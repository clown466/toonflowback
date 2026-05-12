import { tool, Tool } from "ai";
import { z } from "zod";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";
import {
  assetImageGenerationModeLabel,
  decideAssetImageIntent,
  type AssetImageGenerationMode,
  type AssetImagePromptPolicy,
  type AssetImageReferencePolicy,
} from "@/services/assetImageIntent";
import { clearProjectStoryboards, shouldAppend, shouldForce, toPublicWorkspaceName } from "@/services/storyboardDraftGeneration";
import { generateProjectStoryboardWithSkill } from "@/services/storyboardSkillGeneration";
import {
  listDirectorBoards,
  queueDirectorBoardGeneration,
  regenerateDirectorBoard,
  type DirectorBoardType,
} from "@/services/directorBoardGeneration";
import { generateVideoPromptForTrack, type VideoPromptInfoItem } from "@/services/videoPromptGeneration";
import { submitVideoGenerationTask, type VideoUploadItem } from "@/services/videoGeneration";
import { toToolJsonSchema } from "@/utils/jsonSchema";

export interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
  abortSignal?: AbortSignal;
  sourceText?: string;
}

const assetTypeSchema = z.enum(["role", "scene", "tool", "other"]);
type AssetType = z.infer<typeof assetTypeSchema>;
const generatableAssetTypeSchema = z.enum(["role", "scene", "tool"]);
type GeneratableAssetType = z.infer<typeof generatableAssetTypeSchema>;
const assetImageGenerationModeSchema = z.enum(["fresh_design", "reference_redraw", "partial_edit", "variant", "retry_failed", "ambiguous_redraw", "default"]);
const assetImageReferencePolicySchema = z.enum(["none", "current_asset", "auto"]);
const assetImagePromptPolicySchema = z.enum(["asset_description_plus_request", "asset_prompt_plus_request", "reuse_current_prompt"]);
const assetImageQualitySchema = z.enum(["1K", "2K", "4K"]);
type AssetImageQuality = z.infer<typeof assetImageQualitySchema>;
const directorBoardTypeSchema = z.enum(["continuity", "textStoryboard", "hybridStoryboard"]);
const videoReferenceSourceSchema = z.enum(["assets", "storyboard", "directorBoard"]);
const videoReferenceInfoSchema = z.object({
  id: z.number().int().positive(),
  sources: videoReferenceSourceSchema,
});

export interface ProjectAssetImageGenerationOptions {
  includeCompleted?: boolean;
  sourceText?: string;
  userRequirement?: string;
  skillId?: string;
  generationMode?: AssetImageGenerationMode;
  referencePolicy?: AssetImageReferencePolicy;
  promptPolicy?: AssetImagePromptPolicy;
  finalizeMessage?: boolean;
  assetType?: GeneratableAssetType;
  limit?: number;
  assetIds?: number[];
  assetNames?: string[];
  disableNaturalLanguageScopeParsing?: boolean;
  useExistingAssetReference?: boolean;
  imageQuality?: AssetImageQuality;
  imageModel?: string;
  concurrentCount?: number;
}

export interface NovelAssetExtractionOptions {
  sourceText?: string;
  novelIds?: number[];
  chapterIndexes?: number[];
}

const assetInputSchema = z.object({
  name: z.string().min(1).describe("资产名称"),
  type: assetTypeSchema.describe("资产类型：role角色 / scene场景 / tool道具 / other其他"),
  describe: z.string().optional().describe("资产描述"),
  prompt: z.string().optional().describe("资产生成提示词"),
  source: z.string().optional().describe("资产来源说明，例如小说章节或事件"),
});

type AssetInput = z.infer<typeof assetInputSchema>;

function pickCount(value: unknown): number {
  const raw = typeof value === "object" && value !== null ? Object.values(value as Record<string, unknown>)[0] : value;
  const count = Number(raw ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAssetImageQuality(value: unknown): AssetImageQuality | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "1K" || normalized === "2K" || normalized === "4K") return normalized;
  return undefined;
}

function parseAssetImageQualityFromText(text: string): AssetImageQuality | undefined {
  const match = text.match(/(^|[^0-9])([124])\s*[kKＫｋ]([^0-9]|$)/);
  if (match) return normalizeAssetImageQuality(`${match[2]}K`);
  if (/低质量|低清|草稿|快速|省积分|省点数|便宜/i.test(text)) return "1K";
  if (/高质量|高清|精细|最高质量|最高分辨率|大图/i.test(text)) return "4K";
  if (/中等质量|标准质量|标准图|默认质量/i.test(text)) return "2K";
  return undefined;
}

function chineseNumberToArabic(value: string): number | null {
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text === "十") return 10;
  const hundredParts = text.split("百");
  let total = 0;
  let rest = text;
  if (hundredParts.length === 2) {
    total += (digits[hundredParts[0]!] ?? 1) * 100;
    rest = hundredParts[1]!;
  }
  const tenParts = rest.split("十");
  if (tenParts.length === 2) {
    total += (tenParts[0] ? digits[tenParts[0]] ?? 0 : 1) * 10;
    total += tenParts[1] ? digits[tenParts[1]] ?? 0 : 0;
    return total > 0 ? total : null;
  }
  if (rest.length === 1 && digits[rest] != null) return total + digits[rest];
  return total > 0 ? total : null;
}

function normalizePositiveLimit(value: unknown): number | undefined {
  const numberValue = typeof value === "string" ? chineseNumberToArabic(value) : Number(value);
  if (!Number.isInteger(numberValue) || Number(numberValue) <= 0) return undefined;
  return Math.min(Number(numberValue), 100);
}

function normalizeAssetName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function parseAssetTypeFromText(text: string): GeneratableAssetType | undefined {
  const matched: GeneratableAssetType[] = [];
  if (/(角色|人物|主角|配角|character)/i.test(text)) matched.push("role");
  if (/(场景|环境|地点|空间|scene|environment|location)/i.test(text)) matched.push("scene");
  if (/(道具|物品|工具|prop|props)/i.test(text)) matched.push("tool");
  return matched.length === 1 ? matched[0] : undefined;
}

