#!/usr/bin/env bash
# install-workspace.sh — copy tokopt-vscode .github/ assets into a target repo
#
# Usage: install-workspace.sh <target-repo-path> [--dry-run]
#
# Copies:
#   .github/agents/*.agent.md  → <target>/.github/agents/
#   .github/skills/*/SKILL.md  → <target>/.github/skills/
#   .github/prompts/*.prompt.md → <target>/.github/prompts/
#
# Merge-safe: existing files in the target are preserved unless they
# share a name with a tokopt-vscode asset (in which case they are
# overwritten — re-run after `git pull` is the update path).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") <target-repo-path> [--dry-run]

Copies tokopt-vscode .github/ assets into the target repo.

Arguments:
  <target-repo-path>   Path to the target repository (must contain .github/)
  --dry-run            Print what would be copied without writing

Example:
  $(basename "$0") ~/work/my-project
  $(basename "$0") ~/work/my-project --dry-run
EOF
}

if [ $# -lt 1 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 1
fi

TARGET="$1"
DRY_RUN=0
if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

if [ ! -d "$TARGET" ]; then
  echo "ERROR: target '$TARGET' does not exist or is not a directory" >&2
  exit 2
fi

if [ ! -d "$TARGET/.github" ]; then
  echo "ERROR: target '$TARGET/.github' does not exist." >&2
  echo "       Create it first with: mkdir -p '$TARGET/.github'" >&2
  exit 3
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY: $*"
  else
    echo "+ $*"
    "$@"
  fi
}

# Copy each asset class — preserve dir structure under .github/
for sub in agents skills prompts; do
  src_dir="$SRC_ROOT/.github/$sub"
  dst_dir="$TARGET/.github/$sub"
  if [ ! -d "$src_dir" ]; then
    echo "WARN: source '$src_dir' missing — skipping"
    continue
  fi
  run mkdir -p "$dst_dir"
  # rsync if available, else cp -r
  if command -v rsync >/dev/null 2>&1; then
    if [ "$DRY_RUN" -eq 1 ]; then
      rsync -av --dry-run --exclude='.gitkeep' "$src_dir/" "$dst_dir/"
    else
      rsync -av --exclude='.gitkeep' "$src_dir/" "$dst_dir/"
    fi
  else
    # Filter out .gitkeep manually
    for item in "$src_dir"/*; do
      base=$(basename "$item")
      [ "$base" = ".gitkeep" ] && continue
      run cp -r "$item" "$dst_dir/"
    done
  fi
done

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] No files were modified. Re-run without --dry-run to apply."
else
  echo "Install complete. Open '$TARGET' in VS Code Insiders and verify:"
  echo "  - Copilot Chat picker (@) shows @token-doctor, @prompt-optimizer"
  echo "  - Slash menu (/) shows /token-audit, /prompt-anatomy, /slim-suggest, /slim-apply"
fi
