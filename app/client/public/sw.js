/**
 * Bookplate's service worker. PUSH ONLY.
 *
 * There is deliberately NO `fetch` handler. A worker that never intercepts
 * requests cannot serve a stale bundle, needs no cache-versioning story, and
 * cannot break a release — which is why offline precaching was left out of the
 * spec that introduced this file rather than smuggled into it. If offline
 * support is ever added, it is a `fetch` handler HERE, plus a precache
 * manifest; this file is where to add it.
 *
 * Plain JavaScript in `public/`, copied verbatim to the build root by Vite and
 * served by `routes/ui.ts`'s unauthenticated `express.static` — the same path
 * `site.webmanifest` already takes. It must NOT be reached by that router's
 * `router.get('*', serveSpa)` catch-all: a worker served as `index.html`
 * registers successfully and then never fires, which presents as push being
 * silently broken with no error anywhere.
 *
 * The scope is the serving path's directory, so at `/sw.js` the scope is `/`,
 * matching what `site.webmanifest` declares. Moving this file into a
 * subdirectory would silently narrow that.
 */

self.addEventListener('push', (event) => {
  // A push service may wake the worker with no payload at all. Showing nothing
  // beats throwing: an unhandled rejection here is surfaced by some browsers
  // as a generic "this site was updated in the background" notification.
  if (!event.data) return;

  let message;
  try {
    message = event.data.json();
  } catch {
    return;
  }
  if (!message || typeof message.title !== 'string') return;

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: typeof message.body === 'string' ? message.body : '',
      // The collapse key. An at-least-once redelivery of the same notification
      // REPLACES the one on screen instead of stacking beside it — see
      // `services/push-template.ts`.
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      icon: '/png/icon-192.png',
      badge: '/png/icon-192.png',
      data: { url: typeof message.url === 'string' ? message.url : '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      // Focus an already-open Bookplate rather than opening a second copy;
      // `navigate` moves that tab to the deep link where the browser allows it.
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        await client.focus();
        if (typeof client.navigate === 'function') {
          try {
            await client.navigate(url);
          } catch {
            // Cross-origin or otherwise refused; the focused tab is still the
            // right outcome.
          }
        }
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
