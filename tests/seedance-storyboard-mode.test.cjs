const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const decisionSkill = fs.readFileSync(path.join(root, 'data/skills/production_agent_decision.md'), 'utf8');
const panelSkill = fs.readFileSync(path.join(root, 'data/skills/production_execution_storyboard_panel.md'), 'utf8');
const productionAgent = fs.readFileSync(path.join(root, 'src/agents/productionAgent/index.ts'), 'utf8');

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

function assertNotIncludes(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `${label} should not include: ${needle}`);
}

assertIncludes(decisionSkill, 'Seedance 分镜模式', 'decision skill');
assertIncludes(decisionSkill, '视频模型包含 `Seedance`', 'decision skill');
assertIncludes(decisionSkill, '无需询问用户，直接以 **"Seedance 分镜模式"** 派发给执行层', 'decision skill');
assertIncludes(decisionSkill, 'Seedance 分镜模式 / 纯文本多参模式 / 分镜图辅助多参模式 / 首位帧模式', 'decision skill mode list');

assertIncludes(panelSkill, '**Seedance 分镜模式**', 'panel skill modes table');
assertIncludes(panelSkill, '与「纯文本多参模式」一致', 'panel skill Seedance mode behavior');
assertIncludes(panelSkill, 'prompt=""', 'panel skill Seedance XML');
assertIncludes(panelSkill, 'shouldGenerateImage="false"', 'panel skill Seedance XML');
assertIncludes(panelSkill, '已完成分镜面板写入（Seedance 分镜模式）', 'panel skill confirmation');
assertNotIncludes(panelSkill, 'Seedance 分镜模式**：激活 `storyboard_prompt_techniques`', 'Seedance should skip prompt skills');

assertIncludes(productionAgent, 'isSeedance', 'production agent route flag');
assertIncludes(productionAgent, 'Seedance 分镜模式', 'production agent model info');

console.log('Seedance storyboard mode skill checks passed');
