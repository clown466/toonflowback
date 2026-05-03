const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const decision = read('data/skills/script_agent_decision.md');
const skeleton = read('data/skills/script_execution_skeleton.md');
const creation = read('data/skills/script_execution_adaptation.md');
const script = read('data/skills/script_execution_script.md');
const index = read('src/agents/scriptAgent/index.ts');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(decision.includes('创作模式'), 'decision skill should define creation mode');
assert(decision.includes('原创模式'), 'decision skill should include original mode');
assert(decision.includes('只有用户明确要求“小说改编/原著改编”') || decision.includes('只有用户明确要求'), 'decision skill should default non-adaptation unless explicit adaptation');
assert(!decision.includes('请确认以下信息：计划拆分为几集？每集大约几分钟？覆盖原著哪些章节？'), 'decision skill should not ask original range in generic init question');
assert(decision.includes('用户只回复“不改编/原创/直写”时') && decision.includes('必须立即进入原创模式下一步'), 'decision skill should continue to original-mode next step after non-adaptation');
assert(decision.includes('不要说“后续你想继续再告诉我”'), 'decision skill should not stop after non-adaptation acknowledgement');
assert(decision.includes('按项目简介自动生成'), 'decision skill should offer auto-generation of missing original parameters');

assert(skeleton.includes('原创模式') && skeleton.includes('不调用 `get_novel_events`'), 'skeleton skill should skip novel events in original mode');
assert(creation.includes('创作策略') && creation.includes('<adaptationStrategy>创作策略内容</adaptationStrategy>'), 'strategy skill should support creation strategy output');
assert(script.includes('原创模式') && script.includes('不得调用 `get_novel_text`'), 'script skill should not require novel text in original mode');
assert(index.includes('创作策略/改编策略内容'), 'script agent format prompt should accept creation strategy wording');

console.log('Original script mode checks passed');
