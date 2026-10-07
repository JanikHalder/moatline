# Verbesserungsvorschläge

## Erledigt (Quick-Wins)

- **Env-Validierung**: API prüft beim Start `DATABASE_URL` und (in Produktion) `BETTER_AUTH_SECRET`.
- **Scan**: Nutzt `defaultBranch` aus dem Repo für den package.json-Abruf (nicht mehr fest "main").
- **Packages-Route**: Liefert nur Findings des **letzten** erfolgreichen Scans pro Repo (nicht alle Success-Scans).
- **Frontend**: Fehlermeldung bei fehlgeschlagenem API-Call (z. B. Repo anlegen, Scan starten).

---

## API

- **Rate-Limit / Batching**: Beim Scan npm-Registry mit `p-limit` (Concurrency 5) begrenzt (erledigt).
- **Globaler Error-Handler**: Hono `onError` für JSON-Fehler und Logging (erledigt).
- **Update-Workflow**: Stub durch echten Ablauf ersetzen (Branch anlegen, `npm-check-updates`, Build, Push) mit `GITHUB_TOKEN` und ggf. Worker/Queue (offen).
- **Branch in parseGitHubUrl**: Optional aus URL auslesen (z. B. `tree/main`), Fallback Repo.`defaultBranch` (erledigt).

---

## Frontend (erledigt)

- **Scan-Status-Polling**: Auf Repo-Detail bei Status "pending" alle paar Sekunden Scans abfragen (erledigt).
- **Update-Run-Polling**: Nach "Update starten" Update-Run-Status pollen bis pushed/failed (erledigt).
- **Auth-Typen**: Better-Auth-Client-Typen in `lib/auth-types.ts`, keine Ad-hoc-Casts (erledigt).
- **Loading-States**: Scan-/Update-/Add-Repo-Buttons mit Disabled und Lade-Text (erledigt).

---

## Qualität & DX (erledigt)

- **ESLint + Prettier**: Einheitliche Lint- und Format-Regeln, Script `pnpm run lint` / `pnpm run format` (erledigt).
- **E2E-Tests**: Playwright für kritischen Pfad – `pnpm run test:e2e` (Login-Seite, Formular); einmalig `pnpm exec playwright install` (erledigt).
- **API-Tests mit Session**: GET /api/repos mit gemockter Session + `activeOrganizationId` → 200 und leeres Array (erledigt).

---

## Sicherheit & Betrieb

- **CORS**: In Produktion `CORS_ORIGIN` explizit setzen (kein `*`).
- **BETTER_AUTH_SECRET**: Mindestlänge (z. B. 32 Zeichen) beim Start prüfen.
- **Login-Gate**: Auth ist standardmäßig aktiv; der Demo-Org-Bypass läuft nur
  noch über `VITE_DISABLE_LOGIN=true` im Dev-Build (erledigt).

---

## Ende-zu-Ende-Durchlauf (erledigt)

Der Stack wurde gegen eine echte PostgreSQL-Instanz gestartet und im Browser
durchgespielt (Signup → Org → Repo → Scan → Dashboard). Dabei behoben:

- **Build**: `pnpm run build` scheiterte an Typfehlern im Drizzle-Mock des
  Scan-Tests; `pnpm run format:check` an 36 ungeformten Dateien.
- **Org anlegen**: Better Auth verlangt einen `slug`; der Dialog schickte keinen
  und verschluckte den 400er – der Slug wird jetzt aus dem Namen abgeleitet,
  Fehler werden angezeigt.
- **Aktive Org**: Eine frische Session hatte keine aktive Organisation, alle
  Org-Routen antworteten mit 403 und die App wirkte leer. Die erste Org des
  Users wird nun automatisch aktiviert.
- **Org-Wechsel**: Routen werden beim Wechsel neu gemountet, sonst blieben die
  Daten der vorherigen Org stehen. Neue Orgs lassen sich jetzt jederzeit über
  den Org-Switcher anlegen.
- **Dropdown**: Hatte keinen Open-State (dauerhaft aufgeklappt) und schachtelte
  einen Button im Button. Öffnet und schließt jetzt per Klick, Escape und
  Außenklick.
- **Scan mit ungültigem `GITHUB_TOKEN`**: Ein 401 der GitHub-API ließ jeden Scan
  scheitern, auch bei öffentlichen Repos. Es wird nun auf die öffentliche
  Raw-URL zurückgefallen; Scan-Fehler landen zusätzlich im Log.

---

## Offen

- **E2E-Abdeckung**: Playwright deckt bisher nur die Login-Seite ab. Der
  eingeloggte Pfad (Org anlegen, Repo hinzufügen, Scan) bräuchte eine
  Test-Datenbank und Fixtures.
- **Daten-Refetch**: Views laden ihre Daten beim Mounten; ein Org-Wechsel
  remountet sie. Eine Query-Bibliothek (TanStack Query) würde Caching und
  Invalidierung sauberer lösen als der Remount-Key.
- **CI**: Läuft über `.github/workflows/ci.yml` (Lint, Format, Build,
  Migrationen, Unit- und E2E-Tests) – ein Deploy-Schritt fehlt bewusst.
