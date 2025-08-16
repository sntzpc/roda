// api.js
import { block } from './notif.js';

// <<< SET: URL Web App GAS kamu >>>
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzLd7HMg9JIq2W2XECap5EugR84VIv9_tNQUoRwpsER_fEBveLE3hn65K--JtbFaxA/exec';

// Ambil token dari localStorage
function getToken() {
  try {
    return (JSON.parse(localStorage.getItem('roda_token') || '{}').token) || '';
  } catch { return ''; }
}

// --- JSONP fallback ---
function jsonpCall(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const reqObj = { action, ...payload, token };
    const b64 = Utilities_b64encode(JSON.stringify(reqObj));

    const cbName = `__gas_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const url = `${GAS_URL}?jsonp=1&action=${encodeURIComponent(action)}&q=${encodeURIComponent(b64)}&cb=${encodeURIComponent(cbName)}`;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, 15000);

    function cleanup() {
      clearTimeout(timer);
      if (window[cbName]) delete window[cbName];
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (resp) => {
      cleanup();
      if (!resp || resp.ok !== true) {
        reject(new Error(resp?.error || 'GAS error (JSONP)'));
      } else {
        resolve(resp.data);
      }
    };

    script.src = url;
    script.onerror = () => { cleanup(); reject(new Error('JSONP network error')); };
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
  const token = (JSON.parse(localStorage.getItem('roda_token') || '{}').token) || '';
  const body  = { action, ...payload, token };

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

  // ping & login: JANGAN buka blocker
  if (action === 'ping' || action === 'login') {
    try { return await runFetch(); }
    catch { return await jsonpCall(action, payload); }
  }

  // aksi lain: blocker ON, dan ada fallback JSONP bila fetch gagal
  return await block.wrap(async ()=>{
    try { return await runFetch(); }
    catch { return await jsonpCall(action, payload); }
  });
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

  depart:    (orderId, guestNo)                => post('depart', { orderId, guestNo }),
  arrive:    (orderId, guestNo)                => post('arrive', { orderId, guestNo }),
  skipGuest: (orderId, guestNo, note) => post('skipGuest', { orderId, guestNo, note }),


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
