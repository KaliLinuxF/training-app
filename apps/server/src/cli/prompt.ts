import type { Readable, Writable } from 'node:stream';

/** First line of a stream (without the line break); the whole input when there is none. */
export async function readFirstLine(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk as Uint8Array);
    chunks.push(buf);
    if (buf.includes(0x0a)) break;
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.split(/\r?\n/, 1)[0] ?? '';
}

export class PromptCancelled extends Error {
  override name = 'PromptCancelled';
}

const ENTER = new Set(['\r', '\n']);
const BACKSPACE = new Set(['\u007f', '\b']);
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const ESC = '\u001b';

/**
 * Reads a line from a TTY without echoing it. Handles backspace, Ctrl+C / Ctrl+D (cancel)
 * and ignores escape sequences (arrow keys).
 */
export function promptHidden(question: string, input: NodeJS.ReadStream, output: Writable): Promise<string> {
  if (!input.isTTY) return Promise.reject(new Error('stdin is not a terminal'));
  output.write(question);
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    let escape = false;

    const finish = (err: Error | null): void => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (err) reject(err);
      else resolve(value);
    };

    function onData(chunk: string): void {
      for (const ch of chunk) {
        if (escape) {
          // CSI sequences end with a byte in @–~ (but '[' itself starts them).
          if (ch !== '[' && ch >= '@' && ch <= '~') escape = false;
          continue;
        }
        if (ENTER.has(ch)) return finish(null);
        if (ch === CTRL_C || ch === CTRL_D) return finish(new PromptCancelled('Cancelled'));
        if (ch === ESC) escape = true;
        else if (BACKSPACE.has(ch)) value = Array.from(value).slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
    }

    input.on('data', onData);
  });
}
