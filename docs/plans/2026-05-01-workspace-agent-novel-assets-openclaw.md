# Workspace Agent Novel Assets Workflow Implementation Plan

> **For OpenClaw:** Use the available OpenClaw agents to split and execute this plan task-by-task. Do **not** post progress from the ClaudeCode/main-control bot in the Discord subarea/thread `你是否能给我添加更多机器人`; coordinate internally or with allowed bots only.

**Goal:** Add a project-level `workspaceAgent` that can orchestrate the novel-to-assets workflow: inspect uploaded novel status, trigger/guide event analysis, extract characters/scenes/props, write project-level assets, and delegate script/production work when needed.

**Architecture:** Keep existing `scriptAgent` and `productionAgent` behavior intact. Add a new project-level workspace route and agent module that uses `ResTool` with `projectId` only, project-level tools via `useNovelWorkflowTools`, and sub-agent delegation for script/production work. Update agent deployment defaults and decision prompt so natural user requests like “根据小说准备资产库/帮我塑角造景” map to real tool calls.

**Tech Stack:** TypeScript, Socket.IO, Vercel AI SDK `tool`, Zod, Knex/SQLite, existing Toonflow agent/memory/skill infrastructure.

---

## Current Context / Known Files

Repo root:

```text
/srv/cc-connect-workspaces/codex-discord/toonflowback
```

Important existing files:

```text
src/socket/routes/productionAgent.ts
src/socket/routes/scriptAgent.ts
src/socket/resTool.ts
src/agents/productionAgent/index.ts
src/agents/productionAgent/tools.ts
src/agents/scriptAgent/index.ts
src/agents/scriptAgent/tools.ts
src/lib/initDB.ts
src/lib/fixDB.ts
src/utils/agent/skillsTools.ts
data/skills/production_agent_decision.md
```

Existing DB agent keys include:

```text
scriptAgent
productionAgent
scriptAgent:decisionAgent
scriptAgent:supervisionAgent
scriptAgent:storySkeletonAgent
scriptAgent:adaptationStrategyAgent
scriptAgent:scriptAgent
productionAgent:decisionAgent
productionAgent:supervisionAgent
productionAgent:deriveAssetsAgent
productionAgent:generateAssetsAgent
productionAgent:directorPlanAgent
productionAgent:storyboardGenAgent
productionAgent:storyboardPanelAgent
productionAgent:storyboardTableAgent
```

Existing `productionAgent` currently creates `ResTool` with both `projectId` and `scriptId`:

```ts
let resTool = new ResTool(socket, {
  projectId: socket.handshake.auth.projectId,
  scriptId: socket.handshake.auth.scriptId,
});
```

For the new workspace-level agent, use project-level context only:

```ts
const resTool = new ResTool(socket, {
  projectId: socket.handshake.auth.projectId,
});
```

The new workspace decision agent should include tools in this shape:

```ts
tools: {
  ...memory.getTools(),
  ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
  ...useNovelWorkflowTools({ resTool: ctx.resTool, msg: ctx.msg }),
  ...(await createSubAgent(ctx)),
}
```

For workspaceAgent, `useTools` should be project-level tools, not production-only or script-only tools.

---

## Task Assignment Recommendation for OpenClaw

Run these tasks with separate OpenClaw agents, but avoid parallel edits to the same file:

- **bot1 / GPT backend logic:** Tasks 1-2, route/agent skeleton.
- **bot2 / GPT backend logic:** Tasks 3-4, novel workflow tools.
- **bot3 / GPT backend logic:** Tasks 5-6, DB config and prompt updates.
- **bot4 / GPT backend logic:** Tasks 7-8, integration wiring and tests.
- **bot9 or bot10 / Kimi:** final code review, Chinese prompt wording review, edge-case review.

Before starting implementation, each bot must run:

```bash
cd /srv/cc-connect-workspaces/codex-discord/toonflowback
git status --short
```

Do not overwrite existing uncommitted user changes. Current repo already has several modified files; preserve and build on them carefully.

---

## Task 1: Inspect Socket Route Registration and Decide Workspace Route Mount Point

**Objective:** Find exactly how Socket.IO routes are registered, then identify where to add the new `workspaceAgent` socket namespace/route.

