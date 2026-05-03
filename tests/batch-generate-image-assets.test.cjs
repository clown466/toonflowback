const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/assetsGenerate/batchGenerateImageAssets.ts'), 'utf8');

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

function assertNotIncludes(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `${label} should not include: ${needle}`);
}

assertIncludes(route, 'await aiImage.save(imagePath);', 'batch route');
assertNotIncludes(route, 'aiImage.save(imagePath);\n\n        const imageData', 'batch route should await save before DB success update');

assertIncludes(route, 'select("state").first()', 'batch route should reread image state after save');
assertIncludes(route, 'imageData.state !== "生成中"', 'batch route should guard changed/cancelled state after save');
assertIncludes(route, '.where({ id: imageId })\n            .where("state", "生成中")', 'batch route should conditionally update completed state');
assertIncludes(route, 'state: "已完成"', 'batch route should still mark successful generated image completed');
assertIncludes(route, 'errorReason: null', 'batch route should clear previous error only on guarded success');
assertIncludes(route, 'updated === 0', 'batch route should detect skipped guarded update');

assertNotIncludes(route, 'return res.status(500).send("资产已被删除")', 'background task must not write response after initial response');
assertIncludes(route, 'Promise.all(tasks).catch((err) => {', 'batch route should log top-level background errors');
assertIncludes(route, 'console.error("[batchGenerateImageAssets] batch failed", u.error(err));', 'batch route should log background batch failure details');
assertIncludes(route, 'console.error("[batchGenerateImageAssets] request failed", u.error(err));', 'batch route should log top-level request failure details');
assertIncludes(route, '.where("state", "生成中")\n            .update({ state: "生成失败"', 'batch route should not overwrite cancellation/final state with failure');

console.log('Batch generate image assets checks passed');
