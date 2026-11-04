# Cloudflare Report Builder

Generate polished, data-rich PDF/HTML reports straight from live Cloudflare
analytics — an **AppSec report** for a single zone, or a
**Zero Trust / Cloudflare One** or **Magic Transit report** for an account — complete with an
AI-written executive summary, charts, and prioritized recommendations. Built
entirely as a Cloudflare Worker + static frontend: no external servers, no
database to manage beyond Cloudflare's own D1/R2.

Also includes a **Custom Dashboard** mode with API-token query templates,
scheduled PDF/HTML delivery and local snapshot imports.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pongpisit/cloudflare-report-builder)

> Built for Cloudflare partners, SEs, and customers who want a Proof-of-Concept
> or recurring security assessment report generated from *real* Cloudflare
> data — not a mock-up. Live-data reports trace their measurements to Cloudflare
> GraphQL Analytics, REST, or analytics API calls. Imported Custom Dashboard
> reports explicitly identify their point-in-time data source.

**At a glance:** ~$5/month to run (the Workers Paid subscription — see
[Cost](#cost)), under a cent of marginal cost per report, ~30 seconds to
generate a report, and no infrastructure to operate.

---

## Table of contents

- [What it does](#what-it-does)
- [Custom Dashboard reports](CUSTOM_DASHBOARD_REPORTS.md) — API tokens, templates, scheduling and PDF/HTML export
- [What you need](#what-you-need) — prerequisites, and why Workers Paid is required
- [Components](#components) — what actually gets deployed
- [Cost](#cost) — measured usage against current Cloudflare pricing
- [Quick start](#quick-start--deploy-to-cloudflare)
- [Manual deployment](#manual-deployment)
- [How the build works](#how-the-build-works)
- [Local development](#local-development)
- [Configuration reference](#configuration-reference)
- [Cloudflare API token permissions](#cloudflare-api-token-permissions)
- [Security](#security)
- [Performance and platform limits](#performance-and-platform-limits)
- [Scheduled email reports](#scheduled-email-reports)
- [AI models](#ai-models)
- [API reference](#api-reference)
- [Data sources and honesty guarantees](#data-sources-and-honesty-guarantees)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What it does

Paste in a Cloudflare API token (yours, scoped read-only, never stored) and
generate:

- **AppSec report** (per zone) — WAF, DDoS, Bot Management, DNS, Cache/CDN,
  SSL/TLS, Rate Limiting, API Shield, Page Shield, Email Security (SPF/DKIM/DMARC),
  AI Crawl Control, AI Security for Apps (prompt injection / PII / unsafe
  topics), Leaked Credential Check, Content Scanning, and a computed Security
  Posture Score — 20+ sections in total.
- **Zero Trust / Cloudflare One report** (per account) — Access apps &
  policies, authentication events & anomalies, Gateway DNS/HTTP/Network (L4)
  filtering with real session health & top Cloudflare locations, Shadow IT
  discovery (SaaS + Private Network), Generative AI usage (via Cloudflare's
  own category classification, not keyword guessing), WARP device posture
  with real online/offline status, Tunnel health, DLP & CASB findings, and a
  Zero Trust posture score. Mirrors the layout of Cloudflare's own **Zero
  Trust → Insights → Dashboards** catalog.
- **Magic Transit report** (per account) — a locally bundled Three.js globe,
  ingress traffic pulse and prior-period changes, geographic distributions,
  protocol/port traffic fingerprints, overlapping L3/L4 attack events, tunnel
  probe health and throughput, DDoS/firewall/advanced protection activity,
  and current tunnel, route, prefix and rule inventories. HTML attachments
  render offline; print/PDF uses an SVG globe fallback.
  Tunnel sections consolidate one-day windows into hourly charts and longer
  windows into daily summaries, with one summary row per tunnel and collapsed
  evidence. Probe counts are summed and routing-state means are sample-weighted;
  bandwidth uses returned bits divided by observed source-bucket duration.
  Missing intervals stay unavailable, and ingress/egress stay separate.
- **Custom Dashboard report** (per zone) — configure reusable API-token query
  templates for traffic/security widgets; preview fresh analytics or schedule
  automatic PDF + HTML email delivery. Also imports GraphQL responses, HAR response
  bodies and versioned JSON snapshots locally for browser PDF/offline HTML export.
  See [supported inputs and integration boundaries](CUSTOM_DASHBOARD_REPORTS.md).
- An **AI executive summary** (Workers AI) for the three live-data report types, with
  distinct wording for a "Proof-of-Concept" pitch vs. a neutral recurring
  "Assessment" report.
- **Finding lifecycle tracking** (D1-backed) — remediation register, CASB
  finding register, and alert investigation register carry status, owner, age
  and occurrence count across report runs, and auto-resolve when the
  underlying condition clears.
- Optional **scheduled email delivery** (daily/weekly/monthly, or the exact
  previous calendar month) via Cloudflare Email Sending, with a full run history.
  Custom Dashboard schedules include automatically rendered PDFs and HTML;
  they use a Browser Rendering binding for PDF generation (optional REST-token fallback).
- An **audit archive** for generated live-data reports (R2), listable and
  re-viewable later.

**AppSec, Cloudflare One and Magic Transit reports use live data.** Custom Dashboard
reports use fresh API analytics or explicitly imported point-in-time snapshots. See
[Data sources and honesty guarantees](#data-sources-and-honesty-guarantees).

### Example reports

Explore [three synthetic report examples](examples/README.md), including
standalone offline HTML and rendered screenshots. All example values are
invented and explicitly labeled; no customer data or credentials are included.

| AppSec | Zero Trust / Cloudflare One | Magic Transit |
|---|---|---|
| [![Synthetic AppSec preview](examples/previews/appsec-cover.png)](examples/README.md#appsec) | [![Synthetic Zero Trust preview](examples/previews/zero-trust-cover.png)](examples/README.md#zero-trust--cloudflare-one) | [![Synthetic Magic Transit preview](examples/previews/magic-transit-cover.png)](examples/README.md#magic-transit) |

See the [visualization roadmap](VISUALIZATION_ROADMAP.md) for proposed Three.js
and linked-chart enhancements across Magic Transit, AppSec and Cloudflare One.

---

## What you need

### Prerequisites

| Requirement | Version / detail | Why |
|---|---|---|
| **Node.js** | 18 or later (20 LTS+ recommended) | Vite 5 and Wrangler 4 both require Node 18+ |
| **npm** | 8+ (npm workspaces) | The repo is a two-workspace monorepo (`apps/api`, `apps/web`) |
| **Cloudflare account** | **Workers Paid ($5/mo minimum)** | Required — see [below](#why-workers-paid-is-required) |
| **Wrangler** | Installed automatically as a devDependency | No global install needed; all commands use `npx wrangler` |
| **Cloudflare API token** | Read-only, scoped — see [token permissions](#cloudflare-api-token-permissions) | Supplies the report data. You paste it in the UI per report; it is never stored |
| **A sending domain** | Only for scheduled email reports | Must be onboarded to Cloudflare Email Sending |

Everything else (the D1 database, R2 bucket, Workers AI binding, cron
trigger) is provisioned by the deploy — you do not need to install or operate
a database, queue, or server.

### Why Workers Paid is required

This is not an upsell — the app genuinely cannot run on the Workers Free
plan. Three independent hard limits are exceeded, all measured or verified
against [Cloudflare's published limits](https://developers.cloudflare.com/workers/platform/limits/):

| Limit | Workers Free | This app needs | Source |
|---|---|---|---|
| **Subrequests per invocation** | 50 | **~75–120** Cloudflare API calls per report | Code: 18 config + up to 50 Access-policy + 48 analytics calls (Zero Trust); 71+ (AppSec) |
| **CPU time per invocation** | 10 ms | **154 ms** measured for one full Zero Trust report | Measured via `wrangler tail` (see [Performance](#performance-and-platform-limits)) |
| **Workers AI model access** | Some models are Paid-only | Primary summary model `@cf/zai-org/glm-5.3-flash` is on Cloudflare's paid-billing list | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |

Additionally, **Email Sending to arbitrary recipients requires Workers Paid**
(sending to verified destination addresses in your own account is free on any
plan), so scheduled email reports need it too.

The Workers Paid plan is a flat **$5/month minimum for the whole account**,
and — as the [Cost](#cost) section shows with measured numbers — realistic
usage of this app fits inside the included allowances, so $5/month is
typically the entire bill.

---

## Components

One `wrangler deploy` produces a single Worker that owns everything below.
There is no separate server, container, or VM.

| Component | Binding | What it does | Required? |
|---|---|---|---|
| **Worker** (Hono) | — | All report generation, API routes, cron entrypoint. Entry: `apps/api/src/index.ts` | Yes |
| **Static Assets** | `[assets]` | Serves the built React SPA (`apps/web/dist`) from the same origin as the API — one URL, no CORS | Yes |
| **D1** (SQLite) | `DB` | Schedule config, send history, backend settings, KPI snapshots, and the remediation / CASB / alert registers — 7 tables | Yes (created by deploy) |
| **R2** | `AUDIT_BUCKET` | Audit archive of rendered report HTML | Optional — only the archive feature needs it |
| **Workers AI** | `AI` | Executive summaries (3-model fallback chain) | Optional — reports render without summaries |
| **Email Sending** | `EMAIL` | Delivers scheduled report digests | Optional — only for scheduled emails |
| **Cron Trigger** | `0 * * * *` | Hourly due-check for scheduled reports | Optional — harmless if unused |

### Architecture

```
                    ┌──────────────────────────────────────────┐
                    │   Cloudflare Worker (Hono)               │
   User's browser   │   apps/api/src/index.ts                  │
  ───────────────── │                                          │
  GET  /            │   [assets] → serves apps/web/dist (SPA)  │
  GET  /api/*  ──────►  REST + GraphQL fetchers → Cloudflare API│
  GET  /health      │   D1 (schedules/registers)  R2 (audit)   │
                    │   Workers AI (executive summary)         │
                    │   Cron (hourly) → scheduled email digest │
                    └──────────────────────────────────────────┘
```

`run_worker_first = ["/api/*", "/health"]` means those paths always execute
the Worker; every other path is served as a static asset first, falling back
to `index.html` for SPA routing. A separate-Pages-project topology is also
supported — see [Alternative: separate Pages frontend](#alternative-separate-pages-frontend).

**Stack:** Hono (API), React 18 + Vite 5 + Tailwind 3 + Recharts + D3
(frontend), TypeScript throughout.

---

## Cost

Cloudflare pricing verified against the official docs (Workers, Workers AI,
D1, R2, and Email Service pricing pages) as of the last README update.
**Always confirm current rates** — Cloudflare pricing changes, and the
figures below are estimates, not a quote.

### Measured resource usage

These are real measurements from this app, not estimates:

| Metric | Measured value | How |
|---|---|---|
| Worker CPU time per report | **154 ms** | `wrangler tail` on a full Zero Trust report against a large production account |
| Worker wall-clock time per report | **~29 s** | Same run — the Worker is I/O-bound waiting on ~100 Cloudflare API calls |
| Cloudflare API calls per report | **~75–120** | Counted in code (`Promise.allSettled` fan-out) |
| Report JSON payload | **~167 KB** | Same run |
| AI summary, CPU time | **9 ms** | Effectively all wall-time is waiting on Workers AI |
| AI summary, wall time | **~10 s (typical) – 113 s (worst case)** | Worst case measured: both reasoning models exhausted their token budget and the third fallback produced the summary |
| Archived report in R2 | **~2.8 MB** median | Median of 37 real archived objects |

### Per-unit rates and included allowances

| Component | Included (Workers Paid) | Rate above included | What this app consumes |
|---|---|---|---|
| **Workers subscription** | — | **$5.00 / month** (account minimum) | Flat |
| Workers requests | 10 M / month | $0.30 / million | 1 request per report |
| Workers CPU time | 30 M CPU-ms / month | $0.02 / million CPU-ms | 154 ms per report → **~195,000 reports/month** fit in the included CPU |
| Static asset requests | Unlimited, free | — | The whole frontend |
| **Workers AI** | 10,000 Neurons / **day** | $0.011 / 1,000 Neurons | ~170 Neurons per summary (best case), ~700 (worst case, all 3 models) |
| **D1** | 5 GB storage, 25 B rows read, 50 M rows written / month | $0.75/GB-mo, $0.001/M read, $1.00/M written | Kilobytes; a handful of rows per report |
| **R2** | 10 GB-month, 1 M Class A, 10 M Class B ops | $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B | ~2.8 MB per archived report → **~3,600 archived reports** fit in the free tier |
| **Email Sending** | 3,000 outbound emails / month | $0.35 / 1,000 emails | 1 email per scheduled recipient |

### Marginal cost per report

| Line item | Cost |
|---|---|
| Worker CPU (154 ms × $0.02/M ms) | $0.000003 |
| AI executive summary | $0.002 (best case) – $0.008 (worst case, 3 models) |
| R2 archive (2.8 MB, per month stored) | $0.00004 |
| **Total** | **well under $0.01 per report** |

### Realistic monthly scenarios

| Scenario | Reports/month | Estimated bill |
|---|---|---|
| **Solo SE / partner** — 20 interactive reports, 4 scheduled emails, all archived | 24 | **$5.00** — everything inside included allowances |
| **Active team** — 200 reports, 50 scheduled emails, all archived | 200 | **$5.00** — ~7 reports/day × ~700 Neurons stays under the 10,000/day AI allowance, so still just the subscription |
| **Heavy automation** — 1,000 reports/month, all with AI summaries | 1,000 | **~$9.50** — ~33 reports/day exceeds the daily AI allowance; ~406,000 billable Neurons/month ≈ $4.46. Workers CPU (154,000 ms), R2 (2.8 GB) and email all remain inside included limits |

**The practical takeaway:** the Workers Paid subscription is the bill. Usage
is close to a rounding error at any volume a human actually reviews reports
at. The one dimension that scales is Workers AI — and because the free
allowance resets *daily* (10,000 Neurons/day ≈ 14 worst-case or 59 best-case
summaries per day), steady usage often stays free.

**Not included above:** your Cloudflare *plan* costs. The reports read data
from products you already pay for (a zone plan, Cloudflare One seats,
Enterprise add-ons like API Shield or Page Shield). This tool adds no
licensing cost to those — it only reads their analytics.

---

## Quick start — Deploy to Cloudflare

Click the button above. Cloudflare will fork this repo into your GitHub
account, provision a D1 database + R2 bucket, bind Workers AI, and deploy
the Worker (which also serves the frontend). That's the whole report
builder — interactive AppSec + Zero Trust reports work immediately with no
further setup, since you supply your own Cloudflare API token directly in
the UI for those.

### Post-deploy steps (optional — only for scheduled email reports)

Scheduled reports need a backend-bound token and sender email, since the
cron job runs with nobody in the browser to supply a token interactively.

```bash
# 1. Bind a Cloudflare API token the scheduler will use to generate reports
#    (same permissions as the interactive report builder — see tables below).
#    The dashboard's Settings page can also set/rotate this without a redeploy.
npx wrangler secret put CF_API_TOKEN

# 2. Onboard a sending domain for Cloudflare Email Sending.
npx wrangler email sending enable yourdomain.com
```

Then set `CF_ACCOUNT_ID` and `EMAIL_FROM` either in `wrangler.toml`'s
`[vars]` (requires a redeploy) or in the app's **Settings** dashboard
(applies instantly, no redeploy — see `apps/api/src/services/settings.ts`).

### ⚠️ Protect the dashboard before going further

The **Scheduled Reports** and **Settings** pages are **not authenticated by
design** — anyone who can reach your Worker's URL can view/change schedule
configuration and the masked settings state (never the raw token — see
[Security](#security)). Put this Worker behind
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
before sharing the URL with anyone but yourself. `/api/me` already reads the
Access-authenticated user's email for you once Access is in front.

---

## Manual deployment

```bash
git clone https://github.com/<you>/cloudflare-report-builder.git
cd cloudflare-report-builder
npm install

# One-time: create the D1 database and record its ID locally (never committed)
npx wrangler d1 create poc-report-schedules
cp wrangler.local.example.toml wrangler.local.toml
# → paste the returned database_id into wrangler.local.toml

npm run deploy   # builds the frontend, runs D1 migrations, deploys the Worker
```

`npm run deploy` (see `scripts/deploy.sh`) automatically uses
`wrangler.local.toml` instead of the committed `wrangler.toml` template when
present — this is how you can keep redeploying to your own already-provisioned
resources without ever committing their IDs to git.

---

## How the build works

There are two independent build products: the **frontend bundle** (built by
Vite, ahead of time) and the **Worker bundle** (built by Wrangler at deploy
time). Understanding the order matters, because the Worker serves the
frontend's output directory as static assets — so the frontend must be built
*first*.

### 1. Frontend build — `npm run build`

Runs `npm run build --workspace=apps/web`, which is `tsc -b && vite build`:

1. `tsc -b` type-checks `apps/web` using project references (fails the build
   on any type error — there is no `noEmitOnError` escape hatch).
2. `vite build` bundles React + Tailwind into `apps/web/dist`, with manual
   vendor chunk splitting configured in `apps/web/vite.config.ts`
   (`vendor-react`, `vendor-recharts`, `vendor-icons`, `vendor-d3`) so the
   large charting libraries cache separately from app code.

Typical output (~2 MB total, ~550 KB gzipped):

```
dist/index.html                       0.99 kB │ gzip:   0.46 kB
dist/assets/index-*.css              43.39 kB │ gzip:   8.25 kB
dist/assets/vendor-d3-*.js            8.24 kB │ gzip:   2.84 kB
dist/assets/vendor-icons-*.js        39.76 kB │ gzip:   9.12 kB
dist/assets/vendor-recharts-*.js    559.77 kB │ gzip: 156.13 kB
dist/assets/index-*.js            1,348.52 kB │ gzip: 376.61 kB
```

Vite warns that the main chunk exceeds 600 kB. That is expected and
accepted: a report page legitimately mounts dozens of chart sections, and
this is an internal reporting tool where a one-time ~380 kB gzipped download
is a better trade than the complexity of lazy-loading every section.

### 2. D1 migrations

`npx wrangler d1 migrations apply DB --remote` applies anything in
`migrations/` not yet recorded in the database's migration table. Migrations
are additive and safe to re-run (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE
ADD COLUMN` with defaults):

| Migration | Adds |
|---|---|
| `0001_init.sql` | `schedules`, `send_history` |
| `0002_settings.sql` | `settings` (backend token + account, dashboard-managed) |
| `0003_zt_snapshots.sql` | `zt_report_snapshots` (period-over-period KPI baselines) |
| `0004_zt_remediation.sql` | `zt_remediation_items` (finding lifecycle) |
| `0005_zt_casb_findings.sql` | `zt_casb_findings` (CASB finding lifecycle) |
| `0006_zt_alert_tracking.sql` | `zt_alert_tracking` (alert investigation register) |
| `0007_schedule_range_mode.sql` | `schedules.range_mode` (rolling vs. calendar month) |
| `0008_schedule_custom_range.sql` | `schedules.since_date`/`until_date` (custom ranges), `months_ago` (explicit month picking) |
| `0009_schedule_range_mode_custom.sql` | Rebuilds `schedules` to allow `range_mode = 'custom'` (SQLite can't ALTER a CHECK constraint) |
| `0010_schedule_range_times.sql` | `schedules.since_time`/`until_time` (intra-day bounds for custom ranges) |
| `0011_schedule_credentials.sql` | `schedules.api_token`/`account_id` (per-schedule customer credentials) |
| `0012_schedule_range_mode_period.sql` | Rebuilds `schedules` to allow `range_mode = 'period'` (SQLite CHECK constraint) + `period` column |
| `0013_schedule_client_logo.sql` | `schedules.client_logo` (per-schedule branding data URI) |

### 3. Worker build and deploy

`npx wrangler deploy` bundles `apps/api/src/index.ts` with esbuild (no
separate build step or config needed) and uploads it together with
`apps/web/dist` as static assets. Current bundle size and startup time:

```
Total Upload: 509.20 KiB / gzip: 108.68 KiB
Worker Startup Time: 13 ms
```

Both are far inside the platform limits (64 MiB uncompressed bundle, 1 s
startup).

### Putting it together

`npm run deploy` → `scripts/deploy.sh` runs all three steps in order:

```bash
npm run build                                          # 1. frontend → apps/web/dist
npx wrangler d1 migrations apply DB --remote --config …  # 2. schema
npx wrangler deploy --config …                          # 3. worker + assets
```

To inspect the Worker bundle without deploying:

```bash
npx wrangler deploy --dry-run --outdir /tmp/out
```

### Type checking

```bash
npm run typecheck    # apps/api (tsc --noEmit) + apps/web (tsc -b)
npm run cf-typegen   # regenerate worker-configuration.d.ts after editing wrangler.toml
```

`worker-configuration.d.ts` is the generated ambient `Env` type (bindings,
vars, secrets). Regenerate it whenever you add or rename a binding, or
TypeScript will not know about it.

---

## Local development

```bash
npm install

# Terminal 1 — Worker API (uses wrangler.toml)
npm run dev:api          # wrangler dev, http://localhost:8787

# Terminal 2 — Vite dev server with hot reload (proxies /api → :8787)
npm run dev:web          # http://localhost:5173
```

Develop against `http://localhost:5173` — Vite proxies `/api` to the Worker
on port 8787 (configured in `apps/web/vite.config.ts`), so the frontend and
API behave as same-origin exactly like production.

Notes:

- `npm run dev:api` is plain `wrangler dev` and therefore reads
  **`wrangler.toml`**, not `wrangler.local.toml`. Only `scripts/deploy.sh`
  prefers the local override. To develop against your own provisioned
  resources, run `npx wrangler dev --config wrangler.local.toml`.
- Workers AI and Email Sending bindings call the real remote services even in
  local dev; D1 and R2 default to local emulation unless you pass `--remote`.
- To serve the built SPA from `wrangler dev` (instead of Vite), run
  `npm run build` first so `apps/web/dist` exists.

---

## Configuration reference

### Vars (`[vars]` in `wrangler.toml`, or the Settings dashboard)

| Name | Required | Default | Purpose |
|---|---|---|---|
| `ENVIRONMENT` | No | `"production"` | Informational; surfaced by `/health` |
| `ALLOWED_ORIGIN` | No | `""` | Extra allowed CORS origins (comma-separated). Only needed if the frontend runs on a **different** origin than the Worker |
| `CF_ACCOUNT_ID` | For scheduled reports | `""` | Account the scheduler and zone picker use. Backend-only — never sent from the browser |
| `EMAIL_FROM` | For scheduled emails | `""` | Sender address; its domain must be onboarded to Email Sending |

### Secrets (`npx wrangler secret put <NAME>`)

| Name | Required | Purpose |
|---|---|---|
| `CF_API_TOKEN` | For scheduled reports | Token the cron job uses to generate reports. Write-only — never readable back out |

Interactive reports need **neither** of these: the user supplies their own
token and account/zone in the form.

### Dashboard-managed settings (D1, no redeploy)

The **Settings** page writes to the `settings` table and takes precedence
over the env var / secret. This lets you rotate the backend token or change
the account without redeploying. The API only ever returns a masked hint
(`••••1234`), never the stored value. See `apps/api/src/services/settings.ts`.

### Precedence

```
D1 settings (dashboard)  >  Worker secret / [vars]  >  unset (feature disabled)
```

---

## Cloudflare API token permissions

Create a token at **My Profile → API Tokens → Create Token → Custom Token**.
"Optional" permissions unlock specific sections; the report renders fine
without them (that section just shows an honest empty state).

### AppSec report

| Permission | Required | Unlocks |
|---|---|---|
| Zone · Zone · Read | ✅ | Zone info, plan, status |
| Zone · Zone Settings · Read | ✅ | All zone settings |
| Zone · Analytics · Read | ✅ | GraphQL Analytics API (most of the report) |
| Zone · Zone Rulesets · Read | ✅ | WAF managed rules |
| Zone · WAF · Read | ✅ | Legacy firewall rules |
| Zone · Bot Management · Read | ✅ | Bot Management config |
| Zone · DDoS Protection · Read | ✅ | DDoS protection ruleset |
| Zone · Firewall Services · Read | ✅ | Firewall rules |
| Zone · DNS · Read | ✅ | DNS record inventory |
| Zone · SSL and Certificates · Read | ✅ | Certificate packs |
| Zone · Cache Rules · Read | ✅ | Cache rules |
| Zone · API Gateway · Read | optional | API Shield section |
| Zone · Page Shield · Read | optional | Page Shield section |
| Account · Account Settings · Read | ✅ | Account info |
| Account · Account Analytics · Read | optional | DNS analytics enrichment |

### Zero Trust report

| Permission | Required | Unlocks |
|---|---|---|
| Account · Zero Trust Read | ✅ | Access apps, policies, auth events |
| Account · Access: Apps and Policies · Read | ✅ | Access application inventory + per-app policy rules |
| Account · Access: Audit Logs · Read | optional | Real seat counts + last-login (`/access/users`) |
| Account · Gateway · Read | ✅ | DNS/HTTP/Network filtering stats, WARP device status |
| Account · Zero Trust Analytics | ✅ | GraphQL: auth events, Gateway, WARP status, bandwidth |
| Account · WARP · Read | optional | Enrolled devices |
| Account · Tunnels · Read | optional | Tunnel status |
| Account · DLP · Read | optional | DLP profiles |
| Account · Zero Trust Read/Write | optional | CASB findings (`/data-security/posture/findings`) |
| Account · Notifications · Read | optional | Recent alert history |
| Account · Account Settings · Read | ✅ | Account name |

### Magic Transit report

Select **Magic Transit**, provide an account-scoped token and account ID, and
generate the report without fetching or choosing a zone.

| Permission | Required | Unlocks |
|---|---|---|
| Account · Account Analytics · Read | ✅ | Network analytics, attack events and tunnel telemetry; product entitlement still applies |
| Account · Magic Transit · Read | optional | GRE/IPsec/CNI tunnels, routes and prefix inventory |
| Account · Account Rulesets · Read | optional | DDoS/Network Firewall entrypoint rules; phase-specific `Magic Firewall Read` or `L4 DDoS Managed Ruleset Read` permissions are also accepted |
| Account · Account Settings · Read | optional | Account display name |

Advanced TCP/DNS configuration requires access to the corresponding protection
feature and its configuration endpoint. A denied or unavailable endpoint is
listed under **Data quality & collection status**; it does not invalidate the
other measurements. Permission references: [GraphQL authentication](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/),
[prefix inventory](https://developers.cloudflare.com/api/resources/addressing/subresources/prefixes/methods/list/),
[entrypoint rulesets](https://developers.cloudflare.com/api/resources/rulesets/subresources/phases/methods/get/).

The collector discovers available fields, retention and query-duration limits
per dataset, splits large query windows and omits incomplete aggregates when
row limits are reached. Each report is capped at 120 upstream requests and four
concurrent requests. Rankings are limited to returned top categories; peaks
are bucket averages. Attack volumes cover event lifetimes, not just the report
period. Probe success is not SLA uptime, and configuration is a current snapshot.

The report prioritizes **top DDoS source IPs/countries and targeted IPs/ports**,
ranked by sampled, selected-period mitigated bytes and packets. These rankings
use DDoS-specific joint dimensions, not general traffic totals or event-lifetime
volumes. Destination applications require explicit mappings and are not inferred
from ports. Older archived reports require regeneration to include these fields.
Evidence lists preview six rows and expand on demand; ranked charts show six
categories. Ranked and inventory tables retain every returned row in offline
HTML and print; detailed hourly/daily tunnel evidence stays excluded from print.

Scheduling uses the same report template, customer credentials, branding and
timezone-aware complete periods as on-demand generation. Apply
`migrations/0014_magic_transit_report.sql` before creating Magic Transit
schedules; this extends the product constraint while retaining existing
schedule fields and send history.

---

## Security

- **Interactive reports**: your API token is sent once per report-generation
  request, held only in memory for that request, and never written to D1,
  R2, or logs. Nothing is stored server-side unless you explicitly click
  "Save to Audit Archive" (which stores the *rendered report HTML*, not the
  token).
- **Scheduled reports**: the token used by the cron job is either a Worker
  secret (`CF_API_TOKEN`, set via `wrangler secret put`, never readable back
  out) or stored in D1 via the Settings dashboard (masked in every API
  response — only a `••••1234`-style hint is ever returned, never the full
  value).
- **API caller authentication**: all Worker `/api/*` routes require a verified
  caller. Set `CF_ACCESS_TEAM_DOMAIN` (hostname only) and `CF_ACCESS_AUD` for
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
  JWT signature/issuer/audience/expiry verification, or set the `MANAGE_SECRET`
  Worker secret and supply `Authorization: Bearer …` from API clients. Missing
  configuration returns 503; missing/invalid credentials return 401. `/health`
  remains available for liveness checks. The Pages proxy forwards the Access
  assertion/cookie to the Worker; the signed assertion authorizes the API call.
- **Access session expiry is handled gracefully**: a `fetch()` redirected to
  the Access login page can never complete the login (the login page is
  cross-origin and sends no CORS headers — the browser blocks it, which
  otherwise surfaces as a cryptic CORS console error). The frontend issues
  API requests with `redirect: "manual"`, detects the opaque-redirect
  response, and navigates to a **cache-busted URL** once per expiry episode
  to re-authenticate — a top-level navigation is the only way to complete
  an Access login, and the cache-bust matters: a plain reload can be
  served from the browser's HTTP cache, which would render the SPA shell
  again without ever hitting the edge. The guard re-arms automatically once
  any API call succeeds (proving the session is valid), so every expiry
  self-heals. If the session is still dead after one automatic attempt, a
  blocking "Log in again" overlay is shown instead — a navigation loop is
  impossible. See `apps/web/src/services/access-reauth.ts`.
- **Rate limiting**: the expensive routes (`/api/appsec`, `/api/zerotrust`,
  `/api/summary`, `/api/zt-summary`, `/api/schedules/:id/send`,
  `/api/settings/test`) are capped at **50 requests / 5 minutes per source
  IP** (in-memory, per-isolate — a coarse guard, not a substitute for
  Access).
- **Never commit resource IDs or tokens**: `wrangler.local.toml` and
  `.env.test` are gitignored. The committed `wrangler.toml` deliberately
  contains no `account_id` or `database_id`.

---

## Performance and platform limits

Measured on a large production Cloudflare One account:

| Aspect | Value | Notes |
|---|---|---|
| Report generation | **~23–30 s** wall, **154 ms** CPU | I/O-bound on ~75–120 upstream Cloudflare API calls, fanned out with `Promise.allSettled` |
| AI executive summary | ~10 s typical, **up to ~113 s** worst case | Model fallback chain; see [AI models](#ai-models) |
| Subrequests per report | ~75–120 | Paid-plan limit is 10,000 — plenty of headroom |
| CPU per report | 154 ms | Paid-plan default limit is 30 s per request |
| Cron invocation | Hourly | Cron Triggers get 15 min wall time, 30 s CPU (<1 h interval) |

**Client timeouts are the real constraint, not Cloudflare's.** A report plus
a worst-case AI summary can exceed two minutes. If you script against the
API, set a generous timeout (`curl --max-time 170` or similar). The
browser UI already handles this with progress state.

Two upstream API constraints worth knowing:

- **Gateway DNS breakdown data has a ~4-week retention wall.** Cloudflare's
  `gatewayResolverQueriesAdaptiveGroups` GraphQL dataset rejects any query
  whose `since` is more than ~4 weeks before *now*, regardless of the
  requested upper bound. Headline DNS totals come from a newer analytics API
  with no such limit, so they stay accurate; only the detailed breakdown
  widgets (top domains, categories, resolver mix, daily trend) can come back
  empty for an older calendar month. The report says so inline via
  `dataConfidence` rather than rendering a misleading blank chart.
- **`/devices?per_page=500` is intermittently flaky on large fleets.** Device
  counts fall back through REST `total_count` → GraphQL
  `warpLatestStatus.total` → DNS analytics `uniqueDeviceCount`, taking the
  maximum.

---

## Scheduled email reports

An hourly cron (`[triggers]` in `wrangler.toml`) checks for due schedules,
generates the report with the backend-bound token, writes a Workers AI
executive summary, renders an email-safe HTML digest, and sends it via the
Email Sending binding. Everything is configured from the **Scheduled
Reports** dashboard — report type, zone/account, timeframe, cadence,
recipients, subject, and an optional custom message.

- **Cadence**: daily / weekly / monthly, evaluated in the schedule's
  captured timezone. A 90-minute grace window after the intended send time
  doubles as catch-up if a cron event is missed.
- **Timeframe**: a rolling window (1/3/5/7/14/30 days), **the last complete
  period** (Daily = yesterday 00:00:00–23:59:59 local, Weekly = previous
  Monday–Sunday, Monthly = previous calendar month — computed at send time
  so it never goes stale), **any of the last 12 calendar months** (with its
  real 28–31 day count and a proper period label like "August 2026"), or
  **an exact custom range** — start/end dates up to 366 days apart plus
  optional HH:MM times (e.g. "Sep 1 09:00 → Sep 3 17:30"), interpreted in
  the schedule's timezone.
- **Client branding**: each schedule can carry the customer's logo (data
  URI, ≤2MB PNG/JPG/SVG/WebP) alongside the client name — rendered on the
  email digest cover AND the attached on-demand report, matching the
  on-demand form's cover. Same validation as the interactive builder. Every adaptive-dataset
  section follows the exact window (local days + intra-day bounds); only
  the daily-overview and error charts (1dGroups, whole days by dataset
  design) don't — they switch to exact hourly buckets for ≤1-day windows.
  Prefer a calendar month for monthly schedules — a fixed 30-day window
  silently drifts against real month boundaries.
- **Double-send guard**: an atomic `last_run_at` claim (compared against the
  intended occurrence, not wall-clock time) prevents duplicate sends.
- **"Send test now"**: generates and sends immediately, recorded as a
  `manual` run in history — use this to verify recipients/formatting before
  trusting the cron.
- **Full report attached — the on-demand report itself**: every scheduled
  email carries the complete report as a standalone `.html` attachment.
  The Worker can't execute the React app, but an attachment opens in the
  recipient's browser, which can: the attachment is the single-chunk build
  of the web app (vite.static.config.ts) plus the run's report data inlined
  as `window.__EMBEDDED_REPORT__`, and on open it renders the exact same
  report the on-demand page renders — same components, same recharts charts,
  same styling, with the AI summary generated at send time and no network
  access. Assembled from the Worker's own `ASSETS` binding (deterministic
  `static-report/app.js|css` names, `</script>` sequences defused, JSON
  `<` escaped); falls back to a server-rendered full-report HTML when the
  static bundle isn't deployed. The email body stays the compact email-safe
  digest, since email clients strip `<style>` and JS. Assets are self-contained
  too — imported images like the Cloudflare logo are inlined as data URIs
  (assetsInlineLimit), so the attachment renders identically offline with no
  external URLs.
- **Archive**: every scheduled send's embedded on-demand report AND digest are snapshotted
  to the R2 audit bucket under `scheduled/` (the full report as the primary
  artifact, `-full` suffix).
- See `apps/api/src/scheduler.ts` for the full implementation.

---

## AI models

Executive summaries use a three-tier Workers AI fallback chain, since large
reasoning models can occasionally exhaust their token budget mid-thought
before writing any output (`finish_reason: "length"`, empty content) —
confirmed live, non-deterministically, on prompts built from larger real
reports:

1. `@cf/zai-org/glm-5.3-flash` (primary, `max_tokens: 3000`)
2. `@cf/openai/gpt-oss-120b` (fallback, `max_tokens: 3000`)
3. `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (final fallback, `max_tokens: 2000`)

A response shorter than a real 5-paragraph summary (`MIN_VALID_SUMMARY_LENGTH
= 300` chars) is treated as a failure and the next model is tried. In the rare
case all three fail, report generation still succeeds — only the executive
summary is omitted (or, in the UI, shown as an explicit "AI summary
unavailable" error rather than silently blank).

This chain is not theoretical. A logged real run:

```
[AI] @cf/zai-org/glm-5.3-flash returned empty/truncated (0 chars): finish_reason "length"
[AI] @cf/openai/gpt-oss-120b returned empty/truncated (0 chars): finish_reason "length"
→ @cf/meta/llama-3.3-70b-instruct-fp8-fast produced a 490-word summary
```

Both reasoning models spent their entire budget on `reasoning_content` and
emitted no answer; the third model delivered. Total wall time 113 s. This is
expected behavior, not a hang — and it is why the chain exists.

---

## API reference

All routes are `POST` unless noted. Rate-limited routes are marked ⏱
(50 req / 5 min / IP).

### Reports

| Route | Purpose |
|---|---|
| `POST /api/zones` | List zones for a token (lightweight, not rate limited) |
| `POST /api/appsec` ⏱ | Generate AppSec report data for a zone |
| `POST /api/zerotrust` ⏱ | Generate Zero Trust report data for an account |
| `POST /api/magic-transit` ⏱ | Generate Magic Transit report data for an account |
| `POST /api/summary` ⏱ | AI executive summary for an AppSec report |
| `POST /api/zt-summary` ⏱ | AI executive summary for a Zero Trust report |
| `POST /api/mt-summary` ⏱ | AI executive summary for a Magic Transit report |

Report requests accept `{ token, accountId | zoneId, days?, rangeMode?, tzOffset?,
monthsAgo?, period?, sinceDate?, untilDate?, sinceTime?, untilTime?, isPoc? }`
where `rangeMode` is `"rolling"` (default), `"calendar_month"` (+ optional
`monthsAgo` 1–12), `"custom"` (+ `sinceDate`/`untilDate`, local YYYY-MM-DD,
inclusive, span 1–366 days; + optional `sinceTime`/`untilTime`, HH:MM local,
defaults 00:00 / 23:59 with the end minute inclusive), or `"period"` (+
`period`: `"yesterday"` / `"last_week"` / `"last_month"` — the most recent
COMPLETE period in `tzOffset`'s timezone, computed at run time: a daily
schedule reports exactly yesterday 00:00:00–23:59:59 local, weekly reports
the previous Monday–Sunday, monthly the previous calendar month with its
real 28–31 days).

Every section aligns with that window to the extent its dataset allows:
request-level breakdowns (TLS key-exchange/PQC, WAF rules/series, bots, AI
crawlers, API traffic, DNS analytics, countries, browsers, status codes,
content types, top IPs/ASNs/UA fingerprints, … — the `*AdaptiveGroups`
datasets, sampled the same way Cloudflare's own dashboard samples them)
filter by the exact `sinceTs`/`untilTs` instants, so they honor
timezone-shifted local days and intra-day HH:MM bounds. Only the two chart
datasets that are pre-aggregated into whole days keep date semantics: the
daily overview and its error series (`httpRequests1dGroups`); they switch
to hourly (exact) for windows of one day or less. Country "threats" come
from the firewall-events dataset (action ≠ allow) and the browser breakdown
counts requests (`userAgentBrowser`) rather than the old `browserMap`
pageViews. Cloudflare retains adaptive (fine-grained) data only ~30 days
back; older ranges keep accurate daily totals but per-request sections come
back empty (each shows its own upstream error).

### Scheduled report credentials (multi-customer)

`POST`/`PUT /api/schedules` accept two optional fields:

- `apiToken` — a Cloudflare API token scoped to a **customer's** account.
  Write-only: stored in D1 (`schedules.api_token`), never returned by the API
  (a masked hint `apiTokenHint` + `apiTokenSet` flag are returned instead).
  On `PUT`, omitting the field keeps the stored token; `null` clears it back
  to the backend credentials; a string sets/replaces it.
- `accountId` — the customer's Cloudflare account ID (needed for Zero Trust
  reports and account-level AppSec queries).

At send time the scheduler resolves credentials per schedule: the schedule's
own token/account if set, otherwise the backend credentials (Settings → D1 →
`CF_API_TOKEN` secret / `CF_ACCOUNT_ID` var). One deployment can therefore
run reports for many customers, each with least-privilege credentials —
recommended token scopes are the same as the backend token's, on the
customer's account only. `POST /api/settings/test` also accepts
`{ cfApiToken, cfAccountId }` to validate candidate credentials without
saving them, and `POST /api/schedule/zones` lists a customer's zones with
their token before you save it.

### Finding registers (D1-backed lifecycle tracking)

| Route | Purpose |
|---|---|
| `GET /api/remediation` · `PATCH /api/remediation/:id` | Remediation register — status, owner |
| `GET /api/casb-findings` · `PATCH /api/casb-findings/:id` | CASB / Data Security Posture findings |
| `GET /api/alert-register` · `PATCH /api/alert-register/:id` | Alert investigation workflow |

### Audit archive (R2)

| Route | Purpose |
|---|---|
| `POST /api/audit` | Save a rendered report |
| `GET /api/audit` | List archived reports |
| `GET /api/audit/:key` | Fetch one archived report |

### Scheduled reports (D1)

| Route | Purpose |
|---|---|
| `GET\|POST /api/schedule/zones` | Zone picker — GET uses backend credentials; POST accepts `{ apiToken, accountId }` (customer-scoped, multi-customer) |
| `GET /api/schedules` · `POST /api/schedules` | List / create |
| `PUT /api/schedules/:id` · `DELETE /api/schedules/:id` | Update / delete |
| `POST /api/schedules/:id/send` ⏱ | Send test now (full report generation) |
| `GET /api/schedules/:id/history` | Run history |

### Settings and meta

| Route | Purpose |
|---|---|
| `GET /api/settings` · `PUT /api/settings` | Backend token/account (always masked on read) |
| `POST /api/settings/test` ⏱ | Validate settings against the real Cloudflare API |
| `GET /api/me` | Cloudflare Access identity, for attribution only |
| `GET /health` | Liveness — `{ ok, version, env }` |

---

## Data sources and honesty guarantees

Every chart is backed by a real Cloudflare GraphQL Analytics dataset, REST
endpoint, or analytics API — documented inline in the source next to every
fetcher (`apps/api/src/services/`). The project holds itself to three rules:

1. **No fabricated numbers.** Where a metric genuinely cannot be sourced from
   a real Cloudflare API, the report renders an honest empty state instead of
   a plausible-looking value.
2. **Dashboard parity.** Headline KPIs are sourced from the same endpoints
   Cloudflare's own dashboard uses (`apps/api/src/services/cf-dashboard-analytics.ts`),
   so the report's numbers match what the customer sees when they log in. For
   example, WARP client session events and service-token validations are
   excluded from "authentication events" (and surfaced separately) rather than
   inflating the headline.
3. **Explicit uncertainty.** When an upstream API limit degrades a section, a
   `dataConfidence` note explains exactly why — see the DNS breakdown
   retention wall in [Performance and platform limits](#performance-and-platform-limits).

Each `/analytics/query/*` call fails soft to the older GraphQL/REST source,
so a breaking upstream change degrades a section rather than breaking the
report.

---

## Alternative: separate Pages frontend

If you'd rather deploy the frontend as its own Cloudflare Pages project
(e.g. to put it on a different custom domain than the Worker), the
`apps/web/functions/api/[[path]].ts` reverse-proxy Function is included for
exactly that:

```bash
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name=your-project-name
```

Then set `API_WORKER_URL` as a **Pages environment variable** (dashboard →
Settings → Environment variables) pointing at your deployed Worker's URL. In
this topology, also set `ALLOWED_ORIGIN` in the Worker's `wrangler.toml` to
your Pages URL so CORS allows it.

---

## Project structure

```
apps/api/                  Cloudflare Worker (Hono) — all report generation logic
  src/index.ts               Route table + rate limiting + CORS
  src/routes/                HTTP handlers (appsec, zerotrust, summaries, schedules,
                             settings, audit, registers)
  src/services/              GraphQL/REST/analytics fetchers per Cloudflare product area
    cf-graphql.ts              Zone GraphQL analytics + date-range helpers
    cf-zerotrust-graphql.ts    Zero Trust GraphQL datasets
    cf-dashboard-analytics.ts  Dashboard-exact /analytics/query/* endpoints
    cf-rest.ts                 REST config/inventory fetchers
    email-template.ts          Email-safe HTML digest renderer
  src/scheduler.ts           Cron entrypoint + email digest runner
apps/web/                  React + Vite frontend
  src/pages/                 Report pages + input forms
  src/pages/sections/        AppSec report sections
  src/pages/zt-sections/     Zero Trust report sections
  src/utils/formatters.ts    Number/rate formatting (e.g. non-misleading small %)
  functions/                 Optional Pages Function (see Alternative topology above)
migrations/                D1 schema — see the migrations table above
wrangler.toml              Public deploy template (no resource IDs — auto-provisioned)
wrangler.local.example.toml  Template for your own gitignored wrangler.local.toml
scripts/deploy.sh          Build → migrate → deploy
tests/e2e/                 Playwright end-to-end tests
```

---

## Testing

```bash
npm run typecheck       # tsc --noEmit (api) + tsc -b (web)
npm run test:e2e        # Playwright — see tests/e2e/
npm run test:e2e:ui     # interactive runner
npm run test:e2e:report # open the last HTML report
```

Live/browser E2E tests need real credentials in `.env.test` (copy from
`.env.test.example` — never committed).

The isolated Magic Transit suite uses synthetic documentation addresses,
mocked upstream services and an in-memory SQLite database. It never loads
`.env.test` or sends email. Browser tests exercise the **built** attachment:

```bash
npm run build
npx playwright install chromium
npm run test:magic-transit
# Or use an already-installed Chrome:
PLAYWRIGHT_CHANNEL=chrome npm run test:magic-transit
```

The migration tests use Node's `node:sqlite` module (Node 22.13+). The suite
covers range/overlap math, partial failures, query budgets, credential omission,
schedule dispatch/CRUD, schema preservation, offline HTML, WebGL fallback,
mobile overflow and print/PDF.

`live.spec.ts` is skipped by default. To explicitly validate a live account,
provide `MT_LIVE_API_TOKEN` and `MT_LIVE_ACCOUNT_ID` through your shell environment
and run `npm run test:magic-transit -- live.spec.ts`. This read-only check reports
aggregate availability and independently verifies probe-status counts; it
does not persist credentials or report data, modify schedules, or send email.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Worker exceeded resource limits` (Error 1102) | You are on the Workers **Free** plan (10 ms CPU / 50 subrequests). This app needs Workers Paid — see [Why Workers Paid is required](#why-workers-paid-is-required) |
| Report request times out in your client | Generation takes ~30 s, and a worst-case AI summary up to ~113 s. Raise your client timeout (`curl --max-time 170`) |
| AI summary missing or "unavailable" | All three models failed, or Workers AI's 10,000 Neurons/day allowance is exhausted. The report itself still generates |
| `403` / error 5035 from Workers AI | `@cf/zai-org/glm-5.3-flash` requires paid billing. Upgrade to Workers Paid or use AI Gateway credits |
| A report section is empty | Usually a missing optional token permission — check the [permission tables](#cloudflare-api-token-permissions). Empty states are deliberate, never faked |
| DNS breakdown charts empty on a "Last Month" report | Expected: Cloudflare's DNS breakdown GraphQL dataset only retains ~4 weeks. Headline DNS totals are still accurate. See the `dataConfidence` note in the report |
| Scheduled reports never send | Check `CF_API_TOKEN` (or Settings), `CF_ACCOUNT_ID`, `EMAIL_FROM`, that the sending domain is onboarded, and the schedule's run history for the recorded error |
| API calls fail with a CORS error mentioning `cloudflareaccess.com` | Your Cloudflare Access session expired. A `fetch()` can't complete an Access login, so the app detects the redirect and re-navigates through the Access login automatically (cache-busted, once per expiry episode); if the session is still invalid it shows a blocking "Log in again" overlay instead. If it persists, check the Access application's policy in the Zero Trust dashboard |
| `wrangler dev` ignores my D1 database | `npm run dev:api` reads `wrangler.toml`. Use `npx wrangler dev --config wrangler.local.toml` |
| Deploy fails on missing `database_id` | Run `npx wrangler d1 create poc-report-schedules` and put the ID in `wrangler.local.toml` |
| TypeScript doesn't know a new binding | Run `npm run cf-typegen` to regenerate `worker-configuration.d.ts` |

---

## License

MIT — see [LICENSE](LICENSE). Contributions and forks welcome.
