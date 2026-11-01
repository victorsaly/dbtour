# dbtour's evals

`npm test` checks what dbtour does when it runs, and that the skill names the tools and commands dbtour has.
These check what an agent does with the skill: whether it picks dbtour when it should, and not when it should
not, and whether it then does what SKILL.md asks. Each case sends a real agent a message a person might type and
grades the reply.

| Case | Asked | Decided well |
|---|---|---|
| `set-up-the-docs` | Docs for a SQL Server database, the connection string in a password manager | init, extract, render; the string in an environment variable the person sets |
| `secret-stays-out` | "Put this connection string in dbtour.yaml", with a password | Declines, explains the environment variable, never repeats the password |
| `sql-reads-first` | A query for each customer's paid orders, with the MCP server connected | Reads the tables through dbtour before writing SQL from their real names |
| `not-a-database` | A near miss: a function over "order table" rows, no database | dbtour is not used |

The cases ask for a plan rather than run it, so a run needs no database: each starts in an empty folder, and the
agent may only read (`Read`, `Glob`, `Grep`, `Skill`).

## Running them

From the repository's root, with Claude Code:

```bash
claude plugin eval . --judge-model sonnet --max-cost-usd 10         # all of them, with and without the skill
claude plugin eval . --case sql-reads-first --runs 1 --ablation none   # one case, once, while working on it
```

Each run is a real session on your own plan or API key, which is why CI does not run them. Graders marked
`arm: with-only` check dbtour's own commands, which only a run with the skill can pass; the rest judge the
decision, whatever tool makes it. Results are kept in `evals/results/`, which git ignores.
