import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";
import u from "@/utils";
import {
  getVisualManualForAssetType,
  ImageGenerationAssetType,
  renderImageGenerationSkillPrompt,
  resolveImageGenerationSkill,
} from "@/services/imageGenerationSkill";

type AssetType = "role" | "scene" | "tool";

interface AssetTypeConfig {
  label: string;
  taskClass: string;
  dir: string;
  promptTitle: string;
  promptEnd: string;
}

export interface AssetImageGenerationItem {
  id: number;
  type: AssetType | "storyboard";
  name: string;
  prompt: string;
  describe?: string | null;
  base64?: string | null;
  skillId?: string | null;
  userRequirement?: string | null;
}

export interface SubmitAssetImageGenerationInput {
  projectId: number;
  model: `${string}:${string}` | string;
  resolution: "1K" | "2K" | "4K" | string;
  concurrentCount?: number;
  skillId?: string | null;
  userRequirement?: string | null;
  items: AssetImageGenerationItem[];
}

const assetTypeConfig: Record<AssetType, AssetTypeConfig> = {
  role: {
    label: "角色",
    taskClass: "角色图生成",
    dir: "role",
    promptTitle: "角色标准四视图",
    promptEnd: "人物角色四视图",
  },
  scene: {
    label: "场景",
    taskClass: "场景图生成",
    dir: "scene",
    promptTitle: "标准场景图",
    promptEnd: "标准场景图",
  },
  tool: {
    label: "道具",
    taskClass: "道具图生成",
    dir: "props",
    promptTitle: "标准道具图",
    promptEnd: "标准道具图",
  },
};

function buildPrompt(cfg: AssetTypeConfig, project: { artStyle?: string | null; type?: string | null; intro?: string | null }, name: string, prompt: string, visualManual: string, userRequirement?: string | null): string {
  return `
    请根据以下参数生成${cfg.promptTitle}：

    **基础参数：**
    - 画风风格: ${project.artStyle || "未指定"}
    - 项目类型: ${project.type || "未指定"}
    - 项目简介: ${project.intro || "无"}

    **视觉手册：**
    ${visualManual || "当前项目未配置对应视觉手册，请只按项目画风和资产设定生成。"}

    **${cfg.label}设定：**
    - 名称:${name},
    - 提示词:${prompt},
    - 用户额外要求:${userRequirement || "无"}

    请严格按照系统规范生成${cfg.promptEnd}。
  `;
}

function isSupportedAssetType(type: string): type is AssetType {
  return type === "role" || type === "scene" || type === "tool";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableImageError(error: unknown) {
  const message = u.error(error).message;
  return /429|负载|饱和|稍后|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|temporarily|rate limit/i.test(message);
}

async function runImageTaskWithRetry(task: () => Promise<void>, maxAttempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableImageError(error)) break;
      const delayMs = 30000 * attempt;
      console.warn(`[assetImageGeneration] image request failed, retrying in ${delayMs}ms (${attempt}/${maxAttempts})`, u.error(error).message);
      await wait(delayMs);
    }
  }
  throw lastError;
}

