// The dbtour mark: a database cylinder with a table's pulse running through it, one geometry at every size.
// Shared by the page (the header), the favicon that index.ts inlines, and the brand files in brand/.

/** The cylinder, in a 24-unit box: the top ellipse and the body closed by the bottom arc. */
export const markCylinderTop = { cx: 12, cy: 6.5, rx: 8.5, ry: 3 };
export const markCylinderBody = 'M3.5,6.5 V17.5 A8.5,3 0 0 0 20.5,17.5 V6.5';
/** The pulse across the body: a plain column, a key, a foreign key. */
export const markPulse = '3.5,14.5 6.5,14.5 8,11 9.5,14.5 11.5,14.5 13,12 14.5,14.5 16.5,14.5 17.5,13 18.5,14.5 20.5,14.5';

export function markSvg(size: number, ink: string, strokeWidth = 1.5): string {
  const { cx, cy, rx, ry } = markCylinderTop;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="${strokeWidth}" stroke-linejoin="miter" stroke-linecap="butt">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>` +
    `<path d="${markCylinderBody}"/>` +
    `<polyline points="${markPulse}"/>` +
    `</svg>`
  );
}

/** For <link rel="icon">: the mark as a data URI, in the ink that reads on both light and dark tabs. */
export function markDataUri(ink = '#8c8c8c'): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(32, ink, 2))}`;
}
