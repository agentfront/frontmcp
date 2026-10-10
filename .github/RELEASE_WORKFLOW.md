# Release Workflow Documentation

This document describes the release workflow for FrontMCP: package versioning and publishing. FrontMCP's documentation
lives on [frontmcp.dev](https://frontmcp.dev); see [Documentation](#documentation).

## Overview

The release workflow consists of 2 main workflows that handle different stages of the release process:

1. **create-release-branch** - Creates release branch with version bumps
2. **publish-on-next-close** - Publishes packages when release branch merges to main

## Package Versioning Strategy

### Synchronized Packages

Packages tagged with `versioning:synchronized` in `project.json`:

- Always versioned together
- Share the same version number
- All bumped during release branch creation

### Independent Packages

Packages tagged with `versioning:independent` in `project.json`:

- Versioned independently
- Only bumped when affected by changes
- Analyzed by Codex to determine appropriate version bump (major/minor/patch)

## Workflow Details

### 1. Create Release Branch Workflow

**File:** `.github/workflows/create-release-branch.yml`

**Triggers:**

- Manual workflow dispatch with version bump type (patch/minor/major)

**Purpose:**
Creates a new release branch with all version bumps and documentation archival.

**Process:**

#### Step 1: Version Determination

- Computes next version from root `package.json` + bump input
- Gets last release version from git tags
- Determines minor versions for comparison

#### Step 2: Identify Affected Libraries

- Finds all independent libraries
- Determines which are affected since last release
- Prepares context for Codex analysis

#### Step 3: Codex Analysis (Independent Libs)

- Analyzes changes for each affected independent library
- Determines appropriate version bump (major/minor/patch)
- Generates changelog entries

#### Step 4: Version Bumping

- Bumps all synchronized libraries to new version
- Bumps affected independent libraries based on Codex analysis
- Updates CHANGELOGs for independent libraries

#### Step 5: Commit and Push

- Commits all changes with detailed message
- Pushes release branch (no tags yet)
- Opens PR to main

**Creates:**

- Branch: `next/{version}`
- PR: `v{version}` → `main`

### 2. Publish on Release Merge Workflow

**File:** `.github/workflows/publish-on-next-close.yml`

**Triggers:**

- PR closed (merged) from `next/*` to `main`

**Purpose:**
Publishes packages and creates GitHub release when release PR merges.

**Process:**

#### Step 1: Determine Release Version

- Extracts version from branch name (`next/0.4.0` → `0.4.0`)
- Falls back to `package.json` if needed

#### Step 2: Identify Packages to Publish

- Finds all synchronized libraries
- Finds affected independent libraries
- Combines both lists

#### Step 3: Build Packages

- Builds all packages to publish

#### Step 4: Publish to npm

- Publishes each package via npm trusted publishing
- Uses OIDC authentication

#### Step 5: Create Git Tag

- Creates tag `v{version}` at merge commit
- Pushes tag to remote

#### Step 6: Create GitHub Release

- Creates GitHub release with auto-generated notes

## Release Process (Step-by-Step)

### For Maintainers

1. **Develop on main branch**
   - Make changes to code
   - Describe what users see change in each PR's "User-facing change" section

2. **Create release branch**
   - Go to Actions → "Create release branch"
   - Select version bump type (patch/minor/major)
   - Workflow creates `next/{version}` branch
   - Automatically:
     - Bumps synchronized package versions
     - Analyzes and bumps affected independent packages
     - Opens PR to main

3. **Review and update release branch**
   - Review the auto-generated PR
   - Make any additional changes to `next/{version}` branch

4. **Merge release PR**
   - When ready, merge the PR to main
   - Automatically:
     - Publishes all packages to npm
     - Creates git tag
     - Creates GitHub release, with the release highlights frontmcp.dev reads

5. **Continue development**
   - Cycle repeats

## Configuration

### Package Tags

Add to `project.json`:

```json
{
  "tags": ["versioning:synchronized"]
}
```

or

```json
{
  "tags": ["versioning:independent"]
}
```

### Environment Secrets

Required in GitHub repository settings:

- `CODEX_OPENAI_KEY` - OpenAI API key for Codex (environment: release)
- `NPM_TOKEN` - npm publish token (for trusted publishing)
- `DOCS_SYNC_TOKEN` (organization secret) - also starts frontmcp.dev's release pass, so it needs Contents: read and write
  on `agentfront/frontmcp.dev`

### Node Version

Specified in `.nvmrc` file at repository root.

## Troubleshooting

### Release branch creation fails

- Verify all synchronized packages have `version` field
- Check for uncommitted changes
- Verify git tags are accessible

### Publish fails

- Verify npm trusted publishing is configured
- Check package `package.json` files are valid
- Verify `tag:versioning:synchronized` or `tag:versioning:independent` tags exist

## Best Practices

1. **Always review Codex-generated PRs** before merging
2. **Test changes locally** before pushing to release branches
3. **Use semantic versioning** correctly:
   - MAJOR: Breaking changes
   - MINOR: New features (backwards compatible)
   - PATCH: Bug fixes (backwards compatible)
4. **Update draft release notes** manually if Codex misses important changes

## Documentation

FrontMCP's documentation is [frontmcp.dev](https://frontmcp.dev), built from the `agentfront/frontmcp.dev` repository.
This repository has no docs site. It connects to the docs in four places:

- **The release pass:** after publishing a release that isn't a prerelease, the publish workflow sends
  `repository_dispatch` `frontmcp-release` (`{ version, tag, previousTag }`) to `agentfront/frontmcp.dev`. There, Codex
  drafts the docs changes from this release's diff and pull request descriptions, and a "Move to FrontMCP X.Y.Z" pull
  request opens for review (frontmcp.dev's `docs/release-pass.md`).

- **Release highlights:** the publish workflow writes them into the GitHub Release body as a hidden
  `CARD_MDX_START … CARD_MDX_END` block, and frontmcp.dev's releases page reads them from there.
- **What changed for users:** each PR's "User-facing change" section. The release pass gives these to Codex as its main
  input, so a change users see needs one.
- **The skills catalog** (`libs/skills/catalog`) is the documentation that ships with FrontMCP. It stays in this
  repository and changes in the same PR as the behavior it describes.
