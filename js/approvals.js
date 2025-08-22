// approvals.js — REPLACE (anti NA + BUSY + USED, rapi & ketat)
import { q } from './util.js';
import { showNotif } from './notif.js';
import { api } from './api.js';
import { isDbg, prefixed } from './debug.js';

const dlog = prefixed('[CCTV]');

// ============================
// State
// ============================
let currentOrderId = null;
let vehicles = [];
let drivers  = [];
let bsAlloc  = null; // bootstrap.Modal instance untuk #mdlAlloc

// Busy map dari dashboard
let busyVeh = new Set();
let busyDrv = new Set();

// ============================
/* Status helpers
   Kita menganggap AVAILABLE hanya jika status ada di AVAILABLE_TAGS (atau boolean available=true/active=true).
   Sisanya dianggap NA (Not Available), mis. 'maintenance', 'service', 'rusak', 'offline', 'reserved', dll.
   BUSY diambil dari dashboard (on trip/allocated/busy). */
// ============================
const safe  = (s)=> (s==null ? '' : String(s));
const lower = (s)=> safe(s).toLowerCase();

const AVAILABLE_TAGS = [
  'available','ready','free','idle','tersedia','siap','aktif','ready for use'
];
const BUSY_TAGS = [
  'allocated','on trip','in transit','departed','busy','occupied','assigned'
];

function normStatusRaw(obj, type='veh'){
  // Ambil beberapa kemungkinan field status dari payload berbeda
  let raw = obj?.status ?? obj?.state ?? obj?.availability ?? '';
  // boolean shortcut
  if (obj?.available === false) raw = raw || 'unavailable';
  if (obj?.active === false)    raw = raw || 'inactive';
  return lower(raw);
}

function isAvailableByStatus(obj, type='veh'){
  const raw = normStatusRaw(obj, type);
  if (!raw) {
    // jika tidak ada status eksplisit, kita anggap available KECUALI object punya active=false/available=false
    if (obj?.available === false || obj?.active === false) return false;
    return true;
  }
  return AVAILABLE_TAGS.includes(raw);
}

function buildBusyMapFromDashboard(dash) {
  busyVeh = new Set();
  busyDrv = new Set();
  if (dash && Array.isArray(dash.vehicles)) {
    dash.vehicles.forEach(v => {
      const id = v.id || v.vehicleId || v.vehId || v._id;
      const s  = lower(v.status || v.state || (v.on_trip ? 'on trip' : ''));
      if (id && (BUSY_TAGS.includes(s) || (s && !AVAILABLE_TAGS.includes(s)))) busyVeh.add(String(id));
    });
  }
  if (dash && Array.isArray(dash.drivers)) {
    dash.drivers.forEach(d => {
      const id = d.id || d.driverId || d._id || d.userId;
      const s  = lower(d.status || d.state || (d.on_trip ? 'on trip' : ''));
      if (id && (BUSY_TAGS.includes(s) || (s && !AVAILABLE_TAGS.includes(s)))) busyDrv.add(String(id));
    });
  }
}

// disabled jika:
// - NA (status bukan available), atau
// - busy dari dashboard, atau
// - sudah dipakai di baris lain (in-order lock) dan bukan barisnya sendiri
function isVehDisabledByFlags({ id, vehObj, usedInOrder, selfUsing }) {
  if (!id) return false;
  const na   = !isAvailableByStatus(vehObj, 'veh');
  const busy = busyVeh.has(String(id));
  const used = usedInOrder.has(String(id)) && !selfUsing;
  return na || busy || used;
}
function isDrvDisabledByFlags({ id, drvObj, usedInOrder, selfUsing }) {
  if (!id) return false;
  const na   = !isAvailableByStatus(drvObj, 'drv');
  const busy = busyDrv.has(String(id));
  const used = usedInOrder.has(String(id)) && !selfUsing;
  return na || busy || used;
}

