// The mark as a React element, drawn from the same geometry as the favicon and the brand files.
import { markFrame, markPulse } from '../mark.ts';

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" strokeLinecap="butt" aria-hidden="true">
      <rect x={markFrame.x} y={markFrame.y} width={markFrame.size} height={markFrame.size} />
      <polyline points={markPulse} />
    </svg>
  );
}
