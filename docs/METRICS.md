# Browser metric notes

The browser capture layer records navigation timing, request/error counts, and optional paint metrics for each configured page visit.

## Largest Contentful Paint

`largestContentfulPaintMs` is useful, but it is also the most environment-sensitive metric in the project:

- Chromium may not emit an LCP entry for pages with no eligible rendered content.
- LCP can be unavailable when navigation fails before paint.
- It may also be unavailable when a page renders only after user interaction or long-running client-side work that outlives the configured wait strategy.

When an LCP threshold is configured and no LCP value is captured, the threshold evaluator intentionally marks that page visit as failed with `reason: "missing"`. This keeps regressions and capture blind spots visible instead of letting a configured threshold pass silently.

Recommended usage:

1. Keep LCP thresholds on pages that reliably paint visible content during the automated visit.
2. Prefer `waitUntil: "load"` or `waitUntil: "networkidle"` for pages where client-side rendering affects paint metrics.
3. Remove `largestContentfulPaintMs` from a page override when the page cannot emit a stable LCP in automation.
4. Review each failed threshold result before treating missing LCP as an application performance failure.
