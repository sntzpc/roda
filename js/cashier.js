// cashier.js — sinkron & ber-CCTV
import { q } from './util.js';
import { showNotif } from './notif.js';
import { api } from './api.js';
import { fmtLong } from './util.js';
import { auth } from './auth.js';

/* ===== CCTV toggle (Ctrl+Shift+D) ===== */
const DBG_KEY = 'roda_debug';
function isDbg(){ try{ return JSON.parse(localStorage.getItem(DBG_KEY)||'false'); }catch(_){ return false; } }
function dlog(...a){ if(isDbg()) console.log('[CASH]', ...a); }
window.addEventListener('keydown', (e)=>{
  if (e.ctrlKey && e.shiftKey && (e.key==='D'||e.key==='d')) {
    const v = !isDbg(); localStorage.setItem(DBG_KEY, JSON.stringify(v));
    showNotif('success', `Debug ${v?'ON':'OFF'}`);
  }
});

let data = [];
const state = { current: null };

function renderRows(items){
  const tbody = q('#tblCashier');
  if (!tbody) return;

  if (!items.length){
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Tidak ada tugas kasir.</td></tr>`;
    return;
  }

  const isRO = (auth.user?.role === 'admin' || auth.user?.role === 'master');

  tbody.innerHTML = items.map((it, i)=>{
    const jadwal = it.berangkatISO ? fmtLong(it.berangkatISO) : '-';
    const tamuStr = (it.guests||[]).map(g=>g.nama).join(', ');
    const aksiBtn = (it.kind==='buat_surat')
      ? `<button class="btn btn-sm btn-primary" data-letter="${i}" ${isRO?'disabled':''}>Buat Surat</button>`
      : `<button class="btn btn-sm btn-warning" data-ptjb="${i}" ${isRO?'disabled':''}>PTJB</button>`;

    // ID disimpan di dataset, TIDAK ditampilkan di kolom
    return `<tr data-oid="${it.orderId}" data-did="${it.driverId}" data-vid="${it.vehicleId||''}">
      <td class="text-center">${i+1}</td>
      <td>${it.driverName||'-'}</td>
      <td>${it.vehicleName||'-'}</td>
      <td><div>${it.route||'-'}</div><div class="small text-muted">${jadwal}</div></td>
      <td>${tamuStr||'-'}</td>
      <td class="text-nowrap">${aksiBtn}</td>
    </tr>`;
  }).join('');

  // Bind actions hanya jika BUKAN read-only
  if (!isRO){
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
  }
}


async function refreshCashier(){
  try{
    dlog('refreshCashier() → memanggil listCashierTasks');
    data = await api.listCashierTasks();
    dlog('listCashierTasks hasil:', data?.length ?? 0);
    if (isDbg()) console.table(data || []);
    renderRows(data);

    // Kalau masih kosong → tarik snapshot diagnosa dari GAS
    if ((!data || data.length===0) && typeof api.debugState === 'function'){
      try{
        const snap = await api.debugState({ cashier: 1 });
        dlog('CCTV snapshot kasir:', snap);
        // tampilkan ringkas di console bila ada
        if (snap && snap.cashier && Array.isArray(snap.cashier.groups)) {
          console.table(snap.cashier.groups.map(g=>({
            key: g.key, orderId: g.orderId, driver: g.driverName,
            vehicle: g.vehicleName, guests: (g.guests||[]).length,
            letters: (g.letters||[]).map(x=>x.status).join(',')
          })));
        }
      }catch(e){
        dlog('debugState cashier gagal:', e?.message||e);
      }
    }
  }catch(e){
    console.error(e);
    showNotif('error', e.message || 'Gagal memuat tugas kasir');
  }
}

/* ====== Buat Surat ====== */
function openMakeLetter(item){
  state.current = item;
  q('#ltNo').value = '';
  q('#ltAdvance').value = '0';
  q('#ltNote').value = '';
  q('#ltOrderId')?.setAttribute('value', item.orderId);
  q('#ltDriverId')?.setAttribute('value', item.driverId);
  q('#ltVehicleId')?.setAttribute('value', item.vehicleId || '');
  bootstrap.Modal.getOrCreateInstance('#mdlLetter').show();
}

q('#btnLetterSave')?.addEventListener('click', async ()=>{
  const it = state.current; if (!it) return;
  const letterNo = q('#ltNo').value.trim();
  const advance  = +q('#ltAdvance').value || 0;
  const note     = q('#ltNote').value.trim();

  try{
    dlog('createTaskLetter payload', {orderId:it.orderId,driverId:it.driverId,vehicleId:it.vehicleId,letterNo,advance});
    await api.createTaskLetter({ orderId: it.orderId, driverId: it.driverId, vehicleId: it.vehicleId||'', letterNo, advanceAmount: advance, note });
    showNotif('success','Surat tugas dibuat');
    bootstrap.Modal.getInstance('#mdlLetter')?.hide();
    refreshCashier();
  }catch(e){
    showNotif('error', e.message || 'Gagal membuat surat');
  }
});

/* ====== PTJB ====== */
function openPTJB(item){
  state.current = item;
  q('#stLetterNo').value = item.letterNo || '';
  q('#stAdvance').value  = (item.advanceAmount||0);
  q('#stAmount').value   = (item.settleAmount||0);
  q('#stNote').value     = '';
  q('#stStatus').value   = (item.status==='pending' ? 'pending' : 'lunas');
  updateDiffLabel();
  bootstrap.Modal.getOrCreateInstance('#mdlSettle').show();
}
function updateDiffLabel(){
  const adv = +q('#stAdvance').value || 0;
  const stl = +q('#stAmount').value || 0;
  const diff = adv - stl;
  let info = `Selisih: ${diff}`;
  if (diff > 0) info += ' (LEBIH, dikembalikan driver)';
  if (diff < 0) info += ' (KURANG, dibayar perusahaan)';
  if (diff === 0) info += ' (LUNAS)';
  q('#stDiff').textContent = info;
}
q('#stAmount')?.addEventListener('input', updateDiffLabel);

q('#btnSettleSave')?.addEventListener('click', async ()=>{
  const it = state.current; if (!it) return;
  const amount = +q('#stAmount').value || 0;
  const note   = q('#stNote').value.trim();
  const status = (q('#stStatus').value === 'lunas') ? 'settled' : 'pending';

  try{
    dlog('settleTaskLetter payload', {letterId:it.letterId,amount,status});
    await api.settleTaskLetter({ letterId: it.letterId, settleAmount: amount, note, status });
    showNotif('success', status==='settled' ? 'PTJB Lunas' : 'PTJB disimpan (pending)');
    bootstrap.Modal.getInstance('#mdlSettle')?.hide();
    refreshCashier();
  }catch(e){
    showNotif('error', e.message || 'Gagal menyimpan PTJB');
  }
});

/* ====== init ====== */
window.addEventListener('DOMContentLoaded', ()=>{
  dlog('DOMContentLoaded → init kasir');
  q('#btnReloadCashier')?.addEventListener('click', ()=>{
    dlog('klik Refresh');
    refreshCashier();
  });
  refreshCashier();
});
