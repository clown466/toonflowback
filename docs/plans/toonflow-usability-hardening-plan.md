# Toonflow 可用性/落地性修复计划

> **For Hermes/OpenClaw:** 重点解决「看起来生成成功但前端不可用」的问题。安全问题本轮不做。执行时按任务边界拆给不同 OpenClaw bot；每个 bot 只改自己范围内文件，避免互相覆盖。

**Goal:** 让图片/视频/分镜/批量生成链路做到：只有真实产物可访问时才标成功；失败原因能回显；前端轮询状态可信；模型选择不再选到必然不可用的空实现。

**Architecture:** 以 `src/utils/ai.ts` 的生成结果校验和保存校验为底座；各生成路由在「AI 返回 + OSS 写入 + 文件校验 + DB 更新」全部成功后才标完成；轮询接口再次校验文件存在并返回统一错误字段；启动巡检修复历史脏数据。

**Tech Stack:** Node/Express/TypeScript、Knex/SQLite、OSS 本地目录、sharp、现有 CJS 回归测试。

---

## 执行原则

1. **安全问题先不管**：不处理鉴权、SSRF、路径穿越等安全项。
2. **先落地 P0**：假成功、未 await、状态竞态、错误回显优先。
3. **不做大重构**：尽量 helper 化，但不重写整个生成系统。
4. **兼容现有中文状态**：保留 `生成中/已完成/生成失败/生成成功`，可新增 `已取消` 但不要强制迁移全系统。
5. **每项必须可验证**：至少 `yarn lint` + 一个小回归测试或最小接口验证。
6. **不要覆盖当前工作区已有改动**：先看 `git diff -- <file>`，只做任务要求范围。

---

## 当前已知证据

来自 Codex CLI GPT-5.5 二次审计：

- `src/utils/ai.ts` 对供应商返回的图片/视频/TTS 结果缺少统一非空和有效性校验。
- `data/vendor/openai.ts`、`data/vendor/null.ts` 等空实现返回 `""`，可能造成 0 字节假成功。
- `src/routes/assetsGenerate/batchGenerateImageAssets.ts` 中 `aiImage.save(imagePath)` 未 `await`。
- `withTaskRecord` 只覆盖 AI 请求，不覆盖 OSS 保存和业务 DB 更新。
- 取消状态可能被后台任务完成后覆盖。
- `fixDB.ts` 不检查「已完成但文件缺失/0 字节」。
- 多个 polling 接口返回字段不统一，也不校验文件是否真实存在。
- 模型列表接口不能完整体现 image/video 能力和实现状态。
- `src/app.ts` 注释了日志初始化，生成失败排查困难。

---

## Phase 1：P0 生成假成功治理

### Task A：AI 结果校验与空适配器失败化

**Owner 建议：OpenClaw bot1**

**Objective:** 供应商返回空字符串、无效 base64、不可下载 URL 时，必须失败并给出明确原因，不能写 0 字节文件。

**Files:**

- Modify: `src/utils/ai.ts`
- Modify: `data/vendor/openai.ts`
- Modify: `data/vendor/null.ts`
- Test: `tests/ai-empty-result.test.cjs`

**Implementation details:**

1. 在 `src/utils/ai.ts` 增加内部 helper：

```ts
const MIN_IMAGE_BYTES = 1024;
const MIN_VIDEO_BYTES = 1024;
const MIN_AUDIO_BYTES = 128;

function assertNonEmptyGeneratedResult(kind: "image" | "video" | "audio", result: string) {
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error(`供应商未返回有效${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}内容`);
  }
}
```

2. 在 `AiImage.run()`、`AiVideo.run()`、`AiAudio.run()` 获取供应商返回值后立即校验非空。
3. 在 `save()` 前处理 URL/base64 后，写入前后都校验 Buffer 或文件大小。
4. 对图片保存后优先用 `sharp(path).metadata()` 验证；如果依赖导入麻烦，至少 `stat.size > MIN_IMAGE_BYTES`。
5. 把 `data/vendor/openai.ts`、`data/vendor/null.ts` 的空 `imageRequest/videoRequest/ttsRequest` 改为明确 `throw new Error("当前供应商未实现图片生成")` 等。

**Acceptance:**

```bash
yarn lint
node tests/ai-empty-result.test.cjs
```

测试至少覆盖：

- 空字符串返回会抛 `供应商未返回有效图片内容`。
- 无效 base64 不会写入成功状态。
- 空实现 vendor 不返回 `""`。

---

### Task B：批量资产图片生成一致性修复

**Owner 建议：OpenClaw bot2**

**Objective:** 批量资产图生成必须等待 OSS 保存成功后才更新 DB；取消/失败不能被覆盖。

**Files:**

- Modify: `src/routes/assetsGenerate/batchGenerateImageAssets.ts`
- Optional Create: `src/utils/generatedArtifact.ts`
- Test: `tests/batch-generate-image-assets.test.cjs`

**Implementation details:**

1. 把：

