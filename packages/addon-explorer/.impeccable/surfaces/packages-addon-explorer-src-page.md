---
version: 1
slug: "packages-addon-explorer-src-page"
primary_target: "packages/addon-explorer/src/page"
related_targets: []
---

# The dbtour page

Scope: `packages/addon-explorer/src/page`, the whole page (home, sidebar, table view, diagram). Visitor mode: Operate.

Audience and job: developers on a team, daily, beside their editor; find a column, a relation or a diagram
in seconds. Both scenes: long dark sessions on a second monitor, and a deployed docs site opened from a link.
Content: the model (schemas, tables, columns, keys, relations, groups, notes). Constraints: offline from a
file, no network assets, fonts embedded as data URIs; dark follows the system; nothing playful or
marketing-like; the database name and its tables lead; must not look like every other docs tool.

## Direction contract

THESIS: The page is a catalogue. Every table is an entry with a number, a name and a plot of its structure,
on a matte black field, and the index is the only map. It refuses the docs-tool arrangement of grey panels,
blue links and bordered cards.

OWN-WORLD: Matte black ground (#0b0b0b) with white hairline ink (#f5f5f5 at 1px); light mode is the white
sleeve (#f4f4f2, black ink) with the same grammar. Schemas are a strip of colour blocks (Factory red #e2001a,
yellow #ffd500, blue #0057b8, white, grey) always decoded by name beside them, never codes alone. Type:
Archivo for text, Red Hat Mono in small letter-spaced caps for labels and numbers, both embedded. Controls are
hairline boxes; the active one takes a colour block on its trailing edge. Selection lifts a hairline to
double weight. No shadow, no radius above 2px, no gradient.

STORY: A developer lands, sees the database as a stack of hairline plots, one per table, keys as peaks;
reads a table as a catalogue entry with its columns ruled beneath; follows a relation to the next entry;
opens the map when the structure matters; copies the entry to an agent.

FIRST VIEWPORT (home, 1280 wide): left rail 280px, black, the mark and wordmark at top, the search as a
hairline box with a mono caps placeholder, then the index: each table as a numbered row (`003  dbo.Orders`)
preceded by its schema's colour block. Centre: the database name as the only headline (Archivo 600, 28px),
the driver line in mono caps beneath, then the plot owning the field: one white hairline per table, stacked
at 18px pitch, each line's profile drawn from its columns (a key is a peak, a foreign key a shoulder, a plain
column a low tick), the table's number and name in mono caps at the line's left; hovering lifts a line to
double weight and names it; clicking opens the entry. Right: the schema strip decoded (block, name, count).
Primary action: the search, focused with /.

FORM: the Factory catalogue sleeve, a dealt challenger that won on audience identification and is raised
for clarity: names always accompany codes; nothing is hover-only. Seed key 2836ff74, kind challenger,
source brand-identity-canon-saville-catalog-sleeve. Signature interaction: the plot's slow traverse, lines
drawing in once on load and the open table's line lifting to double weight. Motion grammar: one draw-in of
0.6s with an exponential ease-out, nothing else moves; reduced motion skips it.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict,
DESIGN.md, and every shipping raster carrying its provenance.
