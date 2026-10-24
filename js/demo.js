// Demo modu: sunucu yerine tarayıcıda (localStorage) çalışan veri deposu.
// İş kuralları sunucuyla aynıdır (backend/Logic.js).
const Demo = (() => {
  const KEY = 'isTakip.demoDb.v1';
  let db = null;

  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const toRow = (t, o) => Object.fromEntries(Logic.TABLES[t].map(c => [c, o[c] == null ? '' : String(o[c])]));

  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
    if (!db) seed();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* özel pencere vb. */ }
  }

  const store = {
    rows: t => (db[t] || []).map(o => ({ ...o })),
    insert(t, o) {
      const row = toRow(t, { ...o, id: o.id || uid() });
      (db[t] = db[t] || []).push(row);
      save();
      return { ...row };
    },
    update(t, id, patch) {
      const r = (db[t] || []).find(x => x.id === String(id));
      if (!r) throw new Error('Kayıt bulunamadı.');
      Object.keys(patch).forEach(k => { r[k] = patch[k] == null ? '' : String(patch[k]); });
      save();
      return { ...r };
    },
    remove(t, id) { db[t] = (db[t] || []).filter(x => x.id !== String(id)); save(); },
    now: () => fmt(new Date())
  };

  function seed() {
    db = Object.fromEntries(Object.keys(Logic.TABLES).map(t => [t, []]));
    const now = store.now();
    const users = [
      ['yonetici@demo.local', 'Demo Yönetici', true],
      ['ayse@demo.local', 'Ayşe Yılmaz', false],
      ['mehmet@demo.local', 'Mehmet Demir', false],
      ['zeynep@demo.local', 'Zeynep Kaya', false]
    ].map(([email, ad, yonetici]) => store.insert('Kullanicilar', { email, ad, yonetici, aktif: true, olusturma: now }));

    const B = {};
    ['Finans', 'Satın Alma', 'İnsan Kaynakları', 'Üretim Planlama', 'Satış', 'Lojistik'].forEach(ad => {
      B[ad] = store.insert('Birimler', { ad, aciklama: '', silindi: false, olusturma: now }).id;
    });

    let seq = 0;
    const proje = (ad, birim, olusturan, ust = '', durum = 'Aktif') => store.insert('Projeler', {
      kod: 'PRJ-' + String(++seq).padStart(6, '0'), ad, ustProjeId: ust, birimId: B[birim], durum,
      aciklama: '', olusturan: olusturan.email, olusturma: now, silindi: false, silen: '', silinme: ''
    });
    const [adm, ayse, mehmet, zeynep] = users;
    const efatura = proje('e-Fatura / e-Arşiv Entegrasyonu', 'Finans', adm);
    const gib = proje('GİB Bağlantı Testleri', 'Finans', adm, efatura.id);
    const sablon = proje('Fatura Şablonları', 'Finans', ayse, efatura.id);
    const onay = proje('Satın Alma Onay Akışı', 'Satın Alma', mehmet);
    const bordro = proje('Bordro Raporları Revizyonu', 'İnsan Kaynakları', zeynep, '', 'Beklemede');
    const mrp = proje('MRP Parametre Revizyonu', 'Üretim Planlama', adm);
    const stok = proje('Emniyet Stoku Hesabı', 'Üretim Planlama', mehmet, mrp.id);
    const sevk = proje('Sevkiyat Etiket Tasarımı', 'Lojistik', ayse, '', 'Tamamlandı');
    store.insert('Sayaclar', { id: 'proje', deger: seq });

    const ata = (u, list) => list.forEach((p, i) => store.insert('Atamalar', { projeId: p.id, email: u.email, oncelik: i + 1, atayan: adm.email, olusturma: now }));
    ata(adm, [efatura, mrp]);
    ata(ayse, [sablon, gib, sevk]);
    ata(mehmet, [onay, stok]);
    ata(zeynep, [bordro, gib]);

    // Son üç haftanın iş günleri için örnek kayıtlar (deterministik)
    let r = 7;
    const rnd = n => { r = (r * 9301 + 49297) % 233280; return Math.floor((r / 233280) * n); };
    const gunluk = ['Kullanıcı yetki talebi', 'Rapor hatası incelendi', 'Şifre sıfırlama / destek', 'Ay sonu kapanış desteği', 'Veri düzeltme talebi', 'Eğitim / bilgilendirme'];
    const isler = { [adm.email]: [efatura, mrp, gib], [ayse.email]: [sablon, gib, sevk], [mehmet.email]: [onay, stok, mrp], [zeynep.email]: [bordro, gib] };
    const birimList = Object.values(B);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let g = 21; g >= 1; g--) {
      const d = new Date(today); d.setDate(d.getDate() - g);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      users.forEach(u => {
        let t = 9 * 60 + rnd(30);
        const parca = 2 + rnd(3);
        for (let i = 0; i < parca && t < 17 * 60; i++) {
          const sure = 45 + rnd(150);
          const s = new Date(d); s.setMinutes(t);
          const e = new Date(d); e.setMinutes(Math.min(t + sure, 18 * 60));
          const p = rnd(10) < 6 ? isler[u.email][rnd(isler[u.email].length)] : null;
          store.insert('Loglar', {
            personel: u.email, projeId: p ? p.id : '', birimId: p ? p.birimId : birimList[rnd(birimList.length)],
            baslangic: fmt(s), bitis: fmt(e), aciklama: p ? 'Geliştirme çalışması' : gunluk[rnd(gunluk.length)],
            olusturan: u.email, olusturma: fmt(e), guncelleme: fmt(e), silindi: false
          });
          t += sure + 10 + rnd(40);
        }
      });
    }
    save();
  }

  function call(email, action, payload, boot) {
    if (!db) load();
    const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
    const out = { ok: true, data: clone(Logic.handle(store, email, action, clone(payload || {}))) };
    if (action === 'admin.info') out.data.demo = true;
    if (boot) out.boot = clone(Logic.handle(store, email, 'bootstrap'));
    return out;
  }

  return {
    call,
    users() { if (!db) load(); return db.Kullanicilar.filter(u => Logic.bool(u.aktif)); },
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* yok say */ } seed(); },
    exportJson() { if (!db) load(); return JSON.stringify(db, null, 2); }
  };
})();
