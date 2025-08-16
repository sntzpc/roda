// driver.js — tampilan per-ORDER + checklist & aksi massal
import { q } from './util.js';
import { api } from './api.js';
import { auth } from './auth.js';
import { showNotif } from './notif.js';

/* ====== Debug toggle (optional) ====== */
const DBG_KEY = 'roda_debug';
function isDbg(){ try{ return JSON.parse(localStorage.getItem(DBG_KEY)||'false'); }catch(_){ return false; } }
function dlog(...args){ if(isDbg()) console.log('[CCTV]', ...args); }

/* ====== Cache ringan ====== */
const orderMetaCache = new Map();   // orderId -> { pemesanNama, berangkatISO, asal, tujuan }
const orderGuestsCache = new Map(); // orderId -> full snapshot (debugState)
const checklistByOrder = new Map(); // orderId -> { checked:Set<number>, notes:Map<number,string> }

/* ====== Util ringkas ====== */
const fmt2 = n=>n<10?('0'+n):n;
const fmtShort = iso => {
  if(!iso) return '-';
  const d=new Date(iso);
  return `${fmt2(d.getDate())}/${fmt2(d.getMonth()+1)}/${d.getFullYear()} ${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
};

/* ====== Ambil meta order (cache) ====== */
async function getOrderMeta(orderId){
  if (orderMetaCache.has(orderId)) return orderMetaCache.get(orderId);
  // ambil via debugState agar dapat pemesanNama
  const snap = await api.debugState({ orderId });
  const o = snap?.order || {};
  const meta = {
    pemesanNama: o.pemesanNama || '-',
    berangkatISO: o.berangkatISO || '',
    asal: o.asal || '',
    tujuan: o.tujuan || ''
  };
  orderMetaCache.set(orderId, meta);
  // simpan juga snapshot tamu untuk dipakai modal
  orderGuestsCache.set(orderId, snap || {});
  return meta;
}

/* ====== Render baris ringkas per-ORDER ====== */
function rowHtml(group, meta, i, readonly){
  // group: { orderId, items:[...], count, allDeparted, allArrived }
  const act =
    group.allDeparted
      ? `<button class="btn btn-sm btn-success" data-act="arrive" data-oid="${group.orderId}">Tiba</button>`
      : `<button class="btn btn-sm btn-primary" data-act="depart" data-oid="${group.orderId}" disabled>Berangkat</button>`;

  return `<tr data-oid="${group.orderId}" data-readonly="${readonly ? '1':'0'}">
    <td>${meta.pemesanNama}</td>
    <td class="text-center">${group.count}</td>
    <td>${meta.asal||group.asal||'-'} → ${meta.tujuan||group.tujuan||'-'}</td>
    <td>${fmtShort(meta.berangkatISO || group.items?.[0]?.berangkatISO)}</td>
    <td class="text-nowrap">
      <button class="btn btn-sm btn-outline-secondary" data-view="${group.orderId}">
        View
      </button>
    </td>
    <td class="text-nowrap">${act}</td>
  </tr>`;
}

/* ====== Kumpulkan & kelompokkan tugas dari myTasks() ====== */
async function loadDriverTasks(){
  if (!auth.user) return;
  try{
    const readonly = (auth.user?.role === 'admin' || auth.user?.role === 'master');

    // PENTING:
    // - Driver: hanya tugas miliknya
    // - Admin/Master: semua tugas (read-only)
    const username = auth.user.username;
    const rows = readonly ? await api.myTasksAll()
                          : await api.myTasks(username);

    dlog('HASIL myTasks-like →', (rows||[]).length);

    const tbody = q('#tblDriver'); if (!tbody) return;

    if (!rows || rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada tugas.</td></tr>`;
      return;
    }

    // Kelompokkan per orderId
    const byOrder = new Map();
    rows.forEach(r=>{
      if(!byOrder.has(r.orderId)) byOrder.set(r.orderId, []);
      byOrder.get(r.orderId).push(r);
    });

    // Ambil meta paralel
    const orderIds = Array.from(byOrder.keys());
    const metas = await Promise.all(orderIds.map(getOrderMeta));
    const metaById = {}; orderIds.forEach((id,idx)=> metaById[id] = metas[idx]);

    // Bentuk grup per order
    const groups = orderIds.map((orderId, i)=>{
      const items = byOrder.get(orderId) || [];
      const allDeparted = items.length>0 && items.every(x => !!(x.departAt || x.noDepartNote));
      const allArrived  = items.length>0 && items.every(x => !!x.arriveAt || !!x.noDepartNote);
      return {
        orderId, items,
        count: items.length,
        asal: items[0]?.asal || '',
        tujuan: items[0]?.tujuan || '',
        allDeparted, allArrived,
        idx: i
      };
    });

    // Tampilkan hanya yang belum semua tiba
    const shown = groups.filter(g=>!g.allArrived);

    if (!shown.length){
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Semua tugas selesai.</td></tr>`;
      return;
    }

    tbody.innerHTML = shown.map(g=> rowHtml(g, metaById[g.orderId]||{}, g.idx, readonly)).join('');

    // Read-only admin/master → matikan tombol aksi (tetap bisa View)
    if (readonly){
      tbody.querySelectorAll('[data-act]').forEach(btn=>{
        btn.disabled = true; btn.classList.add('disabled');
        btn.title = 'Read only (admin/master)';
      });
    }

  }catch(e){
    showNotif('error', e.message || 'Gagal memuat tugas driver');
  }
}

// === helper: kunci semua kontrol checklist di modal View ===
function disableChecklistUI(orderId){
  // Cari modal "View" yang sedang terbuka. Sesuaikan selector id kalau perlu.
  const modal =
    document.querySelector('.modal.show[data-oid="'+orderId+'"]') || // modal punya data-oid
    document.querySelector('#mdlDrvView') ||                         // fallback id yg kita pakai
    document.querySelector('.modal.show');                           // last resort: modal aktif

  if (!modal) return;

  // Matikan semua checkbox & textarea (biarkan tombol Tutup tetap aktif)
  modal.querySelectorAll('input[type="checkbox"], textarea').forEach(el => { el.disabled = true; });

  // Nonaktifkan tombol Simpan Checklist kalau ada
  const btnSave = modal.querySelector('#btnSaveChecklist');
  if (btnSave) { btnSave.disabled = true; btnSave.classList.add('disabled'); }

  // (opsional) ubah hint/label status
  const hint = modal.querySelector('[data-checklist-hint]');
  if (hint) hint.textContent = 'Checklist terkunci karena keberangkatan sudah dicatat.';
}


/* ====== Modal: buka & render detail tamu per ORDER ====== */
async function openView(orderId){
  // Ambil snapshot dari cache atau panggil lagi
  let snap = orderGuestsCache.get(orderId);
  if (!snap) {
    snap = await api.debugState({ orderId });
    orderGuestsCache.set(orderId, snap);
  }

  // Cari driver.id yang sedang login
  let myDrvId = '';
  // coba dari mapping (kalau user panggil debugState(driverUser) sebelumnya mungkin kosong)
  if (snap?.mapping?.matchedDrv?.id) {
    myDrvId = snap.mapping.matchedDrv.id;
  } else {
    // fallback: cari driver berdasar Users.userId = auth.user.username
    const drv = (snap?.drivers || snap?.D || []).find(d => d.userId === auth.user.username);
    if (drv) myDrvId = drv.id;
    if (!myDrvId) {
      // jika snapshot order tidak punya daftar driver, ambil satu snapshot driverUser
      try{
        const s2 = await api.debugState({ driverUser: auth.user.username });
        myDrvId = s2?.mapping?.matchedDrv?.id || myDrvId;
      }catch(_) {}
    }
  }

  const o = snap?.order || {};
  const guestsAll = snap?.guests || [];
  // Tamu milik driver & sudah approved
  const myGuests = guestsAll.filter(g => g.driverId === myDrvId && String(g.approved).toUpperCase()==='TRUE');

  // Render tabel modal
  q('#dgOrderId').textContent = orderId;
  q('#dgOrderInfo').textContent =
    `${o.pemesanNama||'-'} • ${o.asal||'-'} → ${o.tujuan||'-'} • ${fmtShort(o.berangkatISO)}`;

  const saved = checklistByOrder.get(orderId) || { checked:new Set(), notes:new Map() };
  const TB = q('#tblGuestDetail');
  TB.innerHTML = myGuests.map(g=>{
    const no = +g.guestNo;
    const alreadyDeparted = !!(g.departAt) || !!(g.noDepartNote);
    const checked = alreadyDeparted || saved.checked.has(no);
    const note = saved.notes.get(no) || (g.noDepartNote || '');
    return `<tr data-gn="${no}">
      <td class="text-center">${no}</td>
      <td>${g.nama||'-'}</td>
      <td>${g.unit||''}</td>
      <td>${g.jabatan||''}</td>
      <td>${g.gender||''}</td>
      <td>${g.wa||''}</td>
      <td class="text-center">
        <input type="checkbox" ${checked?'checked':''} ${alreadyDeparted?'disabled':''} />
      </td>
      <td>
        <input type="text" class="form-control form-control-sm" placeholder="Wajib diisi jika tidak dicentang"
               value="${note.replace(/"/g,'&quot;')}" ${alreadyDeparted?'disabled':''} />
      </td>
    </tr>`;
  }).join('');

  // Simpan checklist
  const btnSave = q('#btnSaveChecklist');
  btnSave.onclick = ()=>{
    const checked = new Set();
    const notes   = new Map();
    let ok = true;

    TB.querySelectorAll('tr').forEach(tr=>{
      const gn = +tr.getAttribute('data-gn');
      const cb = tr.querySelector('input[type="checkbox"]');
      const tx = tr.querySelector('input[type="text"]');
      const isChecked = cb?.checked;
      const isDisabled = cb?.disabled;

      if (isDisabled) {
        // yang sudah berangkat → anggap checked & abaikan note
        checked.add(gn);
        return;
      }
      if (isChecked) {
        checked.add(gn);
      } else {
        const note = (tx?.value||'').trim();
        if (!note) ok = false;
        notes.set(gn, note);
      }
    });

    if (!ok) {
      showNotif('error','Ada tamu yang tidak dicentang dan belum ada keterangannya.');
      return;
    }

    checklistByOrder.set(orderId, { checked, notes });
    showNotif('success','Checklist disimpan.');

    // aktifkan tombol "Aksi Berangkat" di baris order ini
    const rowBtn = document.querySelector(`[data-oid="${orderId}"] [data-act="depart"]`);
    if (rowBtn) rowBtn.disabled = false;

    // tutup modal
    bootstrap.Modal.getOrCreateInstance('#mdlDriverGuests').hide();
  };

  // tampilkan modal
  bootstrap.Modal.getOrCreateInstance('#mdlDriverGuests').show();
}

/* ====== Proses Berangkat (massal) ====== */
async function doDepart(orderId){
  const saved = checklistByOrder.get(orderId);
  if (!saved || !saved.checked){
    showNotif('error','Silakan klik "View" dan simpan checklist terlebih dahulu.');
    return;
  }

  try{
    // 1) tamu yang dicentang → depart
    for (const gn of saved.checked){
      await api.depart(orderId, gn);
    }
    // 2) tamu yang TIDAK dicentang → skipGuest (wajib ada note)
    for (const [gn, note] of saved.notes.entries()){
      await api.skipGuest(orderId, gn, note);
    }

    showNotif('success','Berangkat dicatat (termasuk tamu yang tidak ikut).');
    disableChecklistUI(orderId);
    await loadDriverTasks();
  }catch(e){
    showNotif('error', e.message || 'Gagal memproses berangkat');
  }
}

/* ====== Proses Tiba (massal) ====== */
async function doArrive(orderId){
  try{
    // ambil data terbaru utk tahu siapa saja yang belum tiba
    const rows = await api.myTasks(auth.user.username);
    const mine = rows.filter(r=> r.orderId===orderId && !!r.departAt && !r.arriveAt);
    if (mine.length === 0){
      showNotif('success','Semua tamu sudah tiba.');
      await loadDriverTasks();
      return;
    }
    for (const it of mine){
      await api.arrive(orderId, it.guestNo);
    }
    showNotif('success','Tiba dicatat & tugas selesai.');
    await loadDriverTasks();
  }catch(e){
    showNotif('error', e.message || 'Gagal mencatat tiba');
  }
}

/* ====== Binding aksi tabel utama ====== */
function bindActions(){
  const tbody = q('#tblDriver'); if (!tbody) return;

  tbody.addEventListener('click', async (ev)=>{
    const btnView = ev.target.closest('[data-view]');
    const btnAct  = ev.target.closest('[data-act]');
    const tr = ev.target.closest('tr');
    if (!tr) return;
    const orderId = tr.getAttribute('data-oid');

    // read-only admin/master → boleh View saja
    const isRO = (auth.user?.role === 'admin' || auth.user?.role === 'master' || tr.dataset.readonly === '1');

    if (btnView){
      await openView(orderId);
      return;
    }
    if (btnAct){
      const kind = btnAct.getAttribute('data-act');
      if (isRO){
        showNotif('warn','Mode Read-only (admin/master), aksi dinonaktifkan.');
        return;
      }
      if (kind === 'depart') return doDepart(orderId);
      if (kind === 'arrive') return doArrive(orderId);
    }
  });
}

/* ====== Init ====== */
window.addEventListener('DOMContentLoaded', ()=>{
  q('#btnReloadDriver')?.addEventListener('click', loadDriverTasks);
  bindActions();
});
window.addEventListener('route', (e)=>{
  if (e.detail.page === 'driver') loadDriverTasks();
});
