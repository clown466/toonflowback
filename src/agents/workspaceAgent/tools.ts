import { tool, Tool } from "ai";
import { z } from "zod";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";
import { clearProjectStoryboards, generateProjectStoryboardDraft } from "@/services/storyboardDraftGeneration";

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
  sourceText?: string;
}

const assetTypeSchema = z.enum(["role", "scene", "tool", "other"]);

const assetInputSchema = z.object({
  name: z.string().min(1).describe("资产名称"),
  type: assetTypeSchema.describe("资产类型：role角色 / scene场景 / tool道具 / other其他"),
  describe: z.string().optional().describe("资产描述"),
  prompt: z.string().optional().describe("资产生成提示词"),
  source: z.string().optional().describe("资产来源说明，例如小说章节或事件"),
});

type AssetInput = z.infer<typeof assetInputSchema>;
type ProjectAssetImageType = "role" | "scene" | "tool";
type ProjectAssetRow = {
  id: number;
  name?: string | null;
  type?: string | null;
  describe?: string | null;
  prompt?: string | null;
  imageId?: number | null;
  imageState?: string | null;
};

interface ProjectAssetImageScopeOptions {
  includeCompleted?: boolean;
  sourceText?: string;
  finalizeMessage?: boolean;
  assetIds?: number[];
  assetNames?: string[];
  assetTypes?: ProjectAssetImageType[];
}

