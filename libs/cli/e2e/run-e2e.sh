#!/bin/bash
set -e

# E2E Test Script for FrontMCP CLI
# This script:
# 1. Starts a local Verdaccio registry
# 2. Builds and publishes all @frontmcp packages
# 3. Runs E2E tests using the local registry
# 4. Cleans up

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
E2E_DIR="$SCRIPT_DIR"
VERDACCIO_PORT=14873
VERDACCIO_URL="http://localhost:$VERDACCIO_PORT"
TEST_DIR=$(mktemp -d)
VERDACCIO_PID=""

# Detect Docker availability and registry host for Docker-in-Docker access
DOCKER_AVAILABLE=false
DOCKER_REGISTRY_HOST="host.docker.internal"
if DOCKER_INFO_OUTPUT=$(docker info 2>/dev/null); then
  DOCKER_AVAILABLE=true
  # On Linux (non-Docker-Desktop), use bridge gateway
  if [ "$(uname)" = "Linux" ] && ! echo "$DOCKER_INFO_OUTPUT" | grep -q "Desktop"; then
    DOCKER_REGISTRY_HOST="172.17.0.1"
  fi
fi

cleanup() {
  echo "🧹 Cleaning up..."
  if [ -n "$VERDACCIO_PID" ]; then
    kill "$VERDACCIO_PID" 2>/dev/null || true
  fi
  # Remove Docker images created during E2E tests
  if [ "$DOCKER_AVAILABLE" = "true" ]; then
    for img_pattern in "test-npm-docker*" "test-yarn-docker*"; do
      docker images -q "$img_pattern" 2>/dev/null | xargs -r docker rmi 2>/dev/null || true
    done
  fi
  rm -rf "$TEST_DIR"
  rm -rf "$E2E_DIR/storage"
  rm -f "$ROOT_DIR/.npmrc.e2e"
  echo "✅ Cleanup complete"
}

# Patch a Dockerfile to also copy registry config so Docker build can reach Verdaccio
patch_dockerfile_for_registry() {
  local dockerfile="$1"
  local config_file="$2"  # .npmrc or .yarnrc
  # Insert COPY for registry config before each lockfile COPY line (portable sed)
  sed -i.bak "s|^COPY package|COPY ${config_file}* ./\\
COPY package|" "$dockerfile"
  rm -f "${dockerfile}.bak"
  # Verify the patch was applied
  if ! grep -qF "COPY ${config_file}" "$dockerfile"; then
    echo "patch_dockerfile_for_registry: no COPY package line found in $dockerfile"
    return 1
  fi
}

trap cleanup EXIT

echo "📦 FrontMCP CLI E2E Tests"
echo "=========================="
echo ""

# Check if verdaccio is installed
if ! command -v verdaccio &> /dev/null; then
  echo "⚠️  Verdaccio not found. Installing..."
  npm install -g verdaccio
fi

# Start Verdaccio
echo "🚀 Starting Verdaccio on port $VERDACCIO_PORT..."
cd "$E2E_DIR"
verdaccio --config verdaccio.config.yaml --listen $VERDACCIO_PORT &
VERDACCIO_PID=$!

# Wait for Verdaccio to start
echo "⏳ Waiting for Verdaccio to start..."
for i in {1..30}; do
  if curl -s "$VERDACCIO_URL" > /dev/null 2>&1; then
    echo "✅ Verdaccio is running"
    break
  fi
  sleep 1
done

if ! curl -s "$VERDACCIO_URL" > /dev/null 2>&1; then
  echo "❌ Failed to start Verdaccio"
  exit 1
fi

# Set npm registry and auth for local Verdaccio
export npm_config_registry="$VERDACCIO_URL"

# Create a local .npmrc with auth token for publishing
echo "//localhost:$VERDACCIO_PORT/:_authToken=fake-token-for-e2e" > "$ROOT_DIR/.npmrc.e2e"
export NPM_CONFIG_USERCONFIG="$ROOT_DIR/.npmrc.e2e"

