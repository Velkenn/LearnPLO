#!/bin/sh
# Build the site with e2e/stub/supabase.js in place of supabase-js, for browser tests of accounts
# (weak spots, the daily challenge) without a network. Uses esbuild directly, so it also works
# where `npm install` can't reach the registry (point ESBUILD at any esbuild binary).
#
#   e2e/stub/build.sh [out dir]      # default e2e/stub/site
#   python3 -m http.server 4174 -d e2e/stub/site &
#   npm run e2e -- "http://localhost:4174/?stub=member" --shots
#   node e2e/daily.mjs "http://localhost:4174/?stub=member" --shots
set -e
cd "$(dirname "$0")/../.."
OUT=${1:-e2e/stub/site}
ES=${ESBUILD:-$(ls node_modules/.bin/esbuild 2>/dev/null || command -v esbuild || echo esbuild)}
ENV='{"VITE_SUPABASE_URL":"https://stub.supabase.co","VITE_SUPABASE_KEY":"stub"}'
rm -rf "$OUT"; mkdir -p "$OUT"
"$ES" src/main.ts --bundle --format=esm --outfile="$OUT/main.js" --define:import.meta.env="$ENV" \
  --alias:@supabase/supabase-js=./e2e/stub/supabase.js --log-level=warning
"$ES" src/styles/main.css --bundle --outfile="$OUT/main.css" --log-level=warning
sed -e 's#\./src/styles/main.css#./main.css#' -e 's#\./src/main.ts#./main.js#' index.html > "$OUT/index.html"
cp -r public/. "$OUT/"
echo "built $OUT"
