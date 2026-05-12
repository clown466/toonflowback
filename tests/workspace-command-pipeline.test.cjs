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
  let receivedContext = null;
  let decisionAICalled = false;

  class ResToolMock {
    constructor(socket, data) {
      this.socket = socket;
      this.data = data;
    }

    newMessage() {
      return createFakeMessage();
    }
  }

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
      runDecisionAI: async (ctx) => {
        receivedContext = ctx;
        decisionAICalled = true;
      },
    },
    '@/socket/resTool': ResToolMock,
  });

  assert.strictEqual(route.getWorkspaceCommandCandidateIntent, undefined, 'route should not export command-pipeline intent matching');

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

  assert.strictEqual(decisionAICalled, true, 'workspace commands should be handled by the decision agent');
  assert.ok(receivedContext, 'decision agent should receive a context');
  assert.strictEqual(receivedContext.text, '尝试生成前4个场景图片');
  assert.strictEqual(receivedContext.resTool.data.projectId, 123);

  const routeSource = fs.readFileSync(path.join(root, 'src/socket/routes/workspaceAgent.ts'), 'utf8');
  assert.ok(!routeSource.includes('@/agents/workspaceAgent/command/'), 'socket route should not import old command pipeline modules');
  assert.ok(!routeSource.includes('workspace command pipeline'), 'socket route should not execute old command pipeline');
  assert.ok(!routeSource.includes('runProjectAssetImageGenerationFastPath'), 'socket route should not directly call old asset image fast path');

  console.log('Workspace command route delegation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
