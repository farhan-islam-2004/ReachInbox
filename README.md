# ReachInbox Email Scheduler

A full-stack platform for scheduling and delivering email at scale. The system separates scheduling (synchronous, API-driven) from delivery (asynchronous, worker-driven), with PostgreSQL as the authoritative state store and BullMQ-over-Redis for durable delayed execution.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-8-DC382D?style=flat-square&logo=redis&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-6.x-FF6B6B?style=flat-square)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-9.2-005571?style=flat-square&logo=elasticsearch&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)

---

## Overview

Scheduling email reliably is harder than it looks. A naive approach — enqueue a job, send it, done — breaks under worker crashes, duplicate consumers, and clock skew. This project builds the full pipeline carefully: every email is written to PostgreSQL before a BullMQ job is ever created. The database is always the authority. Redis stores the delay reference; the worker executes delivery only after atomically claiming the database record. If the worker crashes mid-flight, the record's state makes the failure mode explicit rather than ambiguous.

The rate-limiting layer is enforced at the worker, not the API, using a Redis Lua script that checks minimum send delay and hourly quotas in a single atomic `EVAL` call — no in-memory counters, no race conditions between concurrent workers. When a limit is hit, the job is rescheduled via `job.moveToDelayed()` rather than failing, so retry counters stay clean.

The frontend is a React + Tailwind SPA authenticated via Google OAuth, exposing scheduling, search, status monitoring, and Slack integration. Elasticsearch serves as a search projection over delivered mail, indexed asynchronously so that search availability never blocks delivery.

---

## Features

**Scheduling**
- Delayed scheduling to any future timestamp
- Bulk scheduling via `POST /api/emails/schedule-batch` (chunked DB inserts + single `addBulk` to Redis)
- Configurable minimum inter-send delay per sender (default: 2,000 ms)
- Per-sender and per-campaign hourly rate limits
- File attachment support — base64 payloads stored in PostgreSQL, decoded at dispatch

**Reliability**
- PostgreSQL written first, BullMQ job created second — no silent message loss on restart
- Deterministic job IDs (`email_<emailId>`) prevent duplicate enqueueing on retry
- Atomic `SCHEDULED → PROCESSING` claim via `updateMany` — one worker wins, others skip
- Delayed jobs survive Redis and worker restarts (stored in sorted sets, not memory)
- Conservative crash-boundary handling: ambiguous PROCESSING records are preserved, not blindly re-dispatched
- Durable `messageId` recovery: if SMTP confirmed but DB finalization crashed, finalize without re-sending

**Platform**
- Google OAuth 2.0 with CSRF-protected state parameter (Redis, single-use, 10-min TTL)
- Server-side sessions — 7-day HttpOnly cookies, tokens stored in PostgreSQL
- Per-user ownership isolation enforced at the query layer on every endpoint
- Elasticsearch full-text search (subject, body, recipient) scoped by `userId`
- Bull Board queue dashboard at `http://localhost:4000/admin/queues`
- Slack rate-limit notifications with hourly deduplication via `SET NX EX 3600`

---

## Architecture

```mermaid
flowchart TD
    Client["React Frontend\n(port 5173)"] -->|"Google OAuth / session cookie"| API["Express API\n(port 4000)"]

    subgraph AuthLayer["Authentication & Ownership"]
        API -->|"validate session"| PG[("PostgreSQL\n(port 5432)")]
        API -->|"requireAuth + userId scope"| Guard{"Ownership guard"}
        Guard --> Resources["Campaigns · Senders · Emails"]
    end

    subgraph SchedulingLayer["Scheduling Pipeline"]
        API -->|"1 · persist email record"| PG
        API -->|"2 · addBulk / addJob"| Redis[("Redis\n(port 6379)")]
        Redis --> BullMQ["BullMQ emailQueue\n(delayed set)"]
    end

    subgraph WorkerLayer["Worker & Delivery"]
        BullMQ -->|"job eligible"| Worker["Email Worker\n(concurrency: 5)"]
        Worker -->|"Lua rate-limit reservation"| Redis
        Worker -->|"atomic SCHEDULED → PROCESSING"| PG
        Worker -->|"SMTP dispatch"| SMTP["Ethereal SMTP"]
        Worker -->|"finalize SENT + messageId"| PG
    end

    subgraph ObservabilityLayer["Observability & Alerts"]
        Worker -.->|"async index (userId-scoped)"| ES["Elasticsearch 9.2\n(port 9200)"]
        Worker -.->|"deduplicated alert"| Slack["Slack API"]
        BullBoard["Bull Board\n/admin/queues"] --> Redis
    end
```

