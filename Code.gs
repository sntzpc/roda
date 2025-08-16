/** ====== CONFIG ====== */
const SECRET = 'ganti-dengan-secret-acak-anda'; // ubah!
const SHEETS = {
  USERS:'Users', VEH:'Vehicles', DRV:'Drivers', ORD:'Orders', OGU:'OrderGuests', CFG:'Config', LOG:'AuditLog'
};
/** ==================== */

function doPost(e){
  try{
    const req = JSON.parse(e.postData.contents||'{}');
    const fn = ({
      login, ping, listVehicles, upsertVehicle, deleteVehicle,
      listDrivers, upsertDriver, deleteDriver,
      listUsers, upsertUser, deleteUser,
      getConfig, setConfig,
      createOrder, listApprovals, listAllocGuests, allocGuest, approveGuest, rejectOrder, deleteGuest, approveAll,
      myTasks, depart, arrive,
      journal, dashboard
    })[req.action];
    if(!fn) return res({ok:false,error:'Unknown action'});
    ensureSheets_();
    const out = fn(req);
    return res({ ok:true, data: out });
  }catch(err){
    return res({ ok:false, error: String(err) });
  }
}
function res(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ====== UTIL ====== */
const SH = name=>SpreadsheetApp.getActive().getSheetByName(name);
function rows_(sh){ const v=sh.getDataRange().getValues(); if(v.length<2) return []; const h=v[0]; return v.slice(1).map(r=>obj_(h,r)); }
function obj_(h, r){ const o={}; h.forEach((k,i)=>o[k]=r[i]); return o; }
function writeRows_(sh, rows, headers){
  if(!headers) headers = Object.keys(rows[0]||{});
  sh.clearContents(); sh.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows.map(r=>headers.map(k=>r[k]??'')));
}
function uid_(){ return Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10); }
function now_(){ return new Date(); }
function hash_(str){ // HMAC-SHA256 with secret
  const raw = Utilities.computeHmacSha256Signature(str, SECRET);
  return Utilities.base64Encode(raw);
}
function log_(user, action, detail){
  const sh=SH(SHEETS.LOG); sh.appendRow([new Date(), user||'',action||'',JSON.stringify(detail||{})]);
}
function telegram_(text, chatId){
  const cfg = getConfig({});
  const token = cfg.tgBot||''; const admin = chatId || cfg.tgAdmin || '';
  if(!token || !admin) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  UrlFetchApp.fetch(url, { method:'post', payload:{ chat_id: admin, text:text }, muteHttpExceptions:true });
}

/** ====== FIRST RUN ====== */
function ensureSheets_(){
  const ss=SpreadsheetApp.getActive();
  const ensure=(name, headers)=>{
    let sh=ss.getSheetByName(name); if(!sh){ sh=ss.insertSheet(name); sh.appendRow(headers); }
    const h=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
    if(h.join('|')!==headers.join('|')) writeRows_(sh, [], headers); // reset header jika beda
    return sh;
  };
  ensure(SHEETS.USERS, ['username','hash','role','tgId','token','tokenExp']);
  ensure(SHEETS.VEH,   ['id','name','brand','plate','capacity','driverId','status','note']);
  ensure(SHEETS.DRV,   ['id','name','wa','status']);
  ensure(SHEETS.ORD,   ['id','pemesanUser','pemesanNama','pemesanUnit','pemesanJabatan','asal','tujuan','berangkatISO','pulangISO','agenda','status']);
  ensure(SHEETS.OGU,   ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
  ensure(SHEETS.CFG,   ['key','value']);
  ensure(SHEETS.LOG,   ['timestamp','user','action','detail']);

  // seed default users
  const u = rows_(SH(SHEETS.USERS));
  if(!u.find(x=>x.username==='admin')){
    SH(SHEETS.USERS).appendRow(['admin', hash_('admin:admin'), 'admin','', '', '']);
  }
  if(!u.find(x=>x.username==='master')){
    SH(SHEETS.USERS).appendRow(['master', hash_('master:master'), 'master','', '', '']);
  }
}

/** ====== AUTH ====== */
function login(req){
  const { username, password, remember } = req;
  const users = rows_(SH(SHEETS.USERS));
  const u = users.find(x=>x.username===username);
  if(!u) throw 'User tidak ditemukan';
  const expected = hash_(`${username}:${password}`);
  if(u.hash!==expected) throw 'Password salah';
  const token = makeToken_(username, u.role, remember);
  // simpan token
  const sh=SH(SHEETS.USERS); const v=sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++){
    if(v[i][0]===username){ v[i][4]=token.token; v[i][5]=token.expISO; break; }
  }
  sh.clearContents(); sh.getRange(1,1,v.length,v[0].length).setValues(v);
  log_(username,'login',{remember});
  return { user:{ username, role:u.role, tgId:u.tgId||'' }, token: token.token };
}
function ping(req){
  const t = parseToken_(req.token);
  return { user:{ username:t.sub, role:t.role } };
}
function makeToken_(username, role, remember){
  const exp = new Date();
  exp.setDate(exp.getDate() + (remember?30:1));
  const payload = { sub: username, role, exp: exp.getTime() };
  const base = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(base, SECRET));
  return { token: `${base}.${sig}`, expISO: exp.toISOString() };
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

