import fs from "fs";
import path from "path";
import u from "@/utils";
import { parseFrontmatter, scanSkills } from "@/utils/agent/skillsTools";
import { listImageGenerationSkills } from "@/services/imageGenerationSkill";

export const WORKSPACE_DOMAIN_AGENT_IDS = ["asset", "production", "asset_reference_planner"] as const;
export type WorkspaceDomainAgentId = (typeof WORKSPACE_DOMAIN_AGENT_IDS)[number];

export interface WorkspaceDomainAgentCatalogItem {
  id: WorkspaceDomainAgentId;
  name: string;
  role: string;
  delegateWhen: string[];
  doNotUseWhen: string[];
  childAgents: string[];
  canWriteData: boolean;
  riskLevel: "read" | "plan" | "write" | "cost";
}

export interface WorkspaceSkillCatalogItem {
  id: string;
  name: string;
  description: string;
  source: "image_generation" | "production" | "art_director" | "story_director";
  targetTypes?: string[];
  aspectRatio?: string;
  path?: string;
}

export function getWorkspaceDomainAgentCatalog(): WorkspaceDomainAgentCatalogItem[] {
  return [
    {
      id: "asset",
      name: "资产总控",
      role: "负责小说资产提取、资产库维护、角色/场景/道具参考图生成，并根据用户意图决定是否带当前资产图参考。",
      delegateWhen: ["用户要求提取资产、塑角造景、生成角色图/场景图/道具图、重绘或重新设计资产参考图。"],
      doNotUseWhen: ["用户要求分镜表、导演板、分镜图或视频生产时，应交给生产总控。"],
      childAgents: ["assetExtractor", "assetImagePlanner", "imageGenerationSkills"],
      canWriteData: true,
      riskLevel: "cost",
    },
    {
      id: "production",
      name: "生产总控",
      role: "负责小说章节到分镜表、分镜图、视频制作准备的生产流程，并使用项目资产库保持视觉一致。",
      delegateWhen: ["用户要求分镜、导演规划、分镜表、分镜图、视频制作准备、衍生资产或制作流程。"],
      doNotUseWhen: ["项目还没有小说和资产且用户只是询问状态。", "用户只要求上传、编辑或查看普通项目资料。"],
      childAgents: ["deriveAssetsAgent", "generateAssetsAgent", "directorPlanAgent", "storyboardGenAgent", "storyboardPanelAgent", "storyboardTableAgent", "supervisionAgent"],
      canWriteData: true,
      riskLevel: "cost",
    },
    {
      id: "asset_reference_planner",
      name: "资产参考图规划",
      role: "基于项目资产库规划角色四视图、场景参考图和道具参考图的下一步范围。",
      delegateWhen: ["用户想知道哪些资产需要先出参考图，或需要一份资产生图范围计划。"],
      doNotUseWhen: ["用户已经明确要求直接提交批量生图任务，此时使用资产批量出图工具。"],
      childAgents: [],
      canWriteData: false,
      riskLevel: "plan",
    },
  ];
}

function toUnixPath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

async function readSkillMeta(filePath: string, source: WorkspaceSkillCatalogItem["source"]): Promise<WorkspaceSkillCatalogItem | null> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(content);
    return {
      id: parsed.name,
      name: parsed.name,
      description: parsed.description,
      source,
      path: toUnixPath(path.relative(u.getPath("skills"), filePath)),
    };
  } catch {
    return null;
  }
}

export async function getWorkspaceSkillCatalog(projectId: number): Promise<WorkspaceSkillCatalogItem[]> {
  const project = await u.db("o_project").where("id", projectId).select("artStyle", "directorManual").first();
  const skills: WorkspaceSkillCatalogItem[] = [];

  const imageSkills = await listImageGenerationSkills();
  skills.push(
    ...imageSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: "image_generation" as const,
      targetTypes: skill.targetTypes,
      aspectRatio: skill.aspectRatio,
      path: `image_generation_skills/${skill.fileName}`,
    })),
  );

  const skillFiles = [
    ...((await scanSkills(u.getPath(["skills", "production_skills"]) + "/*.md")) ?? []),
    ...((await scanSkills(u.getPath(["skills", "art_skills", project?.artStyle ?? "", "driector_skills"]) + "/*.md")) ?? []),
    ...((await scanSkills(u.getPath(["skills", "story_skills", project?.directorManual ?? "", "driector_skills"]) + "/*.md")) ?? []),
  ];

  for (const filePath of skillFiles) {
    const source = filePath.includes("/art_skills/") ? "art_director" : filePath.includes("/story_skills/") ? "story_director" : "production";
    const meta = await readSkillMeta(filePath, source);
    if (meta) skills.push(meta);
  }

  const byKey = new Map<string, WorkspaceSkillCatalogItem>();
  for (const skill of skills) byKey.set(`${skill.source}:${skill.id}:${skill.path ?? ""}`, skill);
  return Array.from(byKey.values()).sort((a, b) => `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`));
}
