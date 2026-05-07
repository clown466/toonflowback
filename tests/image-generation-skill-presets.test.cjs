const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { transform } = require("sucrase");

const root = path.resolve(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "toonflow-image-skills-"));

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

const service = loadTsModule("src/services/imageGenerationSkill.ts", {
  "@/utils": {
    getPath: (parts) => {
      const list = Array.isArray(parts) ? parts : parts ? [parts] : [];
      return path.join(tmpRoot, "data", ...list);
    },
    getArtPrompt: () => "visual manual",
  },
});

(async () => {
  try {
    const skills = await service.listImageGenerationSkills();
    const ids = skills.map((skill) => skill.id);
    assert.ok(ids.includes("role_standard_four_view"), "role four-view preset should be built in");
    assert.ok(ids.includes("scene_top_down_panorama"), "scene top-down preset should be built in");
    assert.ok(ids.includes("tool_multi_angle_reference"), "tool multi-angle preset should be built in");

    const sceneTopDown = await service.getImageGenerationSkill("scene_top_down_panorama");
    assert.equal(sceneTopDown.aspectRatio, "16:9");
    assert.deepEqual(sceneTopDown.targetTypes, ["scene"]);

    const rendered = service.renderImageGenerationSkillPrompt(sceneTopDown, {
      project: { id: 1, name: "Fruit Drama", artStyle: "3D comedy", directorManual: "short drama" },
      asset: { id: 2, type: "scene", name: "Safe Bunker", describe: "dark bunker", prompt: "red emergency light" },
      visualManual: "visual manual",
      userRequirement: "no characters",
      timeEnvironmentContext: "night lighting",
      neutralAssetLighting: null,
    });
    assert.match(rendered, /top-down|bird's-eye|overhead map/i, "scene top-down preset should ask for overhead layout");
    assert.match(rendered, /Safe Bunker/, "rendered preset should include asset name");
    assert.match(rendered, /night lighting/, "rendered preset should include scene time context");

    const resolved = await service.resolveImageGenerationSkill({
      requestText: "我要生成场景俯视全景参考图",
      assetType: "scene",
    });
    assert.equal(resolved.id, "scene_top_down_panorama", "Chinese request should resolve to top-down scene preset");

    console.log("Image generation skill preset checks passed");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
});
