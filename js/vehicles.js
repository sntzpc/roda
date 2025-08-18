// vehicles.js
import { q } from './util.js';
import { api } from './api.js';
import { cachePreselectVehicle } from './store.js';

function statusClass(s){
  if(s==='allocated') return 'yellow';
  if(s==='on_trip')   return 'pink';
  if(s==='maintenance') return 'blue';
  if(s==='inactive') return 'gray';
  return '';
}
function statusText(s){
  return ({
    available:   'Tersedia',
    allocated:   'Teralokasi',
    on_trip:     'Dalam Perjalanan',
    maintenance: 'Perbaikan',
    inactive:    'Non-Aktif'
  })[s] || s;
}

// === mapping kelas badge kecil di pojok kanan card ===
function statusBadgeClass(s){
  if (s === 'available')   return 'badge-status bg-available';
  if (s === 'allocated')   return 'badge-status bg-allocated';
  if (s === 'on_trip')     return 'badge-status bg-ontrip';
  if (s === 'maintenance') return 'badge-status bg-maintenance';
  if (s === 'inactive')    return 'badge-status bg-inactive';
  return 'badge-status bg-inactive';
}

async function load(){
  const list = await api.listVehicles();
  q('#vehicleCards').innerHTML = list.map(v=>{
    const cls = statusClass(v.status);
    const badgeCls = statusBadgeClass(v.status);
    const canOrder = v.status === 'available';
    const reason = v.note ? `<div class="small text-muted mt-1">${v.note}</div>` : '';
    return `<div class="col-12 col-md-6 col-lg-4">
      <div class="card card-veh ${cls}">
        <div class="card-body">
          <div class="d-flex justify-content-between">
            <h6 class="mb-1">${v.name}</h6>
            <span class="badge ${badgeCls}">${statusText(v.status)}</span>
          </div>
          <div class="small text-muted">${v.brand||'-'} • ${v.plate||'-'} • Kap ${v.capacity||'-'}</div>
          <div class="mt-2">Driver: <strong>${v.driverName||'-'}</strong> <span class="text-muted">(${v.driverWa||'-'})</span></div>
          ${reason}
          <div class="mt-3">
            <button class="btn btn-sm btn-primary" data-order="${v.id}" ${canOrder?'':'disabled'}>Pesan</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  q('#vehicleCards').querySelectorAll('[data-order]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      cachePreselectVehicle(btn.dataset.order);
      window.dispatchEvent(new CustomEvent('route', {detail:{page:'order'}}));
    });
  });
}

window.addEventListener('route', e=>{
  if (e.detail.page==='vehicles' || e.detail.page==='dashboard') load();
});