```ts
aiImage.save(imagePath);
```

改为：

```ts
await aiImage.save(imagePath);
```

2. 保存后再次读取 `o_image` 当前状态，如果不再是 `生成中`，不要改成 `已完成`。
3. 用条件更新：

```ts
const updated = await u.db("o_image")
  .where({ id: imageId })
  .where("state", "生成中")
  .update({ state: "已完成", filePath: imagePath, errorReason: null });
```

4. 如果 `updated === 0`，记录日志，不覆盖取消/失败。
5. 后台任务内部禁止再 `return res.status(...)`；响应已发出后只能写 DB/日志。
6. `Promise.all(tasks).catch(() => {})` 改成带日志：

```ts
Promise.all(tasks).catch((error) => {
  console.error("[batchGenerateImageAssets] batch failed", u.error(error));
});
```

**Acceptance:**

```bash
yarn lint
node tests/batch-generate-image-assets.test.cjs
```

---

### Task C：任务中心覆盖完整生成生命周期

**Owner 建议：OpenClaw bot3**

**Objective:** `o_tasks` 的「已完成」必须代表 AI 请求、OSS 保存、业务 DB 更新都完成，而不是只代表供应商返回了。

**Files:**

- Modify: `src/utils/taskRecord.ts`
- Modify: `src/utils/ai.ts`
- Modify: `src/routes/assetsGenerate/generateAssets.ts`
- Modify: `src/routes/production/storyboard/batchGenerateImage.ts`
- Modify: `src/routes/production/assets/batchGenerateAssetsImage.ts`
- Modify: `src/routes/production/workbench/generateVideo.ts`
- Test: `tests/task-record-consistency.test.cjs`

**Implementation details:**

1. 不强制大重构；可以先让 `withTaskRecord` 只记录 running，完成/失败由业务路由显式调用。
2. 或新增 helper：`createGenerationTaskRecord()`，返回 `{ taskId, done, fail }`。
3. 路由中在以下步骤后才 done：
   - AI run 成功；
   - save 成功；
   - 文件存在/非空；
   - 业务表状态已成功更新。
4. 失败时 reason 带阶段：`AI_REQUEST_FAILED`、`OSS_WRITE_FAILED`、`DB_UPDATE_FAILED`、`CANCELLED`。
5. `taskRecord(1)` / `taskRecord(0)` 如为 async，必须 await 或显式 catch。

**Acceptance:**

```bash
yarn lint
node tests/task-record-consistency.test.cjs
```

---

### Task D：取消状态和后台竞态幂等

**Owner 建议：OpenClaw bot4**

**Objective:** 用户取消后，后台完成不能把状态改回成功；失败原因要能看懂。

**Files:**

- Modify: `src/routes/assetsGenerate/cancelGenerate.ts`
- Modify: `src/routes/assetsGenerate/generateAssets.ts`
- Modify: `src/routes/assetsGenerate/batchGenerateImageAssets.ts`
- Modify: `src/routes/production/storyboard/cancelGenerateImage.ts` 如存在
- Test: `tests/cancel-generate-race.test.cjs`

**Implementation details:**

1. 取消接口至少写：

```ts
state: "生成失败",
errorReason: "用户取消"
```

如前端能兼容，可新增 `已取消`。
2. 所有成功落库统一使用 `where state = '生成中'` 条件更新。
3. 生成完成前后都检查当前状态，不覆盖 `用户取消`。
4. 返回值带 `id/state/errorReason`。

**Acceptance:**

```bash
yarn lint
node tests/cancel-generate-race.test.cjs
```

---

## Phase 2：P1 前端可感知与数据自愈

### Task E：DB/OSS 一致性巡检和自愈

**Owner 建议：OpenClaw bot5**

**Objective:** 启动时修复历史「已完成但文件缺失/空文件」脏数据，避免前端持续展示坏图。

**Files:**

- Modify: `src/lib/fixDB.ts`
- Modify: `src/utils/oss.ts` 如需补 helper
- Test: `tests/db-oss-consistency.test.cjs`

**Implementation details:**

1. `fixDB.ts` 启动扫描：
   - `o_image.state='已完成'` 且 `filePath` 空/不存在/size=0 => 改 `生成失败`，`errorReason='产物文件缺失或为空'`。
   - `o_storyboard.state='已完成'` 同理。
   - `o_video.state='生成成功'` 同理。
2. `oss.ts` 增加 `statFile(filePath)` 或 `isValidFile(filePath, minBytes)`。
3. 巡检要打印汇总日志：修了多少 image/storyboard/video。

**Acceptance:**

```bash
yarn lint
node tests/db-oss-consistency.test.cjs
```

---

### Task F：轮询/状态/错误回显契约统一

**Owner 建议：OpenClaw bot6**

**Objective:** 前端轮询不再只看 DB 字段；后端返回统一 `src/filePath/errorReason/diagnostic`，文件不存在时给明确失败。

**Files:**

