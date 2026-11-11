import { Router } from 'express';
import {
  shortenUrl,
  redirectUrl,
  demoHitUrl,
  demoStats,
} from '../controllers/url.controller';
import {
  shortenLimiter,
  demoHitLimiter,
  redirectLimiter,
} from '../middleware/rateLimit';

const router = Router();

// 1. Shorten URL (Ingress protected: 20 per 15 min per IP)
router.post('/shorten', shortenLimiter, shortenUrl);

// 2. Portfolio Demo Telemetry & Inspection Endpoints (Protected: 60 per min per IP)
router.post('/api/demo/hit/:code', demoHitLimiter, demoHitUrl);
router.get('/api/demo/stats', demoHitLimiter, demoStats);

// 3. Real 302 Redirect Path (Protected: 120 per min per IP)
router.get('/:code', redirectLimiter, redirectUrl);

export default router;
