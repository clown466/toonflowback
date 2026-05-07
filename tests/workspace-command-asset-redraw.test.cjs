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
  novels: [],
  scripts: [],
  assets: [
    { id: 42, name: "Safe Bunker", type: "scene" },
    { id: 43, name: "Rooftop", type: "scene" },
  ],
  imageGenerationSkills: [],
};

const text = [
  "重新生成Safe Bunker场景图",
  "",
  "使用资产生图预设：场景俯视全景参考（skillId: scene_top_down_panorama）",
].join("\n");

const plan = createWorkspaceCommandPlan(text, snapshot);

assert.ok(plan, "asset redraw command should create a workspace command plan");
assert.strictEqual(plan.intent, "asset_image_generation");
assert.strictEqual(plan.scope.assetType, "scene");
assert.deepStrictEqual(plan.scope.assetIds, [42]);
assert.deepStrictEqual(plan.scope.assetNames, ["Safe Bunker"]);
assert.strictEqual(plan.scope.includeCompleted, true, "重新生成 should allow redrawing completed assets");
assert.strictEqual(plan.scope.skillId, "scene_top_down_panorama");
assert.strictEqual(plan.executor.options.includeCompleted, true);
assert.strictEqual(plan.executor.options.skillId, "scene_top_down_panorama");

console.log("Workspace asset redraw command checks passed");
