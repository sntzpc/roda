// auth.js
import { q } from './util.js';
import { showNotif } from './notif.js';
import { api } from './api.js';
import { saveToken, loadToken, clearToken } from './store.js';
import { showPage, setGuard } from './ui.js';

/* =========================
   Aturan halaman per role
   ========================= */
const ALLOWED_PAGES = {
  master:  ['dashboard','order','vehicles','approvals','driver','journal','settings','cashier'],
  admin:   ['dashboard','order','vehicles','approvals','driver','journal','settings','cashier'],
  user:    ['order','vehicles','settings'],
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
  // Belum login → paksa ke login
  if (!auth.user) return 'login';

  const role = auth.user.role;
  const allow = ALLOWED_PAGES[role] || [];
  if (!allow.includes(page)) return DEFAULT_PAGE[role] || 'login';
  return page;
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
  const u = q('#loginUser').value.trim();
  const p = q('#loginPass').value;
  const remember = q('#rememberMe').checked;

  try{
    const data = await api.login(u,p,remember);
    auth = { user:data.user, token:data.token };
    saveToken({token:data.token});

    showNotif('success','Login berhasil');
    renderWho(); gate();
    showPage(defaultPageFor(auth.user.role));
  }catch(e){
    showNotif('error', e.message || 'Login gagal');
  }
}

function logout(){
  clearToken();
  auth = { user:null, token:null };
  showNotif('success','Logout');
  renderWho(); gate();
  showPage('login');
}

/* =========================
   Init
   ========================= */
window.addEventListener('DOMContentLoaded', async ()=>{
  // Pasang guard global dulu
  setGuard(guardRoute);

  // 1) Tampilkan halaman login SEGERA agar section lain tetap tersembunyi
  showPage('login');

  // 2) Pasang handler tombol + enter key
  const btnLogin = q('#btnLogin');
  const onEnter  = (ev) => { if (ev.key === 'Enter') onLogin(); };
  btnLogin?.addEventListener('click', onLogin);
  q('#loginUser')?.addEventListener('keydown', onEnter);
  q('#loginPass')?.addEventListener('keydown', onEnter);

  // 3) Logout
  q('#btnLogout')?.addEventListener('click', logout);

  // 4) Coba auto-login TANPA mengunci UI
  const ok = await tryAuto();

  // 5) Arahkan sesuai hasil auto-login
  showPage(ok ? defaultPageFor(auth.user.role) : 'login');
});