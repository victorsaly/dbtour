// The family's icons: each is the mark's cylinder with a sign of its own in place of the pulse, so the six read as
// one family and none as another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyMembers, familySvg, markCylinderBody, markPulse, markSvg } from '../src/mark.ts';

test('every member of the family is the cylinder with a sign of its own', () => {
  assert.deepEqual(familyMembers, ['app', 'cli', 'skill', 'mcp', 'plugin', 'packages']);
  const drawn = familyMembers.map((member) => familySvg(member, 40, '#0b0b0b'));
  for (const svg of drawn) {
    assert.match(svg, /<ellipse cx="12" cy="5.5" rx="8.5" ry="2.5"\/>/);
    assert.ok(svg.includes(markCylinderBody));
    assert.ok(!svg.includes(markPulse), 'the pulse is the mark: a member has a sign of its own');
    assert.match(svg, /width="40" height="40" viewBox="0 0 24 24"/);
    assert.match(svg, /stroke="#0b0b0b"/);
  }
  assert.equal(new Set(drawn).size, familyMembers.length, 'no two members share a sign');
});

test('a member is drawn with the mark’s pen unless asked otherwise', () => {
  assert.match(familySvg('cli', 24, '#fff'), /stroke-width="2"/);
  assert.match(familySvg('cli', 24, '#fff', 1.5), /stroke-width="1.5"/);
  // The mark itself is unchanged by the family.
  assert.ok(markSvg(24, '#fff').includes(markPulse));
});
