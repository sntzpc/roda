// order.js (rapih & tanpa bentrok)
import { q, qa, debounce, fmtLong } from './util.js';
import { showNotif } from './notif.js';
import { getIdent, setIdent, addWilayah, getWilayah, takePreselectVehicle } from './store.js';
import { pickDateTime } from './ui.js';
import { api } from './api.js';
import { auth } from './auth.js';

const guestMax = 200; // batas upload

/* ========== IDENTITAS ========== */
function renderIdent(){
  const ident = getIdent();
  q('#ordNama').value = ident.nama || '';
  q('#ordUnit').value = ident.unit || '';
  q('#ordJabatan').value = ident.jabatan || '';
}
function persistIdent(){
  setIdent({
    nama: q('#ordNama').value.trim(),
    unit: q('#ordUnit').value.trim(),
    jabatan: q('#ordJabatan').value.trim()
  });
}

/* ========== AUTO-SUGGEST WILAYAH (tanpa bentrok) ========== */
function suggestSetup(inputEl, listEl){
  // Matikan autofill/auto-correct native agar dropdown kita yang dipakai
  inputEl.setAttribute('autocomplete','off');
  inputEl.setAttribute('autocorrect','off');
  inputEl.setAttribute('autocapitalize','off');
  inputEl.setAttribute('spellcheck','false');

  const renderList = ()=>{
    const key = inputEl.value.trim().toLowerCase();
    if (key.length < 1){
      listEl.classList.add('d-none'); listEl.innerHTML = ''; return;
    }
    const items = getWilayah()
      .filter(w => w.toLowerCase().includes(key))
      .slice(0, 20);

    if (!items.length){
      listEl.classList.add('d-none'); listEl.innerHTML = ''; return;
    }
    listEl.innerHTML = items
      .map(w => `<div class="suggest-item" data-val="${w.replace(/"/g,'&quot;')}">${w}</div>`)
      .join('');
    listEl.classList.remove('d-none');
  };

  // Event: ketik & fokus → tampilkan saran (dengan debounce agar ringan)
  inputEl.addEventListener('input', debounce(renderList, 80));
  inputEl.addEventListener('focus', renderList);

  // Tutup sedikit setelah blur supaya pemilihan via pointerdown sempat jalan
  inputEl.addEventListener('blur', ()=> setTimeout(()=> listEl.classList.add('d-none'), 150));

  // Pilih item: pakai pointerdown (lebih cepat dari blur) + fallback click
  const choose = (ev)=>{
    const it = ev.target.closest('.suggest-item');
    if(!it) return;
    ev.preventDefault(); ev.stopPropagation();
    const val = it.getAttribute('data-val');
    inputEl.value = val;
    listEl.classList.add('d-none');
    // Trigger change agar listener lain (jika ada) bisa merespons
    inputEl.dispatchEvent(new Event('change'));
    inputEl.focus();
  };
  listEl.addEventListener('pointerdown', choose, {capture:true});
  listEl.addEventListener('click', choose);
}

/* ========== SWAP DARI↔KE ========== */
function swapFromTo(){
  const a = q('#ordFrom').value; const b = q('#ordTo').value;
  q('#ordFrom').value = b; q('#ordTo').value = a;
}

/* ========== TANGGAL/JAM ========== */
let depISO = '', retISO = '';
function setDep(iso){ depISO = iso; q('#ordBerangkatLabel').value = fmtLong(iso); }
function setRet(iso){ retISO = iso; q('#ordPulangLabel').value   = fmtLong(iso); }

