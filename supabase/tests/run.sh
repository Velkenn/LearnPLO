#!/usr/bin/env bash
# Runs the SQL tests on a throwaway local Postgres (16 or newer): loads stub_supabase.sql, every
# migration in order, then each *_test.sql. Nothing touches the real Supabase project.
#   bash supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$bin/initdb" ] || bin="$(dirname "$(command -v initdb)")"

tmp="$(mktemp -d)"
port=$((20000 + RANDOM % 20000))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

# initdb refuses to run as root, so use a plain user when we are root.
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$tmp"

run "'$bin/initdb' -D '$tmp/data' -U postgres -A trust >/dev/null"
run "'$bin/pg_ctl' -D '$tmp/data' -o '-p $port -k $tmp -c listen_addresses=' -l '$tmp/log' -w start >/dev/null"

psql=(psql -h "$tmp" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${psql[@]}" -f "$here/stub_supabase.sql" >/dev/null
for f in "$root"/supabase/migrations/*.sql; do
  "${psql[@]}" -f "$f" >/dev/null
done
for t in "$here"/*_test.sql; do
  "${psql[@]}" -f "$t" 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //" | grep -vE "^$|^[0-9a-f-]{36}$"
done
