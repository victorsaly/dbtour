// A table's size, read apart from its plot: the plot is the columns and keys, the size bar is the bytes.
// Lengths are linear, so half the length is half the bytes, and every figure is named beside its bar.
import { driverName, formatBytes, formatCount } from 'dbtour/markdown';
import type { Table, TableStats } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';

/**
 * The bar's two parts as shares of the whole length: data then indexes, the table's bytes against `largest`
 * (the largest table's bytes on the home, the table's own on its entry).
 */
export function barShares(stats: TableStats, largest: number): { data: number; indexes: number } {
  if (largest <= 0) return { data: 0, indexes: 0 };
  return { data: stats.dataBytes / largest, indexes: stats.indexBytes / largest };
}

/** 1st, 2nd, 3rd, 4th; 11th to 13th are the exceptions English keeps. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Where a table stands by rows among those with stats, in words; nothing for a view or a table alone. */
export function rankByRows(cat: Catalogue, ref: string): string | undefined {
  const counted = cat.entries.filter((e) => e.stats);
  const entry = counted.find((e) => e.ref === ref);
  if (!entry || counted.length < 2) return undefined;
  const rank = 1 + counted.filter((e) => e.stats!.rows > entry.stats!.rows).length;
  const of = `of ${counted.length} tables by rows`;
  if (rank === 1) return `the largest ${of}`;
  if (rank === counted.length) return `the smallest ${of}`;
  return `the ${ordinal(rank)} largest ${of}`;
}

/**
 * What each figure of a table's size is, as its database counts it: SQL Server estimates the rows from its
 * catalogue; SQLite's are the cells of the table's pages, counted when it was read.
 */
export function sizeTerms(driver: string): { rows: string; data: string; indexes: string } {
  if (driver === 'sqlite') {
    return {
      rows: 'Counted from the cells of its pages in the file, as it was when read: no row is read to make it.',
      data: 'The pages the rows sit on: the table\'s own b-tree.',
      indexes: 'The pages every index takes beside it, a UNIQUE\'s among them.',
    };
  }
  return {
    rows: `${driverName(driver)}'s own count of the rows, an estimate: no row is read to make it.`,
    data: `The pages the rows sit on: the table itself${driver === 'mssql' ? ', its heap or clustered index' : ''}.`,
    indexes: 'The pages every other index takes beside it.',
  };
}

/**
 * What an index line says over its bar: rows and size; for a view, that it keeps none; and for a table the
 * source gave no stats, nothing, since a missing count is not an empty table.
 */
export function sizeCaption(stats: TableStats | undefined, kind: Table['kind']): string {
  if (stats) return `${formatCount(stats.rows)} rows · ${formatBytes(stats.dataBytes + stats.indexBytes)}`;
  return kind === 'view' ? 'no rows of its own' : '';
}
