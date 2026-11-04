/**
 * Sends scheduled report emails via the Cloudflare Email Sending binding
 * (`[[send_email]]` in wrangler.toml — no API keys needed).
 *
 * - Recipient addressing: a single recipient goes in `to`; multiple
 *   recipients are sent via `bcc` (with the sender's own address in `to`,
 *   which the API requires) so clients never see each other.
 * - Transient failures (E_RATE_LIMIT_EXCEEDED, E_DELIVERY_FAILED) are
 *   retried with backoff per the Email Sending guidance; all other errors
 *   fail fast.
 *
 * The `from` domain must be onboarded to Email Sending:
 *   npx wrangler email sending enable <domain>
 */

import type { Env } from "../types";

export interface SendReportEmailParams {
  to: string[];          // recipient addresses (max 50 combined to+cc+bcc)
  subject: string;
  html: string;
  text: string;
  /** Sender address override (from Settings) — defaults to env.EMAIL_FROM */
  from?: string;
  /**
   * File attachments — e.g. the full-report HTML document (the complete
   * report rendered for the browser, attached alongside the email-safe
   * digest body). Disposition "attachment" (not inline).
   */
  attachments?: {
    filename: string;
    type: string;
    content: string | Uint8Array;
  }[];
}

export interface SendReportEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

const SENDER_NAME = "Cloudflare Report Builder";

// Email Sending error codes worth retrying (per the docs: retry these with
// exponential backoff; validation/sender errors will never succeed on retry).
const RETRYABLE_CODES = new Set(["E_RATE_LIMIT_EXCEEDED", "E_DELIVERY_FAILED"]);
const RETRY_DELAYS_MS = [1_000, 4_000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendReportEmail(
  env: Env,
  p: SendReportEmailParams
): Promise<SendReportEmailResult> {
  const from = p.from || env.EMAIL_FROM || "reports@example.com";

  if (!env.EMAIL) {
    return { ok: false, error: "EMAIL binding not configured on the Worker" };
  }
  if (p.to.length === 0) {
    return { ok: false, error: "No recipients configured" };
  }

  // Multiple recipients → BCC (sender's own address satisfies the required
  // `to` field); single recipient → direct `to`.
  const isMulti = p.to.length > 1;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await env.EMAIL.send({
        to: isMulti ? from : p.to[0],
        bcc: isMulti ? p.to : undefined,
        from: { email: from, name: SENDER_NAME },
        subject: p.subject,
        html: p.html,
        text: p.text,
        ...(p.attachments?.length
          ? {
              attachments: p.attachments.map((a) => ({
                disposition: "attachment" as const,
                filename: a.filename,
                type: a.type,
                content: a.content,
              })),
            }
          : {}),
      });
      return { ok: true, messageId: response.messageId };
    } catch (e) {
      // Email Sending throws Error objects carrying E_* codes, e.g.
      // E_SENDER_NOT_VERIFIED (domain not onboarded), E_RECIPIENT_SUPPRESSED.
      const err = e as { code?: string; message?: string };
      const detail = err.code ? `${err.code}: ${err.message ?? ""}` : String(e);

      const canRetry = attempt < RETRY_DELAYS_MS.length && err.code !== undefined && RETRYABLE_CODES.has(err.code);
      if (!canRetry) {
        console.error("[email] send failed:", detail);
        return { ok: false, error: detail };
      }
      console.warn(`[email] retryable failure (attempt ${attempt + 1}): ${detail}`);
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }

  return { ok: false, error: "unreachable" };
}
