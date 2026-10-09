import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  PermissionDeniedError,
  type ClientOptions,
} from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ParsedBetaMessage } from '@anthropic-ai/sdk/lib/beta-parser';
import type {
  BetaImageBlockParam,
  BetaTextBlockParam,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { silentLogger, type Logger } from '../logger';
import {
  FoodAiError,
  sanitizeEstimate,
  sanitizeRecalculation,
  type FoodEstimate,
  type FoodEstimateInput,
  type FoodEstimator,
  type FoodRecalcInput,
  type FoodRecalculation,
  type RawEstimate,
} from './estimator';

export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_TOKENS = 8000;
/** Server-side refusal fallback, `fallbacks: 'default'` form (routes by refusal category). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Stable on purpose (no dates, no user data): the same prefix on every request. */
export const SYSTEM_PROMPT = `You are a nutrition estimator inside a personal food diary. The user is a woman in Ukraine who tracks a calorie deficit. She logs a meal as a short description (usually in Ukrainian), a photo of the food, or both, and you estimate its energy.

How to estimate:
- Identify each distinct food or drink and list it as its own item.
- Description: use the quantities she states (grams, millilitres, pieces, spoons). Where none are given, assume a typical home portion in Ukraine.
- Photo: judge portions from visual cues such as plate and bowl size, cutlery, hands and packaging. If a description comes with the photo, use it to identify the dishes and quantities.
- Assume Ukrainian and Eastern European home cooking and products sold in Ukrainian shops unless something else is clear.
- Include drinks and whatever adds energy: visible sauces, oil, butter, sour cream, dressing, sugar in tea or coffee.
- Never add items that are neither mentioned nor visible.

How to answer:
- name: a short Ukrainian name, e.g. «Вівсянка з бананом».
- portion: in Ukrainian, as grams or a household measure, e.g. «250 г», «1 скибка», «1 чашка (250 мл)».
- kcal: a whole number for that portion.
- comment: an empty string, or one short Ukrainian sentence when it helps her, e.g. when a portion is hard to judge from the photo.
- If the photo shows no food or drink, return no items and the comment «Схоже, на фото немає їжі».
- Report estimates only: no diet advice, judgement or moralising.`;

/**
 * For «✨ Перерахувати»: she has corrected the items, so the model only prices them. Also stable;
 * the extra section overrides the identification rules of the base prompt.
 */
export const RECALC_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

Recalculation:
In this request she has already reviewed an estimate and corrected the items herself. Her numbered list is final, and these rules take precedence over the ones above:
- Return exactly one item for each numbered line, in the same order, with her name and portion copied unchanged. Never rename, merge, split, reorder, drop or add items, even if the photo seems to show something else.
- kcal: the energy of exactly that food in exactly that portion. Where a line has no portion, assume a typical home portion in Ukraine.
- If a photo is attached, use it only to understand how the food was prepared: oil, butter, sauces, dressing, cooking method. Count such additions into the item they belong to unless she lists them as a line of their own.
- comment: an empty string, or one short Ukrainian sentence when it helps her, e.g. when a portion is ambiguous.`;

/** What the model must produce; kept permissive — `sanitizeEstimate` enforces the API limits. */
const modelOutputSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe('Short Ukrainian name of the food or drink'),
      portion: z.string().describe('Portion in Ukrainian: grams or a household measure'),
      kcal: z.number().describe('Energy of this portion in kcal, a whole number'),
    }),
  ),
  comment: z.string().describe('Empty, or one short Ukrainian sentence'),
}) satisfies z.ZodType<RawEstimate>;

/** JSON schema for `output_config.format`, plus the parser `beta.messages.parse()` applies. */
const outputFormat = betaZodOutputFormat(modelOutputSchema);

function userText({ text, imageBase64 }: FoodEstimateInput): string {
  const meal = `<meal>\n${text}\n</meal>`;
  if (imageBase64 === null) return `What I ate:\n${meal}`;
  return text ? `A photo of what I ate. My description:\n${meal}` : 'A photo of what I ate.';
}

/** One line of the numbered list: line breaks inside her values would break the numbering. */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** «1. Вівсянка з бананом — 250 г»; a line without a portion is just the name. */
export function recalcList(items: FoodRecalcInput['items']): string {
  return items
    .map(({ name, portion }, i) => {
      const what = oneLine(portion) ? `${oneLine(name)} — ${oneLine(portion)}` : oneLine(name);
      return `${i + 1}. ${what}`;
    })
    .join('\n');
}

function recalcText({ items, imageBase64 }: FoodRecalcInput): string {
  const lead = imageBase64 === null ? 'My corrected items:' : 'A photo of what I ate. My corrected items:';
  return `${lead}\n<items>\n${recalcList(items)}\n</items>`;
}

/** The image (if any) goes before the text, as the vision docs recommend. */
function withImage(text: string, imageBase64: string | null): (BetaImageBlockParam | BetaTextBlockParam)[] {
  const block: BetaTextBlockParam = { type: 'text', text };
  if (imageBase64 === null) return [block];
  return [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }, block];
}

export const userContent = (input: FoodEstimateInput) => withImage(userText(input), input.imageBase64);

const recalcContent = (input: FoodRecalcInput) => withImage(recalcText(input), input.imageBase64);

/**
 * Opus 5.5 runs adaptive thinking by default and rejects `thinking: disabled`, so `thinking`,
 * sampling parameters and `tool_choice` are deliberately absent; `effort: 'low'` keeps it quick.
 * Both modes share everything but the system prompt and the user message (same output schema).
 */
function buildRequest(model: string, system: string, content: (BetaImageBlockParam | BetaTextBlockParam)[]) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system,
    output_config: { effort: 'low', format: outputFormat },
    messages: [{ role: 'user', content }],
  } satisfies MessageCreateParamsNonStreaming;
}

export const buildEstimateRequest = (input: FoodEstimateInput, model: string) =>
  buildRequest(model, SYSTEM_PROMPT, userContent(input));

export const buildRecalcRequest = (input: FoodRecalcInput, model: string) =>
  buildRequest(model, RECALC_SYSTEM_PROMPT, recalcContent(input));

export type EstimateRequest = ReturnType<typeof buildRequest>;
export type EstimateMessage = Pick<
  ParsedBetaMessage<RawEstimate>,
  'stop_reason' | 'stop_details' | 'parsed_output'
>;

/** The slice of the SDK client the estimator uses; tests inject a fake object (no network). */
export interface FoodAiClient {
  beta: { messages: { parse(params: EstimateRequest): PromiseLike<EstimateMessage> } };
}

/** Checks `stop_reason` before touching the output; returns the raw structured output. */
function structuredOutput(message: EstimateMessage): RawEstimate {
  switch (message.stop_reason) {
    case 'end_turn':
      break;
    case 'refusal':
      throw new FoodAiError('ai_failed', `refusal (category: ${message.stop_details?.category ?? 'none'})`);
    case 'max_tokens':
      throw new FoodAiError('ai_failed', 'output cut off at max_tokens');
    default:
      throw new FoodAiError('ai_failed', `unexpected stop_reason ${String(message.stop_reason)}`);
  }
  if (!message.parsed_output) throw new FoodAiError('ai_failed', 'no structured output in the response');
  return message.parsed_output;
}

/** Checks `stop_reason`, then cleans the output up. */
export const readEstimateResponse = (message: EstimateMessage): FoodEstimate =>
  sanitizeEstimate(structuredOutput(message));

/** Checks `stop_reason`, then requires exactly `expected` items and takes their kcal by index. */
export const readRecalcResponse = (message: EstimateMessage, expected: number): FoodRecalculation =>
  sanitizeRecalculation(structuredOutput(message), expected);

/** First line, at most 160 characters: enough to diagnose, never a dump. */
const short = (message: string): string => (message.split('\n')[0] ?? '').slice(0, 160);

/** Maps anything the SDK call can throw to our two outcomes. The reason never holds user content. */
export function toFoodAiError(err: unknown): FoodAiError {
  if (err instanceof FoodAiError) return err;
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new FoodAiError('ai_unavailable', `HTTP ${err.status}`);
  }
  // Subclasses of APIError with no HTTP status come first.
  if (err instanceof APIConnectionTimeoutError) return new FoodAiError('ai_failed', 'request timed out');
  if (err instanceof APIUserAbortError) return new FoodAiError('ai_failed', 'request aborted');
  if (err instanceof APIConnectionError) return new FoodAiError('ai_failed', 'connection failed');
  // RateLimitError (429), InternalServerError (5xx/529), BadRequestError (400), NotFoundError, …
  if (err instanceof APIError) {
    return new FoodAiError(
      'ai_failed',
      `HTTP ${String(err.status)} ${err.type ?? ''}: ${short(err.message)}`,
    );
  }
  // Thrown by parse() when a text block is not valid JSON for the schema; its message may quote output.
  if (err instanceof AnthropicError)
    return new FoodAiError('ai_failed', 'structured output could not be parsed');
  return new FoodAiError('ai_failed', `unexpected ${err instanceof Error ? err.name : typeof err}`);
}

type SdkLogger = NonNullable<ClientOptions['logger']>;

/** Forwards only the SDK's own message (never the extra arguments, which can carry request data). */
const sdkLogger = (logger: Logger): SdkLogger => ({
  error: (message: string) => logger.error(`anthropic sdk: ${message}`),
  warn: (message: string) => logger.warn(`anthropic sdk: ${message}`),
  info: () => undefined,
  debug: () => undefined,
});

export function createAnthropicClient(apiKey: string, logger: Logger = silentLogger): FoodAiClient {
  return new Anthropic({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    // Explicit, so ANTHROPIC_LOG=debug cannot make the SDK log request bodies (photos, text).
    logLevel: 'warn',
    logger: sdkLogger(logger),
  });
}

export interface ClaudeEstimatorOptions {
  apiKey: string;
  /** `FOOD_AI_MODEL`, default `claude-opus-5-5`. */
  model: string;
  logger?: Logger;
  /** Tests: a fake client instead of the SDK. */
  client?: FoodAiClient;
}

export function createClaudeEstimator({
  apiKey,
  model,
  logger = silentLogger,
  client,
}: ClaudeEstimatorOptions): FoodEstimator {
  const api = client ?? createAnthropicClient(apiKey, logger);
  let keyRejected = false;

  /** One model call; every failure becomes a logged `FoodAiError`. */
  async function call<T>(
    what: 'estimate' | 'recalculation',
    request: EstimateRequest,
    read: (message: EstimateMessage) => T,
  ): Promise<T> {
    try {
      const result = read(await api.beta.messages.parse(request));
      keyRejected = false;
      return result;
    } catch (err) {
      const error = toFoodAiError(err);
      if (error.code === 'ai_unavailable') {
        if (!keyRejected) logger.error(`Anthropic key rejected (${error.reason}): check ANTHROPIC_API_KEY`);
        keyRejected = true;
      } else {
        logger.warn(`food ${what} failed: ${error.reason}`);
      }
      throw error;
    }
  }

  return {
    estimate: (input) => call('estimate', buildEstimateRequest(input, model), readEstimateResponse),
    recalculate: (input) =>
      call('recalculation', buildRecalcRequest(input, model), (message) =>
        readRecalcResponse(message, input.items.length),
      ),
  };
}
