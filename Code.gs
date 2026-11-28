/**
 * THU CHI GIA ĐÌNH – máy chủ Google Apps Script
 * Gắn với Google Sheet "Thu chi gia đình".
 * Cài đặt: Tiện ích mở rộng → Apps Script → dán toàn bộ file này → Lưu
 *          → chạy hàm capQuyen một lần (cấp quyền) → Triển khai → Ứng dụng web
 *          (Thực thi với tư cách: Tôi · Ai có quyền truy cập: Bất kỳ ai).
 * Mật khẩu ban đầu: admin (app sẽ bắt đổi ngay lần đầu đăng nhập).
 * Khoá Gemini: nhập trong app (Menu → Khoá đọc bill). Không cần sửa file này.
 */

var VER = '28/11/2026-e'; // luôn giống VER trong index.html (máy chủ nạp từ GitHub dùng để biết có bản mới)
var SHEET = 'THU CHI GIA ĐÌNH';
var HEAD = ['ID', 'Ngày', 'Loại', 'Mục', 'Số tiền', 'Nội dung', 'Nơi mua / Người nhận', 'Chi tiết', 'Nguồn', 'Thời gian nhập', 'Tiền mặt / Ngân hàng', 'Người ghi', 'Dự án', 'Vai trò trong dự án'];
// vai trò của một khoản trong dự án (ghi chữ ra Sheet cho dễ đọc)
var JROLE = { von: 'Vốn gia đình bỏ vào', gop: 'Nhận vốn góp', vay: 'Vay / mượn', tra: 'Trả gốc / hoàn vốn', lai: 'Trả lãi / chia lời', cp: 'Chi phí dự án', dt: 'Doanh thu / lợi nhuận' };
function jrOf_(v) { var s = normVN_(v); for (var k in JROLE) if (s && (s === k || s === normVN_(JROLE[k]))) return k; return ''; }
var NCOL = HEAD.length;
// vay nợ: Loại = Vay / Trả nợ / Cho vay / Thu nợ, Mục = Cá nhân / Ngân hàng / Vợ chồng, Nơi mua / Người nhận = tên người cho vay
var NOV = { vay: 'Vay', tra: 'Trả nợ', cho: 'Cho vay', thu: 'Thu nợ' };
function novOf_(v) { var s = normVN_(v); return /^cho vay/.test(s) ? 'cho' : /^thu no/.test(s) ? 'thu' : /^tra no|^tra vay/.test(s) ? 'tra' : /^vay/.test(s) ? 'vay' : ''; }
var DEFAULT_PASS = 'admin';
var DEF_CATS = {
  chi: ['Ăn uống', 'Cà phê – trà sữa', 'Đi chợ – siêu thị', 'Điện nước – internet', 'Xăng xe – đi lại', 'Nhà cửa – đồ dùng',
        'Con cái – học hành', 'Sức khoẻ', 'Mua sắm – quần áo', 'Hiếu hỉ – biếu tặng', 'Giải trí – du lịch',
        'Chi đầu tư / Nhà đất', 'Chi đầu tư / Dự án', 'Chi đầu tư / Chứng khoán', 'Chi đầu tư / Vàng', 'Chi đầu tư / Gửi tiết kiệm', 'Chi đầu tư / Đầu tư khác',
        'Chi khác'],
  thu: ['Lương', 'Thưởng', 'Thu đầu tư / Lãi ngân hàng', 'Thu đầu tư / Thu từ dự án', 'Thu đầu tư / Cổ tức – chứng khoán', 'Thu khác']
};
// Mục con viết "Nhóm / Mục con". Nhóm có chữ "đầu tư" được app tính riêng (không vào chi sinh hoạt).
var GEM_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
var GEM_FALLBACK = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

/* ---------- Web app ---------- */
function doGet() {
  return ContentService.createTextOutput('Thu chi gia đình – máy chủ đang chạy (bản ' + VER + ').');
}

function doPost(e) {
  var out;
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle_(b);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(b) {
  b = b || {};
  var me = whoAmI_(b.token);
  if (!me) return { ok: false, auth: false, error: 'Sai mật khẩu' };
  ME_ = me;
  switch (b.action) {
    case 'login': return { ok: true, def: me === 'c' && !!auth_().def, ver: VER, me: me, users: users_() };
    case 'list': return list_(b.gen);
    case 'add': return withLock_(function () { return add_(b.rows || []); });
    case 'update': return withLock_(function () { return update_(b.row || {}); });
    case 'updMany': return withLock_(function () { var n = 0; (b.rows || []).forEach(function (r) { if (update_(r).ok) n++; }); return { ok: true, n: n }; });
    case 'del': return withLock_(function () { return del_(b.ids || (b.id ? [b.id] : [])); });
    case 'bill': return bill_(b);
    case 'gemCfg': return gemCfg_();
    case 'passChange': return passChange_(b.pass, me);
    case 'userSet': return userSet_(b, me);
    case 'photoList': return photoList_(b.pgen);
    case 'photoUp': return phLock_(function () { return photoUp_(b); });
    case 'photoGet': return photoGet_(b.id, +b.s || 900);
    case 'photoEdit': return phLock_(function () { return photoEdit_(b); });
    case 'photoDel': return phLock_(function () { return photoDel_(b.id); });
    case 'cfgSet': return cfgSet_(b);
    case 'evSave': return withLock_(function () { return evSave_(b.ev || {}); });
    case 'evDel': return withLock_(function () { return evDel_(b.id); });
    case 'calOn': return withLock_(function () { return calOn_(!!b.on); });
    default: return { ok: false, error: 'Lệnh không hợp lệ: ' + b.action };
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { var r = fn(); bump_(); return r; } finally { lock.releaseLock(); }
}

// "đời" dữ liệu: đổi mỗi lần ghi (app, hoặc sửa tay trong Sheet) → app chỉ tải lại khi có thay đổi
function gen_() { return props_().getProperty('gen') || '1'; }
function bump_() { props_().setProperty('gen', Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); }
function onEdit() { try { bump_(); } catch (e) {} }

/* ---------- Mật khẩu ---------- */
function props_() { return PropertiesService.getScriptProperties(); }

function hash_(salt, p) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + p, Utilities.Charset.UTF_8));
}

function auth_() {
  var raw = props_().getProperty('auth');
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  var salt = Utilities.getUuid();
  var a = { salt: salt, hash: hash_(salt, DEFAULT_PASS), def: true };
  props_().setProperty('auth', JSON.stringify(a));
  return a;
}

function checkPass_(t) { return !!whoAmI_(t); }

/* Hai người dùng: 'c' chồng (mật khẩu 'auth', chủ sổ), 'v' vợ (mật khẩu 'auth2', chồng đặt lần đầu). Tên hiển thị đổi được. */
var ME_ = 'c';
function auth2_() { var raw = props_().getProperty('auth2'); if (raw) { try { return JSON.parse(raw); } catch (e) {} } return null; }
function whoAmI_(t) {
  if (!t) return '';
  var a = auth_(); if (hash_(a.salt, String(t)) === a.hash) return 'c';
  var v = auth2_(); if (v && hash_(v.salt, String(t)) === v.hash) return 'v';
  return '';
}
function users_() {
  var u = { c: 'Chồng', v: 'Vợ' };
  try { var x = JSON.parse(props_().getProperty('users') || '{}'); if (x.c) u.c = x.c; if (x.v) u.v = x.v; } catch (e) {}
  u.vOn = !!auth2_();
  return u;
}
function passOk_(p, who) {
  p = String(p || '').trim();
  if (p.length < 4) return 'Mật khẩu cần ít nhất 4 ký tự';
  if (p === DEFAULT_PASS) return 'Không dùng mật khẩu "admin"';
  var other = who === 'c' ? auth2_() : auth_();
  if (other && hash_(other.salt, p) === other.hash) return 'Mật khẩu này trùng với của người kia, chọn mật khẩu khác';
  return '';
}
function passSet_(p, who) {
  var salt = Utilities.getUuid();
  props_().setProperty(who === 'v' ? 'auth2' : 'auth', JSON.stringify({ salt: salt, hash: hash_(salt, String(p).trim()), def: false }));
}
function passChange_(p, me) {
  var e = passOk_(p, me || 'c'); if (e) return { ok: false, error: e };
  passSet_(p, me || 'c');
  return { ok: true };
}
// đổi tên hai người; chồng (chủ sổ) đặt / đổi / tắt mật khẩu của vợ
function userSet_(b, me) {
  var P = props_(), u = users_(), res = { ok: true };
  if (b.names) {
    var n = { c: String(b.names.c || '').trim().slice(0, 20) || 'Chồng', v: String(b.names.v || '').trim().slice(0, 20) || 'Vợ' };
    P.setProperty('users', JSON.stringify(n));
  }
  if (b.vPass !== undefined) {
    if (me !== 'c') return { ok: false, error: 'Chỉ chủ sổ mới đặt được mật khẩu cho người kia' };
    if (b.vPass === '') P.deleteProperty('auth2');
    else { var e = passOk_(b.vPass, 'v'); if (e) return { ok: false, error: e }; passSet_(b.vPass, 'v'); }
  }
  bump_();
  res.users = users_();
  return res;
}

