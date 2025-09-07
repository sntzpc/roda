/*******************************
 * ========== KONFIG ===========
 *******************************/
const SECRET = 'x7#9F!pL2*KqZ$8nW5vR@dY3sG6%hJ4&'; // ganti di produksi
const SHEETS = {
  USERS:'Users', VEH:'Vehicles', DRV:'Drivers',
  TL:'TaskLetters', CASH:'CashOps',
  ORD:'Orders', OGU:'OrderGuests',
  CFG:'Config', LOG:'AuditLog'
};

// === DEBUG / CCTV: snapshot+diagnostic end-to-end ===
function debugState(req){
  var orderId    = (req && req.orderId)    || '';
  var driverUser = (req && req.driverUser) || '';
  var out = {
    order: null,
    guests: [],
    guestsDiag: [],       // ← tabel diagnosis per tamu (alokasi/approved/alasan)
    drivers: [],
    driversIndex: [],     // ← id, name, userId, wa ringkas
    vehicles: [],
    myTasks: [],          // ← hasil seperti myTasks()
    mapping: {},          // ← cara pemetaan driverUser -> driver
    warnings: []          // ← catatan
  };

  function asTrue(x){ return x===true || x==='TRUE' || x==='true' || x===1 || x==='1'; }
  function norm(s){ return (s||'').toString().trim().toLowerCase(); }
  function normalizePhone(s){
    s = (s||'').toString().trim().replace(/[^\d]/g,'');
    if (s.indexOf('0') === 0) s = '62' + s.slice(1);
    return s;
  }

  var U = rows_(SH(SHEETS.USERS));
  var D = rows_(SH(SHEETS.DRV));
  var V = rows_(SH(SHEETS.VEH));
  var O = rows_(SH(SHEETS.ORD));
  var G = rows_(SH(SHEETS.OGU));

  // ---- fokus per order (kalau diminta) ----
  if (orderId) {
    out.order  = O.find(function(o){ return o.id===orderId; }) || null;
    var ogu    = G.filter(function(g){ return g.orderId===orderId; });
    out.guests = ogu;

    // index entitas terkait
    var vehIds = Array.from(new Set(ogu.map(function(g){ return g.vehicleId; }).filter(Boolean)));
    var drvIds = Array.from(new Set(ogu.map(function(g){ return g.driverId;  }).filter(Boolean)));
    out.vehicles = V.filter(function(v){ return vehIds.indexOf(v.id) >= 0; });
    out.drivers  = D.filter(function(d){ return drvIds.indexOf(d.id) >= 0; });

    // diagnosis per tamu
    out.guestsDiag = ogu.map(function(g){
      var drv = D.find(function(d){ return d.id===g.driverId; }) || {};
      var approved = asTrue(g.approved);
      var reasons = [];
      if (!g.driverId) reasons.push('NO_DRIVER_ID');
      if (!approved)   reasons.push('NOT_APPROVED');
      return {
        guestNo: +g.guestNo,
        nama: g.nama || '',
        driverId: g.driverId || '',
        driverName: drv.name || '',
        vehicleId: g.vehicleId || '',
        approvedRaw: g.approved,
        approved: approved,
        okForTask: (!!g.driverId && approved),
        reasons: reasons.join('|') || '-'
      };
    });
  }

  // ---- mapping driverUser -> driver (algoritma myTasks) ----
  if (driverUser) {
    var foundBy = '';
    var drv = D.find(function(d){ return (d.userId||'') === driverUser; });
    if (drv){ foundBy='userId'; }
    if (!drv){
      drv = D.find(function(d){ return norm(d.name) === norm(driverUser); });
      if (drv) foundBy='name';
    }
    if (!drv){
      drv = D.find(function(d){ return normalizePhone(d.wa) === normalizePhone(driverUser); });
      if (drv) foundBy='wa';
    }

    out.mapping = {
      inputUser: driverUser,
      matchedDrv: drv || null,
      foundBy: foundBy || null
    };

    // pratinjau myTasks: ambil hanya approved TRUE (toleran boolean/string)
    var ogRows  = G.filter(function(x){ return x.driverId && (x.driverId === (drv && drv.id)) && asTrue(x.approved); });
    var ordMap  = O.reduce(function(a,o){ a[o.id]=o; return a; }, {});
    out.myTasks = ogRows.map(function(x){
      var o = ordMap[x.orderId] || {};
      return {
        orderId:x.orderId, guestNo:+x.guestNo, nama:x.nama,
        asal:o.asal, tujuan:o.tujuan, berangkatISO:o.berangkatISO,
        departAt:x.departAt||'', arriveAt:x.arriveAt||'',
        vehicleId: x.vehicleId || '', driverId: x.driverId || ''
      };
    });
  }

  // ringkas indeks driver (selalu ada agar mudah dibaca)
  out.driversIndex = D.map(function(d){
    return { id:d.id, name:d.name||'', userId:d.userId||'', wa:d.wa||'', status:d.status||'' };
  });

  // catatan umum
  if (driverUser && (!out.mapping.matchedDrv)) {
    out.warnings.push('Driver tidak ketemu dari userId/nama/WA. Pastikan Drivers.userId = username.');
  }
  if (orderId && out.guestsDiag.length && out.guestsDiag.every(function(x){ return !x.okForTask; })) {
    out.warnings.push('Semua tamu di order ini belum memenuhi syarat tugas (driverId/approved).');
  }

    // ====== CCTV untuk halaman Kasir ======
  if (req && String(req.cashier||'') === '1') {
    var og  = rows_(SH(SHEETS.OGU));
    var ord = rows_(SH(SHEETS.ORD));
    var drv = rows_(SH(SHEETS.DRV));
    var veh = rows_(SH(SHEETS.VEH));
    var tl  = rows_(SH(SHEETS.TL));

    var approved = og.filter(function(r){ return r.approved === 'TRUE' && r.driverId; });
    var groups = {};
    approved.forEach(function(r){
      var key = r.orderId + '__' + r.driverId;
      if (!groups[key]) groups[key] = { orderId:r.orderId, driverId:r.driverId, vehicleId:r.vehicleId||'', guests:[] };
      groups[key].guests.push({ guestNo:+r.guestNo, nama:r.nama });
      if (r.vehicleId) groups[key].vehicleId = r.vehicleId;
    });

    out.cashier = {
      approvedCount: approved.length,
      groupCount: Object.keys(groups).length,
      groups: Object.keys(groups).map(function(k){
        var g = groups[k];
        var o = ord.find(function(x){ return x.id===g.orderId; }) || {};
        var d = drv.find(function(x){ return x.id===g.driverId; }) || {};
        var v = veh.find(function(x){ return x.id===g.vehicleId; }) || {};
        var letters = tl.filter(function(x){ return x.orderId===g.orderId && x.driverId===g.driverId; });
        return {
          key: k,
          orderId: g.orderId,
          driverId: g.driverId,
          driverName: d.name||'',
          vehicleId: g.vehicleId,
          vehicleName: v.name||'',
          route: (o.asal||'') + ' → ' + (o.tujuan||''),
          berangkatISO: o.berangkatISO||'',
          guests: g.guests,
          letters: letters.map(function(x){ return { id:x.id, status:x.status, advance:+x.advanceAmount||0, settle:+x.settleAmount||0 }; })
        };
      })
    };
  }

  // ... di dalam debugState(req) sebelum return out;
if (req && String(req.cashier||'') === '1') {
  var og  = rows_(SH(SHEETS.OGU));
  var ord = rows_(SH(SHEETS.ORD));
  var drv = rows_(SH(SHEETS.DRV));
  var veh = rows_(SH(SHEETS.VEH));
  var tl  = rows_(SH(SHEETS.TL));

  var isTrue = (v)=> (v===true) || (String(v).trim().toUpperCase()==='TRUE');
  var nz = (s)=> String(s||'').trim();

  var approved = og.filter(function(r){ return isTrue(r.approved) && nz(r.driverId) !== ''; });
  var groups = {};
  approved.forEach(function(r){
    var key = nz(r.orderId) + '__' + nz(r.driverId);
    if(!groups[key]) groups[key] = { orderId:nz(r.orderId), driverId:nz(r.driverId), vehicleId:nz(r.vehicleId), guests:[] };
    groups[key].guests.push({ guestNo:+r.guestNo, nama:r.nama||'' });
    if(nz(r.vehicleId)) groups[key].vehicleId = nz(r.vehicleId);
  });

  out.cashier = {
    approvedCount: approved.length,
    groupCount: Object.keys(groups).length,
    groups: Object.keys(groups).map(function(k){
      var g = groups[k];
      var o = ord.find(function(x){ return x.id===g.orderId; }) || {};
      var d = drv.find(function(x){ return x.id===g.driverId; }) || {};
      var v = veh.find(function(x){ return x.id===g.vehicleId; }) || {};
      var letters = tl.filter(function(x){ return x.orderId===g.orderId && x.driverId===g.driverId; });
      return {
        key: k,
        orderId: g.orderId,
        driverId: g.driverId,
        driverName: d.name||'',
        vehicleId: g.vehicleId,
        vehicleName: v.name||'',
        route: (o.asal||'') + ' → ' + (o.tujuan||''),
        berangkatISO: o.berangkatISO||'',
        guests: g.guests,
        letters: letters.map(function(x){ return { id:x.id, status:x.status, advance:+x.advanceAmount||0, settle:+x.settleAmount||0 }; })
      };
    })
  };
}

  return out;
}


