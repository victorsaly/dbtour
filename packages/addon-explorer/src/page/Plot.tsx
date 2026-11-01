// One table as a hairline: a pulse per column, keys as peaks. Drawn at the box's real width, never scaled,
// so the stroke stays one pixel and the draw-in dash covers the whole line.
import { useEffect, useRef, useState } from 'react';
import { plotPath, tickCentre, tickWidth, type Tick } from './plot.ts';
import { tableHash } from './route.ts';

/** Before the box is measured, and in a test renderer, the plot is drawn this wide. */
const defaultWidth = 600;

interface Props {
  ticks: Tick[];
  height: number;
  /** Stagger index for the draw-in on the home page. */
  index?: number;
  /** When given, each tick is a link to its column on the table page. */
  tableRef?: string;
  activeColumn?: string;
  className?: string;
}

export function Plot({ ticks, height, index = 0, tableRef, activeColumn, className }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(defaultWidth);
  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const d = plotPath(ticks, width, height);
  const w = tickWidth(ticks.length, width);
  return (
    <svg ref={svg} className={`plot${className ? ` ${className}` : ''}`} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ '--i': index } as React.CSSProperties} aria-hidden={tableRef ? undefined : true} role={tableRef ? 'img' : undefined}>
      {tableRef && <title>{ticks.map((t) => t.column).join(', ')}</title>}
      <path d={d} pathLength={1} className="is-drawn" />
      {tableRef &&
        ticks.map((tick, i) => {
          const x = tickCentre(i, ticks.length, width);
          const active = tick.column === activeColumn;
          return (
            <a key={tick.column} href={tableHash(tableRef, tick.column)} className={`plot-tick${active ? ' is-active' : ''}`}>
              <title>{tick.column}</title>
              <rect x={x - w / 2} y={0} width={w} height={height} fill="transparent" />
              {active && <path d={plotPath([tick], w, height)} transform={`translate(${x - w / 2} 0)`} className="plot-active" />}
            </a>
          );
        })}
    </svg>
  );
}
