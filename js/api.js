// Sunucu (Apps Script) ya da demo deposu ile konuşan katman + oturum yönetimi.
const Api = (() => {
  const LS_CFG = 'isTakip.config', SS_SESSION = 'isTakip.session';
  let session = null; // { mode: 'demo'|'live', email, token?, exp?, name? }

  function override() {
    try { return JSON.parse(localStorage.getItem(LS_CFG) || 'null'); } catch (e) { return null; }
  }
  function config() {
    const base = window.APP_CONFIG || {}, o = override();
    const pick = k => String((o && o[k] !== undefined ? o[k] : base[k]) || '').trim();
    return { backendUrl: pick('backendUrl'), googleClientId: pick('googleClientId'), override: !!o, base };
  }
  const mode = () => (config().backendUrl ? 'live' : 'demo');

  function saveOverride(c) { localStorage.setItem(LS_CFG, JSON.stringify(c)); logout(); }
  function clearOverride() { localStorage.removeItem(LS_CFG); logout(); }

  function setSession(s) {
    session = s;
    try { sessionStorage.setItem(SS_SESSION, JSON.stringify(s)); } catch (e) { /* yok say */ }
  }
  function restore() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null');
      if (s && s.mode === mode() && (!s.exp || s.exp * 1000 > Date.now() + 60000)) session = s;
    } catch (e) { /* yok say */ }
    return session;
  }
  function logout() {
    session = null;
    try { sessionStorage.removeItem(SS_SESSION); } catch (e) { /* yok say */ }
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  }

  function decodeJwt(t) {
    const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const loginDemo = email => setSession({ mode: 'demo', email });
  function loginGoogle(credential) {
    const p = decodeJwt(credential);
    setSession({ mode: 'live', email: p.email, name: p.name, token: credential, exp: p.exp });
  }

  async function post(url, body) {
    let res;
    try {
      // text/plain: Apps Script CORS ön kontrolünü (preflight) desteklemediği için
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
    } catch (e) {
      throw new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı ve API adresini kontrol edin.');
    }
    if (!res.ok) throw new Error('Sunucu hatası (' + res.status + ').');
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Sunucudan geçersiz yanıt alındı. Web uygulaması erişimi "Herkes" olarak dağıtıldı mı?'); }
    if (!j.ok) throw new Error(j.error || 'Bilinmeyen hata');
    return j;
  }

  // Yanıt: { data, boot? } — boot=true ise işlemden sonra güncel temel veriler de döner.
  async function call(action, payload, boot) {
    if (!session) throw new Error('OTURUM: Lütfen giriş yapın.');
    if (session.mode === 'demo') {
      await new Promise(r => setTimeout(r, 50));
      return Demo.call(session.email, action, payload, boot);
    }
    if (session.exp && session.exp * 1000 < Date.now()) throw new Error('OTURUM: Oturum süresi doldu, lütfen tekrar giriş yapın.');
    return post(config().backendUrl, { action, payload: payload || {}, token: session.token, boot: !!boot });
  }

  const ping = async url => (await post(url || config().backendUrl, { action: 'ping' })).data;

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Google giriş servisi yüklenemedi.'));
      document.head.appendChild(s);
    });
  }

  return {
    config, mode, saveOverride, clearOverride, restore, logout, loginDemo, loginGoogle, call, ping, loadGis,
    get session() { return session; }
  };
})();
