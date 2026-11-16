# Releases

env-manager is published to npm as `@stefan.inc/env-manager`. It ships its TypeScript source with no build step: `files` publishes `src` without the tests, beside the README and `LICENSE`, and Bun runs `src/cli.ts` directly. `src/package.test.ts` fails when the tarball holds anything else.

- Install globally with `bun add -g @stefan.inc/env-manager`, which puts `env-manager` on PATH. Projects add it with `bun add -d @stefan.inc/env-manager`.
- Runtime imports belong in `dependencies`; tooling and types in `devDependencies`, which installs never fetch. CI's `install` job packs the package, installs it globally and runs `env-manager --help`, so a missing runtime dependency fails there.
- Every push to `master` whose CI passes runs `.github/workflows/release.yml`. Its `.github/scripts/release.ts` stops when `master` moved past the commit CI tested, turns pending changesets into a version and a `CHANGELOG.md` entry, publishes with `npm publish` unless npm already has that version, then commits the version to `master` as `github-actions[bot]`. Publishing before pushing lets a rerun converge. A push made with the workflow's token starts no CI run, so a release never triggers another.
- npm trusts `release.yml` by file name through trusted publishing, so no token is stored anywhere and every version carries provenance. Renaming the workflow breaks publishing until the trusted publisher on npmjs.com names the new file.
- A change to `src` (tests aside) or `package.json` adds a changeset in the same change: `.changeset/<short-name>.md`, with `'@stefan.inc/env-manager': patch`, `minor`, or `major` as its front matter and a sentence or two for the changelog, written for someone upgrading. The pull request check and the pre-push hook fail without one. A change that should not release takes `bunx changeset add --empty`.
- Pick the level by what a project that upgrades without editing anything sees:
  - `patch`: a bug fix, or a change with no new surface.
  - `minor`: anything new that leaves existing projects working, such as a new command, flag or directive.
  - `major`: only a change that breaks such a project, such as a removed or renamed command or flag, a changed `.env` directive, a generated reader whose shape changed, or a different AWS secret layout.
- Before you write a `major` changeset, ask the maintainer to confirm it, unless they asked for a major release in this task.
- Changesets that land on `master` together release as one version, at the highest level among them.

# Consumers

env-manager is a global tool, never a project dependency: projects call `env-manager` from PATH, and their CI installs it first with `bun add -g @stefan.inc/env-manager@^1` before `bun run env:generate`. A `major` release means bumping that range in each project's workflows, with whatever migration it needs; find them with `grep -rl "@stefan.inc/env-manager" ~/code/*/.github/workflows`.
