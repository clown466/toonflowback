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
  await db.schema.createTable('o_image', (table) => {
    table.increments('id').primary();
    table.text('filePath');
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
  let capturedPrompts = [];
  let capturedModelKeys = [];
  let mockStoryboardResponses = [];
  const service = loadTsModule('src/services/storyboardSkillGeneration.ts', {
    '@/utils': {
      db,
      Ai: {
        Text: (modelKey) => ({
          stream: async (input) => {
            capturedModelKeys.push(modelKey);
            capturedPrompt = input.prompt;
            capturedPrompts.push(input.prompt);
            const response = mockStoryboardResponses.shift();
            const text = typeof response === 'string' ? response : JSON.stringify(response);
            return {
              textStream: (async function* () {
                yield text;
              })(),
            };
          },
        }),
      },
    },
  });

  mockStoryboardResponses = [
    {
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
    },
  ];

  const result = await service.generateProjectStoryboardWithSkill(1, {
    sourceText: '请针对 juben10 生成1个分镜',
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
  assert.ok(!capturedPrompt.includes('future villain'), 'unrelated future-only assets should not reach storyboard model context');
  assert.strictEqual(capturedModelKeys[0], 'productionAgent:storyboardTableAgent', 'structured storyboard generation should use the dedicated storyboard table agent model');
  assert.ok(capturedPrompt.includes('固定流程'), 'prompt should include the base storyboard method');
  assert.ok(capturedPrompt.includes('narrativeFunction'), 'prompt should include the storyboard table template fields');
  assert.ok(capturedPrompt.includes('先生成 storyboardTable'), 'prompt should require storyboard table first');
  assert.ok(capturedPrompt.includes('用户明确要求数量'), 'prompt should respect explicit shot count');
  assert.ok(capturedPrompt.includes('shots.length 必须等于 storyboardTable 的数据行数'), 'prompt should keep table and shots aligned');

  const storyboards = await db('o_storyboard').where({ projectId: 1, scriptId: result.episodesId }).orderBy('index');
  assert.strictEqual(storyboards.length, 1);
  assert.strictEqual(storyboards[0].videoDesc, 'SELECTED_EVENT_ONLY opening shot');
  assert.strictEqual(storyboards[0].prompt, 'hero in blue room, cinematic keyframe');
  assert.strictEqual(storyboards[0].shouldGenerateImage, 1);

  const links = await db('o_assets2Storyboard').where({ storyboardId: storyboards[0].id }).orderBy('assetId');
  assert.deepStrictEqual(links.map((row) => row.assetId), [1, 2]);

  await db('o_project').insert({
    id: 3,
    name: 'Invalid Model Output',
    intro: 'Project intro',
    artStyle: 'animated thriller',
    directorManual: 'Use clear beats',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 30,
    projectId: 3,
    chapterIndex: 1,
    chapter: 'juben10',
    chapterData: 'Chloe crosses the market and sees the warning sign.',
    event: '| juben10 | Chloe, market | Chloe notices danger |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 21, projectId: 3, name: 'Chloe', type: 'role', describe: 'lead', prompt: 'Chloe prompt' },
    { id: 22, projectId: 3, name: 'market', type: 'scene', describe: 'market', prompt: 'market prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = ['not json'];
  await assert.rejects(
    () =>
      service.generateProjectStoryboardWithSkill(3, {
        sourceText: '请针对 juben10 重新生成分镜',
        force: true,
      }),
    (error) => {
      assert.ok(String(error.message).includes('结构化分镜生成失败'), error.message);
      assert.ok(String(error.message).includes('已停止写入'), error.message);
      return true;
    },
  );
  assert.strictEqual(capturedPrompts.length, 1, 'structured path should still call the model once');
  const invalidStoryboards = await db('o_storyboard').where({ projectId: 3 });
  assert.strictEqual(invalidStoryboards.length, 0, 'invalid model output must not write fallback storyboards');

  await db('o_project').insert({
    id: 4,
    name: 'Explicit Quick Draft',
    intro: 'Project intro',
    artStyle: 'animated thriller',
    directorManual: 'Use clear beats',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 40,
    projectId: 4,
    chapterIndex: 1,
    chapter: 'juben10',
    chapterData: 'Chloe enters the old station.',
    event: '| juben10 | Chloe, station | Chloe enters the station |',
    eventState: 1,
  });

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [];
  const quickDraftResult = await service.generateProjectStoryboardWithSkill(4, {
    sourceText: '请针对 juben10 生成快速草稿',
    force: true,
  });
  assert.strictEqual(quickDraftResult.createdCount, 3, 'explicit quick draft should keep the old three-shot draft path');
  assert.ok(String(quickDraftResult.fallbackReason).includes('快速草稿'));
  assert.strictEqual(capturedPrompts.length, 0, 'explicit quick draft should not call the structured model');

  await db('o_project').insert({
    id: 2,
    name: 'Dialogue Timing',
    intro: 'Project intro',
    artStyle: 'animated short drama',
    directorManual: 'Keep dialogue playable',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 20,
    projectId: 2,
    chapterIndex: 10,
    chapter: 'juben10',
    chapterData:
      'Chloe says, "Listen, we cannot keep pretending this plan is safe. The guards already know our faces, the east gate is locked, and if we wait until sunrise every person in this room gets dragged into the street."',
    event: '| juben10 | Chloe, safehouse | Chloe warns the team that the plan is collapsing |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 11, projectId: 2, name: 'Chloe', type: 'role', describe: 'leader', prompt: 'Chloe prompt' },
    { id: 12, projectId: 2, name: 'safehouse', type: 'scene', describe: 'hideout', prompt: 'safehouse prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [
    {
      storyboardTable: '| 镜号 | 时长 | 画面 |\\n| --- | ---: | --- |\\n| 1 | 4s | Chloe speaks |\\n| 2 | 4s | Team listens |\\n| 3 | 5s | Chloe finishes |',
      shots: [
        {
          duration: 4,
          videoDesc: 'Chloe begins warning the team.',
          imagePrompt: 'Chloe in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: Listen, we cannot keep pretending this plan is safe.',
        },
        {
          duration: 4,
          videoDesc: 'The team reacts.',
          imagePrompt: 'tense team in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: The guards already know our faces, the east gate is locked.',
        },
        {
          duration: 5,
          videoDesc: 'Chloe delivers the final warning.',
          imagePrompt: 'Chloe final warning',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: If we wait until sunrise every person in this room gets dragged into the street.',
        },
      ],
    },
    {
      storyboardTable: '| 镜号 | 时长 | 画面 |\\n| --- | ---: | --- |\\n| 1 | 3s | Setup |\\n| 2 | 4s | Warning starts |\\n| 3 | 4s | Guard risk |\\n| 4 | 4s | Gate risk |\\n| 5 | 4s | Sunrise threat |\\n| 6 | 4s | Team reaction |',
      shots: [
        {
          duration: 3,
          videoDesc: 'Safehouse tension before Chloe speaks.',
          imagePrompt: 'safehouse tense opening',
          associateAssetNames: ['safehouse'],
          dialogue: '无台词',
        },
        {
          duration: 2,
          videoDesc: 'Chloe tells the team the plan is unsafe.',
          imagePrompt: 'Chloe warning close shot',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: Listen, we cannot keep pretending this plan is safe.',
        },
        {
          duration: 2,
          videoDesc: 'Chloe explains the guards know their faces.',
          imagePrompt: 'Chloe tense medium shot',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: The guards already know our faces.',
        },
        {
          duration: 2,
          videoDesc: 'The east gate problem lands on the team.',
          imagePrompt: 'team reacting in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: The east gate is locked.',
        },
        {
          duration: 2,
          videoDesc: 'Chloe finishes with the sunrise threat.',
          imagePrompt: 'Chloe final warning dramatic light',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: If we wait until sunrise every person in this room gets dragged into the street.',
        },
        {
          duration: 4,
          videoDesc: 'The team absorbs the warning in a tight reaction shot.',
          imagePrompt: 'team tense reaction in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: '无台词',
        },
      ],
    },
  ];

  const dialogueResult = await service.generateProjectStoryboardWithSkill(2, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });

  assert.strictEqual(dialogueResult.createdCount, 6, 'dialogue-heavy chapter should retry instead of accepting three shots');
  assert.strictEqual(capturedPrompts.length, 2, 'bad low-count/short-duration output should trigger one retry');
  assert.deepStrictEqual(capturedModelKeys, ['productionAgent:storyboardTableAgent', 'productionAgent:storyboardTableAgent']);
  assert.ok(capturedPrompts[1].includes('上一次输出不合格'), 'retry prompt should explain the quality failure');

  const dialogueStoryboards = await db('o_storyboard').where({ projectId: 2, scriptId: dialogueResult.episodesId }).orderBy('index');
  assert.strictEqual(dialogueStoryboards.length, 6);
  const totalDuration = dialogueStoryboards.reduce((sum, row) => sum + Number(row.duration), 0);
  assert.ok(totalDuration >= 20, `normalized total duration should be dialogue-aware, got ${totalDuration}s`);

  await db('o_project').insert({
    id: 5,
    name: 'Fast Cut Budget',
    intro: 'English-language American short drama with explosive pacing',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Use fast cuts and punchy American TV rhythm',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 50,
    projectId: 5,
    chapterIndex: 10,
    chapter: 'juben10',
    chapterData: Array.from({ length: 80 }, (_, index) => `Beat ${index + 1}: Chloe, Bob, and Leo push through a dangerous campus gag with fast physical comedy.`).join(' '),
    event: '| juben10 | Chloe, Bob, Leo, campus | The team crosses campus through escalating danger with fast comedy beats |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 51, projectId: 5, name: 'Chloe', type: 'role', describe: 'lead', prompt: 'Chloe prompt' },
    { id: 52, projectId: 5, name: 'campus', type: 'scene', describe: 'campus', prompt: 'campus prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [
    {
      storyboardTable: '',
      shots: Array.from({ length: 20 }, (_, index) => ({
        duration: 10,
        videoDesc: `Fast campus beat ${index + 1}.`,
        imagePrompt: `Chloe and team in fast campus beat ${index + 1}`,
        associateAssetNames: ['Chloe', 'campus'],
        dialogue: '无台词',
      })),
    },
  ];

  const fastCutResult = await service.generateProjectStoryboardWithSkill(5, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });
  assert.strictEqual(fastCutResult.createdCount, 20);
  assert.ok(capturedPrompts[0].includes('目标总时长'), 'prompt should include a chapter duration budget');
  assert.ok(capturedPrompts[0].includes('4-6s'), 'prompt should tell the model to use fast short shots');
  const fastCutStoryboards = await db('o_storyboard').where({ projectId: 5, scriptId: fastCutResult.episodesId }).orderBy('index');
  const fastCutDurations = fastCutStoryboards.map((row) => Number(row.duration));
  assert.ok(fastCutDurations.every((duration) => duration >= 4 && duration <= 6), `fast-cut shot durations should stay short: ${fastCutDurations.join(',')}`);
  const fastCutTotal = fastCutDurations.reduce((sum, duration) => sum + duration, 0);
  assert.ok(fastCutTotal <= 120, `chapter duration budget should prevent 3-minute storyboard tables, got ${fastCutTotal}s`);

  await db.destroy();
  console.log('Storyboard skill generation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
