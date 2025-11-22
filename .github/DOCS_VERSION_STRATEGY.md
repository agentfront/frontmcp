# Documentation Versioning Strategy

This document clarifies how documentation is handled for different version types.

## Version Types and Doc Behavior

### PATCH Releases (0.4.0 → 0.4.1)

**Scenario:** Bug fixes, small improvements, no breaking changes

**Documentation Flow:**

```
┌─────────────────────────────────────────────────────────┐
│ PATCH RELEASE: 0.4.0 → 0.4.1                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. Create release branch (next/0.4.1)                  │
│    ├─ Bump synchronized packages: 0.4.0 → 0.4.1       │
│    ├─ Bump affected independent packages               │
│    └─ ❌ SKIP docs archival (same minor: 0.4 = 0.4)   │
│                                                         │
│ 2. Codex updates live docs on release branch          │
│    ├─ Reads: release branch code changes              │
│    ├─ Reads: docs/draft/** (for reference only)       │
│    └─ Updates: docs/live/docs/** (bug fix docs)       │
│                                                         │
│ 3. Merge to main → Publish                            │
│    ├─ Publish packages to npm                         │
│    └─ Mintlify deploys updated docs/live/             │
│                                                         │
│ Result:                                                │
│ ✅ docs/live/docs/** - Updated with bug fix docs      │
│ ✅ docs/draft/docs/** - Unchanged (for next release)  │
│ ✅ No archival, no version folders created             │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**

- ✅ Live docs get bug fix documentation updates
- ✅ Draft docs stay intact for future feature release
- ❌ No archival of old docs
- ❌ No moving draft to live
- ✅ Codex intelligently updates only what's needed

### MINOR/MAJOR Releases (0.4.x → 0.5.0)

**Scenario:** New features, potentially breaking changes

**Documentation Flow:**

```
┌─────────────────────────────────────────────────────────┐
│ MINOR RELEASE: 0.4.3 → 0.5.0                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. Create release branch (next/0.5.0)                  │
│    ├─ Bump synchronized packages: 0.4.3 → 0.5.0       │
│    ├─ Bump affected independent packages               │
│    └─ ✅ Archive & publish docs (diff minor: 0.4→0.5) │
│                                                         │
│ 2. Archive old version (0.4) docs                     │
│    ├─ docs/live/docs/getting-started/                 │
│    │  └─> docs/live/docs/v/0.4/getting-started/       │
│    ├─ docs/live/docs/servers/                         │
│    │  └─> docs/live/docs/v/0.4/servers/               │
│    └─ Update docs/live/docs.json:                     │
│       ├─ Add version "v0.4" (not default)             │
│       └─ Update paths to docs/v/0.4/**                │
│                                                         │
│ 3. Publish draft as new live                          │
│    ├─ docs/draft/docs/ → docs/live/docs/              │
│    ├─ docs/draft/blog/ → docs/live/blog/              │
│    ├─ docs/draft/assets/ → docs/live/assets/          │
│    └─ docs/draft/snippets/ → docs/live/snippets/      │
│                                                         │
│ 4. Codex updates newly published live docs            │
│    ├─ Reads: release branch code changes              │
│    └─ Updates: docs/live/** (refinements)             │
│                                                         │
│ 5. Merge to main → Publish                            │
│    ├─ Publish packages to npm                         │
│    └─ Mintlify deploys updated docs/live/             │
│                                                         │
│ Result:                                                │
│ ✅ docs/live/docs/v/0.4/** - Archived old version     │
│ ✅ docs/live/docs/** - New version docs (from draft)  │
│ ✅ docs/draft/** - Emptied (ready for next features)  │
│ ✅ Version selector shows: v0.5 (latest), v0.4, v0.3  │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**

- ✅ Old docs preserved in versioned folder
- ✅ Draft docs become new live docs
- ✅ Codex can still refine the newly published docs
- ✅ Version dropdown shows all historical versions

## Decision Logic in Code

The workflow uses this check:

```bash
LAST_MINOR="${{ steps.versions.outputs.last_minor }}"  # e.g., "0.4"
NEXT_MINOR="${{ steps.next.outputs.next_minor }}"      # e.g., "0.4" or "0.5"

if [ "$LAST_MINOR" = "$NEXT_MINOR" ]; then
  echo "PATCH release - skipping docs archival"
  exit 0
fi

# If we reach here, it's a MINOR/MAJOR release
echo "MINOR/MAJOR release - archiving and publishing docs"
node scripts/archive-and-publish-docs.mjs "$LAST_MINOR" "$NEXT_MINOR"
```

## Examples

### Example 1: Patch Release

**Release:** 0.4.0 → 0.4.1

**What happens:**

1. ✅ Packages bumped to 0.4.1
2. ❌ Docs archival SKIPPED (0.4 = 0.4)
3. ✅ Codex updates `docs/live/docs/**` with bug fix docs
4. ✅ `docs/draft/**` untouched (accumulating v0.5 features)

**Users see:**

- Latest docs (v0.4) updated with bug fixes
- Historical versions (v0.3, v0.2, etc.) unchanged

### Example 2: Minor Release

**Release:** 0.4.3 → 0.5.0

**What happens:**

1. ✅ Packages bumped to 0.5.0
2. ✅ Archive `docs/live/docs/**` → `docs/live/docs/v/0.4/**`
3. ✅ Move `docs/draft/**` → `docs/live/**`
4. ✅ Update `docs/live/docs.json` with v0.4 archived entry
5. ✅ Codex refines newly published `docs/live/docs/**`

**Users see:**

- Latest docs (v0.5) with all new features from draft
- Historical version (v0.4) available in version dropdown
- All previous versions (v0.3, v0.2, etc.) still available

### Example 3: Major Release

**Release:** 0.9.5 → 1.0.0

**What happens:**

1. ✅ Packages bumped to 1.0.0
2. ✅ Archive `docs/live/docs/**` → `docs/live/docs/v/0.9/**`
3. ✅ Move `docs/draft/**` → `docs/live/**`
4. ✅ Update `docs/live/docs.json` with v0.9 archived entry
5. ✅ Codex refines newly published `docs/live/docs/**`

**Users see:**

- Latest docs (v1.0) with all breaking changes documented
- Historical version (v0.9) available in version dropdown
- All previous versions accessible

## Summary

| Release Type            | Archive Old Docs   | Move Draft→Live | Update Live Docs   | Draft After Release |
| ----------------------- | ------------------ | --------------- | ------------------ | ------------------- |
| **PATCH** (0.4.0→0.4.1) | ❌ No              | ❌ No           | ✅ Yes (via Codex) | Unchanged           |
| **MINOR** (0.4.x→0.5.0) | ✅ Yes (to v/0.4/) | ✅ Yes          | ✅ Yes (via Codex) | Emptied             |
| **MAJOR** (0.9.x→1.0.0) | ✅ Yes (to v/0.9/) | ✅ Yes          | ✅ Yes (via Codex) | Emptied             |

This ensures:

- ✅ Patch releases get doc updates without disrupting draft work
- ✅ Minor/Major releases properly archive old docs and publish new features
- ✅ Users always have access to docs for the version they're using
- ✅ Draft docs are always preparing for the next feature release
