#!/usr/bin/env bash
# check-csp.test.sh: prove the CSP guard fails on each regression and passes on the real pages.
# Run from the repo root. Bash 3.2 compatible. Prints "PASS X/Y".

set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
GUARD="$REPO/scripts/check-csp.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PASS=0
TOTAL=0

fresh() {
  rm -rf "$WORK/site"
  mkdir -p "$WORK/site/es"
  cp "$REPO/index.html" "$WORK/site/index.html"
  cp "$REPO/es/index.html" "$WORK/site/es/index.html"
}

# mutate FILE SED_EXPRESSION
mutate() {
  sed -E "$2" "$WORK/site/$1" > "$WORK/tmp.html"
  mv "$WORK/tmp.html" "$WORK/site/$1"
}

# rehash FILE: put the real hash of the single-line inline script back into the policy,
# so a mutation that changes the script is judged on its own reason and not on the hash.
rehash() {
  local body hash
  body=$(sed -n 's#.*<script>\(.*\)</script>.*#\1#p' "$WORK/site/$1" | head -n 1)
  hash=$(printf '%s' "$body" | openssl dgst -sha256 -binary | openssl base64 -A)
  mutate "$1" "s#sha256-[A-Za-z0-9+/=]+#sha256-$hash#"
}

# expect NAME WANT_EXIT [REASON_SUBSTRING]
expect() {
  local name="$1" want="$2" reason="${3:-}" got
  TOTAL=$((TOTAL + 1))
  bash "$GUARD" "$WORK/site" > "$WORK/out.txt" 2>&1
  got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FAIL: $name (exit $got, wanted $want)"
    cat "$WORK/out.txt"
  elif [ -n "$reason" ] && ! grep -Fq "$reason" "$WORK/out.txt"; then
    echo "FAIL: $name (output lacks \"$reason\")"
    cat "$WORK/out.txt"
  else
    PASS=$((PASS + 1))
  fi
}

fresh
expect "unmodified copy passes" 0 "csp: ok"

fresh; mutate index.html '/http-equiv="Content-Security-Policy"/d'
expect "CSP meta removed" 1 "expected exactly 1 Content-Security-Policy meta"

fresh; mutate es/index.html 's/latifi\.lang/latifi.lanG/'
expect "inline script altered, hash stale" 1 "is not in script-src"

fresh; mutate index.html 's#<h1 id="hero-title">#<h1 id="hero-title" style="color:red">#'
expect "style attribute added" 1 "style attribute found"

fresh; mutate es/index.html 's#<h1 id="hero-title">#<h1 id="hero-title" onclick="go()">#'
expect "inline handler added" 1 "inline event handler attribute found"

fresh; mutate index.html 's#</head>#<style>a{color:red}</style></head>#'
expect "style element added" 1 "style element found"

fresh; mutate es/index.html 's#<a class="logo" href="index.html"#<a class="logo" href="javascript:void(0)"#'
expect "javascript href added" 1 "javascript scheme"

fresh
PAD=$(printf 'x%.0s' $(seq 1 200))
mutate index.html "s#catch\\(e\\)\\{\\}</script>#catch(e){}/*$PAD*/</script>#"
rehash index.html
expect "inline script padded past 400 bytes" 1 "inline script is"

echo "PASS $PASS/$TOTAL"
[ "$PASS" -eq "$TOTAL" ]