**Files:**
- Inspect: `src/socket/routes/productionAgent.ts`
- Inspect: `src/socket/routes/scriptAgent.ts`
- Inspect: likely `src/socket/index.ts`, `src/socket.ts`, `src/app.ts`, or equivalent Socket.IO bootstrap file.
- No code changes unless the mount point is obvious and isolated.

**Steps:**

1. Search for existing socket route imports/usages:

```bash
cd /srv/cc-connect-workspaces/codex-discord/toonflowback
python3 - <<'PY'
from pathlib import Path
for p in Path('src').rglob('*.ts'):
    s=p.read_text(errors='ignore')
    if 'productionAgent' in s or 'scriptAgent' in s or 'socket/routes' in s:
        print(p)
PY
```

2. Read the bootstrap file(s) fully enough to understand the namespace style.
3. Record the exact namespace names currently used for production/script agents.
4. Decide the new namespace name. Preferred:

```text
/workspaceAgent
```

5. If route registration is straightforward, prepare the code change for Task 8; otherwise document the required mount point in the task handoff.

**Verification:**

- You can answer: “new route file should be imported in `<file>` and mounted as `<namespace>`.”
- No tests required for this inspection-only task.

---

## Task 2: Add `src/socket/routes/workspaceAgent.ts`

**Objective:** Create a project-level Socket.IO route for the new workspace agent.

**Files:**
- Create: `src/socket/routes/workspaceAgent.ts`
- Reference: `src/socket/routes/scriptAgent.ts`
- Reference: `src/socket/routes/productionAgent.ts`

**Implementation Requirements:**

1. Copy the auth/check/chat/stop/updateThinkConfig structure from `scriptAgent.ts` or `productionAgent.ts`.
2. Import the new agent module:

```ts
import * as agent from "@/agents/workspaceAgent/index";
```

3. Create `ResTool` with **projectId only**:

```ts
let resTool = new ResTool(socket, {
  projectId: socket.handshake.auth.projectId,
});
```

4. Require `isolationKey` just like existing routes.
5. `updateContext` should accept project-level context only:

```ts
socket.on("updateContext", (data: { isolationKey: string; projectId: number }, callback) => {
  isolationKey = data.isolationKey;
  resTool = new ResTool(socket, {
    projectId: data.projectId,
  });
  console.log("[workspaceAgent] 上下文已更新:", isolationKey);
  callback?.({ success: true });
});
```

6. `chat` should call:

```ts
await agent.runDecisionAI(ctx);
```

7. Use assistant display name `总控策划` or `项目总控` for the initial message.

**Verification:**

Run TypeScript check/build command used by the project. If unknown, first inspect `package.json`; likely:

```bash
yarn build
```

Expected: no TypeScript errors from the new route.

---

## Task 3: Create `src/agents/workspaceAgent/index.ts`

**Objective:** Implement the new project-level decision agent module.

**Files:**
- Create: `src/agents/workspaceAgent/index.ts`
- Reference: `src/agents/scriptAgent/index.ts`
- Reference: `src/agents/productionAgent/index.ts`

**Implementation Requirements:**

1. Define `AgentContext` similar to existing agents:

```ts
export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
  thinkConfig: {
    think: boolean;
    thinlLevel: 0 | 1 | 2 | 3;
  };
}
```

2. Use separate memory namespace:

```ts
const memory = new Memory("workspaceAgent", isolationKey);
```

3. Load a new skill file:

```ts
const skill = path.join(u.getPath("skills"), "workspace_agent_decision.md");
const prompt = getSkillContentForAgent(
  await fs.promises.readFile(skill, "utf-8"),
  "workspaceAgent:decisionAgent",
);
```

4. Build project-level context from DB:

```ts
const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();
const novelCount = await u.db("o_novel").where("projectId", resTool.data.projectId).count({ count: "id" }).first();
const assetCount = await u.db("o_assets").where("projectId", resTool.data.projectId).count({ count: "id" }).first();
```

5. Stream with key:

```ts
u.Ai.Text("workspaceAgent:decisionAgent", ctx.thinkConfig.think, ctx.thinkConfig.thinlLevel).stream(...)
```

6. Tool set must include:

```ts
tools: {
  ...memory.getTools(),
  ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
  ...useNovelWorkflowTools({ resTool: ctx.resTool, msg: ctx.msg }),
  ...(await createSubAgent(ctx)),
}
```

