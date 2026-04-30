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
    const endpoints = [
      `${MINUBA_BASE}/orders`,
      `${MINUBA_BASE}/Order`,
      `${MINUBA_BASE}/orders?limit=500`,
      `${MINUBA_BASE}/orders?pageSize=500`,
      `${MINUBA_BASE}/orders?take=500`,
    ];

    let allOrders = [];
    let lastError = '';

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json', 'ApiKey': MINUBA_KEY }
        });
        const text = await res.text();
        console.log(`URL: ${url} | Status: ${res.status} | Response: ${text.substring(0, 200)}`);
        if (res.ok) {
          const data = JSON.parse(text);
          allOrders = Array.isArray(data) ? data : (data.orders || data.data || data.items || data.result || []);
          break;
        } else {
          lastError = `${url}: HTTP ${res.status}: ${text}`;
        }
      } catch (e) {
        lastError = `${url}: ${e.message}`;
      }
    }

    if (!allOrders.length && lastError) throw new Error(lastError);

    const mapped = allOrders.map(o => ({
      ordrenummer:           String(o.id || o.orderId || o.orderNumber || o.Id || o.OrderId || '').trim(),
      kundenummer:           String(o.customerId || o.customerNumber || o.CustomerId || '').trim(),
      kundenavn:             String(o.customerName || o.name || o.CustomerName || o.Name || '').trim(),
      adresse:               String(o.deliveryAddress || o.address || o.contactAddress || o.DeliveryAddress || '').trim() || null,
      postnr:                String(o.deliveryZip || o.zip || o.contactZip || o.DeliveryZip || '').trim() || null,
      by:                    String(o.deliveryCity || o.city || o.contactCity || o.DeliveryCity || '').trim() || null,
      ordreoverskrift:       String(o.subject || o.title || o.description || o.Subject || o.Title || '').trim(),
      ordretype:             String(o.orderType || o.type || o.OrderType || o.Type || '').trim(),
      ansvarlig_medarbejder: String(o.responsibleEmployee || o.responsible || o.ResponsibleEmployee || '').trim(),
      afdeling:              String(o.department || o.Department || '').trim(),
      ordrestatus:           String(o.status || o.orderStatus || o.Status || o.OrderStatus || '').trim(),
      opfoelgningsnote:      String(o.followUpNote || o.note || o.FollowUpNote || o.Note || '').trim(),
      oprettet_dato:         String(o.createdDate || o.created || o.CreatedDate || o.Created || '').trim() || null,
    })).filter(o => o.ordrenummer);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: mapped, total: mapped.length, raw_count: allOrders.length })
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
