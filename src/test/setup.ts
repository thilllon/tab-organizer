import { beforeEach } from 'vitest';
import { createChromeFake } from './chrome-fake';

/** `lib.dom.d.ts` declares `LockGrantedCallback` non-generic, so a typed alias is used instead. */
type LockCallback<T> = (lock: Lock | null) => T | Promise<T>;

/**
 * Minimal Web Locks shim for runtimes without `navigator.locks` (Node < 24, some CI images).
 * Serialises callbacks per lock name, which is all `withLock()` in src/sessions/storage.ts needs.
 */
function createLocksShim(): LockManager {
  const queues = new Map<string, Promise<unknown>>();
  function request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockCallback<T>,
    maybeCallback?: LockCallback<T>,
  ): Promise<Awaited<T>> {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback) {
      return Promise.reject(new TypeError('LockManager.request: callback is required'));
    }
    const previous = queues.get(name) ?? Promise.resolve();
    const run = async (): Promise<Awaited<T>> => {
      await previous.catch(() => undefined);
      return await callback({ name, mode: 'exclusive' });
    };
    const next = run();
    queues.set(name, next);
    return next;
  }
  return {
    request,
    query: async () => ({ held: [], pending: [] }),
  };
}

function installLocksShim(): void {
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    return;
  }
  const shim = createLocksShim();
  if (typeof navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: { locks: shim }, configurable: true });
    return;
  }
  Object.defineProperty(navigator, 'locks', { value: shim, configurable: true });
}

installLocksShim();

// A chrome object must exist at module-evaluation time: `src/background/sessions.ts` (Task 9)
// registers `chrome.runtime.onInstalled.addListener(...)` in its module body, and a static
// `import` in its test runs before any `beforeEach`. This instance is replaced per test below.
Object.assign(globalThis, { chrome: createChromeFake().chrome });

beforeEach(() => {
  const fake = createChromeFake();
  Object.assign(globalThis, { chrome: fake.chrome, __chromeFake: fake });
});
