# env-manager

utility to manage my own environment variables for all my personal projects

## Features

1. define environment schema per project

    schema + defaults are embedded as comments in the `.env` file. format: `# {optional?, type:validators?}`. example:

    ```
    # env-manager: project-name | 2025-01-15T10:30:00-05:00

    FOO= # {optional float}
    # {string}
    BAR='some default value'
    API_KEY= # {string:format(/^openai-key_\w+/)}
    PORT=3000 # {int:min(3000),max(10000)}
    DEBUG= # {optional bool}
    CALLBACK= # {url}
    ADMIN= # {optional email}
    ```

2. store projects in aws secrets manager (both schema and data) in namespace `env-manager/<project>`

    single-project values output uses optional `# env-manager format: ts|swift`, `# env-manager path: <path>`, and `# env-manager generate: <reader path>`. TS defaults are `.env.local` and `src/env.ts` with `package.json`; Swift values default to `Config/LocalSecrets.xcconfig`. Legacy `values.format`, `values.path`, and `ts` metadata are still readable but cannot be duplicated with new names.

3. cli script

    3.1. `env-manager up [-p --project=<name>]` - uploads `.env` schema and configured values. `.env` date only changes when the schema/template changes from AWS; the values file date only changes in `ts` mode when values change. defaults project to the `.env` header, then basename of cwd

    3.2. `env-manager down [-p --project=<name>]` - syncs `.env` and configured values from aws, preserving the stored schema date and writing the stored value date in `ts` mode

    3.3. `env-manager generate [path]` - materializes local values and TS readers (default `src/env.ts`). Swift produces values only. `--target <name>` selects one monorepo target. Alias: `gen`; deprecated `ts` forwards to `generate` with a warning. `--local` skips automatic Git updates

    3.4. `env-manager init [-p --project=<name>] [--values-format ts|swift --values-path <path>]` - creates `.env` from aws if project exists, otherwise creates empty template with header. `--local` skips AWS credentials, remote project lookup, global defaults, and automatic Git updates

    3.5. `env-manager list` - lists all projects in `env-manager/*` namespace

    3.6. `env-manager new-key <provider> [env_name]` - creates API key via provider, adds to configured values, syncs to AWS. auto-adds schema entry if missing.

    3.7. `env-manager set <field> <value>` - sets `.env` config fields like `values.format` and `values.path`

    `# env-manager local:true` persists local mode. Explicit `--local`/`--no-local` overrides it for one invocation; `init --local` persists it. Local mode skips all AWS and Git updates. Storage commands fail before credentials; `--no-local` permits them. `set local true|false`, `check`, `format`, and `env set` work locally. The stored `# env-manager ts: <path>` remains compatible.

    flags:
    - `-p, --project <name>`: project name (defaults to `.env` header, then cwd basename)
    - `-y, --yes`: accept defaults for prompts (non-interactive)

## Root configuration and targets

Ordinary projects need no target sections. Monorepos use one-line declarations,
for example `# env-manager target: client format=ts path=.env.local generate=src/env.ts`.
Paths are relative to the target directory. Swift targets use `format=swift` and
cannot declare `generate`. `# env-manager targets: client,server` selects a scope
until replaced by the next selection; `targets: *` selects all. Every variable is
defined once and every target selected at least once; empty sections are valid.

Monorepos always use root `.env.local` as their values/environment source. Child
files are generated subsets with project, target, environment, and a relative
`root` ownership pointer. Child commands resolve the root. AWS stores one root
schema and one values/files payload per environment.

`check` validates config and all planned paths without writing. `check --strict`
also requires types on legacy variables. New output settings or target declarations
require types; `local` alone does not. `format` preserves values, comments, order,
and scopes. Unknown metadata, duplicate settings/variables/targets/selections,
invalid defaults or validators, unused/unknown targets, output collisions,
symlink escapes, and foreign ownership are errors with file and line diagnostics.
Preflight completes before generation writes any files.

## Key Providers

Providers automate API key creation via browser automation (`claude --chrome`).

| Provider | Default Env Name | Key Format |
|----------|-----------------|------------|
| `claude` | `ANTHROPIC_API_KEY` | `sk-ant-*` |

Usage:
```bash
env-manager new-key claude              # uses ANTHROPIC_API_KEY
env-manager new-key claude MY_API_KEY   # uses custom env name
```

## Schema Types

| Type | Validators | Example |
|------|-----------|---------|
| `string` | `format(regex)` | `# {string:format(/^sk-/)}` |
| `int` | `min(n)`, `max(n)` | `# {int:min(0),max(100)}` |
| `float` | `min(n)`, `max(n)` | `# {float:min(0.0)}` |
| `bool` | - | `# {bool}` |
| `url` | - | `# {url}` |
| `email` | - | `# {email}` |

All types can be prefixed with `optional` (e.g., `# {optional string}`).

## Validation

- every command validates before executing
- CLI uses custom parser to extract schema from `.env` comments
- CLI coerces values (string → int/float/bool) and throws on validation failure
- defaults are always applied when present, even on optional keys
- int/float parsing is strict (no trailing junk), regex validators reset state
- project names cannot contain spaces or "|" and headers must match `--project`
- validator parsing is strict and rejects unknown or invalid validators
- header detection tolerates leading non-schema comments before the header
- file sync only supports UTF-8 text; binary files are rejected
- latest matching version is source of truth: `.env` tracks schema/template version, `ts` values files track value version

## Generated TypeScript (env-manager generate)

```ts
// src/env.ts - generated by env-manager
import { z } from 'zod';

const env = z.object({
  FOO: z.coerce.number().optional(),
  BAR: z.string(),
  API_KEY: z.string().regex(/^openai-key_\w+/),
  PORT: z.coerce.number().int().min(3000).max(10000),
  DEBUG: z.stringbool().optional(),
  CALLBACK: z.url(),
  ADMIN: z.email().optional(),
}).parse(process.env);

export default env;
```

## File Structure

```
src/
  cli.ts          # entry point, arg parsing
  commands/
    up.ts
    down.ts
    generate.ts
    init.ts
    list.ts
    new-key.ts
  providers/
    index.ts      # provider interface and registry
    claude.ts     # claude provider (browser automation)
  parser.ts       # .env schema parser
  validator.ts    # validation with coercion
  aws.ts          # secrets manager (aws cli only)
parser.test.ts    # bun test for parser
```

## Future Features

- `env-manager diff` - show differences between local and remote
- multiple environments (dev/staging/prod)
