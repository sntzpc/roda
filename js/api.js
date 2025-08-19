// api.js
import { block } from './notif.js';

// <<< SET: URL Web App GAS kamu >>>
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw2WJlPWLIXxVLeBcWA0Jqfj0Zh8hP9i3DN9vsuCQau4KPlnT1uwFwBAS0OEeHZar--/exec';

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
  const token = getToken();
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
  const payload = {
    action: 'getOrders',
    token: getToken(),
    scope,
    sinceDays,
    page,
    pageSize
  };

  // 1) Coba POST biasa
  try{
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();

    // format router GAS: { ok, data }
    if (json && json.ok && json.data && Array.isArray(json.data.orders)) {
      return json.data.orders;
    }
    if (json && json.data && Array.isArray(json.data)) {
      return json.data; // fallback jika handler return array langsung
    }
    if (json && Array.isArray(json.orders)) {
      return json.orders;
    }
    throw new Error(json && json.error ? json.error : 'Format respons tidak dikenal');
  }catch(err){
    console.warn('[fetchMyOrders] POST gagal, mencoba JSONP fallback:', err);
  }

  // 2) Fallback JSONP: doGet?jsonp=1&action=getOrders&q=<websafe>
  const q = webSafeBase64(JSON.stringify(payload));
  const cb = 'cb'+Math.random().toString(36).slice(2);

  return new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    const url = `${GAS_URL.replace('/exec','/exec')}?jsonp=1&action=getOrders&cb=${cb}&q=${encodeURIComponent(q)}`;
    window[cb] = (resp)=>{
      try{
        delete window[cb];
        s.remove();
      }catch(e){}
      if (resp && resp.ok && resp.data && Array.isArray(resp.data.orders)) return resolve(resp.data.orders);
      if (resp && resp.ok && Array.isArray(resp.data)) return resolve(resp.data);
      if (resp && Array.isArray(resp.orders)) return resolve(resp.orders);
      return reject(new Error(resp && resp.error ? resp.error : 'Format JSONP tidak dikenal'));
    };
    s.onerror = ()=>{ try{ delete window[cb]; s.remove(); }catch(e){}; reject(new Error('JSONP gagal')); };
    s.src = url;
    document.head.appendChild(s);
  });

  // helper
  function webSafeBase64(str){
    const b = btoa(unescape(encodeURIComponent(str)));
    return b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
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
