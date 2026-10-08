import type { HttpBindings } from '@hono/node-server';

/** Bindings are absent when the app is driven through `app.request()` in tests. */
export interface AppEnv {
  Bindings: Partial<HttpBindings>;
}
