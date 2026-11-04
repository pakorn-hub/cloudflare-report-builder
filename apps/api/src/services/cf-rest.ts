/**
 * Cloudflare REST API client — read-only, no data stored.
 * Adapted from fetch-cf-config/index.js (CATEGORIES + fetchEndpoint pattern).
 */

const CF_BASE = "https://api.cloudflare.com/client/v4";

// ─── Generic REST Fetch ───────────────────────────────────────────────────────

export interface RestResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error?: string;
  status: number;
}

export async function cfGet<T = unknown>(
  token: string,
  path: string
): Promise<RestResult<T>> {
  const url = path.startsWith("http") ? path : `${CF_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return { ok: false, data: null, error: String(e), status: 0 };
  }

  if (res.status === 401)
    return { ok: false, data: null, error: "Invalid API token", status: 401 };
  if (res.status === 403)
    return {
      ok: false,
      data: null,
      error: "Insufficient token permissions",
      status: 403,
    };
  if (res.status === 404)
    return { ok: false, data: null, error: "Resource not found", status: 404 };
  if (!res.ok)
    return {
      ok: false,
      data: null,
      error: `HTTP ${res.status}`,
      status: res.status,
    };

  const json = (await res.json()) as { success: boolean; result: T };
  if (!json.success)
    return { ok: false, data: null, error: "API returned success:false", status: res.status };

  return { ok: true, data: json.result, status: res.status };
}

// ─── Paged REST Fetch (captures result_info.total_count) ─────────────────────
/**
 * Like cfGet, but also returns `result_info.total_count` from the response
 * envelope — needed for "how many total X exist" questions (e.g. total API
 * operations, discovery operations pending review) where the endpoint caps
 * per_page well below the real total and the list length alone would
 * under-report the true count.
 */
export interface RestResultPaged<T = unknown> extends RestResult<T> {
  totalCount?: number;
}

export async function cfGetPaged<T = unknown>(
  token: string,
  path: string
): Promise<RestResultPaged<T>> {
  const url = path.startsWith("http") ? path : `${CF_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return { ok: false, data: null, error: String(e), status: 0 };
  }

  if (!res.ok)
    return { ok: false, data: null, error: `HTTP ${res.status}`, status: res.status };

  const json = (await res.json()) as {
    success: boolean;
    result: T;
    result_info?: { total_count?: number };
  };
  if (!json.success)
    return { ok: false, data: null, error: "API returned success:false", status: res.status };

  return { ok: true, data: json.result, status: res.status, totalCount: json.result_info?.total_count };
}

// ─── Zone Info ────────────────────────────────────────────────────────────────

// ─── Well-known hostname → provider mapping ───────────────────────────────────
/**
 * Maps domain suffixes to known cloud/CDN providers.
 * Used to identify CNAME/MX targets without needing an IP lookup.
 * Order matters — more specific patterns first.
 */
const HOSTNAME_PROVIDER_PATTERNS: Array<{
  pattern: RegExp;
  provider: string;
  category: string;
  color: string;
}> = [
  // ── Cloudflare ──────────────────────────────────────────────────────────────
  { pattern: /\.r2\.dev$/i,               provider: "Cloudflare R2",      category: "cdn",   color: "#F6821F" },
  { pattern: /\.pages\.dev$/i,            provider: "Cloudflare Pages",   category: "paas",  color: "#F6821F" },
  { pattern: /\.workers\.dev$/i,          provider: "Cloudflare Workers", category: "paas",  color: "#F6821F" },
  { pattern: /\.cfargotunnel\.com$/i,     provider: "Cloudflare Tunnel",  category: "cdn",   color: "#F6821F" },
  { pattern: /\.cloudflare\.net$/i,       provider: "Cloudflare",         category: "cdn",   color: "#F6821F" },
  { pattern: /\.cloudflare\.com$/i,       provider: "Cloudflare",         category: "cdn",   color: "#F6821F" },
  { pattern: /\.cf-emailsecurity\.net$/i, provider: "Cloudflare Email",   category: "cdn",   color: "#F6821F" },
  { pattern: /\.trycloudflare\.com$/i,    provider: "Cloudflare Tunnel",  category: "cdn",   color: "#F6821F" },
  // ── Amazon AWS ──────────────────────────────────────────────────────────────
  { pattern: /\.amazonaws\.com$/i,        provider: "Amazon AWS",         category: "cloud", color: "#FF9900" },
  { pattern: /\.awsglobalaccelerator\.com$/i, provider: "Amazon AWS",     category: "cloud", color: "#FF9900" },
  { pattern: /\.cloudfront\.net$/i,       provider: "AWS CloudFront",     category: "cdn",   color: "#FF9900" },
  { pattern: /\.elb\.amazonaws\.com$/i,   provider: "AWS ELB",            category: "cloud", color: "#FF9900" },
  { pattern: /\.s3\.amazonaws\.com$/i,    provider: "AWS S3",             category: "cloud", color: "#FF9900" },
  { pattern: /\.execute-api\./i,          provider: "AWS API Gateway",    category: "cloud", color: "#FF9900" },
  // ── Microsoft Azure ─────────────────────────────────────────────────────────
  { pattern: /\.windows\.net$/i,          provider: "Microsoft Azure",    category: "cloud", color: "#0078D4" },
  { pattern: /\.azure\.com$/i,            provider: "Microsoft Azure",    category: "cloud", color: "#0078D4" },
  { pattern: /\.azurewebsites\.net$/i,    provider: "Azure App Service",  category: "cloud", color: "#0078D4" },
  { pattern: /\.trafficmanager\.net$/i,   provider: "Azure Traffic Mgr",  category: "cloud", color: "#0078D4" },
  { pattern: /\.azuredns\.com$/i,         provider: "Microsoft Azure",    category: "cloud", color: "#0078D4" },
  { pattern: /\.blob\.core\.windows\.net$/i, provider: "Azure Blob",      category: "cloud", color: "#0078D4" },
  { pattern: /\.msft\.net$/i,             provider: "Microsoft",          category: "cloud", color: "#0078D4" },
  // ── Google Cloud ────────────────────────────────────────────────────────────
  { pattern: /\.googleusercontent\.com$/i,provider: "Google Cloud",       category: "cloud", color: "#4285F4" },
  { pattern: /\.googleapis\.com$/i,       provider: "Google Cloud",       category: "cloud", color: "#4285F4" },
  { pattern: /\.appspot\.com$/i,          provider: "Google App Engine",  category: "cloud", color: "#4285F4" },
  { pattern: /\.run\.app$/i,              provider: "Google Cloud Run",   category: "cloud", color: "#4285F4" },
  { pattern: /\.cloudfunctions\.net$/i,   provider: "Google Functions",   category: "cloud", color: "#4285F4" },
  // ── Fastly ──────────────────────────────────────────────────────────────────
  { pattern: /\.fastly\.net$/i,           provider: "Fastly CDN",         category: "cdn",   color: "#FF282D" },
  { pattern: /\.fastlylb\.net$/i,         provider: "Fastly CDN",         category: "cdn",   color: "#FF282D" },
  // ── Akamai ──────────────────────────────────────────────────────────────────
  { pattern: /\.akamai\.net$/i,           provider: "Akamai CDN",         category: "cdn",   color: "#009BDE" },
  { pattern: /\.akamaiedge\.net$/i,       provider: "Akamai CDN",         category: "cdn",   color: "#009BDE" },
  { pattern: /\.akamaihdtech\.net$/i,     provider: "Akamai CDN",         category: "cdn",   color: "#009BDE" },
  // ── Vercel ──────────────────────────────────────────────────────────────────
  { pattern: /\.vercel\.app$/i,           provider: "Vercel",             category: "paas",  color: "#000000" },
  { pattern: /\.now\.sh$/i,               provider: "Vercel",             category: "paas",  color: "#000000" },
  // ── Netlify ─────────────────────────────────────────────────────────────────
  { pattern: /\.netlify\.app$/i,          provider: "Netlify",            category: "paas",  color: "#00C7B7" },
  { pattern: /\.netlify\.com$/i,          provider: "Netlify",            category: "paas",  color: "#00C7B7" },
  // ── DigitalOcean ────────────────────────────────────────────────────────────
  { pattern: /\.digitaloceanspaces\.com$/i, provider: "DigitalOcean",     category: "vps",   color: "#0080FF" },
  { pattern: /\.ondigitalocean\.app$/i,   provider: "DigitalOcean",       category: "vps",   color: "#0080FF" },
  // ── Heroku ──────────────────────────────────────────────────────────────────
  { pattern: /\.herokuapp\.com$/i,        provider: "Heroku",             category: "paas",  color: "#6762A6" },
  // ── SendGrid / Twilio ───────────────────────────────────────────────────────
  { pattern: /\.sendgrid\.net$/i,         provider: "SendGrid (Twilio)",  category: "email", color: "#1A82E2" },
  { pattern: /\.twilio\.com$/i,           provider: "Twilio",             category: "saas",  color: "#F22F46" },
  // ── Google Email / Workspace ─────────────────────────────────────────────────
  { pattern: /\.google\.com$/i,           provider: "Google",             category: "saas",  color: "#4285F4" },
  { pattern: /\.smtp\.google\.com$/i,     provider: "Google Workspace",   category: "email", color: "#4285F4" },
  { pattern: /aspmx\.l\.google\.com$/i,   provider: "Google Workspace",   category: "email", color: "#4285F4" },
  // ── Microsoft 365 / Exchange ────────────────────────────────────────────────
  { pattern: /\.mail\.protection\.outlook\.com$/i, provider: "Microsoft 365", category: "email", color: "#0078D4" },
  { pattern: /\.outlook\.com$/i,          provider: "Microsoft 365",      category: "email", color: "#0078D4" },
  { pattern: /\.office365\.com$/i,        provider: "Microsoft 365",      category: "email", color: "#0078D4" },
  // ── Zoho ────────────────────────────────────────────────────────────────────
  { pattern: /\.zoho\.com$/i,             provider: "Zoho",               category: "saas",  color: "#E42527" },
  { pattern: /\.zmailcloud\.com$/i,       provider: "Zoho Mail",          category: "email", color: "#E42527" },
  // ── GitHub ──────────────────────────────────────────────────────────────────
  { pattern: /\.github\.io$/i,            provider: "GitHub Pages",       category: "paas",  color: "#24292F" },
  // ── Shopify ─────────────────────────────────────────────────────────────────
  { pattern: /\.myshopify\.com$/i,        provider: "Shopify",            category: "saas",  color: "#96BF48" },
  // ── HubSpot ─────────────────────────────────────────────────────────────────
  { pattern: /\.hubspot\.com$/i,          provider: "HubSpot",            category: "saas",  color: "#FF7A59" },
  // ── Wix ─────────────────────────────────────────────────────────────────────
  { pattern: /\.wixsite\.com$/i,          provider: "Wix",                category: "saas",  color: "#FAAD08" },
  // ── Oracle Cloud ─────────────────────────────────────────────────────────────
  { pattern: /\.oraclecloud\.com$/i,      provider: "Oracle Cloud",       category: "cloud", color: "#F80000" },
  // ── Hetzner ──────────────────────────────────────────────────────────────────
  { pattern: /\.hetzner\.com$/i,          provider: "Hetzner",            category: "vps",   color: "#D50C2D" },
  // ── Supabase ─────────────────────────────────────────────────────────────────
  { pattern: /\.supabase\.co$/i,          provider: "Supabase",           category: "paas",  color: "#3ECF8E" },
];

