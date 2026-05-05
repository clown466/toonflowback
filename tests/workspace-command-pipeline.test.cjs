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

function createFakeMessage() {
  return {
    datetime: new Date('2026-05-05T00:00:00.000Z').toISOString(),
    text: () => ({ complete: () => undefined, error: () => undefined }),
    thinking: () => ({
      appendText: () => undefined,
      updateTitle: () => undefined,
      complete: () => undefined,
    }),
    complete: () => undefined,
    error: () => undefined,
  };
}

async function main() {
  const memoryWrites = [];
  let plannerInput = null;
  let executorInput = null;
  let decisionAICalled = false;

  class MemoryMock {
    constructor(scope, key) {
      this.scope = scope;
      this.key = key;
    }

    async add(role, content, meta) {
      memoryWrites.push({ scope: this.scope, key: this.key, role, content, meta });
    }
  }

  class ResToolMock {
    constructor(socket, data) {
      this.socket = socket;
      this.data = data;
    }

    newMessage() {
      return createFakeMessage();
    }
  }

  const pipelineMock = {
    loadProjectSnapshot: async (input) => ({ projectId: input.projectId, assets: [] }),
    createWorkspaceCommandPlan: async (input) => {
      plannerInput = input;
      return {
        intent: input.intent,
        type: 'asset_image_generation',
        command: {
          kind: 'generate_asset_images',
          scope: { assetType: 'scene', limit: 4 },
        },
      };
    },
    executeWorkspaceCommandPlan: async (input) => {
      executorInput = input;
      return { handled: true, message: '已提交前 4 个场景图片生成任务。' };
    },
  };

  const route = loadTsModule('src/socket/routes/workspaceAgent.ts', {
    jsonwebtoken: { verify: () => true },
    '@/utils': {
      db: () => ({
        where: () => ({
          select: () => ({
            first: async () => ({ value: 'token-key' }),
          }),
        }),
      }),
      error: (error) => (error instanceof Error ? error : new Error(String(error))),
    },
    '@/agents/workspaceAgent/index': {
      runDecisionAI: async () => {
        decisionAICalled = true;
      },
    },
    '@/socket/resTool': ResToolMock,
    '@/utils/agent/memory': MemoryMock,
    '@/agents/workspaceAgent/commandPipeline': pipelineMock,
  });

  assert.strictEqual(route.getWorkspaceCommandCandidateIntent('尝试生成前4个场景图片'), 'asset_image_generation');

  const nspHandlers = {};
  route.default({
    on: (event, handler) => {
      nspHandlers[event] = handler;
    },
  });

  const socketHandlers = {};
  const socket = {
    id: 'socket-1',
    handshake: {
      auth: {
        token: 'Bearer valid',
        isolationKey: 'project-iso',
        projectId: 123,
      },
    },
    on: (event, handler) => {
      socketHandlers[event] = handler;
    },
    emit: () => undefined,
    disconnect: () => {
      throw new Error('socket should stay connected');
    },
  };

  await nspHandlers.connection(socket);
  await socketHandlers.chat({ content: '尝试生成前4个场景图片' });

  assert.ok(plannerInput, 'pipeline planner should be called');
  assert.strictEqual(plannerInput.intent, 'asset_image_generation');
  assert.strictEqual(plannerInput.text, '尝试生成前4个场景图片');
  assert.strictEqual(plannerInput.projectId, 123);
  assert.ok(executorInput, 'pipeline executor should be called');
  assert.strictEqual(executorInput.plan.type, 'asset_image_generation');
  assert.strictEqual(decisionAICalled, false, 'handled pipeline command should not fall back to decision AI');
  assert.deepStrictEqual(
    memoryWrites.map((item) => item.role),
    ['user', 'assistant:commandPipeline'],
    'automatic command path should be written to memory',
  );

  const routeSource = fs.readFileSync(path.join(root, 'src/socket/routes/workspaceAgent.ts'), 'utf8');
  assert.ok(!routeSource.includes('runProjectAssetImageGenerationFastPath'), 'socket route should not directly call old asset image fast path');

  console.log('Workspace command pipeline socket route checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
