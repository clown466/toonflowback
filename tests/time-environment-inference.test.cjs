const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');

const root = path.resolve(__dirname, '..');

function loadTsModule(file, mocks = {}) {
  const filename = path.join(root, file);
  assert.ok(fs.existsSync(filename), `${file} should exist`);
  const code = fs.readFileSync(filename, 'utf8');
  const js = transform(code, { transforms: ['typescript', 'imports'] }).code;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return loadTsModule(path.join('src', `${id.slice(2)}.ts`), mocks);
    if (id.startsWith('./') || id.startsWith('../')) {
      const target = path.join(path.dirname(file), id);
      return loadTsModule(target.endsWith('.ts') || target.endsWith('.json') ? target : `${target}.ts`, mocks);
    }
    return require(id);
  };
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', js);
  fn(localRequire, module, module.exports, path.dirname(filename), filename);
  return module.exports;
}

function inferForAsset(assetType, text, userRequirement = null) {
  const { inferTimeEnvironment } = loadTsModule('src/services/timeEnvironmentInference.ts');
  assert.strictEqual(typeof inferTimeEnvironment, 'function', 'inferTimeEnvironment should be exported');
  return inferTimeEnvironment({
    assetType,
    assetName: assetType === 'scene' ? '图书馆' : assetType === 'tool' ? '雨伞' : '林澈',
    assetDescribe: text,
    assetPrompt: text,
    userRequirement,
  });
}

function assertNeutralAssetResult(result, label) {
  assert.strictEqual(result.applies, false, `${label} should not apply inferred scene time environment`);
  assert.ok(result.contextText, `${label} should return contextText`);
  assert.match(result.contextText, /中性|标准|展示|neutral|studio|even|balanced|soft/i, `${label} should describe neutral display lighting`);
  assert.doesNotMatch(result.contextText, /雨夜|黄昏|夜晚|night|dusk/i, `${label} neutral text should not inherit scene time clues`);
}

function assertNeutralSceneResult(result, label) {
  assert.ok(result.contextText, `${label} should return contextText`);
  assert.match(result.contextText, /中性|环境光|标准|自然|neutral|ambient|balanced|generic/i, `${label} should describe neutral environment light`);
  assert.doesNotMatch(result.contextText, /推理时间：(?:白天|夜晚|黄昏|凌晨|清晨)/, `${label} should not choose a concrete time`);
}

function testInference() {
  assertNeutralAssetResult(inferForAsset('role', '角色站在雨夜街口，黄昏轮廓光，夜晚蓝调背景'), 'role asset');
  assertNeutralAssetResult(inferForAsset('tool', '道具放在雨夜窗边，黄昏余光，夜晚环境'), 'tool asset');

  const nightScene = inferForAsset('scene', 'night, 夜晚, 图书馆室内冷白灯, rows of bookshelves, quiet interior');
  assert.strictEqual(nightScene.applies, true, 'scene with explicit night clues should apply inferred time environment');
  assert.strictEqual(nightScene.timeOfDay, 'night', 'scene should infer night');
  assert.match(nightScene.contextText, /夜晚|night/i, 'night scene context should mention night');
  assert.match(nightScene.contextText, /灯光|冷白灯|lighting|light/i, 'night scene context should mention lighting');

  const forcedRainNight = inferForAsset('scene', '白天晴朗的校园操场，自然日光', '强制雨夜，必须是夜晚下雨');
  assert.strictEqual(forcedRainNight.applies, true, 'explicit user rain-night requirement should apply');
  assert.strictEqual(forcedRainNight.timeOfDay, 'night', 'explicit user rain-night requirement should override daytime defaults');
  assert.match(forcedRainNight.contextText, /雨夜|夜晚|下雨|rain/i, 'forced rain-night context should mention the override');

  const conflict = inferForAsset('scene', '清晨阳光、正午烈日、黄昏余晖、夜晚霓虹同时出现');
  assert.strictEqual(conflict.timeOfDay, 'unknown', 'conflicting time clues should resolve to unknown');
  assertNeutralSceneResult(conflict, 'conflicting scene');

  const missing = inferForAsset('scene', '木质书架，阅读桌椅，安静整洁，书本文具摆放有序');
  assert.strictEqual(missing.timeOfDay, 'unknown', 'scene without time clues should be unknown');
  assertNeutralSceneResult(missing, 'scene without clues');
}

function assertIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

function testStaticIntegration() {
  const assetService = fs.readFileSync(path.join(root, 'src/services/assetImageGeneration.ts'), 'utf8');
  const skillService = fs.readFileSync(path.join(root, 'src/services/imageGenerationSkill.ts'), 'utf8');

  assertIncludes(assetService, 'timeEnvironmentContext', 'asset image generation should build timeEnvironmentContext');
  assertIncludes(assetService, 'neutralAssetLighting', 'asset image generation should build neutralAssetLighting');
  assertIncludes(skillService, 'timeEnvironmentContext', 'image generation skill context should expose timeEnvironmentContext');
  assertIncludes(skillService, 'neutralAssetLighting', 'image generation skill context should expose neutralAssetLighting');
  assert.match(assetService, /assetType\s*===\s*["']scene["']\s*\?\s*null\s*:\s*buildNeutralAssetLightingText\s*\(/, 'role/tool assets should use neutral lighting branch');
  assert.match(assetService, /assetType\s*===\s*["']scene["']\s*\?\s*inferTimeEnvironment\s*\(/, 'scene assets should use time environment inference branch');
}

testStaticIntegration();
testInference();
console.log('Time environment inference regression checks passed');
