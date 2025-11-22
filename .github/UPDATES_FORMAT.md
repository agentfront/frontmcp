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
    href="https://github.com/agentfront/frontmcp/releases/tag/v0.5.0"
    cta="View full changlog"
  >
    🚀 **Streaming API** – Build real-time experiences with backpressure support and automatic reconnection.

    🛡️ **Enhanced Errors** – Get detailed stack traces and user-friendly error messages that help you debug faster.

    📚 **Documentation** – New streaming guide and updated authentication examples to get you started quickly.

  </Card>
</Update>
```

**Fields:**

- `label`: `"v{version}"` (e.g., `"v0.5.0"`)
- `description`: ISO date format `"YYYY-MM-DD"`
- `tags`: `{["Releases"]}`
- `title`: `"FrontMCP v{version}: Brief description"`
- `href`: `"https://github.com/agentfront/frontmcp/releases/tag/v{version}"`
- `cta`: `"View full changlog"` (note: keep exact spelling)

**Content format:**

- Use emoji at start of each line (🚀 🛡️ 🔐 📚 ⚡ 🎨 🔧 🧩 etc.)
- Format: `emoji **Bold feature name** – Description of what users can do.`
- Use en dash (–) not hyphen (-)
- Each feature on its own line with blank line between
- Focus on benefits and practical capabilities
- NO changelog link at end (href already points to releases)

#### B. Independent Libraries

Separate update per independent library published in this release:

```mdx
<Update label="json-schema-to-zod-v3 v1.2.0" description="2025-11-22" tags={["Independent"]}>
  <Card
    title="json-schema-to-zod-v3 v1.2.0"
    href="https://github.com/agentfront/frontmcp/tree/main/libs/json-schema-to-zod-v3"
    cta="Explore the library"
  >
    🔒 **Regex hardening** – Default-on quantifier guards and pattern timeouts keep untrusted specs safe.

    🧠 **Schema utilities** – Helpers like jsonSchemaObjectToZodRawShape reproduce complex shapes without custom code.

    🛠️ **Configurable security** – Tune setSecurityConfig once to balance trusted specs and public uploads.

  </Card>
</Update>
```

**Fields:**

- `label`: `"{package-name} v{version}"` (e.g., `"json-schema-to-zod-v3 v1.2.0"`)
- `description`: ISO date format `"YYYY-MM-DD"` (same as FrontMCP release)
- `tags`: `{["Independent"]}`
- `title`: `"{package-name} v{version}"`
- `href`: `"https://github.com/agentfront/frontmcp/tree/main/libs/{lib-folder-name}"`
- `cta`: `"Explore the library"`

**Content format:**

- Use emoji at start of each line
- Format: `emoji **Bold feature name** – Description.`
- Use en dash (–) not hyphen (-)
- Each feature on its own line with blank line between
- Focus on practical use cases
- NO changelog link at end

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
    href="https://github.com/agentfront/frontmcp/releases/tag/v0.5.0"
    cta="View full changlog"
  >
    🚀 **Streaming API** – Build real-time experiences with backpressure support and automatic reconnection.

    🛡️ **Enhanced Errors** – Get detailed stack traces and user-friendly error messages that help you debug faster.

    🔐 **Authentication Flow** – Simplified auth setup with better provider integration and clearer error messages.

    📚 **Documentation** – New streaming guide and updated authentication examples to get you started quickly.

  </Card>
</Update>

<Update label="json-schema-to-zod-v3 v1.2.0" description="2025-11-22" tags={["Independent"]}>
  <Card
    title="json-schema-to-zod-v3 v1.2.0"
    href="https://github.com/agentfront/frontmcp/tree/main/libs/json-schema-to-zod-v3"
    cta="Explore the library"
  >
    ✨ **JSON Schema Draft 2020-12** – Full support for the latest JSON Schema specification with all new features.

    🔍 **Enhanced Validation** – More accurate regex pattern validation catches edge cases before runtime.

    🛠️ **Better DX** – Improved TypeScript types and error messages make integration smoother.

  </Card>
</Update>

<Update label="mcp-from-openapi v3.3.0" description="2025-11-22" tags={["Independent"]}>
  <Card
    title="mcp-from-openapi v3.3.0"
    href="https://github.com/agentfront/frontmcp/tree/main/libs/mcp-from-openapi"
    cta="Explore the library"
  >
    🌐 **OpenAPI 3.1 Discriminators** – Full support for polymorphic schemas with discriminator mapping.

    🔐 **Auth Scheme Detection** – Automatically detect and configure authentication from OpenAPI specs.

    🧩 **Nested Objects** – Properly generate types and validators for deeply nested object structures.

  </Card>
</Update>

<Update label="v0.4.0" description="2025-11-21" tags={['Releases']}>
  <Card
    title="FrontMCP v0.4.0: Generator-powered adapters"
    href="https://github.com/agentfront/frontmcp/releases/tag/v0.4.0"
    cta="View full changlog"
  >
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
    🚀 **Work-in-progress feature 1** – Description of what users will be able to do.

    🛡️ **Work-in-progress feature 2** – Another benefit-focused description.

    🔧 **Bug fix** – How this fix improves the user experience.

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
  <Card title="FrontMCP v0.5.1: Bug fixes" href="https://github.com/agentfront/frontmcp/releases/tag/v0.5.1" cta="View full changlog">
    🔧 **Authentication timeout fix** – Connections now stay alive longer for better reliability.

    🧩 **Plugin conflict resolution** – Plugins work together smoothly without initialization races.

  </Card>
</Update>
```