export function resolveHostnameProvider(hostname: string): {
  provider: string; category: string; color: string;
} | null {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  for (const pat of HOSTNAME_PROVIDER_PATTERNS) {
    if (pat.pattern.test(h)) {
      return { provider: pat.provider, category: pat.category, color: pat.color };
    }
  }
  return null;
}

// ─── DNS Record + ASN Enrichment ─────────────────────────────────────────────

// Well-known ASN → provider mapping (covers 95%+ of cloud traffic)
const KNOWN_ASN_PROVIDERS: Record<number, { name: string; category: string; color: string }> = {
  // Cloudflare
  13335: { name: "Cloudflare",      category: "cdn",          color: "#F6821F" },
  // Google
  15169: { name: "Google Cloud",    category: "cloud",        color: "#4285F4" },
  396982:{ name: "Google Cloud",    category: "cloud",        color: "#4285F4" },
  // AWS
  16509: { name: "Amazon AWS",      category: "cloud",        color: "#FF9900" },
  14618: { name: "Amazon AWS",      category: "cloud",        color: "#FF9900" },
  // Azure / Microsoft
  8075:  { name: "Microsoft Azure", category: "cloud",        color: "#0078D4" },
  8069:  { name: "Microsoft",       category: "cloud",        color: "#0078D4" },
  // Akamai
  20940: { name: "Akamai",          category: "cdn",          color: "#009BDE" },
  // Fastly
  54113: { name: "Fastly",          category: "cdn",          color: "#FF282D" },
  // Alibaba
  45102: { name: "Alibaba Cloud",   category: "cloud",        color: "#FF6A00" },
  // DigitalOcean
  14061: { name: "DigitalOcean",    category: "vps",          color: "#0080FF" },
  // Linode/Akamai Cloud
  63949: { name: "Linode",          category: "vps",          color: "#00B050" },
  // Hetzner
  24940: { name: "Hetzner",         category: "vps",          color: "#D50C2D" },
  // OVH
  16276: { name: "OVH",             category: "vps",          color: "#123F6D" },
  // Vercel
  76846: { name: "Vercel",          category: "paas",         color: "#000000" },
  // Heroku/Salesforce
  22695: { name: "Heroku",          category: "paas",         color: "#6762A6" },
  // Oracle Cloud
  31898: { name: "Oracle Cloud",    category: "cloud",        color: "#F80000" },
  // IBM Cloud
  36351: { name: "IBM Cloud",       category: "cloud",        color: "#006699" },
};

export interface DnsRecordEnriched {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
  // ASN enrichment for A/AAAA records
  asn?: number;
  asnHolder?: string;
  provider?: string;
  providerCategory?: string;
  providerColor?: string;
}

/** Look up the ASN for a single IP via RIPE Stat (public, no auth). */
async function lookupAsnForIp(ip: string): Promise<{ asn: number; holder: string } | null> {
  try {
    const url = `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}&max_related=0`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      data?: { asns?: Array<{ asn: number; holder: string }> };
    };
    const asns = j.data?.asns ?? [];
    return asns[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches all DNS records for a zone and enriches A/AAAA records with
 * ASN / hosting provider data using the public RIPE Stat API.
 * Runs ASN lookups in parallel (max 5 at a time to avoid rate limiting).
 */
export async function fetchDnsRecordsEnriched(
  token: string,
  zoneId: string
): Promise<DnsRecordEnriched[]> {
  // Fetch all DNS records
  const res = await cfGet<DnsRecordEnriched[]>(
    token,
    `/zones/${zoneId}/dns_records?per_page=500&order=name`
  );
  if (!res.ok || !res.data) return [];

  const records = res.data;

  // Extract unique IPs from A/AAAA records
  const ipRecords = records.filter((r) => r.type === "A" || r.type === "AAAA");
  const uniqueIps = [...new Set(ipRecords.map((r) => r.content))];

  // Batch ASN lookups (5 concurrent)
  const asnMap = new Map<string, { asn: number; holder: string } | null>();
  const batches: string[][] = [];
  for (let i = 0; i < uniqueIps.length; i += 5) {
    batches.push(uniqueIps.slice(i, i + 5));
  }
  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((ip) => lookupAsnForIp(ip).then((r) => ({ ip, result: r })))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        asnMap.set(r.value.ip, r.value.result);
      }
    }
  }

  // Enrich records
  return records.map((record) => {
    // For A/AAAA: use ASN lookup result
    if (record.type === "A" || record.type === "AAAA") {
      const asnInfo = asnMap.get(record.content);
      if (!asnInfo) return record;
      const known = KNOWN_ASN_PROVIDERS[asnInfo.asn];
      return {
        ...record,
        asn: asnInfo.asn,
        asnHolder: asnInfo.holder,
        provider: known?.name ?? asnInfo.holder.split(" ").slice(0, 2).join(" "),
        providerCategory: known?.category ?? "hosting",
        providerColor: known?.color ?? "#6B7280",
      };
    }

    // For CNAME/MX/NS: use hostname pattern matching
    if (["CNAME", "MX", "NS"].includes(record.type)) {
      const hostnameInfo = resolveHostnameProvider(record.content);
      if (hostnameInfo) {
        return {
          ...record,
          provider: hostnameInfo.provider,
          providerCategory: hostnameInfo.category,
          providerColor: hostnameInfo.color,
        };
      }
    }

    return record;
  });
}

export async function getZoneInfo(token: string, zoneId: string) {
  return cfGet<{
    id: string;
    name: string;
    status: string;
    plan: { name: string };
    account: { id: string; name: string };
  }>(token, `/zones/${zoneId}`);
}

// ─── Certificates ─────────────────────────────────────────────────────────────

export interface CfCertPack {
  id: string;
  hosts: string[];
  type: string;
  status: string;
  certificates: Array<{
    expires_on: string;
    issuer: string;
    subject: string;
    id: string;
    hosts: string[];
  }>;
}

export async function getCertificates(token: string, zoneId: string) {
  return cfGet<CfCertPack[]>(token, `/zones/${zoneId}/ssl/certificate_packs`);
}

// ─── TLS Settings ─────────────────────────────────────────────────────────────

export async function getTlsMinVersion(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string }>(
    token,
    `/zones/${zoneId}/settings/min_tls_version`
  );
}

export async function getTls13(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string }>(
    token,
    `/zones/${zoneId}/settings/tls_1_3`
  );
}

export async function getAlwaysHttps(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string }>(
    token,
    `/zones/${zoneId}/settings/always_use_https`
  );
}

export async function getSsl(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string }>(
    token,
    `/zones/${zoneId}/settings/ssl`
  );
}

// ─── Security Settings ────────────────────────────────────────────────────────

export async function getSecurityLevel(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string }>(
    token,
    `/zones/${zoneId}/settings/security_level`
  );
}

export async function getBotManagementConfig(token: string, zoneId: string) {
  return cfGet<{
    enable_js: boolean;
    fight_mode: boolean;
    using_latest_model: boolean;
    score_cwv_performance: boolean;
    auto_update_model: boolean;
  }>(token, `/zones/${zoneId}/bot_management`);
}

export async function getDdosHttpOverrides(token: string, zoneId: string) {
  return cfGet<{ id: string; description: string; enabled: boolean }[]>(
    token,
    `/zones/${zoneId}/ddos_protection/http`
  );
}

// ─── WAF / Rulesets ───────────────────────────────────────────────────────────

export interface CfRuleset {
  id: string;
  name: string;
  description: string;
  kind: string;
  phase: string;
  rules?: CfRule[];
}

