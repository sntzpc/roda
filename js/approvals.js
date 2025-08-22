// approvals.js — REPLACE (rapi & anti double-alokasi)
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
// Util
// ============================
const safe  = (s)=> (s==null ? '' : String(s));
const lower = (s)=> safe(s).toLowerCase();
const FREE_TAGS = ['free','available','idle'];
const BUSY_TAGS = ['allocated','on trip','in transit','departed','busy'];

function buildBusyMapFromDashboard(dash) {
  busyVeh = new Set();
  busyDrv = new Set();
  if (dash && Array.isArray(dash.vehicles)) {
    dash.vehicles.forEach(v => {
      const id = v.id || v.vehicleId || v.vehId || v._id;
      const s  = lower(v.status || v.state || (v.on_trip ? 'on trip' : ''));
      if (id && (BUSY_TAGS.includes(s) || (s && !FREE_TAGS.includes(s)))) busyVeh.add(String(id));
    });
  }
  if (dash && Array.isArray(dash.drivers)) {
    dash.drivers.forEach(d => {
      const id = d.id || d.driverId || d._id || d.userId;
      const s  = lower(d.status || d.state || (d.on_trip ? 'on trip' : ''));
      if (id && (BUSY_TAGS.includes(s) || (s && !FREE_TAGS.includes(s)))) busyDrv.add(String(id));
    });
  }
}