- Modify: `src/routes/assets/pollingImageAssets.ts`
- Modify: `src/routes/production/assets/pollingImage.ts`
- Modify: `src/routes/production/storyboard/pollingImage.ts`
- Modify: `src/routes/production/workbench/checkVideoStateList.ts`
- Test: `tests/polling-status-contract.test.cjs`

**Implementation details:**

统一每个 item 返回：

```ts
{
  id,
  state,
  src,
  filePath,
  errorReason,
  diagnostic,
}
```

- 成功状态但文件缺失：返回 `state='生成失败'`，`errorReason='产物文件缺失或无法访问'`，并可顺手修 DB。
- 保留旧字段兼容前端。

**Acceptance:**

```bash
yarn lint
node tests/polling-status-contract.test.cjs
```

---

### Task G：模型能力和配置落地

**Owner 建议：OpenClaw bot7**

**Objective:** 前端不要选到必然不可用的模型；image/video 模型列表和详情接口语义正确。

**Files:**

- Modify: `src/routes/setting/modelMap/getImageAndVideoModel.ts`
- Modify: `src/routes/modelSelect/getModelList.ts`
- Modify: `src/routes/modelSelect/getModelDetail.ts`
- Modify: `src/utils/vendor.ts`
- Test: `tests/model-capability-list.test.cjs`

**Implementation details:**

1. `getModelList({ type: 'all' })` 真返回全部类型。
2. `getImageAndVideoModel` 返回 image + video。
3. `getModelDetail` 找不到时返回业务错误，不要 success(undefined)。
4. 在模型返回中增加 `implemented/capabilities`，或过滤明显空实现的 image/video/tts。

**Acceptance:**

```bash
yarn lint
node tests/model-capability-list.test.cjs
```

---

### Task H：生产视频提示词上下文补齐

**Owner 建议：OpenClaw bot8 或 bot9(Kimi)**

**Objective:** 视频 prompt 生成实际传入 `prompt/track/associateAssetsIds/shouldGenerateImage`，减少视频落地错引用。

**Files:**

- Modify: `src/routes/production/workbench/generateVideoPrompt.ts`
- Modify: `data/skills/production_skills/complete_video_production_workflow.md` 如有必要
- Modify: `data/skills/production_execution_storyboard_panel.md` 如有必要
- Test: `tests/video-prompt-context.test.cjs`

**Implementation details:**

1. XML `<storyboardItem>` 补齐属性：
   - `prompt`
   - `track`
   - `associateAssetsIds`
   - `shouldGenerateImage`
2. 资产类型命名保持 DB 和 prompt 文档一致。
3. 保持 `node tests/seedance-storyboard-mode.test.cjs` 通过。

**Acceptance:**

```bash
node tests/seedance-storyboard-mode.test.cjs
node tests/video-prompt-context.test.cjs
```

---

### Task I：日志启用和生成链路结构化日志

**Owner 建议：OpenClaw bot10(Kimi)**

**Objective:** 失败时能从日志快速查到 projectId/businessId/vendor/model/stage/path/error。

**Files:**

- Modify: `src/app.ts`
- Modify: `src/logger.ts` 如需
- Modify: 关键生成路由中少量 console 结构化日志

**Implementation details:**

1. 恢复 `import "./logger";`，确认不会导致 dev 异常。
2. 生成链路日志统一包含：

```text
[generate] stage=oss_save_failed business=o_image:10 vendor=timeai model=gpt-image-2 path=/... error=...
```

3. 不要打印完整 API key。

**Acceptance:**

```bash
yarn lint
```

手动触发失败生成，检查日志文件中存在 stage/business/model/path/error。

---

## 最终验收清单

完成所有任务后，由主控执行：

```bash
cd /root/projects/Toonflow-app
yarn lint
node tests/seedance-storyboard-mode.test.cjs
node tests/ai-empty-result.test.cjs
node tests/batch-generate-image-assets.test.cjs
node tests/task-record-consistency.test.cjs
node tests/cancel-generate-race.test.cjs
node tests/db-oss-consistency.test.cjs
node tests/polling-status-contract.test.cjs
node tests/model-capability-list.test.cjs
node tests/video-prompt-context.test.cjs
```

然后做一次最小真实链路验证：

1. 选择一个图片模型生成 Chloe。
2. 后端日志必须出现 vendor/model/stage。
3. DB 中 `o_image.state='已完成'` 时，`filePath` 文件必须存在且 size > 0。
4. `/oss/...` 原图和 `/oss/smallImage/...` 缩略图 HTTP 200。
5. 前端卡片不再显示「图片错误」。
6. 模拟供应商空返回/错误返回时，前端显示明确 `errorReason`，DB 不产生 0 字节成功记录。

---

## Dispatch 建议

第一轮先派：bot1、bot2、bot5、bot6、bot7。它们互相重叠较少，可以并行。

第二轮派：bot3、bot4、bot8、bot10。它们涉及多个生成路由，等第一轮基础 helper 和契约稳定后再做，避免冲突。
