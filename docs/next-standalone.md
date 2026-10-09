# Fix: Next.js standalone for smaller Dokploy images

Moatline flagged this repository because it depends on **Next.js** but does not
use `output: 'standalone'`. On shared Hetzner hosts that often means
**1.5–3 GB per app image**. With ~20 sites the root disk hits 90 %+ even when
the Docker build cache is empty.

House standard (also in [payload-skills `docker-standalone`](https://github.com/morgendigital/payload-skills/tree/main/docker-standalone)): enable standalone, point the start command at the standalone server (Railpack) or copy it in a multi-stage Dockerfile.

## 1. Enable standalone

In `next.config.ts` / `next.config.mjs` / `next.config.js`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // …existing options
};

export default nextConfig;
```

## 2a. Railpack / Nixpacks (Dokploy build type Railpack)

Change the start script (or set `RAILPACK_START_CMD` in Dokploy):

```json
{
  "scripts": {
    "build": "next build",
    "start": "cross-env NODE_OPTIONS=\"--no-deprecation $NODE_OPTIONS\" node .next/standalone/server.js"
  }
}
```

Monorepo — check the path after one local build (`ls .next/standalone`):

```json
"start": "node .next/standalone/apps/web/server.js"
```

In Dokploy environment:

- `HOSTNAME=0.0.0.0`
- Port `3000`

Without `HOSTNAME=0.0.0.0` the process may listen only on localhost and Traefik reports the app down.

## 2b. Dockerfile (smallest images)

Dokploy build type **Dockerfile**. Runner stage only needs standalone + static + public:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm i --frozen-lockfile
COPY . .
RUN corepack enable && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

Add a `.dockerignore` with `node_modules`, `.next`, `.git`.

## 3. Verify

```bash
pnpm build
# Railpack path:
node .next/standalone/server.js
# Or after docker build:
docker images   # unique size should drop well below ~1 GB for a typical Payload site
```

## 4. Do not

- Do not replace `NODE_OPTIONS` in `start` — append (`$NODE_OPTIONS`), see payload-skills `memory-limit`.
- Do not put media uploads in the image — use S3/R2.
- Do not run `docker volume prune` blindly on production (databases live there).

## Done when

- [ ] `output: 'standalone'` is in next.config
- [ ] Start uses `node .next/standalone/…/server.js` **or** the Dockerfile copies `.next/standalone`
- [ ] `HOSTNAME=0.0.0.0` is set for Railpack deploys
- [ ] Moatline scan no longer lists this finding