/** ====== CONFIG ====== */
function getConfig(_req){
  const m = rows_(SH(SHEETS.CFG)).reduce((a,r)=>{a[r.key]=r.value;return a;},{});
  return { tgBot:m.tgBot||'', tgAdmin:m.tgAdmin||'' };
}
function setConfig(req){
  const { tgBot, tgAdmin } = req.cfg||{};
  const sh=SH(SHEETS.CFG);
  const map = {'tgBot':tgBot||'', 'tgAdmin':tgAdmin||''};
  writeRows_(sh, Object.keys(map).map(k=>({key:k, value:map[k]})), ['key','value']);
  log_('master','setConfig',{});
  return true;
}

/** ====== VEHICLES ====== */
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
  const v = req.veh||{};
  if(!v.id) v.id = uid_();
  const sh = SH(SHEETS.VEH);
  const rows = rows_(sh);
  const idx = rows.findIndex(x=>x.id===v.id);
  const row = {
    id:v.id, name:v.name||'', brand:v.brand||'', plate:v.plate||'',
    capacity:+v.capacity||1, driverId:v.driverId||'', status:v.status||'available', note:v.note||''
  };
  if(idx<0) { rows.push(row); } else { rows[idx]=row; }
  writeRows_(sh, rows, ['id','name','brand','plate','capacity','driverId','status','note']);
  log_('admin','upsertVehicle',{id:v.id});
  return true;
}
function deleteVehicle(req){
  const id = req.id;
  const sh = SH(SHEETS.VEH);
  const rows = rows_(sh).filter(r=>r.id!==id);
  writeRows_(sh, rows, ['id','name','brand','plate','capacity','driverId','status','note']);
  log_('admin','deleteVehicle',{id});
  return true;
}

/** ====== DRIVERS ====== */
function listDrivers(){ return rows_(SH(SHEETS.DRV)); }
function upsertDriver(req){
  const d = req.drv||{}; if(!d.id) d.id=uid_();
  const sh=SH(SHEETS.DRV); const rows=rows_(sh);
  const idx=rows.findIndex(x=>x.id===d.id);
  const row={ id:d.id, name:d.name||'', wa:d.wa||'', status:d.status||'active' };
  if(idx<0) rows.push(row); else rows[idx]=row;
  writeRows_(sh, rows, ['id','name','wa','status']);
  log_('admin','upsertDriver',{id:d.id});
  return true;
}
function deleteDriver(req){
  const id=req.id; const sh=SH(SHEETS.DRV);
  const rows=rows_(sh).filter(r=>r.id!==id); writeRows_(sh, rows, ['id','name','wa','status']);
  log_('admin','deleteDriver',{id}); return true;
}

/** ====== USERS ====== */
function listUsers(){ return rows_(SH(SHEETS.USERS)).map(u=>({username:u.username, role:u.role, tgId:u.tgId||''})); }
function upsertUser(req){
  const inU = req.user||{};
  const sh=SH(SHEETS.USERS); const rows=rows_(sh);
  let u = rows.find(x=>x.username===inU.username);
  if(!u){
    u = { username:inU.username, hash: hash_(`${inU.username}:${inU.newPassword||'1234'}`), role: inU.role||'user', tgId: inU.tgId||'', token:'', tokenExp:'' };
    rows.push(u);
  }else{
    if(inU.role) u.role=inU.role;
    if(inU.tgId!==null && inU.tgId!==undefined) u.tgId=inU.tgId;
    if(inU.newPassword) u.hash = hash_(`${u.username}:${inU.newPassword}`);
  }
  writeRows_(sh, rows, ['username','hash','role','tgId','token','tokenExp']);
  log_('admin','upsertUser',{username:inU.username});
  return true;
}
function deleteUser(req){
  const username = req.username;
  if(username==='admin'||username==='master') throw 'Tidak boleh hapus user inti';
  const sh=SH(SHEETS.USERS); const rows=rows_(sh).filter(r=>r.username!==username);
  writeRows_(sh, rows, ['username','hash','role','tgId','token','tokenExp']);
  log_('admin','deleteUser',{username});
  return true;
}