// disabled jika:
// - busy dari dashboard; atau
// - sudah dipakai di baris lain (in-order lock)
function isVehDisabled(id, usedInOrder, selfUsing) {
  if (!id) return false;
  if (busyVeh.has(String(id))) return true;
  if (usedInOrder.has(String(id)) && !selfUsing) return true;
  return false;
}
function isDrvDisabled(id, usedInOrder, selfUsing) {
  if (!id) return false;
  if (busyDrv.has(String(id))) return true;
  if (usedInOrder.has(String(id)) && !selfUsing) return true;
  return false;
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
// Modal Alokasi (anti double-alokasi)
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
    const vId = String(g.vehicleId ?? g.vehicle_id ?? g.allocated_vehicle?.id ?? '' || '');
    const dId = String(g.driverId  ?? g.driver_id  ?? g.driver?.id ?? '' || '');
    if (vId) usedVeh.add(vId);
    if (dId) usedDrv.add(dId);
  });

  const vehOptionsHTML = (selId, selfUsing) => {
    const opts = ['<option value="">Pilih…</option>'];
    vehicles.forEach(v => {
      const id    = String(v.id ?? v.vehicleId ?? '');
      const name  = v.name || v.nama || '';
      const plate = v.plate || v.nopol || v.noPol || '';
      const busy  = busyVeh.has(id);
      const locked= isVehDisabled(id, usedVeh, selfUsing && selId===id);
      const dis   = (busy || locked) ? 'disabled' : '';
      const lbl   = `${name || plate || id}${plate?` (${plate})`:''}${busy?' [BUSY]':''}${(!busy && locked)?' [USED]':''}`;
      opts.push(`<option value="${id}" ${selId===id?'selected':''} ${dis} data-busy="${busy?1:0}" data-used="${(!busy && locked)?1:0}">${lbl}</option>`);
    });
    return opts.join('');
  };

  const drvOptionsHTML = (selId, selfUsing) => {
    const opts = ['<option value="">Pilih…</option>'];
    drivers.forEach(d => {
      const id   = String(d.id ?? d.driverId ?? d.userId ?? '');
      const name = d.name || d.nama || '';
      const busy = busyDrv.has(id);
      const locked= isDrvDisabled(id, usedDrv, selfUsing && selId===id);
      const dis  = (busy || locked) ? 'disabled' : '';
      const lbl  = `${name || id}${busy?' [BUSY]':''}${(!busy && locked)?' [USED]':''}`;
      opts.push(`<option value="${id}" ${selId===id?'selected':''} ${dis} data-busy="${busy?1:0}" data-used="${(!busy && locked)?1:0}">${lbl}</option>`);
    });
    return opts.join('');
  };

  tbody.innerHTML = guests.map((g,i)=>{
    const gid = g.no || g.guestNo || g.index || g.id;
    const selVehId = String(g.vehicleId ?? g.vehicle_id ?? g.allocated_vehicle?.id ?? '' || '');
    const selDrvId = String(g.driverId  ?? g.driver_id  ?? g.driver?.id ?? '' || '');
    const ok = g.approved ? 'disabled' : '';
    return `<tr data-gn="${gid}">
      <td>${i+1}</td>
      <td>${safe(g.nama)}</td>
      <td>${safe(g.unit||'')}</td>
      <td>${safe(g.jabatan||'')}</td>
      <td>
        <select class="form-select form-select-sm" data-veh ${ok}>
          ${vehOptionsHTML(selVehId, true)}
        </select>
      </td>
      <td>
        <select class="form-select form-select-sm" data-drv ${ok}>
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
  tbody.querySelectorAll('[data-veh]').forEach(sel=>sel.addEventListener('change', onVehChange));
  tbody.querySelectorAll('[data-drv]').forEach(sel=>sel.addEventListener('change', onDrvChange));
  tbody.querySelectorAll('[data-approve]').forEach(btn=>btn.addEventListener('click', onApproveGuest));
  tbody.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', onDeleteGuest));

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
    tr.querySelectorAll('[data-veh] option').forEach(opt=>{
      const id = opt.value;
      if (!id) { opt.disabled = false; opt.dataset.used = '0'; return; }
      const selfUsing = (used.veh.get(id) === idx);
      const shouldDisable = isVehDisabled(id, new Set(used.veh.keys()), selfUsing);
      opt.disabled = shouldDisable;
      opt.dataset.used = (!busyVeh.has(id) && shouldDisable && !selfUsing) ? '1' : '0';
      // pertahankan selected meski disabled jika selfUsing (boleh; user sudah memilihnya)
      if (shouldDisable && !selfUsing && opt.selected) { opt.selected = false; }
    });

    // Driver options
    tr.querySelectorAll('[data-drv] option').forEach(opt=>{
      const id = opt.value;
      if (!id) { opt.disabled = false; opt.dataset.used = '0'; return; }
      const selfUsing = (used.drv.get(id) === idx);
      const shouldDisable = isDrvDisabled(id, new Set(used.drv.keys()), selfUsing);
      opt.disabled = shouldDisable;
      opt.dataset.used = (!busyDrv.has(id) && shouldDisable && !selfUsing) ? '1' : '0';
      if (shouldDisable && !selfUsing && opt.selected) { opt.selected = false; }
    });
  });
}

// ============================
// Perubahan pilihan per baris
// ============================
async function onVehChange(ev){
  const tr = ev.target.closest('tr');
  const guestNo = +tr.dataset.gn;
  const vehicleId = ev.target.value || '';
  const drvSelect = tr.querySelector('[data-drv]');

  // Auto set driver default kendaraan kalau kosong & tidak busy/terkunci
  if (vehicleId) {
    const veh = vehicles.find(v => String(v.id ?? v.vehicleId ?? '') === String(vehicleId));
    const cand = String(veh?.driverId ?? '');
    if (cand && !drvSelect.value && !busyDrv.has(cand)) {
      // pastikan tidak terkunci oleh baris lain
      const used = collectCurrentSelections();
      if (!used.drv.has(cand)) drvSelect.value = cand;
    }
  }

  // Sinkron ke server
  try {
    await api.allocGuest(currentOrderId, guestNo, vehicleId, drvSelect.value || '');
  } catch (e) {
    console.error(e);
    showNotif('error', e.message || 'Gagal menyimpan alokasi');
  }

  // Re-lock berdasarkan pilihan terbaru
  applyInOrderLocks();
  updateApproveAllState();
}

async function onDrvChange(ev){
  const tr = ev.target.closest('tr');
  const guestNo = +tr.dataset.gn;
  const vehicleId = tr.querySelector('[data-veh]').value || '';
  const driverId  = ev.target.value || '';

  try {
    await api.allocGuest(currentOrderId, guestNo, vehicleId, driverId);
  } catch (e) {
    console.error(e);
    showNotif('error', e.message || 'Gagal menyimpan alokasi');
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

  const vehBusy = selVeh.selectedOptions[0]?.dataset?.busy === '1';
  const drvBusy = selDrv.selectedOptions[0]?.dataset?.busy === '1';
  const vehUsed = selVeh.selectedOptions[0]?.dataset?.used === '1';
  const drvUsed = selDrv.selectedOptions[0]?.dataset?.used === '1';

  if (!veh || !drv) { showNotif('error','Kendaraan & driver wajib dialokasikan'); return; }
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
    const vBusy= vSel.selectedOptions[0]?.dataset?.busy === '1';
    const dBusy= dSel.selectedOptions[0]?.dataset?.busy === '1';
    const vUsed= vSel.selectedOptions[0]?.dataset?.used === '1';
    const dUsed= dSel.selectedOptions[0]?.dataset?.used === '1';
    return !(v && d) || vBusy || dBusy || vUsed || dUsed;
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
    const vBusy= vSel.selectedOptions[0]?.dataset?.busy === '1';
    const dBusy= dSel.selectedOptions[0]?.dataset?.busy === '1';
    const vUsed= vSel.selectedOptions[0]?.dataset?.used === '1';
    const dUsed= dSel.selectedOptions[0]?.dataset?.used === '1';
    return !(v && d) || vBusy || dBusy || vUsed || dUsed;
  });
  if (hasInvalid){
    showNotif('error','Masih ada tamu yang belum valid (kosong/BUSY/duplikat).');
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
