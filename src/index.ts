import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import urlRoutes from './routes/url.routes';
import { initDb } from './db/migrate';
import { redis } from './db/redis';
import { pool } from './db/pool';
import {
  startClickSyncScheduler,
  shutdownClickSync,
  getClickQueueMetrics,
} from './services/clickSyncQueue';

const app = express();

// 1. Trust Render's reverse proxy for accurate IP rate limiting
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.disable('etag');
app.use(express.json({ limit: '10kb' }));

// 2. Anti-Abuse Rate Limiter for Shortening (20 per 15 minutes per IP)
const shortenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded: Max 20 shortens per 15 min per IP in this demo.',
  },
});

app.use('/shorten', shortenLimiter);

// 3. Health & Readiness Endpoint
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const [dbRes, redisPong] = await Promise.all([
      pool.query('SELECT 1'),
      redis.ping(),
    ]);

    const queueMetrics = await getClickQueueMetrics();

    return res.status(200).json({
      status: 'healthy',
      postgres: dbRes.rowCount === 1 ? 'connected' : 'error',
      redis: redisPong === 'PONG' ? 'connected' : 'error',
      clickQueue: queueMetrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(503).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// 4. Interactive Portfolio Landing Page
app.get('/', async (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CacheCut &bull; High-Throughput URL Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root {
      --bg: #0b0f17;
      --card-bg: #111827;
      --card-border: #1f2937;
      --card-hover: #1e293b;
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #8b5cf6;
      --code-bg: #030712;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding: 24px 16px;
      min-height: 100vh;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .nav-links {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .nav-pill {
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      padding: 6px 12px;
      background: #1e293b;
      color: #93c5fd;
      border: 1px solid #334155;
      border-radius: 6px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .nav-pill:hover {
      background: #2563eb;
      color: white;
      border-color: #2563eb;
    }

    .cold-start-banner {
      background: rgba(30, 41, 59, 0.7);
      border: 1px dashed #334155;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .card-title {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    /* Shortener Form */
    .input-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .url-input {
      flex: 1;
      min-width: 280px;
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px 14px;
      color: var(--text-main);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .url-input:focus {
      border-color: var(--primary);
    }

    .btn {
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Results Bench */
    .result-box {
      margin-top: 20px;
      padding: 16px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      display: none;
    }

    .link-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid #1e293b;
    }

    .short-url-link {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 600;
      color: #60a5fa;
      text-decoration: none;
    }
    .short-url-link:hover { text-decoration: underline; }

    .action-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid #334155;
      background: #1e293b;
      color: var(--text-main);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn-sm:hover { background: #334155; }

    /* Live Telemetry Grid */
    .telemetry-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .telemetry-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
    }

    .telemetry-lbl {
      font-size: 11px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .telemetry-val {
      font-size: 20px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
    }

    .tier-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .tier-L1 { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid #059669; }
    .tier-L2 { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid #2563eb; }
    .tier-PG { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid #d97706; }

    /* Architecture Info Box */
    .arch-explainer {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
      background: #0d131f;
      border-left: 3px solid var(--primary);
      padding: 10px 14px;
      border-radius: 0 6px 6px 0;
      margin-top: 14px;
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 10px;
    }
    th {
      text-align: left;
      color: var(--text-dim);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 8px 10px;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 10px;
      border-bottom: 1px solid #1a2234;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    .target-url {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
    }

    .footer {
      text-align: center;
      margin-top: 30px;
      font-size: 12px;
      color: var(--text-dim);
    }
    .footer a { color: var(--text-muted); text-decoration: none; }
    .footer a:hover { color: var(--text-main); }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Header -->
    <header class="header">
      <div class="title-row">
        <div class="logo-badge">
          <i data-lucide="scissors" style="width: 22px; height: 22px;"></i>
        </div>
        <div>
          <h1>CacheCut</h1>
          <div class="subtitle">High-Throughput Tiered URL Engine &bull; L1 Memory &bull; L2 Redis &bull; Neon Postgres</div>
        </div>
      </div>
      <div class="nav-links">
        <a href="/health" class="nav-pill" target="_blank"><i data-lucide="activity" style="width: 14px; height: 14px;"></i> /health</a>
        <a href="https://qrew.onrender.com" class="nav-pill" target="_blank"><i data-lucide="cpu" style="width: 14px; height: 14px;"></i> Qrew Engine</a>
        <a href="https://github.com/makx-dev/CacheCut" class="nav-pill" target="_blank"><i data-lucide="github" style="width: 14px; height: 14px;"></i> GitHub</a>
      </div>
    </header>

    <!-- Cold Start Transparency Banner -->
    <div class="cold-start-banner">
      <i data-lucide="clock" style="width: 16px; height: 16px; color: var(--warning); flex-shrink: 0;"></i>
      <span><strong>Portfolio Transparency:</strong> First load after 15 min idle takes 30–50s as Render wakes the Node container and Neon resumes serverless compute. Subsequent lookups execute at sub-millisecond speeds.</span>
    </div>

    <!-- Shortener Input Card -->
    <div class="card">
      <div class="card-title">
        <i data-lucide="link" style="width: 16px; height: 16px; color: var(--primary);"></i>
        Create &amp; Cache New Short URL
      </div>
      <form id="shortenForm" class="input-group" onsubmit="handleShorten(event)">
        <input 
          type="url" 
          id="longUrlInput" 
          class="url-input" 
          placeholder="https://github.com/makx-dev/Qrew" 
          required 
          value="https://github.com/makx-dev/Qrew"
        />
        <button type="submit" class="btn" id="shortenBtn">
          <i data-lucide="zap" style="width: 16px; height: 16px;"></i> Shorten URL
        </button>
      </form>

      <!-- Inspection Results Bench -->
      <div id="resultBox" class="result-box">
        <div class="link-row">
          <div>
            <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase;">Generated Link (7-Day Lifetime)</div>
            <a href="#" id="shortLinkAnchor" class="short-url-link" target="_blank"></a>
          </div>
          <div class="action-group">
            <button class="btn-sm" onclick="copyShortLink()"><i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy</button>
            <a href="#" id="realRedirectBtn" class="btn-sm" target="_blank" style="text-decoration: none;">
              <i data-lucide="external-link" style="width: 14px; height: 14px;"></i> 302 Redirect
            </a>
            <button class="btn-sm" onclick="runInspectionHit()" style="border-color: #10b981; color: #6ee7b7;" title="Test normal lookup (hits L1 Memory)">
              <i data-lucide="zap" style="width: 14px; height: 14px;"></i> Test Hit (L1)
            </button>
            <button class="btn-sm" onclick="runInspectionHit('L1')" style="border-color: #3b82f6; color: #93c5fd;" title="Flush L1 memory cache and hit L2 Redis">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Flush L1 &rarr; Test L2
            </button>
            <button class="btn-sm" onclick="runInspectionHit('L2')" style="border-color: #f59e0b; color: #fde68a;" title="Flush L1 & Redis and hit PostgreSQL">
              <i data-lucide="database" style="width: 14px; height: 14px;"></i> Flush L1+L2 &rarr; Test PG
            </button>
          </div>
        </div>

        <!-- Real-Time Measured Telemetry -->
        <div class="telemetry-grid">
          <div class="telemetry-card">
            <div class="telemetry-lbl">Resolution Tier</div>
            <div id="telemetryTier" class="telemetry-val">-</div>
          </div>
          <div class="telemetry-card">
            <div class="telemetry-lbl">Measured Latency</div>
            <div id="telemetryLatency" class="telemetry-val" style="color: var(--primary);">-</div>
          </div>
          <div class="telemetry-card">
            <div class="telemetry-lbl">Buffered in Redis</div>
            <div id="telemetryBuffered" class="telemetry-val" style="color: var(--warning);">-</div>
          </div>
          <div class="telemetry-card">
            <div class="telemetry-lbl">Persisted in DB</div>
            <div id="telemetryPersisted" class="telemetry-val" style="color: var(--success);">-</div>
          </div>
        </div>

        <div class="arch-explainer">
          <strong>Interactive Cache Tier Testing:</strong> Click <em>"Flush L1"</em> to simulate an in-process cache miss and watch the request resolve from L2 Redis. Click <em>"Flush L1+L2"</em> to evict both and observe PostgreSQL fallback.
        </div>
      </div>
    </div>

    <!-- Active Demo Links Table -->
    <div class="card">
      <div class="card-title">
        <i data-lucide="shield-check" style="width: 16px; height: 16px; color: var(--purple);"></i>
        Your Session Links &amp; Seeded Demos
      </div>
      <div style="font-size: 11px; color: var(--text-dim); margin-top: -8px; margin-bottom: 14px;">
        🔒 <strong>Privacy Guard:</strong> Strangers' links are never shown publicly. Only curated portfolio demos and links created in your active browser session are displayed.
      </div>
      <table>
        <thead>
          <tr>
            <th>Short Code</th>
            <th>Original Destination</th>
            <th>Type</th>
            <th>Inspect</th>
          </tr>
        </thead>
        <tbody id="sessionLinksTableBody">
          <!-- Populated dynamically via JavaScript -->
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <footer class="footer">
      <p>CacheCut Architecture Demo &bull; Embedded BullMQ Zero-Loss Click Persistence &bull; Free-Tier Sandbox</p>
    </footer>

  </div>

  <script>
    lucide.createIcons();

    let currentCode = null;

    // Seeded public demo links
    const SEEDED_DEMOS = [
      { shortCode: 'cachecut-repo', ogUrl: 'https://github.com/makx-dev/CacheCut', type: 'Seeded Demo' },
      { shortCode: 'qrew-engine', ogUrl: 'https://github.com/makx-dev/Qrew', type: 'Seeded Demo' }
    ];

    function getSessionLinks() {
      try {
        const stored = sessionStorage.getItem('cachecut_links');
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    }

    function saveSessionLink(code, url) {
      try {
        const list = getSessionLinks();
        if (!list.some(item => item.shortCode === code)) {
          list.unshift({ shortCode: code, ogUrl: url, type: 'This Session' });
          sessionStorage.setItem('cachecut_links', JSON.stringify(list.slice(0, 10)));
        }
      } catch {}
    }

    function renderLinksTable() {
      const tbody = document.getElementById('sessionLinksTableBody');
      const sessionList = getSessionLinks();
      const allLinks = [...sessionList, ...SEEDED_DEMOS];

      tbody.innerHTML = allLinks.map(u => \`
        <tr>
          <td><a href="/\${u.shortCode}" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 600;">/\${u.shortCode}</a></td>
          <td class="target-url" title="\${u.ogUrl}">\${u.ogUrl}</td>
          <td><span style="font-size: 10.5px; padding: 2px 6px; border-radius: 4px; background: #1e293b; color: #94a3b8;">\${u.type}</span></td>
          <td><button class="btn-sm" onclick="selectCode('\${u.shortCode}')"><i data-lucide="play" style="width: 12px; height: 12px;"></i> Inspect</button></td>
        </tr>
      \`).join('');

      lucide.createIcons();
    }

    renderLinksTable();

    async function handleShorten(e) {
      e.preventDefault();
      const input = document.getElementById('longUrlInput');
      const btn = document.getElementById('shortenBtn');
      const url = input.value.trim();
      if (!url) return;

      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width: 16px; height: 16px;"></i> Shortening...';

      try {
        const res = await fetch('/shorten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ og_url: url })
        });
        const data = await res.json();

        if (!res.ok) {
          alert('Error: ' + (data.error || 'Failed to shorten'));
          return;
        }

        saveSessionLink(data.shortCode, data.ogUrl);
        renderLinksTable();
        displayShortCode(data.shortCode);
        await runInspectionHit();
      } catch (err) {
        alert('Network error shortening URL: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="zap" style="width: 16px; height: 16px;"></i> Shorten URL';
        lucide.createIcons();
      }
    }

    function displayShortCode(code) {
      currentCode = code;
      const fullUrl = window.location.origin + '/' + code;
      const box = document.getElementById('resultBox');
      const anchor = document.getElementById('shortLinkAnchor');
      const redirectBtn = document.getElementById('realRedirectBtn');

      anchor.textContent = fullUrl;
      anchor.href = fullUrl;
      redirectBtn.href = fullUrl;
      box.style.display = 'block';
    }

    async function runInspectionHit(flushTier) {
      if (!currentCode) return;
      const url = flushTier ? '/api/demo/hit/' + currentCode + '?flush=' + flushTier : '/api/demo/hit/' + currentCode;

      try {
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
          const tierEl = document.getElementById('telemetryTier');
          tierEl.className = 'telemetry-val tier-badge';
          tierEl.textContent = data.error || 'Not Found';
          return;
        }

        // Update Tier Badge
        const tierEl = document.getElementById('telemetryTier');
        tierEl.className = 'telemetry-val tier-badge tier-' + data.tier;
        tierEl.textContent = data.tier === 'L1' ? 'L1 Memory (<1ms)' : data.tier === 'L2' ? 'L2 Redis (~2ms)' : 'PG Fallback (~25ms)';

        // Update Latency
        document.getElementById('telemetryLatency').textContent = data.latencyMs + ' ms';

        // Update Counters
        document.getElementById('telemetryBuffered').textContent = data.bufferedClicks;
        document.getElementById('telemetryPersisted').textContent = data.persistedClicks;
      } catch (err) {
        console.error('Inspection failed:', err);
      }
    }

    function selectCode(code) {
      displayShortCode(code);
      runInspectionHit();
      window.scrollTo({ top: 120, behavior: 'smooth' });
    }

    function copyShortLink() {
      const anchor = document.getElementById('shortLinkAnchor');
      navigator.clipboard.writeText(anchor.textContent).then(() => {
        alert('Short URL copied to clipboard!');
      });
    }

    // Auto-refresh counters every 5 seconds if a short code is being inspected
    setInterval(() => {
      if (currentCode) {
        fetch('/api/demo/hit/' + currentCode, { method: 'POST' })
          .then(r => r.json())
          .then(d => {
            if (d && d.bufferedClicks !== undefined) {
              document.getElementById('telemetryBuffered').textContent = d.bufferedClicks;
              document.getElementById('telemetryPersisted').textContent = d.persistedClicks;
            }
          })
          .catch(() => {});
      }
    }, 5000);
  </script>
</body>
</html>`;

  return res.send(html);
});

// 5. Mount Core URL and API Routes
app.use('/', urlRoutes);

// 6. Catch-all for undefined routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// 7. Server Boot & Database Initialization
const PORT = Number(process.env.PORT) || 3000;

async function bootstrap() {
  try {
    // Run idempotent database migrations (table creation & index setup)
    await initDb();

    // Start the embedded BullMQ 10s click persistence scheduler
    startClickSyncScheduler(10000);

    const server = app.listen(PORT, () => {
      console.log(`[CacheCut] High-throughput URL engine running on port ${PORT}`);
      console.log(`[CacheCut] Embedded BullMQ click-sync worker & scheduler active`);
    });

    // Graceful Shutdown Handling
    const handleShutdown = async (signal: string) => {
      console.log(`[CacheCut] ${signal} received. Initiating graceful shutdown...`);
      server.close();
      await shutdownClickSync();
      await redis.quit();
      await pool.end();
      console.log('[CacheCut] Graceful shutdown complete.');
      process.exit(0);
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  } catch (err: any) {
    console.error('[CacheCut] Startup bootstrap failed:', err.message);
    process.exit(1);
  }
}

bootstrap();