/* ---------- Cài đặt ---------- */
function cats_() {
  var P = props_(), raw = P.getProperty('cats');
  if (raw) {
    try {
      var c = JSON.parse(raw);
      if (c && c.chi && c.chi.length) {
        if (!P.getProperty('catsV2')) { // lần đầu có nhóm đầu tư: thêm vào danh mục anh đã sửa
          var add = function (list, def) {
            if (list.some(function (x) { return /đầu tư/i.test(x); })) return list;
            var inv = def.filter(function (x) { return / \/ /.test(x); });
            return list.slice(0, -1).concat(inv, list.slice(-1));
          };
          c = { chi: add(c.chi, DEF_CATS.chi), thu: add(c.thu, DEF_CATS.thu) };
          P.setProperty('cats', JSON.stringify(c)); P.setProperty('catsV2', '1');
        }
        if (!P.getProperty('catsV3')) { // thêm mục Cà phê – trà sữa ngay sau Ăn uống
          if (!c.chi.some(function (x) { return /ca phe|cafe|coffee|tra sua/.test(normVN_(x)); })) {
            var ai = -1; c.chi.forEach(function (x, i) { if (ai < 0 && /an uong/.test(normVN_(x))) ai = i; });
            c.chi.splice(ai + 1, 0, 'Cà phê – trà sữa');
            P.setProperty('cats', JSON.stringify(c));
          }
          P.setProperty('catsV3', '1');
        }
        return c;
      }
    } catch (e) {}
  }
  return DEF_CATS;
}

function cleanList_(a, last) {
  var seen = {}, out = [];
  (a || []).forEach(function (s) {
    s = String(s || '').replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ').trim().slice(0, 60);
    if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; out.push(s); }
  });
  if (out.map(function (x) { return x.toLowerCase(); }).indexOf(last.toLowerCase()) < 0) out.push(last);
  return out.slice(0, 40);
}

// ngân sách riêng từng người (chồng 'budget', vợ 'budget_v')
function budKey_() { return ME_ === 'v' ? 'budget_v' : 'budget'; }
// số dư gốc của 2 ví (tiền mặt / ngân hàng), riêng từng người; số dư hiện tại = gốc + thu − chi ± chuyển (app tính)
function projects_() { try { return JSON.parse(props_().getProperty('projects') || '[]') || []; } catch (e) { return []; } }
function balKey_() { return ME_ === 'v' ? 'bal_v' : 'bal'; }
function bal_() { try { var b = JSON.parse(props_().getProperty(balKey_()) || 'null'); if (b) return b; } catch (e) {} return null; }
function budget_() {
  try { var b = JSON.parse(props_().getProperty(budKey_()) || 'null'); if (b) return b; } catch (e) {}
  return { total: 0, cats: {} };
}

function cfgSet_(b) {
  var P = props_(), res = { ok: true };
  bump_();
  if (b.projects) { var pl = []; b.projects.forEach(function (n) { n = String(n || '').trim().slice(0, 60); if (n && pl.indexOf(n) < 0) pl.push(n); }); P.setProperty('projects', JSON.stringify(pl)); res.projects = pl; }
  if (b.bal) { var sg = function (v) { return Math.abs(numOf_(v)) * (/^\s*-/.test(String(v)) ? -1 : 1); }, bl = { tm: sg(b.bal.tm), nh: sg(b.bal.nh) }; /* số dư gốc có thể âm */ P.setProperty(balKey_(), JSON.stringify(bl)); res.bal = bl; }
  if (b.budget) {
    var cl = { total: Math.max(0, numOf_(b.budget.total)), cats: {} };
    Object.keys(b.budget.cats || {}).slice(0, 40).forEach(function (k) {
      var v = Math.max(0, numOf_(b.budget.cats[k])); if (v) cl.cats[String(k).slice(0, 40)] = v;
    });
    P.setProperty(budKey_(), JSON.stringify(cl));
    res.budget = cl;
  }
  if (b.cats) {
    var c = { chi: cleanList_(b.cats.chi, 'Chi khác'), thu: cleanList_(b.cats.thu, 'Thu khác') };
    P.setProperty('cats', JSON.stringify(c));
    res.cats = c;
  }
  if (b.model !== undefined) P.setProperty('gemModel', String(b.model || '').trim());
  if (b.key !== undefined) {
    var k = String(b.key || '').replace(/\s+/g, '');
    if (!k) { P.deleteProperty('gemKey'); P.deleteProperty('gemModels'); res.hasKey = false; return res; }
    var m = modelsFetch_(k);
    if (!m.ok) return { ok: false, error: m.error };
    P.setProperty('gemKey', k);
    P.setProperty('gemModels', JSON.stringify({ t: Date.now(), list: m.list }));
    res.hasKey = true;
    res.model = m.list[0] || '';
  }
  return res;
}

/* ---------- Âm lịch (dùng chung với app; sửa trong lunar.js) ---------- */
/*LUNAR*//* Âm lịch Việt Nam – thuật toán Hồ Ngọc Đức (múi giờ +7) */
var AL = (function () {
  var PI = Math.PI, TZ = 7;
  function INT(d) { return Math.floor(d); }
  function jdFromDate(dd, mm, yy) {
    var a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
    var jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
    return jd;
  }
  function jdToDate(jd) {
    var a, b, c;
    if (jd > 2299160) { a = jd + 32044; b = INT((4 * a + 3) / 146097); c = a - INT((b * 146097) / 4); }
    else { b = 0; c = jd + 32082; }
    var d = INT((4 * c + 3) / 1461), e = c - INT((1461 * d) / 4), m = INT((5 * e + 2) / 153);
    return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)];
  }
  function NewMoon(k) {
    var T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
    var Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    var Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    var F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    var deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return Jd1 + C1 - deltat;
  }
  function SunLongitude(jdn) {
    var T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
    var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    var L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    var DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    var L = (L0 + DL) * dr;
    return L - PI * 2 * INT(L / (PI * 2));
  }
  function sunLong6(dn) { return INT(SunLongitude(dn - 0.5 - TZ / 24) / PI * 6); }
  function newMoonDay(k) { return INT(NewMoon(k) + 0.5 + TZ / 24); }
  function month11(yy) {
    var k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853), nm = newMoonDay(k);
    return sunLong6(nm) >= 9 ? newMoonDay(k - 1) : nm;
  }
  function leapOffset(a11) {
    var k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5), last, i = 1, arc = sunLong6(newMoonDay(k + i));
    do { last = arc; i++; arc = sunLong6(newMoonDay(k + i)); } while (arc !== last && i < 14);
    return i - 1;
  }
  // dương → âm: [ngày, tháng, năm, nhuận]
  function s2l(dd, mm, yy) {
    var dn = jdFromDate(dd, mm, yy), k = INT((dn - 2415021.076998695) / 29.530588853);
    var ms = newMoonDay(k + 1); if (ms > dn) ms = newMoonDay(k);
    var a11 = month11(yy), b11 = a11, ly;
    if (a11 >= ms) { ly = yy; a11 = month11(yy - 1); } else { ly = yy + 1; b11 = month11(yy + 1); }
    var ld = dn - ms + 1, diff = INT((ms - a11) / 29), leap = 0, lm = diff + 11;
    if (b11 - a11 > 365) { var lo = leapOffset(a11); if (diff >= lo) { lm = diff + 10; if (diff === lo) leap = 1; } }
    if (lm > 12) lm -= 12;
    if (lm >= 11 && diff < 4) ly -= 1;
    return [ld, lm, ly, leap];
  }
  // âm → dương: [ngày, tháng, năm] (0 nếu không có)
  function l2s(ld, lm, ly, leap) {
    var a11, b11;
    if (lm < 11) { a11 = month11(ly - 1); b11 = month11(ly); } else { a11 = month11(ly); b11 = month11(ly + 1); }
    var k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853), off = lm - 11;
    if (off < 0) off += 12;
    if (b11 - a11 > 365) {
      var lo = leapOffset(a11), lmn = lo - 2; if (lmn < 0) lmn += 12;
      if (leap && lm !== lmn) return [0, 0, 0];
      if (leap || off >= lo) off += 1;
    }
    return jdToDate(newMoonDay(k + off) + ld - 1);
  }
  var CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  var CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
  var TK = ['Xuân phân', 'Thanh minh', 'Cốc vũ', 'Lập hạ', 'Tiểu mãn', 'Mang chủng', 'Hạ chí', 'Tiểu thử', 'Đại thử', 'Lập thu', 'Xử thử', 'Bạch lộ',
    'Thu phân', 'Hàn lộ', 'Sương giáng', 'Lập đông', 'Tiểu tuyết', 'Đại tuyết', 'Đông chí', 'Tiểu hàn', 'Đại hàn', 'Lập xuân', 'Vũ thủy', 'Kinh trập'];
  var GIO_HD = ['110100101100', '001101001011', '110011010010', '101100110100', '001011001101', '010010110011'];
  function info(dd, mm, yy) {
    var l = s2l(dd, mm, yy), jd = jdFromDate(dd, mm, yy), dc = (jd + 1) % 12, hd = [];
    var g = GIO_HD[dc % 6];
    for (var i = 0; i < 12; i++) if (g.charAt(i) === '1') hd.push(CHI[i] + ' (' + ((i * 2 + 23) % 24) + '–' + ((i * 2 + 1) % 24) + 'h)');
    return {
      d: l[0], m: l[1], y: l[2], leap: l[3],
      canChiNgay: CAN[(jd + 9) % 10] + ' ' + CHI[dc],
      canChiThang: CAN[(l[2] * 12 + l[1] + 3) % 10] + ' ' + CHI[(l[1] + 1) % 12],
      canChiNam: CAN[(l[2] + 6) % 10] + ' ' + CHI[(l[2] + 8) % 12],
      tietKhi: TK[INT(SunLongitude(jd - 0.5 - TZ / 24 + 1) / PI * 12)],
      gioHD: hd
    };
  }
  function yearName(ly) { return CAN[(ly + 6) % 10] + ' ' + CHI[(ly + 8) % 12]; }
  return { s2l: s2l, l2s: l2s, info: info, yearName: yearName, jd: jdFromDate };
})();
/*END LUNAR*/

