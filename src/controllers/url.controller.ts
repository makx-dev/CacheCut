import { Request, Response } from 'express';
import {
  createShortUrl,
  resolveUrl,
  validateLongUrl,
  getRecentUrls,
} from '../services/url.service';
import { getClickQueueMetrics, getBufferedClicks } from '../services/clickSyncQueue';

/**
 * POST /shorten
 * Enforces URL validation, 7-day expiration, and cache pre-warming.
 */
export const shortenUrl = async (req: Request, res: Response) => {
  const { og_url } = req.body;

  const validation = validateLongUrl(og_url);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const record = await createShortUrl(og_url);
    return res.status(201).json(record);
  } catch (err: any) {
    console.error('[CacheCut] Failed to create short URL:', err.message);
    return res.status(500).json({ error: 'Failed to create short URL' });
  }
};

/**
 * GET /:code
 * The production 302 redirect path.
 * Checks L1 -> L2 -> PG, tracks clicks in Redis, and redirects.
 */
export const redirectUrl = async (req: Request, res: Response) => {
  const { code } = req.params;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid short code' });
  }

  try {
    const result = await resolveUrl(code);

    if (!result) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    if (result.expired) {
      return res.status(410).json({
        error: 'Link Expired',
        message: 'This demo link has exceeded its 7-day lifetime to protect storage capacity.',
      });
    }

    return res.redirect(302, result.ogUrl);
  } catch (err: any) {
    console.error('[CacheCut] Redirect error:', err.message);
    return res.status(500).json({ error: 'Internal redirect error' });
  }
};

/**
 * POST /api/demo/hit/:code
 * Used by the portfolio interactive UI to simulate a redirect inspection without browser-opaque 302 masking.
 * Shares the exact same resolution function, returning live measured latency, tier hit, and dual counters.
 */
export const demoHitUrl = async (req: Request, res: Response) => {
  const { code } = req.params;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid short code' });
  }

  try {
    const result = await resolveUrl(code);

    if (!result) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/demo/stats
 * Telemetry endpoint exposing queue depth, buffered clicks, and recent URLs for portfolio observability.
 */
export const demoStats = async (_req: Request, res: Response) => {
  try {
    const [queueMetrics, recentUrls] = await Promise.all([
      getClickQueueMetrics(),
      getRecentUrls(8),
    ]);

    return res.json({
      status: 'healthy',
      queue: queueMetrics,
      recent: recentUrls,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
