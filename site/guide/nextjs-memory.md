# High memory in Next.js apps

Self-hosted Next.js (and Payload) apps often grow past a few hundred MB of
RSS. Moatline already watches that: on the **server → Apps** tab and on the
**repository → Memory** card when the app is linked. Findings fire when an
app is near its limit, was OOM-killed, uses ~2× its 7-day median, or takes a
large share of the host without a limit.

## What Moatline shows

1. **Memory chart** — RSS over 24 hours or 7 days against the usual median.
2. **Findings** — `usage:memory`, `usage:limit`, `usage:oom`, `usage:share`
   with remediation in the detail text.
3. **Redeploy** — frees memory immediately; if RSS climbs again between
   deploys, it is usually a leak, not warm-up.

A Next.js process often settles after warm-up (compiling routes, filling
caches). A line that **only climbs** between deploys is the problem.

## First containment (ops)

1. Set a **memory limit** on the app in Dokploy or Coolify (Resources).
2. Set env  
   `NODE_OPTIONS=--max-old-space-size=<MB>`  
   to about **75% of that limit**, so Node exits before the kernel kills
   something else on the server.
3. Redeploy once and watch the chart for a day.

Without a limit, one leaky app can take the whole host down (databases,
other sites).

## Common causes in Next.js / Payload

| Symptom                              | Likely cause                                           |
| ------------------------------------ | ------------------------------------------------------ |
| Climbs under traffic, never flattens | Unbounded `fetch` / ISR / custom `Map` cache           |
| Spikes on image-heavy pages          | `next/image` optimizer concurrency or large originals  |
| Climbs on CMS use                    | Payload (or similar) keeping media/documents in memory |
| High from the start                  | Huge bundle / many workers / wrong `NODE_OPTIONS` heap |
| Climbs then OOM restart loop         | Limit too low _or_ real leak — check chart slope       |

Also check: listeners never removed, global singletons that accumulate,
logging that buffers huge strings, and building **on** the same small
server as production (build OOM is a separate finding: `oom:build`).

## How to see _what_ grows (developers)

1. Temporarily add `NODE_OPTIONS=--inspect=0.0.0.0:9229` (and open the port
   only via Tailscale / SSH tunnel — never publicly).
2. Open Chrome → `chrome://inspect` → the Node target → **Memory**.
3. Take a **heap snapshot**, generate traffic that reproduces growth, take
   another snapshot, compare.
4. Or use `clinic heapprofiler` / `0x` against a staging replica.

Look for retained strings, arrays, and caches keyed by request URL without
TTL or size cap.

## Checklist

- [ ] Memory limit set on the platform
- [ ] `NODE_OPTIONS=--max-old-space-size` ≈ 75% of the limit
- [ ] Chart: flat after warm-up, or climbing? (repo Memory card / server Apps)
- [ ] After redeploy: does growth return within hours?
- [ ] Caches have max size / TTL
- [ ] Image optimization and Payload media not holding blobs in process RAM
- [ ] Heap snapshot if it still climbs

Related: [AI agents and MCP](./ai-agents) · [Operations](./operations) ·
[Server monitoring](/reference/server-monitoring)
