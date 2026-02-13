const API_KEY = process.env.WORLDLABS_API_KEY;
const API_BASE = 'https://api.worldlabs.ai/marble/v1';

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}/${path}`, {
    ...options,
    headers: {
      'WLT-Api-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'World Labs API key not configured' });
  }

  try {
    const { images, name, mode } = req.body;
    const model = mode === 'draft' ? 'Marble 0.1-mini' : 'Marble 0.1-plus';

    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    let worldPrompt;

    if (images.length === 1) {
      // Single image — send base64 directly
      const base64 = images[0].data.split(',')[1];
      worldPrompt = {
        type: 'image',
        image_prompt: {
          source: 'data_base64',
          data_base64: base64,
        },
      };
    } else {
      // Multiple images with azimuth
      const angleStep = 360 / images.length;
      worldPrompt = {
        type: 'multi-image',
        multi_image_prompt: images.map((img, i) => ({
          azimuth: Math.round(i * angleStep),
          content: {
            source: 'data_base64',
            data_base64: img.data.split(',')[1],
          },
        })),
      };
    }

    const result = await apiFetch('worlds:generate', {
      method: 'POST',
      body: JSON.stringify({
        world_prompt: worldPrompt,
        display_name: name || 'Property Tour',
        model,
      }),
    });

    res.status(200).json({
      operationId: result.operation_id,
      message: 'Generation started',
    });

  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
}
