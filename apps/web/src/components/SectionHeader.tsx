/**
 * SectionHeader — Alfa Romeo design language.
 *
 * Structure:
 *   [thick AR red left border] + uppercase label on one line
 *   Large section heading — title in dark navy, red vertical bar accent
 *   Optional subtitle in slate
 */

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  className?: string;
  printBreak?: boolean;
}

export default function SectionHeader({ title, subtitle, icon, className }: Props) {
  return (
    <div className={`mb-6 ${className ?? ""}`} style={{ borderLeft: "4px solid #ba0816", paddingLeft: "1rem" }}>
      {/* Uppercase label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {icon && <span style={{ color: "#ba0816", opacity: 0.9, display: "flex" }}>{icon}</span>}
        <span style={{
          fontSize: 10, fontWeight: 400, letterSpacing: "0.12rem",
          textTransform: "uppercase", color: "#ba0816",
        }}>
          {title}
        </span>
      </div>
      {/* Section heading */}
      <h2 style={{
        fontSize: 20, fontWeight: 700, lineHeight: 1.2,
        color: "#292b35", letterSpacing: "-0.02em", margin: 0,
      }}>
        {title}
      </h2>
      {/* Subtitle */}
      {subtitle && (
        <p style={{ fontSize: 12, marginTop: 4, color: "#5d5e65", lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
