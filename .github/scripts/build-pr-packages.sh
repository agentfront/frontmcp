#!/usr/bin/env bash
# Runs inside the container of pr-testing-registry.yml: installs, versions, builds and packs the PR in /work into /packages.
set -euo pipefail

# The runner owns the mounted checkout; Git refuses a repository of another owner unless it's marked safe.
git config --global --add safe.directory /work
corepack enable
yarn install --immutable
npx nx release version "$VERSION" --git-tag=false --git-commit=false
npx nx run-many -t build --parallel=5

FAILED_PACKAGES=()
mapfile -t PUBLISHABLE_PROJECTS < <(npx nx show projects --with-target publish 2>/dev/null)
echo "Found ${#PUBLISHABLE_PROJECTS[@]} publishable packages: ${PUBLISHABLE_PROJECTS[*]}"

for project in "${PUBLISHABLE_PROJECTS[@]}"; do
  if [ -d "libs/$project/dist" ]; then
    DIST_PATH="libs/$project/dist"
  elif [ -d "plugins/$project/dist" ]; then
    DIST_PATH="plugins/$project/dist"
  else
    echo "Warning: No dist folder found for $project"
    continue
  fi

  echo "Packing $DIST_PATH..."
  if ! npm pack "./$DIST_PATH" --pack-destination /packages; then
    echo "Warning: pack failed for $project"
    FAILED_PACKAGES+=("$project")
  fi
done

if [ ${#FAILED_PACKAGES[@]} -gt 0 ]; then
  echo "::warning::Failed to pack: ${FAILED_PACKAGES[*]}"
fi
