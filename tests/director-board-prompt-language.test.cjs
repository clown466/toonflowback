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
        id: 2,
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
  assert.match(englishPrompt, /Primary goal:/, "English director board prompt should use English structure");
  assert.doesNotMatch(englishPrompt, /主要目标：/, "English director board prompt should not use Chinese structure");
  assert.match(englishPrompt, /All visible board labels and annotations must be in English only/, "English prompt should constrain visible labels");

  const chinesePrompt = buildPrompt("chinese");
  assert.match(chinesePrompt, /主要目标：/, "Chinese director board prompt should use Chinese structure");
  assert.doesNotMatch(chinesePrompt, /Primary goal:/, "Chinese director board prompt should not use English structure");
  assert.match(chinesePrompt, /画面内所有标签和标注统一使用中文/, "Chinese prompt should constrain visible labels");

  const normalized = await service.normalizeDirectorBoardPromptLanguage(
    "Create one director board.\nCharacter facts: 黄色柠檬角色，穿战术背心。",
    "english",
  );
  assert.equal(normalized, "Create a director board. C1 Leo is a yellow lemon in a tactical vest.");

  const src = fs.readFileSync(path.join(root, "src/services/directorBoardGeneration.ts"), "utf8");
  assert.match(src, /normalizeDirectorBoardPromptLanguage\(prompt, promptLanguage\)/, "background image task should normalize the prompt before image generation");
  assert.match(src, /promptLanguage,\s*model/, "generation paths should pass the detected language into the background image task");

  console.log("Director board prompt language checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
