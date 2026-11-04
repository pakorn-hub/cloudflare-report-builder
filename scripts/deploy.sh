#!/usr/bin/env bash
# Builds the frontend, runs D1 migrations, and deploys the Worker.
#
# If wrangler.local.toml exists (gitignored — your own real resource IDs,
# see wrangler.local.example.toml), it's used instead of the committed
# wrangler.toml template. This lets a maintainer keep deploying to their own
# already-provisioned D1 database/account without ever committing its ID.
#
# Community users deploying via the "Deploy to Cloudflare" button never hit
# this branch — Cloudflare's button flow auto-provisions resources from the
# committed wrangler.toml directly.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG="wrangler.toml"
if [ -f "wrangler.local.toml" ]; then
  echo "==> Using wrangler.local.toml (local override)"
  CONFIG="wrangler.local.toml"
fi

echo "==> Building frontend"
npm run build

echo "==> Applying D1 migrations"
npx wrangler d1 migrations apply DB --remote --config "$CONFIG"

echo "==> Deploying Worker"
npx wrangler deploy --config "$CONFIG"
