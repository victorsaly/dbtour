# Working on dbtour

For coding agents changing this repository. The design is in [PLAN.md](PLAN.md); read it first.

## What is where

- `packages/core`: the `dbtour` package. `src/model.ts` is the model and its validation, `src/notes.ts` the
  notes file, `src/render/` the Markdown and Mermaid, `src/search.ts` the search the page and the MCP server
  share, `src/mcp.ts` the tools `dbtour mcp` serves, `src/sql.ts` the check a query passes before a source
  runs it (`dbtour sql`, the MCP query tool, the page), `src/serve.ts` the local server behind
  `dbtour serve`, `src/workspace.ts` the databases set up in `~/.dbtour` (settings, names, the secret
  store's shape), `src/plugins.ts` how sources and add-ons are loaded, `src/cli.ts` the command. Everything
  but cli.ts and serve.ts is pure, and all of it but cli.ts at least 90% covered by `test/`.
- `packages/keychain`: `dbtour-keychain`, passwords in the system's keychain through `@napi-rs/keyring`. Core
  loads it only when a password is wanted; tests hand in a store of their own (`Io.secrets`), and never touch
  the real keychain or `~/.dbtour` (`DBTOUR_HOME` points them at a folder of their own).
- `packages/source-mssql`: SQL Server. `src/query.sql` is run as one batch and returns several result sets;
  `src/map.ts` turns the rows into a `Database` and is tested on fixture rows, no server needed.
  `test/e2e/` runs against SQL Server in Docker and is skipped when Docker is absent.
- `packages/addon-explorer`: the page. `src/index.ts` is what `render` loads: it inlines `dist/` and the model
  into one index.html. `src/page/` is the React app that esbuild bundles into `dist/` (`npm run build`, run
  for you before the tests). Its pure parts, `route.ts`, `graph.ts`, `layout.ts` and
  `prompt.ts`, `catalogue.ts` and `plot.ts`, are tested in Node; the components by `test/e2e/` in Google
  Chrome, skipped when there is none. `fonts/` holds the two OFL fonts the build inlines; `src/mark.ts` is the
  logo's geometry, which `npm run brand` draws into `brand/`. The look is recorded in `DESIGN.md`.
- `examples/shop`: a small model, its notes and config; `npm run example` renders it.
- `skills/dbtour`: the agent skill (`SKILL.md`, `reference.md`); `.claude-plugin/` makes the repository a
  Claude Code plugin that brings the skill and starts `dbtour mcp`. `scripts/test/skill.test.ts` holds both
  to the code: the MCP tools and commands they name, and their version. `evals/` checks what an agent does
  with the skill (`claude plugin eval .`, run by hand, not in CI).

## How the code is written

- TypeScript that Node 22.18+ runs as is in the repository: `.ts` in every import, nothing
  `erasableSyntaxOnly` rejects; the tests import `src/` directly. `npm run typecheck` checks it, `npm test`
  runs it. What the packages publish is compiled: Node will not strip types under node_modules, so
  `npm run build` emits each package's `dist/` (tsc, with the `.ts` imports rewritten) and `exports` and
  `bin` point there. The page's browser code is esbuild's and may use JSX and the DOM. `npm run smoke`
  installs the packed tarballs in an empty project and runs `dbtour` from there; CI runs it too.
- Comments say why, in plain words. Docs use British spelling (colour, licence).
- A source owns its driver and nothing else depends on it. Core depends on `yaml` only.
- A number that is waited for or measured is named and its value explained where it is defined.
- Errors say what to do next, in a sentence an agent can act on. Exit 1 for what was asked, 2 for what is
  missing, 3 for nothing to do.
- A connection string comes from an environment variable named in `dbtour.yaml`, never from argv or the file.

## Before you push

```bash
npm run check   # lint, typecheck, unit tests with coverage
npm run smoke   # the packed packages installed and run as a user would
```

## Rules

- Write the failing test first, then the fix.
- One pull request is one release: bump every package's version and its `dbtour` pins, the skill's
  (`metadata.version` in `skills/dbtour/SKILL.md`) and the plugin's (`.claude-plugin/plugin.json`), the README
  badge and a changelog entry marked `(unreleased)` in the same pull request. Find the number from what is released (`gh release list`).
  Merging to main does the rest: `release.yml` tags the version, creates the GitHub release from the
  changelog section and publishes to npm. `npm run release` is the same by hand, for when it could not, and
  `npm run release -- --publish` from a checkout of a tag publishes a version the workflow tagged but did
  not publish.
- Never move or replace a published tag; ship a new patch instead. The release script refuses to.
- Tests that commit pass their own identity (`git -c user.name=… -c user.email=…`).
- Other sessions may work in the main checkout at the same time: work in a `git worktree` of your own.
