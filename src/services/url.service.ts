import { pool } from '../db/pool';
import { redis } from '../db/redis';
import { LruCache } from '../utils/lruCache';
import { generateCode } from '../utils/generateCode';
import { recordClick, getBufferedClicks } from './clickSyncQueue';

export interface ResolveResult {
  shortCode: string;
  ogUrl: string;
  tier: 'L1' | 'L2' | 'PG';
  latencyMs: number;
  expired: boolean;
  bufferedClicks: number;
  persistedClicks: number;
  expiresAt: string | null;
}

export interface UrlRecord {
  shortCode: string;
  ogUrl: string;
  createdAt: string;
  expiresAt: string | null;
  clickCnt: number;
}

interface CachedUrlData {
  ogUrl: string;
  expiresAt: string | null;
}

// Tier 1 In-Memory LRU Cache: 10,000 entries, 60s TTL
const urlL1Cache = new LruCache<string, CachedUrlData>(10000, 60000);

// Redis Cache TTL: 24 hours (86,400 seconds)
const REDIS_CACHE_TTL = 86400;

/**
 * Validates target URL against phishing schemes, non-HTTP protocols, and excessive lengths.
 */
export function validateLongUrl(urlStr: string): { valid: boolean; error?: string } {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'Target URL is required.' };
  }

  const trimmed = urlStr.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum allowable length of 2048 characters.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only http:// and https:// URLs are permitted.' };
    }
    if (!parsed.hostname || parsed.hostname.includes(' ')) {
      return { valid: false, error: 'Invalid hostname format.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Malformed URL format. Ensure protocol (https://) is included.' };
  }
}

/**
 * Flushes specific cache tiers for demonstration / tier-switching showcase.
 */
export async function flushCacheTier(code: string, tier: 'L1' | 'L2' | 'all'): Promise<void> {
  if (tier === 'L1' || tier === 'all') {
    urlL1Cache.delete(code);
  }
  if (tier === 'L2' || tier === 'all') {
    urlL1Cache.delete(code);
    try {
      await redis.del(`url:${code}`);
    } catch {}
  }
}

/**
 * Creates and stores a new shortened URL with 7-day demo expiration.
 */
export async function createShortUrl(ogUrl: string): Promise<UrlRecord> {
  const sanitizedUrl = ogUrl.trim();
  let shortCode = generateCode();
  let attempts = 0;

  // Collision mitigation loop (extremely rare with 7-char custom nanoid)
  while (attempts < 5) {
    const existing = await pool.query('SELECT 1 FROM urls WHERE short_code = $1', [shortCode]);
    if (existing.rowCount === 0) break;
    shortCode = generateCode();
    attempts++;
  }

  const result = await pool.query(
    `INSERT INTO urls (short_code, og_url, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')
     RETURNING short_code, og_url, created_at, expires_at, click_cnt`,
    [shortCode, sanitizedUrl]
  );

  const row = result.rows[0];
  const record: UrlRecord = {
    shortCode: row.short_code,
    ogUrl: row.og_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    clickCnt: row.click_cnt || 0,
  };

  // Pre-warm Tier-1 (Local LRU) & Tier-2 (Redis) caches
  urlL1Cache.set(shortCode, {
    ogUrl: record.ogUrl,
    expiresAt: record.expiresAt,
  });

  await redis.set(
    `url:${shortCode}`,
    JSON.stringify({ ogUrl: record.ogUrl, expiresAt: record.expiresAt }),
    'EX',
    REDIS_CACHE_TTL
  );

  return record;
}

/**
 * Shared URL resolution engine: Used by both the real 302 redirect and the interactive demo endpoint.
 * Measures real latency dynamically via performance.now() across L1, L2, and Postgres tiers.
 */
