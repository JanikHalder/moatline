---
layout: page
sidebar: false
aside: false
title: Privacy policy
---

<script setup>
import { legal } from "./.vitepress/legal";
</script>

<div class="legal vp-doc">

# Privacy policy

Last updated {{ legal.updated }}.

This policy explains what personal data the Moatline website (moatline.dev) and the hosted Moatline service (the "Service") process, why, and what rights you have. The controller is {{ legal.company }}, {{ legal.address }}, {{ legal.email }}.

A self-hosted Moatline sends us nothing: whoever runs it is responsible for the data in it.

## The website

**Analytics.** We count visits with Plausible Analytics, which we run ourselves (plausible.janikhalder.at). It sets no cookies and stores no IP addresses or other identifiers; visits are counted as anonymous totals (page, referrer, country, browser). Legal basis: our legitimate interest in knowing which pages are read (Art. 6(1)(f) GDPR).

**Server logs.** When you open a page, the web server briefly processes your IP address and browser details to deliver it and to fend off attacks.

## The Service

| What                                                                                                                                                                         | Why                                            | Kept                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Account: name, email address, password (hashed), second-factor secret (encrypted), sessions with IP address and browser                                                      | Sign-in and security                           | Until you delete the account; sessions expire                                                 |
| Organizations, members, roles, invitations                                                                                                                                   | Working together                               | Until the organization is deleted                                                             |
| Audit log: who did what, when, from which IP address                                                                                                                         | Security and traceability for the organization | Until the organization is deleted                                                             |
| Repository data: URLs, branches, dependency names and versions, findings, pull requests opened                                                                               | The core of the Service                        | Until the repository is removed                                                               |
| Server reports from the agent: hostname, operating system, packages and updates, containers, disk and memory use, firewall and login events, error lines from container logs | Watching your servers                          | Reports are replaced by newer ones; metrics are kept for 14 days, storage history for 90 days |
| Access tokens for GitHub, GitLab, Bitbucket, Gitea, Dokploy, Coolify and others                                                                                              | Acting on your behalf where you asked          | Encrypted; until you remove them                                                              |
| Live checks of the URLs you enter                                                                                                                                            | Uptime and deploy checks                       | Until the repository is removed                                                               |

Legal basis: performing the contract with you (Art. 6(1)(b) GDPR) and, for security logs, our legitimate interest in a secure Service (Art. 6(1)(f) GDPR). Server reports may contain personal data of third parties (for example user names in login events); you decide what the agent runs on, and we process that data on your behalf.

The Service does not execute code from your repositories and does not read the contents of your databases.

## Who else processes data

- **Hosting:** {{ legal.hosting }} — the servers the Service runs on, in the EU.
- **Stripe** (Stripe Payments Europe, Ltd., Ireland) — payment, taxes and invoices as merchant of record (Stripe Managed Payments). Stripe processes your billing details as its own controller; see [stripe.com/privacy](https://stripe.com/privacy).
- **Resend** — sending emails (confirmations, password resets, notifications). Resend may process data in the USA, covered by the EU–US Data Privacy Framework and standard contractual clauses.
- **The services you connect** (GitHub, your Dokploy server, Slack, Telegram …) receive what the Service sends them on your instruction, under their own privacy policies.

We do not sell data and do not use it for advertising.

## Your rights

You have the right to access, rectify and erase your data, to restrict or object to processing, and to receive your data in a portable format. Most of it you can change or delete yourself in the Service; for anything else write to {{ legal.email }}. You may also complain to a supervisory authority — in Austria the Datenschutzbehörde (dsb.gv.at).

## Changes

We update this policy when the Service changes; the date at the top shows the current version.

</div>
