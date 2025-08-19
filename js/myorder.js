// /js/myorder.js
// =====================================================
// Halaman "My Order" – akses: User, Admin, Master
// Fitur: ambil 30 hari terakhir, cache LS, filter/paging, detail modal (Bootstrap)
// =====================================================

import * as API from './api.js';                 // ⬅ ganti: import namespace
import { auth } from './auth.js';

const fetchMyOrders = API.fetchMyOrders;         // ⬅ ambil fungsi yang kita perlu

// ====== Fallback ringkas untuk toast bila belum ada util ======
const _hasToast = (typeof window.toastSuccess === 'function' && typeof window.toastError === 'function');
function toastSuccess(msg){ _hasToast ? window.toastSuccess(msg) : console.log('[OK]', msg); }
function toastError(msg){ _hasToast ? window.toastError(msg) : console.error('[ERR]', msg); }

// ====== Konstanta ======
const CACHE_KEY = 'MYORDERS_CACHE_V1';   // { ts:number, list:[] }
const CACHE_TTL_MS = 2 * 60 * 1000;      // refresh minimal tiap 2 menit jika di-refresh manual
const SINCE_DAYS = 30;
const ALLOWED_ROLES = ['user','admin','master'];

// ====== State modul ======
let $page, $search, $status, $tbl, $tbody, $btnRefresh, $prev, $next, $pageInfo, $pageSizeSel, $autoChk;
let $modalEl, $moTitle, $moBody, bsMyOrderModal;

let _all = [];       // semua data (setelah filter 30 hari)
let _view = [];      // data setelah search/status filter
let _page = 1;
let _pageSize = 20;
let _timer = null;
let _inited = false;

// ====== Helpers role/state (tanpa bergantung export state dari api.js) ======
function currentRole(){
  try{
    const r0 = auth?.user?.role;
    if (r0) return String(r0).trim().toLowerCase();
    const r1 = API?.state?.user?.role;
    if (r1) return String(r1).trim().toLowerCase();
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return String(u?.role || '').trim().toLowerCase();
  }catch{ return ''; }
}

function hasAccess(){
  return ALLOWED_ROLES.includes(currentRole());
}
function isWithinDays(iso, days){
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return (now - t) <= days * 24 * 60 * 60 * 1000;
}

// format: dd/mm/yyyy | HH:MM:SS (24h)
function fmtDateTimeID(iso){
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const pad = n => (n<10?'0':'')+n;
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} | ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// map status -> badge class (Bootstrap 5)
function statusBadgeClass(s){
  switch((s||'').toLowerCase()){
    case 'completed': return 'badge text-bg-success';
    case 'approved':
    case 'allocated': return 'badge text-bg-warning';
    case 'on trip':
    case 'in transit': return 'badge text-bg-danger';
    case 'arrived': return 'badge text-bg-info';
    case 'cancelled':
    case 'pending': 
    default: return 'badge text-bg-secondary';
  }
}

// ====== Cache LocalStorage (hanya 30 hari) ======
function loadCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.list)) return null;
    // Prune 30 hari
    obj.list = obj.list.filter(r => isWithinDays(r.last_update || r.created_at, SINCE_DAYS));
    return obj;
  }catch(e){ return null; }
}
function saveCache(list){
  const pruned = (list||[]).filter(r => isWithinDays(r.last_update || r.created_at, SINCE_DAYS));
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list: pruned }));
}
function shouldRefresh(cache){
  if (!cache) return true;
  return (Date.now() - (cache.ts||0)) > CACHE_TTL_MS;
}

// ====== Render ======
function renderTable(){
  const start = (_page-1)*_pageSize;
  const rows = _view.slice(start, start+_pageSize);
  const html = rows.map(r=>{
    const veh = r.allocated_vehicle ? `${r.allocated_vehicle.name||''} (${r.allocated_vehicle.plate||'-'})` : '-';
    const drv = r.driver ? `${r.driver.name||'-'}` : '-';
    const dep = r.depart?.at ? `${fmtDateTimeID(r.depart.at)}` : '-';
    const arr = r.arrive?.at ? `${fmtDateTimeID(r.arrive.at)}` : '-';
    const badge = statusBadgeClass(r.status);
    const tujuan = r.destination || r.activity || '-';
    return `<tr data-id="${r.id}">
      <td>${r.order_no || r.id}</td>
      <td>${fmtDateTimeID(r.created_at)}</td>
      <td>${escapeHtml(tujuan)}</td>
      <td><span class="${badge}">${escapeHtml(r.status||'-')}</span></td>
      <td>${escapeHtml(veh)}</td>
      <td>${escapeHtml(drv)}</td>
      <td>${dep}</td>
      <td>${arr}</td>
      <td><button class="btn btn-link btn-sm p-0" data-act="detail" data-id="${r.id}">Detail</button></td>
    </tr>`;
  }).join('');
  $tbody.innerHTML = html || `<tr><td colspan="9" class="text-center text-muted">Tidak ada data</td></tr>`;

  const totalPages = Math.max(1, Math.ceil(_view.length/_pageSize));
  const curr = Math.min(_page, totalPages);
  $pageInfo.textContent = `Hal. ${_view.length ? curr : 0}/${totalPages}`;
}

