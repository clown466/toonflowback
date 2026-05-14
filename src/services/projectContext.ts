import fs from "fs";
import path from "path";
import isPathInside from "is-path-inside";
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import u from "@/utils";
import { db } from "@/utils/db";

export type ProjectConstraintSourceType = "user_to_controller" | "md_project_skill" | "project_setting" | "manual" | "agent_inferred";
export type RoleFactCardSourceType = "uploaded_image" | "user" | "agent_inferred" | "manual";

export interface ProjectConstraints {
  projectId: number;
  content: string;
  sourceType: ProjectConstraintSourceType;
  sourceRef?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoleFactCard {
  id: string;
  projectId: number;
  assetId?: number | null;
  roleName: string;
  sourceType: RoleFactCardSourceType;
  confidence: number;
  facts: string;
  negativeFacts?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectContextBundle {
  project: Record<string, unknown> | null;
  projectConstraints: ProjectConstraints | null;
  projectSkillContents: Array<{ source: string; path: string; content: string }>;
  roleFactCards: RoleFactCard[];
  assetSummary: Array<{
    id: number;
    name?: string | null;
    type?: string | null;
    describe?: string | null;
    prompt?: string | null;
    imageId?: number | null;
    filePath?: string | null;
    parentAssetId?: number | null;
  }>;
}

let ensurePromise: Promise<void> | null = null;

export function ensureProjectContextTables() {
  if (!ensurePromise) {
    ensurePromise = ensureProjectContextTablesOnce(db).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function ensureProjectContextTablesOnce(knexDb: Knex) {
  if (!(await knexDb.schema.hasTable("o_projectConstraints"))) {
    await knexDb.schema.createTable("o_projectConstraints", (table) => {
      table.integer("projectId").notNullable().primary();
      table.text("content").notNullable();
      table.text("sourceType").notNullable();
      table.text("sourceRef");
      table.integer("createdAt").notNullable();
      table.integer("updatedAt").notNullable();
      table.index(["sourceType"]);
    });
  }

  if (!(await knexDb.schema.hasTable("o_roleFactCards"))) {
    await knexDb.schema.createTable("o_roleFactCards", (table) => {
      table.text("id").notNullable().primary();
      table.integer("projectId").notNullable();
      table.integer("assetId");
      table.text("roleName").notNullable();
      table.text("sourceType").notNullable();
      table.float("confidence").notNullable().defaultTo(1);
      table.text("facts").notNullable();
      table.text("negativeFacts");
      table.integer("createdAt").notNullable();
      table.integer("updatedAt").notNullable();
      table.index(["projectId"]);
      table.index(["projectId", "assetId"]);
      table.index(["projectId", "roleName"]);
    });
  }

  if (!(await knexDb.schema.hasTable("o_projectSkillBindings"))) {
    await knexDb.schema.createTable("o_projectSkillBindings", (table) => {
      table.text("id").notNullable().primary();
      table.integer("projectId").notNullable();
      table.text("path").notNullable();
      table.text("sourceType").notNullable().defaultTo("md_project_skill");
      table.integer("createdAt").notNullable();
      table.integer("updatedAt").notNullable();
      table.unique(["projectId", "path"]);
      table.index(["projectId"]);
    });
  }
}

export async function getProjectConstraints(projectId: number): Promise<ProjectConstraints | null> {
  await ensureProjectContextTables();
  const row = await db<ProjectConstraints>("o_projectConstraints").where({ projectId }).first();
  return row ?? null;
}

export async function saveProjectConstraints(input: {
  projectId: number;
  content: string;
  sourceType?: ProjectConstraintSourceType;
  sourceRef?: string | null;
}): Promise<ProjectConstraints> {
  await ensureProjectContextTables();
  const now = Date.now();
  const existing = await getProjectConstraints(input.projectId);
  const row: ProjectConstraints = {
    projectId: input.projectId,
    content: input.content,
    sourceType: input.sourceType ?? "manual",
    sourceRef: input.sourceRef ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) {
    await db("o_projectConstraints").where({ projectId: input.projectId }).update(row);
  } else {
    await db("o_projectConstraints").insert(row);
  }

  return row;
}

export async function listRoleFactCards(filter: { projectId: number; assetId?: number | null; roleName?: string | null }): Promise<RoleFactCard[]> {
  await ensureProjectContextTables();
  let query = db<RoleFactCard>("o_roleFactCards").where({ projectId: filter.projectId }).orderBy("updatedAt", "desc");
  if (typeof filter.assetId === "number") query = query.andWhere("assetId", filter.assetId);
  if (filter.roleName) query = query.andWhere("roleName", filter.roleName);
  return query;
}

export async function saveRoleFactCard(input: {
  id?: string | null;
  projectId: number;
  assetId?: number | null;
  roleName: string;
  sourceType: RoleFactCardSourceType;
  confidence: number;
  facts: string;
  negativeFacts?: string | null;
}): Promise<RoleFactCard> {
  await ensureProjectContextTables();
  const now = Date.now();
  const normalizedRoleName = input.roleName.trim();
  const confidence = Math.max(0, Math.min(1, input.confidence));

  let existing: RoleFactCard | undefined;
  if (input.id) {
    existing = await db<RoleFactCard>("o_roleFactCards").where({ id: input.id }).first();
  } else if (typeof input.assetId === "number") {
    existing = await db<RoleFactCard>("o_roleFactCards").where({ projectId: input.projectId, assetId: input.assetId, roleName: normalizedRoleName }).first();
  } else {
    existing = await db<RoleFactCard>("o_roleFactCards").where({ projectId: input.projectId, roleName: normalizedRoleName }).whereNull("assetId").first();
  }

  const row: RoleFactCard = {
    id: existing?.id ?? input.id ?? uuid(),
    projectId: input.projectId,
    assetId: input.assetId ?? null,
    roleName: normalizedRoleName,
    sourceType: input.sourceType,
    confidence,
    facts: input.facts,
    negativeFacts: input.negativeFacts ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) {
    await db("o_roleFactCards").where({ id: existing.id }).update(row);
  } else {
    await db("o_roleFactCards").insert(row);
  }

  return row;
}

export async function buildProjectContextBundle(projectId: number): Promise<ProjectContextBundle> {
  await ensureProjectContextTables();
  const project = (await u
    .db("o_project")
    .where("id", projectId)
    .select("id", "name", "projectType", "intro", "type", "artStyle", "directorManual", "videoRatio", "imageModel", "videoModel", "imageQuality", "mode")
    .first()) as Record<string, unknown> | undefined;

  const [projectConstraints, roleFactCards, assetSummary, projectSkillContents] = await Promise.all([
    getProjectConstraints(projectId),
    listRoleFactCards({ projectId }),
    readAssetSummary(projectId),
    readBoundProjectSkillContents(projectId, project),
  ]);

  return {
    project: project ?? null,
    projectConstraints,
    projectSkillContents,
    roleFactCards,
    assetSummary,
  };
}

async function readAssetSummary(projectId: number) {
  let query = u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .select(
      "o_assets.id",
      "o_assets.name",
      "o_assets.type",
      "o_assets.describe",
      "o_assets.prompt",
      "o_assets.imageId",
      "o_assets.assetsId as parentAssetId",
      "o_image.filePath",
    );

  query = query.orderBy("o_assets.type", "asc").orderBy("o_assets.id", "asc").limit(200);
  return query as Promise<ProjectContextBundle["assetSummary"]>;
}

async function readBoundProjectSkillContents(projectId: number, project?: Record<string, unknown>) {
  const skillsRoot = path.resolve(u.getPath("skills"));
  const candidates: Array<{ source: string; relativePath: string }> = [];
  const rows = await db<{ path: string; sourceType: string }>("o_projectSkillBindings").where({ projectId }).select("path", "sourceType");

  for (const row of rows) {
    candidates.push({ source: row.sourceType || "md_project_skill", relativePath: row.path });
  }

  const projectSkillPath = path.join("project_skills", `${projectId}.md`);
  if (fs.existsSync(path.join(skillsRoot, projectSkillPath))) candidates.push({ source: "md_project_skill", relativePath: projectSkillPath });

  const seen = new Set<string>();
  const results: Array<{ source: string; path: string; content: string }> = [];
  for (const candidate of candidates) {
    const safe = safeSkillPath(skillsRoot, candidate.relativePath);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    try {
      results.push({
        source: candidate.source,
        path: path.relative(skillsRoot, safe).replace(/\\/g, "/"),
        content: await fs.promises.readFile(safe, "utf-8"),
      });
    } catch {
      // Skill bindings may point to files removed by another worker/user; ignore stale bindings.
    }
  }
  return results;
}

function safeSkillPath(skillsRoot: string, relativePath: string) {
  const target = path.resolve(skillsRoot, relativePath);
  return target === skillsRoot || isPathInside(target, skillsRoot) ? target : null;
}
