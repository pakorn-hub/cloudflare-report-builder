# Visualization roadmap

Status: **proposal** for future visualization work. Magic Transit already has
a Three.js globe and compact hourly/daily tunnel summaries. The shared globe,
AppSec and Zero Trust enhancements below are not implemented yet.

## Recommended direction

Use a small number of focused 3D views for geography and relationship
exploration. Use linked 2D charts for comparing counts, rates, latency and
health. Enhance existing sections rather than increasing report length.

| Report | Suggested enhancement | Existing supporting data |
|---|---|---|
| Magic Transit | Extend the globe with source/processing-country views, packet/byte selection and smooth country focus. Offer a configured tunnel/route explorer. | Country rankings, tunnel inventory, routes, health and traffic measurements. |
| AppSec | Geographic explorer for requests, bandwidth and threats; selecting a country highlights its evidence row. | Country distribution includes requests, bytes and threats. |
| Zero Trust / Cloudflare One | Authentication geography with request/blocked views; explore application-to-policy/identity-provider and tunnel-to-private-route relationships. | Authentication country totals and explicit configuration identifiers. |

### Data boundaries

- Country totals do not establish measured source-to-destination paths or
  hourly country activity. Geographic route arcs and time replay require
  matching joint measurements before they can represent traffic.
- Configuration links describe a current snapshot. They are not proof that
  traffic traversed that relationship during the reporting period.
- Zero Trust has application/policy/provider and tunnel/route relationships,
  but not a complete measured user-to-application-to-tunnel journey.
- Missing measurements remain unavailable, distinct from measured zero.
- Each visualization identifies its unit, reporting window and denominator.
  Aggregates from different datasets are not implicitly joined into one flow.

## First implementation phase

1. Generalize the Magic Transit globe into a reusable, metric-aware component
   with labels and units appropriate to each report.
2. Pause animation when off-screen or the document is hidden. In reduced-motion
   mode, render on interaction or resize instead of continuously.
3. Add smooth country focus, hover highlighting, keyboard-accessible selection,
   clear legends and robust WebGL fallback.
4. Lazy-load the 3D engine when needed. Keep scheduled attachments self-contained
   without external textures, map services or runtime dependencies.
5. Add focused relationship explorers only where identifiers establish links.

The current globe disables automatic rotation for reduced motion, but its
animation loop still renders continuously. Viewport and document-visibility
handling are useful performance improvements before adding more canvases.

## Complementary 2D improvements

- Shared time cursors across aligned traffic, mitigation and health charts.
- Click-to-filter categories with matching evidence-row highlighting.
- Expandable drill-downs inside existing report sections.
- Subtle SVG transitions for measured flows and configuration diagrams.

Preserve compact hourly tunnel summaries for one-day Magic Transit reports and
daily summaries for longer windows. Keep ingress and egress separate; routing
state and probe success retain their different meanings.

## Export and verification requirements

Every interactive view needs an equivalent static SVG or accessible evidence
view for PDF and script-free HTML snapshots. Scheduled HTML attachments can
retain interactive 3D, with an offline static fallback.

Verify reduced motion, off-screen pausing, keyboard interaction, missing data,
WebGL/context failure, mobile layout, deterministic exports and correct units.
Use synthetic fixtures for public tests; live credentials and customer reports
stay outside the repository.

## Source references

- [Magic Transit globe](apps/web/src/components/magic-transit/NetworkGlobe.tsx)
- [Magic Transit report](apps/web/src/pages/MagicTransitReportPage.tsx)
- [AppSec geography](apps/web/src/pages/sections/GeoMapSection.tsx)
- [Zero Trust authentication geography](apps/web/src/pages/zt-sections/ZTAccessGeoSection.tsx)
- [Zero Trust applications and policies](apps/web/src/pages/zt-sections/ZTAccessAppsSection.tsx)
- [Zero Trust tunnels and routes](apps/web/src/pages/zt-sections/ZTTunnelHealthSection.tsx)
- [Report data contracts](apps/web/src/types.ts)
- [HTML/PDF export](apps/web/src/utils/pdf-export.ts)
- [Scheduled attachment builder](apps/api/src/services/attachment-builder.ts)
