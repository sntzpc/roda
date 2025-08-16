// approvals.js — versi bersih (tanpa duplikasi fungsi)
import { q } from './util.js';
import { showNotif } from './notif.js';
import { api } from './api.js';

/* ====== (opsional) CCTV toggle ====== */
const DBG_KEY = 'roda_debug';
function isDbg(){ try{ return JSON.parse(localStorage.getItem(DBG_KEY)||'false'); }catch(_){ return false; } }
function dlog(...args){ if(isDbg()) console.log('[CCTV]', ...args); }
window.addEventListener('keydown', (e)=>{
  if (e.ctrlKey && e.shiftKey && (e.key==='D' || e.key==='d')) {
    const v = !isDbg(); localStorage.setItem(DBG_KEY, JSON.stringify(v));
    showNotif('success', `Debug ${v?'ON':'OFF'}`);
  }
});

/* ====== state ====== */
let currentOrderId = null;
let vehicles = [], drivers = [];

/* ====== tabel daftar persetujuan ====== */
// approvals.js — GANTI fungsi refresh() dengan ini
async function refresh(){
  const rows = await api.listApprovals();
  const tbody = q('#tblApprovals');     // pastikan ini <tbody id="tblApprovals">
  tbody.innerHTML = rows.map((r, i)=>{
    const when = r.berangkatLabel + (r.pulangLabel ? ` → ${r.pulangLabel}` : '');
    return `<tr data-oid="${r.id}">
      <td class="text-center">${i+1}</td>          <!-- No urut -->
      <!-- ID tidak ditampilkan -->
      <td>${r.pemesan?.nama || '-'}</td>
      <td>${r.asal} → ${r.tujuan}</td>
      <td>${when}</td>
      <td>${r.jml}</td>
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
}


/* ====== modal alokasi ====== */
async function openAlloc(orderId){
  currentOrderId = orderId;

  // master data
  [vehicles, drivers] = await Promise.all([api.listVehicles(), api.listDrivers()]);
  const g = await api.listAllocGuests(orderId);

  q('#allocOrderInfo').textContent = `Order ${orderId} • ${g.info||''}`;
  renderAllocRows(g.guests||[]);
  updateApproveAllState();

  // tampilkan modal
  const modalEl = document.getElementById('mdlAlloc');
  const modal   = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

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
}

function renderAllocRows(guests){
  const tbody = q('#tblAllocGuests');
  tbody.innerHTML = guests.map((g,i)=>{
    const vehOpt = ['<option value="">Pilih…</option>']
      .concat(vehicles.map(v=>`<option value="${v.id}" ${g.vehicleId===v.id?'selected':''}>${v.name||v.plate||v.id}</option>`))
      .join('');
    const drvOpt = ['<option value="">Pilih…</option>']
      .concat(drivers.map(d=>`<option value="${d.id}" ${g.driverId===d.id?'selected':''}>${d.name||d.id}</option>`))
      .join('');
    const ok = g.approved ? 'disabled' : '';
    return `<tr data-gn="${g.no}">
      <td>${i+1}</td>
      <td>${g.nama}</td>
      <td>${g.unit||''}</td>
      <td>${g.jabatan||''}</td>
      <td><select class="form-select form-select-sm" data-veh ${ok}>${vehOpt}</select></td>
      <td><select class="form-select form-select-sm" data-drv ${ok}>${drvOpt}</select></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-success" data-approve ${ok}><i class="bi bi-check2"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-del ${ok}><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  // simpan alokasi saat kendaraan/driver berubah
  tbody.querySelectorAll('[data-veh]').forEach(sel=>sel.addEventListener('change', onVehChange));
  tbody.querySelectorAll('[data-drv]').forEach(sel=>sel.addEventListener('change', onDrvChange));

  // aksi
  tbody.querySelectorAll('[data-approve]').forEach(btn=>btn.addEventListener('click', onApproveGuest));
  tbody.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', onDeleteGuest));
}

async function onVehChange(ev){
  const tr = ev.target.closest('tr'); const guestNo = +tr.dataset.gn;
  const vehicleId = ev.target.value || '';
  const drvSelect = tr.querySelector('[data-drv]');

  // auto set driver default kendaraan jika driver belum dipilih
  const veh = vehicles.find(v=>v.id===vehicleId);
  if (veh && veh.driverId && !drvSelect.value) drvSelect.value = veh.driverId;

  await api.allocGuest(currentOrderId, guestNo, vehicleId, drvSelect.value||'');
  updateApproveAllState();
}
async function onDrvChange(ev){
  const tr = ev.target.closest('tr'); const guestNo = +tr.dataset.gn;
  const vehicleId = tr.querySelector('[data-veh]').value || '';
  const driverId  = ev.target.value || '';
  await api.allocGuest(currentOrderId, guestNo, vehicleId, driverId);
  updateApproveAllState();
}

async function onApproveGuest(ev){
  const tr = ev.target.closest('tr'); const guestNo = +tr.dataset.gn;
  const veh = tr.querySelector('[data-veh]').value; const drv = tr.querySelector('[data-drv]').value;
  if(!veh||!drv){ showNotif('error','Kendaraan & driver wajib dialokasikan'); return; }
  try{
    dlog('APPROVE GUEST ->', {orderId:currentOrderId, guestNo, veh, drv});
    await api.approveGuest(currentOrderId, guestNo);
    showNotif('success','Tamu disetujui & dikirim ke Driver');
    tr.remove();

    // === CCTV: snapshot setelah APPROVE satu tamu ===
    if (isDbg() && typeof api.debugState === 'function'){
      try{
        const snap = await api.debugState({ orderId: currentOrderId });
        console.log('[CCTV] POST-APPROVE SNAPSHOT');
        console.log(snap);
        if (snap.guestsDiag && snap.guestsDiag.length){
          console.table(snap.guestsDiag.map(g => ({
            guestNo: g.guestNo,
            nama: g.nama,
            driverId: g.driverId,
            driverName: g.driverName,
            approved: g.approved,
            okForTask: g.okForTask,
            reasons: g.reasons
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

function updateApproveAllState(){
  const tbody = q('#tblAllocGuests');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const pending = rows.filter(r => !r.querySelector('[data-approve]').disabled);

  if (pending.length === 0){
    q('#btnApproveAll').disabled = true;
    return;
  }
  const anyMissing = pending.some(r=>{
    const veh = r.querySelector('[data-veh]').value;
    const drv = r.querySelector('[data-drv]').value;
    return !(veh && drv);
  });
  q('#btnApproveAll').disabled = anyMissing;
}

function finalizeOrderIfDone(){
  const tbody = q('#tblAllocGuests');
  const pending = tbody.querySelector('button[data-approve]:not([disabled])');
  if (!pending){
    // tutup modal
    const inst = bootstrap.Modal.getInstance('#mdlAlloc'); inst?.hide();
    // hapus baris order dari daftar
    const listTbody = q('#tblApprovals');
    const btn = listTbody?.querySelector(`[data-view="${currentOrderId}"]`);
    btn?.closest('tr')?.remove();
  }else{
    updateApproveAllState();
  }
}

/* ====== Approve All ====== */
q('#btnApproveAll').addEventListener('click', async ()=>{
  const tbody = q('#tblAllocGuests');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const pending = rows.filter(r => !r.querySelector('[data-approve]').disabled);
  const anyMissing = pending.some(r=>{
    const veh = r.querySelector('[data-veh]').value;
    const drv = r.querySelector('[data-drv]').value;
    return !(veh && drv);
  });
  if (pending.length && anyMissing){
    showNotif('error','Masih ada tamu yang belum dialokasikan kendaraan & driver.');
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

    // === CCTV: snapshot setelah APPROVE ALL ===
    if (isDbg() && typeof api.debugState === 'function'){
      try{
        const snap = await api.debugState({ orderId: currentOrderId });
        console.log('[CCTV] POST-APPROVE-ALL SNAPSHOT');
        console.log(snap);
        if (snap.guestsDiag && snap.guestsDiag.length){
          console.table(snap.guestsDiag.map(g => ({
            guestNo: g.guestNo,
            nama: g.nama,
            driverId: g.driverId,
            driverName: g.driverName,
            approved: g.approved,
            okForTask: g.okForTask,
            reasons: g.reasons
          })));
        }
      }catch(_){}
    }

    showNotif('success','Semua tamu disetujui & dikirim ke Driver');
    const inst = bootstrap.Modal.getInstance('#mdlAlloc'); inst?.hide();
    const listTbody = q('#tblApprovals');
    const btn = listTbody?.querySelector(`[data-view="${currentOrderId}"]`);
    btn?.closest('tr')?.remove();
  }catch(e){
    showNotif('error', e.message||'Gagal Approve All');
  }
});

/* ====== Modal alasan ====== */
function askReason(cb){
  q('#reasonText').value='';
  const mdl = bootstrap.Modal.getOrCreateInstance('#mdlReason');
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

/* ====== init ====== */
window.addEventListener('DOMContentLoaded', ()=>{
  q('#btnReloadApprovals')?.addEventListener('click', refresh);
});
window.addEventListener('route', e=>{
  if (e.detail.page === 'approvals') refresh();
});
