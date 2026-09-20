# ReachInbox Scheduler — Frontend Web Application

A high-performance, production-grade email scheduling user interface inspired by ReachInbox ONE design language. Built with React 18, TypeScript, Tailwind CSS, and Vite.

---

## Features

- **ReachInbox / ONE Aesthetic**: Modern SaaS interface featuring clean slate/charcoal tones, subtle borders, and ReachInbox emerald accents.
- **Session-Based Authentication**: Seamless integration with the backend Google OAuth 2.0 flow using HttpOnly `reachinbox_session` cookies via `credentials: 'include'`.
- **Scheduled & Sent Queues**: Real-time tabs displaying scheduled and delivered emails with live BullMQ worker counts.
- **Elasticsearch Fuzzy Search**: Debounced live full-text search across recipients, subjects, and email content.
- **Dynamic Scheduling Studio**:
  - Single recipient delivery or batch CSV/newline parsing with live count badges.
  - Multi-sender account selector.
  - Rich formatting controls (Bold, Italic, Lists, Links, Code).
  - Configurable send delay (enforcing backend $\ge$ 2000ms minimum inter-message rate limit).
  - Immediate execution test (+3s) or custom future calendar date/time picker.
- **Diagnostic Email Details Modal**: Inspect durable delivery receipts, Ethereal SMTP Message-IDs, and BullMQ status indicators.
- **Slack OAuth Modal**: Connect Slack workspaces, view delivery alert channels, and disconnect with live state updates.
- **Bull Board Direct Link**: One-click jump to BullMQ live queue management dashboard at `http://localhost:4000/admin/queues`.

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node v24)
- Backend running on `http://localhost:4000`

### Installation
```bash
cd frontend
npm install
```

### Environment Variables
Configure `.env`:
```env
VITE_API_URL=http://localhost:4000
```
*(When using Vite dev server, requests to `/api` and `/admin` are automatically proxied to the backend on port 4000).*

### Development Mode
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build
```bash
npm run build
npm run preview
```
Ensures 100% type safety with zero TypeScript or bundling errors.
