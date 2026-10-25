import assert from 'node:assert/strict';
import { insert, remove, rects, neighbor, swap, nudge, leaves, dropTarget, equalize } from './layout.js';

let t = insert(null, null, 'a');
assert.deepEqual(t, { pane: 'a' });
t = insert(t, 'a', 'b', 'bottom');
t = insert(t, 'b', 'c', 'bottom');
assert.equal(t.dir, 'col');
assert.deepEqual(leaves(t), ['a', 'b', 'c']);
assert.deepEqual(t.sizes, [0.5, 0.25, 0.25]);

t = insert(t, 'b', 'd', 'right');
assert.equal(t.children[1].dir, 'row');
assert.deepEqual(leaves(t), ['a', 'b', 'd', 'c']);

const box = { x: 0, y: 0, w: 1006, h: 1012 };
const { panes, dividers } = rects(equalize(t), box);
assert.equal(panes.size, 4);
assert.equal(dividers.length, 3);
assert.equal(panes.get('a').h, 1000 / 3);
assert.equal(neighbor(panes, 'a', 'down'), 'b');
assert.equal(neighbor(panes, 'b', 'right'), 'd');
assert.equal(neighbor(panes, 'd', 'down'), 'c');
assert.equal(neighbor(panes, 'a', 'up'), null);

assert.deepEqual(leaves(swap(t, 'a', 'c')), ['c', 'b', 'd', 'a']);

let r = remove(t, 'd');
assert.deepEqual(r, { dir: 'col', children: [{ pane: 'a' }, { pane: 'b' }, { pane: 'c' }], sizes: [0.5, 0.25, 0.25] });
r = remove(remove(r, 'a'), 'b');
assert.deepEqual(r, { pane: 'c' });
assert.equal(remove(r, 'c'), null);

const edge = insert(t, null, 'e', 'left');
assert.equal(edge.dir, 'row');
assert.equal(edge.children[0].pane, 'e');

const n = nudge(t, 'a', 'down');
assert.ok(Math.abs(n.sizes[0] - 0.55) < 1e-9);
assert.ok(Math.abs(nudge(t, 'c', 'down').sizes[2] - 0.2) < 1e-9);

const d = dropTarget(panes, box, 500, 5, 'b');
assert.equal(d.target, null);
assert.equal(d.side, 'top');
assert.equal(dropTarget(panes, box, 200, 300, 'a'), null);
assert.equal(dropTarget(panes, box, 200, 300, 'b').side, 'bottom');

console.log('layout ok');
