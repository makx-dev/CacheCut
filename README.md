# CacheCut

A high-throughput URL shortener with a two-tier cache (in-memory + Redis) and batched click counting. Built with TypeScript, Express, PostgreSQL and Redis.

CacheCut is built to keep redirects fast under load. Lookups are served from an in-process L1 cache, falling back to Redis (cache-aside) and then PostgreSQL. Click counts are aggregated in memory, flushed to Redis once per second, and synced to PostgreSQL with an atomic `GETDEL` handoff.

On a single laptop, this took redirect throughput from ~2.3k to ~9k req/s (100 connections, autocannon). A delta test under normal operation showed no lost or double-counted clicks.

## Features

- Short code generation (`nanoid`) and redirect
- Two-tier cache: L1 in-memory, then Redis (cache-aside with TTL), then PostgreSQL
- Batched click counting: in-memory aggregation, 1s flush to Redis, periodic sync to Postgres
- Atomic Redis to Postgres handoff using `GETDEL`
- Dockerized PostgreSQL 17 and Redis 7 (AOF persistence on)

## Architecture

### Read path (redirect)

```mermaid
flowchart LR
    C[Client] --> A[Express /:code]
    A --> L1{L1 in-memory<br/>cache}
    L1 -- hit --> R[302 redirect]
    L1 -- miss --> RD{Redis<br/>url:code}
    RD -- hit --> F1[Fill L1] --> R
    RD -- miss --> PG[(PostgreSQL)]
    PG --> F2[Fill Redis + L1] --> R
```

### Click counting path

```mermaid
flowchart LR
    H[Redirect handler] --> M[In-memory counter Map]
    M -- flush every 1s --> RI[Redis INCRBY clicks:code]
    RI -- sync job: GETDEL --> PGU[(PostgreSQL<br/>click_cnt += n)]
```

## Tech stack

TypeScript, Node.js, Express 5, PostgreSQL 17, Redis 7 (`ioredis`), Docker Compose.

## Getting started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Setup

```bash
git clone https://github.com/makx-dev/CacheCut.git
cd CacheCut
npm install

# start Postgres and Redis
docker compose up -d

# create the schema
docker compose exec -T postgres psql -U user -d url_shortener < schema.sql
```

Create a `.env` file (commit a `.env.example`, not `.env`):

```env
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/url_shortener
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Run

```bash
npm run dev      # tsx watch, development
npm start        # builds with tsc, then runs node dist/index.js
```

## API

`src/routes/url.routes.ts` is mounted at the app root in `index.ts` (`app.use('/', urlRoutes)`), so the paths below are exactly as written, no prefix.

| Method | Path | Description |
|---|---|---|
| `POST` | `/shorten` | Create a short URL, handled by `shortenUrl` |
| `GET` | `/:code` | 302 redirect to the original URL, handled by `redirectUrl` |

```bash
# create
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -d '{"og_url":"https://example.com"}'

# redirect (use -I to see the 302 and Location header)
curl -I http://localhost:3000/<code>
```

## Benchmarks

Setup: `npx autocannon -c 100 -d 10 http://localhost:3000/<code>`, single Node process, Windows laptop with Docker Desktop, IDE and other apps open. Numbers are indicative, not production figures.

| Version | Avg req/s | p50 | p99 |
|---|---|---|---|
| Postgres only (redirect, `UPDATE click_cnt`, single hot URL) | 1,600.8 | 61 ms | 216 ms |
| Redis cache-aside (GET + INCR per request) | 1,391.1 | 60 ms | 211 ms |
| + L1 cache + batched click counting | 9,014 | 9 ms | 31 ms |

Notes:

- Autocannon reports `0 2xx responses` because it does not follow redirects and counts a `302` as non-2xx. The redirects are real; verify with `curl -I`.
- All three rows above are now measured on the same runner (`node dist/index.js`), at 100 connections / 10s, for a like-for-like comparison.

### Redis cache-aside breakdown

Measured against `dist/index.js` (built, `node` runtime) with `autocannon` hitting a single hot code where the cache is warm (unless noted), 10s per scenario. Each redirect does a cache-hit `GET` plus an `INCR` in Redis.

| Concurrency | Duration | Avg Req/Sec | Total Requests | Avg Latency | p50 | p99 | Max Latency | Error Rate |
|---|---|---|---|---|---|---|---|---|
| 10 conns | 10s | 1,733.6 req/s | 17,335 | 5.29 ms | 4 ms | 16 ms | 193 ms | 0% |
| 50 conns (cold) | 10s | 2,623.4 req/s | 26,230 | 18.60 ms | 17 ms | 62 ms | 90 ms | 0% |
| 50 conns (warm) | 10s | 2,930.7 req/s | 29,304 | 16.60 ms | 16 ms | 45 ms | 66 ms | 0% |
| 100 conns | 10s | 1,391.1 req/s | 13,911 | 71.69 ms | 60 ms | 211 ms | 292 ms | 0% |

Throughput peaks around 50 conns (warm cache beats cold by ~12%, as expected) and drops off again at 100 conns — at that concurrency this run is slightly behind the Postgres-only row above, so the benefit of this layer over plain Postgres shows up more at moderate concurrency than at 100 conns; the L1 cache below is what fixes the drop-off at high concurrency.

