const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { transform } = require("sucrase");

const root = path.resolve(__dirname, "..");

function loadTsModule(file, mocks = {}) {
  const filename = path.join(root, file);
  assert.ok(fs.existsSync(filename), `${file} should exist`);
  const code = fs.readFileSync(filename, "utf8");
  const js = transform(code, { transforms: ["typescript", "imports"] }).code;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) return loadTsModule(path.join("src", `${id.slice(2)}.ts`), mocks);
    if (id.startsWith("./") || id.startsWith("../")) {
      const target = path.join(path.dirname(file), id);
      return loadTsModule(target.endsWith(".ts") || target.endsWith(".json") ? target : `${target}.ts`, mocks);
    }
    return require(id);
  };
  const fn = new Function("require", "module", "exports", "__dirname", "__filename", js);
  fn(localRequire, module, module.exports, path.dirname(filename), filename);
  return module.exports;
}

const mockUtils = {
  Ai: {
    Text: () => ({
      invoke: async ({ system, messages }) => {
        assert.match(system, /English only|中文提示词/, "normalization system prompt should force one output language");
        assert.ok(messages[0].content.includes("黄色柠檬"), "normalization should receive the original mixed prompt");
        return { text: "Create a director board. C1 Leo is a yellow lemon in a tactical vest." };
      },
    }),
  },
};

const service = loadTsModule("src/services/directorBoardGeneration.ts", {
  "@/utils": mockUtils,
});

function buildPrompt(language) {
  return service.buildChapterDirectorBoardPrompt({
    project: {
      id: 1,
      name: "Fruit Crime",
      type: language === "english" ? "水果美剧" : "中文短剧",
      videoRatio: "9:16",
      artStyle: "cinematic animation",
    },
    script: {
      id: 10,
      name: "juben10",
      content: language === "english" ? "Chloe enters the warehouse and raises the shotgun." : "Chloe 进入仓库并举起霰弹枪。",
    },
    boardIndex: 0,
    totalBoards: 1,
    storyboards: [
      {
        id: 1,
        index: 0,
        videoDesc: language === "english" ? "Chloe confronts Leo near the warehouse door." : "Chloe 在仓库门口对峙 Leo。",
        prompt: language === "english" ? "wide shot, tense blocking" : "广角镜头，紧张调度",
        duration: "5s",
      },
    ],
    assets: [
      {
        id: 1,
        name: "Chloe",
        type: "role",
        roleFacts: "水蜜桃拟人女性，粉橙色桃子头，有清晰桃子纵向凹沟，穿战术背心，带霰弹枪和小刀，自信讽刺。",
      },
      {
        id: 2,
        name: "Bob",
        type: "role",
        roleFacts: "橙子水果士兵，橙色果皮身体，戴防毒面具，穿军装，严肃警觉，实用主义。",
      },
      {
        id: 3,
        name: "Leo",
        type: "role",
        roleFacts: "黄色柠檬角色，穿战术背心，不是青柠。",
      },
    ],
    language,
  });
}

