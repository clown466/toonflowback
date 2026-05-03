const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const ai = read('src/utils/ai.ts');
const openaiVendor = read('data/vendor/openai.ts');
const nullVendor = read('data/vendor/null.ts');

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

function assertNotIncludes(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `${label} should not include: ${needle}`);
}

assertIncludes(ai, 'const MIN_IMAGE_BYTES = 1024;', 'ai image minimum size guard');
assertIncludes(ai, 'const MIN_VIDEO_BYTES = 1024;', 'ai video minimum size guard');
assertIncludes(ai, 'const MIN_AUDIO_BYTES = 128;', 'ai audio minimum size guard');
assertIncludes(ai, 'function assertNonEmptyGeneratedResult(kind: GeneratedKind, result: string)', 'ai empty result guard');
assertIncludes(ai, '供应商未返回有效${generatedKindLabel(kind)}内容', 'ai empty result error');
assertIncludes(ai, '供应商返回的${generatedKindLabel(kind)}内容不是有效base64', 'ai invalid base64 error');
assertIncludes(ai, '供应商返回的图片内容无效', 'ai sharp image validation error');
assertIncludes(ai, 'decodeGeneratedBase64("image", this.result)', 'image save should validate and decode before writing');
assertIncludes(ai, 'decodeGeneratedBase64("video", this.result)', 'video save should validate and decode before writing');
assertIncludes(ai, 'decodeGeneratedBase64("audio", this.result)', 'audio save should validate and decode before writing');
assertIncludes(ai, 'await assertValidGeneratedArtifact("image", await u.oss.getFile(path));', 'image save should validate written file');
assertIncludes(ai, 'await assertValidGeneratedArtifact("video", await u.oss.getFile(path));', 'video save should validate written file');
assertIncludes(ai, 'await assertValidGeneratedArtifact("audio", await u.oss.getFile(path));', 'audio save should validate written file');
assertIncludes(ai, 'this.result = await urlToBase64(this.result, "image")', 'image URL result should be downloaded with image guard');
assertIncludes(ai, 'this.result = await urlToBase64(this.result, "video")', 'video URL result should be downloaded with video guard');
assertIncludes(ai, 'this.result = await urlToBase64(this.result, "audio")', 'audio URL result should be downloaded with audio guard');

for (const [label, source] of [['openai vendor', openaiVendor], ['null vendor', nullVendor]]) {
  assertIncludes(source, 'throw new Error("当前供应商未实现图片生成")', label);
  assertIncludes(source, 'throw new Error("当前供应商未实现视频生成")', label);
  assertIncludes(source, 'throw new Error("当前供应商未实现音频生成")', label);
  assert.ok(!/const imageRequest[\s\S]*?return "";[\s\S]*?const videoRequest/.test(source), `${label} imageRequest should not return empty string`);
  assert.ok(!/const videoRequest[\s\S]*?return "";[\s\S]*?const ttsRequest/.test(source), `${label} videoRequest should not return empty string`);
  assert.ok(!/const ttsRequest[\s\S]*?return "";[\s\S]*?const checkForUpdates/.test(source), `${label} ttsRequest should not return empty string`);
}

console.log('AI empty result checks passed');