export interface CfRule {
  id: string;
  description: string;
  action: string;
  enabled: boolean;
  expression?: string;
  /** Rule tags (dashboard calls these "tags"; API wire field is "categories"),
   *  e.g. ["sqli"], ["xss"], ["wordpress"], ["directory-traversal"]. Only
   *  populated on managed-ruleset rules; absent on custom rules. */
  categories?: string[];
  /** Present on `execute` rules — references another (usually managed) ruleset. */
  action_parameters?: { id?: string };
  /** Present on rate-limiting rules (phase http_ratelimit). */
  ratelimit?: {
    characteristics?: string[];
    period?: number;
    requests_per_period?: number;
    mitigation_timeout?: number;
    counting_expression?: string;
  };
}

export async function getRulesets(token: string, zoneId: string) {
  return cfGet<CfRuleset[]>(token, `/zones/${zoneId}/rulesets`);
}

export async function getRuleset(
  token: string,
  zoneId: string,
  rulesetId: string
) {
  return cfGet<CfRuleset>(token, `/zones/${zoneId}/rulesets/${rulesetId}`);
}

// ─── Phase Entrypoint Rulesets ─────────────────────────────────────────────────
/**
 * A zone's "entrypoint" ruleset for a given phase (e.g.
 * http_request_firewall_managed, http_response_firewall_managed) contains the
 * `execute` rules that deploy managed rulesets (OWASP Core, Cloudflare
 * Managed, Sensitive Data Detection, legacy Exposed Credentials Check, etc.)
 * — each `execute` rule's `action_parameters.id` is the managed ruleset ID.
 * https://developers.cloudflare.com/api/resources/rulesets/subresources/phases/methods/get/
 */
