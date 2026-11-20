# CacheCut

A high-throughput URL shortener with a two-tier cache (in-memory + Redis) and retry-backed asynchronous click persistence. Built with **TypeScript, Express, PostgreSQL, Redis, and BullMQ**.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Interactive_Console-2ea44f?style=for-the-badge&logo=render)](https://cachecut.onrender.com)
[![Qrew Engine](https://img.shields.io/badge/Qrew_Engine-Decoupled_Worker-blue?style=for-the-badge&logo=redis)](https://qrew.onrender.com)
[![Docker](https://img.shields.io/badge/Docker-Compose_Ready-2496ED?style=for-the-badge&logo=docker)](./docker-compose.yml)
[![CI/CD Pipeline](https://github.com/makx-dev/CacheCut/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/makx-dev/CacheCut/actions/workflows/ci-cd.yml)

> ⏳ **Cold Start Notice:** On first access after 15 min idle, Render wakes the Node container (30–50s) and Neon resumes serverless compute. Subsequent lookups execute at sub-millisecond speeds.

---

CacheCut is built to keep redirects fast under load. Lookups are served from an in-process L1 cache, falling back to Redis (cache-aside) and then PostgreSQL. Click counts are buffered in Redis (`INCR`) and asynchronously committed to PostgreSQL via an embedded **BullMQ worker** with an atomic `GETDEL` handoff and exponential backoff retries.

On a single laptop, this took redirect throughput from ~1.4k to ~5.4k req/s at 100 connections (and up to ~6.3k req/s at 10 conns with 1 ms p50 latency). A delta test under normal operation showed zero lost or double-counted clicks across 174,000+ requests.

## Features

- **Short Code Generation (`nanoid`) & Redirect:** 7-character collision-resistant URL encoding.
- **Two-Tier Cache Hierarchy:** L1 in-memory (LRU), then Redis (cache-aside with 24h TTL), then PostgreSQL.
- **Asynchronous Write-Behind Click Persistence:** Immediate Redis buffer (`clicks:<code>`), periodic 10s `GETDEL` handoff, and BullMQ worker commits with retry budget (guaranteed zero click loss).
- **Anti-Abuse Ingress Rate Limiting:** `express-rate-limit` with `trust proxy` enabled (20 shortens per 15 min per IP).
- **URL Sanitization & 7-Day Storage Protection:** Strict HTTP/HTTPS validation (max 2,048 chars) and database link lifetime pruning (`expires_at`).
- **Interactive Developer Test Bench (`GET /`):** Live latency telemetry (`performance.now()`), resolution tier badges (L1 / L2 / PG), and dual click counters ("Buffered in Redis" vs "Persisted in Postgres").

---

## Architecture

### Read Path (Redirect & Lookup)

```mermaid
flowchart LR
    C[Client] --> A[Express /:code]
    A --> L1{L1 in-memory<br/>LRU Cache}
    L1 -- hit --> R[302 redirect]
    L1 -- miss --> RD{Redis<br/>url:code}
    RD -- hit --> F1[Fill L1] --> R
    RD -- miss --> PG[(PostgreSQL)]
    PG --> F2[Fill Redis + L1] --> R
```

### Click Counting & Persistence Path

```mermaid
flowchart LR
    H[Redirect / Demo Hit] --> RI[Redis INCR clicks:code<br/>SADD dirty:clicks]
    RI -- 10s Scheduler: Atomic GETDEL --> Q[BullMQ persist-clicks Job]
    Q -- Worker (Retries + Backoff) --> PGU[(PostgreSQL<br/>click_cnt += delta)]
```

---

## Tech Stack

TypeScript, Node.js, Express 5, PostgreSQL 17, Redis 7 (`ioredis`), BullMQ 5, Docker Compose.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose (or cloud PostgreSQL and Redis URLs)

### Setup

```bash
git clone https://github.com/makx-dev/url-shortener.git
cd url-shortener
npm install

# Start local Postgres and Redis
docker compose up -d
```

Create a `.env` file:

```env
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/url_shortener
REDIS_HOST=localhost
REDIS_PORT=6379
# In production (e.g. Render / Neon / Redis Cloud):
# REDIS_URL=rediss://default:password@your-redis-host:6379
```

### Run

```bash
npm run dev      # tsx watch, development
npm start        # builds with tsc, then runs node dist/index.js
```

---

## API Reference

| Method | Path | Description | Rate Limit |
|---|---|---|---|
| `GET` | `/` | Interactive Developer Test Bench & Telemetry UI | None |
| `POST` | `/shorten` | Create a short URL (JSON payload `{ "og_url": "..." }`) | 20 req / 15 min |
| `GET` | `/:code` | 302 redirect to the destination URL | None |
| `POST` | `/api/demo/hit/:code` | Shared resolution inspection (returns tier, latencyMs, and dual click counts) | None |
| `GET` | `/api/demo/stats` | Observability endpoint (BullMQ queue depth, recent URLs) | None |
| `GET` | `/health` | Broker & database connection readiness probe | None |

### Example Commands

```bash
# Create short URL (bash/curl)
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -d '{"og_url":"https://github.com/makx-dev/Qrew"}'

# Test resolution & measure latency
curl -X POST http://localhost:3000/api/demo/hit/3xK9p

# Redirect (use -I to inspect 302 and Location header)
curl -I http://localhost:3000/3xK9p
```

---

## Benchmarks

Setup: `npx autocannon -c 100 -d 10 http://localhost:3000/<code>`, single Node process, Windows laptop with IDE and apps open. Numbers are indicative, not production figures.

| Version | Avg req/s | p50 | p99 |
|---|---|---|---|
| Postgres only (redirect, `UPDATE click_cnt`, single hot URL) | 1,600.8 | 61 ms | 216 ms |
| Redis cache-aside (GET + INCR per request) | 1,391.1 | 60 ms | 211 ms |
| + L1 cache + batched click counting | 5,370.2 | 16 ms | 77 ms |

Notes:
- Autocannon reports `0 2xx responses` because it does not follow redirects and counts a `302` as non-2xx. The redirects are real; verify with `curl -I`.
- All three rows above are measured on the same runner (`node dist/index.js`), at 100 connections / 10s, for a like-for-like comparison.

### L1 Cache + Batched Click Sync Breakdown (Live Measured)

Measured against `dist/index.js` (built, `node` runtime) with `autocannon` hitting a single hot code (`/V4ExgpN`), 10s per scenario. Redirects are served from local in-memory L1 cache, with click counts aggregated and synced to PostgreSQL via the write-behind buffer.

| Concurrency | Duration | Avg Req/Sec | Total Requests | Avg Latency | p50 | p99 | Max Latency | Error Rate |
|---|---|---|---|---|---|---|---|---|
| 10 conns | 10s | 6,276.0 req/s | 62,753 | 1.09 ms | 1 ms | 6 ms | 47 ms | 0% |
| 50 conns | 10s | 5,771.6 req/s | 57,710 | 8.21 ms | 7 ms | 34 ms | 105 ms | 0% |
| 100 conns | 10s | 5,370.2 req/s | 53,695 | 18.15 ms | 16 ms | 77 ms | 226 ms | 0% |

### Correctness Check (Delta Test)

1. Initial `click_cnt` in PostgreSQL for code `V4ExgpN`: 0 (plus ~160 manual verification and health-check requests).
2. Ran three consecutive high-load `autocannon` benchmarks:
   - 100 connections (10s): 53,695 requests
   - 10 connections (10s): 62,753 requests
   - 50 connections (10s): 57,710 requests
   - **Total requests sent:** 174,158 requests
3. Waited past the database sync interval and ran `npm run check:clicks`:
   - **Final `click_cnt` in PostgreSQL:** 174,318
   - Difference: +160 (exact match for pre-test manual requests)

This demonstrates a 100% accurate, zero-loss click aggregation and persistence pipeline without dropping clicks or double-counting during sustained high-concurrency traffic bursts.

---

## Key Design Decisions & Trade-Offs

- **Cache-Aside with TTL for Redis:** Simple, resilient fallback to PostgreSQL on miss. Short URL keys stored at `url:{code}` with 24h TTL to protect Redis RAM.
- **L1 In-Process Cache:** Eliminates TCP hops from the hot redirect path. Uses a bounded LRU eviction policy (10,000 items, 60s TTL) to prevent memory leaks.
- **Write-Behind Click Buffering:** Direct PostgreSQL writes per redirect throttle system throughput. Buffering in Redis via `INCR` trades transient sub-second durability for massive throughput gains.
- **Atomic `GETDEL` + BullMQ Job Handoff:** Atomically reading and clearing the Redis counter prevents double-counting. Enqueuing `{ code, delta }` into BullMQ ensures that if PostgreSQL experiences connection drops or cold-start timeouts, the retry budget carries the count until persistence succeeds.
- **Reverse Proxy Compliance:** Configured `trust proxy: 1` so rate limiters inspect client IPs rather than Render's fronting load balancer.
- **Capacity Defense:** All created links enforce a 7-day expiration (`expires_at`) to bound storage consumption on free-tier databases.

---

## Roadmap

- [x] Move click sync to a BullMQ job queue with retry backoff
- [x] API rate limiter middleware (`express-rate-limit` with `trust proxy`)
- [x] Shared resolution test-bench endpoint (`POST /api/demo/hit/:code`)
- [x] Real-time latency measurement and dual-counter visualization
- [ ] Distributed OpenTelemetry tracing across CacheCut and Qrew worker

---

## License

ISC