PostgreSQL is the single source of truth throughout. Redis holds delay references and rate-limit counters. The worker process is intentionally separate from the API so each can be scaled and restarted independently.

---

## Engineering Notes

### Delivery lifecycle

1. Authenticated request → API validates sender/campaign ownership
2. Email row written to PostgreSQL with `status = SCHEDULED`
3. BullMQ delayed job created with `jobId: email_<emailId>` and `delay = scheduledAt - now`
4. When delay elapses, worker picks up the job
5. Redis Lua script atomically checks min-delay and hourly limits; if blocked, job is rescheduled via `moveToDelayed()`, no failure counted
6. Worker claims the record: `updateMany({ where: { id, status: 'SCHEDULED' } })` — only `count === 1` proceeds
7. Nodemailer dispatches via SMTP; `messageId` returned
8. PostgreSQL updated to `SENT` with `messageId` and `sentAt`
9. Elasticsearch indexed asynchronously — errors logged, delivery never blocked

### Crash boundaries

Standard SMTP has no distributed two-phase commit with PostgreSQL. This system handles the boundary conservatively:

- **Worker crashes before DB finalize:** record stays `PROCESSING` with `messageId = null`. On retry, the worker detects this state and halts without re-dispatching to avoid duplicate sends. The record is preserved for review.
- **DB finalize crashes after `messageId` is written:** the worker detects `messageId !== null` on a `PROCESSING` record and finalizes to `SENT` without re-sending.
- **SMTP failure:** record reverts to `SCHEDULED`, BullMQ retries with backoff. After all attempts exhausted, marked `FAILED`.

This design does not claim exactly-once SMTP delivery — no standard SMTP integration can make that guarantee.

### Rate limiting

Enforced at the worker level using a single atomic Redis Lua `EVAL` call across four keys per send slot. The script checks, in order: minimum send delay → sender hourly quota → campaign hourly quota. All checks and counter increments happen atomically, coordinating correctly across concurrent workers without shared memory.

When a limit fires: DB record reverts to `SCHEDULED`, job moves to `delayed` via `moveToDelayed(nextAvailableTimestamp, token)`, `DelayedError` is thrown. BullMQ does not increment the retry counter for `DelayedError`.

### Bulk scheduling

`POST /api/emails/schedule-batch` accepts arrays of email inputs. Records are inserted into PostgreSQL in chunks of 250 via `createMany`, then all BullMQ jobs are created in a single `addBulk` call.

Observed local benchmark: 1,000 email records persisted to PostgreSQL and 1,000 BullMQ delayed jobs enqueued in approximately 140 ms on local Docker infrastructure. This measures scheduling and enqueue time only — not SMTP delivery.

### Search

Elasticsearch is a read projection, not the source of truth. Indexing happens asynchronously after PostgreSQL commits `SENT`; if ES is unreachable the error is caught and logged, delivery is unaffected. Every indexed document carries a `userId` keyword field; every query applies a term filter on `userId` before executing.

### Data model

| Model | Purpose |
|---|---|
| `User` | Tenant — linked to Google `sub` |
| `Session` | 7-day server-side session token |
| `Sender` | SMTP identity and credentials per user |
| `Campaign` | Grouping of emails with optional `hourlyLimit` |
| `Email` | Authoritative record — `SCHEDULED → PROCESSING → SENT / FAILED` |
| `SlackConnection` | Slack OAuth token and channel per user |

