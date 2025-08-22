// order.js (rapih & terstruktur)
// ===================================================================
// Impor utilitas & API
// ===================================================================
import { q, qa, debounce, fmtLong } from './util.js';
import { showNotif } from './notif.js';
import { getIdent, setIdent, addWilayah, getWilayah, takePreselectVehicle } from './store.js';
import { pickDateTime } from './ui.js';
import { api } from './api.js';
import { auth } from './auth.js';

const guestMax = 200; // batas upload
const ORDER_IDENT_CACHE = 'ORDER_IDENT_V1'; // cache per-perangkat {nama,unit,jabatan}

// ===================================================================
// Identitas Pemesan (Nama, Unit, Jabatan) — Controller UX
// ===================================================================
const IdentUX = (() => {
  let wired = false;
  let $page, $nama, $unit, $jab, $submit, $logout, $btnEdit, unitWrap, jabWrap;
  let initialNama = '';

  // ---------- helpers ----------
  const toastErr = (m) => (typeof window.toastError === 'function' ? window.toastError(m) : showNotif('error', m));
  const readCache = () => { try { return JSON.parse(localStorage.getItem(ORDER_IDENT_CACHE) || 'null') || {}; } catch { return {}; } };
  const writeCache = (obj) => { try {
    localStorage.setItem(ORDER_IDENT_CACHE, JSON.stringify({
      nama: (obj.nama||'').trim(), unit: (obj.unit||'').trim(), jabatan: (obj.jabatan||'').trim()
    }));
  } catch {} };
  const clearCache = () => { try { localStorage.removeItem(ORDER_IDENT_CACHE); } catch {} };

  const ensureInvalidFeedback = (inputEl, msg='Wajib diisi') => {
    let fb = inputEl.nextElementSibling;
    if (!fb || !fb.classList?.contains('invalid-feedback')) {
      fb = document.createElement('div');
      fb.className = 'invalid-feedback d-block';
      inputEl.insertAdjacentElement('afterend', fb);
    }
    fb.textContent = msg;
    return fb;
  };
  const setInvalid = (inputEl, on, msg) => {
    if (!inputEl) return;
    if (on) {
      inputEl.classList.add('is-invalid');
      ensureInvalidFeedback(inputEl, msg);
    } else {
      inputEl.classList.remove('is-invalid');
      const fb = inputEl.nextElementSibling;
      if (fb && fb.classList?.contains('invalid-feedback')) fb.textContent = '';
    }
  };

  const hideUJ = () => {
    unitWrap?.classList.add('d-none');
    jabWrap?.classList.add('d-none');
    $btnEdit?.classList.remove('d-none');
  };
  const showUJ = () => {
    unitWrap?.classList.remove('d-none');
    jabWrap?.classList.remove('d-none');
    $btnEdit?.classList.add('d-none'); // tombol hilang ketika field ditampilkan
  };

  // ---------- public methods ----------
  function mount() {
    if (wired) return;

    $page   = document.querySelector('section[data-page="order"]');
    if (!$page) return;
    $nama   = q('#ordNama');
    $unit   = q('#ordUnit');
    $jab    = q('#ordJabatan');
    $submit = q('#btnSubmitOrder');
    $logout = q('#btnLogout');

    if (!$nama || !$unit || !$jab || !$submit) return;

    unitWrap = $unit.closest('.col-md-4') || $unit.parentElement;
    jabWrap  = $jab.closest('.col-md-4')  || $jab.parentElement;

    // — Prefill dari Settings (store) + cache per perangkat
    const ident = getIdent() || {};
    const cache = readCache();
    $nama.value = (cache.nama ?? ident.nama ?? '') || '';
    $unit.value = (cache.unit ?? ident.unit ?? '') || '';
    $jab.value  = (cache.jabatan ?? ident.jabatan ?? '') || '';
    initialNama = ($nama.value || '').trim();

    // — Button "Ubah Unit & Jabatan"
    $btnEdit = document.getElementById('btnEditIdent');
    if (!$btnEdit) {
      $btnEdit = document.createElement('button');
      $btnEdit.id = 'btnEditIdent';
      $btnEdit.type = 'button';
      $btnEdit.className = 'btn btn-link btn-sm ps-0';
      $btnEdit.textContent = 'Ubah Unit & Jabatan';
      $nama.insertAdjacentElement('afterend', $btnEdit);
    }

    // — Default: sembunyikan U&J (akan tampil hanya bila user butuh mengubah)
    hideUJ();

    // — Event: tombol manual tampilkan U&J
    $btnEdit.addEventListener('click', showUJ);

    // — Event: bila Nama berubah dari nilai awal → tampilkan U&J
    $nama.addEventListener('input', () => {
      const curr = ($nama.value || '').trim();
      if (curr !== initialNama) showUJ();
      writeCache({ nama: curr, unit: $unit.value, jabatan: $jab.value });
    });

    // — Validasi real-time + simpan cache
    const validateAndSave = debounce(() => {
      const u = ($unit.value || '').trim();
      const j = ($jab.value  || '').trim();
      setInvalid($unit, !u, 'Unit wajib diisi');
      setInvalid($jab,  !j,  'Jabatan wajib diisi');
      writeCache({ nama: ($nama.value||'').trim(), unit: u, jabatan: j });
    }, 160);
    $unit.addEventListener('input', validateAndSave);
    $jab.addEventListener('input',  validateAndSave);

    // — Blok submit bila U&J kosong (pakai capture agar menang awal)
    $submit.addEventListener('click', (ev) => {
      const u = ($unit.value || '').trim();
      const j = ($jab.value  || '').trim();
      if (!u || !j) {
        showUJ();
        setInvalid($unit, !u, 'Unit wajib diisi');
        setInvalid($jab,  !j,  'Jabatan wajib diisi');
        toastErr('Lengkapi Unit dan Jabatan terlebih dahulu.');
        (!u ? $unit : $jab).focus();
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }, true);

    // — Reset cache saat Logout
    if ($logout) {
      $logout.addEventListener('click', () => { clearCache(); }, true);
    }

    // — Auto-sync setelah “Simpan” di Settings
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('#btnSaveIdent')) {
        // beri kesempatan handler Settings menulis ke store
        setTimeout(() => {
          const next = getIdent() || {};
          // perbarui cache & field, tetap hormati UX default (sembunyikan U&J)
          writeCache({ nama: next.nama||'', unit: next.unit||'', jabatan: next.jabatan||'' });
          if (!$page.classList.contains('d-none')) {
            // jangan ganggu jika user sedang mengetik di salah satu field
            if (!document.activeElement || ![$nama,$unit,$jab].includes(document.activeElement)) {
              $nama.value = next.nama || '';
              $unit.value = next.unit || '';
              $jab.value  = next.jabatan || '';
              initialNama = ($nama.value || '').trim();
              hideUJ();
              setInvalid($unit, false);
              setInvalid($jab,  false);
            }
          }
        }, 0);
      }
    }, true);

    // — Sync antar-tab/jendela
    window.addEventListener('storage', (ev) => {
      if (ev.key !== ORDER_IDENT_CACHE) return;
      try {
        const next = JSON.parse(ev.newValue || 'null') || {};
        if (!document.activeElement || ![$nama,$unit,$jab].includes(document.activeElement)) {
          if (typeof next.nama === 'string')    $nama.value = next.nama;
          if (typeof next.unit === 'string')    $unit.value = next.unit;
          if (typeof next.jabatan === 'string') $jab.value  = next.jabatan;
          hideUJ();
          setInvalid($unit, false);
          setInvalid($jab,  false);
        }
      } catch {}
    });

    wired = true;
  }

  // dipanggil sebelum submit agar Settings juga ikut terbarui
  function persistToSettingsStore() {
    // gabungkan cache & field -> tulis via setIdent (source of truth)
    const obj = {
      nama: ($nama?.value || '').trim(),
      unit: ($unit?.value || '').trim(),
      jabatan: ($jab?.value || '').trim(),
    };
    setIdent(obj);
    writeCache(obj);
  }

  return { mount, persistToSettingsStore, showUJ, hideUJ };
})();

