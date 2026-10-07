#!/bin/sh
# Abort the container if migrations fail instead of serving an API against a
# database that is missing tables.
set -e
cd /app
pnpm --filter db migrate
exec node apps/api/dist/index.js
