import fs from "fs";
import path from "path";
import isPathInside from "is-path-inside";
import getPath from "@/utils/getPath";

export interface StoryboardGenerationSkill {
  id: string;
  name: string;
  description: string;
  target: string[];
  tags: string[];
  output?: string;
  defaultShotsPerBeat?: number;
  source: "builtin" | "user";
  path: string;
  fileName: string;
  editable: boolean;
  content: string;
}

export interface StoryboardGenerationPromptContext {
  [key: string]: unknown;
}

const USER_SKILL_DIR = "storyboard_generation_skills";
const ABSOLUTE_SKILLS_ROOT = "/root/toonflow-data/skills";

function skillsRoot() {
  return fs.existsSync(ABSOLUTE_SKILLS_ROOT) ? ABSOLUTE_SKILLS_ROOT : getPath(["skills"]);
}

function userRoot() {
  const dir = path.join(skillsRoot(), USER_SKILL_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeId(value: string) {
  return value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function assertSafeSkillId(id: string) {
  const normalized = normalizeId(id);
  if (!normalized) throw new Error("skillId 不能为空");
  return normalized;
}

function userSkillPath(id: string) {
  const root = userRoot();
  const safeId = assertSafeSkillId(id);
  const filePath = path.join(root, `${safeId}.md`);
  if (!isPathInside(filePath, root)) throw new Error("无效的 skill 路径");
  return filePath;
}

function splitFrontMatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { attrs: {} as Record<string, string>, body: content };
  const attrs: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (/^[>|][+-]?$/.test(value)) {
      const blockLines: string[] = [];
      for (i += 1; i < lines.length; i += 1) {
        const next = lines[i];
        if (next.trim() && !/^\s/.test(next) && next.includes(":")) {
          i -= 1;
          break;
        }
        blockLines.push(next.replace(/^\s{2}/, ""));
      }
      attrs[key] = value.startsWith("|")
        ? blockLines.join("\n").trim()
        : blockLines.map((item) => item.trim()).filter(Boolean).join(" ").trim();
      continue;
    }

    attrs[key] = value;
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

function parseTarget(value?: string) {
  const parsed = parseListValue(value);
  return parsed.length ? Array.from(new Set(parsed)) : ["storyboard"];
}

function parseNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function relativeSkillPath(filePath: string) {
  return path.relative(skillsRoot(), filePath).split(path.sep).join("/");
}

function idFromRelativePath(relativePath: string) {
  return normalizeId(relativePath.replace(/\.md$/i, "").replace(/[\\/]+/g, "__"));
}

function metadataFromContent(filePath: string, content: string, source: "builtin" | "user"): StoryboardGenerationSkill {
  const fileName = path.basename(filePath);
  const relativePath = relativeSkillPath(filePath);
  const { attrs } = splitFrontMatter(content);
  const id = source === "user" ? normalizeId(attrs.id || fileName) : normalizeId(attrs.id || idFromRelativePath(relativePath));
  return {
    id,
    name: attrs.name || id,
    description: attrs.description || "",
    target: parseTarget(attrs.target),
    tags: parseListValue(attrs.tags),
    output: attrs.output || undefined,
    defaultShotsPerBeat: parseNumber(attrs.defaultShotsPerBeat),
    source,
    path: relativePath,
    fileName,
    editable: source === "user",
    content,
  };
}

async function pathExists(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir: string, predicate: (filePath: string) => boolean) {
  if (!(await pathExists(dir))) return [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(filePath, predicate)));
    else if (entry.isFile() && predicate(filePath)) files.push(filePath);
  }
  return files;
}

async function builtinSkillFiles() {
  const root = skillsRoot();
  const groups = await Promise.all([
    collectFiles(path.join(root, "production_skills"), (filePath) => /^storyboard_(?:generation_method|table_techniques)\.md$/i.test(path.basename(filePath))),
    collectFiles(path.join(root, "story_skills"), (filePath) => {
      const relativePath = relativeSkillPath(filePath);
      return /\/driector_skills\/director_storyboard_table_narrative\.md$/i.test(relativePath);
    }),
  ]);
  return Array.from(new Set(groups.flat())).sort((a, b) => {
    const left = relativeSkillPath(a);
    const right = relativeSkillPath(b);
    const priority = (value: string) => {
      if (value === "production_skills/storyboard_generation_method.md") return 0;
      if (value === "production_skills/storyboard_table_techniques.md") return 1;
      return 2;
    };
    return priority(left) - priority(right) || left.localeCompare(right);
  });
}

async function userSkillFiles() {
  return collectFiles(userRoot(), (filePath) => path.dirname(filePath) === userRoot() && /\.md$/i.test(path.basename(filePath)));
}

async function readSkill(filePath: string, source: "builtin" | "user") {
  const content = await fs.promises.readFile(filePath, "utf-8");
  return metadataFromContent(filePath, content, source);
}

export async function listStoryboardGenerationSkills() {
  const [builtinFiles, customFiles] = await Promise.all([builtinSkillFiles(), userSkillFiles()]);
  const skills = await Promise.all([
    ...builtinFiles.map((filePath) => readSkill(filePath, "builtin")),
    ...customFiles.map((filePath) => readSkill(filePath, "user")),
  ]);
  const seen = new Set<string>();
  return skills
    .filter((skill) => {
      const key = `${skill.source}:${skill.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ content: _, ...meta }) => meta);
}

export async function getStoryboardGenerationSkill(id: string): Promise<StoryboardGenerationSkill> {
  const safeId = assertSafeSkillId(id);
  const userPath = userSkillPath(safeId);
  if (await pathExists(userPath)) return readSkill(userPath, "user");

  const builtinFiles = await builtinSkillFiles();
  for (const filePath of builtinFiles) {
    const skill = await readSkill(filePath, "builtin");
    if (skill.id === safeId) return skill;
  }
  throw new Error("skill 不存在");
}

export async function saveStoryboardGenerationSkill(input: { id?: string; content: string }) {
  const { attrs } = splitFrontMatter(input.content);
  const idSource = input.id || attrs.id || attrs.name || `custom_storyboard_skill_${Date.now()}`;
  const id = assertSafeSkillId(idSource);
  await fs.promises.writeFile(userSkillPath(id), input.content, "utf-8");
  return getStoryboardGenerationSkill(id);
}

export async function deleteStoryboardGenerationSkill(id: string) {
  const filePath = userSkillPath(id);
  if (!(await pathExists(filePath))) throw new Error("仅支持删除用户分镜 skill");
  await fs.promises.rm(filePath, { force: true });
}

function readPath(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value == null || typeof value !== "object") return "";
    return (value as Record<string, unknown>)[part];
  }, source);
}

export function renderStoryboardGenerationSkillPrompt(skill: StoryboardGenerationSkill, context: StoryboardGenerationPromptContext) {
  const { body } = splitFrontMatter(skill.content);
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => String(readPath(context, key) ?? ""));
}

function scoreSkill(skill: Omit<StoryboardGenerationSkill, "content">, text: string, target?: string | null) {
  if (target && skill.target.length && !skill.target.includes(target)) return -1;
  const normalized = text.toLowerCase();
  let score = 0;
  if (normalized.includes(skill.id.toLowerCase())) score += 8;
  if (skill.name && normalized.includes(skill.name.toLowerCase())) score += 8;
  for (const tag of skill.tags) {
    if (tag && normalized.includes(tag.toLowerCase())) score += 4;
  }
  if (skill.description && normalized.includes(skill.description.toLowerCase())) score += 2;
  if (skill.output && normalized.includes(skill.output.toLowerCase())) score += 2;
  return score;
}

export async function resolveStoryboardGenerationSkill(options: {
  skillId?: string | null;
  requestText?: string | null;
  target?: string | null;
}) {
  if (options.skillId) {
    const skill = await getStoryboardGenerationSkill(options.skillId);
    return options.target && skill.target.length && !skill.target.includes(options.target) ? null : skill;
  }

  const requestText = options.requestText?.trim();
  if (!requestText) return null;
  const skills = await listStoryboardGenerationSkills();
  const ranked = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, requestText, options.target) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0] ? getStoryboardGenerationSkill(ranked[0].skill.id) : null;
}
