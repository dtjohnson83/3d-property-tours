import { useState, useRef, useCallback } from 'react';
import Head from 'next/head';

const STEPS = {
  UPLOAD: 'upload',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error'
};

export default function Home() {
  const [step, setStep] = useState(STEPS.UPLOAD);
  const [images, setImages] = useState([]);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('standard');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotFlash, setSnapshotFlash] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const fileInputRef = useRef(null);
  const viewerRef = useRef(null);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    const newImages = [];

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        newImages.push({
          name: file.name,
          type: file.type,
          data: ev.target.result,
          preview: ev.target.result
        });
        if (newImages.length === files.length) {
          setImages(prev => [...prev, ...newImages]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const takeSnapshot = useCallback(() => {
    // Flash effect
    setSnapshotFlash(true);
    setTimeout(() => setSnapshotFlash(false), 300);

    // Since cross-origin iframes can't be captured with canvas,
    // we'll capture a timestamp and the current view URL as a reference
    const timestamp = new Date().toLocaleTimeString();
    const snapshotData = {
      id: Date.now(),
      timestamp,
      url: result?.viewUrl,
      label: `Snapshot ${snapshots.length + 1}`
    };
    setSnapshots(prev => [snapshotData, ...prev]);
  }, [result, snapshots.length]);

  const openSnapshotView = useCallback((snapshot) => {
    // Open the world in a new tab for the user to screenshot
    window.open(snapshot.url, '_blank');
  }, []);

  const removeSnapshot = useCallback((id) => {
    setSnapshots(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleGenerate = async () => {
    if (images.length === 0) return;

    setStep(STEPS.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: images.map(img => ({
            name: img.name,
            type: img.type,
            data: img.data
          })),
          name: name || 'Property Tour',
          mode
        })
      });

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        const text = await response.text();
        throw new Error(`Server error (${response.status}): ${text.substring(0, 200)}`);
      }
      if (!response.ok) throw new Error(data.error + (data.details ? ' - ' + JSON.stringify(data.details) : '') || 'Generation failed');

      const operationId = data.operationId;
      let completed = false;

      while (!completed) {
        await new Promise(r => setTimeout(r, 3000));

        const statusRes = await fetch(`/api/status?operationId=${operationId}`);
        const statusData = await statusRes.json();

        if (statusData.done) {
          if (statusData.error) {
            throw new Error(statusData.error.message || 'Generation failed');
          }
          completed = true;
          const worldId = statusData.response?.world_id || statusData.response?.id;
          setResult({
            worldId,
            viewUrl: `https://platform.worldlabs.ai/worlds/${worldId}`,
            name: name || 'Property Tour'
          });
          setStep(STEPS.DONE);
          setIframeLoaded(false);
        } else {
          setProgress(statusData.metadata?.progress_pct || progress + 5);
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
    setSnapshots([]);
    setIframeLoaded(false);
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
          background: #0a0a0a;
          color: #fff;
          min-height: 100vh;
        }
      `}</style>

      <style jsx>{`
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .header {
          text-align: center;
          padding: 40px 0 30px;
        }
        .header h1 {
          font-size: 1.8rem;
          margin-bottom: 8px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .header p {
          color: #888;
          font-size: 0.95rem;
        }
        .upload-area {
          border: 2px dashed #333;
          border-radius: 16px;
          padding: 40px 20px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          margin-bottom: 20px;
        }
        .upload-area:hover {
          border-color: #667eea;
          background: rgba(102, 126, 234, 0.05);
        }
        .upload-icon { font-size: 3rem; margin-bottom: 10px; }
        .upload-text { color: #888; font-size: 0.95rem; }
        .upload-text strong { color: #667eea; }
        .image-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        .image-thumb {
          position: relative;
          aspect-ratio: 1;
          border-radius: 12px;
          overflow: hidden;
        }
        .image-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .image-thumb .remove {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(0,0,0,0.7);
          color: white;
          border: none;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .input-group {
          margin-bottom: 16px;
        }
        .input-group label {
          display: block;
          color: #888;
          font-size: 0.85rem;
          margin-bottom: 6px;
        }
        .input-group input, .input-group select {
          width: 100%;
          padding: 12px 16px;
          border-radius: 10px;
          border: 1px solid #333;
          background: #1a1a1a;
          color: white;
          font-size: 1rem;
          outline: none;
        }
        .input-group input:focus, .input-group select:focus {
          border-color: #667eea;
        }
        .btn {
          width: 100%;
          padding: 16px;
          border-radius: 12px;
          border: none;
          font-size: 1.1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, opacity 0.2s;
          margin-top: 10px;
        }
        .btn:active { transform: scale(0.98); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .btn-secondary {
          background: #1a1a1a;
          color: #888;
          border: 1px solid #333;
        }
        .progress-section {
          text-align: center;
          padding: 60px 20px;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .spinner {
          width: 60px;
          height: 60px;
          border: 3px solid #333;
          border-top: 3px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .progress-bar {
          width: 100%;
          max-width: 300px;
          height: 6px;
          background: #333;
          border-radius: 3px;
          margin: 16px 0;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #667eea, #764ba2);
          border-radius: 3px;
          transition: width 0.5s;
        }

        /* Viewer Section */
        .viewer-section {
          padding: 20px 0;
        }
        .viewer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .viewer-header h2 {
          font-size: 1.2rem;
        }
        .viewer-header .subtitle {
          color: #888;
          font-size: 0.85rem;
        }
        .viewer-container {
          position: relative;
          width: 100%;
          aspect-ratio: 16/10;
          border-radius: 16px;
          overflow: hidden;
          background: #111;
          border: 1px solid #222;
        }
        .viewer-container iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
        .viewer-loading {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #111;
          z-index: 2;
          transition: opacity 0.5s;
        }
        .viewer-loading.hidden {
          opacity: 0;
          pointer-events: none;
        }
        .viewer-hint {
          text-align: center;
          color: #666;
          font-size: 0.8rem;
          margin-top: 10px;
          padding: 0 10px;
        }

        /* Snapshot Flash */
        .snapshot-flash {
          position: absolute;
          inset: 0;
          background: white;
          z-index: 10;
          opacity: 0;
          pointer-events: none;
          animation: flash 0.3s ease-out;
        }
        @keyframes flash {
          0% { opacity: 0.8; }
          100% { opacity: 0; }
        }

        /* Snapshot Button */
        .snapshot-btn {
          position: absolute;
          bottom: 16px;
          right: 16px;
          z-index: 5;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(10px);
          border: 2px solid rgba(255,255,255,0.3);
          color: white;
          font-size: 1.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.15s, background 0.15s;
        }
        .snapshot-btn:active {
          transform: scale(0.9);
          background: rgba(102, 126, 234, 0.6);
        }

        /* Toolbar */
        .viewer-toolbar {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .toolbar-btn {
          flex: 1;
          min-width: 120px;
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid #333;
          background: #1a1a1a;
          color: #aaa;
          font-size: 0.85rem;
          cursor: pointer;
          text-align: center;
          transition: border-color 0.2s, color 0.2s;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .toolbar-btn:hover {
          border-color: #667eea;
          color: #fff;
        }

        /* Snapshot Gallery */
        .gallery-section {
          margin-top: 24px;
        }
        .gallery-title {
          font-size: 1rem;
          color: #888;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .gallery-count {
          background: #667eea;
          color: white;
          font-size: 0.75rem;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .gallery-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .gallery-item {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 12px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .gallery-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .gallery-item-label {
          font-size: 0.85rem;
          color: #ccc;
        }
        .gallery-item-time {
          font-size: 0.75rem;
          color: #666;
        }
        .gallery-item-actions {
          display: flex;
          gap: 6px;
        }
        .gallery-action-btn {
          flex: 1;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid #333;
          background: transparent;
          color: #667eea;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background 0.15s;
        }
        .gallery-action-btn:hover {
          background: rgba(102, 126, 234, 0.1);
        }
        .gallery-action-btn.delete {
          color: #ff6b6b;
        }
        .gallery-action-btn.delete:hover {
          background: rgba(255, 107, 107, 0.1);
        }

        .result-section-compact {
          margin-top: 20px;
        }

        .error-section {
          text-align: center;
          padding: 60px 20px;
        }
        .error-icon { font-size: 3rem; margin-bottom: 20px; }
        .error-msg { color: #ff6b6b; margin-bottom: 20px; }
      `}</style>

      <div className="container">
        <div className="header">
          <h1>🏠 3D Property Tours</h1>
          <p>Upload photos → Get an immersive 3D walkthrough</p>
        </div>

        {step === STEPS.UPLOAD && (
          <>
            <div 
              className="upload-area" 
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">📸</div>
              <div className="upload-text">
                <strong>Tap to add photos</strong><br/>
                Take photos around the room/property
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFiles}
              style={{ display: 'none' }}
            />

            {images.length > 0 && (
              <>
                <div className="image-grid">
                  {images.map((img, i) => (
                    <div key={i} className="image-thumb">
                      <img src={img.preview} alt={img.name} />
                      <button className="remove" onClick={() => removeImage(i)}>×</button>
                    </div>
                  ))}
                </div>

                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: 16 }}>
                  {images.length} photo{images.length !== 1 ? 's' : ''} selected
                  {images.length < 4 && ' (4+ recommended for best results)'}
                </p>
              </>
            )}

            <div className="input-group">
              <label>Property Name</label>
              <input
                type="text"
                placeholder="e.g. 123 Main St - Living Room"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label>Quality</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="standard">Standard ($1.20) — Best quality</option>
                <option value="draft">Draft ($0.12) — Quick preview</option>
              </select>
            </div>

            <button 
              className="btn btn-primary" 
              onClick={handleGenerate}
              disabled={images.length === 0}
            >
              Generate 3D Tour →
            </button>
          </>
        )}

        {step === STEPS.PROCESSING && (
          <div className="progress-section">
            <div className="spinner" />
            <h2>Building your 3D world...</h2>
            <p style={{ color: '#888', marginTop: 8 }}>This usually takes 1-3 minutes</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
            <p style={{ color: '#667eea' }}>{Math.min(progress, 100)}%</p>
          </div>
        )}

        {step === STEPS.DONE && result && (
          <div className="viewer-section">
            {/* Viewer Header */}
            <div className="viewer-header">
              <div>
                <h2>🎉 {result.name}</h2>
                <div className="subtitle">Drag to rotate • Pinch/scroll to zoom</div>
              </div>
            </div>

            {/* 3D Viewer */}
            <div className="viewer-container" ref={viewerRef}>
              <div className={`viewer-loading ${iframeLoaded ? 'hidden' : ''}`}>
                <div className="spinner" />
                <p style={{ color: '#888', fontSize: '0.9rem' }}>Loading 3D world...</p>
              </div>

              <iframe
                src={result.viewUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                onLoad={() => setIframeLoaded(true)}
                title="3D Property Tour"
              />

              {/* Snapshot flash effect */}
              {snapshotFlash && <div className="snapshot-flash" />}

              {/* Snapshot button overlay */}
              <button
                className="snapshot-btn"
                onClick={takeSnapshot}
                title="Take Snapshot"
              >
                📸
              </button>
            </div>

            <div className="viewer-hint">
              💡 Use the viewer above to explore — drag to rotate the camera, pinch or scroll to zoom in/out
            </div>

            {/* Toolbar */}
            <div className="viewer-toolbar">
              <a
                className="toolbar-btn"
                href={result.viewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                🔗 Open Full Screen
              </a>
              <button
                className="toolbar-btn"
                onClick={() => {
                  navigator.clipboard.writeText(result.viewUrl);
                  alert('Link copied!');
                }}
              >
                📋 Copy Link
              </button>
              <button
                className="toolbar-btn"
                onClick={takeSnapshot}
              >
                📸 Snapshot
              </button>
            </div>

            {/* Snapshot Gallery */}
            {snapshots.length > 0 && (
              <div className="gallery-section">
                <div className="gallery-title">
                  📸 Snapshots
                  <span className="gallery-count">{snapshots.length}</span>
                </div>
                <div className="gallery-grid">
                  {snapshots.map((snap) => (
                    <div key={snap.id} className="gallery-item">
                      <div className="gallery-item-header">
                        <span className="gallery-item-label">{snap.label}</span>
                        <span className="gallery-item-time">{snap.timestamp}</span>
                      </div>
                      <div className="gallery-item-actions">
                        <button
                          className="gallery-action-btn"
                          onClick={() => openSnapshotView(snap)}
                        >
                          🔗 View
                        </button>
                        <button
                          className="gallery-action-btn delete"
                          onClick={() => removeSnapshot(snap.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Create Another */}
            <div className="result-section-compact">
              <button className="btn btn-primary" onClick={reset}>
                Create Another Tour
              </button>
            </div>
          </div>
        )}

        {step === STEPS.ERROR && (
          <div className="error-section">
            <div className="error-icon">😞</div>
            <h2>Something went wrong</h2>
            <p className="error-msg">{error}</p>
            <button className="btn btn-secondary" onClick={reset}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </>
  );
}