export async function getPhaseEntrypoint(
  token: string,
  zoneId: string,
  phase: string
): Promise<CfRuleset | null> {
  try {
    const res = await cfGet<CfRuleset>(token, `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
    return res.ok ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

/** Extracts the managed ruleset IDs deployed via `execute` rules in an entrypoint ruleset. */
export function getExecutedRulesetIds(entrypoint: CfRuleset | null): string[] {
  if (!entrypoint?.rules) return [];
  return entrypoint.rules
    .filter((r) => r.action === "execute" && r.enabled !== false && r.action_parameters?.id)
    .map((r) => r.action_parameters!.id!);
}

/**
 * Fetches full rule bodies (including `categories`) for a set of managed
 * ruleset IDs and returns a ruleId → categories lookup map. Used to replace
 * regex-based WAF attack classification with Cloudflare's own rule tags.
 */
export async function getManagedRuleCategoriesMap(
  token: string,
  zoneId: string,
  managedRulesetIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  await Promise.all(
    managedRulesetIds.map(async (id) => {
      try {
        const detail = await cfGet<CfRuleset>(token, `/zones/${zoneId}/rulesets/${id}`);
        if (!detail.ok || !detail.data?.rules) return;
        for (const rule of detail.data.rules) {
          if (rule.id && rule.categories && rule.categories.length > 0) {
            map.set(rule.id, rule.categories);
          }
        }
      } catch {
        /* ignore individual ruleset fetch failures */
      }
    })
  );
  return map;
}

// ─── Sensitive Data Detection / Legacy Exposed Credentials Check ─────────────
/**
 * Well-known Cloudflare managed ruleset IDs — stable, public, and identical
 * across every Cloudflare zone/account (not customer-specific secrets).
 * `gitleaks:allow` — these look like API keys to entropy-based secret
 * scanners but are just Cloudflare's own ruleset identifiers.
 */
export const SENSITIVE_DATA_DETECTION_RULESET_ID = "e22d83c647c64a3eae91b71b499d988e"; // gitleaks:allow
export const LEGACY_EXPOSED_CREDENTIALS_RULESET_ID = "c2e184081120413c86c3ab7e14069605"; // gitleaks:allow

export interface ManagedDetectionDeployment {
  sensitiveDataDetectionDeployed: boolean;
  legacyExposedCredentialsDeployed: boolean;
  /** Managed ruleset IDs executed in the request-phase entrypoint (OWASP Core, Cloudflare Managed, etc.) */
  requestPhaseManagedRulesetIds: string[];
}

export async function getManagedDetectionDeployment(
  token: string,
  zoneId: string
): Promise<ManagedDetectionDeployment> {
  const [requestEntry, responseEntry] = await Promise.all([
    getPhaseEntrypoint(token, zoneId, "http_request_firewall_managed"),
    getPhaseEntrypoint(token, zoneId, "http_response_firewall_managed"),
  ]);
  const requestPhaseManagedRulesetIds = getExecutedRulesetIds(requestEntry);
  const responsePhaseManagedRulesetIds = getExecutedRulesetIds(responseEntry);
  return {
    sensitiveDataDetectionDeployed: responsePhaseManagedRulesetIds.includes(SENSITIVE_DATA_DETECTION_RULESET_ID),
    legacyExposedCredentialsDeployed: requestPhaseManagedRulesetIds.includes(LEGACY_EXPOSED_CREDENTIALS_RULESET_ID),
    requestPhaseManagedRulesetIds,
  };
}

// ─── Custom WAF Rules (full detail with expressions) ──────────────────────────
/**
 * Fetches the zone's custom firewall ruleset with full rule details including
 * the Cloudflare Rules Language expression for each rule.
 * Phases: http_request_firewall_custom (WAF custom rules)
 *         http_ratelimit (rate limiting rules via new rulesets API)
 */
export interface CustomWafRule {
  id: string;
  description: string;
  action: string;
  enabled: boolean;
  expression: string;
  phase: string;
  rulesetName: string;
  /** Rate-limit specifics — only present when phase === "http_ratelimit". */
  ratelimit?: {
    characteristics?: string[];
    period?: number;
    requests_per_period?: number;
    mitigation_timeout?: number;
    counting_expression?: string;
  };
}

export async function getCustomWafRules(
  token: string,
  zoneId: string
): Promise<CustomWafRule[]> {
  const listRes = await cfGet<CfRuleset[]>(token, `/zones/${zoneId}/rulesets`);
  if (!listRes.ok || !listRes.data) return [];

  const rules: CustomWafRule[] = [];

  // Find custom firewall and rate-limit rulesets (kind = zone, not managed)
  const targetPhases = new Set([
    "http_request_firewall_custom",
    "http_ratelimit",
    "http_request_sbfm",
  ]);

  const targetRulesets = listRes.data.filter(
    (rs) => rs.kind === "zone" && targetPhases.has(rs.phase ?? "")
  );

  await Promise.all(
    targetRulesets.map(async (rs) => {
      const detail = await cfGet<CfRuleset>(
        token,
        `/zones/${zoneId}/rulesets/${rs.id}`
      );
      if (!detail.ok || !detail.data?.rules) return;
      for (const rule of detail.data.rules) {
        rules.push({
          id:          rule.id,
          description: rule.description || "(no description)",
          action:      rule.action,
          enabled:     rule.enabled !== false,
          expression:  rule.expression ?? "",
          phase:       rs.phase ?? "",
          rulesetName: rs.name,
          ratelimit:   rule.ratelimit,
        });
      }
    })
  );

  return rules.sort((a, b) => {
    // Sort: enabled first, then by action severity
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const severity: Record<string, number> = { block: 5, drop: 4, managed_challenge: 3, challenge: 2, js_challenge: 1, log: 0, skip: -1 };
    return (severity[b.action] ?? 0) - (severity[a.action] ?? 0);
  });
}

// ─── Rate Limits ──────────────────────────────────────────────────────────────

export interface CfRateLimit {
  id: string;
  description?: string;
  threshold: number;
  period: number;
  action: { mode: string };
  match: { request: { url_pattern: string } };
  disabled?: boolean;
}

export async function getRateLimits(token: string, zoneId: string) {
  return cfGet<CfRateLimit[]>(token, `/zones/${zoneId}/rate_limits?per_page=100`);
}

// ─── Cache Settings ───────────────────────────────────────────────────────────

export async function getCacheLevel(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string }>(
    token,
    `/zones/${zoneId}/settings/cache_level`
  );
}

export async function getBrowserCacheTtl(token: string, zoneId: string) {
  return cfGet<{ id: string; value: number }>(
    token,
    `/zones/${zoneId}/settings/browser_cache_ttl`
  );
}

// ─── API Shield ───────────────────────────────────────────────────────────────

export async function getApiShieldConfig(token: string, zoneId: string) {
  return cfGet<{ auth_id_characteristics: string[] }>(
    token,
    `/zones/${zoneId}/api_gateway/configuration`
  );
}

// ─── API Shield — Discovered Operations (endpoints) ──────────────────────────
/**
 * Returns the list of API endpoints discovered by API Shield endpoint discovery.
 * Each operation is a unique (method, path, host) tuple seen in traffic.
 * Requires API Shield / API Gateway to be enabled on the zone.
 */
/**
 * IMPORTANT: the real `feature` query-param enum is `thresholds` |
 * `parameter_schemas` | `schema_info` — there is NO `traffic_stats` feature.
 * Request-count data for an operation lives at `features.thresholds.requests`
 * ("The estimated number of requests covered by these calculations"), not
 * `traffic_stats.requests_total` (which never existed and caused a live
 * HTTP 400 on every call once error-swallowing was removed).
 * https://developers.cloudflare.com/api/resources/api_gateway/subresources/operations/methods/list/
 */
export interface ApiOperation {
  operation_id: string;
  method: string;       // GET, POST, PUT, DELETE, PATCH, etc.
  host: string;
  endpoint: string;     // path pattern e.g. /api/v1/users/{var}
  last_updated: string;
  features?: {
    thresholds?: {
      requests?: number;
      suggested_threshold?: number;
      p50?: number;
      p90?: number;
      p99?: number;
      data_points?: number;
      auth_id_tokens?: number;
      period_seconds?: number;
      last_updated?: string;
    };
    schema_info?: {
      active_schema?: { id: string; name: string; created_at?: string } | null;
      mitigation_action?: "none" | "log" | "block";
    };
  };
}

export async function getApiShieldOperations(
  token: string,
  zoneId: string,
  limit = 25,
  direction: "asc" | "desc" = "desc"
): Promise<ApiOperation[]> {
  // API caps per_page at 50 regardless of the value requested.
  const perPage = Math.min(limit, 50);
  const res = await cfGet<ApiOperation[]>(
    token,
    `/zones/${zoneId}/api_gateway/operations?feature=thresholds&feature=schema_info&order=thresholds.requests&direction=${direction}&page=1&per_page=${perPage}`
  );
  // Throw (rather than silently swallow to []) on a genuine API failure so the
  // real reason (permissions/plan/404) surfaces in the report's diagnostics —
  // Promise.allSettled + safeGet at the call site already handle this safely.
  if (!res.ok) throw new Error(`API Shield operations: ${res.error ?? "unknown error"} (HTTP ${res.status})`);
  return Array.isArray(res.data) ? res.data : [];
}

/** Total count of operations tracked for the zone (independent of the per_page cap). */
export async function getApiOperationsTotalCount(token: string, zoneId: string): Promise<number> {
  const res = await cfGetPaged<ApiOperation[]>(token, `/zones/${zoneId}/api_gateway/operations?per_page=5`);
  if (!res.ok) throw new Error(`API Shield operations count: ${res.error ?? "unknown error"} (HTTP ${res.status})`);
  return res.totalCount ?? (Array.isArray(res.data) ? res.data.length : 0);
}

/**
 * Resolves a single operation's method/host/endpoint by ID.
 * `GET /zones/{zone_id}/api_gateway/operations/{operation_id}`
 * Used to fill in human-readable paths for operation IDs returned by the
 * Endpoint Labeling Service (GraphQL) that don't happen to fall within the
 * small top-traffic/low-traffic REST samples used to build the primary
 * operation map — see resolveOperationDetails() in fetch-appsec.ts.
 */
export async function getApiOperationById(
  token: string,
  zoneId: string,
  operationId: string
): Promise<ApiOperation | null> {
  try {
    const res = await cfGet<ApiOperation>(token, `/zones/${zoneId}/api_gateway/operations/${operationId}`);
    return res.ok ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a batch of operation IDs to {method, host, endpoint} via parallel
 * individual lookups. Intentionally NOT used for the full at-risk operation
 * set (which can be in the hundreds) — callers should pass only the IDs that
 * will actually be displayed (e.g. after slicing to the top N for a table),
 * to keep the number of extra REST calls bounded and fast.
 */
export async function getOperationsByIds(
  token: string,
  zoneId: string,
  operationIds: string[]
): Promise<Map<string, ApiOperation>> {
  const results = await Promise.all(
    operationIds.map(async (id) => [id, await getApiOperationById(token, zoneId, id)] as const)
  );
  const map = new Map<string, ApiOperation>();
  for (const [id, op] of results) {
    if (op) map.set(id, op);
  }
  return map;
}

/**
 * Zombie API detection — Cloudflare's own `cf-risk-zombie` label applies to
 * saved endpoints with no traffic in 32+ days. Since a truly dormant endpoint
 * produces zero rows in any traffic-based GraphQL query, we detect it instead
 * by fetching operations SORTED BY LOWEST TRAFFIC FIRST (sort=asc) — this
 * surfaces the most zombie-like candidates directly, then flags any whose
 * `last_updated` (last time this operation was seen/updated) is 32+ days old.
 *
 * NOTE: the API caps per_page at 50, so for zones with very large numbers of
 * saved operations (e.g. thousands) this is a representative sample of the
 * least-trafficked operations, not an exhaustive audit — labeled as such in
 * the UI. Full auditing should be done in Security → Web Assets.
 */
export async function getLowTrafficOperations(
  token: string,
  zoneId: string,
  limit = 50
): Promise<ApiOperation[]> {
  return getApiShieldOperations(token, zoneId, limit, "asc");
}

// ─── API Shield — Operation Labels (authoritative, traffic-window-independent) ─
/**
 * `GET /zones/{zone_id}/api_gateway/labels?with_mapped_resource_counts=true`
 * returns every managed + user label with `mapped_resources.operation` — the
 * exact persisted count of operations currently carrying that label, computed
 * by Cloudflare's own 24-hour risk scan. This is the SAME number the
 * dashboard's Web Assets page shows (e.g. "375 at-risk / 2202 operations"),
 * unlike the GraphQL `webAssetsLabelsManaged` dimension which only reflects
 * labels seen on traffic within the queried date range — so a saved endpoint
 * with a risk label but no traffic this period is invisible to GraphQL but
 * still counted here. Use this as the PRIMARY source for label counts;
 * GraphQL remains useful only for "traffic volume of labeled endpoints".
 * https://developers.cloudflare.com/security/web-assets/label-operations/
 *
 * IMPORTANT: the real field is `mapped_resources.operation` (SINGULAR),
 * confirmed via a live raw REST response — NOT `operations` (plural) as
 * originally assumed from the docs' prose description. That mistake meant
 * this field was always `undefined` for every label, silently defeating
 * the entire REST-primary/GraphQL-fallback design: every label's count
 * fell through to the GraphQL rolling-30-day-traffic-window estimate
 * instead of the correct persisted snapshot — explaining both an inflated
 * count for a broadly-applied label (cf-api-endpoint) and a wrong,
 * traffic-window-capped count for cf-risk-zombie (which by definition has
 * no traffic, so its true GraphQL-derived count is always near zero).
 */
export interface ApiShieldLabel {
  name: string;
  description?: string;
  source: "user" | "managed";
  mapped_resources?: { operation?: number };
}

export async function getApiShieldLabels(token: string, zoneId: string): Promise<ApiShieldLabel[]> {
  const res = await cfGet<ApiShieldLabel[]>(
    token,
    `/zones/${zoneId}/api_gateway/labels?with_mapped_resource_counts=true&per_page=100`
  );
  if (!res.ok) throw new Error(`API Shield labels: ${res.error ?? "unknown error"} (HTTP ${res.status})`);
  return Array.isArray(res.data) ? res.data : [];
}

// ─── API Shield — Discovery (candidate operations pending review) ────────────
/**
 * Counts operations Cloudflare has discovered from traffic but that have NOT
 * yet been saved into Endpoint Management (`state=review`). These operations
 * get basic matching/context automatically, but do NOT receive risk scans,
 * schema validation, or the other "full"-state-gated protections until saved.
 * https://developers.cloudflare.com/security/web-assets/manage-operations/
 */
export async function getDiscoveryOperationsReviewCount(token: string, zoneId: string): Promise<number> {
  const res = await cfGetPaged<unknown[]>(token, `/zones/${zoneId}/api_gateway/discovery/operations?state=review&per_page=5`);
  if (!res.ok) throw new Error(`API Shield discovery operations: ${res.error ?? "unknown error"} (HTTP ${res.status})`);
  return res.totalCount ?? (Array.isArray(res.data) ? res.data.length : 0);
}

/**
 * IMPORTANT — dashboard parity: `GET /zones/{zone_id}/api_gateway/labels`
 * and `GET /zones/{zone_id}/api_gateway/operations` (used elsewhere in this
 * file) ONLY count "full" (saved) state operations. Cloudflare's dashboard
 * Web Assets summary — confirmed via a captured internal dashboard API call
 * (`/api_gateway/operations/summary?with_labels=true`) — counts labels
 * across BOTH "full" AND "candidate" (discovered-but-not-saved) state
 * operations combined (confirmed live: candidate 1370 + full 832 = total
 * 2202 exactly). Since the public API has no per-label aggregate for
 * candidate-state operations (the discovery endpoint's documented filters
 * are direction/endpoint/host/method/order/origin/page/per_page/state —
 * no `label` filter), the only way to get real candidate-state label
 * counts is to paginate the discovery list and tally each operation's
 * `labels[]` array ourselves. Capped at `maxOperations` to bound Worker
 * subrequest count on very large zones — result honestly reports whether
 * it was truncated.
 */
export interface DiscoveryLabelCountsResult {
  labelCounts: Map<string, number>;
  coveredCount: number;
  truncated: boolean;
}

interface DiscoveryOpWithLabels {
  labels?: Array<{ name: string }>;
}

export async function getDiscoveryOperationsLabelCounts(
  token: string,
  zoneId: string,
  totalReviewCount: number,
  maxOperations = 1500
): Promise<DiscoveryLabelCountsResult> {
  const perPage = 50;
  const cappedTotal = Math.min(totalReviewCount, maxOperations);
  const pageCount = Math.max(0, Math.ceil(cappedTotal / perPage));
  const labelCounts = new Map<string, number>();
  let coveredCount = 0;

  if (pageCount === 0) {
    return { labelCounts, coveredCount, truncated: false };
  }

  const failedResult: RestResult<DiscoveryOpWithLabels[]> = { ok: false, data: null, status: 0 };
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => i + 1).map((page) =>
      cfGet<DiscoveryOpWithLabels[]>(
        token,
        `/zones/${zoneId}/api_gateway/discovery/operations?state=review&per_page=${perPage}&page=${page}`
      ).catch(() => failedResult)
    )
  );

  for (const res of pages) {
    if (!res.ok || !Array.isArray(res.data)) continue;
    for (const op of res.data) {
      coveredCount++;
      for (const label of op.labels ?? []) {
        labelCounts.set(label.name, (labelCounts.get(label.name) ?? 0) + 1);
      }
    }
  }

  return { labelCounts, coveredCount, truncated: totalReviewCount > maxOperations };
}

// ─── Leaked Credential Check (real; replaces the dead `leakedCredentials` stub) ─
/** https://developers.cloudflare.com/waf/detections/leaked-credentials/ */
export interface LeakedCredentialCheckStatus {
  enabled?: boolean;
}

export async function getLeakedCredentialCheckStatus(
  token: string,
  zoneId: string
): Promise<LeakedCredentialCheckStatus | null> {
  try {
    const res = await cfGet<LeakedCredentialCheckStatus>(token, `/zones/${zoneId}/leaked-credential-checks`);
    return res.ok ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

export interface LeakedCredentialDetection {
  id?: string;
  username?: string;
  password?: string;
}

export async function getLeakedCredentialCheckDetections(
  token: string,
  zoneId: string
): Promise<LeakedCredentialDetection[]> {
  try {
    const res = await cfGet<LeakedCredentialDetection[]>(token, `/zones/${zoneId}/leaked-credential-checks/detections`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

// ─── Malicious Uploads (Content Scanning) ─────────────────────────────────────
/** https://developers.cloudflare.com/waf/detections/malicious-uploads/ */
export interface ContentScanningStatus {
  value?: string; // "on" | "off"
  modified?: string;
}

export async function getContentScanningStatus(
  token: string,
  zoneId: string
): Promise<ContentScanningStatus | null> {
  try {
    const res = await cfGet<ContentScanningStatus>(token, `/zones/${zoneId}/content-upload-scan/settings`);
    return res.ok ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

// ─── AI Security for Apps (PII / unsafe-topic / prompt-injection detection) ──
/** https://developers.cloudflare.com/waf/detections/ai-security-for-apps/ */
export interface AiSecurityStatus {
  enabled?: boolean;
}

export async function getAiSecurityStatus(
  token: string,
  zoneId: string
): Promise<AiSecurityStatus | null> {
  try {
    const res = await cfGet<AiSecurityStatus>(token, `/zones/${zoneId}/ai-security/settings`);
    return res.ok ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

/** https://developers.cloudflare.com/waf/detections/ai-security-for-apps/get-started/ */
export interface AiSecurityCustomTopic {
  label: string;
  topic: string;
}

export async function getAiSecurityCustomTopics(
  token: string,
  zoneId: string
): Promise<AiSecurityCustomTopic[]> {
  try {
    const res = await cfGet<{ topics?: AiSecurityCustomTopic[] }>(token, `/zones/${zoneId}/ai-security/custom-topics`);
    return res.ok && Array.isArray(res.data?.topics) ? res.data!.topics! : [];
  } catch {
    return [];
  }
}

/**
 * AI Security for Apps has an optional "Log Mode" managed ruleset
 * (deployed as an `execute` rule in the http_request_firewall_managed phase
 * entrypoint, same mechanism as Sensitive Data Detection / legacy Exposed
 * Credentials Check) that logs detections without blocking, useful for
 * tuning before enforcing custom rules on cf.llm.prompt.* fields.
 * https://developers.cloudflare.com/waf/detections/ai-security-for-apps/log-mode-vs-production-mode/
 */
export const AI_SECURITY_LOG_MODE_RULESET_ID = "b7cd52df92f74c848cec0c2ed385e336"; // gitleaks:allow — public Cloudflare ruleset ID, not a secret

// ─── API Shield — Schema Validation Settings ──────────────────────────────────
/**
 * IMPORTANT: `/zones/{zone_id}/api_gateway/schemas` returns full OpenAPI
 * documents wrapped as `{ schemas: [...], timestamp }` — NOT a flat array of
 * schema metadata. Use the non-deprecated `/zones/{zone_id}/schema_validation/schemas`
 * endpoint instead, which returns the flat `{schema_id, name, kind,
 * created_at, validation_enabled}[]` shape this interface expects.
 * https://developers.cloudflare.com/api/resources/schema_validation/subresources/schemas/methods/list/
 */
export interface ApiSchemaInfo {
  schema_id: string;
  name: string;
  kind: string;
  created_at: string;
  validation_enabled: boolean;
}

export async function getApiShieldSchemas(
  token: string,
  zoneId: string
): Promise<ApiSchemaInfo[]> {
  try {
    const res = await cfGet<ApiSchemaInfo[]>(
      token,
      `/zones/${zoneId}/schema_validation/schemas?validation_enabled=true`
    );
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

// ─── API Shield — JWT Validation configurations ───────────────────────────────
/**
 * `/zones/{zone_id}/token_validation/config` — the actual JWT validation
 * config resource. Returns {id, title, description, token_sources,
 * token_type, credentials, ...} — there is no boolean "enabled" or
 * "allow_absent_token" field; a configuration existing in this list IS the
 * signal that JWT validation is configured (per-rule enforcement is a
 * separate resource: token_validation/rules).
 * https://developers.cloudflare.com/api/resources/token_validation/subresources/configuration/methods/list/
 */
export interface ApiJwtConfig {
  id: string;
  title: string;
  description?: string;
  token_type: string;
  token_sources: string[];
}

export async function getApiShieldJwtConfigs(
  token: string,
  zoneId: string
): Promise<ApiJwtConfig[]> {
  try {
    const res = await cfGet<ApiJwtConfig[]>(
      token,
      `/zones/${zoneId}/token_validation/config`
    );
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

// ─── Cipher Suites ────────────────────────────────────────────────────────────

export async function getCipherSuites(token: string, zoneId: string) {
  return cfGet<{ id: string; value: string[] }>(
    token,
    `/zones/${zoneId}/settings/ciphers`
  );
}

// ─── Custom Firewall Rules (for WAF rule name lookup) ─────────────────────────
/**
 * Fetches all zone-level custom firewall rules and returns a map of
 * ruleId → description. Used to translate raw rule IDs in analytics
 * to human-readable names.
 */
export async function getCustomFirewallRuleNames(
  token: string,
  zoneId: string
): Promise<Map<string, string>> {
  // List rulesets to find the custom firewall ruleset
  const rulesetsRes = await cfGet<CfRuleset[]>(token, `/zones/${zoneId}/rulesets`);
  if (!rulesetsRes.ok || !rulesetsRes.data) return new Map();

  // Find the zone-level custom firewall ruleset (phase: http_request_firewall_custom, kind: zone)
  const customRuleset = rulesetsRes.data.find(
    (rs) => rs.phase === "http_request_firewall_custom" && rs.kind === "zone"
  );
  if (!customRuleset) return new Map();

  // Fetch the full ruleset with its rules
  const detailRes = await cfGet<CfRuleset>(token, `/zones/${zoneId}/rulesets/${customRuleset.id}`);
  if (!detailRes.ok || !detailRes.data) return new Map();

  const nameMap = new Map<string, string>();
  for (const rule of detailRes.data.rules ?? []) {
    if (rule.id && rule.description) {
      nameMap.set(rule.id, rule.description);
    }
  }
  return nameMap;
}

// ─── Email Security — DMARC / SPF / DKIM via DNS ──────────────────────────────
/**
 * Fetches email authentication records for the zone domain.
 * Uses Cloudflare's own DoH (dns.cloudflare.com) — no auth required.
 * Also reads MX records from the zone DNS API (already authed).
 */

const DOH = "https://cloudflare-dns.com/dns-query";

async function dohQuery(name: string, type: "TXT" | "MX"): Promise<string[]> {
  try {
    const typeNum = type === "TXT" ? 16 : 15;
    const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${typeNum}`, {
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      Status: number;
      Answer?: Array<{ data: string }>;
    };
    if (json.Status !== 0) return [];
    return (json.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } catch {
    return [];
  }
}

// Parse SPF policy directive (~all / -all / +all / ?all)
function parseSPFPolicy(record: string): string {
  if (record.includes("-all")) return "Fail (hard fail)";
  if (record.includes("~all")) return "SoftFail";
  if (record.includes("?all")) return "Neutral";
  if (record.includes("+all")) return "Pass (unsafe — allow all)";
  if (record.includes("v=spf1") && !record.includes("all")) return "No explicit policy";
  return "None";
}

// Parse DMARC policy (p= tag)
function parseDMARCPolicy(record: string): string {
  const match = record.match(/\bp=([^;]+)/i);
  return match ? match[1].trim().toLowerCase() : "none";
}

// Parse DMARC rua/ruf (reporting addresses)
function parseDMARCReporting(record: string): { rua: string[]; ruf: string[] } {
  const rua = record.match(/rua=([^;]+)/i)?.[1]?.split(",").map((s) => s.trim()) ?? [];
  const ruf = record.match(/ruf=([^;]+)/i)?.[1]?.split(",").map((s) => s.trim()) ?? [];
  return { rua, ruf };
}

// Parse DMARC subdomain policy (sp=)
function parseDMARCSubdomainPolicy(record: string): string {
  const match = record.match(/\bsp=([^;]+)/i);
  return match ? match[1].trim().toLowerCase() : "inherits p=";
}

// Parse DMARC pct (percentage tag)
function parseDMARCPct(record: string): number {
  const match = record.match(/\bpct=(\d+)/i);
  return match ? parseInt(match[1], 10) : 100;
}

// Parse DMARC adkim/aspf alignment
function parseDMARCAlignment(record: string): { adkim: string; aspf: string } {
  const adkim = record.match(/\badkim=([rs])/i)?.[1]?.toLowerCase() ?? "r";
  const aspf  = record.match(/\baspf=([rs])/i)?.[1]?.toLowerCase()  ?? "r";
  return {
    adkim: adkim === "s" ? "Strict" : "Relaxed",
    aspf:  aspf  === "s" ? "Strict" : "Relaxed",
  };
}

export interface EmailSecurityInfo {
  domain: string;
  // SPF
  spfRecord: string;
  spfPolicy: string;
  spfIncludes: string[];
  // DMARC
  dmarcRecord: string;
  dmarcPolicy: string;
  dmarcSubdomainPolicy: string;
  dmarcPct: number;
  dmarcRua: string[];
  dmarcRuf: string[];
  dmarcAlignment: { adkim: string; aspf: string };
  // DKIM
  dkimSelectors: Array<{ selector: string; record: string; valid: boolean }>;
  // MX
  mxRecords: Array<{ priority: number; exchange: string }>;
  // Cloudflare Email Security
  usingCloudflareEmailSecurity: boolean;
  // Overall grade
  grade: "A" | "B" | "C" | "D" | "F";
  issues: string[];
}

// Common DKIM selectors to probe
const DKIM_SELECTORS = [
  "mail", "google", "default", "zoho", "k1", "k2", "k3",
  "selector1", "selector2", "dkim", "smtp", "email",
  "s1", "s2", "mx", "mandrill", "mailchimp", "sendgrid",
  "protonmail", "pm", "sig1", "sig2",
];

export async function fetchEmailSecurity(
  token: string,
  zoneId: string,
  domain: string
): Promise<EmailSecurityInfo> {
  const issues: string[] = [];

  // Fetch SPF, DMARC, MX in parallel
  const [spfRecords, dmarcRecords, mxRaw] = await Promise.all([
    dohQuery(domain, "TXT"),
    dohQuery(`_dmarc.${domain}`, "TXT"),
    // Also get MX from zone DNS API (already authenticated)
    cfGet<Array<{ content: string; priority: number }>>(
      token,
      `/zones/${zoneId}/dns_records?type=MX&per_page=50`
    ).then((r) => r.data ?? []),
  ]);

  // Parse SPF (find the v=spf1 record)
  const spfRecord = spfRecords.find((r) => r.startsWith("v=spf1")) ?? "";
  const spfPolicy = spfRecord ? parseSPFPolicy(spfRecord) : "No SPF record found";
  const spfIncludes = [...spfRecord.matchAll(/include:(\S+)/gi)].map((m) => m[1]);

  if (!spfRecord) issues.push("No SPF record — phishing risk");
  else if (spfRecord.includes("+all")) issues.push("SPF uses +all (allows all senders — dangerous)");
  else if (spfRecord.includes("?all")) issues.push("SPF uses ?all (neutral — provides no protection)");

  // Parse DMARC
  const dmarcRecord = dmarcRecords.find((r) => r.startsWith("v=DMARC1")) ?? "";
  const dmarcPolicy = dmarcRecord ? parseDMARCPolicy(dmarcRecord) : "none";
  const dmarcSubPolicy = dmarcRecord ? parseDMARCSubdomainPolicy(dmarcRecord) : "none";
  const dmarcPct = dmarcRecord ? parseDMARCPct(dmarcRecord) : 0;
  const dmarcReporting = dmarcRecord ? parseDMARCReporting(dmarcRecord) : { rua: [], ruf: [] };
  const dmarcAlignment = dmarcRecord ? parseDMARCAlignment(dmarcRecord) : { adkim: "Relaxed", aspf: "Relaxed" };

  if (!dmarcRecord) issues.push("No DMARC record — no email authentication policy");
  else if (dmarcPolicy === "none") issues.push("DMARC policy is 'none' — monitoring only, no enforcement");
  else if (dmarcPct < 100) issues.push(`DMARC pct=${dmarcPct}% — not fully enforced`);
  if (dmarcRecord && dmarcReporting.rua.length === 0) issues.push("DMARC has no rua= reporting address");

  // Parse MX records
  const mxRecords: Array<{ priority: number; exchange: string }> =
    (mxRaw as Array<{ content: string; priority: number }>).map((r) => ({
      priority: r.priority ?? 10,
      exchange: r.content.replace(/\.$/, ""),
    })).sort((a, b) => a.priority - b.priority);

  // Also try DoH for MX in case REST API returned nothing
  if (mxRecords.length === 0) {
    const mxDoh = await dohQuery(domain, "MX");
    mxDoh.forEach((r) => {
      const parts = r.trim().split(/\s+/);
      if (parts.length >= 2) {
        mxRecords.push({ priority: parseInt(parts[0], 10), exchange: parts[1].replace(/\.$/, "") });
      }
    });
    mxRecords.sort((a, b) => a.priority - b.priority);
  }

  const usingCloudflareEmailSecurity = mxRecords.some(
    (mx) => mx.exchange.includes("cf-emailsecurity") || mx.exchange.includes("cloudflare-email")
  );

  // Probe DKIM selectors in parallel (limit concurrency)
  const dkimProbes = await Promise.allSettled(
    DKIM_SELECTORS.map((sel) =>
      dohQuery(`${sel}._domainkey.${domain}`, "TXT").then((records) => ({
        selector: sel,
        records,
      }))
    )
  );

  const dkimSelectors: Array<{ selector: string; record: string; valid: boolean }> = [];
  for (const probe of dkimProbes) {
    if (probe.status === "fulfilled") {
      const dkimRec = probe.value.records.find((r) => r.includes("v=DKIM1") || r.includes("k=rsa") || r.includes("k=ed25519"));
      if (dkimRec) {
        dkimSelectors.push({
          selector: probe.value.selector,
          record: dkimRec,
          valid: dkimRec.includes("p=") && !dkimRec.includes("p=;") && !dkimRec.includes('p=""'),
        });
      }
    }
  }

  if (dkimSelectors.length === 0) issues.push("No DKIM records found for common selectors");

  // Calculate grade
  let score = 100;
  if (!spfRecord) score -= 30;
  else if (spfRecord.includes("+all")) score -= 25;
  else if (spfRecord.includes("?all")) score -= 15;

  if (!dmarcRecord) score -= 30;
  else if (dmarcPolicy === "none") score -= 15;
  else if (dmarcPct < 100) score -= 10;

  if (dkimSelectors.length === 0) score -= 20;

  const grade: EmailSecurityInfo["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  return {
    domain,
    spfRecord,
    spfPolicy,
    spfIncludes,
    dmarcRecord,
    dmarcPolicy,
    dmarcSubdomainPolicy: dmarcSubPolicy,
    dmarcPct,
    dmarcRua: dmarcReporting.rua,
    dmarcRuf: dmarcReporting.ruf,
    dmarcAlignment,
    dkimSelectors,
    mxRecords,
    usingCloudflareEmailSecurity,
    grade,
    issues,
  };
}

// ─── Enhanced Zone Settings (single bulk call) ────────────────────────────────
/**
 * GET /zones/{zone_id}/settings
 * Returns all 100+ zone settings in one call. We parse the interesting ones.
 */
export interface ZoneSetting { id: string; value: unknown; modified_on?: string; editable?: boolean }

export async function getAllZoneSettings(token: string, zoneId: string) {
  return cfGet<ZoneSetting[]>(token, `/zones/${zoneId}/settings`);
}

export function parseZoneSettings(settings: ZoneSetting[]): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const s of settings) m[s.id] = s.value;
  return m;
}

