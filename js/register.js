// js/register.js
import { api } from './api.js';
import { showPage } from './ui.js';
import { showNotif } from './notif.js';
import { saveToken } from './store.js';
import { defaultPageFor, auth, gate } from './auth.js';

function slugifyUsername(s){
  return (s||'')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '') // a-z0-9 . _ -
    .replace(/_{2,}/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0,32);
}

function wireRegisterOnce(){
  const f        = document.getElementById('frm-register');
  const inpFull  = document.getElementById('reg-fullname');
  const inpUser  = document.getElementById('reg-username');
  const inpPass  = document.getElementById('reg-password');
  const inpTele  = document.getElementById('reg-tele');
  const btnSubm  = document.getElementById('btn-reg-submit');

  if (!f || f.dataset.wired) return;
  f.dataset.wired = '1';

  // default password bila kosong
  if (inpPass && !inpPass.value) inpPass.value = 'user123';

  // autosuggest username dari nama depan
  if (inpFull && inpUser){
    let touchedUser = false;
    inpUser.addEventListener('input', ()=>{
      touchedUser = true;
      inpUser.value = slugifyUsername(inpUser.value);
    });
    inpFull.addEventListener('input', ()=>{
      if (touchedUser) return;
      const first = String(inpFull.value||'').trim().split(/\s+/)[0] || '';
      inpUser.value = slugifyUsername(first);
    });
  }

  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fullname = (inpFull?.value||'').trim();
    const username = slugifyUsername(inpUser?.value||'');
    const password = (inpPass?.value||'').trim();
    const tgId     = (inpTele?.value||'').replace(/[^\d\-]/g,'').trim();

    if(!fullname){ showNotif('error','Nama lengkap wajib diisi.'); return; }
    if(!username){ showNotif('error','Username wajib diisi.'); return; }
    if((password||'').length < 6){ showNotif('error','Password minimal 6 karakter.'); return; }

    btnSubm?.setAttribute('disabled','disabled');
    const old = btnSubm?.innerHTML;
    if (btnSubm) btnSubm.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Mendaftar…';

    try{
      // panggil backend register (public)
      await api.register({ username, password, fullname, tgId });

      // auto-login (biar langsung pakai)
      const data = await api.login(username, password, true);
      saveToken({ token: data.token });

      // sinkronkan state auth & UI role-based
      auth.user  = data.user;
      auth.token = data.token;
      gate();                         // tampilkan nav-item sesuai role user

      // info welcome
      showNotif('success','Pendaftaran berhasil. Selamat datang!');
      // arahkan ke halaman default sesuai role baru
      document.body.classList.add('gated');   // munculkan navbar
      showPage(defaultPageFor(data.user.role));
    }catch(err){
      showNotif('error', err?.message || 'Pendaftaran gagal.');
    }finally{
      btnSubm?.removeAttribute('disabled');
      if (btnSubm && old) btnSubm.innerHTML = old;
    }
  });
}

// Inisialisasi hanya saat route=register
window.addEventListener('route', (e)=>{
  if (e?.detail?.page === 'register') {
    // Pastikan form sudah ada di DOM, lalu wire
    wireRegisterOnce();
  }
});