7. Do not import production-only tools as the default `useTools` unless they are safe at project level. Prefer creating `src/agents/workspaceAgent/tools.ts` in Task 4.

8. Reuse `consumeFullStream` / `removeAllXmlTags` helpers pattern from existing agent files. If those helpers are local duplicated functions lower in files, copy the minimal required helpers.

**Verification:**

```bash
yarn build
```

Expected: TypeScript compiles.

---

## Task 4: Add Project-Level Workspace Tools

**Objective:** Provide safe project-level tools for workspaceAgent, separate from single-script production tools.

**Files:**
- Create: `src/agents/workspaceAgent/tools.ts`
- Possibly create: `src/agents/workspaceAgent/novelWorkflowTools.ts`
- Reference: `src/agents/scriptAgent/tools.ts`
- Reference: `src/agents/productionAgent/tools.ts`

**Required exported functions:**

```ts
export default function useTools(config: ToolConfig) { ... }
export function useNovelWorkflowTools(config: ToolConfig) { ... }
```

**Minimum ToolConfig:**

```ts
interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}
```

**Required `useNovelWorkflowTools` tools:**

### `get_project_novel_status`

Purpose: inspect whether current project has uploaded novels and whether event analysis is complete.

Suggested output:

```ts
{
  projectId,
  novelCount,
  novels: [
    {
      id,
      chapter,
      chapterIndex,
      eventState,
      eventCount,
      errorReason,
    }
  ],
  hasNovel: boolean,
  hasUnfinishedEventAnalysis: boolean,
  hasFailedEventAnalysis: boolean,
}
```

Implementation hints:

- Query `o_novel` by `projectId`.
- Query relation/event tables if needed: `o_eventChapter`, `o_event`.
- Treat `eventState` values conservatively:
  - `1` or similar success value = complete only if codebase confirms.
  - `0` = running/incomplete.
  - `-1` = failed.
- If state semantics are unclear, include raw states in response instead of pretending.

### `get_project_asset_status`

Purpose: summarize existing project assets by type.

Query:

```ts
await u.db("o_assets").where("projectId", projectId).select(...)
```

Return grouped counts for:

```text
role
scene
tool
other
```

### `list_project_assets`

Purpose: list existing assets so the decision agent can avoid duplicates.

Include fields like:

```text
id, name, type, describe, prompt, scriptId, projectId, imageId, promptState, imageState
```

### `create_or_update_project_assets_from_json`

Purpose: write extracted novel-level assets into `o_assets` with `projectId`; no `scriptId` required.

Input schema should require:

```ts
assets: z.array(z.object({
  name: z.string(),
  type: z.enum(["role", "scene", "tool", "other"]),
  describe: z.string().optional(),
  prompt: z.string().optional(),
  source: z.string().optional(),
}))
```

Rules:

- Deduplicate by `projectId + name + type`.
- Update description/prompt if existing asset found and new content is non-empty.
- Insert otherwise.
- Generate id using the same project convention found in existing code. Search for insert patterns into `o_assets` before implementing.
- Do not require `scriptId`.

### Optional tool: `start_or_report_novel_event_analysis`

Only implement if existing code exposes a clear function/API for event extraction. If not clear, return a structured message saying event analysis trigger is not wired yet and include next required action.

**Verification:**

- Add unit or integration tests if test framework exists.
- At minimum run build:

```bash
yarn build
```

- Add a small script or test to call pure helper functions if helpers are extracted.

---

## Task 5: Add Workspace Sub-Agent Delegation Tools

**Objective:** Allow workspaceAgent to delegate project-level tasks to script/production agents without being tied to a single script.

**Files:**
- Modify: `src/agents/workspaceAgent/index.ts`
- Possibly reference/copy patterns from:
  - `src/agents/scriptAgent/index.ts:createSubAgent`
  - `src/agents/productionAgent/index.ts:createSubAgent`

**Required tools returned by `createSubAgent(ctx)`:**

### `run_script_agent_for_project`

Description: asks scriptAgent-style execution to produce story skeleton/adaptation/script planning for the project.

Implementation options:

- Prefer invoking shared internal functions if available.
- Otherwise implement a workspace-local `runAgent` helper similar to existing agents with key `scriptAgent:decisionAgent` or a narrower script subagent key.

### `run_production_agent_for_assets`

