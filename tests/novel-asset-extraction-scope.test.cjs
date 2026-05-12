const assert = require('assert');
const fs = require('fs');
const path = require('path');
const knexFactory = require('knex');
const { transform } = require('sucrase');

const root = path.resolve(__dirname, '..');

function loadTsModule(file, mocks = {}) {
  const filename = path.join(root, file);
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

async function createSchema(db) {
  await db.schema.createTable('o_novel', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.integer('chapterIndex');
    table.text('chapter');
    table.integer('eventState');
    table.text('event');
    table.text('chapterData');
  });
  await db.schema.createTable('o_assets', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.text('name');
    table.text('type');
    table.text('describe');
    table.text('prompt');
    table.text('remark');
    table.integer('scriptId');
    table.integer('assetsId');
    table.integer('startTime');
  });
}

function createMessageSink() {
  const messages = [];
  return {
    messages,
    msg: {
      text: (content) => {
        messages.push(String(content));
        return { complete: () => undefined, error: () => undefined };
      },
      thinking: () => ({
        appendText: () => undefined,
        updateTitle: () => undefined,
        complete: () => undefined,
      }),
      complete: () => undefined,
      error: () => undefined,
    },
  };
}

async function testChapterScopedNewAssetExtraction() {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createSchema(db);
  await db('o_novel').insert([
    {
      id: 10,
      projectId: 1,
      chapterIndex: 10,
      chapter: 'juben10',
      event: '| Chapter 10 | Austin Zombie, Fan Zombies, Delivery Boxes | old chapter event |',
      chapterData: 'Austin Zombie fires delivery boxes at the team on the college campus.',
      eventState: 1,
    },
    {
      id: 17,
      projectId: 1,
      chapterIndex: 17,
      chapter: 'juben17',
      event: "| Chapter 17 juben17 | Chloe, Leo, Tiffany, Bob, Eugene | Chloe's team reaches Tiffany's deepest lab, trapped by Botox gas and lasers |",
      chapterData:
        'The elevator went down to the deepest part of Shining Glow Labs. The doors opened into a giant, pure white lab. Tiffany turned in a pink leather chair with four long skinny arms, giant green eyes, and glowing green nails. Chloe held her shotgun. Bob aimed his heavy gun. Leo wiped his frying pan. Botox gas filled the room. Lasers blocked the exit. The monitors showed zombie camera feeds with pink filters and heart stickers.',
      eventState: 1,
    },
  ]);
  await db('o_assets').insert([
    { id: 1, projectId: 1, name: 'Chloe', type: 'role', describe: 'old Chloe', prompt: 'old Chloe prompt' },
    { id: 2, projectId: 1, name: 'Bob', type: 'role', describe: 'old Bob', prompt: 'old Bob prompt' },
    { id: 3, projectId: 1, name: 'Leo', type: 'role', describe: 'old Leo', prompt: 'old Leo prompt' },
    { id: 4, projectId: 1, name: 'Eugene / Cyber Ghost', type: 'role', describe: 'old Eugene', prompt: 'old Eugene prompt' },
    { id: 5, projectId: 1, name: 'Shining Glow Labs Pink Factory', type: 'scene', describe: 'old factory', prompt: 'old factory prompt' },
    { id: 6, projectId: 1, name: "Bob's Gun", type: 'tool', describe: 'old gun', prompt: 'old gun prompt' },
    { id: 7, projectId: 1, name: 'Austin Zombie', type: 'role', describe: 'old Austin', prompt: 'old Austin prompt' },
  ]);

  const service = loadTsModule('src/agents/workspaceAgent/tools.ts', {
    '@/utils': { db },
    '@/socket/resTool': class ResToolMock {},
    '@/services/assetImageGeneration': { submitAssetImageGeneration: async () => ({ submitted: 0 }) },
    '@/services/storyboardDraftGeneration': { clearProjectStoryboards: async () => ({}), toPublicWorkspaceName: (name) => name },
    '@/services/storyboardSkillGeneration': { generateProjectStoryboardWithSkill: async () => ({}) },
    '@/utils/jsonSchema': { toToolJsonSchema: (schema) => schema },
  });

  const sink = createMessageSink();
  const result = await service.runNovelAssetExtractionTool(
    { resTool: { data: { projectId: 1 } }, msg: sink.msg },
    { sourceText: '提取第17章新增角色/场景/道具', chapterIndexes: [17] },
  );

  assert.strictEqual(result.handled, true);
  assert.ok(result.message.includes('第17章 juben17'), result.message);
  assert.ok(result.message.includes('新增资产'), result.message);
  assert.strictEqual(result.result.updatedCount, 0, '新增模式 should not update existing assets');
  assert.ok(result.result.skippedCount >= 5, 'existing chapter assets should be skipped in 新增 mode');

  const assets = await db('o_assets').where({ projectId: 1 }).orderBy('id');
  const names = assets.map((asset) => asset.name);
  for (const expected of [
    'Tiffany / Mutated Tiffany',
    'Shining Glow Labs Deep White Lab',
    "Chloe's Shotgun",
    "Leo's Frying Pan",
    'Botox Gas Trap',
    'Laser Trap Grid',
    "Tiffany's Green Needle Nails",
    'Pink CEO Chair',
    'Filtered Zombie Monitor Wall',
  ]) {
    assert.ok(names.includes(expected), `expected new chapter 17 asset: ${expected}`);
  }
  const austin = await db('o_assets').where({ id: 7 }).first();
  assert.strictEqual(austin.remark, null, 'chapter 10 only asset should not be touched by chapter 17 extraction');
  await db.destroy();
}