/* ---------- Nhắc ngày giỗ trên điện thoại qua Google Calendar ---------- */
var CAL_NAME = 'Ngày & sự kiện – Thu chi gia đình', CAL_YEARS = 5;
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function evCal_() {
  var P = props_(), id = P.getProperty('calId'), cal = null;
  if (id) { try { cal = CalendarApp.getCalendarById(id); } catch (e) {} }
  if (cal) { try { if (cal.getName() !== CAL_NAME) cal.setName(CAL_NAME); } catch (e) {} }
  if (!cal) {
    cal = CalendarApp.createCalendar(CAL_NAME, { color: CalendarApp.Color.RED, timeZone: 'Asia/Ho_Chi_Minh' });
    P.setProperty('calId', cal.getId());
  }
  return cal;
}
// ngày dương của sự kiện trong năm yr (năm âm nếu theo âm lịch); tháng thiếu không có ngày 30 → 29
function evOccIn_(ev, yr) {
  if (ev.cal === 'duong') {
    var dmax = new Date(Date.UTC(yr, ev.m, 0)).getUTCDate();
    return yr + '-' + pad2_(ev.m) + '-' + pad2_(Math.min(ev.d, dmax));
  }
  var s = AL.l2s(ev.d, ev.m, yr, 0); if (!s[0]) return '';
  if (ev.d === 30) { var b = AL.s2l(s[0], s[1], s[2]); if (b[0] !== 30 || b[1] !== ev.m) s = AL.l2s(29, ev.m, yr, 0); }
  return s[2] + '-' + pad2_(s[1]) + '-' + pad2_(s[0]);
}
function evOccs_(ev, n) {
  var t = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'), p = t.split('-');
  var base = ev.cal === 'duong' ? +p[0] : AL.s2l(+p[2], +p[1], +p[0])[2], out = [];
  for (var k = -1; out.length < n && k < n + 2; k++) { var iso = evOccIn_(ev, base + k); if (iso && iso >= t) out.push({ iso: iso, yr: base + k }); }
  return out;
}
function evTitle_(ev, yr) {
  var nth = ev.y && yr > ev.y ? (ev.k === 'gio' ? ' (' + (yr - ev.y) + ' năm)' : ev.k === 'sn' ? ' (' + (yr - ev.y) + ' tuổi)' : '') : '';
  return ev.n + nth;
}
// tạo lại các lần nhắc của 1 sự kiện; trả '' hoặc lỗi
function calSync_(ev, del) {
  var P = props_();
  try {
    var map = {}; try { map = JSON.parse(P.getProperty('evCal') || '{}'); } catch (e) {}
    if (!map[ev.id] && (del || P.getProperty('calOn') !== '1')) return '';
    var cal = evCal_();
    (map[ev.id] || []).forEach(function (x) { try { var e = cal.getEventById(x.i || x); if (e) e.deleteEvent(); } catch (er) {} });
    var ids = [];
    if (!del && P.getProperty('calOn') === '1') evOccs_(ev, CAL_YEARS).forEach(function (o) { ids.push(calMake_(cal, ev, o)); });
    if (ids.length) map[ev.id] = ids; else delete map[ev.id];
    P.setProperty('evCal', JSON.stringify(map));
    return '';
  } catch (e) {
    return /permission|quyền|authoriz/i.test(e.message) ? 'Máy chủ chưa có quyền Google Calendar – mở Apps Script, chạy hàm capQuyen một lần' : e.message;
  }
}
function calMake_(cal, ev, o) {
  var p = o.iso.split('-'), st = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 1, 0)); // 8:00 giờ VN
  var desc = (ev.cal === 'am' ? 'Ngày ' + ev.d + '/' + ev.m + ' âm lịch. ' : '') + (ev.note || '') + '\n(Tạo từ app Thu chi gia đình)';
  var e = cal.createEvent(evTitle_(ev, o.yr), st, new Date(st.getTime() + 36e5), { description: desc });
  e.removeAllReminders();
  e.addPopupReminder(0);                                       // 8:00 sáng ngày giỗ
  if (ev.r > 0) e.addPopupReminder(Math.min(ev.r, 28) * 1440); // trước N ngày, 8:00
  return { i: e.getId(), d: o.iso };
}

// Tự gia hạn: chạy hằng tháng (trigger), luôn giữ đủ 5 lần sắp tới cho mọi ngày giỗ → năm nào cũng có nhắc
function lichTuDong() {
  var P = props_();
  if (P.getProperty('calOn') !== '1') return 0;
  var map = {}; try { map = JSON.parse(P.getProperty('evCal') || '{}'); } catch (e) {}
  var cal = evCal_(), t = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'), n = 0;
  events_().forEach(function (ev) {
    var have = (map[ev.id] || []).filter(function (x) { return x.d && x.d >= t; }), days = have.map(function (x) { return x.d; });
    evOccs_(ev, CAL_YEARS).forEach(function (o) { if (days.indexOf(o.iso) < 0) { have.push(calMake_(cal, ev, o)); n++; } });
    map[ev.id] = have; // lần đã qua để lại trong lịch, chỉ bỏ khỏi danh sách theo dõi
  });
  P.setProperty('evCal', JSON.stringify(map));
  return n;
}
function calTrigger_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'lichTuDong') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('lichTuDong').timeBased().onMonthDay(1).atHour(3).create();
}

function calOn_(on) {
  var P = props_();
  P.setProperty('calOn', on ? '1' : '0');
  var err = '', n = 0;
  events_().forEach(function (ev) { if (err) return; err = calSync_(ev, !on); if (!err && on) n++; });
  if (!err) { try { calTrigger_(on); } catch (e) { err = /permission|quyền|authoriz/i.test(e.message) ? 'Máy chủ chưa có quyền tự chạy hằng tháng – mở Apps Script, chạy hàm capQuyen một lần' : e.message; } }
  if (err) { P.setProperty('calOn', '0'); try { calTrigger_(false); } catch (e) {} }
  return { ok: !err, error: err, calOn: !err && on, n: n };
}

/* ---------- Ngày giỗ & sự kiện (lịch vạn niên) ---------- */
// {id, n: tên, k: gio|sn|khac, cal: am|duong, d, m, y: năm mất / năm sinh (tuỳ chọn), r: nhắc trước (ngày), note}
function events_() {
  try { return JSON.parse(props_().getProperty('events') || '[]'); } catch (e) { return []; }
}

function evSave_(e) {
  var n = String(e.n || '').trim().slice(0, 80);
  var d = Math.round(+e.d), m = Math.round(+e.m);
  if (!n) return { ok: false, error: 'Nhập tên (vd: Sinh nhật mẹ)' };
  if (!(d >= 1 && d <= (e.cal === 'duong' ? 31 : 30)) || !(m >= 1 && m <= 12)) return { ok: false, error: 'Ngày tháng không hợp lệ' };
  var ev = {
    id: String(e.id || newId_()), n: n,
    k: ['gio', 'sn', 'khac'].indexOf(e.k) >= 0 ? e.k : 'gio',
    cal: e.cal === 'duong' ? 'duong' : 'am', d: d, m: m,
    y: +e.y >= 1900 && +e.y <= 2100 ? Math.round(+e.y) : 0,
    r: Math.max(0, Math.min(60, Math.round(+e.r || 0))),
    note: String(e.note || '').slice(0, 200)
  };
  var list = events_(), i = -1;
  for (var j = 0; j < list.length; j++) if (list[j].id === ev.id) i = j;
  if (i >= 0) list[i] = ev; else list.push(ev);
  if (list.length > 200) return { ok: false, error: 'Tối đa 200 sự kiện' };
  props_().setProperty('events', JSON.stringify(list));
  return { ok: true, ev: ev, events: list, calErr: calSync_(ev) };
}

function evDel_(id) {
  calSync_({ id: id }, true);
  var list = events_().filter(function (x) { return x.id !== id; });
  props_().setProperty('events', JSON.stringify(list));
  return { ok: true, events: list };
}

/* ---------- Ảnh gia đình (thư mục trên Google Drive) ----------
   App thu nhỏ ảnh trên điện thoại (cạnh dài ≤ 1600 px) rồi tải lên; ngày chụp + chú thích + người tải lưu ở phần mô tả tệp (JSON).
   Ảnh bỏ thẳng vào thư mục trên Drive cũng hiện: ngày lấy theo tên tệp (2025-06-12…, IMG_20250612…) hoặc ngày tải lên. */
