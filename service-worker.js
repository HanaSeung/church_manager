const CACHE = 'church-manager-v253';
const ASSETS = [
  'index.html',
  'Sortable.min.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'firebase-config.js',
  'changelog.js',
  'finstore.js',
  'bible.html',
  'hymn.html',
  'responsive.html',
  'board.html',
  'chat.html',
  'chatlist.html',
  'members.html',
  'offering.html',
  'income.html',
  'expense.html',
  'budget.html',
  'stats.html',
  'report.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== 'shared-incoming').map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 캐시 우선 + 네트워크 응답을 캐시에 저장(다음 방문/오프라인 대비)
self.addEventListener('fetch', (e) => {
  // 공유(Share Target)로 들어온 파일 수신: 캐시에 담고 bible.html로 리디렉트
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('sharedFiles');
        const payloads = [];
        for (const f of files) {
          if (f && typeof f.text === 'function') {
            payloads.push({ name: (f.name || 'shared.json'), text: await f.text() });
          }
        }
        const cache = await caches.open('shared-incoming');
        await cache.put(
          new Request('shared-payload.json'),
          new Response(JSON.stringify(payloads), { headers: { 'Content-Type': 'application/json' } })
        );
      } catch (err) { /* 무시 */ }
      return Response.redirect('bible.html?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fromNet = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fromNet;
    })
  );
});
