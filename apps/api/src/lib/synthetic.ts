/**
 * Runs a user journey against a site: HTTP steps in order, cookies carried
 * from one to the next (so a login holds), each checked for status, text
 * and time. Only the site's own origin is ever requested. Results carry
 * statuses and timings — never bodies, never the secret variables.
 */

export type Step = {
  method: "GET" | "POST" | "PUT" | "HEAD";
  path: string;
  body?: string;
  contentType?: "json" | "form" | "none";
  /** Exact status; default: any 2xx or 3xx. */
  expectStatus?: number;
  /** Text the response must contain. */
  expectText?: string;
  /** Slower than this fails the step; default 10 s. */
  maxMs?: number;
};

export type StepResult = {
  step: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  error?: string;
};

export type JourneyResult = { ok: boolean; steps: StepResult[] };

const MAX_BODY = 512 * 1024;

/** ${name} → value; JSON bodies get JSON-escaped values, forms URL-encoded. */
export function fill(
  template: string,
  vars: Record<string, string>,
  mode: "json" | "form" | "plain"
): string {
  return template.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]{0,40})\}/g,
    (m, name: string) => {
      const v = vars[name];
      if (v === undefined) return m;
      return mode === "json"
        ? JSON.stringify(v).slice(1, -1)
        : mode === "form"
          ? encodeURIComponent(v)
          : v;
    }
  );
}

/** name=value pairs from Set-Cookie headers, merged into the jar. */
export function storeCookies(
  jar: Map<string, string>,
  setCookies: string[]
): void {
  for (const c of setCookies) {
    const pair = c.split(";")[0] ?? "";
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    // An expired or emptied cookie is a logout.
    if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(c))
      jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function readText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_BODY) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runJourney(
  origin: string,
  steps: Step[],
  vars: Record<string, string>,
  fetchFn: typeof fetch = fetch
): Promise<JourneyResult> {
  const base = new URL(origin);
  const jar = new Map<string, string>();
  const results: StepResult[] = [];
  for (const s of steps) {
    const label = `${s.method} ${s.path}`;
    const maxMs = s.maxMs ?? 10_000;
    if (!s.path.startsWith("/") || s.path.startsWith("//")) {
      results.push({
        step: label,
        ok: false,
        status: null,
        ms: null,
        error: "path must start with /",
      });
      return { ok: false, steps: results };
    }
    const mode =
      s.contentType === "json"
        ? "json"
        : s.contentType === "form"
          ? "form"
          : "plain";
    const started = Date.now();
    try {
      let url = new URL(fill(s.path, vars, "form"), base);
      let method: string = s.method;
      let body: string | undefined =
        s.body && s.method !== "GET" && s.method !== "HEAD"
          ? fill(s.body, vars, mode)
          : undefined;
      let res: Response | null = null;
      // Redirects by hand: same origin only, and the jar updated on each.
      for (let hop = 0; hop <= 5; hop++) {
        res = await fetchFn(url, {
          method,
          redirect: "manual",
          headers: {
            "User-Agent": "Moatline synthetic check",
            ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
            ...(body && s.contentType === "json"
              ? { "Content-Type": "application/json" }
              : {}),
            ...(body && s.contentType === "form"
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
          },
          body,
          signal: AbortSignal.timeout(Math.max(maxMs, 1000) + 5000),
        });
        storeCookies(jar, res.headers.getSetCookie?.() ?? []);
        const loc = res.headers.get("location");
        if (
          res.status >= 300 &&
          res.status < 400 &&
          loc &&
          s.expectStatus !== res.status
        ) {
          const next = new URL(loc, url);
          if (next.origin !== base.origin) break;
          url = next;
          method = "GET";
          body = undefined;
          continue;
        }
        break;
      }
      const ms = Date.now() - started;
      const status = res!.status;
      const statusOk = s.expectStatus
        ? status === s.expectStatus
        : status >= 200 && status < 400;
      let error: string | undefined;
      if (!statusOk)
        error = `expected ${s.expectStatus ?? "2xx/3xx"}, got ${status}`;
      else if (s.expectText) {
        const text = s.method === "HEAD" ? "" : await readText(res!);
        if (!text.includes(fill(s.expectText, vars, "plain")))
          error = "expected text not found";
      }
      if (!error && ms > maxMs) error = `took ${ms} ms, limit ${maxMs} ms`;
      results.push({
        step: label,
        ok: !error,
        status,
        ms,
        ...(error ? { error } : {}),
      });
      if (error) return { ok: false, steps: results };
    } catch (e) {
      const ms = Date.now() - started;
      const timeout =
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError");
      results.push({
        step: label,
        ok: false,
        status: null,
        ms,
        error: timeout ? "no answer (timeout)" : "request failed",
      });
      return { ok: false, steps: results };
    }
  }
  return { ok: true, steps: results };
}

/** Ready-made journeys. */
export const PRESETS: Record<
  string,
  { name: string; steps: Step[]; variables: string[] }
> = {
  payloadLogin: {
    name: "Payload admin login",
    variables: ["email", "password"],
    steps: [
      { method: "GET", path: "/admin", expectStatus: 200, maxMs: 8000 },
      {
        method: "POST",
        path: "/api/users/login",
        contentType: "json",
        body: '{"email":"${email}","password":"${password}"}',
        expectStatus: 200,
        maxMs: 8000,
      },
      {
        method: "GET",
        path: "/api/users/me",
        expectStatus: 200,
        expectText: '"user"',
        maxMs: 5000,
      },
    ],
  },
  pageText: {
    name: "Home page shows its content",
    variables: [],
    steps: [
      {
        method: "GET",
        path: "/",
        expectStatus: 200,
        expectText: "",
        maxMs: 5000,
      },
    ],
  },
};
