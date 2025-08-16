// settings.js
import { q } from './util.js';
import { getIdent, setIdent } from './store.js';
import { api } from './api.js';
import { showNotif } from './notif.js';
import { auth } from './auth.js';

const stabs = ['identitas','vehicles','drivers','users','config'];

/* ---------- Router Tab ---------- */
function showTab(name){
  stabs.forEach(s=>q(`#stab-${s}`)?.classList.toggle('d-none', s!==name));
  q('#pills').querySelectorAll('[data-stab]').forEach(b=>b.classList.toggle('active', b.dataset.stab===name));

  if (name === 'vehicles')      loadVehicles();
  else if (name === 'drivers')  loadDrivers();
  else if (name === 'users')    loadUsers();
  else if (name === 'config')   loadConfig();
}

/* ---------- Init ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  // nav pills
  q('#pills').querySelectorAll('[data-stab]').forEach(b=>b.addEventListener('click', ()=>showTab(b.dataset.stab)));
  showTab('identitas');

  // Identitas (localStorage)
  const ident = getIdent();
  q('#setNama').value    = ident.nama||'';
  q('#setUnit').value    = ident.unit||'';
  q('#setJabatan').value = ident.jabatan||'';
  q('#btnSaveIdent').addEventListener('click', ()=>{
    setIdent({
      nama:    q('#setNama').value.trim(),
      unit:    q('#setUnit').value.trim(),
      jabatan: q('#setJabatan').value.trim()
    });
    showNotif('success','Identitas tersimpan (local)');
  });

  // Tombol Tambah (dipasang sekali)
  q('#btnAddVeh')?.addEventListener('click', async ()=>{
    // biarkan format sesuai api.js kamu; jika api.upsertVehicle sudah menerima objek langsung, ini OK.
    await api.upsertVehicle({ id:'', name:'Nama Kendaraan', brand:'', plate:'', capacity:1, driverId:'', status:'available', note:'' });
    showNotif('success','Kendaraan ditambahkan');
    loadVehicles();
  });

  q('#btnAddDrv')?.addEventListener('click', async ()=>{
  try{
    await api.upsertDriver({ id: '', name: 'Nama Driver',  wa: '', status: 'active', userId: '' });
    showNotif('success','Driver ditambahkan');
    loadDrivers();
  }catch(e){
    showNotif('error', e.message || 'Gagal menambah driver');
  }
});

  q('#btnAddUser')?.addEventListener('click', async ()=>{
    const uname = prompt('Username baru?'); if(!uname) return;
    await api.upsertUser({ user:{ username: uname.trim(), role: 'user', tgId: '' } });
    showNotif('success','User ditambahkan (PW awal 1234)');
    loadUsers();
  });

});

/* ---------- Vehicles ---------- */
async function loadVehicles(){
  const rows = await api.listVehicles();
  q('#tblSetVehicles').innerHTML = rows.map(v=>`
    <tr data-id="${v.id}">
      <td><input class="form-control form-control-sm" value="${v.name}"></td>
      <td><input class="form-control form-control-sm" value="${v.brand||''}"></td>
      <td><input class="form-control form-control-sm" value="${v.plate||''}"></td>
      <td style="width:90px"><input type="number" min="1" class="form-control form-control-sm" value="${v.capacity||1}"></td>
      <td>
        <select class="form-select form-select-sm" data-drv></select>
      </td>
      <td>
        <select class="form-select form-select-sm">
          <option value="available"   ${v.status==='available'?'selected':''}>Tersedia</option>
          <option value="allocated"   ${v.status==='allocated'?'selected':''}>Teralokasi</option>
          <option value="on_trip"     ${v.status==='on_trip'?'selected':''}>Dalam Perjalanan</option>
          <option value="maintenance" ${v.status==='maintenance'?'selected':''}>Perbaikan</option>
          <option value="inactive"    ${v.status==='inactive'?'selected':''}>Non-Aktif</option>
        </select>
      </td>
      <td><input class="form-control form-control-sm" value="${v.note||''}" placeholder="keterangan status"></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-primary" data-save>Simpan</button>
        <button class="btn btn-sm btn-outline-danger" data-del>Hapus</button>
      </td>
    </tr>
  `).join('');

  // Isi opsi driver
  const drivers = await api.listDrivers();
  q('#tblSetVehicles').querySelectorAll('tr').forEach(tr=>{
    const select = tr.querySelector('[data-drv]');
    select.innerHTML = ['<option value="">(Tanpa Driver)</option>', ...drivers.map(d=>`<option value="${d.id}">${d.name}</option>`)].join('');
  });
  // Set selected driverId sesuai data
  rows.forEach((v,i)=>{
    const tr = q('#tblSetVehicles').querySelectorAll('tr')[i];
    tr.querySelector('[data-drv]').value = v.driverId||'';
  });

  // Bind aksi
  q('#tblSetVehicles').querySelectorAll('[data-save]').forEach(btn=>btn.addEventListener('click', async ()=>{
    const tr  = btn.closest('tr');
    const tds = tr.querySelectorAll('td');
    const v = {
      id:       tr.dataset.id,
      name:     tds[0].querySelector('input').value.trim(),
      brand:    tds[1].querySelector('input').value.trim(),
      plate:    tds[2].querySelector('input').value.trim(),
      capacity: +tds[3].querySelector('input').value || 1,
      driverId: tds[4].querySelector('select').value || '',
      status:   tds[5].querySelector('select').value,
      note:     tds[6].querySelector('input').value.trim()
    };
    await api.upsertVehicle(v);
    showNotif('success','Kendaraan disimpan');
    loadVehicles();
  }));
  q('#tblSetVehicles').querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', async ()=>{
    const id = btn.closest('tr').dataset.id;
    await api.deleteVehicle(id);
    showNotif('success','Kendaraan dihapus');
    loadVehicles();
  }));
}

