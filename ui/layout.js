// Docking layout: a tree of splits. A node is either a leaf { pane: id } or a
// split { dir: 'row' | 'col', children: [...], sizes: [...] } whose sizes are
// fractions summing to 1. All functions are pure and return new trees.

export const GAP = 6;
const MIN = 0.05;

const axisOf = (side) => (side === 'left' || side === 'right' ? 'row' : 'col');
const isBefore = (side) => side === 'left' || side === 'top';

export function leaves(node) {
  if (!node) return [];
  return node.children ? node.children.flatMap(leaves) : [node.pane];
}

function split(dir, children, sizes) {
  const flat = [], fs = [];
  children.forEach((c, i) => {
    if (c.children && c.dir === dir) c.children.forEach((g, j) => { flat.push(g); fs.push(sizes[i] * c.sizes[j]); });
    else { flat.push(c); fs.push(sizes[i]); }
  });
  return { dir, children: flat, sizes: fs };
}

export function insert(tree, target, id, side = 'bottom') {
  const leaf = { pane: id };
  if (!tree) return leaf;
  const dir = axisOf(side), before = isBefore(side);
  if (target == null || !leaves(tree).includes(target)) {
    if (tree.children && tree.dir === dir) {
      const n = tree.children.length, s = 1 / (n + 1);
      const sizes = tree.sizes.map((x) => x * (1 - s));
      return before
        ? { dir, children: [leaf, ...tree.children], sizes: [s, ...sizes] }
        : { dir, children: [...tree.children, leaf], sizes: [...sizes, s] };
    }
    return { dir, children: before ? [leaf, tree] : [tree, leaf], sizes: [0.5, 0.5] };
  }
  const walk = (node) => {
    if (node.pane === target) return { dir, children: before ? [leaf, node] : [node, leaf], sizes: [0.5, 0.5] };
    if (!node.children) return node;
    const i = node.children.findIndex((c) => c.pane === target);
    if (i >= 0 && node.dir === dir) {
      const children = [...node.children], sizes = [...node.sizes];
      const half = sizes[i] / 2;
      sizes[i] = half;
      const at = before ? i : i + 1;
      children.splice(at, 0, leaf);
      sizes.splice(at, 0, half);
      return { dir, children, sizes };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return walk(tree);
}

export function remove(tree, id) {
  if (!tree || tree.pane === id) return null;
  if (!tree.children) return tree;
  const children = [], sizes = [];
  tree.children.forEach((c, i) => {
    const r = remove(c, id);
    if (r) { children.push(r); sizes.push(tree.sizes[i]); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return split(tree.dir, children, sizes.map((s) => s / total));
}

// Turn pane `id` and its next (else previous) sibling from side by side to stacked, or back.
export function rotate(tree, id) {
  const walk = (node) => {
    if (!node.children) return node;
    const i = node.children.findIndex((c) => c.pane === id);
    if (i < 0) return split(node.dir, node.children.map(walk), node.sizes);
    const dir = node.dir === 'row' ? 'col' : 'row';
    if (node.children.length === 2) return split(dir, node.children, node.sizes);
    const j = Math.min(i, node.children.length - 2), s = node.sizes[j] + node.sizes[j + 1];
    const pair = split(dir, node.children.slice(j, j + 2), [node.sizes[j] / s, node.sizes[j + 1] / s]);
    return {
      ...node,
      children: [...node.children.slice(0, j), pair, ...node.children.slice(j + 2)],
      sizes: [...node.sizes.slice(0, j), s, ...node.sizes.slice(j + 2)],
    };
  };
  return tree && walk(tree);
}

export function swap(tree, a, b) {
  if (!tree) return tree;
  if (!tree.children) return tree.pane === a ? { pane: b } : tree.pane === b ? { pane: a } : tree;
  return { ...tree, children: tree.children.map((c) => swap(c, a, b)) };
}

export function equalize(tree) {
  if (!tree?.children) return tree;
  const n = tree.children.length;
  return { ...tree, children: tree.children.map(equalize), sizes: Array(n).fill(1 / n) };
}

// Move the divider after child i of the split at `path` by `delta` (a fraction).
export function resizeAt(tree, path, i, delta) {
  if (path.length) {
    const [h, ...rest] = path;
    return { ...tree, children: tree.children.map((c, j) => (j === h ? resizeAt(c, rest, i, delta) : c)) };
  }
  const sizes = [...tree.sizes];
  const pair = sizes[i] + sizes[i + 1];
  sizes[i] = Math.min(pair - MIN, Math.max(MIN, sizes[i] + delta));
  sizes[i + 1] = pair - sizes[i];
  return { ...tree, sizes };
}

// Grow/shrink pane `id` towards `side` by moving the closest suitable divider.
export function nudge(tree, id, side, step = 0.05) {
  const dir = axisOf(side), sign = isBefore(side) ? -1 : 1;
  const chain = [];
  const find = (node, path) => {
    if (node.pane === id) return true;
    if (!node.children) return false;
    return node.children.some((c, i) => {
      if (!find(c, [...path, i])) return false;
      if (node.dir === dir) chain.push({ path, i, n: node.children.length });
      return true;
    });
  };
  if (!tree || !find(tree, [])) return tree;
  for (const { path, i, n } of chain) {
    if (sign > 0 && i < n - 1) return resizeAt(tree, path, i, step);
    if (sign < 0 && i > 0) return resizeAt(tree, path, i - 1, -step);
  }
  const d = chain[0];
  if (!d) return tree;
  return sign > 0 ? resizeAt(tree, d.path, d.i - 1, step) : resizeAt(tree, d.path, d.i, -step);
}

export function rects(tree, box) {
  const panes = new Map(), dividers = [];
  const walk = (node, b, path) => {
    if (!node.children) { panes.set(node.pane, b); return; }
    const row = node.dir === 'row';
    const total = (row ? b.w : b.h) - GAP * (node.children.length - 1);
    let pos = row ? b.x : b.y;
    node.children.forEach((c, i) => {
      const len = total * node.sizes[i];
      walk(c, row ? { x: pos, y: b.y, w: len, h: b.h } : { x: b.x, y: pos, w: b.w, h: len }, [...path, i]);
      pos += len;
      if (i < node.children.length - 1) {
        dividers.push({ path, i, dir: node.dir, total, rect: row ? { x: pos, y: b.y, w: GAP, h: b.h } : { x: b.x, y: pos, w: b.w, h: GAP } });
        pos += GAP;
      }
    });
  };
  if (tree) walk(tree, box, []);
  return { panes, dividers };
}

const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function neighbor(map, id, dir) {
  const r = map.get(id);
  if (!r) return null;
  const [dx, dy] = DIRS[dir];
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let best = null, bestScore = Infinity;
  for (const [k, c] of map) {
    if (k === id) continue;
    const gap = dx > 0 ? c.x - (r.x + r.w) : dx < 0 ? r.x - (c.x + c.w) : dy > 0 ? c.y - (r.y + r.h) : r.y - (c.y + c.h);
    if (gap < -1) continue;
    const overlap = dx ? Math.min(r.y + r.h, c.y + c.h) - Math.max(r.y, c.y) : Math.min(r.x + r.w, c.x + c.w) - Math.max(r.x, c.x);
    const off = dx ? Math.abs(c.y + c.h / 2 - cy) : Math.abs(c.x + c.w / 2 - cx);
    const score = gap + (overlap > 0 ? 0 : 1e5) + off * 0.01;
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return best;
}

// Where a pane dragged to (x, y) would dock: a desk edge, or a side of a pane.
export function dropTarget(map, box, x, y, dragged, edge = 40) {
  const ex = [['left', x - box.x], ['right', box.x + box.w - x], ['top', y - box.y], ['bottom', box.y + box.h - y]];
  const [eside, ed] = ex.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (ed < edge && ed >= 0) return { target: null, side: eside, rect: half(box, eside, 1 / 3) };
  for (const [k, r] of map) {
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    if (k === dragged) return null;
    const fx = (x - r.x) / r.w, fy = (y - r.y) / r.h;
    const [side] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]].reduce((a, b) => (b[1] < a[1] ? b : a));
    return { target: k, side, rect: half(r, side, 0.5) };
  }
  return null;
}

function half(r, side, f) {
  if (side === 'left') return { ...r, w: r.w * f };
  if (side === 'right') return { ...r, x: r.x + r.w * (1 - f), w: r.w * f };
  if (side === 'top') return { ...r, h: r.h * f };
  return { ...r, y: r.y + r.h * (1 - f), h: r.h * f };
}
