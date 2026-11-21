// Thu chi gia đình – service worker: không lưu đệm (luôn tải bản mới),
// chỉ nhận ảnh bill được chia sẻ từ app khác (Chia sẻ → Thu chi).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method === 'POST' && /\/share-target\/?$/.test(url.pathname)) {
    e.respondWith((async function () {
      try {
        var fd = await e.request.formData();
        var files = fd.getAll('bill');
        var c = await caches.open('share-inbox');
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          if (!f || !f.size) continue;
          var name = Date.now() + '-' + i + '-' + encodeURIComponent(f.name || 'bill.jpg');
          await c.put(new Request('./share-inbox/' + name), new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }));
        }
      } catch (err) {}
      return Response.redirect('./?share=1', 303);
    })());
  }
});
