const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');

const root = path.resolve(__dirname, '..');

function loadTsModule(file, append = '') {
  const filename = path.join(root, file);
  assert.ok(fs.existsSync(filename), `${file} should exist`);
  const code = `${fs.readFileSync(filename, 'utf8')}\n${append}`;
  const js = transform(code, { transforms: ['typescript', 'imports'] }).code;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === '@/utils') return { default: {} };
    if (id === '@/utils/stripThink') return { stripThink: (value) => String(value || '') };
    if (id.startsWith('@/')) return loadTsModule(path.join('src', `${id.slice(2)}.ts`));
    return require(id);
  };
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', js);
  fn(localRequire, module, module.exports, path.dirname(filename), filename);
  return module.exports;
}

function extractSection(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.ok(startIndex >= 0, `${start} section should exist`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  return text.slice(startIndex, endIndex > startIndex ? endIndex : text.length);
}

function testDirectorBoardRoleIdentityIgnoresNegativeFruitNames() {
  const { buildChapterDirectorBoardPrompt, stripIdentityNegativeClauses } = loadTsModule('src/services/directorBoardGeneration.ts');

  const stripped = stripIdentityNegativeClauses('Chloe 是女性拟人化桃子水果角色。不要写成草莓、青柠、柠檬、普通人类。');
  assert.match(stripped, /桃子/, 'positive peach identity should remain');
  assert.doesNotMatch(stripped, /草莓|青柠|柠檬/, 'negative fruit names should be stripped');

  const prompt = buildChapterDirectorBoardPrompt({
    project: { id: 1, name: 'Fruit Show', videoRatio: '9:16' },
    script: { id: 10, name: 'juben10' },
    boardIndex: 0,
    totalBoards: 1,
    language: 'english',
    boardType: 'textStoryboard',
    storyboards: [
      {
        id: 1,
        index: 0,
        prompt: 'Close-up of Chloe cleaning a small knife. Leo wipes a frying pan in the background.',
        videoDesc: 'Chloe cleans a small knife while Leo wipes a frying pan in the Safe Bunker.',
        duration: '2',
      },
    ],
    assets: [
      {
        id: 1,
        name: 'Chloe',
        type: 'role',
        filePath: '/role/chloe.png',
        prompt: 'Female anthropomorphic peach fruit character Chloe, pink-orange peach head, clear peach groove, tactical vest. Do not make her strawberry, lime, lemon, normal human, or a character with hair.',
      },
      {
        id: 2,
        name: 'Leo',
        type: 'role',
        filePath: '/role/leo.png',
        prompt: 'Leo, anthropomorphic bright yellow lemon fruit character, calm deadpan attitude, frying pan.',
      },
    ],
  });

  const legend = extractSection(prompt, 'Character legend:', 'Character labels:');
  assert.match(legend, /Chloe\. a peach figure; final design from attached role reference\./i, 'Chloe should stay peach');
  assert.doesNotMatch(legend, /Chloe\. A bright yellow lemon figure/, 'Chloe should not inherit lemon from negative text');
  assert.doesNotMatch(prompt, /peach into strawberry|lemon into lime|水蜜桃画成草莓|柠檬画成青柠/i, 'director board should not hard-code alternative fruit negatives');
  assert.match(prompt, /Preserve each character's species\/object identity/, 'director board should use generic identity preservation');
}

function testFallbackRoleCardUsesTextNotHardcodedName() {
  const { __test } = loadTsModule('src/services/roleFactCard.ts', 'exports.__test = { buildFallbackRoleFactCard, stripIdentityNegativeClauses };');

  const strawberryChloe = __test.buildFallbackRoleFactCard(
    {
      id: 1,
      projectId: 1,
      name: 'Chloe',
      type: 'role',
      prompt: 'Chloe is an anthropomorphic strawberry fruit character with a red strawberry body and tactical vest.',
      describe: '',
      imageId: 1,
    },
    'asset_text_fallback',
  );
  assert.match(strawberryChloe.facts, /Identity: strawberry fruit character\./, 'role name Chloe should not force peach identity');

  const peachChloe = __test.buildFallbackRoleFactCard(
    {
      id: 2,
      projectId: 1,
      name: 'Chloe',
      type: 'role',
      prompt: 'Chloe 是拟人化桃子水果角色，粉橙桃子头。不要写成草莓、青柠、柠檬、普通人类。',
      describe: '',
      imageId: 1,
    },
    'asset_text_fallback',
  );
  assert.match(peachChloe.facts, /Identity: peach fruit character\./, 'positive peach identity should survive negative stripping');
  assert.doesNotMatch(`${peachChloe.facts} ${peachChloe.negativeFacts}`, /strawberry|lime|lemon|草莓|青柠|柠檬/i, 'role card fallback should not store enumerated unrelated fruit negatives');
  assert.match(peachChloe.negativeFacts, /preserve the uploaded\/selected character identity/, 'role card fallback should use generic preservation constraints');
}

testDirectorBoardRoleIdentityIgnoresNegativeFruitNames();
testFallbackRoleCardUsesTextNotHardcodedName();
console.log('Director board role identity regression checks passed');
