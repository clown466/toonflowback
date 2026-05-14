const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/routes/production/getFlowData.ts'), 'utf8');
const workspaceTools = fs.readFileSync(path.join(root, 'src/agents/workspaceAgent/tools.ts'), 'utf8');

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

assertIncludes(source, 'episodesId: z.number().optional().nullable()', 'getFlowData episodesId fallback contract');
assertIncludes(source, 'export async function getProjectLevelAssets', 'getFlowData reusable asset helper');
assertIncludes(source, '.whereNull("o_assets.assetsId")', 'getFlowData project-level parent asset query');
assertIncludes(source, '.whereIn("o_assets.assetsId", parentAssetIds)', 'getFlowData child asset query');
assertIncludes(source, 'state: normalizeAssetState(item.imageState)', 'getFlowData parent asset state');
assertIncludes(source, 'errorReason: item.imageErrorReason ?? ""', 'getFlowData parent asset error reason');
assertIncludes(source, 'const flowData = emptyFlowData(scriptData?.content ?? "")', 'getFlowData assets-only fallback');
assertIncludes(source, 'function parseFlowData', 'getFlowData malformed production data fallback');

assertIncludes(workspaceTools, 'type: "asset_images"', 'workspaceAgent asset image event type');
assertIncludes(workspaceTools, 'stage: "submitted"', 'workspaceAgent submitted event');
assertIncludes(workspaceTools, 'result.skippedGeneratingItems.map', 'workspaceAgent skipped generating payload');
assertIncludes(workspaceTools, 'state: "生成中"', 'workspaceAgent generating status payload');

console.log('getFlowData asset fallback contract checks passed');
