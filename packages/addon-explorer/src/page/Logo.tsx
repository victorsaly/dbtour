// The mark and the wordmark as React elements, drawn from the same geometry as the favicon and the brand files.
import { markCylinderBody, markCylinderTop, markPulse, wordmarkBox, wordmarkDb, wordmarkTour } from '../mark.ts';

export function Mark({ size = 20 }: { size?: number }) {
  const { cx, cy, rx, ry } = markCylinderTop;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      <path d={markCylinderBody} />
      <polyline points={markPulse} />
    </svg>
  );
}

/** The wordmark: "db" bold for the data, "tour" medium and muted for the way through it. */
export function Wordmark() {
  const { width, height } = wordmarkBox;
  return (
    <svg className="wordmark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="dbtour">
      <path d={wordmarkDb} fill="currentColor" />
      <path className="wm-tour" d={wordmarkTour} />
    </svg>
  );
}
