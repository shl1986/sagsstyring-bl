const https = require('https');

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME = 'Sagsstyring · Bjarne Larsen ApS';

const FAG_ANSVARLIG = {
  'Tømrer': 'simon.p@bjarnelarsen.nu',
  'Murer':  'morten@bjarnelarsen.nu',
  'Maler':  'tanja@bjarnelarsen.nu',
  'Kloak':  'lasse@bjarnelarsen.nu',
};

function sendMail(payload){
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!SENDGRID_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY ikke konfigureret' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Ugyldig JSON' }) }; }

  const { sag, nytFag, ansvarlig } = body;
  if (!sag || !nytFag) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Mangler sag eller nytFag' }) };
  }

  const toEmail = FAG_ANSVARLIG[nytFag] || null;

  if (!toEmail) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `Ingen email for: ${nytFag}` }) };
  }

  const subject = `Ny opgave tildelt: ${nytFag} · Sag #${sag.ordrenummer}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">Ny opgave tildelt: ${nytFag}</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666;width:120px">Sagnummer</td><td style="padding:6px 0;font-weight:500">#${sag.ordrenummer}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Kunde</td><td style="padding:6px 0">${sag.kundenavn||'—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Adresse</td><td style="padding:6px 0">${sag.adresse||'—'}, ${sag.postnr||''} ${sag.by||''}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Overskrift</td><td style="padding:6px 0">${sag.ordreoverskrift||'—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Ansvarlig</td><td style="padding:6px 0">${sag.ansvarlig_medarbejder||'—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Status</td><td style="padding:6px 0">${sag.ordrestatus||'—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Fag tildelt</td><td style="padding:6px 0"><strong style="color:#B81C2B">${nytFag}</strong></td></tr>
        </table>
        <div style="margin-top:20px">
          <a href="https://iva-bl.netlify.app" style="background:#B81C2B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500">Åbn sagsstyring</a>
        </div>
        <p style="margin-top:20px;font-size:12px;color:#999">Byggefirmaet Bjarne Larsen ApS · Sagsstyring</p>
      </div>
    </div>`;

  try {
    const result = await sendMail({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
    });

    if (result.status >= 400) {
      throw new Error(`SendGrid ${result.status}: ${result.body}`);
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true, to: toEmail, fag: nytFag }) };
  } catch(err) {
    console.error('Send email fejl:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
