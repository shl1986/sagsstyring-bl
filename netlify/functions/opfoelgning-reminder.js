const https = require('https');

const SUPA_URL   = 'https://eybaeyemhnobxghxmtgx.supabase.co';
const SUPA_KEY   = process.env.SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME  = 'Sagsstyring · Bjarne Larsen ApS';
const APP_URL    = 'https://iva-bl.netlify.app';

function httpsGet(hostname, path, headers){
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sendMail(payload){
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fmtDato(str){ if(!str) return ''; const [y,m,d]=str.split('-'); return `${d}/${m}/${y}`; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

exports.handler = async () => {
  try {
    const supaHost = SUPA_URL.replace('https://','');
    const res = await httpsGet(supaHost,
      '/rest/v1/sager?select=ordrenummer,kundenavn,adresse,by,postnr,ordreoverskrift,ansvarlig_medarbejder,tasks',
      { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    );
    if(res.status !== 200){ console.error('Supabase fejl:', res.body); return { statusCode: 500, body: 'Supabase fejl' }; }

    const sager = JSON.parse(res.body);
    const today = new Date(); today.setHours(0,0,0,0);
    const pad = n => String(n).padStart(2,'0');
    const todayStr = today.getFullYear()+'-'+pad(today.getMonth()+1)+'-'+pad(today.getDate());

    const reminders = {};
    for(const sag of sager){
      let tasks = [];
      try { tasks = JSON.parse(sag.tasks||'[]'); } catch(e){ continue; }
      for(const task of tasks){
        if(!task.done && task.user && task.deadline && task.deadline <= todayStr){
          if(!reminders[task.user]) reminders[task.user] = [];
          reminders[task.user].push({ sag, task });
        }
      }
    }

    if(!Object.keys(reminders).length){ console.log('Ingen reminders.'); return { statusCode: 200, body: 'Ingen reminders' }; }

    let sent=0, failed=0;
    for(const [email, items] of Object.entries(reminders)){
      try {
        const antal = items.length;
        const sagListe = items.map(({sag,task}) => {
          const adresse = [sag.adresse,sag.postnr,sag.by].filter(Boolean).join(' ');
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">#${esc(sag.ordrenummer)} — ${esc(sag.kundenavn)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#666;font-size:13px">${esc(adresse)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(task.text)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#B81C2B;font-weight:600">${fmtDato(task.deadline)}</td>
          </tr>`;
        }).join('');

        const subject = antal===1 ? `📌 Overskredet opgave: ${items[0].sag.kundenavn}` : `📌 ${antal} overskredet opgaver`;
        const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
          <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
            <h1 style="color:#fff;font-size:18px;margin:0">📌 ${antal===1?'1 overskredet opgave':`${antal} overskredet opgaver`}</h1>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
            <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb">
              <thead><tr style="background:#B81C2B">
                <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">SAG</th>
                <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">ADRESSE</th>
                <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">OPGAVE</th>
                <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">DEADLINE</th>
              </tr></thead>
              <tbody>${sagListe}</tbody>
            </table>
            <div style="margin-top:20px"><a href="${APP_URL}" style="background:#B81C2B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500">Åbn sagsstyring</a></div>
            <p style="margin-top:20px;font-size:12px;color:#999">Sendes automatisk kl. 05:00 · Bjarne Larsen ApS</p>
          </div>
        </div>`;

        const result = await sendMail({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [email], subject, html });
        if(result.status >= 400) throw new Error(`Resend ${result.status}: ${result.body}`);
        sent++;
      } catch(e){ console.error(`Fejl for ${email}:`, e.message); failed++; }
    }

    console.log(`Sendt: ${sent}, fejl: ${failed}`);
    return { statusCode: 200, body: JSON.stringify({ sent, failed }) };
  } catch(err){
    console.error('Uventet fejl:', err);
    return { statusCode: 500, body: err.message };
  }
};
