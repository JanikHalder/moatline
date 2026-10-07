import type {
  ChecksResult,
  CreatePrResult,
  MergePrResult,
  RevertResult,
} from "./git-api";

export type {
  ChecksResult,
  ChecksState,
  CreatePrResult,
  MergePrResult,
  RevertResult,
} from "./git-api";

export function parseGitHubUrl(
  githubUrl: string
): { owner: string; repo: string; branch: string } | null {
  const treeMatch = githubUrl.match(
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?tree\/([^/]+)/
  );
  if (treeMatch) {
    const [, owner, repo, branch] = treeMatch;
    return { owner, repo, branch: branch || "main" };
  }
  const match = githubUrl.match(
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  );
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo, branch: "main" };
}

const GITHUB_API = "https://api.github.com";

/**
 * Every GitHub call with a deadline: a stalled connection must end in an
 * error, not leave a fix run waiting forever.
 */
export async function ghFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  // GitHub is sometimes slow right after a push (opening a PR then waits
  // for the branch to be indexed): a minute, and one more try for timeouts
  // and 5xx. Retrying a PR creation is safe — the second one gets 422
  // "already exists" and createPullRequest looks the PR up.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status >= 502 && res.status <= 504 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt > 0) {
        throw new Error(
          `GitHub did not answer (${e instanceof Error ? e.message : "network error"})`
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function findOpenPr(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string
): Promise<{ number: number; url: string } | null> {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&state=open`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) return null;
  const arr = (await res.json()) as { number: number; html_url: string }[];
  return arr[0] ? { number: arr[0].number, url: arr[0].html_url } : null;
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  opts: { head: string; base: string; title: string; body: string }
): Promise<CreatePrResult> {
  try {
    return await createPullRequestOnce(token, owner, repo, opts);
  } catch (e) {
    // Maybe GitHub created it and only the answer got lost.
    const existing = await findOpenPr(
      token,
      owner,
      repo,
      opts.head,
      opts.base
    ).catch(() => null);
    if (existing) return { ok: true, ...existing, alreadyExists: true };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "GitHub did not answer",
    };
  }
}

async function createPullRequestOnce(
  token: string,
  owner: string,
  repo: string,
  opts: { head: string; base: string; title: string; body: string }
): Promise<CreatePrResult> {
  const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
    }),
  });
  if (res.status === 201) {
    const data = (await res.json()) as { number: number; html_url: string };
    return { ok: true, number: data.number, url: data.html_url };
  }
  const text = await res.text();
  if (res.status === 422) {
    if (/No commits between/i.test(text)) {
      return { ok: false, error: "No changes to open a PR for.", noDiff: true };
    }
    // A PR for this head may already exist – look it up instead of failing.
    const existing = await findOpenPr(token, owner, repo, opts.head, opts.base);
    if (existing) {
      return {
        ok: true,
        number: existing.number,
        url: existing.url,
        alreadyExists: true,
      };
    }
    return { ok: false, error: `GitHub 422: ${text.slice(0, 300)}` };
  }
  return { ok: false, error: `GitHub ${res.status}: ${text.slice(0, 300)}` };
}

export async function mergePullRequest(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  opts?: { method?: "merge" | "squash" | "rebase"; sha?: string }
): Promise<MergePrResult> {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        merge_method: opts?.method ?? "squash",
        ...(opts?.sha ? { sha: opts.sha } : {}),
      }),
    }
  );
  if (res.status === 200) {
    const data = (await res.json()) as { sha?: string };
    return { ok: true, sha: data.sha };
  }
  const text = await res.text();
  // 405 = not mergeable (branch protection / required checks). Respect it.
  if (res.status === 405) {
    return {
      ok: false,
      error: `Not mergeable – branch protection or required checks: ${text.slice(0, 200)}`,
      notMergeable: true,
    };
  }
  if (res.status === 409) {
    return {
      ok: false,
      error: `Merge conflict / head moved: ${text.slice(0, 200)}`,
    };
  }
  return { ok: false, error: `GitHub ${res.status}: ${text.slice(0, 200)}` };
}

type CheckRun = {
  name?: string;
  status?: string;
  conclusion?: string | null;
};

/**
 * Conclusions that are not a pass but also not a failure. A skipped or neutral
 * check is not a reason to block a merge — treating it as failure would make
 * the gate unusable in repos with conditional workflows.
 */
const CHECK_PASS = new Set(["success", "neutral", "skipped"]);

/**
 * The state of everything CI says about a commit: modern check runs and the
 * older commit statuses, which many setups still use.
 *
 * "none" means no CI reported anything at all — a real answer, and different
 * from "everything passed": a repo without CI cannot prove a change is safe,
 * it can only fail to object.
 */
export async function getRefChecks(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<ChecksResult> {
  const base = `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
  const [runsRes, statusRes] = await Promise.all([
    ghFetch(`${base}/check-runs?per_page=100`, { headers: ghHeaders(token) }),
    ghFetch(`${base}/status`, { headers: ghHeaders(token) }),
  ]);

  const runs: CheckRun[] = runsRes.ok
    ? (((await runsRes.json()) as { check_runs?: CheckRun[] }).check_runs ?? [])
    : [];
  const combined = statusRes.ok
    ? ((await statusRes.json()) as { state?: string; total_count?: number })
    : { state: undefined, total_count: 0 };

  const failing = runs.filter(
    (r) =>
      r.status === "completed" && !CHECK_PASS.has(r.conclusion ?? "success")
  );
  if (failing.length > 0) {
    return {
      state: "failure",
      detail: `failing: ${failing.map((r) => r.name ?? "check").join(", ")}`,
    };
  }
  if (combined.state === "failure" || combined.state === "error") {
    return { state: "failure", detail: "a commit status reports failure" };
  }

  const pending = runs.filter((r) => r.status !== "completed");
  if (pending.length > 0) {
    return {
      state: "pending",
      detail: `running: ${pending.map((r) => r.name ?? "check").join(", ")}`,
    };
  }
  if (combined.state === "pending" && (combined.total_count ?? 0) > 0) {
    return { state: "pending", detail: "a commit status is pending" };
  }

  const reported = runs.length + (combined.total_count ?? 0);
  if (reported === 0) {
    return { state: "none", detail: "no CI reported on this commit" };
  }
  return { state: "success", detail: `${reported} check(s) passed` };
}

/**
 * Poll until CI stops being pending. Returns the last state either way — a
 * timeout is reported as still pending rather than quietly passing.
 */
export async function waitForChecks(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  opts?: { timeoutMs?: number; intervalMs?: number; now?: () => number }
): Promise<ChecksResult> {
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const intervalMs = opts?.intervalMs ?? 20_000;
  const now = opts?.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let last = await getRefChecks(token, owner, repo, ref);
  while (last.state === "pending" && now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await getRefChecks(token, owner, repo, ref);
  }
  return last;
}

/**
 * Undo one commit on a branch without a clone: a new commit on top whose
 * tree is the commit's parent tree. Only while the commit is still the tip
 * — with anything on top, restoring the old tree would also throw that away,
 * so it refuses ("moved") and a human decides. The ref update is a
 * fast-forward; branch protection that forbids direct pushes refuses it.
 */
export async function revertTipCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  message: string
): Promise<RevertResult> {
  const base = `${GITHUB_API}/repos/${owner}/${repo}`;
  const get = async <T>(path: string): Promise<T | null> => {
    const res = await ghFetch(`${base}${path}`, { headers: ghHeaders(token) });
    return res.ok ? ((await res.json()) as T) : null;
  };
  const ref = await get<{ object: { sha: string } }>(
    `/git/ref/heads/${encodeURIComponent(branch)}`
  );
  if (!ref) return { ok: false, error: `Branch ${branch} not found.` };
  if (ref.object.sha !== sha) {
    return {
      ok: false,
      moved: true,
      error: `${branch} has moved on since ${sha.slice(0, 7)} — not reverted automatically.`,
    };
  }
  const commit = await get<{ parents: { sha: string }[] }>(
    `/git/commits/${sha}`
  );
  const parent = commit?.parents[0]?.sha;
  if (!parent) return { ok: false, error: "The commit has no parent." };
  const parentCommit = await get<{ tree: { sha: string } }>(
    `/git/commits/${parent}`
  );
  if (!parentCommit) return { ok: false, error: "Parent commit not readable." };
  const created = await ghFetch(`${base}/git/commits`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      message,
      tree: parentCommit.tree.sha,
      parents: [sha],
    }),
  });
  if (!created.ok) {
    return {
      ok: false,
      error: `GitHub ${created.status}: ${(await created.text()).slice(0, 200)}`,
    };
  }
  const revert = ((await created.json()) as { sha: string }).sha;
  const moved = await ghFetch(
    `${base}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      headers: ghHeaders(token),
      body: JSON.stringify({ sha: revert, force: false }),
    }
  );
  if (!moved.ok) {
    return {
      ok: false,
      error: `Could not update ${branch} (branch protection?): GitHub ${moved.status} ${(await moved.text()).slice(0, 200)}`,
    };
  }
  return { ok: true, sha: revert };
}
