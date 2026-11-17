---
'@stefan.inc/env-manager': patch
---

`generate` no longer bumps the version of a file that already holds what it would write. A reader pulled from git used to be rewritten with a higher `| vN` whenever the checkout's own record was older, so every pull left a version-only diff. A version now changes only when values or the schema change, and `up` compares content instead of version labels when deciding whether to upload.