function doGet(e){
  ensureSheets_();

  // === JSONP endpoint (untuk fallback CORS) ===
  if (e && e.parameter && e.parameter.jsonp === '1') {
    var cb = e.parameter.cb || 'callback';

    try {
      // payload dikirim web-safe base64 di param "q"
      var payload = {};
      if (e.parameter.q) {
        var raw = Utilities.base64DecodeWebSafe(e.parameter.q);
        payload = JSON.parse(Utilities.newBlob(raw).getDataAsString() || '{}');
      }

      // tentukan action (ambil dari query atau dari payload)
      var action = e.parameter.action || payload.action || '';

      // routing sama seperti doPost
var map = {
  // --- Auth ---
  login, ping,

  // --- Settings ---
  listVehicles, upsertVehicle, deleteVehicle,
  listDrivers, upsertDriver, deleteDriver,
  listUsers, upsertUser, deleteUser,
  getConfig, setConfig,

  // --- Order & Persetujuan ---
  createOrder, listApprovals, listAllocGuests,
  allocGuest, approveGuest, rejectOrder, deleteGuest, approveAll,
  getOrders: getOrders_,

  // --- Driver (tugas) ---
  myTasks: myTasks_robust, myTasksAll, depart, arrive, skipGuest, allDriverTasks,

  // --- Kasir ---
  listCashierTasks, createTaskLetter, settleTaskLetter, listCashierJournal,

  // --- Publik Register ---
  register,

  // --- Laporan & Dashboard ---
  journal, dashboard,

  debugState, testTelegram
};
      var fn = map[action];
      if (!fn) {
        var txt404 = cb + '(' + JSON.stringify({ ok:false, error:'Unknown action' }) + ')';
        return ContentService.createTextOutput(txt404).setMimeType(ContentService.MimeType.JAVASCRIPT);
      }

      var out = fn(payload);
      var txt = cb + '(' + JSON.stringify({ ok:true, data: out }) + ')';
      return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JAVASCRIPT);

    } catch(err) {
      var errTxt = cb + '(' + JSON.stringify({ ok:false, error: String(err) }) + ')';
      return ContentService.createTextOutput(errTxt).setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
  }

  // === halaman bridge lama (biarkan kalau kamu pakai) ===
  if (e && e.parameter && e.parameter.view === 'bridge') {
    var t = HtmlService.createTemplateFromFile('bridge');
    t.allowedOrigins = getAllowedOrigins_();
    return t.evaluate()
      .setTitle('GAS Bridge')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

    // ping sederhana (default)
  return json_({ ok:true, data: { ping:'ok' } });
}


/*******************************
 * ======== HTTP ENTRY =========
 *******************************/
function doPost(e){
  try{
    const req = JSON.parse(e.postData.contents||'{}');

    // Router: action -> handler
    const map = {
  // --- Auth ---
  login, ping,

  // --- Settings ---
  listVehicles, upsertVehicle, deleteVehicle,
  listDrivers,  upsertDriver,  deleteDriver,
  listUsers,    upsertUser,    deleteUser,
  getConfig,    setConfig,

  // --- Order & Persetujuan ---
  createOrder, listApprovals, listAllocGuests,
  allocGuest, approveGuest, rejectOrder, deleteGuest, approveAll,
  getOrders: getOrders_,

  // --- Driver (tugas) ---
  // ⬇⬇⬇ GANTI baris ini
  myTasks: myTasks_robust, myTasksAll, depart, arrive, skipGuest, allDriverTasks,

  // --- Kasir ---
  listCashierTasks, createTaskLetter, settleTaskLetter, listCashierJournal,

  // --- Publik Register (⬅⬅ TAMBAH INI)
  register,

  // --- Laporan & Dashboard ---
  journal, dashboard,

  debugState, testTelegram
};

    ensureSheets_(); // pastikan struktur siap

    const fn = map[req.action];
    if(!fn) return json_({ ok:false, error:'Unknown action' });

    const out = fn(req);
    return json_({ ok:true, data: out });
  }catch(err){
    return json_({ ok:false, error: String(err) });
  }
}
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/****************************************
 * ===== UTIL (baca-tulis Spreadsheet) ==
 ****************************************/
const SH = name=>SpreadsheetApp.getActive().getSheetByName(name);

function rows_(sh){
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0];
  return v.slice(1).map(r=>{
    const o={}; h.forEach((k,i)=>o[k]=r[i]); return o;
  });
}
function writeRows_(sh, rows, headers){
  const hdr = headers || Object.keys(rows[0]||{});
  sh.clearContents();
  sh.getRange(1,1,1,hdr.length).setValues([hdr]);
  if(rows.length){
    sh.getRange(2,1,rows.length,hdr.length)
      .setValues(rows.map(r=>hdr.map(k=>r[k]??'')));
  }
}
function uid_(){ return Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10); }
function hash_(str){ const raw=Utilities.computeHmacSha256Signature(str, SECRET); return Utilities.base64Encode(raw); }
function nowISO_(){ return new Date().toISOString(); }

// Nilai "ya/true" robust untuk kolom approved, dst.
function isTrue_(v){
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    var s = v.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 't' || s === 'ok';
  }
  return false;
}

/** Aktor pencatat log: dari token kalau ada, fallback req.actor, lalu 'system' */
function actor_(req){
  try{
    if (req && req.token){
      const t = parseToken_(req.token);
      return t.sub || 'system';
    }
  }catch(_){}
  return (req && req.actor) ? String(req.actor) : 'system';
}

/** Audit log ringkas */
function log_(req, action, detail){
  SH(SHEETS.LOG).appendRow([ new Date(), actor_(req), action||'', JSON.stringify(detail||{}) ]);
}

/**
 * Public: Register user role "user" (tanpa login).
 * Payload: { username, password, fullname, tgId? }
 * - Validasi pola username
 * - Cek duplikasi
 * - Set role = 'user'
 * - Gunakan jalur yang sama dengan upsertUser agar login tetap konsisten
 */
function register(payload){
  var username = String(payload && payload.username || '').trim().toLowerCase();
  var password = String(payload && payload.password || '');
  var fullname = String(payload && payload.fullname || '').trim();
  var tgId     = (payload && payload.tgId) ? String(payload.tgId).trim() : '';

  if (!username || !/^[a-z0-9._]{3,32}$/.test(username)){
    throw new Error('Username tidak valid (huruf kecil/angka/titik/underscore, 3–32).');
  }
  if (!fullname){
    throw new Error('Nama lengkap wajib diisi.');
  }
  if (!password || password.length < 6){
    throw new Error('Password minimal 6 karakter.');
  }

  // Cek apakah user sudah ada
  var users = listUsers(); // gunakan fungsi yang sudah ada
  var exists = users.some(function(u){ return (u.username||'').toLowerCase() === username; });
  if (exists){
    throw new Error('Username sudah terdaftar.');
  }

  // Buat user baru via jalur upsertUser supaya format field & hashing konsisten
  // upsertUser biasanya menerima { username, role?, newPassword?, tgId?, fullname? }
  var newUser = {
    username: username,
    role: 'user',
    newPassword: password,
    tgId: tgId,
    fullname: fullname
  };
  upsertUser(newUser);

  // Opsional: kirim kembali subset info user
  return { username: username, role: 'user', fullname: fullname, tgId: tgId || null, created_at: new Date().toISOString() };
}


/****************************************
 * ========== FIRST RUN / SCHEMA ========
 ****************************************/
function ensureSheets_(){
  const lock = LockService.getScriptLock();
  lock.tryLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const EXPECT = {};
    EXPECT[SHEETS.USERS] = ['username','hash','role','tgId','token','tokenExp'];
    EXPECT[SHEETS.VEH]   = ['id','name','brand','plate','capacity','driverId','status','note'];
    EXPECT[SHEETS.DRV]   = ['id','name','wa','status','userId']; // userId: pengikat driver ke akun
    EXPECT[SHEETS.ORD]   = ['id','pemesanUser','pemesanNama','pemesanUnit','pemesanJabatan','asal','tujuan','berangkatISO','pulangISO','agenda','status'];
    EXPECT[SHEETS.OGU]   = ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt', 'noDepartNote'];
    EXPECT[SHEETS.CFG]   = ['key','value'];
    EXPECT[SHEETS.LOG]   = ['timestamp','user','action','detail'];
    EXPECT[SHEETS.TL]    = ['id','orderId','driverId','vehicleId','letterNo','createdAt','cashierUser','advanceAmount','settleAmount','status','note'];
    EXPECT[SHEETS.CASH]  = ['id','letterId','type','amount','note','at','by'];

    const ensure = (name, headers) => {
      let sh = ss.getSheetByName(name);
      if (!sh) {
        sh = ss.insertSheet();
        sh.setName(name);
        sh.getRange(1,1,1,headers.length).setValues([headers]);
        return sh;
      }
      const lastCol = Math.max(1, sh.getLastColumn());
      const h = sh.getRange(1,1,1,lastCol).getDisplayValues()[0].map(x=>x||'');
      headers.forEach(k=>{
        if(!h.includes(k)){
          const c=sh.getLastColumn()+1;
          sh.getRange(1,c).setValue(k);
        }
      });
      return sh;
    };

    Object.keys(EXPECT).forEach(n=>ensure(n, EXPECT[n]));

    // seed admin/master jika belum ada
    const u = rows_(SH(SHEETS.USERS));
    if(!u.find(x=>x.username==='admin'))  SH(SHEETS.USERS).appendRow(['admin',  hash_('admin:admin'),'admin','', '', '']);
    if(!u.find(x=>x.username==='master')) SH(SHEETS.USERS).appendRow(['master', hash_('master:master'),'master','', '', '']);
  } finally {
    lock.releaseLock();
  }
}

/****************************************
 * ========== AUTH (Login/Ping) =========
 ****************************************/
function login(req){
  const { username, password, remember } = req;
  const u = rows_(SH(SHEETS.USERS)).find(x=>x.username===username);
  if(!u) throw 'User tidak ditemukan';
  if(u.hash!==hash_(`${username}:${password}`)) throw 'Password salah';

  const token = makeToken_(username, u.role, remember);
  const sh=SH(SHEETS.USERS); const v=sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++){
    if(v[i][0]===username){ v[i][4]=token.token; v[i][5]=token.expISO; break; }
  }
  sh.clearContents(); sh.getRange(1,1,v.length,v[0].length).setValues(v);

  log_(req,'login',{remember: !!remember});
  return { user:{ username, role:u.role, tgId:u.tgId||'' }, token: token.token };
}
function ping(req){
  const t = parseToken_(req.token);
  return { user:{ username:t.sub, role:t.role } };
}
function makeToken_(username, role, remember){
  const exp = new Date(); exp.setDate(exp.getDate() + (remember?30:1));
  const payload = { sub: username, role, exp: exp.getTime() };
  const base = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const sig  = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(base, SECRET));
  return { token:`${base}.${sig}`, expISO:exp.toISOString() };
}
function parseToken_(token){
  if(!token) throw 'No token';
  const [base,sig] = token.split('.');
  const check = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(base, SECRET));
  if(check!==sig) throw 'Invalid token';
  const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(base)).getDataAsString());
  if(Date.now()>payload.exp) throw 'Token expired';
  return payload;
}

/** Auth helper sederhana untuk handler yang butuh detail user */
function requireAuth_(req){
  try{
    var t = parseToken_(req && req.token);
    // Minimal field yang dipakai getOrders_: id, role, name, email (opsional)
    return { id: t.sub, role: t.role, name: t.sub, email: '' };
  }catch(e){
    throw new Error('Unauthorized');
  }
}

/****************************************
 * ========== SETTINGS → CONFIG =========
 ****************************************/
function getConfig(_req){
  const m = rows_(SH(SHEETS.CFG)).reduce((a,r)=>{a[r.key]=r.value;return a;},{});
  return { tgBot:m.tgBot||'', tgAdmin:m.tgAdmin||'' };
}
function setConfig(req){
  const { tgBot, tgAdmin } = req.cfg||{};
  const map = { tgBot:tgBot||'', tgAdmin:tj(tgAdmin) };

  function tj(v){ return (v==null)?'':String(v); }

  writeRows_(SH(SHEETS.CFG),
    Object.keys(map).map(k=>({key:k, value:map[k]})),
    ['key','value']
  );
  log_(req,'setConfig',{});
  return true;
}

/****************************************
 * ========= SETTINGS → VEHICLES ========
 ****************************************/
