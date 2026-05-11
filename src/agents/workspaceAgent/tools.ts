import { tool, Tool } from "ai";
import { z } from "zod";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { submitAssetImageGeneration } from "@/services/assetImageGeneration";
import { clearProjectStoryboards, toPublicWorkspaceName } from "@/services/storyboardDraftGeneration";
import { generateProjectStoryboardWithSkill } from "@/services/storyboardSkillGeneration";
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

export interface ProjectAssetImageGenerationOptions {
  includeCompleted?: boolean;
  sourceText?: string;
  userRequirement?: string;
  skillId?: string;
  finalizeMessage?: boolean;
  assetType?: GeneratableAssetType;
  limit?: number;
  assetIds?: number[];
  assetNames?: string[];
  disableNaturalLanguageScopeParsing?: boolean;
  useExistingAssetReference?: boolean;
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

export async function runNovelAssetExtractionFastPath(config: ToolConfig, options: NovelAssetExtractionOptions = {}) {
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

function shouldIncludeCompletedAssets(text: string) {
  return /全部|所有|全量|重新|重绘|重出|覆盖|替换|修改|改成|改为|全新|重新设计|从零设计|新形象|新造型|已完成.*也|包括.*已完成/i.test(text);
}

function shouldUseExistingAssetImageReference(text: string) {
  return /参考.*(现有|当前|原有|已有)|基于.*(现有|当前|原有|已有)|保持.*(原图|当前图|现有图)|沿用.*(原图|当前图|现有图)|修改|改成|改为|重绘|替换/i.test(text);
}

function shouldAvoidExistingAssetImageReference(text: string) {
  return (
    /(不|不要|别|无需|禁止|完全不).{0,10}(参考|使用|沿用|继承|带入).{0,10}(原图|旧图|当前图|现有图|已有图|参考图|图片)/i.test(text) ||
    /(原图|旧图|当前图|现有图|已有图|参考图|图片).{0,10}(不|不要|别|无需|禁止|完全不).{0,10}(参考|使用|沿用|继承|带入)/i.test(text) ||
    /(全新|重新设计|从零设计|新形象|新造型|只按文字|纯文本).{0,64}(生成|出图|生图|设计|重绘|角色图|资产图|参考图|图片|图像|形象)/i.test(text) ||
    /(角色图|资产图|参考图|图片|图像|形象).{0,64}(全新|重新设计|从零设计|新形象|新造型|只按文字|纯文本)/i.test(text)
  );
}

function shouldUseFreshAssetText(text: string) {
  return (
    /(全新|重新设计|从零设计|新形象|新造型).{0,64}(生成|出图|生图|设计|重绘|角色图|资产图|参考图|图片|图像|形象)/i.test(text) ||
    /(角色图|资产图|参考图|图片|图像|形象).{0,64}(全新|重新设计|从零设计|新形象|新造型)/i.test(text)
  );
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

export async function runProjectAssetImageGenerationFastPath(config: ToolConfig, options?: ProjectAssetImageGenerationOptions) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  const requestText = options?.userRequirement ?? options?.sourceText ?? config.sourceText ?? "";
  const includeCompleted = shouldIncludeCompletedAssets(requestText) ? true : options?.includeCompleted ?? (options?.disableNaturalLanguageScopeParsing ? false : shouldIncludeCompletedAssets(requestText));
  const finalizeMessage = options?.finalizeMessage ?? true;
  const parsedScope = options?.disableNaturalLanguageScopeParsing ? {} : parseAssetImageRequestScope(requestText);
  const assetType = options?.assetType ?? parsedScope.assetType;
  const limit = normalizePositiveLimit(options?.limit) ?? parsedScope.limit;
  const assetIds = Array.from(new Set((options?.assetIds ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
  const assetNames = Array.from(new Set((options?.assetNames ?? []).map((name) => nonEmpty(name)).filter((name): name is string => Boolean(name))));
  const assetNameSet = new Set(assetNames.map(normalizeAssetName));
  const scopeText = formatAssetImageScope({ assetType, limit, assetIds, assetNames });
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

  const scopedAssets = assets.filter((asset: any) => {
    if (assetType && asset.type !== assetType) return false;
    if (assetIds.length && !assetIds.includes(Number(asset.id))) return false;
    if (assetNameSet.size && !assetNameSet.has(normalizeAssetName(asset.name))) return false;
    return true;
  });
  const selectedAssets = limit ? scopedAssets.slice(0, limit) : scopedAssets;
  const skippedCompleted = selectedAssets.filter((asset: any) => asset.imageState === "已完成");
  const skippedGenerating = selectedAssets.filter((asset: any) => asset.imageState === "生成中");
  const targetAssets = selectedAssets.filter((asset: any) => {
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
  const avoidExistingAssetReference = shouldAvoidExistingAssetImageReference(sourceText);
  const freshAssetText = shouldUseFreshAssetText(sourceText);
  const effectiveUserRequirement = freshAssetText ? buildFreshAssetUserRequirement(sourceText) : options?.userRequirement ?? options?.sourceText ?? config.sourceText ?? null;
  const useExistingAssetReference =
    avoidExistingAssetReference ? false : options?.useExistingAssetReference ?? (includeCompleted || shouldUseExistingAssetImageReference(sourceText));
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
        userRequirement: effectiveUserRequirement,
      };
    }),
  );

  const result = await submitAssetImageGeneration({
    projectId,
    model: project.imageModel,
    resolution: project.imageQuality,
    concurrentCount: 1,
    onStatusChange: (event) => {
      emitProjectAssetImageUpdate(resTool, {
        projectId,
        stage: "progress",
        records: [event],
      });
    },
    items: generationItems,
    skillId: options?.skillId ?? null,
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
        imageModel: project.imageModel,
        imageQuality: project.imageQuality,
        aspectRatio: "16:9",
        includeCompleted,
        scope: scopeText || null,
        scopedAssets: scopedAssets.length,
        selectedAssets: selectedAssets.length,
        submitted: result.submitted,
        skippedBySubmitGuard: result.skippedGenerating,
        skippedCompleted: includeCompleted ? 0 : skippedCompleted.length,
        skippedGenerating: skippedGenerating.length,
        skippedNoPrompt: skippedNoPrompt.length,
        freshAssetText,
        useExistingAssetReference,
        referencedExistingImages: generationItems.filter((item) => item.base64).length,
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
    `模型：${project.imageModel}，质量：${project.imageQuality}，后台并发：1。`,
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

export async function runProjectStoryboardDraftFastPath(
  config: ToolConfig,
  options?: { sourceText?: string; force?: boolean; append?: boolean; novelIds?: number[]; chapterIndexes?: number[]; skillId?: string; userRequirement?: string },
) {
  const { resTool, msg } = config;
  const projectId = Number(resTool.data.projectId);
  msg.updateStatus("streaming");
  const thinking = msg.thinking("正在生成生产分镜草案...");
  thinking.updateTitle("正在调用分镜模型生成结构化分镜...");

  const result = await generateProjectStoryboardWithSkill(projectId, {
    sourceText: options?.sourceText,
    userRequirement: options?.userRequirement,
    skillId: options?.skillId,
    preferredScriptId: typeof resTool.data.scriptId === "number" ? resTool.data.scriptId : undefined,
    force: options?.force,
    append: options?.append,
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

export async function runProjectStoryboardClearFastPath(config: ToolConfig, options?: { sourceText?: string }) {
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
      execute: async (options) => runProjectStoryboardDraftFastPath(config, options),
    }),
    clear_project_storyboards: tool({
      description: "清空当前项目或当前章节分镜工作区中的已有分镜。只在用户明确要求清空/删除分镜且不要求立刻重推时使用。",
      inputSchema: toToolJsonSchema<{ sourceText?: string; chapterIndexes?: number[] }>(z.object({
        sourceText: z.string().optional().describe("用户原始要求；用于匹配 juben10/章节名/第 N 条"),
        chapterIndexes: z.array(z.number()).optional().describe("可选：只清空指定项目内章节序号"),
      })),
      execute: async ({ sourceText, chapterIndexes }) => runProjectStoryboardClearFastPath(config, {
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
      execute: async (options) => runProjectStoryboardDraftFastPath(config, { ...options, force: true }),
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
        const assets = await query;

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
      description: "直接提交当前项目资产库的角色/场景/道具参考图生成任务，后台异步生成，固定 16:9；用于用户明确要求资产出图、批量生图、生成参考图。必须严格遵守用户指定范围：例如“前4个场景图”必须传 assetType='scene' 且 limit=4；“只生成 Chloe”必须传 assetNames。",
      inputSchema: toToolJsonSchema<{
        includeCompleted?: boolean;
        assetType?: GeneratableAssetType;
        limit?: number;
        assetIds?: number[];
        assetNames?: string[];
        useExistingAssetReference?: boolean;
      }>(z.object({
        includeCompleted: z.boolean().optional().describe("是否连已完成图片的资产也重新提交；默认 false，只补缺图/失败图"),
        assetType: generatableAssetTypeSchema.optional().describe("可选：只生成某类资产；用户说角色/场景/道具时必须填写"),
        limit: z.number().int().positive().max(100).optional().describe("可选：最多提交多少个资产；用户说前 N 个/生成 N 张时必须填写"),
        assetIds: z.array(z.number().int().positive()).optional().describe("可选：只生成指定资产 ID"),
        assetNames: z.array(z.string().min(1)).optional().describe("可选：只生成指定资产名称，例如 Chloe"),
        useExistingAssetReference: z
          .boolean()
          .optional()
          .describe("是否把当前已完成资产图作为图生图参考；用户说全新、不参考原图、只按文字生成时必须为 false；用户说参考现有图/沿用原图时为 true"),
      })),
      execute: async ({ includeCompleted, assetType, limit, assetIds, assetNames, useExistingAssetReference }) => {
        return runProjectAssetImageGenerationFastPath(config, {
          includeCompleted,
          sourceText: config.sourceText,
          assetType,
          limit,
          assetIds,
          assetNames,
          useExistingAssetReference,
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