**Result:** One update component only

### Scenario 2: Release with Independent Libraries

When synchronized packages + 2 independent libraries are released:

```mdx
<Update label="v0.5.0" description="2025-11-22" tags={['Releases']}>
  <Card title="FrontMCP v0.5.0: New features" href="https://github.com/agentfront/frontmcp/releases/tag/v0.5.0" cta="View full changlog">
    🚀 **Feature 1** – Synchronized package features description...

    🛡️ **Feature 2** – Another synchronized feature...

  </Card>
</Update>

<Update label="json-schema-to-zod-v3 v1.2.0" description="2025-11-22" tags={['Independent']}>
  <Card title="json-schema-to-zod-v3 v1.2.0" href="https://github.com/agentfront/frontmcp/tree/main/libs/json-schema-to-zod-v3" cta="Explore the library">
    ✨ **Change 1** – Independent lib 1 changes description...

    🔍 **Change 2** – Another independent lib 1 change...

  </Card>
</Update>

<Update label="mcp-from-openapi v3.3.0" description="2025-11-22" tags={['Independent']}>
  <Card title="mcp-from-openapi v3.3.0" href="https://github.com/agentfront/frontmcp/tree/main/libs/mcp-from-openapi" cta="Explore the library">
    🌐 **Change 1** – Independent lib 2 changes description...

    🔐 **Change 2** – Another independent lib 2 change...

  </Card>
</Update>
```

**Result:** Three update components (1 FrontMCP + 2 independent)

### Scenario 3: Independent-Only Release

When only an independent library is released (rare, but possible):

```mdx
<Update label="json-schema-to-zod-v3 v1.2.1" description="2025-11-23" tags={['Independent']}>
  <Card
    title="json-schema-to-zod-v3 v1.2.1"
    href="https://github.com/agentfront/frontmcp/tree/main/libs/json-schema-to-zod-v3"
    cta="Explore the library"
  >
    🔧 **Critical bug fix** – Description of what's fixed and how it helps users.
  </Card>
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
- [ ] FrontMCP uses tag `{["Releases"]}` with `cta="View full changlog"` (exact spelling)
- [ ] Independent libs use tag `{["Independent"]}` with `cta="Explore the library"`
- [ ] FrontMCP href points to GitHub releases: `https://github.com/agentfront/frontmcp/releases/tag/v{version}`
- [ ] Independent libs href points to GitHub tree: `https://github.com/agentfront/frontmcp/tree/main/libs/{lib-name}`
- [ ] Content uses emoji + **Bold** – Description format with en dashes (–)
- [ ] Latest updates at top (after frontmatter)
- [ ] Valid MDX syntax (no unclosed tags)
- [ ] NO changelog links at end of content (already in href)

## Common Mistakes to Avoid

❌ **DON'T:**

- Remove or modify frontmatter
- Use different date formats
- Mix release types in one update
- Include file paths or technical details in titles
- Use hyphens (-) instead of en dashes (–) in content
- Forget to close tags
- Use wrong tag types (Releases vs Independent)
- Add changelog links at end of content (already in href)

✅ **DO:**

- Preserve frontmatter exactly
- Use ISO date format (YYYY-MM-DD)
- Separate FrontMCP from independent libs
- Write user-facing, benefit-focused descriptions
- Use emoji + **Bold feature** – Description format
- Use en dashes (–) not hyphens (-)
- Use GitHub URLs in href (releases for FrontMCP, tree/main/libs for independent)
- Validate MDX syntax
- Use correct tags for each type

## Summary

| Aspect      | FrontMCP (Synchronized)                                      | Independent Libraries                                           |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| **Label**   | `"v{version}"`                                               | `"{package-name} v{version}"`                                   |
| **Title**   | `"FrontMCP v{version}: Description"`                         | `"{package-name} v{version}"`                                   |
| **href**    | `"https://github.com/agentfront/frontmcp/releases/tag/v..."` | `"https://github.com/agentfront/frontmcp/tree/main/libs/{lib}"` |
| **cta**     | `"View full changlog"` (exact spelling)                      | `"Explore the library"`                                         |
| **Tags**    | `{["Releases"]}`                                             | `{["Independent"]}`                                             |
| **Order**   | First (within release date)                                  | After FrontMCP                                                  |
| **Count**   | One per release                                              | One per library published                                       |
| **Content** | Emoji + **Bold** – Description format                        | Emoji + **Bold** – Description format                           |
| **Format**  | Use en dash (–), benefit-focused                             | Use en dash (–), practical use cases                            |
| **Link**    | NO changelog link at end                                     | NO changelog link at end                                        |

**Remember:** Frontmatter is critical - never remove or modify it!