async function testAllChapterRemainingAssetExtraction() {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createSchema(db);
  await db('o_novel').insert([
    {
      id: 20,
      projectId: 2,
      chapterIndex: 20,
      chapter: 'juben20',
      event: '| Chapter 20 juben20 | Chloe, Eugene, Bob, Leo, Road Rage Zombies, creepy old man | highway jam and Alpha Bunker clue |',
      chapterData:
        'The truck roared onto the highway. Hundreds of crashed cars blocked the road. Road Rage Zombies smashed their car horns. Eugene wore a gas mask. Leo sprayed non-stick cooking oil on his frying pan. A creepy old man revealed Alpha Bunker.',
      eventState: 1,
    },
    {
      id: 24,
      projectId: 2,
      chapterIndex: 24,
      chapter: 'juben24',
      event: "| Chapter 24 juben24 | Chloe, Leo, Eugene, Bob, her Dad, Olaf, old rich CEOs | The Board's special lunch party and golden server fight |",
      chapterData:
        'Her Dad spoke through golden speakers. Old Rich CEOs and Olaf played a video game with the team. A giant Roomba with chainsaws dropped from the ceiling. A yellow excavator with machine guns fired everywhere. Chloe had to physically break the golden server in the middle of the room.',
      eventState: 1,
    },
    {
      id: 25,
      projectId: 2,
      chapterIndex: 25,
      chapter: 'juben25',
      event: '| Chapter 25 juben25 | Chloe, Eugene, Leo, Bob, Chloe’s dad, Glitch Monster | Master Key admin control and final upload monster |',
      chapterData:
        "The golden door opened to the Golden Upload Lab. The golden water tank boiled. Chloe used her blood and Master Key for admin control. Her failed-upload father became a Glitch Monster with metal robot arms and a glowing red computer board in his chest.",
      eventState: 1,
    },
    {
      id: 26,
      projectId: 2,
      chapterIndex: 26,
      chapter: 'juben26',
      event: '| Chapter 26 juben26 | Chloe, Eugene, Leo, Tiny Dad, Bob | blue orb and system update ending |',
      chapterData:
        'Outside, Vacation Zombies in silk robes were frozen like Red Light, Green Light. Floating loading bars said System Updating and Empathy Patch. A glowing blue orb was left behind and Tiny Dad yelled from Leo’s pan.',
      eventState: 1,
    },
  ]);
  await db('o_assets').insert([
    { id: 1, projectId: 2, name: 'Chloe', type: 'role', describe: 'old Chloe', prompt: 'old Chloe prompt' },
    { id: 2, projectId: 2, name: 'Leo', type: 'role', describe: 'old Leo', prompt: 'old Leo prompt' },
  ]);

  const service = loadTsModule('src/agents/workspaceAgent/tools.ts', {
    '@/utils': { db },
    '@/socket/resTool': class ResToolMock {},
    '@/services/assetImageGeneration': { submitAssetImageGeneration: async () => ({ submitted: 0 }) },
    '@/services/storyboardDraftGeneration': { clearProjectStoryboards: async () => ({}), toPublicWorkspaceName: (name) => name },
    '@/services/storyboardSkillGeneration': { generateProjectStoryboardWithSkill: async () => ({}) },
    '@/utils/jsonSchema': { toToolJsonSchema: (schema) => schema },
  });

  const result = await service.runNovelAssetExtractionTool(
    { resTool: { data: { projectId: 2 } }, msg: createMessageSink().msg },
    { sourceText: '读取所有小说情节提取剩余新增资产' },
  );
  assert.strictEqual(result.result.updatedCount, 0, 'remaining/new extraction should skip existing assets');

  const names = (await db('o_assets').where({ projectId: 2 }).orderBy('id')).map((asset) => asset.name);
  for (const expected of [
    'Road Rage Zombies',
    'Creepy Old Man',
    'Road Rage Highway Jam',
    'Gas Mask',
    'Non-Stick Cooking Oil',
    'Shadow Board Old Rich CEOs',
    'Olaf',
    'The Elysium Board Game Hall',
    'Golden Server Room',
    'Golden Speakers',
    'Chainsaw Roomba',
    'Weaponized Excavator',
    "Chloe's Dad / Tiny Dad",
    'Glitch Monster',
    'Golden Upload Lab',
    'Master Key',
    'Glowing Red Computer Board',
    'Vacation Zombies',
    'Frozen Update World',
    'Glowing Blue Orb',
    'System Update Loading Bars',
  ]) {
    assert.ok(names.includes(expected), `expected all-chapter remaining asset: ${expected}`);
  }
  await db.destroy();
}

async function main() {
  await testChapterScopedNewAssetExtraction();
  await testAllChapterRemainingAssetExtraction();
  console.log('Novel asset extraction scope checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
