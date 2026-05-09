import u from "@/utils";
import { stripThink } from "@/utils/stripThink";
import { v4 as uuidv4 } from "uuid";

type AssetType = "role" | "scene" | "tool" | string;

interface AssetForRoleCard {
  id: number;
  projectId: number;
  name?: string | null;
  type?: AssetType | null;
  describe?: string | null;
  prompt?: string | null;
  imageId?: number | null;
  filePath?: string | null;
}

interface RoleFactCardDraft {
  facts: string;
  negativeFacts: string;
  confidence: number;
  sourceType: string;
}

export interface SyncRoleFactCardResult {
  skipped?: boolean;
  card?: RoleFactCardDraft;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasAnyText(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function unique(items: string[]) {
  return [...new Set(items.map(clean).filter(Boolean))];
}

function parseJsonObject(text: string): any | null {
  const cleaned = stripThink(text).replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildFallbackRoleFactCard(asset: AssetForRoleCard, sourceType: string): RoleFactCardDraft {
  const name = clean(asset.name) || "Unnamed role";
  const source = [asset.name, asset.prompt, asset.describe].map(clean).filter(Boolean).join(" ");
  const lowerName = name.toLowerCase();

  let identity = "anthropomorphic character";
  if (/chloe/.test(lowerName) || /桃子|水蜜桃|peach/i.test(source)) identity = "peach fruit woman";
  else if (/bob/.test(lowerName) || /橙子|橙色果皮|orange/i.test(source)) identity = "stocky orange fruit soldier";
  else if (/leo/.test(lowerName) || /柠檬|lemon/i.test(source)) identity = "yellow lemon fruit man";
  else if (/水果|果|fruit/i.test(source)) identity = "anthropomorphic fruit character";

  const features: string[] = [];
  if (hasAnyText(source, [/粉橙|桃红|pink-orange|peach head/i])) features.push("pink-orange peach head");
  if (hasAnyText(source, [/桃子纵向凹沟|桃子.*凹沟|peach groove/i])) features.push("clear peach groove");
  if (hasAnyText(source, [/鲜明柠檬黄|亮黄色|黄色柠檬|yellow lemon|lemon yellow/i])) features.push("bright yellow lemon body");
  if (hasAnyText(source, [/绿色叶子|叶子|果梗|短果梗|green leaf|stem/i])) features.push("green leaf and short stem on top");
  if (hasAnyText(source, [/半睁|疲倦|疲惫|half-lidded|tired|sleepy/i])) features.push("half-lidded tired eyes");
  if (hasAnyText(source, [/头盔|耳状凸起|耳朵|cat.?ear|helmet/i])) features.push("yellow helmet or cat-ear-like head silhouette");
  if (hasAnyText(source, [/黑色边缘|黑色.*结构|strap|rim|visor/i])) features.push("black helmet rim or strap detail");
  if (hasAnyText(source, [/连帽|夹克|hoodie|jacket/i])) features.push("simple yellow jacket or hoodie");
  if (hasAnyText(source, [/黑色长裤|black pants/i])) features.push("black pants");
  if (hasAnyText(source, [/白色运动鞋|运动鞋|sneakers|shoes/i])) features.push("white sneakers with yellow accents");
  if (hasAnyText(source, [/防毒面具|gas mask/i])) features.push("gas mask");
  if (hasAnyText(source, [/战术背心|防弹背心|tactical vest/i])) features.push("tactical vest");
  if (hasAnyText(source, [/迷彩|军装|military|soldier/i])) features.push("military gear");
  if (hasAnyText(source, [/霰弹枪|长枪|shotgun|gun/i])) features.push("shotgun or long gun");
  if (hasAnyText(source, [/小刀|knife/i])) features.push("small knife");
  if (hasAnyText(source, [/平底锅|frying pan/i])) features.push("frying pan");

  const attitudes: string[] = [];
  if (hasAnyText(source, [/自信|讽刺|坏笑|sarcastic|confident/i])) attitudes.push("confident sarcastic attitude");
  if (hasAnyText(source, [/严肃|警觉|practical|tense/i])) attitudes.push("tense and practical attitude");
  if (hasAnyText(source, [/冷静|吐槽|疲倦|deadpan|calm/i])) attitudes.push("calm deadpan attitude");

  const factParts = unique([...features, ...attitudes]);
  const facts = [
    `Role: ${name}.`,
    `Identity: ${identity}.`,
    asset.filePath || asset.imageId ? "Authority: uploaded/selected role image is the highest visual reference." : "Authority: current asset prompt and description are the visual reference.",
    factParts.length ? `Key visual facts: ${factParts.join("; ")}.` : "",
  ].filter(Boolean).join(" ");

  const negative: string[] = ["do not redesign the character", "do not turn into a normal human"];
  if (/leo/i.test(name) || /柠檬|lemon/i.test(source)) negative.push("do not make Leo a green lime", "do not make Leo orange like Bob");
  if (/chloe/i.test(name) || /桃子|水蜜桃|peach/i.test(source)) negative.push("do not make Chloe a strawberry");
  if (/bob/i.test(name) || /橙子|orange/i.test(source)) negative.push("do not make Bob a peach or lemon");

  return {
    facts,
    negativeFacts: unique(negative).join("; "),
    confidence: asset.filePath || asset.imageId ? 0.62 : 0.48,
    sourceType,
  };
}

async function getAssetWithImage(assetId: number, projectId?: number): Promise<AssetForRoleCard | null> {
  const row = await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .select("o_assets.*", "o_image.filePath")
    .where("o_assets.id", assetId)
    .modify((qb: any) => {
      if (projectId != null) qb.andWhere("o_assets.projectId", projectId);
    })
    .first();
  return row ?? null;
}

async function upsertRoleFactCard(asset: AssetForRoleCard, draft: RoleFactCardDraft) {
  const now = Date.now();
  const existing = await u.db("o_roleFactCards").where("projectId", asset.projectId).andWhere("assetId", asset.id).first();
  const payload = {
    projectId: asset.projectId,
    assetId: asset.id,
    roleName: clean(asset.name) || "Unnamed role",
    facts: draft.facts,
    negativeFacts: draft.negativeFacts,
    sourceType: draft.sourceType,
    confidence: draft.confidence,
    updatedAt: now,
  };
  if (existing) {
    await u.db("o_roleFactCards").where("id", existing.id).update(payload);
    return;
  }
  await u.db("o_roleFactCards").insert({
    id: uuidv4(),
    ...payload,
    createdAt: now,
  });
}

async function inferRoleFactCardWithVision(asset: AssetForRoleCard, imageBase64: string): Promise<RoleFactCardDraft | null> {
  const name = clean(asset.name) || "Unnamed role";
  const context = [asset.prompt, asset.describe].map(clean).filter(Boolean).join("\n");
  const prompt = [
    "You are creating a role fact card for an AI short-drama production pipeline.",
    "Read the uploaded character reference image as the highest visual authority.",
    "Return JSON only, with this schema:",
    '{"facts":"English concise visual facts. Mention species/object identity, strongest colors/shapes, outfit, key prop, face/eye expression, silhouette markers. 45-90 words.","negativeFacts":"English constraints for what must not be changed or confused.","confidence":0.0}',
    "",
    `Role name: ${name}`,
    context ? `Existing asset text:\n${context}` : "Existing asset text: empty",
    "",
    "Do not invent details that are not visible or not supported by the existing asset text.",
  ].join("\n");

  const result = await u.Ai.Text("universalAi").invoke({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageBase64 },
        ],
      } as any,
    ],
    maxOutputTokens: 900,
  } as any);
  const parsed = parseJsonObject(result.text);
  if (!parsed?.facts || typeof parsed.facts !== "string") return null;
  return {
    facts: clean(parsed.facts),
    negativeFacts: clean(parsed.negativeFacts),
    confidence: Math.max(0.1, Math.min(0.98, Number(parsed.confidence) || 0.78)),
    sourceType: "uploaded_image_vision",
  };
}

