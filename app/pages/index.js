import { useState, useRef, useCallback, useEffect } from 'react';
import Head from 'next/head';

const STEPS = { UPLOAD: 'upload', PROCESSING: 'processing', DONE: 'done', ERROR: 'error' };
const DIRECTIONS = ['front', 'right', 'back', 'left'];
const DIR_LABELS = { front: '⬆️ Front', right: '➡️ Right', back: '⬇️ Back', left: '⬅️ Left' };

export default function Home() {
  const [step, setStep] = useState(STEPS.UPLOAD);
  const [images, setImages] = useState([]);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('standard');
  const [inputType, setInputType] = useState('images'); // images | video | panorama
  const [layoutMode, setLayoutMode] = useState('auto'); // auto | direction
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [worlds, setWorlds] = useState([]); // Multi-world gallery
  const [tipsOpen, setTipsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [video, setVideo] = useState(null);
  const [panorama, setPanorama] = useState(null);
  const [progressPhase, setProgressPhase] = useState('');
  const fileInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const panoInputRef = useRef(null);

  const maxImages = layoutMode === 'auto' ? 8 : 4;

  // Animated progress
  useEffect(() => {
    if (step !== STEPS.PROCESSING) return;
    const phases = ['Uploading images...', 'Analyzing geometry...', 'Building 3D mesh...', 'Rendering world...', 'Almost there...'];
    let idx = 0;
    setProgressPhase(phases[0]);
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, phases.length - 1);
      setProgressPhase(phases[idx]);
    }, 15000);
    return () => clearInterval(interval);
  }, [step]);

  const resizeImage = (file, maxWidth = 1024, quality = 0.7) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = (h * maxWidth) / w; w = maxWidth; }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const data = canvas.toDataURL('image/jpeg', quality);
          resolve({ name: file.name, type: 'image/jpeg', data, preview: data, direction: null });
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const newImages = await Promise.all(imageFiles.map(f => resizeImage(f)));
    setImages(prev => {
      const combined = [...prev, ...newImages];
      return combined.slice(0, maxImages);
    });
  };

  const handleFileInput = (e) => handleFiles(e.target.files);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleVideoFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      alert('Video must be under 100MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setVideo({ name: file.name, data: ev.target.result, preview: URL.createObjectURL(file) });
    };
    reader.readAsDataURL(file);
  };

  const handlePanoFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const resized = await resizeImage(file, 2048, 0.8);
    setPanorama(resized);
  };

  const removeImage = (index) => setImages(prev => prev.filter((_, i) => i !== index));
  const setImageDirection = (index, dir) => {
    setImages(prev => prev.map((img, i) => i === index ? { ...img, direction: dir } : img));
  };

  const canGenerate = () => {
    if (inputType === 'video') return !!video;
    if (inputType === 'panorama') return !!panorama;
    if (images.length === 0) return false;
    if (layoutMode === 'direction' && images.length > 1) {
      return images.every(img => img.direction);
    }
    return true;
  };

  const handleGenerate = async () => {
    if (!canGenerate()) return;
    setStep(STEPS.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const body = {
        name: name || 'Property Tour',
        mode,
        inputType,
        layoutMode,
      };
      if (inputType === 'video') {
        body.video = { name: video.name, data: video.data };
      } else if (inputType === 'panorama') {
        body.panorama = { name: panorama.name, data: panorama.data };
      } else {
        body.images = images.map(img => ({
          name: img.name,
          type: img.type,
          data: img.data,
          direction: img.direction,
        }));
      }

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); } catch {
        throw new Error(`Server error (${response.status}): ${responseText.substring(0, 200)}`);
      }
      if (!response.ok) throw new Error((data.error || 'Generation failed') + (data.details ? ' - ' + JSON.stringify(data.details) : ''));

      const operationId = data.operationId;
      let completed = false;

      while (!completed) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(`/api/status?operationId=${operationId}`);
        const statusData = await statusRes.json();

        if (statusData.done) {
          if (statusData.error) throw new Error(statusData.error.message || 'Generation failed');
          completed = true;
          const worldId = statusData.response?.world_id || statusData.response?.id;
          let viewUrl = `https://platform.worldlabs.ai/worlds/${worldId}`;
          try {
            const worldRes = await fetch(`/api/world?worldId=${worldId}`);
            if (worldRes.ok) {
              const worldData = await worldRes.json();
              viewUrl = worldData.world_marble_url || viewUrl;
            }
          } catch (e) { console.error('Failed to fetch world details', e); }
          const newResult = { worldId, viewUrl, name: name || 'Property Tour', createdAt: new Date().toLocaleString() };
          setResult(newResult);
          setWorlds(prev => [newResult, ...prev]);
          setStep(STEPS.DONE);
        } else {
          setProgress(statusData.metadata?.progress_pct || Math.min(progress + 3, 95));
        }
      }
    } catch (err) {
      console.error('Generate error:', err);
      setError(err.message || JSON.stringify(err));
      setStep(STEPS.ERROR);
    }
  };

  const reset = () => {
    setStep(STEPS.UPLOAD);
    setImages([]);
    setName('');
    setProgress(0);
    setResult(null);
    setError(null);
    setVideo(null);
    setPanorama(null);
  };

  return (
    <>
      <Head>
        <title>3D Property Tours</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #08080c;
          color: #e8e8ef;
          min-height: 100vh;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes orbFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.1); }
          66% { transform: translate(-20px, 15px) scale(0.95); }
        }
      `}</style>

      <style jsx>{`
        .page { min-height: 100vh; position: relative; overflow: hidden; }
        .bg-orb {
          position: fixed; border-radius: 50%; filter: blur(80px); opacity: 0.15; pointer-events: none; z-index: 0;
          animation: orbFloat 20s ease-in-out infinite;
        }
        .bg-orb-1 { width: 400px; height: 400px; background: #667eea; top: -100px; right: -100px; }
        .bg-orb-2 { width: 300px; height: 300px; background: #764ba2; bottom: -50px; left: -50px; animation-delay: -7s; }
        .bg-orb-3 { width: 200px; height: 200px; background: #06b6d4; top: 50%; left: 50%; animation-delay: -13s; }

        .container {
          max-width: 640px; margin: 0 auto; padding: 20px; position: relative; z-index: 1;
          min-height: 100vh; display: flex; flex-direction: column;
        }
        .header { text-align: center; padding: 40px 0 24px; animation: fadeInUp 0.6s ease; }
        .header h1 {
          font-size: 2rem; font-weight: 700; margin-bottom: 8px;
          background: linear-gradient(135deg, #667eea, #764ba2, #06b6d4);
          background-size: 200% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        .header p { color: #6b6b80; font-size: 0.95rem; }

        /* Glass card */
        .glass {
          background: rgba(255,255,255,0.03); backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.06); border-radius: 20px;
          padding: 24px; margin-bottom: 16px;
          animation: fadeInUp 0.5s ease;
        }

        /* Input type tabs */
        .tab-row { display: flex; gap: 6px; margin-bottom: 20px; }
        .tab {
          flex: 1; padding: 10px 8px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03); color: #6b6b80; font-size: 0.82rem; font-weight: 500;
          cursor: pointer; text-align: center; transition: all 0.2s;
        }
        .tab:hover { border-color: rgba(102,126,234,0.3); color: #a0a0b8; }
        .tab.active {
          background: linear-gradient(135deg, rgba(102,126,234,0.15), rgba(118,75,162,0.15));
          border-color: rgba(102,126,234,0.4); color: #e8e8ef;
        }

        /* Layout toggle */
        .toggle-row { display: flex; gap: 8px; margin-bottom: 16px; }
        .toggle-btn {
          flex: 1; padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
          background: transparent; color: #6b6b80; font-size: 0.82rem; cursor: pointer; transition: all 0.2s;
        }
        .toggle-btn.active {
          background: rgba(102,126,234,0.12); border-color: rgba(102,126,234,0.4); color: #c0c0d8;
        }
        .toggle-desc { font-size: 0.75rem; color: #4a4a5c; margin-top: 4px; }

        /* Upload area */
        .upload-area {
          border: 2px dashed rgba(255,255,255,0.1); border-radius: 16px;
          padding: 40px 20px; text-align: center; cursor: pointer;
          transition: all 0.3s; position: relative; overflow: hidden;
        }
        .upload-area:hover, .upload-area.drag-over {
          border-color: rgba(102,126,234,0.5);
          background: rgba(102,126,234,0.05);
        }
        .upload-area.drag-over { transform: scale(1.01); }
        .upload-icon { font-size: 2.5rem; margin-bottom: 10px; }
        .upload-text { color: #6b6b80; font-size: 0.9rem; line-height: 1.5; }
        .upload-text strong { color: #667eea; }

        /* Image counter */
        .img-counter {
          display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem;
          background: rgba(102,126,234,0.12); color: #667eea; font-weight: 600; margin-top: 12px;
        }

        /* Image grid */
        .image-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
        .image-thumb {
          position: relative; aspect-ratio: 1; border-radius: 14px; overflow: hidden;
          border: 2px solid transparent; transition: border-color 0.2s;
          animation: fadeInUp 0.3s ease;
        }
        .image-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .remove-btn {
          position: absolute; top: 6px; right: 6px; width: 22px; height: 22px;
          border-radius: 50%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
          color: white; border: none; cursor: pointer; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
        }
        .dir-select {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: rgba(0,0,0,0.75); backdrop-filter: blur(8px);
          padding: 4px; border: none; color: #fff; font-size: 0.7rem;
          text-align: center; cursor: pointer; width: 100%;
        }
        .dir-select option { background: #1a1a2e; }

        /* Video preview */
        .video-preview {
          border-radius: 16px; overflow: hidden; margin-top: 16px;
          border: 1px solid rgba(255,255,255,0.08); position: relative;
        }
        .video-preview video { width: 100%; max-height: 240px; object-fit: cover; }
        .video-remove {
          position: absolute; top: 10px; right: 10px; padding: 6px 14px;
          border-radius: 20px; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.1); color: #ff6b6b;
          font-size: 0.8rem; cursor: pointer;
        }

        /* Panorama preview */
        .pano-preview {
          border-radius: 16px; overflow: hidden; margin-top: 16px;
          border: 1px solid rgba(255,255,255,0.08); position: relative;
        }
        .pano-preview img { width: 100%; max-height: 200px; object-fit: cover; }

        /* Inputs */
        .input-group { margin-bottom: 14px; }
        .input-group label { display: block; color: #6b6b80; font-size: 0.82rem; margin-bottom: 6px; font-weight: 500; }
        .input-field {
          width: 100%; padding: 12px 16px; border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);
          color: #e8e8ef; font-size: 0.95rem; outline: none; transition: border-color 0.2s;
        }
        .input-field:focus { border-color: rgba(102,126,234,0.5); }
        select.input-field { cursor: pointer; }
        select.input-field option { background: #1a1a2e; }

        /* Buttons */
        .btn {
          width: 100%; padding: 16px; border-radius: 14px; border: none;
          font-size: 1.05rem; font-weight: 600; cursor: pointer;
          transition: all 0.2s; margin-top: 8px; position: relative; overflow: hidden;
        }
        .btn:active { transform: scale(0.98); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        .btn-primary {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white; box-shadow: 0 4px 20px rgba(102,126,234,0.3);
        }
        .btn-primary:hover:not(:disabled) { box-shadow: 0 6px 30px rgba(102,126,234,0.4); }
        .btn-ghost {
          background: transparent; color: #6b6b80;
          border: 1px solid rgba(255,255,255,0.08);
        }

        /* Tips section */
        .tips-toggle {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0; cursor: pointer; color: #6b6b80; font-size: 0.88rem;
          border: none; background: none; width: 100%;
        }
        .tips-toggle:hover { color: #a0a0b8; }
        .tips-arrow { transition: transform 0.3s; font-size: 0.7rem; }
        .tips-arrow.open { transform: rotate(180deg); }
        .tips-content {
          max-height: 0; overflow: hidden; transition: max-height 0.4s ease;
        }
        .tips-content.open { max-height: 600px; }
        .tip-group { margin-bottom: 14px; }
        .tip-group h4 { font-size: 0.82rem; color: #667eea; margin-bottom: 6px; }
        .tip-group p { font-size: 0.78rem; color: #5a5a6e; line-height: 1.5; }

        /* Processing */
        .processing { text-align: center; padding: 80px 20px; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .proc-spinner {
          width: 64px; height: 64px; border-radius: 50%; margin-bottom: 24px;
          border: 3px solid rgba(255,255,255,0.05);
          border-top: 3px solid #667eea; border-right: 3px solid #764ba2;
          animation: spin 1s linear infinite;
        }
        .proc-bar { width: 100%; max-width: 280px; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; margin: 20px 0 8px; overflow: hidden; }
        .proc-fill {
          height: 100%; border-radius: 2px; transition: width 0.8s ease;
          background: linear-gradient(90deg, #667eea, #764ba2, #06b6d4);
          background-size: 200% auto; animation: shimmer 2s linear infinite;
        }
        .proc-phase { color: #6b6b80; font-size: 0.85rem; animation: pulse 2s ease-in-out infinite; }
        .proc-pct { color: #667eea; font-size: 0.9rem; font-weight: 600; margin-top: 4px; }

        /* Skeleton */
        .skeleton {
          background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%);
          background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
          border-radius: 12px;
        }

        /* Result viewer */
        .viewer-card {
          background: rgba(255,255,255,0.03); backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.06); border-radius: 20px;
          overflow: hidden; animation: fadeInUp 0.6s ease;
        }
        .viewer-box {
          aspect-ratio: 16/10; display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background 0.3s; background: rgba(0,0,0,0.3);
        }
        .viewer-box:hover { background: rgba(102,126,234,0.05); }
        .viewer-inner { text-align: center; padding: 40px 20px; }
        .viewer-globe { font-size: 4rem; margin-bottom: 12px; }
        .viewer-cta { color: #667eea; font-size: 1.1rem; font-weight: 600; }
        .viewer-sub { color: #4a4a5c; font-size: 0.82rem; margin-top: 6px; }
        .viewer-actions { display: flex; gap: 8px; padding: 16px; }
        .action-btn {
          flex: 1; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03); color: #a0a0b8; font-size: 0.85rem;
          cursor: pointer; text-align: center; transition: all 0.2s; text-decoration: none;
          display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .action-btn:hover { border-color: rgba(102,126,234,0.4); color: #e8e8ef; background: rgba(102,126,234,0.08); }

        /* World gallery */
        .gallery { margin-top: 24px; animation: fadeInUp 0.5s ease; }
        .gallery-header { font-size: 0.9rem; color: #6b6b80; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .gallery-badge { background: rgba(102,126,234,0.2); color: #667eea; font-size: 0.72rem; padding: 2px 10px; border-radius: 12px; font-weight: 600; }
        .gallery-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .gallery-item {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s;
        }
        .gallery-item:hover { border-color: rgba(102,126,234,0.3); }
        .gallery-item-name { font-size: 0.85rem; color: #c0c0d8; margin-bottom: 4px; }
        .gallery-item-date { font-size: 0.72rem; color: #4a4a5c; }

        /* Share */
        .share-row { display: flex; gap: 8px; margin-top: 12px; }
        .share-btn {
          padding: 10px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);
          background: transparent; color: #6b6b80; font-size: 0.82rem;
          cursor: pointer; transition: all 0.2s;
        }
        .share-btn:hover { border-color: rgba(102,126,234,0.4); color: #a0a0b8; }

        /* Error */
        .error-section { text-align: center; padding: 80px 20px; animation: fadeInUp 0.5s ease; }
        .error-icon { font-size: 3rem; margin-bottom: 16px; }
        .error-msg { color: #ff6b8a; margin-bottom: 20px; font-size: 0.9rem; line-height: 1.5; padding: 16px; background: rgba(255,107,138,0.08); border-radius: 12px; border: 1px solid rgba(255,107,138,0.15); }

        /* Responsive */
        @media (max-width: 480px) {
          .image-grid { grid-template-columns: repeat(3, 1fr); }
          .gallery-grid { grid-template-columns: 1fr; }
          .viewer-actions { flex-wrap: wrap; }
          .tab { font-size: 0.75rem; padding: 8px 4px; }
        }
      `}</style>

      <div className="page">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />

        <div className="container">
          <div className="header">
            <h1>🏠 3D Property Tours</h1>
            <p>Upload photos, video, or panoramas → immersive 3D walkthrough</p>
          </div>

          {/* ========== UPLOAD ========== */}
          {step === STEPS.UPLOAD && (
            <>
              {/* Input type tabs */}
              <div className="glass">
                <div className="tab-row">
                  {[
                    { key: 'images', icon: '📸', label: 'Photos' },
                    { key: 'video', icon: '🎬', label: 'Video' },
                    { key: 'panorama', icon: '🌐', label: 'Panorama' },
                  ].map(t => (
                    <button key={t.key} className={`tab ${inputType === t.key ? 'active' : ''}`}
                      onClick={() => setInputType(t.key)}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                {/* Images mode */}
                {inputType === 'images' && (
                  <>
                    <div className="toggle-row">
                      <button className={`toggle-btn ${layoutMode === 'auto' ? 'active' : ''}`}
                        onClick={() => setLayoutMode('auto')}>
                        🔄 Auto Layout
                        <div className="toggle-desc">Up to 8 photos, AI positions them</div>
                      </button>
                      <button className={`toggle-btn ${layoutMode === 'direction' ? 'active' : ''}`}
                        onClick={() => setLayoutMode('direction')}>
                        🧭 Direction Control
                        <div className="toggle-desc">Up to 4 photos, you set directions</div>
                      </button>
                    </div>

                    <div className={`upload-area ${dragOver ? 'drag-over' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}>
                      <div className="upload-icon">{dragOver ? '📥' : '📸'}</div>
                      <div className="upload-text">
                        <strong>{dragOver ? 'Drop photos here' : 'Tap to add photos'}</strong><br/>
                        or drag & drop • JPG, PNG, WebP
                      </div>
                      {images.length > 0 && (
                        <div className="img-counter">{images.length} / {maxImages}</div>
                      )}
                    </div>

                    <input ref={fileInputRef} type="file" accept="image/*" multiple
                      onChange={handleFileInput} style={{ display: 'none' }} />

                    {images.length > 0 && (
                      <div className="image-grid">
                        {images.map((img, i) => (
                          <div key={i} className="image-thumb" style={{ animationDelay: `${i * 0.05}s` }}>
                            <img src={img.preview} alt={img.name} />
                            <button className="remove-btn" onClick={() => removeImage(i)}>×</button>
                            {layoutMode === 'direction' && (
                              <select className="dir-select" value={img.direction || ''}
                                onChange={(e) => setImageDirection(i, e.target.value || null)}
                                onClick={(e) => e.stopPropagation()}>
                                <option value="">Direction...</option>
                                {DIRECTIONS.map(d => (
                                  <option key={d} value={d}>{DIR_LABELS[d]}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Video mode */}
                {inputType === 'video' && (
                  <>
                    {!video ? (
                      <div className="upload-area" onClick={() => videoInputRef.current?.click()}>
                        <div className="upload-icon">🎬</div>
                        <div className="upload-text">
                          <strong>Upload a video</strong><br/>
                          MP4 or MOV, under 100MB<br/>
                          10–30 second walkthrough works best
                        </div>
                      </div>
                    ) : (
                      <div className="video-preview">
                        <video src={video.preview} controls muted />
                        <button className="video-remove" onClick={() => setVideo(null)}>✕ Remove</button>
                      </div>
                    )}
                    <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/mov"
                      onChange={handleVideoFile} style={{ display: 'none' }} />
                  </>
                )}

                {/* Panorama mode */}
                {inputType === 'panorama' && (
                  <>
                    {!panorama ? (
                      <div className="upload-area" onClick={() => panoInputRef.current?.click()}>
                        <div className="upload-icon">🌐</div>
                        <div className="upload-text">
                          <strong>Upload a 360° panorama</strong><br/>
                          Use your phone's built-in pano mode
                        </div>
                      </div>
                    ) : (
                      <div className="pano-preview">
                        <img src={panorama.preview} alt="Panorama" />
                        <button className="video-remove" onClick={() => setPanorama(null)}>✕ Remove</button>
                      </div>
                    )}
                    <input ref={panoInputRef} type="file" accept="image/*"
                      onChange={handlePanoFile} style={{ display: 'none' }} />
                  </>
                )}
              </div>

              {/* Settings */}
              <div className="glass">
                <div className="input-group">
                  <label>Property Name</label>
                  <input className="input-field" type="text"
                    placeholder="e.g. 123 Main St — Living Room"
                    value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Quality</label>
                  <select className="input-field" value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="standard">Standard ($1.20) — Best quality</option>
                    <option value="draft">Draft ($0.12) — Quick preview</option>
                  </select>
                </div>
              </div>

              {/* Tips */}
              <div className="glass" style={{ padding: '0 24px' }}>
                <button className="tips-toggle" onClick={() => setTipsOpen(!tipsOpen)}>
                  <span>💡 Tips for Best Results</span>
                  <span className={`tips-arrow ${tipsOpen ? 'open' : ''}`}>▼</span>
                </button>
                <div className={`tips-content ${tipsOpen ? 'open' : ''}`}>
                  <div className="tip-group">
                    <h4>🔄 Auto Layout</h4>
                    <p>Use overlapping photos from the same space. Keep the same lighting and aspect ratio. Aim for 60-70% overlap between adjacent shots.</p>
                  </div>
                  <div className="tip-group">
                    <h4>🧭 Direction Control</h4>
                    <p>Use distinct views — front door, backyard, kitchen, living room. Assign each photo its compass direction for precise placement.</p>
                  </div>
                  <div className="tip-group">
                    <h4>🎬 Video</h4>
                    <p>Slow, steady pan around the space. Good lighting, 10–30 seconds. Avoid fast movements or shaky footage.</p>
                  </div>
                  <div className="tip-group">
                    <h4>🌐 Panorama</h4>
                    <p>Use your phone's built-in pano mode. Keep the phone level and rotate smoothly. Works great for single rooms.</p>
                  </div>
                  <div className="tip-group">
                    <h4>🏠 Property Tours</h4>
                    <p>Shoot room by room. Capture corners and transitions between spaces. Good lighting and high resolution help. No blur!</p>
                  </div>
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleGenerate} disabled={!canGenerate()}>
                Generate 3D Tour →
              </button>

              {/* World Gallery */}
              {worlds.length > 0 && (
                <div className="gallery">
                  <div className="gallery-header">
                    🌍 Your Worlds <span className="gallery-badge">{worlds.length}</span>
                  </div>
                  <div className="gallery-grid">
                    {worlds.map((w, i) => (
                      <div key={i} className="gallery-item" onClick={() => window.open(w.viewUrl, '_blank')}>
                        <div className="gallery-item-name">{w.name}</div>
                        <div className="gallery-item-date">{w.createdAt}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========== PROCESSING ========== */}
          {step === STEPS.PROCESSING && (
            <div className="processing">
              <div className="proc-spinner" />
              <h2 style={{ fontSize: '1.3rem', marginBottom: 4 }}>Building your 3D world</h2>
              <p className="proc-phase">{progressPhase}</p>
              <div className="proc-bar">
                <div className="proc-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
              </div>
              <p className="proc-pct">{Math.min(Math.round(progress), 100)}%</p>
            </div>
          )}

          {/* ========== DONE ========== */}
          {step === STEPS.DONE && result && (
            <div style={{ animation: 'fadeInUp 0.6s ease' }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: '1.3rem' }}>🎉 {result.name}</h2>
                <p style={{ color: '#6b6b80', fontSize: '0.85rem' }}>Your 3D world is ready</p>
              </div>

              <div className="viewer-card">
                <div className="viewer-box" onClick={() => window.open(result.viewUrl, '_blank')}>
                  <div className="viewer-inner">
                    <div className="viewer-globe">🌍</div>
                    <p className="viewer-cta">Tap to Explore Your 3D World</p>
                    <p className="viewer-sub">Opens in World Labs viewer • Drag to rotate, pinch to zoom</p>
                  </div>
                </div>
                <div className="viewer-actions">
                  <a className="action-btn" href={result.viewUrl} target="_blank" rel="noopener noreferrer">
                    🔗 Full Screen
                  </a>
                  <button className="action-btn" onClick={() => {
                    navigator.clipboard.writeText(result.viewUrl);
                    alert('Link copied!');
                  }}>📋 Copy Link</button>
                  <button className="action-btn" onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: result.name, url: result.viewUrl });
                    } else {
                      navigator.clipboard.writeText(result.viewUrl);
                      alert('Link copied!');
                    }
                  }}>📤 Share</button>
                </div>
              </div>

              {/* Compose hint */}
              <div className="glass" style={{ marginTop: 16, textAlign: 'center' }}>
                <p style={{ color: '#6b6b80', fontSize: '0.82rem' }}>
                  💡 Generate multiple rooms and compose them together on{' '}
                  <a href="https://platform.worldlabs.ai" target="_blank" rel="noopener noreferrer"
                    style={{ color: '#667eea', textDecoration: 'none' }}>
                    World Labs Platform
                  </a>
                </p>
              </div>

              <button className="btn btn-primary" onClick={reset} style={{ marginTop: 16 }}>
                Create Another Tour
              </button>

              {worlds.length > 1 && (
                <div className="gallery">
                  <div className="gallery-header">
                    🌍 All Your Worlds <span className="gallery-badge">{worlds.length}</span>
                  </div>
                  <div className="gallery-grid">
                    {worlds.map((w, i) => (
                      <div key={i} className="gallery-item" onClick={() => window.open(w.viewUrl, '_blank')}>
                        <div className="gallery-item-name">{w.name}</div>
                        <div className="gallery-item-date">{w.createdAt}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========== ERROR ========== */}
          {step === STEPS.ERROR && (
            <div className="error-section">
              <div className="error-icon">😞</div>
              <h2>Something went wrong</h2>
              <p className="error-msg">{error}</p>
              <button className="btn btn-ghost" onClick={reset}>Try Again</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
