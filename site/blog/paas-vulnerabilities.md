---
title: "Is your Dokploy or Coolify vulnerable? Checking the platform itself against its advisories"
description: "The platform that deploys your apps has root on your servers and its own security advisories — dozens of them. How to check the version you run against them, and why the platform is the one component that cannot vouch for itself."
date: 2026-10-04
author: Moatline
tags: [security, dokploy, coolify, portainer]
sidebar: false
faq:
  - q: "Where are security advisories for Dokploy and Coolify published?"
    a: "On GitHub, as repository security advisories of Dokploy/dokploy and coollabsio/coolify. Each lists the affected version range and, when available, the patched version."
  - q: "How do I find the version of Dokploy or Coolify I run?"
    a: "Both show it in their web interface. Coolify also answers through its API at /api/v1/version."
  - q: "Why does the platform's version matter more than an app's?"
    a: "A self-hosted PaaS runs with Docker and usually root access on every server it manages. A vulnerability in it can reach every app and database it deploys."
---

# Is your Dokploy or Coolify vulnerable?

<PostMeta />

You scan your apps' dependencies. You keep the server patched. The piece in
between — the platform that builds, deploys and manages everything — is easy
to forget, and it is the one with the most access: Docker on every server,
your Git tokens, your environment variables, often root.

## These platforms have advisories too

Both projects publish security advisories on GitHub, and there are many: as
of October 2026, about 70 for
[Coolify](https://github.com/coollabsio/coolify/security/advisories) and
about 60 for [Dokploy](https://github.com/Dokploy/dokploy/security/advisories),
several of them rated high or critical — command injection among them. That
is not a reason to avoid them; it is what active projects with researchers
looking at them look like. It is a reason to know which version you run.

## Checking it by hand

1. Find your version: the web interface shows it; Coolify also answers at
   `GET /api/v1/version`.
2. Open the project's advisories and compare your version with each
   advisory's **affected versions** range.
3. If you fall into one, update to the **patched version** or later.

Ranges look like `<= 4.0.0-beta.473` or `>= 0.20.0, < 0.22.5`; pre-release
numbers compare numerically, so `beta.99` is older than `beta.400`.

## Why the platform cannot do this for itself

A platform can tell you that an update is available. It cannot credibly tell
you that it is the vulnerable part — and when an update breaks things, as
[platform upgrades sometimes do](https://github.com/coollabsio/coolify/issues/4218),
people pin old versions and stop looking. The check belongs to something
that watches from outside.

## How Moatline does it

Moatline reads the version of every connected Dokploy, Coolify, Komodo and
Portainer every six hours and checks it against the advisories each project
publishes, with the latest release next to it. An advisory that affects the
version you run is notified once, with the fixed version.
[See how it works](/guide/introduction).
