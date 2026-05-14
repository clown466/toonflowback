import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
const router = express.Router();

const textMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const referenceSchema = z.object({
  type: z.enum(["image", "video", "audio"]),
  base64: z.string(),
});

async function getModelConfig(id: string, modelName: string) {
  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();
  if (!vendorConfigData) throw new Error("未找到该供应商配置");
  if (!vendorConfigData.models) throw new Error("未找到模型列表");

  const modelList = await u.vendor.getModelList(vendorConfigData.id!);
  const selectedModel = modelList.find((i: any) => i.modelName == modelName);
  if (!selectedModel) throw new Error(`未找到模型：${modelName}`);

  return { vendorConfigData, selectedModel };
}

function getTestPrompt(prompt: unknown, fallback: string) {
  return typeof prompt === "string" && prompt.trim() ? prompt.trim() : fallback;
}

function getVideoMode(mode: unknown) {
  if (typeof mode !== "string" || !mode.trim()) return "text";
  const value = mode.trim();
  if (!value.startsWith("[")) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

async function saveGenerated(type: "image" | "video", runner: { save: (path: string) => Promise<unknown> }) {
  const fileName = `model-test-${Date.now()}-${Math.random().toString(36).slice(2)}.${type === "video" ? "mp4" : "jpg"}`;
  await runner.save(fileName);
  return u.oss.getFileUrl(fileName);
}

// 文本模型对话测试
router.post(
  "/textTest",
  validateFields({
    modelName: z.string(),
    id: z.string(),
    messages: z.array(textMessageSchema).min(1),
  }),
  async (req, res) => {
    const { modelName, id, messages } = req.body;

    try {
      await getModelConfig(id, modelName);
      const result = await u.Ai.Text(`${id}:${modelName}`).invoke({
        messages,
      });
      const thinking = (result as any).reasoningText ?? (result as any).reasoning ?? "";
      return res.status(200).send(success({ content: result.text, thinking }));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      return res.status(500).send(error(msg));
    }
  },
);

// 图片模型测试
router.post(
  "/imageTest",
  validateFields({
    modelName: z.string(),
    id: z.string(),
    prompt: z.string().optional(),
    imageBase64: z.string().optional(),
  }),
  async (req, res) => {
    const { modelName, id, prompt, imageBase64 } = req.body;

    try {
      await getModelConfig(id, modelName);
      const runner = await u.Ai.Image(`${id}:${modelName}`).run({
        prompt: getTestPrompt(prompt, "一张16:9比例的可爱橘猫插画，色彩明亮，高清细节，干净背景"),
        referenceList: imageBase64 ? [{ type: "image", base64: imageBase64 }] : [],
        size: "1K",
        aspectRatio: "16:9",
      });
      return res.status(200).send(success(await saveGenerated("image", runner)));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      return res.status(500).send(error(msg));
    }
  },
);

// 视频模型测试
router.post(
  "/videoTest",
  validateFields({
    modelName: z.string(),
    id: z.string(),
    mode: z.string().optional(),
    prompt: z.string().optional(),
    images: z.array(referenceSchema).optional(),
    videos: z.array(referenceSchema).optional(),
    audios: z.array(referenceSchema).optional(),
  }),
  async (req, res) => {
    const { modelName, id, mode, prompt, images, videos, audios } = req.body;

    try {
      const { selectedModel } = await getModelConfig(id, modelName);
      const durationResolution = selectedModel.durationResolutionMap?.[0];
      const runner = await u.Ai.Video(`${id}:${modelName}`).run({
        duration: durationResolution?.duration?.[0] ?? 5,
        resolution: durationResolution?.resolution?.[0] ?? "720p",
        aspectRatio: "16:9",
        prompt: getTestPrompt(prompt, "一段电影感镜头：清晨阳光穿过窗户，桌面上的咖啡杯冒着热气，镜头缓慢推进。"),
        referenceList: [...(images ?? []), ...(videos ?? []), ...(audios ?? [])],
        audio: false,
        mode: getVideoMode(mode) as any,
      });
      return res.status(200).send(success(await saveGenerated("video", runner)));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      return res.status(500).send(error(msg));
    }
  },
);

// 检查语言模型
export default router.post(
  "/",
  validateFields({
    modelName: z.string(),
    type: z.enum(["text", "video", "image"]),
    id: z.string(),
  }),
  async (req, res) => {
    const { modelName, type, id } = req.body;

    try {
      const requestFn: Record<string, { fnName: string; modelData?: any }> = {
        text: { fnName: "textRequest" },
        image: {
          fnName: "imageRequest",
          modelData: {
            prompt:
              "一张16:9比例的图片，完美等分为2x2四宫格布局，各区域无缝衔接：\n左上宫格：一只可爱的猫，毛发蓬松，眼睛明亮，姿态俏皮\n右上宫格：一只友善的狗，金毛犬，表情愉悦，摇着尾巴\n左下宫格：一头健壮的牛，田园背景，目光温和，皮毛光泽\n右下宫格：一匹骏马，姿态优雅，鬃毛飘逸，肌肉健美\n风格要求：四个宫格风格统一，色彩鲜艳饱和，高清画质，细节清晰锐利，专业插画风格，线条干净，统一的左上方光源，柔和阴影，和谐配色，卡通/半写实风格，宫格间用白色或浅灰细线分隔", //图片提示词
            referenceList: [], //输入的图片提示词
            size: "1K", // 图片尺寸
            aspectRatio: "1:1",
          },
        },
        video: { fnName: "videoRequest", modelData: {} },
      } as const;
      const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();

      if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
      if (!vendorConfigData.models) return res.status(500).send(error("未找到模型列表"));

      const modelList = await u.vendor.getModelList(vendorConfigData.id!);

      const selectedModel = modelList.find((i: any) => i.modelName == modelName);
      if (!selectedModel) return res.status(500).send(error(`未找到模型 ${modelName}`));
      if (type == "video") {
        const duration = selectedModel.durationResolutionMap?.[0]?.duration?.[0];
        const resolution = selectedModel.durationResolutionMap?.[0]?.resolution?.[0];
        if (!duration || !resolution) return res.status(500).send(error(`模型 ${modelName} 缺少视频测试所需的时长或分辨率配置`));
        requestFn["video"].modelData = {
          model: modelName,
          duration,
          resolution,
          aspectRatio: "16:9",
          prompt:
            "A shirtless middle-aged man with a horse head is standing in a supermarket, carefully comparing two identical bottles of shampoo for 3 seconds, then suddenly bursts into tears, drops to his knees dramatically, a flock of pigeons explodes out of nowhere from behind him, the supermarket lights flicker, an old grandma nearby continues shopping completely unbothered, the horse head man instantly stops crying, puts both shampoo bottles back, and moonwalks away disappearing into the vegetable section. Security camera footage style, slightly grainy, 5 seconds.",
          referenceList: [],
          audio: false,
          mode: "text",
        };
      }
      const reqConfig = requestFn[type as "text" | "video" | "image"];

      if (type == "text") {
        const { textStream } = await u.Ai.Text(`${id}:${modelName}`).stream({
          prompt: "请只回复 OK，用于测试模型是否可用。",
        });
        let fullResponse = "";
        for await (const chunk of textStream) {
          fullResponse += chunk;
        }
        if (!fullResponse) return res.status(500).send(error("模型未返回结果"));
        res.status(200).send(success(fullResponse));
      } else {
        const aiTypeFn = {
          image: "Image",
          video: "Video",
        } as const;
        const reqFn = await u.Ai[aiTypeFn[type as "image" | "video"]](`${id}:${modelName}`).run({
          ...reqConfig.modelData,
        });
        await reqFn.save(type == "video" ? "test.mp4" : "testImage.jpg");
        const resultUrl = await u.oss.getFileUrl(type == "video" ? "test.mp4" : "testImage.jpg");
        res.status(200).send(success(resultUrl));
      }
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      res.status(500).send(error(msg));
    }
  },
);