function parseLimitFromText(text: string): number | undefined {
  const numberToken = String.raw`(\d{1,3}|[零〇一二两三四五六七八九十百]{1,8})`;
  const patterns = [
    new RegExp(String.raw`前\s*${numberToken}\s*(?:个|张|幅|组)?\s*(?:角色|人物|场景|环境|道具|物品|资产|参考图|图片|图)`, "i"),
    new RegExp(String.raw`(?:生成|提交|出|生|做)\s*前?\s*${numberToken}\s*(?:个|张|幅|组)?\s*(?:角色|人物|场景|环境|道具|物品|资产|参考图|图片|图)`, "i"),
    new RegExp(String.raw`${numberToken}\s*(?:个|张|幅|组)\s*(?:角色|人物|场景|环境|道具|物品|资产|参考图|图片|图)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const limit = normalizePositiveLimit(match?.[1]);
    if (limit) return limit;
  }
  return undefined;
}

function parseChapterIndexesFromText(text: string): number[] {
  const indexes: number[] = [];
  const numberToken = String.raw`(\d{1,4}|[零〇一二两三四五六七八九十百]{1,8})`;
  const rangePattern = new RegExp(String.raw`(?:juben\s*)?${numberToken}\s*(?:到|至|-|~)\s*(?:juben\s*)?${numberToken}|第?\s*${numberToken}\s*(?:章|章节|集|条)?\s*(?:到|至|-|~)\s*第?\s*${numberToken}\s*(?:章|章节|集|条)?`, "gi");
  for (const match of text.matchAll(rangePattern)) {
    const start = normalizePositiveLimit(match[1] ?? match[3]);
    const end = normalizePositiveLimit(match[2] ?? match[4]);
    if (!start || !end) continue;
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    for (let index = min; index <= max && indexes.length < 100; index += 1) indexes.push(index);
  }

  const singlePatterns = [
    new RegExp(String.raw`\bjuben\s*${numberToken}\b`, "gi"),
    new RegExp(String.raw`第?\s*${numberToken}\s*(?:章|章节|集|条)`, "gi"),
  ];
  for (const pattern of singlePatterns) {
    for (const match of text.matchAll(pattern)) {
      const index = normalizePositiveLimit(match[1]);
      if (index) indexes.push(index);
    }
  }

  return Array.from(new Set(indexes)).sort((a, b) => a - b);
}

export function parseAssetImageRequestScope(sourceText?: string): Pick<ProjectAssetImageGenerationOptions, "assetType" | "limit"> {
  const text = sourceText ?? "";
  return {
    assetType: parseAssetTypeFromText(text),
    limit: parseLimitFromText(text),
  };
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

async function writeProjectAssets(projectId: number, assets: AssetInput[], options: { skipExisting?: boolean } = {}) {
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
      if (options.skipExisting) {
        skipped.push(asset);
        continue;
      }
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
  const sourceLabel =
    novels
      .map((novel) => {
        const chapterIndex = novel.chapterIndex ?? novel.id;
        const chapter = nonEmpty(novel.chapter);
        return `第${chapterIndex}章${chapter ? ` ${chapter}` : ""}`;
      })
      .filter(Boolean)
      .join("、") || "小说事件/章节原文";
  const add = (name: string, type: AssetInput["type"], describe: string) => assets.push({ name, type, describe, source: sourceLabel });

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
    [/\bTiffany\b/i, "Tiffany / Mutated Tiffany", "Shining Glow Labs 的美妆 CEO 变异 Boss，四条细长手臂、巨大绿色眼睛、发光绿色指甲，执迷塑形和完美对称"],
    [/Plastic Guards|Barbie Zombies?|Barbie Zombie/i, "Plastic Guards / Barbie Zombies", "Tiffany 释放的医美塑形守卫丧尸，穿瑜伽裤、外形高度同质化，用来围攻主角小队"],
    [/Thesis Zombies|student zombies/i, "Thesis Zombies", "被论文和成绩焦虑驱动的学生丧尸群，携带课本和学术压力感"],
    [/Gamer Zombie/i, "Gamer Zombie", "沉迷游戏和 Wi-Fi 的高速闪避丧尸，穿格子衫，动作像滑行玩家"],
    [/Professor Zombies/i, "Professor Zombies", "执着批改和逻辑秩序的教授丧尸群，被混乱音乐干扰"],
    [/Overworked Monster|fused lab monster/i, "The Overworked Monster", "实验室融合怪物，代表过劳和实验事故的恐怖喜剧怪物"],
    [/Austin Zombie/i, "Austin Zombie", "网红式变异丧尸，使用直播、粉色灯光、快递盒和粉丝群攻击"],
    [/Fan Zombies/i, "Fan Zombies", "受 Austin Zombie 影响的粉丝丧尸群，像直播间观众一样蜂拥而上"],
    [/Road Rage Zombies?|zombie traffic jam/i, "Road Rage Zombies", "困在高速堵车中的路怒丧尸群，疯狂按喇叭、撞车并追逐装甲卡车"],
    [/creepy old man/i, "Creepy Old Man", "通往 Alpha Bunker 路线上的诡异老人，提供关键线索并暗示 Chloe 是核心钥匙"],
    [/zombie worker|toll booth|show.*pass/i, "Zombie Toll Booth Worker", "山路收费站的僵尸工作人员，机械执行通行规则，使用扫码器和残酷的头颅支付系统"],
    [/Zombie Park Ranger|park ranger/i, "Zombie Park Ranger", "感染后的山林管理员，骑着巨型变异松鼠，用哨声和罚单指挥森林攻击"],
    [/mutant squirrels?|giant mutant squirrel/i, "Giant Mutant Squirrel", "被粉色尘埃感染的巨型松鼠，体型像野猪，针状毛发和亮绿色眼睛，动作极快"],
    [/zombie waiters?|fancy zombie waiters?/i, "Fancy Zombie Waiters", "The Elysium 门口的高级僵尸侍者，保持礼仪和身份检查程序"],
    [/Chloe'?s dad|her Dad|Tiny Dad/i, "Chloe's Dad / Tiny Dad", "Chloe 的父亲和幕后操控者，试图通过上传意识获得永生，失败后残留成微型愤怒投影"],
    [/Old Rich CEOs?|rich friends|Shadow Board|Board's special lunch party/i, "Shadow Board Old Rich CEOs", "躲在 The Elysium 的富豪董事会成员，把末日和主角小队当作远程操控游戏"],
    [/\bOlaf\b/i, "Olaf", "Shadow Board 中参与远程杀戮游戏的富豪成员，被其他 CEO 嘲笑准头很差"],
    [/Glitch Monster|failed-upload father|upload failed/i, "Glitch Monster", "Chloe 父亲上传失败后的最终怪物形态，黑色黏液、机械臂、红色电路板和多张争吵面孔融合"],
    [/Vacation Zombies|silk robes|Red Light, Green Light/i, "Vacation Zombies", "The Elysium 内被冻结更新的富豪度假丧尸，穿丝绸睡袍，像红绿灯游戏一样静止"],
  ];
  for (const [regex, name, desc] of roleRules) if (regex.test(text)) add(name, "role", desc);

  const sceneRules: Array<[RegExp, string, string]> = [
    [/bunker/i, "Safe Bunker", "幸存者小队出发前的安全地堡，末日避难空间"],
    [/campus|college/i, "Zombie College Campus", "被学生丧尸包围的大学校园，充满课本、压力和混乱追逐"],
    [/library/i, "College Library", "校园图书馆，救援 Cyber Ghost 的关键室内场景"],
    [/basement|supercomputer center/i, "Basement Supercomputer Center", "阴冷地下超级计算机中心，旧书、咖啡和压力气味浓重"],
    [/Shining Glow Labs|pink factory/i, "Shining Glow Labs Pink Factory", "病毒源头的粉色工厂/实验室入口，带商业化美妆饮品风格"],
    [/deepest part of Shining Glow Labs|giant,\s*pure white lab|pure white lab|deepest lab/i, "Shining Glow Labs Deep White Lab", "Shining Glow Labs 最深处的纯白 Boss 实验室，粉色 CEO 椅、监控屏、医美气味和陷阱装置集中出现"],
    [/armored truck|truck/i, "Armored Truck", "小队穿越校园和工厂战斗时使用的装甲卡车"],
    [/highway|traffic jam|crashed cars/i, "Road Rage Highway Jam", "爆炸后通往 Alpha Bunker 的高速公路堵车区，满是撞毁车辆、粉色灰尘和路怒丧尸"],
    [/mountain toll booth|toll booth/i, "Mountain Toll Booth Gate", "通往 Alpha Bunker 山路上的军用收费站，厚重金属栏杆、弹孔窗口和血迹通行系统"],
    [/pink-dust forest|mountain road|rocky mountain road|cotton candy forest/i, "Pink-Dust Mountain Forest", "被粉色尘埃覆盖的山林道路，森林像诡异棉花糖，感染动物高速伏击车辆"],
    [/The Elysium gate|fancy marble gate|Alpha Bunker|Elysium/i, "The Elysium Alpha Bunker Entrance", "富豪避难所 The Elysium / Alpha Bunker 的豪华大理石入口，带身份检查和末日高级会所气质"],
    [/Board's special lunch party|white marble pillar|lunch party|bunker.*party/i, "The Elysium Board Game Hall", "The Elysium 内部富豪董事会游戏大厅，白色大理石柱、金色音响和远程操控杀戮机关"],
    [/golden server|server in the middle|physically break the golden server/i, "Golden Server Room", "董事会游戏大厅中央的金色服务器区域，是远程操控系统的物理核心"],
    [/golden door|final tank|golden water tank|upload lab|green healing water/i, "Golden Upload Lab", "黄金门后的最终上传实验室，金色水箱、闪烁全息影像、黑色黏液和系统崩溃灯光"],
    [/fake sunlight|outside.*zombies.*stopped|System Updating|Empathy Patch/i, "Frozen Update World", "结局中全世界丧尸进入系统更新后的静止外部世界，漂浮加载条覆盖城市与道路"],
  ];
  for (const [regex, name, desc] of sceneRules) if (regex.test(text)) add(name, "scene", desc);

  const toolRules: Array<[RegExp, string, string]> = [
    [/marked paper|paper with red marks|80% copied/i, "Marked Paper", "带红色批注/抄袭标记的论文纸，用来击溃学生丧尸的学术焦虑"],
    [/Chloe[\s\S]{0,80}shotgun|shotgun[\s\S]{0,80}Chloe/i, "Chloe's Shotgun", "Chloe 近战和火力压制使用的霰弹枪，Boss 战中用于快速开火和制造冲击"],
    [/Leo[\s\S]{0,80}(pan|frying pan)|frying pan[\s\S]{0,80}Leo/i, "Leo's Frying Pan", "Leo 标志性的平底锅武器，用来格挡针刺、制造喜剧式反击和保护队友"],
    [/gun|shotgun|bullets/i, "Bob's Gun", "Bob 使用的枪械火力道具，用于对抗丧尸"],
    [/power strip|unplug/i, "Power Strip", "Chloe 拔掉的电源排插，用来冻结沉迷 Wi-Fi 的 Gamer Zombie"],
    [/PA system|speakers|techno|EDM|anime techno/i, "PA System with Anime Techno Music", "播放混乱动漫电子乐的广播系统，用来干扰教授丧尸"],
    [/laptop|computer/i, "Eugene's Laptop", "Eugene/Cyber Ghost 的黑客电脑，用于追踪病毒和入侵系统"],
    [/anime pillow|waifu/i, "Anime Pillow", "Eugene 抱着的宅系动漫抱枕，强化角色喜剧辨识度"],
    [/dynamite/i, "Dynamite", "Chloe 用来摧毁 Austin Zombie 的炸药"],
    [/delivery boxes|boxes/i, "Delivery Boxes", "Austin Zombie 从机器中发射的重型快递盒攻击物"],
    [/diet tea/i, "Failed Diet Tea", "Shining Glow Labs 失败实验的减肥茶，病毒源头线索"],
    [/Botox gas|gas vents?|pink gas|gas filled/i, "Botox Gas Trap", "Tiffany 实验室释放的粉色 Botox 毒气陷阱，会困住小队并制造窒息压迫感"],
    [/laser|lasers/i, "Laser Trap Grid", "Shining Glow Labs Boss 战中的激光陷阱网，封锁出口并压缩角色行动空间"],
    [/green nails|needles?|needle-thin|glowing green/i, "Tiffany's Green Needle Nails", "Tiffany 四只手上的发光绿色针状指甲，用于高速突刺攻击 Chloe"],
    [/pink leather chair|chair slowly turned/i, "Pink CEO Chair", "Tiffany 登场使用的粉色皮革 CEO 椅，背对监控屏旋转揭示 Boss 形态"],
    [/monitors?|screens?|camera feeds?|heart stickers?/i, "Filtered Zombie Monitor Wall", "实验室监控墙，显示带粉色滤镜和爱心贴纸的僵尸直播画面"],
    [/toxic tea tank|3-story-tall glass tank|giant tank|Ultimate Fat Burner/i, "Toxic Diet Tea Tank", "Shining Glow Labs 中装满有毒减肥茶的巨型玻璃罐，是最终爆炸和溶解 Tiffany 的核心装置"],
    [/glass tubes?|Barbie Zombie/i, "Plastic Guard Glass Tubes", "地板升起的玻璃培养管，内部装着塑形守卫/Barbie Zombies，作为 Boss 战增援装置"],
    [/emergency drain pipe|detox system|drain trap/i, "Emergency Detox Drain System", "实验室中的紧急排毒排水系统，Leo 和 Eugene 用来触发陷阱并溶解 Tiffany"],
    [/gas mask/i, "Gas Mask", "小队在粉色灰尘和污染环境中使用的防护面具，用于穿越 Shining Glow Labs 爆炸后的污染区"],
    [/non-stick cooking oil/i, "Non-Stick Cooking Oil", "Leo 用来保养平底锅的防粘锅油，强化他的荒诞武器风格"],
    [/red barcode scanner|barcode scanner/i, "Red Barcode Scanner", "收费站僵尸工作人员使用的红色扫码器，用来判定通行付款和身份检查"],
    [/human heads?|PAID sticker|paid in heads/i, "Head Payment Wall", "收费站墙上悬挂的头颅支付记录，每个头颅贴有 PAID 标签，体现通行规则的恐怖荒诞"],
    [/gold bricks?|heavy currency/i, "Gold Bricks / Heavy Currency", "Chloe 用来砸毁收费站系统的沉重金砖，被僵尸误判为重货币"],
    [/sonic repeller|repeller/i, "Bob's Sonic Repeller", "Bob 用来驱散变异松鼠和山林攻击的声波驱赶器"],
    [/pink paper|Speed limit|Fine.*heart/i, "Pink Speed Limit Fine", "Zombie Park Ranger 举起的粉色罚单，写着限速和一颗人心罚款"],
    [/cat-ear helmet/i, "Leo's Cat-Ear Helmet", "Leo 执行假外卖计划时佩戴的猫耳头盔，突出荒诞配送伪装"],
    [/pizza box|Doomsday Special/i, "Red Pizza Box", "进入 The Elysium 时使用的红色披萨盒伪装道具，骗过高级僵尸侍者"],
    [/golden speakers?/i, "Golden Speakers", "The Elysium 董事会游戏大厅中的金色扬声器，用来播放父亲和富豪董事会的远程声音"],
    [/Roomba with chainsaws|chainsaw Roomba/i, "Chainsaw Roomba", "从天花板落下的巨型链锯扫地机器人，像死亡陀螺一样切割地面"],
    [/yellow excavator|machine guns|arcade game/i, "Weaponized Excavator", "富豪远程操控的黄色挖掘机，铲斗被机枪替代，在大厅中疯狂扫射"],
    [/Master Key|admin control/i, "Master Key", "Chloe 用血触发的最高权限钥匙，用来夺取系统管理员控制权"],
    [/red computer board|computer board/i, "Glowing Red Computer Board", "插在 Glitch Monster 胸口的发光红色电路板，表现上传失败和系统污染"],
    [/glowing blue orb|blue orb/i, "Glowing Blue Orb", "Glitch Monster 消失后留下的发光蓝色球体，承载父亲残留意识和结局反转"],
    [/floating loading bars?|System Updating|Empathy Patch|Sleep Mode/i, "System Update Loading Bars", "世界冻结后悬浮在丧尸头顶的系统更新加载条，显示 Empathy Patch 和 Sleep Mode 等状态"],
  ];
  for (const [regex, name, desc] of toolRules) if (regex.test(text)) add(name, "tool", desc);

  return { assets };
}

function shouldOnlyCreateNewAssets(sourceText?: string) {
  return /新增|新出现|新角色|新场景|新道具|只.*新/i.test(sourceText ?? "");
}

function describeNovelScope(novels: any[]) {
  if (!novels.length) return "当前小说章节";
  return novels
    .map((novel) => {
      const chapterIndex = novel.chapterIndex ?? novel.id;
      const chapter = nonEmpty(novel.chapter);
      return `第${chapterIndex}章${chapter ? ` ${chapter}` : ""}`;
    })
    .join("、");
}

export async function runNovelAssetExtractionTool(config: ToolConfig, options: NovelAssetExtractionOptions = {}) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在直接读取小说并提取资产...");

  const allNovels = await u
    .db("o_novel")
    .where("projectId", projectId)
    .select("id", "chapter", "chapterIndex", "eventState", "event", "chapterData")
    .orderBy("chapterIndex", "asc");
  const requestedNovelIds = Array.from(new Set((options.novelIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  const requestedChapterIndexes = Array.from(
    new Set([...(options.chapterIndexes ?? []), ...parseChapterIndexesFromText(options.sourceText ?? "")].map(Number).filter((index) => Number.isInteger(index) && index > 0)),
  );
  let novels = allNovels;
  if (requestedNovelIds.length) novels = allNovels.filter((novel: any) => requestedNovelIds.includes(Number(novel.id)));
  else if (requestedChapterIndexes.length) novels = allNovels.filter((novel: any) => requestedChapterIndexes.includes(Number(novel.chapterIndex)));

  if (!allNovels.length) {
    thinking.updateTitle("未找到小说章节");
    thinking.complete();
    const text = msg.text("当前项目没有小说章节，无法基于原文提取资产。请先上传/导入小说。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "no_novel" };
  }

  if (!novels.length) {
    thinking.updateTitle("未匹配到指定章节");
    thinking.complete();
    const requested = requestedChapterIndexes.length ? `第 ${requestedChapterIndexes.join("、")} 章` : requestedNovelIds.length ? `小说记录 ${requestedNovelIds.join("、")}` : "指定章节";
    const text = msg.text(`没有匹配到${requested}，已停止资产提取，避免把其他章节资产写入当前资产库。`);
    text.complete();
    msg.complete();
    return { handled: true, reason: "chapter_not_found", extractedCandidates: 0 };
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
  const onlyNew = shouldOnlyCreateNewAssets(options.sourceText);
  const result = await writeProjectAssets(projectId, candidateAssets, { skipExisting: onlyNew });
  const assetRows = await u.db("o_assets").where("projectId", projectId).whereNull("assetsId").select("type").count({ count: "id" }).groupBy("type");
  const summary = summarizeByAssetType(assetRows as Array<{ type?: string | null; count?: unknown }>);

  thinking.appendText(JSON.stringify({ extractedCandidates: candidateAssets.length, ...result }, null, 2));
  thinking.updateTitle("小说资产提取完成");
  thinking.complete();

  const lines = [
    `已直接从${describeNovelScope(novels)}写入资产库，不再等待大模型决策。`,
    onlyNew ? `已按“新增资产”模式处理：已有资产只跳过，不再更新。` : "",
    `本次候选资产 ${candidateAssets.length} 个：新建 ${result.createdCount}，更新 ${result.updatedCount}，跳过 ${result.skippedCount}。`,
    `当前资产库：角色 ${summary.role}，场景 ${summary.scene}，道具 ${summary.tool}，其他 ${summary.other}。`,
  ].filter(Boolean);
  if (result.createdCount || result.updatedCount) {
    const changed = [...result.created, ...result.updated].slice(0, 24).map((item: any) => `- ${item.name}（${item.type}）`);
    lines.push("\n已处理资产：", ...changed);
  }
  const text = msg.text(lines.join("\n"));
  text.complete();
  msg.complete();
  return { handled: true, message: lines.join("\n"), result };
}

// Compatibility alias for older agent plans/tests that still import the former name.
export async function runNovelAssetExtractionFastPath(config: ToolConfig, options: NovelAssetExtractionOptions = {}) {
  return runNovelAssetExtractionTool(config, options);
}

function buildAssetImagePromptSource(asset: any, freshAssetText: boolean) {
  const describe = nonEmpty(asset.describe);
  const prompt = nonEmpty(asset.prompt);
  const name = nonEmpty(asset.name) ?? `资产 #${asset.id}`;
  if (freshAssetText) {
    return describe ? `${name}。${describe}` : prompt ?? name;
  }
  return prompt ?? describe ?? name;
}

function buildFreshAssetUserRequirement(text: string) {
  const raw = nonEmpty(text) ?? "无";
  return [
    raw,
    "本次是全新资产图设计任务：不要沿用、复刻、临摹或微调当前资产图片；不要从旧资产图继承颜色、服装、脸型、构图或局部细节；如果存在当前图片，只当作历史产物忽略。",
    "只依据资产名称、资产描述、用户本次要求、项目视觉手册和所选生图预设生成。若用户指定了新的水果/物种/造型，以用户本次要求为最高优先级。",
  ].join("\n");
}

function formatAssetNames(assets: Array<{ id: number; name: string }>, limit = 12) {
  const names = assets.slice(0, limit).map((asset) => `${asset.name || `#${asset.id}`}`);
  if (assets.length > limit) names.push(`等 ${assets.length} 个`);
  return names.join("、");
}

function assetTypeLabel(type?: GeneratableAssetType) {
  if (type === "role") return "角色";
  if (type === "scene") return "场景";
  if (type === "tool") return "道具";
  return "资产";
}

function formatAssetImageScope(scope: { assetType?: GeneratableAssetType; limit?: number; assetIds?: number[]; assetNames?: string[] }) {
  const parts: string[] = [];
  if (scope.assetType) parts.push(assetTypeLabel(scope.assetType));
  if (scope.limit) parts.push(`前 ${scope.limit} 个`);
  if (scope.assetIds?.length) parts.push(`指定 ID ${scope.assetIds.join(", ")}`);
  if (scope.assetNames?.length) parts.push(`指定名称 ${scope.assetNames.join("、")}`);
  return parts.join("，");
}

function emitProjectAssetImageUpdate(resTool: ResTool, payload: Record<string, unknown>) {
  resTool.socket.emit("productionDataUpdated", {
    type: "asset_images",
    ...payload,
  });
}

async function attachLatestAssetImageFields<T extends { id?: number | null }>(assets: T[]) {
  const assetIds = assets.map((asset) => Number(asset.id)).filter((id) => Number.isFinite(id));
  if (!assetIds.length) return assets;
  const rows = await u
    .db("o_image")
    .whereIn("assetsId", assetIds)
    .select("id", "assetsId", "state", "filePath", "errorReason")
    .orderBy("id", "desc");
  const latestByAssetId = new Map<number, any>();
  rows.forEach((row: any) => {
    const assetId = Number(row.assetsId);
    if (!latestByAssetId.has(assetId)) latestByAssetId.set(assetId, row);
  });
  return assets.map((asset: any) => {
    const latest = latestByAssetId.get(Number(asset.id));
    return {
      ...asset,
      latestImageId: latest?.id ?? null,
      latestImageState: latest?.state ?? null,
      latestImageFilePath: latest?.filePath ?? null,
      latestImageErrorReason: latest?.errorReason ?? null,
    };
  });
}

function isGeneratingAssetImage(asset: any) {
  return asset.imageState === "生成中" || asset.latestImageState === "生成中";
}

function hasMissingOrFailedAssetImage(asset: any) {
  return !asset.imageId || asset.imageState === "生成失败" || asset.latestImageState === "生成失败" || (asset.imageState === "已完成" && !asset.imageFilePath);
}

function isAssetImageRepairRequest(text: string, mode: AssetImageGenerationMode) {
  return mode === "retry_failed" || /(失败|报错|错误|未成功|未开始|缺图|补生成|补图|重试|重新跑|补跑)/i.test(text);
}

export async function runProjectAssetImageGenerationTool(config: ToolConfig, options?: ProjectAssetImageGenerationOptions) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const requestText = options?.userRequirement ?? options?.sourceText ?? config.sourceText ?? "";
  const intentDecision = decideAssetImageIntent(requestText, {
    generationMode: options?.generationMode,
    referencePolicy: options?.referencePolicy,
    promptPolicy: options?.promptPolicy,
    includeCompleted: options?.includeCompleted,
    useExistingAssetReference: options?.useExistingAssetReference,
  });
  const includeCompleted = intentDecision.includeCompleted;
  const finalizeMessage = options?.finalizeMessage ?? true;
  const parsedScope = options?.disableNaturalLanguageScopeParsing ? {} : parseAssetImageRequestScope(requestText);
  const assetType = options?.assetType ?? parsedScope.assetType;
  const limit = normalizePositiveLimit(options?.limit) ?? parsedScope.limit;
  const assetIds = Array.from(new Set((options?.assetIds ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
  const assetNames = Array.from(new Set((options?.assetNames ?? []).map((name) => nonEmpty(name)).filter((name): name is string => Boolean(name))));
  const assetNameSet = new Set(assetNames.map(normalizeAssetName));
  const scopeText = formatAssetImageScope({ assetType, limit, assetIds, assetNames });
  const thinking = msg.thinking("正在提交资产批量出图任务...");
  const requestedImageQuality = normalizeAssetImageQuality(options?.imageQuality) ?? parseAssetImageQualityFromText(requestText);
  const requestedImageModel = nonEmpty(options?.imageModel);
  const concurrentCount = Math.min(Math.max(Number(options?.concurrentCount || 1), 1), 4);

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
  const effectiveImageModel = requestedImageModel ?? nonEmpty(project.imageModel);
  const projectDefaultImageQuality = nonEmpty(project.imageQuality);
  if (!effectiveImageModel || (!projectDefaultImageQuality && !requestedImageQuality)) {
    thinking.updateTitle("缺少图像模型配置");
    thinking.complete();
    if (finalizeMessage) {
      const text = msg.text("当前项目还没有配置图像模型或图片质量；也可以在本次工具调用中显式指定 imageModel 和 imageQuality。");
      text.complete();
      msg.complete();
    }
    return { handled: true, reason: "missing_project_image_config" };
  }
  const effectiveImageQuality = requestedImageQuality ?? normalizeAssetImageQuality(projectDefaultImageQuality) ?? projectDefaultImageQuality ?? "2K";

  const rawAssets = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereNull("o_assets.assetsId")
    .whereIn("o_assets.type", ["role", "scene", "tool"])
    .select(
      "o_assets.id",
      "o_assets.name",
      "o_assets.type",
      "o_assets.describe",
      "o_assets.prompt",
      "o_assets.imageId",
      "o_image.state as imageState",
      "o_image.filePath as imageFilePath",
    )
    .orderByRaw(`CASE o_assets.type WHEN 'role' THEN 1 WHEN 'scene' THEN 2 WHEN 'tool' THEN 3 ELSE 4 END`)
    .orderBy("o_assets.id", "asc");
  const assets = await attachLatestAssetImageFields(rawAssets as any[]);
  const wantsRepairMissingOrFailed = isAssetImageRepairRequest(requestText, intentDecision.generationMode);

  const scopedAssets = assets.filter((asset: any) => {
    if (assetType && asset.type !== assetType) return false;
    if (assetIds.length && !assetIds.includes(Number(asset.id))) return false;
    if (assetNameSet.size && !assetNameSet.has(normalizeAssetName(asset.name))) return false;
    return true;
  });
  const selectedAssets = limit ? scopedAssets.slice(0, limit) : scopedAssets;
  const skippedCompleted = selectedAssets.filter((asset: any) => asset.imageState === "已完成" && !(wantsRepairMissingOrFailed && hasMissingOrFailedAssetImage(asset)));
  const skippedGenerating = selectedAssets.filter((asset: any) => isGeneratingAssetImage(asset));
  const targetAssets = selectedAssets.filter((asset: any) => {
    if (isGeneratingAssetImage(asset)) return false;
    if (wantsRepairMissingOrFailed) return hasMissingOrFailedAssetImage(asset);
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
          includeCompleted,
          totalAssets: assets.length,
          scope: scopeText || null,
          scopedAssets: scopedAssets.length,
          selectedAssets: selectedAssets.length,
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
          scopeText ? `已按范围筛选：${scopeText}；匹配 ${scopedAssets.length} 个，进入本次范围 ${selectedAssets.length} 个。` : "",
          scopeText && selectedAssets.length === 0 ? "该范围内没有匹配到资产，请换一个范围或先提取资产。" : "",
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

  const sourceText = requestText;
  if (intentDecision.needsClarification) {
    thinking.appendText(JSON.stringify({ projectId, intentDecision, scope: scopeText || null }, null, 2));
    thinking.updateTitle("需要确认资产生图方式");
    thinking.complete();
    const message = intentDecision.clarificationQuestion ?? "请确认本次资产图是要参考当前图修改，还是完全重新设计。";
    if (finalizeMessage) {
      const text = msg.text(message);
      text.complete();
      msg.complete();
    }
    return { handled: true, reason: "needs_asset_image_mode_confirmation", message, intentDecision };
  }

  const freshAssetText = intentDecision.promptPolicy === "asset_description_plus_request" || intentDecision.generationMode === "fresh_design";
  const effectiveUserRequirement = freshAssetText ? buildFreshAssetUserRequirement(sourceText) : options?.userRequirement ?? options?.sourceText ?? config.sourceText ?? null;
  const useExistingAssetReference = intentDecision.useExistingAssetReference === true;
  const generationItems = await Promise.all(
    validAssets.map(async (asset: any) => {
      let base64: string | null = null;
      if (useExistingAssetReference && asset.imageFilePath) {
        try {
          base64 = await u.oss.getImageBase64(asset.imageFilePath);
        } catch {
          base64 = null;
        }
      }
      return {
        id: asset.id,
        type: asset.type,
        name: asset.name || `资产 #${asset.id}`,
        describe: nonEmpty(asset.describe) ?? null,
        prompt: buildAssetImagePromptSource(asset, freshAssetText),
        base64,
        skillId: options?.skillId ?? null,
        generationMode: intentDecision.generationMode,
        referencePolicy: intentDecision.referencePolicy,
        promptPolicy: intentDecision.promptPolicy,
        userRequirement: effectiveUserRequirement,
      };
    }),
  );

  const result = await submitAssetImageGeneration({
    projectId,
    model: effectiveImageModel,
    resolution: effectiveImageQuality,
    concurrentCount,
    onStatusChange: (event) => {
      emitProjectAssetImageUpdate(resTool, {
        projectId,
        stage: "progress",
        records: [event],
      });
    },
    items: generationItems,
    skillId: options?.skillId ?? null,
    generationMode: intentDecision.generationMode,
    referencePolicy: intentDecision.referencePolicy,
    promptPolicy: intentDecision.promptPolicy,
    userRequirement: effectiveUserRequirement,
  });

  emitProjectAssetImageUpdate(resTool, {
    projectId,
    stage: "submitted",
    submitted: result.submitted,
    assetIds: validAssets.map((asset: any) => asset.id),
    records: result.imageIds.map((item) => ({
      projectId,
      assetId: item.assetId,
      imageId: item.imageId,
      state: "生成中",
    })),
  });

  thinking.appendText(
    JSON.stringify(
      {
        projectId,
        imageModel: effectiveImageModel,
        requestedImageModel,
        imageQuality: effectiveImageQuality,
        projectDefaultImageQuality: project.imageQuality,
        aspectRatio: "16:9",
        includeCompleted,
        scope: scopeText || null,
        scopedAssets: scopedAssets.length,
        selectedAssets: selectedAssets.length,
        submitted: result.submitted,
        intentDecision,
        skippedBySubmitGuard: result.skippedGenerating,
        skippedCompleted: includeCompleted ? 0 : skippedCompleted.length,
        skippedGenerating: skippedGenerating.length,
        skippedNoPrompt: skippedNoPrompt.length,
        freshAssetText,
        useExistingAssetReference,
        referencedExistingImages: generationItems.filter((item) => item.base64).length,
        skillId: options?.skillId ?? null,
        concurrentCount,
        assetIds: validAssets.map((asset: any) => asset.id),
      },
      null,
      2,
    ),
  );
  thinking.updateTitle("资产批量出图任务已提交");
  thinking.complete();

  const lines = [
    `已提交 ${result.submitted} 个资产图生成任务，画幅固定 16:9。`,
    scopeText ? `已按范围筛选：${scopeText}；匹配 ${scopedAssets.length} 个，进入本次范围 ${selectedAssets.length} 个。` : "",
    `模型：${effectiveImageModel}，质量：${effectiveImageQuality}，后台并发：${concurrentCount}。`,
    requestedImageModel && requestedImageModel !== project.imageModel ? `已按本次要求覆盖项目默认出图模型：${project.imageModel || "未设置"} -> ${requestedImageModel}。` : "",
    requestedImageQuality && requestedImageQuality !== normalizeAssetImageQuality(project.imageQuality) ? `已按本次要求覆盖项目默认质量：${project.imageQuality || "未设置"} -> ${requestedImageQuality}。` : "",
    options?.skillId ? `已使用生图预设：${options.skillId}。` : "",
    `模式：${assetImageGenerationModeLabel(intentDecision.generationMode)}。`,
    validAssets.length ? `本次提交：${formatAssetNames(validAssets)}。` : "",
    !includeCompleted && skippedCompleted.length ? `已完成的 ${skippedCompleted.length} 个资产本次保留不重绘；需要全量重绘时说“重绘全部资产图”。` : "",
    skippedGenerating.length ? `已有 ${skippedGenerating.length} 个资产正在生成中，已跳过避免重复任务。` : "",
    skippedNoPrompt.length ? `有 ${skippedNoPrompt.length} 个资产缺少提示词/描述，已跳过。` : "",
    useExistingAssetReference ? `已把 ${generationItems.filter((item) => item.base64).length} 张当前资产图作为参考图传给生图模型。` : "",
    !useExistingAssetReference && includeCompleted ? "本次不带入当前资产图参考，只按文字设定、视觉手册和生图预设生成。" : "",
    freshAssetText ? "已识别为全新设计：本次不会复用旧资产 prompt 作为主提示词。" : "",
    "你可以在资产区看生成中状态，完成后图片会自动写回对应资产。",
  ].filter(Boolean);
  if (finalizeMessage) {
    const text = msg.text(lines.join("\n"));
    text.complete();
    msg.complete();
  }

  return { handled: true, message: lines.join("\n"), result };
}

// Compatibility alias for older agent plans/tests that still import the former name.
export async function runProjectAssetImageGenerationFastPath(config: ToolConfig, options?: ProjectAssetImageGenerationOptions) {
  return runProjectAssetImageGenerationTool(config, options);
}

export async function runProjectStoryboardDraftTool(
  config: ToolConfig,
  options?: { sourceText?: string; force?: boolean; append?: boolean; novelIds?: number[]; chapterIndexes?: number[]; skillId?: string; userRequirement?: string },
) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const sourceText = [options?.sourceText, options?.userRequirement, config.sourceText].filter(Boolean).join("\n");
  msg.updateStatus("streaming");
  const thinking = msg.thinking("正在生成生产分镜草案...");
  thinking.updateTitle("正在调用分镜模型生成结构化分镜...");

  const result = await generateProjectStoryboardWithSkill(projectId, {
    sourceText,
    userRequirement: options?.userRequirement,
    skillId: options?.skillId,
    preferredScriptId: typeof resTool.data.scriptId === "number" ? resTool.data.scriptId : undefined,
    force: options?.force ?? shouldForce(sourceText),
    append: options?.append ?? shouldAppend(sourceText),
    novelIds: options?.novelIds,
    chapterIndexes: options?.chapterIndexes,
    abortSignal: config.abortSignal,
    onWorkspaceResolved: (workspace) => {
      resTool.socket.emit("productionDataUpdated", {
        projectId,
        episodesId: workspace.episodesId,
        scriptName: workspace.scriptName,
        scriptCreated: workspace.scriptCreated,
        existingCount: workspace.existingCount,
        selectedNovelIds: workspace.selectedNovelIds,
        selectedChapterIndexes: workspace.selectedChapterIndexes,
        selectedChapterLabels: workspace.selectedChapterLabels,
        createdCount: 0,
        storyboardIds: [],
        stage: "workspace_resolved",
      });
    },
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
        usedSkillId: result.usedSkillId,
        usedSkillName: result.usedSkillName,
        fallbackReason: result.fallbackReason,
        storyboardIds: result.storyboardIds,
      },
      null,
      2,
    ),
  );
  thinking.updateTitle(result.createdCount > 0 ? "分镜草案已写入章节工作区" : "已有分镜，已切换章节工作区");
  thinking.complete();

  resTool.socket.emit("productionDataUpdated", {
    projectId,
    episodesId: result.episodesId,
    scriptName: result.scriptName,
    createdCount: result.createdCount,
    existingCount: result.existingCount,
    storyboardIds: result.storyboardIds,
  });

  const tableRows = result.storyboardTable
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.includes("|") && !/^\|\s*-/.test(line));
  const tableDataRows = Math.max(0, tableRows.length - 1);
  const tablePreview = tableRows.slice(0, 5).join("\n");
  const lines = [
    result.message,
    result.usedSkillName ? `分镜方法：${result.usedSkillName}。` : "",
    result.fallbackReason ? `已回退旧模板生成器：${result.fallbackReason}。` : "",
    result.selectedChapterLabels.length ? `本次章节：${result.selectedChapterLabels.join("、")}。` : "",
    tableDataRows > 0 ? `分镜表已生成 ${tableDataRows} 行并写入章节工作区数据。` : "",
    tablePreview ? `分镜表预览：\n${tablePreview}` : "",
    `已关联当前项目资产库，并写入 Flova 工作台可读取的数据。`,
    result.createdCount > 0 ? "现在可以在左侧分镜列表查看分镜表；默认下一步是点“生成章节导演板”生成分镜故事板。首帧图只是可选补充。" : "",
  ].filter(Boolean);
  const text = msg.text(lines.join("\n"));
  text.complete();
  msg.complete();

  return { handled: true, result };
}

// Compatibility alias for older agent plans/tests that still import the former name.
export async function runProjectStoryboardDraftFastPath(
  config: ToolConfig,
  options?: { sourceText?: string; force?: boolean; append?: boolean; novelIds?: number[]; chapterIndexes?: number[]; skillId?: string; userRequirement?: string },
) {
  return runProjectStoryboardDraftTool(config, options);
}

export async function runProjectStoryboardClearTool(config: ToolConfig, options?: { sourceText?: string }) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在清空章节分镜...");

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
  thinking.updateTitle(result.cleared ? "分镜已清空" : result.needsSelection ? "需要指定章节分镜工作区" : "没有可清空的分镜");
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

// Compatibility alias for older agent plans/tests that still import the former name.
export async function runProjectStoryboardClearFastPath(config: ToolConfig, options?: { sourceText?: string }) {
  return runProjectStoryboardClearTool(config, options);
}

function parseStoredNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isFinite(item));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

async function scriptCandidatesWithStoryboardCounts(projectId: number, scripts: any[]) {
  const scriptIds = scripts.map((script) => Number(script.id)).filter((id) => Number.isFinite(id));
  const countRows = scriptIds.length
    ? await u.db("o_storyboard").where({ projectId }).whereIn("scriptId", scriptIds).select("scriptId").count({ count: "id" }).groupBy("scriptId")
    : [];
  const countMap = new Map(countRows.map((row: any) => [Number(row.scriptId), pickCount(row.count)]));
  return scripts.map((script) => ({
    id: Number(script.id),
    name: toPublicWorkspaceName(script.name ?? "未命名章节工作区"),
    storyboardCount: countMap.get(Number(script.id)) ?? 0,
    createTime: script.createTime ?? null,
  }));
}

async function resolveChapterWorkspace(config: ToolConfig, options?: { scriptId?: number; sourceText?: string; chapterIndexes?: number[] }) {
  const projectId = Number(config.resTool.data.projectId);
  const explicitScriptId = Number(options?.scriptId);
  if (Number.isInteger(explicitScriptId) && explicitScriptId > 0) {
    const script = await u.db("o_script").where({ id: explicitScriptId, projectId }).first();
    if (script?.id) return { ok: true as const, scriptId: Number(script.id), script };
    return { ok: false as const, reason: `没有找到指定章节工作区 ID ${explicitScriptId}。` };
  }

  const requestedChapterIndexes = Array.from(
    new Set([...(options?.chapterIndexes ?? []), ...parseChapterIndexesFromText(options?.sourceText ?? config.sourceText ?? "")].map(Number).filter((index) => Number.isInteger(index) && index > 0)),
  );
  const scripts = await u.db("o_script").where({ projectId }).select("id", "name", "content", "createTime").orderBy("id", "asc");
  if (requestedChapterIndexes.length) {
    const novels = await u
      .db("o_novel")
      .where({ projectId })
      .whereIn("chapterIndex", requestedChapterIndexes)
      .select("id", "chapter", "chapterIndex", "chapterData");
    if (!novels.length) return { ok: false as const, reason: `没有匹配到项目内第 ${requestedChapterIndexes.join("、")} 条小说。` };

    const labels = novels.flatMap((novel: any) =>
      [novel.chapter, `第${novel.chapterIndex}`, `第 ${novel.chapterIndex}`, `juben${novel.chapterIndex}`]
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
    const matchedScripts = scripts.filter((script: any) => {
      const scriptContent = String(script.content ?? "").trim();
      const name = String(script.name ?? "").trim().toLowerCase();
      const contentMatched = novels.some((novel: any) => String(novel.chapterData ?? "").trim() && String(novel.chapterData ?? "").trim() === scriptContent);
      const nameMatched = labels.some((label) => label && name.includes(label));
      return contentMatched || nameMatched;
    });
    const candidates = await scriptCandidatesWithStoryboardCounts(projectId, matchedScripts);
    const withStoryboards = candidates.filter((item) => item.storyboardCount > 0);
    if (withStoryboards.length === 1) {
      const script = matchedScripts.find((item: any) => Number(item.id) === withStoryboards[0]!.id);
      return { ok: true as const, scriptId: withStoryboards[0]!.id, script };
    }
    if (candidates.length === 1) {
      const script = matchedScripts.find((item: any) => Number(item.id) === candidates[0]!.id);
      return { ok: true as const, scriptId: candidates[0]!.id, script };
    }
    return {
      ok: false as const,
      reason: candidates.length
        ? `匹配到多个章节工作区，请指定 scriptId：${candidates.map((item) => `${item.id}:${item.name}（分镜${item.storyboardCount}）`).join("；")}`
        : `项目内第 ${requestedChapterIndexes.join("、")} 条还没有对应的章节分镜工作区。请先生成分镜表。`,
      candidates,
    };
  }

  const currentScriptId = Number(config.resTool.data.scriptId);
  if (Number.isInteger(currentScriptId) && currentScriptId > 0) {
    const script = await u.db("o_script").where({ id: currentScriptId, projectId }).first();
    if (script?.id) return { ok: true as const, scriptId: Number(script.id), script };
  }

  const candidates = await scriptCandidatesWithStoryboardCounts(projectId, scripts);
  const withStoryboards = candidates.filter((item) => item.storyboardCount > 0);
  if (withStoryboards.length === 1) {
    const script = scripts.find((item: any) => Number(item.id) === withStoryboards[0]!.id);
    return { ok: true as const, scriptId: withStoryboards[0]!.id, script };
  }
  if (candidates.length === 1) {
    const script = scripts.find((item: any) => Number(item.id) === candidates[0]!.id);
    return { ok: true as const, scriptId: candidates[0]!.id, script };
  }
  return {
    ok: false as const,
    reason: candidates.length
      ? `当前项目有多个章节工作区，请指定章节或 scriptId：${candidates.map((item) => `${item.id}:${item.name}（分镜${item.storyboardCount}）`).join("；")}`
      : "当前项目还没有章节分镜工作区。请先基于小说章节生成分镜表。",
    candidates,
  };
}

function emitProductionDataUpdate(resTool: ResTool, payload: Record<string, unknown>) {
  resTool.socket.emit("productionDataUpdated", payload);
}

export async function runListProjectDirectorBoardsTool(config: ToolConfig, options?: { scriptId?: number; sourceText?: string; chapterIndexes?: number[] }) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在读取章节导演板列表...");
  const workspace = await resolveChapterWorkspace(config, options);
  if (!workspace.ok) {
    thinking.updateTitle("需要先确定章节工作区");
    thinking.appendText(JSON.stringify(workspace, null, 2));
    thinking.complete();
    const text = msg.text(workspace.reason);
    text.complete();
    msg.complete();
    return { handled: true, ...workspace, errorCode: "workspace_not_resolved" };
  }
  const boards = await listDirectorBoards(projectId, workspace.scriptId);
  thinking.appendText(JSON.stringify({ projectId, scriptId: workspace.scriptId, count: boards.length, boards }, null, 2));
  thinking.updateTitle("章节导演板列表读取完成");
  thinking.complete();
  const text = msg.text(`当前章节工作区有 ${boards.length} 张导演板。`);
  text.complete();
  msg.complete();
  return { handled: true, projectId, scriptId: workspace.scriptId, boards };
}

export async function runGenerateProjectDirectorBoardsTool(
  config: ToolConfig,
  options?: {
    scriptId?: number;
    sourceText?: string;
    chapterIndexes?: number[];
    storyboardIds?: number[];
    model?: string;
    imageSize?: AssetImageQuality;
    imageQuality?: AssetImageQuality;
    boardType?: DirectorBoardType;
    shotsPerBoard?: number;
    replace?: boolean;
    generateImages?: boolean;
    usePreviousBoardReference?: boolean;
  },
) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在生成章节导演板...");
  const workspace = await resolveChapterWorkspace(config, options);
  if (!workspace.ok) {
    thinking.updateTitle("需要先确定章节工作区");
    thinking.appendText(JSON.stringify(workspace, null, 2));
    thinking.complete();
    const text = msg.text(workspace.reason);
    text.complete();
    msg.complete();
    return { handled: true, ...workspace, errorCode: "workspace_not_resolved" };
  }

  const rows = await queueDirectorBoardGeneration(projectId, workspace.scriptId, {
    storyboardIds: options?.storyboardIds,
    model: nonEmpty(options?.model),
    imageSize: options?.imageSize ?? options?.imageQuality,
    boardType: options?.boardType,
    shotsPerBoard: options?.shotsPerBoard,
    replace: options?.replace,
    generateImages: options?.generateImages ?? true,
    usePreviousBoardReference: options?.usePreviousBoardReference,
  });
  emitProductionDataUpdate(resTool, {
    projectId,
    episodesId: workspace.scriptId,
    scriptId: workspace.scriptId,
    type: "director_boards",
    stage: options?.generateImages === false ? "director_boards_planned" : "director_boards_submitted",
    directorBoardIds: rows.map((row: any) => row.id),
  });
  thinking.appendText(
    JSON.stringify(
      {
        projectId,
        scriptId: workspace.scriptId,
        createdCount: rows.length,
        boardType: options?.boardType ?? "continuity",
        generateImages: options?.generateImages ?? true,
        model: options?.model ?? null,
        imageSize: options?.imageSize ?? options?.imageQuality ?? null,
        usePreviousBoardReference: options?.usePreviousBoardReference ?? false,
      },
      null,
      2,
    ),
  );
  thinking.updateTitle(options?.generateImages === false ? "章节导演板提示词已生成" : "章节导演板图片任务已提交");
  thinking.complete();
  const lines = [
    `已生成 ${rows.length} 张章节导演板记录。`,
    options?.generateImages === false ? "本次只生成导演板提示词，没有提交图片生成。" : "图片已进入后台生成队列，完成后会写回导演板列表。",
    `类型：${options?.boardType ?? "continuity"}；每板最多 ${options?.shotsPerBoard ?? 6} 个镜头；${options?.replace === false ? "保留旧导演板并追加" : "已替换旧导演板" }。`,
  ];
  const text = msg.text(lines.join("\n"));
  text.complete();
  msg.complete();
  return { handled: true, projectId, scriptId: workspace.scriptId, rows };
}

export async function runRegenerateProjectDirectorBoardTool(
  config: ToolConfig,
  options: {
    scriptId?: number;
    sourceText?: string;
    chapterIndexes?: number[];
    boardId: number;
    model?: string;
    imageSize?: AssetImageQuality;
    imageQuality?: AssetImageQuality;
    boardType?: DirectorBoardType;
    usePreviousBoardReference?: boolean;
  },
) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在重绘单张章节导演板...");
  const workspace = await resolveChapterWorkspace(config, options);
  if (!workspace.ok) {
    thinking.updateTitle("需要先确定章节工作区");
    thinking.appendText(JSON.stringify(workspace, null, 2));
    thinking.complete();
    const text = msg.text(workspace.reason);
    text.complete();
    msg.complete();
    return { handled: true, ...workspace, errorCode: "workspace_not_resolved" };
  }
  const row = await regenerateDirectorBoard(projectId, workspace.scriptId, options.boardId, {
    model: nonEmpty(options.model),
    imageSize: options.imageSize ?? options.imageQuality,
    boardType: options.boardType,
    usePreviousBoardReference: options.usePreviousBoardReference,
  });
  emitProductionDataUpdate(resTool, {
    projectId,
    episodesId: workspace.scriptId,
    scriptId: workspace.scriptId,
    type: "director_boards",
    stage: "director_board_regenerating",
    directorBoardIds: [options.boardId],
  });
  thinking.appendText(JSON.stringify({ projectId, scriptId: workspace.scriptId, boardId: options.boardId, row }, null, 2));
  thinking.updateTitle("单张章节导演板已提交重绘");
  thinking.complete();
  const text = msg.text(`已提交导演板 #${options.boardId} 的重绘任务。`);
  text.complete();
  msg.complete();
  return { handled: true, projectId, scriptId: workspace.scriptId, row };
}

function addUniqueVideoInfo(target: VideoPromptInfoItem[], item: VideoPromptInfoItem) {
  if (target.some((existing) => existing.id === item.id && existing.sources === item.sources)) return;
  target.push(item);
}

async function buildVideoReferenceInfo(
  projectId: number,
  scriptId: number,
  options?: { info?: VideoPromptInfoItem[]; directorBoardIds?: number[]; storyboardIds?: number[]; assetIds?: number[]; includeDirectorBoardAssets?: boolean },
) {
  const info: VideoPromptInfoItem[] = [];
  for (const item of options?.info ?? []) addUniqueVideoInfo(info, item);
  for (const id of options?.directorBoardIds ?? []) addUniqueVideoInfo(info, { id, sources: "directorBoard" });
  for (const id of options?.storyboardIds ?? []) addUniqueVideoInfo(info, { id, sources: "storyboard" });
  for (const id of options?.assetIds ?? []) addUniqueVideoInfo(info, { id, sources: "assets" });

  if (options?.includeDirectorBoardAssets !== false) {
    const directorBoardIds = info.filter((item) => item.sources === "directorBoard").map((item) => item.id);
    if (directorBoardIds.length) {
      const boards = await u.db("o_directorBoard").where({ projectId, scriptId }).whereIn("id", directorBoardIds).select("assetIds");
      for (const assetId of Array.from(new Set(boards.flatMap((board: any) => parseStoredNumberArray(board.assetIds))))) {
        addUniqueVideoInfo(info, { id: assetId, sources: "assets" });
      }
    }
  }

  const storyboards = info.filter((item) => item.sources === "storyboard").map((item) => item.id);
  if (storyboards.length) {
    const assetRows = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboards).select("assetId");
    for (const assetId of Array.from(new Set(assetRows.map((row: any) => Number(row.assetId)).filter((id) => Number.isFinite(id))))) {
      addUniqueVideoInfo(info, { id: assetId, sources: "assets" });
    }
  }

  return info;
}

