# Release Workflow Documentation

This document describes the complete release workflow for FrontMCP, including documentation versioning, package versioning, and publishing.

## Overview

The release workflow consists of 4 main workflows that handle different stages of the release process:

1. **update-draft-docs** - Updates draft documentation on main branch
2. **create-release-branch** - Creates release branch with version bumps and docs archival
3. **codex-mintlify-docs** - Updates live documentation on release branches
4. **publish-on-next-close** - Publishes packages when release branch merges to main

## Documentation Structure

```
docs/
├── draft/              # Draft documentation for next release
│   ├── docs/          # Draft markdown files
│   ├── blog/          # Draft blog posts
│   ├── assets/        # Draft assets
│   ├── snippets/      # Draft snippets
│   ├── docs.json      # Draft navigation (future use)
│   └── updates.mdx    # Draft release notes
│
└── live/              # Production documentation
    ├── docs/          # Live markdown files
    │   └── v/         # Archived versions
    │       ├── 0.3/   # Version 0.3 archived docs
    │       ├── 0.2/   # Version 0.2 archived docs
    │       └── 0.1/   # Version 0.1 archived docs
    ├── blog/          # Live blog posts
    ├── assets/        # Live assets
    ├── snippets/      # Live snippets
    ├── docs.json      # Production navigation
    └── updates.mdx    # Production release notes
```

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

### 1. Update Draft Docs Workflow

**File:** `.github/workflows/update-draft-docs.yml`

**Triggers:**

- Push to `main` branch (except release commits)
- Excludes changes to docs, changelogs, READMEs

**Purpose:**
Updates draft documentation based on changes merged to main branch.

**Process:**

1. Analyzes commits and diffs since last release
2. Uses Codex to update draft documentation
3. Creates PR with draft docs updates

**Modifies:**

- `docs/draft/docs/**` - Draft markdown files
- `docs/draft/updates.mdx` - Draft release notes
- `docs/draft/assets/**` - Draft assets (if needed)
- `docs/draft/snippets/**` - Draft snippets (if needed)

**Does NOT modify:**

- `docs/live/**` - Production docs
- `docs/draft/blog/**` - Blog posts

### 2. Create Release Branch Workflow

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

#### Step 5: Archive and Publish Docs

**Behavior depends on version type:**

##### PATCH Version (e.g., 0.4.0 → 0.4.1)

When `LAST_MINOR` = `NEXT_MINOR` (both are `0.4`):

- ❌ **Script is SKIPPED** - No archival, no draft→live movement
- ✅ Draft docs stay in `/docs/draft/` for future releases
- ✅ Live docs updated by Codex workflow based on release branch changes
- ✅ Perfect for bug fixes that only need live docs updates

##### MINOR/MAJOR Version (e.g., 0.4.x → 0.5.0)

When `LAST_MINOR` ≠ `NEXT_MINOR` (e.g., `0.4` → `0.5`):

Uses `scripts/archive-and-publish-docs.mjs` to:

1. Archive current `/docs/live/docs/*` to `/docs/live/docs/v/{previousMinor}/*`
   - Excludes the `v/` folder itself
2. Update `/docs/live/docs.json`:
   - Add archived version with `version ${previousMinor}` tag
   - Update paths to point to `docs/v/{previousMinor}/...`
   - Update latest version label
3. Move content from `/docs/draft` to `/docs/live` (replace mode):
   - `docs/draft/docs` → `docs/live/docs` (excluding `v/` folder)
   - `docs/draft/blog` → `docs/live/blog`
   - `docs/draft/assets` → `docs/live/assets`
   - `docs/draft/snippets` → `docs/live/snippets`

**Note:** `updates.mdx` is NOT handled by this script. It is updated by Codex in the next workflow (codex-mintlify-docs) which intelligently merges the draft update into the live updates.

#### Step 6: Commit and Push

- Commits all changes with detailed message
- Pushes release branch (no tags yet)
- Opens PR to main

**Creates:**

- Branch: `next/{version}`
- PR: `v{version}` → `main`

### 3. On Release Branch Update Workflow

**File:** `.github/workflows/codex-mintlify-docs.yml`

**Triggers:**

- Push to `next/**` branches
- Excludes changes to docs, changelogs, READMEs

**Purpose:**
Updates live documentation when changes are pushed to release branches.

**Process:**

1. Analyzes changes since last published release
2. Uses Codex to update production documentation
3. Creates PR with docs updates

**Modifies:**

- `docs/live/docs/**` - Production markdown files
- `docs/live/updates.mdx` - Production release notes with:
  - One `<Update>` component for FrontMCP (synchronized packages)
  - Separate `<Update>` components for each independent library published
  - Preserves critical frontmatter metadata for Mintlify
- `docs/live/docs.json` - Production navigation
- `CHANGELOG.md` - Root changelog
- `README.md` - Root README
- `libs/**/README.md` - Library READMEs

