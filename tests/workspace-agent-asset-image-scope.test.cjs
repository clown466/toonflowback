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
    table.text('imageModel');
    table.text('imageQuality');
    table.text('artStyle');
  });
  await db.schema.createTable('o_assets', (table) => {
    table.increments('id').primary();
    table.text('name');
    table.text('type');
    table.text('describe');
    table.text('prompt');
    table.integer('imageId');
    table.integer('assetsId');
    table.integer('projectId');
  });
  await db.schema.createTable('o_image', (table) => {
    table.increments('id').primary();
    table.text('state');
    table.text('filePath');
  });
}

function createMessageSink() {
  const messages = [];
  return {
    messages,
    msg: {
      thinking: () => ({
        appendText: () => undefined,
        updateTitle: () => undefined,
        complete: () => undefined,
      }),
      text: (content) => {
        messages.push(content);
        return {
          complete: () => undefined,
          error: () => undefined,
        };
      },
      complete: () => undefined,
      error: () => undefined,
    },
  };
}

async function main() {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createSchema(db);
  await db('o_project').insert({ id: 1, name: 'Scope Test', imageModel: 'demo:image', imageQuality: '1K', artStyle: 'anime' });
  await db('o_assets').insert([
    { id: 1, projectId: 1, name: 'Chloe', type: 'role', describe: 'role desc', prompt: 'role prompt' },
    { id: 2, projectId: 1, name: 'Bob', type: 'role', describe: 'role desc', prompt: 'role prompt' },
    { id: 10, projectId: 1, name: 'Scene 1', type: 'scene', describe: 'scene desc 1', prompt: 'scene prompt 1' },
    { id: 11, projectId: 1, name: 'Scene 2', type: 'scene', describe: 'scene desc 2', prompt: 'scene prompt 2' },
    { id: 12, projectId: 1, name: 'Scene 3', type: 'scene', describe: 'scene desc 3', prompt: 'scene prompt 3' },
    { id: 13, projectId: 1, name: 'Scene 4', type: 'scene', describe: 'scene desc 4', prompt: 'scene prompt 4' },
    { id: 14, projectId: 1, name: 'Scene 5', type: 'scene', describe: 'scene desc 5', prompt: 'scene prompt 5' },
    { id: 20, projectId: 1, name: 'Prop 1', type: 'tool', describe: 'prop desc', prompt: 'prop prompt' },
  ]);

  let capturedInput = null;
  const serviceMock = {
    submitAssetImageGeneration: async (input) => {
      capturedInput = input;
      return {
        projectId: input.projectId,
        total: input.items.length,
        submitted: input.items.length,
        skippedGenerating: 0,
        imageIds: input.items.map((item, index) => ({ assetId: item.id, imageId: 100 + index })),
      };
    },
  };

  const tools = loadTsModule('src/agents/workspaceAgent/tools.ts', {
    ai: { tool: (definition) => definition },
    '@/utils': { db, error: (error) => (error instanceof Error ? error : new Error(String(error))) },
    '@/socket/resTool': function ResTool() {},
    '@/services/assetImageGeneration': serviceMock,
    '@/services/storyboardDraftGeneration': {
      clearProjectStoryboards: async () => ({}),
      generateProjectStoryboardDraft: async () => ({}),
    },
    '@/utils/jsonSchema': { toToolJsonSchema: (schema) => schema },
  });

  assert.strictEqual(tools.parseAssetImageRequestScope('尝试生成前4个场景图片').assetType, 'scene');
  assert.strictEqual(tools.parseAssetImageRequestScope('尝试生成前4个场景图片').limit, 4);
  assert.strictEqual(tools.parseAssetImageRequestScope('请生成前四个角色图').assetType, 'role');
  assert.strictEqual(tools.parseAssetImageRequestScope('请生成前四个角色图').limit, 4);

  const { msg, messages } = createMessageSink();
  const emitted = [];
  await tools.runProjectAssetImageGenerationFastPath(
    {
      resTool: {
        data: { projectId: 1 },
        socket: { emit: (event, payload) => emitted.push({ event, payload }) },
      },
      msg,
    },
    { sourceText: '尝试生成前4个场景图片。' },
  );

  assert.ok(capturedInput, 'asset generation service should be called');
  assert.deepStrictEqual(capturedInput.items.map((item) => item.id), [10, 11, 12, 13]);
  assert.deepStrictEqual(capturedInput.items.map((item) => item.type), ['scene', 'scene', 'scene', 'scene']);
  assert.ok(messages.join('\n').includes('已按范围筛选：场景，前 4 个'), 'message should report scoped selection');
  assert.ok(emitted.some((item) => item.payload?.assetIds?.join(',') === '10,11,12,13'), 'socket update should include only selected assets');

  await db.destroy();
  console.log('Workspace agent asset image scope checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