// ─── Page Shield ──────────────────────────────────────────────────────────────

export interface PageShieldStatus {
  enabled: boolean;
  use_cloudflare_reporting_endpoint: boolean;
  use_connection_url_path: boolean;
}

export interface PageShieldScript {
  id: string;
  url: string;
  host: string;
  url_contains_cdn_cgi_path: boolean;
  status: string;  // "active" | "infrequent"
  first_seen_at: string;
  last_seen_at: string;
  js_integrity_score?: number;
  fetched_at?: string;
  seen_at?: string;
  obfuscation_score?: number;
  dataflow_score?: number;
  malware_score?: number;
  cryptomining_score?: number;
  magecart_score?: number;
}

export async function getPageShieldStatus(token: string, zoneId: string) {
  return cfGet<PageShieldStatus>(token, `/zones/${zoneId}/page_shield`);
}

export async function getPageShieldScripts(token: string, zoneId: string) {
  // CF API: GET /zones/:id/page_shield/scripts
  // Response: { success, result: PageShieldScript[], result_info: {...} }
  // cfGet extracts json.result → so data is PageShieldScript[] directly.
  // Fetch more scripts and include all scores for better analysis.
  return cfGet<PageShieldScript[]>(
    token,
    `/zones/${zoneId}/page_shield/scripts?per_page=100&direction=desc`
  );
}

