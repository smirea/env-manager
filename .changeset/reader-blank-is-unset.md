---
'@stefan.inc/env-manager': minor
---

Generated readers treat an empty value as unset. A required variable that is blank now fails with its name instead of passing as `''` (or as `0` for a number), which is what the tracked `.env` placeholders produced under any dotenv loader. Regenerate with `env-manager generate`; the `optional()` helper is gone and optional fields read `.optional()`.
