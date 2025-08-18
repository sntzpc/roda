// dashboard.js — Dashboard interaktif + CCTV kuat
import { q } from './util.js';
import { api } from './api.js';
import { showNotif } from './notif.js';

/* ====== Debug (membaca 2 key agar tidak “geser”) ====== */
function isDbg(){
  try{
    const a = JSON.parse(localStorage.getItem('roda_debug')||'false');
    const b = JSON.parse(localStorage.getItem('app_debug')||'false');
    return !!(a || b);
  }catch{ return false; }
}
function dlog(...args){ if(isDbg()) console.log('[DASH]', ...args); }

/* ====== Cache ====== */
let VEH_CACHE = [];
let SNAP_CACHE = null;

/* ====== Util ====== */
const fmt2 = n => (n<10?'0'+n:n);
function fmtShort(iso){
  if(!iso) return '-';
  const d = new Date(iso);
  return `${fmt2(d.getDate())}/${fmt2(d.getMonth()+1)}/${d.getFullYear()} ${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
}
function pageVisible(page){
  const sec = document.querySelector(`section[data-page="${page}"]`);
  return !!sec && !sec.classList.contains('d-none');
}
function clsByStatus(s){
  if (s==='allocated')   return 'veh-yellow';
  if (s==='on_trip')     return 'veh-pink';
  if (s==='maintenance') return 'veh-blue';
  if (s==='inactive')    return 'veh-gray';
  return '';
}

/* ====== Snapshot (opsional) ====== */
async function getSnapshot(){
  if (SNAP_CACHE) return SNAP_CACHE;
  if (typeof api.debugState !== 'function') return null;
  try{
    SNAP_CACHE = await api.debugState({});
    dlog('snapshot OK');
  }catch(e){
    console.log('[DASH] snapshot error:', e?.message||e);
    SNAP_CACHE = null;
  }
  return SNAP_CACHE;
}
function onTripByVehicle(snap){
  const map = new Map();
  const guests = snap?.guests || [];
  guests.forEach(g=>{
    const onTrip = !!g.departAt && !g.arriveAt && g.vehicleId;
    if (!onTrip) return;
    if (!map.has(g.vehicleId)) map.set(g.vehicleId, []);
    map.get(g.vehicleId).push(g);
  });
  return map;
}

/* ====== KPI (opsional) ====== */
function renderKpi(stats){
  if (!stats) return;
  if (q('#statActiveVehicles')) q('#statActiveVehicles').textContent = stats.activeVehicles ?? 0;
  if (q('#statOnTrip'))         q('#statOnTrip').textContent         = stats.onTripGuests ?? 0;
  if (q('#topVehicles')){
    const tv = Array.isArray(stats.topVehicles) ? stats.topVehicles.slice(0,3) : [];
    q('#topVehicles').innerHTML = tv.map(v=>`<li>${v.name||'-'} — ${v.trips||0} trip</li>`).join('');
  }
}

/* ====== Kartu kendaraan ====== */
function renderVehicleCards(list, onTripMap){
  const wrap = q('#dashVehicleCards');
  if (!wrap) { console.log('[DASH] #dashVehicleCards TIDAK ditemukan di DOM'); return; }

  if (!list.length){
    wrap.innerHTML = `<div class="col-12">
      <div class="alert alert-light border text-center text-muted">
        Belum ada data kendaraan. Coba buka menu <b>Kendaraan</b> / <b>Pengaturan → Kendaraan</b>.
      </div></div>`;
    return;
  }

  wrap.innerHTML = list.map(v=>{
    const trips = onTripMap?.get(v.id) || [];
    const chip  = trips.length ? `<span class="badge bg-primary-subtle text-primary ms-2">${trips.length} on trip</span>` : '';
    const drv   = v.driverName ? `<div class="veh-meta">👤 ${v.driverName}${v.driverWa?` • ${v.driverWa}`:''}</div>` : '';
    const plate = v.plate ? `<span class="veh-plate">${v.plate}</span>` : '';
    return `
      <div class="col-12 col-sm-6 col-lg-4">
        <div class="veh-card ${clsByStatus(v.status)}" data-vid="${v.id}">
          <div class="veh-head">
            <div class="veh-title"><i class="bi bi-truck-front me-2"></i>${v.name||'-'} ${plate}</div>
            <span class="veh-badge">${
              v.status==='available'   ? 'Tersedia' :
              v.status==='allocated'   ? 'Teralokasi' :
              v.status==='on_trip'     ? 'Perjalanan' :
              v.status==='maintenance' ? 'Perbaikan' :
              v.status==='inactive'    ? 'Non-Aktif' : v.status
            }</span>
          </div>
          <div class="veh-sub text-muted small">${v.brand||''}</div>
          ${drv}
          <div class="veh-foot">
            <div>Kapasitas: <b>${v.capacity||1}</b></div>
            ${chip}
          </div>
        </div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-vid]').forEach(el=>{
    el.addEventListener('click', ()=> openVehicleDetail(el.dataset.vid));
  });
}

