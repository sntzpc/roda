// js/debug.js — pusat debug tunggal
const KEY = 'roda_debug';

export const isDbg = () => localStorage.getItem(KEY) === 'true';
export const setDbg = (v) => {
  localStorage.setItem(KEY, v ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('debug-change', { detail: { enabled: v } }));
};
export const toggleDbg = () => { const v = !isDbg(); setDbg(v); return v; };
export const dlog = (...args) => { if (isDbg()) console.log(...args); };
export const prefixed = (prefix) => (...args) => dlog(prefix, ...args);

// Hotkey Ctrl+Shift+D (pasang sekali)
if (!window.__DBG_BOUND__) {
  window.__DBG_BOUND__ = true;
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      const on = toggleDbg();
      console.info(`[DEBUG] ${on ? 'ON' : 'OFF'}`);
    }
  }, { passive:true });
}

// Global fallback (kalau ada modul yang mau akses via window)
window.__DBG__ = { isDbg, dlog, prefixed, toggleDbg, setDbg };
