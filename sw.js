/* Service worker do Meu Caixa: deixa o app abrir sem internet.
   Estratégia: responde na hora com o que está guardado e atualiza o guardado em segundo plano.
   Ao publicar uma versão nova, troque o número em VERSAO para limpar o guardado antigo. */
const VERSAO = 'v3';
const CACHE = 'meu-caixa-' + VERSAO;
const ARQUIVOS = [
  './', 'index.html', 'styles.css', 'logic.js', 'db.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((guardado) => {
      const rede = fetch(e.request)
        .then((r) => {
          if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
          return r;
        })
        .catch(() => guardado);
      return guardado || rede;
    })
  );
});
