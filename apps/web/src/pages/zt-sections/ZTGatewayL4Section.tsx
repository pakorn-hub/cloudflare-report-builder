import { Network } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";
import type { ZeroTrustData } from "../../types";
import { formatNumber, formatBytes, formatRate } from "../../utils/formatters";
import SectionHeader from "../../components/SectionHeader";

const COLORS = ["#3B82F6","#EF4444","#10B981","#F59E0B","#8B5CF6","#F97316","#6B7280","#EC4899"];

export default function ZTGatewayL4Section({ data }: { data: ZeroTrustData }) {
  const series    = data.gatewayL4TimeSeries ?? [];
  const blocked   = data.gatewayL4BlockedDestinations ?? [];
  const protocols = data.gatewayL4Protocols ?? [];
  const countries = data.gatewayL4SourceCountries ?? [];
  const ports     = data.gatewayL4PortBreakdown ?? [];
  const transportStatus = data.gatewayTransportStatusBreakdown ?? [];
  const tokenAuthStatus = data.gatewayTokenAuthStatusBreakdown ?? [];
  const topColos        = data.gatewayTopColos ?? [];
  const privateOrigins  = data.privateNetworkOrigins ?? [];
  const nslByOfframp    = data.gatewayNslByOfframp ?? [];
  const nslTopUsers     = data.gatewayNslTopUsers ?? [];
  const s         = data.summary;
  const bandwidthBytes = (s.gatewayBandwidthBytesSent ?? 0) + (s.gatewayBandwidthBytesRecvd ?? 0);

  const hasData = series.length > 0 || blocked.length > 0 || protocols.length > 0 || bandwidthBytes > 0 || privateOrigins.length > 0 || nslByOfframp.length > 0;
  if (!hasData) {
    return (
      <section className="report-section">
        <SectionHeader icon={<Network size={20}/>} title="Gateway — Network (L4) & Session Analytics"
          subtitle="Layer 4 network sessions, blocked IPs, protocols, and port distribution" />
        <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-8 text-center text-cf-gray-400 text-sm">
          No L4 session data detected. Deploy WARP or configure network policies to enable Gateway L4 filtering.
        </div>
      </section>
    );
  }

  const totalL4  = s.gatewayL4Sessions ?? 0;
  const totalBlk = s.gatewayL4Blocked  ?? 0;
  // Raw (unrounded) — see formatRate() for why the displayed value isn't
  // simply Math.round()'d to an integer.
  const blkPct   = totalL4 > 0 ? (totalBlk / totalL4) * 100 : 0;
  const retransmittedBytes = s.gatewayRetransmittedBytes ?? 0;

  // NOTE: bandwidth comes from a separate GraphQL dataset
  // (gatewayL4DownstreamSessionsAdaptiveGroups) than L4 session/block counts
  // (gatewayL4SessionsAdaptiveGroups) — the two can be non-zero independently,
  // since one measures private-network session policy hits and the other
  // measures raw downstream byte counters. Shown here as its own KPI, not
  // implied to be a per-session breakdown of the L4 sessions above.
  const kpis = [
    { label: "L4 Sessions", value: formatNumber(totalL4),  color: "#3B82F6" },
    { label: "Blocked",     value: formatNumber(totalBlk), color: "#EF4444" },
    { label: "Block Rate",  value: formatRate(totalBlk, totalL4), color: blkPct > 5 ? "#EF4444" : "#10B981" },
    { label: "Blocked IPs", value: String(blocked.length), color: "#F59E0B" },
    ...(bandwidthBytes > 0 ? [{ label: "Network Bandwidth", value: formatBytes(bandwidthBytes), color: "#14B8A6" }] : []),
    ...(retransmittedBytes > 0 ? [{ label: "Retransmitted", value: formatBytes(retransmittedBytes), color: retransmittedBytes / Math.max(bandwidthBytes, 1) > 0.05 ? "#EF4444" : "#9CA3AF" }] : []),
    ...((s.gatewayNslTotalBytes ?? 0) > 0 ? [{ label: "Total Session Bytes", value: formatBytes(s.gatewayNslTotalBytes!), color: "#0EA5E9" }] : []),
  ];

  return (
    <section className="report-section">
      <SectionHeader icon={<Network size={20}/>} title="Gateway — Network (L4) & Session Analytics"
        subtitle="Layer 4 network sessions, blocked IPs, protocols, port distribution, bandwidth, and session health" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {series.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Session Volume</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="l4T" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
                  <linearGradient id="l4B" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)}/>
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Area type="monotone" dataKey="total"   name="Total"   stroke="#3B82F6" fill="url(#l4T)" strokeWidth={2} dot={false}/>
                <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#EF4444" fill="url(#l4B)" strokeWidth={2} dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {protocols.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Transport Protocols</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={protocols} cx="50%" cy="45%" innerRadius={50} outerRadius={80}
                  paddingAngle={2} dataKey="count" nameKey="protocol"
                  label={({ protocol, percent }) => `${protocol} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {protocols.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {countries.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Source Countries</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={countries.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <YAxis type="category" dataKey="country" tick={{ fontSize: 10 }} width={36}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" radius={[0,4,4,0]}>{countries.slice(0,8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {ports.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
            <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Destination Ports</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ports.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                <YAxis type="category" dataKey="service" tick={{ fontSize: 10 }} width={56}/>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatNumber(v)}/>
                <Bar dataKey="count" radius={[0,4,4,0]}>{ports.slice(0,8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Network Session Log (NSL) — real bandwidth split by egress path
          (WARP client / Cloudflare Tunnel / direct Internet) and top
          bandwidth consumers. Mirrors the dashboard's own "Network sessions"
          card — a trust/adoption signal: how much traffic actually flows
          through Zero Trust egress paths vs. straight to the Internet. */}
      {(nslByOfframp.length > 0 || nslTopUsers.length > 0) && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {nslByOfframp.length > 0 && (() => {
            const total = nslByOfframp.reduce((sum, o) => sum + o.bytesTotal, 0);
            return (
              <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
                <h3 className="text-sm font-semibold text-cf-navy mb-3">Traffic by Egress Path</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={nslByOfframp} cx="50%" cy="45%" innerRadius={50} outerRadius={80}
                      paddingAngle={2} dataKey="bytesTotal" nameKey="offramp" label={false} labelLine={false}>
                      {nslByOfframp.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => formatBytes(v)}/>
                    <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 10 }}
                      formatter={(value: string) => {
                        const o = nslByOfframp.find((x) => x.offramp === value);
                        const pct = o && total > 0 ? Math.round((o.bytesTotal / total) * 100) : 0;
                        return `${value} (${pct}%)`;
                      }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
          {nslTopUsers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Users by Bandwidth</h3>
              <div className="space-y-1.5">
                {nslTopUsers.slice(0, 8).map((u) => (
                  <div key={u.email} className="flex items-center justify-between text-xs">
                    <span className="text-cf-gray-600 truncate font-mono pr-2">{u.email}</span>
                    <span className="font-mono font-semibold text-cf-navy flex-shrink-0">{formatBytes(u.bytesTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Network Session Analytics — mirrors Cloudflare's own "Network session
          analytics" dashboard (session health + top colos). Only rendered
          if the account actually uses WARP-routed network sessions — most
          accounts using only DNS/HTTP Gateway filtering will not have this
          data, which is an honest empty state, not a bug. */}
      {(topColos.length > 0 || transportStatus.length > 0 || tokenAuthStatus.length > 0) && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {topColos.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Top Cloudflare Locations (Ingress)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topColos.slice(0,8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9"/>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)}/>
                  <YAxis type="category" dataKey="colo" tick={{ fontSize: 10 }} width={46}/>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number, _n, p) => [formatNumber(v), p?.payload?.country]}/>
                  <Bar dataKey="count" radius={[0,4,4,0]}>{topColos.slice(0,8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {(transportStatus.length > 0 || tokenAuthStatus.length > 0) && (
            <div className="bg-white rounded-xl shadow-sm border border-cf-gray-200 p-4">
              <h3 className="text-sm font-semibold text-cf-navy mb-3">Session Health</h3>
              {transportStatus.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-2">Transport Status</p>
                  <div className="flex flex-wrap gap-2">
                    {transportStatus.map((t) => (
                      <div key={t.status} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cf-gray-200 bg-cf-gray-50">
                        <span className="text-xs font-medium text-cf-navy">{t.status}</span>
                        <span className="text-[10px] text-cf-gray-500 bg-cf-gray-200 px-1.5 py-0.5 rounded">{formatNumber(t.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tokenAuthStatus.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-cf-gray-500 uppercase tracking-wide mb-2">Token Auth Status</p>
                  <div className="flex flex-wrap gap-2">
                    {tokenAuthStatus.map((t) => (
                      <div key={t.status} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cf-gray-200 bg-cf-gray-50">
                        <span className="text-xs font-medium text-cf-navy">{t.status}</span>
                        <span className="text-[10px] text-cf-gray-500 bg-cf-gray-200 px-1.5 py-0.5 rounded">{formatNumber(t.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Private Network Origins — mirrors Cloudflare's "Shadow IT: Private
          Network analytics" dashboard (WARP-routed internal traffic origins,
          distinct from the public-internet Shadow IT SaaS section). */}
      {privateOrigins.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Private Network Origins</h3>
            <p className="text-xs text-cf-gray-500 mt-0.5">Internal source IPs and virtual networks accessed via WARP-routed private network traffic</p>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th className="px-4 py-2 text-left font-semibold">Source IP</th>
                  <th className="px-4 py-2 text-left font-semibold">Virtual Network</th>
                  <th className="px-4 py-2 text-right font-semibold">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {privateOrigins.map((o, i) => (
                  <tr key={`${o.sourceIp}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                    <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{o.sourceIp}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{o.virtualNetwork}</td>
                    <td className="px-4 py-1.5 text-right font-mono font-bold text-cf-navy text-[11px]">{formatNumber(o.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="mt-5 bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-cf-gray-100">
            <h3 className="text-sm font-semibold text-cf-navy">Top Blocked Destinations</h3>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-cf-gray-50 text-cf-gray-500 uppercase tracking-wide text-[10px]">
                  <th className="px-4 py-2 text-left font-semibold">#</th>
                  <th className="px-4 py-2 text-left font-semibold">IP</th>
                  <th className="px-4 py-2 text-left font-semibold">Country</th>
                  <th className="px-4 py-2 text-left font-semibold">Port</th>
                  <th className="px-4 py-2 text-left font-semibold">Service</th>
                  <th className="px-4 py-2 text-left font-semibold">Protocol</th>
                  <th className="px-4 py-2 text-right font-semibold">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cf-gray-100">
                {blocked.map((d, i) => (
                  <tr key={d.ip} className={i % 2 === 0 ? "bg-white" : "bg-cf-gray-50/40"}>
                    <td className="px-4 py-1.5 text-cf-gray-400 font-mono text-[11px]">{i+1}</td>
                    <td className="px-4 py-1.5 font-mono text-cf-navy text-[11px]">{d.ip}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.country || "–"}</td>
                    <td className="px-4 py-1.5 text-[11px] font-mono text-cf-gray-500">{d.port ?? "–"}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.service || "–"}</td>
                    <td className="px-4 py-1.5 text-[11px] text-cf-gray-500">{d.protocol}</td>
                    <td className="px-4 py-1.5 text-right font-mono font-bold text-red-600 text-[11px]">{formatNumber(d.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