/* ---------- Drivers (dengan binding userId) ---------- */
async function loadDrivers(){
  const [drivers, users] = await Promise.all([api.listDrivers(), api.listUsers()]);
  const driverUsers = users.filter(u => u.role === 'driver').map(u=>u.username);

  const tbody = q('#tblSetDrivers');
  tbody.innerHTML = drivers.map(d=>{
    const userOpt = ['<option value="">(tidak terikat)</option>']
      .concat(driverUsers.map(u=>`<option value="${u}" ${d.userId===u?'selected':''}>${u}</option>`))
      .join('');
    const statusOpt = ['active','inactive']
      .map(s=>`<option value="${s}" ${d.status===s?'selected':''}>${s}</option>`).join('');
    return `<tr data-id="${d.id}">
      <td><input class="form-control form-control-sm" data-f="name"   value="${d.name||''}"></td>
      <td><input class="form-control form-control-sm" data-f="wa"     value="${d.wa||''}"></td>
      <td><select class="form-select form-select-sm"  data-f="status">${statusOpt}</select></td>
      <td><select class="form-select form-select-sm"  data-f="userId">${userOpt}</select></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-primary"         data-act="save">Simpan</button>
        <button class="btn btn-sm btn-outline-danger ms-1" data-act="del">Hapus</button>
      </td>
    </tr>`;
  }).join('');

  // Save driver
  tbody.querySelectorAll('button[data-act="save"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tr  = btn.closest('tr'); const id = tr.getAttribute('data-id');
      const get = s => tr.querySelector(`[data-f="${s}"]`).value;
      try{
        await api.upsertDriver({ drv:{
          id,
          name:   get('name').trim(),
          wa:     get('wa').trim(),
          status: get('status'),
          userId: get('userId').trim()
        }});
        showNotif('success','Driver disimpan');
      }catch(e){
        showNotif('error', e.message||'Gagal simpan driver');
      }
    });
  });
  // Delete driver
  tbody.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tr = btn.closest('tr'); const id = tr.getAttribute('data-id');
      if(!confirm('Hapus driver ini?')) return;
      try{
        await api.deleteDriver(id);
        tr.remove();
        showNotif('success','Driver dihapus');
      }catch(e){
        showNotif('error', e.message||'Gagal hapus driver');
      }
    });
  });
}
// muat saat tab drivers aktif
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('#pills [data-stab]');
  if(!btn) return;
  if (btn.dataset.stab === 'drivers') loadDrivers();
});
window.addEventListener('route', e=>{
  if(e.detail.page==='settings'){
    const active = document.querySelector('#pills .nav-link.active')?.dataset.stab;
    if(active==='drivers') loadDrivers();
  }
});

