const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/assetsGenerate/batchGenerateImageAssets.ts'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/assetImageGeneration.ts'), 'utf8');

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

function assertNotIncludes(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `${label} should not include: ${needle}`);
}

assertIncludes(route, 'submitAssetImageGeneration', 'batch route should delegate to asset image generation service');
assertIncludes(route, 'skillId: z.string().optional().nullable()', 'batch route should accept image generation skill id');
assertIncludes(route, 'userRequirement: z.string().optional().nullable()', 'batch route should accept user requirement');

assertIncludes(service, 'await aiImage.save(imagePath);', 'asset image generation service');
assertNotIncludes(service, '\n          aiImage.save(imagePath);', 'asset image generation service should await save before DB success update');

assertIncludes(service, 'select("state").first()', 'asset image generation service should reread image state after save');
assertIncludes(service, 'imageData.state !== "生成中"', 'asset image generation service should guard changed/cancelled state after save');
assertIncludes(service, '.where({ id: imageId })\n          .where("state", "生成中")', 'asset image generation service should conditionally update completed state');
assertIncludes(service, 'state: "已完成"', 'asset image generation service should still mark successful generated image completed');
assertIncludes(service, 'errorReason: null', 'asset image generation service should clear previous error only on guarded success');
assertIncludes(service, 'updated === 0', 'asset image generation service should detect skipped guarded update');

assertNotIncludes(service, 'return res.status(500).send("资产已被删除")', 'background task must not write response after initial response');
assertIncludes(service, 'Promise.all(tasks).catch((err) => {', 'asset image generation service should log top-level background errors');
assertIncludes(service, 'console.error("[assetImageGeneration] batch failed", u.error(err));', 'asset image generation service should log background batch failure details');
assertIncludes(route, 'console.error("[batchGenerateImageAssets] request failed", u.error(err));', 'batch route should log top-level request failure details');
assertIncludes(service, '.where("state", "生成中")\n          .update({ state: "生成失败"', 'asset image generation service should not overwrite cancellation/final state with failure');

console.log('Batch generate image assets checks passed');