var PHOTO_DIR = 'Ảnh gia đình – Thu chi';
function pgen_() { return props_().getProperty('pgen') || '1'; }
function phLock_(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { var r = fn(); props_().setProperty('pgen', Date.now().toString(36) + Math.random().toString(36).slice(2, 5)); r.pgen = pgen_(); return r; } finally { lock.releaseLock(); }
}
function photoDir_() {
  var P = props_(), id = P.getProperty('photoDir'), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed && f.isTrashed()) f = null; } catch (e) { f = null; } }
  if (!f) { f = DriveApp.createFolder(PHOTO_DIR); P.setProperty('photoDir', f.getId()); }
  return f;
}
function photoMeta_(f, tz) {
  var m = {}; try { m = JSON.parse(f.getDescription() || '{}') || {}; } catch (e) {}
  var name = f.getName(), base = name.replace(/\.[a-z0-9]+$/i, ''), d = m.d || '', x;
  if (!d && (x = base.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/))) d = x[1] + '-' + x[2] + '-' + x[3];
  if (!d) d = Utilities.formatDate(f.getDateCreated(), tz, 'yyyy-MM-dd');
  var cap = m.cap !== undefined ? m.cap : (/^(img|dsc|pxl|photo|image)?[_\- ]?\d/i.test(base) ? '' : base.replace(/[_]+/g, ' '));
  return { id: f.getId(), d: d, cap: String(cap || '').slice(0, 80), u: m.u || '', sz: f.getSize() };
}
function photoList_(known) {
  if (known && known === pgen_()) return { ok: true, same: true, pgen: known };
  var c = cache_(), key = 'photos:' + pgen_(), hit = c && c.get(key);
  if (hit) return JSON.parse(hit);
  var dir = photoDir_(), it = dir.getFiles(), out = [], tz = 'Asia/Ho_Chi_Minh';
  while (it.hasNext()) { var f = it.next(); if (/^image\//.test(f.getMimeType())) out.push(photoMeta_(f, tz)); }
  out.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
  var res = { ok: true, photos: out, dir: dir.getId(), pgen: pgen_() };
  try { if (c) c.put(key, JSON.stringify(res), 600); } catch (e) {}
  return res;
}
function photoUp_(b) {
  if (!b.b64) return { ok: false, error: 'Không có ảnh' };
  var d = /^\d{4}-\d{2}-\d{2}$/.test(b.d || '') ? b.d : Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var cap = String(b.cap || '').trim().slice(0, 80);
  var blob = Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'image/jpeg', d + (cap ? ' ' + cap.replace(/[\\/:*?"<>|]/g, '') : '') + '.jpg');
  var f = photoDir_().createFile(blob);
  f.setDescription(JSON.stringify({ d: d, cap: cap, u: ME_ }));
  return { ok: true, photo: photoMeta_(f, 'Asia/Ho_Chi_Minh') };
}
function photoEdit_(b) {
  var f = DriveApp.getFileById(b.id), m = {};
  try { m = JSON.parse(f.getDescription() || '{}') || {}; } catch (e) {}
  if (b.d !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.d)) m.d = b.d;
  if (b.cap !== undefined) m.cap = String(b.cap).trim().slice(0, 80);
  f.setDescription(JSON.stringify(m));
  return { ok: true, photo: photoMeta_(f, 'Asia/Ho_Chi_Minh') };
}
function photoDel_(id) { DriveApp.getFileById(id).setTrashed(true); return { ok: true }; }
// lấy ảnh cỡ s (px cạnh dài): ảnh nhỏ (app đã thu nhỏ) gửi nguyên; ảnh lớn bỏ thẳng trên Drive → dùng ảnh thu nhỏ của Drive
function photoGet_(id, s) {
  var f = DriveApp.getFileById(id), blob = null;
  if (f.getSize() > 1500000 || s <= 300) {
    try {
      var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      var link = (JSON.parse(r.getContentText()) || {}).thumbnailLink;
      if (link) { var t = UrlFetchApp.fetch(link.replace(/=s\d+$/, '') + '=s' + Math.min(1600, s), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }); if (t.getResponseCode() === 200) blob = t.getBlob(); }
    } catch (e) {}
    if (!blob && f.getSize() > 1500000) { try { blob = f.getThumbnail(); } catch (e) {} }
  }
  if (!blob) blob = f.getBlob();
  return { ok: true, id: id, mime: blob.getContentType() || 'image/jpeg', b64: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- Sheet ---------- */
function sheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, NCOL).setValues([HEAD]).setFontWeight('bold').setBackground('#e6f2ec');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('dd/mm/yyyy');
    sh.getRange('E:E').setNumberFormat('#,##0');
    sh.setColumnWidth(1, 90); sh.setColumnWidth(6, 260); sh.setColumnWidth(8, 300);
  }
  if (props_().getProperty('cols') !== String(NCOL)) { // sổ cũ: thêm tiêu đề các cột mới (K nguồn tiền, L người ghi)
    var hd = sh.getRange(1, 1, 1, NCOL).getValues()[0];
    for (var i = 10; i < NCOL; i++) if (!hd[i]) sh.getRange(1, i + 1).setValue(HEAD[i]).setFontWeight('bold').setBackground('#e6f2ec');
    props_().setProperty('cols', String(NCOL));
  }
  return sh;
}

function tz_() {
  try { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Ho_Chi_Minh'; } catch (e) { return 'Asia/Ho_Chi_Minh'; }
}

function isoOf_(v, tz) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v || '').trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})$/))) s = s + '/' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy'); // thiếu năm → năm nay (lùi năm nếu ra tương lai)
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) {
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  }
  return '';
}

function pad_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

function dateOf_(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  // 12:00 giờ VN – không lệch ngày dù múi giờ dự án khác nhau
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 5, 0, 0));
}

// số tiền: "1.250.000đ", "1,250,000", "235k", "1,5 triệu", "235.000,00" → số nguyên
function numOf_(v) {
  if (typeof v === 'number') return Math.round(v);
  var t = String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ''), m = t.match(/^-?([\d.,]+)(k|nghin|ngan|tr|trieu|m)?/);
  if (!m) return 0;
  var d = m[1], mul = !m[2] ? 1 : /^(k|nghin|ngan)$/.test(m[2]) ? 1e3 : 1e6;
  if (mul > 1 && /^\d+[.,]\d{1,3}$/.test(d) && !(mul === 1e3 && /[.,]\d{3}$/.test(d))) return Math.round(parseFloat(d.replace(',', '.')) * mul);
  d = d.replace(/[.,]\d{1,2}$/, '').replace(/[^\d]/g, ''); // bỏ phần lẻ ",00"
  return d ? Math.round(+d * mul) : 0;
}

function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

function rowOut_(r, tz) {
  var nv = novOf_(r[2]);
  var o = {
    id: String(r[0]),
    d: isoOf_(r[1], tz),
    t: nv ? 'no' : /chuy|rut|nop/i.test(normVN_(r[2])) ? 'ck' : /thu/i.test(String(r[2])) ? 'thu' : 'chi', // ck = chuyển giữa tiền mặt và ngân hàng
    c: String(r[3] || ''),
    a: Math.abs(numOf_(r[4])),
    n: String(r[5] || ''),
    p: String(r[6] || ''),
    x: String(r[7] || ''),
    s: /bill|ảnh/i.test(String(r[8])) ? 'bill' : 'tay',
    at: r[9] instanceof Date ? Utilities.formatDate(r[9], tz, 'dd/MM/yyyy HH:mm') : String(r[9] || ''),
    w: walOf_(r[10]),
    u: /^v/i.test(normVN_(r[11])) ? 'v' : 'c',  // để trống = chồng (chủ sổ)
    j: String(r[12] || '').trim(), jr: r[12] && !nv ? jrOf_(r[13]) : ''
  };
  if (nv) o.v = nv;
  return o;
}

// nguồn tiền: 'tm' tiền mặt, 'nh' ngân hàng (gồm thẻ, chuyển khoản, ví điện tử), '' chưa ghi
function walOf_(v) { var s = normVN_(v); return /tien mat|\bcash\b|^tm$/.test(s) ? 'tm' : /ngan hang|bank|\bthe\b|chuyen khoan|^nh$|^ck$/.test(s) ? 'nh' : ''; }
function rowIn_(o) {
  var src = o.s === 'bill' ? 'Ảnh bill' : 'Nhập tay';
  return [
    String(o.id || newId_()),
    dateOf_(o.d),
    o.t === 'no' ? (NOV[o.v] || 'Vay') : o.t === 'ck' ? 'Chuyển' : o.t === 'thu' ? 'Thu' : 'Chi',
    String(o.c || '').slice(0, 60),
    Math.abs(numOf_(o.a)),
    String(o.n || '').slice(0, 300),
    String(o.p || '').slice(0, 120),
    String(o.x || '').slice(0, 3000),
    src,
    Utilities.formatDate(new Date(), tz_(), 'dd/MM/yyyy HH:mm'),
    o.w === 'tm' ? 'Tiền mặt' : o.w === 'nh' ? 'Ngân hàng' : '',
    (o.u || ME_) === 'v' ? 'Vợ' : 'Chồng',
    String(o.j || '').trim().slice(0, 60), o.j && o.t !== 'no' ? (JROLE[o.jr] || '') : ''
  ];
}

function list_(gen) {
  if (gen && gen === gen_()) return { ok: true, same: true, gen: gen, pgen: pgen_() };
  var sh = sheet_(), tz = tz_();
  var n = sh.getLastRow() - 1, rows = [];
  if (n > 0) {
    var vals = sh.getRange(2, 1, n, NCOL).getValues();
    var fix = [];
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      if (r[1] === '' && r[4] === '') continue;
      if (!r[0]) { r[0] = newId_(); fix.push([i + 2, r[0]]); }
      rows.push(rowOut_(r, tz));
    }
    // dòng gõ tay trong Sheet chưa có ID → gán ID để sửa được trong app
    fix.forEach(function (f) { sh.getRange(f[0], 1).setValue(f[1]); });
    if (fix.length) bump_();
  }
  return {
    ok: true, gen: gen_(), rows: rows, me: ME_, users: users_(), cats: cats_(), budget: budget_(), bal: bal_(), projects: projects_(), pgen: pgen_(), events: events_(), calOn: props_().getProperty('calOn') === '1', ver: VER,
    hasKey: !!props_().getProperty('gemKey'),
    model: props_().getProperty('gemModel') || ''
  };
}