### API surface

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | — | Liveness |
| `GET` | `/api/health/db` | — | DB connectivity |
| `GET` | `/api/auth/google` | — | Begin OAuth |
| `GET` | `/api/auth/me` | ✓ | Current user |
| `POST` | `/api/auth/logout` | ✓ | End session |
| `POST` | `/api/emails/schedule` | ✓ | Schedule one email |
| `POST` | `/api/emails/schedule-batch` | ✓ | Schedule a batch |
| `GET` | `/api/emails` | ✓ | List (paginated, filterable) |
| `GET` | `/api/emails/:id` | ✓ | Single email |
| `GET` | `/api/search/emails` | ✓ | Elasticsearch search |
| `GET` | `/api/slack/connect` | ✓ | Begin Slack OAuth |
| `GET` | `/api/slack/status` | ✓ | Slack connection status |
| `DELETE` | `/api/slack/disconnect` | ✓ | Remove Slack connection |
| `GET` | `/admin/queues` | — | Bull Board |

### Why this architecture

| Decision | Reason |
|---|---|
| PostgreSQL as source of truth | ACID guarantees for the full email lifecycle |
| BullMQ + Redis sorted sets | Delay semantics map directly to "deliver at timestamp"; survives restarts |
| Redis Lua for rate limiting | Atomic multi-key reservation without race conditions |
| Elasticsearch as projection | Full-text search without `LIKE` pressure on PostgreSQL |
| Separate worker process | API and delivery scale and restart independently |
| Ethereal SMTP | Sandboxed testing — messages captured, preview URLs generated, no real inbox impact |
| HttpOnly session cookies | Opaque server-side tokens; no JWT secrets, no client-visible session data |

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS, React Router 6 |
| Backend | Node.js, Express 4, TypeScript 5 |
| Database | PostgreSQL 17, Prisma 6 |
| Queue | BullMQ 6, Bull Board 9 |
| Cache / Coordination | Redis 8 (AOF), ioredis 6 |
| Search | Elasticsearch 9.2 |
| Email | Nodemailer 10, Ethereal SMTP |
| Auth | Google OAuth 2.0, google-auth-library 11 |
| Notifications | Slack Web API 8 |
| Infrastructure | Docker Compose |

---

## Getting Started

**Prerequisites:** Node.js 18+, npm 9+, Docker with Compose v2.

### 1. Clone

```bash
git clone https://github.com/farhan-islam-2004/ReachInbox-Scheduler.git
cd ReachInbox-Scheduler
```

### 2. Start infrastructure

```bash
docker compose up -d
# starts PostgreSQL :5432, Redis :6379, Elasticsearch :9200
```

### 3. Configure and start the backend

```bash
cd backend
npm install
cp .env.example .env   # fill in credentials — see Configuration below
npx prisma generate
npx prisma migrate deploy
npm run dev            # API at http://localhost:4000
```

### 4. Start the worker _(separate terminal)_

```bash
cd backend
npm run dev:worker     # or: npm run build && npm run start:worker
```

> In `NODE_ENV=development` the worker also starts automatically inside the API process unless `START_WORKER=false` is set.

