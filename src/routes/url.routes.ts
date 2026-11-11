import { Router } from 'express';
import {
  shortenUrl,
  redirectUrl,
  demoHitUrl,
  demoStats,
} from '../controllers/url.controller';

const router = Router();

// 1. Shorten URL (Ingress)
router.post('/shorten', shortenUrl);

// 2. Portfolio Demo Telemetry & Inspection Endpoints
router.post('/api/demo/hit/:code', demoHitUrl);
router.get('/api/demo/stats', demoStats);

// 3. Real 302 Redirect Path (Handles short codes like /3xK9p)
router.get('/:code', redirectUrl);

export default router;
