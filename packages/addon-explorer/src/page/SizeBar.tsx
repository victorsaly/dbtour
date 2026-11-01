// A size as a bar: data solid, indexes outlined, lengths in proportion to bytes. The figures are always
// written beside it by the caller; the bar only shows how they compare.
import { formatBytes } from 'dbtour/markdown';
import type { TableStats } from 'dbtour/model';
import { barShares } from './size.ts';

export function SizeBar({ stats, largest }: { stats: TableStats; largest: number }) {
  const { data, indexes } = barShares(stats, largest);
  const part = (kind: string, share: number) => (
    // A part with any bytes keeps a pixel, so a small table still shows it has some.
    <span className={`size-${kind}${share > 0 ? ' is-some' : ''}`} style={{ width: `${share * 100}%` }} />
  );
  return (
    <span className="size-bar" role="img" aria-label={`${formatBytes(stats.dataBytes)} of data, ${formatBytes(stats.indexBytes)} of indexes`}>
      {part('data', data)}
      {part('indexes', indexes)}
    </span>
  );
}

/** The two swatches the legends name the parts with. */
export function Swatch({ kind }: { kind: 'data' | 'indexes' }) {
  return <span className={`swatch swatch-${kind}`} aria-hidden="true" />;
}
