#!/usr/bin/env bash
# uninstall.sh — remove only the files installed by install-user.sh
#
# Reads ~/.copilot/.tokopt-vscode-manifest and removes each listed file.
# Empty directories are pruned. Does NOT touch files that aren't in the
# manifest, even if they look like tokopt-vscode assets.

set -euo pipefail

USER_COPILOT="$HOME/.copilot"
MANIFEST="$USER_COPILOT/.tokopt-vscode-manifest"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<EOF
Usage: $(basename "$0") [--dry-run]

Removes only the files listed in $MANIFEST.
Files not in the manifest are left untouched.

Options:
  --dry-run   Print what would be removed without deleting
EOF
  exit 1
fi

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "No manifest found at $MANIFEST — nothing to uninstall." >&2
  exit 0
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY: $*"
  else
    echo "- $*"
    "$@"
  fi
}

removed=0
while IFS= read -r path; do
  # Skip comments / blanks
  [[ "$path" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${path// }" ]] && continue
  if [ -f "$path" ]; then
    run rm -f "$path"
    removed=$((removed + 1))
  fi
done < "$MANIFEST"

# Prune empty skill subdirectories under ~/.copilot/skills/
if [ "$DRY_RUN" -eq 0 ]; then
  find "$USER_COPILOT/skills" -mindepth 1 -type d -empty -delete 2>/dev/null || true
fi

# Remove manifest itself (last) on real run
if [ "$DRY_RUN" -eq 0 ]; then
  rm -f "$MANIFEST"
  echo
  echo "Uninstall complete. Removed $removed files."
else
  echo
  echo "[dry-run] Would remove $removed files."
fi
