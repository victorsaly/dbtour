# Working on dbtour

For coding agents changing this repository. The design is in [PLAN.md](PLAN.md); read it first.

## What is where

- `packages/core`: the `dbtour` package. `src/model.ts` is the model and its validation, `src/notes.ts` the
  notes file, `src/render/` the Markdown and Mermaid, `src/plugins.ts` how sources and add-ons are loaded,
  `src/cli.ts` the command. Everything but cli.ts is pure and at least 90% covered by `test/`.
- `packages/source-mssql`: SQL Server. `src/query.sql` is run as one batch and returns several result sets;
  `src/map.ts` turns the rows into a `Database` and is tested on fixture rows, no server needed.
  `test/e2e/` runs against SQL Server in Docker and is skipped when Docker is absent.
- `examples/shop`: a small model, its notes and config; `npm run example` renders it.

## How the code is written

- TypeScript that Node 22.18+ runs as is: no build step, `.ts` in every import, nothing `erasableSyntaxOnly`
  rejects. `npm run typecheck` checks it, `npm test` runs it.
- Comments say why, in plain words. Docs use British spelling (colour, licence).
- A source owns its driver and nothing else depends on it. Core depends on `yaml` only.
- A number that is waited for or measured is named and its value explained where it is defined.
- Errors say what to do next, in a sentence an agent can act on. Exit 1 for what was asked, 2 for what is
  missing, 3 for nothing to do.
- A connection string comes from an environment variable named in `dbtour.yaml`, never from argv or the file.

## Before you push

```bash
npm run check   # lint, typecheck, unit tests with coverage
```

## Rules

- Write the failing test first, then the fix.
- One pull request is one release: bump every package's version, the README badge and a changelog entry
  marked `(unreleased)` in the same pull request. Find the number from what is released (`gh release list`).
- Never move or replace a published tag; ship a new patch instead.
- Tests that commit pass their own identity (`git -c user.name=… -c user.email=…`).
- Other sessions may work in the main checkout at the same time: work in a `git worktree` of your own.