function idRows_(sh) {
  var n = sh.getLastRow() - 1, map = {};
  if (n <= 0) return map;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0]) map[String(ids[i][0])] = i + 2;
  return map;
}

function add_(rows) {
  if (!rows.length) return { ok: true, ids: [] };
  var sh = sheet_(), have = idRows_(sh), out = [], ids = [];
  rows.forEach(function (o) {
    if (o.id && have[o.id]) { ids.push(o.id); return; } // gửi lại lần 2 → bỏ qua
    var r = rowIn_(o);
    if (!r[1] || !r[4]) return;
    out.push(r); ids.push(r[0]);
  });
  if (out.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, out.length, NCOL).setValues(out);
  }
  return { ok: true, ids: ids };
}

function update_(o) {
  var sh = sheet_(), r = idRows_(sh)[o.id];
  if (!r) return { ok: false, error: 'Không tìm thấy khoản này (có thể đã bị xoá trong Sheet)' };
  var v = rowIn_(o);
  if (!v[1] || !v[4]) return { ok: false, error: 'Thiếu ngày hoặc số tiền' };
  var old = sh.getRange(r, 1, 1, NCOL).getValues()[0];
  v[8] = old[8] || v[8]; // giữ nguồn ban đầu
  if (old[11]) v[11] = old[11]; // giữ người ghi
  sh.getRange(r, 1, 1, NCOL).setValues([v]);
  return { ok: true };
}

function del_(ids) {
  var sh = sheet_(), map = idRows_(sh), rs = [];
  ids.forEach(function (id) { if (map[id]) rs.push(map[id]); });
  rs.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  return { ok: true, n: rs.length };
}

/* ---------- Thương hiệu → mục (sổ tay chung với app; sửa trong brands.py) ---------- */
/*BRANDS*/var BRANDS = [["xe", "Grab / Xanh SM (MoMo)", "tai momo ho chi minh|momo ho chi minh|online mobile services?|\\bm ?service\\b"], ["an", "GrabFood", "grab ?food"], ["an", "ShopeeFood", "shopee ?food|now vn|foody"], ["an", "GoFood", "go ?food"], ["an", "Baemin", "baemin"], ["an", "beFood", "\\bbe ?food"], ["cafe", "Starbucks", "starbucks?"], ["cafe", "Highlands Coffee", "highlands?"], ["cafe", "Phúc Long", "phuc ?long"], ["cafe", "Phê La", "\\bphe ?la\\b"], ["cafe", "Gong Cha", "gong ?cha"], ["cafe", "The Coffee House", "the ?coffee ?house|\\btch\\b"], ["cafe", "Trung Nguyên", "trung ?nguyen"], ["cafe", "Cộng Cà Phê", "\\bcong ca ?phe|\\bcong cafe"], ["cafe", "Katinat", "katinat"], ["cafe", "Cheese Coffee", "cheese ?coffee"], ["cafe", "Aha Cafe", "\\baha ?caf"], ["cafe", "Passio", "passio"], ["cafe", "Tocotoco", "toco ?toco"], ["cafe", "Koi Thé", "\\bkoi ?the\\b"], ["cafe", "Mixue", "mixue"], ["cafe", "Ding Tea", "ding ?tea"], ["cafe", "Bobapop", "boba ?pop"], ["cafe", "Royaltea", "royal ?tea"], ["cafe", "Tiger Sugar", "tiger ?sugar"], ["cafe", "Feeling Tea", "feeling ?tea"], ["cafe", "Laha", "\\blaha\\b"], ["cafe", "Napoli Coffee", "napoli"], ["cafe", "Café Amazon", "caf\\w* ?amazon"], ["cafe", "% Arabica", "arabica"], ["cafe", "Runam", "\\brunam"], ["cafe", "Milano Coffee", "milano ?coff"], ["cafe", "Urban Station", "urban ?station"], ["cafe", "Bamos Coffee", "bamos"], ["cafe", "Long Coffee", "\\blong ?coffee"], ["cafe", "Ông Bầu", "\\bong ?bau\\b"], ["cafe", "Phindeli", "phindeli"], ["cafe", "Chagee", "chagee"], ["cafe", "Hey Tea", "hey ?tea"], ["cafe", "Sharetea", "share ?tea"], ["cafe", "Cà phê Muối", "ca ?phe muoi"], ["cafe", "The Alley", "the ?alley"], ["cafe", "Bluebottle", "blue ?bottle"], ["cafe", "Tim Hortons", "tim ?hortons"], ["cafe", "Luckin Coffee", "luckin"], ["an", "Pizza 4P's", "pizza ?4 ?p|\\b4p ?s\\b"], ["an", "Gogi House", "gogi"], ["an", "King BBQ", "king ?bbq"], ["an", "Meat Plus", "meat ?plus"], ["an", "Kichi Kichi", "kichi"], ["an", "Manwah", "manwah"], ["an", "Hotpot Story", "hot ?pot ?story"], ["an", "Sumo BBQ", "sumo"], ["an", "Pizza Hut", "pizza ?hut"], ["an", "Domino's", "domino"], ["an", "The Pizza Company", "pizza ?company"], ["an", "KFC", "\\bkfc\\b"], ["an", "McDonald's", "mc ?donald|\\bmcd\\b"], ["an", "Lotteria", "lotteria"], ["an", "Jollibee", "jollibee"], ["an", "Burger King", "burger ?king"], ["an", "Texas Chicken", "texas ?chicken"], ["an", "Popeyes", "popeyes"], ["an", "Phở 24", "\\bpho ?24"], ["an", "Phở Thìn", "pho ?thin"], ["an", "Haidilao", "haidilao|hai di lao"], ["an", "Ashima", "ashima"], ["an", "iSushi", "\\bi ?sushi"], ["an", "Sushi Hokkaido", "hokkaido"], ["an", "Tokyo Deli", "tokyo ?deli"], ["an", "Marukame Udon", "marukame"], ["an", "Yoshinoya", "yoshinoya"], ["an", "San Fu Lou", "san ?fu ?lou"], ["an", "Dookki", "dookki"], ["an", "Paris Baguette", "paris ?baguette"], ["an", "Tous les Jours", "tous ?les ?jours"], ["an", "ABC Bakery", "abc ?bakery"], ["an", "Wrap & Roll", "wrap ?roll"], ["an", "Lẩu Phan", "lau ?phan"], ["an", "Thái Express", "thai ?express"], ["an", "Vuvuzela", "vuvuzela"], ["an", "Al Fresco", "al ?fresco"], ["an", "Seoul Garden", "seoul ?garden"], ["an", "GoGi Steak", "gogi ?steak"], ["an", "Cơm Tấm Phúc Lộc Thọ", "phuc ?loc ?tho"], ["an", "Bánh mì Huỳnh Hoa", "huynh ?hoa"], ["an", "Phở Hòa", "pho ?hoa\\b"], ["an", "Bún chả Hương Liên", "huong ?lien"], ["an", "Chang Kang Kung", "chang ?kang"], ["an", "Ka Ka Hotpot", "\\bkaka|ka ka"], ["an", "Golden Gate", "golden ?gate"], ["an", "Món Huế", "mon ?hue"], ["an", "Ngon Villa", "ngon ?villa|quan ?an ?ngon"], ["an", "Subway", "\\bsubway\\b"], ["an", "Gà Rán Otoké", "otoke"], ["an", "Nhà hàng", "\\bnha hang\\b|\\brestaurant\\b|\\bbuffet\\b|\\bbbq\\b|\\bquan an\\b"], ["cho", "WinMart", "win ?mart|vinmart"], ["cho", "Co.opmart", "co ?op ?mart|coopmart|co ?op ?food|coop ?xtra"], ["cho", "Bách Hóa Xanh", "bach ?hoa ?xanh|\\bbhx\\b"], ["cho", "GO!", "\\bbig ?c\\b|\\bgo ?mall|\\bgo !|tops ?market"], ["cho", "Lotte Mart", "lotte ?mart"], ["cho", "AEON", "\\baeon\\b"], ["cho", "Emart", "\\be ?mart\\b"], ["cho", "MM Mega Market", "mega ?market"], ["cho", "Circle K", "circle ?k"], ["cho", "FamilyMart", "family ?mart"], ["cho", "GS25", "\\bgs ?25"], ["cho", "7-Eleven", "7 ?eleven"], ["cho", "Ministop", "ministop"], ["cho", "Kingfoodmart", "king ?food"], ["cho", "Satra", "satra"], ["cho", "Hapro", "hapro"], ["cho", "Farmers Market", "farmers ?market"], ["cho", "Chợ", "^cho\\b|\\bcho dan\\b"], ["xe", "Petrolimex", "petrolimex|\\bplx\\b"], ["xe", "PV Oil", "pv ?oil"], ["xe", "Grab", "\\bgrab\\b"], ["xe", "Xanh SM", "xanh ?sm|\\bgsm\\b"], ["xe", "Be", "\\bbe ?(bike|car|group)\\b"], ["xe", "Gojek", "gojek"], ["xe", "Mai Linh", "mai ?linh"], ["xe", "Vinasun", "vinasun"], ["xe", "Vietjet Air", "vietjet"], ["xe", "Vietnam Airlines", "vietnam ?airlines"], ["xe", "Bamboo Airways", "bamboo ?air"], ["xe", "VETC", "\\bvetc\\b"], ["xe", "ePass", "\\bepass\\b"], ["xe", "Vinfast", "vinfast"], ["xe", "Gửi xe", "gui ?xe|parking|bai do xe"], ["dien", "EVN", "\\bevn\\b|dien ?luc"], ["dien", "Nước sạch", "cap ?nuoc|nuoc ?sach|kinh ?doanh ?nuoc"], ["dien", "Viettel", "viettel"], ["dien", "VNPT", "\\bvnpt\\b|vinaphone"], ["dien", "FPT Telecom", "fpt ?telecom"], ["dien", "MobiFone", "mobifone"], ["dien", "K+", "\\bk\\+|kplus"], ["dien", "VTVcab", "vtv ?cab"], ["kham", "Long Châu", "long ?chau"], ["kham", "Pharmacity", "pharmacity"], ["kham", "An Khang", "nha ?thuoc ?an ?khang|an ?khang ?pharma"], ["kham", "Medicare", "medicare"], ["kham", "Vinmec", "vinmec"], ["kham", "Bệnh viện", "benh ?vien|phong ?kham|nha ?khoa|nha ?thuoc|hospital|clinic"], ["shop", "Uniqlo", "uniqlo"], ["shop", "Zara", "\\bzara\\b"], ["shop", "H&M", "\\bh m\\b"], ["shop", "Shopee", "shopee"], ["shop", "Lazada", "lazada"], ["shop", "Tiki", "\\btiki\\b"], ["shop", "TikTok Shop", "tiktok"], ["shop", "Canifa", "canifa"], ["shop", "Routine", "routine"], ["shop", "Coolmate", "coolmate"], ["shop", "IVY moda", "ivy ?moda"], ["shop", "Nike", "\\bnike\\b"], ["shop", "Adidas", "adidas"], ["shop", "Owen", "\\bowen\\b"], ["shop", "Aristino", "aristino"], ["shop", "Juno", "\\bjuno\\b"], ["shop", "Biti's", "\\bbiti"], ["shop", "Hasaki", "hasaki"], ["shop", "Guardian", "guardian"], ["nha", "Điện Máy Xanh", "dien ?may ?xanh"], ["nha", "Thế Giới Di Động", "the ?gioi ?di ?dong|\\btgdd\\b"], ["nha", "IKEA", "\\bikea\\b"], ["nha", "MR DIY", "mr ?diy"], ["nha", "Miniso", "miniso"], ["nha", "Daiso", "daiso"], ["nha", "Nguyễn Kim", "nguyen ?kim"], ["nha", "FPT Shop", "fpt ?shop"], ["nha", "CellphoneS", "cellphone ?s"], ["nha", "Hoà Phát", "hoa ?phat"], ["vui", "CGV", "\\bcgv\\b"], ["vui", "Lotte Cinema", "lotte ?cinema"], ["vui", "Galaxy Cinema", "galaxy ?cine"], ["vui", "BHD Star", "\\bbhd\\b"], ["vui", "Beta Cinemas", "beta ?cine"], ["vui", "Netflix", "netflix"], ["vui", "Spotify", "spotify"], ["vui", "YouTube", "youtube"], ["vui", "VinWonders", "vinwonders|vinpearl"], ["vui", "Sun World", "sun ?world"], ["vui", "Agoda", "agoda"], ["vui", "Booking.com", "booking ?com"], ["vui", "Traveloka", "traveloka"], ["vui", "Airbnb", "airbnb"], ["vui", "Klook", "klook"], ["hoc", "Fahasa", "fahasa"], ["hoc", "Kids Plaza", "kids ?plaza"], ["hoc", "Con Cưng", "con ?cung"], ["hoc", "Bibo Mart", "bibo ?mart"], ["hoc", "Học phí", "hoc ?phi|truong ?(mam non|tieu hoc|thcs|thpt)"]];/*END BRANDS*/
var KIND_RX = { cafe: /ca phe|cafe|coffee|tra sua|do uong/, an: /an uong|nha hang|an ngoai/, cho: /\bcho\b|sieu thi|thuc pham/, xe: /xang|di lai|\bxe\b/,
  dien: /dien|nuoc|internet|vien thong/, kham: /suc khoe|thuoc|y te/, shop: /mua sam|quan ao|thoi trang/, nha: /nha cua|do dung|gia dung/, vui: /giai tri|du lich/, hoc: /con cai|hoc/ };
