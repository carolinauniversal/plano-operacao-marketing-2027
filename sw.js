// Service worker do app: instalação (PWA) e notificações push.
// Não guarda páginas em cache de propósito: cada abertura traz a versão publicada mais recente.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { /* carga inválida: usa o texto padrão */ }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Plano e Operação - Marketing 2027', {
    body: d.corpo || 'Você tem uma nova notificação.',
    icon: 'icone-192.png',
    tag: d.tag || undefined,
    lang: 'pt-BR'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (abertas.length) return abertas[0].focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
