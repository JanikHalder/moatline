import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, domains: {}, repositories: {} }));

import {
  domainProblems,
  isLetsEncrypt,
  registrableDomain,
} from "./domain-check";
import { monthRange } from "./client-report";

describe("registrableDomain", () => {
  it("strips subdomains, knows three-label suffixes", () => {
    expect(registrableDomain("www.kunde.at")).toBe("kunde.at");
    expect(registrableDomain("shop.example.co.at")).toBe("example.co.at");
    expect(registrableDomain("app.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("10.0.0.1")).toBeNull();
    expect(registrableDomain("localhost")).toBeNull();
  });
});

const healthy = {
  cert: {
    ok: true,
    validTo: "2027-01-01T00:00:00Z",
    daysLeft: 80,
    issuer: "Let's Encrypt",
    error: null,
  },
  registration: { expires: "2027-06-01T00:00:00Z", daysLeft: 240 },
  mail: {
    mx: ["mx1.example"],
    spf: "v=spf1 include:_spf.google.com ~all",
    dmarc: "v=DMARC1; p=quarantine",
    dmarcPolicy: "quarantine",
    dkim: ["google"],
  },
};

describe("domainProblems", () => {
  it("is quiet for a healthy domain", () => {
    expect(domainProblems(healthy)).toEqual([]);
    expect(
      domainProblems({ ...healthy, acme: { reachable: true, error: null } })
    ).toEqual([]);
  });

  it("warns when Let's Encrypt cannot reach port 80, weeks before expiry", () => {
    const p = domainProblems({
      ...healthy,
      acme: { reachable: false, error: "ECONNREFUSED" },
    });
    expect(p).toMatchObject([{ id: "acme-port80", severity: "medium" }]);
    expect(p[0]!.text).toContain("expires in 80 days");
    expect(
      domainProblems({
        ...healthy,
        cert: { ...healthy.cert, daysLeft: 20 },
        acme: { reachable: false, error: "no answer within 8 s" },
      })[0]
    ).toMatchObject({ id: "acme-port80", severity: "high" });
  });

  it("knows Let's Encrypt by its issuer names", () => {
    expect(isLetsEncrypt("Let's Encrypt")).toBe(true);
    expect(isLetsEncrypt("R11")).toBe(true);
    expect(isLetsEncrypt("E6")).toBe(true);
    expect(isLetsEncrypt("Google Trust Services")).toBe(false);
    expect(isLetsEncrypt(null)).toBe(false);
  });

  it("flags expiring certificates and registrations, missing mail DNS", () => {
    const p = domainProblems({
      cert: { ...healthy.cert, daysLeft: 3 },
      registration: { expires: "2026-10-20T00:00:00Z", daysLeft: 16 },
      mail: { mx: ["mx"], spf: null, dmarc: null, dmarcPolicy: null, dkim: [] },
    });
    expect(p.map((x) => [x.id, x.severity])).toEqual([
      ["cert-expiry", "high"],
      ["registration", "medium"],
      ["spf", "medium"],
      ["dmarc", "medium"],
      ["dkim", "low"],
    ]);
  });

  it("does not ask for mail records on a domain without mail", () => {
    expect(
      domainProblems({
        ...healthy,
        mail: { mx: [], spf: null, dmarc: null, dmarcPolicy: null, dkim: [] },
      })
    ).toEqual([]);
  });
});

describe("monthRange", () => {
  it("covers one calendar month", () => {
    expect(monthRange("2026-09")).toEqual([
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-10-01T00:00:00Z"),
    ]);
    expect(monthRange("2026-13")).toBeNull();
  });
});
