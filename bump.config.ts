import { defineConfig } from 'bumpp';

export default defineConfig({
    commit: 'chore: release v%s',
    tag: 'v%s',
    push: true,
    // Runs after the version is written and before the commit and tag: a failure stops the release.
    // bumpp splits this string on spaces and runs it without a shell: a `&&` chain would be passed
    // as arguments to the first command. The chain lives in the `verify` script instead.
    execute: 'pnpm verify',
});
