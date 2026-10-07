/* global fetch, AbortSignal, setTimeout */
// Moatline probe: checks live URLs from another location and reports back.
// No dependencies — Node 20+. Configure with:
//   MOATLINE_URL   https://app.moatline.dev
//   PROBE_TOKEN    the token from PROBE_TOKENS on the API
//   INTERVAL_MS    how often to ask for work (default 30000)

const base = (process.env.MOATLINE_URL ?? "").replace(/\/+$/, "");
const token = process.env.PROBE_TOKEN ?? "";
const interval = Number(process.env.INTERVAL_MS) || 30_000;
if (!base || !token) {
  console.error("MOATLINE_URL and PROBE_TOKEN are required.");
  process.exit(1);
}
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "user-agent": "moatline-probe",
};

/** Up means the server answered below 500 — the same rule as the API. */
async function check(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "moatline/probe" },
    });
    await res.body?.cancel().catch(() => {});
    const ok = res.status > 0 && res.status < 500;
    return {
      ok,
      httpStatus: res.status,
      error: ok ? null : `HTTP ${res.status}`,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const cause = e?.cause?.code ?? e?.name ?? "error";
    return {
      ok: false,
      httpStatus: null,
      error: String(
        cause === "TimeoutError" ? "timeout after 10s" : cause
      ).slice(0, 200),
      durationMs: Date.now() - started,
    };
  }
}

async function round() {
  const res = await fetch(`${base}/api/probe/targets`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`targets: HTTP ${res.status}`);
  const { probe, targets } = await res.json();
  if (!targets.length) return;
  const results = [];
  // Eight at a time: enough for hundreds of sites a minute.
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    const done = await Promise.all(batch.map((t) => check(t.url)));
    batch.forEach((t, j) => results.push({ id: t.id, ...done[j] }));
  }
  const post = await fetch(`${base}/api/probe/results`, {
    method: "POST",
    headers,
    body: JSON.stringify({ results }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!post.ok) throw new Error(`results: HTTP ${post.status}`);
  const down = results.filter((r) => !r.ok).length;
  console.log(`[${probe}] checked ${results.length}, ${down} down`);
}

for (;;) {
  await round().catch((e) => console.error(`[probe] ${e.message}`));
  await new Promise((r) => setTimeout(r, interval));
}
