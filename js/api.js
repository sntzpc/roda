// [ADD] Versi build (opsional untuk verifikasi di console)
const __API_BUILD = '2025-08-22a';
console.debug('[api.js] build', __API_BUILD);

// [ADD] Helper tersedia di scope modul + dipasang ke window (cadangan)
function isApproved_(v){
  if (v === true || v === 1) return true;
  const t = String(v ?? '').toUpperCase();
  return (t === 'TRUE' || t === '1' || t === 'YA');
}
try { window.isApproved_ = window.isApproved_ || isApproved_; } catch {}


// api.js
import { block } from './notif.js';

// [ADD] Pastikan global binding klasik untuk isApproved_ tersedia
function __ensureGlobal_isApproved() {
  try {
    if (typeof window !== 'undefined') {
      if (typeof window.isApproved_ !== 'function') {
        window.isApproved_ = function(v){
          if (v === true || v === 1) return true;
          var t = String(v == null ? '' : v).toUpperCase();
          return (t === 'TRUE' || t === '1' || t === 'YA');
        };
      }
      // Penting: buat *global variable binding* bernama `isApproved_`
      // JSONP dari GAS dieksekusi di global sloppy scope dan butuh identifier ini.
      if (typeof isApproved_ === 'undefined') {
        window.eval('var isApproved_ = window.isApproved_;');
      }
    }
  } catch (e) {
    // ignore; kalau eval diblokir, minimal window.isApproved_ sudah ada
  }
}
// jalankan sekali saat modul load
__ensureGlobal_isApproved();


// <<< SET: URL Web App GAS kamu >>>
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwChpAfIhi_E3LEQweK6GqBfcEEpZNSfm0LJYXrTwL0RbloA04LmUfOlYfY69HI-A/exec';

// Ambil token dari localStorage
function getToken() {
  try {
    const a = JSON.parse(localStorage.getItem('authToken') || 'null');
    if (a?.token) return a.token;
    // fallback kompatibilitas lama
    const b = JSON.parse(localStorage.getItem('roda_token') || 'null');
    return b?.token || '';
  } catch { return ''; }
}

// Deteksi apakah GAS_URL beda origin dengan halaman (hindari CORS)
function isCrossOrigin(url){
  try { return new URL(url, location.href).origin !== location.origin; }
  catch { return true; } // kalau gagal parse, anggap cross-origin
}