(async () => {
  assert.equal(
    service.detectDirectorBoardPromptLanguage({
      project: { id: 1, type: "水果美剧" },
      script: { id: 10, content: "Chloe 举起霰弹枪，Leo 站在门口。" },
      storyboards: [{ id: 1, videoDesc: "Chloe 和 Leo 对峙。" }],
    }),
    "english",
    "explicit American-drama intent should choose English even when source notes contain Chinese",
  );

  assert.equal(
    service.detectDirectorBoardPromptLanguage({
      project: { id: 1, type: "中文短剧" },
      script: { id: 10, content: "Chloe 举起霰弹枪，Leo 站在门口。" },
      storyboards: [{ id: 1, videoDesc: "Chloe 和 Leo 对峙。" }],
    }),
    "chinese",
    "explicit Chinese intent should choose Chinese",
  );

  const englishPrompt = buildPrompt("english");
  assert.match(englishPrompt, /Use the fixed layout below exactly/, "English director board prompt should force a fixed structure");
  assert.match(englishPrompt, /Use the attached reference images in order:/, "English director board prompt should use short ordered refs");
  assert.match(englishPrompt, /Center bottom: 6 storyboard panels/, "English director board prompt should keep a stable six-panel layout");
  assert.doesNotMatch(englishPrompt, /简单版式：/, "English director board prompt should not use Chinese structure");
  assert.match(englishPrompt, /All visible text must be English only/, "English prompt should constrain visible labels");
  assert.match(englishPrompt, /simple readable colored pencil figures/, "English prompt should use the simpler board style");
  assert.match(englishPrompt, /Ref 1 \(C1\): Chloe\. a peach figure\./, "English role refs should keep minimal identifying Chloe details");
  assert.match(englishPrompt, /Ref 2 \(C2\): Bob\. an orange soldier figure\./, "English role refs should keep minimal identifying Bob details");
  assert.match(englishPrompt, /Ref 3 \(C3\): Leo\. a bright yellow lemon figure\./, "English role refs should keep minimal identifying Leo details");
  assert.doesNotMatch(englishPrompt, /[\u3400-\u9fff]/, "English prompt should not keep Chinese source text");
  const roleRefLines = englishPrompt.split("\n").filter((line) => /^Ref \d+ \(C\d+\): (Chloe|Bob|Leo)\./.test(line));
  assert.ok(roleRefLines.every((line) => line.length <= 90), "English role ref lines should stay minimal enough for image prompts");
  assert.ok(englishPrompt.length < 3500, "English director board prompt should stay concise");

  const englishTextStoryboardPrompt = service.buildChapterDirectorBoardPrompt({
    project: {
      id: 1,
      name: "Fruit Crime",
      type: "水果美剧",
      videoRatio: "9:16",
      artStyle: "cinematic animation",
    },
    script: {
      id: 10,
      name: "juben10",
      content: "Chloe enters the warehouse and raises the shotgun.",
    },
    boardIndex: 0,
    totalBoards: 1,
    storyboards: [
      {
        id: 1,
        index: 0,
        videoDesc: "Chloe confronts Leo near the warehouse door.",
        prompt: "wide shot, tense blocking",
        duration: "5s",
      },
    ],
    assets: [],
    language: "english",
    boardType: "textStoryboard",
  });
  assert.match(englishTextStoryboardPrompt, /text-rich storyboard director board/, "text storyboard type should use a richer board prompt");
  assert.match(englishTextStoryboardPrompt, /All visible text must be English only/, "text storyboard must force English visible text");
  assert.match(englishTextStoryboardPrompt, /Storyboard card content:/, "text storyboard should include per-card content");
  assert.doesNotMatch(englishTextStoryboardPrompt, /分镜卡内容|版式要求/, "English text storyboard prompt should not include Chinese labels");

  const chinesePrompt = buildPrompt("chinese");
  assert.match(chinesePrompt, /固定结构：/, "Chinese director board prompt should use a fixed structure");
  assert.match(chinesePrompt, /中下：6 个连续分镜小格/, "Chinese director board prompt should keep a stable six-panel layout");
  assert.doesNotMatch(chinesePrompt, /Simple layout:/, "Chinese director board prompt should not use English structure");
  assert.match(chinesePrompt, /画面文字保持简短可读，并统一使用中文/, "Chinese prompt should constrain visible labels");
  assert.match(chinesePrompt, /角色只画成简单铅笔\/马克笔符号或剪影/, "Chinese prompt should use the simpler board style");
  assert.ok(chinesePrompt.length < 3000, "Chinese director board prompt should stay concise");

  const normalized = await service.normalizeDirectorBoardPromptLanguage(
    "Create one director board.\nCharacter facts: 黄色柠檬角色，穿战术背心。",
    "english",
  );
  assert.equal(normalized, "Create a director board. C1 Leo is a yellow lemon in a tactical vest.");

  const directorBoardChunks = service.chunkStoryboardsForDirectorBoards(
    [
      { id: 1, duration: "4" },
      { id: 2, duration: "5" },
      { id: 3, duration: "6" },
      { id: 4, duration: "4" },
      { id: 5, duration: "7" },
    ],
    { maxDuration: 15, maxShots: 6 },
  );
  assert.deepStrictEqual(
    directorBoardChunks.map((chunk) => chunk.map((item) => item.id)),
    [
      [1, 2, 3],
      [4, 5],
    ],
    "director boards should be grouped by <=15s video-generation windows",
  );

  const src = fs.readFileSync(path.join(root, "src/services/directorBoardGeneration.ts"), "utf8");
  assert.match(src, /normalizeDirectorBoardPromptLanguage\(prompt, promptLanguage\)/, "background image task should normalize the prompt before image generation");
  assert.match(src, /promptLanguage,\s*model/, "generation paths should pass the detected language into the background image task");

  console.log("Director board prompt language checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
