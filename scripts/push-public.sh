#!/usr/bin/env bash
# Push the current branch tip to the public remote (origin → moatline).
# Day-to-day WIP should go to the private "dev" remote instead.
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git branch --show-current)
remote=${1:-origin}
target=${2:-main}

if [[ "$remote" != "origin" ]]; then
  echo "This script is for the public remote (origin). Got: $remote" >&2
  exit 1
fi

echo "About to: git push $remote HEAD:$target"
echo "  from branch: $branch"
echo "  public repo: $(git remote get-url origin)"
echo
read -r -p "Continue? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || exit 0

git push "$remote" "HEAD:$target"
echo "Pushed HEAD → $remote:$target"
