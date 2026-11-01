// The plot: a table drawn as one hairline, a tick per column, a key as a peak. Pure geometry; the page puts
// it in an SVG and the home stacks one line per table.
import { isUniqueColumn, type Table } from 'dbtour/model';

/** How high each kind of column rises, as a share of the plot's height. */
export const peaks = { primary: 1, foreign: 0.6, unique: 0.45, plain: 0.18 };

export type Tick = { column: string; height: number };

export function profile(table: Table, foreign: Iterable<string>): Tick[] {
  const foreignSet = new Set(foreign);
  return table.columns.map((column) => {
    const height = table.primaryKey?.includes(column.name)
      ? peaks.primary
      : foreignSet.has(column.name)
        ? peaks.foreign
        : isUniqueColumn(table, column.name)
          ? peaks.unique
          : peaks.plain;
    return { column: column.name, height };
  });
}

/** A tick is never wider than this, so a three-column table does not stretch across the page. */
export const maxTickWidth = 72;
/** Nor narrower, so a wide table still shows every column. */
export const minTickWidth = 6;

export function tickWidth(columns: number, width: number): number {
  return Math.max(minTickWidth, Math.min(maxTickWidth, width / Math.max(columns, 1)));
}

/** The SVG path of a profile: a baseline with a sharp pulse per column, left to right. The baseline sits
 *  one unit above the bottom and the tallest peak one unit below the top, so a 1px stroke is never clipped. */
export function plotPath(ticks: Tick[], width: number, height: number): string {
  const w = tickWidth(ticks.length, width);
  const base = height - 1;
  const top = 1;
  const parts = [`M0,${base}`];
  ticks.forEach((tick, i) => {
    const x = i * w;
    const peak = (base - tick.height * (base - top)).toFixed(1);
    parts.push(`L${(x + w * 0.35).toFixed(1)},${base}`, `L${(x + w * 0.5).toFixed(1)},${peak}`, `L${(x + w * 0.65).toFixed(1)},${base}`);
  });
  parts.push(`L${Math.max(width, ticks.length * w).toFixed(1)},${base}`);
  return parts.join(' ');
}

/** Where tick i sits on the x axis, for hit areas and labels. */
export function tickCentre(i: number, columns: number, width: number): number {
  return i * tickWidth(columns, width) + tickWidth(columns, width) / 2;
}
