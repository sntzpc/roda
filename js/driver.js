// driver.js — tampilan per-ORDER + checklist & aksi massal (RO utk admin/master)
import { q } from './util.js';
import { api } from './api.js';
import { auth } from './auth.js';
import { showNotif } from './notif.js';
import { isDbg, prefixed } from './debug.js';
const dlog = prefixed('[DRV]');

/* ====== Cache ringan ====== */
const orderMetaCache   = new Map();   // orderId -> { pemesanNama, berangkatISO, asal, tujuan }
const orderGuestsCache = new Map();   // orderId -> snapshot (debugState)
const checklistByOrder = new Map();   // orderId -> { checked:Set<number>, notes:Map<number,string> }

/* ====== Util ringkas ====== */
const fmt2 = n => n < 10 ? ('0' + n) : n;
const fmtShort = iso => {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${fmt2(d.getDate())}/${fmt2(d.getMonth()+1)}/${d.getFullYear()} ${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
};

/* ====== Ambil meta order (cache) ====== */
async function getOrderMeta(orderId){
  if (orderMetaCache.has(orderId)) return orderMetaCache.get(orderId);
  const snap = await api.debugState({ orderId }).catch(()=>null);
  const o = snap?.order || {};
  const meta = {
    pemesanNama:  o.pemesanNama || '-',
    berangkatISO: o.berangkatISO || '',
    asal:         o.asal || '',
    tujuan:       o.tujuan || ''
  };
  orderMetaCache.set(orderId, meta);
  orderGuestsCache.set(orderId, snap || {});
  return meta;
}

/* ====== Render baris ringkas per-ORDER ====== */
function rowHtml(group, meta, i, readonly){
  const act =
    group.allDeparted
      ? `<button class="btn btn-sm btn-success" data-act="arrive" data-oid="${group.orderId}">Tiba</button>`
      : `<button class="btn btn-sm btn-primary" data-act="depart" data-oid="${group.orderId}" disabled>Berangkat</button>`;

  return `<tr data-oid="${group.orderId}" data-readonly="${readonly ? '1':'0'}">
    <td>${meta.pemesanNama}</td>
    <td class="text-center">${group.count}</td>
    <td>${meta.asal || group.asal || '-'} → ${meta.tujuan || group.tujuan || '-'}</td>
    <td>${fmtShort(meta.berangkatISO || group.items?.[0]?.berangkatISO)}</td>
    <td class="text-nowrap">
      <button class="btn btn-sm btn-outline-secondary" data-view="${group.orderId}">View</button>
    </td>
    <td class="text-nowrap">${act}</td>
  </tr>`;
}

/* ====== Ambil semua tugas untuk admin/master (gabung dari semua driver) ====== */
async function fetchAllTasksForAdminMaster(){
  const drivers = await api.listDrivers().catch(()=>[]);
  if (!Array.isArray(drivers) || !drivers.length) return [];

  // Prioritas parameter untuk myTasks_robust di backend: userId → name → wa
  const keys = drivers.map(d => (d.userId || d.name || d.wa || '').toString().trim()).filter(Boolean);

  const calls = keys.map(k => api.myTasks(k).catch(()=>[]));
  const results = await Promise.all(calls);
  const flat = results.flat();

  // Dedup (jaga-jaga) per orderId+guestNo
  const seen = new Set();
  const out = [];
  for (const it of flat){
    const key = `${it.orderId}__${it.guestNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  dlog('MERGE all drivers tasks ->', out.length);
  return out;
}

/* ====== Kumpulkan & kelompokkan tugas ====== */
async function loadDriverTasks(){
  if (!auth.user) return;
  try{
    const role = (auth.user?.role || '').toLowerCase();
    const readonly = (role === 'admin' || role === 'master');

    let rows = [];
    if (readonly){
      rows = await fetchAllTasksForAdminMaster();
    }else{
      rows = await api.myTasks(auth.user.username);
    }
    dlog('HASIL tugas →', (rows||[]).length);

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
    const metas    = await Promise.all(orderIds.map(getOrderMeta));
    const metaById = {}; orderIds.forEach((id,idx)=> metaById[id] = metas[idx]);

    // Grup per order
    const groups = orderIds.map((orderId, i)=>{
      const items = byOrder.get(orderId) || [];
      const allDeparted = items.length>0 && items.every(x => !!(x.departAt || x.noDepartNote));
      const allArrived  = items.length>0 && items.every(x => !!x.arriveAt  || x.noDepartNote);
      return {
        orderId, items,
        count: items.length,
        asal: items[0]?.asal || '',
        tujuan: items[0]?.tujuan || '',
        allDeparted, allArrived,
        idx: i
      };
    });

    // Tampilkan hanya yg belum semua tiba
    const shown = groups.filter(g => !g.allArrived);
    if (!shown.length){
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Semua tugas selesai.</td></tr>`;
      return;
    }

    tbody.innerHTML = shown.map(g => rowHtml(g, metaById[g.orderId]||{}, g.idx, readonly)).join('');

    // Read-only admin/master → matikan tombol aksi (View tetap aktif)
    if (readonly){
      tbody.querySelectorAll('[data-act]').forEach(btn=>{
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.title = 'Read only (admin/master)';
        btn.style.pointerEvents = 'none';
      });
    }
  }catch(e){
    showNotif('error', e.message || 'Gagal memuat tugas driver');
  }
}

