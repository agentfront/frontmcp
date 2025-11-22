# Updates.mdx Format Guide

This document explains the structure and format for `docs/live/updates.mdx` and `docs/draft/updates.mdx`.

## Critical Requirements

### 1. Frontmatter Metadata (MUST PRESERVE)

**CRITICAL:** The frontmatter is required by Mintlify to detect the page. It must be present at the top of the file:

```yaml
---
title: 'Updates'
slug: 'updates'
icon: 'sparkles'
mode: 'center'
---
```

**Never remove or modify this frontmatter!**

### 2. Update Component Structure

Each release uses `<Update>` components. There are two types:

#### A. FrontMCP (Synchronized Packages)

One update per release for all synchronized packages:

```mdx
<Update label="v0.5.0" description="2025-11-22" tags={["Releases"]}>
  <Card
    title="FrontMCP v0.5.0: Brief compelling description"
    href="/docs"
    cta="Read the release notes"
  >
    ### Features
    - New feature 1
    - New feature 2

    ### Fixes
    - Bug fix 1

    ### Docs
    - Documentation update

  </Card>
</Update>
```

**Fields:**

- `label`: `"v{version}"` (e.g., `"v0.5.0"`)
- `description`: ISO date format `"YYYY-MM-DD"`
- `tags`: `{["Releases"]}`
- `title`: `"FrontMCP v{version}: Brief description"`

#### B. Independent Libraries

Separate update per independent library published in this release:

```mdx
<Update label="json-schema-to-zod-v3 v1.2.0" description="2025-11-22" tags={["Independent"]}>
  <Card
    title="json-schema-to-zod-v3 v1.2.0"
    href="/docs"
    cta="Read the release notes"
  >
    ### Changes
    - Independent lib change 1
    - Independent lib change 2

    ### Fixes
    - Bug fix specific to this library

  </Card>
</Update>
```

**Fields:**

- `label`: `"{package-name} v{version}"` (e.g., `"json-schema-to-zod-v3 v1.2.0"`)
- `description`: ISO date format `"YYYY-MM-DD"` (same as FrontMCP release)
- `tags`: `{["Independent"]}`
- `title`: `"{package-name} v{version}"`

## Complete Example

### Live Updates (docs/live/updates.mdx)

```mdx
---
title: 'Updates'
slug: 'updates'
icon: 'sparkles'
mode: 'center'
---

<Update label="v0.5.0" description="2025-11-22" tags={["Releases"]}>
  <Card
    title="FrontMCP v0.5.0: Enhanced error handling and streaming"
    href="/docs"
    cta="Read the release notes"
  >
    ### Features
    - New streaming API with backpressure support
    - Enhanced error types with stack traces
    - Improved authentication flow

    ### Fixes
    - Fixed memory leak in long-running connections
    - Resolved race condition in plugin initialization

    ### Docs
    - Added streaming guide
    - Updated authentication examples

  </Card>
</Update>

<Update label="json-schema-to-zod-v3 v1.2.0" description="2025-11-22" tags={["Independent"]}>
  <Card
    title="json-schema-to-zod-v3 v1.2.0"
    href="/docs"
    cta="Read the release notes"
  >
    ### Features
    - Support for JSON Schema draft 2020-12
    - New regex pattern validation

    ### Fixes
    - Fixed optional array handling

  </Card>
</Update>

<Update label="mcp-from-openapi v3.3.0" description="2025-11-22" tags={["Independent"]}>
  <Card
    title="mcp-from-openapi v3.3.0"
    href="/docs"
    cta="Read the release notes"
  >
    ### Features
    - Support for OpenAPI 3.1 discriminators
    - Improved auth scheme detection

    ### Fixes
    - Fixed nested object generation

  </Card>
</Update>

<Update label="v0.4.0" description="2025-11-21" tags={['Releases']}>
  <Card title="FrontMCP v0.4.0: Generator-powered adapters" href="/docs" cta="Read the release notes">
    ... (previous release)
  </Card>
</Update>
```

### Draft Updates (docs/draft/updates.mdx)

```mdx
---
title: 'Updates'
slug: 'updates'
icon: 'sparkles'
mode: 'center'
---

<Update label="draft" description="2025-11-22" tags={["Releases"]}>
  <Card
    title="FrontMCP draft"
    href="/docs"
    cta="Read the release notes"
  >
    ### Features
    - Work-in-progress feature 1
    - Work-in-progress feature 2

    ### Fixes
    - Bug fix being tested

  </Card>
</Update>
```

