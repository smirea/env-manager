# env-manager

CLI tool for managing environment variables with schema validation and AWS Secrets Manager sync.

## Installation

```bash
bun install
bun link
```

## Usage

```bash
env-manager <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `init` | Create `.env` from AWS or new template and copy matching global defaults |
| `up` | Upload `.env` schema and `.env.local` values to AWS |
| `down` | Download `.env` and `.env.local` from AWS |
| `ts [path]` | Generate typed `env.ts` file (default: `src/env.ts`) |
| `list` (`ls`) | List all projects in `env-manager/*` namespace and global keys |
| `print [project]` | Print the stored `.env`, `.env.local`, and file contents for a project |
| `global set` | Set a global default env var |
| `global get [NAME]` | Get a global default env var |
| `global list` (`global ls`) | List all global default env vars |
| `global rm <NAME>` | Remove a global default env var |
| `new-key <KEY>` | Create and add API key (e.g., `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) |
| `new-key --list` | List available keys |

### Options

| Option | Description |
|--------|-------------|
| `-p, --project <name>` | Project name (default: current directory name) |
| `-y, --yes` | Accept defaults for prompts (non-interactive) |
| `--name <name>` | OpenRouter key name (`new-key OPENROUTER_API_KEY` only; default: project name) |
| `--credit <usd>` | OpenRouter key credit limit in USD/month (`new-key OPENROUTER_API_KEY` only; default: `10`) |
| `--unlimited` | Create OpenRouter key without a credit limit (`new-key OPENROUTER_API_KEY` only) |
| `--expiration <utc-iso>` | OpenRouter key expiration (UTC ISO-8601, `new-key OPENROUTER_API_KEY` only) |
| `-h, --help` | Show help message |

## Schema Format

Define environment variable schemas as comments in your `.env` file:

```bash
#env-manager: my-project | 2025-01-27T10:00:00-05:00

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
re-syncs `.env.local` with any global defaults that share a schema entry.

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

Re-running `env-manager init` later is an easy way to refresh `.env.local`
with any new global defaults you've added. Only keys that exist in `.env`
are considered, so unrelated global values stay untouched.

### 2. Define your schema

Edit `.env` to add your variables with schema comments:

```bash
#env-manager: my-app | 2025-01-27T10:00:00-05:00

DATABASE_URL= # {string}
PORT=3000 # {int:min(1000),max(65535)}
DEBUG= # {optional bool}
```

### 3. Add values locally

Create `.env.local` with actual values (not committed to git):

```bash
DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000
DEBUG=true
```

### 4. Generate typed env access

```bash
env-manager ts
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

# Print the stored secret payload for a project
env-manager print
env-manager print my-project
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

## File Structure

| File | Purpose |
|------|---------|
| `.env` | Schema + defaults (committed to git) |
| `.env.local` | Actual values (not committed) |
| `src/env.ts` | Generated typed env access |

## License

MIT