Description: asks productionAgent-style execution to create/derive/generate asset plans from project-level asset list.

Must not assume a single `scriptId`. If production tool requires scriptId, the tool should first list available scripts and ask/return that a script selection is required.

### `run_asset_reference_generation_plan`

Description: create a plan for which role four-views, scene references, and prop references should be generated next.

**Rules:**

- Subagents may use `useNovelWorkflowTools` and project-level workspace tools.
- Do not pass a fake `scriptId`.
- If a downstream production tool requires `scriptId`, fail loudly with a helpful message rather than silently writing wrong data.

**Verification:**

- Build passes.
- Tool descriptions clearly mention project-level behavior.

---

## Task 6: Add Workspace Agent DB Configuration Defaults

**Objective:** Add default `o_agentDeploy` rows for workspaceAgent in both initialization and migration/fix paths.

**Files:**
- Modify: `src/lib/initDB.ts`
- Modify: `src/lib/fixDB.ts`

**Add rows to init data:**

```ts
{
  model: "",
  modelName: "",
  vendorId: null,
  key: "workspaceAgent",
  name: "项目总控Agent",
  desc: "项目级总控，负责小说到资产库、剧本、生产流程的整体调度",
  disabled: false,
},
{
  model: "",
  modelName: "",
  vendorId: null,
  key: "workspaceAgent:decisionAgent",
  name: "项目总控Agent:决策层",
  desc: "项目级决策层，负责根据用户意图调用小说、资产、剧本和生产工具",
  temperature: 1,
  maxOutputTokens: 0,
  disabled: false,
},
```

**Update `fixDB.ts`:**

Add to `advancedAgentList` or equivalent migration list:

```ts
{ key: "workspaceAgent:decisionAgent", name: "项目总控Agent:决策层", desc: "项目级决策层" }
```

Also ensure base `workspaceAgent` row exists if `fixDB.ts` handles base agents separately; if not, add a safe upsert/insert-if-missing.

**Verification:**

Search confirms both keys exist:

```bash
python3 - <<'PY'
from pathlib import Path
for f in ['src/lib/initDB.ts','src/lib/fixDB.ts']:
    s=Path(f).read_text()
    print(f, 'workspaceAgent' in s, 'workspaceAgent:decisionAgent' in s)
PY
```

Expected: both files report true for relevant keys.

---

## Task 7: Add `data/skills/workspace_agent_decision.md`

**Objective:** Create the project-level decision prompt that tells workspaceAgent when and how to run the novel-to-assets workflow.

**Files:**
- Create: `data/skills/workspace_agent_decision.md`
- Modify if needed: `data/skills/production_agent_decision.md`

**Required Content:**

Use existing skill/frontmatter conventions. Include a section like:

```md
---
name: workspace_agent_decision
description: 项目级总控决策层，负责小说、资产库、剧本和生产流程调度。
---

# Workspace Agent Decision

你是项目级总控 Agent。你负责在 project 范围内调度小说、资产库、剧本和生产流程。

## 小说资产提取自动流程

当用户要求：
- 根据上传小说提取资产
- 从小说中提取角色场景道具
- 帮我塑角造景
- 根据小说准备资产库
- 根据小说搭建角色/场景/道具库

必须按顺序执行：

1. 调用 `get_project_novel_status` 检查当前项目状态。
2. 若无小说，提示用户先上传小说，不要编造资产。
3. 若存在未完成事件分析的小说，先调用可用工具触发/报告事件分析状态；如果系统暂未暴露触发工具，明确告诉用户需要先完成事件分析。
4. 调用资产状态工具检查已有资产，避免重复创建。
5. 从小说事件/章节/项目资料中提取角色、场景、道具。
6. 调用 `create_or_update_project_assets_from_json` 写入项目级资产库，必须带 `projectId`，不要强依赖 `scriptId`。
7. 需要生成参考图时，先生成角色四视图、场景参考图、道具参考图的计划；涉及实际生成前，按现有生产流程要求确认。
8. 如需要剧本/生产协作，再调用子 Agent 工具。

## 工具调用原则

- 能调用工具就不要只口头说明。
- project 级任务不得假设单一 `scriptId`。
- 任何写入资产库的动作必须先查重。
- 对事件分析状态、资产生成状态不确定时，返回原始状态和下一步，而不是猜测。
```

