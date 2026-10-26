/**
 * ERP Birimi İş Takip — iş kuralları.
 *
 * Bu dosya hem Google Apps Script sunucusunda (Logic.gs olarak) hem de tarayıcıdaki
 * demo modunda aynen çalışır. Veriye yalnızca dışarıdan verilen "store" üzerinden erişilir:
 *   rows(tablo) · insert(tablo, kayıt) · update(tablo, id, alanlar) · remove(tablo, id) · now()
 * Tüm değerler metin olarak saklanır; tarih-saatler "YYYY-MM-DDTHH:mm" biçimindedir.
 */
var Logic = (function () {
  'use strict';

  const TABLES = {
    Kullanicilar: ['id', 'email', 'ad', 'yonetici', 'aktif', 'olusturma'],
    Birimler: ['id', 'ad', 'aciklama', 'silindi', 'olusturma'],
    Projeler: ['id', 'kod', 'ad', 'ustProjeId', 'birimId', 'durum', 'aciklama', 'olusturan', 'olusturma', 'silindi', 'silen', 'silinme'],
    Atamalar: ['id', 'projeId', 'email', 'oncelik', 'atayan', 'olusturma'],
    Loglar: ['id', 'personel', 'projeId', 'birimId', 'baslangic', 'bitis', 'aciklama', 'olusturan', 'olusturma', 'guncelleme', 'silindi'],
    Sayaclar: ['id', 'deger']
  };
  const PROJE_DURUMLARI = ['Aktif', 'Beklemede', 'Tamamlandı'];
  const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const MAX_LOG_DK = 24 * 60;

  // ---------- yardımcılar ----------
  const bool = v => v === true || String(v).toLowerCase() === 'true';
  const fail = msg => { throw new Error(msg); };
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const text = v => String(v == null ? '' : v).trim();
  const required = (v, label) => text(v) || fail(label + ' zorunludur.');
  const pad = (n, w) => String(n).padStart(w, '0');
  const toDate = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  };
  const minutesBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 60000);
  const find = (store, table, id) => store.rows(table).find(r => r.id === String(id)) || null;
  const needAdmin = me => { if (!me.yonetici) fail('Bu işlem için yönetici yetkisi gerekir.'); };
  const trDT = s => s ? s.slice(8, 10) + '.' + s.slice(5, 7) + ' ' + s.slice(11, 16) : '';

  function nextSeq(store, name) {
    const row = find(store, 'Sayaclar', name);
    const n = row ? Number(row.deger) + 1 : 1;
    if (row) store.update('Sayaclar', name, { deger: n });
    else store.insert('Sayaclar', { id: name, deger: n });
    return n;
  }

  function resolveUser(store, email) {
    const e = norm(email);
    const u = e && store.rows('Kullanicilar').find(x => norm(x.email) === e);
    if (!u || !bool(u.aktif)) fail('YETKISIZ: ' + (email || 'Bu hesap') + ' için uygulamaya erişim izni tanımlanmamış. Yöneticinize başvurun.');
    return { id: u.id, email: e, ad: u.ad || e, yonetici: bool(u.yonetici) };
  }

  // ---------- çıktı biçimleri ----------
  const userOut = u => ({ id: u.id, email: norm(u.email), ad: u.ad, yonetici: bool(u.yonetici), aktif: bool(u.aktif), olusturma: u.olusturma });
  const birimOut = b => Object.assign({}, b, { silindi: bool(b.silindi) });
  const projeOut = p => Object.assign({}, p, { silindi: bool(p.silindi) });
  const atamaOut = a => Object.assign({}, a, { email: norm(a.email), oncelik: Number(a.oncelik) || 0 });
  function logOut(l, now) {
    return Object.assign({}, l, {
      personel: norm(l.personel),
      aktif: !l.bitis,
      sureDk: Math.max(0, minutesBetween(l.baslangic, l.bitis || now)),
      tur: l.projeId ? 'Geliştirme' : 'Günlük İş',
      silindi: bool(l.silindi)
    });
  }

  const liveLogs = store => store.rows('Loglar').filter(l => !bool(l.silindi));
  const activeLogOf = (store, email) => liveLogs(store).find(l => norm(l.personel) === email && !l.bitis) || null;

  // Proje / birim seçimini doğrular. Projeli kayıtta birim zorunludur; Günlük İş birimsiz girilebilir.
  function checkRefs(store, projeId, birimId, existing) {
    if (projeId) {
      const p = find(store, 'Projeler', projeId) || fail('Seçilen proje bulunamadı.');
      if (bool(p.silindi) && !(existing && existing.projeId === projeId)) fail('Silinmiş bir projeye kayıt girilemez.');
      required(birimId, 'Birim');
    }
    if (!birimId) return;
    const b = find(store, 'Birimler', birimId) || fail('Seçilen birim bulunamadı.');
    if (bool(b.silindi) && !(existing && existing.birimId === birimId)) fail('Silinmiş bir birime kayıt girilemez.');
  }

  // Aynı personelin kayıtları üst üste binemez: bir işe ara verip başka işe geçmek ayrı kayıt demektir.
  function checkOverlap(store, personel, start, end, exceptId, now) {
    const c = liveLogs(store).find(o => norm(o.personel) === personel && o.id !== exceptId &&
      o.baslangic < end && start < (o.bitis || now));
    if (c) fail('Bu zaman aralığı aynı personelin başka bir kaydıyla çakışıyor (' + trDT(c.baslangic) + ' – ' + (c.bitis ? c.bitis.slice(11, 16) : 'devam ediyor') + ').');
  }

  function closeLog(store, log, now) {
    if (minutesBetween(log.baslangic, now) < 1) store.update('Loglar', log.id, { silindi: true, guncelleme: now });
    else store.update('Loglar', log.id, { bitis: now, guncelleme: now });
  }

  // ---------- işlemler ----------
  const ACTIONS = {
    bootstrap(store, me) {
      const users = store.rows('Kullanicilar').map(userOut).filter(u => me.yonetici || u.aktif);
      const aktif = activeLogOf(store, me.email);
      return {
        me: me,
        users: me.yonetici ? users : users.map(u => ({ id: u.id, email: u.email, ad: u.ad, yonetici: u.yonetici, aktif: true })),
        birimler: store.rows('Birimler').map(birimOut),
        projeler: store.rows('Projeler').map(projeOut),
        atamalar: store.rows('Atamalar').map(atamaOut),
        aktifLog: aktif ? logOut(aktif, store.now()) : null,
        simdi: store.now()
      };
    },

    // ---- iş logları ----
    'logs.list'(store, me, p) {
      const from = text(p.from) || '0000-00-00', to = text(p.to) || '9999-99-99';
      const personel = me.yonetici ? norm(p.personel) : me.email;
      const now = store.now();
      return liveLogs(store)
        .filter(l => { const d = l.baslangic.slice(0, 10); return d >= from && d <= to && (!personel || norm(l.personel) === personel); })
        .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
        .map(l => logOut(l, now));
    },

    'logs.save'(store, me, p) {
      const now = store.now();
      const existing = p.id ? find(store, 'Loglar', p.id) : null;
      if (p.id && (!existing || bool(existing.silindi))) fail('Kayıt bulunamadı.');
      if (existing && !me.yonetici && norm(existing.personel) !== me.email) fail('Sadece kendi kayıtlarınızı düzenleyebilirsiniz.');

      const personel = me.yonetici ? norm(p.personel || me.email) : me.email;
      if (personel !== me.email) {
        const u = store.rows('Kullanicilar').find(x => norm(x.email) === personel);
        if (!u) fail('Personel bulunamadı.');
      }
      const baslangic = required(p.baslangic, 'Başlangıç');
      if (!DT.test(baslangic)) fail('Başlangıç zamanı geçersiz.');
      // Bitiş boş bırakılırsa kayıt açık kalır (devam eden çalışma); bitiş sonradan düzenleyerek girilir.
      const bitis = text(p.bitis);
      if (bitis) {
        if (!DT.test(bitis)) fail('Bitiş zamanı geçersiz.');
        if (bitis <= baslangic) fail('Bitiş, başlangıçtan sonra olmalıdır.');
        if (minutesBetween(baslangic, bitis) > MAX_LOG_DK) fail('Tek bir kayıt 24 saatten uzun olamaz.');
      } else {
        if (baslangic > now) fail('Bitiş saati girilmeyen (açık) bir kaydın başlangıcı ileri bir zaman olamaz.');
        const acik = activeLogOf(store, personel);
        if (acik && (!existing || acik.id !== existing.id))
          fail('Bu personelin bitiş saati girilmemiş açık bir kaydı zaten var (' + trDT(acik.baslangic) + '). Önce onun bitiş saatini girin.');
      }

      const projeId = text(p.projeId), birimId = text(p.birimId);
      checkRefs(store, projeId, birimId, existing);
      checkOverlap(store, personel, baslangic, bitis || now, existing ? existing.id : '', now);

      const rec = { personel, projeId, birimId, baslangic, bitis, aciklama: text(p.aciklama), guncelleme: now };
      const saved = existing
        ? store.update('Loglar', existing.id, rec)
        : store.insert('Loglar', Object.assign(rec, { olusturan: me.email, olusturma: now, silindi: false }));
      return logOut(saved, now);
    },

    'logs.delete'(store, me, p) {
      const l = find(store, 'Loglar', p.id);
      if (!l || bool(l.silindi)) fail('Kayıt bulunamadı.');
      if (!me.yonetici && norm(l.personel) !== me.email) fail('Sadece kendi kayıtlarınızı silebilirsiniz.');
      store.update('Loglar', l.id, { silindi: true, guncelleme: store.now() });
      return true;
    },

    // ---- canlı bildirim: başladım / bitirdim ----
    'timer.start'(store, me, p) {
      const now = store.now();
      const projeId = text(p.projeId), birimId = text(p.birimId);
      checkRefs(store, projeId, birimId, null);
      const aktif = activeLogOf(store, me.email);
      const kapsayan = liveLogs(store).find(o => norm(o.personel) === me.email && o.bitis && o.baslangic <= now && now < o.bitis);
      if (kapsayan) fail('Şu anki saati kapsayan bir kaydınız zaten var (' + trDT(kapsayan.baslangic) + ' – ' + kapsayan.bitis.slice(11, 16) + ').');
      if (aktif) closeLog(store, aktif, now); // başka işe geçiş: önceki çalışma otomatik biter
      const log = store.insert('Loglar', {
        personel: me.email, projeId, birimId, baslangic: now, bitis: '', aciklama: text(p.aciklama),
        olusturan: me.email, olusturma: now, guncelleme: now, silindi: false
      });
      return logOut(log, now);
    },

    'timer.stop'(store, me, p) {
      const now = store.now();
      const aktif = activeLogOf(store, me.email) || fail('Devam eden bir çalışmanız yok.');
      if (text(p.aciklama)) store.update('Loglar', aktif.id, { aciklama: text(p.aciklama) });
      closeLog(store, aktif, now);
      return true;
    },

    // ---- projeler ----
    'projects.save'(store, me, p) {
      const now = store.now();
      const existing = p.id ? find(store, 'Projeler', p.id) : null;
      if (p.id && (!existing || bool(existing.silindi))) fail('Proje bulunamadı.');
      if (existing && !me.yonetici && norm(existing.olusturan) !== me.email) fail('Sadece kendi eklediğiniz projeleri düzenleyebilirsiniz.');

      const ad = required(p.ad, 'Proje adı');
      const birimId = required(p.birimId, 'Ait olduğu birim');
      const b = find(store, 'Birimler', birimId) || fail('Birim bulunamadı.');
      if (bool(b.silindi) && !(existing && existing.birimId === birimId)) fail('Silinmiş bir birim seçilemez.');

      const ustProjeId = text(p.ustProjeId);
      if (ustProjeId) {
        const ust = find(store, 'Projeler', ustProjeId);
        if (!ust || bool(ust.silindi)) fail('Üst proje bulunamadı.');
        if (ust.ustProjeId) fail('Alt projenin altına yeni alt proje eklenemez.');
        if (existing && ust.id === existing.id) fail('Proje kendisinin alt projesi olamaz.');
        if (existing && store.rows('Projeler').some(x => x.ustProjeId === existing.id && !bool(x.silindi)))
          fail('Alt projeleri olan bir proje başka bir projenin altına taşınamaz.');
      }
      const durum = PROJE_DURUMLARI.indexOf(text(p.durum)) >= 0 ? text(p.durum) : 'Aktif';
      const rec = { ad, ustProjeId, birimId, durum, aciklama: text(p.aciklama) };

      if (existing) return projeOut(store.update('Projeler', existing.id, rec));
      const proje = store.insert('Projeler', Object.assign(rec, {
        kod: 'PRJ-' + pad(nextSeq(store, 'proje'), 6), olusturan: me.email, olusturma: now, silindi: false, silen: '', silinme: ''
      }));
      if (bool(p.kendimeAta)) assign(store, me, proje.id, me.email, true);
      return projeOut(proje);
    },

    // Soft delete: kayıt silinmez, "Silindi" olarak işaretlenir. Alt projeler de birlikte işaretlenir.
    'projects.delete'(store, me, p) {
      const pr = find(store, 'Projeler', p.id);
      if (!pr || bool(pr.silindi)) fail('Proje bulunamadı.');
      if (!me.yonetici && norm(pr.olusturan) !== me.email) fail('Sadece kendi eklediğiniz projeleri silebilirsiniz.');
      const now = store.now();
      const mark = { silindi: true, silen: me.email, silinme: now };
      store.update('Projeler', pr.id, mark);
      store.rows('Projeler').filter(x => x.ustProjeId === pr.id && !bool(x.silindi)).forEach(x => store.update('Projeler', x.id, mark));
      return true;
    },

    'projects.restore'(store, me, p) {
      needAdmin(me);
      const pr = find(store, 'Projeler', p.id);
      if (!pr || !bool(pr.silindi)) fail('Silinmiş proje bulunamadı.');
      if (pr.ustProjeId && bool((find(store, 'Projeler', pr.ustProjeId) || {}).silindi)) fail('Önce üst projeyi geri alın.');
      const unmark = { silindi: false, silen: '', silinme: '' };
      store.update('Projeler', pr.id, unmark);
      store.rows('Projeler').filter(x => x.ustProjeId === pr.id && bool(x.silindi) && x.silinme === pr.silinme)
        .forEach(x => store.update('Projeler', x.id, unmark));
      return true;
    },

    // { projeId, email, atanmis } tek kişi; yönetici { projeId, emails: [...] } ile listeyi topluca belirleyebilir.
    'projects.assign'(store, me, p) {
      const pr = find(store, 'Projeler', p.projeId);
      if (!pr || bool(pr.silindi)) fail('Proje bulunamadı.');
      if (Array.isArray(p.emails)) {
        needAdmin(me);
        const hedef = p.emails.map(norm);
        const mevcut = store.rows('Atamalar').filter(a => a.projeId === pr.id).map(a => norm(a.email));
        mevcut.filter(e => hedef.indexOf(e) < 0).forEach(e => assign(store, me, pr.id, e, false));
        hedef.filter(e => mevcut.indexOf(e) < 0).forEach(e => assign(store, me, pr.id, e, true));
      } else {
        assign(store, me, pr.id, norm(p.email || me.email), bool(p.atanmis));
      }
      return true;
    },

    'dashboard.reorder'(store, me, p) {
      const ids = (p.projeIds || []).map(String);
      store.rows('Atamalar').filter(a => norm(a.email) === me.email).forEach(a => {
        const i = ids.indexOf(a.projeId);
        if (i >= 0 && Number(a.oncelik) !== i + 1) store.update('Atamalar', a.id, { oncelik: i + 1 });
      });
      return true;
    },

    // ---- birimler (yalnız yönetici) ----
    'birimler.save'(store, me, p) {
      needAdmin(me);
      const ad = required(p.ad, 'Birim adı');
      const existing = p.id ? find(store, 'Birimler', p.id) : null;
      if (p.id && !existing) fail('Birim bulunamadı.');
      if (store.rows('Birimler').some(b => !bool(b.silindi) && norm(b.ad) === norm(ad) && (!existing || b.id !== existing.id)))
        fail('Bu isimde bir birim zaten var.');
      const rec = { ad, aciklama: text(p.aciklama) };
      if (existing) return birimOut(store.update('Birimler', existing.id, rec));
      return birimOut(store.insert('Birimler', Object.assign(rec, { silindi: false, olusturma: store.now() })));
    },

    'birimler.delete'(store, me, p) {
      needAdmin(me);
      const b = find(store, 'Birimler', p.id);
      if (!b || bool(b.silindi)) fail('Birim bulunamadı.');
      store.update('Birimler', b.id, { silindi: true });
      return true;
    },

    // ---- kullanıcılar / izin verilen e-postalar (yalnız yönetici) ----
    'users.save'(store, me, p) {
      needAdmin(me);
      const email = norm(required(p.email, 'E-posta'));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Geçerli bir e-posta adresi girin.');
      const existing = p.id ? find(store, 'Kullanicilar', p.id) : null;
      if (p.id && !existing) fail('Kullanıcı bulunamadı.');
      const all = store.rows('Kullanicilar');
      if (all.some(u => norm(u.email) === email && (!existing || u.id !== existing.id))) fail('Bu e-posta zaten listede.');
      const yonetici = bool(p.yonetici), aktif = p.aktif === undefined ? true : bool(p.aktif);
      if (existing && norm(existing.email) === me.email && (!yonetici || !aktif || email !== me.email))
        fail('Kendi yönetici yetkinizi, durumunuzu veya e-postanızı değiştiremezsiniz.');
      const rec = { email, ad: text(p.ad) || email, yonetici, aktif };
      if (existing) return userOut(store.update('Kullanicilar', existing.id, rec));
      return userOut(store.insert('Kullanicilar', Object.assign(rec, { olusturma: store.now() })));
    },

    'admin.info'(store, me) {
      needAdmin(me);
      return {
        sayilar: {
          kullanici: store.rows('Kullanicilar').filter(u => bool(u.aktif)).length,
          birim: store.rows('Birimler').filter(b => !bool(b.silindi)).length,
          proje: store.rows('Projeler').filter(x => !bool(x.silindi)).length,
          log: liveLogs(store).length
        }
      };
    }
  };

  function assign(store, me, projeId, email, atanmis) {
    if (!me.yonetici && email !== me.email) fail('Projeleri yalnızca kendinize atayabilirsiniz.');
    const mevcut = store.rows('Atamalar').find(a => a.projeId === projeId && norm(a.email) === email);
    if (atanmis && !mevcut) {
      const u = store.rows('Kullanicilar').find(x => norm(x.email) === email && bool(x.aktif));
      if (!u) fail('Atanacak kullanıcı bulunamadı: ' + email);
      const max = store.rows('Atamalar').filter(a => norm(a.email) === email).reduce((m, a) => Math.max(m, Number(a.oncelik) || 0), 0);
      store.insert('Atamalar', { projeId, email, oncelik: max + 1, atayan: me.email, olusturma: store.now() });
    } else if (!atanmis && mevcut) {
      store.remove('Atamalar', mevcut.id);
    }
  }

  function handle(store, email, action, payload) {
    const me = resolveUser(store, email);
    const fn = ACTIONS[action] || fail('Bilinmeyen işlem: ' + action);
    return fn(store, me, payload || {});
  }

  return { TABLES, PROJE_DURUMLARI, bool, norm, handle, resolveUser };
})();
