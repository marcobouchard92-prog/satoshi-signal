// Service Worker — Satoshi Signal
// Handles background push notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SIGNAL_CHANGE') {
    const { signal, price, conf, tf } = event.data;
    const emoji = signal === 'BUY' ? '🟢' : signal === 'SELL' ? '🔴' : '🟡';
    
    const options = {
      body: `${emoji} ${signal} @ $${Number(price).toLocaleString('en-US', {maximumFractionDigits:0})} — Confidence ${conf}% (${tf})`,
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'satoshi-signal',
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      data: { signal, price, conf, tf, url: self.location.origin },
      actions: [
        { action: 'open', title: 'Ouvrir l\'app' },
        { action: 'dismiss', title: 'Ignorer' }
      ]
    };

    event.waitUntil(
      self.registration.showNotification('₿ Satoshi Signal', options)
    );
  }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow(self.location.origin);
      }
    })
  );
});

// Keep alive — periodic sync to check signals even when tab is closed
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-signal') {
    event.waitUntil(checkBTCSignal());
  }
});

async function checkBTCSignal() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=168');
    const data = await res.json();
    const closes = data.map(k => parseFloat(k[4]));
    
    // Simple RSI check
    const rsi = calcRSI(closes, 14);
    
    if (rsi < 30) {
      await self.registration.showNotification('₿ Satoshi Signal — ALERTE', {
        body: `🟢 RSI oversold (${rsi.toFixed(1)}) — Potentiel signal BUY`,
        tag: 'satoshi-rsi-alert',
        renotify: true,
        vibrate: [300, 100, 300],
      });
    } else if (rsi > 70) {
      await self.registration.showNotification('₿ Satoshi Signal — ALERTE', {
        body: `🔴 RSI overbought (${rsi.toFixed(1)}) — Potentiel signal SELL`,
        tag: 'satoshi-rsi-alert',
        renotify: true,
        vibrate: [300, 100, 300],
      });
    }
  } catch(e) {}
}

function calcRSI(prices, period) {
  if (prices.length < period + 1) return 50;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i-1];
    d > 0 ? ag += d : al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i-1];
    ag = (ag * (period-1) + Math.max(0, d)) / period;
    al = (al * (period-1) + Math.max(0, -d)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag/al);
}
