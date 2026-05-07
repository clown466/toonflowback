import fs from "fs";
import path from "path";
import isPathInside from "is-path-inside";
import u from "@/utils";

export type ImageGenerationAssetType = "role" | "scene" | "tool";

export interface ImageGenerationSkill {
  id: string;
  name: string;
  description: string;
  targetTypes: ImageGenerationAssetType[];
  tags: string[];
  aspectRatio?: `${number}:${number}`;
  fileName: string;
  content: string;
}

export interface ImageGenerationPromptContext {
  project: {
    id: number;
    name?: string | null;
    intro?: string | null;
    type?: string | null;
    artStyle?: string | null;
    directorManual?: string | null;
  };
  asset: {
    id: number;
    type: ImageGenerationAssetType;
    name: string;
    describe?: string | null;
    prompt?: string | null;
  };
  visualManual: string;
  userRequirement?: string | null;
  timeEnvironmentContext?: string | null;
  neutralAssetLighting?: string | null;
}

const SKILL_DIR = "image_generation_skills";
const BUILTIN_IMAGE_GENERATION_SKILLS: Record<string, string> = {
  role_standard_four_view: `---
name: 角色标准四视图
description: 生成角色正面、侧面、背面、四分之三角度设定图
targetTypes: role
tags: 角色,四视图,设定图,标准图
aspectRatio: 16:9
---
你是角色资产设计师。

生成一张角色标准四视图设定图：
1. 正面
2. 侧面
3. 背面
4. 四分之三角度

保持同一个角色、同一服装、同一比例、同一材质。
使用中性展示光和干净背景，不绑定剧情时间、天气或场景光。
不要生成文字、水印、字幕、UI。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

角色：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}
`,
  role_single_reference: `---
name: 角色单张标准参考
description: 生成单个角色的清晰全身资产参考图
targetTypes: role
tags: 角色,单图,全身,参考图,标准图
aspectRatio: 1:1
---
你是角色资产设计师。

生成一张单角色全身资产参考图。
角色需要占画面主体，轮廓清楚，外观特征、服装、道具、材质清晰可见。
使用中性展示光和简洁背景，适合作为后续分镜、导演板和视频生成的角色参考图。
不要生成四视图，不要生成故事场景，不要生成文字、水印、字幕、UI。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

角色：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}
`,
  scene_top_down_panorama: `---
name: 场景俯视全景参考
description: 生成场景鸟瞰/俯视空间布局图，适合分镜调度和导演板参考
targetTypes: scene
tags: 场景,俯视,鸟瞰,全景,空间布局,地图,调度
aspectRatio: 16:9
---
你是场景资产设计师。

生成一张场景俯视全景参考图。
视角必须是 top-down / bird's-eye view / overhead map，像室内平面布局参考或鸟瞰地图。
严禁使用 eye-level view、normal perspective、cinematic establishing shot、front exterior view、street-level view。
重点展示完整空间布局、入口、主要家具、关键道具、可行动区域、摄像机友好空间和灯光方向。
这是后续分镜、导演板和视频生成的权威场景参考图。
不要出现角色、人物、对白、字幕、UI、水印。
除非用户明确要求，尽量不要在画面内写文字标签。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

场景：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

时间/环境约束：
{{timeEnvironmentContext}}

用户额外要求：
{{userRequirement}}
`,
  scene_four_panel_multi_angle: `---
name: 场景四宫格多景别
description: 生成同一场景的4景别、多角度四宫格设定图
targetTypes: scene
tags: 场景,四宫格,4景别,四景别,多角度,景别
aspectRatio: 16:9
---
你是场景资产设计师。

必须生成一张四宫格场景设定图：
1. 左上：远景，展示整体空间布局
2. 右上：中景，展示主要活动区域
3. 左下：近景，展示材质、道具、氛围细节
4. 右下：俯视或反向角度，展示空间关系

必须保持同一场景、同一时间、同一美术风格。
不得生成文字、水印、UI、字幕。

视觉手册：
{{visualManual}}

项目风格：
{{project.artStyle}}

场景名称：
{{asset.name}}

场景描述：
{{asset.describe}}

资产提示词：
{{asset.prompt}}

用户额外要求：
{{userRequirement}}
`,
  scene_cinematic_establishing: `---
name: 场景电影全景参考
description: 生成单张电影化场景全景图，强调氛围、空间和关键道具
targetTypes: scene
tags: 场景,全景,氛围,电影感,参考图
aspectRatio: 16:9
---
你是场景资产设计师。

生成一张单场景电影化全景参考图。
重点展示场景整体氛围、空间深度、建筑结构、关键道具、主光方向和色彩关系。
不要出现角色、人物、对白、字幕、UI、水印。
画面需要适合作为后续分镜、导演板和视频生成的场景参考。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

场景：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

时间/环境约束：
{{timeEnvironmentContext}}

用户额外要求：
{{userRequirement}}
`,
  tool_standard_reference: `---
name: 道具标准参考图
description: 生成单个道具的清晰资产参考图
targetTypes: tool
tags: 道具,单图,标准图,参考图
aspectRatio: 1:1
---
你是道具资产设计师。

生成一张单道具标准资产参考图。
道具需要占画面主体，轮廓、材质、颜色、磨损、结构和可识别细节清楚。
使用中性展示光和简洁背景，不绑定剧情时间、天气或场景光。
不要生成角色、人物、文字、水印、字幕、UI。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

道具：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}
`,
  tool_multi_angle_reference: `---
name: 道具多角度参考
description: 生成同一道具的正面、侧面、背面和细节多角度设定图
targetTypes: tool
tags: 道具,多角度,四视图,细节,设定图
aspectRatio: 16:9
---
你是道具资产设计师。

生成一张同一道具的多角度设定图：
1. 正面
2. 侧面
3. 背面
4. 关键细节特写

保持同一个道具、同一材质、同一颜色和同一结构。
使用中性展示光和干净背景，适合作为后续分镜、导演板和视频生成的道具参考。
不要生成角色、人物、文字、水印、字幕、UI。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

道具：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}
`,
};

