// netlify/functions/opfoelgning-reminder.js
// Kører hver morgen kl. 07:00 dansk tid (05:00 UTC)
// Sender reminder-mail via SendGrid til brugere med opfølgningsdato nået

const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_ANON_KEY;
const SG_KEY    = process.env.SENDGRID_API_KEY;
const APP_URL   = 'https://iva-bl.netlify.app';
const FROM_EMAIL = 'shl@bjarnelarsen.nu';
const FROM_NAME  = 'Sagsstyring · Bjarne Larsen ApS';

exports.handler = async () => {
  try {
    // ── 1. Hent alle sager med opfølgningsdatoer ──────────────────────────
    const res = await fetch(
      `${SUPA_URL}/rest/v1/sager?select=ordrenummer,kundenavn,adresse,by,postnr,ordreoverskrift,ansvarlig_medarbejder,opfoelgning_datoer&opfoelgning_datoer=neq.{}`,
      {
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Supabase fejl:', err);
      return { statusCode: 500, body: 'Supabase fejl: ' + err };
    }

    const sager = await res.json();

    // ── 2. Find sager der skal sendes reminder for i dag ──────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Saml notifikationer per modtager-email
    // { "email@example.com": [ {sag, dato}, ... ] }
    const reminders = {};

    for (const sag of sager) {
      let datoMap = {};
      try {
        datoMap = JSON.parse(sag.opfoelgning_datoer || '{}');
      } catch (e) {
        continue;
      }

      for (const [email, datoStr] of Object.entries(datoMap)) {
        if (!datoStr) continue;
        const dato = new Date(datoStr);
        dato.setHours(0, 0, 0, 0);

        // Send hvis datoen er i dag eller overskredet
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

    // ── 3. Send én samlet mail per modtager ───────────────────────────────
    const results = await Promise.allSettled(
      Object.entries(reminders).map(([email, items]) =>
        sendReminderEmail(email, items)
      )
    );

    const sent    = results.filter(r => r.status === 'fulfilled').length;
    const failed  = results.filter(r => r.status === 'rejected').length;
    console.log(`Reminders sendt: ${sent}, fejlede: ${failed}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, failed })
    };

  } catch (err) {
    console.error('Uventet fejl:', err);
    return { statusCode: 500, body: err.message };
  }
};

// ── Hjælpefunktion: send mail via SendGrid ─────────────────────────────────
async function sendReminderEmail(toEmail, items) {
  const antal = items.length;
  const sagListe = items.map(({ sag, dato }) => {
    const adresse = [sag.adresse, sag.postnr, sag.by].filter(Boolean).join(' ');
    const overskredet = new Date(dato) < new Date(new Date().setHours(0,0,0,0));
    const datoLabel = overskredet
      ? `<span style="color:#B81C2B;font-weight:600;">Overskredet (${fmtDato(dato)})</span>`
      : `<span style="color:#1565c0;">${fmtDato(dato)}</span>`;

    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e0d8;font-weight:600;color:#1a2024;">
          #${sag.ordrenummer} — ${esc(sag.kundenavn)}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e0d8;color:#6b7a8d;font-size:0.9em;">
          ${esc(adresse)}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e0d8;font-size:0.9em;">
          ${esc(sag.ordreoverskrift || '')}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e0d8;font-size:0.9em;">
          ${datoLabel}
        </td>
      </tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:32px 0;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#faf8f4;border:1px solid #ddd8ce;border-radius:8px;overflow:hidden;max-width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#B81C2B;padding:20px 28px;">
            <p style="margin:0;color:#fff;font-size:1.1em;font-weight:600;letter-spacing:0.02em;">
              Bjarne Larsen ApS · Sagsstyring
            </p>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="padding:28px 28px 16px;">
            <h1 style="margin:0 0 8px;font-size:1.3em;color:#1a2024;font-weight:600;">
              📌 ${antal === 1 ? '1 sag klar til opfølgning' : `${antal} sager klar til opfølgning`}
            </h1>
            <p style="margin:0;color:#6b7a8d;font-size:0.95em;line-height:1.5;">
              ${antal === 1
                ? 'Nedenstående sag har nået sin opfølgningsdato og venter på din handling.'
                : 'Nedenstående sager har nået deres opfølgningsdato og venter på din handling.'}
            </p>
          </td>
        </tr>

        <!-- Tabel -->
        <tr>
          <td style="padding:0 28px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd8ce;border-radius:4px;overflow:hidden;font-size:0.88em;">
              <thead>
                <tr style="background:#B81C2B;">
                  <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:500;font-size:0.8em;letter-spacing:0.04em;">SAG</th>
                  <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:500;font-size:0.8em;letter-spacing:0.04em;">ADRESSE</th>
                  <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:500;font-size:0.8em;letter-spacing:0.04em;">OVERSKRIFT</th>
                  <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:500;font-size:0.8em;letter-spacing:0.04em;">OPFØLGNING</th>
                </tr>
              </thead>
              <tbody>
                ${sagListe}
              </tbody>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:0 28px 28px;">
            <a href="${APP_URL}" style="display:inline-block;background:#B81C2B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:4px;font-size:0.9em;font-weight:600;">
              Åbn sagsstyring →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #ddd8ce;background:#f4f1ec;">
            <p style="margin:0;color:#6b7a8d;font-size:0.78em;line-height:1.5;">
              Denne mail er sendt automatisk af sagsstyringssystemet.<br>
              Fjern opfølgningsdatoen i systemet for at stoppe disse påmindelser.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const subject = antal === 1
    ? `📌 Opfølgning klar: ${items[0].sag.kundenavn} (#${items[0].sag.ordrenummer})`
    : `📌 ${antal} sager klar til opfølgning`;

  const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SG_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [{ type: 'text/html', value: html }]
    })
  });

  if (!sgRes.ok) {
    const err = await sgRes.text();
    console.error(`SendGrid fejl for ${toEmail}:`, err);
    throw new Error(`SendGrid fejl: ${err}`);
  }

  console.log(`Mail sendt til ${toEmail} (${antal} sager)`);
}

function fmtDato(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
