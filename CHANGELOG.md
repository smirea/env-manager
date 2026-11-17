# @stefan.inc/env-manager

## 1.1.0

### Minor Changes

- c8b5d79: Generated readers treat an empty value as unset. A required variable that is blank now fails with its name instead of passing as `''` (or as `0` for a number), which is what the tracked `.env` placeholders produced under any dotenv loader. Regenerate with `env-manager generate`; the `optional()` helper is gone and optional fields read `.optional()`.
- 0467fe5: Swift targets can generate a check script: `generate=Config/check-env.sh` on a `format=swift` target (or `env-manager generate Config/check-env.sh` in a single Swift project) writes an executable `sh` script to commit. Run it as the Xcode target's first Run Script phase and a build or archive fails, naming each variable, when a required setting is unset or malformed. It never prints a value.
- a9a3efb: New command `env-manager sync github <env>`: sets the repository's GitHub Actions secrets from a stored environment through the `gh` CLI. It syncs every variable that has a value; `--only A,B` narrows it to a whitelist, `--repo owner/name` picks the repository, and `--dry-run` names the secrets without setting them. Values go to `gh` on stdin and are never printed.

### Patch Changes

- 769e8e1: `generate` no longer bumps the version of a file that already holds what it would write. A reader pulled from git used to be rewritten with a higher `| vN` whenever the checkout's own record was older, so every pull left a version-only diff. A version now changes only when values or the schema change, and `up` compares content instead of version labels when deciding whether to upload.

## 1.0.0

### Major Changes

- d27dcd8: First release on npm as `@stefan.inc/env-manager`. Install the CLI globally with `bun add -g @stefan.inc/env-manager`, or replace a `github:smirea/env-manager` dependency with `@stefan.inc/env-manager`.