/** ====== ORDERS ====== */
function createOrder(req){
  const o = req.order||{};
  const orderId = uid_();
  SH(SHEETS.ORD).appendRow([orderId, o.pemesan?.user||'', o.pemesan?.nama||'', o.pemesan?.unit||'', o.pemesan?.jabatan||'',
    o.asal||'', o.tujuan||'', o.berangkatISO||'', o.pulangISO||'', o.agenda||'', 'pending']);
  const shOG = SH(SHEETS.OGU);
  (o.tamu||[]).forEach((g,i)=>{
    shOG.appendRow([orderId, i+1, g.nama||'', g.unit||'', g.jabatan||'', g.gender||'L', g.wa||'', '', '', '', '', '']);
  });
  log_(o.pemesan?.user||o.pemesan?.nama||'', 'createOrder', {orderId});
  // notif
  telegram_(`ORDER BARU ${orderId}\n${o.pemesan?.nama||''} (${o.pemesan?.unit||''})\n${o.asal} → ${o.tujuan}\nBerangkat: ${o.berangkatISO}`, null);
  // preselect kendaraan jika ada
  if(o.preVehicleId){
    // set vehicleId di semua tamu (belum approve)
    const og = rows_(shOG);
    og.filter(x=>x.orderId===orderId).forEach(x=>x.vehicleId=o.preVehicleId);
    writeRows_(shOG, og, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
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
  const guests = g.map(x=>({ no:+x.guestNo, nama:x.nama, unit:x.unit, jabatan:x.jabatan, vehicleId:x.vehicleId||'', driverId:x.driverId||'', approved: x.approved==='TRUE' }));
  return { info, guests };
}
function allocGuest(req){
  const { orderId, guestNo, vehicleId, driverId } = req;
  const sh = SH(SHEETS.OGU); const rows = rows_(sh);
  const i = rows.findIndex(x=>x.orderId===orderId && +x.guestNo===+guestNo);
  if(i<0) throw 'Tamu tidak ada';
  rows[i].vehicleId = vehicleId||'';
  rows[i].driverId  = driverId||'';
  writeRows_(sh, rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
  // set status order allocating
  setOrderStatus_(orderId, 'allocating');
  log_('admin','allocGuest',{orderId,guestNo,vehicleId,driverId});
  // ubah status kendaraan jika ada vehicleId → allocated
  if(vehicleId) setVehicleStatus_(vehicleId,'allocated');
  return true;
}
function approveGuest(req){
  const { orderId, guestNo } = req;
  const sh = SH(SHEETS.OGU); const rows = rows_(sh);
  const i = rows.findIndex(x=>x.orderId===orderId && +x.guestNo===+guestNo);
  if(i<0) throw 'Tamu tidak ada';
  if(!rows[i].vehicleId || !rows[i].driverId) throw 'Alokasikan kendaraan & driver dulu';
  rows[i].approved = 'TRUE';
  writeRows_(sh, rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
  log_('admin','approveGuest',{orderId,guestNo});
  // kirim ke driver (notif)
  const drv = rows_(SH(SHEETS.DRV)).find(d=>d.id===rows[i].driverId);
  if(drv && drv.status!=='inactive'){
    telegram_(`TUGAS BARU untuk ${drv.name}\nOrder ${orderId} • Tamu ${rows[i].nama}`, null);
  }
  return true;
}
function approveAll(req){
  const { orderId } = req;
  const rows = rows_(SH(SHEETS.OGU)).filter(r=>r.orderId===orderId);
  if(rows.some(r=>r.approved!=='TRUE')) throw 'Masih ada tamu belum approve';
  setOrderStatus_(orderId,'approved');
  log_('admin','approveAll',{orderId});
  return true;
}
function rejectOrder(req){
  const { orderId, reason } = req;
  setOrderStatus_(orderId,'rejected');
  log_('admin','rejectOrder',{orderId,reason});
  telegram_(`ORDER ${orderId} DITOLAK.\nAlasan: ${reason||'-'}`, null);
  return true;
}
function deleteGuest(req){
  const { orderId, guestNo, reason } = req;
  const sh=SH(SHEETS.OGU); const rows=rows_(sh).filter(r=> !(r.orderId===orderId && +r.guestNo===+guestNo) );
  writeRows_(sh, rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
  log_('admin','deleteGuest',{orderId,guestNo,reason});
  return true;
}
function myTasks(req){
  const { driverUser } = req;
  // mapping driver user → Driver.id lewat user.tgId? Kita sederhanakan: username driver == nama driver (atau di masa depan, tambahkan kolom mapping).
  const drvRows = rows_(SH(SHEETS.DRV));
  const user = rows_(SH(SHEETS.USERS)).find(u=>u.username===driverUser);
  // asumsi username driver = driver name; bila tidak, gunakan tgId untuk mapping manual
  const drv = drvRows.find(d=>d.name.toLowerCase()===driverUser.toLowerCase()) || drvRows.find(d=>d.id===user?.tgId); // fallback
  if(!drv) return [];
  const og = rows_(SH(SHEETS.OGU)).filter(x=>x.driverId===drv.id && x.approved==='TRUE');
  const ord = rows_(SH(SHEETS.ORD));
  return og.map(x=>{
    const o = ord.find(k=>k.id===x.orderId)||{};
    return {
      orderId:x.orderId, guestNo:+x.guestNo, nama:x.nama,
      asal:o.asal, tujuan:o.tujuan, berangkatISO:o.berangkatISO,
      departAt:x.departAt||'', arriveAt:x.arriveAt||'',
      departAtLabel: x.departAt? fmtShort_(x.departAt):'', arriveAtLabel: x.arriveAt? fmtShort_(x.arriveAt):''
    };
  });
}
function depart(req){
  const { orderId, guestNo }=req;
  const sh=SH(SHEETS.OGU); const rows=rows_(sh);
  const i=rows.findIndex(r=>r.orderId===orderId && +r.guestNo===+guestNo);
  if(i<0) throw 'Tugas tidak ada';
  rows[i].departAt = new Date().toISOString();
  writeRows_(sh, rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
  // set kendaraan on_trip
  if(rows[i].vehicleId) setVehicleStatus_(rows[i].vehicleId,'on_trip');
  log_('driver','depart',{orderId,guestNo});
  telegram_(`BERANGKAT Order ${orderId} • ${rows[i].nama}`, null);
  return true;
}
function arrive(req){
  const { orderId, guestNo }=req;
  const sh=SH(SHEETS.OGU); const rows=rows_(sh);
  const i=rows.findIndex(r=>r.orderId===orderId && +r.guestNo===+guestNo);
  if(i<0) throw 'Tugas tidak ada';
  rows[i].arriveAt = new Date().toISOString();
  writeRows_(sh, rows, ['orderId','guestNo','nama','unit','jabatan','gender','wa','vehicleId','driverId','approved','departAt','arriveAt']);
  // jika semua tamu order sudah tiba → set vehicle available
  const sameVeh = rows.filter(r=> r.vehicleId===rows[i].vehicleId && (!r.arriveAt) );
  if(sameVeh.length===0 && rows[i].vehicleId) setVehicleStatus_(rows[i].vehicleId,'available');
  log_('driver','arrive',{orderId,guestNo});
  telegram_(`TIBA Order ${orderId} • ${rows[i].nama}`, null);
  return true;
}

/** ====== JOURNAL & DASHBOARD ====== */
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
    const d2 = g.arriveAt ? new Date(g.arriveAt) : null;
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
  const onTripGuests = og.filter(g=>g.departAt && !g.arriveAt).length;
  // top 3 vehicles by trips (arriveAt counted)
  const map = {};
  og.filter(g=>g.arriveAt).forEach(g=>{ map[g.vehicleId]= (map[g.vehicleId]||0)+1; });
  const top = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([vid,c])=>{
    const v = veh.find(x=>x.id===vid)||{};
    return { name:v.name||'(Tanpa Nama)', count:c };
  });
  return { activeVehicles, onTripGuests, topVehicles: top };
}

/** ====== helpers ====== */
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
