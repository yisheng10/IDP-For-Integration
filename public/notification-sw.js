self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'TrialLight', body: event.data.text() };
  }

  const title = payload.title || 'TrialLight';
  const options = {
    body: payload.body || 'A new CRC incident requires attention.',
    data: payload.data || {},
    icon: '/triallight-crc-favicon.svg',
    badge: '/triallight-crc-favicon.svg',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/home';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => 'focus' in client);
      if (matchingClient) {
        matchingClient.focus();
        if ('navigate' in matchingClient) {
          return matchingClient.navigate(targetUrl);
        }
        return matchingClient;
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