**Note:** Draft updates are cumulative and track all changes for the next release.

## Ordering Rules

1. **Latest first**: New updates always go at the top (after frontmatter)
2. **FrontMCP before independent**: Within the same release date, FrontMCP update comes first
3. **Independent by name**: If multiple independent libs in same release, alphabetical order
4. **Historical order**: Previous releases follow in reverse chronological order

## Release Scenarios

### Scenario 1: Synchronized-Only Release

When only synchronized packages are released (no independent libs affected):

```mdx
<Update label="v0.5.1" description="2025-11-23" tags={['Releases']}>
  <Card title="FrontMCP v0.5.1: Bug fixes">### Fixes - Fixed authentication timeout - Resolved plugin conflict</Card>
</Update>
```

**Result:** One update component only

### Scenario 2: Release with Independent Libraries

When synchronized packages + 2 independent libraries are released:

```mdx
<Update label="v0.5.0" description="2025-11-22" tags={['Releases']}>
  <Card title="FrontMCP v0.5.0: New features">### Features - Synchronized package features...</Card>
</Update>

<Update label="json-schema-to-zod-v3 v1.2.0" description="2025-11-22" tags={['Independent']}>
  <Card title="json-schema-to-zod-v3 v1.2.0">### Changes - Independent lib 1 changes...</Card>
</Update>

<Update label="mcp-from-openapi v3.3.0" description="2025-11-22" tags={['Independent']}>
  <Card title="mcp-from-openapi v3.3.0">### Changes - Independent lib 2 changes...</Card>
</Update>
```

**Result:** Three update components (1 FrontMCP + 2 independent)

### Scenario 3: Independent-Only Release

When only an independent library is released (rare, but possible):

```mdx
<Update label="json-schema-to-zod-v3 v1.2.1" description="2025-11-23" tags={['Independent']}>
  <Card title="json-schema-to-zod-v3 v1.2.1">### Fixes - Critical bug fix</Card>
</Update>
```

**Result:** One independent update component only

## Codex Integration

### How Codex Generates Updates

1. **Reads context:**

   - `independent-libs.json` - Which independent libs are published
   - `commits.txt` - All commits since last release
   - `diff.patch` - All code changes

2. **Creates FrontMCP update:**

   - Groups all synchronized package changes
   - Uses version from `version.txt`
   - Creates one comprehensive update

3. **Creates independent updates:**

   - For each library in `independent-libs.json`:
     - Filters commits to `libs/{lib}/` path
     - Filters diff to `libs/{lib}/` path
     - Creates separate update with library's version

4. **Preserves frontmatter:**
   - Always keeps the YAML frontmatter intact
   - Never modifies title, slug, icon, or mode

## Validation Checklist

Before committing updates.mdx changes:

- [ ] Frontmatter present and unchanged
- [ ] All `<Update>` components properly closed
- [ ] All `<Card>` components properly closed
- [ ] Date format is `YYYY-MM-DD`
- [ ] FrontMCP uses tag `{["Releases"]}`
- [ ] Independent libs use tag `{["Independent"]}`
- [ ] Latest updates at top (after frontmatter)
- [ ] Valid MDX syntax (no unclosed tags)
- [ ] All links use relative paths (e.g., `/docs` not `https://...`)

## Common Mistakes to Avoid

❌ **DON'T:**

- Remove or modify frontmatter
- Use different date formats
- Mix release types in one update
- Include file paths or technical details in titles
- Use absolute URLs in href attributes
- Forget to close tags
- Use wrong tag types (Releases vs Independent)

✅ **DO:**

- Preserve frontmatter exactly
- Use ISO date format (YYYY-MM-DD)
- Separate FrontMCP from independent libs
- Write user-facing descriptions
- Use relative paths for links
- Validate MDX syntax
- Use correct tags for each type

## Summary

| Aspect      | FrontMCP (Synchronized)              | Independent Libraries         |
| ----------- | ------------------------------------ | ----------------------------- |
| **Label**   | `"v{version}"`                       | `"{package-name} v{version}"` |
| **Title**   | `"FrontMCP v{version}: Description"` | `"{package-name} v{version}"` |
| **Tags**    | `{["Releases"]}`                     | `{["Independent"]}`           |
| **Order**   | First (within release date)          | After FrontMCP                |
| **Count**   | One per release                      | One per library published     |
| **Content** | All synchronized changes grouped     | Library-specific changes only |

**Remember:** Frontmatter is critical - never remove or modify it!
