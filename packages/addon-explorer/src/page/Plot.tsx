// One table as a hairline: a pulse per column, keys as peaks. Drawn at the box's real width, never scaled,
// so the stroke stays one pixel and the draw-in dash covers the whole line. On an entry each tick is a link
// to its column, and hovering or focusing it opens a tooltip that says what the column is and what its peak
// means; the arrow keys walk the ticks. The column the reader points at is shared with the columns table.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { plotPath, tickCentre, tickWidth, type Tick, type Tip } from './plot.ts';
import { tableHash } from './route.ts';

/** Before the box is measured, and in a test renderer, the plot is drawn this wide. */
const defaultWidth = 600;

/** Within this many pixels of either end, the tooltip is anchored to that end rather than centred, so it is
 *  never cut off by the box; about half the tooltip's width. */
const tipEdge = 150;

interface Props {
  ticks: Tick[];
  height: number;
  /** Stagger index for the draw-in on the home page. */
  index?: number;
  /** When given, each tick is a link to its column on the table page. */
  tableRef?: string;
  activeColumn?: string;
  className?: string;
  /** One per tick, for the tooltip; without them a tick has none. */
  tips?: Tip[];
  /** The column pointed at, here or in the columns table: its tick is lifted. */
  hover?: string;
  /** Whether the tooltip shows for `hover`: only when it was pointed at in the plot itself. */
  showTip?: boolean;
  onHover?: (column: string | undefined) => void;
}

export function Plot({ ticks, height, index = 0, tableRef, activeColumn, className, tips, hover, showTip, onHover }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(defaultWidth);
  // Escape hides the tooltip for the column in hand, and only the tooltip: focus stays on the tick, and the
  // next column pointed at shows its own again.
  const [dismissed, setDismissed] = useState<string>();
  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ← and → move between the ticks, so the line can be read one column at a time from the keyboard.
  const step = (event: KeyboardEvent<Element>, i: number) => {
    if (event.key === 'Escape') {
      setDismissed(ticks[i].column);
      return;
    }
    const to = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : -1;
    if (to < 0 || to >= ticks.length) return;
    event.preventDefault();
    svg.current?.querySelectorAll<SVGAElement>('a.plot-tick')[to]?.focus();
  };

  const d = plotPath(ticks, width, height);
  const w = tickWidth(ticks.length, width);
  const tipAt = showTip && hover !== undefined && hover !== dismissed ? ticks.findIndex((t) => t.column === hover) : -1;
  const tip = tipAt === -1 ? undefined : tips?.[tipAt];
  const x = tipAt === -1 ? 0 : tickCentre(tipAt, ticks.length, width);
  const anchor = x < tipEdge ? 'start' : x > width - tipEdge ? 'end' : 'middle';
  const drawn = (
    <svg ref={svg} className={`plot${className ? ` ${className}` : ''}`} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ '--i': index } as React.CSSProperties} aria-hidden={tableRef ? undefined : true} role={tableRef ? 'group' : undefined} aria-label={tableRef ? 'Columns, one tick each' : undefined}>
      <path d={d} pathLength={1} className="is-drawn" />
      {tableRef &&
        ticks.map((tick, i) => {
          const at = tickCentre(i, ticks.length, width);
          const active = tick.column === activeColumn;
          const lifted = tick.column === hover && !active;
          const said = tips?.[i];
          return (
            <a
              key={tick.column}
              href={tableHash(tableRef, tick.column)}
              className={`plot-tick${active ? ' is-active' : ''}${lifted ? ' is-hover' : ''}`}
              aria-label={said ? `${said.column}, ${said.type}, ${said.peak.toLowerCase()}` : tick.column}
              aria-describedby={tip && tip.column === tick.column ? 'plot-tip' : undefined}
              onMouseEnter={() => {
                setDismissed(undefined);
                onHover?.(tick.column);
              }}
              onMouseLeave={() => onHover?.(undefined)}
              onFocus={() => {
                setDismissed(undefined);
                onHover?.(tick.column);
              }}
              onBlur={() => onHover?.(undefined)}
              onKeyDown={(event) => step(event, i)}
            >
              <rect x={at - w / 2} y={0} width={w} height={height} fill="transparent" />
              {(active || lifted) && <path d={plotPath([tick], w, height)} transform={`translate(${at - w / 2} 0)`} className={active ? 'plot-active' : 'plot-hover'} />}
            </a>
          );
        })}
    </svg>
  );
  if (!tips) return drawn;
  return (
    <div className="plot-box">
      {drawn}
      {tip && <PlotTip tip={tip} tick={ticks[tipAt]} left={x} anchor={anchor} />}
    </div>
  );
}

/** The tooltip: the column and its type, its peak drawn small beside what the peak means, then the rest. */
function PlotTip({ tip, tick, left, anchor }: { tip: Tip; tick: Tick; left: number; anchor: 'start' | 'middle' | 'end' }) {
  return (
    <div id="plot-tip" role="tooltip" className={`plot-tip is-${anchor}`} style={{ left }}>
      <div className="tip-head">
        <span className="tip-name">{tip.column}</span>
        <span className="tip-type">{tip.type}</span>
      </div>
      <div className="tip-peak">
        <svg className="tip-mark" viewBox="0 0 18 14" width="18" height="14" aria-hidden="true">
          <path d={plotPath([tick], 18, 14)} />
        </svg>
        <span>
          {tip.peak}
          {tip.target && (
            <>
              {' → '}
              <span className="tip-name">
                {tip.target}.{tip.targetColumn}
              </span>
            </>
          )}
        </span>
      </div>
      {tip.description && <p className="tip-description">{tip.description}</p>}
      <p className="tip-facts">{tip.facts.join(' · ')}</p>
      {tip.protection.length > 0 && (
        <p className="tip-protection">
          {tip.protection.map((p) => (
            <span key={p.text} className="tag protect">
              {p.rank && <span className={`rank-dot rank-${p.rank}`} aria-hidden="true" />}
              {p.text}
            </span>
          ))}
        </p>
      )}
      {tip.properties.map(([name, value]) => (
        <p key={name} className="tip-property">
          <span className="prop-name">{name}:</span> {value}
        </p>
      ))}
      <p className="tip-hint">Click or Enter: its row · ← →: the next column</p>
    </div>
  );
}
