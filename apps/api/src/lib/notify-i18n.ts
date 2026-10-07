/**
 * Notifications in the organization's language. The messages are written
 * in English where they arise; known wordings are translated here as
 * whole-line patterns, so the call sites stay as they are. Anything not
 * matched — package names, GitHub's error text, finding details — passes
 * through unchanged.
 */
export type NotifyLang = "en" | "de";

type Rule = [RegExp, string | ((...m: string[]) => string)];

const n = (count: string, one: string, many: string) =>
  count === "1" ? one : many;

/** Applied to the title and to every line of the message, first match wins. */
const DE: Rule[] = [
  // Titles
  [
    /^Errors jumped after the deploy of (.+?)( — rolled back| — rollback failed)?$/,
    (_, r, s) =>
      `Fehler sind nach dem Deploy von ${r} stark gestiegen${suffix(s)}`,
  ],
  [/^(.+) is down$/, "$1 ist nicht erreichbar"],
  [/^(.+): restarting through (Dokploy|Coolify)$/, "$1: Neustart über $2"],
  [
    /^(.+): self-healing could not restart it$/,
    "$1: Selbstheilung konnte nicht neu starten",
  ],
  [
    /^(.+) is still down after the restart$/,
    "$1 ist nach dem Neustart immer noch nicht erreichbar",
  ],
  [/^(.+) has been down for (\d+) min$/, "$1 ist seit $2 min nicht erreichbar"],
  [/^(.+) is back up after (\d+) min$/, "$1 ist nach $2 min wieder erreichbar"],
  [/^The site does not answer: (.+)\.$/, "Die Seite antwortet nicht: $1."],
  [/^Errors in the logs:$/, "Fehler in den Logs:"],
  [
    /^Self-healing restarts it if it stays down for 5 minutes\.$/,
    "Die Selbstheilung startet sie neu, wenn sie 5 Minuten nicht erreichbar bleibt.",
  ],
  [
    /^Down for (\d+) min\. Moatline restarted the app and keeps checking\.$/,
    "Seit $1 min nicht erreichbar. Moatline hat die App neu gestartet und prüft weiter.",
  ],
  [
    /^(Dokploy|Coolify) refused the restart: (.+)$/,
    "$1 hat den Neustart abgelehnt: $2",
  ],
  [
    /^Down since (\d{2}:\d{2}) UTC\. Someone needs to look at it\.$/,
    "Nicht erreichbar seit $1 UTC. Jemand muss sich das ansehen.",
  ],
  [
    /^The restart through (Dokploy|Coolify) helped\.$/,
    "Der Neustart über $1 hat geholfen.",
  ],
  [/^It recovered on its own\.$/, "Sie hat sich von selbst erholt."],
  [
    /^New error in (.+): (\d+)× within an hour$/,
    "Neuer Fehler in $1: $2× innerhalb einer Stunde",
  ],
  [
    /^Started after the deploy at (\d{2}:\d{2}) UTC\.$/,
    "Begann nach dem Deploy um $1 UTC.",
  ],
  [
    /^(.+): (\d+) new problems? \((.+)\)$/,
    (_, s, c, src) =>
      `${s}: ${c} ${n(c, "neues Problem", "neue Probleme")} (${src})`,
  ],
  [/^(.+): (.+) not configured$/, "$1: $2 nicht eingerichtet"],
  [/^(.+): (.+) not working$/, "$1: $2 funktioniert nicht"],
  [
    /^Deploy of (.+) broke the live site( — rolled back| — rollback failed)?$/,
    (_, r, s) =>
      `Deploy von ${r} hat die Live-Seite kaputt gemacht${suffix(s)}`,
  ],
  [
    /^Deploy of (.+) did not go live — the previous version is still running( — rolled back| — rollback failed)?$/,
    (_, r, s) =>
      `Deploy von ${r} ging nicht live — die vorherige Version läuft weiter${suffix(s)}`,
  ],
  [/^Deploy triggered for (.+)$/, "Deploy für $1 ausgelöst"],
  [/^Deploy failed for (.+)$/, "Deploy für $1 fehlgeschlagen"],
  [
    /^Uptime Kuma: (\d+) monitors? down$/,
    (_, c) => `Uptime Kuma: ${c} ${n(c, "Monitor", "Monitore")} offline`,
  ],
  [/^PR merged for (.+)$/, "PR für $1 gemergt"],
  [
    /^(.+) got slower \(mobile\): (.+)$/,
    "$1 ist langsamer geworden (mobil): $2",
  ],
  [
    /^(.+) got slower \(desktop\): (.+)$/,
    "$1 ist langsamer geworden (Desktop): $2",
  ],
  [
    /^(\d+) new vulnerabilit(?:y|ies) in (.+)$/,
    (_, c, r) =>
      `${c} ${n(c, "neue Schwachstelle", "neue Schwachstellen")} in ${r}`,
  ],
  [
    /^Security auto-fix failed for (.+)$/,
    "Automatischer Sicherheits-Fix für $1 fehlgeschlagen",
  ],
  [
    /^No auto-fix available for (.+)$/,
    "Kein automatischer Fix für $1 verfügbar",
  ],
  [
    /^Security fix pushed but PR failed for (.+)$/,
    "Sicherheits-Fix für $1 gepusht, aber PR fehlgeschlagen",
  ],
  [/^Security fix PR opened for (.+)$/, "Sicherheits-Fix-PR für $1 geöffnet"],
  [
    /^Security fix not verified for (.+)$/,
    "Sicherheits-Fix für $1 nicht verifiziert",
  ],
  [/^Auto-merge held back for (.+)$/, "Auto-Merge für $1 zurückgehalten"],
  [/^Auto-merge failed for (.+)$/, "Auto-Merge für $1 fehlgeschlagen"],
  [/^Security fix merged for (.+)$/, "Sicherheits-Fix für $1 gemergt"],
  [/^Update PR opened for (.+)$/, "Update-PR für $1 geöffnet"],
  [
    /^Update for (.+): (\w+) failed on the branch$/,
    "Update für $1: $2 auf dem Branch fehlgeschlagen",
  ],
  // Message lines
  [
    /^(.*?) ?Roll back from the repository page, or turn on automatic rollback\.$/,
    "$1 Zurückrollen auf der Repository-Seite, oder automatischen Rollback einschalten.",
  ],
  [
    /^Dokploy deploys the merge by itself \(auto deploy on push\)\.$/,
    "Dokploy deployt den Merge selbst (Auto-Deploy bei Push).",
  ],
  [
    /^Dokploy accepted the deploy request\.$/,
    "Dokploy hat den Deploy-Auftrag angenommen.",
  ],
  [
    /^The health endpoint now reports (.+)\. Check the environment variables in Dokploy — mails or uploads may be failing\.$/,
    "Der Health-Endpoint meldet jetzt $1. Prüfe die Umgebungsvariablen in Dokploy — Mails oder Uploads schlagen eventuell fehl.",
  ],
  [
    /^(.+) is not set in Dokploy — (.+)$/,
    "$1 ist in Dokploy nicht gesetzt — $2",
  ],
  [/^Merged to the default branch\.$/, "In den Standard-Branch gemergt."],
  [/^PR merged to the default branch\.$/, "PR in den Standard-Branch gemergt."],
  [/^(\d+) critical, (\d+) high$/, "$1 kritisch, $2 hoch"],
  [/^…and (\d+) more$/, "…und $1 weitere"],
  [
    /^(.+) produced no changes \(fixes may require manual major upgrades\)\.$/,
    "$1 hat nichts geändert (Fixes brauchen evtl. manuelle Major-Upgrades).",
  ],
  [
    /^The PR is open but was not merged automatically: (.+)$/,
    "Der PR ist offen, wurde aber nicht automatisch gemergt: $1",
  ],
  [
    /^No CI ran on the fix branch and nothing was checked here, so it is not merged automatically\. The PR is open for review\.$/,
    "Auf dem Fix-Branch lief keine CI und hier wurde nichts geprüft, daher wird nicht automatisch gemergt. Der PR ist zur Prüfung offen.",
  ],
  [
    /^CI on the fix branch is (\w+): (.+)\. The PR is open for review\.$/,
    "Die CI auf dem Fix-Branch ist $1: $2. Der PR ist zur Prüfung offen.",
  ],
  [
    /^Review the PR before merging — the log in Moatline shows what failed\.$/,
    "Prüfe den PR vor dem Mergen — das Log in Moatline zeigt, was fehlschlug.",
  ],
  [
    /^Minor\/patch updates · (.+)$/,
    (_, r) => `Minor-/Patch-Updates · ${checkWords(r)}`,
  ],
  [/^Latest updates · (.+)$/, (_, r) => `Neueste Updates · ${checkWords(r)}`],
  [
    /^After the deploy(?: of (\w+))?\. Lighthouse (mobile|desktop) on (\S+)\.(?: Misses the budget: (.+)\.)?$/,
    (_, c, s, u, b) =>
      `Nach dem Deploy${c ? ` von ${c}` : ""}. Lighthouse ${s === "mobile" ? "mobil" : "Desktop"} auf ${u}.${b ? ` Verfehlt das Budget: ${b}.` : ""}`,
  ],
  [
    /^Lighthouse (mobile|desktop) on (\S+)\.(?: Misses the budget: (.+)\.)?$/,
    (_, s, u, b) =>
      `Lighthouse ${s === "mobile" ? "mobil" : "Desktop"} auf ${u}.${b ? ` Verfehlt das Budget: ${b}.` : ""}`,
  ],
];

function suffix(s: string | undefined): string {
  if (s === " — rolled back") return " — zurückgerollt";
  if (s === " — rollback failed") return " — Rollback fehlgeschlagen";
  return "";
}

function checkWords(s: string): string {
  return s
    .replace("checked by CI", "von der CI geprüft")
    .replace(/(\w+) passed/, "$1 bestanden");
}

function line(rules: Rule[], text: string): string {
  for (const [re, to] of rules) {
    const m = text.match(re);
    if (!m) continue;
    return typeof to === "string"
      ? text.replace(re, to)
      : (to as (...a: string[]) => string)(...(m as unknown as string[]));
  }
  return text;
}

export function translateNotification(
  lang: NotifyLang,
  title: string,
  message: string
): { title: string; message: string } {
  if (lang !== "de") return { title, message };
  return {
    title: line(DE, title),
    message: message
      .split("\n")
      .map((l) => line(DE, l))
      .join("\n"),
  };
}