function listVehicles(){
  const drv = rows_(SH(SHEETS.DRV));
  return rows_(SH(SHEETS.VEH)).map(v=>{
    const d = drv.find(x=>x.id===v.driverId)||{};
    return {
      id:v.id, name:v.name, brand:v.brand, plate:v.plate, capacity:+v.capacity||1,
      driverId:v.driverId||'', driverName:d.name||'', driverWa:d.wa||'',
      status:v.status||'available', note:v.note||''
    };
  });
}
function upsertVehicle(req){
  var v = (req && req.veh) ? req.veh : (req || {});
  if (v && v.veh) v = v.veh;

  if (!v.id) v.id = uid_();

  var sh   = SH(SHEETS.VEH);
  var rows = rows_(sh);
  var idx  = rows.findIndex(function(x){ return x.id === v.id; });

  var row = {
    id:       v.id,
    name:     v.name     || '',
    brand:    v.brand    || '',
    plate:    v.plate    || '',
    capacity: +v.capacity || 1,
    driverId: v.driverId || '',
    status:   v.status   || 'available',
    note:     v.note     || ''
  };

  if (idx < 0) rows.push(row); else rows[idx] = row;

  writeRows_(sh, rows, ['id','name','brand','plate','capacity','driverId','status','note']);
  log_(req,'upsertVehicle',{ id: v.id, driverId: row.driverId });
  return true;
}
function deleteVehicle(req){
  const id=req.id;
  const rows = rows_(SH(SHEETS.VEH)).filter(r=>r.id!==id);
  writeRows_(SH(SHEETS.VEH), rows, ['id','name','brand','plate','capacity','driverId','status','note']);
  log_(req,'deleteVehicle',{id});
  return true;
}

/****************************************
 * ========= SETTINGS → DRIVERS =========
 ****************************************/
function listDrivers(){ return rows_(SH(SHEETS.DRV)); }
function upsertDriver(req){
  // Terima payload flat atau double-wrap
  var d = (req && req.drv) ? req.drv : (req || {});
  if (d && d.drv) d = d.drv; // toleransi jika ada {drv:{...}} lagi

  if (!d.id) d.id = uid_();

  var sh   = SH(SHEETS.DRV);
  var rows = rows_(sh);
  var idx  = rows.findIndex(function(x){ return x.id === d.id; });

  var row = {
    id:      d.id,
    name:    d.name    || '',
    wa:      d.wa      || '',
    status:  d.status  || 'active',
    userId:  d.userId  || ''
  };

  if (idx < 0) rows.push(row); else rows[idx] = row;

  writeRows_(sh, rows, ['id','name','wa','status','userId']);
  log_(req,'upsertDriver',{ id: d.id, userId: row.userId });
  return true;
}

function deleteDriver(req){
  const id=req.id;
  const rows=rows_(SH(SHEETS.DRV)).filter(r=>r.id!==id);
  writeRows_(SH(SHEETS.DRV), rows, ['id','name','wa','status','userId']);
  log_(req,'deleteDriver',{id});
  return true;
}

/****************************************
 * ========= SETTINGS → USERS ===========
 ****************************************/
function listUsers(){
  return rows_(SH(SHEETS.USERS))
    .map(u=>({username:u.username, role:u.role, tgId:u.tgId||''}));
}
function upsertUser(req){
  var inRaw = (req && req.user) ? req.user : (req || {});
  if (inRaw && inRaw.user) inRaw = inRaw.user; // toleransi double-wrap

  var username = String(inRaw.username || '').trim();
  if (!username) throw 'Username wajib diisi';

  // Bedakan "tidak dikirim" vs "dikirim nilai kosong"
  var hasRole = Object.prototype.hasOwnProperty.call(inRaw, 'role');
  var hasTgId = Object.prototype.hasOwnProperty.call(inRaw, 'tgId');

  var roleVal = hasRole ? String(inRaw.role || '').trim() : null;
  var tgIdVal = hasTgId ? (inRaw.tgId == null ? '' : String(inRaw.tgId)) : null;
  var newPw   = (inRaw.newPassword || '');

  var sh   = SH(SHEETS.USERS);
  var rows = rows_(sh);
  var u = rows.find(function(x){ return x.username === username; });

  if (!u){
    // Insert baru: role default 'user' bila tidak dikirim atau kosong
    u = {
      username: username,
      hash: hash_(username + ':' + (newPw || '1234')),
      role: (hasRole ? (roleVal || 'user') : 'user'),
      tgId: (hasTgId ? tgIdVal : ''),
      token: '',
      tokenExp: ''
    };
    rows.push(u);
  } else {
    // Update: hanya kolom yang dikirim saja yang diubah
    if (hasRole && roleVal) u.role = roleVal;   // abaikan role kosong
    if (hasTgId)            u.tgId = tgIdVal;   // boleh kosong jika memang ingin dikosongkan
    if (newPw)              u.hash = hash_(u.username + ':' + newPw);
  }

  writeRows_(sh, rows, ['username','hash','role','tgId','token','tokenExp']);
  log_(req,'upsertUser',{ username, changed:{ role:hasRole, tgId:hasTgId, pw:!!newPw } });
  return true;
}

function deleteUser(req){
  const username = req.username;
  if(username==='admin'||username==='master') throw 'Tidak boleh hapus user inti';
  const rows=rows_(SH(SHEETS.USERS)).filter(r=>r.username!==username);
  writeRows_(SH(SHEETS.USERS), rows, ['username','hash','role','tgId','token','tokenExp']);
  log_(req,'deleteUser',{username});
  return true;
}

/** =======================
 * TELEGRAM NOTIF CENTER
 * ======================= */

// alias untuk backward-compat (atasi error "telegram_is is not defined")
function telegram_is(text, chatId){ return telegram_(text, chatId); }
function currentUser_is(req){ return currentUser_(req); }

// Ikon/emoji per jenis notifikasi
const TG_ICONS = {
  order:   '📝',
  approval:'✅',
  depart:  '🚗💨',
  arrive:  '🏁',
  reject:  '❌',
  delete:  '🗑️',
};

// ===== Utils: read all rows once
function _getAll_(){
  return {
    U: rows_(SH(SHEETS.USERS)),
    D: rows_(SH(SHEETS.DRV)),
    V: rows_(SH(SHEETS.VEH)),
    O: rows_(SH(SHEETS.ORD)),
    G: rows_(SH(SHEETS.OGU)),
  };
}
function _findUser_(users, username){ return users.find(u=>u.username===username); }

// ===== Helpers: Telegram core
function tgGetMe_(token){
  var url = 'https://api.telegram.org/bot' + token + '/getMe';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
  var code = resp.getResponseCode();
  if (code !== 200) throw 'Token Telegram tidak valid (getMe '+code+').';
  var j={}; try{ j=JSON.parse(resp.getContentText()||'{}'); }catch(_){}
  if (!j.ok) throw 'Token Telegram ditolak: ' + (j.description || 'unknown');
  return j.result || {};
}

function tgNormalizeChatId_(val){
  // Terima angka/teks, kembalikan string trim
  var s = (val==null ? '' : String(val)).trim();
  // Google Sheet kadang mengubah angka besar → notasi ilmiah; cegah di sisi data Anda
  // Di sini kita hanya mengembalikan apa adanya (Telegram menerima string).
  return s;
}

function tgAnalyzeChatIdHint_(chatId){
  // Berikan hint sesuai pola chatId
  var s = tgNormalizeChatId_(chatId);
  if (!s) return 'Chat ID kosong. Isi Chat ID atau set Config.tgAdmin.';
  if (s[0] === '@') {
    return 'Terlihat seperti @channelusername. Pastikan bot sudah menjadi admin channel tsb.';
  }
  if (s[0] === '-') {
    return 'Terlihat seperti ID grup/channel (negatif). Pastikan bot sudah dimasukkan ke grup/channel (dan admin untuk channel).';
  }
  // positif → kemungkinan user privat
  return 'Terlihat seperti User ID privat. Pastikan user sudah menekan "Start" ke bot.';
}

function tgSend_(opts){
  // opts: { token, chatId, text, parseMode, strict, tag }
  var token = String(opts.token||'').trim();
  var chatId= tgNormalizeChatId_(opts.chatId);
  var text  = String(opts.text||'').trim() || '...';
  var parse = opts.parseMode || 'HTML';
  var strict = opts.strict === true;
  var tag   = opts.tag || 'tg_send';

  if (!token)  { if(strict) throw 'Telegram Bot Token kosong.'; return { ok:false, reason:'no_token' }; }
  if (!chatId) { if(strict) throw 'Chat ID kosong.'; return { ok:false, reason:'no_chat' }; }

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parse,
    disable_web_page_preview: true
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText() || '';
  var j = {}; try{ j = JSON.parse(body); }catch(_){}

  var ok = (code === 200) && (j.ok === true);
  if (typeof log_ === 'function'){
    log_({actor:'system'}, tag, { to: chatId, code: code, ok: ok, body: ok? (j.result && j.result.message_id) : (j.description||body).slice(0,180) });
  }
  if (!ok && strict){
    // Kemas error yg informatif
    var base = 'Telegram error ' + code + ': ' + (j.description || body);
    if (code === 400 && /chat not found/i.test(body)){
      base += '\nHint: ' + tgAnalyzeChatIdHint_(chatId) +
              '\n• Untuk user privat: pastikan user sudah chat / Start ke bot.' +
              '\n• Untuk grup: pakai ID grup negatif (mis. -1001234…) & bot sudah jadi anggota.' +
              '\n• Untuk channel: pakai -100… atau @channelusername & bot admin channel.';
    }
    throw base;
  }
  return { ok: ok, code: code, raw: j };
}

// ===== High-level wrappers (dipakai aplikasi)
function _tgBroadcast_(text, chatIds){
  var cfg = getConfig({});
  var token = String(cfg.tgBot||'').trim();
  (chatIds||[]).filter(Boolean).forEach(function(cid){
    tgSend_({ token: token, chatId: cid, text: text, strict:false, tag:'tg_broadcast' });
  });
}
function _tgToRoles_(users, roles, text){
  var ids = users
    .map(function(u){ return roles.includes(u.role) ? String(u.tgId==null?'':u.tgId).trim() : ''; })
    .filter(Boolean);

  if (ids.length){
    _tgBroadcast_(text, ids);
  }else{
    // fallback: tgAdmin
    var cfg = getConfig({});
    var admin = String(cfg.tgAdmin||'').trim();
    if (admin){
      var token = String(cfg.tgBot||'').trim();
      tgSend_({ token: token, chatId: admin, text: text, strict:false, tag:'tg_admin_fallback' });
    }
  }
}
function _tgToPemesan_(users, order, text){
  var u = _findUser_(users, order.pemesanUser||'');
  var cid = u ? String(u.tgId==null?'':u.tgId).trim() : '';
  if (!cid) return;
  var cfg = getConfig({}); var token = String(cfg.tgBot||'').trim();
  tgSend_({ token: token, chatId: cid, text: text, strict:false, tag:'tg_pemesan' });
}
function _tgToDriverId_(users, drivers, driverId, text){
  var d = drivers.find(function(x){ return x.id===driverId; });
  if (!d || !d.userId) return;
  var u = _findUser_(users, d.userId);
  var cid = u ? String(u.tgId==null?'':u.tgId).trim() : '';
  if (!cid) return;
  var cfg = getConfig({}); var token = String(cfg.tgBot||'').trim();
  tgSend_({ token: token, chatId: cid, text: text, strict:false, tag:'tg_driver' });
}

function _fmtLong(iso){ return fmtLong_(iso||''); }
function _fmtShort(iso){ return fmtShort_(iso||''); }