### Postgres-only breakdown

Measured with `benchmark/measure_postgres.ts` against Postgres directly, no Redis or L1 cache in the path, 10s per scenario.

| Scenario | Concurrency | Avg Req/Sec | Total Reqs (10s) | Avg Latency | p50 | p99 | Error Rate |
|---|---|---|---|---|---|---|---|
| Redirect (`UPDATE click_cnt` - single hot URL) | 10 conns | 2,541.7 req/s | 25,412 | 3.41 ms | 3 ms | 9 ms | 0% |
| Redirect (`UPDATE click_cnt` - single hot URL) | 50 conns | 2,044.6 req/s | 20,444 | 23.99 ms | 18 ms | 66 ms | 0% |
| Redirect (`UPDATE click_cnt` - single hot URL) | 100 conns | 1,600.8 req/s | 16,008 | 62.13 ms | 61 ms | 216 ms | 0% |
| Redirect (`UPDATE click_cnt` - 20 distributed URLs) | 50 conns | 1,432.8 req/s | 14,328 | 34.61 ms | 20 ms | 93 ms | 0% |
| Read-only redirect (`SELECT` only, no write) | 50 conns | 3,102.8 req/s | 31,024 | 15.66 ms | 15 ms | 35 ms | 0% |
| Shorten URL (`INSERT INTO urls`) | 50 conns | 2,475.9 req/s | 24,753 | 19.73 ms | 17 ms | 47 ms | 0% |

This is what motivates the L1 + Redis cache-aside layer: the write on every redirect (`UPDATE click_cnt`) is the bottleneck, and it degrades fast as concurrency rises (2,541.7 → 1,600.8 req/s from 10 to 100 conns). Read-only redirects and inserts alone are comfortably faster, and error rate stays at 0% across all scenarios.

#### Usage

Start your server in one terminal:

```bash
npm run dev
```

Run the benchmark in another terminal:

```bash
npm run bench:postgres
```

**Tip:** you can also pass custom duration or concurrency flags using `--`:

```bash
npm run bench:postgres -- -c 100 -d 20
```

### Correctness check (delta test)

1. Read `click_cnt` from Postgres for a code (158,901).
2. Run `autocannon -c 100 -d 5` against it (30,939 requests).
3. Wait past the sync interval and read `click_cnt` again (189,940).

Delta of 31,039 vs 30,939 sent. The extra ~100 came from manual `curl` hits and connection handshakes, and Redis was empty afterwards, so the batch moved rather than duplicated. This covers normal operation only, not failure scenarios.

## Design decisions

- **Cache-aside with TTL for Redis:** simple, and a stale or missing key just falls back to Postgres. Keys: `url:{code}` (1h TTL).
- **L1 in-process cache:** removes the network hop from the hot path. It should have a short TTL and a max size so it can't grow unbounded or serve stale data for long.
- **Batched click counting:** writing to Postgres (or even Redis) per redirect caps throughput. Aggregating in memory and flushing once per second trades up to 1s of durability for a large throughput gain.
- **`GETDEL` for the handoff:** reading and clearing the counter atomically prevents the sync job from double-counting or dropping increments that arrive between a `GET` and a `DEL`.
- **Two-tier sync cadence:** an in-memory `Map` flushes to Redis (`INCRBY` + `SADD dirty:clicks`) every 1s; a separate worker pops up to 500 dirty codes from Redis (5 batches of 100) every 5s and applies them to Postgres with `GETDEL` + `UPDATE click_cnt`.
- **Failure handling on sync:** if the Redis pipeline flush fails, the batch is merged back into the in-memory buffer instead of being dropped. If the Postgres `UPDATE` fails after `GETDEL`, the count is restored to Redis with `INCRBY` and the code is re-added to `dirty:clicks`, so a DB outage delays a sync rather than losing clicks.
- **Graceful shutdown:** `SIGINT`/`SIGTERM` handlers stop both interval timers and run one final `flushLocalClicksToRedis` + `syncClicksToDatabase` before the process exits, so a normal restart or deploy does not lose buffered clicks.

## Known limitations

- L1 is per process. With multiple instances, entries can be stale until the L1 TTL expires.
- Up to ~1s of buffered clicks can be lost only on a hard/unclean crash (process killed, power loss, etc.) — a normal shutdown via `SIGINT`/`SIGTERM` (e.g. Docker stop, most PaaS restarts) flushes the buffer first, so no loss there.
- If the Postgres `UPDATE` fails after `GETDEL` (e.g. DB is briefly down), the count is written back to Redis and re-marked dirty, so it's retried on the next sync cycle rather than lost — it's delayed, not dropped, as long as Postgres recovers before the process itself crashes.
- No authentication, rate limiting, or custom aliases yet.

## Roadmap

- [ ] Move click sync to a BullMQ job queue
- [ ] API rate limiter middleware
- [ ] Postgres-down and Redis-down failure tests

## Project structure

```
src/
  controllers/   url.controller.ts
  db/            pool.ts, redis.ts
  routes/        url.routes.ts
  services/      clickSync.service.ts
  types/         url.types.ts
  utils/         generateCode.ts
  index.ts
schema.sql
docker-compose.yml
```

## License

ISC