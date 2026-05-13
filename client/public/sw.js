// Service Worker (ПР13 + ПР14 + ПР15 + ПР18)
// App Shell: Cache First для статики, Network First для динамического контента

const APP_SHELL_CACHE = 'app-shell-v3';
const DYNAMIC_CACHE = 'dynamic-content-v1';
const API_CACHE = 'api-cache-v1';

// App Shell — минимальный набор ресурсов для каркаса приложения (ПР15)
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/favicon.ico',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-48x48.png',
  '/icons/favicon-64x64.png',
  '/icons/favicon-128x128.png',
  '/icons/favicon-256x256.png',
  '/icons/favicon-512x512.png',
];

// Установка: кэшируем App Shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Активация: удаляем устаревшие кэши
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== APP_SHELL_CACHE && key !== DYNAMIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегии кэширования (ПР15 + ПР18)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Запросы к API — Network First с фолбэком на кэш (ПР18)
  // GET /api/products кэшируем, чтобы отдавать офлайн
  if (event.request.url.includes('/api/products') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request.clone())
        .then(networkRes => {
          const resClone = networkRes.clone();
          caches.open(API_CACHE).then(cache => {
            cache.put(event.request, resClone);
          });
          return networkRes;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Остальные /api/ запросы — пропускаем (не кэшируем)
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Пропускаем запросы к другим источникам (CDN и пр.)
  if (url.origin !== location.origin) {
    return;
  }

  // Динамический контент (навигация по страницам) — Network First (ПР15)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(networkRes => {
          const resClone = networkRes.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request, resClone);
          });
          return networkRes;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cached => cached || caches.match('/index.html'));
        })
    );
    return;
  }

  // Статические ресурсы (App Shell) — Cache First (ПР15)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(fetchResponse => {
          if (fetchResponse && fetchResponse.status === 200) {
            const responseClone = fetchResponse.clone();
            caches.open(APP_SHELL_CACHE).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return fetchResponse;
        });
      })
      .catch(() => {
        return caches.match('/index.html');
      })
  );
});

// ==================== Push-уведомления (ПР16 + ПР17) ====================

self.addEventListener('push', (event) => {
  let data = { title: 'Новое уведомление', body: '', reminderId: null };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/favicon-128x128.png',
    badge: '/icons/favicon-48x48.png',
    vibrate: [200, 100, 200],
    data: { reminderId: data.reminderId },
  };

  // Если это напоминание — добавляем кнопку «Отложить на 5 минут» (ПР17)
  if (data.reminderId) {
    options.actions = [
      { action: 'snooze', title: 'Отложить на 5 минут' },
    ];
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Клик по push-уведомлению (ПР16 + ПР17)
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;

  // Обработка кнопки «Отложить на 5 минут» (ПР17)
  if (action === 'snooze') {
    const reminderId = notification.data && notification.data.reminderId;
    if (reminderId) {
      event.waitUntil(
        fetch(`https://localhost:3000/api/snooze?reminderId=${reminderId}`, { method: 'POST' })
          .then(() => notification.close())
          .catch((err) => {
            console.error('Snooze failed:', err);
            notification.close();
          })
      );
    } else {
      notification.close();
    }
    return;
  }

  // Обычный клик — открываем приложение
  notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('localhost') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