/* ========== TAMU ========== */
function renderGuests(n){
  const wrap = q('#guestList'); wrap.innerHTML = '';
  for(let i=1;i<=n;i++){
    const el = document.createElement('div');
    el.className = 'border rounded p-2 mb-2';
    el.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <strong>Tamu ${i}</strong>
        <button class="btn btn-sm btn-outline-secondary" data-exp><i class="bi bi-plus"></i></button>
      </div>
      <div class="row g-2 mt-2 d-none" data-body>
        <div class="col-md-3"><input class="form-control" placeholder="Nama" data-f="nama"></div>
        <div class="col-md-3"><input class="form-control" placeholder="Unit" data-f="unit"></div>
        <div class="col-md-3"><input class="form-control" placeholder="Jabatan" data-f="jabatan"></div>
        <div class="col-md-1">
          <select class="form-select" data-f="gender">
            <option value="L">L</option><option value="P">P</option>
          </select>
        </div>
        <div class="col-md-2"><input class="form-control" placeholder="No WA (opsional)" data-f="wa"></div>
      </div>`;
    wrap.appendChild(el);
    const btn = el.querySelector('[data-exp]'); const body = el.querySelector('[data-body]');
    btn.addEventListener('click', ()=> body.classList.toggle('d-none'));
  }
}
function readGuests(){
  const items = [];
  q('#guestList').querySelectorAll('[data-body]').forEach((b,idx)=>{
    const get = s=>b.querySelector(`[data-f="${s}"]`).value.trim();
    items.push({
      no: idx+1,
      nama: get('nama'),
      unit: get('unit'),
      jabatan: get('jabatan'),
      gender: get('gender'),
      wa: get('wa')
    });
  });
  return items;
}

/* ========== TEMPLATE & UPLOAD TAMU ========== */
function downloadGuestTemplate(){
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['Nama','Unit','Jabatan','Gender (L/P)']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Template Tamu');
  XLSX.writeFile(wb, 'TemplateTamu.xlsx');
}
function handleGuestUpload(file){
  const reader = new FileReader();
  reader.onload = () => {
    const wb = XLSX.read(reader.result, {type:'binary'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''})
      .slice(1)
      .map(r=>({
        nama: r[0],
        unit: r[1],
        jabatan: r[2],
        gender: (r[3]||'').toString().toUpperCase().trim()==='P' ? 'P' : 'L',
        wa: ''
      }))
      .filter(r=>r.nama);

    if(rows.length > guestMax){
      showNotif('error', `Maks ${guestMax} tamu per upload`); return;
    }

    // render menimpa manual
    q('#ordJmlTamu').value = Math.max(1, rows.length);
    renderGuests(rows.length);

    // isi nilai
    q('#guestList').querySelectorAll('[data-body]').forEach((b,i)=>{
      const r = rows[i] || {};
      b.querySelector('[data-f="nama"]').value    = r.nama    || '';
      b.querySelector('[data-f="unit"]').value    = r.unit    || '';
      b.querySelector('[data-f="jabatan"]').value = r.jabatan || '';
      b.querySelector('[data-f="gender"]').value  = r.gender  || 'L';
    });
    showNotif('success', `Upload ${rows.length} tamu berhasil (menimpa input manual)`);
  };
  reader.readAsBinaryString(file);
}

/* ========== SUBMIT ORDER ========== */
async function submitOrder(){
  // validasi dasar
  const nama = q('#ordNama').value.trim();
  if(!nama){ showNotif('error','Nama pemesan wajib'); return; }
  if(!depISO){ showNotif('error','Tanggal berangkat belum dipilih'); return; }

  const from = q('#ordFrom').value.trim();
  const to   = q('#ordTo').value.trim();
  if(!from || !to){ showNotif('error','Asal & tujuan wajib'); return; }

  const guests = readGuests();
  if(guests.length === 0){ showNotif('error','Jumlah tamu minimal 1'); return; }
  if(guests.some(g=>!g.nama)){ showNotif('error','Nama tiap tamu wajib diisi'); return; }

  // persist identitas & wilayah populer
  persistIdent(); addWilayah(from); addWilayah(to);

  // preselect kendaraan jika ada
  const preVeh = takePreselectVehicle() || '';

  const order = {
    pemesan: {
      nama,
      unit: q('#ordUnit').value.trim(),
      jabatan: q('#ordJabatan').value.trim(),
      user: (auth.user?.username || '')
    },
    asal: from, tujuan: to,
    berangkatISO: depISO, pulangISO: retISO || '',
    agenda: q('#ordAgenda').value.trim(),
    tamu: guests,
    preVehicleId: preVeh
  };

  try{
    await api.createOrder(order);
    showNotif('success','Order terkirim. Menunggu persetujuan.');
    // reset pulang & agenda
    q('#ordAgenda').value = '';
    retISO = '';
    q('#ordPulangLabel').value = '';
    q('#tglPulangToggle').checked = false;
    q('#pulangWrap').classList.add('d-none');
  }catch(e){
    showNotif('error', e.message || 'Gagal mengirim order');
  }
}

/* ========== INIT ========== */
window.addEventListener('DOMContentLoaded', ()=>{
  // Identitas
  renderIdent();

  // Auto-suggest wilayah (Dari/Ke)
  suggestSetup(q('#ordFrom'), q('#suggestFrom'));
  suggestSetup(q('#ordTo'),   q('#suggestTo'));

  // Swap
  q('#btnSwap')?.addEventListener('click', swapFromTo);
  document.getElementById('btnSwapMobile')?.addEventListener('click', swapFromTo);

  // Date-time picker
  q('#btnPickBerangkat').addEventListener('click', ()=> pickDateTime('#ordBerangkatLabel', setDep));
  q('#btnPickPulang').addEventListener('click',   ()=> pickDateTime('#ordPulangLabel',   setRet));
  q('#tglPulangToggle').addEventListener('change', e => q('#pulangWrap').classList.toggle('d-none', !e.target.checked));

  // Guests
  q('#ordJmlTamu').addEventListener('change', e => renderGuests(+e.target.value));
  renderGuests(+q('#ordJmlTamu').value);

  // Template & upload tamu
  q('#btnDlGuestTpl').addEventListener('click', downloadGuestTemplate);
  q('#upGuests').addEventListener('change', e => { const f = e.target.files?.[0]; if(f) handleGuestUpload(f); });

  // Submit/reset
  q('#btnSubmitOrder').addEventListener('click', submitOrder);
  q('#btnResetOrder').addEventListener('click', ()=>{
    renderIdent();
    renderGuests(+q('#ordJmlTamu').value);
  });
});
