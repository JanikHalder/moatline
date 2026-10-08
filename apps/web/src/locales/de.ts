/**
 * German interface texts. The key is the English text in the code; a key
 * missing here simply shows in English. Keep `{placeholders}` unchanged.
 */
export const de: Record<string, string> = {
  // Navigation and layout
  Overview: "Übersicht",
  Dashboard: "Dashboard",
  Repositories: "Repositories",
  Servers: "Server",
  Clients: "Kunden",
  Monitoring: "Monitoring",
  Team: "Team",
  "Audit log": "Audit-Log",
  Settings: "Einstellungen",
  "Account security": "Kontosicherheit",
  "Signed in": "Angemeldet",
  "Sign out": "Abmelden",
  Language: "Sprache",
  "Color theme": "Farbschema",
  Light: "Hell",
  Dark: "Dunkel",
  System: "System",
  "Login disabled": "Login deaktiviert",
  "Dependency security": "Abhängigkeits-Sicherheit",
  "Turn on two-factor authentication":
    "Zwei-Faktor-Authentifizierung aktivieren",
  "As {role}, adding servers, issuing install codes and changing integrations need it.":
    "Als {role} brauchst du sie, um Server hinzuzufügen, Install-Codes zu erstellen und Integrationen zu ändern.",
  "Set it up": "Einrichten",
  "Create your first organization": "Erstelle deine erste Organisation",
  "Repositories, scans and findings all belong to an organization. Create one to get started — you can invite colleagues to it afterwards under Team.":
    "Repositories, Scans und Findings gehören immer zu einer Organisation. Erstelle eine, um loszulegen — Kolleg:innen lädst du danach unter Team ein.",
  "Create organization": "Organisation erstellen",

  // Common
  Actions: "Aktionen",
  Add: "Hinzufügen",
  Cancel: "Abbrechen",
  Create: "Erstellen",
  Name: "Name",
  Status: "Status",
  Deploy: "Deploy",
  Branch: "Branch",
  "That did not work": "Das hat nicht geklappt",
  "Could not add": "Konnte nicht hinzugefügt werden",
  "Could not create": "Konnte nicht erstellt werden",
  "Adding…": "Wird hinzugefügt…",
  none: "keins",
  open: "offen",
  live: "live",
  down: "offline",
  Live: "Live",
  Down: "Offline",
  Off: "Aus",
  Hourly: "Stündlich",
  "Daily (03:00)": "Täglich (03:00)",
  "Weekly (Mon 03:00)": "Wöchentlich (Mo 03:00)",

  // Repositories list
  "{n} connected · {m} on a schedule": "{n} verbunden · {m} mit Zeitplan",
  "Fast scan all": "Alle schnell scannen",
  "Lockfile + advisory database for every repository — no clone, about a second each":
    "Lockfile + Advisory-Datenbank für jedes Repository — ohne Klon, etwa eine Sekunde pro Repo",
  "Add repo": "Repo hinzufügen",
  "Search repositories": "Repositories durchsuchen",
  All: "Alle",
  "Critical & high": "Kritisch & hoch",
  "Open PRs": "Offene PRs",
  "Deploy problems": "Deploy-Probleme",
  "Major updates": "Major-Updates",
  "No repos yet": "Noch keine Repos",
  Repository: "Repository",
  Vulnerabilities: "Schwachstellen",
  "Packages · Perf": "Pakete · Perf",
  "No repository matches.": "Kein Repository passt.",
  "Scanning…": "Scannt…",
  "Last scan failed": "Letzter Scan fehlgeschlagen",
  "Never scanned": "Nie gescannt",
  "Scanned {when}": "Gescannt {when}",
  "Live URL set": "Live-URL gesetzt",
  "next {when}": "nächster {when}",
  "Manual only": "Nur manuell",
  "Failed to load repos": "Repos konnten nicht geladen werden",
  "Failed to start the scans": "Die Scans konnten nicht gestartet werden",
  "Failed to add repo": "Repo konnte nicht hinzugefügt werden",
  "{n} fast scan started": "{n} schneller Scan gestartet",
  "{n} fast scans started": "{n} schnelle Scans gestartet",
  "{n} already running": "{n} laufen bereits",
  "Scanning {name}…": "{name} wird gescannt…",
  "Full scan of {name} started": "Voller Scan von {name} gestartet",
  "Fixing CVEs in {name} — a PR follows":
    "CVEs in {name} werden gefixt — ein PR folgt",
  "Updating {name} — a PR follows": "{name} wird aktualisiert — ein PR folgt",
  "Deploy of {name} started": "Deploy von {name} gestartet",
  "Add repositories": "Repositories hinzufügen",
  "Enter a URL instead": "Stattdessen URL eingeben",
  "Repository URL": "Repository-URL",
  "Root directory (optional)": "Root-Ordner (optional)",
  "e.g. apps/web or packages/api — leave empty for repo root":
    "z. B. apps/web oder packages/api — leer lassen für den Repo-Root",
  "For monorepos: path to the folder containing package.json.":
    "Für Monorepos: Pfad zum Ordner mit der package.json.",
  "Add repository": "Repository hinzufügen",
  "Add {n} repositories": "{n} Repositories hinzufügen",

  // Row parts and actions
  "no CVEs": "keine CVEs",
  "{n} critical": "{n} kritisch",
  "{n} high": "{n} hoch",
  "{n} moderate": "{n} mittel",
  "{n} low": "{n} niedrig",
  "{n} fixable": "{n} behebbar",
  "{n} site issue": "{n} Seiten-Problem",
  "{n} site issues": "{n} Seiten-Probleme",
  "Live site exposes something": "Die Live-Seite gibt etwas preis",
  "up to date": "aktuell",
  "{n} outdated": "{n} veraltet",
  "{n} major": "{n} Major",
  "Mobile Lighthouse": "Lighthouse mobil",
  "misses {n} budget items": "verfehlt {n} Budget-Werte",
  rejected: "abgelehnt",
  "rolled back": "zurückgerollt",
  "not live": "nicht live",
  deployed: "deployt",
  "no deploy yet": "noch kein Deploy",
  "fix PR": "Fix-PR",
  "update PR": "Update-PR",
  "check failed": "Check fehlgeschlagen",
  "fixing…": "wird gefixt…",
  "updating…": "wird aktualisiert…",
  Scan: "Scan",
  "Lockfile + advisory database — about a second":
    "Lockfile + Advisory-Datenbank — etwa eine Sekunde",
  "More actions for {name}": "Weitere Aktionen für {name}",
  "Full scan (unused packages too)": "Voller Scan (auch ungenutzte Pakete)",
  "Fix CVEs": "CVEs fixen",
  "Update packages (minor & patch)": "Pakete aktualisieren (Minor & Patch)",
  "Deploy with Dokploy": "Mit Dokploy deployen",
  "Copy findings for agent": "Findings für den Agent kopieren",
  "Open pull request": "Pull Request öffnen",
  "Open live site": "Live-Seite öffnen",
  "Details & settings": "Details & Einstellungen",
  "Roll back…": "Zurückrollen…",

  // Clients
  "Your customers' sites, servers and domains in one place — and the monthly maintenance report.":
    "Websites, Server und Domains deiner Kunden an einem Ort — und der monatliche Wartungsbericht.",
  "New client": "Neuer Kunde",
  "No clients yet": "Noch keine Kunden",
  "Create one, then put its repositories, servers and domains under it.":
    "Lege einen an und ordne ihm dann Repositories, Server und Domains zu.",
  "{a} sites · {b} servers · {c} domains":
    "{a} Websites · {b} Server · {c} Domains",
  "{n} down": "{n} offline",
  "{n} domain issue": "{n} Domain-Problem",
  "{n} domain issues": "{n} Domain-Probleme",
  "all good": "alles gut",
  Domains: "Domains",
  "Domains without a client": "Domains ohne Kunde",
  "From the repositories' live URLs, plus any you add. Checked daily: certificate, registration, SPF / DKIM / DMARC.":
    "Aus den Live-URLs der Repositories und allen, die du hinzufügst. Täglich geprüft: Zertifikat, Registrierung, SPF / DKIM / DMARC.",
  "Domain to add": "Domain hinzufügen",
  "Add domain": "Domain hinzufügen",
  "The report language is what the client reads; the app stays as it is.":
    "Die Berichtssprache ist das, was der Kunde liest; die App bleibt, wie sie ist.",
  "Contact email (optional)": "Kontakt-E-Mail (optional)",
  "Contact email": "Kontakt-E-Mail",
  "Report language": "Berichtssprache",
  "No contact email": "Keine Kontakt-E-Mail",
  "Report month": "Berichtsmonat",
  "Monthly report": "Monatsbericht",
  "Add sites, servers, domains": "Websites, Server, Domains hinzufügen",
  Details: "Details",
  "Contact and report language": "Kontakt und Berichtssprache",
  Sites: "Websites",
  "None yet.": "Noch keine.",
  "reported {when}": "gemeldet {when}",
  "no agent": "kein Agent",
  "Certificate, registration and mail authentication, checked daily.":
    "Zertifikat, Registrierung und Mail-Authentifizierung, täglich geprüft.",
  "Delete client": "Kunde löschen",
  "Delete client {name}? Sites, servers and domains stay, just without a client.":
    "Kunde {name} löschen? Websites, Server und Domains bleiben, nur ohne Kunde.",
  "Add to {name}": "Zu {name} hinzufügen",
  "Pick what belongs to this client. Items under another client move here.":
    "Wähle, was zu diesem Kunden gehört. Einträge eines anderen Kunden werden hierher verschoben.",
  "Nothing left to add.": "Nichts mehr hinzuzufügen.",
  "Could not build the report": "Der Bericht konnte nicht erstellt werden",
  "Could not assign": "Konnte nicht zugeordnet werden",

  // Domains
  Domain: "Domain",
  Certificate: "Zertifikat",
  Registration: "Registrierung",
  Mail: "Mail",
  Client: "Kunde",
  "No client": "Kein Kunde",
  "No domains yet — they appear from the live URLs of the repositories, or add one.":
    "Noch keine Domains — sie erscheinen aus den Live-URLs der Repositories, oder füge eine hinzu.",
  "checked {when}": "geprüft {when}",
  "not checked": "nicht geprüft",
  "{n} days": "{n} Tage",
  "not published": "nicht veröffentlicht",
  "The registry does not publish the date (e.g. .at, .de)":
    "Die Registry veröffentlicht das Datum nicht (z. B. .at, .de)",
  "no mail": "kein Mail",
  "Check {name} now": "{name} jetzt prüfen",
  "Remove {name}": "{name} entfernen",
  "No valid certificate": "Kein gültiges Zertifikat",
  "Certificate expires in {n} days — automatic renewal is not working":
    "Zertifikat läuft in {n} Tagen ab — die automatische Erneuerung funktioniert nicht",
  "Domain registration expires in {n} days":
    "Domain-Registrierung läuft in {n} Tagen ab",
  "No SPF record — mail from this domain lands in spam or is rejected":
    "Kein SPF-Eintrag — Mails dieser Domain landen im Spam oder werden abgelehnt",
  "No DMARC record": "Kein DMARC-Eintrag",
  "DMARC policy is p=none — spoofed mail is not stopped":
    "DMARC-Richtlinie ist p=none — gefälschte Mails werden nicht gestoppt",
  "No DKIM key found for common selectors":
    "Kein DKIM-Schlüssel für gängige Selektoren gefunden",

  // Repository detail, servers and cards
  " (compose)": " (Compose)",
  " (this repository)": " (dieses Repository)",
  " Link the Dokploy application, or expose a ":
    " Verknüpfe die Dokploy-App oder liefere ein ",
  " The deployed commit is taken from Dokploy instead (its last successful deploy).":
    " Der deployte Commit wird stattdessen aus Dokploy genommen (letzter erfolgreicher Deploy).",
  " and deploys it with Dokploy (if Dokploy deploys on push, its webhook does it and nothing is deployed twice).":
    " und deployt ihn mit Dokploy (deployt Dokploy bei Push selbst, übernimmt das sein Webhook und nichts wird doppelt deployt).",
  " · accepted by Dokploy": " · von Dokploy angenommen",
  " · every 15 minutes": " · alle 15 Minuten",
  " · rejected by Dokploy": " · von Dokploy abgelehnt",
  "%, disk": " %, Festplatte",
  "%, memory": " %, Arbeitsspeicher",
  "(not found in Dokploy)": "(in Dokploy nicht gefunden)",
  "(only while nothing was committed on top). Without a Dokploy rollback the revert is deployed — that is a normal build.":
    "(nur solange nichts darauf committet wurde). Ohne Dokploy-Rollback wird der Revert deployt — ein normaler Build.",
  ", open Payload endpoints": ", offene Payload-Endpunkte",
  ", so a deploy can be confirmed instead of assumed.":
    ", damit ein Deploy bestätigt statt angenommen wird.",
  ", so scheduled scans will not start. The setting is saved either way.":
    ", daher starten geplante Scans nicht. Die Einstellung wird trotzdem gespeichert.",
  ". Add them to the health endpoint (see docs/health-endpoint.md), e.g.":
    ". Ergänze sie im Health-Endpunkt (siehe docs/health-endpoint.md), z. B.",
  ". Budget: the Lighthouse go-live budget.":
    ". Budget: das Lighthouse-Go-live-Budget.",
  ". It runs on the self-hosted runner (server → Setup → build server) with an empty database of its own — never the real one.":
    ". Er läuft auf dem Self-hosted Runner (Server → Setup → Build-Server) mit einer eigenen leeren Datenbank — nie der echten.",
  ". No Dokploy application is linked, so nothing is deployed.":
    ". Keine Dokploy-App verknüpft, daher wird nichts deployt.",
  ". The installer downloads the agent, checks its SHA-256, sets up the selected tools, sends a first report and enables the timers.":
    ". Der Installer lädt den Agent, prüft seine SHA-256, richtet die gewählten Tools ein, sendet einen ersten Bericht und aktiviert die Timer.",
  ". The server, the agent or its timer may be down — check":
    ". Server, Agent oder sein Timer sind evtl. ausgefallen — prüfe",
  ". Valid for one hour, used once, never stored here.":
    ". Eine Stunde gültig, einmal verwendbar, hier nie gespeichert.",
  "1. Harden the server": "1. Server härten",
  "2. Automatic updates": "2. Automatische Updates",
  "3. Monitoring agent": "3. Monitoring-Agent",
  "7 days": "7 Tage",
  "A few failed SSH logins make CrowdSec ban the address — for SSH and every website on the server. Only fixed addresses: an IP your provider reassigns could be someone else's tomorrow.":
    "Ein paar fehlgeschlagene SSH-Logins lassen CrowdSec die Adresse sperren — für SSH und jede Website auf dem Server. Nur feste Adressen: eine IP, die dein Provider neu vergibt, gehört morgen vielleicht jemand anderem.",
  "A finding stays open while its source keeps reporting it and resolves itself the first time it no longer does.":
    "Ein Finding bleibt offen, solange seine Quelle es meldet, und schließt sich selbst, sobald sie es nicht mehr tut.",
  "A folder, file or glob on the server. The agent only reads file dates and sizes — never contents. 26 hours suits a nightly backup.":
    "Ein Ordner, eine Datei oder ein Glob auf dem Server. Der Agent liest nur Datum und Größe der Dateien — nie den Inhalt. 26 Stunden passen zu einem nächtlichen Backup.",
  "A line that only climbs between deploys is a leak; a Next.js app usually settles after warm-up.":
    "Eine Linie, die zwischen Deploys nur steigt, ist ein Leck; eine Next.js-App pendelt sich nach dem Aufwärmen meist ein.",
  "A reinstall brings new checks — see the Setup tab":
    "Eine Neuinstallation bringt neue Prüfungen — siehe Setup-Tab",
  Access: "Zugang",
  "Access changed since it was last accepted":
    "Zugang hat sich seit der letzten Bestätigung geändert",
  Accessibility: "Barrierefreiheit",
  "Action failed": "Aktion fehlgeschlagen",
  "Active bans": "Aktive Sperren",
  "Add a server and install the agent to see load, pending updates, CrowdSec and Trivy results here.":
    "Füge einen Server hinzu und installiere den Agent, um hier Last, offene Updates, CrowdSec- und Trivy-Ergebnisse zu sehen.",
  "Add backup location": "Backup-Ort hinzufügen",
  "Add my IP (": "Meine IP hinzufügen (",
  "Add server": "Server hinzufügen",
  "Advisories from npm audit for this scan.":
    "Advisories aus npm audit für diesen Scan.",
  Advisory: "Advisory",
  "Advisory / reference": "Advisory / Referenz",
  Affects: "Betrifft",
  Agent: "Agent",
  "Agent status and hardening score from the Wazuh manager.":
    "Agent-Status und Härtungs-Score vom Wazuh-Manager.",
  "Alerts (24h)": "Alarme (24 h)",
  "All agents are reporting": "Alle Agents melden sich",
  "All servers": "Alle Server",
  "Allow breaking fixes (": "Breaking Fixes erlauben (",
  "Already installed tools are left alone, so this works on an existing server too. Packages come only from the vendors' official repositories (Debian/Ubuntu).":
    "Bereits installierte Tools bleiben unverändert, das funktioniert also auch auf einem bestehenden Server. Pakete kommen nur aus den offiziellen Repositories der Hersteller (Debian/Ubuntu).",
  "Also set up on the server": "Zusätzlich auf dem Server einrichten",
  "Applications on this server": "Anwendungen auf diesem Server",
  "Attacks detected and blocked on this server.":
    "Erkannte und blockierte Angriffe auf diesem Server.",
  "Authorized SSH keys": "Berechtigte SSH-Keys",
  "Auto-deploy needs a Dokploy application (above).":
    "Auto-Deploy braucht eine Dokploy-App (oben).",
  "Auto-deploy via Dokploy after merge":
    "Nach dem Merge automatisch über Dokploy deployen",
  "Auto-fix critical/high CVEs (open a PR automatically)":
    "Kritische/hohe CVEs automatisch fixen (PR automatisch öffnen)",
  "Auto-merge held back — the PR is open for review":
    "Auto-Merge zurückgehalten — der PR ist zur Prüfung offen",
  "Auto-merge when the check and CI pass":
    "Automatisch mergen, wenn Check und CI grün sind",
  "Automatic rollback needs a live URL — without one nothing can tell that a deploy broke the site.":
    "Automatischer Rollback braucht eine Live-URL — ohne sie kann nichts erkennen, dass ein Deploy die Seite kaputt gemacht hat.",
  "Automatic scan": "Automatischer Scan",
  "Automatic updates": "Automatische Updates",
  "Autonomous security pipeline": "Autonome Sicherheits-Pipeline",
  "Backup name": "Backup-Name",
  "Backup path": "Backup-Pfad",
  Backups: "Backups",
  "Best practices": "Best Practices",
  Bouncers: "Bouncer",
  "Branch and root directory used when scanning for package.json.":
    "Branch und Root-Ordner, in denen nach der package.json gesucht wird.",
  "Brute-force protection": "Brute-Force-Schutz",
  "Bumps outdated packages on a new branch, checks it and opens a pull request.":
    "Hebt veraltete Pakete auf einem neuen Branch an, prüft ihn und öffnet einen Pull Request.",
  "CPU (load)": "CPU (Last)",
  "CPU is the 1-minute load per core. Thresholds: CPU":
    "CPU ist die 1-Minuten-Last pro Kern. Schwellen: CPU",
  CVEs: "CVEs",
  "Check before the PR": "Prüfung vor dem PR",
  "Check failed": "Prüfung fehlgeschlagen",
  "Check now": "Jetzt prüfen",
  "Checked for Payload sites linked to a Dokploy application (every 15 minutes).":
    "Geprüft für Payload-Seiten mit verknüpfter Dokploy-App (alle 15 Minuten).",
  "Checked from the outside every 15 minutes, no agent needed: common ports (databases, Docker API, Redis, admin panels…) and the TLS certificate. Any open port not listed as expected is a finding; an expected port that does not answer is too. Open ports are also scanned by Nuclei.":
    "Alle 15 Minuten von außen geprüft, ohne Agent: gängige Ports (Datenbanken, Docker-API, Redis, Admin-Panels…) und das TLS-Zertifikat. Jeder offene Port, der nicht als erwartet eingetragen ist, ist ein Finding; ein erwarteter Port, der nicht antwortet, ebenso. Offene Ports scannt auch Nuclei.",
  "Checked from the outside right away — open ports and TLS, no agent needed. OS version, updates and Trivy need the agent.":
    "Sofort von außen geprüft — offene Ports und TLS, ohne Agent. OS-Version, Updates und Trivy brauchen den Agent.",
  "Checked:": "Geprüft:",
  "Checking…": "Prüft…",
  Configuration: "Konfiguration",
  Container: "Container",
  "Copy as markdown": "Als Markdown kopieren",
  "Could not accept": "Konnte nicht bestätigt werden",
  "Could not add the server": "Server konnte nicht hinzugefügt werden",
  "Could not copy — select the text instead.":
    "Kopieren fehlgeschlagen — markiere den Text stattdessen.",
  "Could not create a code": "Code konnte nicht erstellt werden",
  "Could not fix the versions": "Versionen konnten nicht repariert werden",
  "Could not load monitors": "Monitore konnten nicht geladen werden",
  "Could not load servers": "Server konnten nicht geladen werden",
  "Could not load the server": "Server konnte nicht geladen werden",
  "Could not reach Dokploy": "Dokploy nicht erreichbar",
  "Could not start the scan": "Scan konnte nicht gestartet werden",
  "Create PR": "PR erstellen",
  "Creates a one-time code, valid for one hour.":
    "Erstellt einen Einmal-Code, eine Stunde gültig.",
  Critical: "Kritisch",
  "CrowdSec is not running.": "CrowdSec läuft nicht.",
  Current: "Aktuell",
  "Current access accepted": "Aktueller Zugang bestätigt",
  Database: "Datenbank",
  "Database for the build": "Datenbank für den Build",
  Delete: "Löschen",
  "Delete repo": "Repo löschen",
  "Delete repository": "Repository löschen",
  "Delete server": "Server löschen",
  "Deleting…": "Wird gelöscht…",
  "Dependencies and advisories on the configured branch.":
    "Abhängigkeiten und Advisories auf dem eingestellten Branch.",
  Deployment: "Deployment",
  Desktop: "Desktop",
  "Did you (or a colleague) add this? Then accept it. If not, someone else did — remove it and treat the server as compromised.":
    "Hast du (oder ein Kollege) das hinzugefügt? Dann bestätige es. Wenn nicht, war es jemand anderes — entferne es und behandle den Server als kompromittiert.",
  Disk: "Festplatte",
  "Docker apps": "Docker-Apps",
  "Docker publishes container ports past UFW — the external port check (server address under Settings) shows what is really reachable.":
    "Docker veröffentlicht Container-Ports an UFW vorbei — der externe Port-Check (Serveradresse unter Einstellungen) zeigt, was wirklich erreichbar ist.",
  "Dokploy application": "Dokploy-App",
  "Done — open the server": "Fertig — Server öffnen",
  "Download findings.md": "findings.md herunterladen",
  "Each scheduled scan is followed by a scan of the commit the live URL reports — the version that is actually deployed.":
    "Auf jeden geplanten Scan folgt ein Scan des Commits, den die Live-URL meldet — der Version, die wirklich deployt ist.",
  "Each step is off by default. They escalate: merge needs auto-fix; deploy needs merge.":
    "Jeder Schritt ist standardmäßig aus. Sie bauen aufeinander auf: Merge braucht Auto-Fix, Deploy braucht Merge.",
  "Environment in Dokploy": "Umgebung in Dokploy",
  "Error log": "Fehlerprotokoll",
  "Every dependency in package.json against its latest release.":
    "Jede Abhängigkeit aus der package.json gegen ihr neuestes Release.",
  "Everything below is from": "Alles darunter stammt aus",
  Expected: "Erwartet",
  "Expected but not reachable": "Erwartet, aber nicht erreichbar",
  "Expected open ports": "Erwartete offene Ports",
  "External check": "Externer Check",
  "Extra Nuclei targets": "Zusätzliche Nuclei-Ziele",
  "Extra URLs beyond the applications' live URLs, one per line. The same address rules apply as for live URLs.":
    "Zusätzliche URLs über die Live-URLs der Anwendungen hinaus, eine pro Zeile. Es gelten dieselben Adressregeln wie für Live-URLs.",
  "Extra open ports": "Zusätzliche offene Ports",
  "Extra target": "Zusätzliches Ziel",
  "Failed to load": "Laden fehlgeschlagen",
  Filesystem: "Dateisystem",
  Finding: "Finding",
  Findings: "Findings",
  "Findings for agent": "Findings für den Agent",
  "Findings on the running application: Nuclei, Uptime Kuma and — through the linked Dokploy application — its container's image CVEs and memory.":
    "Findings der laufenden Anwendung: Nuclei, Uptime Kuma und — über die verknüpfte Dokploy-App — Image-CVEs und Speicher ihres Containers.",
  "Firewall (UFW)": "Firewall (UFW)",
  "First seen": "Erstmals gesehen",
  Fix: "Fix",
  "Fix critical CVEs": "Kritische CVEs fixen",
  "Fix the input above to get the command.":
    "Korrigiere die Eingabe oben, um den Befehl zu erhalten.",
  "Fix versions on the branch": "Versionen auf dem Branch reparieren",
  "Fix: rebuild on a current base image (e.g. the newest node:22-alpine) and redeploy. Vulnerable npm packages are fixed in the repository — the repository scan opens the update.":
    "Fix: auf einem aktuellen Basis-Image neu bauen (z. B. dem neuesten node:22-alpine) und neu deployen. Verwundbare npm-Pakete werden im Repository gefixt — der Repository-Scan öffnet das Update.",
  "Fixing…": "Wird repariert…",
  "From the outside only ports and certificates are visible. What is installed and what needs updating can only be read on the server itself — install the agent under the Setup tab.":
    "Von außen sind nur Ports und Zertifikate sichtbar. Was installiert ist und Updates braucht, lässt sich nur auf dem Server selbst lesen — installiere den Agent im Setup-Tab.",
  "Full build + tests": "Voller Build + Tests",
  "Fullest disk": "Vollste Festplatte",
  General: "Allgemein",
  "Generate a new install command": "Neuen Install-Befehl erzeugen",
  "Generate install command": "Install-Befehl erzeugen",
  "GitHub organization or repository": "GitHub-Organisation oder -Repository",
  Hardening: "Härtung",
  "Hardening, who can get in, and signs of compromise.":
    "Härtung, wer Zugang hat und Anzeichen einer Kompromittierung.",
  "Hetzner firewall": "Hetzner-Firewall",
  Hide: "Ausblenden",
  High: "Hoch",
  "Host (OS packages)": "Host (OS-Pakete)",
  "IP addresses or networks up to /24 (IPv4) or /48 (IPv6), separated by commas.":
    "IP-Adressen oder Netze bis /24 (IPv4) bzw. /48 (IPv6), durch Kommas getrennt.",
  "IP — name not checked": "IP — Name nicht geprüft",
  "If you do not recognise this: block the server in the provider firewall, keep it running for analysis, rotate every credential that was on it.":
    "Wenn du das nicht kennst: sperre den Server in der Provider-Firewall, lass ihn für die Analyse laufen und erneuere alle Zugangsdaten, die darauf lagen.",
  Image: "Image",
  "Install the agent on the server — the commands are under":
    "Installiere den Agent auf dem Server — die Befehle stehen unter",
  "Keep a second SSH session open while it runs, and test logging in with your key before closing the first — password login is turned off once a key is in place.":
    "Halte währenddessen eine zweite SSH-Sitzung offen und teste den Login mit deinem Key, bevor du die erste schließt — der Passwort-Login wird abgeschaltet, sobald ein Key hinterlegt ist.",
  "Keys and services the site needs — mail, uploads, secrets. Never the values.":
    "Keys und Dienste, die die Seite braucht — Mail, Uploads, Secrets. Nie die Werte.",
  "Last deploy": "Letzter Deploy",
  "Last seen": "Zuletzt gesehen",
  Latest: "Neueste",
  "Latest scan": "Letzter Scan",
  "Latest, including major versions": "Neueste, inklusive Major-Versionen",
  "Lighthouse via PageSpeed Insights, daily and after every deploy":
    "Lighthouse über PageSpeed Insights, täglich und nach jedem Deploy",
  Limit: "Limit",
  "Linked automatically when one Dokploy application deploys this repository. Used for “Merge & deploy”, for auto-deploy, and to match the running container — its memory and image CVEs show up on this page.":
    "Wird automatisch verknüpft, wenn genau eine Dokploy-App dieses Repository deployt. Genutzt für „Merge & Deploy“, für Auto-Deploy und um den laufenden Container zuzuordnen — sein Speicher und seine Image-CVEs erscheinen auf dieser Seite.",
  "Live URL": "Live-URL",
  "Live application": "Live-Anwendung",
  "Live applications": "Live-Anwendungen",
  "Live apps": "Live-Apps",
  "Live log": "Live-Log",
  "Live scan failed": "Live-Scan fehlgeschlagen",
  Load: "Last",
  "Load from Dokploy": "Aus Dokploy laden",
  "Load monitors": "Monitore laden",
  "Load over the last 24 hours": "Last der letzten 24 Stunden",
  "Load, updates, attacks and vulnerabilities on the machines the applications run on.":
    "Last, Updates, Angriffe und Schwachstellen auf den Maschinen, auf denen die Anwendungen laufen.",
  "Loading branches…": "Branches werden geladen…",
  "Loading…": "Lädt…",
  "Major versions can break the app; read the changelogs before merging.":
    "Major-Versionen können die App kaputt machen; lies vor dem Mergen die Changelogs.",
  "Manual install": "Manuelle Installation",
  "Maximum age in hours": "Maximales Alter in Stunden",
  "Measured on": "Gemessen auf",
  Memory: "Arbeitsspeicher",
  "Memory and CPU arrive with agent 1.6.0 — reinstall it from the Setup tab.":
    "Speicher und CPU kommen mit Agent 1.6.0 — installiere ihn im Setup-Tab neu.",
  "Memory cap (optional)": "Speicherlimit (optional)",
  "Memory over time": "Speicher im Verlauf",
  "Memory: e.g. 6G or 4096M.": "Speicher: z. B. 6G oder 4096M.",
  Merge: "Mergen",
  "Merge & deploy": "Merge & Deploy",
  "Merge and deploy?": "Mergen und deployen?",
  "Merge failed": "Merge fehlgeschlagen",
  "Merge the pull request?": "Pull Request mergen?",
  "Merging…": "Wird gemergt…",
  "Minor & patch (recommended)": "Minor & Patch (empfohlen)",
  Mobile: "Mobil",
  "Monitors of the applications on this server.":
    "Monitore der Anwendungen auf diesem Server.",
  "Monitors whose URL matches a linked application are attached automatically; pick others here.":
    "Monitore, deren URL zu einer verknüpften Anwendung passt, werden automatisch zugeordnet; andere wählst du hier.",
  "Never block these IPs (your office)": "Diese IPs nie sperren (euer Büro)",
  "New backup maximum age in hours":
    "Maximales Alter des neuen Backups in Stunden",
  "New backup name": "Name des neuen Backups",
  "New backup path": "Pfad des neuen Backups",
  "Newest file per backup location; too old raises an alarm.":
    "Neueste Datei pro Backup-Ort; zu alt löst einen Alarm aus.",
  "Newest release within each major version — usually deploys without code changes.":
    "Neuestes Release innerhalb jeder Major-Version — deployt meist ohne Codeänderungen.",
  "No Wazuh agent ID set for this server.":
    "Für diesen Server ist keine Wazuh-Agent-ID gesetzt.",
  "No data yet.": "Noch keine Daten.",
  "No database": "Keine Datenbank",
  "No dependencies in package.json or scan returned no results.":
    "Keine Abhängigkeiten in der package.json oder der Scan lieferte keine Ergebnisse.",
  "No inbound rules — everything is blocked.":
    "Keine eingehenden Regeln — alles ist blockiert.",
  "No known vulnerabilities found.": "Keine bekannten Schwachstellen gefunden.",
  "No known vulnerabilities in the deployed version.":
    "Keine bekannten Schwachstellen in der deployten Version.",
  "No live URL set": "Keine Live-URL gesetzt",
  "No live URL set. A triggered deploy only means the platform accepted the request — add the URL under Settings to see whether it reached the running app.":
    "Keine Live-URL gesetzt. Ein ausgelöster Deploy heißt nur, dass die Plattform den Auftrag angenommen hat — trage die URL unter Einstellungen ein, um zu sehen, ob er die laufende App erreicht hat.",
  "No monitors attached. Configure Uptime Kuma under Settings, then link applications with a live URL or pick monitors in this server's settings.":
    "Keine Monitore zugeordnet. Richte Uptime Kuma unter Einstellungen ein und verknüpfe dann Anwendungen mit Live-URL oder wähle Monitore in den Einstellungen dieses Servers.",
  "No open findings on the live application.":
    "Keine offenen Findings auf der Live-Anwendung.",
  "No repositories in this organization yet.":
    "Noch keine Repositories in dieser Organisation.",
  "No run yet. Runs need a free PageSpeed Insights API key (Settings → Performance).":
    "Noch kein Lauf. Läufe brauchen einen kostenlosen PageSpeed-Insights-API-Key (Einstellungen → Performance).",
  "No runs yet.": "Noch keine Läufe.",
  "No scan yet.": "Noch kein Scan.",
  "No scans yet": "Noch keine Scans",
  "No scans yet. Run a scan to see package status.":
    "Noch keine Scans. Starte einen Scan, um den Paketstatus zu sehen.",
  "No servers yet": "Noch keine Server",
  "No targets. Link applications that have a live URL in the Settings tab, or add extra URLs there.":
    "Keine Ziele. Verknüpfe im Einstellungen-Tab Anwendungen mit Live-URL oder füge dort zusätzliche URLs hinzu.",
  "No vulnerability data for this scan":
    "Keine Schwachstellen-Daten für diesen Scan",
  "None watched yet — add the backup folders under Settings and missing backups raise an alarm.":
    "Noch keine überwacht — füge die Backup-Ordner unter Einstellungen hinzu, dann lösen fehlende Backups einen Alarm aus.",
  "None — the repository's CI decides":
    "Keine — die CI des Repositories entscheidet",
  "Not assigned": "Nicht zugeordnet",
  "Not checked yet": "Noch nicht geprüft",
  "Not checked yet.": "Noch nicht geprüft.",
  "Not in the expected ports — see Findings":
    "Nicht in den erwarteten Ports — siehe Findings",
  "Not installed yet.": "Noch nicht installiert.",
  "Not linked": "Nicht verknüpft",
  "Not monitored: assign this application to a server (Settings → Runs on server) so its live URL is scanned with Nuclei and matched to Uptime Kuma.":
    "Nicht überwacht: ordne diese Anwendung einem Server zu (Einstellungen → Läuft auf Server), damit ihre Live-URL mit Nuclei gescannt und Uptime Kuma zugeordnet wird.",
  "Not protected": "Nicht geschützt",
  "Not scanned": "Nicht gescannt",
  "Not scanned yet — Trivy checks running images once a day.":
    "Noch nicht gescannt — Trivy prüft laufende Images einmal täglich.",
  "Not verified": "Nicht verifiziert",
  "Nothing exposed, headers in place.": "Nichts offen, Header vorhanden.",
  "Nothing found on the live applications":
    "Nichts auf den Live-Anwendungen gefunden",
  "Nothing open": "Nichts offen",
  "Nothing resolved yet": "Noch nichts behoben",
  "Nothing runs on this server. Auto-merge then waits for a green GitHub CI; a repository without CI is never merged automatically.":
    "Auf diesem Server läuft nichts. Auto-Merge wartet dann auf eine grüne GitHub-CI; ein Repository ohne CI wird nie automatisch gemergt.",
  "Nuclei and Uptime Kuma.": "Nuclei und Uptime Kuma.",
  "Nuclei runs": "Nuclei-Läufe",
  "Nuclei scan started": "Nuclei-Scan gestartet",
  "OS version, updates, load and Trivy need the agent":
    "OS-Version, Updates, Last und Trivy brauchen den Agent",
  "One command sets up everything. Works on a new server and on one that already runs your apps.":
    "Ein Befehl richtet alles ein. Funktioniert auf einem neuen Server und auf einem, auf dem schon eure Apps laufen.",
  "Only an owner or admin can generate install commands.":
    "Nur Owner oder Admins können Install-Befehle erzeugen.",
  "Only firewall and fail2ban — leave SSH authentication as it is":
    "Nur Firewall und fail2ban — SSH-Anmeldung unverändert lassen",
  "Only for apps that build without a database — Payload and Next.js pages that render from their database fail here, because the check never gets credentials. Runs at low priority, one at a time.":
    "Nur für Apps, die ohne Datenbank bauen — Payload- und Next.js-Seiten, die aus ihrer Datenbank rendern, scheitern hier, weil der Check nie Zugangsdaten bekommt. Läuft mit niedriger Priorität, einer nach dem anderen.",
  "Only on a server meant for builds (e.g. your Dokploy build server). Installs a self-hosted runner that builds every pull request with an empty throwaway database — what Moatline cannot do for Payload/Next.js apps. Set the repository's check to “None” and add the workflow from its settings; auto-merge then waits for it.":
    "Nur auf einem Server für Builds (z. B. eurem Dokploy-Build-Server). Installiert einen Self-hosted Runner, der jeden Pull Request mit einer leeren Wegwerf-Datenbank baut — was Moatline für Payload/Next.js-Apps nicht kann. Stelle die Prüfung des Repositories auf „Keine“ und füge den Workflow aus seinen Einstellungen hinzu; Auto-Merge wartet dann darauf.",
  Open: "Offen",
  "Open findings": "Offene Findings",
  "Open findings on the live applications":
    "Offene Findings auf den Live-Anwendungen",
  "Open server": "Server öffnen",
  "Open settings": "Einstellungen öffnen",
  "Open the affected application": "Betroffene Anwendung öffnen",
  "Optional: build server for GitHub Actions":
    "Optional: Build-Server für GitHub Actions",
  "Outdated packages": "Veraltete Pakete",
  Package: "Paket",
  "Package findings": "Paket-Findings",
  "Package versions do not match: packages released together (Payload, Next.js, React) are at different versions. The deploy would fail — the log below lists them.":
    "Paketversionen passen nicht zusammen: gemeinsam veröffentlichte Pakete (Payload, Next.js, React) haben unterschiedliche Versionen. Der Deploy würde scheitern — das Log unten listet sie auf.",
  "Page weight": "Seitengewicht",
  "Pending updates (": "Offene Updates (",
  "Pending…": "Ausstehend…",
  Performance: "Performance",
  "Plain http outside the tailnet":
    "Unverschlüsseltes http außerhalb des Tailnets",
  "Possible compromise": "Mögliche Kompromittierung",
  "PostgreSQL (Payload migrations run first)":
    "PostgreSQL (Payload-Migrationen laufen zuerst)",
  "Prefer to read the agent first?": "Lieber zuerst den Agent lesen?",
  "Private repositories only: on a public one, anyone could run code on this server with a pull request. The runner is in the docker group (needed for the build database) — root on this server.":
    "Nur für private Repositories: bei einem öffentlichen könnte jeder per Pull Request Code auf diesem Server ausführen. Der Runner ist in der Docker-Gruppe (nötig für die Build-Datenbank) — also root auf diesem Server.",
  "Public IP or hostname": "Öffentliche IP oder Hostname",
  "Public IP or hostname (optional)": "Öffentliche IP oder Hostname (optional)",
  "Puts the previous version back: Dokploy's rollback when it kept the previous image, and a revert commit of the merge on":
    "Stellt die vorherige Version wieder her: Dokploys Rollback, wenn es das vorherige Image behalten hat, und ein Revert-Commit des Merges auf",
  "Reachable from the internet": "Aus dem Internet erreichbar",
  "Real Chrome users (75th percentile): LCP":
    "Echte Chrome-Nutzer (75. Perzentil): LCP",
  "Reboot time (server time, usually UTC)":
    "Neustart-Zeit (Serverzeit, meist UTC)",
  "Registration token": "Registrierungs-Token",
  "Remove this repo and all its scan data? This cannot be undone.":
    "Dieses Repo und alle Scan-Daten entfernen? Das lässt sich nicht rückgängig machen.",
  "Removes the server, its findings and its history.":
    "Entfernt den Server, seine Findings und seinen Verlauf.",
  "Reported by the site": "Von der Seite gemeldet",
  Reporting: "Meldet sich",
  "Repository settings": "Repository-Einstellungen",
  Resolved: "Behoben",
  Revoke: "Widerrufen",
  "Roll back": "Zurückrollen",
  "Roll back automatically when a deploy breaks the site":
    "Automatisch zurückrollen, wenn ein Deploy die Seite kaputt macht",
  "Roll back the last deploy?": "Letzten Deploy zurückrollen?",
  "Roll back this deploy": "Diesen Deploy zurückrollen",
  "Rollback failed": "Rollback fehlgeschlagen",
  "Rollback failed. ": "Rollback fehlgeschlagen. ",
  "Rolled back. ": "Zurückgerollt. ",
  "Rolling back…": "Wird zurückgerollt…",
  Root: "Root",
  "Root directory": "Root-Ordner",
  "Run a scan to check them.": "Starte einen Scan, um sie zu prüfen.",
  "Run failed": "Lauf fehlgeschlagen",
  "Run now": "Jetzt ausführen",
  "Run on the server": "Auf dem Server ausführen",
  "Run progress": "Fortschritt des Laufs",
  "Running…": "Läuft…",
  "Running… (~1 min)": "Läuft… (~1 Min.)",
  "Runs daily on the server; nothing reported yet.":
    "Läuft täglich auf dem Server; noch nichts gemeldet.",
  "Runs on server": "Läuft auf Server",
  "SSH keys": "SSH-Keys",
  "SSH password login": "SSH-Passwort-Login",
  "SSH port": "SSH-Port",
  "SSH, firewall, access changes, Docker risks and signs of compromise — reported by agent 1.4.0 or newer. Reinstall the agent from the Setup tab.":
    "SSH, Firewall, Zugangsänderungen, Docker-Risiken und Anzeichen einer Kompromittierung — gemeldet ab Agent 1.4.0. Installiere den Agent im Setup-Tab neu.",
  Save: "Speichern",
  "Save as": "Speichern als",
  "Save failed": "Speichern fehlgeschlagen",
  "Save settings": "Einstellungen speichern",
  "Saving…": "Wird gespeichert…",
  "Scan failed": "Scan fehlgeschlagen",
  "Scan failed. Check the error above.":
    "Scan fehlgeschlagen. Siehe Fehler oben.",
  "Scan now": "Jetzt scannen",
  "Scan progress": "Scan-Fortschritt",
  "Scan running containers": "Laufende Container scannen",
  "Scan running…": "Scan läuft…",
  "Scan the deployed version": "Deployte Version scannen",
  "Scanning the deployed commit…": "Deployter Commit wird gescannt…",
  "Scans the exact commit the deployment reports, so a CVE fixed in the code can be told apart from one fixed in production.":
    "Scannt genau den Commit, den das Deployment meldet — so lässt sich ein im Code gefixtes CVE von einem in Produktion gefixten unterscheiden.",
  Schedule: "Zeitplan",
  "Schedule:": "Zeitplan:",
  "Scheduled scan": "Geplanter Scan",
  Security: "Sicherheit",
  "Security fix run": "Sicherheits-Fix-Lauf",
  "Security updates": "Sicherheits-Updates",
  "Security updates at 03:00 and 12:00, a reboot only at night when one is needed, Docker packages excluded, containers set to come back up after the reboot.":
    "Sicherheits-Updates um 03:00 und 12:00, ein Neustart nur nachts und nur wenn nötig, Docker-Pakete ausgenommen, Container starten nach dem Neustart wieder.",
  "Security updates only arrive when someone installs them by hand. Run save-server/scripts/auto-update.sh on the server.":
    "Sicherheits-Updates kommen nur, wenn jemand sie von Hand installiert. Führe save-server/scripts/auto-update.sh auf dem Server aus.",
  "Security · CVEs": "Sicherheit · CVEs",
  Server: "Server",
  "Server settings saved": "Server-Einstellungen gespeichert",
  "Servers cannot reach": "Server erreichen nicht",
  Set: "Gesetzt",
  Setup: "Setup",
  Severity: "Schweregrad",
  "Showing the": "Angezeigt werden die",
  Silent: "Still",
  Since: "Seit",
  "Site security": "Seiten-Sicherheit",
  Size: "Größe",
  Source: "Quelle",
  "Squash-merges the pull request into":
    "Merged den Pull Request per Squash in",
  "Start update": "Update starten",
  Started: "Gestartet",
  "Starting…": "Startet…",
  State: "Zustand",
  "TLS on 443:": "TLS auf 443:",
  Targets: "Ziele",
  "That does not look like a public key (ssh-ed25519 / ssh-rsa / ecdsa…).":
    "Das sieht nicht wie ein Public Key aus (ssh-ed25519 / ssh-rsa / ecdsa…).",
  "That does not look like a registration token.":
    "Das sieht nicht wie ein Registrierungs-Token aus.",
  The: "Der",
  "The URL answers but reports no commit.":
    "Die URL antwortet, meldet aber keinen Commit.",
  "The agent refuses to send its token over unencrypted http. Use https, or the Moatline host's Tailscale address.":
    "Der Agent schickt sein Token nicht über unverschlüsseltes http. Nutze https oder die Tailscale-Adresse des Moatline-Hosts.",
  "The agent stopped reporting": "Der Agent meldet sich nicht mehr",
  "The check failed on this branch. Merging anyway can break the deploy — Dokploy then keeps the previous version running.":
    "Die Prüfung ist auf diesem Branch fehlgeschlagen. Trotzdem zu mergen kann den Deploy kaputt machen — Dokploy lässt dann die vorherige Version laufen.",
  "The code works once and until": "Der Code funktioniert einmal und bis",
  "The customer this site belongs to — for the client view and the monthly report.":
    "Der Kunde, zu dem diese Seite gehört — für die Kundenansicht und den Monatsbericht.",
  "The fix exists and has not shipped.":
    "Der Fix existiert, ist aber noch nicht ausgeliefert.",
  "The health endpoint reports no": "Der Health-Endpoint meldet keine",
  "The key comment contains a quote — remove it.":
    "Der Key-Kommentar enthält ein Anführungszeichen — entferne es.",
  "The last scan found no issues at low severity or above.":
    "Der letzte Scan fand keine Probleme ab niedrigem Schweregrad.",
  "The live scan failed.": "Der Live-Scan ist fehlgeschlagen.",
  "The same file is in the repository at":
    "Dieselbe Datei liegt im Repository unter",
  "The server reports in through a small agent — this app never gets SSH access or credentials for it.":
    "Der Server meldet sich über einen kleinen Agent — diese App bekommt nie SSH-Zugang oder Zugangsdaten dafür.",
  "The server's Nuclei scans then include this live URL, and its findings and Uptime Kuma monitors show up here.":
    "Die Nuclei-Scans des Servers enthalten dann diese Live-URL, und ihre Findings und Uptime-Kuma-Monitore erscheinen hier.",
  "The trend appears after a few reports (agent 1.6.0, one every 5 minutes).":
    "Der Verlauf erscheint nach ein paar Berichten (Agent 1.6.0, einer alle 5 Minuten).",
  "The trend appears after a few reports (one every 5 minutes).":
    "Der Verlauf erscheint nach ein paar Berichten (einer alle 5 Minuten).",
  "Their live URLs are scanned by Nuclei and matched to Uptime Kuma monitors, so findings show up on the application itself.":
    "Ihre Live-URLs werden von Nuclei gescannt und Uptime-Kuma-Monitoren zugeordnet, sodass Findings direkt bei der Anwendung erscheinen.",
  "This API instance runs without": "Diese API-Instanz läuft ohne",
  "Token: GitHub → organization (or repository) → Settings → Actions → Runners → New self-hosted runner → the value after":
    "Token: GitHub → Organisation (oder Repository) → Settings → Actions → Runners → New self-hosted runner → der Wert nach",
  "Top scenarios": "Häufigste Szenarien",
  "Trivy is not installed.": "Trivy ist nicht installiert.",
  Type: "Typ",
  "Typecheck (recommended)": "Typecheck (empfohlen)",
  "UFW firewall (SSH, 80, 443 plus your ports), fail2ban, SSH with keys only. On a server that already has firewall rules, existing rules are only shown, never replaced.":
    "UFW-Firewall (SSH, 80, 443 plus deine Ports), fail2ban, SSH nur mit Keys. Auf einem Server mit bestehenden Firewall-Regeln werden diese nur angezeigt, nie ersetzt.",
  "Unused packages": "Ungenutzte Pakete",
  Up: "Online",
  "Update packages": "Pakete aktualisieren",
  "Update run": "Update-Lauf",
  Updates: "Updates",
  Usage: "Nutzung",
  "Use AI to fix breaking changes": "Breaking Changes mit KI beheben",
  "Use HH:MM, e.g. 04:00.": "Format HH:MM, z. B. 04:00.",
  "Use https://github.com/ORG or https://github.com/ORG/REPO.":
    "Nutze https://github.com/ORG oder https://github.com/ORG/REPO.",
  Used: "Belegt",
  Usually: "Üblich",
  "Verified by a second audit": "Durch einen zweiten Audit bestätigt",
  "Versions were aligned on the branch — the pull request has the fix; let its checks finish before merging.":
    "Die Versionen wurden auf dem Branch angeglichen — der Pull Request enthält den Fix; lass seine Checks durchlaufen, bevor du mergst.",
  "View PR": "PR ansehen",
  "Vulnerabilities in the image": "Schwachstellen im Image",
  Vulnerable: "Verwundbar",
  "Waiting for agent": "Wartet auf Agent",
  "Waiting for the first report": "Wartet auf den ersten Bericht",
  "Watches the live URL after every deploy. Dokploy's rollback when it kept the previous image, and a revert of the merge on":
    "Beobachtet die Live-URL nach jedem Deploy. Dokploys Rollback, wenn es das vorherige Image behalten hat, und ein Revert des Merges auf",
  "Watching the deploy — Dokploy's build state and the live URL — for up to 12 minutes…":
    "Beobachtet den Deploy — Build-Status in Dokploy und die Live-URL — bis zu 12 Minuten…",
  "Wazuh agent ID": "Wazuh-Agent-ID",
  "What the Hetzner firewall lets in": "Was die Hetzner-Firewall hereinlässt",
  "What the live site shows anyone: exposed files":
    "Was die Live-Seite jedem zeigt: offene Dateien",
  "What the outside world reaches. Nuclei scans these with safe, non-intrusive templates only; findings land on the application they belong to.":
    "Was die Außenwelt erreicht. Nuclei scannt sie nur mit sicheren, nicht-invasiven Templates; Findings landen bei der Anwendung, zu der sie gehören.",
  "Where this repo is deployed. Prefer an endpoint that returns a JSON":
    "Wo dieses Repo deployt ist. Am besten ein Endpoint, der ein JSON-Feld",
  "Where this server's backups land. The agent checks the newest file on every report; one that is too old raises an alarm.":
    "Wo die Backups dieses Servers landen. Der Agent prüft bei jedem Bericht die neueste Datei; ist sie zu alt, gibt es einen Alarm.",
  "Which updates": "Welche Updates",
  "Workflow for your build server": "Workflow für euren Build-Server",
  "Yes, accept current access": "Ja, aktuellen Zugang bestätigen",
  "Your public SSH key (optional — an existing authorized_keys is used otherwise)":
    "Dein öffentlicher SSH-Key (optional — sonst wird eine bestehende authorized_keys genutzt)",
  "and compose stacks": "und Compose-Stacks",
  "and security headers. Read-only, daily and after every deploy.":
    "und Security-Header. Nur lesend, täglich und nach jedem Deploy.",
  "and {n} more.": "und {n} weitere.",
  "audit did not run": "Audit lief nicht",
  "auto-update command": "Auto-Update-Befehl",
  "checksum command": "Prüfsummen-Befehl",
  "common ports (SSH, web, databases, Docker API, Redis, admin panels…). Expected:":
    "gängige Ports (SSH, Web, Datenbanken, Docker-API, Redis, Admin-Panels…). Erwartet:",
  "config ok": "Konfig ok",
  "docker group (= root)": "Docker-Gruppe (= root)",
  "download command": "Download-Befehl",
  "e.g. apps/web — leave empty for repo root":
    "z. B. apps/web — leer lassen für den Repo-Root",
  "e.g. hetzner-web-01": "z. B. hetzner-web-01",
  "expires in": "läuft ab in",
  "failed on the update branch — review the pull request before merging. The log below shows what failed.":
    "ist auf dem Update-Branch fehlgeschlagen — prüfe den Pull Request vor dem Mergen. Das Log unten zeigt, was fehlschlug.",
  "field at": "-Feld unter",
  "field: then a deploy is confirmed by the commit changing, not by the page merely loading.":
    "liefert: dann wird ein Deploy durch den neuen Commit bestätigt, nicht nur dadurch, dass die Seite lädt.",
  "fix available": "Fix verfügbar",
  "fix for": "Fix für",
  "half the RAM, e.g. 6G": "halber RAM, z. B. 6G",
  "hardening command": "Härtungs-Befehl",
  "install command": "Install-Befehl",
  "is available": "ist verfügbar",
  "is not set —": "ist nicht gesetzt —",
  "killed for running out of memory": "wegen Speichermangel beendet",
  "manual only": "nur manuell",
  "more in the Findings tab.": "weitere im Findings-Tab.",
  "most severe of": "schwerste von",
  "no files": "keine Dateien",
  "no findings": "keine Findings",
  "no fix": "kein Fix",
  "no fix yet": "noch kein Fix",
  "no known CVEs": "keine bekannten CVEs",
  "no live URL": "keine Live-URL",
  "no live URL set": "keine Live-URL gesetzt",
  "no report yet": "noch kein Bericht",
  "none critical or high": "keine kritischen oder hohen",
  "not checked yet": "noch nicht geprüft",
  "not imported anywhere": "nirgends importiert",
  "not needed": "nicht nötig",
  "not trusted": "nicht vertrauenswürdig",
  "nothing answers": "nichts antwortet",
  "on the API to an address the servers reach — over Tailscale e.g.":
    "auf der API auf eine Adresse, die die Server erreichen — über Tailscale z. B.",
  "open security": "offene Sicherheits-",
  "pending across all servers": "offen auf allen Servern",
  "requests ·": "Anfragen ·",
  "resolved ": "behoben ",
  "root login": "Root-Login",
  "runner install command": "Runner-Install-Befehl",
  "running containers": "laufende Container",
  "scheduler not running on this instance":
    "Scheduler läuft auf dieser Instanz nicht",
  "selected · scanned on their default branch from the repository root. For a monorepo, set the root directory afterwards in the repository's settings.":
    "ausgewählt · gescannt auf dem Standard-Branch ab dem Repository-Root. Bei einem Monorepo setzt du den Root-Ordner danach in den Repository-Einstellungen.",
  "since ": "seit ",
  "to pick the application from a list.":
    ", um die App aus einer Liste zu wählen.",
  "tsc --noEmit: catches what an update breaks in the code, needs no database and little memory.":
    "tsc --noEmit: findet, was ein Update im Code kaputt macht, braucht keine Datenbank und wenig Speicher.",
  "uid 0 accounts": "Konten mit uid 0",
  "unattended-upgrades installs security updates on its own; this shows whether it actually does.":
    "unattended-upgrades installiert Sicherheits-Updates selbstständig; hier siehst du, ob es das wirklich tut.",
  "visible to the API key. Missing one? Projects in another Dokploy organization need a key from that organization.":
    "für den API-Key sichtbar. Fehlt eine? Projekte in einer anderen Dokploy-Organisation brauchen einen Key aus dieser Organisation.",
  "waiting for agent": "wartet auf Agent",
  "{n} further vulnerabilities affect only {branch} — introduced after this commit was built.":
    "{n} weitere Schwachstellen betreffen nur {branch} — nach dem Build dieses Commits hinzugekommen.",
  "{n} further vulnerability affects only {branch} — introduced after this commit was built.":
    "{n} weitere Schwachstelle betrifft nur {branch} — nach dem Build dieses Commits hinzugekommen.",
  "{n} known vulnerabilities in the deployed version — all of them still open on {branch} too, so there is nothing waiting to be deployed.":
    "{n} bekannte Schwachstellen in der deployten Version — alle auch auf {branch} noch offen, es wartet also nichts auf einen Deploy.",
  "{n} known vulnerability in the deployed version — still open on {branch} too, so there is nothing waiting to be deployed.":
    "{n} bekannte Schwachstelle in der deployten Version — auch auf {branch} noch offen, es wartet also nichts auf einen Deploy.",
  "{n} vulnerabilities are fixed on {branch} but still running live":
    "{n} Schwachstellen sind auf {branch} gefixt, laufen aber noch live",
  "{n} vulnerability is fixed on {branch} but still running live":
    "{n} Schwachstelle ist auf {branch} gefixt, läuft aber noch live",
  "· checked": "· geprüft",
  "· commit": "· Commit",
  "· recommended": "· empfohlen",
  "— Trivy checks the images that are live":
    "— Trivy prüft die Images, die live laufen",
  "— change under Settings.": "— änderbar unter Einstellungen.",
  "— details in the Findings tab (filter “Security”).":
    "— Details im Findings-Tab (Filter „Sicherheit“).",
  "— set the Dokploy URL and API key under":
    "— trage die Dokploy-URL und den API-Key ein unter",
  "— then a broken mail setup shows up here and notifies you.":
    "— dann erscheint ein kaputtes Mail-Setup hier und du wirst benachrichtigt.",
  "— version": "— Version",
  "live is up to date": "Live ist aktuell",
  "not deployed yet": "noch nicht deployt",
  "Both are watched every few minutes; a change scans again by itself.":
    "Beide werden alle paar Minuten beobachtet; bei einer Änderung wird automatisch neu gescannt.",
  "auto-scanned on change": "bei Änderung automatisch gescannt",

  // Dashboard, monitoring, settings, team, audit, account, sign-in
  ", send it a message (or add it to your team's group), then click":
    ", schreibe ihm eine Nachricht (oder füge ihn zur Gruppe deines Teams hinzu) und klicke dann auf",
  ". Alerts arrive for new critical CVEs, auto-fix PRs, deploys, failures and new server problems.":
    ". Alarme kommen bei neuen kritischen CVEs, Auto-Fix-PRs, Deploys, Fehlern und neuen Server-Problemen.",
  ". Read is enough and keeps the token harmless: it cannot change firewalls or servers. Servers are matched by their public IP (the address in the server settings) or by name.":
    ". Lesen reicht und hält das Token harmlos: es kann weder Firewalls noch Server ändern. Server werden über ihre öffentliche IP (die Adresse in den Server-Einstellungen) oder den Namen zugeordnet.",
  "1. Scan the code with your authenticator app, or enter this key by hand:":
    "1. Scanne den Code mit deiner Authenticator-App oder gib diesen Schlüssel von Hand ein:",
  "2. Enter the 6-digit code it shows:":
    "2. Gib den 6-stelligen Code ein, den sie anzeigt:",
  "; the update and security workflows also need":
    "; die Update- und Sicherheits-Workflows brauchen außerdem",
  "API key": "API-Key",
  "API keys (MCP)": "API-Keys (MCP)",
  "API token (x-api-key)": "API-Token (x-api-key)",
  "Accept invitation": "Einladung annehmen",
  "Access token": "Zugriffstoken",
  "Account created. Copy these credentials now — they cannot be shown again.":
    "Konto erstellt. Kopiere diese Zugangsdaten jetzt — sie können nicht noch einmal angezeigt werden.",
  "Add it to Claude Code:": "Zu Claude Code hinzufügen:",
  "Add one to start scanning.":
    "Füge eines hinzu, um mit dem Scannen zu beginnen.",
  "Agent status and hardening (SCA) scores from the Wazuh manager API.":
    "Agent-Status und Härtungs-Scores (SCA) aus der Wazuh-Manager-API.",
  "Also allow starting Nuclei and repository scans":
    "Auch das Starten von Nuclei- und Repository-Scans erlauben",
  "Also allow opening security-fix pull requests":
    "Auch das Öffnen von Security-Fix-Pull-Requests erlauben",
  "Agents & automation": "Agents & Automation",
  "Allow security fixes over MCP": "Security-Fixes über MCP erlauben",
  "API keys with the fix scope may open lockfile-only security PRs. Turn off to keep MCP read/scan only.":
    "API-Keys mit dem Fix-Scope dürfen nur-Lockfile-Security-PRs öffnen. Ausschalten hält MCP auf Lesen/Scans.",
  "Auto-fix critical CVEs on new repositories":
    "Kritische CVEs auf neuen Repositories automatisch fixen",
  "Automation & AI agents": "Automation & KI-Agents",
  "Automation policy saved": "Automations-Richtlinie gespeichert",
  "Blocks enabling auto-merge and auto-deploy on any repository. Fixes still open as PRs.":
    "Blockiert das Einschalten von Auto-Merge und Auto-Deploy auf jedem Repository. Fixes öffnen weiterhin als PRs.",
  "Blocks auto-merge and auto-deploy. Saving turns them off on repositories that already had them enabled. Fixes still open as PRs.":
    "Blockiert Auto-Merge und Auto-Deploy. Beim Speichern werden sie auf Repositories ausgeschaltet, die sie schon hatten. Fixes öffnen weiterhin als PRs.",
  "Automation policy saved — auto-merge/deploy turned off on {n} repositories":
    "Automations-Richtlinie gespeichert — Auto-Merge/Deploy auf {n} Repositories ausgeschaltet",
  "Also allow listing organization members":
    "Auch das Auflisten der Organisationsmitglieder erlauben",
  "can list members": "kann Mitglieder auflisten",
  "PR review policy enforced": "PR-Review-Richtlinie durchgesetzt",
  "Limit to repositories (empty = all)":
    "Auf Repositories beschränken (leer = alle)",
  "Limit to servers (empty = all)": "Auf Server beschränken (leer = alle)",
  "New repositories start with auto-fix for critical advisories turned on. You can still change each repository.":
    "Neue Repositories starten mit Auto-Fix für kritische Advisories. Du kannst jedes Repository weiterhin ändern.",
  "No agent or automation events yet":
    "Noch keine Agent- oder Automations-Ereignisse",
  "Require pull-request review": "Pull-Request-Review verlangen",
  "Rules for unattended security fixes and what coding agents may start over MCP. Every action is written to the audit log.":
    "Regeln für unbeaufsichtigte Security-Fixes und was Coding-Agents über MCP starten dürfen. Jede Aktion landet im Audit-Log.",
  "Save automation policy": "Automations-Richtlinie speichern",
  "API key updated": "API-Key aktualisiert",
  "Save key": "Key speichern",
  "Edit {name}": "{name} bearbeiten",
  "Updated API key": "API-Key geändert",
  "Security fix PR opened": "Security-Fix-PR geöffnet",
  "Via MCP ({key})": "Über MCP ({key})",
  Manual: "Manuell",
  "can open fix PRs": "kann Fix-PRs öffnen",
  "{n} repositories": "{n} Repositories",
  Application: "Anwendung",
  "Ask them to change it after the first sign-in via “Forgot password?”.":
    "Bitte sie, es nach der ersten Anmeldung über „Passwort vergessen?“ zu ändern.",
  "Assign a monitor to a server and its problems appear there and in Findings. Monitors on an application's live URL are assigned automatically.":
    "Ordne einen Monitor einem Server zu, dann erscheinen seine Probleme dort und in den Findings. Monitore auf der Live-URL einer Anwendung werden automatisch zugeordnet.",
  "Assign the application to a server to scan its live URL with Nuclei.":
    "Ordne die Anwendung einem Server zu, um ihre Live-URL mit Nuclei zu scannen.",
  "Authentication code": "Authentifizierungscode",
  "Auto-fix": "Auto-Fix",
  "Automatic scans are not running": "Automatische Scans laufen nicht",
  "Back to sign in": "Zurück zur Anmeldung",
  "Back to the app": "Zurück zur App",
  "Backup code": "Backup-Code",
  "Backup codes copied": "Backup-Codes kopiert",
  "Backup codes — shown only now": "Backup-Codes — nur jetzt sichtbar",
  "Base URL": "Basis-URL",
  "CA certificate (PEM)": "CA-Zertifikat (PEM)",
  Certificates: "Zertifikate",
  "Choose a new password": "Wähle ein neues Passwort",
  "Code from the authenticator app": "Code aus der Authenticator-App",
  Configured: "Eingerichtet",
  "Configured – paste to replace": "Eingerichtet – zum Ersetzen einfügen",
  "Confirm with your password": "Mit deinem Passwort bestätigen",
  "Contents: read": "Contents: read",
  "Contents: write": "Contents: write",
  Copied: "Kopiert",
  Copy: "Kopieren",
  "Could not copy the findings": "Findings konnten nicht kopiert werden",
  "Could not create the account.": "Konto konnte nicht erstellt werden.",
  "Could not create the key": "Key konnte nicht erstellt werden",
  "Could not create the organization.":
    "Organisation konnte nicht erstellt werden.",
  "Could not download the findings":
    "Findings konnten nicht heruntergeladen werden",
  "Could not load the overview": "Übersicht konnte nicht geladen werden",
  "Could not remove": "Konnte nicht entfernt werden",
  "Could not revoke": "Konnte nicht widerrufen werden",
  "Could not send": "Konnte nicht gesendet werden",
  Coverage: "Abdeckung",
  "Create a bot with": "Erstelle einen Bot mit",
  "Create a key in Uptime Kuma under Settings → API Keys. It only grants read access to":
    "Erstelle in Uptime Kuma unter Settings → API Keys einen Key. Er gewährt nur Lesezugriff auf",
  "Create account": "Konto erstellen",
  "Create an account directly": "Konto direkt erstellen",
  "Create key": "Key erstellen",
  "Creating…": "Wird erstellt…",
  "Dokploy (auto-deploy)": "Dokploy (Auto-Deploy)",
  Done: "Fertig",
  Download: "Herunterladen",
  "Each backup code works once.": "Jeder Backup-Code funktioniert einmal.",
  "Each code signs you in once without the app. Store them in your password manager; older codes no longer work.":
    "Jeder Code meldet dich einmal ohne App an. Speichere sie in deinem Passwort-Manager; ältere Codes funktionieren nicht mehr.",
  Email: "E-Mail",
  "Email (SMTP)": "E-Mail (SMTP)",
  "Enter the Kuma URL and an API key under Settings to see all monitors here.":
    "Trage die Kuma-URL und einen API-Key unter Einstellungen ein, um hier alle Monitore zu sehen.",
  "Every tool in one list, most severe first. Click a row for details.":
    "Alle Tools in einer Liste, das Schwerste zuerst. Klicke auf eine Zeile für Details.",
  "Everyone with access to this organization.":
    "Alle mit Zugang zu dieser Organisation.",
  Expires: "Läuft ab",
  Exposed: "Exponiert",
  "Exposed vulnerabilities": "Exponierte Schwachstellen",
  "Find chat": "Chat finden",
  "Findings copied — paste them into your coding agent":
    "Findings kopiert — füge sie in deinen Coding-Agent ein",
  "For a manager with a self-signed certificate: paste its CA and exactly that CA is trusted. TLS verification is never switched off. Use a user with a read-only role.":
    "Für einen Manager mit selbstsigniertem Zertifikat: füge seine CA ein, dann wird genau dieser CA vertraut. Die TLS-Prüfung wird nie abgeschaltet. Nutze einen Benutzer mit Nur-Lese-Rolle.",
  "Forgot password?": "Passwort vergessen?",
  'Free: Google Cloud Console → APIs & Services → enable "PageSpeed Insights API" → Credentials → Create API key (restrict it to that API). 25,000 runs a day; without a key Google allows none.':
    "Kostenlos: Google Cloud Console → APIs & Services → „PageSpeed Insights API“ aktivieren → Credentials → Create API key (auf diese API beschränken). 25.000 Läufe pro Tag; ohne Key erlaubt Google keine.",
  From: "Von",
  "Go to repositories": "Zu den Repositories",
  "Go to sign in": "Zur Anmeldung",
  "Hetzner Cloud firewalls": "Hetzner-Cloud-Firewalls",
  "Hetzner Console → project → Security → API tokens → Generate, with permission":
    "Hetzner Console → Projekt → Security → API tokens → Generate, mit der Berechtigung",
  "Hetzner tokens removed": "Hetzner-Tokens entfernt",
  Host: "Host",
  "I have stored it": "Ich habe ihn gespeichert",
  "I have stored them": "Ich habe sie gespeichert",
  "If that address belongs to an account, a reset link is on its way. The link expires in one hour.":
    "Gehört die Adresse zu einem Konto, ist ein Link zum Zurücksetzen unterwegs. Er läuft nach einer Stunde ab.",
  Integrations: "Integrationen",
  "Integrations saved": "Integrationen gespeichert",
  "Invite a colleague": "Kolleg:in einladen",
  "Inviting…": "Wird eingeladen…",
  "Jane Doe": "Max Muster",
  "Joining…": "Tritt bei…",
  "Last scan": "Letzter Scan",
  "Let Claude or another AI assistant read this organization's servers, findings, uptime and repositories over MCP. Read-only unless you allow starting scans; nothing can change settings or touch servers.":
    "Lass Claude oder einen anderen KI-Assistenten die Server, Findings, Uptime und Repositories dieser Organisation über MCP lesen. Nur lesend, außer du erlaubst das Starten von Scans; Einstellungen ändern oder Server anfassen kann nichts.",
  "Let Claude or another AI assistant read this organization's servers, findings, uptime and repositories over MCP. Choose scopes and optional allowlists; nothing can change settings or touch servers.":
    "Lass Claude oder einen anderen KI-Assistenten die Server, Findings, Uptime und Repositories dieser Organisation über MCP lesen. Wähle Scopes und optionale Allowlists; Einstellungen ändern oder Server anfassen kann nichts.",
  "Lets the security pipeline ship a merged fix.":
    "Lässt die Sicherheits-Pipeline einen gemergten Fix ausliefern.",
  "Lighthouse and Core Web Vitals of every live site, daily and after each deploy, through Google PageSpeed Insights.":
    "Lighthouse und Core Web Vitals jeder Live-Seite, täglich und nach jedem Deploy, über Google PageSpeed Insights.",
  "Live app": "Live-App",
  "Live app:": "Live-App:",
  "Load older": "Ältere laden",
  "Loading invitation": "Einladung wird geladen",
  "Lookup failed": "Suche fehlgeschlagen",
  "Lost your phone? Use a backup code":
    "Handy verloren? Nutze einen Backup-Code",
  "Manager API URL": "Manager-API-URL",
  Members: "Mitglieder",
  Monitor: "Monitor",
  Monitors: "Monitore",
  "Monitors are pulled every 5 minutes and attached to the servers and applications they watch.":
    "Monitore werden alle 5 Minuten abgerufen und den Servern und Anwendungen zugeordnet, die sie überwachen.",
  "Name (optional)": "Name (optional)",
  "Needed for private repositories. Scanning requires":
    "Nötig für private Repositories. Scannen braucht",
  "New backup codes": "Neue Backup-Codes",
  "New key": "Neuer Key",
  "New organization…": "Neue Organisation…",
  "New password": "Neues Passwort",
  "No chats yet – send your bot a message (or add it to a group), then try again.":
    "Noch keine Chats – schreibe deinem Bot eine Nachricht (oder füge ihn zu einer Gruppe hinzu) und versuche es dann erneut.",
  "No email is sent. The account is created straight away with a generated password — pass the credentials on yourself.":
    "Es wird keine E-Mail verschickt. Das Konto wird sofort mit einem generierten Passwort erstellt — gib die Zugangsdaten selbst weiter.",
  "No known vulnerabilities across scanned repositories.":
    "Keine bekannten Schwachstellen in den gescannten Repositories.",
  "No live URL — what is deployed is unknown.":
    "Keine Live-URL — unbekannt, was deployt ist.",
  "No members yet.": "Noch keine Mitglieder.",
  "No monitors match": "Kein Monitor passt",
  "No organization selected": "Keine Organisation gewählt",
  "No problems": "Keine Probleme",
  "No repositories connected yet.": "Noch keine Repositories verbunden.",
  "No repositories yet": "Noch keine Repositories",
  "No servers connected — load, updates, CrowdSec and Trivy on the hosts are not monitored.":
    "Keine Server verbunden — Last, Updates, CrowdSec und Trivy auf den Hosts werden nicht überwacht.",
  "No tool reports a problem right now.":
    "Gerade meldet kein Tool ein Problem.",
  "Not now": "Nicht jetzt",
  "Nothing recorded yet": "Noch nichts aufgezeichnet",
  Notifications: "Benachrichtigungen",
  "Notify address": "Benachrichtigungs-Adresse",
  "One token per line": "Ein Token pro Zeile",
  "Open Kuma": "Kuma öffnen",
  "Open findings on all servers": "Offene Findings auf allen Servern",
  "Open vulnerabilities across every repository in this organization.":
    "Offene Schwachstellen in allen Repositories dieser Organisation.",
  "Organization invitation": "Einladung zur Organisation",
  "Organization name": "Name der Organisation",
  Organizations: "Organisationen",
  "PageSpeed Insights API key": "PageSpeed-Insights-API-Key",
  Password: "Passwort",
  "Password changed. Taking you to the sign-in page…":
    "Passwort geändert. Du wirst zur Anmeldung weitergeleitet…",
  "Pending invitations": "Offene Einladungen",
  "Performance (Lighthouse)": "Performance (Lighthouse)",
  Port: "Port",
  Problems: "Probleme",
  "Pull requests: read and write": "Pull requests: read and write",
  "QR code for the authenticator app": "QR-Code für die Authenticator-App",
  Read: "Read",
  "Read the firewall rules in front of each server, so a database port the firewall opens to everyone is caught — not only what our one IP sees.":
    "Liest die Firewall-Regeln vor jedem Server, damit ein Datenbank-Port erkannt wird, den die Firewall für alle öffnet — nicht nur das, was unsere eine IP sieht.",
  "Read-only project tokens, one per line":
    "Nur-Lese-Projekt-Tokens, eines pro Zeile",
  Refresh: "Aktualisieren",
  "Refresh failed": "Aktualisieren fehlgeschlagen",
  "Registration is invitation only — an invited address can create an account, nobody else can.":
    "Registrierung nur auf Einladung — eine eingeladene Adresse kann ein Konto erstellen, sonst niemand.",
  Remove: "Entfernen",
  "Remove tokens": "Tokens entfernen",
  "Repeat new password": "Neues Passwort wiederholen",
  "Repositories here have a schedule, but this API instance was started without the scheduler. Set":
    "Repositories hier haben einen Zeitplan, aber diese API-Instanz wurde ohne Scheduler gestartet. Setze",
  "Repositories, scans and members all live inside an organization.":
    "Repositories, Scans und Mitglieder gehören immer zu einer Organisation.",
  "Request a new link": "Neuen Link anfordern",
  "Reset your password": "Passwort zurücksetzen",
  Response: "Antwort",
  Retrying: "Neuer Versuch",
  Role: "Rolle",
  "Save changes": "Änderungen speichern",
  Saved: "Gespeichert",
  "Scheduler active — checks for due scans every 5 minutes":
    "Scheduler aktiv — prüft alle 5 Minuten auf fällige Scans",
  "Scroll sideways for every tool.": "Seitlich scrollen für alle Tools.",
  "Search monitors": "Monitore durchsuchen",
  "Search name or URL": "Name oder URL suchen",
  "Security overview": "Sicherheitsübersicht",
  "Select or create an organization first.":
    "Wähle oder erstelle zuerst eine Organisation.",
  "Select organization": "Organisation wählen",
  "Send invitation": "Einladung senden",
  "Send reset link": "Link zum Zurücksetzen senden",
  "Send test message": "Testnachricht senden",
  "Send this week's summary now": "Wochen-Zusammenfassung jetzt senden",
  "Sending…": "Wird gesendet…",
  "Sends invitations, password resets and alert mails.":
    "Verschickt Einladungen, Passwort-Resets und Alarm-Mails.",
  "Server · application": "Server · Anwendung",
  "Set new password": "Neues Passwort setzen",
  "Sign in": "Anmelden",
  "Sign in failed": "Anmeldung fehlgeschlagen",
  "Sign in to accept this invitation. If you do not have an account yet, sign up with the address the invitation was sent to — an invited address can register even though registration is otherwise closed.":
    "Melde dich an, um diese Einladung anzunehmen. Hast du noch kein Konto, registriere dich mit der Adresse, an die die Einladung ging — eine eingeladene Adresse kann sich registrieren, obwohl die Registrierung sonst geschlossen ist.",
  "Sign in to scan your repositories for outdated and vulnerable packages.":
    "Melde dich an, um deine Repositories auf veraltete und verwundbare Pakete zu scannen.",
  "Sign up": "Registrieren",
  "Sign up failed": "Registrierung fehlgeschlagen",
  "Signing in also asks for a code from an authenticator app (1Password, Bitwarden, Google Authenticator, …). Required for owners and admins: this app knows every server and holds the integration secrets.":
    "Die Anmeldung fragt zusätzlich nach einem Code aus einer Authenticator-App (1Password, Bitwarden, Google Authenticator, …). Pflicht für Owner und Admins: diese App kennt jeden Server und verwahrt die Integrations-Secrets.",
  "Slack incoming webhook URL": "Slack-Incoming-Webhook-URL",
  "Telegram bot token": "Telegram-Bot-Token",
  "Telegram chat ID": "Telegram-Chat-ID",
  "Test failed": "Test fehlgeschlagen",
  "That code did not work": "Der Code hat nicht funktioniert",
  "The 6-digit code from your authenticator app.":
    "Der 6-stellige Code aus deiner Authenticator-App.",
  "The live URL reports no commit, so the deployed version could not be scanned.":
    "Die Live-URL meldet keinen Commit, daher konnte die deployte Version nicht gescannt werden.",
  "The scheduler could not read the database":
    "Der Scheduler konnte die Datenbank nicht lesen",
  "This link is missing its reset token. Request a new one.":
    "Diesem Link fehlt das Reset-Token. Fordere einen neuen an.",
  "Tokens and endpoints this organization uses for scans, fixes and notifications.":
    "Tokens und Endpunkte, die diese Organisation für Scans, Fixes und Benachrichtigungen nutzt.",
  "Trust this device for 30 days": "Diesem Gerät 30 Tage vertrauen",
  "Turn off": "Ausschalten",
  "Turn on": "Einschalten",
  "Two-factor authentication": "Zwei-Faktor-Authentifizierung",
  "Two-factor authentication is on": "Zwei-Faktor-Authentifizierung ist aktiv",
  "Two-factor authentication turned off":
    "Zwei-Faktor-Authentifizierung ausgeschaltet",
  Unassigned: "Nicht zugeordnet",
  Uptime: "Uptime",
  "Uptime Kuma URL": "Uptime-Kuma-URL",
  "Uptime Kuma could not be reached": "Uptime Kuma nicht erreichbar",
  "Uptime Kuma is not connected": "Uptime Kuma ist nicht verbunden",
  "Uptime Kuma, Trivy, CrowdSec, Nuclei, Wazuh and the server agents in one place.":
    "Uptime Kuma, Trivy, CrowdSec, Nuclei, Wazuh und die Server-Agents an einem Ort.",
  "Use the authenticator app instead":
    "Stattdessen die Authenticator-App nutzen",
  "Used to clone repositories and open pull requests.":
    "Zum Klonen von Repositories und Öffnen von Pull Requests.",
  User: "Benutzer",
  "Valid for": "Gültig für",
  "Verification failed": "Überprüfung fehlgeschlagen",
  Verify: "Bestätigen",
  "View all": "Alle ansehen",
  "Vulnerabilities in the deployed version where it is known, plus what Nuclei and Uptime Kuma found on the running application.":
    "Schwachstellen in der deployten Version, soweit bekannt, plus das, was Nuclei und Uptime Kuma auf der laufenden Anwendung gefunden haben.",
  "Waiting for the invited person to accept.":
    "Wartet darauf, dass die eingeladene Person annimmt.",
  "We will email you a link to choose a new one.":
    "Wir schicken dir per E-Mail einen Link, um ein neues zu wählen.",
  "Weekly summary": "Wochen-Zusammenfassung",
  "Weekly summary on Mondays": "Wochen-Zusammenfassung montags",
  What: "Was",
  When: "Wann",
  "Where scan results and pipeline events are posted.":
    "Wohin Scan-Ergebnisse und Pipeline-Ereignisse gesendet werden.",
  'Which tool watches which server. A grey cell is not "all good" — it means nobody is looking.':
    "Welches Tool welchen Server überwacht. Eine graue Zelle heißt nicht „alles gut“ — sondern dass niemand hinschaut.",
  Who: "Wer",
  "Who did what, when and from where — sign-ins, access to servers, integrations, members, MCP tools and unattended actions. Secret values are never recorded.":
    "Wer hat was wann und von wo getan — Anmeldungen, Serverzugriff, Integrationen, Mitglieder, MCP-Tools und unbeaufsichtigte Aktionen. Geheimnisse werden nie gespeichert.",
  "Who did what, when and from where — sign-ins, access to servers, integrations, members and unattended actions. Secret values are never recorded.":
    "Wer was wann und von wo getan hat — Anmeldungen, Zugriffe auf Server, Integrationen, Mitglieder und automatische Aktionen. Secret-Werte werden nie aufgezeichnet.",
  "You were invited to join": "Du wurdest eingeladen, beizutreten:",
  "Your key — shown only now": "Dein Key — nur jetzt sichtbar",
  "an organization": "einer Organisation",
  "applications are measured on their branch only. Give them a live URL that reports its commit (repository → Settings) — then the scheduled scan also checks what is actually deployed.":
    "Anwendungen werden nur auf ihrem Branch gemessen. Gib ihnen eine Live-URL, die ihren Commit meldet (Repository → Einstellungen) — dann prüft der geplante Scan auch, was wirklich deployt ist.",
  "branch only": "nur Branch",
  "can start scans": "kann Scans starten",
  "claude mcp add command": "claude-mcp-add-Befehl",
  "configured – enter to replace": "eingerichtet – zum Ersetzen eingeben",
  "e.g. Claude on Alex's laptop": "z. B. Claude auf Alex' Laptop",
  "failed a check, not down yet": "Check fehlgeschlagen, noch nicht offline",
  "fixed on a branch but still running live — the fix has not been deployed.":
    "auf einem Branch gefixt, läuft aber noch live — der Fix ist noch nicht deployt.",
  "fixed, not deployed": "gefixt, nicht deployt",
  "never used": "nie benutzt",
  "no open findings": "keine offenen Findings",
  "not monitored": "nicht überwacht",
  "not scanned": "nicht gescannt",
  "on exactly one API instance and restart it. Manual scans are unaffected.":
    "auf genau einer API-Instanz und starte sie neu. Manuelle Scans sind nicht betroffen.",
  "moatline (read-only role)": "moatline (Nur-Lese-Rolle)",
  "the last successful pull": "dem letzten erfolgreichen Abruf",
  "to push branches and open or merge PRs. Without a token here the server-wide GITHUB_TOKEN is used, if one is set.":
    ", um Branches zu pushen und PRs zu öffnen oder zu mergen. Ohne Token hier wird das serverweite GITHUB_TOKEN genutzt, falls gesetzt.",
  "vulnerabilities are": "Schwachstellen sind",
  "vulnerability is": "Schwachstelle ist",
  "· last": "· zuletzt",
  "· last scan": "· letzter Scan",
  "— showing the state from": "— angezeigt wird der Stand von",
  critical: "kritisch",
  high: "hoch",
  medium: "mittel",
  moderate: "mittel",
  low: "niedrig",
  info: "Info",
  "PR closed": "PR geschlossen",
  "Language of notifications": "Sprache der Benachrichtigungen",
  "Slack, Telegram and email. Package names and error texts from GitHub stay as they are.":
    "Slack, Telegram und E-Mail. Paketnamen und Fehlertexte von GitHub bleiben, wie sie sind.",
  Redeploy: "Redeploy",
  "Redeploy {name}": "{name} neu deployen",
  "Redeploy {name}?": "{name} neu deployen?",
  "Redeploy of {name} started": "Redeploy von {name} gestartet",
  "Redeploy failed": "Redeploy fehlgeschlagen",
  "The container restarts in a moment; the next agent report shows its state.":
    "Der Container startet gleich neu; der nächste Agent-Bericht zeigt seinen Zustand.",
  "Dokploy recreates the database container on the same volume — the data stays. It is unreachable for a few seconds.":
    "Dokploy erstellt den Datenbank-Container auf demselben Volume neu — die Daten bleiben. Für ein paar Sekunden ist sie nicht erreichbar.",
  "Dokploy rebuilds and restarts the whole compose stack, every service in it.":
    "Dokploy baut den ganzen Compose-Stack neu und startet jeden Dienst darin neu.",
  "Dokploy rebuilds the application from its source and replaces the running container.":
    "Dokploy baut die Anwendung aus dem Quellcode neu und ersetzt den laufenden Container.",
  "Dokploy: {where}": "Dokploy: {where}",
  "Add all from Dokploy": "Alle aus Dokploy hinzufügen",
  "Every repository Dokploy deploys from GitHub that is not here yet":
    "Jedes Repository, das Dokploy von GitHub deployt und hier noch fehlt",
  "Add everything from Dokploy": "Alles aus Dokploy hinzufügen",
  "Every repository Dokploy deploys from GitHub that is not here yet — linked to its Dokploy service, server and live URL, and scanned right away.":
    "Jedes Repository, das Dokploy von GitHub deployt und hier noch fehlt — verknüpft mit Dokploy-Dienst, Server und Live-URL und sofort gescannt.",
  "Could not load Dokploy": "Dokploy konnte nicht geladen werden",
  "Nothing missing — every Dokploy service with a GitHub source is already here.":
    "Nichts fehlt — jeder Dokploy-Dienst mit GitHub-Quelle ist schon da.",
  "Not here yet: {n}": "Noch nicht da: {n}",
  "Select all": "Alle auswählen",
  "Select none": "Keine auswählen",
  "also deployed as {list}": "auch deployt als {list}",
  "Already here: {n} Dokploy services.": "Schon da: {n} Dokploy-Dienste.",
  "Without a GitHub source (nothing to scan): {n}":
    "Ohne GitHub-Quelle (nichts zu scannen): {n}",
  "Add {n} repository": "{n} Repository hinzufügen",
  "{n} repository added — fast scan running":
    "{n} Repository hinzugefügt — Schnellscan läuft",
  "{n} repositories added — fast scans running":
    "{n} Repositories hinzugefügt — Schnellscans laufen",
  "Import failed": "Import fehlgeschlagen",
  "Run the updates now": "Updates jetzt ausführen",
  "Installs pending security updates right away instead of at 03:00 — same rules, Docker packages stay excluded. If a reboot is needed it still waits for the reboot time.":
    "Installiert ausstehende Sicherheitsupdates sofort statt um 03:00 — gleiche Regeln, Docker-Pakete bleiben ausgenommen. Ist ein Neustart nötig, wartet er trotzdem auf die Neustart-Zeit.",
  "update-now command": "Befehl für Updates jetzt",
  "Run this on the server. It replaces only the agent and keeps its token and settings. The agent never updates itself — it accepts no commands from here.":
    "Auf dem Server ausführen. Ersetzt nur den Agent und behält Token und Einstellungen. Der Agent aktualisiert sich nie selbst — er nimmt von hier keine Befehle an.",
  "agent update command": "Befehl zum Agent-Update",
  ". Running the install command again (new code) updates the agent and replaces its token; without a code it keeps the token.":
    ". Der Installationsbefehl mit neuem Code aktualisiert den Agent und ersetzt sein Token; ohne Code bleibt das Token.",
  "{n} agent is not on version {v}": "{n} Agent ist nicht auf Version {v}",
  "{n} agents are not on version {v}": "{n} Agents sind nicht auf Version {v}",
  "On one server — replaces only the agent, keeps token and settings:":
    "Auf einem Server — ersetzt nur den Agent, behält Token und Einstellungen:",
  "All at once from your machine, over SSH, as":
    "Alle auf einmal von deinem Rechner, per SSH, als",
  "SSH user": "SSH-Benutzer",
  "update loop": "Update-Schleife",
  "Without an address, so not in the loop: {list}":
    "Ohne Adresse, daher nicht in der Schleife: {list}",
  "Build cache": "Build-Cache",
  Images: "Images",
  Containers: "Container",
  "Volumes (data)": "Volumes (Daten)",
  "Build cache cleared": "Build-Cache geleert",
  "Unused images removed": "Ungenutzte Images gelöscht",
  "The next agent report (within an hour) shows the new sizes.":
    "Der nächste Agent-Bericht (innerhalb einer Stunde) zeigt die neuen Größen.",
  "Cleanup failed": "Aufräumen fehlgeschlagen",
  "Docker storage": "Docker-Speicher",
  "Every deploy leaves a build cache and an image behind — until the disk is full.":
    "Jeder Deploy hinterlässt Build-Cache und ein Image — bis die Platte voll ist.",
  "Measured {when}.": "Gemessen {when}.",
  "{size} unused": "{size} ungenutzt",
  "Clear build cache": "Build-Cache leeren",
  "Remove unused images": "Ungenutzte Images löschen",
  "Clear the build cache?": "Build-Cache leeren?",
  "Remove unused images?": "Ungenutzte Images löschen?",
  "Safe: running apps are not touched. The next build of each app takes a little longer.":
    "Unbedenklich: Laufende Apps bleiben unberührt. Der nächste Build jeder App dauert etwas länger.",
  "Removes every image no container uses — including older versions a Dokploy rollback would go back to. Running apps and volumes are not touched.":
    "Löscht jedes Image, das kein Container nutzt — auch ältere Versionen, auf die ein Dokploy-Rollback zurückginge. Laufende Apps und Volumes bleiben unberührt.",
  "not maintained since {year}": "seit {year} nicht gepflegt",
  "newer build available": "neueres Image verfügbar",
  "Image no longer maintained — since {date}":
    "Image wird nicht mehr gepflegt — seit {date}",
  "No new image has been published for it in over a year. A restart, reboot or redeploy runs the same old build again — its vulnerabilities stay. Replace it with a maintained image or drop the service.":
    "Seit über einem Jahr wurde kein neues Image veröffentlicht. Neustart, Reboot oder Redeploy starten denselben alten Stand — die Schwachstellen bleiben. Durch ein gepflegtes Image ersetzen oder den Dienst entfernen.",
  "A newer build of this image exists": "Es gibt ein neueres Image",
  "The tag was published again after this image was built. Pull it and recreate the container (redeploy) to get the fixes.":
    "Der Tag wurde neu veröffentlicht, nachdem dieses Image gebaut wurde. Neu ziehen und den Container neu erstellen (Redeploy), um die Fixes zu bekommen.",
  "{n} Dokploy server has no agent": "{n} Dokploy-Server hat keinen Agent",
  "{n} Dokploy servers have no agent": "{n} Dokploy-Server haben keinen Agent",
  "Dokploy deploys to them, but nothing here watches load, updates, attacks or vulnerabilities.":
    "Dokploy deployt dorthin, aber hier überwacht niemand Last, Updates, Angriffe oder Schwachstellen.",
  "Dokploy host": "Dokploy-Host",
  Versions: "Versionen",
  current: "aktuell",
  "patch behind": "Patch zurück",
  "minor behind": "Minor zurück",
  "major behind": "Major zurück",
  "Installed (lockfile) · declared {range}":
    "Installiert (Lockfile) · angegeben {range}",
  "No lockfile — lowest version of {range}":
    "Kein Lockfile — niedrigste Version von {range}",
  "From {source}": "Aus {source}",
  "end of life": "Support beendet",
  "EOL soon": "Support endet bald",
  "{n} update started — a pull request each":
    "{n} Update gestartet — je ein Pull Request",
  "{n} updates started — a pull request each":
    "{n} Updates gestartet — je ein Pull Request",
  "Builds run one after another; each pull request appears in its repository.":
    "Die Builds laufen nacheinander; jeder Pull Request erscheint im jeweiligen Repository.",
  "Could not start": "Konnte nicht starten",
  "Fast scans started — versions appear as they finish.":
    "Schnellscans gestartet — die Versionen erscheinen, sobald sie fertig sind.",
  "Payload, Next.js, React and Node on every site — from each repository's lockfile and Dockerfile.":
    "Payload, Next.js, React und Node auf jeder Seite — aus Lockfile und Dockerfile jedes Repositorys.",
  "sites a minor or major behind": "Seiten ein Minor oder Major zurück",
  "Node.js (recommended {major})": "Node.js (empfohlen {major})",
  "sites on a Node.js without security updates":
    "Seiten auf einem Node.js ohne Sicherheitsupdates",
  "{n} repositories have no version data yet — it is collected with the next scan.":
    "{n} Repositories haben noch keine Versionsdaten — sie kommen mit dem nächsten Scan.",
  "Search repositories or clients": "Repositories oder Kunden suchen",
  "Payload sites": "Payload-Seiten",
  Upgrade: "Aktualisieren",
  "to version": "auf Version",
  "Open {n} pull requests": "{n} Pull Requests öffnen",
  "{n} selected": "{n} ausgewählt",
  "Select {name}": "{name} auswählen",
  "not scanned yet": "noch nicht gescannt",
  "update running": "Update läuft",
  "No repositories match.": "Keine passenden Repositories.",
  "{family} {version} on {n} sites?": "{family} {version} auf {n} Seiten?",
  "For each site: every {family} package to exactly this version, nothing else; then install, the repository's check, and a pull request. Nothing is merged or deployed — you review each pull request. Builds run one after another.":
    "Pro Seite: jedes {family}-Paket auf genau diese Version, sonst nichts; dann Installation, der Check des Repositorys und ein Pull Request. Nichts wird gemergt oder deployt — du prüfst jeden Pull Request. Die Builds laufen nacheinander.",
  "No errors logged in this period. (Needs agent 1.11.0 on the server.)":
    "Keine Fehler in diesem Zeitraum. (Braucht Agent 1.11.0 auf dem Server.)",
  new: "neu",
  "Errors in the logs": "Fehler in den Logs",
  "Error lines the app logged, the same message grouped — passwords, tokens, e-mail and IP addresses removed on the server.":
    "Fehlerzeilen, die die App geloggt hat, gleiche Meldungen zusammengefasst — Passwörter, Tokens, E-Mail- und IP-Adressen werden schon auf dem Server entfernt.",
  "Uptime and outages": "Verfügbarkeit und Ausfälle",
  "The live URL is checked every 5 minutes, every minute while it fails. Two failures in a row are an outage.":
    "Die Live-URL wird alle 5 Minuten geprüft, bei Fehlern jede Minute. Zwei Fehlschläge hintereinander gelten als Ausfall.",
  "30 days": "30 Tage",
  "90 days": "90 Tage",
  "No outages recorded.": "Keine Ausfälle erfasst.",
  "down for {d}": "seit {d} nicht erreichbar",
  restarted: "neu gestartet",
  "What happened": "Was passiert ist",
  "{n} site is down": "{n} Seite ist nicht erreichbar",
  "{n} sites are down": "{n} Seiten sind nicht erreichbar",
  "since {when}": "seit {when}",
  "Restart automatically when the site stays down":
    "Automatisch neu starten, wenn die Seite nicht erreichbar bleibt",
  "After 5 minutes down, the app is restarted through Dokploy — at most 3 times a day. If that does not help, you get a message.":
    "Nach 5 Minuten Ausfall wird die App über Dokploy neu gestartet — höchstens 3-mal am Tag. Hilft das nicht, bekommst du eine Nachricht.",
  "Setting everything up — this page follows along.":
    "Alles wird eingerichtet — diese Seite zeigt den Fortschritt.",
  "Done. The first build runs in Dokploy now.":
    "Fertig. Der erste Build läuft jetzt in Dokploy.",
  "Stopped at a step — what was created so far stays.":
    "An einem Schritt gestoppt — was bis dahin angelegt wurde, bleibt.",
  "GitHub repository": "GitHub-Repository",
  "Dokploy project": "Dokploy-Projekt",
  Backup: "Backup",
  "Domain and certificate": "Domain und Zertifikat",
  "First deploy": "Erster Deploy",
  "Moatline monitoring": "Überwachung in Moatline",
  "Last step is yours: DNS": "Der letzte Schritt liegt bei dir: DNS",
  "Point the domain's A record to {ip}. The certificate is issued as soon as it resolves.":
    "Setze den A-Record der Domain auf {ip}. Das Zertifikat wird ausgestellt, sobald er aufgelöst wird.",
  "Point the domain's A record to your Dokploy server. The certificate is issued as soon as it resolves.":
    "Setze den A-Record der Domain auf deinen Dokploy-Server. Das Zertifikat wird ausgestellt, sobald er aufgelöst wird.",
  "Open the repository": "Repository öffnen",
  "New site": "Neue Seite",
  "Repository from your template, Dokploy app with database and backup, domain, first deploy and monitoring — in one go.":
    "Repository aus eurer Vorlage, Dokploy-App mit Datenbank und Backup, Domain, erster Deploy und Überwachung — in einem Schritt.",
  "1. Site": "1. Seite",
  "HTTPS with Let's Encrypt; set the DNS afterwards.":
    "HTTPS mit Let's Encrypt; den DNS-Eintrag danach setzen.",
  "2. Code": "2. Code",
  "A new repository from a GitHub template, or one that exists.":
    "Ein neues Repository aus einer GitHub-Vorlage oder ein bestehendes.",
  "From template": "Aus Vorlage",
  "Existing repository": "Bestehendes Repository",
  Template: "Vorlage",
  "No template repository found — mark one as template in its GitHub settings.":
    "Kein Vorlagen-Repository gefunden — markiere eines in seinen GitHub-Einstellungen als Template.",
  Owner: "Besitzer",
  "Repository name": "Repository-Name",
  Private: "Privat",
  "3. Dokploy": "3. Dokploy",
  Project: "Projekt",
  "New project": "Neues Projekt",
  "Project name": "Projektname",
  "GitHub access in Dokploy": "GitHub-Zugang in Dokploy",
  "Connect GitHub in Dokploy first (Settings → Git).":
    "Verbinde zuerst GitHub in Dokploy (Settings → Git).",
  None: "Keine",
  "Daily at 03:00, the last 14 kept.":
    "Täglich um 03:00, die letzten 14 bleiben.",
  "No backup": "Kein Backup",
  "4. Environment variables": "4. Umgebungsvariablen",
  "From the template's .env.example. Database, secrets and URLs fill themselves.":
    "Aus der .env.example der Vorlage. Datenbank, Secrets und URLs werden automatisch gesetzt.",
  "The repository has no .env.example — add variables in Dokploy later.":
    "Das Repository hat keine .env.example — Variablen später in Dokploy ergänzen.",
  "automatic: connection to the new database":
    "automatisch: Verbindung zur neuen Datenbank",
  "automatic: random secret": "automatisch: zufälliges Secret",
  "automatic: the site's URL": "automatisch: die URL der Seite",
  "Create site": "Seite anlegen",
  Apps: "Apps",
  Maintenance: "Wartung",
  containers: "Container",
  unhealthy: "unhealthy",
  sites: "Seiten",
  "nothing critical open": "nichts Kritisches offen",
  bans: "Sperren",
  "CrowdSec not running": "CrowdSec läuft nicht",
  "security updates pending": "Sicherheitsupdates offen",
  "reboot required": "Neustart nötig",
  disk: "Platte",
  "Docker can free": "kann Docker freigeben",
  "backup checks failing": "Backup-Prüfungen schlagen fehl",
  "OS out of support": "OS ohne Support",
  "no security updates any more": "keine Sicherheitsupdates mehr",
  "Reboot required": "Neustart nötig",
  "servers running an old kernel": "Server mit altem Kernel",
  "Agent {v}": "Agent {v}",
  "servers on the current agent": "Server mit aktuellem Agent",
  "Operating system": "Betriebssystem",
  Kernel: "Kernel",
  "support ended {date}": "Support endete {date}",
  "support ends {date}": "Support endet {date}",
  "supported until {date}": "Support bis {date}",
  "up {n} days": "seit {n} Tagen an",
  "{n} security": "{n} Sicherheit",
  "{n} pending": "{n} offen",
  "no automatic updates": "keine automatischen Updates",
  "update available": "Update verfügbar",
  "Operating system, kernel, Docker and updates on every server \u2014 and which ones are out of support.":
    "Betriebssystem, Kernel, Docker und Updates auf jedem Server — und welche keinen Support mehr haben.",
  Coolify: "Coolify",
  "Sites on Coolify get the same: deploys with watch and rollback, self-healing, redeploy buttons, database checks. Turn the API on in Coolify (Settings → API) and create a token with read and deploy.":
    "Seiten auf Coolify bekommen dasselbe: Deploys mit Überwachung und Rollback, Selbstheilung, Redeploy-Buttons, Datenbank-Checks. In Coolify die API einschalten (Settings → API) und ein Token mit read und deploy anlegen.",
  "Coolify token (Bearer)": "Coolify-Token (Bearer)",
  "Coolify application": "Coolify-Anwendung",
  "For sites on Coolify: deploys, rollback, self-healing. Linked automatically when one Coolify application deploys this repository. Dokploy wins when both are set.":
    "Für Seiten auf Coolify: Deploys, Rollback, Selbstheilung. Wird automatisch verknüpft, wenn genau eine Coolify-Anwendung dieses Repository deployt. Sind beide gesetzt, gilt Dokploy.",
  "Auto-deploy needs a Dokploy or Coolify application (above).":
    "Auto-Deploy braucht eine Dokploy- oder Coolify-Anwendung (oben).",
  "Coolify restarts it — same image, same volumes, no rebuild. It is unreachable for a few seconds.":
    "Coolify startet ihn neu — gleiches Image, gleiche Volumes, kein Neubau. Für ein paar Sekunden ist er nicht erreichbar.",
  "Coolify URL": "Coolify-URL",
  Platforms: "Plattformen",
  "Security & operations": "Sicherheit & Betrieb",
  "Thank you — your subscription is active in a moment.":
    "Danke — dein Abo ist gleich aktiv.",
  "Checkout could not open": "Der Checkout konnte nicht geöffnet werden",
  "Could not open the portal": "Das Portal konnte nicht geöffnet werden",
  Billing: "Abrechnung",
  active: "aktiv",
  canceled: "gekündigt",
  "no subscription": "kein Abo",
  "payment failed": "Zahlung fehlgeschlagen",
  "Billed per server and month — adding or removing a server changes it pro rata. Prefer not to pay? Moatline is open source: host it yourself for free.":
    "Abgerechnet pro Server und Monat — kommt ein Server dazu oder fällt weg, ändert sich der Betrag anteilig. Lieber nichts zahlen? Moatline ist Open Source: kostenlos selbst hosten.",
  "Paid for": "Bezahlt für",
  "{n} servers": "{n} Server",
  "Ends on {date}.": "Endet am {date}.",
  "Renews on {date}.": "Verlängert sich am {date}.",
  "Without a subscription you can look around, but not add servers or repositories.":
    "Ohne Abo kannst du dich umsehen, aber keine Server oder Repositories hinzufügen.",
  Subscribe: "Abo abschließen",
  "Invoices, payment method, cancel": "Rechnungen, Zahlungsart, Kündigung",
  "Updating to {v} — the app restarts in a minute or two.":
    "Update auf {v} läuft — die App startet in ein, zwei Minuten neu.",
  "Update failed": "Update fehlgeschlagen",
  "{v} available": "{v} verfügbar",
  "This instance runs version {v}.": "Diese Instanz läuft auf Version {v}.",
  "No release information available.": "Keine Release-Informationen verfügbar.",
  "Update to {v}": "Auf {v} aktualisieren",
  "Installed through {platform}: change the image tags in the service to {v} there and redeploy.":
    "Über {platform} installiert: dort die Image-Tags des Dienstes auf {v} setzen und neu deployen.",
  "In the folder with docker-compose.yml (set PC_VERSION in .env when you pin versions). For one-click updates, set SELF_UPDATE=true and mount the Docker socket.":
    "Im Ordner mit der docker-compose.yml (PC_VERSION in der .env setzen, wenn ihr Versionen festlegt). Für Ein-Klick-Updates SELF_UPDATE=true setzen und den Docker-Socket einbinden.",
  "update command": "Update-Befehl",
  "Release notes on GitHub": "Release-Notes auf GitHub",
  "Update to {v}?": "Auf {v} aktualisieren?",
  "Pulls the new images and recreates the containers. The app is unavailable for a minute or two; the database migrates on start. Data stays.":
    "Lädt die neuen Images und erstellt die Container neu. Die App ist ein, zwei Minuten nicht erreichbar; die Datenbank migriert beim Start. Die Daten bleiben.",
  Update: "Aktualisieren",
  "The Docker socket is mounted, but the API may not use it: add its group (group_add: DOCKER_GID, see docker-compose.yml) for one-click updates.":
    "Der Docker-Socket ist eingebunden, aber die API darf ihn nicht nutzen: für Ein-Klick-Updates ihre Gruppe ergänzen (group_add: DOCKER_GID, siehe docker-compose.yml).",
  "errors jumped": "Fehler gestiegen",
  Observability: "Observability",
  "Deploys, rollbacks, incidents and fix PRs, sent to your observability tools — and their alerts turned into incidents here.":
    "Deploys, Rollbacks, Vorfälle und Fix-PRs an eure Observability-Tools — und deren Alerts werden hier zu Vorfällen.",
  "OTLP endpoint (HTTP)": "OTLP-Endpunkt (HTTP)",
  "Dash0, Grafana Cloud, SigNoz, Honeycomb … — events arrive as logs.":
    "Dash0, Grafana Cloud, SigNoz, Honeycomb … — Ereignisse kommen als Logs an.",
  "OTLP headers, one per line": "OTLP-Header, einer pro Zeile",
  "Stored — type to replace": "Gespeichert — zum Ersetzen neu eingeben",
  "Grafana URL (annotations)": "Grafana-URL (Annotationen)",
  "Grafana service account token": "Grafana-Service-Account-Token",
  "Webhook for events (JSON)": "Webhook für Ereignisse (JSON)",
  "No target set — save an OTLP endpoint, Grafana or a webhook first.":
    "Kein Ziel gesetzt — zuerst einen OTLP-Endpunkt, Grafana oder einen Webhook speichern.",
  "Sent to {ok}; failed: {bad}": "Gesendet an {ok}; fehlgeschlagen: {bad}",
  "Test event sent to {ok}": "Testereignis gesendet an {ok}",
  "Send a test event": "Testereignis senden",
  "New alert receiver URL": "Neue Alert-Empfangs-URL",
  "Create alert receiver URL": "Alert-Empfangs-URL erstellen",
  "Shown once — copy it now. Add it as a webhook contact point in Grafana or a receiver in Alertmanager. Label alerts with service (or app, job) = the repository's name; add moatline_action=restart to let Moatline restart the app.":
    "Wird nur einmal angezeigt — jetzt kopieren. In Grafana als Webhook-Kontaktpunkt oder im Alertmanager als Receiver eintragen. Alerts mit service (oder app, job) = Name des Repositorys versehen; mit moatline_action=restart darf Moatline die App neu starten.",
  "alert receiver URL": "Alert-Empfangs-URL",
  "Alerts are being received. A new URL replaces the old one.":
    "Alerts werden empfangen. Eine neue URL ersetzt die alte.",
  "Alerts from Grafana, Alertmanager and other tools become incidents on the repository they name.":
    "Alerts aus Grafana, Alertmanager und anderen Tools werden zu Vorfällen am genannten Repository.",
  alert: "Alert",
  "Deploy with {platform}": "Mit {platform} deployen",
  "Open in {platform}": "In {platform} öffnen",
  "Join Tailscale": "Tailscale beitreten",
  "asks for an auth key on the server — never put in the command":
    "fragt den Auth-Key auf dem Server ab — nie im Befehl",
  "SSH only over Tailscale": "SSH nur über Tailscale",
  "closes public SSH in ufw once Tailscale is up; never without a firewall. Dokploy or Coolify must then reach this server over Tailscale (its 100.x address)":
    "schließt öffentliches SSH in ufw, sobald Tailscale läuft; nie ohne Firewall. Dokploy oder Coolify müssen den Server dann über Tailscale erreichen (seine 100.x-Adresse)",
  Method: "Methode",
  Path: "Pfad",
  "Remove step": "Schritt entfernen",
  "Body type": "Body-Typ",
  Body: "Body",
  "Expected status": "Erwarteter Status",
  "Text the page must contain (optional)":
    "Text, den die Seite enthalten muss (optional)",
  "Expected text": "Erwarteter Text",
  "Time limit in ms": "Zeitlimit in ms",
  "Check saved": "Check gespeichert",
  "Check added — first run started": "Check angelegt — erster Lauf gestartet",
  "Could not save": "Konnte nicht speichern",
  "Edit check": "Check bearbeiten",
  "New check": "Neuer Check",
  "Steps run in order against the live URL; cookies carry over, so a login holds. Use ${name} for values that are stored encrypted.":
    "Die Schritte laufen nacheinander gegen die Live-URL; Cookies werden weitergereicht, ein Login bleibt also bestehen. ${name} für Werte, die verschlüsselt gespeichert werden.",
  "Payload admin login": "Payload-Admin-Login",
  "Home page shows its content": "Startseite zeigt ihren Inhalt",
  "Every (minutes)": "Alle (Minuten)",
  "Add step": "Schritt hinzufügen",
  "Values (stored encrypted)": "Werte (verschlüsselt gespeichert)",
  "Use a dedicated test user with as few rights as possible.":
    "Einen eigenen Test-Nutzer mit möglichst wenig Rechten verwenden.",
  "All steps passed": "Alle Schritte bestanden",
  Checks: "Checks",
  "More than “the site answers”: a login, a page's content, a form — step by step. Two failures in a row open an incident.":
    "Mehr als „die Seite antwortet“: ein Login, der Inhalt einer Seite, ein Formular — Schritt für Schritt. Zwei Fehlschläge hintereinander öffnen einen Vorfall.",
  "Add check": "Check hinzufügen",
  "No checks yet. Start from a template, e.g. the Payload admin login.":
    "Noch keine Checks. Starte mit einer Vorlage, z. B. dem Payload-Admin-Login.",
  "not run yet": "noch nicht gelaufen",
  "every {n} min": "alle {n} min",
  Edit: "Bearbeiten",
  check: "Check",
  "Setup failed": "Einrichtung fehlgeschlagen",
  "Set up OpenObserve on Dokploy": "OpenObserve auf Dokploy einrichten",
  "OpenObserve on Dokploy": "OpenObserve auf Dokploy",
  "A light observability tool on your own server — logs, events, dashboards. Moatline sends its events there right away.":
    "Ein schlankes Observability-Tool auf eurem eigenen Server — Logs, Ereignisse, Dashboards. Moatline schickt seine Ereignisse sofort dorthin.",
  "Deploying now. Once the DNS points at the server, log in with these — the password is shown only now:":
    "Wird jetzt deployt. Sobald der DNS-Eintrag auf den Server zeigt, damit anmelden — das Passwort wird nur jetzt angezeigt:",
  "E-mail": "E-Mail",
  "Admin e-mail": "Admin-E-Mail",
  Close: "Schließen",
  "Set up": "Einrichten",
  "How to upgrade, and keep the IP": "So aktualisierst du, und behältst die IP",
  // Findings in plain words (lib/explain.ts) and request errors
  "The operating system no longer gets security updates":
    "Das Betriebssystem bekommt keine Sicherheitsupdates mehr",
  "{os} has been out of support since {date}. New security holes in it are not fixed anymore, so the server gets easier to attack every month.":
    "{os} wird seit {date} nicht mehr unterstützt. Neue Sicherheitslücken werden nicht mehr geschlossen – der Server wird jeden Monat leichter angreifbar.",
  "Move the server to a supported version (Ubuntu 24.04 LTS). The guide walks you through it, including keeping the IP address.":
    "Bring den Server auf eine unterstützte Version (Ubuntu 24.04 LTS). Die Anleitung führt dich Schritt für Schritt durch – auch wie du die IP-Adresse behältst.",
  "Support for the operating system ends soon":
    "Die Unterstützung für das Betriebssystem endet bald",
  "{os} gets security updates only until {date}.":
    "{os} bekommt nur noch bis {date} Sicherheitsupdates.",
  "Plan the move to a supported version before then.":
    "Plane den Umstieg auf eine unterstützte Version vorher ein.",
  "The server is not connected to Tailscale":
    "Der Server ist nicht mit Tailscale verbunden",
  "It cannot be reached over your private network. If SSH is only allowed over Tailscale, SSH is closed too.":
    "Er ist über dein privates Netzwerk nicht erreichbar. Wenn SSH nur über Tailscale erlaubt ist, kommst du auch per SSH nicht drauf.",
  "Log in through your provider's web console and run: sudo tailscale up":
    "Melde dich über die Web-Konsole deines Anbieters an und führe aus: sudo tailscale up",
  "The Tailscale key has expired": "Der Tailscale-Schlüssel ist abgelaufen",
  "The Tailscale key expires soon": "Der Tailscale-Schlüssel läuft bald ab",
  "When it expires, the server drops off your private network.":
    "Läuft er ab, fällt der Server aus deinem privaten Netzwerk.",
  "Turn off key expiry for this machine in the Tailscale admin console.":
    "Schalte in der Tailscale-Admin-Konsole den Schlüsselablauf für diese Maschine ab.",
  "The server is overloaded": "Der Server ist überlastet",
  "The processor is fully busy. Sites on this server get slow or stop answering.":
    "Der Prozessor ist voll ausgelastet. Seiten auf diesem Server werden langsam oder antworten nicht mehr.",
  "See on the Apps tab which app uses the processor. A bigger server or moving an app helps.":
    "Schau im Tab Apps, welche App den Prozessor belastet. Ein größerer Server oder das Umziehen einer App hilft.",
  "The disk slows the server down": "Die Festplatte bremst den Server",
  "Programs keep waiting for the disk — often a database or a backup doing heavy work.":
    "Programme warten ständig auf die Festplatte – oft arbeitet gerade eine Datenbank oder ein Backup viel.",
  "Check which app is busy. If it lasts, a server with a faster disk helps.":
    "Prüfe, welche App gerade arbeitet. Hält es an, hilft ein Server mit schnellerer Festplatte.",
  "Other machines on the same hardware slow this server down":
    "Andere Maschinen auf derselben Hardware bremsen diesen Server",
  "Your provider shares the hardware, and others take part of the processor time.":
    "Dein Anbieter teilt die Hardware, und andere nehmen einen Teil der Rechenzeit.",
  "If it lasts, switch to a plan with dedicated CPU or ask the provider to move the server.":
    "Hält es an, wechsle zu einem Tarif mit dedizierter CPU oder bitte den Anbieter, den Server zu verschieben.",
  "The server is running out of memory":
    "Dem Server geht der Arbeitsspeicher aus",
  "When memory runs out, Linux stops programs to save itself — usually the biggest one, often a database.":
    "Wenn der Speicher voll ist, beendet Linux Programme, um sich zu retten – meist das größte, oft eine Datenbank.",
  "See on the Apps tab what uses the most memory. Set memory limits or move to a bigger server.":
    "Schau im Tab Apps, was am meisten Speicher braucht. Setze Speicherlimits oder wechsle auf einen größeren Server.",
  "The disk is almost full ({pct})": "Die Festplatte ist fast voll ({pct})",
  "When it is full, databases stop saving, deploys fail and sites go down.":
    "Ist sie voll, speichern Datenbanken nichts mehr, Deploys schlagen fehl und Seiten fallen aus.",
  "Free up space. Deleting Docker's unused build cache and images on the Maintenance tab is often enough.":
    "Schaffe Platz. Oft reicht es, im Tab Wartung Dockers ungenutzten Build-Cache und alte Images zu löschen.",
  "Old build files take up {size}": "Alte Build-Dateien belegen {size}",
  "Every deploy leaves build cache and an old image behind. Deleting them is safe — running apps are not touched.":
    "Jeder Deploy hinterlässt Build-Cache und ein altes Image. Löschen ist sicher – laufende Apps bleiben unberührt.",
  "Delete them with one click on the Maintenance tab.":
    "Lösch sie mit einem Klick im Tab Wartung.",
  "Available updates could not be checked":
    "Verfügbare Updates konnten nicht geprüft werden",
  "The server could not read which updates are available.":
    "Der Server konnte nicht lesen, welche Updates verfügbar sind.",
  "Run sudo apt-get update on the server and look at the error.":
    "Führe auf dem Server sudo apt-get update aus und sieh dir den Fehler an.",
  "{n} security updates waiting — installed automatically":
    "{n} Sicherheitsupdates warten – werden automatisch installiert",
  "They close known security holes.":
    "Sie schließen bekannte Sicherheitslücken.",
  "Nothing to do: automatic updates install them {when}.":
    "Nichts zu tun: Die automatischen Updates installieren sie {when}.",
  "{n} security updates waiting": "{n} Sicherheitsupdates warten",
  "They close known security holes, and nothing installs them automatically.":
    "Sie schließen bekannte Sicherheitslücken – und nichts installiert sie automatisch.",
  "Turn on automatic updates on the Setup tab, or install them now with the command there.":
    "Schalte im Tab Setup die automatischen Updates ein, oder installiere sie jetzt mit dem Befehl dort.",
  "Security updates have been waiting for days":
    "Sicherheitsupdates warten schon seit Tagen",
  "Automatic updates should have installed them by now — something is blocking them.":
    "Die automatischen Updates hätten sie längst installieren sollen – etwas blockiert sie.",
  "Run the update command from the Setup tab and read its output.":
    "Führe den Update-Befehl aus dem Tab Setup aus und lies die Ausgabe.",
  "Automatic updates are not working":
    "Die automatischen Updates funktionieren nicht",
  "They are switched on, but have never run.":
    "Sie sind eingeschaltet, aber noch nie gelaufen.",
  "They have not run for days.": "Sie sind seit Tagen nicht gelaufen.",
  "The last run failed.": "Der letzte Lauf ist fehlgeschlagen.",
  "Set up automatic updates again with the command on the Setup tab. It repairs the configuration.":
    "Richte die automatischen Updates mit dem Befehl im Tab Setup neu ein. Das repariert die Konfiguration.",
  "{n} regular updates available": "{n} normale Updates verfügbar",
  "Newer versions without security fixes. Not urgent.":
    "Neuere Versionen ohne Sicherheitskorrekturen. Nicht dringend.",
  "Install them at your next maintenance.":
    "Installiere sie bei der nächsten Wartung.",
  "Restart scheduled": "Neustart geplant",
  "An update only takes effect after a restart.":
    "Ein Update wirkt erst nach einem Neustart.",
  "Nothing to do: the server restarts by itself {when}, and the apps start again.":
    "Nichts zu tun: Der Server startet {when} selbst neu, und die Apps starten wieder.",
  "The server has been waiting days for a restart":
    "Der Server wartet seit Tagen auf einen Neustart",
  "An installed update (usually the kernel) is not active until the server restarts.":
    "Ein installiertes Update (meist der Kernel) wirkt erst, wenn der Server neu startet.",
  "Restart it at a quiet time with sudo reboot — the apps start again by themselves. Or set a nightly restart time on the Setup tab.":
    "Starte ihn zu einer ruhigen Zeit mit sudo reboot neu – die Apps starten von selbst wieder. Oder lege im Tab Setup eine nächtliche Neustart-Zeit fest.",
  "The server needs a restart": "Der Server braucht einen Neustart",
  "Restart it at a quiet time, or set a nightly restart time on the Setup tab.":
    "Starte ihn zu einer ruhigen Zeit neu, oder lege im Tab Setup eine nächtliche Neustart-Zeit fest.",
  "Automatic security updates are off":
    "Automatische Sicherheitsupdates sind aus",
  "Security fixes are installed only when someone does it by hand.":
    "Sicherheitskorrekturen werden nur installiert, wenn jemand das von Hand macht.",
  "Turn them on with the command on the Setup tab.":
    "Schalte sie mit dem Befehl im Tab Setup ein.",
  "The server has not looked for updates in a while":
    "Der Server hat länger nicht nach Updates gesucht",
  "Run sudo apt-get update. With automatic updates on, this happens by itself.":
    "Führe sudo apt-get update aus. Mit automatischen Updates passiert das von selbst.",
  "{app} runs, but is not healthy": "{app} läuft, ist aber nicht gesund",
  "Its own health check fails — it may not answer requests.":
    "Die eigene Gesundheitsprüfung schlägt fehl – womöglich beantwortet sie keine Anfragen.",
  "Look at its logs. A redeploy often helps.":
    "Sieh dir die Logs an. Ein Redeploy hilft oft.",
  "{app} keeps crashing and restarting":
    "{app} stürzt ständig ab und startet neu",
  "It never stays up. Everything that depends on it — a site that needs this database, for example — fails too.":
    "Der Dienst läuft nie lange am Stück. Alles, was davon abhängt – etwa eine Seite, die diese Datenbank braucht – fällt mit aus.",
  "Look at its logs for the reason. A redeploy often fixes it.":
    "Den Grund findest du in den Logs. Oft behebt ein Redeploy das Problem.",
  "{app} is down": "{app} ist ausgefallen",
  "{app} runs only partly": "{app} läuft nur teilweise",
  "Fewer copies run than should.":
    "Es laufen weniger Instanzen als vorgesehen.",
  "Redeploy it and look at its logs.":
    "Mach ein Redeploy und sieh dir die Logs an.",
  "A backup is too old": "Ein Backup ist zu alt",
  "A backup is missing": "Ein Backup fehlt",
  "If something breaks now, everything since the last good backup is lost.":
    "Geht jetzt etwas kaputt, ist alles seit dem letzten guten Backup verloren.",
  "Check the backup job that writes to this folder.":
    "Prüfe den Backup-Job, der in diesen Ordner schreibt.",
  "{app} crashed because it ran out of memory":
    "{app} ist abgestürzt, weil der Speicher ausging",
  "Linux stopped it to protect the server.":
    "Linux hat sie beendet, um den Server zu schützen.",
  "Give it a higher memory limit in Dokploy or Coolify, or have the developers look for a memory leak.":
    "Gib ihr in Dokploy oder Coolify ein höheres Speicherlimit, oder lass die Entwickler nach einem Speicherleck suchen.",
  "{app} is close to its memory limit": "{app} ist nah an ihrem Speicherlimit",
  "At the limit it is stopped and restarted.":
    "Am Limit wird sie beendet und neu gestartet.",
  "Raise its memory limit in Dokploy or Coolify.":
    "Erhöhe ihr Speicherlimit in Dokploy oder Coolify.",
  "{app} uses much more memory than usual":
    "{app} braucht viel mehr Speicher als sonst",
  "This often points to a memory leak.":
    "Das deutet oft auf ein Speicherleck hin.",
  "A redeploy frees the memory for now. If it keeps growing, tell the developers.":
    "Ein Redeploy gibt den Speicher vorerst frei. Wächst er weiter, sag den Entwicklern Bescheid.",
  "{app} takes a large share of the server's memory":
    "{app} belegt einen großen Teil des Server-Speichers",
  "Without a limit it can starve the other apps on the server.":
    "Ohne Limit kann sie den anderen Apps auf dem Server den Speicher wegnehmen.",
  "Set a memory limit for it in Dokploy or Coolify.":
    "Setze ihr ein Speicherlimit in Dokploy oder Coolify.",
  "{app} keeps the processor busy": "{app} lastet den Prozessor dauerhaft aus",
  "The other apps on the server get less processor time.":
    "Die anderen Apps auf dem Server bekommen weniger Rechenzeit.",
  "Check whether that is expected (an import, for example). Otherwise look at its logs.":
    "Prüfe, ob das erwartet ist (etwa ein Import). Sonst sieh dir die Logs an.",
  "Attack protection (CrowdSec) is not running":
    "Der Angriffsschutz (CrowdSec) läuft nicht",
  "Password guessing and attacks on the sites are no longer blocked automatically.":
    "Passwort-Raten und Angriffe auf die Seiten werden nicht mehr automatisch blockiert.",
  "Run the agent install again with CrowdSec selected (Setup tab).":
    "Führe die Agent-Installation erneut mit CrowdSec aus (Tab Setup).",
  "Attack protection could not be checked completely":
    "Der Angriffsschutz konnte nicht vollständig geprüft werden",
  "Usually temporary. If it stays, run sudo cscli metrics on the server.":
    "Meist nur vorübergehend. Bleibt es, führe auf dem Server sudo cscli metrics aus.",
  "Attack protection detects attacks, but blocks nothing":
    "Der Angriffsschutz erkennt Angriffe, blockiert aber nichts",
  "CrowdSec recognizes attackers, but no firewall bouncer turns that into blocks.":
    "CrowdSec erkennt Angreifer, aber kein Firewall-Bouncer setzt die Sperren um.",
  "Run the agent install again with CrowdSec selected — it adds the firewall bouncer.":
    "Führe die Agent-Installation erneut mit CrowdSec aus – sie richtet den Firewall-Bouncer ein.",
  "Attack protection has stopped blocking":
    "Der Angriffsschutz blockiert nicht mehr",
  "The firewall bouncer no longer picks up new blocks.":
    "Der Firewall-Bouncer übernimmt keine neuen Sperren mehr.",
  "Restart it on the server: sudo systemctl restart crowdsec-firewall-bouncer":
    "Starte ihn auf dem Server neu: sudo systemctl restart crowdsec-firewall-bouncer",
  "The vulnerability scan did not run":
    "Der Schwachstellen-Scan ist nicht gelaufen",
  "Known security holes in this server's software are unknown right now.":
    "Bekannte Sicherheitslücken in der Software dieses Servers sind gerade unbekannt.",
  "Run the agent install again with Trivy selected (Setup tab).":
    "Führe die Agent-Installation erneut mit Trivy aus (Tab Setup).",
  "Rated critical: attackers can likely exploit it from the internet.":
    "Als kritisch eingestuft: Angreifer können sie wahrscheinlich über das Internet ausnutzen.",
  "Rated high: exploitable under common conditions.":
    "Als hoch eingestuft: unter üblichen Bedingungen ausnutzbar.",
  "Rated low to medium: exploitable only under special conditions.":
    "Als niedrig bis mittel eingestuft: nur unter besonderen Bedingungen ausnutzbar.",
  "Known security hole in the system package {pkg}":
    "Bekannte Sicherheitslücke im Systempaket {pkg}",
  "Nothing to do: automatic updates install the fix {when}.":
    "Nichts zu tun: Die automatischen Updates installieren die Korrektur {when}.",
  "A fix exists. Install the updates (Setup tab → run updates now).":
    "Es gibt eine Korrektur. Installiere die Updates (Tab Setup → Updates jetzt ausführen).",
  "No fix exists yet. Nothing to do now — it closes by itself once the update ships.":
    "Noch gibt es keine Korrektur. Jetzt nichts zu tun – die Lücke schließt sich, sobald das Update erscheint.",
  "Known security hole in {pkg}, inside {image}":
    "Bekannte Sicherheitslücke in {pkg}, im Image {image}",
  "A fixed version exists. Redeploy the app so it is rebuilt; if the image version is pinned, raise it.":
    "Es gibt eine korrigierte Version. Mach ein Redeploy, damit die App neu gebaut wird; ist die Image-Version fest eingetragen, erhöhe sie.",
  "No fixed version yet. Check whether a newer image exists; otherwise wait for one.":
    "Noch keine korrigierte Version. Prüfe, ob es ein neueres Image gibt; sonst darauf warten.",
  "Harden the server (Setup tab, step 1). It switches password login off — SSH keys keep working.":
    "Härte den Server (Tab Setup, Schritt 1). Das schaltet den Passwort-Login ab – SSH-Keys funktionieren weiter.",
  "Accounts without a password can log in over SSH":
    "Konten ohne Passwort können sich per SSH anmelden",
  "Anyone who finds such an account gets onto the server.":
    "Wer so ein Konto findet, kommt auf den Server.",
  "SSH accepts passwords": "SSH akzeptiert Passwörter",
  "Bots try millions of passwords on every server. One weak password is enough to get in.":
    "Bots probieren auf jedem Server Millionen Passwörter. Ein schwaches Passwort reicht, um reinzukommen.",
  "The admin account (root) can log in with a password":
    "Das Admin-Konto (root) kann sich mit Passwort anmelden",
  "If the password is guessed, the attacker controls the whole server.":
    "Wird das Passwort erraten, kontrolliert der Angreifer den ganzen Server.",
  "The server has no firewall of its own":
    "Der Server hat keine eigene Firewall",
  "Every program that opens a port is reachable from the internet.":
    "Jedes Programm, das einen Port öffnet, ist aus dem Internet erreichbar.",
  "Harden the server (Setup tab, step 1): it turns on a firewall with only SSH, 80 and 443 open.":
    "Härte den Server (Tab Setup, Schritt 1): Das schaltet eine Firewall ein, die nur SSH, 80 und 443 offen lässt.",
  "Nothing stops password guessing on SSH":
    "Nichts stoppt Passwort-Raten bei SSH",
  "Attackers can try passwords as long as they like.":
    "Angreifer können beliebig lange Passwörter ausprobieren.",
  "Install CrowdSec with the agent, or fail2ban with the hardening (both on the Setup tab).":
    "Installiere CrowdSec mit dem Agent oder fail2ban mit der Härtung (beides im Tab Setup).",
  "A new SSH key can log in as {user}":
    "Ein neuer SSH-Key kann sich als {user} anmelden",
  "Whoever has this key can log into the server. If nobody on your team added it, treat it as a break-in.":
    "Wer diesen Key hat, kann sich am Server anmelden. Hat ihn niemand aus deinem Team hinzugefügt, behandle es als Einbruch.",
  "If it was you or your team, accept it on the Security tab. Otherwise remove it from authorized_keys and change all keys and passwords.":
    "Warst du es oder dein Team, bestätige ihn im Tab Sicherheit. Sonst entferne ihn aus authorized_keys und tausche alle Keys und Passwörter.",
  "{user} got admin rights": "{user} hat Admin-Rechte bekommen",
  "If nobody on your team did this, treat it as a break-in.":
    "War es niemand aus deinem Team, behandle es als Einbruch.",
  "If it was intended, accept it on the Security tab. Otherwise remove the user from the group.":
    "War es gewollt, bestätige es im Tab Sicherheit. Sonst entferne den Benutzer aus der Gruppe.",
  "A second admin account appeared: {user}":
    "Ein zweites Admin-Konto ist aufgetaucht: {user}",
  "This is a classic sign of a break-in.":
    "Das ist ein klassisches Zeichen für einen Einbruch.",
  "Treat it as a break-in: find out who created it, remove it and change all keys and passwords.":
    "Behandle es als Einbruch: Finde heraus, wer es angelegt hat, entferne es und tausche alle Keys und Passwörter.",
  "Some services still run old code after an update":
    "Einige Dienste laufen nach einem Update noch mit altem Code",
  "The update is installed, but running programs keep the old, vulnerable version until they restart.":
    "Das Update ist installiert, aber laufende Programme nutzen die alte, verwundbare Version, bis sie neu starten.",
  "Restart the services listed in the details, or the whole server at a quiet time.":
    "Starte die in den Details genannten Dienste neu, oder den ganzen Server zu einer ruhigen Zeit.",
  "{app} has full control over the server":
    "{app} hat volle Kontrolle über den Server",
  "A privileged container can do anything the server can. If the app is hacked, so is the server.":
    "Ein privilegierter Container darf alles, was der Server darf. Wird die App gehackt, ist es auch der Server.",
  "Turn privileged mode off unless the app really needs it.":
    "Schalte den privilegierten Modus ab, außer die App braucht ihn wirklich.",
  "{app} can control Docker": "{app} kann Docker steuern",
  "Access to the Docker socket is the same as admin rights on the server.":
    "Zugriff auf den Docker-Socket ist gleichbedeutend mit Admin-Rechten auf dem Server.",
  "Expected for platform tools like Dokploy and Traefik.":
    "Bei Plattform-Werkzeugen wie Dokploy und Traefik ist das normal.",
  "Only platform tools (Dokploy, Coolify, Traefik) need this. Remove it from other apps.":
    "Das brauchen nur Plattform-Werkzeuge (Dokploy, Coolify, Traefik). Entferne es bei anderen Apps.",
  "{app} shares the server's network":
    "{app} teilt sich das Netzwerk des Servers",
  "It bypasses Docker's isolation and can open any port on the server.":
    "Sie umgeht Dockers Abschottung und kann jeden Port am Server öffnen.",
  "Use a normal Docker network unless it really needs this.":
    "Nutze ein normales Docker-Netzwerk, außer sie braucht das wirklich.",
  "{app} can change files on the server ({path})":
    "{app} kann Dateien auf dem Server ändern ({path})",
  "If the app is hacked, the attacker can change the server's files.":
    "Wird die App gehackt, kann der Angreifer Dateien des Servers ändern.",
  "Mount the folder read-only, or only the folder the app needs.":
    "Binde den Ordner nur lesend ein, oder nur den Ordner, den die App braucht.",
  "{app} has extra system rights": "{app} hat zusätzliche Systemrechte",
  "These rights let a hacked app reach beyond its container.":
    "Mit diesen Rechten kann eine gehackte App über ihren Container hinausgreifen.",
  "Remove the extra capability unless the app needs it.":
    "Entferne das zusätzliche Recht, außer die App braucht es.",
  "Remove the port mapping, or bind it to 127.0.0.1. Apps reach each other over the internal network, you over Tailscale.":
    "Entferne die Port-Freigabe oder binde sie an 127.0.0.1. Apps erreichen sich über das interne Netzwerk, du über Tailscale.",
  "{what} is open to the internet": "{what} ist aus dem Internet erreichbar",
  "Anyone can connect to it. Databases and admin tools should never be public.":
    "Jeder kann sich verbinden. Datenbanken und Admin-Werkzeuge sollten nie öffentlich sein.",
  "{what} is kept closed only by a firewall":
    "{what} wird nur von einer Firewall zugehalten",
  "Docker opens ports past the server's own firewall. One wrong firewall change exposes it.":
    "Docker öffnet Ports an der Server-Firewall vorbei. Eine falsche Firewall-Änderung, und er ist offen.",
  "Several containers share Docker's default network":
    "Mehrere Container teilen sich Dockers Standard-Netzwerk",
  "They can all reach each other.":
    "Sie können sich alle gegenseitig erreichen.",
  "Give each project its own network — Dokploy and Coolify do that.":
    "Gib jedem Projekt ein eigenes Netzwerk – Dokploy und Coolify machen das.",
  "Apps share a network with databases":
    "Apps teilen sich ein Netzwerk mit Datenbanken",
  "If one app is hacked, it can reach the databases of the others.":
    "Wird eine App gehackt, erreicht sie die Datenbanken der anderen.",
  "Give each project its own network.":
    "Gib jedem Projekt ein eigenes Netzwerk.",
  "A service listens on all network interfaces (port {port})":
    "Ein Dienst lauscht auf allen Netzwerk-Schnittstellen (Port {port})",
  "It is not reachable from outside right now — only the firewall keeps it so.":
    "Von außen ist er gerade nicht erreichbar – das hält nur die Firewall so.",
  "Bind it to 127.0.0.1 if it does not need to be reachable.":
    "Binde ihn an 127.0.0.1, wenn er nicht erreichbar sein muss.",
  "Possible break-in: {what}": "Möglicher Einbruch: {what}",
  "Moatline saw something attackers typically do.":
    "Moatline hat etwas gesehen, das Angreifer typischerweise tun.",
  "Look at the details now. If you cannot explain it: take the server off the internet, rebuild it from a clean image and change all passwords and keys.":
    "Sieh dir die Details jetzt an. Kannst du es nicht erklären: Nimm den Server vom Netz, setze ihn aus einem sauberen Image neu auf und tausche alle Passwörter und Keys.",
  "The server address cannot be checked":
    "Die Server-Adresse kann nicht geprüft werden",
  "Check the address in the server's settings.":
    "Prüfe die Adresse in den Einstellungen des Servers.",
  "The server cannot be reached from the internet":
    "Der Server ist aus dem Internet nicht erreichbar",
  "No port answers. The server may be off, or a firewall blocks everything.":
    "Kein Port antwortet. Der Server ist vielleicht aus, oder eine Firewall blockiert alles.",
  "Check in your provider's console whether the server is running.":
    "Prüfe in der Konsole deines Anbieters, ob der Server läuft.",
  "{service} (port {port}) is not reachable":
    "{service} (Port {port}) ist nicht erreichbar",
  "Visitors cannot reach what runs on this port.":
    "Besucher erreichen nicht, was auf diesem Port läuft.",
  "Check that the service runs and the firewall lets the port in.":
    "Prüfe, ob der Dienst läuft und die Firewall den Port durchlässt.",
  "{service} (port {port}) is reachable over Tailscale":
    "{service} (Port {port}) ist über Tailscale erreichbar",
  "Only devices in your private network can reach it.":
    "Nur Geräte in deinem privaten Netzwerk erreichen ihn.",
  "{service} (port {port}) is open to the internet":
    "{service} (Port {port}) ist aus dem Internet erreichbar",
  "Anyone can connect to it.": "Jeder kann sich damit verbinden.",
  "Close the port in the firewall unless it has to be public.":
    "Schließ den Port in der Firewall, außer er muss öffentlich sein.",
  "The HTTPS certificate is not valid": "Das HTTPS-Zertifikat ist ungültig",
  "Browsers show a security warning, and visitors leave.":
    "Browser zeigen eine Sicherheitswarnung, und Besucher springen ab.",
  "Check the domain in Dokploy or Coolify. The certificate comes from Let's Encrypt through Traefik.":
    "Prüfe die Domain in Dokploy oder Coolify. Das Zertifikat kommt über Traefik von Let's Encrypt.",
  "The HTTPS certificate has expired": "Das HTTPS-Zertifikat ist abgelaufen",
  "The HTTPS certificate expires in {n} days":
    "Das HTTPS-Zertifikat läuft in {n} Tagen ab",
  "It normally renews by itself. If it has not, renewal is failing — often because of DNS.":
    "Normalerweise erneuert es sich selbst. Ist das nicht passiert, schlägt die Erneuerung fehl – oft wegen DNS.",
  "Check the domain's DNS and the Traefik logs in Dokploy or Coolify.":
    "Prüfe das DNS der Domain und die Traefik-Logs in Dokploy oder Coolify.",
  "{name} is down": "{name} ist ausgefallen",
  "Uptime Kuma cannot reach it.": "Uptime Kuma erreicht sie nicht.",
  "Open the app and look at its logs. A restart often helps.":
    "Öffne die App und sieh dir die Logs an. Ein Neustart hilft oft.",
  "{name} answers unreliably": "{name} antwortet unzuverlässig",
  "Uptime Kuma's checks fail and are being retried.":
    "Die Prüfungen von Uptime Kuma schlagen fehl und werden wiederholt.",
  "Watch it — if it goes down, look at its logs.":
    "Behalte sie im Auge – fällt sie aus, sieh dir die Logs an.",
  "The HTTPS certificate of {name} is not valid":
    "Das HTTPS-Zertifikat von {name} ist ungültig",
  "Check the domain in Dokploy or Coolify.":
    "Prüfe die Domain in Dokploy oder Coolify.",
  "The HTTPS certificate of {name} expires soon":
    "Das HTTPS-Zertifikat von {name} läuft bald ab",
  "No Hetzner firewall in front of the server":
    "Keine Hetzner-Firewall vor dem Server",
  "A firewall at Hetzner protects the server even if its own firewall is set up wrong.":
    "Eine Firewall bei Hetzner schützt den Server auch dann, wenn seine eigene Firewall falsch eingestellt ist.",
  "Create a firewall in the Hetzner console that allows only SSH, 80 and 443, and apply it to this server.":
    "Lege in der Hetzner-Konsole eine Firewall an, die nur SSH, 80 und 443 erlaubt, und wende sie auf diesen Server an.",
  "The Hetzner firewall lets everything in":
    "Die Hetzner-Firewall lässt alles durch",
  "It protects nothing in this state.": "So schützt sie nichts.",
  "Replace the allow-all rule with rules for SSH, 80 and 443.":
    "Ersetze die Alles-erlauben-Regel durch Regeln für SSH, 80 und 443.",
  "The Hetzner firewall opens port {port} to everyone":
    "Die Hetzner-Firewall öffnet Port {port} für alle",
  "Nothing uses the port yet — but anything that starts on it is public at once.":
    "Noch nutzt nichts den Port – aber alles, was darauf startet, ist sofort öffentlich.",
  "Anyone can connect to what runs on this port.":
    "Jeder kann sich mit dem verbinden, was auf diesem Port läuft.",
  "Remove the rule, or allow only your own IP addresses.":
    "Entferne die Regel, oder erlaube nur deine eigenen IP-Adressen.",
  "The Wazuh agent is not active": "Der Wazuh-Agent ist nicht aktiv",
  "Wazuh does not watch this server right now.":
    "Wazuh überwacht diesen Server gerade nicht.",
  "Check the agent ID in the server's settings and the agent on the server.":
    "Prüfe die Agent-ID in den Server-Einstellungen und den Agent auf dem Server.",
  "Hardening score: {score}": "Härtungs-Score: {score}",
  "Wazuh compares the server's settings against a security baseline.":
    "Wazuh vergleicht die Einstellungen des Servers mit einer Sicherheits-Grundlinie.",
  "The failed checks are listed in Wazuh, each with its fix.":
    "Die fehlgeschlagenen Prüfungen stehen in Wazuh, jeweils mit Lösung.",
  "The database {name} is open to the internet":
    "Die Datenbank {name} ist aus dem Internet erreichbar",
  "Anyone can try to log in. With a weak or leaked password, the data is gone.":
    "Jeder kann versuchen, sich anzumelden. Mit einem schwachen oder geleakten Passwort sind die Daten weg.",
  "Remove the external port in {platform}. Your apps reach the database over the internal network.":
    "Entferne den externen Port in {platform}. Deine Apps erreichen die Datenbank über das interne Netzwerk.",
  "The database {name} has no backup": "Die Datenbank {name} hat kein Backup",
  "If the server or the data breaks, everything is lost.":
    "Geht der Server oder die Datenbank kaputt, ist alles weg.",
  "Add a scheduled backup in {platform} (database → Backups).":
    "Richte in {platform} ein geplantes Backup ein (Datenbank → Backups).",
  "The backup of {name} is switched off":
    "Das Backup von {name} ist abgeschaltet",
  "No new copies of the data are made.":
    "Es werden keine neuen Kopien der Daten gemacht.",
  "Switch it back on in {platform}.": "Schalte es in {platform} wieder ein.",
  "The last backup of {name} failed":
    "Das letzte Backup von {name} ist fehlgeschlagen",
  "There is no fresh copy of the data.":
    "Es gibt keine frische Kopie der Daten.",
  "Open the backup in {platform}, read the error (often the storage destination) and run it again.":
    "Öffne das Backup in {platform}, lies den Fehler (oft das Speicherziel) und starte es erneut.",
  "The backup of {name} has not run in a while":
    "Das Backup von {name} ist länger nicht gelaufen",
  "The newest copy of the data is old.": "Die neueste Kopie der Daten ist alt.",
  "Check the backup schedule in {platform}.":
    "Prüfe den Backup-Zeitplan in {platform}.",
  "{image} is no longer maintained": "{image} wird nicht mehr gepflegt",
  "Nobody fixes security holes in it anymore, so they pile up.":
    "Niemand schließt darin noch Sicherheitslücken – sie sammeln sich an.",
  "Switch to a maintained image that does the same job.":
    "Steig auf ein gepflegtes Image um, das dasselbe kann.",
  "A newer build of {image} is available":
    "Ein neuerer Build von {image} ist verfügbar",
  "The same version was rebuilt, usually with security fixes.":
    "Dieselbe Version wurde neu gebaut, meist mit Sicherheitskorrekturen.",
  "Redeploy the app to pull the new build.":
    "Mach ein Redeploy der App, um den neuen Build zu holen.",
  "Coolify runs on this server, but is not connected":
    "Coolify läuft auf diesem Server, ist aber nicht verbunden",
  "Its apps cannot be seen or redeployed from here.":
    "Seine Apps sind von hier aus weder sichtbar noch neu deploybar.",
  "Connect Coolify under Settings.": "Verbinde Coolify unter Einstellungen.",
  "{app} is not managed by Dokploy or Coolify":
    "{app} wird nicht von Dokploy oder Coolify verwaltet",
  "Moatline cannot redeploy it from here. That is fine for tools you run yourself.":
    "Moatline kann sie von hier aus nicht neu deployen. Für Werkzeuge, die du selbst betreibst, ist das in Ordnung.",
  "Nothing to do if that is intended.":
    "Nichts zu tun, wenn das so gewollt ist.",
  "The server stopped reporting": "Der Server meldet sich nicht mehr",
  "Moatline sees nothing from it anymore — the server may be down, or the agent stopped.":
    "Moatline sieht nichts mehr von ihm – der Server ist vielleicht aus, oder der Agent ist gestoppt.",
  "Check whether the server runs. On the server: systemctl status pc-agent-metrics.timer":
    "Prüfe, ob der Server läuft. Auf dem Server: systemctl status pc-agent-metrics.timer",
  "The agent has never reported": "Der Agent hat sich noch nie gemeldet",
  "Moatline knows nothing about this server yet.":
    "Moatline weiß noch nichts über diesen Server.",
  "Run the install command from the Setup tab on the server.":
    "Führe den Installationsbefehl aus dem Tab Setup auf dem Server aus.",
  "Go to Maintenance": "Zur Wartung",
  "Go to Setup": "Zum Setup",
  "Go to Security": "Zur Sicherheit",
  "Go to Apps": "Zu den Apps",
  resolved: "behoben",
  "What this means": "Was das bedeutet",
  "What to do": "Was zu tun ist",
  "Open the guide": "Anleitung öffnen",
  "Technical details": "Technische Details",
  "The server's automation fixes this by itself.":
    "Die Automatik des Servers behebt das von selbst.",
  "fixes itself": "erledigt sich von selbst",
  "{n} known holes": "{n} bekannte Lücken",
  "Moatline is not reachable right now. Check your connection and reload the page.":
    "Moatline ist gerade nicht erreichbar. Prüfe deine Verbindung und lade die Seite neu.",
  "Too many requests in a short time. Wait a minute and reload.":
    "Zu viele Anfragen in kurzer Zeit. Warte eine Minute und lade neu.",
  "You are no longer signed in. Sign in again to continue.":
    "Du bist nicht mehr angemeldet. Melde dich neu an, um weiterzumachen.",
  "You do not have permission to do this.": "Dafür fehlen dir die Rechte.",
  "Something went wrong on the server. Try again in a moment.":
    "Auf dem Server ist etwas schiefgegangen. Versuch es gleich noch einmal.",
  "Request failed": "Anfrage fehlgeschlagen",
  "Repository not found": "Repository nicht gefunden",
  "Server not found": "Server nicht gefunden",
  "Client not found": "Kunde nicht gefunden",
  "Set a live URL first.": "Trag zuerst eine Live-URL ein.",
  "No live URL configured for this repo.":
    "Für dieses Repository ist keine Live-URL eingetragen.",
  "Authentication required": "Bitte melde dich an.",
  "Uptime Kuma is not configured under Settings.":
    "Uptime Kuma ist unter Einstellungen nicht eingerichtet.",
  "Dokploy is not configured for this organization.":
    "Dokploy ist noch nicht verbunden (Einstellungen → Dokploy).",
  "No GitHub token configured.":
    "Es ist kein GitHub-Token hinterlegt (Einstellungen → GitHub).",
  "This server does not report that container.":
    "Dieser Server meldet diesen Container nicht.",
  "Set an IP address or hostname first.":
    "Trag zuerst eine IP-Adresse oder einen Hostnamen ein.",
  "The agent has not reported access yet.":
    "Der Agent hat die Zugänge noch nicht gemeldet.",
  "{n} configured — paste all tokens to replace them":
    "{n} hinterlegt – füge alle Tokens ein, um sie zu ersetzen",
  "{n} Hetzner servers read, {matched} matched to servers here":
    "{n} Hetzner-Server gelesen, {matched} davon Servern hier zugeordnet",
  "1 person has access.": "1 Person hat Zugriff.",
  "{n} people have access.": "{n} Personen haben Zugriff.",
  "Deployed commit {sha}": "Deployter Commit {sha}",
  offline: "offline",
  "fix and deploy": "beheben und deployen",
  on: "an",
  off: "aus",
  "What needs you, and how your sites and servers are doing.":
    "Was du tun solltest, und wie es deinen Seiten und Servern geht.",
  "Known security holes in each site, and whether the live site is healthy.":
    "Bekannte Sicherheitslücken pro Seite, und ob die Live-Seite gesund ist.",
  "Security holes": "Sicherheitslücken",
  "Live site": "Live-Seite",
  "Live site:": "Live-Seite:",
  "none known": "keine bekannt",
  "{n} of {total} reporting": "{n} von {total} melden sich",
  "{n} silent": "{n} still",
  "{n} waiting for the agent": "{n} warten auf den Agent",
  "{n} findings on live sites": "{n} Findings auf Live-Seiten",
  "Server for {name}": "Server für {name}",
  "invalid or expiring within {n} days": "ungültig oder läuft in {n} Tagen ab",
  "{n} not assigned yet.": "{n} noch nicht zugeordnet.",
  "Could not load the keys: {error}":
    "Die Keys konnten nicht geladen werden: {error}",
  "used {when}": "benutzt {when}",
  revoked: "widerrufen",
  "Revoke {name}": "{name} widerrufen",
  "expired {when}": "abgelaufen {when}",
  "expires {when}": "läuft {when} ab",
  "Servers cannot reach {url}": "Die Server erreichen {url} nicht",
  "Set AGENT_BASE_URL on the API to an address the servers can reach — for example over Tailscale:":
    "Setze AGENT_BASE_URL auf der API auf eine Adresse, die die Server erreichen – zum Beispiel über Tailscale:",
  "{n} critical or serious": "{n} kritisch oder schwer",
  "of {n} packages": "von {n} Paketen",
  Online: "Online",
  Offline: "Offline",
  done: "fertig",
  available: "verfügbar",
  "major update": "großes Update",
  direct: "direkt",
  "via another package": "über ein anderes Paket",
  outdated: "veraltet",
  unused: "ungenutzt",
  used: "genutzt",
  "last check {when}": "letzte Prüfung {when}",
  "{n} setup problems": "{n} Probleme bei der Einrichtung",
  "learning…": "lernt noch…",
  "CPU ({n} cores)": "CPU ({n} Kerne)",
  failed: "fehlgeschlagen",
  ok: "ok",
  never: "nie",
  "scheduled {when}": "geplant {when}",
  "needed since {when}": "nötig seit {when}",
  needed: "nötig",
  "of {n} cores": "von {n} Kernen",
  "{pct}% waiting for the disk": "{pct} % warten auf die Festplatte",
  "load {load} on {n} cores (agent 1.8.0 measures real CPU use)":
    "Last {load} auf {n} Kernen (ab Agent 1.8.0 wird die echte CPU-Nutzung gemessen)",
  "{used} of {total}": "{used} von {total}",
  "1 disk": "1 Festplatte",
  "{n} disks": "{n} Festplatten",
  "{n} updates in total": "{n} Updates insgesamt",
  "restart needed": "Neustart nötig",
  "Checked {when}": "Geprüft {when}",
  "Last scan {when}": "Letzter Scan {when}",
  "running for {n} days": "läuft seit {n} Tagen",
  "No open findings.": "Keine offenen Findings.",
  "No open findings from {source}.": "Keine offenen Findings von {source}.",
  "about {n} min left": "noch etwa {n} Min.",
  "{n} found so far": "{n} bisher gefunden",
  "Server address": "Server-Adresse",
  "Installed — token {prefix}… since {when}":
    "Installiert – Token {prefix}… seit {when}",
  "1 open point": "1 offener Punkt",
  "{n} open points": "{n} offene Punkte",
  "{name} has a critical security hole":
    "{name} hat eine kritische Sicherheitslücke",
  "{name} has {n} critical security holes":
    "{name} hat {n} kritische Sicherheitslücken",
  "{name} has a serious security hole":
    "{name} hat eine schwere Sicherheitslücke",
  "{name} has {n} serious security holes":
    "{name} hat {n} schwere Sicherheitslücken",
  "In the packages the site uses. Most are fixed by updating — Moatline can open the pull request for you.":
    "In den Paketen, die die Seite nutzt. Meist hilft ein Update – Moatline kann den Pull Request für dich erstellen.",
  "A fix for {name} is ready, but not live yet":
    "Ein Fix für {name} ist fertig, aber noch nicht live",
  "The security fix is merged, but the site still runs the old version. Deploy it.":
    "Der Sicherheits-Fix ist gemergt, aber die Seite läuft noch mit der alten Version. Deploye sie.",
  "{name} is not reachable": "{name} ist nicht erreichbar",
  "already restarted automatically": "schon automatisch neu gestartet",
  Now: "Jetzt",
  Soon: "Bald",
  "When you have time": "Wenn du Zeit hast",
  "Nothing is watched yet": "Noch wird nichts überwacht",
  "All good — nothing to do": "Alles in Ordnung – nichts zu tun",
  "Add your sites and servers — Moatline then tells you here what needs you.":
    "Füge deine Seiten und Server hinzu – Moatline sagt dir dann hier, was zu tun ist.",
  "Moatline keeps checking your sites and servers and tells you here as soon as something needs you.":
    "Moatline prüft deine Seiten und Server weiter und sagt dir hier Bescheid, sobald etwas zu tun ist.",
  "Add sites": "Seiten hinzufügen",
  "What needs you": "Was jetzt zu tun ist",
  "One thing, the most urgent first.": "Eine Sache.",
  "{n} things, the most urgent first.": "{n} Punkte, das Dringendste zuerst.",
  "Show fewer": "Weniger anzeigen",
  "Show all {n}": "Alle {n} anzeigen",
  "At least {n} characters.": "Mindestens {n} Zeichen.",
  "Install the agent on {name}": "Agent auf {name} installieren",
  "{n} silent or not yet installed": "{n} still oder noch nicht installiert",
  "Outside check": "Außenprüfung",
  "{n} other": "{n} weitere",
  "keeps restarting": "startet ständig neu",
  "not healthy": "nicht gesund",
  healthy: "gesund",
  starting: "startet",
  stopped: "gestoppt",
  paused: "pausiert",
  running: "läuft",
  "{n} running containers": "{n} laufende Container",
  "{n} services": "{n} Dienste",
  "{n} not at full strength": "{n} nicht voll verfügbar",
  "{n} with problems": "{n} mit Problemen",
  "{n} using unusually much memory":
    "{n} mit ungewöhnlich hohem Speicherverbrauch",
  "{n} with critical security holes": "{n} mit kritischen Sicherheitslücken",
  "of {size}": "von {size}",
  "usually {size}": "sonst {size}",
  "Read the packages": "Pakete lesen",
  "Find unused packages": "Ungenutzte Pakete finden",
  "Look for known security holes": "Nach bekannten Sicherheitslücken suchen",
  "Look up newer versions": "Neuere Versionen nachschlagen",
  Restart: "Neustart",
  "Go there": "Ansehen",
  "Fix it": "Beheben",
  "Loading repositories…": "Repositories werden geladen…",
  online: "online",
  "{names} offline": "{names} offline",
  "Saving failed": "Speichern fehlgeschlagen",
  "Check all now": "Alle jetzt prüfen",
  "Take over everything from Dokploy": "Alles aus Dokploy übernehmen",
  "Every site Dokploy deploys from GitHub, in one go. Recommended.":
    "Jede Seite, die Dokploy aus GitHub deployt, auf einmal. Empfohlen.",
  "A new site from a template": "Eine neue Seite aus einer Vorlage",
  "Repository, Dokploy app, database, domain and monitoring in one step.":
    "Repository, Dokploy-App, Datenbank, Domain und Überwachung in einem Schritt.",
  "1 repository is only checked when you click":
    "1 Repository wird nur geprüft, wenn du klickst",
  "{n} repositories are only checked when you click":
    "{n} Repositories werden nur geprüft, wenn du klickst",
  "New security holes are published every day. A nightly check finds them without anyone thinking of it.":
    "Jeden Tag werden neue Sicherheitslücken veröffentlicht. Eine nächtliche Prüfung findet sie, ohne dass jemand daran denken muss.",
  "Check all every night": "Alle jede Nacht prüfen",
  "First, two connections": "Zuerst zwei Verbindungen",
  "Moatline creates the repository on GitHub and the app on Dokploy — for that it needs access to both.":
    "Moatline legt das Repository auf GitHub und die App auf Dokploy an – dafür braucht es Zugriff auf beides.",
  "GitHub token": "GitHub-Token",
  connected: "verbunden",
  "not connected": "nicht verbunden",
  "Connect in the settings": "In den Einstellungen verbinden",
  "3. Environment variables": "3. Umgebungsvariablen",
  "The site is not reachable right now":
    "Die Seite ist gerade nicht erreichbar",
  "Visitors see an error. The incident below shows since when, and what Moatline already tried.":
    "Besucher sehen einen Fehler. Der Vorfall weiter unten zeigt, seit wann – und was Moatline schon versucht hat.",
  "The check is running…": "Die Prüfung läuft…",
  "This site has not been checked yet": "Diese Seite wurde noch nicht geprüft",
  "Usually done within a minute.": "Meist in einer Minute fertig.",
  "The first check looks for known security holes and outdated packages.":
    "Die erste Prüfung sucht nach bekannten Sicherheitslücken und veralteten Paketen.",
  "The last check failed": "Die letzte Prüfung ist fehlgeschlagen",
  "So it is unknown whether the site has security holes. The error is under “Latest scan”.":
    "Darum ist unklar, ob die Seite Sicherheitslücken hat. Der Fehler steht unter „Letzter Scan“.",
  "Try again": "Erneut versuchen",
  "Security holes could not be checked":
    "Sicherheitslücken konnten nicht geprüft werden",
  "1 serious security hole": "1 ernste Sicherheitslücke",
  "{n} serious security holes": "{n} ernste Sicherheitslücken",
  "A fix is on its way — progress is shown below.":
    "Ein Fix ist unterwegs – den Fortschritt siehst du weiter unten.",
  "All of them are fixed by an update. Moatline prepares it as a pull request — you review and merge it.":
    "Alle lassen sich mit einem Update beheben. Moatline bereitet es als Pull Request vor – du prüfst und mergst ihn.",
  "{n} of them are fixed by an update, which Moatline prepares as a pull request. For the rest no fix exists yet.":
    "{n} davon lassen sich mit einem Update beheben, das Moatline als Pull Request vorbereitet. Für den Rest gibt es noch keine Korrektur.",
  "No fix exists yet. Moatline checks again every day and tells you as soon as there is one.":
    "Noch gibt es keine Korrektur. Moatline prüft jeden Tag neu und sagt dir Bescheid, sobald es eine gibt.",
  "Fix automatically": "Automatisch beheben",
  "All good": "Alles in Ordnung",
  "Only minor security holes, nothing urgent.":
    "Nur kleinere Sicherheitslücken, nichts Dringendes.",
  "No known security holes.": "Keine bekannten Sicherheitslücken.",
  "The site is online.": "Die Seite ist online.",
  "Checked {when}.": "Geprüft {when}.",
  "More actions": "Weitere Aktionen",
  "Copy findings for an AI agent": "Findings für einen KI-Agent kopieren",
  "Known security holes": "Bekannte Sicherheitslücken",
  "In the packages this site uses, from the public advisory databases. Most disappear with an update.":
    "In den Paketen, die diese Seite nutzt – aus den öffentlichen Sicherheitsdatenbanken. Die meisten verschwinden mit einem Update.",
  "Fixed by updating to {version}": "Behoben mit Update auf {version}",
  "Fixed by an update": "Behoben mit einem Update",
  "No fix exists yet": "Noch keine Korrektur",
  "A major version: the site may need small changes to work with it.":
    "Eine neue Hauptversion: Die Seite braucht dafür eventuell kleine Anpassungen.",
  "in your package.json": "steht in deiner package.json",
  "comes in through another package": "kommt über ein anderes Paket",
  "More checks": "Weitere Prüfungen",
  "Setup, site security, performance, user journeys and error logs":
    "Konfiguration, Seiten-Sicherheit, Performance, Nutzer-Abläufe und Fehler-Logs",
  "Please confirm your email address first — we just sent you a new link.":
    "Bitte bestätige zuerst deine E-Mail-Adresse – wir haben dir gerade einen neuen Link geschickt.",
  "Almost done: we sent a link to {email}. Open it to confirm your address — then you are signed in.":
    "Fast geschafft: Wir haben einen Link an {email} geschickt. Öffne ihn, um deine Adresse zu bestätigen – danach bist du angemeldet.",
  "Sign in, or create an account with your email address — it takes a minute.":
    "Melde dich an oder erstelle ein Konto mit deiner E-Mail-Adresse – das dauert eine Minute.",
  "On Moatline Cloud no code from your repository runs on our servers: your repository's CI checks every fix. Auto-merge waits for it to pass.":
    "In der Moatline Cloud läuft kein Code aus deinem Repository auf unseren Servern: Die CI deines Repositories prüft jeden Fix. Auto-Merge wartet, bis sie grün ist.",
  free: "kostenlos",
  "This organization uses Moatline without a subscription.":
    "Diese Organisation nutzt Moatline ohne Abo.",
  "within a day": "innerhalb eines Tages",
  "in about 1 day": "in etwa 1 Tag",
  "in about {n} days": "in etwa {n} Tagen",
  "The agent picks it up with its next report.":
    "Der Agent übernimmt das mit seinem nächsten Bericht.",
  Storage: "Speicher",
  "S3 storage on this server and folders you watch: how big, what grows, and a warning before it is too big.":
    "S3-Speicher auf diesem Server und Ordner, die du beobachtest: wie groß, was wächst, und eine Warnung, bevor es zu viel wird.",
  "Needs agent 1.14.0 or newer — update it on the Setup tab. Then MinIO, Garage, SeaweedFS and other S3 servers in Docker show up here by themselves.":
    "Braucht Agent 1.14.0 oder neuer – aktualisiere ihn im Tab Einrichtung. Dann erscheinen MinIO, Garage, SeaweedFS und andere S3-Server in Docker hier von selbst.",
  "No S3 storage found. MinIO, Garage, SeaweedFS and other S3 servers in Docker show up here by themselves; for anything else, watch its folder.":
    "Kein S3-Speicher gefunden. MinIO, Garage, SeaweedFS und andere S3-Server in Docker erscheinen hier von selbst; für alles andere beobachte den Ordner.",
  "Watch a folder": "Ordner beobachten",
  "grows by about {size} a day": "wächst um etwa {size} pro Tag",
  "limit reached {when}": "Limit erreicht {when}",
  "disk full {when}": "Platte voll {when}",
  "full {when}": "voll {when}",
  Folder: "Ordner",
  "{pct}% of its limit": "{pct} % des Limits",
  "Disk {mount}: {pct}% used, {free} free":
    "Platte {mount}: {pct} % belegt, {free} frei",
  "Biggest buckets": "Größte Buckets",
  "Biggest folders": "Größte Ordner",
  "Limit in GB": "Limit in GB",
  "Change limit": "Limit ändern",
  "Set a limit": "Limit setzen",
  "Remove limit": "Limit entfernen",
  "Stop watching": "Nicht mehr beobachten",
  "e.g. Uploads": "z. B. Uploads",
  "Folder on the server": "Ordner auf dem Server",
  "That name is already in use.": "Dieser Name ist schon vergeben.",
  "Any folder on the server — the data folder of an S3 server outside Docker, an upload folder, a backup target. The agent only measures its size.":
    "Irgendein Ordner auf dem Server – der Datenordner eines S3-Servers außerhalb von Docker, ein Upload-Ordner, ein Backup-Ziel. Der Agent misst nur die Größe.",
  Watch: "Beobachten",
  "The disk will be full soon ({when})": "Die Platte ist bald voll ({when})",
  "It keeps filling up at the same pace as over the last week. When it is full, databases stop saving, deploys fail and sites go down.":
    "Sie füllt sich im selben Tempo weiter wie in der letzten Woche. Ist sie voll, speichern Datenbanken nichts mehr, Deploys schlagen fehl und Seiten fallen aus.",
  "Look at what grows on the Maintenance tab — often backups or uploads in S3 storage. Delete what is no longer needed, or give the disk more space.":
    "Sieh im Tab Wartung nach, was wächst – oft Backups oder Uploads im S3-Speicher. Lösche, was nicht mehr gebraucht wird, oder vergrößere die Platte.",
  "A storage is bigger than its limit":
    "Ein Speicher ist größer als sein Limit",
  "A storage is almost at its limit": "Ein Speicher ist fast an seinem Limit",
  "You set a limit for this storage so it does not take the whole disk. It is now at or close to that limit.":
    "Du hast für diesen Speicher ein Limit gesetzt, damit er nicht die ganze Platte belegt. Er ist jetzt an oder kurz vor diesem Limit.",
  "See the biggest buckets on the Maintenance tab. Let old backups expire automatically, delete what is no longer needed, or raise the limit.":
    "Sieh dir im Tab Wartung die größten Buckets an. Lass alte Backups automatisch ablaufen, lösche, was nicht mehr gebraucht wird, oder erhöhe das Limit.",
  "A storage will reach its limit soon":
    "Ein Speicher erreicht bald sein Limit",
  "At the pace of the last week, this storage outgrows the limit you set within two weeks.":
    "Im Tempo der letzten Woche wächst dieser Speicher innerhalb von zwei Wochen über dein Limit.",
  "See what grows on the Maintenance tab and let old data expire, or raise the limit.":
    "Sieh im Tab Wartung nach, was wächst, und lass alte Daten ablaufen – oder erhöhe das Limit.",
  "A storage could not be measured":
    "Ein Speicher konnte nicht gemessen werden",
  "The agent could not find or measure the folder, so it cannot warn you when it gets too big.":
    "Der Agent konnte den Ordner nicht finden oder messen und kann dich deshalb nicht warnen, wenn er zu groß wird.",
  "Check the folder on the Maintenance tab — it may have moved. Fix the path or stop watching it.":
    "Prüfe den Ordner im Tab Wartung – vielleicht wurde er verschoben. Korrigiere den Pfad oder beobachte ihn nicht mehr.",
  // Git hosts and branches
  "A repository": "Ein Repository",
  "Pick one or several from GitHub, GitLab, Bitbucket or Gitea.":
    "Eins oder mehrere aus GitHub, GitLab, Bitbucket oder Gitea auswählen.",
  "Pick from the repositories your Git tokens can read — connected ones are hidden.":
    "Wähle aus den Repositories, die deine Git-Tokens lesen können. Bereits verbundene sind ausgeblendet.",
  "Connect a repository by URL — GitHub, GitLab, Bitbucket or Gitea/Forgejo. Set branch and root directory for monorepos.":
    "Verbinde ein Repository per URL: GitHub, GitLab, Bitbucket oder Gitea/Forgejo. Bei Monorepos Branch und Stammverzeichnis setzen.",
  "Connect a repository to scan its dependencies.":
    "Verbinde ein Repository, um seine Abhängigkeiten zu scannen.",
  "Add a repository to scan packages.":
    "Füge ein Repository hinzu, um Pakete zu scannen.",
  "Every repository these tokens can read is already connected.":
    "Jedes Repository, das diese Tokens lesen können, ist schon verbunden.",
  "Git host not reachable": "Git-Host nicht erreichbar",
  "Not listed:": "Nicht aufgelistet:",
  "{n} open PR on {host}": "{n} offener PR auf {host}",
  "{n} open PRs on {host}": "{n} offene PRs auf {host}",
  "Open on {host}": "Auf {host} öffnen",
  "Open the branch on {host}": "Branch auf {host} öffnen",
  "Branch protection on {host} still applies.":
    "Der Branch-Schutz auf {host} gilt weiterhin.",
  Branches: "Branches",
  "Branches not readable": "Branches nicht lesbar",
  "{n} branch deleted": "{n} Branch gelöscht",
  "{n} branches deleted": "{n} Branches gelöscht",
  "Could not delete": "Konnte nicht gelöscht werden",
  "Branches on {host} and whether they still hold work. Merged ones nobody deleted keep showing up as open — they can go.":
    "Die Branches auf {host} und ob noch Arbeit darin steckt. Gemergte Branches, die niemand gelöscht hat, tauchen weiter als offen auf. Die können weg.",
  "Delete {n} merged branch": "{n} gemergten Branch löschen",
  "Delete {n} merged branches": "{n} gemergte Branches löschen",
  "Check again": "Erneut prüfen",
  "Only the default branch — nothing to clean up.":
    "Nur der Hauptbranch, nichts aufzuräumen.",
  "{n} merged": "{n} gemergt",
  "{n} with an open pull request": "{n} mit offenem Pull Request",
  "{n} with work not in the default branch":
    "{n} mit Arbeit, die nicht im Hauptbranch ist",
  "{n} unknown": "{n} unbekannt",
  checked: "geprüft",
  protected: "geschützt",
  "Delete {name}": "{name} löschen",
  "Delete branch": "Branch löschen",
  "Show all {n} branches": "Alle {n} Branches anzeigen",
  "Only the first 100 branches were compared; the rest show as unknown.":
    "Nur die ersten 100 Branches wurden verglichen. Der Rest steht auf unbekannt.",
  "To delete branches from here, add a {host} token with write access under Settings.":
    "Um Branches von hier aus zu löschen, hinterlege unter Einstellungen einen {host}-Token mit Schreibrechten.",
  "Delete {n} branch on {host}?": "{n} Branch auf {host} löschen?",
  "Delete {n} branches on {host}?": "{n} Branches auf {host} löschen?",
  "Everything in them is already in the default branch, so no work is lost. Each one is checked again before it is deleted; a branch that got new commits in the meantime stays.":
    "Alles darin ist schon im Hauptbranch, es geht also keine Arbeit verloren. Vor dem Löschen wird jeder Branch noch einmal geprüft. Hat einer inzwischen neue Commits bekommen, bleibt er stehen.",
  "merged via PR": "per PR gemergt",
  merged: "gemergt",
  "open pull request": "offener Pull Request",
  "not merged": "nicht gemergt",
  unknown: "unbekannt",
  "not found": "nicht gefunden",
  "default branch": "Hauptbranch",
  "A personal, group or project access token with the api scope (read_api and read_repository are enough for scans only). Leave the URL empty for gitlab.com.":
    "Ein Personal-, Gruppen- oder Projekt-Access-Token mit dem Scope api. Nur für Scans reichen read_api und read_repository. Für gitlab.com die URL leer lassen.",
  "An access token with repository read and write (and user read for the connection test). Enter your instance's URL, e.g. https://codeberg.org or https://git.example.com.":
    "Ein Access-Token mit Lese- und Schreibrechten auf Repositories, dazu Leserecht auf den User für den Verbindungstest. Trag die URL deiner Instanz ein, z. B. https://codeberg.org oder https://git.example.com.",
  "An API token with repository and pull request read/write scopes, together with your Atlassian account email — or a repository/workspace access token without an email.":
    "Ein API-Token mit Lese- und Schreibrechten auf Repositories und Pull Requests, zusammen mit der E-Mail deines Atlassian-Kontos. Alternativ ein Repository- oder Workspace-Access-Token ohne E-Mail.",
  "{host} connected as {account}": "{host} verbunden als {account}",
  "Could not connect": "Verbindung fehlgeschlagen",
  "Remove {host}": "{host} entfernen",
  URL: "URL",
  "Atlassian account email (optional)":
    "E-Mail des Atlassian-Kontos (optional)",
  "Testing…": "Wird getestet…",
  "Test and save": "Testen und speichern",
  "Add a Git host": "Git-Host hinzufügen",
  "GitLab, Bitbucket, Gitea / Forgejo": "GitLab, Bitbucket, Gitea / Forgejo",
  "Repositories on other Git hosts — cloud or self-hosted. Scans, update and security PRs, CI checks and the branch overview work the same as on GitHub.":
    "Repositories auf anderen Git-Hosts, in der Cloud oder selbst gehostet. Scans, Update- und Security-PRs, CI-Checks und die Branch-Übersicht funktionieren genauso wie bei GitHub.",
  // Komodo and Portainer
  "Portainer access token": "Portainer-Access-Token",
  Komodo: "Komodo",
  Portainer: "Portainer",
  "Komodo URL": "Komodo-URL",
  "Portainer URL": "Portainer-URL",
  "Komodo API key": "Komodo-API-Key",
  "Komodo API secret": "Komodo-API-Secret",
  "Stacks on Komodo that deploy from a Git repository: deploys with watch, self-healing, redeploy buttons. Create an API key and secret in Komodo (Settings → API keys).":
    "Stacks in Komodo, die aus einem Git-Repository deployen: Deploys mit Überwachung, Selbstheilung, Redeploy-Buttons. Lege in Komodo einen API-Key mit Secret an (Settings → API keys).",
  "Stacks in Portainer deployed from a Git repository: redeploys with watch, self-healing, redeploy buttons. Create an access token in Portainer (My account → Access tokens).":
    "Stacks in Portainer, die aus einem Git-Repository deployt werden: Redeploys mit Überwachung, Selbstheilung, Redeploy-Buttons. Lege in Portainer einen Access-Token an (My account → Access tokens).",
  "Komodo or Portainer stack": "Komodo- oder Portainer-Stack",
  "For sites in a Komodo or Portainer stack from Git: deploys after a merge, self-healing, redeploy. Linked automatically when one stack deploys this repository. Dokploy and Coolify win when set.":
    "Für Sites in einem Komodo- oder Portainer-Stack aus Git: Deploy nach dem Merge, Selbstheilung, Redeploy. Wird automatisch verknüpft, wenn genau ein Stack dieses Repository deployt. Dokploy und Coolify haben Vorrang, wenn gesetzt.",
  // GitHub App
  "GitHub App installed.": "GitHub App installiert.",
  "GitHub did not confirm the app. Try again.":
    "GitHub hat die App nicht bestätigt. Versuch es noch einmal.",
  "The GitHub App setup took too long or was started elsewhere. Start it again.":
    "Die Einrichtung der GitHub App hat zu lange gedauert oder wurde woanders gestartet. Starte sie noch einmal.",
  "Sign in first, then start the setup again.":
    "Melde dich zuerst an und starte die Einrichtung dann noch einmal.",
  "No GitHub App to install. Create it first.":
    "Es gibt keine GitHub App zum Installieren. Leg sie zuerst an.",
  "Could not refresh": "Konnte nicht aktualisiert werden",
  "GitHub App disconnected": "GitHub App getrennt",
  "Delete it on GitHub too if it is no longer needed.":
    "Lösche sie auch auf GitHub, wenn du sie nicht mehr brauchst.",
  installed: "installiert",
  "not installed yet": "noch nicht installiert",
  "Installed on:": "Installiert auf:",
  "Install on another account": "Auf weiterem Account installieren",
  "Install the app": "App installieren",
  "Check installations": "Installationen prüfen",
  Disconnect: "Trennen",
  "Repositories of the accounts the app is installed on use its tokens; the access token below stays for the rest and for new sites from templates.":
    "Repositories der Accounts, auf denen die App installiert ist, nutzen ihre Tokens. Der Access-Token darunter bleibt für den Rest und für neue Sites aus Templates.",
  "Recommended: a GitHub App": "Empfohlen: eine GitHub App",
  "Create Moatline's own GitHub App in two clicks — like Dokploy. Its tokens last an hour and belong to no person, so nothing breaks when someone leaves.":
    "Leg mit zwei Klicks eine eigene GitHub App für Moatline an, wie bei Dokploy. Ihre Tokens gelten eine Stunde und gehören keiner Person, also bricht nichts, wenn jemand geht.",
  "GitHub organization (optional)": "GitHub-Organisation (optional)",
  "empty: your personal account": "leer: dein persönlicher Account",
  "Opening GitHub…": "GitHub wird geöffnet…",
  "Create GitHub App": "GitHub App anlegen",
  // Sign in and sign up
  "Hide password": "Passwort verbergen",
  "Show password": "Passwort anzeigen",
  "Vulnerabilities fixed by pull request":
    "Sicherheitslücken per Pull Request behoben",
  "Lockfile scans, fixes that keep your framework on one version.":
    "Scans des Lockfiles und Fixes, die dein Framework auf einer Version halten.",
  "Deploys that roll back when they break":
    "Deploys, die sich zurückrollen, wenn sie etwas kaputt machen",
  "Through Dokploy, Coolify, Komodo or Portainer.":
    "Über Dokploy, Coolify, Komodo oder Portainer.",
  "Servers, backups and domains in view":
    "Server, Backups und Domains im Blick",
  "Disks filling up, updates, certificates — before they hurt.":
    "Volle Platten, Updates, Zertifikate, bevor sie wehtun.",
  "Security and operations for self-hosted apps.":
    "Sicherheit und Betrieb für selbst gehostete Apps.",
  "The password needs at least 8 characters.":
    "Das Passwort braucht mindestens 8 Zeichen.",
  "Could not send the link": "Der Link konnte nicht gesendet werden",
  "Enter one of your backup codes.": "Gib einen deiner Backup-Codes ein.",
  "Enter the 6-digit code from your authenticator app.":
    "Gib den 6-stelligen Code aus deiner Authenticator-App ein.",
  "Check your inbox": "Schau in dein Postfach",
  "We sent a link to {email}. Open it to confirm your address — then you are signed in.":
    "Wir haben einen Link an {email} geschickt. Öffne ihn, um deine Adresse zu bestätigen. Danach bist du angemeldet.",
  "Set up Moatline": "Moatline einrichten",
  "Create the first account. It owns this instance and can invite everyone else.":
    "Leg das erste Konto an. Es gehört der Instanz als Owner und kann alle anderen einladen.",
  "Create your account": "Konto anlegen",
  "Use the address the invitation was sent to — then you join your team.":
    "Nimm die Adresse, an die die Einladung ging. Dann kommst du direkt in dein Team.",
  "It takes a minute.": "Dauert eine Minute.",
  "Welcome back": "Willkommen zurück",
  "Sign in to accept the invitation.":
    "Melde dich an, um die Einladung anzunehmen.",
  "Sign in to Moatline.": "Bei Moatline anmelden.",
  "Not there after a minute? Look in the spam folder, or send the link again.":
    "Nach einer Minute noch nichts da? Schau im Spam-Ordner nach oder schick den Link noch einmal.",
  "Sent again.": "Erneut gesendet.",
  "Send the link again": "Link erneut senden",
  "Your name": "Dein Name",
  "At least 8 characters.": "Mindestens 8 Zeichen.",
  "Create the account": "Konto anlegen",
  "No account yet?": "Noch kein Konto?",
  "No account yet? Registration is by invitation — ask an owner of your organization.":
    "Noch kein Konto? Registrieren geht nur mit Einladung. Frag eine Owner-Person deiner Organisation.",
  "Already have an account?": "Schon ein Konto?",
  "Sign in to accept this invitation. New here? Create an account with the address the invitation was sent to — afterwards you come right back here.":
    "Melde dich an, um die Einladung anzunehmen. Neu hier? Leg ein Konto mit der Adresse an, an die die Einladung ging. Danach landest du direkt wieder hier.",
  "Create an account": "Konto anlegen",
  "I already have an account": "Ich habe schon ein Konto",
  "The email address or the password is not right.":
    "E-Mail-Adresse oder Passwort stimmen nicht.",
  "There is already an account with this email address. Sign in instead, or reset the password.":
    "Mit dieser E-Mail-Adresse gibt es schon ein Konto. Melde dich an oder setz das Passwort zurück.",
  "The password is too long.": "Das Passwort ist zu lang.",
  "That does not look like an email address.":
    "Das sieht nicht nach einer E-Mail-Adresse aus.",
  "Registration here is by invitation. Ask an owner of your organization to invite this address.":
    "Registrieren geht hier nur mit Einladung. Bitte eine Owner-Person deiner Organisation, diese Adresse einzuladen.",
  "That code did not work. Check it and try again.":
    "Der Code hat nicht funktioniert. Prüf ihn und versuch es noch einmal.",
  "Too many attempts. Wait a few minutes, then try again.":
    "Zu viele Versuche. Warte ein paar Minuten und versuch es dann noch einmal.",
  // Plans
  "One flat price per month for the whole organization — switch any time, charged pro rata. Prefer not to pay? Moatline is open source: host it yourself for free.":
    "Ein Pauschalpreis pro Monat für die ganze Organisation. Wechseln geht jederzeit, abgerechnet wird anteilig. Lieber nichts zahlen? Moatline ist Open Source, du kannst es kostenlos selbst hosten.",
  "Switched to {plan}.": "Zu {plan} gewechselt.",
  "Could not switch": "Wechsel hat nicht geklappt",
  "/ month": "/ Monat",
  "Up to {n} servers": "Bis zu {n} Server",
  "Unlimited repositories": "Repositories unbegrenzt",
  "Up to {n} repositories": "Bis zu {n} Repositories",
  "Every feature": "Alle Funktionen",
  "Your plan": "Dein Tarif",
  "Too small for what this organization has":
    "Zu klein für das, was diese Organisation schon hat",
  Switch: "Wechseln",
  "Choose {plan}": "{plan} wählen",
  "You are on the old price per server. It keeps working; switching to a plan is usually cheaper.":
    "Du bist noch auf dem alten Preis pro Server. Der läuft weiter, ein Tarif ist meist günstiger.",
  // Probes
  "Checked from {n} locations — an outage counts once a second one sees it.":
    "Von {n} Standorten geprüft. Eine Störung zählt erst, wenn ein zweiter sie auch sieht.",
  // Status pages
  "This status page does not exist or is not published.":
    "Diese Statusseite gibt es nicht, oder sie ist nicht veröffentlicht.",
  Operational: "In Betrieb",
  "Not checked": "Nicht geprüft",
  "{n} min down": "{n} Min. ausgefallen",
  "No downtime": "Kein Ausfall",
  "90 days ago": "vor 90 Tagen",
  "{pct} uptime": "{pct} Verfügbarkeit",
  Today: "Heute",
  "Past incidents": "Vergangene Störungen",
  "No incidents in the last 30 days.":
    "Keine Störungen in den letzten 30 Tagen.",
  "was down": "war ausgefallen",
  "is down": "ist ausgefallen",
  "Updated {time}": "Aktualisiert {time}",
  "Powered by Moatline": "Bereitgestellt von Moatline",
  "All systems operational": "Alle Systeme in Betrieb",
  "Some systems are down": "Einige Systeme sind ausgefallen",
  "Major outage": "Größerer Ausfall",
  "Status not known yet": "Status noch unbekannt",
  "Status page saved": "Statusseite gespeichert",
  "Status pages": "Statusseiten",
  "A public page for your customers: which sites are up, uptime day by day, past outages. It stays up when your servers go down.":
    "Eine öffentliche Seite für deine Kunden: welche Sites laufen, die Verfügbarkeit Tag für Tag und vergangene Ausfälle. Sie bleibt erreichbar, auch wenn deine Server ausfallen.",
  "New status page": "Neue Statusseite",
  "{n} sites": "{n} Sites",
  published: "veröffentlicht",
  draft: "Entwurf",
  Title: "Titel",
  "Acme status": "Acme-Status",
  Address: "Adresse",
  "Description (optional)": "Beschreibung (optional)",
  "Sites on the page": "Sites auf der Seite",
  "Published — anyone with the link can see it":
    "Veröffentlicht: Jede Person mit dem Link kann sie sehen",
  "No status page yet.": "Noch keine Statusseite.",
  // Migrations
  "Database migrations": "Datenbank-Migrationen",
  "Migrations that would delete data are caught in the pull request, before anything runs in production.":
    "Migrationen, die Daten löschen würden, werden schon im Pull Request erkannt, bevor in Produktion etwas läuft.",
  "Nothing risky: no open pull request drops data, and the setup runs migrations properly.":
    "Nichts Riskantes: Kein offener Pull Request löscht Daten, und die Migrationen laufen sauber.",
  "Pull request #{n}": "Pull Request #{n}",
  "Merged, not live yet": "Gemergt, noch nicht live",
  // Jobs and platforms
  "every 5 minutes": "alle 5 Minuten",
  "every 15 minutes": "alle 15 Minuten",
  hourly: "stündlich",
  "every 6 hours": "alle 6 Stunden",
  daily: "täglich",
  weekly: "wöchentlich",
  custom: "eigener Takt",
  "Scheduled jobs": "Geplante Jobs",
  "Backups, cleanups and imports that fail without a sound. Let each job call its URL after it ran — if it stays silent longer than expected, you hear about it, even when its server is down.":
    "Backups, Aufräum-Jobs und Importe, die still scheitern. Lass jeden Job nach seinem Lauf seine Adresse aufrufen. Bleibt er länger still als erwartet, erfährst du es, auch wenn sein Server ausgefallen ist.",
  "Watch a job": "Job überwachen",
  "Nightly database backup": "Nächtliches Datenbank-Backup",
  Runs: "Läuft",
  "No job watched yet.": "Noch kein Job überwacht.",
  "on time": "pünktlich",
  missed: "ausgeblieben",
  "waiting for its first run": "wartet auf den ersten Lauf",
  "last run": "letzter Lauf",
  "Append the command to the job, e.g. `pg_dump … && curl …`. Add /start before the run to measure how long it takes, /fail to report a failure right away.":
    "Häng den Befehl an den Job an, z. B. `pg_dump … && curl …`. Mit /start vor dem Lauf wird die Dauer gemessen, mit /fail meldet der Job einen Fehler sofort.",
  Jobs: "Jobs",
  "Dokploy, Coolify, Komodo and Portainer run everything else — the version you run, checked against the security advisories each project publishes.":
    "Dokploy, Coolify, Komodo und Portainer betreiben alles andere. Die installierte Version wird mit den Sicherheitsmeldungen geprüft, die jedes Projekt veröffentlicht.",
  "No platform connected.": "Keine Plattform verbunden.",
  "Not checked yet — check now.": "Noch nicht geprüft. Jetzt prüfen.",
  "version unknown": "Version unbekannt",
  "{n} known vulnerabilities": "{n} bekannte Sicherheitslücken",
  "no known vulnerability": "keine bekannte Sicherheitslücke",
  "latest: {v}": "neueste: {v}",
  "fixed in {v}": "behoben in {v}",
  // Out of memory
  "A deploy ran the server out of memory":
    "Ein Deploy hat dem Server den Speicher ausgehen lassen",
  "Dokploy and Coolify build on the server the sites run on. A big build took the memory, and the kernel killed the biggest process to survive — often the running app.":
    "Dokploy und Coolify bauen auf dem Server, auf dem auch die Seiten laufen. Ein großer Build hat den Speicher belegt, und der Kernel hat den größten Prozess beendet, um den Server zu retten. Oft ist das die laufende App.",
  "Build on a separate build server, or give builds a memory limit and add swap. The finding goes away a day after the last kill.":
    "Bau auf einem eigenen Build-Server, oder gib Builds ein Speicherlimit und richte Swap ein. Der Fund verschwindet einen Tag nach dem letzten Abbruch.",
  "The server ran out of memory": "Dem Server ist der Speicher ausgegangen",
  "The kernel had to kill processes to keep the server alive. Whatever was killed stopped working until it was restarted.":
    "Der Kernel musste Prozesse beenden, damit der Server weiterläuft. Was beendet wurde, lief bis zum Neustart nicht.",
  "Give the apps memory limits (and NODE_OPTIONS=--max-old-space-size for Node apps), add swap, or move work to another server.":
    "Gib den Apps Speicherlimits (bei Node-Apps zusätzlich NODE_OPTIONS=--max-old-space-size), richte Swap ein oder verlege Arbeit auf einen anderen Server.",
  // Maintenance
  "30 minutes": "30 Minuten",
  "1 hour": "1 Stunde",
  "2 hours": "2 Stunden",
  "4 hours": "4 Stunden",
  "8 hours": "8 Stunden",
  "Maintenance started — alerts are held back.":
    "Wartung gestartet. Alarme werden zurückgehalten.",
  "Maintenance ended": "Wartung beendet",
  "Alerts are held back until {time}. Click to end it now.":
    "Alarme werden bis {time} zurückgehalten. Klick, um die Wartung jetzt zu beenden.",
  "Maintenance until {time}": "Wartung bis {time}",
  "Hold back alerts while you work on it; status pages show maintenance.":
    "Hält Alarme zurück, während du daran arbeitest. Statusseiten zeigen Wartung.",
  "Planned maintenance in progress": "Geplante Wartung läuft",
  // Stripe
  "Thank you — your plan is updated in a moment.":
    "Danke! Dein Tarif ist gleich aktualisiert.",
  "Stripe did not answer": "Stripe hat nicht geantwortet",
  "test mode": "Testmodus",
  "Choose a plan": "Wähle einen Tarif",
  "Look around freely — adding servers and repositories needs a subscription, from 8 € a month.":
    "Schau dich in Ruhe um – um Server und Repositories hinzuzufügen, brauchst du ein Abo, ab 8 € im Monat.",
  "See plans": "Tarife ansehen",
  // Tailscale SSH
  "Tailscale SSH is on: SSH keys no longer let anyone in":
    "Tailscale SSH ist an: SSH-Keys lassen niemanden mehr rein",
  "Over Tailscale, Tailscale itself now decides who may log in — not the SSH keys on the server. You on your laptop still get in, but tools that log in with a key are refused: Dokploy and Coolify for their remote servers, deploys from GitHub Actions. That is usually why Dokploy suddenly cannot reach this server.":
    "Über Tailscale entscheidet jetzt Tailscale selbst, wer sich anmelden darf – nicht mehr die SSH-Keys auf dem Server. Du kommst von deinem Laptop weiter rein, aber Tools, die sich mit einem Key anmelden, werden abgewiesen: Dokploy und Coolify bei ihren Remote-Servern, Deploys aus GitHub Actions. Meist ist das der Grund, warum Dokploy diesen Server plötzlich nicht mehr erreicht.",
  'Option A (simplest): on the server run "sudo tailscale set --ssh=false". The keys count again, and SSH still only goes over Tailscale. The machine running Dokploy or Coolify must be in your tailnet; connect it to the server\'s 100.x address. Option B (keep Tailscale SSH): in the Tailscale admin console under Access controls, add an SSH rule that lets the Dokploy or Coolify machine log in as root with "action": "accept" — "check" asks for a browser login, which no tool can do.':
    'Variante A (am einfachsten): Auf dem Server "sudo tailscale set --ssh=false" ausführen. Dann zählen die Keys wieder, und SSH läuft trotzdem nur über Tailscale. Der Rechner mit Dokploy oder Coolify muss in deinem Tailnet sein; verbinde ihn mit der 100.x-Adresse des Servers. Variante B (Tailscale SSH behalten): In der Tailscale-Konsole unter Access controls eine SSH-Regel anlegen, die den Dokploy- oder Coolify-Rechner als root mit "action": "accept" reinlässt – "check" verlangt eine Anmeldung im Browser, die kein Tool kann.',
  "SSH is open only over Tailscale": "SSH ist nur über Tailscale offen",
  "The firewall no longer lets SSH in from the internet — only over your tailnet. Tools that connect to the server's public IP stop working: Dokploy, Coolify, deploys from GitHub Actions.":
    "Die Firewall lässt SSH nicht mehr aus dem Internet rein – nur über dein Tailnet. Tools, die sich mit der öffentlichen IP des Servers verbinden, funktionieren nicht mehr: Dokploy, Coolify, Deploys aus GitHub Actions.",
  'Add the machine running Dokploy or Coolify to your tailnet (install Tailscale there and run "sudo tailscale up"), then change the server\'s address in Dokploy or Coolify to its 100.x Tailscale address.':
    'Nimm den Rechner mit Dokploy oder Coolify in dein Tailnet auf (dort Tailscale installieren und "sudo tailscale up" ausführen) und ändere die Adresse des Servers in Dokploy oder Coolify auf seine 100.x-Tailscale-Adresse.',
  "Trivy found {n} — the list follows with the next report.":
    "Trivy hat {n} gefunden – die Liste kommt mit dem nächsten Bericht.",
  "Allow SSH only from (optional)": "SSH nur erlauben von (optional)",
  "The address of your Dokploy or Coolify server (its Tailscale address if it is in your tailnet) and your office. SSH from anywhere else is closed in ufw; your own session during the install stays allowed. Needs an active firewall — allow the same addresses in your provider's firewall.":
    "Die Adresse deines Dokploy- oder Coolify-Servers (seine Tailscale-Adresse, wenn er in deinem Tailnet ist) und deines Büros. SSH von überall sonst wird in ufw geschlossen; deine eigene Sitzung während der Installation bleibt erlaubt. Braucht eine aktive Firewall – erlaube dieselben Adressen auch in der Firewall deines Providers.",
  "Accounts, activity and subscriptions across every organization on this instance.":
    "Konten, Aktivität und Abos über alle Organisationen dieser Instanz.",
  Users: "Nutzer",
  "{n} new in 7 days, {m} in 30 days": "{n} neu in 7 Tagen, {m} in 30 Tagen",
  "Active users": "Aktive Nutzer",
  "signed in within 7 days · {n} within 30":
    "in den letzten 7 Tagen angemeldet · {n} in 30",
  Paying: "Zahlend",
  "{eur} € a month · {t} in trial": "{eur} € im Monat · {t} im Test",
  "{s} with a server, {r} with a repository":
    "{s} mit Server, {r} mit Repository",
  "Sign-ups per week": "Anmeldungen pro Woche",
  "this week": "diese Woche",
  Funnel: "Trichter",
  Accounts: "Konten",
  "Email confirmed": "E-Mail bestätigt",
  "Organization with a server": "Organisation mit Server",
  "{n} reporting": "{n} melden sich",
  "Newest accounts": "Neueste Konten",
  Account: "Konto",
  "Signed up": "Registriert",
  "Last active": "Zuletzt aktiv",
  Plan: "Tarif",
  "not confirmed": "nicht bestätigt",
  "Could not load": "Konnte nicht geladen werden",
  "One thing needs you": "Eine Sache braucht dich",
  "{n} things need you": "{n} Dinge brauchen dich",
  "{n} now": "{n} jetzt",
  "{n} soon": "{n} bald",
  "{n} when you get to it": "{n} wenn du Zeit hast",
  "The most urgent first.": "Das Dringendste zuerst.",
};
