#!/usr/bin/env bash
# One-shot build + run: builds the React client and starts the Node server
# which serves both the API and the UI on http://localhost:4000
set -e
cd "$(dirname "$0")"

echo "==> Installing server deps"
(cd server && npm install)

echo "==> Installing client deps & building UI"
(cd client && npm install && npm run build)

echo "==> Seeding demo data (admin / admin123) — comment out to skip"
(cd server && npm run seed)

echo "==> Starting server on http://localhost:4000"
cd server && npm start
