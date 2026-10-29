#!/usr/bin/env bash
# check-i18n-a11y.test.sh: prove the guard fails on each regression and passes on the real pages.
# Run from the repo root. Bash 3.2 compatible. Prints "PASS X/Y".

set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
GUARD="$REPO/scripts/check-i18n-a11y.sh"
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

expect() {
  local name="$1" want="$2" got
  TOTAL=$((TOTAL + 1))
  bash "$GUARD" "$WORK/site" > "$WORK/out.txt" 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (exit $got, wanted $want)"
    cat "$WORK/out.txt"
  fi
}

fresh
expect "unmodified copy passes" 0

fresh; mutate index.html 's/<html lang="en">/<html>/'
expect "missing lang" 1

fresh; mutate es/index.html 's/<html lang="es-419">/<html lang="fr">/'
expect "unsupported lang" 1

fresh; mutate index.html 's#</body>#<main></main></body>#'
expect "second main" 1

fresh; mutate index.html 's/href="#main"/href="#top"/'
expect "skip link removed" 1

fresh; mutate index.html 's/ id="main"//'
expect "main id removed" 1

fresh; mutate es/index.html 's#<title>[^<]*</title>#<title> </title>#'
expect "empty title" 1

fresh; mutate index.html '/hreflang="es-419" href="es\/index.html"/d'
expect "es-419 hreflang removed" 1

fresh; mutate es/index.html '/hreflang="x-default"/d'
expect "x-default hreflang removed" 1

echo "PASS $PASS/$TOTAL"
[ "$PASS" -eq "$TOTAL" ]