function rootDir() {
  const dir = u.getPath(["skills", SKILL_DIR]);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ensureBuiltinSkills(dir);
  return dir;
}

function ensureBuiltinSkills(dir: string) {
  for (const [id, content] of Object.entries(BUILTIN_IMAGE_GENERATION_SKILLS)) {
    const filePath = path.join(dir, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    } else {
      patchBuiltinSkillIfNeeded(id, filePath);
    }
  }
}

function patchBuiltinSkillIfNeeded(id: string, filePath: string) {
  if (id !== "scene_top_down_panorama") return;
  const content = fs.readFileSync(filePath, "utf-8");
  if (content.includes("严禁使用 eye-level view")) return;
  const next = content.replace(
    "视角：top-down / bird's-eye view / overhead map。",
    [
      "视角必须是 top-down / bird's-eye view / overhead map，像室内平面布局参考或鸟瞰地图。",
      "严禁使用 eye-level view、normal perspective、cinematic establishing shot、front exterior view、street-level view。",
    ].join("\n"),
  );
  if (next !== content) fs.writeFileSync(filePath, next, "utf-8");
}

function normalizeId(value: string) {
  return value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function assertSafeSkillId(id: string) {
  const normalized = normalizeId(id);
  if (!normalized) throw new Error("skillId 不能为空");
  return normalized;
}

function skillPath(id: string) {
  const root = rootDir();
  const safeId = assertSafeSkillId(id);
  const filePath = path.join(root, `${safeId}.md`);
  if (!isPathInside(filePath, root)) throw new Error("无效的 skill 路径");
  return filePath;
}

function splitFrontMatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { attrs: {} as Record<string, string>, body: content };
  const attrs: Record<string, string> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    attrs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { attrs, body: content.slice(match[0].length) };
}

