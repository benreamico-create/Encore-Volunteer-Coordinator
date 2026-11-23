#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Encore uses the additive SQL phase files, not the empty Drizzle schema.
# Apply them only to development; production changes go through Publish.
pnpm --filter @workspace/api-server run db:setup:dev