// ===================================================================
// Auto-suggest Wilayah
// ===================================================================
function suggestSetup(inputEl, listEl){
  inputEl.setAttribute('autocomplete','off');
  inputEl.setAttribute('autocorrect','off');
  inputEl.setAttribute('autocapitalize','off');
  inputEl.setAttribute('spellcheck','false');

  const renderList = ()=>{
    const key = inputEl.value.trim().toLowerCase();
    if (key.length < 1){
      listEl.classList.add('d-none'); listEl.innerHTML = ''; return;
    }
    const items = getWilayah().filter(w => w.toLowerCase().includes(key)).slice(0, 20);
    if (!items.length){ listEl.classList.add('d-none'); listEl.innerHTML = ''; return; }
    listEl.innerHTML = items.map(w => `<div class="suggest-item" data-val="${w.replace(/"/g,'&quot;')}">${w}</div>`).join('');
    listEl.classList.remove('d-none');
  };

  inputEl.addEventListener('input', debounce(renderList, 80));
  inputEl.addEventListener('focus', renderList);
  inputEl.addEventListener('blur', ()=> setTimeout(()=> listEl.classList.add('d-none'), 150));

  const choose = (ev)=>{
    const it = ev.target.closest('.suggest-item');
    if(!it) return;
    ev.preventDefault(); ev.stopPropagation();
    const val = it.getAttribute('data-val');
    inputEl.value = val;
    listEl.classList.add('d-none');
    inputEl.dispatchEvent(new Event('change'));
    inputEl.focus();
  };
  listEl.addEventListener('pointerdown', choose, {capture:true});
  listEl.addEventListener('click', choose);
}

