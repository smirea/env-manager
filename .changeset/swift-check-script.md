---
'@stefan.inc/env-manager': minor
---

Swift targets can generate a check script: `generate=Config/check-env.sh` on a `format=swift` target (or `env-manager generate Config/check-env.sh` in a single Swift project) writes an executable `sh` script to commit. Run it as the Xcode target's first Run Script phase and a build or archive fails, naming each variable, when a required setting is unset or malformed. It never prints a value.
