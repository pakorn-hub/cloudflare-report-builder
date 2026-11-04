/**
 * AI Crawl Control — official bot reference data.
 * Mirrors https://developers.cloudflare.com/ai-crawl-control/reference/bots/
 *
 * IMPORTANT: This is the detection method Cloudflare's own AI Crawl Control
 * product uses. `userAgent_like` works on ALL plans (no Bot Management
 * subscription required) — this is the primary/reliable signal for POC
 * reports. `detectionIds` are only populated for Bot Management subscribers
 * and are used as an opportunistic secondary signal (harder to spoof).
 */

export interface AiBotRef {
  name: string;
  operator: string;
  category: "AI Crawler" | "AI Assistant" | "AI Search";
  detectionIds: number[];
  userAgent: string;
}

export const AI_BOT_REFERENCE: AiBotRef[] = [
  { name: "GPTBot",                operator: "OpenAI",       category: "AI Crawler",   detectionIds: [123815556, 33563875], userAgent: "GPTBot" },
  { name: "ChatGPT-User",          operator: "OpenAI",       category: "AI Assistant", detectionIds: [132995013, 33563857], userAgent: "ChatGPT-User" },
  { name: "OAI-SearchBot",         operator: "OpenAI",       category: "AI Search",    detectionIds: [126255384, 33563986], userAgent: "OAI-SearchBot" },
  { name: "ClaudeBot",             operator: "Anthropic",    category: "AI Crawler",   detectionIds: [33563859],            userAgent: "ClaudeBot" },
  { name: "Claude-SearchBot",      operator: "Anthropic",    category: "AI Search",    detectionIds: [33564301],            userAgent: "Claude-SearchBot" },
  { name: "Claude-User",           operator: "Anthropic",    category: "AI Assistant", detectionIds: [33564303],            userAgent: "Claude-User" },
  { name: "PerplexityBot",         operator: "Perplexity",   category: "AI Search",    detectionIds: [33563889],            userAgent: "PerplexityBot" },
  { name: "Perplexity-User",       operator: "Perplexity",   category: "AI Assistant", detectionIds: [33564371],            userAgent: "Perplexity-User" },
  { name: "Google-CloudVertexBot", operator: "Google",       category: "AI Crawler",   detectionIds: [133730073, 33564321], userAgent: "Google-CloudVertexBot" },
  { name: "Bytespider",            operator: "ByteDance",    category: "AI Crawler",   detectionIds: [33563853],            userAgent: "Bytespider" },
  { name: "CCBot",                 operator: "Common Crawl", category: "AI Crawler",   detectionIds: [133621792, 33563855], userAgent: "CCBot" },
  { name: "Meta-ExternalAgent",    operator: "Meta",         category: "AI Crawler",   detectionIds: [124581738, 33563982], userAgent: "meta-externalagent" },
  { name: "Meta-ExternalFetcher",  operator: "Meta",         category: "AI Assistant", detectionIds: [132272919, 33563980], userAgent: "meta-externalfetcher" },
  { name: "FacebookBot",           operator: "Meta",         category: "AI Crawler",   detectionIds: [33563972],            userAgent: "FacebookBot" },
  { name: "Applebot",              operator: "Apple",        category: "AI Search",    detectionIds: [120424214, 33563845], userAgent: "Applebot" },
  { name: "Amazonbot",             operator: "Amazon",       category: "AI Crawler",   detectionIds: [118601807, 33563839], userAgent: "Amazonbot" },
  { name: "DuckAssistBot",         operator: "DuckDuckGo",   category: "AI Assistant", detectionIds: [126666910, 33564037], userAgent: "DuckAssistBot" },
  { name: "MistralAI-User",        operator: "Mistral",      category: "AI Assistant", detectionIds: [128950951, 33564323], userAgent: "MistralAI-User" },
];

/** Referrer domains by AI operator — for detecting AI-driven referral traffic. */
export const AI_REFERRAL_DOMAINS: Record<string, string[]> = {
  OpenAI:     ["openai.com", "chatgpt.com"],
  Anthropic:  ["anthropic.com", "claude.ai"],
  Perplexity: ["perplexity.ai"],
  Google:     ["gemini.google.com"],
  Microsoft:  ["copilot.microsoft.com"],
  Meta:       ["meta.ai"],
  DuckDuckGo: ["duckduckgo.com", "duck.com"],
  Mistral:    ["mistral.ai", "chat.mistral.ai"],
};

export function findBotByUserAgent(userAgent: string): AiBotRef | undefined {
  const ua = (userAgent ?? "").toLowerCase();
  return AI_BOT_REFERENCE.find((b) => ua.includes(b.userAgent.toLowerCase()));
}

export function findOperatorByRefererHost(host: string): string | undefined {
  const h = (host ?? "").toLowerCase();
  for (const [operator, domains] of Object.entries(AI_REFERRAL_DOMAINS)) {
    if (domains.some((d) => h === d || h.endsWith(`.${d}`))) return operator;
  }
  return undefined;
}