// ============================
// Daftar Persetujuan
// ============================
async function refresh(){
  try{
    const rows = await api.listApprovals();
    const tbody = q('#tblApprovals');
    tbody.innerHTML = rows.map((r, i)=>{
      const when = (r.berangkatLabel || '') + (r.pulangLabel ? ` → ${r.pulangLabel}` : '');
      return `<tr data-oid="${r.id}">
        <td class="text-center">${i+1}</td>
        <td>${safe(r.pemesan?.nama) || '-'}</td>
        <td>${safe(r.asal)} → ${safe(r.tujuan)}</td>
        <td>${when}</td>
        <td>${safe(r.jml)}</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-primary me-1" data-view="${r.id}">
            <i class="bi bi-list-check"></i> View
          </button>
          <button class="btn btn-sm btn-outline-danger" data-reject="${r.id}">
            <i class="bi bi-x-circle"></i> Reject
          </button>
        </td>
      </tr>`;
    }).join('');

    // actions
    tbody.querySelectorAll('[data-view]').forEach(b=>{
      b.addEventListener('click', ()=>openAlloc(b.dataset.view));
    });
    tbody.querySelectorAll('[data-reject]').forEach(b=>{
      b.addEventListener('click', ()=>askReason(async (reason)=>{
        try{
          await api.rejectOrder(b.dataset.reject, reason);
          showNotif('success','Order dijadikan reject');
          refresh();
        }catch(e){ showNotif('error', e.message||'Gagal reject'); }
      }));
    });
  }catch(e){
    console.error(e);
    showNotif('error','Gagal memuat daftar persetujuan');
  }
}

// ============================
// Modal Alokasi (NA + BUSY + USED protections)
// ============================
async function openAlloc(orderId){
  currentOrderId = orderId;

  // buat instance modal
  const modalEl = document.getElementById('mdlAlloc');
  bsAlloc = bootstrap.Modal.getOrCreateInstance(modalEl);

  try {
    // master + guests + dashboard
    const [ve, dr, g, dash] = await Promise.all([
      vehicles.length ? Promise.resolve(vehicles) : api.listVehicles(),
      drivers.length  ? Promise.resolve(drivers)  : api.listDrivers(),
      api.listAllocGuests(orderId),
      api.dashboard().catch(()=>null),
    ]);
    vehicles = ve || [];
    drivers  = dr || [];
    buildBusyMapFromDashboard(dash);

    q('#allocOrderInfo').textContent = `Order ${orderId} • ${g.info||''}`;
    renderAllocRows(g.guests||[]);

    updateApproveAllState();
    bsAlloc.show();

    // tombol Debug (opsional)
    if (isDbg() && !modalEl.querySelector('[data-dbg-order]') && typeof api.debugState === 'function'){
      const hdr = modalEl.querySelector('.modal-header');
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-dark';
      btn.textContent = 'Debug';
      btn.setAttribute('data-dbg-order','1');
      btn.addEventListener('click', async ()=>{
        const snap = await api.debugState({ orderId: currentOrderId });
        dlog('SNAPSHOT ORDER', snap);
        showNotif('success','Snapshot order dikirim ke console.');
      });
      hdr.appendChild(btn);
    }
  } catch (e) {
    console.error(e);
    showNotif('error','Gagal memuat data alokasi');
  }
}

