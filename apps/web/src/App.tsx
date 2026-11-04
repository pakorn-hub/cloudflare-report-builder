import { useState, useEffect } from "react";
import HomePage from "./pages/HomePage";
import ReportPage from "./pages/ReportPage";
import ZeroTrustReportPage from "./pages/ZeroTrustReportPage";
import MagicTransitReportPage from "./pages/MagicTransitReportPage";
import CustomDashboardPage from "./pages/CustomDashboardPage";
import type { MagicTransitData } from "../../../shared/magic-transit";
import type { DashboardSnapshot } from "../../../shared/custom-dashboard";
import SchedulesPage from "./pages/SchedulesPage";
import { fetchAppsecData, fetchZeroTrustData, fetchMagicTransitData, fetchUserEmail } from "./services/api";
import { ACCESS_EXPIRED_EVENT, reauthenticateNow } from "./services/access-reauth";
import type { AppSecData, ZeroTrustData, ReportInput } from "./types";

type Phase = "home" | "loading" | "report" | "schedules" | "custom-dashboard";

/**
 * EMBEDDED REPORT — set by scheduled-email attachments: the single-chunk app
 * bundle (vite.static.config.ts) plus the generated report data inlined into
 * one self-contained HTML file. When present, the app boots straight into the
 * report — the exact same components the on-demand page renders — with no
 * network access: the recipient's browser does the rendering at open time.
 */
export interface EmbeddedReport {
  kind: "appsec" | "zero-trust" | "magic-transit" | "custom-dashboard";
  data: unknown;
  input: ReportInput;
  aiSummary?: string;
  generatedAt: string;
  scheduleName: string;
}

const EMBEDDED_REPORT =
  typeof window !== "undefined"
    ? (window as { __EMBEDDED_REPORT__?: EmbeddedReport }).__EMBEDDED_REPORT__
    : undefined;

export default function App() {
  const [mtData, setMtData] = useState<MagicTransitData | null>(EMBEDDED_REPORT?.kind === "magic-transit" ? EMBEDDED_REPORT.data as MagicTransitData : null);
  const [phase, setPhase]             = useState<Phase>(EMBEDDED_REPORT ? "report" : "home");
  const [error, setError]             = useState<string>("");
  const [appsecData, setAppsecData]   = useState<AppSecData | null>(
    EMBEDDED_REPORT?.kind === "appsec" ? (EMBEDDED_REPORT.data as AppSecData) : null
  );
  const [ztData, setZtData]           = useState<ZeroTrustData | null>(
    EMBEDDED_REPORT?.kind === "zero-trust" ? (EMBEDDED_REPORT.data as ZeroTrustData) : null
  );
  const [reportInput, setReportInput] = useState<ReportInput | null>(EMBEDDED_REPORT?.input ?? null);
  const [userEmail, setUserEmail]     = useState<string | null>(null);
  const [accessExpired, setAccessExpired] = useState(false);

  // Skipped in embedded (scheduled attachment) mode: there is no backend to
  // ask, and no session either — the report renders straight from the
  // embedded data.
  useEffect(() => {
    if (EMBEDDED_REPORT) return;
    fetchUserEmail().then(setUserEmail).catch(() => setUserEmail(null));
  }, []);

  // Fired by access-reauth.ts when an Access login redirect is detected but
  // the automatic re-login navigation was already spent for this expiry
  // episode — the session is dead and needs a deliberate user action.
  useEffect(() => {
    const onExpired = () => setAccessExpired(true);
    window.addEventListener(ACCESS_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(ACCESS_EXPIRED_EVENT, onExpired);
  }, []);

  async function handleSubmit(input: ReportInput) {
    setPhase("loading");
    setError("");
    setReportInput(input);
    try {
      setAppsecData(null); setZtData(null); setMtData(null);
      if (input.product === "magic-transit") {
        setMtData(await fetchMagicTransitData(input));
      } else if (input.product === "zero-trust") {
        const data = await fetchZeroTrustData(input);
        setZtData(data);
        setAppsecData(null);
      } else {
        const data = await fetchAppsecData(input);
        setAppsecData(data);
        setZtData(null);
      }
      setPhase("report");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data. Check your token and IDs.");
      setPhase("home");
    }
  }

  function handleReset() {
    setMtData(null);
    setAppsecData(null);
    setZtData(null);
    setReportInput(null);
    setError("");
    setPhase("home");
  }

  if (EMBEDDED_REPORT?.kind === "custom-dashboard") {
    return <CustomDashboardPage onBack={handleReset} initialData={EMBEDDED_REPORT.data as DashboardSnapshot} embedded />;
  }
  if (phase === "custom-dashboard") {
    return <><CustomDashboardPage onBack={handleReset} onOpenSchedules={() => setPhase("schedules")} />{accessExpired && <AccessExpiredOverlay />}</>;
  }

  if (phase === "schedules") {
    return (
      <>
        <SchedulesPage userEmail={userEmail} onBack={() => setPhase("home")} />
        {accessExpired && <AccessExpiredOverlay />}
      </>
    );
  }

  if (phase === "report" && reportInput) {
    if (reportInput.product === "magic-transit" && mtData) {
      return <><MagicTransitReportPage data={mtData} input={reportInput} onReset={handleReset} userEmail={userEmail} />{accessExpired && <AccessExpiredOverlay />}</>;
    }
    if (reportInput.product === "zero-trust" && ztData) {
      return (
        <>
          <ZeroTrustReportPage data={ztData} input={reportInput} onReset={handleReset} userEmail={userEmail} />
          {accessExpired && <AccessExpiredOverlay />}
        </>
      );
    }
    if (appsecData) {
      return (
        <>
          <ReportPage data={appsecData} input={reportInput} onReset={handleReset} userEmail={userEmail} />
          {accessExpired && <AccessExpiredOverlay />}
        </>
      );
    }
  }

  return (
    <>
      <HomePage
        onSubmit={handleSubmit}
        loading={phase === "loading"}
        error={error}
        userEmail={userEmail}
        onOpenSchedules={() => setPhase("schedules")}
        onOpenCustomDashboard={() => setPhase("custom-dashboard")}
      />
      {accessExpired && <AccessExpiredOverlay />}
    </>
  );
}

/**
 * Blocking overlay shown when the Cloudflare Access session is expired and
 * the automatic re-login navigation was already spent for this expiry
 * episode. Until the user re-authenticates, every API call will keep
 * failing, so there is nothing else useful to do on this page.
 */
function AccessExpiredOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          background: "#fff",
          borderRadius: 12,
          padding: "28px 32px",
          boxShadow: "0 20px 50px rgba(2, 6, 23, 0.35)",
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
          Session expired
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.5, color: "#475569" }}>
          This dashboard is protected by Cloudflare Access and your login session has
          expired, so report generation is unavailable until you log in again. You will
          return here automatically afterwards.
        </p>
        <button
          onClick={() => reauthenticateNow()}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "#f97316",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Log in again
        </button>
      </div>
    </div>
  );
}
