// util.js
export const q  = (sel, root=document)=>root.querySelector(sel);
export const qa = (sel, root=document)=>[...root.querySelectorAll(sel)];

export const dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
export const monNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

export const pad2 = n => (n<10?'0':'')+n;

export function fmtTableDate(dt){ // dd/mm/yyyy
  const d = new Date(dt); if(isNaN(d)) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
}
export function fmtTableTime(dt){ // HH:MM 24h
  const d = new Date(dt); if(isNaN(d)) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function fmtLong(dt){ // dddd, dd mmm yyyy – HH:MM
  const d = new Date(dt); if(isNaN(d)) return '';
  const dddd = dayNames[d.getDay()];
  const dd = pad2(d.getDate());
  const mmm = monNames[d.getMonth()];
  const yyyy = d.getFullYear();
  const HH = pad2(d.getHours()); const MM = pad2(d.getMinutes());
  return `${dddd}, ${dd} ${mmm} ${yyyy} – ${HH}:${MM}`;
}

export function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

export function debounce(fn, wait=300){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait) };
}