function applyFilter(){
  const q = ($search.value||'').trim().toLowerCase();
  const st = ($status.value||'').trim().toLowerCase();

  _view = _all.filter(r=>{
    const inDays = isWithinDays(r.last_update || r.created_at, SINCE_DAYS);
    if (!inDays) return false;
    const hit = (
      (r.order_no||'').toLowerCase().includes(q) ||
      (r.activity||'').toLowerCase().includes(q) ||
      (r.destination||'').toLowerCase().includes(q) ||
      (r.driver?.name||'').toLowerCase().includes(q) ||
      (r.allocated_vehicle?.plate||'').toLowerCase().includes(q)
    );
    const stOk = !st || (r.status||'').toLowerCase() === st;
    return hit && stOk;
  }).sort((a,b)=> (new Date(b.created_at)-new Date(a.created_at)));

  _page = 1;
  renderTable();
}

function attachEvents(){
  // klik detail
  $tbody.addEventListener('click', (ev)=>{
    const btn = ev.target.closest('[data-act="detail"]');
    if (btn){
      const id = btn.dataset.id;
      const item = _all.find(x=> String(x.id)===String(id));
      if (item) openDetail(item);
    }
  });

  $search.addEventListener('input', debounce(applyFilter, 200));
  $status.addEventListener('change', applyFilter);
  $btnRefresh.addEventListener('click', ()=> refresh(true));

  $prev.addEventListener('click', ()=>{
    if (_page>1){ _page--; renderTable(); }
  });
  $next.addEventListener('click', ()=>{
    const maxPage = Math.max(1, Math.ceil(_view.length/_pageSize));
    if (_page<maxPage){ _page++; renderTable(); }
  });
  $pageSizeSel.addEventListener('change', ()=>{
    _pageSize = +$pageSizeSel.value || 20;
    _page = 1;
    renderTable();
  });

  // auto refresh
  $autoChk.addEventListener('change', setupAutoRefresh);
}

function openDetail(item){
  $moTitle.textContent = `Detail Order #${item.order_no || item.id}`;
  const veh = item.allocated_vehicle ? `${item.allocated_vehicle.name||''} (${item.allocated_vehicle.plate||'-'})` : '-';
  const drv = item.driver ? `${item.driver.name||'-'}${item.driver.phone?(' · '+item.driver.phone):''}` : '-';
  const dep = item.depart?.at ? fmtDateTimeID(item.depart.at) : '-';
  const arr = item.arrive?.at ? fmtDateTimeID(item.arrive.at) : '-';
  const badge = statusBadgeClass(item.status);

  $moBody.innerHTML = `
    <div class="d-flex gap-2 align-items-start mb-2">
      <span class="${badge}">${escapeHtml(item.status||'-')}</span>
      <div class="ms-auto small text-muted">Last Update: ${fmtDateTimeID(item.last_update||item.created_at)}</div>
    </div>

    <div class="table-responsive">
      <table class="table table-sm">
        <tr><th style="width:220px">No. Order</th><td>${item.order_no || item.id}</td></tr>
        <tr><th>Tanggal Order</th><td>${fmtDateTimeID(item.created_at)}</td></tr>
        <tr><th>Kegiatan/Tujuan</th><td>${escapeHtml(item.destination || item.activity || '-')}</td></tr>
        <tr><th>Kendaraan</th><td>${escapeHtml(veh)}</td></tr>
        <tr><th>Driver</th><td>${escapeHtml(drv)}</td></tr>
        <tr><th>Berangkat</th><td>${dep}${item.depart?.by?(' · oleh '+escapeHtml(item.depart.by)):''
          }${item.depart?.from?(' · dari '+escapeHtml(item.depart.from)) : ''}</td></tr>
        <tr><th>Tiba</th><td>${arr}${item.arrive?.by?(' · oleh '+escapeHtml(item.arrive.by)):''
          }${item.arrive?.to?(' · di '+escapeHtml(item.arrive.to)) : ''}</td></tr>
      </table>
    </div>

    <div class="mt-3">
      <h6 class="mb-2">Timeline</h6>
      <ul class="mb-0 ps-3">
        ${renderTL(item)}
      </ul>
    </div>
  `;

  if (bsMyOrderModal) bsMyOrderModal.show();
}
function closeDetail(){ if (bsMyOrderModal) bsMyOrderModal.hide(); }

function renderTL(it){
  const rows = [];
  rows.push(`<li>${fmtDateTimeID(it.created_at)} · Order dibuat oleh ${escapeHtml(it.created_by_name||'-')}</li>`);
  if (it.status_history && Array.isArray(it.status_history)){
    it.status_history.forEach(s=>{
      rows.push(`<li>${fmtDateTimeID(s.at)} · ${escapeHtml(s.by||'-')} mengubah status ke <b>${escapeHtml(s.status)}</b></li>`);
    });
  }
  if (it.depart?.at) rows.push(`<li>${fmtDateTimeID(it.depart.at)} · Berangkat${it.depart.from?(' dari '+escapeHtml(it.depart.from)) : ''} oleh ${escapeHtml(it.depart.by||'-')}</li>`);
  if (it.arrive?.at) rows.push(`<li>${fmtDateTimeID(it.arrive.at)} · Tiba${it.arrive.to?(' di '+escapeHtml(it.arrive.to)) : ''} oleh ${escapeHtml(it.arrive.by||'-')}</li>`);
  return rows.join('');
}

