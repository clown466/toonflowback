const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  deleteStoryboardGenerationSkill,
  getStoryboardGenerationSkill,
  listStoryboardGenerationSkills,
  renderStoryboardGenerationSkillPrompt,
  resolveStoryboardGenerationSkill,
  saveStoryboardGenerationSkill,
} = require("../src/services/storyboardGenerationSkill.ts");

const skillsRoot = fs.existsSync("/root/toonflow-data/skills")
  ? "/root/toonflow-data/skills"
  : path.join(__dirname, "..", "data", "skills");
const userRoot = path.join(skillsRoot, "storyboard_generation_skills");
const testId = `worker_a_storyboard_test_${process.pid}`;
const testFile = path.join(userRoot, `${testId}.md`);
const escapedFile = path.join(userRoot, "escape_attempt.md");

async function cleanup() {
  await fs.promises.rm(testFile, { force: true });
  await fs.promises.rm(escapedFile, { force: true });
}

(async () => {
  await cleanup();

  const initialList = await listStoryboardGenerationSkills();
  assert.ok(initialList.some((skill) => skill.path === "production_skills/storyboard_table_techniques.md"), "lists general storyboard table methods");
  assert.ok(initialList.some((skill) => skill.path.startsWith("story_skills/") && skill.path.endsWith("/driector_skills/director_storyboard_table_narrative.md")), "lists story narrative storyboard methods");
  assert.ok(!initialList.some((skill) => skill.path.startsWith("art_skills/")), "does not list art style storyboard skills");
  assert.ok(!initialList.some((skill) => skill.path.includes("storyboard_prompt_techniques")), "does not list image prompt techniques");
  assert.ok(!initialList.some((skill) => skill.path.startsWith("production_execution_storyboard")), "does not list internal execution agent skills");
  assert.ok(initialList.every((skill) => skill.content === undefined), "list returns metadata only");

  const content = `---
id: ${testId}
name: Worker A Test Skill
description: Custom storyboard skill for tests
target: storyboard, beat
tags: test, storyboard
output: storyboard-table
defaultShotsPerBeat: 3
---
Hello {{project.name}}.
`;

  const saved = await saveStoryboardGenerationSkill({ id: `../${testId}`, content });
  assert.equal(saved.id, testId);
  assert.equal(saved.source, "user");
  assert.equal(saved.editable, true);
  assert.equal(saved.defaultShotsPerBeat, 3);
  assert.deepEqual(saved.target, ["storyboard", "beat"]);
  assert.ok(saved.content.includes("Hello {{project.name}}."));
  assert.ok(fs.existsSync(testFile), "safe id writes inside user skill directory");

  const listed = await listStoryboardGenerationSkills();
  const meta = listed.find((skill) => skill.id === testId);
  assert.ok(meta, "saved skill appears in list");
  assert.equal(meta.path, `storyboard_generation_skills/${testId}.md`);
  assert.equal(meta.fileName, `${testId}.md`);
  assert.equal(meta.editable, true);
  assert.equal(meta.content, undefined);

  const loaded = await getStoryboardGenerationSkill(testId);
  assert.equal(renderStoryboardGenerationSkillPrompt(loaded, { project: { name: "Toonflow" } }), "Hello Toonflow.\n");

  const resolved = await resolveStoryboardGenerationSkill({ requestText: "Worker A Test Skill", target: "storyboard" });
  assert.equal(resolved.id, testId);

  const builtin = initialList.find((skill) => !skill.editable);
  assert.ok(builtin, "has builtin skill");
  await assert.rejects(() => deleteStoryboardGenerationSkill(builtin.id), /仅支持删除用户分镜 skill/);

  await deleteStoryboardGenerationSkill(testId);
  assert.ok(!fs.existsSync(testFile), "delete removes only user skill");

  await cleanup();
  console.log("Storyboard generation skill checks passed");
})().catch(async (error) => {
  await cleanup();
  console.error(error);
  process.exit(1);
});
