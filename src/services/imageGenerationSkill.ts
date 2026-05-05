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
const DEFAULT_SCENE_FOUR_PANEL_ID = "scene_four_panel_multi_angle";

const DEFAULT_SCENE_FOUR_PANEL_MD = `---
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
`;

function rootDir() {
  const dir = u.getPath(["skills", SKILL_DIR]);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ensureBuiltinSkills(dir);
  return dir;
}

function ensureBuiltinSkills(dir: string) {
  const filePath = path.join(dir, `${DEFAULT_SCENE_FOUR_PANEL_ID}.md`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, DEFAULT_SCENE_FOUR_PANEL_MD, "utf-8");
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
