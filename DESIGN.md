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
  between 6 and 72px. On the entry page every tick is a link to its column. The line means the columns and
  keys and nothing else; size is never drawn into it.
- **Tick tooltip**: on an entry, hovering or focusing a tick opens a hairline box under the baseline
  (`.plot-tip`, never the browser's title): the column in mono with its type, the tick's own peak drawn small
  beside what the peak means in the key's words (primary key, foreign key → its target, unique, column),
  then the description, the facts (null, default, identity, computed, sparse, collation, not trusted), the
  protection tags, the properties, and a hint: click or Enter for its row, ← → for the next column. Near
  either end it anchors to that end. The column pointed at is shared with the columns table: the tick is
  lifted to 2px ink and the row takes `--fill`, whichever side is pointed at; the tooltip shows only when
  the tick is, so a row never covers the map with one.
- **Size bar** (`SizeBar.tsx`, `size.ts`): a table's bytes as length, linear, data solid `--ink` and indexes
  a hairline outline, on a `--line` hairline that marks the full length; 8px tall on the home, 10px on an
  entry; a part with any bytes keeps 1px. On the home a 220px column (112px on a phone) to the right of
  each plot, against the largest table, with the rows and size written above it (below it on a phone) and
  "no rows of its own" for a view. Its key sits under the index label, with swatches, and "Reading a bar"
  in the panel defines rows, data and indexes.
- **Index order**: with sizes, a segmented control above the home's index reads it by Catalogue, Rows or
  Size, largest first; numbers never change, and the choice is remembered in the browser.
- **Size block**: on an entry with sizes, between the header and the plot: a "Size" label over a hairline
  with the date it was counted at the right, the rows as a 20px mono figure with the table's place by rows
  beside it, the bar of its own bytes, the parts named with their swatches, and the three terms side by
  side (stacked on a phone).
- **About block**: on an entry the catalogue says more about, after the Size block: an "About" label over a
  hairline with the created and altered dates at the right, then each feature as a term in mono caps (the
  names core's `features()` gives) in a 180px column beside one plain sentence, a table it names a link;
  then "Properties", each a name in mono, in its own case, beside its value. Stacked on a phone. Not drawn
  when there is nothing to say.
- **Protection column**: in the columns table, only when some column has any: a column's sensitivity label,
  mask and encryption as hairline tags in mono, never upper-cased, since a label is the team's name and a
  mask a function. Sparse and a column's own collation are a second line in the Type cell, an identity's
  seed rides in the Key cell, and a column's properties are "Name: value" lines under its description.
- **Not enforced, not trusted**: a key or check the database no longer enforces carries a `disabled` tag,
  one it no longer trusts a `not trusted` tag, in the Key cell, the constraints and the References panel.
  A warning tag (`.tag.warn`) leads with a small red triangle.
- **Marks by shape**: a square block is a schema, a round dot a sensitivity rank (low `--rank-low` grey,
  medium amber, high orange, critical `--red`, its words always written beside it), a triangle a warning.
  The shape says what kind of mark it is, the colour how much. About terms lead with their schema's block.
- **SQL** (`sql.ts`, `Sql.tsx`): CodeMirror's MSSQL parser reads it, and one set of `sql-*` classes colours
  it in VS Code's Dark+ and Light+ colours, chosen by the owner over a palette of the page's own because
  developers already read SQL in them: keywords blue, built-ins yellow, types teal, names pale blue,
  strings salmon, numbers pale green, comments green. A definition (a view's, a trigger's) is a read-only
  CodeMirror editor in a hairline frame, a bar across its top with "T-SQL" and a Copy button, line numbers
  and folding: the editor a SQL generator will later write in. A check, filter, predicate, default or
  computed expression in a cell is coloured text. Monaco was weighed and left for the SQL add-on: it would
  more than double the page.
- **Query section and SQL page** (`query.ts`, `SqlEditor`, `SqlPage.tsx`): the same frame, editable, after
  an entry's columns (open, collapsible like Indexes) and at `#sql`, linked as "Write SQL" under the map in the
  rail. An entry starts from its table and a LEFT JOIN to each table it references that has a name-like
  column, newest first, protected columns left out with a comment saying which. Autocomplete offers the
  database's schemas, tables and columns in words only, no icons, in a hairline box on the field; names are
  case-insensitive and quoted with [brackets], as T-SQL is. The bar holds Copy query, Copy query for the
  remembered agent (the query with the tables it reads, as the docs write them) and Reset; a draft is kept in
  the browser. Under it, one line says the page cannot reach the database and where the query runs.
  Beside "T-SQL" the status says whether the page is connected: a hollow dot not; connected, the dot is the
  last run, grey before one and while it runs, green (`--ran`, the page's only green) when the database
  answered, red when it did not, and the words say the same ("· ran", "· failed").
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

An identifier inside a caps line, such as the collation in the home's meta line, keeps its own case.

Selection inverts (`--ink` on `--bg`); the caret is `--ink`; focus is a 1px `--ink` outline offset 2px;
scrollbars are thin in `--line`; the search's native cancel button is removed.

## Do not

- Add a kicker above a heading, a card, a gradient, a shadow, or a radius.
- Upper-case an identifier, or show a code or colour without its name.
- Hide anything behind hover alone.
- Let a brand element outweigh the database name and its tables.
