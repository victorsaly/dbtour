// Several databases in one model: which one a view is in, one of them as a model of its own, and what the home
// says of each. Pure, so it is tested in Node. With one database none of this shows: the page is that database.
import { driverName, formatBytes } from 'dbtour/markdown';
import { findTable, tableRef, type Database, type Model } from 'dbtour/model';
import type { Route } from './route.ts';

/** Every table of a database, as the model names it. */
export function tablesOf(database: Database): string[] {
  return database.schemas.flatMap((s) => s.tables.map((t) => tableRef(s.name, t.name)));
}

/**
 * The database a view is in, when all it shows is in one: a database's own home or map, a table, a diagram
 * of one database's tables. The whole map, the editor, a group and the home are in none.
 */
export function databaseOf(model: Model, route: Route): string | undefined {
  if (route.kind === 'database') return model.databases.find((d) => d.name === route.name)?.name;
  const refs = route.kind === 'table' ? [route.ref] : route.kind === 'diagram' ? route.refs : [];
  const names = new Set(refs.map((ref) => findTable(model, ref)?.database.name));
  const [only] = names;
  return names.size === 1 ? only : undefined;
}

/** One database as a model of its own, with the groups that have a table in it; undefined for a name the model lacks. */
export function onlyDatabase(model: Model, name: string): Model | undefined {
  const database = model.databases.find((d) => d.name === name);
  if (!database) return undefined;
  const mine = new Set(tablesOf(database));
  return { ...model, databases: [database], groups: model.groups.filter((g) => g.tables.some((t) => mine.has(t))) };
}

const count = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/** What the home of several says under a database's name: its kind, what it holds, and its size when read. */
export function databaseFacts(database: Database): string[] {
  const tables = database.schemas.flatMap((s) => s.tables);
  const views = tables.filter((t) => t.kind === 'view').length;
  const facts = [`${driverName(database.driver)}${database.version ? ` ${database.version}` : ''}`, count(tables.length - views, 'table')];
  if (views > 0) facts.push(count(views, 'view'));
  facts.push(count(database.relations.length, 'relation'));
  const sized = tables.filter((t) => t.stats);
  if (sized.length > 0) facts.push(formatBytes(sized.reduce((sum, t) => sum + t.stats!.dataBytes + t.stats!.indexBytes, 0)));
  return facts;
}
