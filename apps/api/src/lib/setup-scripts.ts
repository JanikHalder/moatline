/**
 * Which version of each setup script (save-server) a server last ran, from
 * the stamps the app's setup commands leave behind (see server-setup.tsx).
 */
export type SetupScriptState = "current" | "outdated" | "never";

/** Scripts every server should have run; the others only show once they did. */
export const EXPECTED_SETUP_SCRIPTS = ["harden-server.sh", "auto-update.sh"];

export type SetupStamp = {
  name: string;
  sha256: string;
  ranAt?: string | null;
};

/**
 * `reported: false` when the agent does not report stamps (before 1.20.0) —
 * then nothing is known. A missing stamp is "never": not run through the app's
 * setup command, or before stamps existed.
 */
export function setupScriptStates(
  stamps: SetupStamp[] | null | undefined,
  current: Record<string, string | null>
): {
  reported: boolean;
  scripts: { name: string; state: SetupScriptState; ranAt: string | null }[];
} {
  if (!stamps) return { reported: false, scripts: [] };
  const byName = new Map(stamps.map((s) => [s.name, s]));
  const names = [
    ...EXPECTED_SETUP_SCRIPTS,
    ...stamps
      .map((s) => s.name)
      .filter((n) => n in current && !EXPECTED_SETUP_SCRIPTS.includes(n)),
  ];
  return {
    reported: true,
    scripts: names.map((name) => {
      const stamp = byName.get(name);
      const latest = current[name];
      return {
        name,
        state: !stamp
          ? "never"
          : !latest || stamp.sha256 === latest
            ? "current"
            : "outdated",
        ranAt: stamp?.ranAt ?? null,
      };
    }),
  };
}