function _listGuestsBasic_(guests){
  if(!guests.length) return '—';
  return guests.map(function(g){ return '• ' + (g.nama||'-') + ' (WA ' + (g.wa||'-') + ')'; }).join('\n');
}
function _listGuestsAlloc_(guests, vehMap, drvMap){
  if(!guests.length) return '—';
  return guests.map(function(g){
    var v = vehMap[g.vehicleId] || {};
    var d = drvMap[g.driverId]  || {};
    var vLabel = v.name ? ('Kend: ' + v.name) : 'Kend: -';
    var dLabel = d.name ? ('Driver: ' + d.name + ' (WA ' + (d.wa||'-') + ')') : 'Driver: -';
    return '• ' + (g.nama||'-') + ' (WA ' + (g.wa||'-') + ') — ' + vLabel + ' | ' + dLabel;
  }).join('\n');
}

function _orderCtx_(orderId){
  var x = _getAll_();
  var o = x.O.find(function(k){ return k.id===orderId; }) || {};
  var g = x.G.filter(function(k){ return k.orderId===orderId; });
  var vehMap = x.V.reduce(function(a,v){ a[v.id]=v; return a; },{});
  var drvMap = x.D.reduce(function(a,d){ a[d.id]=d; return a; },{});
  return {U:x.U, D:x.D, V:x.V, O:x.O, G:x.G, o:o, g:g, vehMap:vehMap, drvMap:drvMap};
}

/* =========== NOTIF PER KEJADIAN =========== */

function notifyOrderCreated_(orderId){
  const {U,o,g} = _orderCtx_(orderId);
  const text =
`${TG_ICONS.order} ORDER BARU ${orderId}
Pemesan : ${o.pemesanNama||'-'} (${o.pemesanUnit||'-'})
Jml Tamu: ${g.length}
Rute    : ${o.asal||''} → ${o.tujuan||''}
Rencana : ${_fmtLong(o.berangkatISO)}
Agenda  : ${o.agenda||'-'}

Tamu:
${_listGuestsBasic_(g)}`;

  // Kumpulkan penerima: admin/master + pemesan, lalu dedup
  let ids = [
    ..._idsFromRoles_(U, ['master','admin']),
    _idFromUsername_(U, o.pemesanUser||'')
  ].filter(Boolean);

  // Fallback ke tgAdmin hanya jika kosong total
  if (ids.length === 0){
    const admin = _cid_(getConfig({}).tgAdmin);
    if (admin) ids.push(admin);
  }

  _sendOnce_(text, ids);
}

function notifyApprovedGuests_(orderId, guestNos){
  const {U,D,o,g, vehMap, drvMap} = _orderCtx_(orderId);

  // Semua tamu approved (rekap)
  const approvedAll = g.filter(function(x){ return String(x.approved).toUpperCase() === 'TRUE'; });

  // Target “baru di-approve” (untuk pesan driver). Jika guestNos null → pakai approvedAll.
  const targets = (guestNos && guestNos.length)
    ? g.filter(function(x){ return guestNos.indexOf(+x.guestNo) >= 0; })
    : approvedAll.slice();

  // ===== Rekap (admin/master/cashier + pemesan) =====
  var header =
    TG_ICONS.approval + ' APPROVAL Order ' + orderId + '\n' +
    'Disetujui: ' + approvedAll.length + ' dari ' + g.length + ' tamu\n' +
    'Rute     : ' + (o.asal||'') + ' → ' + (o.tujuan||'') + '\n' +
    'Rencana  : ' + _fmtLong(o.berangkatISO) + '\n';

  var groupsAll = _allocGroups_(approvedAll, vehMap, drvMap);
  var bodyAll = _renderAllocSections_(groupsAll, {
    titlePrefix: 'Alokasi disetujui',
    listTitle:   'Tamu :',
    unitLabel:   'Unit'
  });

  var textAll = header + '\n' + bodyAll;

  // kirim (DEDUP)
  var idsRekap = []
    .concat(_idsFromRoles_(U, ['master','admin','cashier']))
    .concat(_idFromUsername_(U, o.pemesanUser||''))
    .filter(Boolean);

  if (idsRekap.length === 0){
    var admin = _cid_(getConfig({}).tgAdmin);
    if (admin) idsRekap.push(admin);
  }
  _sendOnce_(textAll, idsRekap);

  // ===== Per-driver (hanya ke driver terkait) =====
  // Kelompokkan "targets" per driverId
  var byDrv = {};
  targets.forEach(function(t){
    if (!t.driverId) return;
    if (!byDrv[t.driverId]) byDrv[t.driverId] = [];  // <= pengganti (byDrv[t.driverId] ||= [])
    byDrv[t.driverId].push(t);
  });

  Object.keys(byDrv).forEach(function(did){
    var list = byDrv[did];
    var groupsDrv = _allocGroups_(list, vehMap, drvMap); // umumnya 1 group

    var headerDrv =
      TG_ICONS.approval + ' APPROVAL TUGAS\n' +
      'Order   : ' + orderId + '\n' +
      'Rute    : ' + (o.asal||'') + ' → ' + (o.tujuan||'') + '\n' +
      'Rencana : ' + _fmtLong(o.berangkatISO) + '\n';

    // render manual (pas dengan template)
    var g0 = groupsDrv[0] || { vehName:'-', drvName:'-', drvWa:'-', items:[] };
    var listMe = g0.items.map(function(x){
      return '• ' + (x.nama||'-') + ' (WA ' + (x.wa||'-') + ')';
    }).join('\n') || '—';

    var bodyDrvFixed =
      'Unit : ' + (g0.vehName||'-') + ' | Driver : ' + (g0.drvName||'-') + ' (WA ' + (g0.drvWa||'-') + ')\n\n' +
      'Tamu Anda :\n' +
      listMe;

    var textDrv = headerDrv + '\n' + bodyDrvFixed;

    var d = D.find(function(x){ return x.id === did; });
    if (d && d.userId){
      var cid = _idFromUsername_(U, d.userId);
      _sendOnce_(textDrv, [cid]);
    }
  });
}

function notifyDepart_(orderId, guestNo){
  var ctx = _orderCtx_(orderId);
  var U = ctx.U, D = ctx.D, V = ctx.V, o = ctx.o, g = ctx.g;

  // tamu yang memicu event
  var row = g.find(function(x){ return +x.guestNo === +guestNo; }) || {};
  var did = row.driverId || '';
  if (!did) return; // tanpa driver, abaikan

  // Cek: sudah pernah kirim notifikasi depart utk (orderId, driverId)?
  if (_groupNotified_(orderId, did, 'drvDepartNotified')) return;

  // Grup tamu untuk driver ini (yang approved / dialokasikan)
  var list = g.filter(function(x){ return x.driverId === did; });

  var vehMap = V.reduce(function(a,v){ a[v.id]=v; return a; },{});
  var drvMap = D.reduce(function(a,d){ a[d.id]=d; return a; },{});
  var vInfo  = vehMap[row.vehicleId] || vehMap[(list[0]||{}).vehicleId] || {};
  var dInfo  = drvMap[did] || {};

  var jml = list.length;
  var header =
    TG_ICONS.depart + ' BERANGKAT — Order ' + orderId + '\n' +
    'Jml Tamu: ' + jml + '\n' +
    'Rute    : ' + (o.asal||'') + ' → ' + (o.tujuan||'') + '\n' +
    'Aktual  : ' + _fmtShort(row.departAt || new Date().toISOString()) + '\n\n';

  var body =
    'Unit: ' + (vInfo.name||'-') + ' | Driver: ' + (dInfo.name||'-') + ' (WA ' + (dInfo.wa||'-') + ')\n\n' +
    'Tamu :\n' +
    (list.map(function(it){ return '• ' + (it.nama||'-') + ' (WA ' + (it.wa||'-') + ')'; }).join('\n') || '—');

  var text = header + body;

  // Kirim ke admin/master/cashier + pemesan (DEDUP)
  var ids = []
    .concat(_idsFromRoles_(U, ['master','admin','cashier']))
    .concat(_idFromUsername_(U, o.pemesanUser||''))
    .filter(Boolean);
  if (ids.length === 0){
    var admin = _cid_(getConfig({}).tgAdmin);
    if (admin) ids.push(admin);
  }
  _sendOnce_(text, ids);

  // Kirim ke driver terkait
  var d = D.find(function(x){ return x.id === did; });
  if (d && d.userId){
    var cid = _idFromUsername_(U, d.userId);
    _sendOnce_(text, [cid]);
  }

  // Tandai grup ini sudah di-notify agar tak spam
  _markGroupNotified_(orderId, did, 'drvDepartNotified');
}

function notifyArrive_(orderId, guestNo){
  var ctx = _orderCtx_(orderId);
  var U = ctx.U, D = ctx.D, V = ctx.V, o = ctx.o, g = ctx.g;

  // tamu yang memicu event
  var row = g.find(function(x){ return +x.guestNo === +guestNo; }) || {};
  var did = row.driverId || '';
  if (!did) return;

  // Cek apakah sudah pernah notify TIBA utk (orderId, driverId)
  if (_groupNotified_(orderId, did, 'drvArriveNotified')) return;

  // Grup tamu untuk driver ini
  var list = g.filter(function(x){ return x.driverId === did; });

  var vehMap = V.reduce(function(a,v){ a[v.id]=v; return a; },{});
  var drvMap = D.reduce(function(a,d){ a[d.id]=d; return a; },{});
  var vInfo  = vehMap[row.vehicleId] || vehMap[(list[0]||{}).vehicleId] || {};
  var dInfo  = drvMap[did] || {};

  var jml = list.length;
  var header =
    TG_ICONS.arrive + ' TIBA — Order ' + orderId + '\n' +
    'Jml Tamu: ' + jml + '\n' +
    'Rute    : ' + (o.asal||'') + ' → ' + (o.tujuan||'') + '\n' +
    'Aktual  : ' + _fmtShort(row.arriveAt || new Date().toISOString()) + '\n\n';

  var body =
    'Unit: ' + (vInfo.name||'-') + ' | Driver: ' + (dInfo.name||'-') + ' (WA ' + (dInfo.wa||'-') + ')\n\n' +
    'Tamu :\n' +
    (list.map(function(it){ return '• ' + (it.nama||'-') + ' (WA ' + (it.wa||'-') + ')'; }).join('\n') || '—');

  var text = header + body;

  // Kirim ke admin/master/cashier + pemesan
  var ids = []
    .concat(_idsFromRoles_(U, ['master','admin','cashier']))
    .concat(_idFromUsername_(U, o.pemesanUser||''))
    .filter(Boolean);
  if (ids.length === 0){
    var admin = _cid_(getConfig({}).tgAdmin);
    if (admin) ids.push(admin);
  }
  _sendOnce_(text, ids);

  // Kirim ke driver terkait
  var d = D.find(function(x){ return x.id === did; });
  if (d && d.userId){
    var cid = _idFromUsername_(U, d.userId);
    _sendOnce_(text, [cid]);
  }

  // Tandai grup ini sudah di-notify agar tak spam
  _markGroupNotified_(orderId, did, 'drvArriveNotified');
}

