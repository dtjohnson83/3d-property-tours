#!/usr/bin/env node

/**
 * 3D Property Tour Generator
 * 
 * Takes property photos and generates a navigable 3D environment
 * using World Labs API.
 * 
 * Usage:
 *   node generate-3d-tour.js --images ./photos/*.jpg --name "123 Main St"
 *   node generate-3d-tour.js --image ./photo.jpg --name "Living Room"
 *   node generate-3d-tour.js --video ./walkthrough.mp4 --name "Full Tour"
 *   node generate-3d-tour.js --text "Modern open-plan kitchen with marble countertops" --name "Kitchen Concept"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load credentials
const CREDS_PATH = path.join(__dirname, '..', 'credentials', 'worldlabs-credentials.json');

function loadApiKey() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error(`❌ No credentials found at ${CREDS_PATH}`);
    console.error('Create the file with: { "api_key": "your-key-here" }');
    console.error('Get your key at: https://platform.worldlabs.ai');
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  return creds.api_key;
}

function apiRequest(method, endpoint, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.worldlabs.ai',
      path: `/v0${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadFileRequest(filePath, apiKey) {
  return new Promise((resolve, reject) => {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
    
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska'
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    let body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const options = {
      hostname: 'api.worldlabs.ai',
      path: '/v0/media',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pollOperation(operationId, apiKey, maxWaitMs = 300000) {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const result = await apiRequest('GET', `/operations/${operationId}`, null, apiKey);
    
    if (result.data.done) {
      if (result.data.error) {
        throw new Error(`Generation failed: ${JSON.stringify(result.data.error)}`);
      }
      return result.data;
    }

    const progress = result.data.metadata?.progress_pct || 0;
    process.stdout.write(`\r⏳ Generating 3D world... ${progress}%`);
    
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error('Generation timed out after 5 minutes');
}

async function generateFromText(text, name, model, apiKey) {
  console.log(`🏗️  Generating 3D world from text: "${text}"`);
  
  const body = {
    world_prompt: { text_prompt: text },
    display_name: name || text.substring(0, 50),
    model: model
  };

  const result = await apiRequest('POST', '/worlds/generate', body, apiKey);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`API error ${result.status}: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function generateFromImage(imagePathOrUrl, name, model, apiKey) {
  let imageRef;

  if (imagePathOrUrl.startsWith('http')) {
    imageRef = { url: imagePathOrUrl };
  } else {
    console.log(`📤 Uploading ${path.basename(imagePathOrUrl)}...`);
    const upload = await uploadFileRequest(imagePathOrUrl, apiKey);
    if (upload.status !== 200 && upload.status !== 201) {
      throw new Error(`Upload failed: ${JSON.stringify(upload.data)}`);
    }
    imageRef = { media_id: upload.data.id || upload.data.media_id };
  }

  console.log(`🏗️  Generating 3D world from image...`);
  
  const body = {
    world_prompt: { image_prompt: imageRef },
    display_name: name || 'Property Tour',
    model: model
  };

  const result = await apiRequest('POST', '/worlds/generate', body, apiKey);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`API error ${result.status}: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function generateFromMultiImage(imagePaths, name, model, apiKey) {
  const images = [];
  const angleStep = 360 / imagePaths.length;

  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    let imageRef;

    if (imgPath.startsWith('http')) {
      imageRef = { url: imgPath };
    } else {
      console.log(`📤 Uploading ${path.basename(imgPath)} (${i + 1}/${imagePaths.length})...`);
      const upload = await uploadFileRequest(imgPath, apiKey);
      if (upload.status !== 200 && upload.status !== 201) {
        throw new Error(`Upload failed for ${imgPath}: ${JSON.stringify(upload.data)}`);
      }
      imageRef = { media_id: upload.data.id || upload.data.media_id };
    }

    images.push({
      ...imageRef,
      azimuth: Math.round(i * angleStep) // evenly space around 360°
    });
  }

  console.log(`🏗️  Generating 3D world from ${images.length} images...`);
  
  const body = {
    world_prompt: { multi_image_prompt: { images } },
    display_name: name || 'Property Tour',
    model: model
  };

  const result = await apiRequest('POST', '/worlds/generate', body, apiKey);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`API error ${result.status}: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function generateFromVideo(videoPath, name, model, apiKey) {
  let videoRef;

  if (videoPath.startsWith('http')) {
    videoRef = { url: videoPath };
  } else {
    console.log(`📤 Uploading video...`);
    const upload = await uploadFileRequest(videoPath, apiKey);
    if (upload.status !== 200 && upload.status !== 201) {
      throw new Error(`Upload failed: ${JSON.stringify(upload.data)}`);
    }
    videoRef = { media_id: upload.data.id || upload.data.media_id };
  }

  console.log(`🏗️  Generating 3D world from video...`);
  
  const body = {
    world_prompt: { video_prompt: videoRef },
    display_name: name || 'Property Tour',
    model: model
  };

  const result = await apiRequest('POST', '/worlds/generate', body, apiKey);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`API error ${result.status}: ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function main() {
  const args = process.argv.slice(2);
  const apiKey = loadApiKey();

  // Parse arguments
  let mode = null;
  let input = null;
  let inputs = [];
  let name = 'Property Tour';
  let model = 'Marble 0.1-plus'; // Standard quality
  let draft = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--text': mode = 'text'; input = args[++i]; break;
      case '--image': mode = 'image'; input = args[++i]; break;
      case '--images': mode = 'multi'; 
        // Collect all following args until next flag
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          inputs.push(args[++i]);
        }
        break;
      case '--video': mode = 'video'; input = args[++i]; break;
      case '--name': name = args[++i]; break;
      case '--draft': draft = true; model = 'Marble 0.1-mini'; break;
      case '--help':
        console.log(`
3D Property Tour Generator

Usage:
  node generate-3d-tour.js --text "description" --name "Property Name"
  node generate-3d-tour.js --image ./photo.jpg --name "123 Main St"
  node generate-3d-tour.js --images ./photo1.jpg ./photo2.jpg --name "Living Room"
  node generate-3d-tour.js --video ./walkthrough.mp4 --name "Full Tour"

Options:
  --text    Generate from text description
  --image   Generate from single image (path or URL)
  --images  Generate from multiple images (paths or URLs)
  --video   Generate from video (path or URL)
  --name    Display name for the 3D world
  --draft   Use faster/cheaper draft mode ($0.12 vs $1.20)
  --help    Show this help
        `);
        process.exit(0);
    }
  }

  if (!mode) {
    console.error('❌ Specify input: --text, --image, --images, or --video');
    console.error('Run with --help for usage info');
    process.exit(1);
  }

  try {
    let result;

    switch (mode) {
      case 'text':
        result = await generateFromText(input, name, model, apiKey);
        break;
      case 'image':
        result = await generateFromImage(input, name, model, apiKey);
        break;
      case 'multi':
        result = await generateFromMultiImage(inputs, name, model, apiKey);
        break;
      case 'video':
        result = await generateFromVideo(input, name, model, apiKey);
        break;
    }

    // Poll for completion
    const operationId = result.operation_id;
    console.log(`\n📋 Operation ID: ${operationId}`);
    
    const completed = await pollOperation(operationId, apiKey);
    
    console.log('\n\n✅ 3D World Generated!');
    console.log('━'.repeat(50));
    
    if (completed.response) {
      const worldId = completed.response.world_id || completed.response.id;
      console.log(`🌍 World ID: ${worldId}`);
      console.log(`🔗 View: https://platform.worldlabs.ai/worlds/${worldId}`);
      console.log(`📤 Share this link with your client!`);
      
      // Save result
      const outputPath = path.join(__dirname, 'tours', `${name.replace(/[^a-z0-9]/gi, '-')}.json`);
      fs.mkdirSync(path.join(__dirname, 'tours'), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify({
        name,
        worldId,
        viewUrl: `https://platform.worldlabs.ai/worlds/${worldId}`,
        mode: draft ? 'draft' : 'standard',
        createdAt: new Date().toISOString(),
        operationId,
        response: completed.response
      }, null, 2));
      console.log(`💾 Saved to: ${outputPath}`);
    } else {
      console.log('Response:', JSON.stringify(completed, null, 2));
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
