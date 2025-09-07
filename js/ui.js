// ui.js
import { q, qa } from './util.js';

/* =========================
   Guard hook (dipasang dari auth.js)
   ========================= */
let guardFn = (page) => (page === 'login' || page === 'register') ? page : 'login';

export function setGuard(fn){
  guardFn = typeof fn === 'function' ? fn : (p)=> (p === 'login' || p === 'register') ? p : 'login';}

/* =========================
   Navigasi halaman
   ========================= */
export function showPage(page){
  // Filter halaman via guard (role-based)
  page = guardFn(page) || page;

  // 1) aktifkan nav-link sesuai page
  document.querySelectorAll('[data-route]').forEach(a=>{
    a.classList.toggle('active', a.dataset.route === page);
  });

  // 2) tampil/sembunyikan section
  document.querySelectorAll('section[data-page]').forEach(sec=>{
    sec.classList.toggle('d-none', sec.dataset.page !== page);
  });

  // 3) broadcast event "route" utk lazy loaders (vehicles, settings, myorder, dll)
  window.dispatchEvent(new CustomEvent('route', { detail:{ page } }));
}

/* =========================
   Navbar: klik & auto-close hamburger
   ========================= */
window.addEventListener('DOMContentLoaded', ()=>{
  document.addEventListener('click', (ev)=>{
    const a = ev.target.closest('[data-route]');
    if(!a) return;
    ev.preventDefault();
    const page = a.dataset.route;
    showPage(page);

    // Tutup hamburger (collapse) bila link berasal dari dalam navbar
    const nav = q('#navMain');
    if (nav?.classList.contains('show')) {
      const bs = (window.bootstrap && (bootstrap.Collapse.getInstance(nav) || new bootstrap.Collapse(nav, {toggle:false})));
      bs?.hide();
    }
  });
});

/* =========================
   DateTime modal picker (dipakai di Order)
   ========================= */
let dtState = { cb:null };
const mdlDt = (window.bootstrap ? new bootstrap.Modal('#mdlDateTime') : null);

export function pickDateTime(targetInputSelector, cb){
  dtState = { cb };
  // default: sekarang + 30 menit
  const now = new Date(); now.setMinutes(now.getMinutes()+30);
  q('#dtDate').value = now.toISOString().slice(0,10);
  q('#dtTime').value = now.toISOString().slice(11,16);
  mdlDt?.show();
}

q('#btnDtOk')?.addEventListener('click', ()=>{
  const d = q('#dtDate').value;
  const t = q('#dtTime').value;
  if (!d || !t) return;
  const iso = `${d}T${t}:00`;
  dtState.cb?.(iso);
  mdlDt?.hide();
});
