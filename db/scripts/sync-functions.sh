#!/usr/bin/env bash
# sync-functions.sh - copy the edge function SOURCES into the local stack's own Supabase workdir, so the local Edge Runtime serves them.
#
#   bash db/scripts/sync-functions.sh            # copy (idempotent; run it again after every edit: `functions serve` hot-reloads the copy)
#   bash db/scripts/sync-functions.sh --dry-run  # show what would be copied / removed, change nothing
#   bash db/scripts/sync-functions.sh --list     # list the functions that are in the stack workdir now
#
# From   supabase-new/functions/*            (the real functions + _shared; tests, *.md and *.sql files are NOT copied)
#        db/scripts/dev-functions/*          (local-only helpers such as hello-world: they are never deployed)
# To     local-db/stack/supabase/functions/  (git-ignored; the stack's OWN workdir; the repo's supabase/ folder is never touched)
#
# It also writes the per-function JWT policy into local-db/stack/supabase/config.toml between two marker lines
# (`verify_jwt = false` only for the functions that are called without a Supabase login: the Google redirect, a webhook).
# Everything outside the markers is left alone. Nothing is deployed anywhere; no network call is made.
set -euo pipefail
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/supabase-new/functions"
DEV_SRC="$ROOT/db/scripts/dev-functions"
STACK_SUPABASE="$ROOT/local-db/stack/supabase"
DEST="$STACK_SUPABASE/functions"
CONFIG="$STACK_SUPABASE/config.toml"
MANIFEST="$DEST/.athar-synced"
BEGIN_MARK='# >>> athar-functions (managed by db/scripts/sync-functions.sh; edit the list there, not between these lines)'
END_MARK='# <<< athar-functions'

# Functions that must be callable WITHOUT a Supabase login (everything else keeps the default: the gateway verifies the JWT).
#   google-oauth-callback : Google redirects the browser here; the signed single-use `state` is its protection (design 10)
#   image-convert         : a Database Webhook authenticated by IMAGE_CONVERT_SECRET (its own README)
#   email-worker          : called by pg_cron / pg_net (and scripts), not by a user; it checks EMAIL_WORKER_SECRET itself and is closed without it (m62)
NO_VERIFY_JWT="google-oauth-callback image-convert email-worker"

mode="sync"
case "${1:-}" in
  "") ;;
  --dry-run) mode="dry" ;;
  --list) mode="list" ;;
  -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
  *) echo "unknown option: $1 (use --dry-run, --list or --help)" >&2; exit 2 ;;
esac

# ---- safety: the destination must be the stack's own workdir, never the repo's supabase/ folder ------------------------------
case "$DEST" in
  "$ROOT/local-db/stack/supabase/functions") ;;
  *) echo "refusing: unexpected destination $DEST" >&2; exit 2 ;;
esac
if [ ! -f "$CONFIG" ]; then
  echo "local-db/stack/supabase/config.toml not found: is the local stack folder in place? (see local-db/README.md)" >&2
  exit 1
fi

if [ "$mode" = "list" ]; then
  if [ ! -d "$DEST" ]; then echo "(no functions folder yet: run the sync)"; exit 0; fi
  for d in "$DEST"/*/; do [ -d "$d" ] && basename "$d"; done
  exit 0
fi

# top-level entries to copy: every directory of the two sources
names_of() { local dir="$1"; [ -d "$dir" ] || return 0; for d in "$dir"/*/; do [ -d "$d" ] && basename "$d"; done; return 0; }
declare -A origin=()
for n in $(names_of "$SRC"); do origin["$n"]="$SRC"; done
for n in $(names_of "$DEV_SRC"); do
  if [ -n "${origin[$n]:-}" ]; then echo "name clash: $n exists in supabase-new/functions and in db/scripts/dev-functions" >&2; exit 1; fi
  origin["$n"]="$DEV_SRC"
done
if [ "${#origin[@]}" -eq 0 ]; then echo "no function folders found under $SRC" >&2; exit 1; fi
# every function folder needs an entry point (the shared folder _shared is a library, not a function)
for n in "${!origin[@]}"; do
  case "$n" in _*) continue ;; esac
  if [ ! -f "${origin[$n]}/$n/index.ts" ] && [ ! -f "${origin[$n]}/$n/index.js" ]; then
    echo "warning: $n has no index.ts / index.js, it will be copied but cannot be served" >&2
  fi
done

if [ "$mode" = "dry" ]; then
  echo "would copy into $DEST :"
  for n in $(printf '%s\n' "${!origin[@]}" | sort); do echo "  $n   (from ${origin[$n]#$ROOT/})"; done
  if [ -f "$MANIFEST" ]; then echo "would first remove the previously synced entries: $(tr '\n' ' ' < "$MANIFEST")"; fi
  echo "would set verify_jwt = false for: $NO_VERIFY_JWT (only those that exist)"
  exit 0
fi

mkdir -p "$DEST"

# ---- remove what the previous sync put there (so a deleted / renamed source disappears), then copy fresh ----------------------
if [ -f "$MANIFEST" ]; then
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    case "$old" in */*|.*|"") continue ;; esac     # a manifest line is a plain folder name, never a path
    rm -rf "${DEST:?}/$old"
  done < "$MANIFEST"
fi

: > "$MANIFEST.tmp"
for n in $(printf '%s\n' "${!origin[@]}" | sort); do
  src_dir="${origin[$n]}/$n"
  mkdir -p "$DEST/$n"
  tar -C "$src_dir" --exclude='tests' --exclude='*.md' --exclude='*.sql' --exclude='node_modules' --exclude='.DS_Store' -cf - . | tar -C "$DEST/$n" -xf -
  echo "$n" >> "$MANIFEST.tmp"
done
mv "$MANIFEST.tmp" "$MANIFEST"

# ---- per-function JWT policy in the stack's config.toml (idempotent block between two marker lines) -----------------------------
block="$BEGIN_MARK"$'\n'
for n in $NO_VERIFY_JWT; do
  if [ -n "${origin[$n]:-}" ]; then block+="[functions.$n]"$'\n'"verify_jwt = false"$'\n'; fi
done
block+="$END_MARK"
tmp="$CONFIG.tmp.$$"
if grep -qF "$BEGIN_MARK" "$CONFIG"; then
  # replace the old block
  awk -v b="$BEGIN_MARK" -v e="$END_MARK" -v blk="$block" '
    index($0, b) == 1 { print blk; skip = 1; next }
    skip && index($0, e) == 1 { skip = 0; next }
    !skip { print }
  ' "$CONFIG" > "$tmp"
else
  { cat "$CONFIG"; printf '\n%s\n' "$block"; } > "$tmp"
fi
if ! cmp -s "$tmp" "$CONFIG"; then mv "$tmp" "$CONFIG"; echo "config.toml: function JWT policy updated"; else rm -f "$tmp"; fi

echo "synced $(wc -l < "$MANIFEST" | tr -d ' ') entries into local-db/stack/supabase/functions:"
for n in $(sort "$MANIFEST"); do
  files=$(find "$DEST/$n" -type f | wc -l | tr -d ' ')
  jwt="verify_jwt"; case " $NO_VERIFY_JWT " in *" $n "*) jwt="NO jwt check" ;; esac
  case "$n" in _*) jwt="(library)" ;; esac
  printf '  %-24s %3s files   %s   (from %s)\n' "$n" "$files" "$jwt" "${origin[$n]#$ROOT/}"
done
echo "If the functions are being served (db/scripts/dev-functions.sh up) they reload by themselves."