function renderAllocRows(guests){
  const tbody = q('#tblAllocGuests');

  // Kumpulan yang sudah dipakai di order (in-order locks) — ambil dari nilai awal guest
  const usedVeh = new Set();
  const usedDrv = new Set();
  guests.forEach(g => {
    const vId = String(g.vehicleId ?? g.vehicle_id ?? (g.allocated_vehicle?.id ?? ''));
    const dId = String(g.driverId  ?? g.driver_id  ?? (g.driver?.id ?? ''));
    if (vId) usedVeh.add(vId);
    if (dId) usedDrv.add(dId);
  });

  const vehOptionsHTML = (selId, selfUsing) => {
    const opts = ['<option value="">Pilih…</option>'];
    vehicles.forEach(v => {
      const id    = String(v.id ?? v.vehicleId ?? '');
      const name  = v.name || v.nama || '';
      const plate = v.plate || v.nopol || v.noPol || '';
      const raw   = normStatusRaw(v, 'veh');                 // status mentah
      const avail = isAvailableByStatus(v, 'veh');           // true = boleh pilih (kecuali busy/used)
      const busy  = busyVeh.has(id);                         // dari dashboard
      const used  = usedVeh.has(id) && !(selfUsing && selId===id);

      // final disable
      const disable = (!avail) || busy || used;

      // label status
      let badges = [];
      if (!avail) badges.push(`NA${raw ? `: ${raw.toUpperCase()}` : ''}`);
      if (busy)   badges.push('BUSY');
      if (!busy && used) badges.push('USED');
      const label = `${name || plate || id}${plate?` (${plate})`:''}${badges.length?` [${badges.join(' | ')}]`:''}`;

      opts.push(
        `<option value="${id}" ${selId===id?'selected':''} ${disable?'disabled':''}
                 data-na="${!avail?1:0}" data-busy="${busy?1:0}" data-used="${(!busy && used)?1:0}"
                 title="${raw ? raw : (avail?'available':'not available')}">
           ${label}
         </option>`
      );
    });
    return opts.join('');
  };

  const drvOptionsHTML = (selId, selfUsing) => {
    const opts = ['<option value="">Pilih…</option>'];
    drivers.forEach(d => {
      const id   = String(d.id ?? d.driverId ?? d.userId ?? '');
      const name = d.name || d.nama || '';
      const raw  = normStatusRaw(d, 'drv');
      const avail= isAvailableByStatus(d, 'drv');
      const busy = busyDrv.has(id);
      const used = usedDrv.has(id) && !(selfUsing && selId===id);

      const disable = (!avail) || busy || used;

      let badges = [];
      if (!avail) badges.push(`NA${raw ? `: ${raw.toUpperCase()}` : ''}`);
      if (busy)   badges.push('BUSY');
      if (!busy && used) badges.push('USED');
      const label = `${name || id}${badges.length?` [${badges.join(' | ')}]`:''}`;

      opts.push(
        `<option value="${id}" ${selId===id?'selected':''} ${disable?'disabled':''}
                 data-na="${!avail?1:0}" data-busy="${busy?1:0}" data-used="${(!busy && used)?1:0}"
                 title="${raw ? raw : (avail?'available':'not available')}">
           ${label}
         </option>`
      );
    });
    return opts.join('');
  };

  tbody.innerHTML = guests.map((g,i)=>{
    const gid = g.no || g.guestNo || g.index || g.id;
    const selVehId = String(g.vehicleId ?? g.vehicle_id ?? (g.allocated_vehicle?.id ?? ''));
    const selDrvId = String(g.driverId  ?? g.driver_id  ?? (g.driver?.id ?? ''));
    const ok = g.approved ? 'disabled' : '';
    return `<tr data-gn="${gid}">
      <td>${i+1}</td>
      <td>${safe(g.nama)}</td>
      <td>${safe(g.unit||'')}</td>
      <td>${safe(g.jabatan||'')}</td>
      <td>
        <select class="form-select form-select-sm selVeh" data-veh ${ok} data-prev="${selVehId}">
          ${vehOptionsHTML(selVehId, true)}
        </select>
      </td>
      <td>
        <select class="form-select form-select-sm selDrv" data-drv ${ok} data-prev="${selDrvId}">
          ${drvOptionsHTML(selDrvId, true)}
        </select>
      </td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-success" data-approve ${ok}><i class="bi bi-check2"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-del ${ok}><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  // Wire events
  const tbodyEl = q('#tblAllocGuests');
  tbodyEl.querySelectorAll('[data-veh]').forEach(sel=>{
    // simpan initial prev
    sel.dataset.prev = sel.value || '';
    sel.addEventListener('change', onVehChange);
  });
  tbodyEl.querySelectorAll('[data-drv]').forEach(sel=>{
    sel.dataset.prev = sel.value || '';
    sel.addEventListener('change', onDrvChange);
  });
  tbodyEl.querySelectorAll('[data-approve]').forEach(btn=>btn.addEventListener('click', onApproveGuest));
  tbodyEl.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', onDeleteGuest));

  // Terapkan in-order lock berdasarkan pilihan awal
  applyInOrderLocks();
  updateApproveAllState();
}

function collectCurrentSelections(){
  const tbody = q('#tblAllocGuests');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const used = {
    veh: new Map(), // id -> rowIndex
    drv: new Map(),
  };
  rows.forEach((tr, idx) => {
    const v = tr.querySelector('[data-veh]')?.value || '';
    const d = tr.querySelector('[data-drv]')?.value || '';
    if (v) used.veh.set(String(v), idx);
    if (d) used.drv.set(String(d), idx);
  });
  return used;
}

function applyInOrderLocks(){
  const tbody = q('#tblAllocGuests');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const used = collectCurrentSelections();

  rows.forEach((tr, idx) => {
    // Kendaraan options
    tr.querySelectorAll('select[data-veh] option').forEach(opt=>{
      const id = opt.value;
      if (!id) { opt.disabled = false; opt.dataset.used = '0'; return; }
      const baseNA   = opt.dataset.na === '1';
      const baseBusy = opt.dataset.busy === '1';
      const selfUsing = (used.veh.get(id) === idx);
      const shouldDisable = baseNA || baseBusy ||
        isVehDisabledByFlags({ id, vehObj: vehicles.find(v => String(v.id ?? v.vehicleId ?? '') === id), usedInOrder: new Set(used.veh.keys()), selfUsing });
      opt.disabled = shouldDisable;
      opt.dataset.used = (!baseBusy && !baseNA && shouldDisable && !selfUsing) ? '1' : (opt.dataset.used || '0');
      if (shouldDisable && !selfUsing && opt.selected) { opt.selected = false; }
    });

    // Driver options
    tr.querySelectorAll('select[data-drv] option').forEach(opt=>{
      const id = opt.value;
      if (!id) { opt.disabled = false; opt.dataset.used = '0'; return; }
      const baseNA   = opt.dataset.na === '1';
      const baseBusy = opt.dataset.busy === '1';
      const selfUsing = (used.drv.get(id) === idx);
      const shouldDisable = baseNA || baseBusy ||
        isDrvDisabledByFlags({ id, drvObj: drivers.find(d => String(d.id ?? d.driverId ?? d.userId ?? '') === id), usedInOrder: new Set(used.drv.keys()), selfUsing });
      opt.disabled = shouldDisable;
      opt.dataset.used = (!baseBusy && !baseNA && shouldDisable && !selfUsing) ? '1' : (opt.dataset.used || '0');
      if (shouldDisable && !selfUsing && opt.selected) { opt.selected = false; }
    });
  });
}

// ============================
// Perubahan pilihan per baris (dengan revert jika NA/BUSY/USED)
// ============================
async function onVehChange(ev){
  const sel = ev.target;
  const tr = sel.closest('tr');
  const guestNo = +tr.dataset.gn;
  const vehicleId = sel.value || '';
  const drvSelect = tr.querySelector('[data-drv]');

  // Jika user memilih NA/BUSY/USED → batalkan & revert
  const so = sel.selectedOptions[0];
  if (so && (so.dataset.na === '1' || so.dataset.busy === '1' || so.dataset.used === '1')) {
    showNotif('error','Kendaraan tidak tersedia untuk dipilih.');
    sel.value = sel.dataset.prev || '';
    return;
  }

  // Auto set driver default kendaraan kalau kosong & available
  if (vehicleId) {
    const veh = vehicles.find(v => String(v.id ?? v.vehicleId ?? '') === String(vehicleId));
    const cand = String(veh?.driverId ?? '');
    if (cand && !drvSelect.value) {
      const drvObj = drivers.find(d => String(d.id ?? d.driverId ?? d.userId ?? '') === cand);
      const candBusy = busyDrv.has(cand);
      const candNA   = !isAvailableByStatus(drvObj, 'drv');
      const used = collectCurrentSelections();
      if (!candBusy && !candNA && !used.drv.has(cand)) {
        drvSelect.value = cand;
      }
    }
  }

  // Sinkron ke server
  try {
    await api.allocGuest(currentOrderId, guestNo, vehicleId, drvSelect.value || '');
    sel.dataset.prev = sel.value || '';
  } catch (e) {
    console.error(e);
    showNotif('error', e.message || 'Gagal menyimpan alokasi');
    // revert jika gagal
    sel.value = sel.dataset.prev || '';
  }

  // Re-lock berdasarkan pilihan terbaru
  applyInOrderLocks();
  updateApproveAllState();
}

async function onDrvChange(ev){
  const sel = ev.target;
  const tr = sel.closest('tr');
  const guestNo = +tr.dataset.gn;
  const vehicleId = tr.querySelector('[data-veh]').value || '';
  const driverId  = sel.value || '';

  // Jika user memilih NA/BUSY/USED → batalkan & revert
  const so = sel.selectedOptions[0];
  if (so && (so.dataset.na === '1' || so.dataset.busy === '1' || so.dataset.used === '1')) {
    showNotif('error','Driver tidak tersedia untuk dipilih.');
    sel.value = sel.dataset.prev || '';
    return;
  }

  try {
    await api.allocGuest(currentOrderId, guestNo, vehicleId, driverId);
    sel.dataset.prev = sel.value || '';
  } catch (e) {
    console.error(e);
    showNotif('error', e.message || 'Gagal menyimpan alokasi');
    sel.value = sel.dataset.prev || '';
  }

  applyInOrderLocks();
  updateApproveAllState();
}

// ============================
// Approve/Delete satu tamu
// ============================
async function onApproveGuest(ev){
  const tr = ev.target.closest('tr'); 
  const guestNo = +tr.dataset.gn;
  const selVeh = tr.querySelector('[data-veh]');
  const selDrv = tr.querySelector('[data-drv]');
  const veh = selVeh.value; 
  const drv = selDrv.value;

  const vopt = selVeh.selectedOptions[0];
  const dopt = selDrv.selectedOptions[0];

  const vehNA  = vopt?.dataset?.na === '1';
  const drvNA  = dopt?.dataset?.na === '1';
  const vehBusy= vopt?.dataset?.busy === '1';
  const drvBusy= dopt?.dataset?.busy === '1';
  const vehUsed= vopt?.dataset?.used === '1';
  const drvUsed= dopt?.dataset?.used === '1';

  if (!veh || !drv) { showNotif('error','Kendaraan & driver wajib dialokasikan'); return; }
  if (vehNA || drvNA) { showNotif('error','Tidak bisa approve: kendaraan/driver tidak tersedia'); return; }
  if (vehBusy || drvBusy) { showNotif('error','Tidak bisa approve: kendaraan/driver sedang BUSY'); return; }
  if (vehUsed || drvUsed) { showNotif('error','Tidak bisa approve: kendaraan/driver sudah dipakai baris lain'); return; }

  try{
    dlog('APPROVE GUEST ->', {orderId:currentOrderId, guestNo, veh, drv});
    await api.approveGuest(currentOrderId, guestNo);
    showNotif('success','Tamu disetujui & dikirim ke Driver');
    tr.remove();

    // CCTV snapshot
    if (isDbg() && typeof api.debugState === 'function'){
      try{
        const snap = await api.debugState({ orderId: currentOrderId });
        console.log('[CCTV] POST-APPROVE SNAPSHOT');
        console.log(snap);
        if (snap.guestsDiag && snap.guestsDiag.length){
          console.table(snap.guestsDiag.map(g => ({
            guestNo: g.guestNo, nama: g.nama, driverId: g.driverId, driverName: g.driverName,
            approved: g.approved, okForTask: g.okForTask, reasons: g.reasons
          })));
        }
      }catch(_){}
    }

    finalizeOrderIfDone();
  }catch(e){
    showNotif('error', e.message||'Gagal approve tamu');
  }
}

function onDeleteGuest(ev){
  const tr = ev.target.closest('tr'); const guestNo = +tr.dataset.gn;
  askReason(async (reason)=>{
    try{
      await api.deleteGuest(currentOrderId, guestNo, reason);
      tr.remove();
      showNotif('success','Tamu dihapus dari order');
      finalizeOrderIfDone();
    }catch(e){
      showNotif('error', e.message||'Gagal menghapus tamu');
    }
  });
}

// ============================
// Approve All
// ============================
function updateApproveAllState(){
  const tbody = q('#tblAllocGuests');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const pending = rows.filter(r => r.querySelector('[data-approve]') && !r.querySelector('[data-approve]').disabled);

  if (pending.length === 0){ q('#btnApproveAll').disabled = true; return; }

  const invalid = pending.some(r=>{
    const vSel = r.querySelector('[data-veh]');
    const dSel = r.querySelector('[data-drv]');
    const v    = vSel.value;
    const d    = dSel.value;
    const vNA  = vSel.selectedOptions[0]?.dataset?.na   === '1';
    const dNA  = dSel.selectedOptions[0]?.dataset?.na   === '1';
    const vBusy= vSel.selectedOptions[0]?.dataset?.busy === '1';
    const dBusy= dSel.selectedOptions[0]?.dataset?.busy === '1';
    const vUsed= vSel.selectedOptions[0]?.dataset?.used === '1';
    const dUsed= dSel.selectedOptions[0]?.dataset?.used === '1';
    return !(v && d) || vNA || dNA || vBusy || dBusy || vUsed || dUsed;
  });
  q('#btnApproveAll').disabled = invalid;
}

q('#btnApproveAll').addEventListener('click', async ()=>{
  const tbody = q('#tblAllocGuests');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const pending = rows.filter(r => r.querySelector('[data-approve]') && !r.querySelector('[data-approve]').disabled);

  if (!pending.length){ return; }

  const hasInvalid = pending.some(r=>{
    const vSel = r.querySelector('[data-veh]');
    const dSel = r.querySelector('[data-drv]');
    const v    = vSel.value;
    const d    = dSel.value;
    const vNA  = vSel.selectedOptions[0]?.dataset?.na   === '1';
    const dNA  = dSel.selectedOptions[0]?.dataset?.na   === '1';
    const vBusy= vSel.selectedOptions[0]?.dataset?.busy === '1';
    const dBusy= dSel.selectedOptions[0]?.dataset?.busy === '1';
    const vUsed= vSel.selectedOptions[0]?.dataset?.used === '1';
    const dUsed= dSel.selectedOptions[0]?.dataset?.used === '1';
    return !(v && d) || vNA || dNA || vBusy || dBusy || vUsed || dUsed;
  });
  if (hasInvalid){
    showNotif('error','Masih ada tamu yang belum valid (kosong/NA/BUSY/duplikat).');
    return;
  }

  // sinkron alokasi terakhir (jaga-jaga)
  for (const r of pending){
    const gn  = +r.getAttribute('data-gn');
    const veh = r.querySelector('[data-veh]').value || '';
    const drv = r.querySelector('[data-drv]').value || '';
    await api.allocGuest(currentOrderId, gn, veh, drv);
  }

  try{
    dlog('APPROVE ALL ->', {orderId:currentOrderId, pending: pending.map(r=>+r.getAttribute('data-gn'))});
    await api.approveAll(currentOrderId);

    // CCTV snapshot
    if (isDbg() && typeof api.debugState === 'function'){
      try{
        const snap = await api.debugState({ orderId: currentOrderId });
        console.log('[CCTV] POST-APPROVE-ALL SNAPSHOT');
        console.log(snap);
        if (snap.guestsDiag && snap.guestsDiag.length){
          console.table(snap.guestsDiag.map(g => ({
            guestNo: g.guestNo, nama: g.nama, driverId: g.driverId, driverName: g.driverName,
            approved: g.approved, okForTask: g.okForTask, reasons: g.reasons
          })));
        }
      }catch(_){}
    }

    showNotif('success','Semua tamu disetujui & dikirim ke Driver');
    bsAlloc?.hide();

    // hapus baris order dari daftar
    const listTbody = q('#tblApprovals');
    const btn = listTbody?.querySelector(`[data-view="${currentOrderId}"]`);
    btn?.closest('tr')?.remove();
  }catch(e){
    showNotif('error', e.message||'Gagal Approve All');
  }
});

// ============================
// Finalize order jika semua selesai
// ============================
function finalizeOrderIfDone(){
  const tbody = q('#tblAllocGuests');
  const pending = tbody.querySelector('button[data-approve]:not([disabled])');
  if (!pending){
    bsAlloc?.hide();
    const listTbody = q('#tblApprovals');
    const btn = listTbody?.querySelector(`[data-view="${currentOrderId}"]`);
    btn?.closest('tr')?.remove();
  }else{
    updateApproveAllState();
  }
}

// ============================
// Modal alasan
// ============================
function askReason(cb){
  q('#reasonText').value='';
  const mdlEl = document.getElementById('mdlReason');
  const mdl = bootstrap.Modal.getOrCreateInstance(mdlEl);
  mdl.show();
  const ok = q('#btnReasonOk');

  const handler = ()=>{
    ok.removeEventListener('click', handler);
    const reason = q('#reasonText').value.trim();
    cb(reason);
    mdl.hide();
  };
  ok.addEventListener('click', handler);
}

// ============================
// Init
// ============================
window.addEventListener('DOMContentLoaded', ()=>{
  q('#btnReloadApprovals')?.addEventListener('click', refresh);
});
window.addEventListener('route', e=>{
  if (e.detail.page === 'approvals') refresh();
});