async function ensureVideoTrack(projectId: number, scriptId: number, trackId?: number, duration?: number) {
  const normalizedTrackId = Number(trackId);
  if (Number.isInteger(normalizedTrackId) && normalizedTrackId > 0) {
    const existing = await u.db("o_videoTrack").where({ id: normalizedTrackId, projectId, scriptId }).first();
    if (existing?.id) {
      if (duration && duration > 0) await u.db("o_videoTrack").where({ id: normalizedTrackId, projectId }).update({ duration });
      return normalizedTrackId;
    }
  }
  let nextTrackId = Date.now();
  while (await u.db("o_videoTrack").where("id", nextTrackId).first()) nextTrackId += 1;
  await u.db("o_videoTrack").insert({
    id: nextTrackId,
    projectId,
    scriptId,
    duration,
    state: "未生成",
  });
  return nextTrackId;
}

function parseProjectMode(mode: unknown) {
  const raw = nonEmpty(mode);
  if (!raw) return "text";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : raw;
  } catch {
    return raw;
  }
}

async function getProjectVideoDefaults(projectId: number) {
  const project = await u.db("o_project").where("id", projectId).select("videoModel", "mode").first();
  return {
    model: nonEmpty(project?.videoModel),
    mode: parseProjectMode(project?.mode),
  };
}