cd "$ROOT_DIR"

# Get package lists dynamically from Nx
echo "📋 Discovering packages from Nx..."

# Get libs packages (excludes demo-*, plugins meta-package handled separately)
LIBS_PACKAGES=($(npx nx show projects --json 2>/dev/null | node --input-type=module -e "
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
const libs = data.filter(p => {
  if (p.startsWith('demo')) return false;
  if (p.startsWith('plugin-')) return false;
  if (p.startsWith('@')) return false;
  if (p === 'plugins') return false;
  return true;
});
console.log(libs.join(' '));
"))

# Get plugin packages dynamically
PLUGIN_PACKAGES=($(npx nx show projects --projects "plugin-*" 2>/dev/null))

echo "  Libs: ${LIBS_PACKAGES[*]}"
echo "  Plugins: ${PLUGIN_PACKAGES[*]}"

# Build all publishable packages (exclude demo apps)
echo ""
echo "🔨 Building packages..."
npx nx run-many -t build --exclude="demo-*,@frontmcp/source" --parallel=5

# Clean old storage to avoid version conflicts
rm -rf "$E2E_DIR/storage"

# Publish packages to local registry
# Order matters: dependencies must be published before dependents
echo "📤 Publishing packages to local registry..."

# First publish libs packages
for pkg in "${LIBS_PACKAGES[@]}"; do
  echo "  Publishing libs/$pkg..."
  if [ -d "libs/$pkg/dist" ]; then
    cd "libs/$pkg/dist"
    if npm publish --registry "$VERDACCIO_URL" --access public --tag next 2>&1; then
      echo "    ✅ Published successfully"
    else
      echo "    ⚠️  Publish failed (may already exist or missing dependency)"
    fi
    cd "$ROOT_DIR"
  else
    echo "    ⚠️  No dist folder found for libs/$pkg"
  fi
done

# Then publish individual plugins (required before meta-package)
for pkg in "${PLUGIN_PACKAGES[@]}"; do
  echo "  Publishing plugins/$pkg..."
  if [ -d "plugins/$pkg/dist" ]; then
    cd "plugins/$pkg/dist"
    if npm publish --registry "$VERDACCIO_URL" --access public --tag next 2>&1; then
      echo "    ✅ Published successfully"
    else
      echo "    ⚠️  Publish failed (may already exist or missing dependency)"
    fi
    cd "$ROOT_DIR"
  else
    echo "    ⚠️  No dist folder found for plugins/$pkg"
  fi
done

# Finally publish the plugins meta-package
echo "  Publishing libs/plugins..."
if [ -d "libs/plugins/dist" ]; then
  cd "libs/plugins/dist"
  if npm publish --registry "$VERDACCIO_URL" --access public --tag next 2>&1; then
    echo "    ✅ Published successfully"
  else
    echo "    ⚠️  Publish failed (may already exist or missing dependency)"
  fi
  cd "$ROOT_DIR"
else
  echo "    ⚠️  No dist folder found for libs/plugins"
fi

echo ""
echo "🧪 Running E2E tests..."
echo ""

# Test 1: Create a new project with default options
echo "Test 1: Create project with --yes flag (Docker target)"
cd "$TEST_DIR"
npx --registry "$VERDACCIO_URL" frontmcp create test-docker-app --yes

if [ -d "test-docker-app" ] && [ -f "test-docker-app/package.json" ]; then
  echo "  ✅ Project created successfully"

  if [ -f "test-docker-app/ci/Dockerfile" ]; then
    echo "  ✅ Dockerfile created in ci/"
  else
    echo "  ❌ Dockerfile not found"
    exit 1
  fi

  if [ -f "test-docker-app/ci/docker-compose.yml" ]; then
    echo "  ✅ docker-compose.yml created in ci/"
  else
    echo "  ❌ docker-compose.yml not found"
    exit 1
  fi
else
  echo "  ❌ Project creation failed"
  exit 1
fi

# Test 2: Create a Vercel project
echo ""
echo "Test 2: Create project with --target vercel"
npx --registry "$VERDACCIO_URL" frontmcp create test-vercel-app --yes --target vercel

if [ -f "test-vercel-app/vercel.json" ]; then
  echo "  ✅ vercel.json created"
else
  echo "  ❌ vercel.json not found"
  exit 1
fi

# Test 3: Create a Lambda project
echo ""
echo "Test 3: Create project with --target lambda"
npx --registry "$VERDACCIO_URL" frontmcp create test-lambda-app --yes --target lambda

if [ -f "test-lambda-app/ci/template.yaml" ]; then
  echo "  ✅ SAM template.yaml created in ci/"
else
  echo "  ❌ template.yaml not found"
  exit 1
fi

# Test 4: Create a Cloudflare project
echo ""
echo "Test 4: Create project with --target cloudflare"
npx --registry "$VERDACCIO_URL" frontmcp create test-cf-app --yes --target cloudflare

if [ -f "test-cf-app/wrangler.toml" ]; then
  echo "  ✅ wrangler.toml created"
else
  echo "  ❌ wrangler.toml not found"
  exit 1
fi

# Test 5: Create project without GitHub Actions
echo ""
echo "Test 5: Create project with --no-cicd"
npx --registry "$VERDACCIO_URL" frontmcp create test-no-cicd --yes --no-cicd

if [ ! -d "test-no-cicd/.github" ]; then
  echo "  ✅ GitHub Actions not created (as expected)"
else
  echo "  ❌ GitHub Actions should not have been created"
  exit 1
fi

# Test 6: Create project without Redis
echo ""
echo "Test 6: Create project with --redis none"
npx --registry "$VERDACCIO_URL" frontmcp create test-no-redis --yes --redis none

if grep -q "redis" "test-no-redis/ci/docker-compose.yml" 2>/dev/null; then
  echo "  ❌ Redis should not be in docker-compose.yml"
  exit 1
else
  echo "  ✅ docker-compose.yml created without Redis"
fi

# Test 7: Verify project can install dependencies
echo ""
echo "Test 7: Install dependencies in created project"
cd test-docker-app
npm install --registry "$VERDACCIO_URL"
if [ $? -eq 0 ]; then
  echo "  ✅ Dependencies installed successfully"
else
  echo "  ❌ Failed to install dependencies"
  exit 1
fi

# Test 8: Verify TypeScript compilation works (catches export type issues)
# This is the critical test that catches bugs like missing "export type" keywords
# which work in development (via path mappings) but fail in published packages
echo ""
echo "Test 8: TypeScript compilation check (catches export type bugs)"
npx tsc --noEmit
if [ $? -eq 0 ]; then
  echo "  ✅ TypeScript compilation successful"
else
  echo "  ❌ TypeScript compilation failed"
  echo "  This often indicates missing or incorrect exports in published packages"
  echo "  Common cause: using 'export { Type }' instead of 'export type { Type }'"
  exit 1
fi

# Test 9: Verify ESM module resolution works
echo ""
echo "Test 9: ESM module resolution check"
node --input-type=module -e "
import('@frontmcp/sdk').then(m => {
  if (m.FrontMcpInstance) {
    console.log('  ✅ ESM import successful');
    process.exit(0);
  } else {
    console.log('  ❌ FrontMcpInstance not exported');
    process.exit(1);
  }
}).catch(e => {
  console.log('  ❌ ESM import failed:', e.message);
  process.exit(1);
});
"
if [ $? -ne 0 ]; then
  exit 1
fi

# Test 10: Run generated e2e tests (optional, can be slow)
if [ "${RUN_GENERATED_E2E:-false}" = "true" ]; then
  echo ""
  echo "Test 10: Run generated e2e tests"
  npm run test:e2e
  if [ $? -eq 0 ]; then
    echo "  ✅ Generated e2e tests passed"
  else
    echo "  ❌ Generated e2e tests failed"
    exit 1
  fi
fi

# Test 11: Create npm project, install deps, and build Docker image
if [ "$DOCKER_AVAILABLE" = "true" ]; then
  echo ""
  echo "Test 11: Create npm project + Docker build"
  cd "$TEST_DIR"
  npx --registry "$VERDACCIO_URL" frontmcp create test-npm-docker --yes --pm npm

  if [ ! -d "test-npm-docker" ] || [ ! -f "test-npm-docker/package.json" ]; then
    echo "  ❌ Failed to create test-npm-docker project"
    exit 1
  fi
  cd test-npm-docker

  # Configure registry for both host install and Docker build
  echo "registry=$VERDACCIO_URL" > .npmrc
  if ! npm install --registry "$VERDACCIO_URL"; then
    echo "  ❌ npm install failed"
    exit 1
  fi
  echo "  ✅ npm install succeeded"

  # npm ci uses 'resolved' URLs from package-lock.json, ignoring .npmrc registry.
  # The lockfile has localhost URLs, but inside Docker localhost is the container
  # itself. Rewrite to the Docker-accessible host so npm ci can reach Verdaccio.
  sed -i.bak "s|http://localhost:${VERDACCIO_PORT}|http://${DOCKER_REGISTRY_HOST}:${VERDACCIO_PORT}|g" package-lock.json
  rm -f package-lock.json.bak

  # Patch Dockerfile so Docker build can reach Verdaccio via host.docker.internal
  echo "registry=http://${DOCKER_REGISTRY_HOST}:${VERDACCIO_PORT}/" > .npmrc
  patch_dockerfile_for_registry ci/Dockerfile .npmrc

  if ! npm run docker:build; then
    echo "  ❌ npm docker:build failed"
    exit 1
  fi
  echo "  ✅ npm docker:build succeeded"
  cd "$TEST_DIR"
else
  echo ""
  echo "Test 11: ⏭️  Skipped (Docker not available)"
fi

# Test 12: Create yarn project, install deps, and build Docker image
if [ "$DOCKER_AVAILABLE" = "true" ]; then
  echo ""
  echo "Test 12: Create yarn project + Docker build"
  cd "$TEST_DIR"
  npx --registry "$VERDACCIO_URL" frontmcp create test-yarn-docker --yes --pm yarn

  if [ ! -d "test-yarn-docker" ] || [ ! -f "test-yarn-docker/package.json" ]; then
    echo "  ❌ Failed to create test-yarn-docker project"
    exit 1
  fi
  cd test-yarn-docker

  # Configure registry for host install (Yarn Classic reads .npmrc)
  echo "registry=$VERDACCIO_URL" > .npmrc
  if ! yarn install --registry "$VERDACCIO_URL"; then
    echo "  ❌ yarn install failed"
    exit 1
  fi
  echo "  ✅ yarn install succeeded"

  # yarn install --frozen-lockfile uses 'resolved' URLs from yarn.lock.
  # Rewrite localhost to Docker-accessible host (same reason as npm above).
  sed -i.bak "s|http://localhost:${VERDACCIO_PORT}|http://${DOCKER_REGISTRY_HOST}:${VERDACCIO_PORT}|g" yarn.lock
  rm -f yarn.lock.bak

  # Patch Dockerfile so Docker build can reach Verdaccio via host.docker.internal
  echo "registry=http://${DOCKER_REGISTRY_HOST}:${VERDACCIO_PORT}/" > .npmrc
  patch_dockerfile_for_registry ci/Dockerfile .npmrc

  if ! yarn docker:build; then
    echo "  ❌ yarn docker:build failed"
    exit 1
  fi
  echo "  ✅ yarn docker:build succeeded"
  cd "$TEST_DIR"
else
  echo ""
  echo "Test 12: ⏭️  Skipped (Docker not available)"
fi

echo ""
echo "🎉 All E2E tests passed!"
