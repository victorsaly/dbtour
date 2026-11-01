// The dbtour mark: a table's profile as a pulse inside a square frame, one geometry at every size. Shared
// by the page (the header, the nodes), the favicon that index.ts inlines, and the brand files in brand/.

/** The frame and the pulse, in a 24-unit box. The pulse is three ticks: a plain column, a key, a foreign key. */
export const markFrame = { x: 1.5, y: 1.5, size: 21 };
export const markPulse = '4,16 7,16 8,12 9,16 11,16 12,7 13,16 15,16 16,10 17,16 20,16';

export function markSvg(size: number, ink: string, strokeWidth = 1.5): string {
  const { x, y, size: s } = markFrame;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="${strokeWidth}" stroke-linejoin="miter" stroke-linecap="butt">` +
    `<rect x="${x}" y="${y}" width="${s}" height="${s}"/>` +
    `<polyline points="${markPulse}"/>` +
    `</svg>`
  );
}

/** For <link rel="icon">: the mark as a data URI, in the ink that reads on both light and dark tabs. */
export function markDataUri(ink = '#8c8c8c'): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(32, ink, 2))}`;
}