export async function syncRoleFactCardFallback(assetId: number, projectId?: number): Promise<SyncRoleFactCardResult> {
  const asset = await getAssetWithImage(assetId, projectId);
  if (!asset || asset.type !== "role" || !asset.projectId) return { skipped: true };
  const draft = buildFallbackRoleFactCard(asset, asset.filePath || asset.imageId ? "uploaded_image_text_fallback" : "asset_text_fallback");
  await upsertRoleFactCard(asset, draft);
  return { card: draft };
}

export async function refreshRoleFactCardWithVision(assetId: number, projectId?: number, imageBase64?: string): Promise<SyncRoleFactCardResult> {
  const asset = await getAssetWithImage(assetId, projectId);
  if (!asset || asset.type !== "role" || !asset.projectId) return { skipped: true };

  const fallback = buildFallbackRoleFactCard(asset, asset.filePath || asset.imageId ? "uploaded_image_text_fallback" : "asset_text_fallback");
  await upsertRoleFactCard(asset, fallback);

  const image = imageBase64 || (asset.filePath ? await u.oss.getImageBase64(asset.filePath) : "");
  if (!image) return { card: fallback };

  try {
    const visionDraft = await inferRoleFactCardWithVision(asset, image);
    if (!visionDraft) return { card: fallback };
    await upsertRoleFactCard(asset, visionDraft);
    return { card: visionDraft };
  } catch (error) {
    console.warn(`[roleFactCard] vision refresh failed for asset ${asset.id}: ${u.error(error).message}`);
    return { card: fallback };
  }
}

export function queueRoleFactCardVisionRefresh(assetId: number, projectId?: number, imageBase64?: string) {
  void refreshRoleFactCardWithVision(assetId, projectId, imageBase64).catch((error) => {
    console.warn(`[roleFactCard] queued refresh failed for asset ${assetId}: ${u.error(error).message}`);
  });
}
