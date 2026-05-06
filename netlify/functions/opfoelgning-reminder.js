const https = require('https');

const SUPA_URL  = 'https://eybaeyemhnobxghxmtgx.supabase.co';
const SUPA_KEY  = process.env.SUPABASE_ANON_KEY;
const SG_KEY    = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME  = 'Sagsstyring · Bjarne Larsen ApS';
const APP_URL    = 'https://iva-bl.netlify.app';

function httpsPost(hostname, path, headers, data) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'POST', headers };
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

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fmtDato(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

exports.handler = async () => {
  try {
    // ── 1. Hent alle sager med opfølgningsdatoer fra Supabase ─────────────
    const supaHost = SUPA_URL.replace('https://', '');
    const supaPath = '/rest/v1/sager?select=ordrenummer,kundenavn,adresse,by,postnr,ordreoverskrift,ansvarlig_medarbejder,opfoelgning_datoer';

    const supaRes = await httpsGet(supaHost, supaPath, {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
    });

    if (supaRes.status !== 200) {
      console.error('Supabase fejl:', supaRes.body);
      return { statusCode: 500, body: 'Supabase fejl: ' + supaRes.body };
    }

    const sager = JSON.parse(supaRes.body);

    // ── 2. Find sager med opfølgningsdato nået i dag eller tidligere ───────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Saml per bruger-email: { "email": [{sag, dato}] }
    const reminders = {};

    for (const sag of sager) {
      let datoMap = {};
      try { datoMap = JSON.parse(sag.opfoelgning_datoer || '{}'); } catch(e) { continue; }

      for (const [email, datoStr] of Object.entries(datoMap)) {
        if (!datoStr) continue;
        const dato = new Date(datoStr);
        dato.setHours(0, 0, 0, 0);
        if (dato <= today) {
          if (!reminders[email]) reminders[email] = [];
          reminders[email].push({ sag, dato: datoStr });
        }
      }
    }

    if (Object.keys(reminders).length === 0) {
      console.log('Ingen opfølgninger at sende i dag.');
      return { statusCode: 200, body: 'Ingen reminders i dag' };
    }

    // ── 3. Send én samlet mail per bruger ──────────────────────────────────
    let sent = 0, failed = 0;

    for (const [email, items] of Object.entries(reminders)) {
      try {
        await sendReminderEmail(email, items);
        sent++;
      } catch(e) {
        console.error(`Fejl for ${email}:`, e.message);
        failed++;
      }
    }

    console.log(`Reminders sendt: ${sent}, fejlede: ${failed}`);
    return { statusCode: 200, body: JSON.stringify({ sent, failed }) };

  } catch(err) {
    console.error('Uventet fejl:', err);
    return { statusCode: 500, body: err.message };
  }
};

async function sendReminderEmail(toEmail, items) {
  const antal = items.length;

  const sagListe = items.map(({ sag, dato }) => {
    const adresse = [sag.adresse, sag.postnr, sag.by].filter(Boolean).join(' ');
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">#${esc(sag.ordrenummer)} — ${esc(sag.kundenavn)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#666;font-size:13px">${esc(adresse)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(sag.ordreoverskrift||'')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#B81C2B;font-weight:600">${fmtDato(dato)}</td>
      </tr>`;
  }).join('');

  const subject = antal === 1
    ? `📌 Opfølgning klar: ${items[0].sag.kundenavn} (#${items[0].sag.ordrenummer})`
    : `📌 ${antal} sager klar til opfølgning`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">📌 ${antal === 1 ? '1 sag klar til opfølgning' : `${antal} sager klar til opfølgning`}</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
        <p style="margin:0 0 16px;color:#444;font-size:14px">
          ${antal === 1 ? 'Følgende sag har nået sin opfølgningsdato:' : 'Følgende sager har nået deres opfølgningsdato:'}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:4px">
          <thead>
            <tr style="background:#B81C2B">
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">SAG</th>
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">ADRESSE</th>
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">OVERSKRIFT</th>
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">DATO</th>
            </tr>
          </thead>
          <tbody>${sagListe}</tbody>
        </table>
        <div style="margin-top:20px">
          <a href="${APP_URL}" style="background:#B81C2B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500">Åbn sagsstyring</a>
        </div>
        <p style="margin-top:20px;font-size:12px;color:#999">Byggefirmaet Bjarne Larsen ApS · Sagsstyring · Denne mail sendes automatisk kl. 05:00</p>
      </div>
    </div>`;

  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: toEmail }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    content: [{ type: 'text/html', value: html }],
  });

  const result = await httpsPost('api.sendgrid.com', '/v3/mail/send', {
    'Authorization': `Bearer ${SG_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  }, payload);

  if (result.status >= 400) {
    throw new Error(`SendGrid ${result.status}: ${result.body}`);
  }

  console.log(`Mail sendt til ${toEmail} (${antal} sager)`);
}
