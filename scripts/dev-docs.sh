#!/usr/bin/env bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$PROJECT_ROOT/docs"

# File names (will be used relative to DOCS_DIR)
PROD_DOCS="docs.json"
DRAFT_DOCS="docs.draft.json"
BACKUP_DOCS="docs.backup.json"

# Cleanup function to restore backup
cleanup() {
  local exit_code=$?
  echo ""
  echo -e "${YELLOW}Cleaning up...${NC}"

  # Navigate to docs directory for cleanup
  cd "$DOCS_DIR"

  if [ -f "$BACKUP_DOCS" ]; then
    echo -e "${GREEN}Restoring original docs.json from backup${NC}"
    mv "$BACKUP_DOCS" "$PROD_DOCS"
    echo -e "${GREEN}✓ Backup restored successfully${NC}"
  else
    echo -e "${YELLOW}⚠ No backup found to restore${NC}"
  fi

  exit $exit_code
}

# Register cleanup function to run on exit
trap cleanup EXIT INT TERM

# Main script
main() {
  echo -e "${GREEN}Starting Mintlify dev server with draft docs...${NC}"
  echo ""

  # Check if docs directory exists
  if [ ! -d "$DOCS_DIR" ]; then
    echo -e "${RED}Error: docs directory not found at $DOCS_DIR${NC}"
    exit 1
  fi

  # Navigate to docs directory
  cd "$DOCS_DIR"
  echo -e "${GREEN}Working directory: $DOCS_DIR${NC}"
  echo ""

  # Check if draft docs exist
  if [ ! -f "$DRAFT_DOCS" ]; then
    echo -e "${RED}Error: $DRAFT_DOCS not found in docs directory${NC}"
    echo "Please ensure docs.draft.json exists before running this script."
    exit 1
  fi

  # Check if production docs exist
  if [ ! -f "$PROD_DOCS" ]; then
    echo -e "${RED}Error: $PROD_DOCS not found in docs directory${NC}"
    echo "Please ensure docs.json exists before running this script."
    exit 1
  fi

  # Backup production docs
  echo -e "${YELLOW}Creating backup of docs.json...${NC}"
  cp "$PROD_DOCS" "$BACKUP_DOCS"
  echo -e "${GREEN}✓ Backup created: $BACKUP_DOCS${NC}"

  # Replace production docs with draft
  echo -e "${YELLOW}Replacing docs.json with draft version...${NC}"
  cp "$DRAFT_DOCS" "$PROD_DOCS"
  echo -e "${GREEN}✓ docs.json replaced with draft version${NC}"
  echo ""

  # Run mintlify dev
  echo -e "${GREEN}Starting Mintlify dev server...${NC}"
  echo -e "${YELLOW}Press Ctrl+C to stop the server and restore backup${NC}"
  echo ""

  # Run mintlify dev (this will block until user stops it)
  npx mintlify dev
}

# Run main function
main