export async function resolveUrl(
  code: string,
  options?: { flushTier?: 'L1' | 'L2' | 'all' | undefined; fetchRealPersisted?: boolean | undefined }
): Promise<ResolveResult | null> {
  if (!code || typeof code !== 'string') return null;

  // Handle tier eviction simulation for live demo testing
  if (options?.flushTier) {
    await flushCacheTier(code, options.flushTier);
  }

  const start = performance.now();
  let result: {
    ogUrl: string;
    tier: 'L1' | 'L2' | 'PG';
    latencyMs: number;
    expired: boolean;
    expiresAt: string | null;
  } | null = null;

  // --- TIER 1: In-Memory LRU Cache ---
  const l1Target = urlL1Cache.get(code);
  if (l1Target) {
    const latencyMs = Number((performance.now() - start).toFixed(2));
    const isExpired = l1Target.expiresAt ? new Date(l1Target.expiresAt).getTime() < Date.now() : false;
    result = {
      ogUrl: l1Target.ogUrl,
      tier: 'L1',
      latencyMs,
      expired: isExpired,
      expiresAt: l1Target.expiresAt,
    };
  }

  // --- TIER 2: Redis Cache (Single TCP roundtrip) ---
  if (!result) {
    try {
      const cachedRaw = await redis.get(`url:${code}`);
      if (cachedRaw) {
        const parsed: CachedUrlData = JSON.parse(cachedRaw);
        const latencyMs = Number((performance.now() - start).toFixed(2));
        const isExpired = parsed.expiresAt ? new Date(parsed.expiresAt).getTime() < Date.now() : false;

        // Backfill L1 Cache
        urlL1Cache.set(code, parsed);

        result = {
          ogUrl: parsed.ogUrl,
          tier: 'L2',
          latencyMs,
          expired: isExpired,
          expiresAt: parsed.expiresAt,
        };
      }
    } catch (err: any) {
      console.warn(`[CacheCut] Redis cache read failed for ${code}:`, err.message);
    }
  }

  // --- TIER 3: PostgreSQL Fallback (ACID Persistence) ---
  if (!result) {
    const dbResult = await pool.query(
      'SELECT short_code, og_url, created_at, click_cnt, expires_at FROM urls WHERE short_code = $1',
      [code]
    );

    if (dbResult.rowCount === 0) {
      return null;
    }

    const row = dbResult.rows[0];
    const latencyMs = Number((performance.now() - start).toFixed(2));
    const isExpired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false;
    const urlData: CachedUrlData = {
      ogUrl: row.og_url,
      expiresAt: row.expires_at,
    };

    // Backfill both L1 and L2 caches
    urlL1Cache.set(code, urlData);
    redis
      .set(`url:${code}`, JSON.stringify(urlData), 'EX', REDIS_CACHE_TTL)
      .catch(() => {});

    result = {
      ogUrl: row.og_url,
      tier: 'PG',
      latencyMs,
      expired: isExpired,
      expiresAt: row.expires_at,
    };
  }

  if (!result.expired) {
    recordClick(code).catch(() => {});
  }

  // Fetch telemetry counts
  const bufferedClicks = await getBufferedClicks(code);
  let persistedClicks = 0;

  if (options?.fetchRealPersisted) {
    try {
      const dbClicksRes = await pool.query('SELECT click_cnt FROM urls WHERE short_code = $1', [code]);
      persistedClicks = dbClicksRes.rows[0]?.click_cnt || 0;
    } catch {
      persistedClicks = 0;
    }
  }

  return {
    shortCode: code,
    ogUrl: result.ogUrl,
    tier: result.tier,
    latencyMs: result.latencyMs,
    expired: result.expired,
    bufferedClicks,
    persistedClicks,
    expiresAt: result.expiresAt,
  };
}

/**
 * Returns safe, curated public demo links (prevents leaking private user URLs).
 */
export function getSeededDemoUrls(): UrlRecord[] {
  return [
    {
      shortCode: 'cachecut-repo',
      ogUrl: 'https://github.com/makx-dev/CacheCut',
      createdAt: '2026-11-11T00:00:00.000Z',
      expiresAt: null,
      clickCnt: 101,
    },
    {
      shortCode: 'qrew-engine',
      ogUrl: 'https://github.com/makx-dev/Qrew',
      createdAt: '2026-11-11T00:00:00.000Z',
      expiresAt: null,
      clickCnt: 42,
    },
  ];
}