function notifyReject_(orderId, reason){
  const {U,o,g} = _orderCtx_(orderId);
  const text =
`${TG_ICONS.reject} ORDER DITOLAK ${orderId}
Pemesan : ${o.pemesanNama||'-'} (${o.pemesanUnit||'-'})
Jml Tamu: ${g.length}
Agenda  : ${o.agenda||'-'}
Alasan  : ${reason||'-'}`;

  const ids = [
    ..._idsFromRoles_(U, ['master','admin']),
    _idFromUsername_(U, o.pemesanUser||'')
  ].filter(Boolean);
  _sendOnce_(text, ids.length ? ids : [_cid_(getConfig({}).tgAdmin)]);
}
function notifyDeleteGuest_(orderId, guestNo, reason){
  const {U,o,g} = _orderCtx_(orderId);
  const row = g.find(x=>+x.guestNo===+guestNo) || {};
  const text =
`${TG_ICONS.delete} TAMU DIHAPUS — Order ${orderId}
Tamu    : ${row.nama||'-'} (WA ${row.wa||'-'})
Agenda  : ${o.agenda||'-'}
Alasan  : ${reason||'-'}`;

  const ids = [
    ..._idsFromRoles_(U, ['master','admin']),
    _idFromUsername_(U, o.pemesanUser||'')
  ].filter(Boolean);
  _sendOnce_(text, ids.length ? ids : [_cid_(getConfig({}).tgAdmin)]);
}

// === Gateway lama (tetap ada untuk kompatibilitas internal)
function telegram_(text, chatId){
  var cfg   = getConfig({});
  var token = String(cfg.tgBot || '').trim();
  var to    = tgNormalizeChatId_(chatId == null ? (cfg.tgAdmin || '') : chatId);
  tgSend_({ token: token, chatId: to, text: text, strict:false, tag:'telegram_' });
}

// === Alat uji internal (opsional)
function testTelegramAdmin_(){
  telegram_('✅ Test ke tgAdmin (Config.tgAdmin)', null);
  return 'OK';
}
function testTelegramUser_(username){
  var u = rows_(SH(SHEETS.USERS)).find(function(x){ return x.username===username; });
  if (!u) throw 'User tidak ditemukan';
  var cid = tgNormalizeChatId_(u.tgId||'');
  if (!cid) throw 'tgId user kosong';
  telegram_('✅ Test ke user '+username, cid);
  return 'OK';
}

// === API: testTelegram (dipanggil dari UI)
function testTelegram(req){
  var cfg = getConfig ? getConfig() : {};
  var token  = (req && req.botToken) || cfg.tgBot || cfg.tgBotToken || cfg.bot || '';
  var chatId = (req && req.chatId)   || cfg.tgAdmin || cfg.tgAdminChatId || cfg.admin || '';
  var text   = (req && req.text)     || 'Test notifikasi dari Armada Seriang';

  token  = String(token||'').trim();
  chatId = tgNormalizeChatId_(chatId);

  if (!token)  throw 'Telegram Bot Token belum di-set di Config.';
  // 1) validasi token dulu
  tgGetMe_(token);

  if (!chatId) throw 'Telegram Admin Chat ID belum di-set dan tidak diberikan di form.';

  // 2) kirim strict→ TRUE supaya kalau 400, error dijelaskan
  var out = tgSend_({ token: token, chatId: chatId, text: text, strict:true, tag:'testTelegram' });
  return { ok:true, to: chatId, message_id: (out.raw && out.raw.result && out.raw.result.message_id) || null };
}

/** ====== OGU flags: pastikan kolom ada & helper ====== */
function _ensureOGUFlags_(){
  var sh = SH(SHEETS.OGU);
  var rng = sh.getRange(1,1,1,sh.getLastColumn());
  var headers = rng.getValues()[0] || [];
  var need = ['drvDepartNotified','drvArriveNotified'];
  var add = [];
  for (var i=0;i<need.length;i++){
    if (headers.indexOf(need[i]) === -1) add.push(need[i]);
  }
  if (add.length){
    // tambahkan kolom di akhir header
    var newHeaders = headers.concat(add);
    var lastRow = sh.getLastRow() || 1;
    var lastCol = headers.length;
    // tulis header baru
    sh.getRange(1,1,1,newHeaders.length).setValues([newHeaders]);
    // isi nilai kosong utk baris data yang sudah ada
    if (lastRow > 1){
      sh.getRange(2,lastCol+1,lastRow-1,add.length).clearContent();
    }
  }
}

function _groupNotified_(orderId, driverId, fieldName){
  _ensureOGUFlags_();
  var rows = rows_(SH(SHEETS.OGU));
  return rows.some(function(r){
    return r.orderId === orderId && r.driverId === driverId &&
           String(r[fieldName]||'').toUpperCase() === 'TRUE';
  });
}

function _markGroupNotified_(orderId, driverId, fieldName){
  _ensureOGUFlags_();
  var sh = SH(SHEETS.OGU);
  var v  = sh.getDataRange().getValues();
  var headers = v[0]; var idx = headers.indexOf(fieldName);
  if (idx < 0) return; // safety
  for (var i=1;i<v.length;i++){
    if (v[i][0] == null) continue; // baris kosong
    // asumsikan kolom orderId & driverId dikenali oleh rows_(), tapi di v kita tidak tahu indeksnya.
    // Lebih aman: gunakan rows_() untuk mapping -> lalu tulis balik dengan writeRows_()
  }
  // Cara aman: pakai rows_() + writeRows_() agar kolom tetap konsisten
  var rows = rows_(sh);
  rows.forEach(function(r){
    if (r.orderId === orderId && r.driverId === driverId){
      r[fieldName] = 'TRUE';
    }
  });
  // tulis kembali sesuai urutan header saat ini
  writeRows_(sh, rows, headers);
}



/****************************************
 * ======= ORDER & PERSETUJUAN ==========
 ****************************************/
function createOrder(req){
  const o = req.order||{};
  const orderId = uid_();

  SH(SHEETS.ORD).appendRow([
    orderId,
    o.pemesan?.user||'',
    o.pemesan?.nama||'',
    o.pemesan?.unit||'',
    o.pemesan?.jabatan||'',
    o.asal||'', o.tujuan||'',
    o.berangkatISO||'', o.pulangISO||'',
    o.agenda||'',
    'pending'
  ]);

  const shOG = SH(SHEETS.OGU);
  (o.tamu||[]).forEach((g,i)=>{
    shOG.appendRow([orderId, i+1, g.nama||'', g.unit||'', g.jabatan||'', g.gender||'L', g.wa||'', '', '', '', '', '', '']);
  });

  // log pakai user dari token atau fallback pemesan
  log_(req, 'createOrder', { orderId });

  // Telegram – PUSAT NOTIF
  notifyOrderCreated_(orderId);

  // preselect kendaraan (opsional)
  if(o.preVehicleId){
    const og = rows_(shOG);
    og.filter(x=>x.orderId===orderId).forEach(x=>x.vehicleId=o.preVehicleId);
    writeRows_(shOG, og, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);
  }
  return true;
}

function listApprovals(){
  const ord = rows_(SH(SHEETS.ORD)).filter(o=>o.status==='pending' || o.status==='allocating');
  return ord.map(o=>{
    const jml = rows_(SH(SHEETS.OGU)).filter(g=>g.orderId===o.id).length;
    const berLabel = o.berangkatISO? fmtLong_(o.berangkatISO):'';
    const pulLabel = o.pulangISO? fmtLong_(o.pulangISO):'';
    return { id:o.id, pemesan:{nama:o.pemesanNama}, asal:o.asal, tujuan:o.tujuan, berangkatLabel:berLabel, pulangLabel:pulLabel, jml };
  });
}
function listAllocGuests(req){
  const o = rows_(SH(SHEETS.ORD)).find(x=>x.id===req.orderId); if(!o) throw 'Order tidak ada';
  const g = rows_(SH(SHEETS.OGU)).filter(x=>x.orderId===req.orderId);
  const info = `${o.pemesanNama} • ${o.asal} → ${o.tujuan} • ${fmtLong_(o.berangkatISO)}`;
  const guests = g.map(x=>({
    no:+x.guestNo, nama:x.nama, unit:x.unit, jabatan:x.jabatan,
    vehicleId:x.vehicleId||'', driverId:x.driverId||'',
    approved: x.approved==='TRUE'
  }));
  return { info, guests };
}
function allocGuest(req){
  const { orderId, guestNo, vehicleId, driverId } = req;
  const sh = SH(SHEETS.OGU); const rows = rows_(sh);
  const i = rows.findIndex(x=>x.orderId===orderId && +x.guestNo===+guestNo);
  if(i<0) throw 'Tamu tidak ada';

  rows[i].vehicleId = vehicleId||'';
  rows[i].driverId  = driverId||'';
  writeRows_(sh, rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);

  setOrderStatus_(orderId, 'allocating');
  log_(req,'allocGuest',{orderId,guestNo,vehicleId,driverId});

  if(vehicleId) setVehicleStatus_(vehicleId,'allocated');
  return true;
}
function approveGuest(req){
  const { orderId, guestNo } = req;
  const shOG = SH(SHEETS.OGU);
  const all  = rows_(shOG);

  const i = all.findIndex(x => x.orderId === orderId && +x.guestNo === +guestNo);
  if (i < 0) throw 'Tamu tidak ada';
  if (!all[i].vehicleId || !all[i].driverId) throw 'Alokasikan kendaraan & driver dulu';

  all[i].approved = 'TRUE';
  writeRows_(shOG, all, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);

  // Telegram – ringkasan approval hanya untuk tamu ini
  notifyApprovedGuests_(orderId, [guestNo]);

  log_(req,'admin','approveGuest',{orderId,guestNo});

  const stillPending = all.some(r => r.orderId === orderId && r.approved !== 'TRUE');
  if (!stillPending) setOrderStatus_(orderId, 'approved');
  return true;
}
function approveAll(req){
  const { orderId } = req;

  const shOG = SH(SHEETS.OGU);
  const all  = rows_(shOG);
  const targets = all.filter(r => r.orderId === orderId);
  if (targets.length === 0) throw 'Order tidak memiliki tamu';

  const notAllocated = targets.filter(r => !(r.vehicleId && r.driverId));
  if (notAllocated.length) throw 'Alokasikan kendaraan & driver untuk semua tamu terlebih dahulu.';

  let changed = 0;
  targets.forEach(r => { if (r.approved !== 'TRUE') { r.approved = 'TRUE'; changed++; } });

  writeRows_(shOG, all, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);
  setOrderStatus_(orderId, 'approved');

  // Telegram – ringkasan approval untuk SEMUA tamu order ini
  notifyApprovedGuests_(orderId, null);

  log_(req,'admin', 'approveAll', { orderId, guests: targets.length, newlyApproved: changed });
  return true;
}
function rejectOrder(req){
  const { orderId, reason } = req;
  setOrderStatus_(orderId,'rejected');

  // Telegram – PUSAT NOTIF
  notifyReject_(orderId, reason);

  log_(req,'admin','rejectOrder',{orderId,reason});
  return true;
}
function deleteGuest(req){
  const { orderId, guestNo, reason } = req;
  const rows=rows_(SH(SHEETS.OGU)).filter(r=> !(r.orderId===orderId && +r.guestNo===+guestNo) );
  writeRows_(SH(SHEETS.OGU), rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);

  // Telegram – PUSAT NOTIF
  notifyDeleteGuest_(orderId, guestNo, reason);

  log_(req,'admin','deleteGuest',{orderId,guestNo,reason});
  return true;
}

