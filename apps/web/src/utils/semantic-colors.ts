/**
 * Semantic color system for the Cloudflare POC Report.
 *
 * Principle:
 *   🔴 RED/DARK   = bad, negative, attack, malicious, error, blocked, threat
 *   🟢 GREEN      = good, allowed, clean, cached, success, human, pass
 *   🔵 BLUE       = neutral, informational, total counts, in-progress
 *   🟠 ORANGE     = Cloudflare brand, warnings, challenges, medium-risk
 *   ⚫ GRAY       = skipped, unknown, DNS-only, inactive, low-priority
 *   🟣 PURPLE     = bot-related (automated but not necessarily malicious)
 */

// ── Core semantic tokens ────────────────────────────────────────────────────

export const COLORS = {
  // Bad / Negative / Attack / Error
  bad:          "#DC2626",   // red-700 — hard blocks, 5xx errors, attacks
  badMedium:    "#EF4444",   // red-500 — warnings, 4xx errors
  badLight:     "#FCA5A5",   // red-300 — mild errors

  // Good / Positive / Allowed / Success
  good:         "#16A34A",   // green-700 — cache hits, 2xx success, allowed
  goodMedium:   "#22C55E",   // green-500 — positive metrics
  goodLight:    "#86EFAC",   // green-300 — clean/low-risk

  // Neutral / Informational / Total
  neutral:      "#2563EB",   // blue-600 — total requests, general data
  neutralMedium:"#3B82F6",   // blue-500 — neutral counts
  neutralLight: "#93C5FD",   // blue-300 — background fills

  // Warning / Challenge / Medium-risk / Cloudflare brand
  warning:      "#D97706",   // amber-600 — challenges, managed challenges
  warningMedium:"#F59E0B",   // amber-500 — medium priority
  warningLight: "#FDE68A",   // amber-200 — light warnings

  // Cloudflare Brand
  cfOrange:     "#F6821F",   // Tangerine — primary accent
  cfOrangeDark: "#FF6633",   // Ruby — hover/emphasis
  cfOrangeLight:"#FBAD41",   // Mango — light accent

  // Bot / Automated (not inherently malicious)
  bot:          "#7C3AED",   // violet-700 — verified bots
  botMedium:    "#8B5CF6",   // violet-500 — likely bots
  botLight:     "#C4B5FD",   // violet-300 — low bot score

  // Skip / Unknown / Inactive / Low priority
  skip:         "#6B7280",   // gray-500 — skipped events
  unknown:      "#9CA3AF",   // gray-400 — unknown/unclassified
  inactive:     "#D1D5DB",   // gray-300 — disabled/inactive

  // DDoS specific (darker red — most severe)
  ddos:         "#991B1B",   // red-800 — DDoS attacks
  ddosMedium:   "#B91C1C",   // red-700

  // Cloudflare protection (proxied = safe = orange)
  proxied:      "#F6821F",   // Cloudflare proxied
  dnsOnly:      "#9CA3AF",   // DNS-only (unprotected)
} as const;

// ── WAF Action Colors ────────────────────────────────────────────────────────
export const WAF_ACTION_COLORS: Record<string, string> = {
  block:              COLORS.bad,         // hard block = darkest red
  managed_challenge:  COLORS.warning,     // managed challenge = amber
  challenge:          COLORS.warningMedium, // JS challenge = lighter amber
  log:                COLORS.neutralMedium, // logged only = blue
  skip:               COLORS.skip,        // skip = gray
  allow:              COLORS.good,        // explicit allow = green
};

// WAF action badge styles (bg + text + border)
export const WAF_ACTION_BADGE: Record<string, string> = {
  block:              "bg-red-50 text-red-700 border-red-200",
  managed_challenge:  "bg-amber-50 text-amber-700 border-amber-200",
  challenge:          "bg-yellow-50 text-yellow-700 border-yellow-200",
  log:                "bg-blue-50 text-blue-700 border-blue-200",
  skip:               "bg-gray-50 text-gray-600 border-gray-200",
  allow:              "bg-green-50 text-green-700 border-green-200",
};

