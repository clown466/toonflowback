import u from "@/utils";
import { listImageGenerationSkills } from "@/services/imageGenerationSkill";
import type { o_assets, o_image, o_novel, o_project, o_script } from "@/types/database";
import type {
  WorkspaceProjectSnapshot,
  WorkspaceProjectSnapshotAsset,
  WorkspaceProjectSnapshotImageGenerationSkill,
  WorkspaceProjectSnapshotNovel,
  WorkspaceProjectSnapshotProject,
  WorkspaceProjectSnapshotScript,
} from "@/agents/workspaceAgent/command/types";

type AssetImageRow = o_assets & {
  imageFilePath?: string | null;
  imageState?: string | null;
  imageErrorReason?: string | null;
  imageModel?: string | null;
  imageResolution?: string | null;
};

function toNumberId(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapProject(row: o_project | undefined): WorkspaceProjectSnapshotProject | null {
  const id = toNumberId(row?.id);
  if (!row || id == null) return null;
  return {
    id,
    name: row.name,
    intro: row.intro,
    type: row.type,
    artStyle: row.artStyle,
    directorManual: row.directorManual,
    videoRatio: row.videoRatio,
    imageModel: row.imageModel,
    imageQuality: row.imageQuality,
  };
}

function mapNovel(row: o_novel): WorkspaceProjectSnapshotNovel | null {
  const id = toNumberId(row.id);
  if (id == null) return null;
  return {
    id,
    chapterIndex: row.chapterIndex,
    reel: row.reel,
    chapter: row.chapter,
    chapterData: row.chapterData,
    eventState: row.eventState,
    event: row.event,
    errorReason: row.errorReason,
  };
}

function mapAsset(row: AssetImageRow): WorkspaceProjectSnapshotAsset | null {
  const id = toNumberId(row.id);
  if (id == null) return null;
  return {
    id,
    name: row.name,
    type: row.type,
    describe: row.describe,
    prompt: row.prompt,
    remark: row.remark,
    scriptId: row.scriptId,
    imageId: row.imageId,
    promptState: row.promptState,
    promptErrorReason: row.promptErrorReason,
    image: row.imageId
      ? {
        id: row.imageId,
        filePath: row.imageFilePath,
        state: row.imageState,
        errorReason: row.imageErrorReason,
        model: row.imageModel,
        resolution: row.imageResolution,
      }
      : undefined,
  };
}

function mapScript(row: o_script): WorkspaceProjectSnapshotScript | null {
  const id = toNumberId(row.id);
  if (id == null) return null;
  return {
    id,
    name: row.name,
    content: row.content,
    extractState: row.extractState,
    createTime: row.createTime,
    errorReason: row.errorReason,
  };
}

function compactSkills(skills: Awaited<ReturnType<typeof listImageGenerationSkills>>): WorkspaceProjectSnapshotImageGenerationSkill[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    targetTypes: skill.targetTypes,
    tags: skill.tags,
    aspectRatio: skill.aspectRatio,
    fileName: skill.fileName,
  }));
}

export async function loadProjectSnapshot(projectId: number): Promise<WorkspaceProjectSnapshot> {
  const [project, novels, assets, scripts, imageGenerationSkills] = await Promise.all([
    u.db("o_project")
      .where("id", projectId)
      .select("id", "name", "intro", "type", "artStyle", "directorManual", "videoRatio", "imageModel", "imageQuality")
      .first() as Promise<o_project | undefined>,
    u.db("o_novel")
      .where("projectId", projectId)
      .select("id", "chapterIndex", "reel", "chapter", "chapterData", "eventState", "event", "errorReason")
      .orderBy("chapterIndex", "asc")
      .orderBy("id", "asc") as Promise<o_novel[]>,
    u.db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereNull("o_assets.assetsId")
      .select(
        "o_assets.id",
        "o_assets.name",
        "o_assets.type",
        "o_assets.describe",
        "o_assets.prompt",
        "o_assets.remark",
        "o_assets.scriptId",
        "o_assets.imageId",
        "o_assets.promptState",
        "o_assets.promptErrorReason",
        "o_image.filePath as imageFilePath",
        "o_image.state as imageState",
        "o_image.errorReason as imageErrorReason",
        "o_image.model as imageModel",
        "o_image.resolution as imageResolution",
      )
      .orderBy("o_assets.id", "asc") as Promise<AssetImageRow[]>,
    u.db("o_script")
      .where("projectId", projectId)
      .select("id", "name", "content", "extractState", "createTime", "errorReason")
      .orderBy("id", "asc") as Promise<o_script[]>,
    listImageGenerationSkills(),
  ]);

  return {
    project: mapProject(project),
    novels: novels.map(mapNovel).filter((item): item is WorkspaceProjectSnapshotNovel => item !== null),
    assets: assets.map(mapAsset).filter((item): item is WorkspaceProjectSnapshotAsset => item !== null),
    scripts: scripts.map(mapScript).filter((item): item is WorkspaceProjectSnapshotScript => item !== null),
    imageGenerationSkills: compactSkills(imageGenerationSkills),
  };
}
