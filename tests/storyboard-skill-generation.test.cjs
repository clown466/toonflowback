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
    table.text('intro');
    table.text('type');
    table.text('artStyle');
    table.text('directorManual');
    table.text('videoRatio');
  });
  await db.schema.createTable('o_novel', (table) => {
    table.increments('id').primary();
    table.integer('chapterIndex');
    table.text('chapter');
    table.text('chapterData');
    table.text('event');
    table.integer('eventState');
    table.integer('projectId');
  });
  await db.schema.createTable('o_script', (table) => {
    table.increments('id').primary();
    table.text('name');
    table.text('content');
    table.integer('projectId');
    table.integer('createTime');
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
  await db.schema.createTable('o_scriptAssets', (table) => {
    table.integer('scriptId');
    table.integer('assetId');
  });
  await db.schema.createTable('o_storyboard', (table) => {
    table.increments('id').primary();
    table.text('prompt');
    table.text('duration');
    table.text('state');
    table.integer('scriptId');
    table.integer('projectId');
    table.text('track');
    table.integer('trackId');
    table.text('videoDesc');
    table.integer('shouldGenerateImage');
    table.integer('index');
    table.integer('createTime');
  });
  await db.schema.createTable('o_videoTrack', (table) => {
    table.integer('id').primary();
    table.integer('scriptId');
    table.integer('projectId');
    table.integer('duration');
  });
  await db.schema.createTable('o_assets2Storyboard', (table) => {
    table.integer('assetId');
    table.integer('storyboardId');
  });
  await db.schema.createTable('o_agentWorkData', (table) => {
    table.increments('id').primary();
    table.integer('projectId');
    table.integer('episodesId');
    table.text('key');
    table.text('data');
    table.integer('createTime');
    table.integer('updateTime');
  });
}

async function main() {
  const db = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createSchema(db);
  await db('o_project').insert({
    id: 1,
    name: 'Skill Storyboard',
    intro: 'Project intro',
    artStyle: 'anime noir',
    directorManual: 'Use tense staging',
    videoRatio: '16:9',
  });
  await db('o_novel').insert([
    {
      id: 10,
      projectId: 1,
      chapterIndex: 10,
      chapter: 'juben10',
      chapterData: 'SELECTED_CHAPTER_ONLY hero enters the blue room.',
      event: '| juben10 | hero, blue room | SELECTED_EVENT_ONLY |',
      eventState: 1,
    },
    {
      id: 11,
      projectId: 1,
      chapterIndex: 11,
      chapter: 'juben11',
      chapterData: 'FUTURE_CHAPTER_MUST_NOT_REACH_MODEL villain arrives.',
      event: '| juben11 | villain | FUTURE_EVENT_MUST_NOT_REACH_MODEL |',
      eventState: 1,
    },
  ]);
  await db('o_assets').insert([
    { id: 1, projectId: 1, name: 'hero', type: 'role', describe: 'main hero', prompt: 'hero prompt' },
    { id: 2, projectId: 1, name: 'blue room', type: 'scene', describe: 'blue room scene', prompt: 'room prompt' },
    { id: 3, projectId: 1, name: 'villain', type: 'role', describe: 'future villain', prompt: 'villain prompt' },
  ]);

  let capturedPrompt = '';
  const service = loadTsModule('src/services/storyboardSkillGeneration.ts', {
    '@/utils': {
      db,
      Ai: {
        Text: () => ({
          invoke: async (input) => {
            capturedPrompt = input.prompt;
            return {
              text: JSON.stringify({
                storyboardTable: '| 镜号 | 时长 | 画面/动作 | 关联资产 |\\n| --- | ---: | --- | --- |\\n| 1 | 5s | SELECTED_EVENT_ONLY opening | hero, blue room |',
                shots: [
                  {
                    duration: 5,
                    videoDesc: 'SELECTED_EVENT_ONLY opening shot',
                    imagePrompt: 'hero in blue room, cinematic keyframe',
                    associateAssetNames: ['hero', 'blue room'],
                    shouldGenerateImage: true,
                    scene: 'blue room',
                    shotSize: 'wide',
                    cameraMove: 'slow push',
                    action: 'hero enters',
                    emotion: 'tense',
                    lighting: 'cool',
                    beat: 'opening',
                  },
                ],
              }),
            };
          },
        }),
      },
    },
  });

  const result = await service.generateProjectStoryboardWithSkill(1, {
    sourceText: '请针对 juben10 生成分镜',
    force: true,
    skillId: 'cinematic_skill',
    userRequirement: '更紧张',
  });

  assert.strictEqual(result.createdCount, 1);
  assert.strictEqual(result.usedSkillId, 'cinematic_skill');
  assert.strictEqual(result.fallbackReason, undefined);
  assert.ok(capturedPrompt.includes('SELECTED_CHAPTER_ONLY'), 'selected chapter body should reach model');
  assert.ok(capturedPrompt.includes('SELECTED_EVENT_ONLY'), 'selected chapter event should reach model');
  assert.ok(!capturedPrompt.includes('FUTURE_CHAPTER_MUST_NOT_REACH_MODEL'), 'future chapter body must not reach model');
  assert.ok(!capturedPrompt.includes('FUTURE_EVENT_MUST_NOT_REACH_MODEL'), 'future chapter event must not reach model');

  const storyboards = await db('o_storyboard').where({ projectId: 1, scriptId: result.episodesId }).orderBy('index');
  assert.strictEqual(storyboards.length, 1);
  assert.strictEqual(storyboards[0].videoDesc, 'SELECTED_EVENT_ONLY opening shot');
  assert.strictEqual(storyboards[0].prompt, 'hero in blue room, cinematic keyframe');
  assert.strictEqual(storyboards[0].shouldGenerateImage, 1);

  const links = await db('o_assets2Storyboard').where({ storyboardId: storyboards[0].id }).orderBy('assetId');
  assert.deepStrictEqual(links.map((row) => row.assetId), [1, 2]);

  await db.destroy();
  console.log('Storyboard skill generation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
