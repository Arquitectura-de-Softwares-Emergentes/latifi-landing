#!/usr/bin/env bash
# check-i18n-a11y.sh: guard the i18n and ARIA structure of every HTML file (TC-07).
# Usage: bash scripts/check-i18n-a11y.sh [ROOT]
# ROOT defaults to the current directory. Bash 3.2 compatible.
#
# Each HTML file must have:
#   - a lang attribute on the html element with a value of en, en-US or es-419
#   - exactly one main element
#   - a skip link whose href is #main, and an element with id="main"
#   - a non-empty title
#   - link rel="alternate" entries with hreflang en, es-419 and x-default
# Failures print as "file: reason". Success prints "i18n-a11y: ok".

set -u

ROOT="${1:-.}"
FAILURES=0
FILES=0

fail() {
  echo "$1: $2"
  FAILURES=$((FAILURES + 1))
}

check_file() {
  local file="$1"
  local flat lang count tag h

  # Flatten so attributes split over several lines still match.
  flat=$(tr '\n\r\t' '   ' < "$file")

  # lang attribute on the html element
  tag=$(printf '%s' "$flat" | grep -Eio '<html[^>]*>' | head -n 1)
  lang=$(printf '%s' "$tag" | grep -Eio '[[:space:]]lang="[^"]*"' | head -n 1 | sed -E 's/^.*lang="([^"]*)"$/\1/I')
  if [ -z "$lang" ]; then
    fail "$file" "html element has no lang attribute"
  else
    case "$lang" in
      en | en-US | es-419) ;;
      *) fail "$file" "lang \"$lang\" is not one of en, en-US, es-419" ;;
    esac
  fi

  # exactly one main element
  count=$(printf '%s' "$flat" | grep -Eio '<main([[:space:]>/])' | wc -l | tr -d ' ')
  if [ "$count" -ne 1 ]; then
    fail "$file" "expected exactly 1 main element, found $count"
  fi

  # skip link and its target
  if ! printf '%s' "$flat" | grep -Eio '<a[^>]*href="#main"[^>]*>' | grep -q .; then
    fail "$file" "no skip link with href=\"#main\""
  fi
  if ! printf '%s' "$flat" | grep -Eio '<[a-z0-9]+[^>]*[[:space:]]id="main"[^>]*>' | grep -q .; then
    fail "$file" "no element with id=\"main\""
  fi

  # non-empty title
  if ! printf '%s' "$flat" | grep -Eiq '<title>[[:space:]]*[^[:space:]<][^<]*</title>'; then
    fail "$file" "title is missing or empty"
  fi

  # hreflang alternates
  for h in en es-419 x-default; do
    if ! printf '%s' "$flat" | grep -Eio '<link[^>]*>' | grep -i 'rel="alternate"' | grep -iq "hreflang=\"$h\""; then
      fail "$file" "missing link rel=\"alternate\" hreflang=\"$h\""
    fi
  done
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  FILES=$((FILES + 1))
  check_file "$f"
done <<EOT
$(find "$ROOT" -name '*.html' -not -path '*/node_modules/*' -not -path '*/.git/*' | sort)
EOT

if [ "$FILES" -eq 0 ]; then
  echo "$ROOT: no HTML files found"
  exit 1
fi

if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi

echo "i18n-a11y: ok"
