---
title: "Backups that stopped weeks ago: how to know your Dokploy and Coolify backups actually ran"
description: "Scheduled backups on self-hosted platforms can stop without a notification. Why it happens, what 'backup succeeded' does not tell you, and a dead man's switch that tells you when a backup did not run."
date: 2026-10-05
author: Moatline
tags: [backups, dokploy, coolify, monitoring]
sidebar: false
faq:
  - q: "Do Dokploy and Coolify notify me when a backup fails?"
    a: "Both can send notifications for failed backups. A backup that never starts — a stopped schedule, a broken cron, a server that was down at the time — produces no failure, so there is nothing to notify about."
  - q: "What is a dead man's switch for backups?"
    a: "The backup job calls a URL after every successful run. A monitor outside the server expects that call on schedule and raises an alarm when it does not arrive. Silence becomes the signal."
  - q: "Is a successful backup a restorable backup?"
    a: "Not necessarily. Watch the size of each backup against the previous ones — a backup that suddenly shrinks or is empty is the most common sign that it no longer contains the data — and restore one into a scratch database now and then."
---

# Backups that stopped weeks ago

<PostMeta />

"Automatic backups stopped working with no notification at all" is the title
of [a Dokploy issue](https://github.com/Dokploy/dokploy/issues/1359), and it
describes the most expensive kind of failure there is: the one you find out
about when you need the backup. Coolify recently added
[alerts for backups that are missing](https://github.com/coollabsio/coolify/pull/11433)
for the same reason.

## Why "no error" is not "it worked"

Platforms notify about **failed** runs. Many backup problems are not
failures:

- the schedule was changed or disabled during a migration
- the database moved to another node the backup job does not reach
- the server was down or rebooting at the scheduled minute
- the job runs, but writes an empty dump because a credential changed

In each case nothing fails loudly. The dashboard shows the last successful
run, and nobody looks at the date.

## The dead man's switch

Turn the question around. Instead of waiting for an error, expect a signal:

1. The backup job calls a URL **after** a successful run:
   ```bash
   pg_dump "$DATABASE_URL" | gzip > /backups/db-$(date +%F).sql.gz \
     && curl -fsS -m 10 --retry 3 https://example.com/ping/<token>
   ```
2. A monitor that does **not** run on the same server knows the schedule —
   daily, with an hour of grace.
3. If the call does not arrive in time, it raises an alarm. If the job
   reports a failure (`/fail`), it raises one at once.

The monitor has to live elsewhere: a watcher on the same server stops
watching exactly when the server has a problem.

## What else to watch

- **Size against the previous runs.** A dump that is suddenly a tenth of its
  usual size usually means it no longer contains the data.
- **Where it went.** A backup on the same disk as the database is not a
  backup of the server.
- **A restore, now and then.** Restore the newest dump into a scratch
  database and count rows in two or three tables.

## How Moatline does it

Moatline checks that every database on Dokploy and Coolify has a scheduled
backup, that the last one did not fail and is not older than a week. Under
**Monitoring → Jobs**, any job — a backup script, a cleanup, an import —
gets a URL to call after it ran; silence beyond its period plus grace is
reported as missed, checked every minute from outside your servers.
[See pricing](/pricing).
