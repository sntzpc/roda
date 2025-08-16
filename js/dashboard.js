// dashboard.js
import { q } from './util.js';
import { api } from './api.js';
import './vehicles.js'; // supaya kartu kendaraan juga segar saat dashboard di-visit

async function loadDash(){
  const d = await api.dashboard();
  q('#statActiveVehicles').textContent = d.activeVehicles;
  q('#statOnTrip').textContent = d.onTripGuests;
  q('#topVehicles').innerHTML = d.topVehicles.map(v=>`<li>${v.name} — ${v.count} trip</li>`).join('');
  // kartu kendaraan live: sudah di vehicles.js saat route vehicles/dashboard dipanggil
}
window.addEventListener('route', e=>{ if(e.detail.page==='dashboard') loadDash(); });
window.addEventListener('DOMContentLoaded', loadDash);
