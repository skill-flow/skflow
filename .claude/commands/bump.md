---
description: Auto-bump package versions based on commits since last release
allowed-tools: Bash(git *), Bash(node *), Read, Edit, Grep, Glob
---

# bump

Analyze commits since the last version tag and bump the relevant packages' version numbers.

## Steps

### 1. Find the last version tag

```bash
git describe --tags --abbrev=0 2>/dev/null || echo "none"
```

If no tag exists, use the initial commit as the base.

### 2. Get commits since last tag

```bash
git log <last-tag>..HEAD --oneline --no-merges
```

### 3. Determine which packages changed

```bash
git diff --name-only <last-tag>..HEAD
```

Map changed files to packages:

- `packages/runtime/` → `@skflow/runtime`
- `packages/transform/` → `@skflow/transform`
- `packages/cli/` → `@skflow/cli`

### 4. Determine bump type per package

From conventional commit prefixes in the relevant commits:

- `feat!:` or `BREAKING CHANGE` → **major**
- `feat:` → **minor**
- `fix:`, `perf:` → **patch**
- `chore:`, `docs:`, `style:`, `test:`, `refactor:`, `ci:` → **patch** (only if that package has no higher bump)

Use the highest bump level found for each package.

### 5. Update version numbers

For each affected package, read its `package.json`, bump the version field accordingly (major.minor.patch), and write it back.

Also update cross-references: if `@skflow/cli` depends on `@skflow/runtime` and runtime's version bumped, update the dependency version in cli's package.json too.

### 6. Update root package.json

Bump the root `package.json` version to match the highest bump across all packages.

### 7. Report

Output a summary table:

```
Package              Old       New       Bump
@skflow/runtime      0.1.0  →  0.2.0    minor
@skflow/transform    0.1.0  →  0.1.1    patch
@skflow/cli          0.1.0  →  0.2.0    minor
```

Do NOT commit. Leave the changes staged for the user to review.
