const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'src/utils/replaceUrl.ts'), 'utf8');
const js = transform(code, { transforms: ['typescript', 'imports'] }).code;
const moduleData = { exports: {} };
new Function('require', 'module', 'exports', js)(require, moduleData, moduleData.exports);
const replaceUrl = moduleData.exports.__esModule ? moduleData.exports.default : moduleData.exports;

const cases = [
  ['/oss/smallImage/1777546303271/role/a.jpg', '/1777546303271/role/a.jpg'],
  ['/smallImage/1777546303271/role/a.jpg', '/1777546303271/role/a.jpg'],
  ['/oss/1777546303271/role/a.jpg', '/1777546303271/role/a.jpg'],
  ['1777546303271/role/a.jpg', '/1777546303271/role/a.jpg'],
  ['http://127.0.0.1:10588/oss/smallImage/1777546303271/role/a.jpg', '/1777546303271/role/a.jpg'],
  ['http://127.0.0.1:10588/oss/1777546303271/role/a.jpg', '/1777546303271/role/a.jpg'],
];

for (const [input, expected] of cases) {
  assert.strictEqual(replaceUrl(input), expected, input);
}

console.log('replaceUrl path normalization checks passed');
