const https = require('https');

const SUPA_URL   = 'https://eybaeyemhnobxghxmtgx.supabase.co';
const SUPA_KEY   = process.env.SUPABASE_ANON_KEY;
const SG_KEY     = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME  = 'Sagsstyring · Bjarne Larsen ApS';
const APP_URL    = 'https://iva-bl.netlify.app';

function httpsGet(hostname, path, headers) {
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

function httpsPost(hostname, path, headers, data) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
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
    // 1. Hent alle sager med tasks
    const supaHost = SUPA_URL.replace('https://', '');
    const res = await httpsGet(supaHost,
      '/rest/v1/sager?select=ordrenummer,kundenavn,adresse,by,postnr,ordreoverskrift,ansvarlig_medarbejder,tasks',
      { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    );

    if (res.status !== 200) {
      console.error('Supabase fejl:', res.body);
      return { statusCode: 500, body: 'Supabase fejl: ' + res.body };
    }

    const sager = JSON.parse(res.body);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // 2. Find overskredet opgaver per bruger-email
    // { "email": [ { sag, task } ] }
    const reminders = {};

    for (const sag of sager) {
      let tasks = [];
      try { tasks = JSON.parse(sag.tasks || '[]'); } catch(e) { continue; }

      for (const task of tasks) {
        if (!task.done && task.user && task.deadline) {
          const dl = new Date(task.deadline); dl.setHours(0, 0, 0, 0);
          if (dl <= today) {
            if (!reminders[task.user]) reminders[task.user] = [];
            reminders[task.user].push({ sag, task });
          }
        }
      }
    }

    if (Object.keys(reminders).length === 0) {
      console.log('Ingen overskredet opgaver i dag.');
      return { statusCode: 200, body: 'Ingen reminders i dag' };
    }

    // 3. Send én samlet mail per bruger
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

  const sagListe = items.map(({ sag, task }) => {
    const adresse = [sag.adresse, sag.postnr, sag.by].filter(Boolean).join(' ');
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">#${esc(sag.ordrenummer)} — ${esc(sag.kundenavn)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#666;font-size:13px">${esc(adresse)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(task.text)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#B81C2B;font-weight:600">${fmtDato(task.deadline)}</td>
      </tr>`;
  }).join('');

  const subject = antal === 1
    ? `📌 Overskredet opgave: ${items[0].sag.kundenavn} (#${items[0].sag.ordrenummer})`
    : `📌 ${antal} overskredet opgaver`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">📌 ${antal === 1 ? '1 overskredet opgave' : `${antal} overskredet opgaver`}</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
        <p style="margin:0 0 16px;color:#444;font-size:14px">
          ${antal === 1 ? 'Følgende opgave har passeret sin deadline:' : 'Følgende opgaver har passeret deres deadline:'}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:4px">
          <thead>
            <tr style="background:#B81C2B">
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">SAG</th>
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">ADRESSE</th>
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">OPGAVE</th>
              <th style="padding:8px 12px;color:#fff;text-align:left;font-size:12px">DEADLINE</th>
            </tr>
          </thead>
          <tbody>${sagListe}</tbody>
        </table>
        <div style="margin-top:20px">
          <a href="${APP_URL}" style="background:#B81C2B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500">Åbn sagsstyring</a>
        </div>
        <p style="margin-top:20px;font-size:12px;color:#999">Byggefirmaet Bjarne Larsen ApS · Sagsstyring · Sendes automatisk kl. 05:00</p>
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

  if (result.status >= 400) throw new Error(`SendGrid ${result.status}: ${result.body}`);
  console.log(`Mail sendt til ${toEmail} (${antal} opgaver)`);
}
