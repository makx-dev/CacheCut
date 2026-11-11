import { pool } from './pool';

export async function initDb(retries = 2): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[CacheCut] Initializing database schema (attempt ${attempt}/${retries})...`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS urls (
          url_id SERIAL PRIMARY KEY,
          short_code VARCHAR(10) UNIQUE NOT NULL,
          og_url TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          click_cnt INTEGER DEFAULT 0,
          expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
        );

        -- Ensure expires_at column exists if table was pre-existing
        ALTER TABLE urls ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days');

        -- Indexes for high-throughput lookups and expiration sweeps
        CREATE INDEX IF NOT EXISTS idx_urls_short_code ON urls(short_code);
        CREATE INDEX IF NOT EXISTS idx_urls_expires_at ON urls(expires_at);
      `);

      console.log('[CacheCut] Database schema verified successfully.');
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

