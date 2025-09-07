// auth.js
import { q } from './util.js';
import { showNotif } from './notif.js';
import { api } from './api.js';
import { saveToken, loadToken, clearToken } from './store.js';
import { showPage, setGuard } from './ui.js';

let isLogging = false;

function setBtnLoading(btn, on, labelBusy = 'Masuk…') {
  if (!btn) return;
  if (on) {
    // kunci lebar agar tidak “loncat”
    btn.dataset._prevHtml = btn.innerHTML;
    btn.style.width = btn.offsetWidth + 'px';
    btn.disabled = true;
    btn.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
      ${labelBusy}`;
  } else {
    btn.innerHTML = btn.dataset._prevHtml || 'Masuk';
    btn.style.width = '';
    btn.disabled = false;
  }
}

function toggleLoginForm(disabled){
  q('#loginUser')?.toggleAttribute('disabled', disabled);
  q('#loginPass')?.toggleAttribute('disabled', disabled);
  q('#rememberMe')?.toggleAttribute('disabled', disabled);
}

/* =========================
   Aturan halaman per role
   ========================= */
const ALLOWED_PAGES = {
  master:  ['dashboard','order','myorder','vehicles','approvals','driver','journal','settings','cashier'],
  admin:   ['dashboard','order', 'myorder','vehicles','approvals','driver','journal','settings','cashier'],
  user:    ['order', 'myorder','vehicles','settings'],
  driver:  ['driver'],
  cashier: ['cashier'] // <-- baru
};
const DEFAULT_PAGE = { master:'dashboard', admin:'dashboard', user:'order', driver:'driver', cashier:'cashier' };


export function defaultPageFor(role){
  if (role === 'driver')  return 'driver';
  if (role === 'cashier') return 'cashier'; // baru
  if (role === 'user')    return 'order';
  return 'dashboard';
}

/* =========================
   State auth
   ========================= */
export let auth = { user:null, token:null };

/* =========================
   Render user info di navbar
   ========================= */
function renderWho(){
  q('#whoAmI').textContent = auth.user ? `${auth.user.username} (${auth.user.role})` : '';
}

/* =========================
   Gate elemen DOM per role (OR semantics)
   ========================= */
export function gate(){
  const role = auth.user?.role || '';
  document.querySelectorAll('[class*="role-"]').forEach(el=>{
    const roles = el.className.split(/\s+/)
      .filter(c => c.startsWith('role-'))
      .map(c => c.replace('role-',''));
    if (roles.length) el.classList.toggle('d-none', !roles.includes(role));
  });
}

/* =========================
   Guard navigasi (dipasang ke ui.setGuard)
   ========================= */
function guardRoute(page){
  // Izinkan akses publik ke login & register
  if (!auth.user) {
    return (page === 'login' || page === 'register') ? page : 'login';
  }
  const role = auth.user.role;
  const allow = ALLOWED_PAGES[role] || [];
  if (!allow.includes(page)) return DEFAULT_PAGE[role] || 'login';
  return page;
}

function suggestUsernameFrom(fullname){
  const first = (fullname || '').trim().split(/\s+/)[0] || '';
  return first.toLowerCase().replace(/[^a-z0-9._]/g,'').slice(0,32);
}

/* =========================
   Auto-login (token)
   ========================= */
async function tryAuto(){
  const t = loadToken(); if (!t) return false;
  try{
    const data = await api.pingToken(t.token);
    auth = { user:data.user, token:t.token };
    renderWho(); gate();
    return true;
  }catch(e){
    clearToken(); return false;
  }
}

/* =========================
   Login / Logout
   ========================= */
async function onLogin(){
  if (isLogging) return;            // cegah double click / double enter
  isLogging = true;

  const u = q('#loginUser').value.trim();
  const p = q('#loginPass').value;
  const remember = q('#rememberMe').checked;
  const btnLogin = q('#btnLogin');

  try{
    setBtnLoading(btnLogin, true);
    toggleLoginForm(true);

    const data = await api.login(u,p,remember);
    auth = { user:data.user, token:data.token };
    saveToken({token:data.token});

    showNotif('success','Login berhasil');
    renderWho(); gate();
    document.body.classList.add('gated');
    showPage(defaultPageFor(auth.user.role));
  }catch(e){
    showNotif('error', e.message || 'Login gagal');
  }finally{
    setBtnLoading(btnLogin, false);
    toggleLoginForm(false);
    isLogging = false;
  }
}


function logout(){
  clearToken();
  auth = { user:null, token:null };
  showNotif('success','Logout');
  renderWho(); gate();
  document.body.classList.remove('gated');
  showPage('login');
}

/* =========================
   Init
   ========================= */
setGuard(guardRoute);

window.addEventListener('DOMContentLoaded', async ()=>{
  // 1) Tampilkan halaman login segera
  showPage('login');

  // 2) Pasang handler login + enter key
  const btnLogin = q('#btnLogin');
  const onEnterLogin  = (ev) => { if (ev.key === 'Enter') onLogin(); };
  btnLogin?.addEventListener('click', onLogin);
  q('#loginUser')?.addEventListener('keydown', onEnterLogin);
  q('#loginPass')?.addEventListener('keydown', onEnterLogin);

  // 2c) Auto-suggest username
  q('#reg-fullname')?.addEventListener('input', ()=>{
    const f = q('#reg-fullname').value;
    const uEl = q('#reg-username');
    if (uEl && !uEl.dataset.touched) {
      uEl.value = suggestUsernameFrom(f);
    }
  });
  q('#reg-username')?.addEventListener('input', (e)=>{
    e.currentTarget.dataset.touched = '1';
  });

  // 3) Logout
  q('#btnLogout')?.addEventListener('click', logout);

  // 4) Coba auto-login
  const ok = await tryAuto();
  if (ok) {
    document.body.classList.add('gated'); // ⬅ navbar boleh tampil
  } else {
    document.body.classList.remove('gated');
  }

  // 5) Arahkan
  showPage(ok ? defaultPageFor(auth.user.role) : 'login');
});