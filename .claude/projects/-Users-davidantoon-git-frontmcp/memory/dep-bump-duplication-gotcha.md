---
name: dep-bump-duplication-gotcha
description: Bumping zod/jest in this monorepo silently creates duplicate package copies that break the build; fix with yarn resolutions
metadata:
  type: project
---

When bumping shared deps in this Nx/Yarn monorepo, a version bump can create a
**second hoisted copy** of a package while other consumers keep the old one,
which breaks the build even though each copy is individually fine.

Seen cases (June 2026 dependency upgrade):
- **zod**: bumping root to `^4.4.3` left a 4.3.6 copy (other libs pinned `^4.0.0`)
  AND a nested `@frontmcp/di/node_modules/zod`. TS then errors `TS2742`/`TS2883`
  ("inferred type ... cannot be named ... not portable") on every
  `export const x = z.object(...)` in libs/auth, libs/guard, etc.
- **jest**: bumping root `jest` to 30.4.x while `@nx/jest@22.7.5` pins the jest
  30.2.0 sub-package stack (`@jest/reporters`/`@jest/test-result`/`jest-runner`)
  caused `TS2416` on libs/testing's custom `Reporter` (two `@jest/test-result`).

**Fix:** force a single copy via root `resolutions` in package.json:
`"zod": "4.4.3"`, `"@jest/test-result": "30.4.1"`, `"@jest/reporters": "30.4.1"`,
`"jest-runner": "30.4.2"`. Verify with `grep 'resolution: "<pkg>@npm' yarn.lock`
showing exactly one version.

Also watch for **per-lib pins** that desync from a root bump: `libs/cli` pins
`@rspack/core` itself, so bumping root rspack to 2.x split it from the cli's 1.x —
keep them on the same major. See [[ts6-held-back-cli-tsc]].
