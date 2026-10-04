import * as fs from 'fs';
import * as path from 'path';

/**
 * `sw.js` lives in `public/` and is therefore outside the Vite module graph —
 * a reason to test it deliberately, not a reason to leave the only new runtime
 * file uncovered. Loaded here with a mocked `self` so both handlers can be
 * driven directly.
 */
type Handler = (event: unknown) => void;

const loadWorker = () => {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn();
  const matchAll = vi.fn().mockResolvedValue([]);
  const openWindow = vi.fn().mockResolvedValue(undefined);

  const self = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: { showNotification },
    clients: { matchAll, openWindow },
    skipWaiting: vi.fn(),
  };

  const source = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
  new Function('self', 'clients', source)(self, self.clients);

  return { handlers, showNotification, matchAll, openWindow };
};

/**
 * Both handlers hand a promise to `event.waitUntil(...)` to keep the worker
 * alive until it settles. `notificationclick`'s promise is an async IIFE that
 * suspends at its first `await` (the `clients.matchAll` call), so a fake
 * `waitUntil` that merely returns its argument lets the handler call itself
 * resolve before that IIFE's later work (`focus`/`openWindow`) has run — the
 * assertions would then race the worker's own async work. Capturing the
 * promise and awaiting it after invoking the handler makes the harness wait
 * for exactly what a real worker environment would wait for.
 */
const dispatch = async (handler: Handler, event: object) => {
  let waited: Promise<unknown> | undefined;
  const waitUntil = (promise: Promise<unknown>) => {
    waited = promise;
  };
  handler({ ...event, waitUntil });
  await waited;
};

it('shows a notification from the pushed payload', async () => {
  const { handlers, showNotification } = loadWorker();

  await dispatch(handlers.get('push')!, {
    data: {
      json: () => ({
        title: 'Dune was added',
        body: 'Frank Herbert',
        url: '/request',
        tag: 't1',
      }),
    },
  });

  expect(showNotification).toHaveBeenCalledWith(
    'Dune was added',
    expect.objectContaining({
      body: 'Frank Herbert',
      tag: 't1',
      data: { url: '/request' },
    })
  );
});

it('survives a push with no payload', async () => {
  const { handlers, showNotification } = loadWorker();

  // A push service may wake a worker with an empty push; showing nothing is
  // better than throwing inside the worker, which some browsers surface to the
  // user as a generic "site updated in the background" notification.
  await dispatch(handlers.get('push')!, { data: null });

  expect(showNotification).not.toHaveBeenCalled();
});

it('focuses an open tab rather than opening a second one', async () => {
  const { handlers, matchAll, openWindow } = loadWorker();
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  matchAll.mockResolvedValue([{ url: 'https://books.example/library', focus, navigate }]);

  const close = vi.fn();
  await dispatch(handlers.get('notificationclick')!, {
    notification: { data: { url: '/request' }, close },
  });

  expect(focus).toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it('opens a window when nothing is open', async () => {
  const { handlers, openWindow } = loadWorker();

  await dispatch(handlers.get('notificationclick')!, {
    notification: { data: { url: '/request' }, close: vi.fn() },
  });

  expect(openWindow).toHaveBeenCalledWith('/request');
});
