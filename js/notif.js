// notif.js
import { q } from './util.js';

/* ==== Notifikasi ringan di #notifBar ==== */
export function showNotif(type, msg, timeout = 2200){
  const bar = q('#notifBar'); if (!bar) return;
  const cls = type === 'error' ? 'alert-danger'
            : type === 'warn'  ? 'alert-warning'
            : 'alert-success';
  const el = document.createElement('div');
  el.className = `alert ${cls} shadow-sm py-2 px-3 mb-2`;
  el.textContent = msg;
  bar.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

/* ==== Global blocker (overlay) + guard per tombol ==== */
export const block = {
  _lock: 0,

  on(){
    this._lock++;
    q('#blocker')?.classList.remove('d-none');
    document.body.classList.add('busy');
  },

  off(){
    this._lock = Math.max(0, this._lock - 1);
    if (this._lock > 0) return;
    q('#blocker')?.classList.add('d-none');
    document.body.classList.remove('busy');
  },

  async wrap(run){
    this.on();
    try { return await (typeof run === 'function' ? run() : run); }
    finally { this.off(); }
  },

  // Anti double-click untuk tombol tertentu saja (opt-in)
  bindClick(btn, handler){
    if (!btn || btn._guardBound) return;
    btn._guardBound = true;
    btn.addEventListener('click', async (e)=>{
      if (btn.dataset._busy === '1') return;
      btn.dataset._busy = '1';
      const prev = btn.disabled;
      btn.disabled = true;
      try{ await handler(e); }
      finally{
        btn.dataset._busy = '';
        btn.disabled = prev;
      }
    });
  }
};
