'use strict';
(() => {
  const S = {
    boot: null,
    renderTok: 0,
    logF: null,
    editLog: null,
    projF: { q: '', birim: '', durum: '', silinen: false, bana: false },
    rapor: null
  };
  const $ = id => document.getElementById(id);

  // ---------- yardımcılar ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const nowStr = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const parseDT = s => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
  const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const weekStart = s => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const monthStart = s => s.slice(0, 8) + '01';
  const monthEnd = s => { const d = new Date(s.slice(0, 8) + '01T00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); };
  const diffMin = (a, b) => Math.max(0, Math.round((parseDT(b) - parseDT(a)) / 60000));
  const sure = l => diffMin(l.baslangic, l.bitis || nowStr());
  const fmtSure = m => { m = Math.round(m || 0); const h = Math.floor(m / 60), k = m % 60; return h ? (k ? `${h} sa ${k} dk` : `${h} sa`) : `${k} dk`; };
  const fmtSaat = m => ((m || 0) / 60).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const trDate = s => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
  const hm = s => (s ? s.slice(11, 16) : '');
  const gunAdi = s => new Date(s.slice(0, 10) + 'T00:00').toLocaleDateString('tr-TR', { weekday: 'short' });
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel == null ? '' : sel) ? ' selected' : ''}>${esc(label)}</option>`;
  const byKod = (a, b) => a.kod.localeCompare(b.kod);
  const trCmp = (a, b) => String(a).localeCompare(String(b), 'tr');
  const formData = f => Object.fromEntries(new FormData(f).entries());

  const isAdmin = () => !!(S.boot && S.boot.me.yonetici);
  const me = () => S.boot.me;
  const proje = id => S.boot.projeler.find(p => p.id === id);
  const birim = id => S.boot.birimler.find(b => b.id === id);
  const birimAd = id => (birim(id) || {}).ad || '—';
  const kisiAd = email => (S.boot.users.find(u => u.email === email) || {}).ad || email;
  function projeAd(id) {
    if (!id) return 'Günlük İş';
    const p = proje(id);
    if (!p) return '(bilinmeyen proje)';
    const u = p.ustProjeId && proje(p.ustProjeId);
    return (u ? u.ad + ' › ' : '') + p.ad;
  }
  const durumBadge = d => `<span class="badge ${d === 'Aktif' ? 'green' : d === 'Beklemede' ? 'amber' : 'gray'}">${esc(d)}</span>`;
  const turBadge = l => (l.projeId ? '<span class="badge blue">Geliştirme</span>' : '<span class="badge violet">Günlük İş</span>');

  function projeOptions(sel, includeId) {
    const list = S.boot.projeler.filter(p => !p.silindi || p.id === includeId);
    let html = opt('', 'Günlük İş (projesiz)', sel);
    list.filter(p => !p.ustProjeId || !list.some(x => x.id === p.ustProjeId)).sort(byKod).forEach(t => {
      html += opt(t.id, `${t.kod} · ${t.ad}`, sel);
      list.filter(c => c.ustProjeId === t.id).sort(byKod).forEach(c => { html += opt(c.id, `   ↳ ${c.kod} · ${c.ad}`, sel); });
    });
    return html;
  }
  function birimOptions(sel, placeholder = 'Birim seçin…') {
    const list = S.boot.birimler.filter(b => !b.silindi || b.id === sel).sort((a, b) => trCmp(a.ad, b.ad));
    return opt('', placeholder, sel) + list.map(b => opt(b.id, b.ad, sel)).join('');
  }
  // Proje seçilince birim projeye bağlı birimden dolar (değiştirilebilir); Günlük İş seçilince boşalır.
  function bindProjeBirim(form) {
    form.projeId.addEventListener('change', () => {
      const p = proje(form.projeId.value);
      form.birimId.value = p && birim(p.birimId) && !birim(p.birimId).silindi ? p.birimId : '';
    });
  }

  // ---------- bildirim, modal, hata ----------
  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('hide'), 3500);
    setTimeout(() => t.remove(), 4000);
  }
  function handleErr(err) {
    const msg = (err && err.message) || String(err);
    if (/^(OTURUM|YETKISIZ):/.test(msg)) { Api.logout(); showLogin(msg.replace(/^\w+:\s*/, '')); return; }
    toast(msg, 'error');
  }
  const act = fn => async function (e) {
    const btn = e && e.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
    if (btn) btn.disabled = true;
    try { await fn.call(this, e); } catch (err) { handleErr(err); } finally { if (btn) btn.disabled = false; }
  };
  async function q(action, payload) { return (await Api.call(action, payload)).data; }
  async function m(action, payload, okMsg) {
    const r = await Api.call(action, payload, true);
    if (r.boot) S.boot = r.boot;
    if (okMsg) toast(okMsg);
    return r.data;
  }

  function modal(title, body, onSubmit, submitLabel = 'Kaydet') {
    const wrap = document.createElement('div');
    wrap.className = 'modal-bg';
    wrap.innerHTML = `<form class="modal" novalidate>
      <header><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Kapat">✕</button></header>
      <div class="modal-body">${body}</div>
      <footer><button type="button" class="btn" data-close>Vazgeç</button>${onSubmit ? `<button class="btn primary" type="submit">${esc(submitLabel)}</button>` : ''}</footer>
    </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = () => wrap.remove();
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try { await onSubmit(formData(form), form); close(); } catch (err) { handleErr(err); } finally { btn.disabled = false; }
    });
    const first = form.querySelector('input:not([type=checkbox]):not([readonly]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { wrap, form, close };
  }

  function downloadCsv(name, header, rows) {
    const cell = v => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- simgeler ----------
  const ic = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    dash: ic('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
    log: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    proj: ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    rapor: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    birim: ic('<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M8 7h4M8 11h4M8 15h4M2 21h20"/>'),
    users: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
    api: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
  };

  // ---------- yönlendirme ----------
  const ROUTES = {
    '': { title: 'Dashboard', icon: 'dash', render: pageDashboard },
    log: { title: 'İş Logu', icon: 'log', render: pageLog },
    projeler: { title: 'Projeler', icon: 'proj', render: pageProjeler },
    raporlar: { title: 'Raporlar', icon: 'rapor', render: pageRaporlar },
    birimler: { title: 'Birimler', icon: 'birim', render: pageBirimler, admin: true },
    kullanicilar: { title: 'Kullanıcılar', icon: 'users', render: pageKullanicilar, admin: true },
    api: { title: 'API Ayarları', icon: 'api', render: pageApi, admin: true }
  };
  const currentRoute = () => location.hash.replace(/^#\/?/, '').split('?')[0];

  async function render() {
    if (!S.boot) return;
    const r = currentRoute();
    const def = ROUTES[r];
    if (!def || (def.admin && !isAdmin())) { if (r) { location.hash = '#/'; return; } }
    const page = def && (!def.admin || isAdmin()) ? def : ROUTES[''];
    const tok = ++S.renderTok;
    renderNav(r);
    renderTimerBar();
    $('pageTitle').textContent = page.title;
    document.title = page.title + ' · ERP Birimi İş Takip';
    $('shell').classList.remove('nav-open');
    if (!$('view').firstElementChild || $('view').dataset.route !== r) $('view').innerHTML = '<div class="loading">Yükleniyor…</div>';
    const v = document.createElement('div');
    v.className = 'page';
    try {
      await page.render(v);
      if (tok !== S.renderTok) return;
      $('view').replaceChildren(v);
      $('view').dataset.route = r;
    } catch (err) {
      if (tok !== S.renderTok) return;
      $('view').innerHTML = `<div class="card"><p class="error-text">${esc(err.message)}</p></div>`;
      handleErr(err);
    }
  }

  function renderNav(r) {
    const item = ([k, d]) => `<a href="#/${k}" class="${k === r ? 'active' : ''}">${ICON[d.icon]}<span>${esc(d.title)}</span></a>`;
    const entries = Object.entries(ROUTES);
    $('nav').innerHTML = entries.filter(([, d]) => !d.admin).map(item).join('') +
      (isAdmin() ? '<div class="nav-sep">Yönetim</div>' + entries.filter(([, d]) => d.admin).map(item).join('') : '');
  }

  function renderUserbox() {
    const u = me();
    $('userbox').innerHTML = `
      <div class="avatar">${esc((u.ad || u.email).trim().charAt(0).toLocaleUpperCase('tr'))}</div>
      <div class="ub-text"><b>${esc(u.ad)}</b><small>${esc(u.email)}</small>
        <span>${u.yonetici ? '<span class="badge on-dark">Yönetici</span>' : ''}${Api.mode() === 'demo' ? '<span class="badge on-dark amber">Demo</span>' : ''}</span></div>
      <button class="icon-btn on-dark" id="logoutBtn" title="Çıkış yap" aria-label="Çıkış yap">⏻</button>`;
    $('logoutBtn').onclick = () => { Api.logout(); showLogin(); };
  }

  function renderTimerBar() {
    const b = $('timerBar'), l = S.boot.aktifLog;
    if (!l) { b.innerHTML = '<a class="btn small" href="#/">▶ Çalışma başlat</a>'; return; }
    b.innerHTML = `<span class="pulse" aria-hidden="true"></span>
      <span class="tb-text"><b>${esc(projeAd(l.projeId))}</b><small>${esc(birimAd(l.birimId))} · ${hm(l.baslangic)}'den beri</small></span>
      <span class="tb-time" data-since="${esc(l.baslangic)}">${fmtSure(sure(l))}</span>
      <button class="btn small danger" id="tbStop">■ Bitir</button>`;
    $('tbStop').onclick = act(async () => { await m('timer.stop', {}, 'Çalışma bitirildi.'); render(); });
  }
  setInterval(() => document.querySelectorAll('[data-since]').forEach(e => { e.textContent = fmtSure(diffMin(e.dataset.since, nowStr())); }), 15000);

  // ---------- Dashboard ----------
  function myAssignments() {
    return S.boot.atamalar.filter(a => a.email === me().email)
      .map(a => ({ a, p: proje(a.projeId) }))
      .filter(x => x.p && !x.p.silindi)
      .sort((x, y) => x.a.oncelik - y.a.oncelik || byKod(x.p, y.p))
      .map(x => x.p);
  }

  async function pageDashboard(v) {
    const t = today(), ws = weekStart(t), ms = monthStart(t);
    const logs = await q('logs.list', { from: ws < ms ? ws : ms, to: t, personel: me().email });
    const sum = f => logs.filter(f).reduce((s, l) => s + sure(l), 0);
    const atanan = myAssignments();
    const aktif = S.boot.aktifLog;
    const kpi = (label, val, sub = '') => `<div class="kpi"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

    v.innerHTML = `
      <p class="greet">Merhaba <b>${esc(me().ad)}</b>, ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
      <div class="kpis">
        ${kpi('Bugün', fmtSure(sum(l => l.baslangic.slice(0, 10) === t)))}
        ${kpi('Bu hafta', fmtSure(sum(l => l.baslangic.slice(0, 10) >= ws)))}
        ${kpi('Bu ay', fmtSure(sum(l => l.baslangic.slice(0, 10) >= ms)))}
        ${kpi('Atanmış iş', atanan.length, 'proje / alt proje')}
      </div>
      <div class="cols">
        <section class="card grow">
          <div class="card-head"><h2>Bana atanan işler</h2><small class="muted">Öncelik sırasına göre · sürükleyerek veya oklarla sıralayın</small></div>
          ${atanan.length ? `<ol class="tasks" id="tasks">${atanan.map((p, i) => `
            <li class="task${aktif && aktif.projeId === p.id ? ' working' : ''}" draggable="true" data-id="${esc(p.id)}">
              <span class="grip" title="Sürükle">⋮⋮</span>
              <span class="rank">${i + 1}</span>
              <div class="task-main">
                <div class="task-title">${esc(projeAd(p.id))}</div>
                <div class="task-meta"><span class="code">${esc(p.kod)}</span> · ${esc(birimAd(p.birimId))} · ${durumBadge(p.durum)}${aktif && aktif.projeId === p.id ? ' <span class="badge live">Çalışılıyor</span>' : ''}</div>
              </div>
              <div class="task-actions">
                <button class="icon-btn" data-move="-1" title="Yukarı taşı" aria-label="Yukarı taşı">▲</button>
                <button class="icon-btn" data-move="1" title="Aşağı taşı" aria-label="Aşağı taşı">▼</button>
                <button class="btn small" data-start title="Bu işte çalışmaya başla">▶ Başlat</button>
              </div>
            </li>`).join('')}</ol>`
            : '<div class="empty">Size atanmış proje yok. <a href="#/projeler">Projeler</a> ekranından kendinize iş atayabilirsiniz.</div>'}
        </section>
        <section class="card side">
          <h2>Çalışma bildirimi</h2>
          ${aktif ? `<div class="active-box">
              <span class="pulse"></span>
              <div><b>${esc(projeAd(aktif.projeId))}</b><small>${esc(birimAd(aktif.birimId))} · ${hm(aktif.baslangic)}'den beri</small>${aktif.aciklama ? `<small>${esc(aktif.aciklama)}</small>` : ''}</div>
              <span class="tb-time" data-since="${esc(aktif.baslangic)}">${fmtSure(sure(aktif))}</span>
            </div>
            <form id="stopForm" class="stack">
              <label>Açıklama (isteğe bağlı)<input name="aciklama" value="${esc(aktif.aciklama)}" placeholder="Ne yapıldı?"></label>
              <button class="btn danger block">■ Çalışmayı bitir</button>
            </form>
            <hr><h3>Başka bir işe geç</h3>` : '<p class="muted small">İşe başladığınızda bildirin; bitirdiğinizde “Bitir” deyin. Ara verip başka işe geçerseniz önceki çalışma otomatik kapanır.</p>'}
          <form id="startForm" class="stack">
            <label>Proje / İş<select name="projeId">${projeOptions('')}</select></label>
            <label>Birim<select name="birimId" required>${birimOptions('')}</select></label>
            <label>Açıklama<input name="aciklama" placeholder="Ne üzerinde çalışıyorsunuz?"></label>
            <button class="btn primary block">${aktif ? '⇄ Bu işe geç' : '▶ Çalışmaya başla'}</button>
          </form>
          <p class="muted small">Sonradan kayıt eklemek için <a href="#/log">İş Logu</a> ekranını kullanın.</p>
        </section>
      </div>
      <section class="card">
        <div class="card-head"><h2>Son kayıtlarım</h2><a href="#/log" class="btn small">Tümü →</a></div>
        ${logTable(logs.slice(0, 8), { personel: false, actions: false })}
      </section>`;

    const sf = v.querySelector('#startForm');
    bindProjeBirim(sf);
    sf.addEventListener('submit', act(async e => {
      e.preventDefault();
      if (!sf.reportValidity()) return;
      await m('timer.start', formData(sf), aktif ? 'Yeni işe geçildi; önceki çalışma kapatıldı.' : 'Çalışma başladı.');
      render();
    }));
    const stf = v.querySelector('#stopForm');
    if (stf) stf.addEventListener('submit', act(async e => { e.preventDefault(); await m('timer.stop', formData(stf), 'Çalışma bitirildi.'); render(); }));

    const list = v.querySelector('#tasks');
    if (!list) return;
    const saveOrder = act(async () => {
      const ids = [...list.children].map(li => li.dataset.id);
      [...list.children].forEach((li, i) => { li.querySelector('.rank').textContent = i + 1; });
      await m('dashboard.reorder', { projeIds: ids });
    });
    list.addEventListener('click', act(async e => {
      const li = e.target.closest('li.task');
      if (!li) return;
      const mv = e.target.closest('[data-move]');
      if (mv) {
        const sib = mv.dataset.move === '-1' ? li.previousElementSibling : li.nextElementSibling;
        if (!sib) return;
        mv.dataset.move === '-1' ? list.insertBefore(li, sib) : list.insertBefore(sib, li);
        await saveOrder();
      } else if (e.target.closest('[data-start]')) {
        const p = proje(li.dataset.id);
        await m('timer.start', { projeId: p.id, birimId: p.birimId }, 'Çalışma başladı: ' + p.ad);
        render();
      }
    }));
    let dragged = null;
    list.addEventListener('dragstart', e => { dragged = e.target.closest('li.task'); if (dragged) { dragged.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; } });
    list.addEventListener('dragover', e => {
      e.preventDefault();
      const over = e.target.closest('li.task');
      if (!dragged || !over || over === dragged) return;
      const r = over.getBoundingClientRect();
      list.insertBefore(dragged, e.clientY > r.top + r.height / 2 ? over.nextElementSibling : over);
    });
    list.addEventListener('dragend', () => { if (dragged) { dragged.classList.remove('dragging'); dragged = null; saveOrder(); } });
  }

  // ---------- log tablosu (ortak) ----------
  function logTable(logs, { personel = true, actions = true } = {}) {
    if (!logs.length) return '<div class="empty">Bu aralıkta kayıt yok.</div>';
    const total = logs.reduce((s, l) => s + sure(l), 0);
    const canEdit = l => isAdmin() || l.personel === me().email;
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Tarih</th><th>Saat</th><th class="num">Süre</th>${personel ? '<th>Personel</th>' : ''}<th>Proje / İş</th><th>Birim</th><th>Açıklama</th>${actions ? '<th></th>' : ''}</tr></thead>
      <tbody>${logs.map(l => `<tr${l.aktif ? ' class="live-row"' : ''}>
        <td class="nowrap">${trDate(l.baslangic)} <small class="muted">${gunAdi(l.baslangic)}</small></td>
        <td class="nowrap">${hm(l.baslangic)} – ${l.aktif ? '<span class="badge live">devam ediyor</span>' : hm(l.bitis) + (l.bitis.slice(0, 10) !== l.baslangic.slice(0, 10) ? ' <small class="muted">(+1)</small>' : '')}</td>
        <td class="num nowrap">${l.aktif ? `<span data-since="${esc(l.baslangic)}">${fmtSure(sure(l))}</span>` : fmtSure(sure(l))}</td>
        ${personel ? `<td class="nowrap">${esc(kisiAd(l.personel))}</td>` : ''}
        <td>${turBadge(l)} ${l.projeId ? `<span class="code">${esc((proje(l.projeId) || {}).kod || '')}</span> ${esc(projeAd(l.projeId))}${(proje(l.projeId) || {}).silindi ? ' <span class="badge red">Silindi</span>' : ''}` : ''}</td>
        <td>${esc(birimAd(l.birimId))}</td>
        <td class="desc">${esc(l.aciklama)}</td>
        ${actions ? `<td class="row-actions">${canEdit(l) ? `<button class="btn small ghost" data-edit="${esc(l.id)}">Düzenle</button><button class="btn small ghost danger-text" data-del="${esc(l.id)}">Sil</button>` : ''}</td>` : ''}
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">${logs.length} kayıt</td><td class="num nowrap"><b>${fmtSure(total)}</b></td><td colspan="${(personel ? 4 : 3) + (actions ? 1 : 0)}"></td></tr></tfoot>
    </table></div>`;
  }

  // ---------- İş Logu ----------
  async function pageLog(v) {
    const t = today();
    if (!S.logF) S.logF = { from: weekStart(t), to: addDays(weekStart(t), 6), personel: isAdmin() ? '' : me().email };
    const logs = await q('logs.list', S.logF);
    const e = S.editLog;
    const f = e
      ? { personel: e.personel, projeId: e.projeId, birimId: e.birimId, tarih: e.baslangic.slice(0, 10), bas: hm(e.baslangic), bit: hm(e.bitis), aciklama: e.aciklama }
      : { personel: me().email, projeId: '', birimId: '', tarih: t, bas: '', bit: '', aciklama: '' };
    const users = S.boot.users.filter(u => u.aktif || u.email === f.personel).sort((a, b) => trCmp(a.ad, b.ad));
    const personelSel = isAdmin()
      ? users.map(u => opt(u.email, u.ad, f.personel)).join('')
      : opt(me().email, me().ad, me().email);

    v.innerHTML = `
      <section class="card${e ? ' editing' : ''}">
        <div class="card-head"><h2>${e ? 'Kaydı düzenle' : 'Yeni iş kaydı'}</h2>${e && e.aktif ? '<span class="badge live">Devam ediyor</span>' : ''}</div>
        <form id="logForm" class="form-grid">
          <label>Personel<select name="personel" ${isAdmin() ? '' : 'disabled title="Yalnızca kendi adınıza kayıt girebilirsiniz"'}>${personelSel}</select></label>
          <label class="span-2">Proje / İş<select name="projeId">${projeOptions(f.projeId, e && e.projeId)}</select></label>
          <label>Birim<select name="birimId" required>${birimOptions(f.birimId)}</select></label>
          <label>Tarih<input type="date" name="tarih" value="${f.tarih}" required></label>
          <label>Başlangıç<input type="time" name="bas" value="${f.bas}" required></label>
          <label>Bitiş<input type="time" name="bit" value="${f.bit}" ${e && e.aktif ? 'placeholder="devam ediyor"' : 'required'}></label>
          <label>Süre<output id="sureOut" class="output">—</output></label>
          <label class="full">Açıklama<textarea name="aciklama" rows="2" placeholder="Yapılan iş">${esc(f.aciklama)}</textarea></label>
          <div class="full form-actions">
            <button class="btn primary" type="submit">${e ? 'Güncelle' : 'Kaydet'}</button>
            ${e ? '<button type="button" class="btn" id="cancelEdit">Vazgeç</button>' : '<button type="button" class="btn" id="startNow" title="Seçili proje ve birimle canlı çalışma başlatır (kendi adınıza)">▶ Şimdi başlat (canlı)</button>'}
            <span class="hint">Bitiş saati başlangıçtan küçükse ertesi güne sarktığı kabul edilir. Aynı kişinin kayıtları çakışamaz.</span>
          </div>
        </form>
      </section>
      <section class="card">
        <div class="card-head"><h2>Kayıtlar</h2>
          <form id="logFilter" class="filters">
            <label>Başlangıç<input type="date" name="from" value="${S.logF.from}"></label>
            <label>Bitiş<input type="date" name="to" value="${S.logF.to}"></label>
            ${isAdmin() ? `<label>Personel<select name="personel">${opt('', 'Tüm personel', S.logF.personel)}${S.boot.users.slice().sort((a, b) => trCmp(a.ad, b.ad)).map(u => opt(u.email, u.ad, S.logF.personel)).join('')}</select></label>` : ''}
            <div class="seg">
              <button type="button" class="btn small" data-range="gun">Bugün</button>
              <button type="button" class="btn small" data-range="hafta">Bu hafta</button>
              <button type="button" class="btn small" data-range="ay">Bu ay</button>
            </div>
            <button class="btn" type="submit">Listele</button>
          </form>
        </div>
        ${logTable(logs, { personel: isAdmin() })}
      </section>`;

    const form = v.querySelector('#logForm');
    bindProjeBirim(form);
    const out = v.querySelector('#sureOut');
    const calc = () => {
      const { tarih, bas, bit } = formData(form);
      if (!tarih || !bas || !bit || bit === bas) { out.textContent = '—'; return; }
      const end = (bit < bas ? addDays(tarih, 1) : tarih) + 'T' + bit;
      out.textContent = fmtSure(diffMin(tarih + 'T' + bas, end)) + (bit < bas ? ' (ertesi gün)' : '');
    };
    ['tarih', 'bas', 'bit'].forEach(n => form[n].addEventListener('input', calc));
    calc();

    form.addEventListener('submit', act(async ev => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const fd = formData(form);
      if (fd.bit && fd.bit === fd.bas) throw new Error('Bitiş saati başlangıçla aynı olamaz.');
      const bitis = fd.bit ? `${fd.bit < fd.bas ? addDays(fd.tarih, 1) : fd.tarih}T${fd.bit}` : '';
      await m('logs.save', {
        id: e && e.id, personel: isAdmin() ? fd.personel : me().email, projeId: fd.projeId, birimId: fd.birimId,
        baslangic: `${fd.tarih}T${fd.bas}`, bitis, aciklama: fd.aciklama
      }, e ? 'Kayıt güncellendi.' : 'Kayıt eklendi.');
      S.editLog = null;
      render();
    }));
    const cancel = v.querySelector('#cancelEdit');
    if (cancel) cancel.onclick = () => { S.editLog = null; render(); };
    const startNow = v.querySelector('#startNow');
    if (startNow) startNow.onclick = act(async () => {
      if (!form.birimId.value) { form.birimId.reportValidity(); throw new Error('Canlı başlatmak için birim seçin.'); }
      const fd = formData(form);
      await m('timer.start', { projeId: fd.projeId, birimId: fd.birimId, aciklama: fd.aciklama }, 'Çalışma başladı.');
      render();
    });

    const filt = v.querySelector('#logFilter');
    filt.addEventListener('submit', ev => { ev.preventDefault(); S.logF = { ...S.logF, ...formData(filt) }; if (!isAdmin()) S.logF.personel = me().email; render(); });
    filt.querySelectorAll('[data-range]').forEach(b => b.onclick = () => {
      const r = b.dataset.range;
      const [from, to] = r === 'gun' ? [t, t] : r === 'hafta' ? [weekStart(t), addDays(weekStart(t), 6)] : [monthStart(t), monthEnd(t)];
      filt.from.value = from; filt.to.value = to;
      filt.requestSubmit();
    });

    v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      S.editLog = logs.find(l => l.id === b.dataset.edit);
      render().then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    });
    v.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => {
      if (!confirm('Bu kayıt silinsin mi?')) return;
      await m('logs.delete', { id: b.dataset.del }, 'Kayıt silindi.');
      if (S.editLog && S.editLog.id === b.dataset.del) S.editLog = null;
      render();
    }));
  }

  // ---------- Projeler ----------
  const canEditProje = p => isAdmin() || p.olusturan === me().email;

  function projeModal(p, defaults = {}) {
    const yeni = !p;
    p = p || { ad: '', ustProjeId: defaults.ustProjeId || '', birimId: defaults.birimId || '', durum: 'Aktif', aciklama: '' };
    const tops = S.boot.projeler.filter(x => !x.silindi && !x.ustProjeId && x.id !== p.id).sort(byKod);
    const hasChildren = !!p.id && S.boot.projeler.some(x => x.ustProjeId === p.id && !x.silindi);
    const body = `
      <div class="kod-line">${yeni ? '<span class="muted">Proje kodu kayıtta otomatik atanır (PRJ-000001, PRJ-000002 …)</span>' : `Proje kodu <b class="code">${esc(p.kod)}</b>`}</div>
      <label>Proje adı<input name="ad" required maxlength="200" value="${esc(p.ad)}"></label>
      <label>Üst proje<select name="ustProjeId" ${hasChildren ? 'disabled title="Alt projeleri olan bir proje başka projenin altına taşınamaz"' : ''}>${opt('', '— Yok (ana proje)', p.ustProjeId)}${tops.map(t => opt(t.id, `${t.kod} · ${t.ad}`, p.ustProjeId)).join('')}</select></label>
      <label>Ait Olduğu Birim<select name="birimId" required>${birimOptions(p.birimId)}</select></label>
      <label>Durum<select name="durum">${Logic.PROJE_DURUMLARI.map(d => opt(d, d, p.durum)).join('')}</select></label>
      <label>Açıklama<textarea name="aciklama" rows="3">${esc(p.aciklama)}</textarea></label>
      ${yeni ? '<label class="check"><input type="checkbox" name="kendimeAta" checked> Bu projeyi kendime ata</label>' : ''}`;
    const title = yeni ? (p.ustProjeId ? 'Yeni alt proje' : 'Yeni proje') : 'Projeyi düzenle';
    const md = modal(title, body, async fd => {
      await m('projects.save', {
        id: p.id, ad: fd.ad, ustProjeId: hasChildren ? '' : fd.ustProjeId, birimId: fd.birimId,
        durum: fd.durum, aciklama: fd.aciklama, kendimeAta: !!fd.kendimeAta
      }, yeni ? 'Proje oluşturuldu.' : 'Proje güncellendi.');
      render();
    });
    md.form.ustProjeId.addEventListener('change', () => {
      const ust = proje(md.form.ustProjeId.value);
      if (ust && !md.form.birimId.value) md.form.birimId.value = ust.birimId;
    });
  }

  function atamaModal(p) {
    const assigned = new Set(S.boot.atamalar.filter(a => a.projeId === p.id).map(a => a.email));
    const users = S.boot.users.filter(u => u.aktif).sort((a, b) => trCmp(a.ad, b.ad));
    modal('Proje ataması', `
      <p class="muted"><span class="code">${esc(p.kod)}</span> ${esc(projeAd(p.id))}</p>
      <div class="check-list">${users.map(u => `<label class="check"><input type="checkbox" name="u" value="${esc(u.email)}" ${assigned.has(u.email) ? 'checked' : ''}> <span>${esc(u.ad)} <small class="muted">${esc(u.email)}</small></span></label>`).join('')}</div>`,
    async (fd, form) => {
      const emails = [...form.querySelectorAll('input[name=u]:checked')].map(i => i.value);
      await m('projects.assign', { projeId: p.id, emails }, 'Atamalar güncellendi.');
      render();
    });
  }

  async function pageProjeler(v) {
    const F = S.projF;
    v.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Projeler</h2><button class="btn primary" id="newProj">+ Yeni proje</button></div>
        <form class="filters" id="projFilter" onsubmit="return false">
          <label class="grow">Ara<input name="q" type="search" value="${esc(F.q)}" placeholder="Kod, ad veya açıklama"></label>
          <label>Ait Olduğu Birim<select name="birim">${birimOptions(F.birim, 'Tüm birimler')}</select></label>
          <label>Durum<select name="durum">${opt('', 'Tümü', F.durum)}${Logic.PROJE_DURUMLARI.map(d => opt(d, d, F.durum)).join('')}</select></label>
          <label class="check"><input type="checkbox" name="bana" ${F.bana ? 'checked' : ''}> Bana atananlar</label>
          <label class="check"><input type="checkbox" name="silinen" ${F.silinen ? 'checked' : ''}> Silinenleri göster</label>
        </form>
        <div id="projTable"></div>
      </section>`;
    const filt = v.querySelector('#projFilter');
    const box = v.querySelector('#projTable');

    const draw = () => {
      const fd = formData(filt);
      Object.assign(F, { q: fd.q || '', birim: fd.birim || '', durum: fd.durum || '', bana: !!fd.bana, silinen: !!fd.silinen });
      const mine = new Set(S.boot.atamalar.filter(a => a.email === me().email).map(a => a.projeId));
      const qq = F.q.toLocaleLowerCase('tr');
      const match = p => (F.silinen || !p.silindi) && (!F.birim || p.birimId === F.birim) && (!F.durum || p.durum === F.durum) &&
        (!F.bana || mine.has(p.id)) && (!qq || `${p.kod} ${p.ad} ${p.aciklama}`.toLocaleLowerCase('tr').includes(qq));
      const all = S.boot.projeler;
      const rows = [];
      all.filter(p => !p.ustProjeId).sort(byKod).forEach(top => {
        const topOk = match(top);
        if (topOk) rows.push({ p: top, level: 0 });
        all.filter(c => c.ustProjeId === top.id).sort(byKod).forEach(c => { if (match(c)) rows.push({ p: c, level: topOk ? 1 : 0, orphan: !topOk }); });
      });
      if (!rows.length) { box.innerHTML = '<div class="empty">Kriterlere uyan proje yok.</div>'; return; }
      box.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Kod</th><th>Proje</th><th>Ait Olduğu Birim</th><th>Durum</th><th>Atananlar</th><th>Oluşturan</th><th></th></tr></thead>
        <tbody>${rows.map(({ p, level, orphan }) => {
          const atananlar = S.boot.atamalar.filter(a => a.projeId === p.id).map(a => a.email);
          const benim = atananlar.includes(me().email);
          const acts = p.silindi
            ? (isAdmin() ? `<button class="btn small ghost" data-restore="${p.id}">Geri al</button>` : '')
            : [
              !p.ustProjeId ? `<button class="btn small ghost" data-sub="${p.id}" title="Alt proje ekle">+ Alt proje</button>` : '',
              isAdmin() ? `<button class="btn small ghost" data-assign="${p.id}">Ata</button>`
                : `<button class="btn small ghost" data-self="${p.id}" data-on="${benim ? 0 : 1}">${benim ? 'Atamamı kaldır' : 'Bana ata'}</button>`,
              canEditProje(p) ? `<button class="btn small ghost" data-editp="${p.id}">Düzenle</button><button class="btn small ghost danger-text" data-delp="${p.id}">Sil</button>` : ''
            ].join('');
          return `<tr class="${p.silindi ? 'deleted' : ''} ${level ? 'child' : ''}">
            <td class="nowrap"><span class="code">${esc(p.kod)}</span></td>
            <td>${level ? '<span class="indent">↳</span>' : ''}${orphan && proje(p.ustProjeId) ? `<small class="muted">${esc(proje(p.ustProjeId).ad)} › </small>` : ''}<b>${esc(p.ad)}</b>${p.silindi ? ' <span class="badge red">Silindi</span>' : ''}${p.aciklama ? `<br><small class="muted">${esc(p.aciklama)}</small>` : ''}</td>
            <td>${esc(birimAd(p.birimId))}</td>
            <td>${durumBadge(p.durum)}</td>
            <td>${atananlar.length ? atananlar.map(e => `<span class="chip${e === me().email ? ' me' : ''}" title="${esc(e)}">${esc(kisiAd(e))}</span>`).join('') : '<small class="muted">—</small>'}</td>
            <td class="nowrap"><small>${esc(kisiAd(p.olusturan))}</small></td>
            <td class="row-actions">${acts}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    };
    draw();
    filt.addEventListener('input', draw);
    filt.addEventListener('change', draw);
    v.querySelector('#newProj').onclick = () => projeModal(null);

    box.addEventListener('click', act(async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.sub) { const top = proje(d.sub); projeModal(null, { ustProjeId: top.id, birimId: top.birimId }); }
      else if (d.editp) projeModal(proje(d.editp));
      else if (d.assign) atamaModal(proje(d.assign));
      else if (d.self) { await m('projects.assign', { projeId: d.self, email: me().email, atanmis: d.on === '1' }, d.on === '1' ? 'Proje size atandı.' : 'Atama kaldırıldı.'); draw(); }
      else if (d.delp) {
        const p = proje(d.delp);
        const alt = S.boot.projeler.filter(x => x.ustProjeId === p.id && !x.silindi).length;
        if (!confirm(`"${p.kod} ${p.ad}" silinsin mi?${alt ? `\n${alt} alt proje de silindi olarak işaretlenecek.` : ''}\nKayıtlar korunur, proje "Silindi" olarak işaretlenir.`)) return;
        await m('projects.delete', { id: p.id }, 'Proje silindi olarak işaretlendi.');
        draw();
      } else if (d.restore) { await m('projects.restore', { id: d.restore }, 'Proje geri alındı.'); draw(); }
    }));
  }

  // ---------- Raporlar ----------
  const PRESETS = {
    bugun: ['Bugün', t => [t, t]],
    buhafta: ['Bu hafta', t => [weekStart(t), addDays(weekStart(t), 6)]],
    gecenhafta: ['Geçen hafta', t => [addDays(weekStart(t), -7), addDays(weekStart(t), -1)]],
    buay: ['Bu ay', t => [monthStart(t), monthEnd(t)]],
    gecenay: ['Geçen ay', t => { const s = monthStart(addDays(monthStart(t), -1)); return [s, monthEnd(s)]; }],
    son30: ['Son 30 gün', t => [addDays(t, -29), t]],
    buceyrek: ['Bu çeyrek', t => { const mo = Math.floor((+t.slice(5, 7) - 1) / 3) * 3 + 1; const s = `${t.slice(0, 4)}-${pad(mo)}-01`; return [s, monthEnd(`${t.slice(0, 4)}-${pad(mo + 2)}-01`)]; }],
    buyil: ['Bu yıl', t => [t.slice(0, 4) + '-01-01', t.slice(0, 4) + '-12-31']],
    ozel: ['Özel aralık', null]
  };

  function groupBy(logs, keyFn) {
    const g = new Map();
    logs.forEach(l => {
      const k = keyFn(l);
      const r = g.get(k) || { key: k, gel: 0, gun: 0, top: 0, n: 0 };
      const s = sure(l);
      if (l.projeId) r.gel += s; else r.gun += s;
      r.top += s; r.n++;
      g.set(k, r);
    });
    return [...g.values()].sort((a, b) => b.top - a.top);
  }

  async function pageRaporlar(v) {
    const t = today();
    if (!S.rapor) { const [from, to] = PRESETS.buay[1](t); S.rapor = { preset: 'buay', from, to, personel: '', birim: '', tur: '', proje: '' }; }
    const R = S.rapor;
    const all = await q('logs.list', { from: R.from, to: R.to, personel: isAdmin() ? R.personel : me().email });
    const projSet = R.proje ? new Set([R.proje, ...S.boot.projeler.filter(p => p.ustProjeId === R.proje).map(p => p.id)]) : null;
    const logs = all.filter(l => (!R.birim || l.birimId === R.birim) && (!R.tur || l.tur === R.tur) && (!projSet || projSet.has(l.projeId)));
    const total = logs.reduce((s, l) => s + sure(l), 0);
    const gel = logs.filter(l => l.projeId).reduce((s, l) => s + sure(l), 0);
    const pct = x => (total ? Math.round((x / total) * 100) : 0);
    const gun = new Set(logs.map(l => l.baslangic.slice(0, 10))).size;

    const byBirim = groupBy(logs, l => l.birimId);
    const byProje = groupBy(logs, l => l.projeId);
    const byKisi = groupBy(logs, l => l.personel);

    const aggTable = (id, label, rows, nameFn, extraHead = '', extraCell = () => '') => `
      <section class="card">
        <div class="card-head"><h2>${label}</h2><button class="btn small" data-csv="${id}">⇩ Excel (CSV)</button></div>
        ${rows.length ? `<div class="table-wrap"><table class="table agg">
          <thead><tr><th>${label.replace(' bazında', '')}</th>${extraHead}<th class="num">Geliştirme</th><th class="num">Günlük İş</th><th class="num">Toplam (sa)</th><th class="num">Kayıt</th><th class="bar-col">Pay</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${nameFn(r.key)}</td>${extraCell(r.key)}<td class="num">${fmtSaat(r.gel)}</td><td class="num">${fmtSaat(r.gun)}</td><td class="num"><b>${fmtSaat(r.top)}</b></td><td class="num">${r.n}</td>
            <td class="bar-col"><div class="bar"><span class="b-gel" style="width:${total ? (r.gel / total) * 100 : 0}%"></span><span class="b-gun" style="width:${total ? (r.gun / total) * 100 : 0}%"></span></div><small>%${pct(r.top)}</small></td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">Kayıt yok.</div>'}
      </section>`;

    v.innerHTML = `
      <section class="card">
        <form id="rapForm" class="filters">
          <label>Dönem<select name="preset">${Object.entries(PRESETS).map(([k, [l]]) => opt(k, l, R.preset)).join('')}</select></label>
          <label>Başlangıç<input type="date" name="from" value="${R.from}"></label>
          <label>Bitiş<input type="date" name="to" value="${R.to}"></label>
          ${isAdmin() ? `<label>Personel<select name="personel">${opt('', 'Tüm personel', R.personel)}${S.boot.users.slice().sort((a, b) => trCmp(a.ad, b.ad)).map(u => opt(u.email, u.ad, R.personel)).join('')}</select></label>` : ''}
          <label>Birim<select name="birim">${birimOptions(R.birim, 'Tüm birimler')}</select></label>
          <label>Tür<select name="tur">${opt('', 'Tümü', R.tur)}${opt('Geliştirme', 'Geliştirme', R.tur)}${opt('Günlük İş', 'Günlük İş', R.tur)}</select></label>
          <label>Proje<select name="proje">${opt('', 'Tüm projeler', R.proje)}${S.boot.projeler.filter(p => !p.ustProjeId).sort(byKod).map(p => opt(p.id, `${p.kod} · ${p.ad}`, R.proje)).join('')}</select></label>
        </form>
        ${isAdmin() ? '' : '<p class="muted small">Raporlar sizin kayıtlarınızı kapsar. Tüm personelin raporunu yöneticiler görebilir.</p>'}
      </section>
      <div class="kpis">
        <div class="kpi"><span>Toplam süre</span><b>${fmtSaat(total)} sa</b><small>${trDate(R.from)} – ${trDate(R.to)}</small></div>
        <div class="kpi"><span>Geliştirme</span><b>${fmtSaat(gel)} sa</b><small>%${pct(gel)}</small></div>
        <div class="kpi"><span>Günlük İş</span><b>${fmtSaat(total - gel)} sa</b><small>%${pct(total - gel)}</small></div>
        <div class="kpi"><span>Kayıt / gün</span><b>${logs.length}</b><small>${gun} farklı gün · ${byBirim.length} birim</small></div>
      </div>
      <div class="legend"><span><i class="b-gel"></i>Geliştirme</span><span><i class="b-gun"></i>Günlük İş</span></div>
      ${aggTable('birim', 'Birim bazında', byBirim, k => esc(birimAd(k)))}
      ${aggTable('proje', 'Proje bazında', byProje, k => (k ? `<span class="code">${esc((proje(k) || {}).kod || '')}</span> ${esc(projeAd(k))}` : '<i>Günlük İşler (projesiz)</i>'), '<th>Ait Olduğu Birim</th>', k => `<td>${k ? esc(birimAd((proje(k) || {}).birimId)) : '—'}</td>`)}
      ${isAdmin() ? aggTable('kisi', 'Personel bazında', byKisi, k => esc(kisiAd(k))) : ''}
      <section class="card">
        <div class="card-head"><h2>Detay</h2><button class="btn small" data-csv="detay">⇩ Excel (CSV)</button></div>
        ${logTable(logs, { personel: true, actions: false })}
      </section>`;

    const form = v.querySelector('#rapForm');
    form.addEventListener('change', e => {
      const fd = formData(form);
      if (e.target.name === 'preset' && PRESETS[fd.preset][1]) [fd.from, fd.to] = PRESETS[fd.preset][1](t);
      else if (e.target.name === 'from' || e.target.name === 'to') fd.preset = 'ozel';
      if (fd.from > fd.to) { toast('Başlangıç tarihi bitişten sonra olamaz.', 'error'); return; }
      S.rapor = { ...R, ...fd };
      render();
    });

    const stamp = `${R.from}_${R.to}`;
    const csvAgg = (name, rows, nameFn) => downloadCsv(`rapor-${name}-${stamp}.csv`, [name === 'proje' ? 'Proje' : name === 'kisi' ? 'Personel' : 'Birim', 'Geliştirme (sa)', 'Günlük İş (sa)', 'Toplam (sa)', 'Kayıt', 'Pay %'],
      rows.map(r => [nameFn(r.key), fmtSaat(r.gel), fmtSaat(r.gun), fmtSaat(r.top), r.n, pct(r.top)]));
    v.querySelectorAll('[data-csv]').forEach(b => b.onclick = () => {
      const k = b.dataset.csv;
      if (k === 'birim') csvAgg('birim', byBirim, birimAd);
      if (k === 'proje') csvAgg('proje', byProje, id => (id ? `${(proje(id) || {}).kod || ''} ${projeAd(id)}` : 'Günlük İşler'));
      if (k === 'kisi') csvAgg('kisi', byKisi, kisiAd);
      if (k === 'detay') downloadCsv(`rapor-detay-${stamp}.csv`, ['Tarih', 'Başlangıç', 'Bitiş', 'Süre (dk)', 'Süre (sa)', 'Personel', 'Tür', 'Proje Kodu', 'Proje', 'Birim', 'Açıklama'],
        logs.map(l => [trDate(l.baslangic), hm(l.baslangic), l.aktif ? 'devam ediyor' : hm(l.bitis), sure(l), fmtSaat(sure(l)), kisiAd(l.personel), l.tur,
          l.projeId ? (proje(l.projeId) || {}).kod : '', l.projeId ? projeAd(l.projeId) : '', birimAd(l.birimId), l.aciklama]));
    });
  }

  // ---------- Birimler (yönetici) ----------
  async function pageBirimler(v) {
    const list = S.boot.birimler.slice().sort((a, b) => (a.silindi - b.silindi) || trCmp(a.ad, b.ad));
    const projeSay = id => S.boot.projeler.filter(p => p.birimId === id && !p.silindi).length;
    v.innerHTML = `<section class="card">
      <div class="card-head"><h2>Birimler</h2><button class="btn primary" id="newBirim">+ Yeni birim</button></div>
      <p class="muted small">Talep eden / hizmet verilen birimler. Projeler bir birime bağlanır; günlük işlerde birim her kayıtta ayrıca seçilir.</p>
      ${list.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Birim</th><th>Açıklama</th><th class="num">Aktif proje</th><th></th></tr></thead>
        <tbody>${list.map(b => `<tr class="${b.silindi ? 'deleted' : ''}"><td><b>${esc(b.ad)}</b>${b.silindi ? ' <span class="badge red">Silindi</span>' : ''}</td><td>${esc(b.aciklama)}</td><td class="num">${projeSay(b.id)}</td>
          <td class="row-actions">${b.silindi ? '' : `<button class="btn small ghost" data-edit="${b.id}">Düzenle</button><button class="btn small ghost danger-text" data-del="${b.id}">Sil</button>`}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">Henüz birim tanımlanmadı.</div>'}
    </section>`;
    const edit = b => modal(b ? 'Birimi düzenle' : 'Yeni birim', `
      <label>Birim adı<input name="ad" required maxlength="120" value="${esc(b ? b.ad : '')}"></label>
      <label>Açıklama<input name="aciklama" value="${esc(b ? b.aciklama : '')}"></label>`,
    async fd => { await m('birimler.save', { id: b && b.id, ...fd }, b ? 'Birim güncellendi.' : 'Birim eklendi.'); render(); });
    v.querySelector('#newBirim').onclick = () => edit(null);
    v.querySelectorAll('[data-edit]').forEach(x => x.onclick = () => edit(birim(x.dataset.edit)));
    v.querySelectorAll('[data-del]').forEach(x => x.onclick = act(async () => {
      const b = birim(x.dataset.del), n = projeSay(b.id);
      if (!confirm(`"${b.ad}" birimi silinsin mi?${n ? `\nBu birime bağlı ${n} aktif proje var; projeler etkilenmez.` : ''}\nGeçmiş kayıtlar korunur, birim yeni kayıtlarda seçilemez.`)) return;
      await m('birimler.delete', { id: b.id }, 'Birim silindi.');
      render();
    }));
  }

  // ---------- Kullanıcılar (yönetici) ----------
  async function pageKullanicilar(v) {
    const list = S.boot.users.slice().sort((a, b) => (b.aktif - a.aktif) || trCmp(a.ad, b.ad));
    v.innerHTML = `<section class="card">
      <div class="card-head"><h2>Kullanıcılar</h2><button class="btn primary" id="newUser">+ Kullanıcı ekle</button></div>
      <p class="muted small">Yalnızca bu listedeki aktif e-posta adresleri Google hesabıyla giriş yapabilir. “Yönetici” yetkisi; Birimler, Kullanıcılar ve API Ayarları ekranlarını, tüm personelin kayıtlarını ve Google E-Tablo veri sayfalarını açar.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Ad Soyad</th><th>E-posta</th><th>Yönetici</th><th>Durum</th><th></th></tr></thead>
        <tbody>${list.map(u => {
          const self = u.email === me().email;
          return `<tr class="${u.aktif ? '' : 'deleted'}"><td><b>${esc(u.ad)}</b>${self ? ' <small class="muted">(siz)</small>' : ''}</td><td>${esc(u.email)}</td>
          <td><label class="switch" title="${self ? 'Kendi yetkinizi değiştiremezsiniz' : 'Yönetici yetkisi'}"><input type="checkbox" data-admin="${u.id}" ${u.yonetici ? 'checked' : ''} ${self ? 'disabled' : ''}><span></span></label></td>
          <td>${u.aktif ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
          <td class="row-actions"><button class="btn small ghost" data-edit="${u.id}">Düzenle</button>${self ? '' : `<button class="btn small ghost ${u.aktif ? 'danger-text' : ''}" data-toggle="${u.id}">${u.aktif ? 'Pasifleştir' : 'Aktifleştir'}</button>`}</td></tr>`;
        }).join('')}</tbody>
      </table></div></section>`;
    const user = id => S.boot.users.find(u => u.id === id);
    const edit = u => {
      const self = u && u.email === me().email;
      modal(u ? 'Kullanıcıyı düzenle' : 'Kullanıcı ekle', `
        <label>E-posta (Google hesabı)<input type="email" name="email" required value="${esc(u ? u.email : '')}" ${self ? 'readonly' : ''}></label>
        <label>Ad Soyad<input name="ad" required value="${esc(u ? u.ad : '')}"></label>
        <label class="check"><input type="checkbox" name="yonetici" ${u && u.yonetici ? 'checked' : ''} ${self ? 'disabled' : ''}> Yönetici yetkisi</label>`,
      async fd => {
        await m('users.save', { id: u && u.id, email: fd.email, ad: fd.ad, yonetici: self ? true : !!fd.yonetici, aktif: u ? u.aktif : true }, u ? 'Kullanıcı güncellendi.' : 'Kullanıcı eklendi.');
        render();
      });
    };
    v.querySelector('#newUser').onclick = () => edit(null);
    v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(user(b.dataset.edit)));
    v.querySelectorAll('[data-admin]').forEach(c => c.onchange = act(async () => {
      const u = user(c.dataset.admin);
      try { await m('users.save', { ...u, yonetici: c.checked }, c.checked ? `${u.ad} artık yönetici.` : `${u.ad} için yönetici yetkisi kaldırıldı.`); }
      catch (err) { c.checked = !c.checked; throw err; }
    }));
    v.querySelectorAll('[data-toggle]').forEach(b => b.onclick = act(async () => {
      const u = user(b.dataset.toggle);
      if (u.aktif && !confirm(`${u.ad} pasifleştirilsin mi? Uygulamaya giriş yapamayacak; geçmiş kayıtları korunur.`)) return;
      await m('users.save', { ...u, aktif: !u.aktif }, u.aktif ? 'Kullanıcı pasifleştirildi.' : 'Kullanıcı aktifleştirildi.');
      render();
    }));
  }

  // ---------- API Ayarları (yönetici) ----------
  async function pageApi(v) {
    const c = Api.config();
    const demo = Api.mode() === 'demo';
    const info = await q('admin.info');
    v.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Sunucu bağlantısı</h2>${demo ? '<span class="badge amber">Demo modu</span>' : '<span class="badge green">Canlı (Google Sheets)</span>'}</div>
        <form id="apiForm" class="stack narrow">
          <label>Apps Script web uygulaması URL'si<input name="backendUrl" type="url" value="${esc(c.backendUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
          <label>Google OAuth istemci kimliği (Client ID)<input name="googleClientId" value="${esc(c.googleClientId)}" placeholder="…apps.googleusercontent.com"></label>
          <div class="form-actions">
            <button class="btn primary" type="submit">Bu tarayıcıda kaydet ve yeniden giriş yap</button>
            <button class="btn" type="button" id="pingBtn">Bağlantıyı test et</button>
            ${c.override ? '<button class="btn ghost" type="button" id="resetCfg">config.js varsayılanına dön</button>' : ''}
          </div>
          <p class="muted small">Buradaki değişiklik yalnızca bu tarayıcıyı etkiler. Herkes için kalıcı yapmak üzere aşağıdaki içeriği <code>js/config.js</code> dosyasına yazıp depoya gönderin.</p>
          <pre class="code-block" id="cfgSnippet"></pre>
        </form>
      </section>
      <section class="card">
        <h2>Veri sayfaları</h2>
        <div class="kpis small">
          <div class="kpi"><span>Aktif kullanıcı</span><b>${info.sayilar.kullanici}</b></div>
          <div class="kpi"><span>Birim</span><b>${info.sayilar.birim}</b></div>
          <div class="kpi"><span>Proje</span><b>${info.sayilar.proje}</b></div>
          <div class="kpi"><span>İş kaydı</span><b>${info.sayilar.log}</b></div>
        </div>
        ${info.tabloUrl ? `<p><a class="btn" href="${esc(info.tabloUrl)}" target="_blank" rel="noopener">Google E-Tabloyu aç: ${esc(info.tabloAdi)} ↗</a></p>
          <p class="muted small">E-tablo yalnızca sahibine ve yönetici yetkili kullanıcılara paylaşılır; yetki değiştikçe paylaşım otomatik güncellenir.</p>`
        : `<p class="muted small">Demo modunda veriler bu tarayıcının yerel deposunda tutulur.</p>
          <div class="form-actions"><button class="btn" id="dlDemo">Demo verisini indir (JSON)</button><button class="btn ghost danger-text" id="resetDemo">Demo verisini sıfırla</button></div>`}
      </section>`;

    const form = v.querySelector('#apiForm');
    const snippet = () => {
      const fd = formData(form);
      v.querySelector('#cfgSnippet').textContent = `window.APP_CONFIG = {\n  backendUrl: '${fd.backendUrl.trim()}',\n  googleClientId: '${fd.googleClientId.trim()}'\n};`;
    };
    form.addEventListener('input', snippet);
    snippet();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = formData(form);
      if (fd.backendUrl && !fd.googleClientId) { toast('Canlı mod için Client ID de gerekli.', 'error'); return; }
      Api.saveOverride({ backendUrl: fd.backendUrl.trim(), googleClientId: fd.googleClientId.trim() });
      location.reload();
    });
    v.querySelector('#pingBtn').onclick = act(async () => {
      const url = form.backendUrl.value.trim();
      if (!url) throw new Error('Önce URL girin.');
      const r = await Api.ping(url);
      toast(`Bağlantı başarılı · sunucu sürümü ${r.surum} · saat dilimi ${r.saatDilimi}`);
    });
    const rc = v.querySelector('#resetCfg');
    if (rc) rc.onclick = () => { Api.clearOverride(); location.reload(); };
    const dl = v.querySelector('#dlDemo');
    if (dl) dl.onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([Demo.exportJson()], { type: 'application/json' }));
      a.download = 'is-takip-demo.json';
      a.click();
    };
    const rd = v.querySelector('#resetDemo');
    if (rd) rd.onclick = () => { if (confirm('Demo verisi silinip örnek verilerle yeniden oluşturulsun mu?')) { Demo.reset(); Api.logout(); showLogin(); } };
  }

  // ---------- giriş ----------
  function showLogin(msg) {
    S.boot = null; S.logF = null; S.rapor = null; S.editLog = null;
    $('shell').classList.add('hidden');
    const lg = $('login');
    lg.classList.remove('hidden');
    const head = `<div class="login-brand"><span class="logo">${ICON.log}</span><div><h1>ERP Birimi İş Takip</h1><p>Birimlere ayrılan süreyi ve yapılan işleri takip edin.</p></div></div>
      ${msg ? `<div class="alert error">${esc(msg)}</div>` : ''}`;
    if (Api.mode() === 'demo') {
      lg.innerHTML = `<div class="login-card">${head}
        <div class="alert info"><b>Demo modu.</b> Sunucu adresi tanımlanmadığı için veriler bu tarayıcıda tutulur. Denemek için bir kullanıcı seçin.</div>
        <div class="demo-users">${Demo.users().map(u => `<button class="btn block demo-user" data-email="${esc(u.email)}"><span><b>${esc(u.ad)}</b><small>${esc(u.email)}</small></span>${Logic.bool(u.yonetici) ? '<span class="badge">Yönetici</span>' : ''}</button>`).join('')}</div>
      </div>`;
      lg.querySelectorAll('[data-email]').forEach(b => b.onclick = () => { Api.loginDemo(b.dataset.email); start(); });
      return;
    }
    lg.innerHTML = `<div class="login-card">${head}<p class="muted">Kurum Google hesabınızla giriş yapın. Erişim yalnızca yöneticinin tanımladığı e-posta adreslerine açıktır.</p><div id="gbtn" class="gbtn"></div></div>`;
    Api.loadGis().then(() => {
      google.accounts.id.initialize({
        client_id: Api.config().googleClientId,
        callback: r => { Api.loginGoogle(r.credential); start(); },
        auto_select: !msg,
        cancel_on_tap_outside: true
      });
      google.accounts.id.renderButton($('gbtn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'tr', width: 280 });
      if (!msg) google.accounts.id.prompt();
    }).catch(err => { $('gbtn').innerHTML = `<p class="error-text">${esc(err.message)}</p>`; });
  }

  async function start() {
    if (!Api.session && !Api.restore()) { showLogin(); return; }
    try {
      S.boot = (await Api.call('bootstrap')).data;
    } catch (err) {
      Api.logout();
      showLogin(err.message.replace(/^\w+:\s*/, ''));
      return;
    }
    $('login').classList.add('hidden');
    $('shell').classList.remove('hidden');
    renderUserbox();
    render();
  }

  window.addEventListener('hashchange', () => { S.editLog = null; render(); });
  $('menuBtn').onclick = () => $('shell').classList.toggle('nav-open');
  $('scrim').onclick = () => $('shell').classList.remove('nav-open');
  start();
})();
