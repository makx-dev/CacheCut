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
  clickCnt: number;
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
    clickCnt: record.clickCnt,
  });

  await redis.set(
    `url:${shortCode}`,
    JSON.stringify({ ogUrl: record.ogUrl, expiresAt: record.expiresAt, clickCnt: record.clickCnt }),
    'EX',
    REDIS_CACHE_TTL
  );

  return record;
}

/**
 * Shared URL resolution engine: Used by both the real 302 redirect and the interactive demo endpoint.
 * Measures real latency dynamically via performance.now() across L1, L2, and Postgres tiers.
 */
export async function resolveUrl(code: string): Promise<ResolveResult | null> {
  if (!code || typeof code !== 'string') return null;
  const start = performance.now();

  // --- TIER 1: In-Memory LRU Cache ---
  const l1Target = urlL1Cache.get(code);
  if (l1Target) {
    const latencyMs = Number((performance.now() - start).toFixed(2));
    const isExpired = l1Target.expiresAt ? new Date(l1Target.expiresAt).getTime() < Date.now() : false;

    if (!isExpired) {
      recordClick(code).catch(() => {});
    }

    const bufferedClicks = await getBufferedClicks(code);
    return {
      shortCode: code,
      ogUrl: l1Target.ogUrl,
      tier: 'L1',
      latencyMs,
      expired: isExpired,
      bufferedClicks,
      persistedClicks: l1Target.clickCnt,
      expiresAt: l1Target.expiresAt,
    };
  }

  // --- TIER 2: Redis Cache (Single TCP roundtrip) ---
  try {
    const cachedRaw = await redis.get(`url:${code}`);
    if (cachedRaw) {
      const parsed: CachedUrlData = JSON.parse(cachedRaw);
      const latencyMs = Number((performance.now() - start).toFixed(2));
      const isExpired = parsed.expiresAt ? new Date(parsed.expiresAt).getTime() < Date.now() : false;

      // Backfill L1 Cache
      urlL1Cache.set(code, parsed);

      if (!isExpired) {
        recordClick(code).catch(() => {});
      }

      const bufferedClicks = await getBufferedClicks(code);
      return {
        shortCode: code,
        ogUrl: parsed.ogUrl,
        tier: 'L2',
        latencyMs,
        expired: isExpired,
        bufferedClicks,
        persistedClicks: parsed.clickCnt,
        expiresAt: parsed.expiresAt,
      };
    }
  } catch (err: any) {
    console.warn(`[CacheCut] Redis cache read failed for ${code}:`, err.message);
  }

  // --- TIER 3: PostgreSQL Fallback (ACID Persistence) ---
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
    clickCnt: row.click_cnt || 0,
  };

  // Backfill both L1 and L2 caches
  urlL1Cache.set(code, urlData);
  redis
    .set(`url:${code}`, JSON.stringify(urlData), 'EX', REDIS_CACHE_TTL)
    .catch(() => {});

  if (!isExpired) {
    recordClick(code).catch(() => {});
  }

  const bufferedClicks = await getBufferedClicks(code);
  return {
    shortCode: code,
    ogUrl: row.og_url,
    tier: 'PG',
    latencyMs,
    expired: isExpired,
    bufferedClicks,
    persistedClicks: row.click_cnt || 0,
    expiresAt: row.expires_at,
  };
}

/**
 * Fetches recent active links for the demo overview.
 */
export async function getRecentUrls(limit = 10): Promise<UrlRecord[]> {
  try {
    const result = await pool.query(
      `SELECT short_code, og_url, created_at, expires_at, click_cnt
       FROM urls
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      shortCode: row.short_code,
      ogUrl: row.og_url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      clickCnt: row.click_cnt || 0,
    }));
  } catch {
    return [];
  }
}

