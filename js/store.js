// store.js
const LS_IDENT = 'identitas';
const LS_WIL   = 'wilayahList';
const LS_TOKEN = 'authToken';

export function getIdent(){ return JSON.parse(localStorage.getItem(LS_IDENT) || '{"nama":"","unit":"","jabatan":""}'); }
export function setIdent(obj){ localStorage.setItem(LS_IDENT, JSON.stringify(obj||{})); }

export function addWilayah(name){
  name = (name||'').trim(); if(!name) return;
  const base = getWilayah();
  if(!base.includes(name)) base.unshift(name);
  localStorage.setItem(LS_WIL, JSON.stringify(base.slice(0,100)));
}
export function getWilayah(){
  const def = ["Pontianak","Kuching","Sintang","Putussibau","Mess Seriang","Mess Sungai Tawang","Mess Sungai Mawang","Mess Sejiram","Mess Jungkit"];
  const arr = JSON.parse(localStorage.getItem(LS_WIL)||'[]');
  return [...new Set([...arr, ...def])];
}

export function saveToken(tokenObj){ localStorage.setItem(LS_TOKEN, JSON.stringify(tokenObj)); }
export function loadToken(){ return JSON.parse(localStorage.getItem(LS_TOKEN)||'null'); }
export function clearToken(){ localStorage.removeItem(LS_TOKEN); }

export function cachePreselectVehicle(id){ sessionStorage.setItem('preVeh', id||''); }
export function takePreselectVehicle(){ const x=sessionStorage.getItem('preVeh'); sessionStorage.removeItem('preVeh'); return x; }
