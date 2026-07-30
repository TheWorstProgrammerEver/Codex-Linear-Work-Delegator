#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

output_dir="${1:-}"
treeish="${2:-}"
if [[ -z "$output_dir" || "$output_dir" != /* || -e "$output_dir" ]]; then
  printf 'Usage: scripts/build-reviewed-release.sh NEW_ABSOLUTE_OUTPUT_DIR [TREEISH]\n' >&2
  exit 64
fi

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_dir="$(dirname -- "$script_dir")"
repo_root="$(git -C "$source_dir" rev-parse --show-toplevel)"
source_relative="$(realpath --relative-to="$repo_root" "$source_dir")"
if [[ "$source_relative" == .. || "$source_relative" == ../* || "$source_relative" == /* ]]; then
  printf 'Source package is outside its Git worktree.\n' >&2
  exit 78
fi
if [[ -z "$treeish" ]]; then
  treeish="$(git -C "$repo_root" rev-parse --verify HEAD)"
fi
git -C "$repo_root" cat-file -e "$treeish^{tree}"

archive_tree="$treeish"
if [[ "$source_relative" != "." ]]; then
  archive_tree="$treeish:$source_relative"
fi

mkdir -m 0700 -- "$output_dir"
git -C "$repo_root" archive --format=tar "$archive_tree" \
  | tar --extract --file=- --directory="$output_dir"
(
  cd -- "$output_dir"
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
)
