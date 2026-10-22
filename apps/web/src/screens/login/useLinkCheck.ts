import type { LinkKind, LinkProblem } from '@legko/shared';
import { useCallback, useEffect, useState } from 'react';
import { captureLinkToken } from '../../auth/linkToken';
import { ApiError } from '../../lib/api';
import { linkRequestErrorText } from './loginErrors';

export type LinkCheck<T> =
  | { phase: 'loading' }
  | { phase: 'invalid'; reason: LinkProblem }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; token: string; info: T };

/**
 * Takes the token from the URL fragment (or sessionStorage after a reload, §8.4) and asks the server whether the
 * link can be used. `markInvalid` switches to the «Посилання не працює» state later (a 410 on submit).
 */
export function useLinkCheck<T>(
  kind: LinkKind,
  check: (token: string) => Promise<T>,
): { state: LinkCheck<T>; retry: () => void; markInvalid: (reason: LinkProblem) => void } {
  // Read once, before the first paint: the fragment is stripped right away.
  const [token] = useState(() => captureLinkToken(kind));
  const [state, setState] = useState<LinkCheck<T>>(() =>
    token === null ? { phase: 'invalid', reason: 'unknown' } : { phase: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (token === null) return;
    let live = true;
    check(token).then(
      (info) => {
        if (live) setState({ phase: 'ready', token, info });
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && (err.code === 'link_invalid' || err.status === 410)) {
          setState({ phase: 'invalid', reason: err.reason ?? 'unknown' });
        } else if (err instanceof ApiError && err.code === 'bad_request') {
          setState({ phase: 'invalid', reason: 'unknown' });
        } else {
          setState({ phase: 'error', message: linkRequestErrorText(err) });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [token, attempt, check]);

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const markInvalid = useCallback((reason: LinkProblem) => setState({ phase: 'invalid', reason }), []);

  return { state, retry, markInvalid };
}
