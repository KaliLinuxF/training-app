import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { LIMITS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { createLogger, type Logger } from '../logger';
import {
  buildEstimateRequest,
  createAnthropicClient,
  createClaudeEstimator,
  FALLBACK_BETA,
  MAX_TOKENS,
  readEstimateResponse,
  REQUEST_TIMEOUT_MS,
  SYSTEM_PROMPT,
  toFoodAiError,
  type EstimateMessage,
  type EstimateRequest,
  type FoodAiClient,
} from './claude';
import { FoodAiError, type FoodEstimateInput, type RawEstimate } from './estimator';

const MODEL = 'claude-opus-5-5';
const API_KEY = 'sk-ant-test-not-a-real-key';
const IMAGE = '/9j/4AAQSkZJRgABAQAAAQABAAD-test-image-payload';
const TEXT = 'вівсянка з бананом, кава з молоком';

const textInput: FoodEstimateInput = { text: TEXT, imageBase64: null };
const photoInput: FoodEstimateInput = { text: '', imageBase64: IMAGE };

const output: RawEstimate = {
  items: [
    { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 },
    { name: 'Кава з молоком', portion: '1 чашка (250 мл)', kcal: 60 },
  ],
  comment: '',
};

const message = (patch: Partial<EstimateMessage> = {}): EstimateMessage => ({
  stop_reason: 'end_turn',
  stop_details: null,
  parsed_output: output,
  ...patch,
});

function fakeClient(respond: () => EstimateMessage | Promise<EstimateMessage>) {
  const calls: EstimateRequest[] = [];
  const client: FoodAiClient = {
    beta: {
      messages: {
        parse: async (params) => {
          calls.push(params);
          return respond();
        },
      },
    },
  };
  return { client, calls };
}

function captureLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return Object.assign(
    createLogger('debug', (line) => lines.push(line)),
    { lines },
  );
}

const headers = new Headers();
const apiError = (status: number, type: string) => ({
  type: 'error',
  error: { type, message: `${type} happened` },
});

describe('buildEstimateRequest', () => {
  it('asks Opus 5.5 for structured output at low effort, with the server-side refusal fallback', () => {
    const req = buildEstimateRequest(textInput, MODEL);
    expect(req).toMatchObject({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(MAX_TOKENS).toBe(8000);
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
    // Opus 5.5 rejects disabled thinking; sampling params and forced tool use are not sent at all.
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'stream']) {
      expect(req, key).not.toHaveProperty(key);
    }
  });

  it('describes the output with a strict JSON schema', () => {
    const { schema } = buildEstimateRequest(textInput, MODEL).output_config.format;
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['items', 'comment'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'portion', 'kcal'],
            properties: { name: { type: 'string' }, portion: { type: 'string' }, kcal: { type: 'number' } },
          },
        },
        comment: { type: 'string' },
      },
    });
  });

  it('sends text only as one text block', () => {
    const [msg] = buildEstimateRequest(textInput, MODEL).messages;
    expect(msg?.role).toBe('user');
    expect(msg?.content).toEqual([{ type: 'text', text: `What I ate:\n<meal>\n${TEXT}\n</meal>` }]);
  });

  it('puts the image block before the text block', () => {
    const photo = buildEstimateRequest(photoInput, MODEL).messages[0]?.content;
    expect(photo).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: IMAGE } },
      { type: 'text', text: 'A photo of what I ate.' },
    ]);
    const both = buildEstimateRequest({ text: TEXT, imageBase64: IMAGE }, MODEL).messages[0]?.content;
    expect(both?.map((b) => b.type)).toEqual(['image', 'text']);
    expect(both?.[1]).toEqual({
      type: 'text',
      text: `A photo of what I ate. My description:\n<meal>\n${TEXT}\n</meal>`,
    });
  });

  it('keeps the system prompt stable and covers the brief', () => {
    expect(buildEstimateRequest(photoInput, 'x').system).toBe(buildEstimateRequest(textInput, 'y').system);
    for (const phrase of [
      'woman in Ukraine',
      'calorie deficit',
      '«250 г»',
      '«1 скибка»',
      '«1 чашка (250 мл)»',
    ]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
    expect(SYSTEM_PROMPT).toContain('«Схоже, на фото немає їжі»');
    expect(SYSTEM_PROMPT).toMatch(/no diet advice/);
  });
});

