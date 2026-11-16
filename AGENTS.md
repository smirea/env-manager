# Distribution

env-manager ships the way sync-engine does: straight from GitHub, no registry. The package publishes its TypeScript source (`files` in `package.json`, test files excluded) and Bun runs `src/cli.ts` directly.

- Projects depend on it as `"env-manager": "github:smirea/env-manager"`; the lockfile pins the commit.
- Global install: `bun add -g github:smirea/env-manager` exposes `env-manager` on PATH.
- Runtime imports belong in `dependencies`; tooling and types in `devDependencies`, which consumers never install. CI's `install` job packs the package, installs it globally and runs `env-manager --help`, so a missing runtime dependency fails there.

# Workflow

- A merge here is not done until its consumers pin it. After every push to `master` that changes shipped code, move the pin in each repo that depends on it: `bun update env-manager` there (or rewrite a `#<sha>` pin to the new commit), run its `env:generate` script, and commit straight to its `master`. Find them with `grep -l smirea/env-manager ~/code/*/package.json`. A change that breaks the `.env` directives, generated reader shape or AWS layout goes through a PR in the consumer instead.
- Refresh the global install too: `bun add -g github:smirea/env-manager`.
- Docs-only changes need no bump.
