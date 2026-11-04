# Custom Dashboard reports

The **Custom Dashboard** report option supports fresh API-token analytics,
reusable widget templates and fully automated scheduled PDF/HTML delivery.
It also supports local snapshot imports. Select **Load synthetic example**
to try the report/export flow without a token or customer data.

## API-token workflow

1. Select **Custom Dashboard**. Enter an analytics API token, account ID and
   zone ID in the application's form, plus an optional scope label.
2. Choose a complete reporting period. Open **Configure live query widgets**
   to set the title, exact hostname/path filters, widget datasets, metrics,
   chart types and order. Add/remove widgets as needed.
3. Select **Fetch fresh analytics**, then **Build report**. Preview edits change
   this snapshot only; the reusable query template drives future executions.
4. Use **Save query template** to download the configuration without credentials
   or analytics rows. It can be imported into Scheduled Reports.

### Saved-dashboard selector (upstream API access required)

Both the preview and schedule forms include **Select dashboard → Dashboard source
→ Cloudflare saved dashboard**. Choose account or selected-zone scope, click
**Load saved dashboards**, and select a returned dashboard. The connector is
implemented, but successful real discovery remains blocked by the upstream API
access described under [Current integration boundary](#current-integration-boundary).
An upstream failure is displayed as an error, never as an empty dashboard list.

The authenticated, rate-limited `POST /api/custom-dashboard/dashboards` route uses
the supplied credentials, existing write-only schedule credentials when editing,
or backend credentials. It only requests Cloudflare's API host, refuses redirects,
and bounds response size/time. No dashboard cookies or browser session are used.
Credentials are not included in the returned dashboard options.

Only wholly representable definitions are selectable for generation: supported
datasets with unfiltered single-count/response-bytes stat, single-series hourly
time-series, or supported Top-N charts. Unsupported charts, filters, extra query
settings, and multi-series definitions block generation rather than silently
dropping settings or substituting the default template. Reports remain scoped to
the selected zone, including when choosing an account dashboard.

The selection's ID/account/scope and normalized widget configuration are retained
in the query template. Edits restore the stored selection without exposing its
token. Credential/scope changes invalidate loaded choices, and late responses from
an earlier context are ignored. Scheduled runs query fresh measurements using
the stored configuration; later Cloudflare configuration edits require an explicit
reload and reselection. They are not silently synchronized during cron runs.

For the GraphQL token, follow Cloudflare's
[Analytics API token guide](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)
(**Account → Account Analytics → Read**, scoped to the intended resources).
Add **Zone → Zone → Read** if using the zone-list picker. Dataset entitlement,
retention and query-duration limits still depend on the zone's plan.

The preview calls `POST /api/custom-dashboard` behind the existing API caller
gate and rate limiter. Its token is used for this request, then cleared from
the preview form after success; credentials are never included in snapshots,
query-template exports, email bodies or report attachments.

## Fully automated delivery

### One-time operator setup

- Apply migration `migrations/0015_custom_dashboard_report.sql` after the earlier
  migrations. It preserves existing schedule fields and send history.
- Build/deploy the normal frontend and static-report assets (`npm run build`).
  The scheduler uses that bundled renderer for charts and evidence tables.
- Configure the existing D1, R2, EMAIL and hourly cron setup described in
  [Scheduled email reports](README.md#scheduled-email-reports).
- Keep the **BROWSER** binding from `wrangler.toml` (or the local override).
  [Cloudflare Puppeteer](https://developers.cloudflare.com/browser-run/puppeteer/)
  renders the inline report HTML through this binding, without a separate PDF
  API token or dashboard login. Each session closes after rendering, including
  failed runs. Browser Run usage and account quotas apply separately from
  analytics and email; the browser runs in the Worker's account.
- For deployments without the binding, the optional REST fallback accepts Worker
  secrets **PDF_API_TOKEN** and **PDF_ACCOUNT_ID**, set using `wrangler secret put`.
  These are operator-owned credentials, separate from customer analytics. The
  token needs **Browser Run - Edit** for the
  [PDF REST endpoint](https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/).
- Configure the interactive API gate with **CF_ACCESS_TEAM_DOMAIN** (hostname
  only) and **CF_ACCESS_AUD** from the existing Access application, or a Worker
  secret **MANAGE_SECRET** for API clients supplying `Authorization: Bearer …`.
  Access JWT signatures, issuer, audience and expiry are verified. Missing gate
  configuration fails closed. Cron runs do not need an interactive Access token.

### Configure a dashboard schedule

1. Open **Scheduled Reports → New Schedule → Custom Dashboard**.
2. Configure or import the query template. Select a zone, or enter its zone ID
   and label manually (a zone-list permission is unnecessary for manual entry).
3. Set the customer's API token/account once, or use the existing backend
   credentials from Settings / `CF_API_TOKEN` + `CF_ACCOUNT_ID`.
4. Choose the reporting window, delivery cadence, send time, recipients, subject
   and message. Complete periods such as **Yesterday** are recomputed in the
   schedule's timezone on every run. An explicit custom date range stays fixed.
5. Save the schedule. Scheduled runs query fresh analytics, generate a PDF,
   and email it alongside a self-contained HTML report. The artifacts are
   archived in R2 and the run outcome is written to the existing send history.

Schedule tokens are write-only through the API: reads return a masked hint;
edits with the token omitted retain it. Query templates contain configuration,
not stale report rows. No HAR, Cloudflare dashboard cookie or interactive login
is required when cron runs. The app's interactive management API still uses
its normal caller authentication.

Partial widget failures remain visible with coverage notes and unavailable
values. If all analytics queries fail, the renderer bundle is missing, PDF setup
is absent, or PDF generation fails, the run records an error rather than sending
a blank or HTML-only success. Customer analytics tokens are not passed to the
PDF renderer; external resource requests are blocked while rendering.

### Supported live queries

- `httpRequestsAdaptiveGroups`: `count`, `sum.edgeResponseBytes`; aggregate,
  hourly/daily, country, path, hostname, status, cache status and client IP.
- `firewallEventsAdaptiveGroups`: `count`; aggregate, hourly/daily, action,
  source, country, IP, hostname, path and rule ID.

Use 1–12 widgets. Queries run with at most three concurrent requests; aggregate
widgets request one row, Top-N requests 25 rows, and time-series/tables request
up to 2,500 rows. Responses are capped at 2 MB per query and a 6 MB report
response budget. A reached row limit is explicitly reported. No pagination or
automatic retention-window splitting is performed. Reduce the interval if the
zone rejects it. PDF responses are capped at 8 MB.

Values are sampled analytics as returned, with explicit units and no additional
rescaling. Filters are exact hostname/path matches and apply to every widget.
Unsupported schema fields, raw GraphQL and arbitrary upstream URLs cannot be
stored in a template. The editor exports the versioned
`cloudflare-custom-dashboard-template/v1` format; the API validates it on every
save and execution.

## Local snapshot workflow

1. Select **Custom Dashboard → Import JSON / HAR**, or paste JSON.
2. Set the report title, scope, observation interval and timezone. The optional
   dashboard URL is a source reference; its query string and fragment are removed.
3. Include the desired widgets and arrange their order. Set titles, chart types,
   numeric metrics, dimensions/timestamps and units explicitly.
4. Select **Build report**.
5. Use **Save PDF** and choose the browser's **Save as PDF** destination, or use
   **Save HTML** for a script-free, standalone report. Enable background graphics
   for the colored bars. **Save snapshot** downloads the selected widgets and
   mappings as JSON for later import.

Locally imported report data is not sent to the API, AI, R2, email or schedules. The normal app
still performs its existing identity/session request. Imported HAR headers,
cookies, request payloads and raw GraphQL error messages are not retained in
the normalized report. Response data can itself contain sensitive identifiers;
treat exported reports and snapshots according to their content.

## Accepted inputs

- A snapshot in the `cloudflare-custom-dashboard/v1` format below.
- A GraphQL JSON response containing datasets under
  `data.viewer.zones[]` or `data.viewer.accounts[]`.
- A HAR with response bodies for HTTPS GraphQL requests to
  `dash.cloudflare.com` or `api.cloudflare.com`. Base64 response content is supported.

For a HAR, capture only the dashboard load and include response content. Refer
to Cloudflare's [dashboard query capture tutorial](https://developers.cloudflare.com/analytics/graphql-api/tutorials/capture-graphql-queries-from-dashboard/).

HAR/GraphQL imports extract datasets by response alias, **not saved widget
configuration**. A response alias is a starting title, not necessarily the chart
name in Cloudflare. Verify titles, metrics, units and order. Multiple requests
may contain repeated datasets; exclude duplicates. Neither the selected interval
nor capture time is inferred from request variables or capture timestamps.

Logs/Observability, non-GraphQL widgets, batched GraphQL responses and datasets
with nested arrays need an explicit snapshot mapping. Unsupported datasets and
partial GraphQL errors are identified in import notes, which remain visible in
the exported report. Unsupported data is never presented as zero.

## Snapshot format

All values below are invented examples. Row keys are flat; dot-separated keys
from imported GraphQL responses are literal column names.

```json
{
  "format": "cloudflare-custom-dashboard/v1",
  "title": "Synthetic traffic overview",
  "zoneName": "example.com",
  "dashboardUrl": "",
  "period": "2026-09-01 00:00–02:00 UTC",
  "capturedAt": "2026-09-01T02:05:00Z",
  "notes": "SYNTHETIC EXAMPLE — invented data, not a customer report.",
  "warnings": [],
  "widgets": [
    {
      "id": "total",
      "title": "Requests",
      "type": "stat",
      "metric": "requests",
      "dimension": "",
      "unit": "requests",
      "note": "Full selected interval; sampled estimate",
      "rows": [{ "requests": 3000 }]
    },
    {
      "id": "trend",
      "title": "Requests over time",
      "type": "timeseries",
      "metric": "requests",
      "dimension": "timestamp",
      "unit": "requests",
      "note": "Hourly buckets",
      "rows": [
        { "timestamp": "2026-09-01T00:00:00Z", "requests": 1000 },
        { "timestamp": "2026-09-01T01:00:00Z", "requests": 2000 }
      ]
    }
  ]
}
```

Supported chart types are `stat`, `timeseries`, `top-n` and `table`. Cells are
finite numbers, strings, booleans or null. Maximum import size: 20 MB;
100 widgets; 5,000 rows and 80 columns per widget. Oversized/unsupported
HAR datasets are identified rather than silently truncated.

## Data and export behavior

- Stat cards require exactly one aggregate row. Averages, rates, percentiles,
  rankings and time buckets are never automatically added together.
- Time-series charts require at least two unique ISO timestamps with a timezone
  (or UTC date-only values), one row per timestamp. Duplicate times, invalid dates
  or multiple series fall back to visible evidence with an explanation. Explicit
  null observations break the line; timestamps are plotted on a real time axis.
- Top-N charts show up to ten returned rows by the chosen numeric metric, with
  full returned evidence below. These rankings are not population totals.
- Missing/null values remain unavailable; a returned numeric zero remains zero.
- Units and percentage scales are explicit. A fractional ratio is not silently
  multiplied by 100, and bits are not silently converted to bytes.
- On screen, evidence tables scroll within a compact panel. Printing reveals
  all returned rows and uses a named A4 page style with a repeating scope/interval
  header. Charts are SVG. **Save HTML** captures a script-free report; scheduled
  HTML includes the inline application renderer and embedded data, works offline,
  and does not refresh data when opened. The PDF is already rendered before email.

## Current integration boundary

The URL is a reference, not a saved-widget import. As of 2026-10-19, a supported
public API for listing and reading Cloudflare's saved custom dashboard definitions
is an upstream dependency. The public request for dashboard API/CLI support is
tracked in [cloudflare/cf#195](https://github.com/cloudflare/cf/issues/195).
An active account token with successful account access did not produce a dashboard
list: the account listing route returned HTTP 500 on retry, and the dashboard-host
route rejected token authentication. These failures must not be treated as an empty
dashboard list or replaced with synthetic dashboard choices.

The required browser-less flow is: list saved dashboards through a supported API,
select one, read its chart definitions, validate/map supported configurations, then
query fresh analytics and render PDF/HTML. Live use of the saved-dashboard selector
is blocked until the list/read API supports token callers. Dashboard session cookies, HAR
capture and a signed-in browser import are not part of this integration.

Live reports use this application's explicitly configured, allowlisted query
templates. They do not promise exact saved-dashboard replication, arbitrary
dataset support, or an AI narrative. A dashboard PDF is a useful visual reference
but does not contain query definitions or raw data. Optional configuration/query
captures can help validate an exact mapping; they are not needed for automation.

## Animated offline report presenter

Custom Dashboard previews, **Save HTML** downloads and scheduled HTML attachments
include a locally bundled Three.js humanoid droid. Press **Play read-out** to hear
the scope, observation interval, coverage notes and widget highlights. The droid
moves its mouth and gestures while speaking, highlights the current widget, and
provides pause/resume, previous/next, stop, local voice and speed controls.

Speech uses only browser voices marked `localService`; no report text is sent to
an application speech endpoint. A device-local system voice must be installed;
remote browser voices are excluded. Browser/OS support varies. If speech or WebGL
is unavailable, the report and captions remain readable. Speech is opt-in, never
autoplays. Mouth motion is approximate, not phoneme-aligned lip sync.

Narration is deterministic, not an AI assessment: it reads returned values,
explicit notes and rankings without inventing totals or treating missing data as
zero. The presenter is omitted from print/PDF. Interactive HTML embeds the trusted
application bundle and a data-only report snapshot under a no-network CSP; tokens
and editor state are not embedded. Other report types retain their existing export
behavior. These changes do not enable the blocked upstream saved-dashboard API.

## Verification

```bash
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:custom-dashboard
```

The suite uses synthetic data and mocked upstreams only. It covers imports,
token-based preview, query validation/limits, fresh timezone-aware periods,
migration preservation, schedule CRUD and pause/edit credential retention,
scheduled PDF/HTML delivery and failure history, null/zero handling,
widget selection/reordering, saved-dashboard normalization, source-scope checks,
selector failures and credential-change races, stored selection restoration,
offline/mobile HTML and real browser PDF rendering.
Cloudflare analytics/PDF transport is mocked; no live emails or API calls occur.
