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
  await db.schema.createTable('o_project', (table) => {
    table.increments('id').primary();
    table.text('name');
    table.text('type');
    table.text('intro');
    table.text('artStyle');
    table.text('directorManual');
    table.text('videoRatio');
    table.text('imageModel');
    table.text('imageQuality');
  });
  await db.schema.createTable('o_script', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.text('name');
    table.text('content');
  });
  await db.schema.createTable('o_storyboard', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.integer('scriptId');
    table.integer('index');
    table.text('prompt');
    table.text('videoDesc');
    table.text('duration');
    table.text('filePath');
    table.integer('trackId');
  });
  await db.schema.createTable('o_directorBoard', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.integer('scriptId');
    table.text('name');
    table.text('prompt');
    table.text('filePath');
    table.integer('flowId');
    table.text('state');
    table.text('reason');
    table.text('model');
    table.text('boardType');
    table.text('storyboardIds');
    table.text('assetIds');
    table.integer('index');
    table.integer('createTime');
    table.integer('updateTime');
  });
  await db.schema.createTable('o_assets2Storyboard', (table) => {
    table.integer('assetId');
    table.integer('storyboardId');
  });
  await db.schema.createTable('o_assets', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.integer('imageId');
    table.text('name');
    table.text('type');
    table.text('describe');
    table.text('prompt');
  });
  await db.schema.createTable('o_image', (table) => {
    table.increments('id').primary();
    table.text('filePath');
  });
  await db.schema.createTable('o_roleFactCards', (table) => {
    table.integer('projectId');
    table.integer('assetId');
    table.text('roleName');
    table.text('facts');
    table.text('negativeFacts');
  });
}

async function main() {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createSchema(db);
  await db('o_project').insert({
    id: 1,
    name: 'Director Draft',
    type: '水果美剧',
    intro: 'English-language short drama',
    videoRatio: '16:9',
  });
  await db('o_script').insert({ id: 10, projectId: 1, name: 'juben10', content: 'Chloe reaches the bunker.' });
  await db('o_storyboard').insert(
    Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      projectId: 1,
      scriptId: 10,
      index,
      duration: index % 2 ? '3' : '2',
      videoDesc: `Shot ${index + 1}: Chloe advances through the bunker.`,
      prompt: `bunker shot ${index + 1}`,
    })),
  );

  let imageRunCount = 0;
  const service = loadTsModule('src/services/directorBoardGeneration.ts', {
    '@/utils': {
      db,
      error: (error) => (error instanceof Error ? error : new Error(String(error))),
      oss: {
        getImageBase64: async () => '',
        getSmallImageUrl: async (filePath) => filePath,
        getFileUrl: async (filePath) => filePath,
      },
      Ai: {
        Text: () => ({ invoke: async () => ({ text: '' }) }),
        Image: () => ({
          run: async () => {
            imageRunCount += 1;
            return { save: async () => {} };
          },
        }),
      },
    },
  });

  const rows = await service.queueDirectorBoardGeneration(1, 10, {
    storyboardIds: [1, 2, 3, 4, 5, 6, 7, 8],
    boardType: 'textStoryboard',
    shotsPerBoard: 6,
    replace: true,
  });

  assert.strictEqual(rows.length, 2, '8 storyboards should create two director-board drafts');
  assert.strictEqual(imageRunCount, 0, 'draft generation must not call image generation by default');
  const savedRows = await db('o_directorBoard').orderBy('index', 'asc');
  assert.deepStrictEqual(savedRows.map((row) => row.state), ['未生成', '未生成']);
  assert.ok(savedRows.every((row) => row.prompt && row.storyboardIds), 'draft rows should keep prompts and covered storyboard ids');
  assert.ok(savedRows.every((row) => row.boardType === 'textStoryboard'), 'draft rows should persist the selected board type');
  assert.ok(savedRows.every((row) => row.prompt.includes('Storyboard card content:')), 'text storyboard boards should use the text-rich prompt');

  await db.destroy();
  console.log('Director board queue checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
