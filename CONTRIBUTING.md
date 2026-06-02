# Contributing

Thanks for taking the time to contribute!

## Development

Requires Node >= 18 and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm verify        # lint, typecheck (both decorator modes), coverage, build, runtime integration, publint, attw
```

Handy scripts:

| Script | Purpose |
| --- | --- |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Watch mode |
| `pnpm coverage` | Unit tests with coverage (100% threshold) |
| `pnpm lint:fix` | Apply Biome lint/format fixes |
| `pnpm build` | Build dual ESM/CJS + types |
| `pnpm test:runtime` | Real `@`-decorator integration tests (legacy + Stage-3) |

## Pull requests

- `main` is protected: every change lands via a PR, and CI (`verify` on Node
  18/20/22) must pass. History is linear — PRs are squashed or rebased.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for titles
  (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`, ...).
- Add or update tests for any behavior change. Coverage must stay at 100%.
- Keep PRs focused.

## Reporting issues

Use the issue templates for bugs and feature requests. For security problems,
see [SECURITY.md](./SECURITY.md).
