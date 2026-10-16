// Git hooks export GIT_DIR/GIT_INDEX_FILE; inherited by the git calls in tests, they redirect
// `git init`/`git config` on temp repos into the repo running the hook.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_')) delete process.env[name];
}
