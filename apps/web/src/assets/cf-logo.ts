/**
 * Cloudflare logo — imported (not "/cf.png") so vite processes it and, with
 * assetsInlineLimit raised past its size, INLINES it as a data URI at build
 * time. Scheduled-email attachments embed the bundle inside a standalone
 * HTML file where a relative "/cf.png" has no server behind it (and a remote
 * URL would break offline or if the host changes) — this way the same logo
 * renders on-demand, in attachments, and offline. Self-contained by design.
 */
import cfLogoUrl from "./cf.png";
export default cfLogoUrl;