function pickCount(value: unknown): number {
  const raw = typeof value === "object" && value !== null ? Object.values(value as Record<string, unknown>)[0] : value;
  const count = Number(raw ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAssetKey(asset: Pick<AssetInput, "name" | "type">) {
  return `${asset.type}:${asset.name.trim().toLowerCase()}`;
}

function summarizeByAssetType(rows: Array<{ type?: string | null; count?: unknown }>) {
  const summary: Record<"role" | "scene" | "tool" | "other", number> = {
    role: 0,
    scene: 0,
    tool: 0,
    other: 0,
  };

  for (const row of rows) {
    const type = row.type === "role" || row.type === "scene" || row.type === "tool" ? row.type : "other";
    summary[type] += pickCount(row.count);
  }

  return summary;
}

function defaultAssetPrompt(asset: AssetInput) {
  const typeText = asset.type === "role" ? "character design" : asset.type === "scene" ? "environment concept art" : asset.type === "tool" ? "prop design" : "visual design";
  return `${typeText}, ${asset.name}, ${asset.describe ?? "based on the original story"}, production reference, consistent visual style`;
}

function mergeSource(current: unknown, addition: string) {
  const oldText = nonEmpty(current);
  if (!oldText) return addition;
  return oldText.includes(addition) ? oldText : `${oldText}；${addition}`;
}

async function writeProjectAssets(projectId: number, assets: AssetInput[]) {
  const now = Date.now();
  const normalizedAssets = Array.from(new Map(assets.map((asset) => [normalizeAssetKey(asset), asset])).values());
  const existingAssets = await u
    .db("o_assets")
    .where("projectId", projectId)
    .whereNull("assetsId")
    .select("id", "name", "type", "describe", "prompt", "remark");
  const existingMap = new Map(existingAssets.map((asset: any) => [normalizeAssetKey({ name: asset.name ?? "", type: asset.type ?? "other" }), asset]));

  const created: any[] = [];
  const updated: any[] = [];
  const skipped: AssetInput[] = [];

  for (const asset of normalizedAssets) {
    const key = normalizeAssetKey(asset);
    const existing = existingMap.get(key) as any;
    const describe = nonEmpty(asset.describe);
    const prompt = nonEmpty(asset.prompt) ?? defaultAssetPrompt(asset);
    const source = nonEmpty(asset.source);

    if (existing?.id) {
      const patch: Record<string, unknown> = {};
      if (describe && describe !== existing.describe) patch.describe = describe;
      if (prompt && prompt !== existing.prompt) patch.prompt = prompt;
      if (source) patch.remark = mergeSource(existing.remark, source);

      if (Object.keys(patch).length > 0) {
        await u.db("o_assets").where("id", existing.id).update(patch);
        updated.push({ id: existing.id, name: asset.name, type: asset.type, updatedFields: Object.keys(patch) });
      } else {
        skipped.push(asset);
      }
      continue;
    }

    const row = {
      name: asset.name.trim(),
      type: asset.type,
      describe: describe ?? null,
      prompt: prompt ?? null,
      remark: source ?? null,
      projectId,
      scriptId: null,
      assetsId: null,
      startTime: now,
    };
    const [id] = await u.db("o_assets").insert(row);
    created.push({ id, ...row });
  }

  return {
    projectId,
    createdCount: created.length,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    created,
    updated,
    skipped,
  };
}

function extractCandidateAssetsFromNovel(novels: any[]): { assets: AssetInput[]; reason?: string } {
  const text = novels.map((n) => `${n.chapter ?? ""}\n${n.event ?? ""}\n${n.chapterData ?? ""}`).join("\n");
  const assets: AssetInput[] = [];
  const add = (name: string, type: AssetInput["type"], describe: string, source: string) => assets.push({ name, type, describe, source });

  const zombieCampusSignals = [
    /\bChloe\b/i,
    /\bBob\b/i,
    /\bLeo\b/i,
    /\bCyber Ghost\b|\bEugene\b/i,
    /Austin Zombie|Thesis Zombies|Gamer Zombie|Professor Zombies/i,
    /Shining Glow Labs|Failed Diet Tea|anime techno/i,
  ];
  const isZombieCampusDemo = zombieCampusSignals.some((regex) => regex.test(text));
  if (!isZombieCampusDemo) {
    return {
      assets: [],
      reason: "当前快速规则只覆盖僵尸校园英文 demo。为避免给中文/非 demo 项目写入错误资产，已跳过规则写库；请改用 AI 资产提取或提供结构化事件后再写入。",
    };
  }

  const roleRules: Array<[RegExp, string, string]> = [
    [/\bChloe\b/i, "Chloe", "行动果断、嘴毒的水果小队成员，常负责近战、开枪和临场决断"],
    [/\bBob\b/i, "Bob", "持枪、经验丰富的水果小队成员，负责火力和战术支援"],
    [/\bLeo\b/i, "Leo", "冷静吐槽、擅长观察和利用规则漏洞的水果小队成员"],
    [/\bCyber Ghost\b|\bEugene\b/i, "Eugene / Cyber Ghost", "宅系黑客盟友，抱着电脑和动漫抱枕，负责追踪病毒来源和系统入侵"],
    [/Thesis Zombies|student zombies/i, "Thesis Zombies", "被论文和成绩焦虑驱动的学生丧尸群，携带课本和学术压力感"],
    [/Gamer Zombie/i, "Gamer Zombie", "沉迷游戏和 Wi-Fi 的高速闪避丧尸，穿格子衫，动作像滑行玩家"],
    [/Professor Zombies/i, "Professor Zombies", "执着批改和逻辑秩序的教授丧尸群，被混乱音乐干扰"],
    [/Overworked Monster|fused lab monster/i, "The Overworked Monster", "实验室融合怪物，代表过劳和实验事故的恐怖喜剧怪物"],
    [/Austin Zombie/i, "Austin Zombie", "网红式变异丧尸，使用直播、粉色灯光、快递盒和粉丝群攻击"],
    [/Fan Zombies/i, "Fan Zombies", "受 Austin Zombie 影响的粉丝丧尸群，像直播间观众一样蜂拥而上"],
  ];
  for (const [regex, name, desc] of roleRules) if (regex.test(text)) add(name, "role", desc, "小说事件/章节原文");

  const sceneRules: Array<[RegExp, string, string]> = [
    [/bunker/i, "Safe Bunker", "幸存者小队出发前的安全地堡，末日避难空间"],
    [/campus|college/i, "Zombie College Campus", "被学生丧尸包围的大学校园，充满课本、压力和混乱追逐"],
    [/library/i, "College Library", "校园图书馆，救援 Cyber Ghost 的关键室内场景"],
    [/basement|supercomputer center/i, "Basement Supercomputer Center", "阴冷地下超级计算机中心，旧书、咖啡和压力气味浓重"],
    [/Shining Glow Labs|pink factory/i, "Shining Glow Labs Pink Factory", "病毒源头的粉色工厂/实验室入口，带商业化美妆饮品风格"],
    [/armored truck|truck/i, "Armored Truck", "小队穿越校园和工厂战斗时使用的装甲卡车"],
  ];
  for (const [regex, name, desc] of sceneRules) if (regex.test(text)) add(name, "scene", desc, "小说事件/章节原文");

  const toolRules: Array<[RegExp, string, string]> = [
    [/marked paper|paper with red marks|80% copied/i, "Marked Paper", "带红色批注/抄袭标记的论文纸，用来击溃学生丧尸的学术焦虑"],
    [/gun|shotgun|bullets/i, "Bob's Gun", "Bob 使用的枪械火力道具，用于对抗丧尸"],
    [/power strip|unplug/i, "Power Strip", "Chloe 拔掉的电源排插，用来冻结沉迷 Wi-Fi 的 Gamer Zombie"],
    [/PA system|speakers|techno|EDM|anime techno/i, "PA System with Anime Techno Music", "播放混乱动漫电子乐的广播系统，用来干扰教授丧尸"],
    [/laptop|computer/i, "Eugene's Laptop", "Eugene/Cyber Ghost 的黑客电脑，用于追踪病毒和入侵系统"],
    [/anime pillow|waifu/i, "Anime Pillow", "Eugene 抱着的宅系动漫抱枕，强化角色喜剧辨识度"],
    [/dynamite/i, "Dynamite", "Chloe 用来摧毁 Austin Zombie 的炸药"],
    [/delivery boxes|boxes/i, "Delivery Boxes", "Austin Zombie 从机器中发射的重型快递盒攻击物"],
    [/diet tea/i, "Failed Diet Tea", "Shining Glow Labs 失败实验的减肥茶，病毒源头线索"],
  ];
  for (const [regex, name, desc] of toolRules) if (regex.test(text)) add(name, "tool", desc, "小说事件/章节原文");

  return { assets };
}

export async function runNovelAssetExtractionFastPath(config: ToolConfig) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在直接读取小说并提取资产...");

  const novels = await u
    .db("o_novel")
    .where("projectId", projectId)
    .select("id", "chapter", "chapterIndex", "eventState", "event", "chapterData")
    .orderBy("chapterIndex", "asc");

  if (!novels.length) {
    thinking.updateTitle("未找到小说章节");
    thinking.complete();
    const text = msg.text("当前项目没有小说章节，无法基于原文提取资产。请先上传/导入小说。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "no_novel" };
  }

  const extraction = extractCandidateAssetsFromNovel(novels);
  const candidateAssets = extraction.assets;
  if (!candidateAssets.length) {
    thinking.appendText(JSON.stringify({ extractedCandidates: 0, reason: extraction.reason ?? "规则未提取到可写入资产" }, null, 2));
    thinking.updateTitle("小说资产规则提取已跳过");
    thinking.complete();
    const text = msg.text(extraction.reason ?? "当前小说未被快速规则提取出可靠资产。为避免写入空/错误资产，请使用 AI 资产提取流程或提供结构化资产 JSON 后再写入。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "rule_extraction_skipped", extractedCandidates: 0 };
  }
  const result = await writeProjectAssets(projectId, candidateAssets);
  const assetRows = await u.db("o_assets").where("projectId", projectId).whereNull("assetsId").select("type").count({ count: "id" }).groupBy("type");
  const summary = summarizeByAssetType(assetRows as Array<{ type?: string | null; count?: unknown }>);

  thinking.appendText(JSON.stringify({ extractedCandidates: candidateAssets.length, ...result }, null, 2));
  thinking.updateTitle("小说资产提取完成");
  thinking.complete();

  const lines = [
    `已直接从当前小说章节写入资产库，不再等待大模型决策。`,
    `本次候选资产 ${candidateAssets.length} 个：新建 ${result.createdCount}，更新 ${result.updatedCount}，跳过 ${result.skippedCount}。`,
    `当前资产库：角色 ${summary.role}，场景 ${summary.scene}，道具 ${summary.tool}，其他 ${summary.other}。`,
  ];
  if (result.createdCount || result.updatedCount) {
    const changed = [...result.created, ...result.updated].slice(0, 24).map((item: any) => `- ${item.name}（${item.type}）`);
    lines.push("\n已处理资产：", ...changed);
  }
  const text = msg.text(lines.join("\n"));
  text.complete();
  msg.complete();
  return { handled: true, message: lines.join("\n"), result };
}

function shouldIncludeCompletedAssets(text: string) {
  return /全部|所有|全量|重新|重绘|重出|覆盖|已完成.*也|包括.*已完成/i.test(text);
}

function formatAssetNames(assets: Array<{ id: number; name: string }>, limit = 12) {
  const names = assets.slice(0, limit).map((asset) => `${asset.name || `#${asset.id}`}`);
  if (assets.length > limit) names.push(`等 ${assets.length} 个`);
  return names.join("、");
}

function uniqueAssets<T extends { id: number }>(assets: T[]) {
  const seen = new Set<number>();
  return assets.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

function normalizeAssetSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[“”"《》<>「」『』【】[\]（）()，,。.!！?？:：;；、/\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLatinLike(value: string) {
  return /^[a-z0-9 ._-]+$/i.test(value);
}

function textMentionsAssetName(sourceText: string, assetName?: string | null) {
  const normalizedText = normalizeAssetSearchText(sourceText);
  const normalizedName = normalizeAssetSearchText(assetName ?? "");
  if (!normalizedText || normalizedName.length < 2) return false;
  if (isLatinLike(normalizedName)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedName)}([^a-z0-9]|$)`, "i").test(normalizedText);
  }
  return normalizedText.includes(normalizedName);
}

function stripGenericAssetWords(value: string) {
  return value
    .replace(/^(请|帮我|麻烦|直接|开始|重新|重绘|重出|生成|生图|出图|制作|做|更新|把|将)\s*/i, "")
    .replace(/\s*(的)?\s*(角色|人物|场景|环境|道具|资产)?\s*(参考图|图片|图|设定图|资产图|角色图|场景图|道具图)\s*$/i, "")
    .trim();
}

function isGenericScopeHint(value: string) {
  return !value || /^(全部|所有|全量|整个|整套)?\s*(资产|角色|人物|场景|环境|道具|参考图|图片|图)?$/i.test(value);
}

function extractRequestedAssetNameHints(text: string) {
  const hints = new Set<string>();
  const patterns = [
    /(?:重新生成|重新|重绘|重出|生成|生图|出图|制作|做|更新)\s*([^，。！？,\n]{2,80}?)\s*的\s*(?:角色|人物|场景|环境|道具|资产)?\s*(?:参考图|图片|图|设定图)/gi,
    /(?:把|将)\s*([^，。！？,\n]{2,80}?)\s*(?:重新生成|重新|重绘|重出|生成|生图|出图|制作|做|更新)/gi,
    /(?:重新生成|重新|重绘|重出|生成|生图|出图|制作|做|更新)\s*([^，。！？,\n]{2,80}?)\s*(?:角色图|人物图|场景图|环境图|道具图|资产图|参考图|图片)/gi,
    /(?:名为|叫做|名称为)\s*["“']?([^"“”'，。！？,\n]{2,80})/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const hint = stripGenericAssetWords(match[1] ?? "");
      if (!isGenericScopeHint(hint)) hints.add(hint);
    }
  }

  return Array.from(hints);
}

function requestedNameMatchesAsset(requestedName: string, assetName?: string | null) {
  const normalizedRequestedName = normalizeAssetSearchText(requestedName);
  const normalizedAssetName = normalizeAssetSearchText(assetName ?? "");
  if (!normalizedRequestedName || !normalizedAssetName) return false;
  return normalizedRequestedName === normalizedAssetName || normalizedRequestedName.includes(normalizedAssetName) || normalizedAssetName.includes(normalizedRequestedName);
}

function inferAssetTypesFromText(text: string): ProjectAssetImageType[] {
  const types: ProjectAssetImageType[] = [];
  if (/(角色|人物|人设|主角|配角|character|role)/i.test(text)) types.push("role");
  if (/(场景|环境|地点|空间|造景|scene|environment|location)/i.test(text)) types.push("scene");
  if (/(道具|物件|物品|装备|武器|prop|tool|item)/i.test(text)) types.push("tool");
  return types;
}

function normalizeRequestedAssetTypes(types?: ProjectAssetImageType[]) {
  return Array.from(new Set((types ?? []).filter((type): type is ProjectAssetImageType => type === "role" || type === "scene" || type === "tool")));
}

function getAssetTypeLabel(type: string) {
  if (type === "role") return "角色";
  if (type === "scene") return "场景";
  if (type === "tool") return "道具";
  return type || "未知类型";
}

function formatAssetScopeLabel(selectedTypes: ProjectAssetImageType[], scopedAssets: ProjectAssetRow[], matchedSpecificAssets: ProjectAssetRow[]) {
  if (matchedSpecificAssets.length) return `指定资产：${formatAssetNames(scopedAssets.map((asset) => ({ id: asset.id, name: asset.name || `#${asset.id}` })))}`;
  if (selectedTypes.length) return `全部${selectedTypes.map(getAssetTypeLabel).join("、")}`;
  return "全部角色/场景/道具资产";
}

function resolveProjectAssetImageScope(assets: ProjectAssetRow[], options: ProjectAssetImageScopeOptions) {
  const sourceText = options.sourceText ?? "";
  const selectedTypes = normalizeRequestedAssetTypes(options.assetTypes?.length ? options.assetTypes : inferAssetTypesFromText(sourceText));
  const requestedIds = new Set((options.assetIds ?? []).map(Number).filter((id) => Number.isFinite(id)));
  const requestedNames = Array.from(new Set([...(options.assetNames ?? []), ...extractRequestedAssetNameHints(sourceText)].map((name) => name.trim()).filter(Boolean)));

  const matchedById = requestedIds.size ? assets.filter((asset) => requestedIds.has(asset.id)) : [];
  const matchedByRequestedName = requestedNames.length
    ? assets.filter((asset) => requestedNames.some((name) => requestedNameMatchesAsset(name, asset.name)))
    : [];
  const matchedByTextMention = assets.filter((asset) => textMentionsAssetName(sourceText, asset.name));
  const matchedSpecificAssets = uniqueAssets([...matchedById, ...matchedByRequestedName, ...matchedByTextMention]);
  const hasSpecificRequest = requestedIds.size > 0 || requestedNames.length > 0 || matchedByTextMention.length > 0;

  if (hasSpecificRequest && matchedSpecificAssets.length === 0) {
    return {
      ok: false as const,
      reason: "specific_asset_not_found",
      selectedTypes,
      requestedNames,
      scopedAssets: [],
      matchedSpecificAssets: [],
      scopeLabel: "未匹配到指定资产",
    };
  }

  let scopedAssets = matchedSpecificAssets.length ? matchedSpecificAssets : assets;
  if (selectedTypes.length) {
    scopedAssets = scopedAssets.filter((asset) => selectedTypes.includes(asset.type as ProjectAssetImageType));
  }

  if (matchedSpecificAssets.length > 0 && selectedTypes.length > 0 && scopedAssets.length === 0) {
    return {
      ok: false as const,
      reason: "specific_asset_type_mismatch",
      selectedTypes,
      requestedNames,
      scopedAssets: [],
      matchedSpecificAssets,
      scopeLabel: "指定资产类型不匹配",
    };
  }

  return {
    ok: true as const,
    reason: null,
    selectedTypes,
    requestedNames,
    scopedAssets,
    matchedSpecificAssets,
    scopeLabel: formatAssetScopeLabel(selectedTypes, scopedAssets, matchedSpecificAssets),
  };
}

function emitProjectAssetImageUpdate(resTool: ResTool, payload: Record<string, unknown>) {
  resTool.socket.emit("productionDataUpdated", {
    type: "asset_images",
    ...payload,
  });
}

export async function runProjectAssetImageGenerationFastPath(config: ToolConfig, options?: ProjectAssetImageScopeOptions) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const includeCompleted = options?.includeCompleted ?? shouldIncludeCompletedAssets(options?.sourceText ?? "");
  const finalizeMessage = options?.finalizeMessage ?? true;
  const thinking = msg.thinking("正在提交资产批量出图任务...");

  const project = await u.db("o_project").where("id", projectId).select("id", "imageModel", "imageQuality", "artStyle").first();
  if (!project) {
    thinking.updateTitle("项目不存在");
    thinking.complete();
    if (finalizeMessage) {
      const text = msg.text("当前项目不存在，无法提交资产出图任务。");
      text.complete();
      msg.complete();
    }
    return { handled: true, reason: "project_not_found" };
  }
  if (!project.imageModel || !project.imageQuality) {
    thinking.updateTitle("缺少图像模型配置");
    thinking.complete();
    if (finalizeMessage) {
      const text = msg.text("当前项目还没有配置图像模型或图片质量，请先在项目设置里选择图像模型和质量。");
      text.complete();
      msg.complete();
    }
    return { handled: true, reason: "missing_project_image_config" };
  }

  const assets = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereNull("o_assets.assetsId")
    .whereIn("o_assets.type", ["role", "scene", "tool"])
    .select("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.describe", "o_assets.prompt", "o_assets.imageId", "o_image.state as imageState")
    .orderByRaw(`CASE o_assets.type WHEN 'role' THEN 1 WHEN 'scene' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
    .orderBy("o_assets.id", "asc");

  const scope = resolveProjectAssetImageScope(assets as ProjectAssetRow[], options ?? {});
  if (!scope.ok) {
    thinking.appendText(
      JSON.stringify(
        {
          projectId,
          reason: scope.reason,
          requestedNames: scope.requestedNames,
          selectedTypes: scope.selectedTypes,
          matchedSpecificAssets: scope.matchedSpecificAssets.map((asset) => ({ id: asset.id, name: asset.name, type: asset.type })),
          availableAssets: assets.slice(0, 30).map((asset: any) => ({ id: asset.id, name: asset.name, type: asset.type })),
        },
        null,
        2,
      ),
    );
    thinking.updateTitle(scope.reason === "specific_asset_type_mismatch" ? "指定资产类型不匹配" : "未匹配到指定资产");
    thinking.complete();
    if (finalizeMessage) {
      const typeText = scope.selectedTypes.length ? `，但它不属于${scope.selectedTypes.map(getAssetTypeLabel).join("、")}` : "";
      const matchedText = scope.matchedSpecificAssets.length
        ? `已找到：${scope.matchedSpecificAssets.map((asset) => `${asset.name}（${getAssetTypeLabel(asset.type ?? "")}）`).join("、")}${typeText}，所以没有提交生成。`
        : `没有在资产库里匹配到你指定的资产${scope.requestedNames.length ? `：${scope.requestedNames.join("、")}` : ""}。`;
      const candidates = formatAssetNames(assets.map((asset: any) => ({ id: asset.id, name: asset.name || `#${asset.id}` })), 12);
      const text = msg.text([matchedText, candidates ? `当前可选资产包括：${candidates}。` : ""].filter(Boolean).join("\n"));
      text.complete();
      msg.complete();
    }
    return { handled: true, reason: scope.reason, scope };
  }

  const scopedAssets = scope.scopedAssets;
  const skippedCompleted = scopedAssets.filter((asset: any) => asset.imageState === "已完成");
  const skippedGenerating = scopedAssets.filter((asset: any) => asset.imageState === "生成中");
  const targetAssets = scopedAssets.filter((asset: any) => {
    if (asset.imageState === "生成中") return false;
    if (!includeCompleted && asset.imageState === "已完成") return false;
    return true;
  });
  const validAssets = targetAssets.filter((asset: any) => nonEmpty(asset.prompt) || nonEmpty(asset.describe));
  const skippedNoPrompt = targetAssets.filter((asset: any) => !nonEmpty(asset.prompt) && !nonEmpty(asset.describe));

  if (!validAssets.length) {
    thinking.appendText(
      JSON.stringify(
        {
          projectId,
          scope: scope.scopeLabel,
          includeCompleted,
          totalAssets: assets.length,
          scopedAssets: scopedAssets.length,
          skippedCompleted: includeCompleted ? 0 : skippedCompleted.length,
          skippedGenerating: skippedGenerating.length,
          skippedNoPrompt: skippedNoPrompt.length,
        },
        null,
        2,
      ),
    );
    thinking.updateTitle("没有需要提交的资产图");
    thinking.complete();
    if (finalizeMessage) {
      const text = msg.text(
        [
          "当前没有可提交的资产出图任务。",
          `范围：${scope.scopeLabel}。`,
          skippedGenerating.length ? `已有 ${skippedGenerating.length} 个资产正在生成中。` : "",
          !includeCompleted && skippedCompleted.length ? `已有 ${skippedCompleted.length} 个资产图已完成，本次默认保留不重绘。需要重绘时请说“重绘全部资产图”。` : "",
          skippedNoPrompt.length ? `有 ${skippedNoPrompt.length} 个资产缺少提示词/描述，已跳过。` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      text.complete();
      msg.complete();
    }
    return { handled: true, reason: "no_valid_assets" };
  }

  const result = await submitAssetImageGeneration({
    projectId,
    model: project.imageModel,
    resolution: project.imageQuality,
    concurrentCount: 1,
    onStatusChange: (event) => {
      emitProjectAssetImageUpdate(resTool, {
        projectId,
        stage: "progress",
        scope: scope.scopeLabel,
        records: [event],
      });
    },
    items: validAssets.map((asset: any) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name || `资产 #${asset.id}`,
      describe: nonEmpty(asset.describe) ?? null,
      prompt: nonEmpty(asset.prompt) ?? nonEmpty(asset.describe) ?? asset.name ?? "",
      userRequirement: options?.sourceText ?? null,
    })),
    userRequirement: options?.sourceText ?? null,
  });

  emitProjectAssetImageUpdate(resTool, {
    projectId,
    stage: "submitted",
    scope: scope.scopeLabel,
    submitted: result.submitted,
    assetIds: validAssets.map((asset: any) => asset.id),
    records: [
      ...result.imageIds.map((item) => ({
        projectId,
        assetId: item.assetId,
        imageId: item.imageId,
        state: "生成中",
      })),
      ...result.skippedGeneratingItems.map((item) => ({
        projectId,
        assetId: item.assetId,
        imageId: item.imageId,
        state: "生成中",
        skipped: true,
      })),
    ],
  });

  thinking.appendText(
    JSON.stringify(
      {
        projectId,
        scope: scope.scopeLabel,
        imageModel: project.imageModel,
        imageQuality: project.imageQuality,
        aspectRatio: "16:9",
        includeCompleted,
        submitted: result.submitted,
        skippedBySubmitGuard: result.skippedGenerating,
        totalAssets: assets.length,
        scopedAssets: scopedAssets.length,
        skippedCompleted: includeCompleted ? 0 : skippedCompleted.length,
        skippedGenerating: skippedGenerating.length,
        skippedNoPrompt: skippedNoPrompt.length,
        assetIds: validAssets.map((asset: any) => asset.id),
      },
      null,
      2,
    ),
  );
  thinking.updateTitle("资产批量出图任务已提交");
  thinking.complete();

  const lines = [
    `范围：${scope.scopeLabel}。`,
    `已提交 ${result.submitted} 个资产图生成任务，画幅固定 16:9。`,
    `模型：${project.imageModel}，质量：${project.imageQuality}，后台并发：1。`,
    validAssets.length ? `本次提交：${formatAssetNames(validAssets.map((asset: any) => ({ id: asset.id, name: asset.name || `#${asset.id}` })))}。` : "",
    !includeCompleted && skippedCompleted.length ? `已完成的 ${skippedCompleted.length} 个资产本次保留不重绘；需要全量重绘时说“重绘全部资产图”。` : "",
    skippedGenerating.length ? `已有 ${skippedGenerating.length} 个资产正在生成中，已跳过避免重复任务。` : "",
    skippedNoPrompt.length ? `有 ${skippedNoPrompt.length} 个资产缺少提示词/描述，已跳过。` : "",
    "你可以在资产区看生成中状态，完成后图片会自动写回对应资产。",
  ].filter(Boolean);
  if (finalizeMessage) {
    const text = msg.text(lines.join("\n"));
    text.complete();
    msg.complete();
  }

  return { handled: true, message: lines.join("\n"), result };
}

export async function runProjectStoryboardDraftFastPath(config: ToolConfig, options?: { sourceText?: string; force?: boolean; append?: boolean }) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在生成生产分镜草案...");

  const result = await generateProjectStoryboardDraft(projectId, {
    sourceText: options?.sourceText,
    preferredScriptId: typeof resTool.data.scriptId === "number" ? resTool.data.scriptId : undefined,
    force: options?.force,
    append: options?.append,
  });

  thinking.appendText(
    JSON.stringify(
      {
        projectId,
        episodesId: result.episodesId,
        scriptName: result.scriptName,
        scriptCreated: result.scriptCreated,
        createdCount: result.createdCount,
        existingCount: result.existingCount,
        replaced: result.replaced,
        appended: result.appended,
        selectedNovelIds: result.selectedNovelIds,
        selectedChapterIndexes: result.selectedChapterIndexes,
        storyboardIds: result.storyboardIds,
      },
      null,
      2,
    ),
  );
  thinking.updateTitle(result.createdCount > 0 ? "分镜草案已写入生产工作台" : "已有分镜，已切换生产工作台");
  thinking.complete();

  resTool.socket.emit("productionDataUpdated", {
    projectId,
    episodesId: result.episodesId,
    scriptName: result.scriptName,
    createdCount: result.createdCount,
    existingCount: result.existingCount,
    storyboardIds: result.storyboardIds,
  });

  const lines = [
    result.message,
    result.selectedChapterIndexes.length ? `本次章节：${result.selectedChapterIndexes.map((index) => `第${index}章`).join("、")}。` : "",
    `已关联当前项目资产库，并写入 Flova 工作台/生产工作台可读取的数据。`,
    result.createdCount > 0 ? "现在可以在左侧分镜列表查看；需要分镜图片时点“生成全部”。" : "",
  ].filter(Boolean);
  const text = msg.text(lines.join("\n"));
  text.complete();
  msg.complete();

  return { handled: true, result };
}

export async function runProjectStoryboardClearFastPath(config: ToolConfig, options?: { sourceText?: string }) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在清空生产分镜...");

  const result = await clearProjectStoryboards(projectId, {
    sourceText: options?.sourceText,
    preferredScriptId: typeof resTool.data.scriptId === "number" ? resTool.data.scriptId : undefined,
  });

  thinking.appendText(
    JSON.stringify(
      {
        projectId,
        cleared: result.cleared,
        deletedCount: result.deletedCount,
        remainingCount: result.remainingCount,
        needsSelection: result.needsSelection,
        targetScripts: result.targetScripts,
      },
      null,
      2,
    ),
  );
  thinking.updateTitle(result.cleared ? "分镜已清空" : result.needsSelection ? "需要指定生产容器" : "没有可清空的分镜");
  thinking.complete();

  if (result.cleared) {
    resTool.socket.emit("productionDataUpdated", {
      projectId,
      cleared: true,
      deletedCount: result.deletedCount,
      remainingCount: result.remainingCount,
      scripts: result.targetScripts,
    });
  }

  const text = msg.text(result.message);
  text.complete();
  msg.complete();

  return { handled: true, result };
}

export default function useTools(config: ToolConfig) {
  const { resTool, toolsNames, msg, sourceText = "" } = config;
  const { socket } = resTool;

  const tools: Record<string, Tool> = {
    get_project_overview: tool({
      description: "获取当前项目的基础信息、小说章节数、资产数和剧本数，适用于项目级总控判断下一步。",
      inputSchema: z.object({}),
      execute: async () => {
        const thinking = msg.thinking("正在获取项目概览...");
        const projectId = resTool.data.projectId;
        const [project, novelRows, assetRows, scriptRows] = await Promise.all([
          u.db("o_project").where("id", projectId).first(),
          u.db("o_novel").where("projectId", projectId).select("id", "chapter", "chapterIndex", "eventState", "chapterData").orderBy("chapterIndex", "asc"),
          u.db("o_assets").where("projectId", projectId).whereNull("assetsId").select("type").count({ count: "id" }).groupBy("type"),
          u.db("o_script").where("projectId", projectId).select("id", "name", "content", "extractState", "createTime").orderBy("id", "asc"),
        ]);
        const novelContents = new Map(novelRows.map((novel: any) => [String(novel.chapterData ?? "").trim(), novel]));
        const scripts = scriptRows.map((script: any) => {
          const matchedNovel = novelContents.get(String(script.content ?? "").trim()) as any;
          return {
            id: script.id,
            name: script.name,
            extractState: script.extractState,
            createTime: script.createTime,
            contentMatchesNovelChapter: matchedNovel ? { id: matchedNovel.id, chapterIndex: matchedNovel.chapterIndex, chapter: matchedNovel.chapter } : null,
          };
        });
        const assetCounts = summarizeByAssetType(assetRows as Array<{ type?: string | null; count?: unknown }>);
        const result = {
          projectId,
          project,
          novelCount: novelRows.length,
          completedEventAnalysisCount: novelRows.filter((novel: any) => novel.eventState === 1).length,
          novels: novelRows.map((novel: any) => ({ id: novel.id, chapter: novel.chapter, chapterIndex: novel.chapterIndex, eventState: novel.eventState })),
          assetCount: Object.values(assetCounts).reduce((sum, value) => sum + value, 0),
          assetCounts,
          scriptCount: scripts.length,
          scripts,
          expectedEpisodeCountFromNovels: novelRows.length,
          note: `assetCount 只统计当前项目未删除/未挂父级 assetsId 的资产；contentMatchesNovelChapter 表示该剧本内容与小说原文章节相同，可能是导入原文遗留记录，不等于用户单独上传/编写剧本。若小说章节数大于剧本记录数，应按小说章节规划集数：${novelRows.length}章≈${novelRows.length}集；不要把单条剧本记录误判为全项目只有1集。`,
        };

        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle("项目概览获取完成");
        thinking.complete();
        return result;
      },
    }),
    list_project_scripts: tool({
      description: "列出当前项目已有剧本，供项目级总控决定是否需要转交编剧或生产流程。",
      inputSchema: z.object({}),
      execute: async () => {
        const thinking = msg.thinking("正在获取项目剧本列表...");
        const scripts = await u.db("o_script").where("projectId", resTool.data.projectId).select("id", "name", "extractState", "errorReason", "createTime");
        thinking.appendText(JSON.stringify(scripts, null, 2));
        thinking.updateTitle("项目剧本列表获取完成");
        thinking.complete();
        return scripts;
      },
    }),
    get_project_plan_data: tool({
      description: "获取前端工作区中的项目级计划数据。仅在需要读取工作区缓存内容时使用。",
      inputSchema: z.object({
        key: z.string().describe("工作区数据 key"),
      }),
      execute: async ({ key }) => {
        const thinking = msg.thinking(`正在获取工作区数据 ${key}...`);
        const timeoutMs = 3000;
        const result = await new Promise((resolve) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve({
              ok: false,
              key,
              reason: "timeout",
              message: `前端工作区 ${key} 在 ${timeoutMs}ms 内未返回数据，已跳过，避免总控卡住。`,
            });
          }, timeoutMs);

          socket.emit("getPlanData", { key }, (res: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(res ?? { ok: true, key, data: null, message: "前端返回空数据" });
          });
        });
        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle((result as any)?.reason === "timeout" ? "工作区数据获取超时，已跳过" : "工作区数据获取完成");
        thinking.complete();
        return result ?? "无数据";
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([name]) => toolsNames.includes(name))) : tools;
}

export function useNovelWorkflowTools(config: ToolConfig) {
  const { resTool, toolsNames, msg, sourceText = "" } = config;

  const tools: Record<string, Tool> = {
    get_project_novel_status: tool({
      description: "检查当前项目是否有上传小说，以及每章小说事件分析的原始状态和事件数量。",
      inputSchema: z.object({}),
      execute: async () => {
        const thinking = msg.thinking("正在检查小说与事件分析状态...");
        const projectId = resTool.data.projectId;
        const novels = await u
          .db("o_novel")
          .where("projectId", projectId)
          .select("id", "chapter", "chapterIndex", "eventState", "event", "errorReason")
          .orderBy("chapterIndex", "asc");

        const novelIds = novels.map((novel: any) => novel.id).filter((id: unknown): id is number => typeof id === "number");
        const eventCountRows = novelIds.length
          ? await u.db("o_eventChapter").whereIn("novelId", novelIds).select("novelId").count({ eventCount: "eventId" }).groupBy("novelId")
          : [];
        const eventCounts = new Map(eventCountRows.map((row: any) => [row.novelId, pickCount(row.eventCount)]));

        const data = novels.map((novel: any) => ({
          id: novel.id,
          chapter: novel.chapter,
          chapterIndex: novel.chapterIndex,
          eventState: novel.eventState,
          eventCount: eventCounts.get(novel.id) ?? (novel.event ? 1 : 0),
          errorReason: novel.errorReason ?? null,
        }));

        const result = {
          projectId,
          novelCount: data.length,
          novels: data,
          hasNovel: data.length > 0,
          hasUnfinishedEventAnalysis: data.some((novel) => novel.eventState !== 1),
          hasFailedEventAnalysis: data.some((novel) => novel.eventState === -1 || Boolean(novel.errorReason)),
        };

        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle("小说状态检查完成");
        thinking.complete();
        return result;
      },
    }),
    get_project_asset_status: tool({
      description: "按 role/scene/tool/other 汇总当前项目已有资产数量，默认排除衍生资产。",
      inputSchema: z.object({}),
      execute: async () => {
        const thinking = msg.thinking("正在统计项目资产...");
        const projectId = resTool.data.projectId;
        const rows = await u
          .db("o_assets")
          .where("projectId", projectId)
          .whereNull("assetsId")
          .select("type")
          .count({ count: "id" })
          .groupBy("type");

        const result = {
          projectId,
          counts: summarizeByAssetType(rows as Array<{ type?: string | null; count?: unknown }>),
          raw: rows,
        };

        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle("项目资产统计完成");
        thinking.complete();
        return result;
      },
    }),
    list_project_assets: tool({
      description: "列出当前项目已有资产，帮助避免重复创建。",
      inputSchema: z.object({
        type: assetTypeSchema.optional().describe("可选：按资产类型过滤"),
      }),
      execute: async ({ type }) => {
        const thinking = msg.thinking("正在获取项目资产列表...");
        const query = u
          .db("o_assets")
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .where("o_assets.projectId", resTool.data.projectId)
          .whereNull("o_assets.assetsId")
          .select(
            "o_assets.id",
            "o_assets.name",
            "o_assets.type",
            "o_assets.describe",
            "o_assets.prompt",
            "o_assets.scriptId",
            "o_assets.projectId",
            "o_assets.imageId",
            "o_assets.promptState",
            "o_assets.promptErrorReason",
            "o_image.state as imageState",
            "o_image.filePath as imageUrl",
            "o_image.errorReason as imageErrorReason",
          )
          .orderByRaw(`CASE o_assets.type WHEN 'role' THEN 1 WHEN 'scene' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
          .orderBy("o_assets.id", "asc");

        if (type) query.andWhere("o_assets.type", type);
        const assets = await query;

        thinking.appendText(JSON.stringify(assets, null, 2));
        thinking.updateTitle("项目资产列表获取完成");
        thinking.complete();
        return assets;
      },
    }),
    create_or_update_project_assets_from_json: tool({
      description: "将从小说中提取的角色、场景、道具等资产写入项目级资产库；按 projectId + name + type 去重，存在则只用非空字段更新。",
      inputSchema: z.object({
        assets: z.array(assetInputSchema).describe("要创建或更新的项目级资产列表"),
      }),
      execute: async ({ assets }) => {
        const thinking = msg.thinking("正在写入项目级资产库...");
        const projectId = resTool.data.projectId;
        const result = await writeProjectAssets(projectId, assets);

        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle("项目级资产库写入完成");
        thinking.complete();
        return result;
      },
    }),
    batch_generate_project_asset_images: tool({
      description: "按用户指定范围提交当前项目资产库的角色/场景/道具参考图生成任务，后台异步生成，固定 16:9；若用户点名资产，必须传 assetNames 或 assetIds；若用户说全部角色/场景/道具，必须传 assetTypes。",
      inputSchema: z.object({
        includeCompleted: z.boolean().optional().describe("是否连已完成图片的资产也重新提交；默认 false，只补缺图/失败图"),
        assetIds: z.array(z.number()).optional().describe("明确指定要生成的资产 ID；用户点名某几个资产时优先使用"),
        assetNames: z.array(z.string()).optional().describe("明确指定要生成的资产名称；例如 Austin Zombie"),
        assetTypes: z.array(z.enum(["role", "scene", "tool"])).optional().describe("限定资产类型：role角色 / scene场景 / tool道具；例如全部角色只传 role"),
      }),
      execute: async ({ includeCompleted, assetIds, assetNames, assetTypes }) => {
        return runProjectAssetImageGenerationFastPath(config, { includeCompleted, assetIds, assetNames, assetTypes, sourceText, finalizeMessage: false });
      },
    }),
    start_or_report_novel_event_analysis: tool({
      description: "按用户选择的小说章节报告或触发事件分析。可只分析指定章节；不要默认全章节分析。",
      inputSchema: z.object({
        novelIds: z.array(z.number()).optional().describe("需要分析的小说章节 ID；优先使用 get_project_novel_status 返回的 id"),
        chapterIndexes: z.array(z.number()).optional().describe("也可按章节序号选择，例如第1章、第3章"),
        force: z.boolean().optional().describe("已完成的章节是否也重新分析；默认 false，只分析未完成章节"),
      }),
      execute: async ({ novelIds, chapterIndexes, force }) => {
        const thinking = msg.thinking("正在处理所选章节事件分析...");
        const projectId = resTool.data.projectId;
        const query = u.db("o_novel").where("projectId", projectId).select("id", "chapter", "chapterIndex", "eventState", "errorReason");
        if (novelIds?.length) query.whereIn("id", novelIds);
        if (chapterIndexes?.length) query.whereIn("chapterIndex", chapterIndexes);
        const novels = await query.orderBy("chapterIndex", "asc");
        const selectedNovelIds = novels.map((novel: any) => novel.id).filter((id: unknown): id is number => typeof id === "number");
        const targetNovelIds = novels
          .filter((novel: any) => force || novel.eventState !== 1)
          .map((novel: any) => novel.id)
          .filter((id: unknown): id is number => typeof id === "number");

        if (targetNovelIds.length > 0) {
          await u.db("o_novel").where("projectId", projectId).whereIn("id", targetNovelIds).update({ eventState: 0, event: null, errorReason: null });
          const allChapters = await u.db("o_novel").where("projectId", projectId).whereIn("id", targetNovelIds);
          const novel = new u.cleanNovel(3);
          novel.emitter.on("item", async (item: any) => {
            await u
              .db("o_novel")
              .where("id", item.id)
              .update({ event: item.event, eventState: item.event ? 1 : -1, errorReason: item?.errorReason ?? item?.errReason ?? null });
          });
          void novel.start(allChapters, projectId).catch((error) => {
            console.error("[workspaceAgent] 事件分析后台任务失败:", u.error(error).message);
          });
        }

        const result = {
          projectId,
          requestedNovelIds: novelIds ?? null,
          requestedChapterIndexes: chapterIndexes ?? null,
          force: Boolean(force),
          selectedNovelIds,
          selectedChapters: novels.map((novel: any) => ({ id: novel.id, chapterIndex: novel.chapterIndex, chapter: novel.chapter, eventState: novel.eventState, errorReason: novel.errorReason ?? null })),
          triggeredNovelIds: targetNovelIds,
          message:
            selectedNovelIds.length === 0
              ? "没有匹配到要分析的章节，请先从章节列表选择。"
              : targetNovelIds.length > 0
                ? `已开始只分析所选章节：${targetNovelIds.join(", ")}。`
                : "当前选择范围内小说事件分析已完成；如需重跑，请设置 force=true。",
        };

        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle(targetNovelIds.length > 0 ? "所选章节事件分析已启动" : "事件分析状态报告完成");
        thinking.complete();
        return result;
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([name]) => toolsNames.includes(name))) : tools;
}
