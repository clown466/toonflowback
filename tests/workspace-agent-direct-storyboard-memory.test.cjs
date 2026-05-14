const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

async function main() {
  const memoryAdds = [];
  let storyboardToolCalled = false;

  class MemoryMock {
    constructor(agentType, isolationKey) {
      this.agentType = agentType;
      this.isolationKey = isolationKey;
    }

    async add(role, content, options) {
      memoryAdds.push({ role, content, options, agentType: this.agentType, isolationKey: this.isolationKey });
    }

    async get() {
      return { rag: [], summaries: [], shortTerm: [] };
    }

    getTools() {
      return {};
    }
  }

  const service = loadTsModule('src/agents/workspaceAgent/index.ts', {
    '@/utils': { getPath: () => '', db: () => ({}) },
    '@/utils/agent/memory': MemoryMock,
    '@/utils/agent/skillsTools': { getSkillContentForAgent: (content) => content },
    '@/agents/workspaceAgent/tools': {
      __esModule: true,
      default: () => ({}),
      useNovelWorkflowTools: () => ({}),
      runProjectStoryboardDraftTool: async () => {
        storyboardToolCalled = true;
        return {
          handled: true,
          result: {
            message: '已覆盖旧分镜 3 个，并使用分镜方法重新生成 4 个分镜。',
            usedSkillName: '默认分镜方法',
            selectedChapterLabels: ['第17章 juben17'],
            storyboardTable: '| 镜号 | 时长 | 画面 |\n| --- | ---: | --- |\n| 1 | 3s | Chloe enters |\n| 2 | 3s | Bob reacts |',
            reviewStatus: 'passed',
            reviewFailures: [],
            reviewWarnings: [],
            createdCount: 4,
            storyboardIds: [101, 102, 103, 104],
          },
        };
      },
    },
    '@/agents/workspaceAgent/orchestrationRegistry': {
      getWorkspaceDomainAgentCatalog: () => [],
      getWorkspaceSkillCatalog: () => [],
      WORKSPACE_DOMAIN_AGENT_IDS: [],
    },
    '@/services/storyboardDraftGeneration': { toPublicWorkspaceName: (name) => name },
    '@/socket/resTool': class ResToolMock {},
    '@/utils/jsonSchema': { toToolJsonSchema: (schema) => schema },
    ai: { tool: (config) => config },
  });

  await service.runDecisionAI({
    socket: {},
    isolationKey: 'project-1:workspaceAgent',
    text: '重新推理17章分镜',
    userMessageTime: Date.parse('2026-05-14T01:00:00.000Z'),
    abortSignal: undefined,
    resTool: { data: { projectId: 1 } },
    msg: { datetime: '2026-05-14T01:00:01.000Z' },
    thinkConfig: { think: false, thinlLevel: 0 },
  });

  assert.strictEqual(storyboardToolCalled, true, 'direct storyboard request should call the storyboard tool');
  assert.strictEqual(memoryAdds.length, 2, 'user and assistant messages should both be persisted');
  assert.strictEqual(memoryAdds[0].role, 'user');
  assert.strictEqual(memoryAdds[1].role, 'assistant:decision');
  assert.ok(memoryAdds[1].content.includes('已覆盖旧分镜 3 个'), 'assistant memory should keep the tool result message');
  assert.ok(memoryAdds[1].content.includes('分镜表已生成 2 行'), 'assistant memory should keep the storyboard table summary');
  assert.ok(memoryAdds[1].content.includes('写入分镜 ID：101, 102, 103, 104'), 'assistant memory should keep written storyboard ids');
  assert.ok(!memoryAdds[1].content.includes('已通过可靠分镜重推工具处理覆盖重推分镜请求'), 'assistant memory should not be a lossy placeholder');

  console.log('Workspace direct storyboard memory persistence checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