// --- JSONP fallback ---
function jsonpCall(action, payload = {}) {
  return new Promise((resolve, reject) => {
    __ensureGlobal_isApproved();
    const token  = getToken();
    const reqObj = { action, ...payload, token };

    const cbName = `__gas_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sep    = GAS_URL.includes('?') ? '&' : '?';
    const q      = Utilities_b64encode(JSON.stringify(reqObj));
    const url    = `${GAS_URL}${sep}jsonp=1&action=${encodeURIComponent(action)}&q=${encodeURIComponent(q)}&cb=${encodeURIComponent(cbName)}&_ts=${Date.now()}`;

    const script = document.createElement('script');
    let cleaned = false;

    function cleanup(){
      if (cleaned) return; cleaned = true;
      if (window[cbName]) delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, 15000);

    window[cbName] = (resp) => {
      clearTimeout(timer);
      cleanup();
      try {
        if (!resp || resp.ok !== true) {
          reject(new Error(resp?.error || 'GAS error (JSONP)'));
          return;
        }
        // Penting: JANGAN transformasi data di sisi client.
        // Biarkan server yang menyusun struktur data; teruskan apa adanya.
        resolve(resp.data);
      } catch (e) {
        reject(e);
      }
    };

    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('JSONP network error')); };
    script.src = url;
    document.head.appendChild(script);
  });
}

// Base64 web-safe untuk JSONP payload (tanpa dependency eksternal)
function Utilities_b64encode(str) {
  // web-safe base64
  const b64 = btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
  return b64;
}

// --- POST dengan fallback JSONP, no-block untuk 'ping' & 'login'
async function post(action, payload = {}) {
  const token = getToken();
  const body  = { action, ...payload, token };

    // Jika GAS_URL cross-origin, gunakan JSONP langsung (hindari CORS)
  if (isCrossOrigin(GAS_URL)) {
    if (action === 'ping' || action === 'login') {
      return jsonpCall(action, payload);           // tanpa overlay
    }
    return await block.wrap(() => jsonpCall(action, payload)); // dengan overlay
  }


  const runFetch = async () => {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari preflight
      body: JSON.stringify(body),
      mode: 'cors',
      credentials: 'omit'
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'GAS error');
    return j.data;
  };

  // ⬇️ TANPA overlay untuk ping & login
  if (action === 'ping' || action === 'login') {
    try { return await runFetch(); }
    catch { return await jsonpCall(action, payload); }
  }

  // Aksi lain → pakai overlay blocker
  return await block.wrap(async ()=>{
    try { return await runFetch(); }
    catch { return await jsonpCall(action, payload); }
  });
}

// ===== Fetch My Orders (30 hari terakhir) =====
// scope: 'mine' (User) atau 'all' (Admin/Master)
export async function fetchMyOrders({ sinceDays=30, scope='mine', page=1, pageSize=500 } = {}){
  const data = await post('getOrders', { sinceDays, scope, page, pageSize });
  // Normalisasi keluaran handler
  if (Array.isArray(data)) return data;                // handler return array langsung
  if (data && Array.isArray(data.orders)) return data.orders;  // handler return { orders: [...] }
  return []; // fallback aman
}

export const api = {
  // auth
  login: (username, password, remember) => post('login', { username, password, remember }),
  pingToken: (token)                     => post('ping',  { token }),

  // master data
  listVehicles: ()           => post('listVehicles', {}),
  upsertVehicle: (veh)       => post('upsertVehicle', { veh }),
  deleteVehicle: (id)        => post('deleteVehicle', { id }),
  listDrivers: ()            => post('listDrivers', {}),
  upsertDriver: (drv) => {
  const payload = (drv && typeof drv === 'object' && 'drv' in drv) ? drv.drv : drv;
  return post('upsertDriver', { drv: payload });
},
  deleteDriver: (id)         => post('deleteDriver', { id }),
  listUsers: ()              => post('listUsers', {}),
  upsertUser: (user) => {
  const payload = (user && typeof user === 'object' && 'user' in user) ? user.user : user;
  return post('upsertUser', { user: payload });
},
  deleteUser: (username)     => post('deleteUser', { username }),
  getConfig: ()              => post('getConfig', {}),
  setConfig: (cfg)           => post('setConfig', { cfg }),
  testTelegram: (chatId, text) => post('testTelegram', { chatId, text }),

  // orders & approvals
  createOrder: (order)                         => post('createOrder', { order }),
  listApprovals: ()                            => post('listApprovals', {}),
  listAllocGuests: (orderId)                   => post('listAllocGuests', { orderId }),
  allocGuest: (orderId, guestNo, vehicleId, driverId) => post('allocGuest', { orderId, guestNo, vehicleId, driverId }),
  approveGuest: (orderId, guestNo)             => post('approveGuest', { orderId, guestNo }),
  rejectOrder: (orderId, reason)               => post('rejectOrder', { orderId, reason }),
  deleteGuest: (orderId, guestNo, reason)      => post('deleteGuest', { orderId, guestNo, reason }),
  approveAll: (orderId)                        => post('approveAll', { orderId }),

  // driver
  myTasks: (driverUser) => {
  let val = driverUser;
  if (val && typeof val === 'object') {
    // toleransi bentuk salah: {driverUser:'...'} atau {username:'...'}
    val = val.driverUser || val.username || val.name || '';
  }
  return post('myTasks', { driverUser: String(val || '').trim() });
},
  myTasksAll: () => post('myTasksAll', {}),
  allDriverTasks: () => post('allDriverTasks', {}),

  depart:    (orderId, guestNo)                => post('depart', { orderId, guestNo }),
  arrive:    (orderId, guestNo)                => post('arrive', { orderId, guestNo }),
  skipGuest: (orderId, guestNo, note) => post('skipGuest', { orderId, guestNo, note }),

  // Tambah method baru
  register: (payload)  => post ('register', payload),


  // journal & dashboard
  journal:   (fromISO, toISO)                  => post('journal', { fromISO, toISO }),
  dashboard: ()                                => post('dashboard', {}),

  // debug (opsional)
  debugState: (params={})                      => post('debugState', params),

  // cashier
  listCashierTasks:   ()                       => post('listCashierTasks', {}),
  createTaskLetter:   (payload)                => post('createTaskLetter', payload),
  settleTaskLetter:   (payload)                => post('settleTaskLetter', payload),
  listCashierJournal: (payload)                => post('listCashierJournal', payload),
};

