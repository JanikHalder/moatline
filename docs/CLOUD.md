# Running Moatline for customers

A self-hosted Moatline trusts its users and their repositories: sign-up is
by invitation, and fixes can be checked with the repository's own typecheck
or build. Hosting it for customers turns both around. `CLOUD_MODE=true`
switches an instance to that:

|                      | Self-hosted                                   | `CLOUD_MODE=true`                                          |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Sign-up              | invitation only (plus the very first account) | open; the address is confirmed by email                    |
| Checking a fix       | typecheck, build or the repository's CI       | the repository's CI only                                   |
| Package managers     | as the repository configures them             | no lifecycle scripts, no `.pnpmfile.cjs`, no `.yarnrc.yml` |
| Unused-package check | with depcheck's config readers                | source files only                                          |
| Self-update button   | for owners                                    | hidden — the operator updates                              |

On the cloud no code from a customer's repository runs on the server. A
typecheck runs the repository's own `tsc`, a build its scripts; either could
read the API's environment — the database password and `SECRETS_KEY` — and
with them every other customer's data. So the cloud leaves that check to the
repository's GitHub CI, and auto-merge waits for it.

## Setting it up on Dokploy

1. Deploy the Moatline template (`templates/dokploy/moatline`) on a domain,
   for example `app.moatline.dev`.
2. The images (`ghcr.io/janikhalder/moatline-api`, `-web`) are on ghcr.io. While they are private, log the server in
   once: `docker login ghcr.io` with a token that can read packages.
3. **Sign up right away.** The first account is the operator's; with
   `CLOUD_MODE` off it is the only one that can register uninvited.
4. Set the environment in Dokploy and redeploy:

| Variable                                                                                                      | What for                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUD_MODE=true`                                                                                             | the behaviour above                                                                                                                                                                                                                                                                    |
| `RESEND_API_KEY`, `MAIL_FROM` (or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)            | confirmation mails, password resets and invitations for organizations without a mail server of their own. `MAIL_FROM` must be on a domain verified in Resend, e.g. `Moatline <noreply@moatline.dev>`. Without mail sign-up works but is not confirmed, and nobody can reset a password |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_AGENCY` | flat plans per organization, billed by Stripe as merchant of record (Managed Payments); without a subscription an organization can look around but not add servers or repositories                                                                                                     |
| `BILLING_FREE_ORGS`                                                                                           | organizations that need no subscription, by id or slug — your own, for instance                                                                                                                                                                                                        |
| `OPERATOR_EMAILS`                                                                                             | your own email addresses, comma-separated: they get **Usage** in the sidebar — accounts, sign-ups per week, active users, who set up servers, who pays and the monthly revenue, across every organization (needs two-factor authentication)                                            |

5. Set up Stripe as described in [cloud-billing.md](cloud-billing.md); its
   webhook goes to `https://<your domain>/api/billing/stripe/webhook`.
6. Back up the `postgres-data` volume (Dokploy → Volume backups) and keep
   `SECRETS_KEY` somewhere safe: without it the stored tokens of every
   organization are unreadable.

## Limits that stay

- Sign-ups are throttled to five per hour from one address, and the
  confirmation mail to three per hour per account.
- Scans clone repositories and read their files on the server; they do not
  execute them. The scheduler runs heavy jobs one at a time
  (`HEAVY_JOB_CONCURRENCY`), so one large customer can slow scans down for
  the others.
- The stricter option — every repository job in a throwaway container of
  its own — is not built yet.
