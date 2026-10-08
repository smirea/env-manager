# env-manager

Keep environment schemas in one `.env`, generate local values and typed access,
and optionally sync with AWS Secrets Manager.

## Installation

```bash
bun install
bun link
```

## Usage

```bash
env-manager <command> [options]
```

### Ordinary projects

Most projects only need one schema file. No targets or section headers are needed:

```bash
# .env
# env-manager: my-app
# env-manager local:true

API_URL= # {url}
API_KEY= # {string}
PORT=3000 # {int:min(1),max(65535)}
```

```bash
env-manager init --local
# Add your schema entries, then:
env-manager gen
```

With `package.json`, values default to `.env.local` and the TypeScript reader to
`src/env.ts`. Fill in `.env.local` and load it in your app as usual. Generation
creates missing values files with defaults and empty placeholders; existing
single-project values files remain the source and are preserved. Readers contain
validation code, never secret values or embedded defaults. Missing required
values fail validation when syncing or using the reader, so you can generate
while setting up a project.

For Swift, set one format directive; the values destination defaults to
`Config/LocalSecrets.xcconfig`:

```bash
# env-manager: my-ios-app
# env-manager local:true
# env-manager format: swift

API_URL=https://example.com # {url}
API_KEY= # {string}
```

```bash
env-manager init --local --values-format swift
env-manager generate
```

### Commands

