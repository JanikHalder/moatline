import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import { run, scrubbedEnv } from "./run";

const NODE = process.execPath;

describe("scrubbedEnv", () => {
  it("removes secret-looking variables but keeps the rest", () => {
    const out = scrubbedEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      GITHUB_TOKEN: "ghp_secret",
      DATABASE_URL: "postgres://a",
      SECRETS_KEY: "k",
      MY_API_KEY: "v",
      DOKPLOY_PASSWORD: "p",
      SAFE_VALUE: "ok",
    });
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/x");
    expect(out.SAFE_VALUE).toBe("ok");
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.DATABASE_URL).toBeUndefined();
    expect(out.SECRETS_KEY).toBeUndefined();
    expect(out.MY_API_KEY).toBeUndefined();
    expect(out.DOKPLOY_PASSWORD).toBeUndefined();
  });
});

describe("run", () => {
  afterEach(() => {
    delete process.env.TEST_LEAK_TOKEN;
  });

  it("captures stdout and reports success", async () => {
    const res = await run(NODE, ["-e", "process.stdout.write('hello')"], {
      cwd: os.tmpdir(),
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("hello");
  });

  it("reports non-zero exit as not ok", async () => {
    const res = await run(NODE, ["-e", "process.exit(3)"], {
      cwd: os.tmpdir(),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(3);
  });

  it("passes secrets through by default", async () => {
    process.env.TEST_LEAK_TOKEN = "leaked";
    const res = await run(
      NODE,
      ["-e", "process.stdout.write(process.env.TEST_LEAK_TOKEN || 'GONE')"],
      { cwd: os.tmpdir() }
    );
    expect(res.stdout).toBe("leaked");
  });

  it("scrubs secrets from the child env when scrubSecrets is set", async () => {
    process.env.TEST_LEAK_TOKEN = "leaked";
    const res = await run(
      NODE,
      ["-e", "process.stdout.write(process.env.TEST_LEAK_TOKEN || 'GONE')"],
      { cwd: os.tmpdir(), scrubSecrets: true }
    );
    expect(res.stdout).toBe("GONE");
  });

  it("reports a missing binary as not found, without throwing", async () => {
    const res = await run("definitely-not-a-real-binary-xyz", [], {
      cwd: os.tmpdir(),
    });
    expect(res.ok).toBe(false);
    expect(res.stderr).toMatch(/not found|ENOENT/i);
  });

  it("kills a command that exceeds its timeout instead of hanging", async () => {
    const res = await run(NODE, ["-e", "setTimeout(() => {}, 10000)"], {
      cwd: os.tmpdir(),
      timeout: 200,
    });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
  });

  it("does not block the event loop while the child runs", async () => {
    const ticks: string[] = [];
    const pending = run(NODE, ["-e", "setTimeout(() => {}, 150)"], {
      cwd: os.tmpdir(),
    }).then(() => ticks.push("child"));
    await new Promise((r) => setTimeout(r, 20));
    ticks.push("timer");
    await pending;
    // The timer fired first, so the API stayed responsive during the child.
    expect(ticks).toEqual(["timer", "child"]);
  });
});

describe("PACKAGE_MANAGER_ENV", () => {
  it("keeps pnpm from switching to the version in packageManager", async () => {
    const { PACKAGE_MANAGER_ENV } = await import("./run");
    expect(PACKAGE_MANAGER_ENV).toMatchObject({
      npm_config_manage_package_manager_versions: "false",
      pnpm_config_manage_package_manager_versions: "false",
    });
  });
});
