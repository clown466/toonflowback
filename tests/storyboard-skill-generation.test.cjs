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
    table.text('focalLength');
    table.text('aperture');
    table.text('shutterSpeed');
    table.text('iso');
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
            if (response instanceof Error) throw response;
            if (response && typeof response === 'object' && response.__throw) {
              const error = new Error(response.message || String(response.__throw));
              if (response.name) error.name = response.name;
              throw error;
            }
            if (response && typeof response === 'object' && response.__streamChunks) {
              const chunks = response.__streamChunks;
              const throwAfterChunks = response.__throwAfterChunks;
              return {
                textStream: (async function* () {
                  for (const chunk of chunks) yield chunk;
                  if (throwAfterChunks) {
                    const error = new Error(response.message || 'aborted');
                    if (response.name) error.name = response.name;
                    throw error;
                  }
                })(),
              };
            }
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
  assert.ok(capturedPrompt.includes('shots.length 必须等于内部表的数据行数'), 'prompt should keep table and shots aligned');

  const storyboards = await db('o_storyboard').where({ projectId: 1, scriptId: result.episodesId }).orderBy('index');
  assert.strictEqual(storyboards.length, 1);
  assert.strictEqual(storyboards[0].videoDesc, 'SELECTED_EVENT_ONLY opening shot');
  assert.strictEqual(storyboards[0].prompt, 'hero in blue room, cinematic keyframe');
  assert.strictEqual(storyboards[0].shouldGenerateImage, 1);

  const links = await db('o_assets2Storyboard').where({ storyboardId: storyboards[0].id }).orderBy('assetId');
  assert.deepStrictEqual(links.map((row) => row.assetId), [1, 2]);

  await db('o_project').insert({
    id: 12,
    name: 'Preferred Workspace Chapter',
    intro: 'Project intro',
    artStyle: 'animated thriller',
    directorManual: 'Use clear beats',
    videoRatio: '16:9',
  });
  await db('o_novel').insert([
    {
      id: 121,
      projectId: 12,
      chapterIndex: 10,
      chapter: 'juben10',
      chapterData: 'J10_ONLY should not be used when current workspace is chapter 17.',
      event: '| juben10 | old room | J10_EVENT_ONLY |',
      eventState: 1,
    },
    {
      id: 122,
      projectId: 12,
      chapterIndex: 17,
      chapter: 'juben17',
      chapterData: 'J17_ONLY current workspace chapter should be used for vague retry commands.',
      event: '| juben17 | bunker | J17_EVENT_ONLY |',
      eventState: 1,
    },
  ]);
  await db('o_script').insert({
    id: 120,
    projectId: 12,
    name: 'Flova 小说章节工作区 - 第17章 juben17',
    content: 'J17_ONLY current workspace chapter should be used for vague retry commands.',
    createTime: Date.now(),
  });
  await db('o_assets').insert([
    { id: 123, projectId: 12, name: 'Chloe', type: 'role', describe: 'lead', prompt: 'Chloe prompt' },
    { id: 124, projectId: 12, name: 'bunker', type: 'scene', describe: 'bunker', prompt: 'bunker prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [
    {
      storyboardTable: '',
      shots: Array.from({ length: 4 }, (_, index) => ({
        duration: 3,
        videoDesc: `J17_EVENT_ONLY retry beat ${index + 1}.`,
        imagePrompt: `Chloe in bunker retry beat ${index + 1}`,
        associateAssetNames: ['Chloe', 'bunker'],
        dialogue: '无台词',
      })),
    },
  ];
  const preferredWorkspaceResult = await service.generateProjectStoryboardWithSkill(12, {
    sourceText: '再次推理，要求系统把镜头总时长拉长并增加对白承载镜头',
    preferredScriptId: 120,
    force: true,
  });
  assert.strictEqual(preferredWorkspaceResult.selectedChapterIndexes[0], 17, 'vague retry should resolve the current workspace chapter');
  assert.ok(capturedPrompts[0].includes('J17_ONLY'), 'current workspace chapter body should reach model');
  assert.ok(capturedPrompts[0].includes('J17_EVENT_ONLY'), 'current workspace chapter event should reach model');
  assert.ok(!capturedPrompts[0].includes('J10_ONLY'), 'first imported chapter must not leak into vague retry');
  assert.ok(!capturedPrompts[0].includes('J10_EVENT_ONLY'), 'first imported event must not leak into vague retry');

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
  const invalidJsonResult = await service.generateProjectStoryboardWithSkill(3, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });
  assert.strictEqual(invalidJsonResult.createdCount, 0, 'invalid JSON should not auto-write a fallback storyboard');
  assert.strictEqual(invalidJsonResult.reviewStatus, 'failed');
  assert.ok(String(invalidJsonResult.message).includes('没有启用兜底草案'), invalidJsonResult.message);
  assert.ok(String(invalidJsonResult.reviewRetryInstruction).includes('按审核结论重新生成'), invalidJsonResult.reviewRetryInstruction);
  assert.strictEqual(capturedPrompts.length, 1, 'structured path should still call the model once');
  const invalidStoryboards = await db('o_storyboard').where({ projectId: 3 });
  assert.strictEqual(invalidStoryboards.length, 0, 'invalid model output should leave existing storyboard data untouched');

  await db('o_project').insert({
    id: 9,
    name: 'Timeout Stable Fallback',
    intro: 'English-language fast drama',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Keep the chapter under two minutes with fast readable cuts',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 90,
    projectId: 9,
    chapterIndex: 17,
    chapter: 'juben17',
    chapterData:
      'Chloe checks the bunker monitor. Bob locks the pressure door. Leo raises the frying pan and notices the alarm reflection. Chloe says, "Move now. If that red light turns solid, the whole bunker wakes up." Bob answers, "Then stop talking and pick a corridor." Leo says, "Left corridor smells less explosive." The team rushes into the service hall while the camera cuts between faces, boots, and the alarm panel.',
    event: '| juben17 | Chloe, Bob, Leo, bunker | The team escapes the bunker alarm under fast pressure |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 91, projectId: 9, name: 'Chloe', type: 'role', describe: 'peach lead', prompt: 'Chloe prompt' },
    { id: 92, projectId: 9, name: 'Bob', type: 'role', describe: 'orange soldier', prompt: 'Bob prompt' },
    { id: 93, projectId: 9, name: 'Leo', type: 'role', describe: 'yellow lemon', prompt: 'Leo prompt' },
    { id: 94, projectId: 9, name: 'bunker', type: 'scene', describe: 'safe bunker', prompt: 'bunker prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [{ __throw: true, message: '分镜模型响应超过 120 秒，请检查当前文本模型是否可用，或切换更快的文本模型后重试' }];
  const timeoutResult = await service.generateProjectStoryboardWithSkill(9, {
    sourceText: '请针对 juben17 重新生成分镜表',
    force: true,
  });
  assert.strictEqual(timeoutResult.createdCount, 0, 'timeout should not auto-write a fallback storyboard');
  assert.strictEqual(timeoutResult.reviewStatus, 'failed');
  assert.ok(String(timeoutResult.message).includes('没有启用兜底草案'), timeoutResult.message);
  assert.strictEqual(capturedPrompts.length, 1, 'timeout path should call the structured model once');
  assert.ok(capturedPrompts[0].includes('juben17'), 'target chapter should reach the model before timeout');
  const timeoutStoryboards = await db('o_storyboard').where({ projectId: 9, scriptId: timeoutResult.episodesId }).orderBy('index');
  assert.strictEqual(timeoutStoryboards.length, 0, 'timeout should leave storyboard rows untouched');

  await db('o_project').insert({
    id: 11,
    name: 'Terminated Stable Fallback',
    intro: 'English-language fast drama',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Recover from interrupted model streams',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 110,
    projectId: 11,
    chapterIndex: 17,
    chapter: 'juben17',
    chapterData: 'Chloe says, "Keep moving. The lab alarm is not a suggestion." Bob opens the service door while Leo checks the pan reflection.',
    event: '| juben17 | Chloe, Bob, Leo, lab | The team pushes through an alarm escape |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 111, projectId: 11, name: 'Chloe', type: 'role', describe: 'peach lead', prompt: 'Chloe prompt' },
    { id: 112, projectId: 11, name: 'lab', type: 'scene', describe: 'white lab', prompt: 'lab prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [{ __throw: true, message: 'terminated' }];
  const terminatedResult = await service.generateProjectStoryboardWithSkill(11, {
    sourceText: '再次推理 juben17 分镜，增加对白承载镜头',
    force: true,
  });
  assert.strictEqual(terminatedResult.createdCount, 0, 'terminated model stream should not auto-write a fallback');
  assert.strictEqual(terminatedResult.reviewStatus, 'failed');
  const terminatedStoryboards = await db('o_storyboard').where({ projectId: 11, scriptId: terminatedResult.episodesId });
  assert.strictEqual(terminatedStoryboards.length, 0, 'terminated stream should leave storyboard rows untouched');

  await db('o_project').insert({
    id: 13,
    name: 'Partial Stream Recovery',
    intro: 'English-language fast drama',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Recover usable streamed shots before provider timeout',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 130,
    projectId: 13,
    chapterIndex: 17,
    chapter: 'juben17',
    chapterData: 'Chloe runs through the bunker. Bob blocks the door. Leo spots the alarm. Chloe says, "Move now."',
    event: '| juben17 | Chloe, Bob, Leo, bunker | The team escapes before the alarm locks the bunker |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 131, projectId: 13, name: 'Chloe', type: 'role', describe: 'peach lead', prompt: 'Chloe prompt' },
    { id: 132, projectId: 13, name: 'Bob', type: 'role', describe: 'orange soldier', prompt: 'Bob prompt' },
    { id: 133, projectId: 13, name: 'Leo', type: 'role', describe: 'yellow lemon', prompt: 'Leo prompt' },
    { id: 134, projectId: 13, name: 'bunker', type: 'scene', describe: 'safe bunker', prompt: 'bunker prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  const partialShots = Array.from({ length: 4 }, (_, index) => ({
    duration: 3,
    videoDesc: `Recovered streamed bunker beat ${index + 1}.`,
    imagePrompt: `Chloe Bob Leo bunker recovered beat ${index + 1}`,
    associateAssetNames: ['Chloe', 'Bob', 'Leo', 'bunker'],
    dialogue: index === 2 ? 'Chloe: Move now.' : 'No dialogue',
  }));
  mockStoryboardResponses = [
    {
      __streamChunks: [`{"storyboardTable":"","shots":[${partialShots.map((shot) => JSON.stringify(shot)).join(',')},`],
      __throwAfterChunks: true,
      name: 'AbortError',
      message: 'aborted',
    },
  ];
  const partialRecoveryResult = await service.generateProjectStoryboardWithSkill(13, {
    sourceText: '请针对 juben17 生成4个分镜',
    force: true,
  });
  assert.strictEqual(partialRecoveryResult.fallbackReason, undefined, 'usable partial streamed JSON should be recovered instead of falling back');
  assert.strictEqual(partialRecoveryResult.createdCount, 4, 'complete streamed shot objects should be written');
  const partialRows = await db('o_storyboard').where({ projectId: 13, scriptId: partialRecoveryResult.episodesId }).orderBy('index');
  assert.ok(partialRows.every((row) => String(row.videoDesc).includes('Recovered streamed bunker beat')), 'partial recovery should preserve model-produced shots');

  await db('o_project').insert({
    id: 14,
    name: 'Review Blocked Candidate',
    intro: 'English-language fast drama',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Respect explicit shot counts',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 140,
    projectId: 14,
    chapterIndex: 17,
    chapter: 'juben17',
    chapterData: 'Chloe enters the bunker. Bob blocks the door. Leo checks the alarm reflection.',
    event: '| juben17 | Chloe, Bob, Leo, bunker | The team enters the bunker under pressure |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 141, projectId: 14, name: 'Chloe', type: 'role', describe: 'peach lead', prompt: 'Chloe prompt' },
    { id: 142, projectId: 14, name: 'bunker', type: 'scene', describe: 'safe bunker', prompt: 'bunker prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [
    {
      storyboardTable: '',
      shots: [1, 2].map((index) => ({
        duration: 3,
        videoDesc: `Only two beats ${index}.`,
        imagePrompt: `Chloe bunker beat ${index}`,
        associateAssetNames: ['Chloe', 'bunker'],
        dialogue: '无台词',
      })),
    },
  ];
  const reviewBlockedResult = await service.generateProjectStoryboardWithSkill(14, {
    sourceText: '请针对 juben17 生成4个分镜',
    force: true,
  });
  assert.strictEqual(reviewBlockedResult.createdCount, 0, 'review failure should not write candidate storyboards');
  assert.strictEqual(reviewBlockedResult.reviewStatus, 'failed');
  assert.ok(String(reviewBlockedResult.reviewFailures?.[0]).includes('用户明确要求 4 个分镜'), reviewBlockedResult.reviewFailures);
  assert.ok(String(reviewBlockedResult.reviewRetryInstruction).includes('严格输出 4 个镜头'), reviewBlockedResult.reviewRetryInstruction);
  const reviewBlockedRows = await db('o_storyboard').where({ projectId: 14, scriptId: reviewBlockedResult.episodesId });
  assert.strictEqual(reviewBlockedRows.length, 0, 'review-blocked candidates should leave old storyboard rows untouched');

  await db('o_project').insert({
    id: 10,
    name: 'Short Duration Repair',
    intro: 'English-language fast dark comedy',
    type: '水果美剧',
    artStyle: 'American 3D animated black comedy',
    directorManual: 'Keep dialogue readable while cutting fast',
    videoRatio: '16:9',
  });
  const longDialogue =
    'Chloe says, "Move now before the cameras wake up, because if the alarm sees Bob carrying that frying pan, the bunker doors will lock, Leo will start explaining physics again, and every guard in this place will sprint here like they are late for a promotion. I need the left corridor covered, the elevator disabled, the vent camera turned around, and nobody improvises unless the improvisation is quieter than Bob breathing. Bob, keep the pressure door half open, not fully open, because fully open means the hallway microphone hears us and half open means the security desk blames maintenance. Leo, stop polishing the pan and watch the red light. If it blinks twice we move, if it stays solid we freeze, and if it sings the company anthem we pretend we are already captured."';
  await db('o_novel').insert({
    id: 100,
    projectId: 10,
    chapterIndex: 17,
    chapter: 'juben17',
    chapterData: longDialogue,
    event: '| juben17 | Chloe, Bob, Leo, bunker | Chloe pushes the team through a fast bunker escape while issuing urgent instructions |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 101, projectId: 10, name: 'Chloe', type: 'role', describe: 'peach lead', prompt: 'Chloe prompt' },
    { id: 102, projectId: 10, name: 'Bob', type: 'role', describe: 'orange soldier', prompt: 'Bob prompt' },
    { id: 103, projectId: 10, name: 'Leo', type: 'role', describe: 'yellow lemon', prompt: 'Leo prompt' },
    { id: 104, projectId: 10, name: 'bunker', type: 'scene', describe: 'safe bunker', prompt: 'bunker prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  const shortShots = Array.from({ length: 18 }, (_, index) => ({
    duration: index % 3 === 0 ? 2 : 3,
    videoDesc: `Too short bunker dialogue beat ${index + 1}.`,
    imagePrompt: `Chloe, Bob, and Leo in bunker beat ${index + 1}`,
    associateAssetNames: ['Chloe', 'Bob', 'Leo', 'bunker'],
    dialogue: index < 12 ? 'Chloe: Go now.' : '无台词',
  }));
  mockStoryboardResponses = [{ storyboardTable: '', shots: shortShots }];

  const shortDurationResult = await service.generateProjectStoryboardWithSkill(10, {
    sourceText: '删除17章原有分镜，重新推理出新的17章分镜，要求总时长足够承载对白',
    force: true,
  });
  assert.strictEqual(capturedPrompts.length, 1, 'short duration should be repaired locally without repeated model retries');
  assert.strictEqual(shortDurationResult.fallbackReason, undefined, 'local duration repair should not need stable fallback when model JSON is usable');
  const shortDurationRows = await db('o_storyboard').where({ projectId: 10, scriptId: shortDurationResult.episodesId }).orderBy('index');
  const shortDurationTotal = shortDurationRows.reduce((sum, row) => sum + Number(row.duration), 0);
  assert.ok(shortDurationTotal >= 60, `local repair should expand short storyboard duration, got ${shortDurationTotal}s`);
  assert.ok(shortDurationTotal <= 120, `local repair must stay under two minutes, got ${shortDurationTotal}s`);
  assert.ok(shortDurationRows.length >= shortShots.length, 'duration repair should keep or add fast-cut shots instead of collapsing the storyboard');

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
      storyboardTable: '| 镜号 | 时长 | 画面 |\\n| --- | ---: | --- |\\n| 1 | 2s | Setup |\\n| 2 | 3s | Warning starts |\\n| 3 | 3s | Guard risk |\\n| 4 | 3s | Gate risk |\\n| 5 | 3s | Sunrise line begins |\\n| 6 | 3s | Sunrise line lands |\\n| 7 | 2s | Team reaction |\\n| 8 | 2s | Bob reaction |',
      shots: [
        {
          duration: 2,
          videoDesc: 'Safehouse tension before Chloe speaks.',
          imagePrompt: 'safehouse tense opening',
          associateAssetNames: ['safehouse'],
          dialogue: '无台词',
        },
        {
          duration: 3,
          videoDesc: 'Chloe starts the warning in a tight close-up.',
          imagePrompt: 'Chloe warning close shot',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: This plan is not safe.',
        },
        {
          duration: 3,
          videoDesc: 'Chloe explains the guards know their faces.',
          imagePrompt: 'Chloe tense medium shot',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: The guards already know our faces.',
        },
        {
          duration: 3,
          videoDesc: 'The east gate problem lands on the team.',
          imagePrompt: 'team reacting in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: The east gate is locked.',
        },
        {
          duration: 3,
          videoDesc: 'A cut-in angle catches Chloe starting the sunrise threat.',
          imagePrompt: 'Chloe sunrise warning cut-in',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: If we wait until sunrise.',
        },
        {
          duration: 3,
          videoDesc: 'A reaction angle catches the warning landing on everyone.',
          imagePrompt: 'team tense reaction in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: 'Chloe: Everyone gets dragged into the street.',
        },
        {
          duration: 2,
          videoDesc: 'The team absorbs the warning in a tight reaction shot.',
          imagePrompt: 'team tense reaction in safehouse',
          associateAssetNames: ['Chloe', 'safehouse'],
          dialogue: '无台词',
        },
        {
          duration: 2,
          videoDesc: 'Bob looks away, realizing Chloe is right.',
          imagePrompt: 'Bob tense reaction in safehouse',
          associateAssetNames: ['safehouse'],
          dialogue: '无台词',
        },
      ],
    },
  ];

  const dialogueResult = await service.generateProjectStoryboardWithSkill(2, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });

  assert.strictEqual(dialogueResult.createdCount, 7, 'dialogue-heavy chapter should locally split long dialogue across fast cuts');
  assert.strictEqual(capturedPrompts.length, 1, 'oversized dialogue should be repaired locally without another model retry');
  assert.deepStrictEqual(capturedModelKeys, ['productionAgent:storyboardTableAgent']);
  assert.ok(capturedPrompts[0].includes('dialogueTimingRules'), 'prompt context should include front-loaded dialogue timing rules');
  assert.ok(capturedPrompts[0].includes('sourceDialogueFastCutChunks'), 'prompt context should include pre-split dialogue chunks');
  assert.ok(capturedPrompts[0].includes('maxDialogueSecondsPerShot'), 'prompt context should expose the per-shot dialogue cap');
  assert.ok(capturedPrompts[0].includes('不要把 selectedChapters.chapterData 里的完整长句复制进单个镜头'), 'prompt should explicitly forbid copying long raw dialogue into one shot');

  const dialogueStoryboards = await db('o_storyboard').where({ projectId: 2, scriptId: dialogueResult.episodesId }).orderBy('index');
  assert.strictEqual(dialogueStoryboards.length, 7);
  assert.ok(dialogueStoryboards.every((row) => Number(row.duration) <= 4), 'dialogue shots should stay in 2-4s fast-cut rhythm');
  const totalDuration = dialogueStoryboards.reduce((sum, row) => sum + Number(row.duration), 0);
  assert.ok(totalDuration >= 20, `normalized total duration should be dialogue-aware, got ${totalDuration}s`);

  await db('o_project').insert({
    id: 7,
    name: 'Dialogue Repair',
    intro: 'English-language fast drama',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Split long dialogue into fast cuts',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 70,
    projectId: 7,
    chapterIndex: 10,
    chapter: 'juben10',
    chapterData:
      'Chloe says, "Listen, we cannot keep pretending this plan is safe. The guards already know our faces, the east gate is locked, and if we wait until sunrise every person in this room gets dragged into the street."',
    event: '| juben10 | Chloe, safehouse | Chloe warns the team that the plan is collapsing |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 71, projectId: 7, name: 'Chloe', type: 'role', describe: 'leader', prompt: 'Chloe prompt' },
    { id: 72, projectId: 7, name: 'safehouse', type: 'scene', describe: 'hideout', prompt: 'safehouse prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  const oversizedSingleShot = {
    storyboardTable: '| 镜号 | 时长 | 画面 |\\n| --- | ---: | --- |\\n| 1 | 15s | Chloe monologue |',
    shots: [
      {
        duration: 15,
        videoDesc: 'Chloe delivers the warning in one uninterrupted shot.',
        imagePrompt: 'Chloe monologue in safehouse',
        associateAssetNames: ['Chloe', 'safehouse'],
        dialogue:
          'Chloe: Listen, we cannot keep pretending this plan is safe. The guards already know our faces, the east gate is locked, and if we wait until sunrise every person in this room gets dragged into the street.',
      },
    ],
  };
  mockStoryboardResponses = [oversizedSingleShot, oversizedSingleShot, oversizedSingleShot];

  const repairedDialogueResult = await service.generateProjectStoryboardWithSkill(7, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });
  assert.ok(repairedDialogueResult.createdCount > 1, 'local quality repair should split an oversized monologue instead of failing');
  assert.strictEqual(capturedPrompts.length, 1, 'oversized monologue should be repaired locally without repeated model retries');
  const repairedStoryboards = await db('o_storyboard').where({ projectId: 7, scriptId: repairedDialogueResult.episodesId }).orderBy('index');
  assert.ok(repairedStoryboards.every((row) => Number(row.duration) <= 4), 'repaired dialogue cuts should stay within the fast-cut shot cap');
  assert.ok(repairedStoryboards.some((row) => String(row.videoDesc).includes('fast dialogue cut')), 'repaired rows should mark the fast-cut split');

  await db('o_project').insert({
    id: 8,
    name: 'Flat Timing',
    intro: 'English-language American short drama with varied timing',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Use fast cuts with rhythm variation',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 80,
    projectId: 8,
    chapterIndex: 10,
    chapter: 'juben10',
    chapterData: 'Chloe spots Leo near the gate, Bob drops the keycard, and the team races into the bunker before security arrives.',
    event: '| juben10 | Chloe, Leo, Bob, gate, bunker | The team crosses the gate and enters the bunker under pressure |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 81, projectId: 8, name: 'Chloe', type: 'role', describe: 'lead', prompt: 'Chloe prompt' },
    { id: 82, projectId: 8, name: 'bunker', type: 'scene', describe: 'bunker', prompt: 'bunker prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [
    {
      storyboardTable: '',
      shots: Array.from({ length: 6 }, (_, index) => ({
        duration: 2,
        videoDesc: `Flat two-second beat ${index + 1}.`,
        imagePrompt: `Chloe and team flat beat ${index + 1}`,
        associateAssetNames: ['Chloe', 'bunker'],
        dialogue: '无台词',
      })),
    },
    {
      storyboardTable: '',
      shots: [2, 3, 4, 3, 3, 4].map((duration, index) => ({
        duration,
        videoDesc: `Varied timing beat ${index + 1}.`,
        imagePrompt: `Chloe and team varied beat ${index + 1}`,
        associateAssetNames: ['Chloe', 'bunker'],
        dialogue: '无台词',
      })),
    },
  ];

  const variedTimingResult = await service.generateProjectStoryboardWithSkill(8, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });
  assert.strictEqual(variedTimingResult.createdCount, 6);
  assert.strictEqual(capturedPrompts.length, 1, 'flat all-2s timing should be repaired locally without another model retry');
  const variedTimingRows = await db('o_storyboard').where({ projectId: 8, scriptId: variedTimingResult.episodesId }).orderBy('index');
  assert.deepStrictEqual(variedTimingRows.map((row) => Number(row.duration)), [2, 3, 4, 3, 2, 3]);

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
      shots: Array.from({ length: 34 }, (_, index) => ({
        duration: 3,
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
  assert.strictEqual(fastCutResult.createdCount, 34, '34 fast-cut shots should be valid for a 90-120s chapter');
  assert.ok(capturedPrompts[0].includes('目标总时长'), 'prompt should include a chapter duration budget');
  assert.ok(capturedPrompts[0].includes('硬上限 120s'), 'prompt should make the 2-minute cap explicit');
  assert.ok(capturedPrompts[0].includes('2-4 秒'), 'prompt should tell the model to use varied fast short shots');
  assert.ok(capturedPrompts[0].includes('单张章节导演板/一次 AI 视频生成片段'), 'prompt should scope 4-15s to director boards, not single shots');
  const fastCutStoryboards = await db('o_storyboard').where({ projectId: 5, scriptId: fastCutResult.episodesId }).orderBy('index');
  const fastCutDurations = fastCutStoryboards.map((row) => Number(row.duration));
  assert.ok(fastCutDurations.every((duration) => duration >= 1 && duration <= 4), `fast-cut shot durations should allow sub-4s cuts: ${fastCutDurations.join(',')}`);
  const fastCutTotal = fastCutDurations.reduce((sum, duration) => sum + duration, 0);
  assert.ok(fastCutTotal <= 120, `chapter duration budget should prevent 3-minute storyboard tables, got ${fastCutTotal}s`);

  await db('o_project').insert({
    id: 6,
    name: 'Hard Two Minute Cap',
    intro: 'English-language American short drama with very dense fast cuts',
    type: '水果美剧',
    artStyle: 'animated short drama',
    directorManual: 'Never exceed two minutes',
    videoRatio: '16:9',
  });
  await db('o_novel').insert({
    id: 60,
    projectId: 6,
    chapterIndex: 10,
    chapter: 'juben10',
    chapterData: Array.from({ length: 120 }, (_, index) => `Beat ${index + 1}: a short explosive campus cut.`).join(' '),
    event: '| juben10 | Chloe, campus | A dense fast-cut sequence must stay under two minutes |',
    eventState: 1,
  });
  await db('o_assets').insert([
    { id: 61, projectId: 6, name: 'Chloe', type: 'role', describe: 'lead', prompt: 'Chloe prompt' },
    { id: 62, projectId: 6, name: 'campus', type: 'scene', describe: 'campus', prompt: 'campus prompt' },
  ]);

  capturedPrompts = [];
  capturedModelKeys = [];
  mockStoryboardResponses = [
    {
      storyboardTable: '',
      shots: Array.from({ length: 60 }, (_, index) => ({
        duration: 2,
        videoDesc: `Too many flat cuts ${index + 1}.`,
        imagePrompt: `Chloe flat cut ${index + 1}`,
        associateAssetNames: ['Chloe', 'campus'],
        dialogue: '无台词',
      })),
    },
  ];

  const hardCapResult = await service.generateProjectStoryboardWithSkill(6, {
    sourceText: '请针对 juben10 重新生成分镜',
    force: true,
  });
  assert.ok(hardCapResult.createdCount <= 40, `60 all-2s shots should be merged under the shot budget, got ${hardCapResult.createdCount}`);
  assert.strictEqual(capturedPrompts.length, 1, '60 all-2s shots should be repaired locally without another model retry');
  const hardCapStoryboards = await db('o_storyboard').where({ projectId: 6, scriptId: hardCapResult.episodesId }).orderBy('index');
  const hardCapTotal = hardCapStoryboards.reduce((sum, row) => sum + Number(row.duration), 0);
  assert.ok(hardCapTotal <= 120, `chapter storyboard total must never exceed 120s, got ${hardCapTotal}s`);
  assert.ok(hardCapStoryboards.some((row) => Number(row.duration) === 4), 'local repair should merge some flat 2s cuts into 4s beats');

  await db.destroy();
  console.log('Storyboard skill generation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
