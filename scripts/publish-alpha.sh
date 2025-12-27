#!/bin/bash
# Publish alpha version to verdaccio registry
# Usage: ./scripts/publish-alpha.sh <project-dist-path>
#
# Environment variables:
#   VERDACCIO_REGISTRY - Registry URL (default: https://verdaccio.ngrok.app)
#   ALPHA_TS - Timestamp for alpha version (default: current epoch seconds)

set -euo pipefail

PROJECT_DIST="$1"

if [ -z "$PROJECT_DIST" ]; then
  echo "Error: Project dist path is required"
  echo "Usage: $0 <project-dist-path>"
  exit 1
fi

if [ ! -d "$PROJECT_DIST" ]; then
  echo "Error: Directory not found: $PROJECT_DIST"
  exit 1
fi

if [ ! -f "$PROJECT_DIST/package.json" ]; then
  echo "Error: package.json not found in $PROJECT_DIST"
  exit 1
fi

# Use environment variable or default
REGISTRY="${VERDACCIO_REGISTRY:-https://verdaccio.ngrok.app}"
TIMESTAMP="${ALPHA_TS:-$(date +%s)}"

# Copy .npmrc if it exists
if [ -f ".npmrc.verdaccio" ]; then
  cp .npmrc.verdaccio "$PROJECT_DIST/.npmrc"
fi

# Extract base version (remove any existing prerelease suffix)
BASE_VERSION=$(jq -r '.version' "$PROJECT_DIST/package.json" | sed 's/-.*//')
if [ -z "$BASE_VERSION" ] || [ "$BASE_VERSION" = "null" ]; then
  echo "Error: Could not extract version from package.json"
  exit 1
fi

# Update version in package.json
ALPHA_VERSION="$BASE_VERSION-alpha.$TIMESTAMP"
jq --arg v "$ALPHA_VERSION" '.version=$v' "$PROJECT_DIST/package.json" > "$PROJECT_DIST/package.tmp.json"
mv "$PROJECT_DIST/package.tmp.json" "$PROJECT_DIST/package.json"

echo "Publishing $ALPHA_VERSION to $REGISTRY..."

# Publish
cd "$PROJECT_DIST"
npm publish --access public --tag alpha --registry="$REGISTRY"

echo "Successfully published $ALPHA_VERSION"
