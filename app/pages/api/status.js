const API_KEY = process.env.WORLDLABS_API_KEY;
const API_BASE = 'https://api.worldlabs.ai/marble/v1';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { operationId } = req.query;
  if (!operationId) {
    return res.status(400).json({ error: 'operationId required' });
  }

  try {
    const response = await fetch(`${API_BASE}/operations/${operationId}`, {
      headers: {
        'WLT-Api-Key': API_KEY,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: JSON.stringify(data) });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