function skipGuest(req){
  const { orderId, guestNo, note } = req;
  const sh   = SH(SHEETS.OGU);
  const rows = rows_(sh);
  const i = rows.findIndex(x => x.orderId===orderId && +x.guestNo===+guestNo);
  if (i < 0) throw 'Tamu tidak ada';

  rows[i].noDepartNote = String(note || '');
  writeRows_(sh, rows, OGU_HEADERS);
  log_(req,'skipGuest',{ orderId, guestNo });
  return true;
}

/****************************************************
 * getOrders_ — untuk halaman "My Order"
 * Input (req):
 *   - token        : string (dipakai oleh requireAuth_)
 *   - sinceDays    : number (default 30)
 *   - scope        : 'mine' | 'all' (default auto by role)
 *   - page         : number (optional, default 1)
 *   - pageSize     : number (optional, default 500)
 * Output (return):
 *   { orders: [...], total: number }
 ****************************************************/
function getOrders_(req){
  var user = requireAuth_(req);
  var scope = String(req.scope||'mine').toLowerCase();
  var sinceDays = Math.max(1, +req.sinceDays || 30);
  var page = Math.max(1, +req.page || 1);
  var pageSize = Math.max(1, +req.pageSize || 500);

  var sh = getSheetByNames_(["Orders","orders","ORDERS"]);
  if (!sh) return { orders: [], total:0, page:1, pageSize:pageSize };

  // --- preload referensi alokasi (supaya Kendaraan/Driver tidak kosong) ---
  var ogu = rows_(SH(SHEETS.OGU)) || [];
  var veh = rows_(SH(SHEETS.VEH)) || [];
  var drv = rows_(SH(SHEETS.DRV)) || [];

  // index cepat
  var vehById = {}, drvById = {}, oguByOrder = {};
  veh.forEach(function(v){ vehById[v.id] = v; });
  drv.forEach(function(d){ drvById[d.id] = d; });
  ogu.forEach(function(x){
    var k = x.orderId;
    if (!oguByOrder[k]) oguByOrder[k] = [];
    oguByOrder[k].push(x);
  });

  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { orders: [], total:0, page:1, pageSize:pageSize };

  var head = vals[0], idx = headerIdx_(head);
  var cutoff = Date.now() - sinceDays*24*60*60*1000;

  function cell(row, i){ return (i>=0 && i<row.length) ? row[i] : ''; }

  var rows = [];
  for (var r=1;r<vals.length;r++){
    var row = vals[r];

    var createdIso = asIso_(cell(row, idx.created_at));
    var lastIso    = asIso_(cell(row, idx.last_update));
    var depIsoRaw  = asIso_(cell(row, idx.depart_at));
    var arrIsoRaw  = asIso_(cell(row, idx.arrive_at));

    // pakai last_update -> created_at -> depart/arrive untuk filter
    var pivotIso = lastIso || createdIso || depIsoRaw || arrIsoRaw || '';
    var tick = Date.parse(pivotIso);
    if (!(tick>0) || tick < cutoff) continue;

    // scope 'mine' → hanya milik saya (kecuali admin/master)
    if (scope === 'mine' && !isAdmin_(user)){
      var meId = String(user.id||'').toLowerCase();
      var meNm = String(user.name||'').toLowerCase();
      var meEm = String(user.email||'').toLowerCase();
      var cb   = String(cell(row, idx.created_by)||'').toLowerCase();
      var cbn  = String(cell(row, idx.created_by_name)||'').toLowerCase();
      var cbe  = String(cell(row, idx.created_by_email)||'').toLowerCase();
      if (!(meId && cb && meId===cb) && !(meNm && cbn && meNm===cbn) && !(meEm && cbe && meEm===cbe)) {
        continue;
      }
    }

    var orderId = cell(row, idx.id) || String(r);
    var vehName = cell(row, idx.vehicle_name), vehPlate = cell(row, idx.vehicle_plate);
    var drvName = cell(row, idx.driver_name),  drvPhone = cell(row, idx.driver_phone);

    // ---- Fallback alokasi dari OGU bila kolom Orders kosong ----
    if ((!vehName && !vehPlate) || !drvName){
      var ogs = (oguByOrder[orderId]||[]).filter(function(x){ return isApproved_(x.approved); });
      if (ogs.length){
        var vIds = Array.from(new Set(ogs.map(function(x){return x.vehicleId;}).filter(Boolean)));
        var dIds = Array.from(new Set(ogs.map(function(x){return x.driverId; }).filter(Boolean)));

        if (!vehName && !vehPlate && vIds.length){
          var vNames = [], vPlates=[];
          vIds.forEach(function(id){
            var v = vehById[id]||{};
            if (v.name)  vNames.push(String(v.name));
            if (v.plate) vPlates.push(String(v.plate));
          });
          if (vNames.length || vPlates.length){
            vehName  = vNames.join(', ');
            vehPlate = vPlates.join(', ');
          }
        }

        if (!drvName && dIds.length){
          var dNames=[], dPhone='';
          dIds.forEach(function(id){ var d=drvById[id]||{}; if(d.name) dNames.push(String(d.name)); });
          if (dIds.length===1){ var d1=drvById[dIds[0]]||{}; dPhone = d1.wa || d1.phone || ''; }
          if (dNames.length){
            drvName = dNames.join(', ');
            drvPhone = drvPhone || dPhone;
          }
        }
      }
    }

    // ---- Kegiatan/Tujuan: pastikan ada fallback wajar ----
    var tujuan = cell(row, idx.destination) || cell(row, idx.to) || '';
    var asal   = cell(row, idx.from) || '';
    var activity = cell(row, idx.agenda) || '';
    if (!tujuan && (asal || tujuan)){
      // jika header tujuan kosong di sheet tertentu, tampilkan route
      tujuan = (asal || tujuan) ? (asal + (tujuan ? ' → ' + tujuan : '')) : '';
    }

    var obj = {
      id: orderId,
      order_no: orderId,
      created_at: createdIso || lastIso || depIsoRaw || arrIsoRaw || '',
      destination: tujuan || '',
      activity: activity || '',
      status: cell(row, idx.status) || '',
      last_update: lastIso || createdIso || depIsoRaw || arrIsoRaw || ''
    };

    if (vehName || vehPlate) obj.allocated_vehicle = { name:String(vehName||''), plate:String(vehPlate||'') };
    if (drvName || drvPhone) obj.driver = { name:String(drvName||''), phone:String(drvPhone||'') };
    if (depIsoRaw) obj.depart = { at: depIsoRaw };
    if (arrIsoRaw) obj.arrive = { at: arrIsoRaw };

    rows.push(obj);
  }

  // urutkan terbaru
  rows.sort(function(a,b){
    function pick(x){ return x.last_update || x.created_at || (x.depart && x.depart.at) || (x.arrive && x.arrive.at) || 0; }
    return new Date(pick(b)) - new Date(pick(a));
  });

  var total = rows.length;
  var start = (page-1)*pageSize;
  var pageRows = rows.slice(start, start+pageSize);

  return { orders: pageRows, total: total, page: page, pageSize: pageSize };
}


/********** Helpers khusus handler ini **********/
function _getSheetByAliases_(names){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  for (var i=0;i<names.length;i++){
    var nm = names[i];
    if (!nm) continue;
    var sh = ss.getSheetByName(nm);
    if (sh) return sh;
  }
  return null;
}

function _rowsToObjects_(sheet){
  if (!sheet) return [];
  var rng = sheet.getDataRange();
  var vals = rng.getValues();
  if (!vals || vals.length<2) return [];
  var head = vals[0].map(function(h){ return String(h||'').trim(); });
  var out = [];
  for (var r=1;r<vals.length;r++){
    var row = vals[r], obj = {};
    for (var c=0;c<head.length;c++){
      var key = head[c]||('col'+c);
      obj[key] = row[c];
    }
    out.push(obj);
  }
  return out;
}

function _indexBy_(rows, keys){
  var out = {};
  if (!rows) return out;
  for (var i=0;i<rows.length;i++){
    var id = _pick(rows[i], keys);
    if (id!=null && id!=='') out[String(id)] = rows[i];
  }
  return out;
}

function _pick(o, aliases){
  if (!o) return null;
  for (var i=0;i<aliases.length;i++){
    var k = aliases[i];
    if (o.hasOwnProperty(k) && o[k]!=null && String(o[k])!=='') return o[k];
  }
  return null;
}

function _dateIso(v){
  if (!v && v!==0) return '';
  try{
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString(); // ISO lokal->UTC
  }catch(e){ return ''; }
}


/****************************************
 * ========== DRIVER (TUGAS) ============
 ****************************************/
function myTasks(req){
  // Normalisasi payload jadi string username
  var driverUser = (req && typeof req === 'object' && 'driverUser' in req) ? req.driverUser : req;
  if (driverUser && typeof driverUser === 'object' && 'driverUser' in driverUser) {
    driverUser = driverUser.driverUser; // toleransi double-wrap
  }
  driverUser = String(driverUser || '').trim();
  if (!driverUser) return [];

  var drvRows = rows_(SH(SHEETS.DRV));

  function norm(s){ return (s||'').toString().trim().toLowerCase(); }
  function normalizePhone_(s){
    s = (s||'').toString().trim().replace(/[^\d]/g,'');
    if (s.indexOf('0') === 0) s = '62' + s.slice(1);
    return s;
  }

  var drv = drvRows.find(function(d){ return (d.userId||'') === driverUser; }) ||
            drvRows.find(function(d){ return norm(d.name) === norm(driverUser); }) ||
            drvRows.find(function(d){ return normalizePhone_(d.wa) === normalizePhone_(driverUser); });
  if (!drv) return [];

  var og  = rows_(SH(SHEETS.OGU)).filter(function(x){ return x.driverId === drv.id && x.approved === 'TRUE'; });
  var ord = rows_(SH(SHEETS.ORD));

  return og.map(function(x){
    var o = ord.find(function(k){ return k.id === x.orderId; }) || {};
    return {
      orderId:x.orderId, guestNo:+x.guestNo, nama:x.nama,
      asal:o.asal, tujuan:o.tujuan, berangkatISO:o.berangkatISO,
      departAt:x.departAt||'', arriveAt:x.arriveAt||'',
      departAtLabel: x.departAt? fmtShort_(x.departAt):'', arriveAtLabel: x.arriveAt? fmtShort_(x.arriveAt):''
    };
  });
}
function myTasks_robust(req){
  // --- Normalisasi argumen jadi string username ---
  var driverUser = '';
  if (req && typeof req === 'object') {
    if (typeof req.driverUser === 'object' && req.driverUser) {
      driverUser = req.driverUser.driverUser || req.driverUser.username || req.driverUser.name || '';
    } else if ('driverUser' in req) {
      driverUser = req.driverUser;
    } else if (req.payload) {
      var p = req.payload;
      driverUser = (typeof p === 'object') ? (p.driverUser || p.username || p.name || '') : p;
    }
  } else {
    driverUser = req; // kasus req = 'username'
  }
  driverUser = String(driverUser || '').trim();
  if (!driverUser) return [];

  var drvRows = rows_(SH(SHEETS.DRV));

  function norm(s){ return (s||'').toString().trim().toLowerCase(); }
  function normalizePhone_(s){
    s = (s||'').toString().trim().replace(/[^\d]/g,'');
    if (s.indexOf('0') === 0) s = '62' + s.slice(1);
    return s;
  }
  function isApproved_(v){
    // toleran: TRUE (string), true (boolean), 'true', 1
    if (v === true || v === 1) return true;
    var t = String(v||'').toUpperCase();
    return (t === 'TRUE' || t === '1' || t === 'YA');
  }

  // Prioritas: userId → nama → WA
  var drv = drvRows.find(function(d){ return (d.userId||'') === driverUser; }) ||
            drvRows.find(function(d){ return norm(d.name) === norm(driverUser); }) ||
            drvRows.find(function(d){ return normalizePhone_(d.wa) === normalizePhone_(driverUser); });
  if (!drv) return [];

  var og  = rows_(SH(SHEETS.OGU)).filter(function(x){ return x.driverId === drv.id && isApproved_(x.approved); });
  var ord = rows_(SH(SHEETS.ORD));

  // (opsional) catatan ringkas di log untuk debugging
  try { log_({token:req && req.token}, 'myTasks_probe', { driverUser: driverUser, drvId: drv.id, tasks: og.length }); } catch(_){}

  return og.map(function(x){
    var o = ord.find(function(k){ return k.id === x.orderId; }) || {};
    return {
      orderId: x.orderId,
      guestNo: +x.guestNo,
      nama: x.nama,
      asal: o.asal,
      tujuan: o.tujuan,
      berangkatISO: o.berangkatISO,
      departAt: x.departAt || '',
      arriveAt: x.arriveAt || '',
      departAtLabel: x.departAt ? fmtShort_(x.departAt) : '',
      arriveAtLabel: x.arriveAt ? fmtShort_(x.arriveAt) : '',
      noDepartNote: x.noDepartNote || ''
    };
  });
}

