# Using Varlock schemas in env-manager

Research date: 2026-09-15. Inspected the current env-manager source, 21 top-level repos with env-manager-marked `.env` files under `/Users/stefan/code`, representative consumers, current Varlock documentation, and published `varlock@1.19.0` and `@env-spec/parser@0.5.2` packages. Runtime probes used synthetic values in a temporary directory. No project secrets or remote AWS payloads were read or changed.

## Recommendation

Adopt Varlock-style schema annotations through `@env-spec/parser`, initially keeping env-manager's storage, commands, values outputs, and generated Zod modules. Start with a documented static subset and retain `.env` for existing projects. Treat a move to `.env.schema` and the full Varlock runtime as separate migrations.

This improves schema documentation and gives us a path into Varlock tooling with little new setup per repo. Replacing the entire runtime now would add configuration work across Bun, Vite, Electron, Expo, Xcode, and deployment tooling. Most current schemas are simple strings, ports, URLs, and API keys, so they would gain little from dynamic resolution today.

The distinction matters: **env-spec defines syntax; Varlock defines what the decorators and functions do.** Using the parser alone does not give us validation, secret resolution, imports, redaction, or runtime protection. We would still maintain the supported semantic mapping. [env-spec overview](https://varlock.dev/env-spec/overview/), [syntax reference](https://varlock.dev/env-spec/reference/).

## What the other repos actually use

The inventory found 21 marked repos, including env-manager itself. This is a local checkout sample, not an exhaustive inventory of deployed projects. Values were omitted from the inventory output.

| Repo | Observed usage | Migration consequence |
| --- | --- | --- |
| nudge, agent-manager | Root schema; generated `packages/shared/src/env.ts`; server/UI scripts explicitly load `../../.env` and `../../.env.local`. Agent-manager adds Electron scripts and booleans. | Changing comments is cheap. Renaming the file or changing loading requires script changes across packages. |
| vitals | Server Zod module, Bun `--env-file`, shell `source .env`, Vite `loadEnv`, Expo public variables. | Several loaders must agree. Some client variables have no schema annotations today. |
| read-to-me | `GOOGLE_APPLICATION_CREDENTIALS` has `{file}`; the app expects a credential-file path. | Must preserve file restoration, not replace a path with file contents. |
| home-mac, mac-appbar | GitHub/App Store credentials use `{file}`. | Same file-sync requirement. |
| memeforge | Explicit Swift output to `Config/LocalSecrets.xcconfig`; Xcode checks that file and instructs users to run `env-manager down`. | Keep the xcconfig writer. Injecting process env into a CLI does not replace this build configuration. |
| research-austin | GitHub Actions directly reads AWS secret `env-manager/research-austin`, then `.environments.local.values`. | Preserve remote payload structure even if the schema syntax changes. |
| scripts | Many optional strings, regex validation, URL types, generated Zod. | Useful pilot for optionality and validation behavior. |
| botopia, new-you-times | Some or all defaults lack annotations. | Current parser excludes these from validation/codegen. Varlock includes and infers them. |

Additional coupling lives outside the app being migrated. `home-mac/src/setupRepoContainer.ts` detects `.env` before invoking env-manager and combines `.env` plus `.env.local` into deployment values. `home-mac/src/github.ts` also detects the `.env` filename and env-manager marker. Vitals launches scripts from the scripts repo with explicit `.env` paths. The starter template in `stefan-utils/scripts/setup-new-app/files/svelte` also contains env-manager conventions.

A filename migration must update those consumers, not just env-manager.

## Schema mapping

Most annotations have an obvious syntactic equivalent:

| Current | Varlock-style equivalent | Caveat |
| --- | --- | --- |
| `{string}` | `@type=string` | Declare requiredness explicitly or through the header. |
| `{string:format(/^sk-/)}` | `@type=string(matches=/^sk-/)` | `startsWith=sk-` also expresses this particular prefix check. |
| `{int:min(1),max(65535)}` | `@type=number(isInt=true,min=1,max=65535)` | Not equivalent validation; see the runtime probe below. |
| `{float:min(0)}` | `@type=number(min=0)` | Numeric coercion needs compatibility checks. |
| `{bool}` | `@type=boolean` | Accepted input spellings differ. |
| `{url}`, `{email}` | `@type=url`, `@type=email` | Check edge cases against our validator and generated Zod. |
| `{optional string}` | `@optional @type=string` | Keep optionality explicit. |
| `{file}` | `@type=string` plus env-manager file metadata | There is no equivalent built-in sync-and-restore type. |

Varlock adds enums, richer string constraints, arrays, documentation links, and sensitivity metadata. [Data types](https://varlock.dev/reference/data-types/).

A proposed static schema can keep the current filename and metadata:

```dotenv
# env-manager: example | 2026-09-15T00:00:00Z
# env-manager ts: src/env.ts
# @defaultRequired=true
# @defaultSensitive=false
# ---

# @type=url
SERVER_URL=http://localhost:3000

# @type=string(matches=/^sk-or-v1-/) @sensitive
OPENROUTER_API_KEY=

# @type=boolean @optional
DEBUG=
```

This is an example, not an applied migration. The old env-manager parser does not understand these annotations. Ordinary dotenv loaders can ignore the comment annotations while loading these literal defaults.

Explicit root defaults avoid inheriting Varlock init's `@defaultRequired=infer`, which makes empty declarations optional. Sensitive values should be marked deliberately; public client configuration must remain usable by browser/mobile builds. [Root decorators](https://varlock.dev/reference/root-decorators/).

## Compatibility issues confirmed by probes

Installed the published packages outside the repo with install scripts disabled and ran `varlock load --format json` against synthetic fixtures. Compared relevant cases against our actual `parseEnvFile` and `validateEnv` functions.

| Case | Current env-manager | Varlock 1.19.0 |
| --- | --- | --- |
| Integer input `3.7` | Rejects it | `number(isInt=true)` returns `4` |
| Boolean input `t` | Rejects it | Returns `true` |
| Schema `KEY=default`, values file `KEY=` | Required-variable error | Keeps `default` |
| Unknown `@envManagerFile` decorator | Not applicable | Fails with unknown-decorator error |
| `@setValuesBulk("KEY=example", format=env)` | Not supported | Loads `KEY=example` |

The parser successfully reads regular env-manager header comments and supports updating decorators. Its serializer removed the trailing newline in the probe, so schema versioning and round-trip writes need deliberate normalization.

Other compatibility traps:

- Our parser only includes annotated entries. Varlock considers unannotated entries too. A converter must flag those instead of silently changing the generated interface.
- Vitals contains `HOME= # {string optional}`. Our parser silently ignores this malformed annotation; the valid current spelling is `{optional string}`. Migration should surface it for correction.
- Moving defaults into `.env.schema` makes them invisible to existing ordinary `.env` loaders. Our generated Zod module only parses `process.env`; it does not load defaults itself. Either preserve `.env`, emit a compatible defaults file, or change the loaders.
- Full env-spec values can use expansion, functions, and multiline syntax that shell `source` and ordinary dotenv consumers do not share. Keep initial values literal, with deliberate quoting/escaping, or materialize resolved output before those consumers read it.
- Our `# env-manager env: staging` marker selects an AWS values slot and defaults to `local`. Varlock uses `@currentEnv` and environment-specific file layering, with process overrides taking precedence. These mechanisms need an explicit bridge; the comment alone has no meaning to Varlock. [Schema value semantics](https://varlock.dev/guides/schema/), [environments](https://varlock.dev/guides/environments/).

## Three implementation choices

| Choice | Work in env-manager | Extra work per repo | What we gain |
| --- | --- | --- | --- |
| Static schema adapter | Parse env-spec; map supported annotations to our schema model; update writers and converter. | Convert comments. Existing loaders and imports can stay. | Better schema notation, metadata, access to syntax tooling. Still own validation/codegen. |
| Full Varlock validation/resolution during env-manager commands | Load/resolve with Varlock, preserve our sync/output adapters, decide how runtime validation remains consistent. | Limited if output stays plain dotenv/xcconfig; more if new types change generated modules. | Richer schema behavior at sync time. Imports/functions require dependency and storage rules. |
| Varlock at application startup | Retain or replace AWS sync; wire Varlock into apps and builds. | Update startup commands, Bun config, framework integration and CI. | Live resolution, Varlock types and applicable runtime protections. |

The published Varlock root API exposes `load()`, but the configurable `loadEnvGraph` entry point sits under `internal`. An embedded integration should pin its version and test that boundary. The CLI's JSON output is another option, with subprocess and environment-isolation costs. Neither warrants calling the integration a drop-in parser replacement.

For full runtime adoption, Bun's auto-loading can pre-populate values before Varlock gets control. Varlock recommends `env = false` in `bunfig.toml` or `--no-env-file`. That is a real change for the sampled repos. Varlock TypeScript codegen targets `ENV` and environment type augmentation, not our standalone Zod modules; we could preserve existing import paths through a wrapper, but loading still has to occur before use. [Bun integration](https://varlock.dev/integrations/bun/), [code generation](https://varlock.dev/guides/code-generation/).

Schema annotations alone do not enable log redaction or protect secret files from agents. Those benefits require the relevant runtime, encryption, or agent integration.

## AWS, file sync, and cross-repo reuse

Our payload contains raw schema text and an environment map. Each environment contains a dotenv values string, timestamp, and optional file contents. A syntax migration can leave that shape intact. Existing deployments reading values can keep working.

Old env-manager clients are a different problem: they would ignore the new annotations, potentially skip validation and file handling, or fail codegen. Deploy dual-format readers to the machines that use env-manager before converting shared remote schemas. Do not maintain two independently editable schema files. A format/version marker helps new clients, but cannot make already-installed old clients reject a format they do not understand.

Varlock's AWS plugin can retrieve secrets, but is not a direct reader for this nested payload. Its current JSON-key extraction uses a top-level property lookup; our actual values are a dotenv string under `environments[environment].values`. Options are to keep `env-manager down`, add a resolver/command that extracts the selected dotenv string and feed `@setValuesBulk`, or migrate storage. File restoration remains separate. [AWS plugin docs](https://varlock.dev/plugins/aws-secrets/), [AWS plugin source](https://github.com/dmno-dev/varlock/blob/main/packages/plugins/aws-secrets/src/plugin.ts).

Retaining `down` also retains today's credential setup. Direct runtime AWS access requires AWS authentication wherever the app loads configuration, plus plugin setup and handling of network/cache behavior. Our CLI currently loads its own credentials from the env-manager installation; consumer apps do not inherit that mechanism automatically.

Varlock can share local schema/value files using `@import`, including a home-directory file and filtered key imports. This is useful within a monorepo. Across independent repos, a shared file still has to be provisioned on every machine and in CI; a sibling checkout path makes bootstrapping more fragile. Imported schemas also exceed our current single-schema-string backup model unless we store the dependencies or explicitly require them from Git. [Imports](https://varlock.dev/guides/import/).

Our existing global defaults already copy matching shared keys into projects during `init`. Keeping that behavior gives the simplest cross-repo setup. Live imports/resolvers would propagate later rotations without another copy, but introduce a shared runtime dependency. Varlock does not by itself replace our global-default management, API-key creation, up/down workflow, or xcconfig writer.

## Suggested scope and effort

Engineering estimates, not measured implementation times:

1. **One-day spike:** map the actual schema inventory using the published parser; verify representative literals, optionality, regexes, and Zod output; decide whether to preserve or adopt Varlock numeric/empty-value behavior.
2. **Roughly 2–4 additional days for a usable static migration:** dual-format reader, supported-feature errors, converter, annotation-aware writers, file metadata, regression coverage, docs, and pilot repos. Retain `.env` initially and ordinary comments for env-manager-only settings so stock Varlock does not reject unknown decorators.
3. **Separate, larger runtime rollout:** expect at least a week across representative app/build/deployment paths, potentially longer for file credentials and Xcode. Validate scope in the spike rather than committing to a fleet-wide estimate.

Pilot nudge for the common monorepo layout, scripts for validation, read-to-me for files, and memeforge for Swift. Check research-austin's payload consumer and home-mac's deployment paths before changing filename or storage.

The practical answer is that adopting the notation can keep setup almost unchanged. Adopting the entire Varlock execution model means more setup now, with a payoff if we actually want dynamic secrets, shared schema imports, richer types, and runtime protections.