**Production prompt update:**

If `production_agent_decision.md` currently handles this intent, add a short redirect/instruction:

```md
## 项目级小说资产流程转交

如果用户请求的是整个项目的小说资产提取、塑角造景或资产库准备，且上下文没有明确单一 scriptId，应转交/建议使用 workspaceAgent；不要在 productionAgent 中强行依赖 scriptId。
```

**Verification:**

- File exists.
- `getSkillContentForAgent(..., "workspaceAgent:decisionAgent")` can read useful content. If the skill parser requires agent sections, follow existing markdown section format exactly.

---

## Task 8: Wire Socket Route Registration

**Objective:** Mount the new workspaceAgent socket route into the app.

**Files:**
- Modify the socket bootstrap file identified in Task 1.
- Create/import: `src/socket/routes/workspaceAgent.ts`.

**Implementation Requirements:**

1. Import route:

```ts
import workspaceAgentRoute from "@/socket/routes/workspaceAgent";
```

or relative import matching existing style.

2. Register namespace following existing pattern. Example only:

```ts
workspaceAgentRoute(io.of("/workspaceAgent"));
```

3. Do not break existing namespaces for script/production agents.

**Verification:**

- Build passes.
- If server can be started locally, verify namespace registration does not crash:

```bash
yarn dev
```

Then watch logs for startup errors.

---

## Task 9: Tests / Verification

**Objective:** Prove the implementation compiles and key workflow tools behave correctly.

**Files:**
- Create tests only if existing test setup is available.
- Otherwise create a temporary/manual verification script and do not commit temp files.

**Required checks:**

1. Static search:

```bash
cd /srv/cc-connect-workspaces/codex-discord/toonflowback
python3 - <<'PY'
from pathlib import Path
required = [
 'src/agents/workspaceAgent/index.ts',
 'src/agents/workspaceAgent/tools.ts',
 'src/socket/routes/workspaceAgent.ts',
 'data/skills/workspace_agent_decision.md',
]
for f in required:
    print(f, Path(f).exists())
PY
```

2. Build:

```bash
yarn build
```

3. Agent config search:

```bash
python3 - <<'PY'
from pathlib import Path
for f in ['src/lib/initDB.ts','src/lib/fixDB.ts']:
    s=Path(f).read_text()
    print(f)
    for key in ['workspaceAgent', 'workspaceAgent:decisionAgent']:
        print(' ', key, key in s)
PY
```

4. Route registration search:

```bash
python3 - <<'PY'
from pathlib import Path
for p in Path('src').rglob('*.ts'):
    s=p.read_text(errors='ignore')
    if 'workspaceAgent' in s:
        print(p)
PY
```

5. If possible, run a minimal socket/client integration check against `/workspaceAgent` with auth token and projectId. If auth token setup is too costly, document manual verification steps.

---

## Acceptance Criteria

Implementation is complete when all are true:

- `src/agents/workspaceAgent/index.ts` exists and calls `runDecisionAI(ctx)` using `workspaceAgent:decisionAgent`.
- `src/agents/workspaceAgent/tools.ts` exposes project-level tools and `useNovelWorkflowTools`.
- `get_project_novel_status` exists and returns project-level novel/event status without requiring `scriptId`.
- Asset write/list/status tools operate by `projectId` and do not require `scriptId`.
- `src/socket/routes/workspaceAgent.ts` exists and creates `ResTool` with `{ projectId }` only.
- Workspace socket namespace is registered in the app.
- DB defaults include `workspaceAgent` and `workspaceAgent:decisionAgent` in init/fix paths.
- `data/skills/workspace_agent_decision.md` exists and contains the novel asset extraction automatic workflow.
- `production_agent_decision.md` no longer encourages project-level novel asset work to depend on `scriptId`.
- `yarn build` passes.
- Existing `scriptAgent` and `productionAgent` behavior is not regressed.

---

## Open Questions / Cautions

1. `eventState` semantics must be confirmed from existing code before making strong assumptions.
2. Existing asset insert ID generation convention must be followed; search for `o_assets` insert patterns first.
3. The repo already contains uncommitted changes. Do not discard or overwrite them.
4. Do not fake `scriptId` for project-level workflows.
5. If OpenClaw runs multiple agents in parallel, avoid assigning two agents to modify the same file at the same time.