function allDriverTasks(req){
  // Semua tamu yang sudah APPROVED dan BELUM tiba (arriveAt kosong)
  var og  = rows_(SH(SHEETS.OGU)).filter(function(x){
    return x.approved === 'TRUE' && (!x.arriveAt);   // tampilkan yang masih jalan
  });

  var ord = rows_(SH(SHEETS.ORD));

  return og.map(function(x){
    var o = ord.find(function(k){ return k.id === x.orderId; }) || {};
    return {
      orderId: x.orderId,
      guestNo: +x.guestNo,
      nama: x.nama,
      asal: o.asal,
      tujuan: o.tujuan,
      berangkatISO: o.berangkatISO || '',
      departAt: x.departAt || '',
      arriveAt: x.arriveAt || '',
      departAtLabel: x.departAt ? fmtShort_(x.departAt) : '',
      arriveAtLabel: x.arriveAt ? fmtShort_(x.arriveAt) : '',
      driverId: x.driverId || '',
      // kolom catatan “tidak berangkat” (toleran nama field)
      noDepartNote: x.noDepartNote || x.ndNote || x.noteNoDepart || ''
    };
  });
}


function depart(req){
  const { orderId, guestNo }=req;
  const rows=rows_(SH(SHEETS.OGU));
  const i=rows.findIndex(r=>r.orderId===orderId && +r.guestNo===+guestNo);
  if(i<0) throw 'Tugas tidak ada';

  rows[i].departAt = nowISO_();
  writeRows_(SH(SHEETS.OGU), rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);

  // Telegram – PUSAT NOTIF
  notifyDepart_(orderId, guestNo);

  if(rows[i].vehicleId) setVehicleStatus_(rows[i].vehicleId,'on_trip');

  log_(req,'driver','depart',{orderId,guestNo});
  return true;
}
function arrive(req){
  const { orderId, guestNo }=req;
  const rows=rows_(SH(SHEETS.OGU));
  const i=rows.findIndex(r=>r.orderId===orderId && +r.guestNo===+guestNo);
  if(i<0) throw 'Tugas tidak ada';

  rows[i].arriveAt = nowISO_();
  writeRows_(SH(SHEETS.OGU), rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt','noDepartNote']);

  // Telegram – PUSAT NOTIF
  notifyArrive_(orderId, guestNo);

  const stillOn = rows.filter(r=> r.vehicleId===rows[i].vehicleId && (!r.arriveAt) );
  if(stillOn.length===0 && rows[i].vehicleId) setVehicleStatus_(rows[i].vehicleId,'available');

  log_(req,'driver','arrive',{orderId,guestNo});
  return true;
}


/****************************************
 * ============== KASIR =================
 ****************************************/
function listCashierTasks(req){
  const og  = rows_(SH(SHEETS.OGU));
  const ord = rows_(SH(SHEETS.ORD));
  const drv = rows_(SH(SHEETS.DRV));
  const veh = rows_(SH(SHEETS.VEH));
  const tl  = rows_(SH(SHEETS.TL));

  // helper: TRUE robust (boolean TRUE / "TRUE" / " true " / dsb.)
  const isTrue = (v) => (v === true) || (String(v).trim().toUpperCase() === 'TRUE');
  const nz = (s) => String(s || '').trim();

  // Kelompok per (orderId, driverId) untuk tamu approved
  const key = (o,d)=>`${o}__${d}`;

  // ⬅️ FILTER ROBUST: approved HARUS true, driverId tidak kosong (trim)
  const approved = og.filter(r => isTrue(r.approved) && nz(r.driverId) !== '');
  const groups = {};
  approved.forEach(r=>{
    const k = key(nz(r.orderId), nz(r.driverId));
    if (!groups[k]) groups[k] = { orderId: nz(r.orderId), driverId: nz(r.driverId), vehicleId: nz(r.vehicleId), guests: [] };
    groups[k].guests.push({ guestNo:+r.guestNo, nama:r.nama || '', unit:r.unit||'', jabatan:r.jabatan||'' });
    if (nz(r.vehicleId)) groups[k].vehicleId = nz(r.vehicleId);
  });

  const items = [];
  Object.keys(groups).forEach(k=>{
    const g = groups[k];
    const o = ord.find(x=>x.id===g.orderId) || {};
    const d = drv.find(x=>x.id===g.driverId) || {};
    const v = veh.find(x=>x.id===g.vehicleId) || {};

    // Cari surat (jika ada), ambil yang terbaru
    const tlRows = tl
      .filter(x=> x.orderId===g.orderId && x.driverId===g.driverId)
      .sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
    const letter = tlRows[0] || null;

    if (!letter){
      // Belum ada surat → tugas "buat_surat"
      items.push({
        kind: 'buat_surat',
        orderId: g.orderId,
        driverId: g.driverId,
        vehicleId: g.vehicleId || '',
        driverName: d.name || '',
        vehicleName: v.name || '',
        route: `${o.asal||''} → ${o.tujuan||''}`,
        berangkatISO: o.berangkatISO || '',
        guests: g.guests
      });
      return;
    }

    // Sudah ada surat, tampilkan sebagai PTJB jika belum "settled"
    const status = (letter.status || 'open');
    if (status !== 'settled'){
      const lv = veh.find(x=>x.id===letter.vehicleId) || v || {};
      items.push({
        kind: 'ptjb',
        orderId: g.orderId,
        driverId: g.driverId,
        vehicleId: letter.vehicleId || g.vehicleId || '',
        driverName: d.name || '',
        vehicleName: lv.name || '',
        route: `${o.asal||''} → ${o.tujuan||''}`,
        berangkatISO: o.berangkatISO || '',
        guests: g.guests,
        letterId: letter.id,
        letterNo: letter.letterNo || '',
        advanceAmount: +letter.advanceAmount || 0,
        settleAmount: +letter.settleAmount || 0,
        status
      });
    }
    // kalau settled → tidak dimunculkan
  });

  // CCTV kecil (bisa hapus nanti)
  try{
    console.log('[GAS/CASH] approved rows:', approved.length, 'groups:', Object.keys(groups).length, 'items:', items.length);
  }catch(_){}

  // Urutkan: jadwal terdekat dulu
  items.sort((a,b)=> new Date(a.berangkatISO||0) - new Date(b.berangkatISO||0));
  return items;
}

function createTaskLetter(req){
  const { orderId, driverId, vehicleId, letterNo, advanceAmount, note } = req;
  if(!orderId || !driverId) throw 'orderId/driverId wajib';

  const id = uid_();
  SH(SHEETS.TL).appendRow([
    id, orderId, driverId, vehicleId||'',
    letterNo||'', nowISO_(), actor_(req),
    +advanceAmount||0, 0, 'open', note||''
  ]);

  if(+advanceAmount>0){
    SH(SHEETS.CASH).appendRow([ uid_(), id, 'advance', +advanceAmount, note||'', nowISO_(), actor_(req) ]);
  }

  log_(req,'createTaskLetter',{id, orderId, driverId, advance:+advanceAmount||0});
  return { id };
}
function settleTaskLetter(req){
  const { letterId, settleAmount, note } = req;
  const settleStatus = (req.status === 'settled' || req.status === 'lunas') ? 'settled' : 'pending';

  const sh = SH(SHEETS.TL); 
  const v  = sh.getDataRange().getValues();
  let found=false, adv=0, letterNo='';

  for(let i=1;i<v.length;i++){
    if(v[i][0]===letterId){
      letterNo = v[i][4]||'';
      adv      = +v[i][7]||0;          // advanceAmount
      v[i][8]  = +settleAmount||0;     // settleAmount
      v[i][9]  = settleStatus;         // status: settled/pending
      v[i][10] = v[i][10] ? (v[i][10] + ' | ' + (note||'')) : (note||''); // note
      found=true; 
      break;
    }
  }
  if(!found) throw 'Surat tugas tidak ditemukan';

  sh.clearContents(); 
  sh.getRange(1,1,v.length,v[0].length).setValues(v);

  // log transaksi kas
  SH(SHEETS.CASH).appendRow([ uid_(), letterId, 'settlement', +settleAmount||0, note||'', nowISO_(), actor_(req) ]);

  const diff = adv - (+settleAmount||0); // Uang Muka - Pertanggungjawaban
  log_(req,'settleTaskLetter',{letterId, letterNo, advance:adv, settle:+settleAmount||0, diff, status:settleStatus});
  return { diff, status: settleStatus, letterNo };
}
function listCashierJournal(req){
  const from = req.fromISO ? new Date(req.fromISO) : new Date('1970-01-01');
  const to   = req.toISO   ? new Date(req.toISO)   : new Date('2999-12-31');

  const tl = rows_(SH(SHEETS.TL)).filter(x=>{
    const t = new Date(x.createdAt||new Date());
    return t>=from && t<=to;
  });

  const ord = rows_(SH(SHEETS.ORD));
  const drv = rows_(SH(SHEETS.DRV));
  const veh = rows_(SH(SHEETS.VEH));

  return tl.map(x=>{
    const o = ord.find(k=>k.id===x.orderId)||{};
    const d = drv.find(k=>k.id===x.driverId)||{};
    const v = veh.find(k=>k.id===x.vehicleId)||{};
    const diff = (+x.settleAmount||0) - (+x.advanceAmount||0);
    return {
      id:x.id, letterNo:x.letterNo||'',
      orderId:x.orderId, driverName:d.name||'', vehicleName:v.name||'',
      route:`${o.asal||''} → ${o.tujuan||''}`,
      createdAt:x.createdAt||'',
      advance:+x.advanceAmount||0, settle:+x.settleAmount||0, diff,
      status:x.status||'open', note:x.note||''
    };
  });
}

/****************************************
 * ======== LAPORAN & DASHBOARD =========
 ****************************************/
function journal(req){
  const from = new Date(req.fromISO), to = new Date(req.toISO);
  const ord = rows_(SH(SHEETS.ORD));
  const og  = rows_(SH(SHEETS.OGU));
  const veh = rows_(SH(SHEETS.VEH));
  const drv = rows_(SH(SHEETS.DRV));
  const out=[];
  og.forEach(g=>{
    const o = ord.find(x=>x.id===g.orderId)||{};
    const d1 = g.departAt ? new Date(g.departAt) : null;
    if(d1 && d1>=from && d1<=to){
      out.push({
        nama:g.nama, unit:g.unit, jabatan:g.jabatan, agenda:o.agenda||'',
        vehicleName: (veh.find(v=>v.id===g.vehicleId)||{}).name||'',
        driverName: (drv.find(d=>d.id===g.driverId)||{}).name||'',
        departAt: g.departAt||'', arriveAt: g.arriveAt||''
      });
    }
  });
  return out;
}
function dashboard(){
  const veh = rows_(SH(SHEETS.VEH));
  const og  = rows_(SH(SHEETS.OGU));
  const activeVehicles = veh.filter(v=>v.status!=='inactive' && v.status!=='maintenance').length;
  const onTripGuests   = og.filter(g=>g.departAt && !g.arriveAt).length;

  const map = {};
  og.filter(g=>g.arriveAt).forEach(g=>{ map[g.vehicleId]= (map[g.vehicleId]||0)+1; });
  const top = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([vid,c])=>{
    const v = veh.find(x=>x.id===vid)||{}; return { name:v.name||'(Tanpa Nama)', count:c };
  });

  return { activeVehicles, onTripGuests, topVehicles: top };
}

