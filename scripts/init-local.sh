#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
touch .env
if ! grep -q "^STARTER_DB_PASSWORD=" .env; then
  printf 'STARTER_DB_PASSWORD=%s\n' "${STARTER_DB_PASSWORD:-$(openssl rand -hex 16)}" >> .env
fi
if ! grep -q "^STARTER_ADMIN_PASSWORD=" .env; then
  printf 'STARTER_ADMIN_PASSWORD=%s\n' "${STARTER_ADMIN_PASSWORD:-demo@2026!}" >> .env
fi
