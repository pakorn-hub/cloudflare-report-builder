/**
 * Backend settings — dashboard-managed overrides for the Worker's
 * env/secret configuration.
 *
 * Precedence per setting: D1 `settings` row (set via the dashboard) →
 * Worker env (CF_API_TOKEN secret / CF_ACCOUNT_ID & EMAIL_FROM vars) → none.
 *
 * The scheduler and the schedule zone picker both resolve their credentials
 * through getEffectiveBackendConfig() so a token rotated in the dashboard
 * takes effect on the very next run without a redeploy.
 */

import type { Env } from "../types";

export const SETTING_KEYS = {
  cfApiToken: "cf_api_token",
  cfAccountId: "cf_account_id",
  emailFrom: "email_from",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface StoredSettings {
  cfApiToken: string | null;
  cfAccountId: string | null;
  emailFrom: string | null;
}

export interface EffectiveBackendConfig {
  token: string;
  accountId: string;
  emailFrom: string;
  tokenSource: "d1" | "secret" | "none";
  accountSource: "d1" | "env" | "none";
  emailSource: "d1" | "env" | "default";
}

/** Raw values stored in D1 (never leaves the backend as-is). */
export async function getStoredSettings(env: Env): Promise<StoredSettings> {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM settings"
  ).all<{ key: string; value: string }>();

  const map = new Map((results ?? []).map((r) => [r.key, r.value]));
  return {
    cfApiToken: map.get(SETTING_KEYS.cfApiToken) ?? null,
    cfAccountId: map.get(SETTING_KEYS.cfAccountId) ?? null,
    emailFrom: map.get(SETTING_KEYS.emailFrom) ?? null,
  };
}

/** Upsert one setting; value === null deletes the row (falls back to env). */
export async function saveSetting(env: Env, key: SettingKey, value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, value, new Date().toISOString())
    .run();
}

/**
 * The credentials the scheduled report runner and zone picker actually use.
 * D1-stored dashboard settings take precedence; Worker env is the fallback.
 */
export async function getEffectiveBackendConfig(env: Env): Promise<EffectiveBackendConfig> {
  const stored = await getStoredSettings(env);

  const token = stored.cfApiToken ?? env.CF_API_TOKEN ?? "";
  const accountId = stored.cfAccountId ?? env.CF_ACCOUNT_ID ?? "";
  const emailFrom = stored.emailFrom ?? env.EMAIL_FROM ?? "reports@example.com";

  return {
    token,
    accountId,
    emailFrom,
    tokenSource: stored.cfApiToken ? "d1" : env.CF_API_TOKEN ? "secret" : "none",
    accountSource: stored.cfAccountId ? "d1" : env.CF_ACCOUNT_ID ? "env" : "none",
    emailSource: stored.emailFrom ? "d1" : env.EMAIL_FROM ? "env" : "default",
  };
}
