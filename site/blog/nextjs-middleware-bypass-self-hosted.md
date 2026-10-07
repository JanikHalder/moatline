---
title: "CVE-2025-29927: why self-hosted Next.js was affected and Vercel was not"
description: "The Next.js middleware bypass let anyone skip middleware — and the authentication in it — with one request header. Who was affected, which versions fix it, and what it teaches about running Next.js yourself."
date: 2026-10-03
author: Moatline
tags: [nextjs, security, self-hosting, cve]
sidebar: false
faq:
  - q: "Which Next.js versions fix CVE-2025-29927?"
    a: "15.2.3, 14.2.25, 13.5.9 and 12.3.5, and every later release of each line."
  - q: "Was my self-hosted Next.js app affected?"
    a: "If it used middleware for authorization and ran with next start or the standalone output on an affected version, yes. Deployments on Vercel and Netlify were not affected."
  - q: "How can I block the attack without updating?"
    a: "Strip or reject the x-middleware-subrequest request header at the reverse proxy in front of the app. Updating is the real fix."
---

# CVE-2025-29927: the Next.js middleware bypass

<PostMeta />

In March 2025, Next.js published a critical vulnerability: a request carrying
a specific internal header, `x-middleware-subrequest`, made Next.js skip the
middleware entirely. Apps that checked logins in middleware let anyone
through.

## Who was affected

The header was meant for Next.js's own internal requests, to stop middleware
from calling itself in a loop. Nothing stopped a request from outside from
sending it. Affected were apps that:

- used **middleware for authorization** (redirect to login, block paths), and
- ran **self-hosted** — `next start` or the `standalone` output, which is how
  Dokploy, Coolify and most Docker setups run Next.js — on an affected
  version.

Deployments on Vercel and Netlify were not affected: their platforms handle
middleware differently. That is the uncomfortable lesson — the same app was
safe on a managed platform and open on your own server.

## The fix

Update to **15.2.3, 14.2.25, 13.5.9 or 12.3.5** (or later in each line). Until
then, a reverse proxy can strip or reject the `x-middleware-subrequest`
header. And independently of this bug: middleware is a good first check, not
the only one — check authorization again where the data is read.

## What it means for self-hosting

Self-hosting moves a part of security from the platform to you:

- **Advisories that only hit self-hosted setups** need to reach you, with the
  information that you are the affected kind of deployment.
- **The lockfile is the truth**, not `package.json`: a range like `^15.1.0`
  says nothing about what is installed.
- **Framework packages move together.** `next` and its `@next/*` packages
  updated to different versions break builds; update them as one.

## How Moatline does it

Moatline reads the exact versions from the lockfile of every repository,
checks them against the advisory database npm itself uses, and opens a pull
request with the smallest fix — `next` and `@next/*` moved together, checked
by your CI. Merged, it deploys through your platform and watches the live
site, rolling back if the deploy breaks it.
[See how it works](/guide/vulnerabilities).