describe('readEstimateResponse', () => {
  it('returns the cleaned-up estimate on end_turn', () => {
    expect(readEstimateResponse(message())).toEqual(output);
  });

  it.each([
    ['refusal', /refusal \(category: bio\)/],
    ['max_tokens', /max_tokens/],
    ['pause_turn', /unexpected stop_reason pause_turn/],
    ['tool_use', /unexpected stop_reason/],
  ] as const)('checks stop_reason first: %s → ai_failed', (stop_reason, reason) => {
    const msg = message({
      stop_reason,
      stop_details:
        stop_reason === 'refusal'
          ? {
              type: 'refusal',
              category: 'bio',
              explanation: null,
              fallback_credit_token: null,
              fallback_has_prefill_claim: null,
              recommended_model: null,
            }
          : null,
    });
    const err = (() => {
      try {
        readEstimateResponse(msg);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(FoodAiError);
    expect(err).toMatchObject({ code: 'ai_failed', reason: expect.stringMatching(reason) });
  });

  it('fails without structured output', () => {
    expect(() => readEstimateResponse(message({ parsed_output: null }))).toThrow(FoodAiError);
  });

  it('clamps kcal and fits names, portions, item count and comment to the API limits', () => {
    const raw: RawEstimate = {
      items: [
        { name: '  Борщ  ', portion: ' 300 г ', kcal: 182.6 },
        { name: 'Олія', portion: '', kcal: -5 },
        { name: 'Торт', portion: 'весь', kcal: 99999 },
        { name: '   ', portion: '1 шт.', kcal: 10 },
        { name: 'Я'.repeat(LIMITS.foodName + 20), portion: 'п'.repeat(LIMITS.portion + 5), kcal: Number.NaN },
        ...Array.from({ length: 40 }, (_, i) => ({ name: `Страва ${i}`, portion: '', kcal: 1 })),
      ],
      comment: `  ${'Порція приблизна. '.repeat(30)}`,
    };
    const result = readEstimateResponse(message({ parsed_output: raw }));
    expect(result.items).toHaveLength(30);
    expect(result.items.slice(0, 4)).toEqual([
      { name: 'Борщ', portion: '300 г', kcal: 183 },
      { name: 'Олія', portion: '', kcal: 0 },
      { name: 'Торт', portion: 'весь', kcal: LIMITS.kcal.max },
      { name: 'Я'.repeat(LIMITS.foodName), portion: 'п'.repeat(LIMITS.portion), kcal: 0 },
    ]);
    expect(result.comment.length).toBeLessThanOrEqual(300);
    expect(result.comment.startsWith('Порція приблизна.')).toBe(true);
  });

  it('never cuts an emoji in half', () => {
    const raw: RawEstimate = {
      items: [{ name: `${'a'.repeat(LIMITS.foodName - 1)}🍌`, portion: '', kcal: 1 }],
      comment: '',
    };
    expect(readEstimateResponse(message({ parsed_output: raw })).items[0]?.name).toBe(
      'a'.repeat(LIMITS.foodName - 1),
    );
  });
});

describe('toFoodAiError (typed SDK errors)', () => {
  it.each([
    [
      'AuthenticationError',
      new AuthenticationError(401, apiError(401, 'authentication_error'), undefined, headers),
      'ai_unavailable',
    ],
    [
      'PermissionDeniedError',
      new PermissionDeniedError(403, apiError(403, 'permission_error'), undefined, headers),
      'ai_unavailable',
    ],
    [
      'RateLimitError',
      new RateLimitError(429, apiError(429, 'rate_limit_error'), undefined, headers),
      'ai_failed',
    ],
    [
      'InternalServerError',
      new InternalServerError(529, apiError(529, 'overloaded_error'), undefined, headers),
      'ai_failed',
    ],
    [
      'BadRequestError',
      new BadRequestError(400, apiError(400, 'invalid_request_error'), undefined, headers),
      'ai_failed',
    ],
    [
      'NotFoundError',
      new NotFoundError(404, apiError(404, 'not_found_error'), undefined, headers),
      'ai_failed',
    ],
    ['APIConnectionError', new APIConnectionError({ message: 'Connection error.' }), 'ai_failed'],
    ['APIConnectionTimeoutError', new APIConnectionTimeoutError(), 'ai_failed'],
    [
      'AnthropicError (unparseable output)',
      new AnthropicError('Failed to parse structured output: SyntaxError'),
      'ai_failed',
    ],
    ['unknown', new TypeError('boom'), 'ai_failed'],
  ] as const)('%s → %s', (_name, err, code) => {
    expect(toFoodAiError(err).code).toBe(code);
  });

  it('keeps reasons short and free of output text', () => {
    expect(
      toFoodAiError(new RateLimitError(429, apiError(429, 'rate_limit_error'), undefined, headers)).reason,
    ).toMatch(/^HTTP 429 /);
    expect(toFoodAiError(new APIConnectionTimeoutError()).reason).toBe('request timed out');
    const parseFailure = new AnthropicError(
      'Failed to parse structured output: "Вівсянка з бананом" is not valid JSON',
    );
    expect(toFoodAiError(parseFailure).reason).toBe('structured output could not be parsed');
  });
});

describe('createClaudeEstimator (fake client)', () => {
  it('sends the built request and returns the estimate', async () => {
    const { client, calls } = fakeClient(() => message());
    const estimator = createClaudeEstimator({ apiKey: API_KEY, model: 'claude-test-model', client });
    expect(await estimator.estimate(photoInput)).toEqual(output);
    expect(calls).toEqual([buildEstimateRequest(photoInput, 'claude-test-model')]);
  });

  it('logs a rejected key once, other failures each time — never the prompt, the photo or the key', async () => {
    const logger = captureLogger();
    let next: unknown = new AuthenticationError(
      401,
      apiError(401, 'authentication_error'),
      undefined,
      headers,
    );
    const { client } = fakeClient(() => {
      if (next instanceof Error) throw next;
      return message();
    });
    const estimator = createClaudeEstimator({ apiKey: API_KEY, model: MODEL, client, logger });

    for (let i = 0; i < 3; i++)
      await expect(estimator.estimate(photoInput)).rejects.toMatchObject({ code: 'ai_unavailable' });
    expect(logger.lines.filter((l) => l.includes('Anthropic key rejected'))).toHaveLength(1);

    next = new InternalServerError(529, apiError(529, 'overloaded_error'), undefined, headers);
    await expect(estimator.estimate({ text: TEXT, imageBase64: IMAGE })).rejects.toMatchObject({
      code: 'ai_failed',
    });
    next = new APIConnectionTimeoutError();
    await expect(estimator.estimate(textInput)).rejects.toMatchObject({ code: 'ai_failed' });
    next = null;
    await expect(estimator.estimate(textInput)).resolves.toEqual(output);

    expect(logger.lines.filter((l) => l.includes('food estimate failed'))).toHaveLength(2);
    for (const line of logger.lines) {
      expect(line).not.toContain(IMAGE);
      expect(line).not.toContain(TEXT);
      expect(line).not.toContain(API_KEY);
    }
  });

  it('turns refusals and truncated output into ai_failed', async () => {
    const { client } = fakeClient(() => message({ stop_reason: 'refusal', parsed_output: null }));
    const estimator = createClaudeEstimator({ apiKey: API_KEY, model: MODEL, client });
    await expect(estimator.estimate(textInput)).rejects.toMatchObject({ code: 'ai_failed' });
  });
});

describe('with the real SDK client and a fake fetch (no network)', () => {
  interface Captured {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }

  function sdkWith(respond: () => Response) {
    const captured: Captured[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      captured.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: body as Record<string, unknown>,
      });
      return respond();
    };
    return { client: new Anthropic({ apiKey: API_KEY, fetch, maxRetries: 0 }), captured };
  }

  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const apiMessage = (text: string, stop_reason = 'end_turn') => ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text },
    ],
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  });

  it('serialises the request as the Messages API expects and parses the structured output', async () => {
    const { client, captured } = sdkWith(() => jsonResponse(200, apiMessage(JSON.stringify(output))));
    const estimator = createClaudeEstimator({ apiKey: API_KEY, model: MODEL, client });
    expect(await estimator.estimate({ text: TEXT, imageBase64: IMAGE })).toEqual(output);

    const [req] = captured;
    expect(req?.url).toMatch(/\/v1\/messages\?beta=true$/);
    // parse() adds the structured-outputs beta itself.
    expect(req?.headers.get('anthropic-beta')?.split(',')).toContain(FALLBACK_BETA);
    expect(req?.headers.get('x-api-key')).toBe(API_KEY);
    expect(req?.body).toMatchObject({
      model: MODEL,
      max_tokens: 8000,
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(req?.body).not.toHaveProperty('betas');
    expect(req?.body).not.toHaveProperty('thinking');
    expect(req?.body).not.toHaveProperty('temperature');
    const [first] = req?.body.messages as { content: { type: string }[] }[];
    expect(first?.content.map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('maps HTTP failures through the typed SDK errors', async () => {
    const cases: [number, string, string][] = [
      [401, 'authentication_error', 'ai_unavailable'],
      [403, 'permission_error', 'ai_unavailable'],
      [429, 'rate_limit_error', 'ai_failed'],
      [529, 'overloaded_error', 'ai_failed'],
      [400, 'invalid_request_error', 'ai_failed'],
    ];
    for (const [status, type, code] of cases) {
      const { client } = sdkWith(() => jsonResponse(status, apiError(status, type)));
      const estimator = createClaudeEstimator({ apiKey: API_KEY, model: MODEL, client });
      await expect(estimator.estimate(textInput), String(status)).rejects.toMatchObject({ code });
    }
  });

  it('treats truncated JSON (max_tokens) and a refusal as ai_failed', async () => {
    for (const body of [
      apiMessage('{"items": [{"name": "Бор', 'max_tokens'),
      { ...apiMessage(''), content: [], stop_reason: 'refusal' },
    ]) {
      const { client } = sdkWith(() => jsonResponse(200, body));
      const estimator = createClaudeEstimator({ apiKey: API_KEY, model: MODEL, client });
      await expect(estimator.estimate(textInput)).rejects.toMatchObject({ code: 'ai_failed' });
    }
  });
});

describe('createAnthropicClient', () => {
  it('uses a 60 s timeout, one retry and a fixed log level', () => {
    const client = createAnthropicClient(API_KEY);
    expect(client).toBeInstanceOf(Anthropic);
    if (!(client instanceof Anthropic)) return;
    expect(client.timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(client.maxRetries).toBe(1);
    expect(client.logLevel).toBe('warn');
  });
});
