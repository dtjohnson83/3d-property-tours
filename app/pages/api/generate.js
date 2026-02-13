import https from 'https';

const WORLDLABS_API_KEY = process.env.WORLDLABS_API_KEY;
const API_HOST = 'api.worldlabs.ai';

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: API_HOST,
      path: `/v0${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${WORLDLABS_API_KEY}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadMedia(buffer, filename, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const options = {
      hostname: API_HOST,
      path: '/v0/media',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WORLDLABS_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!WORLDLABS_API_KEY) {
    return res.status(500).json({ error: 'World Labs API key not configured' });
  }

  try {
    const { images, name, mode } = req.body;
    const model = mode === 'draft' ? 'Marble 0.1-mini' : 'Marble 0.1-plus';

    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    // Upload images
    const uploadedImages = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const buffer = Buffer.from(img.data.split(',')[1], 'base64');
      const upload = await uploadMedia(buffer, img.name, img.type);
      
      if (upload.status !== 200 && upload.status !== 201) {
        return res.status(500).json({ error: `Failed to upload ${img.name}`, details: upload.data });
      }

      const angleStep = 360 / images.length;
      uploadedImages.push({
        media_id: upload.data.id || upload.data.media_id,
        azimuth: Math.round(i * angleStep)
      });
    }

    // Generate world
    let worldPrompt;
    if (uploadedImages.length === 1) {
      worldPrompt = { image_prompt: { media_id: uploadedImages[0].media_id } };
    } else {
      worldPrompt = { multi_image_prompt: { images: uploadedImages } };
    }

    const genResult = await apiRequest('POST', '/worlds/generate', {
      world_prompt: worldPrompt,
      display_name: name || 'Property Tour',
      model
    });

    if (genResult.status !== 200 && genResult.status !== 201) {
      return res.status(500).json({ error: 'Generation failed', details: genResult.data });
    }

    res.status(200).json({
      operationId: genResult.data.operation_id,
      message: 'Generation started'
    });

  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
}
