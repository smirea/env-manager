---
'@stefan.inc/env-manager': minor
---

New command `env-manager sync github <env>`: sets the repository's GitHub Actions secrets from a stored environment through the `gh` CLI. It syncs every variable that has a value; `--only A,B` narrows it to a whitelist, `--repo owner/name` picks the repository, and `--dry-run` names the secrets without setting them. Values go to `gh` on stdin and are never printed.
