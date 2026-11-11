#!/usr/bin/env bash
# check-csp.sh: guard the Content-Security-Policy and the inline-code rules of every HTML file.
# Usage: bash scripts/check-csp.sh [ROOT]
# ROOT defaults to the current directory. Bash 3.2 compatible. Needs openssl and perl.
#
# Each HTML file must have:
#   - exactly one meta http-equiv="Content-Security-Policy"
#   - a policy that contains default-src 'none', object-src 'none' and base-uri 'none'
#   - for every inline script (no src, not a JSON data block): its sha256 inside script-src,
#     and a body shorter than MAX_INLINE_BYTES (default 400)
#   - no style element, no style attribute, no inline event handler attribute
#     and no href that starts with the javascript scheme
# Failures print as "file: reason". Success prints "csp: ok".

set -u

ROOT="${1:-.}"
MAX_INLINE_BYTES="${MAX_INLINE_BYTES:-400}"
FAILURES=0
FILES=0

fail() {
  echo "$1: $2"
  FAILURES=$((FAILURES + 1))
}

# Bodies of the inline scripts of a file, each followed by a NUL byte, exact bytes.
inline_bodies() {
  perl -0777 -ne '
    while (/<script\b([^>]*)>(.*?)<\/script\s*>/sgi) {
      my ($attrs, $body) = ($1, $2);
      next if $attrs =~ /\bsrc\s*=/i;
      next if $attrs =~ /\btype\s*=\s*["\x27]?application\/(ld\+)?json/i;
      print $body, "\0";
    }
  ' "$1"
}

check_file() {
  local file="$1"
  local flat meta count policy directive scriptsrc body bytes hash

  # Flatten so tags split over several lines still match. Script bodies are read from the file itself.
  flat=$(tr '\n\r\t' '   ' < "$file")

  # exactly one CSP meta
  meta=$(printf '%s' "$flat" | grep -Eio '<meta[^>]*http-equiv="?Content-Security-Policy"?[^>]*>')
  count=$(printf '%s' "$meta" | grep -c . || true)
  if [ "$count" -ne 1 ]; then
    fail "$file" "expected exactly 1 Content-Security-Policy meta, found $count"
    meta=$(printf '%s' "$meta" | head -n 1)
  fi

  policy=""
  if [ -n "$meta" ]; then
    policy=$(printf '%s' "$meta" | sed -nE 's/.*[[:space:]]content="([^"]*)".*/\1/p')
  fi

  if [ -n "$meta" ]; then
    for directive in "default-src 'none'" "object-src 'none'" "base-uri 'none'"; do
      case "$policy" in
        *"$directive"*) ;;
        *) fail "$file" "policy lacks $directive" ;;
      esac
    done
  fi

  scriptsrc=$(printf '%s' "$policy" | tr ';' '\n' | sed -E 's/^[[:space:]]+//' | grep -E '^script-src([[:space:]]|$)' | head -n 1 || true)

  # inline scripts: hash listed in script-src, body under the size cap
  while IFS= read -r -d '' body; do
    bytes=$(printf '%s' "$body" | wc -c | tr -d ' ')
    if [ "$bytes" -ge "$MAX_INLINE_BYTES" ]; then
      fail "$file" "inline script is $bytes bytes, limit is under $MAX_INLINE_BYTES"
    fi
    hash=$(printf '%s' "$body" | openssl dgst -sha256 -binary | openssl base64 -A)
    case "$scriptsrc" in
      *"'sha256-$hash'"*) ;;
      *) fail "$file" "inline script hash 'sha256-$hash' is not in script-src" ;;
    esac
  done < <(inline_bodies "$file")

  if printf '%s' "$flat" | grep -Eiq '<style([[:space:]>/])'; then
    fail "$file" "style element found (style-src is self only)"
  fi
  if printf '%s' "$flat" | grep -Eiq '<[a-z][^>]*[[:space:]"'"'"']style[[:space:]]*='; then
    fail "$file" "style attribute found"
  fi
  if printf '%s' "$flat" | grep -Eiq '<[a-z][^>]*[[:space:]"'"'"']on[a-z]+[[:space:]]*='; then
    fail "$file" "inline event handler attribute found"
  fi
  if printf '%s' "$flat" | grep -Eiq 'href[[:space:]]*=[[:space:]]*["'"'"']?[[:space:]]*javascript:'; then
    fail "$file" "href with the javascript scheme found"
  fi
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  FILES=$((FILES + 1))
  check_file "$f"
done <<EOT
$(find "$ROOT" -name '*.html' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/_site/*' | sort)
EOT

if [ "$FILES" -eq 0 ]; then
  echo "$ROOT: no HTML files found"
  exit 1
fi

if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi

echo "csp: ok"