/* ---------- Users (dengan role cashier) ---------- */
async function loadUsers(){
  const users = await api.listUsers();
  const tbody = q('#tblSetUsers');

  tbody.innerHTML = users.map(u=>{
    // Admin tidak boleh set 'master'
    const ROLES = (auth.user?.role === 'admin')
      ? ['user','driver','cashier','admin']
      : ['user','driver','cashier','admin','master'];

    const roleOpt = ROLES.map(r =>
      `<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`
    ).join('');

    const isAdmin  = u.username === 'admin';
    const isMaster = u.username === 'master';
    if (auth.user?.role === 'admin' && isMaster) return ''; // sembunyikan baris master utk admin

    return `<tr data-uname="${u.username}">
      <td class="text-monospace">${u.username}</td>
      <td><select class="form-select form-select-sm" data-f="role">${roleOpt}</select></td>
      <td><input class="form-control form-control-sm" data-f="tgId" placeholder="Telegram chat ID" value="${u.tgId||''}"></td>
      <td class="text-nowrap">
        <input class="form-control form-control-sm d-inline-block w-auto me-2" data-f="newPassword" type="password" placeholder="password baru">
        <button class="btn btn-sm btn-primary" data-act="save">Simpan</button>
        ${(!isAdmin && !isMaster) ? `<button class="btn btn-sm btn-outline-danger ms-1" data-act="del">Hapus</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  // Save user
  tbody.querySelectorAll('button[data-act="save"]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const tr = btn.closest('tr'); const uname = tr.getAttribute('data-uname');
    const get = s => tr.querySelector(`[data-f="${s}"]`);
    const role = get('role')?.value;
    const tgId = get('tgId')?.value || '';
    const newPassword = get('newPassword')?.value || '';

    try{
      // ⬇️ KIRIM FLAT OBJ, JANGAN { user:{...} }
      await api.upsertUser({ username: uname, role, tgId, newPassword });
      showNotif('success','User tersimpan');
    }catch(e){
      showNotif('error', e.message || 'Gagal simpan user');
    }
  });
});
  // Delete user
  tbody.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tr = btn.closest('tr'); const uname = tr.getAttribute('data-uname');
      if(!confirm(`Hapus user "${uname}"?`)) return;
      try{
        await api.deleteUser(uname);
        tr.remove();
        showNotif('success','User dihapus');
      }catch(e){
        showNotif('error', e.message || 'Gagal hapus user');
      }
    });
  });
}
// muat saat tab users aktif
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('#pills [data-stab]');
  if(!btn) return;
  if (btn.dataset.stab === 'users') loadUsers();
});
window.addEventListener('route', (e)=>{
  if(e.detail.page==='settings'){
    const active = document.querySelector('#pills .nav-link.active')?.dataset.stab;
    if(active==='users') loadUsers();
  }
});

/* ---------- Config ---------- */
async function loadConfig(){
  const c = await api.getConfig();
  q('#cfgTgBot').value   = c.tgBot||'';
  q('#cfgTgAdmin').value = c.tgAdmin||'';
}
q('#btnSaveConfig')?.addEventListener('click', async ()=>{
  await api.setConfig({
    tgBot:   q('#cfgTgBot').value.trim(),
    tgAdmin: q('#cfgTgAdmin').value.trim()
  });
  showNotif('success','Config disimpan');
});
q('#btnRefreshConfig')?.addEventListener('click', loadConfig);