export async function submitAssetImageGeneration(input: SubmitAssetImageGenerationInput) {
  const { projectId, model, resolution, concurrentCount, items } = input;
  const project = await u.db("o_project").where("id", projectId).select("id", "name", "artStyle", "type", "intro", "directorManual").first();
  if (!project) throw new Error("项目为空");

  const validItems = items.filter((item) => isSupportedAssetType(item.type));
  const imageIdByAssetId = new Map<number, number>();
  const previousCompletedImageIds = new Map<number, number>();
  const skippedGenerating: Array<{ assetId: number; imageId: number }> = [];
  const skillUsage = new Map<number, { id: string; name: string }>();

  for (const item of validItems) {
    const currentImage = await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.id", item.id)
      .select("o_assets.imageId", "o_image.state as imageState")
      .first();
    if (currentImage?.imageState === "生成中") {
      skippedGenerating.push({ assetId: item.id, imageId: currentImage.imageId });
      continue;
    }

    const previousCompletedImage = await u
      .db("o_image")
      .where({ assetsId: item.id, state: "已完成" })
      .orderBy("id", "desc")
      .select("id")
      .first();
    if (previousCompletedImage?.id) previousCompletedImageIds.set(item.id, previousCompletedImage.id);

    const [imageId] = await u.db("o_image").insert({
      type: item.type,
      state: "生成中",
      assetsId: item.id,
    });
    imageIdByAssetId.set(item.id, imageId);
    await u.db("o_assets").where("id", item.id).update({ imageId });
  }

  const limit = pLimit(concurrentCount ?? 1);
  const tasks = validItems.map((item) =>
    limit(async () => {
      const imageId = imageIdByAssetId.get(item.id);
      if (!imageId) return;

      const data = await u.db("o_image").where("id", imageId).select("state").first();
      if (data?.state !== "生成中") {
        console.info("[assetImageGeneration] skip generation because image state changed", {
          imageId,
          assetId: item.id,
          state: data?.state,
        });
        return;
      }

      try {
        const cfg = assetTypeConfig[item.type as AssetType];
        if (!cfg) return;

        await u.db("o_assets").where("id", item.id).update({ imageId });

        const imagePath = `/${projectId}/${cfg.dir}/${uuidv4()}.jpg`;
        const assetType = item.type as ImageGenerationAssetType;
        const visualManual = getVisualManualForAssetType(project.artStyle, assetType);
        const selectedSkill = await resolveImageGenerationSkill({
          skillId: item.skillId ?? input.skillId,
          requestText: item.userRequirement ?? input.userRequirement,
          assetType,
        });
        if (selectedSkill) skillUsage.set(item.id, { id: selectedSkill.id, name: selectedSkill.name });
        const promptContext = {
          project: {
            id: projectId,
            name: project.name,
            intro: project.intro,
            type: project.type,
            artStyle: project.artStyle,
            directorManual: project.directorManual,
          },
          asset: {
            id: item.id,
            type: assetType,
            name: item.name,
            describe: item.describe ?? null,
            prompt: item.prompt,
          },
          visualManual,
          userRequirement: item.userRequirement ?? input.userRequirement ?? null,
        };
        const userPrompt = selectedSkill
          ? renderImageGenerationSkillPrompt(selectedSkill, promptContext)
          : buildPrompt(cfg, project, item.name, item.prompt, visualManual, item.userRequirement ?? input.userRequirement);
        const describe = `生成${cfg.label}图，名称：${item.name}，提示词：${item.prompt}`;
        const relatedObjects = { id: item.id, projectId, type: cfg.label, skillId: selectedSkill?.id ?? null, prompt: userPrompt.slice(0, 1200) };

        await runImageTaskWithRetry(async () => {
          const aiImage = u.Ai.Image(model as `${string}:${string}`);
          await aiImage.run(
            {
              prompt: userPrompt,
              referenceList: item.base64 ? [{ base64: item.base64, type: "image" }] : [],
              size: resolution as "1K" | "2K" | "4K",
              aspectRatio: selectedSkill?.aspectRatio ?? "16:9",
            },
            {
              taskClass: cfg.taskClass,
              describe,
              projectId,
              relatedObjects: JSON.stringify(relatedObjects),
            },
          );
          await aiImage.save(imagePath);
        });

        const imageData = await u.db("o_image").where("id", imageId).select("state").first();
        if (!imageData) {
          console.warn("[assetImageGeneration] image record missing after save", { imageId, assetId: item.id });
          return;
        }
        if (imageData.state !== "生成中") {
          console.info("[assetImageGeneration] skip completed update because image state changed", {
            imageId,
            assetId: item.id,
            state: imageData.state,
          });
          return;
        }

        const updated = await u
          .db("o_image")
          .where({ id: imageId })
          .where("state", "生成中")
          .update({
            state: "已完成",
            filePath: imagePath,
            errorReason: null,
            type: item.type,
            model: String(model).split(/:(.+)/)[1],
            resolution,
          });

        if (updated === 0) {
          console.info("[assetImageGeneration] completed update skipped by state guard", { imageId, assetId: item.id });
          return;
        }

        await u.db("o_assets").where("id", item.id).update({ imageId });
      } catch (e: any) {
        await u
          .db("o_image")
          .where({ id: imageId })
          .where("state", "生成中")
          .update({ state: "生成失败", errorReason: u.error(e).message });
        const previousCompletedImageId = previousCompletedImageIds.get(item.id);
        if (previousCompletedImageId) {
          await u.db("o_assets").where("id", item.id).where("imageId", imageId).update({ imageId: previousCompletedImageId });
        }
      }
    }),
  );

  Promise.all(tasks).catch((err) => {
    console.error("[assetImageGeneration] batch failed", u.error(err));
  });

  return {
    projectId,
    total: validItems.length,
    submitted: imageIdByAssetId.size,
    skippedGenerating: skippedGenerating.length,
    skippedUnsupported: items.length - validItems.length,
    skippedGeneratingItems: skippedGenerating,
    skillUsage: Array.from(skillUsage.entries()).map(([assetId, skill]) => ({ assetId, ...skill })),
    imageIds: Array.from(imageIdByAssetId.entries()).map(([assetId, imageId]) => ({ assetId, imageId })),
  };
}
