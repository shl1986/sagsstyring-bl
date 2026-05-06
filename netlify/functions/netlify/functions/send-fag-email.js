const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME = 'Sagsstyring · Bjarne Larsen ApS';

// Fag → ansvarlig e-mail mapping
const FAG_ANSVARLIG = {
  'Tømrer': null, // Afhænger af ansvarlig medarbejder - se nedenfor
  'Murer':  'morten@bjarnelarsen.nu',
  'Maler':  'tanja@bjarnelarsen.nu',
  'Kloak':  'lasse@bjarnelarsen.nu',
  'El':     null,
  'VVS':    null,
};

// Tømrer: Simon eller Marius afhængig af ansvarlig
const TOEMRER_MAP = {
  'Simon Østergaard Poulsen': 'simon.p@bjarnelarsen.nu',
  'Marius Vilsted Meister':   'mv@bjarnelarsen.nu',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!SENDGRID_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY ikke konfigureret' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ugyldig JSON' }) };
  }

  const { sag, nytFag, ansvarlig } = body;
  if (!sag || !nytFag) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Mangler sag eller nytFag' }) };
  }

  // Find modtager
  let toEmail = null;
  if (nytFag === 'Tømrer') {
    toEmail = TOEMRER_MAP[ansvarlig] || null;
  } else {
    toEmail = FAG_ANSVARLIG[nytFag] || null;
  }

  if (!toEmail) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: `Ingen e-mail konfigureret for fag: ${nytFag}` })
    };
  }

  const subject = `Ny opgave tildelt: ${nytFag} · Sag #${sag.ordrenummer}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#B81C2B;padding:16px 20px;border-radius:6px 6px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">Ny opgave tildelt</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
        <p style="margin:0 0 16px;font-size:15px">Du er tildelt en opgave som <strong>${nytFag}</strong>:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666;width:120px">Sagnummer</td><td style="padding:6px 0;font-weight:500">#${sag.ordrenummer}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Kunde</td><td style="padding:6px 0">${sag.kundenavn || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Adresse</td><td style="padding:6px 0">${sag.adresse || '—'}, ${sag.postnr || ''} ${sag.by || ''}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Overskrift</td><td style="padding:6px 0">${sag.ordreoverskrift || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Ansvarlig</td><td style="padding:6px 0">${sag.ansvarlig_medarbejder || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Status</td><td style="padding:6px 0">${sag.ordrestatus || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Fag tildelt</td><td style="padding:6px 0"><strong style="color:#B81C2B">${nytFag}</strong></td></tr>
        </table>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f0f0f0">
          <a href="https://iva-bl.netlify.app" style="background:#B81C2B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500">Åbn sagsstyring</a>
        </div>
        <p style="margin-top:20px;font-size:12px;color:#999">Byggefirmaet Bjarne Larsen ApS · Sagsstyring</p>
      </div>
    </div>
  `;

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`SendGrid fejl ${res.status}: ${err}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent: true, to: toEmail, fag: nytFag })
    };

  } catch(err) {
    console.error('Send email fejl:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
