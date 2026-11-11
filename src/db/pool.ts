import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const requiresSsl = connectionString?.includes('sslmode=require') || connectionString?.includes('neon.tech');

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 20000, // 20s allowance for Neon serverless compute wake
  ssl: requiresSsl ? true : undefined,
});

pool.on('error', (err) => {
  console.error('[CacheCut] Unexpected PostgreSQL pool error:', err.message);
});
