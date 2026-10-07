/**
 * End of standard support of the server distributions in use — after it no
 * security updates arrive, whatever unattended-upgrades does.
 * Ubuntu: ubuntu.com/about/release-cycle; Debian: wiki.debian.org/LTS.
 */
const EOL: Array<[RegExp, string, string]> = [
  [/^Ubuntu 16\.04/, "2021-04-30", "Ubuntu 16.04"],
  [/^Ubuntu 18\.04/, "2023-05-31", "Ubuntu 18.04"],
  [/^Ubuntu 20\.04/, "2025-05-31", "Ubuntu 20.04"],
  [/^Ubuntu 22\.04/, "2027-06-01", "Ubuntu 22.04"],
  [/^Ubuntu 24\.04/, "2029-05-31", "Ubuntu 24.04"],
  [/^Ubuntu 24\.10/, "2025-07-10", "Ubuntu 24.10"],
  [/^Ubuntu 25\.04/, "2026-01-15", "Ubuntu 25.04"],
  [/^Ubuntu 25\.10/, "2026-07-09", "Ubuntu 25.10"],
  [/^Ubuntu 26\.04/, "2031-05-31", "Ubuntu 26.04"],
  [/^Debian GNU\/Linux 10\b/, "2024-06-30", "Debian 10"],
  [/^Debian GNU\/Linux 11\b/, "2026-08-31", "Debian 11"],
  [/^Debian GNU\/Linux 12\b/, "2028-06-30", "Debian 12"],
  [/^Debian GNU\/Linux 13\b/, "2030-06-30", "Debian 13"],
];

export type OsSupport = {
  name: string;
  eol: string | null;
  status: "eol" | "soon" | "ok" | "unknown";
};

export function osSupport(
  os: string | null | undefined,
  now = Date.now()
): OsSupport {
  const hit = os ? EOL.find(([rx]) => rx.test(os)) : undefined;
  if (!hit) return { name: os ?? "—", eol: null, status: "unknown" };
  const left = Date.parse(hit[1]) - now;
  return {
    name: hit[2],
    eol: hit[1],
    status: left < 0 ? "eol" : left < 183 * 24 * 3600 * 1000 ? "soon" : "ok",
  };
}
