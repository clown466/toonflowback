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
  await db('o_project').insert({ id: 1, name: 'Isolation Test', artStyle: 'anime', videoRatio: '16:9' });
  await db('o_novel').insert([
    {
      id: 10,
      projectId: 1,
      chapterIndex: 10,
      chapter: 'juben10',
      chapterData: 'JUBEN10_ONLY_TEXT hero enters the blue room.',
      event: '| juben10 | hero | JUBEN10_EVENT_ONLY | strong | high | 45秒 | suspense |',
      eventState: 1,
    },
    {
      id: 16,
      projectId: 1,
      chapterIndex: 16,
      chapter: 'juben16',
      chapterData: 'JUBEN16_SHOULD_NOT_APPEAR villain reveals future plot.',
      event: '| juben16 | villain | JUBEN16_EVENT_SHOULD_NOT_APPEAR | strong | high | 45秒 | suspense |',
      eventState: 1,
    },
  ]);
  await db('o_assets').insert([
    { id: 1, projectId: 1, name: 'hero', type: 'role', describe: 'main hero', prompt: 'hero prompt' },
    { id: 2, projectId: 1, name: 'villain', type: 'role', describe: 'future villain', prompt: 'villain prompt' },
  ]);

  const service = loadTsModule('src/services/storyboardDraftGeneration.ts', {
    '@/utils': { db },
  });

  assert.deepStrictEqual(service.parseStoryboardChapterIndexes('请针对 juben10 生成分镜'), [10]);
  assert.deepStrictEqual(service.parseStoryboardChapterIndexes('请针对第十章生成分镜'), [10]);

  const result = await service.generateProjectStoryboardDraft(1, {
    sourceText: '请针对 juben10 生成分镜，不要处理后续章节',
    force: true,
  });

  assert.deepStrictEqual(result.selectedChapterIndexes, [10], 'only chapter 10 should be selected');
  assert.ok(result.scriptName.includes('第10章'), 'script should be chapter-scoped');
  assert.strictEqual(result.createdCount, 3, 'single chapter should produce three draft shots');

  const script = await db('o_script').where('id', result.episodesId).first();
  assert.ok(script.content.includes('JUBEN10_ONLY_TEXT'), 'script content should include chapter 10 text');
  assert.ok(!script.content.includes('JUBEN16_SHOULD_NOT_APPEAR'), 'script content must not include chapter 16 text');

  const storyboards = await db('o_storyboard').where('scriptId', result.episodesId).orderBy('index');
  const storyboardText = storyboards.map((row) => `${row.videoDesc}\n${row.prompt}`).join('\n');
  assert.ok(storyboardText.includes('JUBEN10_EVENT_ONLY'), 'storyboards should use chapter 10 event');
  assert.ok(!storyboardText.includes('JUBEN16_EVENT_SHOULD_NOT_APPEAR'), 'storyboards must not use chapter 16 event');
  assert.ok(!result.storyboardTable.includes('JUBEN16_EVENT_SHOULD_NOT_APPEAR'), 'storyboard table must not include chapter 16 event');

  const clearResult = await service.clearProjectStoryboards(1, {
    sourceText: '清空 juben10 分镜',
  });
  assert.strictEqual(clearResult.cleared, true, 'chapter-scoped storyboard clear should execute');
  assert.strictEqual(clearResult.deletedCount, 3, 'clear should delete the three chapter 10 storyboards');
  assert.strictEqual(await db('o_storyboard').where('scriptId', result.episodesId).count({ count: 'id' }).first().then((row) => Number(row.count)), 0);
  assert.strictEqual(await db('o_assets2Storyboard').count({ count: 'storyboardId' }).first().then((row) => Number(row.count)), 0);
  assert.strictEqual(await db('o_videoTrack').count({ count: 'id' }).first().then((row) => Number(row.count)), 0);

  await db('o_project').insert({ id: 2, name: 'Imported Chapter Name Test', artStyle: 'anime', videoRatio: '16:9' });
  await db('o_novel').insert([
    {
      id: 101,
      projectId: 2,
      chapterIndex: 1,
      chapter: 'juben10',
      chapterData: 'IMPORTED_JUBEN10_ONLY_TEXT detective studies the fruit market.',
      event: '| juben10 | detective | IMPORTED_JUBEN10_EVENT_ONLY | strong | high | 45秒 | noir |',
      eventState: 1,
    },
    {
      id: 102,
      projectId: 2,
      chapterIndex: 2,
      chapter: 'juben11',
      chapterData: 'IMPORTED_JUBEN11_SHOULD_NOT_APPEAR rival enters the next chapter.',
      event: '| juben11 | rival | IMPORTED_JUBEN11_EVENT_SHOULD_NOT_APPEAR | strong | high | 45秒 | noir |',
      eventState: 1,
    },
  ]);

  const importedResult = await service.generateProjectStoryboardDraft(2, {
    sourceText: '推理出juben10的分镜',
    force: true,
  });

  assert.deepStrictEqual(importedResult.selectedNovelIds, [101], 'juben10 should match the imported chapter name record');
  assert.deepStrictEqual(importedResult.selectedChapterIndexes, [1], 'imported juben10 is project-internal row 1');
  assert.deepStrictEqual(importedResult.selectedChapterLabels, ['juben10（项目内第1条）']);
  assert.ok(importedResult.scriptName.includes('第1章 juben10'), 'script name should expose both internal index and original chapter name');

  const importedScript = await db('o_script').where('id', importedResult.episodesId).first();
  assert.ok(importedScript.content.includes('IMPORTED_JUBEN10_ONLY_TEXT'), 'script content should use imported juben10');
  assert.ok(!importedScript.content.includes('IMPORTED_JUBEN11_SHOULD_NOT_APPEAR'), 'script content must not pull the next imported chapter');

  const importedStoryboards = await db('o_storyboard').where('scriptId', importedResult.episodesId).orderBy('index');
  const importedStoryboardText = importedStoryboards.map((row) => `${row.videoDesc}\n${row.prompt}`).join('\n');
  assert.ok(importedStoryboardText.includes('IMPORTED_JUBEN10_EVENT_ONLY'), 'storyboards should use imported juben10 event');
  assert.ok(!importedStoryboardText.includes('IMPORTED_JUBEN11_EVENT_SHOULD_NOT_APPEAR'), 'storyboards must not use imported juben11 event');

  await db.destroy();
  console.log('Storyboard chapter isolation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