var _brx = null;
function normVN_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9+&]+/g, ' ').replace(/&/g, ' ').trim();
}
function brandOf_(txt) {
  var t = normVN_(txt); if (!t) return null;
  if (!_brx) _brx = BRANDS.map(function (b) { return [b[0], b[1], new RegExp(b[2])]; });
  for (var i = 0; i < _brx.length; i++) if (_brx[i][2].test(t)) return { k: _brx[i][0], n: _brx[i][1] };
  return null;
}
// mục hợp loại quán – xét cả mục con (vd "Ăn uống / Cafe-trà sữa")
function catFor_(kind, chi) {
  var ok = chi.filter(function (c) { return !/dau tu/.test(normVN_(c.split(' / ')[0])); }), best = '', bs = 0;
  var tryK = function (k) {
    ok.forEach(function (c) {
      var p = c.split(' / '), g = normVN_(p[0]), sc = p[1] ? normVN_(p.slice(1).join(' ')) : '', v = 0;
      if (sc && KIND_RX[k].test(sc)) v = 3; else if (!sc && KIND_RX[k].test(g)) v = 2; else if (sc && k !== 'cafe' && KIND_RX[k].test(g)) v = 1;
      if (v > bs) { bs = v; best = c; }
    });
  };
  tryK(kind); if (!best && kind === 'cafe') tryK('an');
  return best;
}
// bỏ mã giao dịch / mã đơn (chuỗi in hoa lẫn số dài ≥ 6) khỏi nội dung
function cleanTxt_(s) {
  return String(s || '').replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b/g, ' ').replace(/\b\d{8,}\b/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, '').trim();
}
var KIND_LBL = { cafe: 'Cà phê', an: 'Ăn uống' };
// mục anh đã dùng cho từng nơi mua (học từ sổ – kể cả khi anh sửa tay)
function placeHistory_() {
  var sh = sheet_(), n = sh.getLastRow() - 1, map = {};
  if (n <= 0) return map;
  sh.getRange(2, 1, n, NCOL).getValues().forEach(function (r) {
    if (!r[6] || /thu|chuy|vay|no/i.test(normVN_(r[2]))) return;
    var b = brandOf_(r[6]), key = b ? 'b:' + b.n : 'p:' + normVN_(r[6]);
    var o = map[key] || (map[key] = {}); o[r[3]] = (o[r[3]] || 0) + 1;
  });
  return map;
}
function smartCat_(items, cats) {
  var hist = null;
  items.forEach(function (it) {
    it.n = cleanTxt_(it.n); it.p = cleanTxt_(it.p);
    if (it.t !== 'chi') return;
    var b = brandOf_(it.p) || brandOf_(it.n);
    if (b && !/^(Nhà hàng|Chợ|Bệnh viện|Học phí|Gửi xe|Nước sạch)$/.test(b.n) && (!it.p || normVN_(it.p) === normVN_(b.n) || it.p === it.p.toUpperCase())) it.p = b.n;
    if (!it.n || normVN_(it.n) === normVN_(it.p)) it.n = (b && KIND_LBL[b.k] ? KIND_LBL[b.k] + ' ' : '') + (it.p || '');
    if (b && /MoMo\)$/.test(b.n)) it.n = 'Đi xe Grab / Xanh SM (trả qua MoMo)'; // thẻ "TAI MOMO HO CHI MINH" = đi xe trả qua MoMo
    else if (/\b(gd|appcode|so the|ma gd)\b/.test(normVN_(it.n)) || /^[A-Z0-9 .\/:-]{20,}$/.test(it.n || '')) it.n = it.p ? 'Thanh toán tại ' + it.p : it.n;
    if (!hist) hist = placeHistory_();
    var key = b ? 'b:' + b.n : 'p:' + normVN_(it.p), h = it.p && hist[key], best = '';
    if (h) Object.keys(h).forEach(function (c) { if (cats.chi.indexOf(c) >= 0 && (!best || h[c] > h[best])) best = c; });
    if (best) { it.c = best; it.why = 'theo các lần trước ở ' + it.p; return; }
    if (b) { var c = catFor_(b.k, cats.chi); if (c) { it.c = c; it.why = 'theo tên quán'; } }
  });
  return items;
}