// ─── Bulk parallel AppSec config fetch ───────────────────────────────────────
/**
 * Fetches all AppSec configuration endpoints in parallel.
 * Any individual failure is caught and returned as null — never throws.
 */
export async function fetchAppSecConfig(token: string, zoneId: string) {
  const [
    zone,
    certs,
    tlsMin,
    tls13,
    alwaysHttps,
    ssl,
    secLevel,
    botMgmt,
    rulesets,
    rateLimits,
    cacheLevel,
    browserCacheTtl,
    apiShield,
    ciphers,
    allSettings,
    pageShieldStatus,
    pageShieldScripts,
  ] = await Promise.allSettled([
    getZoneInfo(token, zoneId),
    getCertificates(token, zoneId),
    getTlsMinVersion(token, zoneId),
    getTls13(token, zoneId),
    getAlwaysHttps(token, zoneId),
    getSsl(token, zoneId),
    getSecurityLevel(token, zoneId),
    getBotManagementConfig(token, zoneId),
    getRulesets(token, zoneId),
    getRateLimits(token, zoneId),
    getCacheLevel(token, zoneId),
    getBrowserCacheTtl(token, zoneId),
    getApiShieldConfig(token, zoneId),
    getCipherSuites(token, zoneId),
    getAllZoneSettings(token, zoneId),
    getPageShieldStatus(token, zoneId),
    getPageShieldScripts(token, zoneId),
  ]);

  const unwrap = <T>(r: PromiseSettledResult<RestResult<T>>) =>
    r.status === "fulfilled" && r.value.ok ? r.value.data : null;

  // Fetch custom rule names separately (requires 2 REST calls — list + detail)
  const wafRuleNames = await getCustomFirewallRuleNames(token, zoneId).catch(() => new Map<string, string>());

  const rawSettings = unwrap(allSettings) ?? [];
  const settingsMap = parseZoneSettings(rawSettings as ZoneSetting[]);

  return {
    zone: unwrap(zone),
    certs: unwrap(certs) ?? [],
    tlsMin: unwrap(tlsMin),
    tls13: unwrap(tls13),
    alwaysHttps: unwrap(alwaysHttps),
    ssl: unwrap(ssl),
    secLevel: unwrap(secLevel),
    botMgmt: unwrap(botMgmt),
    rulesets: unwrap(rulesets) ?? [],
    rateLimits: unwrap(rateLimits) ?? [],
    cacheLevel: unwrap(cacheLevel),
    browserCacheTtl: unwrap(browserCacheTtl),
    apiShield: unwrap(apiShield),
    ciphers: unwrap(ciphers),
    wafRuleNames,
    // Enhanced settings
    allSettings: settingsMap,
    pageShieldEnabled: unwrap(pageShieldStatus)?.enabled ?? false,
    // cfGet extracts json.result already — data is PageShieldScript[] directly
    pageShieldScripts: (Array.isArray(unwrap(pageShieldScripts))
      ? unwrap(pageShieldScripts)
      : []) as PageShieldScript[],
  };
}

