// File references in one line of terminal output. Pure (no DOM, no xterm), so ui/paths.check.js runs it in node.
// Returns [{ start, end, path, line?, col? }]: UTF-16 offsets, end exclusive. Whether a path exists is checked later.

// One path: stops at whitespace, quotes, brackets, colons and backslashes.
const P = String.raw`[^\s"'\`()<>\[\]{}|,;:\\]+`;
// Earlier patterns win where matches overlap. Each one's first group is the path, the next two are line and col.
const PATTERNS = [
  /File "([^"]+)", line (\d+)/dg,                              // Python traceback (quoted, so spaces are fine)
  /\(((?:file:\/\/)?[^()]+?):(\d+):(\d+)\)/dg,                 // Node: at fn (path:line:col)
  new RegExp(`(${P})\\((\\d+),(\\d+)\\)`, 'dg'),               // tsc: path(line,col)
  new RegExp(`((?:file://)?${P}):(\\d+)(?::(\\d+))?`, 'dg'),   // path:line[:col]: gcc, grep -n, Go, Rust's -->, Node's `at path:…`
  new RegExp(`((?:file://)?${P})`, 'dg'),                      // bare path
];
const BARE = PATTERNS.length - 1;
const URL = /[a-z][\w+.-]*:\/\/\S*/gi;

// A bare path needs a slash (not just `a/b` or `3/4`) or a file extension.
const pathy = (p) => (p.includes('/') ? p.split('/').some((s) => s.length > 1) : /^[\w@+-][^/]*\.[A-Za-z]\w*$/.test(p));

export function findPaths(text) {
  const taken = [...text.matchAll(URL)].filter((m) => !/^file:/i.test(m[0])).map((m) => [m.index, m.index + m[0].length]);
  const free = (s, e) => !taken.some(([a, b]) => s < b && a < e);
  const out = [];
  PATTERNS.forEach((re, i) => {
    for (const m of text.matchAll(re)) {
      const [[start], ...rest] = m.indices.slice(1).filter(Boolean);
      let end = (rest.at(-1) ?? m.indices[1])[1];
      let path = m[1];
      if (i === BARE) {
        const trimmed = path.replace(/\.+$/, '');
        end -= path.length - trimmed.length;
        path = trimmed;
      }
      if (/^file:\/\//i.test(path)) { path = path.slice(7); try { path = decodeURI(path); } catch {} }
      if (!/\w/.test(path) || /^[\d./]+$/.test(path) || (i === BARE && !pathy(path)) || !free(start, end)) continue;
      taken.push([start, end]);
      out.push({ start, end, path, ...(m[2] && { line: +m[2] }), ...(m[3] && { col: +m[3] }) });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}