// ====== Fetch + refresh ======
async function refresh(force=false){
  if (!hasAccess()){
    toastError('Akses ditolak. Role tidak diizinkan.');
    return;
  }
  try{
    const cache = loadCache();
    if (!force && !shouldRefresh(cache) && cache){
      _all = cache.list || [];
      applyFilter();
      return;
    }

    // Ambil dari server (30 hari terakhir)
    const scope = (['Admin','Master'].includes(currentRole())) ? 'all' : 'mine';
    const list = await fetchMyOrders({ sinceDays: SINCE_DAYS, scope });

    saveCache(list);   // simpan cache (pruned 30 hari)
    _all = list;
    applyFilter();
    toastSuccess('Data My Order diperbarui.');
  }catch(err){
    console.error(err);
    toastError('Gagal memuat My Order.');
  }
}

export async function fetchMyOrders({ sinceDays=30, scope='mine', page=1, pageSize=500 } = {}){
  const payload = {
    action: 'getOrders',
    token: getToken(),
    scope, sinceDays, page, pageSize
  };
  const q   = webSafeBase64(JSON.stringify(payload));
  const cb  = 'cb'+Math.random().toString(36).slice(2);
  const sep = GAS_URL.includes('?') ? '&' : '?'; // GAS_URL Anda bisa sudah punya query
  const url = `${GAS_URL}${sep}jsonp=1&action=getOrders&cb=${cb}&q=${encodeURIComponent(q)}`;

  return new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    window[cb] = (resp)=>{
      try{ delete window[cb]; s.remove(); }catch(e){}
      if (resp && resp.ok && resp.data && Array.isArray(resp.data.orders)) return resolve(resp.data.orders);
      if (resp && resp.ok && Array.isArray(resp.data)) return resolve(resp.data);
      if (resp && Array.isArray(resp.orders)) return resolve(resp.orders);
      return reject(new Error(resp && resp.error ? resp.error : 'Format JSONP tidak dikenal'));
    };
    s.onerror = ()=>{ try{ delete window[cb]; s.remove(); }catch(e){}; reject(new Error('JSONP gagal')); };
    s.src = url;
    document.head.appendChild(s);
  });

  function webSafeBase64(str){
    const b = btoa(unescape(encodeURIComponent(str)));
    return b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
}

function setupAutoRefresh(){
  const isVisible = !$page.classList.contains('d-none');
  if (_timer){ clearInterval(_timer); _timer = null; }
  if ($autoChk.checked && isVisible){
    _timer = setInterval(()=> refresh(false), 45000); // 45 detik
  }
}
function teardownAutoRefresh(){
  if (_timer){ clearInterval(_timer); _timer = null; }
}

// ====== Debounce & escape util ======
function debounce(fn, ms){
  let t; 
  return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
}
function escapeHtml(s){
  return (s==null ? '' : String(s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ====== Init ======
function initDom(){
  $page       = document.querySelector('section[data-page="myorder"]');
  if (!$page) return;

  $search     = document.getElementById('myOrderSearch');
  $status     = document.getElementById('myOrderStatus');
  $tbl        = document.getElementById('tblMyOrder');
  $tbody      = $tbl?.querySelector('tbody');
  $btnRefresh = document.getElementById('btnMyOrderRefresh');
  $prev       = document.getElementById('myOrderPrev');
  $next       = document.getElementById('myOrderNext');
  $pageInfo   = document.getElementById('myOrderPageInfo');
  $pageSizeSel= document.getElementById('myOrderPageSize');
  $autoChk    = document.getElementById('myOrderAutoRefresh');

  $modalEl = document.getElementById('modalMyOrderDetail');
  $moTitle = document.getElementById('moTitle');
  $moBody  = document.getElementById('moBody');
  if (window.bootstrap && $modalEl) {
    bsMyOrderModal = bootstrap.Modal.getOrCreateInstance($modalEl, { keyboard:true });
  }

  _page = 1;
  _pageSize = +($pageSizeSel?.value||20);

  attachEvents();
}

function ensureInit(){
  if (_inited) return;
  initDom();
  _inited = true;
}

export function initMyOrder(){
  ensureInit();
  if (!hasAccess()){
    $page.innerHTML = `<div class="alert alert-danger m-2">Anda tidak memiliki akses ke halaman ini.</div>`;
    return;
  }
  setupAutoRefresh();
  refresh(false);
}

// Lazy init via event "route" dari ui.js
window.addEventListener('route', (ev)=>{
  const page = ev?.detail?.page;
  if (!page) return;

  if (page === 'myorder'){
    initMyOrder();
  } else {
    teardownAutoRefresh();
  }
});
