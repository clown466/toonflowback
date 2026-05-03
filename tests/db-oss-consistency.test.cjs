const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knexFactory = require('knex');
const { transform } = require('sucrase');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toonflow-db-oss-'));
process.chdir(tempDir);
process.env.NODE_ENV = 'test';

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
  return module.exports.__esModule && module.exports.default ? module.exports.default : module.exports;
}

async function main() {
  const getPath = loadTsModule('src/utils/getPath.ts');
  const oss = loadTsModule('src/utils/oss.ts', {
    '@/utils/getPath': getPath,
  });

  assert.strictEqual(await oss.isValidFile('missing.png'), false, 'missing file should be invalid');
  await oss.writeFile('empty.png', Buffer.alloc(0));
  assert.strictEqual(await oss.isValidFile('empty.png'), false, '0 byte file should be invalid');
  await oss.writeFile('valid.png', Buffer.from('ok'));
  assert.strictEqual(await oss.isValidFile('valid.png'), true, 'non-empty file should be valid');

  const knex = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await knex.schema.createTable('o_image', (table) => {
    table.integer('id').notNullable();
    table.text('filePath');
    table.text('state');
    table.text('errorReason');
  });
  await knex.schema.createTable('o_storyboard', (table) => {
    table.integer('id').notNullable();
    table.text('filePath');
    table.text('state');
    table.text('reason');
  });
  await knex.schema.createTable('o_video', (table) => {
    table.integer('id').notNullable();
    table.text('filePath');
    table.text('state');
    table.text('errorReason');
  });

  await knex('o_image').insert([
    { id: 1, filePath: 'valid.png', state: '已完成', errorReason: null },
    { id: 2, filePath: 'missing.png', state: '已完成', errorReason: null },
    { id: 3, filePath: '', state: '已完成', errorReason: null },
    { id: 4, filePath: 'empty.png', state: '已完成', errorReason: null },
  ]);
  await knex('o_storyboard').insert([
    { id: 11, filePath: 'valid.png', state: '已完成', reason: null },
    { id: 12, filePath: 'missing-storyboard.png', state: '已完成', reason: null },
  ]);
  await knex('o_video').insert([
    { id: 21, filePath: 'valid.png', state: '生成成功', errorReason: null },
    { id: 22, filePath: 'empty.png', state: '生成成功', errorReason: null },
  ]);

  const code = fs.readFileSync(path.join(root, 'src/lib/fixDB.ts'), 'utf8');
  const match = code.match(/const MISSING_ARTIFACT_REASON[\s\S]*?\n}\n\nexport default async/);
  assert(match, 'fixDB should expose repair helper before default export');
  const repairTsSource = `${match[0].replace(/\n\nexport default async$/, '')}\nreturn repairMissingArtifacts;`;
  const repairSource = transform(repairTsSource, { transforms: ['typescript'] }).code;
  const repairMissingArtifacts = new Function('db', 'u', repairSource)(knex, { oss });
  await repairMissingArtifacts(knex);

  const images = await knex('o_image').orderBy('id');
  assert.strictEqual(images[0].state, '已完成', 'valid image should stay completed');
  for (const row of images.slice(1)) {
    assert.strictEqual(row.state, '生成失败', `image ${row.id} should be repaired`);
    assert.strictEqual(row.errorReason, '产物文件缺失或为空');
  }

  const storyboards = await knex('o_storyboard').orderBy('id');
  assert.strictEqual(storyboards[0].state, '已完成', 'valid storyboard should stay completed');
  assert.strictEqual(storyboards[1].state, '生成失败');
  assert.strictEqual(storyboards[1].reason, '产物文件缺失或为空');

  const videos = await knex('o_video').orderBy('id');
  assert.strictEqual(videos[0].state, '生成成功', 'valid video should stay success');
  assert.strictEqual(videos[1].state, '生成失败');
  assert.strictEqual(videos[1].errorReason, '产物文件缺失或为空');

  await knex.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('DB/OSS consistency checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
