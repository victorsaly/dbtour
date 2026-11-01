// The mark as a React element, drawn from the same geometry as the favicon and the brand files.
import { markCylinderBody, markCylinderTop, markPulse } from '../mark.ts';

export function Mark({ size = 20 }: { size?: number }) {
  const { cx, cy, rx, ry } = markCylinderTop;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" strokeLinecap="butt" aria-hidden="true">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      <path d={markCylinderBody} />
      <polyline points={markPulse} />
    </svg>
  );
}

/** The wordmark: "db" in the mono face for the data, "tour" in the sans for the way through it. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wm-db">db</span>
      <span className="wm-tour">tour</span>
    </span>
  );
}