/* ====== Modal detail on-trip per kendaraan ====== */
async function openVehicleDetail(vehicleId){
  const snap = SNAP_CACHE || await getSnapshot();
  const map  = onTripByVehicle(snap||{});
  const trips = map.get(vehicleId) || [];

  const v = VEH_CACHE.find(x=>x.id===vehicleId) || {};
  const modal = document.querySelector('#mdlVehTrips');

  if (!modal){
    // fallback alert bila modal belum ditambahkan ke HTML
    if (!trips.length){ showNotif('info','Belum ada tamu dalam perjalanan.'); return; }
    const names = trips.map((g,i)=> `${i+1}. ${g.nama||'-'} • ${g.orderId}#${g.guestNo} • ${fmtShort(g.departAt)}`).join('\n');
    alert(`On Trip • ${v.name||v.plate||'Kendaraan'}\n\n${names}`);
    return;
  }

  q('#vehTripsTitle') && (q('#vehTripsTitle').textContent = v.name || v.plate || 'Kendaraan');
  q('#vehTripsMeta')  && (q('#vehTripsMeta').textContent  = `${v.brand||''} ${v.plate?('• '+v.plate):''} ${v.driverName?('• '+v.driverName):''}`);

  const tb = q('#vehTripsBody');
  if (tb){
    if (!trips.length){
      tb.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Belum ada tamu dalam perjalanan.</td></tr>`;
    }else{
      tb.innerHTML = trips.map((g,i)=>`
        <tr>
          <td class="text-center">${i+1}</td>
          <td>${g.nama||'-'}</td>
          <td class="text-monospace">${g.orderId||''}#${g.guestNo||''}</td>
          <td>${fmtShort(g.departAt||'')}</td>
          <td>${g.arriveAt ? fmtShort(g.arriveAt) : '<span class="badge text-bg-warning">Belum tiba</span>'}</td>
        </tr>`).join('');
    }
  }
  bootstrap.Modal.getOrCreateInstance('#mdlVehTrips').show();
}

/* ====== Refresh utama ====== */
async function refreshDashboard(){
  console.log('[DASH] refreshDashboard()');
  try{
    // KPI (opsional, aman kalau tidak ada)
    const stats = typeof api.dashboard === 'function'
      ? await api.dashboard().catch(()=>null)
      : null;
    renderKpi(stats);

    // data utama
    const [list, snap] = await Promise.all([
      api.listVehicles(),
      getSnapshot()
    ]);
    VEH_CACHE = Array.isArray(list) ? list : [];
    const map = snap ? onTripByVehicle(snap) : new Map();

    console.log('[DASH] vehicles:', VEH_CACHE.length, 'snapshot:', !!snap);
    dlog('vehicles sample:', VEH_CACHE[0]);
    renderVehicleCards(VEH_CACHE, map);
  }catch(e){
    console.log('[DASH] ERROR:', e);
    showNotif('error', e.message || 'Gagal memuat dashboard');
  }
}

/* ====== Init & Route ====== */
window.addEventListener('DOMContentLoaded', ()=>{
  // kalau dashboard sudah terlihat saat load (misal role admin/master), muat langsung
  if (pageVisible('dashboard')) refreshDashboard();

  // bantuan diagnosis manual dari console
  window.DASH_diag = async ()=>{
    const a = await api.listVehicles().catch(e=>({err:e?.message||e}));
    const b = (typeof api.debugState==='function') ? await api.debugState({}).catch(e=>({err:e?.message||e})) : '(tidak ada debugState)';
    console.log('[DASH] diag listVehicles →', a);
    console.log('[DASH] diag debugState →', b);
  };
});
window.addEventListener('route', (e)=>{
  if (e.detail.page === 'dashboard') refreshDashboard();
});