function parseListValue(value?: string) {
  if (!value) return [];
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[,，、]/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseTargetTypes(value?: string): ImageGenerationAssetType[] {
  const valid = new Set<ImageGenerationAssetType>(["role", "scene", "tool"]);
  const parsed = parseListValue(value).filter((item): item is ImageGenerationAssetType => valid.has(item as ImageGenerationAssetType));
  return parsed.length ? Array.from(new Set(parsed)) : ["role", "scene", "tool"];
}

function parseAspectRatio(value?: string): `${number}:${number}` | undefined {
  const text = value?.trim();
  return text && /^\d+:\d+$/.test(text) ? (text as `${number}:${number}`) : undefined;
}

function metadataFromContent(id: string, fileName: string, content: string): ImageGenerationSkill {
  const { attrs } = splitFrontMatter(content);
  return {
    id,
    name: attrs.name || id,
    description: attrs.description || "",
    targetTypes: parseTargetTypes(attrs.targetTypes),
    tags: parseListValue(attrs.tags),
    aspectRatio: parseAspectRatio(attrs.aspectRatio),
    fileName,
    content,
  };
}

export async function listImageGenerationSkills() {
  const root = rootDir();
  const files = (await fs.promises.readdir(root)).filter((file) => file.endsWith(".md")).sort((a, b) => a.localeCompare(b));
  return Promise.all(
    files.map(async (fileName) => {
      const id = normalizeId(fileName);
      const content = await fs.promises.readFile(path.join(root, fileName), "utf-8");
      const skill = metadataFromContent(id, fileName, content);
      const { content: _, ...meta } = skill;
      return meta;
    }),
  );
}

export async function getImageGenerationSkill(id: string): Promise<ImageGenerationSkill> {
  const safeId = assertSafeSkillId(id);
  const fileName = `${safeId}.md`;
  const content = await fs.promises.readFile(skillPath(safeId), "utf-8");
  return metadataFromContent(safeId, fileName, content);
}

export async function saveImageGenerationSkill(input: { id?: string; content: string }) {
  const { attrs } = splitFrontMatter(input.content);
  const idSource = input.id || attrs.id || attrs.name || `custom_skill_${Date.now()}`;
  const id = assertSafeSkillId(idSource);
  await fs.promises.writeFile(skillPath(id), input.content, "utf-8");
  return getImageGenerationSkill(id);
}

export async function deleteImageGenerationSkill(id: string) {
  await fs.promises.rm(skillPath(id), { force: true });
}

function readPath(source: any, key: string) {
  return key.split(".").reduce((value, part) => (value == null ? "" : value[part]), source) ?? "";
}

export function renderImageGenerationSkillPrompt(skill: ImageGenerationSkill, context: ImageGenerationPromptContext) {
  const { body } = splitFrontMatter(skill.content);
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => String(readPath(context, key)));
}

export function getVisualManualForAssetType(artStyle: string | null | undefined, type: ImageGenerationAssetType, isDerivative = false) {
  const manualMap: Record<ImageGenerationAssetType, string> = {
    role: isDerivative ? "art_character_derivative" : "art_character",
    scene: isDerivative ? "art_scene_derivative" : "art_scene",
    tool: isDerivative ? "art_prop_derivative" : "art_prop",
  };
  return artStyle ? u.getArtPrompt(artStyle, "art_skills", manualMap[type]) : "";
}

function scoreSkill(skill: Omit<ImageGenerationSkill, "content">, text: string, type: ImageGenerationAssetType) {
  if (!skill.targetTypes.includes(type)) return -1;
  const normalized = text.toLowerCase();
  let score = 0;
  if (normalized.includes(skill.id.toLowerCase())) score += 8;
  if (skill.name && normalized.includes(skill.name.toLowerCase())) score += 8;
  for (const tag of skill.tags) {
    if (tag && normalized.includes(tag.toLowerCase())) score += 4;
  }
  if (skill.description && normalized.includes(skill.description.toLowerCase())) score += 2;
  return score;
}

export async function resolveImageGenerationSkill(options: {
  skillId?: string | null;
  requestText?: string | null;
  assetType: ImageGenerationAssetType;
}) {
  if (options.skillId) {
    const skill = await getImageGenerationSkill(options.skillId);
    return skill.targetTypes.includes(options.assetType) ? skill : null;
  }

  const requestText = options.requestText?.trim();
  if (!requestText) return null;
  const skills = await listImageGenerationSkills();
  const ranked = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, requestText, options.assetType) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0] ? getImageGenerationSkill(ranked[0].skill.id) : null;
}
