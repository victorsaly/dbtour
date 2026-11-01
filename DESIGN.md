# Design

<!-- impeccable:design-schema 1 -->

The dbtour page is a catalogue. Every table is a numbered entry on a matte black field; every schema is a
colour block, always named beside it; every table is drawn as one hairline with a pulse per column and a key
as a peak. The world is the Factory Records catalogue sleeve, chosen by the owner on 1 November 2026, raised
for clarity: names always accompany codes, nothing is hover-only. Light mode is the white sleeve with the same
grammar. Tokens live in `packages/addon-explorer/src/page/styles.css` and `.impeccable/design.json`.

## Colour

| Token | Dark (primary scene) | Light | Use |
|---|---|---|---|
| `--bg` | `#0b0b0b` | `#f4f4f2` | the field |
| `--ink` | `#f5f5f5` | `#0b0b0b` | text, hairlines at full weight, plots |
| `--ink-2` | `#a3a3a3` | `#5c5c5c` | labels, numbers, secondary text |
| `--line` | `rgba(245,245,245,.22)` | `rgba(11,11,11,.22)` | rules, outlines at rest |
| `--line-strong` | `#f5f5f5` | `#0b0b0b` | the search box, buttons, node frames, table head rule |
| `--fill` | `rgba(245,245,245,.06)` | `rgba(11,11,11,.05)` | hover and the highlighted row |
| `--grid` | `#1a1a1a` | `#e2e2dd` | the map's grid |
| `--red` | `#e2001a` | same | the block on an active control, the current entry's number, the active tick |

Schema blocks cycle through `#e2001a`, `#ffd500`, `#0057b8`, `#f5f5f5`, `#8c8c8c` in the order the schemas
are listed (`catalogue.ts`). Colour never carries meaning alone: a block always sits beside its schema's name.
Strategy: restrained. No gradient, no shadow, no radius.

## Type

- `--sans`: Archivo, 400 for text, 600 for headings and the wordmark. Body 13px/1.5; `h1` 28px, tracking
  -0.02em; the map's title 20px.
- `--mono`: Red Hat Mono. Identifiers (table, column, type, default) at 12px, 400. Labels, numbers, table
  heads, buttons, tags and the search placeholder at 10.5px, 500, 0.14em tracking, upper case. Identifiers are
  never upper-cased.
- Both faces are variable fonts inlined from `packages/addon-explorer/fonts/` (OFL). Numerals are tabular.

## Materials and components

- **Hairline**: `--hair` is 1px. Rules, outlines and node frames are hairlines; the current entry, the focused
  node and the highlighted tick go to 2px (`outline-width: 2px`, `stroke-width: 2`).
- **Block**: 10px square, filled with the schema's colour, a hairline outline so yellow and white read on the
  light sleeve.
- **Entry number**: three digits at least, zero-padded, mono caps in `--ink-2`; red when current.
- **Button**: a hairline box, mono caps, transparent; a 10px red block on its trailing edge, always on the
  primary action, on hover and focus otherwise (scaled in, not resized).
- **Search**: a hairline box with a mono caps placeholder and the `/` key drawn as a kbd.
- **Plot** (`Plot.tsx`, `plot.ts`): one path per table, drawn at the box's real pixel width. A tick per
  column; peaks at 1.0 (primary key), 0.6 (foreign key), 0.45 (unique), 0.18 (column). Tick width is clamped
  between 6 and 72px. On the entry page every tick is a link to its column.
- **Facts**: four mono-caps labels with 20px mono values, in two columns, each over a hairline: columns,
  keys, references, referenced by. Every entry shows the same four in the same place.
- **Map nodes**: 240px wide, a 34px head with block, number and name, 22px rows, 6px padding; sizes
  `layout.ts` counts with. Three levels: Names (the head alone), Keys, Columns, chosen in a segmented
  control whose active item carries a 2px red underline. Edges are white hairlines with mono labels;
  virtual relations are dashed. The Links panel lists every relation with a checkbox (accent red) and a
  checkbox per group, declared and from the notes. An entry page embeds the map at names level, 300px tall,
  in a hairline frame, with "Open the map" to the full one.
- **Copy group**: the copy button, a select naming the tool (mono caps, hairline, a drawn chevron) and,
  for a tool with a web chat, an "Open …" button, joined edge to edge.
- **Mark and wordmark**: a database cylinder with the pulse through it, 1.5 stroke in the 24 box; "db" in
  Red Hat Mono 500 in `--ink-2`, "tour" in Archivo 600 in `--ink`.
- **Tags** (`view`, `notes`): 9.5px mono caps in a hairline outline.

## Layout

A 280px rail, the view, and a 280px panel on entries and the home (`.with-panel`). Pages pad 28px 32px, max
1100px. Panel sections are separated by 26px and headed by mono caps over a hairline. Below 800px the rail
stacks above the view at up to 45vh and the panel moves below the content; wide tables scroll inside their
own box, never the page.

## Motion

One authored moment: the plots draw in once (0.6s, `cubic-bezier(.16,1,.3,1)`, 14ms stagger per line on the
home) and the entry's plot redraws when the entry changes. The button block scales in over 0.15s. Reduced
motion removes both. Nothing else moves.

## Browser surfaces

Selection inverts (`--ink` on `--bg`); the caret is `--ink`; focus is a 1px `--ink` outline offset 2px;
scrollbars are thin in `--line`; the search's native cancel button is removed.

## Do not

- Add a kicker above a heading, a card, a gradient, a shadow, or a radius.
- Upper-case an identifier, or show a code or colour without its name.
- Hide anything behind hover alone.
- Let a brand element outweigh the database name and its tables.
