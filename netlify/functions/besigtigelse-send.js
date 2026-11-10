// Netlify Function: besigtigelse-send
// Sender besigtigelsesrapporten som PDF til deltagerne fra Bjarne Larsen ApS.
// Bruger: RESEND_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (findes allerede i Netlify).
const https = require('https');

const RESEND_KEY = process.env.RESEND_API_KEY;
const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_ANON_KEY;
const FROM       = 'Besigtigelse · Bjarne Larsen ApS <shl@bjarnelarsen.nu>';
const TILLADT    = /@bjarnelarsen\.nu$/i;   // mails må kun gå til firmaets egne adresser

function req(method, url, headers, body){
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({ hostname:u.hostname, path:u.pathname+u.search, method,
      headers:{ ...headers, ...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}) }
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode, body:b})); });
    r.on('error', reject); if(data) r.write(data); r.end();
  });
}
const esc = s => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method not allowed' };
  if (!RESEND_KEY || !SUPA_URL || !SUPA_KEY) return { statusCode:500, body:'Miljøvariabler mangler i Netlify' };

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return { statusCode:401, body:'Ikke logget ind' };

  // 1. Tjek at brugeren er logget ind
  const who = await req('GET', SUPA_URL+'/auth/v1/user', { apikey:SUPA_KEY, Authorization:'Bearer '+token });
  if (who.status !== 200) return { statusCode:401, body:'Session udløbet – log ind igen' };
  const afsender = JSON.parse(who.body).email || '';

  let body; try { body = JSON.parse(event.body); } catch(e){ return { statusCode:400, body:'Ugyldig JSON' }; }
  const { id, pdfBase64, filnavn } = body || {};
  if (!id || !pdfBase64) return { statusCode:400, body:'Mangler rapport eller PDF' };
  if (pdfBase64.length > 4_000_000) return { statusCode:413, body:'PDF for stor' };

  // 2. Hent rapporten med brugerens egen adgang
  const rr = await req('GET', `${SUPA_URL}/rest/v1/besigtigelser?id=eq.${encodeURIComponent(id)}&select=*`,
    { apikey:SUPA_KEY, Authorization:'Bearer '+token });
  const rows = rr.status===200 ? JSON.parse(rr.body) : [];
  if (!rows.length) return { statusCode:404, body:'Rapporten blev ikke fundet' };
  const r = rows[0];

  const til = [...new Set([...(r.deltagere_bl||[]).map(d=>d.email), afsender].filter(e => e && TILLADT.test(e)))];
  if (!til.length) return { statusCode:400, body:'Ingen modtagere' };

  const subject = `Besigtigelsesrapport · ${r.selskab||''} · Skadenr. ${r.skadenummer||'—'} · ${r.adresse||''}`.trim();
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
      <h1 style="color:#fff;font-size:18px;margin:0">Besigtigelsesrapport</h1>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px;font-size:14px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        <tr><td style="padding:4px 0;color:#666;width:130px">Skadenummer</td><td style="font-weight:600">${esc(r.skadenummer)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Adresse</td><td>${esc(r.adresse)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Selskab / fag</td><td>${esc(r.selskab)} · ${esc(r.fag)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Besigtiget</td><td>${esc(r.besigtigelsesdato)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Dækning</td><td>${esc(r.output?.daekning)}</td></tr>
      </table>
      <p style="margin:0 0 8px">Rapporten er vedhæftet som PDF.</p>
      <p style="color:#666;font-size:12px;margin:16px 0 0">Sendt fra BL Platform af ${esc(afsender)}</p>
    </div>
  </div>`;

  const mail = await req('POST', 'https://api.resend.com/emails', { Authorization:'Bearer '+RESEND_KEY }, {
    from: FROM, to: til, subject, html,
    attachments: [{ filename: (filnavn||'Besigtigelsesrapport.pdf').replace(/[^\wæøåÆØÅ .,-]/g,'-'), content: pdfBase64 }]
  });
  if (mail.status >= 300) return { statusCode:502, body:'Mail kunne ikke sendes: '+mail.body.slice(0,200) };

  // 3. Marker som sendt
  await req('PATCH', `${SUPA_URL}/rest/v1/besigtigelser?id=eq.${encodeURIComponent(id)}`,
    { apikey:SUPA_KEY, Authorization:'Bearer '+token, Prefer:'return=minimal' },
    { status:'sendt', sendt_at:new Date().toISOString(), sendt_til:til });

  return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ok:true, til }) };
};
