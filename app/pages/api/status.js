import https from 'https';

const WORLDLABS_API_KEY = process.env.WORLDLABS_API_KEY;

function apiRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.worldlabs.ai',
      path: `/v0${path}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${WORLDLABS_API_KEY}` }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { operationId } = req.query;
  if (!operationId) {
    return res.status(400).json({ error: 'operationId required' });
  }

  try {
    const result = await apiRequest(`/operations/${operationId}`);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