/* ---------- Đọc bill bằng Gemini ---------- */
function modelsFetch_(key) {
  var res;
  try {
    res = UrlFetchApp.fetch(GEM_BASE + 'models?pageSize=200', { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
  } catch (e) {
    return { ok: false, error: 'Không kết nối được Gemini: ' + e.message };
  }
  var code = res.getResponseCode();
  if (code === 400 || code === 401 || code === 403) return { ok: false, error: 'Khoá Gemini không đúng hoặc chưa bật (mã ' + code + ')' };
  if (code !== 200) return { ok: false, error: 'Gemini báo lỗi ' + code };
  var list = [];
  try {
    (JSON.parse(res.getContentText()).models || []).forEach(function (m) {
      var name = String(m.name || '').replace(/^models\//, '');
      var gm = m.supportedGenerationMethods || [];
      if (gm.indexOf('generateContent') < 0) return;
      if (!/^gemini-/.test(name) || !/flash/.test(name)) return;
      if (/image|tts|audio|live|embed|thinking|exp|learnlm|robotics|computer|native/.test(name)) return;
      list.push(name);
    });
  } catch (e) {}
  list.sort(function (a, b) { return modelScore_(b) - modelScore_(a); });
  return { ok: true, list: list.slice(0, 6) };
}

function modelScore_(n) {
  var v = n.match(/gemini-(\d+)(?:\.(\d+))?/), s = 0;
  if (v) s = (+v[1]) * 100 + (+(v[2] || 0)) * 10;
  if (/latest/.test(n)) s = 5000;          // bí danh ổn định, luôn trỏ bản mới
  if (/preview/.test(n)) s -= 300;
  if (/lite/.test(n)) s -= 50;
  if (/-\d{3}$|\d{2}-\d{2}/.test(n)) s -= 5; // bản đóng băng theo ngày
  return s;
}

// mode 'fast': Flash-Lite trước (nhanh, ~500 lượt/ngày); 'accurate': Flash trước
// thử tối đa 3 model: 2 model đầu + model Flash (không Lite) đầu tiên nếu chưa có – để không chờ quá lâu
function trim3_(L) { var out = L.slice(0, 2), f = L.filter(function (m) { return !/lite/.test(m); })[0]; if (f && out.indexOf(f) < 0) out.push(f); else if (L[2] && out.length < 3) out.push(L[2]); return out; }
function models_(key, mode) {
  var P = props_(), list = [];
  var pick = P.getProperty('gemModel');
  if (pick) list.push(pick);
  var raw = P.getProperty('gemModels'), c = null;
  try { c = JSON.parse(raw || 'null'); } catch (e) {}
  if (!c || Date.now() - c.t > 7 * 864e5) {
    var m = modelsFetch_(key);
    if (m.ok) { c = { t: Date.now(), list: m.list }; P.setProperty('gemModels', JSON.stringify(c)); }
  }
  (c && c.list || []).concat(GEM_FALLBACK).forEach(function (n) { if (list.indexOf(n) < 0) list.push(n); });
  if (mode !== 'accurate' && !pick) {
    var lite = list.filter(function (n) { return /lite/.test(n); }), full = list.filter(function (n) { return !/lite/.test(n); });
    list = lite.concat(full);
  }
  return list.slice(0, 6);
}

// cấu hình "suy nghĩ" ít nhất mà model chấp nhận (lv = 0, 1, 2…; undefined = hết cách)
function thinkCfg_(m, lv) {
  if (/gemini-1\.|gemini-2\.0/.test(m)) return [null][lv];
  if (/gemini-2\./.test(m)) return [{ thinkingBudget: 0 }, null][lv];
  return [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null][lv];
}
function cache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }

function billPrompt_(cats, today) {
  return [
    'Bạn đọc ảnh hoá đơn / biên lai / ảnh chụp màn hình chuyển khoản của một gia đình Việt Nam và ghi vào sổ thu chi.',
    'Hôm nay là ' + today + ' (năm-tháng-ngày).',
    'Chỉ trả về MỘT đối tượng JSON, không thêm chữ nào khác, theo mẫu:',
    '{"loaiAnh":"sieu_thi|cua_hang|nha_hang|chuyen_khoan|dien_nuoc|khac|khong_phai_bill",',
    ' "giaoDich":[{"loai":"chi|thu|rut_tien|nop_tien","ngay":"YYYY-MM-DD","tien":235000,"noi":"tên cửa hàng / nhà cung cấp / người nhận hoặc người chuyển",',
    '   "noidung":"mô tả ngắn gọn, tối đa 60 ký tự","muc":"một mục trong danh sách","nguon":"tien_mat|ngan_hang","mon":[{"ten":"tên món","sl":2,"tien":64000}]}],',
    ' "ghichu":"lưu ý ngắn nếu có chỗ không chắc"}',
    'Quy tắc:',
    '- Hoá đơn siêu thị, cửa hàng, nhà hàng, cà phê: 1 giao dịch "chi". "tien" = số TỔNG CẦN THANH TOÁN cuối cùng (đã trừ giảm giá, đã gồm VAT/phí phục vụ). KHÔNG lấy tiền khách đưa, tiền thối lại, tiền trước giảm giá. "mon" liệt kê các món (tối đa 15 món đầu, tên món ngắn gọn), "tien" của món là thành tiền của dòng đó.',
    '- Biên lai / ảnh chụp chuyển khoản: tiền chuyển đi là "chi" (noi = tên người nhận, noidung = nội dung chuyển khoản); tiền nhận vào (+, "nhận tiền", "ghi có") là "thu" (noi = người chuyển). "mon" để []. Ảnh lịch sử có nhiều giao dịch thì mỗi giao dịch là một phần tử trong "giaoDich".',
    '- Ảnh CHUYỂN KHOẢN / giao dịch ngân hàng (Techcombank, Vietcombank, MB…): luôn ghi đủ "tien" và "noidung" kể cả khi không biết là quán gì. "noi" = tên cửa hàng sau chữ "TAI" trong lời nhắn (vd "GD THE ... TAI OHMEE ..." → "OHMEE"), nếu không có thì là tên người / đơn vị nhận. "noidung" là lời nhắn đã bỏ số thẻ, APPCODE, mã giao dịch, viết gọn có dấu (vd "Thanh toán tại OHMEE"; chuyển cho người: "Chuyển tiền cho Phan Thị Thu"). Không rõ mục thì "muc" là mục khác.',
    '- Lời nhắn có "TAI MOMO HO CHI MINH", hoặc người nhận là ONLINE MOBILE SERVICES JOINT STOCK COMPANY (công ty ví MoMo), đều là tiền đi xe Grab / Xanh SM trả qua MoMo: "noi":"Grab / Xanh SM (MoMo)", "noidung":"Đi xe Grab / Xanh SM (trả qua MoMo)", "muc" = mục đi lại / xăng xe.',
    '- Biên lai / tin nhắn RÚT TIỀN MẶT (ATM, rút tại quầy) → "loai":"rut_tien" (tiền từ ngân hàng sang tiền mặt, không phải chi). NỘP tiền mặt vào tài khoản → "loai":"nop_tien". "muc" để "".',
    '- Ảnh chỉ chụp phần cuối của hoá đơn dài (chỉ thấy tổng tiền) vẫn ghi 1 giao dịch "chi" với tổng đó; tên quán, ngày lấy nếu thấy ở phần cuối (dòng cảm ơn, địa chỉ, giờ in), không thấy thì để ""; "mon" để [].',
    '- Hoá đơn tiền điện, nước, internet, truyền hình, điện thoại: "chi", noidung ghi rõ loại và kỳ, vd "Tiền điện kỳ T10/2026"; tien = tổng tiền phải trả.',
    '- "nguon": chỉ ghi "tien_mat" khi bill cho thấy rõ trả tiền mặt ("Tiền mặt", "Cash", "TM", có "tiền khách đưa" / "tiền thối lại"). Mọi trường hợp khác (chuyển khoản, quét QR, thẻ, ví điện tử, hoặc không ghi cách trả) → "ngan_hang".',
    '- Số tiền Việt Nam: dấu chấm hoặc dấu phẩy là phân cách hàng nghìn ("235.000" = 235000, "1,250,000" = 1250000); "235K" hoặc "235k" = 235000. "tien" là số nguyên dương, không có dấu.',
    '- Ngày theo kiểu Việt Nam ngày/tháng/năm ("05/11/2026" = 2026-11-05). Không có năm thì dùng năm hiện tại (nếu ra ngày ở tương lai thì lấy năm trước). Không thấy ngày thì để "".',
    '- Mục chi (chọn đúng một, viết y hệt cả phần trước và sau dấu "/"): ' + cats.chi.join(' | '),
    '- Mục thu (chọn đúng một, viết y hệt): ' + cats.thu.join(' | '),
    '- Gợi ý: siêu thị / chợ / đồ ăn mang về nấu → mục gần "Đi chợ – siêu thị"; nhà hàng, quán ăn, cà phê, trà sữa → "Ăn uống"; xăng, gửi xe, taxi, Grab → "Xăng xe – đi lại"; thuốc, khám bệnh → "Sức khoẻ"; học phí, sách vở, đồ trẻ em → "Con cái – học hành"; đám cưới, đám hiếu, biếu → "Hiếu hỉ – biếu tặng". Không chắc thì chọn mục "khác".',
    '- Đầu tư (dùng mục có chữ "đầu tư" nếu danh sách có): chuyển tiền mua đất, đặt cọc nhà → Nhà đất; góp vốn, chuyển tiền dự án → Dự án; nạp tiền tài khoản chứng khoán, mua cổ phiếu → Chứng khoán; mua vàng → Vàng; gửi / mở sổ tiết kiệm → Gửi tiết kiệm. Tiền lãi ngân hàng, lãi tiết kiệm nhận về → Thu đầu tư / Lãi ngân hàng; tiền lợi nhuận, chia lãi từ dự án → Thu từ dự án; cổ tức, tiền bán cổ phiếu → Cổ tức – chứng khoán.',
    '- Quán cà phê, trà sữa (Starbucks, Highlands, Phúc Long, Phê La, Gong Cha, Katinat, The Coffee House, Cộng, Trung Nguyên, Tocotoco, Mixue…) → mục cà phê / trà sữa nếu danh sách có. Nhà hàng, lẩu, nướng, đồ ăn nhanh (Pizza 4P\'s, Gogi, King BBQ, Meat Plus, Kichi Kichi, Manwah, KFC, Lotteria, Jollibee…) → Ăn uống.',
    '- KHÔNG đưa mã giao dịch, mã đơn hàng, số hoá đơn, mã QR vào noidung hay noi. noi là tên quán / cửa hàng viết gọn đúng thương hiệu (vd "Starbucks", "Highlands Coffee").',
    '- noidung viết tiếng Việt có dấu, ngắn gọn, vd "Đi chợ WinMart (12 món)", "Ăn tối Lẩu Phan", "Chuyển tiền học thêm cho cô Hoa".',
    '- Ảnh không đọc được hoặc không phải hoá đơn / giao dịch: "giaoDich": [] và ghi lý do vào "ghichu".'
  ].join('\n');
}

// cho app (đã đăng nhập) gọi thẳng Gemini từ điện thoại – nhanh hơn đi vòng qua máy chủ
function gemCfg_() {
  var key = props_().getProperty('gemKey');
  if (!key) return { ok: false, needKey: true, error: 'Chưa có khoá Gemini' };
  var think = {}; try { think = JSON.parse(props_().getProperty('gemThink') || '{}'); } catch (e) {}
  return { ok: true, key: key, models: models_(key, 'accurate'), think: think, prompt: billPrompt_(cats_(), '{TODAY}') };
}

function bill_(b) {
  var key = props_().getProperty('gemKey');
  if (!key) return { ok: false, needKey: true, error: 'Chưa có khoá Gemini – vào Menu → Khoá đọc bill' };
  if (!b.img) return { ok: false, error: 'Không có ảnh' };
  var cats = cats_();
  var today = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var body = {
    contents: [{ role: 'user', parts: [
      { text: billPrompt_(cats, today) },
      { inline_data: { mime_type: b.mime || 'image/jpeg', data: b.img } }
    ] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 4096 }
  };
  var t0 = Date.now(), P = props_(), C = cache_();
  var think = {}; try { think = JSON.parse(P.getProperty('gemThink') || '{}'); } catch (e) {}
  var models = trim3_(models_(key, b.mode)), lastErr = '', busy = false, empty = null;
  for (var i = 0; i < models.length; i++) {
    var m = models[i], res, code, txt;
    if (i > 0 && Date.now() - t0 > 40000) { lastErr = 'Gemini phản hồi chậm, thử lại hoặc nhập tay'; busy = true; break; } // không để chờ quá lâu
    if (empty && /lite/.test(m)) continue; // Lite đã không đọc được → sang thẳng Flash
    if (C && C.get('q429_' + m)) { busy = true; lastErr = 'Hết lượt miễn phí của Gemini, thử lại sau ít phút'; continue; } // vừa hết lượt → bỏ qua ngay
    var lv = think[m] || 0;
    while (true) {
      var tc = thinkCfg_(m, lv);
      if (tc) body.generationConfig.thinkingConfig = tc; else delete body.generationConfig.thinkingConfig;
      try {
        res = UrlFetchApp.fetch(GEM_BASE + 'models/' + encodeURIComponent(m) + ':generateContent', {
          method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
          headers: { 'x-goog-api-key': key }, muteHttpExceptions: true
        });
      } catch (e) { res = null; lastErr = 'Lỗi kết nối Gemini: ' + e.message; break; }
      code = res.getResponseCode(); txt = res.getContentText();
      if (code === 400 && /think|budget|level/i.test(txt) && thinkCfg_(m, lv + 1) !== undefined) { lv++; continue; } // model không nhận mức này → thử mức sau
      break;
    }
    if (!res) continue;
    if (lv !== (think[m] || 0)) { think[m] = lv; P.setProperty('gemThink', JSON.stringify(think)); }
    if (code === 200) {
      var out = parseGem_(txt, cats, today);
      if (out && !out.items.length && /lite/.test(m) && i < models.length - 1) { empty = out; continue; } // Lite không thấy gì → đọc lại bằng Flash
      if (out) { smartCat_(out.items, cats); out.ok = true; out.model = m; out.ms = Date.now() - t0; return out; }
      lastErr = 'Gemini trả về dữ liệu không đọc được';
      continue;
    }
    if (code === 401 || code === 403) return { ok: false, needKey: true, error: 'Khoá Gemini không còn hiệu lực – nhập lại ở Menu → Khoá đọc bill' };
    if (code === 429) { busy = true; lastErr = 'Hết lượt miễn phí của Gemini, thử lại sau ít phút'; if (C) C.put('q429_' + m, '1', 900); continue; }
    if (code === 503 || code === 500) { busy = true; lastErr = 'Gemini đang quá tải, thử lại sau'; continue; }
    lastErr = 'Gemini báo lỗi ' + code + ' (' + m + ')'; // 404 / 400: thử model khác
  }
  if (empty) { empty.ok = true; empty.ms = Date.now() - t0; return empty; }
  return { ok: false, busy: busy, error: lastErr || 'Không đọc được bill' };
}

function parseGem_(txt, cats, today) {
  var j;
  try {
    var r = JSON.parse(txt), c = (r.candidates || [])[0];
    var s = ((c && c.content && c.content.parts) || []).filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('');
    s = s.replace(/```json|```/g, '');
    var a = s.indexOf('{'), z = s.lastIndexOf('}');
    if (a < 0 || z < a) return null;
    j = JSON.parse(s.slice(a, z + 1));
  } catch (e) { return null; }
  var low = function (a) { return a.map(function (x) { return x.toLowerCase(); }); };
  var lc = low(cats.chi), lt = low(cats.thu);
  var gd = (j.giaoDich || j.giao_dich || []).map(function (g) {
    var t = /rut|nop/i.test(g.loai) ? 'ck' : /thu/i.test(g.loai) ? 'thu' : 'chi';
    var list = t === 'thu' ? cats.thu : cats.chi, ll = t === 'thu' ? lt : lc;
    var want = String(g.muc || '').toLowerCase().replace(/\s*\/\s*/g, ' / ').trim();
    var mi = ll.indexOf(want);
    if (mi < 0 && want) { // Gemini chỉ ghi phần mục con, vd "Nhà đất"
      var tail = want.split(' / ').pop();
      for (var q = 0; q < ll.length && mi < 0; q++) if (ll[q].split(' / ').pop() === tail) mi = q;
    }
    var d = isoOf_(g.ngay, 'Asia/Ho_Chi_Minh');
    if (d > today) { // đoán năm sai → lùi một năm
      var y = +d.slice(0, 4) - 1; d = y + d.slice(4);
      if (d > today) d = '';
    }
    var mon = (g.mon || []).slice(0, 40).map(function (x) {
      return { ten: String(x.ten || '').slice(0, 80), sl: +x.sl || 0, tien: numOf_(x.tien) };
    }).filter(function (x) { return x.ten; });
    var w = t === 'ck' ? (/nop/i.test(g.loai) ? 'tm' : 'nh') : /mat|cash/i.test(g.nguon) ? 'tm' : 'nh'; // không phải tiền mặt → ngân hàng; chuyển: w = ví bị trừ
    return {
      t: t, d: d, a: Math.abs(numOf_(g.tien)), w: w,
      c: t === 'ck' ? (w === 'tm' ? 'Nộp tiền vào ngân hàng' : 'Rút tiền mặt') : mi >= 0 ? list[mi] : list[list.length - 1],
      p: String(g.noi || '').slice(0, 120),
      n: String(g.noidung || '').slice(0, 300),
      mon: mon
    };
  }).filter(function (g) { return g.a > 0; });
  return { kind: String(j.loaiAnh || ''), items: gd, note: String(j.ghichu || '').slice(0, 300) };
}

/* ---------- Chạy tay trong trình soạn Apps Script ---------- */
// Chạy MỘT lần để cấp quyền (bảng tính + kết nối Gemini + Google Calendar). Chạy lại khi bản mới cần thêm quyền.
function capQuyen() {
  // Google cho phép bỏ tích từng quyền khi cấp; dòng này buộc hỏi lại các quyền còn thiếu (vd Google Drive cho ảnh gia đình)
  if (ScriptApp.requireAllScopes) ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  sheet_();
  try { UrlFetchApp.fetch(GEM_BASE + 'models', { muteHttpExceptions: true }); } catch (e) {}
  try { CalendarApp.getDefaultCalendar(); } catch (e) {} // quyền tạo nhắc ngày giỗ trên Google Calendar
  try { ScriptApp.getProjectTriggers(); } catch (e) {}     // quyền tự gia hạn nhắc hằng tháng
  var anh = '';                                             // quyền lưu ảnh gia đình trên Google Drive
  try { anh = 'OK – thư mục ảnh: https://drive.google.com/drive/folders/' + photoDir_().getId(); } catch (e) { anh = 'CHƯA ĐƯỢC – ' + e.message; }
  Logger.log('Đã cấp quyền. Mật khẩu hiện tại: ' + (auth_().def ? 'admin (mặc định)' : 'đã đổi'));
  Logger.log('Ảnh gia đình (Google Drive): ' + anh);
  Logger.log('Máy chủ bản ' + VER + '. Nhớ: Triển khai → Quản lý → Sửa → Phiên bản mới → Triển khai.');
}

// Quên mật khẩu: chạy hàm này → mật khẩu trở về "admin".
function datLaiMatKhau() {
  props_().deleteProperty('auth');
  auth_();
  Logger.log('Mật khẩu của chủ sổ đã đặt lại thành: admin (mật khẩu của người kia giữ nguyên)');
}