export async function runGenerateVideoPromptFromReferencesTool(
  config: ToolConfig,
  options?: {
    scriptId?: number;
    sourceText?: string;
    chapterIndexes?: number[];
    trackId?: number;
    info?: VideoPromptInfoItem[];
    directorBoardIds?: number[];
    storyboardIds?: number[];
    assetIds?: number[];
    model?: string;
    duration?: number;
    includeDirectorBoardAssets?: boolean;
  },
) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在生成视频提示词...");
  const workspace = await resolveChapterWorkspace(config, options);
  if (!workspace.ok) {
    thinking.updateTitle("需要先确定章节工作区");
    thinking.appendText(JSON.stringify(workspace, null, 2));
    thinking.complete();
    const text = msg.text(workspace.reason);
    text.complete();
    msg.complete();
    return { handled: true, ...workspace, errorCode: "workspace_not_resolved" };
  }
  const defaults = await getProjectVideoDefaults(projectId);
  const model = nonEmpty(options?.model) ?? defaults.model;
  if (!model) {
    thinking.updateTitle("缺少视频模型");
    thinking.complete();
    const text = msg.text("当前项目未配置视频模型，也没有在本次工具调用中指定 model。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "missing_video_model" };
  }
  const info = await buildVideoReferenceInfo(projectId, workspace.scriptId, options);
  if (!info.length) {
    thinking.updateTitle("缺少视频参考");
    thinking.complete();
    const text = msg.text("没有可用于生成视频提示词的导演板、分镜图或资产参考。请先指定 directorBoardIds/storyboardIds/assetIds。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "missing_video_references" };
  }
  const trackId = await ensureVideoTrack(projectId, workspace.scriptId, options?.trackId, options?.duration);
  const result = await generateVideoPromptForTrack({
    projectId,
    trackId,
    info,
    model,
    duration: options?.duration,
  });
  emitProductionDataUpdate(resTool, {
    projectId,
    episodesId: workspace.scriptId,
    scriptId: workspace.scriptId,
    type: "video_prompt",
    stage: "video_prompt_generated",
    trackId,
  });
  thinking.appendText(JSON.stringify({ projectId, scriptId: workspace.scriptId, trackId, model, info, result }, null, 2));
  thinking.updateTitle("视频提示词已生成");
  thinking.complete();
  const text = msg.text(`已生成视频提示词并写入轨道 #${trackId}。\n参考项：${info.length} 个；目标时长：${result.targetDuration || options?.duration || "未指定"} 秒。`);
  text.complete();
  msg.complete();
  return { handled: true, projectId, scriptId: workspace.scriptId, trackId, info, result };
}

export async function runSubmitVideoGenerationFromReferencesTool(
  config: ToolConfig,
  options?: {
    scriptId?: number;
    sourceText?: string;
    chapterIndexes?: number[];
    trackId?: number;
    prompt?: string;
    info?: VideoPromptInfoItem[];
    directorBoardIds?: number[];
    storyboardIds?: number[];
    assetIds?: number[];
    model?: string;
    mode?: string | string[];
    resolution?: string;
    duration?: number;
    audio?: boolean;
    includeDirectorBoardAssets?: boolean;
  },
) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const thinking = msg.thinking("正在提交视频生成任务...");
  const workspace = await resolveChapterWorkspace(config, options);
  if (!workspace.ok) {
    thinking.updateTitle("需要先确定章节工作区");
    thinking.appendText(JSON.stringify(workspace, null, 2));
    thinking.complete();
    const text = msg.text(workspace.reason);
    text.complete();
    msg.complete();
    return { handled: true, ...workspace, errorCode: "workspace_not_resolved" };
  }
  const defaults = await getProjectVideoDefaults(projectId);
  const model = nonEmpty(options?.model) ?? defaults.model;
  if (!model) {
    thinking.updateTitle("缺少视频模型");
    thinking.complete();
    const text = msg.text("当前项目未配置视频模型，也没有在本次工具调用中指定 model。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "missing_video_model" };
  }
  const mode = options?.mode ?? defaults.mode;
  const resolution = nonEmpty(options?.resolution) ?? "480p";
  const duration = Number(options?.duration || 8);
  const info = await buildVideoReferenceInfo(projectId, workspace.scriptId, options);
  if (!info.length) {
    thinking.updateTitle("缺少视频参考");
    thinking.complete();
    const text = msg.text("没有可用于生成视频的导演板、分镜图或资产参考。请先指定 directorBoardIds/storyboardIds/assetIds。");
    text.complete();
    msg.complete();
    return { handled: true, reason: "missing_video_references" };
  }
  const trackId = await ensureVideoTrack(projectId, workspace.scriptId, options?.trackId, duration);
  const prompt =
    nonEmpty(options?.prompt) ??
    (
      await generateVideoPromptForTrack({
        projectId,
        trackId,
        info,
        model,
        duration,
      })
    ).prompt;
  const uploadData: VideoUploadItem[] = info.map((item) => ({
    id: item.id,
    sources: item.sources,
    fileType: "image",
    type: "imageReference",
  }));
  const result = await submitVideoGenerationTask({
    projectId,
    scriptId: workspace.scriptId,
    uploadData,
    prompt,
    model,
    mode,
    resolution,
    duration,
    audio: options?.audio,
    trackId,
  });
  emitProductionDataUpdate(resTool, {
    projectId,
    episodesId: workspace.scriptId,
    scriptId: workspace.scriptId,
    type: "video_generation",
    stage: "video_submitted",
    trackId,
    videoId: result.videoId,
  });
  thinking.appendText(JSON.stringify({ projectId, scriptId: workspace.scriptId, trackId, model, mode, resolution, duration, info, result }, null, 2));
  thinking.updateTitle("视频生成任务已提交");
  thinking.complete();
  const text = msg.text(`已提交视频生成任务：轨道 #${trackId}，视频 #${result.videoId}，参考图 ${result.referenceCount} 张，时长 ${result.effectiveDuration}s。`);
  text.complete();
  msg.complete();
  return { handled: true, projectId, scriptId: workspace.scriptId, trackId, videoId: result.videoId, info, result };
}

export default function useTools(config: ToolConfig) {
  const { resTool, toolsNames, msg } = config;
  const { socket } = resTool;

  const tools: Record<string, Tool> = {
    get_project_overview: tool({
      description: "获取当前项目的基础信息、小说章节数、资产数和章节分镜工作区数，适用于项目级总控判断下一步。",
      inputSchema: toToolJsonSchema<Record<string, never>>(z.object({})),
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
        const workspaces = scriptRows.map((script: any) => {
          const matchedNovel = novelContents.get(String(script.content ?? "").trim()) as any;
          return {
            id: script.id,
            name: toPublicWorkspaceName(script.name),
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
          workspaceCount: workspaces.length,
          workspaces,
          expectedEpisodeCountFromNovels: novelRows.length,
          note: `assetCount 只统计当前项目未删除/未挂父级 assetsId 的资产；workspaces 是内部章节分镜工作区，不是改编剧本。若小说章节数大于工作区记录数，应按小说章节规划集数：${novelRows.length}章≈${novelRows.length}集。`,
        };

        thinking.appendText(JSON.stringify(result, null, 2));
        thinking.updateTitle("项目概览获取完成");
        thinking.complete();
        return result;
      },
    }),
    list_project_scripts: tool({
      description: "兼容旧工具名：列出当前项目已有章节分镜工作区。返回的是内部工作区记录，不是改编剧本。",
      inputSchema: toToolJsonSchema<Record<string, never>>(z.object({})),
      execute: async () => {
        const thinking = msg.thinking("正在获取章节分镜工作区列表...");
        const scripts = await u.db("o_script").where("projectId", resTool.data.projectId).select("id", "name", "extractState", "errorReason", "createTime");
        const workspaces = scripts.map((script: any) => ({ ...script, name: toPublicWorkspaceName(script.name) }));
        thinking.appendText(JSON.stringify(workspaces, null, 2));
        thinking.updateTitle("章节分镜工作区列表获取完成");
        thinking.complete();
        return workspaces;
      },
    }),
    get_project_plan_data: tool({
      description: "获取前端工作区中的项目级计划数据。仅在需要读取工作区缓存内容时使用。",
      inputSchema: toToolJsonSchema<{ key: string }>(z.object({
        key: z.string().describe("工作区数据 key"),
      })),
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
    generate_project_storyboard_draft: tool({
      description: "按小说章节/事件分析生成章节分镜表并写回 Flova 工作台。用户要求做分镜、重推分镜、重新推理分镜时使用；force=true 会先覆盖旧分镜再重建。",
      inputSchema: toToolJsonSchema<{
        sourceText?: string;
        force?: boolean;
        append?: boolean;
        novelIds?: number[];
        chapterIndexes?: number[];
        skillId?: string;
        userRequirement?: string;
      }>(z.object({
        sourceText: z.string().optional().describe("用户原始要求；用于解析章节名、juben10 等范围"),
        force: z.boolean().optional().describe("是否覆盖旧分镜；用户说删除后重推、清空并重新推理、重新生成时必须为 true"),
        append: z.boolean().optional().describe("是否追加分镜；默认 false"),
        novelIds: z.array(z.number()).optional().describe("可选：只处理指定小说章节 ID"),
        chapterIndexes: z.array(z.number()).optional().describe("可选：只处理指定项目内章节序号"),
        skillId: z.string().optional().describe("可选：使用指定分镜 Skill"),
        userRequirement: z.string().optional().describe("用户额外分镜要求"),
      })),
      execute: async (options) => runProjectStoryboardDraftTool(config, options),
    }),
    clear_project_storyboards: tool({
      description: "清空当前项目或当前章节分镜工作区中的已有分镜。只在用户明确要求清空/删除分镜且不要求立刻重推时使用。",
      inputSchema: toToolJsonSchema<{ sourceText?: string; chapterIndexes?: number[] }>(z.object({
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/章节名/第 N 条"),
        chapterIndexes: z.array(z.number()).optional().describe("可选：只清空指定项目内章节序号"),
      })),
      execute: async ({ sourceText, chapterIndexes }) => runProjectStoryboardClearTool(config, {
        sourceText: [sourceText, chapterIndexes?.length ? `第${chapterIndexes.join("、")}章` : ""].filter(Boolean).join(" "),
      }),
    }),
    regenerate_project_storyboards: tool({
      description: "一键执行“删除/覆盖旧分镜并重新推理写回”。用户说“确认删除并重新推理”“清空并重推”“覆盖重做分镜”时优先使用这个工具。",
      inputSchema: toToolJsonSchema<{
        sourceText?: string;
        novelIds?: number[];
        chapterIndexes?: number[];
        skillId?: string;
        userRequirement?: string;
      }>(z.object({
        sourceText: z.string().optional().describe("用户原始要求；用于匹配章节名、juben10 等范围"),
        novelIds: z.array(z.number()).optional().describe("可选：只处理指定小说章节 ID"),
        chapterIndexes: z.array(z.number()).optional().describe("可选：只处理指定项目内章节序号"),
        skillId: z.string().optional().describe("可选：使用指定分镜 Skill"),
        userRequirement: z.string().optional().describe("用户额外分镜要求"),
      })),
      execute: async (options) => runProjectStoryboardDraftTool(config, { ...options, force: true }),
    }),
    list_project_director_boards: tool({
      description: "列出当前章节工作区的章节导演板/文字分镜导演板/融合导演板。用户询问导演板状态、失败原因、提示词或已有导演板时使用。",
      inputSchema: toToolJsonSchema<{ scriptId?: number; sourceText?: string; chapterIndexes?: number[] }>(z.object({
        scriptId: z.number().int().positive().optional().describe("可选：明确的章节工作区 ID"),
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/第N章"),
        chapterIndexes: z.array(z.number().int().positive()).optional().describe("可选：按项目内章节序号定位章节工作区"),
      })),
      execute: async (options) => runListProjectDirectorBoardsTool(config, options),
    }),
    generate_project_director_boards: tool({
      description:
        "基于已有分镜表生成章节导演板。用户说生成章节导演板、空间导演板、文字导演板、融合导演板、故事板图片时使用。默认会提交图片生成；如果用户只要提示词/草案，generateImages=false。可由总控决定模型、1K/2K/4K、类型、每板镜头数、是否带上一张导演板作连续性参考。",
      inputSchema: toToolJsonSchema<{
        scriptId?: number;
        sourceText?: string;
        chapterIndexes?: number[];
        storyboardIds?: number[];
        model?: string;
        imageSize?: AssetImageQuality;
        imageQuality?: AssetImageQuality;
        boardType?: DirectorBoardType;
        shotsPerBoard?: number;
        replace?: boolean;
        generateImages?: boolean;
        usePreviousBoardReference?: boolean;
      }>(z.object({
        scriptId: z.number().int().positive().optional().describe("可选：明确的章节工作区 ID"),
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/第N章"),
        chapterIndexes: z.array(z.number().int().positive()).optional().describe("可选：按项目内章节序号定位章节工作区"),
        storyboardIds: z.array(z.number().int().positive()).optional().describe("可选：只用指定分镜生成导演板"),
        model: z.string().optional().describe("可选：本次导演板出图模型；不填才使用项目默认图像模型"),
        imageSize: assetImageQualitySchema.optional().describe("可选：本次导演板图片大小 1K/2K/4K"),
        imageQuality: assetImageQualitySchema.optional().describe("兼容字段：本次导演板图片大小 1K/2K/4K"),
        boardType: directorBoardTypeSchema.optional().describe("continuity=空间连续性导演板；textStoryboard=文字分镜导演板；hybridStoryboard=融合导演板"),
        shotsPerBoard: z.number().int().min(1).max(8).optional().describe("每张导演板最多包含几个分镜；文字导演板常用 6"),
        replace: z.boolean().optional().describe("是否替换旧导演板；默认 true。用户要求追加时传 false"),
        generateImages: z.boolean().optional().describe("是否立即提交导演板图片生成；默认 true。用户只要提示词/草案时传 false"),
        usePreviousBoardReference: z.boolean().optional().describe("是否把上一张已完成导演板作为连续性参考；用户明确要求才传 true，不要自动开启"),
      })),
      execute: async (options) => runGenerateProjectDirectorBoardsTool(config, options),
    }),
    regenerate_project_director_board: tool({
      description: "重绘单张章节导演板。用户要求重绘某一张导演板/某个 boardId 时使用，不要重新生成整章。",
      inputSchema: toToolJsonSchema<{
        scriptId?: number;
        sourceText?: string;
        chapterIndexes?: number[];
        boardId: number;
        model?: string;
        imageSize?: AssetImageQuality;
        imageQuality?: AssetImageQuality;
        boardType?: DirectorBoardType;
        usePreviousBoardReference?: boolean;
      }>(z.object({
        scriptId: z.number().int().positive().optional().describe("可选：明确的章节工作区 ID"),
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/第N章"),
        chapterIndexes: z.array(z.number().int().positive()).optional().describe("可选：按项目内章节序号定位章节工作区"),
        boardId: z.number().int().positive().describe("要重绘的导演板 ID"),
        model: z.string().optional().describe("可选：本次重绘使用的图像模型"),
        imageSize: assetImageQualitySchema.optional().describe("可选：本次导演板图片大小 1K/2K/4K"),
        imageQuality: assetImageQualitySchema.optional().describe("兼容字段：本次导演板图片大小 1K/2K/4K"),
        boardType: directorBoardTypeSchema.optional().describe("可选：重绘时切换导演板类型"),
        usePreviousBoardReference: z.boolean().optional().describe("是否手动把上一张导演板作为连续性参考；用户明确要求才传 true"),
      })),
      execute: async (options) => runRegenerateProjectDirectorBoardTool(config, options),
    }),
    generate_video_prompt_from_references: tool({
      description:
        "按导演板/分镜/资产参考生成可发给视频模型的视频提示词，并写入视频轨道。用户要求“按这个导演板生成视频提示词”“批量生成视频提示词前的单条提示词”时使用。会自动把导演板覆盖的资产参考加入上下文。",
      inputSchema: toToolJsonSchema<{
        scriptId?: number;
        sourceText?: string;
        chapterIndexes?: number[];
        trackId?: number;
        info?: VideoPromptInfoItem[];
        directorBoardIds?: number[];
        storyboardIds?: number[];
        assetIds?: number[];
        model?: string;
        duration?: number;
        includeDirectorBoardAssets?: boolean;
      }>(z.object({
        scriptId: z.number().int().positive().optional().describe("可选：明确的章节工作区 ID"),
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/第N章"),
        chapterIndexes: z.array(z.number().int().positive()).optional().describe("可选：按项目内章节序号定位章节工作区"),
        trackId: z.number().int().positive().optional().describe("可选：写入已有视频轨道；不填则创建新轨道"),
        info: z.array(videoReferenceInfoSchema).optional().describe("可选：直接传参考项数组"),
        directorBoardIds: z.array(z.number().int().positive()).optional().describe("可选：要作为空间连续性参考的导演板 ID"),
        storyboardIds: z.array(z.number().int().positive()).optional().describe("可选：要作为分镜首帧/文字参考的分镜 ID"),
        assetIds: z.array(z.number().int().positive()).optional().describe("可选：要作为角色/场景/道具参考的资产 ID"),
        model: z.string().optional().describe("可选：本次视频目标模型；不填才使用项目默认视频模型"),
        duration: z.number().positive().optional().describe("可选：目标时长；如果使用导演板，系统会优先按导演板覆盖分镜时长"),
        includeDirectorBoardAssets: z.boolean().optional().describe("是否自动把导演板绑定的资产参考加入；默认 true"),
      })),
      execute: async (options) => runGenerateVideoPromptFromReferencesTool(config, options),
    }),
    submit_video_generation_from_references: tool({
      description:
        "按导演板/分镜/资产参考直接提交视频生成任务。用户明确要求生成视频时使用。若未传 prompt，会先生成视频提示词；会自动把导演板绑定资产作为参考图加入，避免用户手动一个个选择。",
      inputSchema: toToolJsonSchema<{
        scriptId?: number;
        sourceText?: string;
        chapterIndexes?: number[];
        trackId?: number;
        prompt?: string;
        info?: VideoPromptInfoItem[];
        directorBoardIds?: number[];
        storyboardIds?: number[];
        assetIds?: number[];
        model?: string;
        mode?: string | string[];
        resolution?: string;
        duration?: number;
        audio?: boolean;
        includeDirectorBoardAssets?: boolean;
      }>(z.object({
        scriptId: z.number().int().positive().optional().describe("可选：明确的章节工作区 ID"),
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/第N章"),
        chapterIndexes: z.array(z.number().int().positive()).optional().describe("可选：按项目内章节序号定位章节工作区"),
        trackId: z.number().int().positive().optional().describe("可选：使用已有视频轨道；不填则创建新轨道"),
        prompt: z.string().optional().describe("可选：用户已经确认的视频提示词；不填则先自动生成"),
        info: z.array(videoReferenceInfoSchema).optional().describe("可选：直接传参考项数组"),
        directorBoardIds: z.array(z.number().int().positive()).optional().describe("可选：要作为空间连续性参考的导演板 ID"),
        storyboardIds: z.array(z.number().int().positive()).optional().describe("可选：要作为分镜首帧/文字参考的分镜 ID"),
        assetIds: z.array(z.number().int().positive()).optional().describe("可选：要作为角色/场景/道具参考的资产 ID"),
        model: z.string().optional().describe("可选：本次视频生成模型；不填才使用项目默认视频模型"),
        mode: z.union([z.string(), z.array(z.string())]).optional().describe("可选：视频模型输入模式；不填使用项目默认 mode"),
        resolution: z.string().optional().describe("可选：视频分辨率，例如 480p/720p/1080p"),
        duration: z.number().positive().optional().describe("可选：目标时长；使用导演板时系统会优先按导演板覆盖分镜时长"),
        audio: z.boolean().optional().describe("是否开启视频模型音频"),
        includeDirectorBoardAssets: z.boolean().optional().describe("是否自动把导演板绑定的资产参考加入；默认 true"),
      })),
      execute: async (options) => runSubmitVideoGenerationFromReferencesTool(config, options),
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([name]) => toolsNames.includes(name))) : tools;
}

export function useNovelWorkflowTools(config: ToolConfig) {
  const { resTool, toolsNames, msg } = config;

  const tools: Record<string, Tool> = {
    get_project_novel_status: tool({
      description: "检查当前项目是否有上传小说，以及每章小说事件分析的原始状态和事件数量。",
      inputSchema: toToolJsonSchema<Record<string, never>>(z.object({})),
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
      inputSchema: toToolJsonSchema<Record<string, never>>(z.object({})),
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
      inputSchema: toToolJsonSchema<{ type?: AssetType }>(z.object({
        type: assetTypeSchema.optional().describe("可选：按资产类型过滤"),
      })),
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
        const assets = await attachLatestAssetImageFields(await query);

        thinking.appendText(JSON.stringify(assets, null, 2));
        thinking.updateTitle("项目资产列表获取完成");
        thinking.complete();
        return assets;
      },
    }),
    create_or_update_project_assets_from_json: tool({
      description: "将从小说中提取的角色、场景、道具等资产写入项目级资产库；按 projectId + name + type 去重，存在则只用非空字段更新。",
      inputSchema: toToolJsonSchema<{ assets: AssetInput[] }>(z.object({
        assets: z.array(assetInputSchema).describe("要创建或更新的项目级资产列表"),
      })),
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
      description: "直接提交当前项目资产库的角色/场景/道具参考图生成任务，后台异步生成，固定 16:9；用于用户明确要求资产出图、批量生图、生成参考图。必须严格遵守用户指定范围：例如“前4个场景图”必须传 assetType='scene' 且 limit=4；“只生成 Chloe”必须传 assetNames。用户指定 1K/2K/4K、低质量/标准质量/高质量时必须传 imageQuality；用户指定出图模型或预设时必须传 imageModel/skillId。",
      inputSchema: toToolJsonSchema<{
        includeCompleted?: boolean;
        assetType?: GeneratableAssetType;
        limit?: number;
        assetIds?: number[];
        assetNames?: string[];
        skillId?: string;
        imageModel?: string;
        concurrentCount?: number;
        generationMode?: AssetImageGenerationMode;
        referencePolicy?: AssetImageReferencePolicy;
        promptPolicy?: AssetImagePromptPolicy;
        useExistingAssetReference?: boolean;
        imageQuality?: AssetImageQuality;
      }>(z.object({
        includeCompleted: z.boolean().optional().describe("是否连已完成图片的资产也重新提交；默认 false，只补缺图/失败图"),
        assetType: generatableAssetTypeSchema.optional().describe("可选：只生成某类资产；用户说角色/场景/道具时必须填写"),
        limit: z.number().int().positive().max(100).optional().describe("可选：最多提交多少个资产；用户说前 N 个/生成 N 张时必须填写"),
        assetIds: z.array(z.number().int().positive()).optional().describe("可选：只生成指定资产 ID"),
        assetNames: z.array(z.string().min(1)).optional().describe("可选：只生成指定资产名称，例如 Chloe"),
        skillId: z.string().optional().describe("可选：本次使用的生图 skill/preset ID，例如四视图、俯视全景、脸部特写+三视图等"),
        imageModel: z.string().optional().describe("可选：本次资产出图模型；用户要求换模型时必须传，不填才用项目默认出图模型"),
        concurrentCount: z.number().int().min(1).max(4).optional().describe("可选：后台并发数，默认 1，最高 4"),
        generationMode: assetImageGenerationModeSchema.optional().describe("结构化生图模式。fresh_design=全新设计不沿用旧图；reference_redraw=参考当前图重绘；partial_edit=局部修改；variant=基于当前图生成变体；retry_failed=重试失败任务。总控必须先判断用户真实意图再填写。"),
        referencePolicy: assetImageReferencePolicySchema.optional().describe("参考图策略。none=绝不带当前资产图；current_asset=必须带当前资产图；auto=不自动带图，除非总控明确判断为 current_asset。用户说全新/新的/不参考原图时必须为 none。"),
        promptPolicy: assetImagePromptPolicySchema.optional().describe("提示词策略。asset_description_plus_request=用资产描述+用户本次要求，避免旧 prompt 污染；asset_prompt_plus_request=沿用资产 prompt 并追加要求；reuse_current_prompt=重试原提示词。"),
        useExistingAssetReference: z
          .boolean()
          .optional()
          .describe("是否把当前已完成资产图作为图生图参考；用户说全新、不参考原图、只按文字生成时必须为 false；用户说参考现有图/沿用原图时为 true"),
        imageQuality: assetImageQualitySchema.optional().describe("可选：本次资产出图质量/分辨率。用户明确说 1K、2K、4K 或低/中/高质量时必须判断后填写；未填写才使用项目默认图片质量。"),
      })),
      execute: async ({ includeCompleted, assetType, limit, assetIds, assetNames, skillId, imageModel, concurrentCount, generationMode, referencePolicy, promptPolicy, useExistingAssetReference, imageQuality }) => {
        return runProjectAssetImageGenerationTool(config, {
          includeCompleted,
          sourceText: config.sourceText,
          assetType,
          limit,
          assetIds,
          assetNames,
          skillId,
          imageModel,
          concurrentCount,
          generationMode,
          referencePolicy,
          promptPolicy,
          useExistingAssetReference,
          imageQuality,
          finalizeMessage: false,
        });
      },
    }),
    start_or_report_novel_event_analysis: tool({
      description: "按用户选择的小说章节报告或触发事件分析。可只分析指定章节；不要默认全章节分析。",
      inputSchema: toToolJsonSchema<{ novelIds?: number[]; chapterIndexes?: number[]; force?: boolean }>(z.object({
        novelIds: z.array(z.number()).optional().describe("需要分析的小说章节 ID；优先使用 get_project_novel_status 返回的 id"),
        chapterIndexes: z.array(z.number()).optional().describe("也可按章节序号选择，例如第1章、第3章"),
        force: z.boolean().optional().describe("已完成的章节是否也重新分析；默认 false，只分析未完成章节"),
      })),
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