**Does NOT modify:**

- `docs/live/docs/v/**` - Archived docs
- `docs/draft/**` - Draft docs
- `docs/live/blog/**` - Blog posts

### 4. Publish on Release Merge Workflow

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

#### Step 4: Remove Draft Blog Cards

Uses `scripts/remove-blog-drafts.mjs` to:

- Scan all `.mdx` and `.md` files in `docs/`
- Remove `draft` attributes from `BlogCard` components
- Makes blog posts visible in production

#### Step 5: Publish to npm

- Publishes each package via npm trusted publishing
- Uses OIDC authentication

#### Step 6: Create Git Tag

- Creates tag `v{version}` at merge commit
- Pushes tag to remote

#### Step 7: Create GitHub Release

- Creates GitHub release with auto-generated notes

## Scripts

### archive-and-publish-docs.mjs

**Usage:**

```bash
node scripts/archive-and-publish-docs.mjs <previous-minor> <new-minor>
```

**Example:**

```bash
node scripts/archive-and-publish-docs.mjs 0.3 0.4
```

**What it does:**

1. Archives current live docs to versioned folder
2. Updates docs.json navigation
3. Publishes draft content to live (replace mode):
   - docs, blog, assets, snippets

**Note:** Does NOT update updates.mdx - that's handled by Codex workflow

**Error Handling:**

- Validates version format
- Handles missing directories gracefully
- Provides detailed error messages
- Exits with error code on failure

### remove-blog-drafts.mjs

**Usage:**

```bash
node scripts/remove-blog-drafts.mjs
```

**What it does:**

1. Recursively finds all `.mdx` and `.md` files in `docs/`
2. Removes `draft` attributes from `BlogCard` components
3. Reports number of files changed

**Patterns removed:**

- `draft={true}`
- `draft={false}`
- `draft="true"`
- `draft="false"`
- `draft` (standalone)

## Release Process (Step-by-Step)

### For Maintainers

1. **Develop on main branch**

   - Make changes to code
   - PRs merged to main trigger draft docs updates automatically
   - Draft docs accumulate changes for next release

2. **Create release branch**

   - Go to Actions → "Create release branch"
   - Select version bump type (patch/minor/major)
   - Workflow creates `next/{version}` branch
   - Automatically:
     - Bumps synchronized package versions
     - Analyzes and bumps affected independent packages
     - Archives previous version docs (if new minor)
     - Publishes draft docs to live (if new minor)
     - Opens PR to main

3. **Review and update release branch**

   - Review the auto-generated PR
   - Make any additional changes to `next/{version}` branch
   - Changes to code trigger live docs updates via Codex
   - Live docs are updated in production immediately

4. **Merge release PR**

   - When ready, merge the PR to main
   - Automatically:
     - Publishes all packages to npm
     - Creates git tag
     - Creates GitHub release
     - Removes draft blog cards
     - Mintlify deploys updated docs

5. **Continue development**
   - New PRs to main update draft docs for next release
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

### Node Version

Specified in `.nvmrc` file at repository root.

## Troubleshooting

### Draft docs not updating on main

- Check workflow runs in Actions tab
- Verify `CODEX_OPENAI_KEY` is set in release environment
- Check for path-ignore patterns

### Release branch creation fails

- Verify all synchronized packages have `version` field
- Check for uncommitted changes
- Verify git tags are accessible

### Docs archival not working

- Verify this is a new minor version (not patch)
- Check `docs/draft/` exists with content
- Verify `docs/live/docs.json` has correct structure

### Publish fails

- Verify npm trusted publishing is configured
- Check package `package.json` files are valid
- Verify `tag:versioning:synchronized` or `tag:versioning:independent` tags exist

## Best Practices

1. **Always review Codex-generated PRs** before merging
2. **Keep draft docs up-to-date** by merging draft doc PRs promptly
3. **Test changes locally** before pushing to release branches
4. **Use semantic versioning** correctly:
   - MAJOR: Breaking changes
   - MINOR: New features (backwards compatible)
   - PATCH: Bug fixes (backwards compatible)
5. **Archive docs only on minor versions** to avoid clutter
6. **Update draft release notes** manually if Codex misses important changes

## Migration Notes

### From Old System

If migrating from a system without draft docs:

1. Create `docs/draft/` directory structure
2. Copy current docs from `docs/live/` to `docs/draft/`
3. Initialize `docs/draft/updates.mdx` with current release notes
4. Tag packages with `versioning:synchronized` or `versioning:independent`
5. Test workflows on a test branch first

### From Manual Docs

If migrating from manual documentation:

1. Set up draft/live directory structure as shown above
2. Run initial release to establish versioning
3. Let Codex handle subsequent updates, review carefully
4. Gradually improve prompts based on Codex output quality
