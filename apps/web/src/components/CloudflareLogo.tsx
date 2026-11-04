/**
 * CloudflareLogo — official Cloudflare wordmark as inline SVG.
 *
 * Props:
 *   variant  "full"  — cloud icon + "Cloudflare" wordmark (default)
 *            "icon"  — cloud icon only
 *   color    "color" — official orange/white (default)
 *            "white" — all white (for dark backgrounds)
 *            "dark"  — all dark navy (for light backgrounds)
 *   height   px height (width scales proportionally)
 */

interface Props {
  variant?: "full" | "icon";
  color?: "color" | "white" | "dark";
  height?: number;
  className?: string;
}

// Official Cloudflare cloud silhouette path (viewBox 0 0 101 41)
const CLOUD_PATH =
  "M80.5 18.3c0-.4 0-.9-.1-1.3C79.1 8.3 71.5 1.5 62.3 1.5c-5.9 0-11.2 2.9-14.5 7.3-1.7-1.2-3.7-1.9-5.9-1.9-5.6 0-10.1 4.5-10.1 10.1 0 .4 0 .8.1 1.2-4.9.9-8.6 5.2-8.6 10.4 0 5.8 4.7 10.5 10.5 10.5h46.2c5.8 0 10.5-4.7 10.5-10.5 0-4.9-3.3-9-8-10.3z";

export default function CloudflareLogo({
  variant = "full",
  color = "color",
  height = 32,
  className = "",
}: Props) {
  // Color tokens
  const cloudFill  = color === "color" ? "#F6821F" : color === "white" ? "#ffffff" : "#1B1B1D";
  const textFill   = color === "color" ? "#404040" : color === "white" ? "#ffffff" : "#1B1B1D";

  if (variant === "icon") {
    // Icon only — viewBox fits the cloud shape
    const w = Math.round(height * (101 / 41));
    return (
      <svg
        width={w}
        height={height}
        viewBox="0 0 101 41"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="Cloudflare"
        role="img"
      >
        <path d={CLOUD_PATH} fill={cloudFill} />
      </svg>
    );
  }

  // Full wordmark — cloud + "Cloudflare" text
  // viewBox: 200 wide × 41 tall (cloud 101px + spacing + text ~90px)
  const w = Math.round(height * (200 / 41));
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 200 41"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Cloudflare"
      role="img"
    >
      {/* Cloud icon */}
      <path d={CLOUD_PATH} fill={cloudFill} />

      {/* Wordmark — "Cloudflare" in the CF sans-serif style */}
      <text
        x="108"
        y="30"
        fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
        fontWeight="600"
        fontSize="22"
        letterSpacing="-0.3"
        fill={textFill}
      >
        Cloudflare
      </text>
    </svg>
  );
}