| Command | Description |
|---------|-------------|
| `init` | Create `.env` from AWS or new template and copy matching global defaults |
| `up` | Upload `.env` schema and configured values for the current environment to AWS |
| `down` | Download `.env` and configured values for the current environment from AWS |
| `rm [project]` | Delete the project secret from AWS without touching local files |
| `generate [path]` (`gen`) | Generate local values files and TypeScript readers; all targets by default |
| `ts [path]` | Deprecated alias for `generate`; still accepts the same options |
| `list` (`ls`) | List all projects in `env-manager/*` namespace and global keys |
| `print [project]` | Print all stored environments for a project |
| `print [project] -e <env>` | Print one stored environment for a project |
| `set <field> <value>` | Set `.env` config: `local`, `format`, `path`, or `generate` |
| `check [--strict]` | Validate root config and output paths without changing files |
| `format` | Normalize spacing while preserving comments, values, variable order, and target scopes |
| `env set <env>` | Set the default environment marker |
| `env list` (`env ls`) | List environments for a project |
| `env rm <env>` | Remove an environment from AWS |
| `global set` | Set a global default env var |
| `global get [NAME]` | Get a global default env var |
| `global list` (`global ls`) | List all global default env vars |
| `global rm <NAME>` | Remove a global default env var |
| `new-key <KEY>` | Create and add API key (e.g., `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) |
| `new-key --list` | List available keys |

### Git updates

After a successful command, tracked files that were clean before the command and
changed by env-manager are committed together as `chore: env manager update`.
Files that were already staged are re-added, including any unstaged edits in those
files, and excluded from the automatic commit. Unrelated staged files stay staged.
Files with only unstaged edits, untracked files, and ignored files are not added
or committed. Unchanged writes do not create commits or change staging.
This applies within the current Git repository; commands outside Git still work.
Automatic commits stay local and are not pushed. Pass `--local` to supported
commands to leave changes unstaged and uncommitted (existing staging is preserved).
The persistent `# env-manager local:true` setting also disables all Git updates.

### Options

| Option | Description |
|--------|-------------|
| `-p, --project <name>` | Project name (default: `.env` header, then current directory name) |
| `--local` / `--no-local` | Override project local mode for this invocation |
| `--target <name>` | Generate only one declared target (`generate` and aliases) |
| `--strict` | Require type annotations in legacy files too (`check`) |
| `-f, --force` | Replace the stored TypeScript output path (`generate` only, including aliases) |
| `-y, --yes` | Accept defaults for prompts (non-interactive) |
| `--values-format <ts\|swift>` | Values output format (`init` only) |
| `--values-path <path>` | Values output path (`init` only; otherwise the format default) |
| `-e, --env <name>` | Print only one environment (`print` only) |
| `--name <name>` | OpenRouter key name (`new-key OPENROUTER_API_KEY` only; default: project name) |
| `--credit <usd>` | OpenRouter key credit limit in USD/month (`new-key OPENROUTER_API_KEY` only; default: `10`) |
| `--unlimited` | Create OpenRouter key without a credit limit (`new-key OPENROUTER_API_KEY` only) |
| `--expiration <utc-iso>` | OpenRouter key expiration (UTC ISO-8601, `new-key OPENROUTER_API_KEY` only) |
| `-h, --help` | Show help message |

### Local mode

```bash
env-manager init --local        # persists local:true in .env
env-manager gen                 # uses the stored setting
env-manager check
env-manager format
env-manager set local false     # turn off the persistent setting
env-manager up --no-local       # explicitly allow AWS for one invocation
```

Precedence: explicit `--local`/`--no-local`, then the root `.env` directive, then
normal command behavior. Flags on commands other than `init` are temporary.
`local` accepts only `true` or `false` and applies to the whole project wherever
it appears in `.env`.

Local mode skips secret storage and all automatic Git staging/commits.
`init` creates or configures local files and skips remote project lookup and global
defaults. `generate`/`gen`/deprecated `ts`, `set`, `env set`, `check`, `format`, and
`new-key --list` work locally. Storage commands (`up`, `down`, `rm`, `print`,
`list`, `env list`, `env rm`, `global`, and API key creation) fail before credentials,
network calls, or file changes. Pass `--no-local` to permit storage for that run.
The `# env-manager env: local` environment selector is separate from storage mode.

## Monorepos

Define every variable once in the root `.env`. Each target is a directory relative
to that file, with its format and optional output paths on one line:

```bash
# env-manager: my-monorepo
# env-manager local:true
# env-manager target: ios format=swift
# env-manager target: client format=ts
# env-manager target: server format=ts path=config/.env.local

# env-manager targets: ios,client,server
API_URL= # {url}
APP_NAME= # {string}

# env-manager targets: client
CLIENT_SETTING= # {optional string}

# env-manager targets: server
DATABASE_URL= # {url}
AUTH_SECRET= # {string}
```

Selection headers replace the previous scope and apply until the next header.
`# env-manager targets: *` selects every declared target. Variables before the
first selection are invalid. Every target must appear in at least one selection;
an empty section counts. There are no nested configuration files or implicit
broadcasts.

Target fields:

| Field | Meaning |
|-------|---------|
| `format=ts\|swift` | Required output format |
| `path=<relative-file>` | Values file, default `.env.local` for TS or `Config/LocalSecrets.xcconfig` for Swift |
| `generate=<relative-file>` | TypeScript reader, default `src/env.ts`; invalid for Swift |

Paths are relative to the target directory. For example:

```bash
# env-manager target: client format=ts path=.env.local generate=src/config/env.ts
```

### Root values and generated children

The root `.env.local` is the single values source for the current environment.
It uses dotenv syntax, even when every target is Swift. Edit values there; do not
use generated child values as input. Schema defaults apply when root values are
missing. `generate` creates the source if it does not exist and otherwise preserves
it. The root schema and one root values/files payload per environment are what
`up` and `down` synchronize with AWS.

```bash
env-manager gen                 # materialize all targets
env-manager gen --target client # only this target; still validate the whole plan
env-manager env set staging     # selects the root environment
env-manager down --no-local     # fetch root values, regenerate child outputs
```

Git-ignore the root `.env.local` and generated target values files. Readers can
be committed. Child values include only selected variables; readers include
only their schema and never contain secret values.

Every child output identifies its owner with metadata (use `//` comments in
TypeScript and xcconfig):

```bash
# env-manager: my-monorepo | 2026-01-01T00:00:00Z
# env-manager target: client
# env-manager root: ..
# env-manager env: staging
```

The root pointer is relative to the output file's directory. These are ownership
headers, not declarations. Commands from child directories find the owning root
through that pointer or by walking to the root `.env`. Broken or mismatched
ownership fails rather than turning the child into a new project.

## Validation and formatting

`check` is read-only. `format` normalizes directive and annotation spacing without
reordering variables or selections, changing values, or removing ordinary comments.
It refuses invalid configuration rather than guessing repairs. Schema-consuming
commands validate configuration before writing. Generation preflights every target
before writing any output, including with `--target`.

Errors report the source file and line. Checks reject unknown or malformed
metadata, invalid types and validators, invalid defaults, duplicate variables or
settings, duplicate targets and selections, unknown targets, unused targets,
untyped variables in the new format, and mixing target declarations with
single-project output settings. Paths must be relative and stay inside their
output directory, including through symlinks. Outputs cannot be directories,
collide, overwrite the root schema/values source, or replace managed files owned
by another project or target.

### Compatibility

Files without target declarations retain single-project behavior. Dated project
headers, `values.format`, `values.path`, and `# env-manager ts: <reader-path>` remain
supported. New `format`, `path`, and `generate` names replace their legacy
counterparts; declaring both is an error. `generate [path]` preserves the existing
positional reader-path argument, and `--force` is still required to change a
configured path. In monorepos, use `--target <name>` with a positional path.

`ts` forwards to `generate` and prints a deprecation warning. Existing stored
`ts` paths still work. Configured output paths must now be relative; move any
absolute output paths inside the project. Introducing `format`, `path`, `generate`,
or target declarations opts into typed-variable checks. `local:true` alone does
not: use `check --strict` to find untyped variables in a legacy file.

## Schema Format

Define environment variable schemas as comments in your `.env` file:

```bash
# env-manager: my-project | 2025-01-27T10:00:00-05:00

API_KEY= # {string:format(/^sk-/)}
PORT=3000 # {int:min(3000),max(10000)}
DEBUG= # {optional bool}
CALLBACK= # {optional url}
ADMIN= # {optional email}

# Schema can also be on the line before
# {float:min(0),max(1)}
RATE_LIMIT=0.5
```

### Supported Types

| Type | Validators | Example |
|------|-----------|---------|
| `string` | `format(regex)` | `# {string:format(/^sk-/)}` |
| `int` | `min(n)`, `max(n)` | `# {int:min(0),max(100)}` |
| `float` | `min(n)`, `max(n)` | `# {float:min(0.0)}` |
| `bool` | - | `# {bool}` |
| `url` | - | `# {url}` |
| `email` | - | `# {email}` |
| `file` | - | `# {file}` |

All types can be prefixed with `optional` (e.g., `# {optional string}`).

`file` values are file paths. On sync, file contents are stored in the secret and written back to the same path when downloading. Files must be valid UTF-8 text (binary files are rejected).

## Values Output

Single-project output settings are optional when `package.json` supplies the TS
defaults. Use `format: swift` to select Swift, and `path` or `generate` to override
format defaults:

```bash
# env-manager format: ts
# env-manager path: .env.local
# env-manager generate: src/config/env.ts
```

```bash
env-manager set format swift
env-manager set path Config/LocalSecrets.xcconfig
```

Swift generation encodes `//` as `/$()/` so URLs survive xcconfig comment parsing;
reading Swift values decodes that representation. This behavior is verified with
Xcode build settings. [Apple xcconfig syntax](https://help.apple.com/xcode/mac/current/en.lproj/dev745c5c974.html)
describes comment delimiters and setting expansion.

`generate` produces a reader for TS and values only for Swift. A positional
reader path is valid only with TS. Without config or `package.json`, configure a
format before commands that read or write values.

## Environments

Project values are grouped by environment. The current environment is stored in
the configured `ts` values file, or in `.env.local` for non-`ts` values formats.
If no environment comment exists, the current environment is `local`.

```bash
env-manager env set staging
env-manager env ls
env-manager env rm staging
```

`env set` only updates the environment comment:

```bash
# env-manager env: staging
```

The next `env-manager up` creates or updates that environment in AWS.
`env-manager down` downloads the current environment and fails if that
environment has been removed remotely.

## Global Defaults

Global defaults store shared env vars that can be reused across projects.

### Manage global defaults

```bash
env-manager global set -n ANTHROPIC_API_KEY -v sk-ant-... -l "claude console"
env-manager global set ANTHROPIC_API_KEY sk-ant-... "claude console"
env-manager global get ANTHROPIC_API_KEY
env-manager global list
env-manager global ls
env-manager global rm ANTHROPIC_API_KEY
```

### Adding a key

```bash
env-manager new-key ANTHROPIC_API_KEY
env-manager new-key OPENROUTER_API_KEY
env-manager new-key OPENROUTER_API_KEY --name my-app --credit 25 --expiration 2027-12-31T23:59:59Z
```

If the key exists in global defaults, you'll be prompted:
```
ANTHROPIC_API_KEY found in global defaults
  [1] Use existing from global defaults
  [2] Create new key
Choice:
```

When creating a new `OPENROUTER_API_KEY`, you'll also be prompted for monthly credit limit:
```
OpenRouter monthly credit limit in USD (default 10; type "unlimited" for no limit):
```

To run non-interactively and use the default choice:
```bash
env-manager new-key ANTHROPIC_API_KEY --yes
```

For OpenRouter, you can set the limit explicitly:
```bash
env-manager new-key OPENROUTER_API_KEY --credit 25
env-manager new-key OPENROUTER_API_KEY --unlimited
```

New keys are automatically saved to both your current project and global defaults for future reuse.

`OPENROUTER_API_KEY` creation requires `OPENROUTER_MANAGEMENT_KEY` to be present in env-manager's `.env.local`.

### Available keys

```bash
env-manager new-key --list
```

Shows all supported keys with descriptions.

## Workflow

### 1. Initialize a project

```bash
env-manager init
```

Creates `.env` from AWS if the project exists, otherwise creates a new template.
If `.env` is already present, `env-manager init` leaves it untouched and simply
re-syncs the configured values file with any global defaults that share a schema
entry.

If global defaults contains keys, you'll be prompted to copy them:
```
Found 1 key(s) in global defaults:
  - ANTHROPIC_API_KEY

Use ANTHROPIC_API_KEY from global defaults? (Y/n):
```

To copy all defaults without prompts:
```bash
env-manager init --yes
```

Re-running `env-manager init` later is an easy way to refresh the configured
values file with any new global defaults you've added. Only keys that exist in
`.env` are considered, so unrelated global values stay untouched.

### 2. Define your schema

Edit `.env` to add your variables with schema comments:

```bash
# env-manager: my-app | 2025-01-27T10:00:00-05:00

DATABASE_URL= # {string}
PORT=3000 # {int:min(1000),max(65535)}
DEBUG= # {optional bool}
```

### 3. Add values locally

Create the configured values file with actual values (not committed to git).
For the default `ts` format this is `.env.local`:

```bash
# env-manager: my-app | 2025-01-27T10:00:00-05:00
# env-manager env: local

DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000
DEBUG=true
```

The `.env` header date versions the schema/template. It only changes when the
stored schema changes. In `ts` mode, the values file header date versions the
actual values, and the environment comment selects which remote environment
commands use.

### 4. Generate typed env access

```bash
env-manager generate
```

Generates `src/env.ts`:

```typescript
// AUTO-GENERATED by env-manager - do not edit
import { z } from 'zod';

const env = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1000).max(65535),
  DEBUG: z.stringbool().optional(),
}).parse(process.env);

export default env;
```

### 5. Sync with AWS

```bash
# Upload to AWS Secrets Manager
env-manager up

# Download from AWS Secrets Manager
env-manager down

# Delete the remote project secret while leaving local files unchanged
env-manager rm

# Print the stored secret payload for a project
env-manager print
env-manager print my-project
env-manager print my-project -e staging
```

## AWS Configuration

The CLI uses the AWS SDK credential chain and loads `.env.local` (and `.env`) from
the env-manager package directory when it starts. It does not load `.env*` files
from whatever directory you run it in.

Set credentials in env-manager's `.env.local`:

```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

Secrets are stored in AWS Secrets Manager under `env-manager/<project-name>`.
Project secrets contain one shared schema and one values/files payload per
environment. Existing single-environment secrets are treated as `local`.

## File Structure

| File | Purpose |
|------|---------|
| `.env` | Schema, defaults, and env-manager config (committed to git) |
| `.env.local` | Default `ts` values file and non-`ts` environment selector |
| `Config/LocalSecrets.xcconfig` | Common Swift/Xcode values file |
| `src/env.ts` | Generated typed env access for `ts` mode |

## License

MIT
