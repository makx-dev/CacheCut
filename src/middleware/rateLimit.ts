import rateLimit from 'express-rate-limit';

// A. Shorten Ingress Limiter: Max 20 shortens per 15 min per IP
export const shortenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded: Max 20 shortens per 15 min per IP in this demo.',
  },
});

// B. Demo Inspection & Hit Limiter: Max 60 hits/min per IP to prevent Redis command exhaustion
export const demoHitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Demo inspection rate limit exceeded: Max 60 inspection hits per minute per IP.',
  },
});

// C. Redirect Ingress Limiter: Max 120 redirects per min per IP to prevent scraper loops
export const redirectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Redirect rate limit exceeded (120 redirects per minute per IP).',
  },
});
