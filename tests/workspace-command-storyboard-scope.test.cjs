const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { transform } = require("sucrase");

const root = path.resolve(__dirname, "..");

function loadTsModule(file, mocks = {}) {
  const filename = path.join(root, file);
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

const { createWorkspaceCommandPlan } = loadTsModule("src/agents/workspaceAgent/command/planner.ts");

const snapshot = {
  project: { id: 1, name: "Fruit Drama" },
  novels: [
    { id: 101, chapterIndex: 10, chapter: "juben10" },
    { id: 102, chapterIndex: 11, chapter: "juben11" },
  ],
  scripts: [],
  assets: [],
  imageGenerationSkills: [],
};

const byChapterName = createWorkspaceCommandPlan("推理出juben10的分镜", snapshot);
assert.ok(byChapterName, "juben chapter command should create a plan");
assert.strictEqual(byChapterName.intent, "storyboard_generation");
assert.strictEqual(byChapterName.confirmationPolicy, "auto");
assert.deepStrictEqual(byChapterName.scope.chapterIds, [101]);
assert.deepStrictEqual(byChapterName.executor.options.novelIds, [101]);

const byChapterIndex = createWorkspaceCommandPlan("推理出第10章的分镜", snapshot);
assert.ok(byChapterIndex, "chapter-index command should create a plan");
assert.strictEqual(byChapterIndex.intent, "storyboard_generation");
assert.strictEqual(byChapterIndex.confirmationPolicy, "auto");
assert.deepStrictEqual(byChapterIndex.scope.chapterIds, [101]);
assert.deepStrictEqual(byChapterIndex.scope.chapterIndexes, [10]);
assert.deepStrictEqual(byChapterIndex.executor.options.novelIds, [101]);
assert.deepStrictEqual(byChapterIndex.executor.options.chapterIndexes, [10]);

console.log("Workspace storyboard scope command checks passed");
