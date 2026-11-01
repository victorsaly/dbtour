// The first view: what the model holds, the groups, and how to move around.
import { driverName } from 'dbtour/markdown';
import type { Model } from 'dbtour/model';
import { groupHash, tableHash } from './route.ts';

export function Home({ model }: { model: Model }) {
  return (
    <article className="page home">
      {model.databases.map((database) => {
        const tables = database.schemas.flatMap((s) => s.tables);
        const views = tables.filter((t) => t.kind === 'view').length;
        return (
          <section key={database.name}>
            <h1>{database.name}</h1>
            <p className="meta">
              {driverName(database.driver)}
              {database.version ? ` ${database.version}` : ''} · {tables.length - views} tables · {views} views · {database.relations.length} relations
            </p>
            {database.description && <p className="description">{database.description}</p>}
          </section>
        );
      })}
      {model.groups.length > 0 && (
        <section>
          <h2>Groups</h2>
          <div className="cards">
            {model.groups.map((group) => (
              <div className="card" key={group.name}>
                <h3>
                  <a href={groupHash(group.name)}>{group.name}</a>
                </h3>
                {group.description && <p>{group.description}</p>}
                <p className="links">
                  {group.tables.map((ref) => (
                    <a key={ref} href={tableHash(ref)}>
                      {ref}
                    </a>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="hint">
        <p>
          Press <kbd>/</kbd> to search tables and columns. A table page lists its columns and relations; <em>Diagram</em> draws it with its neighbours, and <em>+</em> on any
          node adds that table's neighbours too.
        </p>
      </section>
    </article>
  );
}
