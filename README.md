<div align="center">

<h1>
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/mail.svg" width="42" align="center" />
  &nbsp;ReachInbox Email Scheduler
</h1>

<p align="center">
  <strong>A production-grade, distributed email scheduling platform built for high-volume, reliable email dispatching with multi-tenant isolation, real-time observability, and resilient crash recovery.</strong>
</p>

<p align="center">
  <a href="https://reachinbox-frontend-production-b541.up.railway.app">
    <img src="https://img.shields.io/badge/🚀%20Live%20Demo-Railway-7C3AED?style=for-the-badge" alt="Live Demo" />
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  &nbsp;
  <img src="https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  &nbsp;
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-8-DC382D?style=flat-square&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/BullMQ-6.x-FF6B6B?style=flat-square" />
  <img src="https://img.shields.io/badge/Elasticsearch-9.x-005571?style=flat-square&logo=elasticsearch&logoColor=white" />
  <img src="https://img.shields.io/badge/Prisma-6.x-2D3748?style=flat-square&logo=prisma&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white" />
</p>

<br/>

| [🔥 Live Demo](https://reachinbox-frontend-production-b541.up.railway.app) | [📊 Bull Board](https://reachinbox-backend-production-3603.up.railway.app/admin/queues) | [🏥 Health Check](https://reachinbox-backend-production-3603.up.railway.app/api/health) |
|:---:|:---:|:---:|

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Local Setup](#-local-setup)
- [Environment Variables](#-environment-variables)
- [Core Systems](#-core-systems)
  - [Redis & Rate Limiting](#redis--rate-limiting)
  - [Elasticsearch Search](#elasticsearch-search)
  - [Crash Recovery](#crash-recovery)
  - [1000+ Jobs Benchmark](#1000-jobs-benchmark)
- [Google OAuth Setup](#-google-oauth-setup)
- [Slack Alerts Setup](#-slack-oauth--alert-setup)
- [Testing & Verification](#-testing--verification)
- [Bull Board Dashboard](#-bull-board-dashboard)
- [Demo Walkthrough](#-demo-walkthrough)
- [Known Limitations](#-known-limitations)

---

## 🌟 Overview

The **ReachInbox Email Scheduler** solves the challenges of high-volume, reliable email dispatching with:

| Capability | Description |
|---|---|
| **⚡ Durable Scheduling** | Emails persisted in PostgreSQL and enqueued in BullMQ delayed queues with deterministic job IDs |
| **🛡️ Atomic Rate Limiting** | Global, per-sender & per-campaign hourly throttling plus 2,000ms minimum inter-message delay via Redis Lua scripts |
| **📧 Real SMTP Delivery** | Delivers via Ethereal SMTP through Nodemailer, capturing cryptographic Message-IDs |
| **💥 Crash Recovery** | Accurately bounds the SMTP/database failure window with idempotent, ambiguity-safe retry logic |
| **🔍 Full-Text Search** | Asynchronous Elasticsearch 9.x indexing scoped strictly by `userId` — zero cross-tenant leakage |
| **🔔 Slack Alerts** | Real-time rate-limit notifications to Slack with hourly deduplication via `SET NX EX 3600` |
| **🎨 Modern Dashboard** | Figma-inspired React + Tailwind UI matching ReachInbox ONE aesthetics |

---

## 🏗️ Architecture

```mermaid
flowchart TD
    Client["Client / React Frontend (Port 5173)"] -->|Google OAuth 2.0 / Session Cookie| Express["Express API (Port 4000)"]

    subgraph AuthMultiTenancy["Authentication & Multi-Tenancy"]
        Express -->|Validate Session / sub| Postgres["PostgreSQL DB (Port 5432)"]
        Express -->|requireAuth Guard| SecurityCheck{"Ownership Guard"}
        SecurityCheck -->|Scope by userId| UserResources["Campaigns / Senders / Emails"]
    end

    subgraph StorageDispatch["Storage & Dispatch Pipeline"]
        Express -->|1. Authoritative DB Writes| Postgres
        Express -->|2. Delayed Job Enqueue| Redis["Redis Engine (Port 6379)"]
        Redis --> BullMQ["BullMQ emailQueue"]
    end

    subgraph WorkerDelivery["Worker & Delivery Execution"]
        BullMQ -->|Pulls Delayed Job| Worker["Email Worker (Concurrency: 5)"]
        Worker -->|Atomic Rate-Limit & Delay Lua| Redis
        Worker -->|Atomic Claim: SCHEDULED to PROCESSING| Postgres
        Worker -->|Real SMTP Dispatch| Ethereal["Ethereal SMTP Relay"]
        Worker -->|Finalize SENT + messageId| Postgres
    end

    subgraph SearchMonitoringAlert["Search, Monitoring & Alert"]
        Worker -->|Async Non-blocking Index - userId scoped| ES["Elasticsearch 9.x (Port 9200)"]
        Worker -->|Deduplicated Alert via SET NX 3600| Slack["Slack API / Webhooks"]
        BullBoard["Bull Board Dashboard (/admin/queues)"] -->|Queue Observability| Redis
    end
```

---

## 🛠️ Tech Stack

<table>
<tr>
<td valign="top" width="50%">

**Backend**
- Node.js + TypeScript 5.x
- Express 4.x
- Prisma ORM 6.x → PostgreSQL 17
- BullMQ 6.x → Redis 8 (AOF enabled)
- Nodemailer 10.x (Ethereal SMTP)
- google-auth-library 11.x
- Slack Web API 8.x
- Bull Board 9.x
- Helmet, CORS, cookie-parser

</td>
<td valign="top" width="50%">

**Frontend**
- React 18 + Vite
- TypeScript
- Tailwind CSS
- Lucide React icons
- Axios (credentials-first)

**Infrastructure**
- Docker Compose (local)
- Railway (production)
- Elasticsearch 9.2.0
- Cloudflare Tunnel (ES egress)

</td>
</tr>
</table>

---

## 🚀 Local Setup

### Prerequisites

- **Node.js** 18+ (tested on v24)
- **Docker & Docker Compose**
- **npm** 9+

### Quick Start

```bash
# 1. Clone & navigate to project root
git clone https://github.com/farhan-islam-2004/ReachInbox-Scheduler.git
cd ReachInbox-Scheduler

# 2. Launch containerized infrastructure (PostgreSQL, Redis, Elasticsearch)
docker compose up -d

# 3. Backend setup
cd backend
npm install
cp .env.example .env          # Fill in your credentials

npx prisma generate
npx prisma migrate deploy

npm run build
npm run dev                   # Dev server → http://localhost:4000

# 4. Frontend setup (separate terminal)
cd frontend
npm install
cp .env.example .env          # Set VITE_API_URL=http://localhost:4000
npm run dev                   # Vite dev server → http://localhost:5173
```

**Docker services exposed after `docker compose up -d`:**

| Service | Address | Credentials |
|---|---|---|
| PostgreSQL | `localhost:5432` | `reachinbox / reachinbox_dev_password` |
| Redis | `localhost:6379` | — |
| Elasticsearch | `localhost:9200` | — (security disabled locally) |

---

## ⚙️ Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP server port |
| `DATABASE_URL` | `postgresql://reachinbox:reachinbox_dev_password@localhost:5432/reachinbox` | PostgreSQL DSN |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `WORKER_CONCURRENCY` | `5` | BullMQ worker concurrency |
| `MAX_EMAILS_PER_HOUR` | `50` | Global hourly sending cap |
| `MIN_EMAIL_DELAY_MS` | `2000` | Min inter-message delay (ms) |
| `ETHEREAL_HOST` | `smtp.ethereal.email` | Ethereal SMTP server |
| `ETHEREAL_PORT` | `587` | Ethereal SMTP port |
| `ETHEREAL_USER` | *(required)* | Ethereal account username |
| `ETHEREAL_PASSWORD` | *(required)* | Ethereal account password |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch host |
| `ELASTICSEARCH_INDEX` | `emails` | ES index name |
| `GOOGLE_CLIENT_ID` | *(required)* | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | *(required)* | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:4000/api/auth/google/callback` | Google OAuth callback |
| `SLACK_CLIENT_ID` | *(required)* | Slack App Client ID |
| `SLACK_CLIENT_SECRET` | *(required)* | Slack App Client Secret |
| `SLACK_REDIRECT_URI` | `http://localhost:4000/api/slack/callback` | Slack OAuth callback |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL for post-auth redirects |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Backend API base URL |

---

## 🔧 Core Systems

### Redis & Rate Limiting

Redis serves **three mission-critical roles**:

1. **BullMQ Backing Store** — Manages delayed sets, active jobs, and completion records
2. **Atomic Rate Limiting** — Lua scripts for multi-tier hourly throttling + inter-message delay
3. **CSRF State Tokens** — 10-minute TTL cryptographic nonces for Google & Slack OAuth flows

The rate-limiting Lua script executes atomically across all worker instances:

```lua
-- 1. Minimum Send Delay Check (per sender)
local lastSend = tonumber(redis.call('GET', senderLastSendKey) or '0')
local elapsed = currentTimestamp - lastSend
if minDelayMs > 0 and elapsed < minDelayMs then
    local nextEligible = lastSend + minDelayMs
    return { 0, 'MIN_DELAY', tostring(nextEligible), 0, effectiveLimit }
end

-- 2. Hourly Limit Check (per sender)
local currentSenderCount = tonumber(redis.call('GET', senderHourlyKey) or '0')
if currentSenderCount >= effectiveLimit then
    return { 0, 'HOURLY_LIMIT', '0', currentSenderCount, effectiveLimit }
end

-- 3. Atomic Reservation
redis.call('INCR', senderHourlyKey)
redis.call('EXPIRE', senderHourlyKey, keyTtl)
redis.call('SET', senderLastSendKey, currentTimestamp, 'EX', keyTtl)
return { 1, 'OK', '0', newSenderCount, effectiveLimit }
```

When rejected, the worker calls `job.moveToDelayed(nextAvailableTimestamp, token)` and throws `DelayedError()` — no failure counter increment, immediate concurrency slot release.

---

### Elasticsearch Search

- **Dual-Store pattern** — PostgreSQL is the authoritative source; ES is a query-optimized projection
- **Async indexing** — Emails are indexed only after PostgreSQL commits `status = 'SENT'`
- **`userId` scoping** — Every document includes `userId`; every query injects `{ term: { userId } }` — cross-tenant leakage is architecturally impossible
- **Outage-resilient** — ES errors are caught and logged; email delivery is never blocked

---

### Crash Recovery

The delivery lifecycle safely handles the distributed SMTP ↔ PostgreSQL boundary:

1. **Deterministic Job IDs** — BullMQ job IDs follow `email_${email.id}`, preventing duplicate job creation
2. **Atomic DB Claim** — `SCHEDULED → PROCESSING` via `updateMany`; exactly one worker succeeds (`count === 1`)
3. **Ambiguous Crash Recovery** — If a worker crashes post-SMTP-accept but pre-DB-update, the record stays `PROCESSING` with `messageId = NULL`. On retry, the worker detects this state and **skips re-dispatch**, recording an operational note to prevent duplicate sends
4. **Durable Message-ID Recovery** — If `status = 'PROCESSING'` and `messageId` is already populated, the record is finalized as `SENT` without re-sending
5. **No False Guarantees** — Standard SMTP has no 2PC; this system documents and contains that boundary honestly

---

### 1000+ Jobs Benchmark

| Capability | Implementation | Benchmark |
|---|---|---|
| **Batch API** | `POST /api/emails/schedule-batch` | Up to 1,000 emails per call |
| **Chunked Inserts** | `prisma.email.createMany` in 250-record chunks | Atomic, backpressure-safe |
| **Bulk Enqueue** | `emailQueue.addBulk(...)` single Redis round-trip | Minimal network overhead |
| **Verified Speed** | End-to-end | **1,000 emails in 134–140ms** (target: 5,000ms) |

---

## 🔑 Google OAuth Setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**
2. Create an **OAuth 2.0 Web Client ID**
3. Add the following to **Authorized redirect URIs**:
   ```
   http://localhost:4000/api/auth/google/callback
   https://<your-backend>.up.railway.app/api/auth/google/callback
   ```
4. Copy **Client ID** and **Client Secret** into `backend/.env`

**Authentication flow:**
```
User clicks "Continue with Google"
  → GET /api/auth/google
    → Stores 32-byte CSRF state in Redis (10m TTL)
    → Redirects to Google consent screen
      → Google redirects back to /api/auth/google/callback
        → State validated (single-use, deleted from Redis)
        → Code exchanged via google-auth-library
        → ID token verified cryptographically
        → User created/resolved by Google sub (immutable)
        → 7-day HttpOnly session cookie issued
        → Redirect to frontend dashboard
```

---

## 🔔 Slack OAuth & Alert Setup

1. Create a Slack App in the [Slack API Portal](https://api.slack.com/apps)
2. Under **OAuth & Permissions**, add Redirect URL:
   ```
   http://localhost:4000/api/slack/callback
   ```
3. Add **Bot Token Scopes**: `chat:write`, `incoming-webhook`
4. Enable **Incoming Webhooks**
5. Configure `backend/.env`:
   ```env
   SLACK_CLIENT_ID=your_slack_client_id
   SLACK_CLIENT_SECRET=your_slack_client_secret
   SLACK_REDIRECT_URI=http://localhost:4000/api/slack/callback
   ```
6. In the UI: **Slack Alerts → Connect with Slack → select channel → Allow**
7. In Slack: `/invite @reachinbox_scheduler`

**Alert deduplication** — `SET NX EX 3600` ensures at most 1 rate-limit alert per sender per hour, preventing notification floods.

---

## 🧪 Testing & Verification

The test suite validates **52 architectural invariants** across two suites:

```bash
cd backend
npm run build

# Suite 1: Auth, Ownership, Multi-Tenancy (20 tests)
node dist/tests/run-phase7-verification.js

# Suite 2: Rate Limiting, 1000+ Jobs, ES & Slack (32 tests)
node dist/tests/run-verification.js
```

### Results

| Suite | Tests | Status | Coverage |
|---|---|---|---|
| **Phase 7 — Auth & Tenancy** | 20 / 20 | ✅ PASS | Google OAuth state security, session TTL, ownership scoping across campaigns/senders/emails/Slack, ES isolation |
| **Core — Rate Limits & Scale** | 32 / 32 | ✅ PASS | Redis Lua atomic reservations, min send delay enforcement, 1,000-job benchmark (<150ms), crash boundary recovery, ES fallback, Slack dedupe locks |

---

## 📊 Bull Board Dashboard

Real-time BullMQ queue observability:

- **Local**: [http://localhost:4000/admin/queues](http://localhost:4000/admin/queues)
- **Production**: [https://reachinbox-backend-production-3603.up.railway.app/admin/queues](https://reachinbox-backend-production-3603.up.railway.app/admin/queues)

| State | Meaning |
|---|---|
| 🟡 **Delayed** | Waiting for scheduled time or deferred by rate limits |
| 🔵 **Active** | Currently processing under configured worker concurrency |
| 🟢 **Completed** | Successfully delivered |
| 🔴 **Failed** | Unrecoverable errors (after retries) |

---

## 🎬 Demo Walkthrough

### 1. Launch Local Environment

```bash
docker compose up -d
cd backend && npm run dev    # → http://localhost:4000
cd frontend && npm run dev   # → http://localhost:5173
```

### 2. Authenticate

1. Open `http://localhost:5173`
2. Click **"Continue with Google"**
3. Complete consent → redirected to dashboard with 7-day session cookie

### 3. Schedule an Email

1. **Compose** → select sender → fill recipients, subject, body
2. Configure delay (default: 2,000ms) and hourly limit
3. Set schedule time → **Schedule Email**
4. View in **Scheduled** (countdown badge) → after delivery, view in **Sent** (Message-ID + timestamp)

### 4. Full-Text Search

Type a keyword in the search bar — instantaneous Elasticsearch results scoped to your user.

### 5. Slack Alerts

**Slack Alerts → Connect with Slack** → authorize → select channel → trigger rate limit → observe rich alert card in Slack with hourly deduplication.

### 6. Queue Observability

Open **Bull Board** to inspect live `emailQueue` metrics across Delayed, Active, Completed, and Failed states.

---

## ⚠️ Known Limitations

1. **OAuth Developer Credentials** — Local evaluation without configured Google Cloud Console or Slack Developer Apps will show provider configuration prompts. All backend flows are 100% verified via automated test suites.

2. **Ethereal SMTP** — Messages are captured for testing and generate web preview URLs. They do not route to real ISP inboxes. Production deployment requires switching Nodemailer transport to a production relay (Amazon SES, SendGrid, etc.).

3. **Elasticsearch Single-Node Replicas** — On a single-node Docker container, replica shards remain unassigned (expected `yellow` cluster health). This has zero impact on functionality.

---

<div align="center">

**Built with ❤️ for the ReachInbox.ai Engineering Assignment**

<br/>

[![GitHub](https://img.shields.io/badge/GitHub-farhan--islam--2004-181717?style=for-the-badge&logo=github)](https://github.com/farhan-islam-2004/ReachInbox-Scheduler)

</div>
