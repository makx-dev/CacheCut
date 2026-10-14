import { Request, Response } from 'express';
import { pool } from '../db/pool';
import { generateCode } from '../utils/generateCode';
import { redis } from '../db/redis';
import { LruCache } from '../utils/lruCache';
import { recordClick } from '../services/clickSync.service';

// Tier-1 In-Memory LRU Cache: stores short_code -> og_url (10,000 entries, 60s TTL)
const urlL1Cache = new LruCache<string, string>(10000, 60000);

export const getUrl = async (req: Request, res: Response) => {
  const { code } = req.params;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid short code' });
  }

  try {
    const cached = await redis.get(`url:${code}`);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query(
      'SELECT * FROM urls WHERE short_code = $1',
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    await redis.set(`url:${code}`, JSON.stringify(result.rows[0]), 'EX', 3600);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to get short URL' });
  }
};

export const shortenUrl = async (req: Request, res: Response) => {
  const { og_url } = req.body;

  //case when url isn't filled
  if (!og_url || typeof og_url !== 'string') {
    return res.status(400).json({ error: 'og_url is required' });
  }

  //error handler for inavlid url
  try {
    new URL(og_url); // throws if invalid
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  let short_code = generateCode(); //call generateCode
  let attempts = 0;

  // handle collision (rare with 7-char nanoid, but handle it)
  while (attempts < 5) {
    const existing = await pool.query(
      'SELECT 1 FROM urls WHERE short_code = $1',
      [short_code]
    );
    if (existing.rowCount === 0) break;
    short_code = generateCode();
    attempts++;
  }

  try {
    const result = await pool.query(
      `INSERT INTO urls (short_code, og_url) VALUES ($1, $2) RETURNING short_code, og_url, created_at`,
      [short_code, og_url]
    );

    // Pre-warm Tier-1 (Local LRU) & Tier-2 (Redis) caches
    urlL1Cache.set(short_code, og_url);
    await redis.set(`url:${short_code}`, JSON.stringify(result.rows[0]), 'EX', 3600);

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create short URL' });
  }
};

export const redirectUrl = async (req: Request, res: Response) => {
  const { code } = req.params;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid short code' });
  }

  try {
    // --- TIER 1: In-Memory LRU Cache (Sub-microsecond, 0 network overhead) ---
    const l1Target = urlL1Cache.get(code);
    if (l1Target) {
      recordClick(code);
      return res.redirect(l1Target);
    }

    // --- TIER 2: Redis Cache (Single TCP hop) ---
    const cached = await redis.get(`url:${code}`);
    if (cached) {
      const { og_url } = JSON.parse(cached);
      urlL1Cache.set(code, og_url);
      recordClick(code);
      return res.redirect(og_url);
    }

    // --- TIER 3: PostgreSQL Database (Cache miss fallback) ---
    const result = await pool.query(
      'SELECT og_url FROM urls WHERE short_code = $1',
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    const { og_url } = result.rows[0];

    // Populate L2 (Redis) & L1 (LRU) for subsequent requests
    await redis.set(`url:${code}`, JSON.stringify(result.rows[0]), 'EX', 3600);
    urlL1Cache.set(code, og_url);

    // Buffer click in memory (persisted to Redis every 1s, DB every 5s)
    recordClick(code);

    return res.redirect(og_url);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to redirect' });
  }
};



// One gap worth flagging: your :code route will also catch anything that isn't /shorten — including
// things like /favicon.ico. Not a real problem now, but worth a mental note for when you add more
// routes later (put more specific paths before the catch-all :code).