// =============================================================================
// Zero Trust / Cloudflare One REST API fetchers (account-level)
// =============================================================================

// ─── Access Applications ──────────────────────────────────────────────────────

export interface CfAccessApp {
  id: string;
  name: string;
  domain: string;
  type: string;
  session_duration: string;
  allowed_idps?: string[];
  policies?: { id: string }[];
  enabled?: boolean;
}

export async function getAccessApps(token: string, accountId: string): Promise<CfAccessApp[]> {
  try {
    const res = await cfGet<CfAccessApp[]>(token, `/accounts/${accountId}/access/apps?per_page=200`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Access Policies ──────────────────────────────────────────────────────────

export interface CfAccessPolicy {
  id: string;
  name: string;
  decision: string;
  require?: Array<{ mfa?: { auth_method: string } }>;
  precedence?: number;
}

export async function getAccessPolicies(token: string, accountId: string, appId: string): Promise<CfAccessPolicy[]> {
  try {
    const res = await cfGet<CfAccessPolicy[]>(token, `/accounts/${accountId}/access/apps/${appId}/policies`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Access Identity Providers ────────────────────────────────────────────────

export interface CfAccessIdp {
  id: string;
  name: string;
  type: string;
}

export async function getAccessIdps(token: string, accountId: string): Promise<CfAccessIdp[]> {
  try {
    const res = await cfGet<CfAccessIdp[]>(token, `/accounts/${accountId}/access/identity_providers`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Gateway Policies (DNS + HTTP + L4) ──────────────────────────────────────

export interface CfGatewayRule {
  id: string;
  name: string;
  action: string;
  enabled: boolean;
  rule_type?: string;
  conditions?: Array<{ type: string; expression?: { in?: { lhs: string; rhs: string[] } } }>;
  filters?: string[];
  description?: string;
}

export async function getGatewayRules(token: string, accountId: string): Promise<CfGatewayRule[]> {
  try {
    const res = await cfGet<CfGatewayRule[]>(token, `/accounts/${accountId}/gateway/rules?per_page=500`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Gateway Locations ───────────────────────────────────────────────────────

export interface CfGatewayLocation {
  id: string;
  name: string;
  doh_subdomain?: string;
  ip?: string[];
  networks?: Array<{ network: string }>;
}

export async function getGatewayLocations(token: string, accountId: string): Promise<CfGatewayLocation[]> {
  try {
    const res = await cfGet<CfGatewayLocation[]>(token, `/accounts/${accountId}/gateway/locations`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Gateway Categories ───────────────────────────────────────────────────────
/**
 * Full Gateway content category list (id → name), including subcategories.
 * Subcategory IDs (e.g. 182) are distinct from their parent category IDs and
 * are NOT covered by a short hand-written top-level table — always resolve
 * category IDs returned by GraphQL (gatewayResolverByCategoryAdaptiveGroups,
 * etc.) against this live list instead of a hardcoded map.
 * https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/categories/methods/list/
 */
export interface CfGatewayCategory {
  id: number;
  name: string;
  subcategories?: Array<{ id: number; name: string }>;
}

export async function getGatewayCategories(token: string, accountId: string): Promise<CfGatewayCategory[]> {
  try {
    const res = await cfGet<CfGatewayCategory[]>(token, `/accounts/${accountId}/gateway/categories`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

/** Flattens parent categories + subcategories into a single id → name lookup map. */
export function buildGatewayCategoryMap(categories: CfGatewayCategory[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const c of categories) {
    if (typeof c.id === "number" && c.name) map.set(c.id, c.name);
    for (const sub of c.subcategories ?? []) {
      if (typeof sub.id === "number" && sub.name) map.set(sub.id, sub.name);
    }
  }
  return map;
}

// ─── WARP Devices ─────────────────────────────────────────────────────────────

export interface CfWarpDevice {
  id: string;
  name: string;
  user?: { email?: string; name?: string };
  os_version?: string;
  os?: string;
  created?: string;
  last_seen?: string;
  serial_number?: string;
  ip?: string;
  device_type?: string;
}

/**
 * Returns both a sample device list (bounded, used for the device inventory
 * table + OS breakdown) and the REAL total enrolled-device count from
 * `result_info.total_count` — confirmed live that `/devices` truncates to
 * `per_page` (max 500) while `total_count` reports the true fleet size
 * (e.g. a real account with 4,373 enrolled devices but only 500 returned
 * per page). Previously only the truncated list length was used, silently
 * under-reporting "enrolled devices" on any account with >500 devices.
 */
export async function getWarpDevices(
  token: string, accountId: string
): Promise<{ devices: CfWarpDevice[]; totalCount: number }> {
  try {
    const res = await cfGetPaged<CfWarpDevice[]>(token, `/accounts/${accountId}/devices?per_page=500`);
    const devices = res.ok && Array.isArray(res.data) ? res.data : [];
    return { devices, totalCount: res.totalCount ?? devices.length };
  } catch { return { devices: [], totalCount: 0 }; }
}

// ─── WARP Posture Rules ───────────────────────────────────────────────────────

export interface CfPostureRule {
  id: string;
  name: string;
  type: string;
  enabled?: boolean;
  schedule?: { interval: string };
}

export async function getWarpPostureRules(token: string, accountId: string): Promise<CfPostureRule[]> {
  try {
    const res = await cfGet<CfPostureRule[]>(token, `/accounts/${accountId}/devices/posture`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Cloudflare Tunnels ───────────────────────────────────────────────────────

export interface CfTunnel {
  id: string;
  name: string;
  status: string;
  created_at: string;
  connections?: Array<{ id: string; status: string }>;
  config?: { ingress?: Array<{ service?: string; hostname?: string }> };
}

export async function getCloudflaredTunnels(token: string, accountId: string): Promise<CfTunnel[]> {
  try {
    const res = await cfGet<CfTunnel[]>(token, `/accounts/${accountId}/cfd_tunnel?per_page=250&is_deleted=false`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

/**
 * Exact total/healthy tunnel counts via `result_info.total_count` on a
 * `per_page=1` request — mirrors the dashboard's own tunnel-count calls
 * (`/tunnels?per_page=1` and `&status=healthy`) instead of relying on the
 * length of a possibly-truncated list (getCloudflaredTunnels above caps at
 * 250 tunnels; this is exact regardless of fleet size).
 */
export async function getCloudflaredTunnelCounts(
  token: string, accountId: string
): Promise<{ total: number; healthy: number }> {
  try {
    const [totalRes, healthyRes] = await Promise.all([
      cfGetPaged<CfTunnel[]>(token, `/accounts/${accountId}/cfd_tunnel?per_page=1&is_deleted=false`),
      cfGetPaged<CfTunnel[]>(token, `/accounts/${accountId}/cfd_tunnel?per_page=1&is_deleted=false&status=healthy`),
    ]);
    return {
      total: totalRes.ok ? (totalRes.totalCount ?? 0) : 0,
      healthy: healthyRes.ok ? (healthyRes.totalCount ?? 0) : 0,
    };
  } catch { return { total: 0, healthy: 0 }; }
}

// ─── Tunnel Routes ────────────────────────────────────────────────────────────

export interface CfTunnelRoute {
  network: string;
  tunnel_id?: string;
  tunnel_name?: string;
  comment?: string;
  virtual_network_id?: string;
}

export async function getTunnelRoutes(token: string, accountId: string): Promise<CfTunnelRoute[]> {
  try {
    const res = await cfGet<CfTunnelRoute[]>(token, `/accounts/${accountId}/teamnet/routes?per_page=500`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── DLP Profiles ────────────────────────────────────────────────────────────

export interface CfDlpProfile {
  id: string;
  name: string;
  type: "custom" | "predefined";
  entries?: Array<{ id: string; name: string; enabled: boolean }>;
}

export async function getDlpProfiles(token: string, accountId: string): Promise<CfDlpProfile[]> {
  try {
    const res = await cfGet<CfDlpProfile[]>(token, `/accounts/${accountId}/dlp/profiles`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── MCP Server Portals (AI Controls) ─────────────────────────────────────────
/**
 * MCP server portals are a distinct resource from regular Access apps — they
 * live under /access/ai-controls/mcp/portals rather than /access/apps.
 * This is a newer (Aug 2025) surface; wrapped in try/catch since availability
 * may vary by plan/account and the endpoint could change.
 * https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/
 */
export interface CfMcpPortal {
  id: string;
  name: string;
  hostname: string;
}

export async function getMcpPortals(token: string, accountId: string): Promise<CfMcpPortal[]> {
  try {
    const res = await cfGet<CfMcpPortal[]>(token, `/accounts/${accountId}/access/ai-controls/mcp/portals`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Access Users (seats / licensing) ─────────────────────────────────────────
/**
 * Real per-user seat + last-login data, confirmed live via
 * GET /accounts/{id}/access/users. Fields confirmed on a real account:
 * id, uid, name, email, last_successful_login, access_seat (bool),
 * gateway_seat (bool), seat_uid. This is the only source for real seat
 * counts / license utilization — no GraphQL dataset covers this.
 * NOTE: Cloudflare requires `per_page` to be a multiple of 5 on this
 * endpoint (confirmed live via a real 400 error) — use 200.
 */
export interface CfAccessUser {
  id: string;
  uid: string;
  name?: string;
  email: string;
  last_successful_login?: string;
  access_seat?: boolean;
  gateway_seat?: boolean;
}

/**
 * Returns a sample of users (bounded, used to compute seat-flag/last-login
 * aggregates) plus the REAL total seat count from `result_info.total_count`.
 *
 * Two bugs fixed here, both confirmed live on a real account (1,921 total
 * access/gateway seats):
 *   1. Missing `seat_type=any` — the dashboard's own seat-listing call uses
 *      this param; without it this endpoint can silently omit users who
 *      only hold a gateway seat (no access seat).
 *   2. The old 1,000-user hard cap (5 pages × 200) meant `seatsTotal` was
 *      computed as `distinct emails in the fetched sample` instead of the
 *      real total — always wrong on any account with >1,000 seats.
 * `seatsTotal` itself should always use the returned `totalCount` (exact);
 * per-user aggregates (active-in-period, never-logged-in, access/gateway
 * seat split) are computed from the sample and are only approximate on
 * accounts whose true seat count exceeds the sample cap below.
 */
export async function getAccessUsers(
  token: string, accountId: string
): Promise<{ users: CfAccessUser[]; totalCount: number }> {
  try {
    const out: CfAccessUser[] = [];
    let page = 1;
    let totalCount = 0;
    // Cap at 5,000 users (5 pages of 1,000) to bound cost on very large orgs.
    while (page <= 5) {
      const res = await cfGetPaged<CfAccessUser[]>(
        token, `/accounts/${accountId}/access/users?seat_type=any&per_page=1000&page=${page}`
      );
      const batch = res.ok && Array.isArray(res.data) ? res.data : [];
      if (res.totalCount !== undefined) totalCount = res.totalCount;
      out.push(...batch);
      if (batch.length < 1000) break;
      page++;
    }
    return { users: out, totalCount: totalCount || out.length };
  } catch { return { users: [], totalCount: 0 }; }
}

// ─── CASB Findings (Data Security Posture) ────────────────────────────────────
/**
 * Confirmed live: GET /accounts/{id}/data-security/posture/findings returns
 * `{ success: true, result: [] }` on an account without CASB integrations
 * configured — a real, honest empty state (not an error) rather than a
 * guessed/nonexistent endpoint.
 */
export interface CfCasbFinding {
  id?: string;
  integration_id?: string;
  severity?: string;
  type?: string;
  resource_name?: string;
  [key: string]: unknown;
}

export async function getCasbFindings(token: string, accountId: string): Promise<CfCasbFinding[]> {
  try {
    const res = await cfGet<CfCasbFinding[]>(token, `/accounts/${accountId}/data-security/posture/findings?per_page=50`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Alert History ─────────────────────────────────────────────────────────────
/**
 * Confirmed live: GET /accounts/{id}/alerting/v3/history. Real fields:
 * id, name, description, alert_type, mechanism, mechanism_type, policy_id,
 * sent, silenced. Account-wide (not ZT-specific) — surfaced as a lightweight
 * "recent alerts" list in the report rather than a dedicated deep feature.
 * NOTE: per_page must be a multiple of 5 (confirmed live via a real 400).
 */
export interface CfAlertHistoryItem {
  id: string;
  name: string;
  description?: string;
  alert_type: string;
  mechanism_type?: string;
  sent: string;
  silenced?: boolean;
}

export async function getAlertsHistory(token: string, accountId: string, limit = 25): Promise<CfAlertHistoryItem[]> {
  try {
    const res = await cfGet<CfAlertHistoryItem[]>(token, `/accounts/${accountId}/alerting/v3/history?per_page=${limit}`);
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
}

// ─── Account Audit Logs (configuration drift) ─────────────────────────────────
/**
 * Confirmed live: GET /accounts/{id}/logs/audit?since=X&before=Y. Real
 * response shape: { id, account:{id,name}, action:{description,result,time,
 * type}, actor:{id,context,email,ip_address,type}, resource:{id,product,type},
 * zone:{id,name} }. `since`/`before` accept RFC3339 or a plain date.
 * https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/list/
 *
 * Used to answer "what Zero-Trust-relevant configuration changed in this
 * report period" — filtered client-side to a set of known ZT product slugs,
 * since the REST endpoint's `resource.product` filter values aren't
 * independently documented and filtering post-fetch is safer than guessing
 * an unverified query-param value.
 */
export interface CfAuditLogEntry {
  id: string;
  action: { description?: string; result?: string; time: string; type?: string };
  actor: { email?: string; type?: string; context?: string };
  resource?: { product?: string; type?: string };
}

const ZT_AUDIT_PRODUCTS = new Set([
  "access", "gateway", "teams", "dlp", "casb", "warp", "zerotrust",
  "zero_trust", "tunnel", "cfd_tunnel", "dex", "waf_tls_client_certificates",
]);

export async function getAccountAuditLogs(
  token: string,
  accountId: string,
  since: string,
  before: string,
  maxPages = 3
): Promise<CfAuditLogEntry[]> {
  try {
    const out: CfAuditLogEntry[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ since, before });
      if (cursor) params.set("cursor", cursor);
      const res = await cfGet<CfAuditLogEntry[]>(
        token,
        `/accounts/${accountId}/logs/audit?${params.toString()}`
      );
      if (!res.ok || !Array.isArray(res.data)) break;
      out.push(...res.data);
      if (res.data.length === 0) break;
      // cursor pagination — result_info.cursor isn't surfaced by cfGet's
      // plain RestResult; stop after the first page rather than guess at an
      // undocumented shape. maxPages effectively caps at 1 for now.
      break;
    }
    return out.filter((e) => {
      const product = (e.resource?.product ?? "").toLowerCase();
      return ZT_AUDIT_PRODUCTS.has(product);
    });
  } catch { return []; }
}

// ─── DEX — Digital Experience Monitoring (device/network health) ─────────────
/**
 * Confirmed live: GET /accounts/{id}/dex/fleet-status/live?since_minutes=60.
 * Real response shape: { deviceStats: { byColo, byMode, byPlatform, byStatus,
 * byVersion, uniqueDevicesTotal } }, each breakdown an array of
 * { value, uniqueDevicesTotal }. This is LIVE telemetry (up to 60 minutes
 * back) — a device-health snapshot, not a historical time series over the
 * report window. Requires "Cloudflare DEX Read" or "Zero Trust Read" token
 * permission; on accounts without DEX/WARP client telemetry configured this
 * returns an empty/zeroed result, not an error.
 * https://developers.cloudflare.com/api/resources/zero_trust/subresources/dex/subresources/fleet_status/methods/live/
 */
export interface DexLiveStat { value: string; uniqueDevicesTotal: number }
export interface DexFleetStatusLive {
  uniqueDevicesTotal: number;
  byColo: DexLiveStat[];
  byMode: DexLiveStat[];
  byPlatform: DexLiveStat[];
  byStatus: DexLiveStat[];
  byVersion: DexLiveStat[];
}

export async function getDexFleetStatusLive(
  token: string,
  accountId: string,
  sinceMinutes = 60
): Promise<DexFleetStatusLive | null> {
  try {
    const res = await cfGet<{ deviceStats?: DexFleetStatusLive }>(
      token,
      `/accounts/${accountId}/dex/fleet-status/live?since_minutes=${sinceMinutes}`
    );
    if (!res.ok || !res.data?.deviceStats) return null;
    const d = res.data.deviceStats;
    return {
      uniqueDevicesTotal: d.uniqueDevicesTotal ?? 0,
      byColo: d.byColo ?? [],
      byMode: d.byMode ?? [],
      byPlatform: d.byPlatform ?? [],
      byStatus: d.byStatus ?? [],
      byVersion: d.byVersion ?? [],
    };
  } catch { return null; }
}
