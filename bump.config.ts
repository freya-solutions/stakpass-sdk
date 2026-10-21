import { defineConfig } from 'bumpp';

export default defineConfig({
    commit: 'chore: release v%s',
    tag: 'v%s',
    push: true,
    // Runs after the version is written and before the commit and tag: a failure stops the release.
    execute: 'pnpm check && pnpm typecheck && pnpm test && pnpm build',
});
