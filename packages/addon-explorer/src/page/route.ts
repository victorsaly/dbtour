// Every view has a URL in the hash, so a link opens the same view and the page works from a file:
// #dbo.Orders, #dbo.Orders.Status (that column highlighted), #diagram/dbo.Orders,dbo.Customers, #group/Billing.
// With several databases a ref carries its own: #Sales:dbo.Orders.
import { findTable, type Model } from 'dbtour/model';

export type Route =
  | { kind: 'home' }
  | { kind: 'table'; ref: string; column?: string }
  | { kind: 'diagram'; refs: string[] }
  | { kind: 'group'; name: string }
  /** #map: the whole catalogue as a graph. */
  | { kind: 'map' };

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  if (raw === '') return { kind: 'home' };
  const slash = raw.indexOf('/');
  const head = slash === -1 ? raw : raw.slice(0, slash);
  const rest = slash === -1 ? '' : raw.slice(slash + 1);
  if (head === 'map' && rest === '') return { kind: 'map' };
  if (head === 'diagram') {
    // A ref that is not schema.table is dropped; the rest still draw, and none at all goes home.
    const refs = rest.split(',').filter((r) => r !== '').map(decode).filter(isRef);
    return refs.length > 0 ? { kind: 'diagram', refs } : { kind: 'home' };
  }
  if (head === 'group') return rest === '' ? { kind: 'home' } : { kind: 'group', name: decode(rest) };
  const parts = decode(raw).split('.');
  if (parts.some((p) => p === '')) return { kind: 'home' };
  if (parts.length === 2) return { kind: 'table', ref: `${parts[0]}.${parts[1]}` };
  if (parts.length === 3) return { kind: 'table', ref: `${parts[0]}.${parts[1]}`, column: parts[2] };
  // #Orders or a longer dotted path is nothing the page can show; home rather than a crash.
  return { kind: 'home' };
}

/** schema.table, both parts present. */
function isRef(text: string): boolean {
  const parts = text.split('.');
  return parts.length === 2 && parts.every((p) => p !== '');
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#';
    case 'table':
      return `#${encode(route.column === undefined ? route.ref : `${route.ref}.${route.column}`)}`;
    case 'diagram':
      return `#diagram/${route.refs.map(encode).join(',')}`;
    case 'group':
      return `#group/${encode(route.name)}`;
    case 'map':
      return '#map';
  }
}

/**
 * The route with each ref as the model names it, so a link written before a second database was added,
 * #dbo.Orders, opens Sales:dbo.Orders when only Sales has it. A name both databases have stays as written,
 * and the table view says it is not one table.
 */
export function canonicalRoute(route: Route, model: Model): Route {
  const named = (ref: string) => findTable(model, ref)?.ref ?? ref;
  if (route.kind === 'table') return { ...route, ref: named(route.ref) };
  if (route.kind === 'diagram') return { ...route, refs: route.refs.map(named) };
  return route;
}

export const tableHash = (ref: string, column?: string): string => routeHash({ kind: 'table', ref, column });
export const diagramHash = (refs: string[]): string => routeHash({ kind: 'diagram', refs });
export const groupHash = (name: string): string => routeHash({ kind: 'group', name });
export const mapHash = '#map';

/** Dots and colons stay readable in the address bar; commas and slashes are separators, so they are encoded. */
function encode(text: string): string {
  return encodeURIComponent(text).replace(/%2E/gi, '.').replace(/%3A/gi, ':');
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
