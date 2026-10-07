import { describe, expect, it } from "vitest";
import { translateNotification } from "./notify-i18n";

const de = (title: string, message = "") =>
  translateNotification("de", title, message);

describe("translateNotification", () => {
  it("leaves English alone", () => {
    expect(translateNotification("en", "Deploy failed for shop", "x")).toEqual({
      title: "Deploy failed for shop",
      message: "x",
    });
  });

  it("translates the titles the API sends", () => {
    const cases: Array<[string, string]> = [
      ["web-01: 2 new problems (Trivy)", "web-01: 2 neue Probleme (Trivy)"],
      [
        "web-01: 1 new problem (CrowdSec)",
        "web-01: 1 neues Problem (CrowdSec)",
      ],
      [
        "shop: Email, S3 bucket not configured",
        "shop: Email, S3 bucket nicht eingerichtet",
      ],
      ["shop: email not working", "shop: email funktioniert nicht"],
      [
        "Deploy of shop broke the live site — rolled back",
        "Deploy von shop hat die Live-Seite kaputt gemacht — zurückgerollt",
      ],
      [
        "Deploy of shop did not go live — the previous version is still running",
        "Deploy von shop ging nicht live — die vorherige Version läuft weiter",
      ],
      ["Deploy triggered for shop", "Deploy für shop ausgelöst"],
      ["Uptime Kuma: 3 monitors down", "Uptime Kuma: 3 Monitore offline"],
      ["4 new vulnerabilities in shop", "4 neue Schwachstellen in shop"],
      ["1 new vulnerability in shop", "1 neue Schwachstelle in shop"],
      [
        "shop got slower (mobile): performance 90 → 75",
        "shop ist langsamer geworden (mobil): performance 90 → 75",
      ],
      ["Auto-merge held back for shop", "Auto-Merge für shop zurückgehalten"],
      [
        "Update for shop: typecheck failed on the branch",
        "Update für shop: typecheck auf dem Branch fehlgeschlagen",
      ],
    ];
    for (const [en, want] of cases) expect(de(en).title).toBe(want);
  });

  it("translates known message lines and keeps the rest", () => {
    const r = de(
      "x",
      "2 critical, 1 high\n\n• next 15.0.0 — GHSA-xxxx\n…and 3 more"
    );
    expect(r.message).toBe(
      "2 kritisch, 1 hoch\n\n• next 15.0.0 — GHSA-xxxx\n…und 3 weitere"
    );
    expect(
      de(
        "x",
        "After the deploy of 752de05. Lighthouse mobile on https://shop.example/."
      ).message
    ).toBe(
      "Nach dem Deploy von 752de05. Lighthouse mobil auf https://shop.example/."
    );
  });
});

describe("log error notifications", () => {
  it("are translated", () => {
    const r = translateNotification(
      "de",
      "New error in shop: 230× within an hour",
      "Error: connect ECONNREFUSED <ip>:27017\nStarted after the deploy at 14:02 UTC."
    );
    expect(r.title).toBe("Neuer Fehler in shop: 230× innerhalb einer Stunde");
    expect(r.message).toBe(
      "Error: connect ECONNREFUSED <ip>:27017\nBegann nach dem Deploy um 14:02 UTC."
    );
  });
});

describe("incident notifications", () => {
  it("are translated", () => {
    expect(translateNotification("de", "shop is down", "").title).toBe(
      "shop ist nicht erreichbar"
    );
    expect(
      translateNotification(
        "de",
        "shop is back up after 12 min",
        "The restart through Dokploy helped."
      )
    ).toEqual({
      title: "shop ist nach 12 min wieder erreichbar",
      message: "Der Neustart über Dokploy hat geholfen.",
    });
  });
});

describe("error spike notifications", () => {
  it("are translated", () => {
    expect(
      translateNotification(
        "de",
        "Errors jumped after the deploy of shop — rolled back",
        ""
      ).title
    ).toBe(
      "Fehler sind nach dem Deploy von shop stark gestiegen — zurückgerollt"
    );
  });
});
