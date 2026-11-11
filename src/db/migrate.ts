import { pool } from './pool';

export async function initDb(retries = 2): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[CacheCut] Initializing database schema (attempt ${attempt}/${retries})...`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS urls (
          url_id SERIAL PRIMARY KEY,
          short_code VARCHAR(32) UNIQUE NOT NULL,
          og_url TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          click_cnt INTEGER DEFAULT 0,
          expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
        );

        -- Ensure short_code allows up to 32 chars for custom aliases/seed codes
        ALTER TABLE urls ALTER COLUMN short_code TYPE VARCHAR(32);

        -- Ensure expires_at column exists if table was pre-existing
        ALTER TABLE urls ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days');

        -- Indexes for high-throughput lookups and expiration sweeps
        CREATE INDEX IF NOT EXISTS idx_urls_short_code ON urls(short_code);
        CREATE INDEX IF NOT EXISTS idx_urls_expires_at ON urls(expires_at);

        -- Seed permanent demo links for portfolio showcasing
        INSERT INTO urls (short_code, og_url, created_at, click_cnt, expires_at)
        VALUES
          ('cachecut', 'https://github.com/makx-dev/CacheCut', NOW(), 101, NOW() + INTERVAL '365 days'),
          ('qrew', 'https://github.com/makx-dev/Qrew', NOW(), 42, NOW() + INTERVAL '365 days'),
          ('cachecut-repo', 'https://github.com/makx-dev/CacheCut', NOW(), 101, NOW() + INTERVAL '365 days'),
          ('qrew-engine', 'https://github.com/makx-dev/Qrew', NOW(), 42, NOW() + INTERVAL '365 days')
        ON CONFLICT (short_code) DO NOTHING;
      `);

      console.log('[CacheCut] Database schema and seeded demo links verified successfully.');
      return;
    } catch (err: any) {
      console.warn(`[CacheCut] DB init attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) {
        console.error('[CacheCut] CRITICAL: Database schema initialization failed after retries.');
        throw err;
      }
      // Wait 3s before retry to allow serverless DB to resume
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
