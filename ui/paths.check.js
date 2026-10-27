import assert from 'node:assert/strict';
import { findPaths } from './paths.js';

// The matches in `text` as [text, path, line, col].
const found = (text) => findPaths(text).map((m) => [text.slice(m.start, m.end), m.path, m.line, m.col]);
const one = (text, path, line, col) => {
  const ms = findPaths(text).filter((m) => m.path === path);
  assert.equal(ms.length, 1, `${JSON.stringify(text)} should find ${path}, found ${JSON.stringify(found(text))}`);
  assert.deepEqual([ms[0].line, ms[0].col], [line, col], text);
  return ms[0];
};
const none = (text) => assert.deepEqual(found(text), [], text);

// path:line:col / path:line
one('src/app.js:42:7: error: nope', 'src/app.js', 42, 7);                     // gcc, clang, eslint
one('main.c:3:5: warning: unused variable', 'main.c', 3, 5);
one('src/a.ts:3:5 - error TS2322', 'src/a.ts', 3, 5);                         // tsc --pretty false
one('./core.js:12:  // TODO fix', './core.js', 12, undefined);                // grep -n
one('ui/store.svelte.js:7:3:const x', 'ui/store.svelte.js', 7, 3);            // rg --vimgrep
one('./main.go:10:2: undefined: foo', './main.go', 10, 2);                    // Go
one('tests/test_x.py:12: AssertionError', 'tests/test_x.py', 12, undefined);  // pytest
one('  --> src/main.rs:2:5', 'src/main.rs', 2, 5);                           // Rust
one('Makefile:3: *** missing separator', 'Makefile', 3, undefined);

// path(line,col)
const tsc = one('src/a.ts(3,5): error TS2322: Type', 'src/a.ts', 3, 5);
assert.equal(tsc.start, 0);

// Python
const py = 'File "/usr/lib/python3.12/my file.py", line 5, in <module>';
const pm = one(py, '/usr/lib/python3.12/my file.py', 5, undefined);
assert.equal(py.slice(pm.start, pm.end), '/usr/lib/python3.12/my file.py", line 5');

// Node / V8
const nm = one('    at Object.<anonymous> (/home/u/my app/x.js:1:7)', '/home/u/my app/x.js', 1, 7);
assert.equal('    at Object.<anonymous> (/home/u/my app/x.js:1:7)'.slice(nm.start, nm.end), '/home/u/my app/x.js:1:7');
one('    at /home/u/x.js:10:3', '/home/u/x.js', 10, 3);
one('    at async file:///home/u/a%20b.mjs:4:9', '/home/u/a b.mjs', 4, 9);
one('    at f (file:///home/u/x.mjs:1:2)', '/home/u/x.mjs', 1, 2);

// Bare paths, trailing punctuation trimmed
assert.deepEqual(found('README.md  core.js  node_modules  public'), [['README.md', 'README.md', undefined, undefined], ['core.js', 'core.js', undefined, undefined]]);
one('see src/app.js.', 'src/app.js', undefined, undefined);
one('wrote ~/notes/today.txt, done', '~/notes/today.txt', undefined, undefined);
one('cd ../shelf;', '../shelf', undefined, undefined);
one('("./build")', './build', undefined, undefined);
one("['/etc/hosts']", '/etc/hosts', undefined, undefined);
one('open file:///tmp/x.pdf', '/tmp/x.pdf', undefined, undefined);

// False positives
none('1:2');
none('at 10:30 or 10:30:15');
none('an a/b test');
none('about 3/4 of them, on 1/2/2024');
none('std::vector<int> v;');
none('C:\\');
none('see https://example.com/src/app.js:3:4 and http://x.org/a.md');
none('version 1.2.3, e g');
assert.deepEqual(found('https://x.org/a and b.js:1').map((f) => f[1]), ['b.js']);

console.log('paths ok');
