// Thu chi gia đình – service worker
// Mở app tức thì: trả bản đã lưu trong máy ngay, đồng thời tải bản mới ở nền;
// nếu index.html có thay đổi thì báo app hiện nút "Tải lại".
var CACHE = 'thu-chi-v1';
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(['./', './manifest.webmanifest', './icon-192.png']).catch(function () {}); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function sig(r) { return r ? (r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length') || '') : ''; }
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;                                   // gọi máy chủ Apps Script: không đụng tới
  if (/script\.google|googleusercontent|generativelanguage/.test(url.hostname)) return;
  var page = req.mode === 'navigate';
  var key = page ? new Request(new URL('./', self.registration.scope).href) : req;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(key, { ignoreSearch: page }).then(function (old) {
      var net = (page ? fetch(key.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req)).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var changed = old && page && sig(old) !== sig(res);
          c.put(key, res.clone());
          // đợi trang mới chạy xong rồi mới báo (báo ngay thì trang cũ đang đóng nhận mất)
          if (changed) return new Promise(function (ok) { setTimeout(ok, 2000); }).then(function () {
            return self.clients.matchAll({ type: 'window' }).then(function (cl) { cl.forEach(function (x) { x.postMessage('new-version'); }); return res; });
          });
        }
        return res;
      }).catch(function () { return old; });
      if (old) { e.waitUntil(net); return old; }                       // có bản trong máy → mở ngay
      return net;
    });
  }));
});
