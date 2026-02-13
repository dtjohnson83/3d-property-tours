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
  api: { bodyParser: { sizeLimit: '100mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'World Labs API key not configured' });
  }

  try {
    const { images, name, mode, inputType, layoutMode, video, panorama } = req.body;
    const model = mode === 'draft' ? 'Marble 0.1-mini' : 'Marble 0.1-plus';

    let worldPrompt;

    if (inputType === 'video') {
      // Video prompt
      if (!video || !video.data) {
        return res.status(400).json({ error: 'No video data provided' });
      }
      const base64 = video.data.split(',')[1] || video.data;
      worldPrompt = {
        type: 'video',
        video_prompt: {
          source: 'data_base64',
          data_base64: base64,
        },
      };
    } else if (inputType === 'panorama') {
      // Panorama prompt
      if (!panorama || !panorama.data) {
        return res.status(400).json({ error: 'No panorama data provided' });
      }
      const base64 = panorama.data.split(',')[1] || panorama.data;
      worldPrompt = {
        type: 'panorama',
        panorama_prompt: {
          source: 'data_base64',
          data_base64: base64,
        },
      };
    } else {
      // Image-based prompts
      if (!images || images.length === 0) {
        return res.status(400).json({ error: 'No images provided' });
      }

      if (images.length === 1) {
        const base64 = images[0].data.split(',')[1];
        worldPrompt = {
          type: 'image',
          image_prompt: {
            source: 'data_base64',
            data_base64: base64,
          },
        };
      } else if (layoutMode === 'auto') {
        // Auto Layout — no azimuth, API auto-determines positioning
        worldPrompt = {
          type: 'multi-image',
          multi_image_prompt: images.map((img) => ({
            content: {
              source: 'data_base64',
              data_base64: img.data.split(',')[1],
            },
          })),
        };
      } else {
        // Direction Control — with azimuth
        const directions = { front: 0, right: 90, back: 180, left: 270 };
        worldPrompt = {
          type: 'multi-image',
          multi_image_prompt: images.map((img) => ({
            azimuth: img.direction ? directions[img.direction] : 0,
            content: {
              source: 'data_base64',
              data_base64: img.data.split(',')[1],
            },
          })),
        };
      }
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
