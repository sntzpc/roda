// cashier.js — versi stabil dengan fallback debug & route-only refresh
import { q } from './util.js';
import { showNotif } from './notif.js';
import { api } from './api.js';
import { auth } from './auth.js';
import { fmtLong } from './util.js';

// ==== Debug (fallback jika debug.js belum ada) ====
let dlog = () => {};
try {
  const dbg = await import('./debug.js');
  dlog = dbg.prefixed('[CASH]');
} catch (_e) {
  // fallback pakai global bila tersedia
  if (window.__DBG__?.prefixed) dlog = window.__DBG__.prefixed('[CASH]');
}

// ==== State ====
let data = [];
const state = { current: null };

// Helper: apakah read-only (admin/master)
function isRO(){
  const r = (auth.user?.role || '').toLowerCase();
  return r === 'admin' || r === 'master';
}

// ==== Render ====
function renderRows(items){
  const tbody = q('#tblCashier');
  if (!tbody) return;

  if (!items?.length){
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Tidak ada tugas kasir.</td></tr>`;
    // juga kunci tombol modal (jaga-jaga)
    lockCashierModals(isRO());
    return;
  }

  const ro = isRO();

  tbody.innerHTML = items.map((it, i)=>{
    const jadwal  = it.berangkatISO ? fmtLong(it.berangkatISO) : '-';
    const tamuStr = (it.guests||[]).map(g=>g.nama).join(', ');
    const aksiBtn = (it.kind==='buat_surat')
      ? `<button class="btn btn-sm btn-primary" data-letter="${i}">Buat Surat</button>`
      : `<button class="btn btn-sm btn-warning" data-ptjb="${i}">PTJB</button>`;

    // simpan ID di dataset, jangan tampilkan sebagai kolom
    return `<tr data-oid="${it.orderId}" data-did="${it.driverId}" data-vid="${it.vehicleId||''}">
      <td class="text-center">${i+1}</td>
      <td>${it.driverName||'-'}</td>
      <td>${it.vehicleName||'-'}</td>
      <td><div>${it.route||'-'}</div><div class="small text-muted">${jadwal}</div></td>
      <td>${tamuStr||'-'}</td>
      <td class="text-nowrap">${aksiBtn}</td>
    </tr>`;
  }).join('');

  if (!ro){
    // Bind actions normal
    tbody.querySelectorAll('[data-letter]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const i = +b.dataset.letter;
        openMakeLetter(items[i]);
      });
    });
    tbody.querySelectorAll('[data-ptjb]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const i = +b.dataset.ptjb;
        openPTJB(items[i]);
      });
    });
  } else {
    // READ-ONLY: matikan tombol sepenuhnya
    tbody.querySelectorAll('[data-letter],[data-ptjb]').forEach(btn=>{
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled','true');
      btn.title = 'Read only (admin/master)';
      btn.style.pointerEvents = 'none';    // cegah klik
      // opsional: hilangkan data-attr supaya handler yang lain pun tak “nyangkut”
      btn.removeAttribute('data-letter');
      btn.removeAttribute('data-ptjb');
    });
  }

  // kunci tombol di modal juga (jaga-jaga)
  lockCashierModals(ro);
}

// Kunci tombol modal (Simpan Surat / Simpan PTJB) saat RO
function lockCashierModals(ro){
  const btnLetterSave = q('#btnLetterSave');
  const btnSettleSave = q('#btnSettleSave');

  if (btnLetterSave){
    btnLetterSave.disabled = !!ro;
    btnLetterSave.classList.toggle('disabled', !!ro);
    btnLetterSave.title = ro ? 'Read only (admin/master)' : '';
  }
  if (btnSettleSave){
    btnSettleSave.disabled = !!ro;
    btnSettleSave.classList.toggle('disabled', !!ro);
    btnSettleSave.title = ro ? 'Read only (admin/master)' : '';
  }

  // Hard guard: kalau tetap diklik (misal via enter), blok di sini
  function guardClick(ev){
    if (isRO()){
      ev.preventDefault();
      ev.stopPropagation();
      showNotif('info','Mode read-only (admin/master).');
      return false;
    }
  }
  // Pasang sekali (idempotent)
  if (btnLetterSave && !btnLetterSave.__ro_guard){
    btnLetterSave.addEventListener('click', guardClick, true);
    btnLetterSave.__ro_guard = true;
  }
  if (btnSettleSave && !btnSettleSave.__ro_guard){
    btnSettleSave.addEventListener('click', guardClick, true);
    btnSettleSave.__ro_guard = true;
  }
}

// ==== Load ====
async function refreshCashier(){
  try{
    const items = await api.listCashierTasks();
    dlog('listCashierTasks hasil:', items?.length||0);
    renderRows(items||[]);
  }catch(e){
    showNotif('error', e.message || 'Gagal memuat tugas kasir');
  }
}

// ==== Surat Tugas ====
function openMakeLetter(item){
  state.current = item;
  q('#ltOrderId').value = item.orderId;
  q('#ltDriverId').value = item.driverId;
  q('#ltVehicleId').value = item.vehicleId || '';

  q('#ltNo').value = '';
  q('#ltAdvance').value = 0;
  q('#ltNote').value = '';

  bootstrap.Modal.getOrCreateInstance('#mdlLetter').show();
}

q('#btnLetterSave')?.addEventListener('click', async ()=>{
  const orderId   = q('#ltOrderId').value;
  const driverId  = q('#ltDriverId').value;
  const vehicleId = q('#ltVehicleId').value || '';
  const letterNo  = q('#ltNo').value.trim();
  const adv       = +q('#ltAdvance').value || 0;
  const note      = q('#ltNote').value.trim();

  try{
    await api.createTaskLetter({ orderId, driverId, vehicleId, letterNo, advanceAmount: adv, note });
    showNotif('success','Surat tugas dibuat');
    bootstrap.Modal.getInstance('#mdlLetter')?.hide();
    refreshCashier();
  }catch(e){
    showNotif('error', e.message || 'Gagal membuat surat');
  }
});

// ==== PTJB ====
function openPTJB(item){
  state.current = item;
  q('#stLetterNo').value = item.letterNo || '';
  q('#stAdvance').value  = +item.advanceAmount || 0;
  q('#stAmount').value   = +item.settleAmount || 0;
  q('#stNote').value     = '';
  q('#stStatus').value   = (item.status === 'pending') ? 'pending' : 'lunas';
  updateDiff();
  bootstrap.Modal.getOrCreateInstance('#mdlSettle').show();
}

function updateDiff(){
  const adv = +q('#stAdvance').value || 0;
  const stl = +q('#stAmount').value || 0;
  const diff = adv - stl; // uang muka - PTJB
  let info = `Selisih: ${diff}`;
  if (diff > 0) info += ' (LEBIH, dikembalikan driver)';
  if (diff < 0) info += ' (KURANG, dibayar perusahaan)';
  if (diff === 0) info += ' (LUNAS)';
  q('#stDiff').textContent = info;
}
q('#stAmount')?.addEventListener('input', updateDiff);

q('#btnSettleSave')?.addEventListener('click', async ()=>{
  const it = state.current; if (!it) return;
  const amount = +q('#stAmount').value || 0;
  const note   = q('#stNote').value.trim();
  const statusSel = q('#stStatus').value;           // 'lunas' / 'pending'
  const status = (statusSel === 'lunas') ? 'settled' : 'pending';
  try{
    await api.settleTaskLetter({ letterId: it.letterId, settleAmount: amount, note, status });
    showNotif('success', status==='settled' ? 'PTJB lunas' : 'PTJB tersimpan (pending)');
    bootstrap.Modal.getInstance('#mdlSettle')?.hide();
    refreshCashier();
  }catch(e){
    showNotif('error', e.message || 'Gagal menyimpan PTJB');
  }
});

// ==== Init: hanya load saat halaman Kasir dibuka / tombol Refresh ====
window.addEventListener('DOMContentLoaded', ()=>{
  q('#btnReloadCashier')?.addEventListener('click', refreshCashier);
  lockCashierModals(isRO());
});
window.addEventListener('route', (e)=>{
  if (e.detail.page === 'cashier') refreshCashier();
});