// ===================================================================
// Swap Dari ↔ Ke
// ===================================================================
function swapFromTo(){
  const a = q('#ordFrom').value; const b = q('#ordTo').value;
  q('#ordFrom').value = b; q('#ordTo').value = a;
}

// ===================================================================
// Tanggal/Jam
// ===================================================================
let depISO = '', retISO = '';
function setDep(iso){ depISO = iso; q('#ordBerangkatLabel').value = fmtLong(iso); }
function setRet(iso){ retISO = iso; q('#ordPulangLabel').value   = fmtLong(iso); }

// ===================================================================
// Tamu
// ===================================================================
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

// ===================================================================
// Template & Upload Tamu
// ===================================================================
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

// ===================================================================
// Submit Order
// ===================================================================
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

  // persist identitas (ke Settings store & cache perangkat) + wilayah populer
  IdentUX.persistToSettingsStore();
  addWilayah(from); addWilayah(to);

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

// ===================================================================
// INIT
// ===================================================================
window.addEventListener('DOMContentLoaded', ()=>{
  // Mount Identitas UX (prefill + aturan tampil/sembunyi + sync)
  IdentUX.mount();

  // Auto-suggest wilayah
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
    // reset sesuai Settings (source of truth) dan sembunyikan U&J lagi
    const ident = getIdent() || {};
    const merge = { ...ident }; // tidak ambil cache agar 'reset' benar-benar mengikuti Settings
    localStorage.setItem(ORDER_IDENT_CACHE, JSON.stringify({
      nama: merge.nama||'', unit: merge.unit||'', jabatan: merge.jabatan||''
    }));
    // refresh tampilan ident di Order:
    q('#ordNama').value = merge.nama || '';
    q('#ordUnit').value = merge.unit || '';
    q('#ordJabatan').value = merge.jabatan || '';
    // Sembunyikan kembali U&J agar UX default terjaga
    // (akses via controller internal)
    const unitWrap = q('#ordUnit').closest('.col-md-4') || q('#ordUnit').parentElement;
    const jabWrap  = q('#ordJabatan').closest('.col-md-4') || q('#ordJabatan').parentElement;
    unitWrap?.classList.add('d-none');
    jabWrap?.classList.add('d-none');
    document.getElementById('btnEditIdent')?.classList.remove('d-none');

    // tamu tetap sesuai jumlah saat ini
    renderGuests(+q('#ordJmlTamu').value);
  });
});
