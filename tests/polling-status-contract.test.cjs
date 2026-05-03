const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const files = [
  {
    label: 'assets polling',
    path: 'src/routes/assets/pollingImageAssets.ts',
    successState: '已完成',
    table: 'o_image',
    urlHelper: 'getSmallImageUrl',
  },
  {
    label: 'production assets polling',
    path: 'src/routes/production/assets/pollingImage.ts',
    successState: '已完成',
    table: 'o_image',
    urlHelper: 'getSmallImageUrl',
  },
  {
    label: 'storyboard polling',
    path: 'src/routes/production/storyboard/pollingImage.ts',
    successState: '已完成',
    table: 'o_storyboard',
    urlHelper: 'getSmallImageUrl',
  },
  {
    label: 'video polling',
    path: 'src/routes/production/workbench/checkVideoStateList.ts',
    successState: '生成成功',
    table: 'o_video',
    urlHelper: 'getFileUrl',
  },
];

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

for (const item of files) {
  const source = fs.readFileSync(path.join(root, item.path), 'utf8');
  assertIncludes(source, 'id: item.id', `${item.label} contract id`);
  assertIncludes(source, 'state,', `${item.label} contract state`);
  assertIncludes(source, 'src,', `${item.label} contract src`);
  assertIncludes(source, 'filePath: rawFilePath', `${item.label} contract filePath`);
  assertIncludes(source, 'errorReason,', `${item.label} contract errorReason`);
  assertIncludes(source, 'diagnostic,', `${item.label} contract diagnostic`);
  assertIncludes(source, item.successState, `${item.label} success state check`);
  assertIncludes(source, 'await u.oss.fileExists(rawFilePath)', `${item.label} artifact existence check`);
  assertIncludes(source, "state = \"生成失败\"", `${item.label} missing artifact failure state`);
  assertIncludes(source, '产物文件缺失或无法访问', `${item.label} missing artifact reason`);
  assertIncludes(source, 'ARTIFACT_MISSING', `${item.label} diagnostic code`);
  assertIncludes(source, `.db("${item.table}")`, `${item.label} best-effort DB repair`);
  assertIncludes(source, '.update({ state', `${item.label} DB repair update`);
  assertIncludes(source, item.urlHelper, `${item.label} URL helper`);
}

console.log('Polling status contract checks passed');
