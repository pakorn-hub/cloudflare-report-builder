/**
 * BackendSettingsForm — dashboard-managed backend configuration.
 *
 * Lets the operator set the report-generation API token, the target account,
 * and the sender address without touching wrangler secrets or redeploying.
 * Values are stored in D1 and override the Worker's env secret/vars; the
 * full token is never returned by the API (masked hint only).
 */
import { useEffect, useState } from "react";
import {
  Key, Building, Mail, AlertCircle, CheckCircle, Loader2, Eye, EyeOff,
  ShieldCheck, ArrowLeft, Settings as SettingsIcon, X,
} from "lucide-react";
import type { BackendSettingsState } from "../types";
import {
  fetchBackendSettings, saveBackendSettings, testBackendConnection,
  type ConnectionTestResult,
} from "../services/api";

interface Props {
  onDone: () => void;
  /** Called after a successful save — lets the page invalidate its zone cache. */
  onSaved: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  d1: "set via dashboard",
  secret: "Worker secret (wrangler)",
  env: "Worker var (wrangler.toml)",
  none: "not set",
  default: "built-in default",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function BackendSettingsForm({ onDone, onSaved }: Props) {
  const [state, setState] = useState<BackendSettingsState | null>(null);
  const [loadError, setLoadError] = useState("");

  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [clearToken, setClearToken] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [emailFrom, setEmailFrom] = useState("");

  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string; warning?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBackendSettings()
      .then((s) => {
        if (cancelled) return;
        setState(s);
        setAccountId(s.accountId ?? "");
        setEmailFrom(s.emailFrom ?? "");
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load settings.");
      });
    return () => { cancelled = true; };
  }, []);

  const tokenDirty = clearToken || token.trim().length > 0;

  async function handleSave() {
    setFormError("");
    setNotice(null);
    if (!state) return;

    const update: Record<string, string | null> = {};

    if (clearToken) {
      update.cfApiToken = null;
    } else if (token.trim()) {
      if (token.trim().length < 10) { setFormError("API token looks too short to be valid."); return; }
      update.cfApiToken = token.trim();
    }
    if (accountId.trim() !== (state.accountId ?? "")) {
      if (accountId.trim() && !/^[a-f0-9]{32}$/i.test(accountId.trim())) {
        setFormError("Account ID must be a 32-character hex string.");
        return;
      }
      update.cfAccountId = accountId.trim() || null;
    }
    if (emailFrom.trim() !== (state.emailFrom ?? "")) {
      if (emailFrom.trim() && (!EMAIL_RE.test(emailFrom.trim()) || emailFrom.trim().length > 254)) {
        setFormError("Sender address must be a valid email.");
        return;
      }
      update.emailFrom = emailFrom.trim() || null;
    }

    if (Object.keys(update).length === 0) {
      setNotice({ kind: "ok", text: "No changes to save." });
      return;
    }

    setSaving(true);
    try {
      const next = await saveBackendSettings(update);
      setState(next);
      setAccountId(next.accountId ?? "");
      setEmailFrom(next.emailFrom ?? "");
      setToken("");
      setClearToken(false);
      setTestResult(null);
      setNotice({ kind: "ok", text: "Settings saved — applies to the next scheduled run or zone lookup." });
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r: ConnectionTestResult = await testBackendConnection();
      setTestResult({
        ok: true,
        text: `Connected to "${r.accountName ?? "account"}"${typeof r.zonesVisible === "number" ? ` — ${r.zonesVisible} active zone${r.zonesVisible !== 1 ? "s" : ""} visible` : ""}`,
        warning: r.zonesWarning ?? undefined,
      });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Connection test failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ backgroundColor: "#ffffff", border: "1px solid #e2e2e2", borderTop: "3px solid #ba0816", padding: 28 }}>

      <div className="flex items-center gap-3 mb-6">
        <div style={{ width: 40, height: 2, backgroundColor: "#ba0816" }} />
        <span style={{ fontSize: 11, letterSpacing: "0.09375rem", textTransform: "uppercase", color: "#5d5e65" }}>
          Backend Settings
        </span>
      </div>

      {loadError && (
        <div className="flex items-start gap-3 mb-6 p-4" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
          <AlertCircle size={14} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: "#7f1d1d" }}>{loadError}</p>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-3 mb-6 p-4" style={{
          backgroundColor: notice.kind === "ok" ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${notice.kind === "ok" ? "#bbf7d0" : "#fecaca"}`,
        }}>
          <CheckCircle size={14} style={{ color: "#15803d", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: "#14532d" }}>{notice.text}</p>
          <button onClick={() => setNotice(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#5d5e65" }}>
            <X size={13} />
          </button>
        </div>
      )}

      {formError && (
        <div className="flex items-start gap-3 mb-6 p-4" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
          <AlertCircle size={14} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: "#7f1d1d" }}>{formError}</p>
        </div>
      )}

      {/* Current state summary */}
      {state && (
        <div className="p-4 mb-6" style={{ backgroundColor: "#1c1f2a", borderLeft: "4px solid #ba0816" }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <SettingsIcon size={13} style={{ color: "#ba0816" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#f4f4f4", textTransform: "uppercase", letterSpacing: "0.09375rem" }}>
              Current configuration
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 5, columnGap: 16 }}>
            <span style={sumLabel}>API token</span>
            <span style={sumValue}>
              {state.tokenSet
                ? (state.tokenSource === "d1" ? `dashboard — ${state.tokenHint}` : SOURCE_LABEL[state.tokenSource])
                : "not set — scheduled runs will fail"}
            </span>
            <span style={sumLabel}>Account</span>
            <span style={sumValue}>
              {state.accountId ? `${state.accountId} (${SOURCE_LABEL[state.accountSource]})` : "not set"}
            </span>
            <span style={sumLabel}>Sender</span>
            <span style={sumValue}>{state.emailFrom} ({SOURCE_LABEL[state.emailSource]})</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">

        {/* API token */}
        <div>
          <label className="ar-input-label"><Key size={10} style={{ display: "inline", marginRight: 4 }} /> Cloudflare API Token</label>
          <div style={{ position: "relative" }}>
            <input
              type={showToken ? "text" : "password"}
              value={clearToken ? "" : token}
              onChange={(e) => { setToken(e.target.value); setClearToken(false); }}
              disabled={clearToken}
              placeholder={clearToken
                ? "Will be cleared — Worker secret becomes the fallback"
                : state?.tokenSource === "d1"
                  ? `Current: ${state.tokenHint} — leave empty to keep`
                  : state?.tokenSource === "secret"
                    ? "Worker secret active — leave empty to keep, type to override"
                    : "Paste a token with the report-builder permissions"}
              className="ar-input"
              style={{ paddingRight: 44, fontFamily: "monospace", opacity: clearToken ? 0.5 : 1 }}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowToken((s) => !s)} disabled={clearToken}
              style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#5d5e65" }}>
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {state?.tokenSource === "d1" && (
            <button type="button" onClick={() => { setClearToken((c) => !c); setToken(""); }}
              style={{ marginTop: 8, fontSize: 11, background: "none", border: "none", cursor: "pointer", color: clearToken ? "#15803d" : "#d51121", padding: 0 }}>
              {clearToken ? "↩ Keep the dashboard-stored token" : "Clear dashboard token (fall back to Worker secret)"}
            </button>
          )}
          <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 6, lineHeight: 1.5 }}>
            Used by scheduled report runs and the zone picker. Never shown again after saving.
          </p>
        </div>

        {/* Account ID */}
        <div>
          <label className="ar-input-label"><Building size={10} style={{ display: "inline", marginRight: 4 }} /> Account ID</label>
          <input
            type="text" value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder={state?.accountSource === "env" ? `${state.accountId ?? ""} (from Worker var — leave empty to keep)` : "32-character hex account ID"}
            className="ar-input" maxLength={32} style={{ fontFamily: "monospace" }}
          />
          <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 4 }}>
            The account the scheduled reports are generated from.
          </p>
        </div>

        {/* Sender address */}
        <div>
          <label className="ar-input-label"><Mail size={10} style={{ display: "inline", marginRight: 4 }} /> Sender Address</label>
          <input
            type="text" value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="reports@example.com"
            className="ar-input" maxLength={254}
          />
          <p style={{ fontSize: 11, color: "#5d5e65", marginTop: 4 }}>
            Emails are sent from this address — its domain must be onboarded to Cloudflare Email Sending.
          </p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className="p-4" style={{
            backgroundColor: testResult.ok ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${testResult.ok ? "#bbf7d0" : "#fecaca"}`,
          }}>
            <div className="flex items-start gap-3">
              {testResult.ok
                ? <ShieldCheck size={14} style={{ color: "#15803d", flexShrink: 0, marginTop: 1 }} />
                : <AlertCircle size={14} style={{ color: "#d51121", flexShrink: 0, marginTop: 1 }} />}
              <div>
                <p style={{ fontSize: 12, color: testResult.ok ? "#14532d" : "#7f1d1d" }}>{testResult.text}</p>
                {testResult.warning && (
                  <p style={{ fontSize: 11, color: "#7f1d1d", marginTop: 6 }}>{testResult.warning}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 6 }}>
          <button type="button" onClick={handleSave} disabled={saving || !state} className="ar-btn" style={{ flex: 1, padding: "15px 24px 13px", minWidth: 180 }}>
            {saving
              ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
              : <><CheckCircle size={13} /> Save Settings</>}
          </button>
          <button type="button" onClick={handleTest} disabled={testing || !state} className="ar-btn-light" style={{ padding: "15px 24px 13px" }}>
            {testing
              ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Testing…</>
              : <><ShieldCheck size={13} /> Test Connection</>}
          </button>
          <button type="button" onClick={onDone} className="ar-btn-ghost" style={{ padding: "15px 24px 13px" }}>
            <ArrowLeft size={13} /> Back
          </button>
        </div>

        <p style={{ fontSize: 11, color: "#5d5e65", lineHeight: 1.6, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
          Values are stored in the D1 <code style={{ fontFamily: "monospace" }}>settings</code> table and override the
          Worker's env secret/vars — no redeploy needed to rotate the token. The token is stored as-is, so keep this
          dashboard behind Cloudflare Access. These are the <strong>fallback</strong> credentials: any schedule that
          carries its own customer credentials (multi-customer) uses those instead.
        </p>
      </div>
    </div>
  );
}

const sumLabel: React.CSSProperties = {
  fontSize: 11, color: "rgba(244,244,244,0.5)", textTransform: "uppercase", letterSpacing: "0.05em",
};
const sumValue: React.CSSProperties = {
  fontSize: 12, color: "rgba(244,244,244,0.85)", fontFamily: "monospace",
};
