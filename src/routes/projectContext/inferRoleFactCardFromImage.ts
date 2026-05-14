import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { ensureProjectContextTables } from "@/services/projectContext";

const router = express.Router();

function isHttpImage(value: string) {
  return /^https?:\/\//i.test(value);
}

function toAbsoluteHttpUrl(req: express.Request, value: string) {
  if (!value || isHttpImage(value) || value.startsWith("data:")) return value;
  if (!value.startsWith("/")) return value;
  const host = req.headers.host;
  if (!host) return value;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.secure ? "https" : "http");
  return `${proto}://${host}${value}`;
}

function compact(value: unknown, maxLength = 1200) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("识别结果不是有效 JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeDraft(raw: any) {
  const facts = compact(raw?.facts, 4000);
  const negativeFacts = compact(raw?.negativeFacts ?? raw?.negative_facts ?? raw?.guardrails, 2000);
  const confidence = Number(raw?.confidence);
  return {
    facts,
    negativeFacts,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
    sourceType: "uploaded_image" as const,
    summary: compact(raw?.summary, 800),
  };
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    assetId: z.number().optional().nullable(),
    roleName: z.string(),
    assetDescribe: z.string().optional().nullable(),
    assetPrompt: z.string().optional().nullable(),
    imageBase64: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, assetId, roleName, assetDescribe, assetPrompt, imageBase64 } = req.body;
    try {
      await ensureProjectContextTables();
      const project = await u
        .db("o_project")
        .where("id", projectId)
        .select("id", "name", "intro", "type", "artStyle", "directorManual")
        .first();
      const constraints = await u.db("o_projectConstraints").where({ projectId }).first().catch(() => null);
      const existingFact = assetId
        ? await u.db("o_roleFactCards").where({ projectId, assetId }).orderBy("updatedAt", "desc").first().catch(() => null)
        : null;
      let imageData = imageBase64 || "";
      if (!imageData && assetId) {
        const asset = await u.db("o_assets").where({ id: assetId, projectId }).select("imageId").first();
        const image = asset?.imageId ? await u.db("o_image").where({ id: asset.imageId }).select("filePath").first() : null;
        if (!image?.filePath) throw new Error("当前角色还没有可识别的图片，请先上传图片");
        imageData = await u.oss
          .getImageBase64(image.filePath)
          .catch(async () => toAbsoluteHttpUrl(req, await u.oss.getFileUrl(image.filePath)));
      }
      if (!imageData) throw new Error("未提供角色图片，请先上传图片");

      const imageContent = isHttpImage(imageData)
        ? { type: "image", image: imageData }
        : { type: "image", image: imageData };

      const prompt = `请根据上传的角色参考图，生成 Toonflow 角色事实卡草稿。

要求：
1. 只写稳定事实，不写临时姿势、镜头角度、光照、背景噪声。
2. 上传参考图优先级高于小说/描述词；如果文字说法与图片冲突，以图片为准，并把容易误读的点写入 negativeFacts。
3. 如果角色是拟人化水果、道具、动物、怪物或非人类角色，必须明确其本体/物种/材质，不要误写成普通人类。
4. 不确定的内容要保守表达，不要强行补设定。
5. 输出严格 JSON，不要 Markdown 代码块，不要额外解释。

JSON 格式：
{
  "facts": "- 稳定事实1\\n- 稳定事实2",
  "negativeFacts": "- 禁止误读1\\n- 禁止误读2",
  "confidence": 0.0到1.0,
  "summary": "一句话摘要"
}

项目信息：
- 项目名：${compact(project?.name)}
- 项目类型：${compact(project?.type)}
- 项目简介：${compact(project?.intro)}
- 画风：${compact(project?.artStyle)}
- 项目硬约束：${compact(constraints?.content, 2000)}

角色资产：
- 资产ID：${assetId ?? "无"}
- 角色名：${compact(roleName)}
- 现有描述：${compact(assetDescribe, 2000)}
- 现有描述词：${compact(assetPrompt, 2000)}
- 现有事实卡：${compact(existingFact?.facts, 2000)}
- 现有禁止项：${compact(existingFact?.negativeFacts, 1000)}
`;

      const result = await u.Ai.Text("universalAi").invoke({
        system: "你是严格的角色视觉设定分析员，负责把上传角色图转写为可执行的角色事实卡。",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              imageContent,
            ] as any,
          },
        ],
      });

      const draft = normalizeDraft(extractJson(result.text));
      if (!draft.facts) throw new Error("识别结果为空");
      return res.status(200).send(success(draft));
    } catch (err) {
      const message = u.error(err).message;
      const friendly = /image|multimodal|unsupported|content|vision/i.test(message)
        ? `角色图识别失败：当前文本模型可能不支持图片理解。${message}`
        : `角色图识别失败：${message}`;
      return res.status(500).send(error(friendly));
    }
  },
);
