const https = require('https');

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME  = 'Sagsstyring · Bjarne Larsen ApS';
const APP_URL    = 'https://iva-bl.netlify.app';

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!RESEND_KEY) return { statusCode: 500, body: 'RESEND_API_KEY mangler' };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, body: 'Ugyldig JSON' }; }

  const { sag, besked, fraIni, tilEmail } = body;
  if (!sag || !besked || !tilEmail) return { statusCode: 400, body: 'Mangler data' };

  const subject = `✉️ Ny besked fra ${fraIni} · Sag #${sag.ordrenummer}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">✉️ Ny intern besked</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#666;width:100px">Sagnummer</td><td style="padding:6px 0;font-weight:600">#${sag.ordrenummer}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Kunde</td><td style="padding:6px 0">${sag.kundenavn||'—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Fra</td><td style="padding:6px 0;font-weight:600;color:#B81C2B">${fraIni}</td></tr>
        </table>
        <div style="background:#f9fafb;border-left:3px solid #B81C2B;padding:12px 16px;border-radius:0 4px 4px 0;font-size:15px;margin-bottom:20px">
          ${besked.tekst}
        </div>
        <p style="font-size:13px;color:#666;margin-bottom:16px">Åbn sagen og kvitter med ✓ når du har set og forstået beskeden.</p>
        <a href="${APP_URL}" style="background:#B81C2B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">Åbn sagsstyring</a>
        <p style="margin-top:20px;font-size:12px;color:#999">Byggefirmaet Bjarne Larsen ApS · Sagsstyring</p>
      </div>
    </div>`;

  try {
    const result = await sendMail({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [tilEmail], subject, html });
    if (result.status >= 400) throw new Error(`Resend ${result.status}: ${result.body}`);
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch(err) {
    console.error('Mail fejl:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