/****************************************
 * ================ HELPER ==============
 ****************************************/
function setOrderStatus_(orderId, status){
  const sh=SH(SHEETS.ORD); const v=sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++){ if(v[i][0]===orderId){ v[i][10]=status; break; } }
  sh.clearContents(); sh.getRange(1,1,v.length,v[0].length).setValues(v);
}
function setVehicleStatus_(id, status){
  const sh=SH(SHEETS.VEH); const v=sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++){ if(v[i][0]===id){ v[i][6]=status; break; } }
  sh.clearContents(); sh.getRange(1,1,v.length,v[0].length).setValues(v);
}
function fmtLong_(iso){
  if(!iso) return '';
  const d=new Date(iso); const hari=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()];
  const bln=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()];
  const pad=n=>n<10?'0'+n:n;
  return `${hari}, ${pad(d.getDate())} ${bln} ${d.getFullYear()} – ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtShort_(iso){
  const d=new Date(iso); const pad=n=>n<10?'0'+n:n;
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function role_(req){
  try { return parseToken_(req.token).role || ''; }
  catch(e){ return ''; }
}

function isTrue_(v){
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    var s = v.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 't' || s === 'ok';
  }
  return false;
}

// === DRIVER: semua tugas (untuk admin/master; read-only di UI) ===
function myTasksAll(_req){
  var og  = rows_(SH(SHEETS.OGU)).filter(function(x){ return x.approved === 'TRUE'; });
  var ord = rows_(SH(SHEETS.ORD));

  return og.map(function(x){
    var o = ord.find(function(k){ return k.id === x.orderId; }) || {};
    return {
      orderId: x.orderId,
      guestNo: +x.guestNo,
      nama: x.nama,
      asal: o.asal,
      tujuan: o.tujuan,
      berangkatISO: o.berangkatISO,
      departAt: x.departAt || '',
      arriveAt: x.arriveAt || '',
      departAtLabel: x.departAt ? fmtShort_(x.departAt) : '',
      arriveAtLabel: x.arriveAt ? fmtShort_(x.arriveAt) : '',
      readonly: true   // biar UI bisa tahu ini tampilan RO
    };
  });
}

// ===== Helpers dedup chat_id =====
function _cid_(v){ return String(v == null ? '' : v).trim(); }

function _idsFromRoles_(users, roles){
  const set = new Set();
  (users||[]).forEach(u=>{
    if (roles.includes(u.role)){
      const cid = _cid_(u.tgId);
      if (cid) set.add(cid);
    }
  });
  return Array.from(set);
}
function _idFromUsername_(users, username){
  const u = (users||[]).find(x=>x.username === username);
  return _cid_(u?.tgId || '');
}
function _sendOnce_(text, ids){
  const set = new Set();
  (ids||[]).forEach(id => { const c=_cid_(id); if(c) set.add(c); });
  set.forEach(cid => telegram_(text, cid));
}

// ===== Grouping per alokasi (vehicleId + driverId) =====
function _allocGroups_(guests, vehMap, drvMap){
  var groups = [];
  var map = {};
  guests.forEach(function(g){
    var key = (g.vehicleId||'') + '__' + (g.driverId||'');
    if (!map[key]){
      var v = vehMap[g.vehicleId] || {};
      var d = drvMap[g.driverId]  || {};
      map[key] = {
        vehicleId: g.vehicleId||'',
        driverId:  g.driverId||'',
        vehName:   v.name || v.plate || '-',
        drvName:   d.name || '-',
        drvWa:     d.wa || '-',
        items:     []
      };
      groups.push(map[key]);
    }
    map[key].items.push(g);
  });
  return groups;
}

// ===== Render section "Alokasi (n)" / "Alokasi disetujui (n)" =====
function _renderAllocSections_(groups, opts){
  opts = opts || {};
  var titlePrefix = opts.titlePrefix || 'Alokasi';
  var listTitle   = opts.listTitle   || 'Tamu :';    // atau "Tamu Anda :"
  var unitLabel   = opts.unitLabel   || 'Unit';

  var parts = [];
  groups.forEach(function(gr, idx){
    var head = titlePrefix + ' (' + (idx+1) + ') :';
    var unit = unitLabel + ' : ' + (gr.vehName||'-') + ' | Driver : ' + (gr.drvName||'-') + ' (WA ' + (gr.drvWa||'-') + ')';
    var list = (gr.items||[]).map(function(x){
      return '• ' + (x.nama||'-') + ' (WA ' + (x.wa||'-') + ')';
    }).join('\n');

    parts.push(
      head + '\n' +
      unit + '\n\n' +
      listTitle + '\n' +
      (list || '—')
    );
  });

  // separator antar group
  return parts.join('\n===============\n\n');
}

// ====== FLAGS untuk mencegah rekap ganda ======
// kolom baru di SHEETS.ORD: departNotifiedAt, arriveNotifiedAt

function _ensureOrdFlagCols_(){
  var sh = SH(SHEETS.ORD);
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return;
  var headers = sh.getRange(1,1,1,lastCol).getValues()[0] || [];
  var need = ['departNotifiedAt','arriveNotifiedAt'];
  var missing = need.filter(function(h){ return headers.indexOf(h) === -1; });
  if (missing.length){
    sh.getRange(1, headers.length+1, 1, missing.length).setValues([missing]);
  }
}

function _getOrdFlag_(orderId, key){
  var sh = SH(SHEETS.ORD);
  var v  = sh.getDataRange().getValues();
  if (!v || v.length < 2) return '';
  var headers = v[0];
  var idIdx   = headers.indexOf('id');
  var flagIdx = headers.indexOf(key);
  if (idIdx < 0 || flagIdx < 0) return '';
  for (var i=1;i<v.length;i++){
    if (v[i][idIdx] === orderId) return v[i][flagIdx] || '';
  }
  return '';
}

function _setOrdFlag_(orderId, key){
  _ensureOrdFlagCols_();
  var sh = SH(SHEETS.ORD);
  var v  = sh.getDataRange().getValues();
  if (!v || v.length < 2) return false;
  var headers = v[0];
  var idIdx   = headers.indexOf('id');
  var flagIdx = headers.indexOf(key);
  // kalau kolom flag belum ada, tambahkan & ulangi
  if (flagIdx < 0){
    sh.getRange(1, headers.length+1).setValue(key);
    return _setOrdFlag_(orderId, key);
  }
  for (var i=1;i<v.length;i++){
    if (v[i][idIdx] === orderId){
      var iso = new Date().toISOString();
      sh.getRange(i+1, flagIdx+1).setValue(iso);
      return true;
    }
  }
  return false;
}


function isAdmin_(u){ var r=(u&&u.role)||''; return r==='admin'||r==='master'; }

function getSheetByNames_(names){
  var ss = SpreadsheetApp.getActive(), sheets = ss.getSheets();
  var wanted = names.map(function(n){ return String(n).toLowerCase(); });
  for (var i=0;i<sheets.length;i++){
    var nm = String(sheets[i].getName()).toLowerCase();
    if (wanted.indexOf(nm)>=0) return sheets[i];
  }
  // fallback: cari sheet yang mengandung "order"
  for (var j=0;j<sheets.length;j++){
    var nm2 = String(sheets[j].getName()).toLowerCase();
    if (nm2.indexOf('order')>=0) return sheets[j];
  }
  return null;
}

function headerIdx_(headers){
  var h = headers.map(function(x){ return String(x||'').trim().toLowerCase(); });
  function any(arr){ for (var i=0;i<arr.length;i++){ var k=h.indexOf(arr[i]); if (k!==-1) return k; } return -1; }
  return {
    id: any(['id','order_id','orderid','order no','order_no','no order','no_order','no']),
    created_at: any(['created_at','createdat','created','timestamp','tgl','tanggal','order_date','date']),
    created_by: any(['created_by','username','user','pemesan','pemohon','requested_by','created_by_user']),
    created_by_name: any(['created_by_name','pemesan','nama pemesan','nama','name']),
    created_by_email: any(['created_by_email','email']),
    agenda: any(['agenda','kegiatan','activity']),
    destination: any(['destination','tujuan']),
    from: any(['from','asal']),
    to: any(['to','tujuan']),
    status: any(['status']),
    last_update: any(['last_update','updated_at','update_at','modified']),
    vehicle_name: any(['vehicle_name','kendaraan','armada','mobil']),
    vehicle_plate: any(['vehicle_plate','plate','nopol','no_pol','no polisi','no_polisi','no-pol']),
    driver_name: any(['driver','driver_name','supir']),
    driver_phone: any(['driver_phone','no_wa_driver','wa_driver','phone_driver','no wa driver']),
    // tambahkan alias field tanggal yang lazim di sheet Anda:
    depart_at: any(['depart_at','berangkat_at','tgl_berangkat','jam_berangkat','renc_berangkat','renc. berangkat','berangkatiso']),
    arrive_at: any(['arrive_at','tiba_at','tgl_tiba','jam_tiba','pulangiso'])
  };
}



function asIso_(v){
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  var s = String(v);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m){
    var day=+m[1], mon=+m[2]-1, yr=+m[3]; if (yr<100) yr+=2000;
    var hh=+m[4]||0, mm=+m[5]||0, ss=+m[6]||0;
    return new Date(yr,mon,day,hh,mm,ss).toISOString();
  }
  return '';
}


