# Contributing

Issues and pull requests are welcome.

```sh
pnpm install
pnpm check        # Biome: format and lint
pnpm typecheck
pnpm test
pnpm build
```

- Keep the SDK free of runtime dependencies.
- Code that touches the DOM goes in `src/browser.ts`; the core (`src/index.ts`) must run on Node and edge runtimes.
- A change to a request or a response matches the StakPass partner API. Add a test with a mocked `fetch`.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Releases: `pnpm release` (bumpp).

## Security

Do not open a public issue for a vulnerability. Contact StakPass privately.
