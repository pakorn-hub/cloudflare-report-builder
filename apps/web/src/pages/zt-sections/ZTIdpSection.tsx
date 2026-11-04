import { Key } from "lucide-react";
import type { ZeroTrustData } from "../../types";
import SectionHeader from "../../components/SectionHeader";

const IDP_TYPE_LABELS: Record<string, string> = {
  google: "Google Workspace", azure_ad: "Microsoft Azure AD", okta: "Okta",
  github: "GitHub", saml: "SAML 2.0", oidc: "OpenID Connect",
  otp: "One-Time PIN", linkedin: "LinkedIn", facebook: "Facebook",
  jumpcloud: "JumpCloud", ping_identity: "Ping Identity",
  centrify: "Centrify", yandex: "Yandex",
};

export default function ZTIdpSection({ data }: { data: ZeroTrustData }) {
  const idps     = data.accessIdps;
  const policies = data.accessPolicies;
  if (idps.length === 0) return null;

  const mfaCount  = policies.filter((p) => p.requireMfa).length;
  const appCount  = data.accessApps.length;

  return (
    <section className="report-section">
      <SectionHeader icon={<Key size={20}/>} title="Identity Providers & Authentication"
        subtitle="Connected identity providers, MFA coverage, and session configuration" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        {[
          { label: "Identity Providers", value: idps.length,    color: "#3B82F6" },
          { label: "Policies with MFA",  value: mfaCount,       color: mfaCount > 0 ? "#10B981" : "#EF4444" },
          { label: "Apps Protected",     value: appCount,        color: "#8B5CF6" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* IdP cards */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-4">Connected Identity Providers</h3>
          <div className="space-y-3">
            {idps.map((idp) => (
              <div key={idp.id} className="flex items-center gap-3 p-3 rounded-lg bg-cf-gray-50 border border-cf-gray-200">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center">
                  <span className="text-blue-600 font-bold text-[10px]">{idp.type.slice(0,2).toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-cf-navy">{idp.name}</p>
                  <p className="text-[10px] text-cf-gray-500">{IDP_TYPE_LABELS[idp.type] ?? idp.type.toUpperCase()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* MFA coverage */}
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-5">
          <h3 className="text-sm font-semibold text-cf-navy mb-4">MFA Coverage by Application</h3>
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 280 }}>
            {data.accessApps.map((app) => {
              const appPols = policies.filter((p) => p.appId === app.id);
              const hasMfa  = appPols.some((p) => p.requireMfa);
              return (
                <div key={app.id} className="flex items-center justify-between py-1.5 border-b border-cf-gray-100 last:border-0">
                  <span className="text-xs text-cf-navy font-medium">{app.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${hasMfa ? "bg-green-50 text-green-600 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                    {hasMfa ? "MFA Required" : "No MFA"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