// ── HTTP Status Colors ───────────────────────────────────────────────────────
export const HTTP_STATUS_COLORS = {
  e1xx: COLORS.neutralLight,   // 1xx Informational — blue-light
  e2xx: COLORS.good,           // 2xx Success — green
  e3xx: COLORS.neutralMedium,  // 3xx Redirect — blue (neutral)
  e4xx: COLORS.badMedium,      // 4xx Client Error — red
  e5xx: COLORS.bad,            // 5xx Server Error — darkest red
} as const;

// ── Cache Status Colors ──────────────────────────────────────────────────────
export const CACHE_STATUS_COLORS: Record<string, string> = {
  hit:           COLORS.good,          // cache hit = green (good, saves origin)
  stale:         COLORS.goodLight,     // stale = light green (still served from edge)
  updating:      COLORS.goodLight,
  revalidated:   COLORS.goodMedium,
  expired:       COLORS.warningMedium, // expired = amber (needs revalidation)
  miss:          COLORS.warningLight,  // miss = light amber (origin needed)
  bypass:        COLORS.badLight,      // bypass = light red (cache disabled)
  dynamic:       COLORS.badLight,
  none:          COLORS.skip,          // not cacheable = gray
  unknown:       COLORS.unknown,
};

// ── Bot Score Colors ─────────────────────────────────────────────────────────
export const BOT_SCORE_COLORS = {
  verified:      COLORS.good,          // verified bots (Google, Bing) = green
  human:         COLORS.neutralMedium, // human traffic = blue (neutral/good)
  likelyBot:     COLORS.botMedium,     // likely bot = purple
  bot:           COLORS.bad,           // definite bot/scraper = red
} as const;

// ── Security Event Colors ────────────────────────────────────────────────────
export const SECURITY_EVENT_COLORS = {
  waf:           COLORS.cfOrange,      // WAF events = CF orange
  ddos:          COLORS.ddos,          // DDoS = darkest red
  botBlock:      COLORS.bot,           // bot blocked = purple
  rateLimit:     COLORS.botMedium,     // rate limited = lighter purple
  apiShield:     COLORS.good,          // API Shield = green
  threat:        COLORS.bad,           // generic threat = red
} as const;

// ── DNS Record Type Colors ───────────────────────────────────────────────────
export const DNS_TYPE_COLORS: Record<string, string> = {
  A:     COLORS.neutralMedium,  // A record = blue
  AAAA:  COLORS.botMedium,      // AAAA = purple
  CNAME: COLORS.good,           // CNAME = green
  MX:    COLORS.warningMedium,  // MX = amber (email)
  TXT:   COLORS.skip,           // TXT = gray
  NS:    COLORS.cfOrange,       // NS = CF orange
  SRV:   "#00B0D1",             // SRV = teal
  CAA:   COLORS.bad,            // CAA = red (security record)
};

// ── Priority Colors ──────────────────────────────────────────────────────────
export const PRIORITY_COLORS = {
  high:   { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
  medium: { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  low:    { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
} as const;

// ── Email Auth Colors ────────────────────────────────────────────────────────
export const EMAIL_AUTH_COLORS = {
  pass:       COLORS.good,
  fail:       COLORS.bad,
  softfail:   COLORS.warningMedium,
  neutral:    COLORS.neutralMedium,
  none:       COLORS.badMedium,
  reject:     COLORS.good,
  quarantine: COLORS.warningMedium,
} as const;

// ── Score / Grade → Color ────────────────────────────────────────────────────
export function scoreColor(score: number): string {
  if (score >= 80) return COLORS.good;
  if (score >= 60) return COLORS.cfOrange;
  if (score >= 40) return COLORS.warningMedium;
  return COLORS.bad;
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return COLORS.good;
    case "B": return COLORS.goodMedium;
    case "C": return COLORS.warningMedium;
    case "D": return COLORS.warning;
    default:  return COLORS.bad;
  }
}
