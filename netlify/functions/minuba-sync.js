const MINUBA_KEY = process.env.MINUBA_API_KEY;
const MINUBA_BASE = 'https://app.minuba.dk/api/v2';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!MINUBA_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'MINUBA_API_KEY ikke konfigureret' }) };
  }

  try {
    let allOrders = [];
    let page = 1;
    const pageSize = 100;

    while (true) {
      const url = `${MINUBA_BASE}/orders?limit=${pageSize}&offset=${(page-1)*pageSize}`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'ApiKey': MINUBA_KEY
        }
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Minuba HTTP ${res.status}: ${err}`);
      }

      const data = await res.json();
      const orders = Array.isArray(data) ? data : (data.orders || data.data || []);

      if (!orders.length) break;
      allOrders = allOrders.concat(orders);
      if (orders.length < pageSize) break;
      page++;
    }

    const mapped = allOrders.map(o => ({
      ordrenummer:           String(o.id || o.orderId || o.orderNumber || '').trim(),
      kundenummer:           String(o.customerId || o.customerNumber || '').trim(),
      kundenavn:             String(o.customerName || o.name || '').trim(),
      adresse:               String(o.deliveryAddress || o.address || o.contactAddress || '').trim() || null,
      postnr:                String(o.deliveryZip || o.zip || o.contactZip || '').trim() || null,
      by:                    String(o.deliveryCity || o.city || o.contactCity || '').trim() || null,
      ordreoverskrift:       String(o.subject || o.title || o.description || '').trim(),
      ordretype:             String(o.orderType || o.type || '').trim(),
      ansvarlig_medarbejder: String(o.responsibleEmployee || o.responsible || '').trim(),
      afdeling:              String(o.department || '').trim(),
      ordrestatus:           String(o.status || o.orderStatus || '').trim(),
      opfoelgningsnote:      String(o.followUpNote || o.note || '').trim(),
      oprettet_dato:         String(o.createdDate || o.created || '').trim() || null,
    })).filter(o => o.ordrenummer);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: mapped, total: mapped.length })
    };

  } catch (err) {
    console.error('Minuba sync fejl:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
