/**
 * ERP Birimi İş Takip — Google Apps Script sunucusu.
 *
 * Bu betik, verilerin tutulduğu Google E-Tablosuna bağlı (Uzantılar › Apps Script) çalışır ve
 * "Web uygulaması" olarak dağıtılır (Çalıştıran: Ben, Erişim: Herkes). E-tablo yalnızca sahibine
 * ve uygulamada "Yönetici" yetkisi verilen kullanıcılara paylaşılır; diğer kullanıcılar verilere
 * sadece bu API üzerinden, kendi yetkileri ölçüsünde erişir.
 *
 * Kimlik doğrulama: tarayıcı Google ile giriş (Google Identity Services) sonucu aldığı ID token'ı
 * her istekte gönderir; token Google'a doğrulatılır ve e-posta, Kullanicilar sayfasındaki izinli
 * listede aranır. Gerekli komut dosyası özelliği: GOOGLE_CLIENT_ID.
 */
const VERSION = '1.0.0';

function doGet() {
  return json({ ok: true, data: { uygulama: 'ERP Birimi İş Takip API', surum: VERSION } });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action === 'ping') return json({ ok: true, data: { surum: VERSION, saatDilimi: Session.getScriptTimeZone() } });

    const email = verifyToken(req.token);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const store = new SheetStore();
      let data = Logic.handle(store, email, req.action, req.payload);
      if (req.action === 'admin.info') data = Object.assign(data, { tabloUrl: store.ss.getUrl(), tabloAdi: store.ss.getName() });
      if (String(req.action).indexOf('users.') === 0) syncSheetAccess(store);
      out = { ok: true, data };
      if (req.boot) out.boot = Logic.handle(store, email, 'bootstrap');
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err) };
  }
  return json(out);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- kimlik doğrulama ----------
function verifyToken(token) {
  if (!token) throw new Error('OTURUM: Oturum bulunamadı, lütfen giriş yapın.');
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Sunucu yapılandırılmamış: GOOGLE_CLIENT_ID komut dosyası özelliği tanımlı değil.');

  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('OTURUM: Oturum süresi doldu, lütfen tekrar giriş yapın.');
  const info = JSON.parse(res.getContentText());
  if (info.aud !== clientId) throw new Error('OTURUM: Oturum bu uygulamaya ait değil.');
  if (String(info.email_verified) !== 'true') throw new Error('YETKISIZ: E-posta adresi doğrulanmamış.');
  const ttl = Math.min(21600, Number(info.exp) - Math.floor(Date.now() / 1000));
  if (ttl <= 0) throw new Error('OTURUM: Oturum süresi doldu, lütfen tekrar giriş yapın.');
  if (ttl > 5) cache.put(key, info.email, ttl);
  return info.email;
}

// ---------- E-tablo deposu ----------
// Her tablo bir sayfadır; 1. satır başlık, sütun sırası Logic.TABLES ile aynıdır. Hücreler düz metin tutulur.
class SheetStore {
  constructor() {
    this.ss = SpreadsheetApp.getActiveSpreadsheet();
    this.tz = Session.getScriptTimeZone();
    this.cache = {};
  }

  sheet(table) {
    return this.ss.getSheetByName(table) || createTableSheet(this.ss, table);
  }

  load(table) {
    if (!this.cache[table]) {
      const sh = this.sheet(table), cols = Logic.TABLES[table], n = sh.getLastRow() - 1;
      const values = n > 0 ? sh.getRange(2, 1, n, cols.length).getValues() : [];
      const list = [], rowOf = {};
      values.forEach((r, i) => {
        const o = {};
        cols.forEach((c, j) => { o[c] = cellText(r[j], this.tz); });
        if (!o.id) return;
        rowOf[o.id] = i + 2;
        list.push(o);
      });
      this.cache[table] = { list, rowOf };
    }
    return this.cache[table];
  }

  rows(table) {
    return this.load(table).list.map(o => Object.assign({}, o));
  }

  write(table, row, obj) {
    const cols = Logic.TABLES[table];
    const range = this.sheet(table).getRange(row, 1, 1, cols.length);
    range.setNumberFormat('@');
    range.setValues([cols.map(c => (obj[c] == null ? '' : String(obj[c])))]);
  }

  insert(table, obj) {
    const c = this.load(table), cols = Logic.TABLES[table];
    const rec = {};
    cols.forEach(k => { rec[k] = obj[k] == null ? '' : String(obj[k]); });
    if (!rec.id) rec.id = Utilities.getUuid();
    const row = this.sheet(table).getLastRow() + 1;
    this.write(table, row, rec);
    c.list.push(rec);
    c.rowOf[rec.id] = row;
    return Object.assign({}, rec);
  }

  update(table, id, patch) {
    const c = this.load(table);
    const rec = c.list.find(o => o.id === String(id));
    if (!rec) throw new Error('Kayıt bulunamadı: ' + table + '/' + id);
    Object.keys(patch).forEach(k => { rec[k] = patch[k] == null ? '' : String(patch[k]); });
    this.write(table, c.rowOf[rec.id], rec);
    return Object.assign({}, rec);
  }

  remove(table, id) {
    const row = this.load(table).rowOf[String(id)];
    if (!row) return;
    this.sheet(table).deleteRow(row);
    delete this.cache[table];
  }

  now() {
    return Utilities.formatDate(new Date(), this.tz, "yyyy-MM-dd'T'HH:mm");
  }
}

function cellText(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm");
  return v == null ? '' : String(v);
}

function createTableSheet(ss, table) {
  const cols = Logic.TABLES[table];
  const sh = ss.insertSheet(table);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8eef7');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  return sh;
}

// Veri sayfaları yalnızca yöneticilere açık: yönetici + aktif kullanıcılar düzenleyici yapılır, diğerleri çıkarılır.
function syncSheetAccess(store) {
  const ss = store.ss;
  const owner = ss.getOwner() ? ss.getOwner().getEmail().toLowerCase() : '';
  const editors = ss.getEditors().map(u => u.getEmail().toLowerCase());
  store.rows('Kullanicilar').forEach(u => {
    const email = String(u.email).toLowerCase();
    if (!email || email === owner) return;
    const admin = Logic.bool(u.yonetici) && Logic.bool(u.aktif);
    try {
      if (admin && editors.indexOf(email) < 0) ss.addEditor(email);
      if (!admin && editors.indexOf(email) >= 0) ss.removeEditor(email);
    } catch (err) {
      console.warn('Paylaşım güncellenemedi: ' + email + ' — ' + err.message);
    }
  });
}

/**
 * İlk kurulum: Apps Script düzenleyicisinde bu fonksiyonu bir kez çalıştırın.
 * Sayfaları oluşturur ve betiği çalıştıran hesabı ilk yönetici olarak ekler.
 */
function kurulum() {
  const store = new SheetStore();
  Object.keys(Logic.TABLES).forEach(t => store.sheet(t));
  ['Sayfa1', 'Sheet1'].forEach(n => {
    const sh = store.ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && store.ss.getSheets().length > 1) store.ss.deleteSheet(sh);
  });
  const owner = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!store.rows('Kullanicilar').some(u => String(u.email).toLowerCase() === owner)) {
    store.insert('Kullanicilar', { email: owner, ad: owner.split('@')[0], yonetici: true, aktif: true, olusturma: store.now() });
  }
  if (!PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID')) {
    console.warn('GOOGLE_CLIENT_ID komut dosyası özelliğini tanımlamayı unutmayın (Proje Ayarları › Komut dosyası özellikleri).');
  }
  console.log('Kurulum tamam. İlk yönetici: ' + owner);
}
