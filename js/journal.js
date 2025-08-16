// journal.js
import { q, fmtTableDate, fmtTableTime } from './util.js';
import { api } from './api.js';
import { showNotif } from './notif.js';

let cached=[];

async function show(){
  const f = q('#jrFrom').value; const t = q('#jrTo').value;
  if(!f||!t){ showNotif('error','Pilih periode'); return; }
  cached = await api.journal(`${f}T00:00:00`, `${t}T23:59:59`);
  const tb = q('#tblJournal'); let n=1;
  tb.innerHTML = cached.map(r=>`
    <tr>
      <td>${n++}</td>
      <td>${r.nama}</td>
      <td>${r.unit||''}</td>
      <td>${r.jabatan||''}</td>
      <td>${r.agenda||''}</td>
      <td>${r.vehicleName||''}</td>
      <td>${r.driverName||''}</td>
      <td>${fmtTableDate(r.departAt)}</td>
      <td>${fmtTableTime(r.departAt)}</td>
      <td>${fmtTableDate(r.arriveAt)}</td>
      <td>${fmtTableTime(r.arriveAt)}</td>
    </tr>
  `).join('');
}

function exportXlsx(){
  const head = [['No.','Nama','Unit','Jabatan','Agenda','Kendaraan','Driver','Tgl Berangkat','Jam Berangkat','Tgl Tiba','Jam Tiba']];
  const rows = cached.map((r,i)=>[
    i+1, r.nama, r.unit||'', r.jabatan||'', r.agenda||'', r.vehicleName||'', r.driverName||'',
    fmtTableDate(r.departAt), fmtTableTime(r.departAt), fmtTableDate(r.arriveAt), fmtTableTime(r.arriveAt)
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([...head, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Jurnal');
  XLSX.writeFile(wb, 'JurnalKendaraan.xlsx');
}

function exportPdf(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  const f = q('#jrFrom').value; const t = q('#jrTo').value;
  const title = `JURNAL PENGGUNAAN KENDARAAN PERIODE ${new Date(f).toLocaleDateString('id-ID')} - ${new Date(t).toLocaleDateString('id-ID')}`;
  doc.setFontSize(12);
  doc.text(title, 40, 30);
  doc.autoTable({
    startY: 45,
    head: [['No.','Nama','Unit','Jabatan','Agenda','Kendaraan','Driver','Tgl Berangkat','Jam Berangkat','Tgl Tiba','Jam Tiba']],
    body: cached.map((r,i)=>[
      i+1, r.nama, r.unit||'', r.jabatan||'', r.agenda||'', r.vehicleName||'', r.driverName||'',
      (r.departAt?new Date(r.departAt).toLocaleDateString('id-ID'):''), (r.departAt?new Date(r.departAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false}):''),
      (r.arriveAt?new Date(r.arriveAt).toLocaleDateString('id-ID'):''), (r.arriveAt?new Date(r.arriveAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false}):'')
    ]),
    styles:{ fontSize:9, cellPadding:3, overflow:'linebreak' },
    headStyles:{ fillColor:[240,240,240] },
    didDrawPage: (data)=>{
      const pageNumber = doc.internal.getNumberOfPages();
      const str = `${data.pageNumber} dari ${pageNumber}`;
      doc.setFontSize(8);
      doc.text(str, doc.internal.pageSize.getWidth()-60, 20, {align:'right'});
      if(data.pageNumber===pageNumber){
        const printStr = `Jurnal dicetak tanggal ${new Date().toLocaleDateString('id-ID')} - ${new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
        doc.text(printStr, 40, doc.internal.pageSize.getHeight()-20);
      }
    }
  });
  doc.save('JurnalKendaraan.pdf');
}

window.addEventListener('DOMContentLoaded', ()=>{
  q('#btnShowJournal').addEventListener('click', show);
  q('#btnXlsx').addEventListener('click', exportXlsx);
  q('#btnPdf').addEventListener('click', exportPdf);
});
