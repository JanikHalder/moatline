---
title: "Why a renamed Payload field can delete your data — and how to catch it in the pull request"
description: "Payload's Postgres adapter turns schema changes into Drizzle migrations. A renamed field or collection can become DROP COLUMN or DROP TABLE. How it happens, the two setup mistakes behind most incidents, and how to catch destructive migrations before they run."
date: 2026-10-06
author: Moatline
tags: [payload, postgres, migrations, nextjs]
sidebar: false
faq:
  - q: "Does renaming a field in Payload delete its data?"
    a: "It can. Payload's Postgres and SQLite adapters generate migrations with Drizzle. If the migration is generated as a new column plus a dropped old one instead of a rename, the old column's values are gone once the migration runs."
  - q: "Should push be enabled in production?"
    a: "No. push changes the database schema directly without a migration. Payload enables it in development only; a literal push: true in the adapter config also pushes in production, where a renamed field can drop its column."
  - q: "How do I make sure Payload migrations run in production?"
    a: "Either set prodMigrations on the database adapter so migrations run when Payload starts, or run payload migrate before next start in your start command or Dockerfile."
---

# Why a renamed Payload field can delete your data

<PostMeta />

Payload 3 stores content in Postgres or SQLite through Drizzle. Every change
to a collection — a new field, a renamed one, a removed block — becomes a
change to tables and columns. Payload gives you two ways to apply it:
**push** and **migrations**. Both work. Both can also take data with them
when nobody looks at what they are about to do.

## What actually happens on a rename

To the database, a rename is ambiguous. `subtitle` disappeared from the
config and `teaser` appeared. Either the field was renamed — the column
should be renamed and keep its values — or one field was removed and an
unrelated one added.

Drizzle asks this question when it generates a migration. Answered as
"rename", the migration contains `ALTER TABLE … RENAME COLUMN`. Answered the
other way — or generated somewhere that never asked — it contains:

```sql
ALTER TABLE "posts" ADD COLUMN "teaser" varchar;
ALTER TABLE "posts" DROP COLUMN "subtitle";
```

That migration runs fine. The site deploys, the new field is empty, and the
old values are gone. The same goes for a renamed **collection**: its table is
dropped and a new one created, with every row and every relation in it.

## The two setup mistakes behind most incidents

**1. `push: true` in production.** Push applies the schema straight to the
database, without a migration file anyone could review. Payload enables it in
development by default and leaves it off in production — unless the adapter
says `push: true` literally:

```ts
db: postgresAdapter({
  pool: { connectionString: process.env.DATABASE_URI },
  push: true, // pushes in production too
}),
```

Remove the line, or make it explicit: `push: process.env.NODE_ENV !== "production"`.

**2. Migrations that nothing runs.** The migrations are in `src/migrations`,
but the production start command is `next start`. The new code meets the old
schema and fails — or someone runs push to "fix" it. Run them on start:

```ts
import { migrations } from "./migrations";

db: postgresAdapter({
  pool: { connectionString: process.env.DATABASE_URI },
  prodMigrations: migrations,
}),
```

or run `payload migrate && next start` (or the same in the Dockerfile's
`CMD`).

## Catching destructive migrations before they run

The place to catch a dropped column is the pull request that adds the
migration — before it is merged, and certainly before it is deployed. Look
at the `up` function of every new migration (its `down` drops what `up`
created, which is expected) for:

- `DROP TABLE` and `DROP COLUMN` — data is gone after the deploy
- `TRUNCATE` and `DELETE FROM` without `WHERE` — every row is gone
- `ALTER COLUMN … TYPE` — fails on, or cuts, values the new type cannot hold
- `ALTER COLUMN … SET NOT NULL` — fails the migration (and the deploy) if a
  row has no value yet

If one of these is intended, take a backup first. If it is a rename in
disguise, change the migration to `RENAME COLUMN` / `RENAME TO` before
merging.

## How Moatline does it

Moatline reads the migrations of every open pull request and of every commit
that is merged but not deployed yet, for Payload, Prisma and Drizzle
projects. A migration that drops, truncates or empties a table is reported
once per change set, with the file and line, before anything runs. It also
flags `push: true` in the Payload adapter, migrations that nothing runs in
production, and `prisma db push` or `drizzle-kit push` in start or build
scripts. [See how it works](/guide/introduction).