/* ====== Kunci semua kontrol checklist di modal View ====== */
function disableChecklistUI(orderId){
  const mdl = document.getElementById('mdlDriverGuests');
  if (!mdl) return;
  mdl.querySelectorAll('input[type="checkbox"], input[type="text"], textarea').forEach(el => { el.disabled = true; });
  const btnSave = q('#btnSaveChecklist');
  if (btnSave){ btnSave.disabled = true; btnSave.classList.add('disabled'); }
  const hint = mdl.querySelector('[data-checklist-hint]');
  if (hint) hint.textContent = 'Checklist terkunci.';
}

/* ====== Modal: buka & render detail tamu per ORDER ====== */
async function openView(orderId){
  const role = (auth.user?.role || '').toLowerCase();
  const isRO = (role === 'admin' || role === 'master');

  let snap = orderGuestsCache.get(orderId);
  if (!snap) {
    snap = await api.debugState({ orderId }).catch(()=>null);
    orderGuestsCache.set(orderId, snap || {});
  }

  const o  = snap?.order || {};
  const allGuests = snap?.guests || [];

  // Untuk admin/master tampilkan semua tamu; untuk driver: filter miliknya
  let myDrvId = '';
  if (!isRO){
    myDrvId = snap?.mapping?.matchedDrv?.id || '';
    if (!myDrvId){
      const drv = (snap?.drivers || snap?.D || []).find(d => d.userId === auth.user.username);
      if (drv) myDrvId = drv.id;
      if (!myDrvId){
        const s2 = await api.debugState({ driverUser: auth.user.username }).catch(()=>null);
        myDrvId = s2?.mapping?.matchedDrv?.id || '';
      }
    }
  }

  const baseGuests = isRO ? allGuests : allGuests.filter(g => g.driverId === myDrvId);
  const myGuests   = baseGuests.filter(g => String(g.approved).toUpperCase() === 'TRUE');

  q('#dgOrderId').textContent   = orderId;
  q('#dgOrderInfo').textContent = `${o.pemesanNama||'-'} • ${o.asal||'-'} → ${o.tujuan||'-'} • ${fmtShort(o.berangkatISO)}`;

  const saved = checklistByOrder.get(orderId) || { checked:new Set(), notes:new Map() };
  const TB = q('#tblGuestDetail');
  TB.innerHTML = myGuests.map(g=>{
    const no = +g.guestNo;
    const alreadyDeparted = !!(g.departAt) || !!(g.noDepartNote);
    const checked = alreadyDeparted || saved.checked.has(no);
    const note = saved.notes.get(no) || (g.noDepartNote || '');
    const dis = (alreadyDeparted || isRO) ? 'disabled' : '';
    return `<tr data-gn="${no}">
      <td class="text-center">${no}</td>
      <td>${g.nama||'-'}</td>
      <td>${g.unit||''}</td>
      <td>${g.jabatan||''}</td>
      <td>${g.gender||''}</td>
      <td>${g.wa||''}</td>
      <td class="text-center"><input type="checkbox" ${checked?'checked':''} ${dis} /></td>
      <td><input type="text" class="form-control form-control-sm" placeholder="Wajib diisi jika tidak dicentang"
                 value="${(note||'').replace(/"/g,'&quot;')}" ${dis} /></td>
    </tr>`;
  }).join('');

  const mdl = document.getElementById('mdlDriverGuests');
  if (mdl) mdl.setAttribute('data-oid', orderId);

  const btnSave = q('#btnSaveChecklist');
  if (btnSave){
    btnSave.disabled = !!isRO;
    btnSave.classList.toggle('disabled', !!isRO);
    btnSave.onclick = ()=>{
      if (isRO) return; // RO: tidak boleh menyimpan
      const checked = new Set();
      const notes   = new Map();
      let ok = true;

      TB.querySelectorAll('tr').forEach(tr=>{
        const gn = +tr.getAttribute('data-gn');
        const cb = tr.querySelector('input[type="checkbox"]');
        const tx = tr.querySelector('input[type="text"]');
        const isChecked  = cb?.checked;
        const isDisabled = cb?.disabled;

        if (isDisabled){
          checked.add(gn);
          return;
        }
        if (isChecked){
          checked.add(gn);
        }else{
          const note = (tx?.value||'').trim();
          if (!note) ok = false;
          notes.set(gn, note);
        }
      });

      if (!ok){
        showNotif('error','Ada tamu yang tidak dicentang dan belum ada keterangannya.');
        return;
      }

      checklistByOrder.set(orderId, { checked, notes });
      showNotif('success','Checklist disimpan.');
      const rowBtn = document.querySelector(`[data-oid="${orderId}"] [data-act="depart"]`);
      if (rowBtn) rowBtn.disabled = false;
      bootstrap.Modal.getOrCreateInstance('#mdlDriverGuests').hide();
    };
  }

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
    for (const gn of saved.checked){
      await api.depart(orderId, gn);
    }
    if (typeof api.skipGuest === 'function'){
      for (const [gn, note] of saved.notes.entries()){
        await api.skipGuest(orderId, gn, note);
      }
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
    const rows = await api.myTasks(auth.user.username);
    const mine = rows.filter(r => r.orderId===orderId && !!r.departAt && !r.arriveAt);
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
    const tr = ev.target.closest('tr'); if (!tr) return;
    const orderId = tr.getAttribute('data-oid');

    const role = (auth.user?.role || '').toLowerCase();
    const isRO = (role === 'admin' || role === 'master' || tr.dataset.readonly === '1');

    if (btnView){
      await openView(orderId);
      return;
    }
    if (btnAct){
      if (isRO){
        showNotif('warn','Mode Read-only (admin/master), aksi dinonaktifkan.');
        return;
      }
      const kind = btnAct.getAttribute('data-act');
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