### 5. Start the frontend _(separate terminal)_

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:4000
npm run dev            # UI at http://localhost:5173
```

---

## Configuration

### Environment variables

**Backend** (`backend/.env`):

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | |
| `REDIS_PORT` | `6379` | |
| `PORT` | `4000` | |
| `WORKER_CONCURRENCY` | `5` | |
| `MAX_EMAILS_PER_HOUR` | `50` | Global hourly cap |
| `MIN_EMAIL_DELAY_MS` | `2000` | Per-sender min send interval (ms) |
| `ETHEREAL_HOST` | `smtp.ethereal.email` | |
| `ETHEREAL_PORT` | `587` | |
| `ETHEREAL_SECURE` | `false` | |
| `ETHEREAL_USER` | — | |
| `ETHEREAL_PASSWORD` | — | |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | |
| `ELASTICSEARCH_INDEX` | `emails` | |
| `GOOGLE_CLIENT_ID` | — | |
| `GOOGLE_CLIENT_SECRET` | — | |
| `GOOGLE_REDIRECT_URI` | `http://localhost:4000/api/auth/google/callback` | |
| `SLACK_CLIENT_ID` | — | |
| `SLACK_CLIENT_SECRET` | — | |
| `SLACK_REDIRECT_URI` | `http://localhost:4000/api/slack/callback` | |
| `FRONTEND_URL` | `http://localhost:5173` | Post-auth redirect target |
| `CORS_ORIGIN` | `http://localhost:5173` | |

**Frontend** (`frontend/.env`):

| Variable | Default |
|---|---|
| `VITE_API_URL` | `http://localhost:4000` |

### Google OAuth

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Web Client ID**
3. Add `http://localhost:4000/api/auth/google/callback` to **Authorized redirect URIs**
4. Copy **Client ID** and **Client Secret** into `backend/.env`

The login flow: the API generates a 32-byte random state stored in Redis (10-min TTL, single-use), redirects to Google, receives the callback, validates state, exchanges the code via `google-auth-library`, verifies the ID token, upserts the user by Google `sub`, issues a 7-day HttpOnly session cookie, and redirects to the frontend.

### Slack

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Add `http://localhost:4000/api/slack/callback` under **OAuth & Permissions → Redirect URLs**
3. Add bot scopes: `chat:write`, `incoming-webhook`; enable **Incoming Webhooks**
4. Copy credentials into `backend/.env`
5. Connect from the UI: **Slack Alerts → Connect with Slack → select channel → Allow**
6. Invite the bot in Slack: `/invite @<your-bot-name>`

When the sender hourly limit is hit, the worker fires one Slack notification and sets a `SET NX EX 3600` key — subsequent triggers within the same hour are silently skipped.

---

## Testing

Two verification suites ship with the project. Both require the full local stack running.

```bash
cd backend
npm run build

# Suite 1 — auth, sessions, multi-tenant ownership isolation
node dist/tests/run-phase7-verification.js

# Suite 2 — rate limiting, bulk scheduling, Elasticsearch, Slack deduplication, crash boundary
node dist/tests/run-verification.js
```

**Suite 1** (20 assertions) covers: OAuth state lifecycle, session validation and expiry, sender and campaign ownership enforcement, cross-user access denial, Elasticsearch `userId` scoping, Slack connection isolation.

**Suite 2** (32 assertions) covers: Redis Lua min-delay and hourly limit enforcement, bulk scheduling within 5,000 ms, PostgreSQL record persistence, idempotent SENT guard, `messageId` recovery on `PROCESSING` records, Elasticsearch index and retrieval, Slack `SET NX` deduplication, OAuth state replay rejection, API endpoint contract.

---

## Limitations

- **No exactly-once SMTP delivery guarantee.** Standard SMTP provides no distributed two-phase commit with PostgreSQL. The ambiguous crash window is handled conservatively, but duplicate delivery cannot be fully ruled out in pathological failure scenarios.
- **Ethereal SMTP is a sandbox.** Messages do not reach real inboxes. Switching to a production relay (SES, SendGrid, etc.) requires updating `ETHEREAL_HOST`, `ETHEREAL_PORT`, and credentials.
- **Single-node Elasticsearch.** Replica shards remain unassigned on a single Docker node; cluster health reports `yellow`. Indexing and search work normally.
- **OAuth requires registered credentials.** Without a configured Google Cloud project or Slack App, the OAuth redirect flows will fail. All other backend functionality is verifiable via the test suites.

---

<sub>Built by Farhan Islam Sekh — TypeScript · React · PostgreSQL · Redis · BullMQ · Elasticsearch</sub>
