import assert from 'node:assert/strict';
import { insert, remove, rects, neighbor, swap, nudge, leaves, dropTarget, equalize, rotate } from './layout.js';

let t = insert(null, null, 'a');
assert.deepEqual(t, { pane: 'a' });
t = insert(t, 'a', 'b', 'bottom');
t = insert(t, 'b', 'c', 'bottom');
assert.equal(t.dir, 'col');
assert.deepEqual(leaves(t), ['a', 'b', 'c']);
const near = (a, b) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${a} vs ${b}`));
near(t.sizes, [1 / 3, 1 / 3, 1 / 3]);
near(insert({ dir: 'col', children: [{ pane: 'x' }, { pane: 'y' }], sizes: [0.9, 0.1] }, 'y', 'z').sizes, [0.6, 0.2 / 3, 1 / 3]);

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
assert.deepEqual(leaves(r), ['a', 'b', 'c']);
near(r.sizes, [1 / 3, 1 / 3, 1 / 3]);
r = remove(remove(r, 'a'), 'b');
assert.deepEqual(r, { pane: 'c' });
assert.equal(remove(r, 'c'), null);

const edge = insert(t, null, 'e', 'left');
assert.equal(edge.dir, 'row');
assert.equal(edge.children[0].pane, 'e');

const n = nudge(t, 'a', 'down');
assert.ok(Math.abs(n.sizes[0] - (1 / 3 + 0.05)) < 1e-9);
assert.ok(Math.abs(nudge(t, 'c', 'down').sizes[2] - (1 / 3 - 0.05)) < 1e-9);

const d = dropTarget(panes, box, 500, 5, 'b');
assert.equal(d.target, null);
assert.equal(d.side, 'top');
assert.equal(dropTarget(panes, box, 200, 300, 'a'), null);
assert.equal(dropTarget(panes, box, 200, 300, 'b').side, 'bottom');

// col[a, row[b, d], c]: b and d stack, merging into the column; then b and d go side by side again.
const rot = rotate(t, 'b');
assert.deepEqual(rot.dir, 'col');
assert.deepEqual(leaves(rot), ['a', 'b', 'd', 'c']);
assert.equal(rot.children.length, 4);
const back = rotate(rot, 'b');
assert.equal(back.children[1].dir, 'row');
assert.deepEqual(leaves(back.children[1]), ['b', 'd']);
assert.ok(Math.abs(back.sizes.reduce((x, y) => x + y) - 1) < 1e-9);
assert.deepEqual(rotate({ pane: 'a' }, 'a'), { pane: 'a' });

console.log('layout ok');
