import{d as $e,ad as Ke,Y as ne,Z as B,w as s,a as d,f as t,o as a,c as m,$ as c,a0 as A,J as T,a7 as G,ab as Ae,b as o,e as R,bB as gt,ac as le,a1 as L,ae as He,z as y,S as Ee,_ as he,a5 as ce,L as vt,g as ue,T as Xt,U as Qt,I as en,aB as tn,av as nn,aA as Oe,af as qe}from"./index-DXS7sV1z.js";import{S as on,_ as ln}from"./index-B6Px5Zsy.js";import{i as Z}from"./axios-CJ9BA_kU.js";import{A as sn,m as an,p as dn}from"./providersLogo-B21y_j8w.js";import{D as xe}from"./index-D72LhMDs.js";import{T as je}from"./index-BrDH3D21.js";import{B as Ue}from"./index-4QgiPXjH.js";import{R as We,a as Ge,b as rn}from"./index-Acyj35nL.js";import{a as Je,F as un}from"./index-C_0kcLTz.js";import{I as pt}from"./index-CMxFlBN0.js";import{M as mn,a as cn}from"./index-B5rUPMRV.js";import{E as gn}from"./index-D1sinsPK.js";import{A as vn}from"./index-CSB3YV1W.js";import{I as pn}from"./index-B_YuZ8jP.js";import{a as fn}from"./index3-BcPG5EUD.js";import{C as yn,a as bn}from"./index-8GRSaPIO.js";import{C as $n}from"./index-B8zzSAGW.js";import{T as hn}from"./index-CnxRH5pL.js";import{S as _n,a as Vn,T as kn}from"./index-Dux77sNi.js";import{a as Rn,C as wn}from"./index-B759YLdZ.js";import{I as Cn}from"./index-UCVneOpI.js";import{U as Mn}from"./index-DRn_ga-8.js";import{D as ie}from"./plugin-B5R79Vlx.js";import"./index-BETGohS9.js";import"./index-DzkKO6NI.js";import"./dialog-PoqBqSN3.js";import"./dep-6fcd3856-Cz0QyasC.js";import"./form-model-D7vMpeRS.js";import"./index-D-r8dcwf.js";import"./fake-arrow-BlzFYW_D.js";import"./index-dZpqtV39.js";import"./index-CcWg68ni.js";import"./index-C9gXpOL8.js";import"./dep-c171b67b-De9IqgSv.js";import"./index-CSPrXbDL.js";import"./delete-BLzWRfi-.js";import"./dep-fe7c938f-B9a3GaMi.js";const ze=`/**
 * Toonflow AI供应商模板
 * @version 2.0
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage" //单图参考
  | "startEndRequired" //首尾帧（两张都得有）
  | "endFrameOptional" //首尾帧（尾帧可选）
  | "startFrameOptional" //首尾帧（首帧可选）
  | "text" //文本
  | (\`videoReference:\${number}\` | \`imageReference:\${number}\` | \`audioReference:\${number}\`)[]; //多参考（数字代表限制数量）

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string; //唯一ID，作为文件名存储用户磁盘上，禁止符号
  version: string; //版本号，格式为x.y，需遵守语义化版本控制
  name: string; //供应商名称
  author: string; //作者
  description?: string; //描述，支持Markdown格式
  icon?: string; //图标，仅支持Base64格式，建议尺寸为128x128像素
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: \`\${number}:\${number}\`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any; // HTTP请求库
declare const logger: (msg: string) => void; // 日志函数
declare const jsonwebtoken: any; // JWT处理库
declare const zipImage: (base64: string, size: number) => Promise<string>; // 图片压缩函数，返回有头base64字符串
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>; // 图片分辨率调整函数，返回有头base64字符串
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>; // 图片合成函数，返回有头base64字符串
declare const urlToBase64: (url: string) => Promise<string>; // URL转Base64函数，返回有头base64字符串
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>; // 轮询函数，fn为异步函数，interval为轮询间隔，timeout为超时时间，返回fn的结果
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel) => any; //文本模型
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>; //图片模型，返回有头base64字符串
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>; //视频模型，返回有头base64字符串
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>; //（暂未开放）语音模型，返回有头base64字符串
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>; //检查更新函数，返回是否有更新和最新版本号和更公告（支持Markdown格式）
  updateVendor?: () => Promise<string>; //更新函数，返回最新的代码文本
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "bull",
  version: "2.0",
  author: "Toonflow",
  name: "空模板",
  description: "## OpenAI标准格式接口，可修改请求地址并手动添加模型。",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "示例：https://api.openai.com/v1" },
  ],
  inputValues: { apiKey: "", baseUrl: "https://api.openai.com/v1" },
  models: [{ name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false }],
};

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\\s+/i, "");
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  return "";
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  return "";
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "## 新版本更新公告" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

// 这行代码用于确保当前文件被识别为模块，避免全局变量冲突
export {};

/**
 * ============================================================
 * AI 代码生成指南
 * ============================================================
 *
 * 【概述】
 * 本文件是 Toonflow AI 供应商适配模板。AI 在生成新供应商适配代码时，
 * 必须严格遵守以下规则，并要求用户提供目标平台的 curl 调用示例或 API 文档信息作为输入依据。
 *
 * 【前置要求】
 * 在生成代码前，请向用户索要以下信息（至少其一）：
 *   1. 目标 API 的 curl 请求示例（包含请求地址、Headers、Body 结构、响应结构）
 *   2. 目标 API 的官方文档链接或文档截图/文本内容
 *   3. 需要适配的模型类型（text / image / video / tts）及其能力说明
 * 没有足够信息时，应主动追问，不要凭空编造 API 结构。
 *
 * 【代码规则】
 *
 * 1. 禁止引入任何外部包
 *    不可使用 import / require，仅能使用本文件「全局声明」区域中已声明的方法和对象，
 *    包括：axios、logger、jsonwebtoken、zipImage、zipImageResolution、mergeImages、
 *    urlToBase64、pollTask，以及 createOpenAI、createDeepSeek、createZhipu、createQwen、
 *    createAnthropic、createOpenAICompatible、createXai、createMinimax、
 *    createGoogleGenerativeAI 等 AI SDK 工厂函数。
 *
 * 2. 禁止在 exports.* 函数外部声明离散的全大写常量
 *    错误示例：const API_URL = "https://..."; const MAX_RETRY = 3;
 *    如果确实需要可配置的常量值，必须将其声明在 vendor.inputValues 中，
 *    通过 vendor.inputValues.xxx 访问，让用户可在界面上配置。
 *    如果是纯逻辑内部使用的临时变量，应内联在对应的 exports.* 函数体内部，使用小驼峰命名。
 *
 * 3. 逻辑尽量聚合在 exports.* 对应的函数内部
 *    每个适配函数（textRequest / imageRequest / videoRequest / ttsRequest）
 *    应自包含，将请求构造、发送、轮询、结果解析等逻辑写在函数体内，避免拆分出大量外部辅助函数。
 *    如果多个函数确实存在公共逻辑（如签名计算、Token 生成、请求头构造），
 *    可提取为文件内的小驼峰命名函数，放在「适配器函数」区块之前的「辅助工具」区块中，
 *    且不可使用全大写命名。
 *
 * 4. 命名规范
 *    所有变量、函数一律使用小驼峰命名（camelCase），禁止使用 UPPER_SNAKE_CASE。
 *
 * 5. 不需要重新声明类型
 *    本文件顶部已完整定义了所有接口和类型（VendorConfig、ImageConfig、VideoConfig、
 *    TTSConfig、TextModel、ImageModel、VideoModel、TTSModel、ReferenceList、PollResult 等），
 *    AI 生成代码时直接使用即可，不要重复声明。
 *
 * 6. 返回值规范
 *    - textRequest(model)：返回 AI SDK 的 chat model 实例（通过 createOpenAI 等工厂函数创建）。
 *    - imageRequest(config, model)：返回有头 base64 字符串（如 "data:image/png;base64,..."）。
 *      config.referenceList 为 Extract<ReferenceList, { type: "image" }>[] 类型，
 *      每个引用条目均为 base64 形式（sourceType 固定为 "base64"）。
 *    - videoRequest(config, model)：返回有头 base64 字符串（如 "data:video/mp4;base64,..."）。
 *      config.referenceList 为 ReferenceList[] 类型，可包含 image / video / audio 三种引用，
 *      每个引用条目均为 base64 形式（sourceType 固定为 "base64"）。
 *      config.mode 为当前激活的视频模式数组，需根据 mode 决定如何使用 referenceList。
 *    - ttsRequest(config, model)：返回有头 base64 字符串（如 "data:audio/mp3;base64,..."）。
 *      config.referenceList 为 Extract<ReferenceList, { type: "audio" }>[] 类型（音频参考）。
 *    当 API 返回的是 URL 而非二进制数据时，使用 urlToBase64(url) 转换。
 *
 * 7. ReferenceList 与 VideoMode 说明
 *    ReferenceList 是统一的多媒体引用类型，每个条目包含：
 *      - type: "image" | "audio" | "video"（媒体类型）
 *      - sourceType: "base64"（当前模板固定为 base64）
 *      - base64（对应的数据）
 *
 *    VideoMode 定义了视频模型支持的输入模式：
 *      - "text"：纯文本生成视频
 *      - "singleImage"：单张首帧图片
 *      - "startEndRequired"：首尾帧（两张都必须提供）
 *      - "endFrameOptional"：首尾帧（尾帧可选）
 *      - "startFrameOptional"：首尾帧（首帧可选）
 *      - 数组形式如 ["imageReference:9", "videoReference:3", "audioReference:3"]：
 *        多模态参考模式，数字表示该类型的最大数量限制。
 *
 *    在 videoRequest 中，config.mode 表示当前选择的模式，需根据其值决定：
 *      - 如何从 config.referenceList 中提取对应类型的引用
 *      - 如何构造 API 请求体中的图片/视频/音频参数
 *
 * 8. 异步任务处理
 *    对于视频生成等需要轮询的异步任务，使用全局的 pollTask 函数：
 *    const result = await pollTask(async () => {
 *      const resp = await axios.get(...);
 *      if (resp.data.status === "SUCCESS") return { completed: true, data: resp.data.url };
 *      if (resp.data.status === "FAILED") return { completed: true, error: resp.data.message };
 *      return { completed: false };
 *    }, 5000, 600000); // 每5秒轮询，10分钟超时
 *    if (result.error) throw new Error(result.error);
 *    return await urlToBase64(result.data!);
 *
 * 9. 错误处理
 *    在每个函数开头校验必需参数（如 API Key），缺失时使用 throw new Error("...") 抛出。
 *    API 请求失败时，从响应中提取有意义的错误信息抛出，不要吞掉异常。
 *
 * 10. 日志输出
 *     在关键步骤使用 logger("...") 输出日志（如"开始提交任务"、"任务ID: xxx"、"轮询中..."），
 *     便于调试。
 *
 * 11. vendor 配置填写
 *     - id：纯英文小写，作为文件名使用，禁止特殊符号和空格。
 *     - version：语义化版本格式 "x.y"。
 *     - inputs：根据目标 API 所需的认证信息配置（API Key、Secret、请求地址等）。
 *     - models：根据目标平台支持的模型列表填写，注意正确设置 type 和各模型特有字段。
 *       - VideoModel 的 mode 对应 API 支持的输入模式（参见规则 7 的 VideoMode 说明）。
 *       - VideoModel 的 audio 字段：true（始终生成音频）、false（不生成）、"optional"（用户可选）。
 *       - VideoModel 的 durationResolutionMap 对应各时长下可选的分辨率。
 *       - VideoModel 的 associationSkills 可选，用于描述模型的特殊能力。
 *       - ImageModel 的 mode 对应 API 支持的生图模式（"text" 纯文本、"singleImage" 单图参考、"multiReference" 多图参考）。
 *       - TTSModel 的 voices 对应可选的音色列表。
 *
 * 12. 图片处理
 *     - 需要压缩图片体积时使用 zipImage(base64, maxSizeKB)。
 *     - 需要调整图片分辨率时使用 zipImageResolution(base64, width, height)。
 *     - 需要将多张图片拼合为一张时使用 mergeImages(base64Arr, maxSize)。
 *     - 以上函数均接收和返回有头 base64 字符串。
 *
 * 13. 文件结构
 *     生成的代码必须保持本模板的整体结构：
 *     类型定义区 → 全局声明区 → 供应商配置区 → [辅助工具区（可选）] → 适配器函数区 → 导出区
 *     不要打乱顺序，不要删除已有的结构注释分隔线。
 *     辅助工具区用于放置多个适配器函数共享的小驼峰命名辅助函数（如 getHeaders、getBaseUrl）。
 *
 * 14. 导出规范
 *     必须导出以下字段（通过 exports.xxx = xxx 赋值）：
 *       - exports.vendor（必须）
 *       - exports.textRequest（必须）
 *       - exports.imageRequest（必须）
 *       - exports.videoRequest（必须）
 *       - exports.ttsRequest（必须）
 *       - exports.checkForUpdates（可选）
 *       - exports.updateVendor（可选）
 *     未实现的适配器函数保留空实现（return ""），不可省略导出。
 *     文件末尾必须包含 export {}; 以确保文件被识别为模块。
 *
 * 【生成流程】
 * 当用户请求生成新的供应商适配时：
 *   1. 确认用户已提供 curl 示例或 API 文档。
 *   2. 分析 API 的认证方式、端点地址、请求/响应结构。
 *   3. 基于本模板结构，填充 vendor 配置和对应的适配器函数。
 *   4. 根据当前模板的 ReferenceList 定义，按 base64 形式构造和消费 referenceList。
 *   5. 仅实现用户需要的模型类型，未用到的函数保留空实现（return ""）。
 *   6. 生成完整可用的代码，确保无语法错误、无遗漏导出。
 */
`,In={class:"textTestDialog"},Tn={key:0,class:"emptyHint"},An={class:"bubble"},xn={class:"role"},Un={key:0,class:"content"},Bn={key:0,class:"thinkContent"},Pn={key:1,class:"cursor"},Sn={key:1,class:"content"},Nn={class:"inputArea"},Fn={class:"inputActions"},Ln={class:"hint"},Dn={class:"btns"},On=$e({__name:"TextModelTest",props:He({vendorId:{},modelName:{}},{modelVisible:{type:Boolean},modelVisibleModifiers:{}}),emits:["update:modelVisible"],setup(I){const J=I,D=Ke(I,"modelVisible"),U=y([]),P=y(""),b=y(!1),S=y(null);function E(){Ee(()=>{S.value&&(S.value.scrollTop=S.value.scrollHeight)})}async function h(){var x,O,K;const f=P.value.trim();if(!f||b.value)return;U.value.push({role:"user",content:f}),P.value="",b.value=!0;const $={role:"assistant",content:"",loading:!0};U.value.push($),E();try{const r=U.value.slice(0,-1).map(N=>({role:N.role,content:N.content})),{data:q}=await Z.post("/setting/vendorConfig/modelTest/textTest",{modelName:J.modelName,id:J.vendorId,messages:r});$.content=typeof q=="string"?q:(q==null?void 0:q.content)??JSON.stringify(q),$.thinking=(q==null?void 0:q.thinking)??void 0,$.loading=!1}catch(r){const q=((O=(x=r==null?void 0:r.response)==null?void 0:x.data)==null?void 0:O.message)||((K=r==null?void 0:r.response)==null?void 0:K.data)||(r==null?void 0:r.message)||String(r);$.content=`❌ ${typeof q=="string"?q:JSON.stringify(q)}`,$.loading=!1}finally{b.value=!1,E()}}function V(){U.value=[]}function v(){U.value=[],P.value="",b.value=!1}return(f,$)=>{const x=ne("i-thinking-problem"),O=je,K=Ue,r=ne("i-send"),q=xe;return a(),B(q,{placement:"center",width:"60vw",visible:D.value,"onUpdate:visible":$[1]||($[1]=N=>D.value=N),header:f.$t("settings.vendor.test.textTitle")+" - "+I.modelName,footer:!1,onClosed:v},{default:s(()=>[d("div",In,[d("div",{class:"messageList",ref_key:"messageListRef",ref:S},[t(U).length===0?(a(),m("div",Tn,c(f.$t("settings.vendor.test.textEmptyHint")),1)):A("",!0),(a(!0),m(T,null,G(t(U),(N,w)=>(a(),m("div",{key:w,class:Ae(["messageItem",N.role])},[d("div",An,[d("div",xn,c(N.role==="user"?f.$t("settings.vendor.test.you"):f.$t("settings.vendor.test.assistant")),1),N.role==="assistant"?(a(),m("div",Un,[N.thinking?(a(),m("span",Bn,[o(x,{theme:"outline",size:"14"}),R(" "+c(N.thinking),1)])):A("",!0),d("span",null,c(N.content),1),N.loading?(a(),m("span",Pn,"▌")):A("",!0)])):(a(),m("div",Sn,c(N.content),1))])],2))),128))],512),d("div",Nn,[o(O,{modelValue:t(P),"onUpdate:modelValue":$[0]||($[0]=N=>L(P)?P.value=N:null),placeholder:f.$t("settings.vendor.test.textInputPlaceholder"),autosize:{minRows:2,maxRows:5},disabled:t(b),onKeydown:gt(le(h,["ctrl","exact"]),["enter"])},null,8,["modelValue","placeholder","disabled","onKeydown"]),d("div",Fn,[d("span",Ln,"Ctrl + Enter "+c(f.$t("settings.vendor.test.send")),1),d("div",Dn,[o(K,{variant:"outline",size:"small",disabled:t(b)||t(U).length===0,onClick:V},{default:s(()=>[R(c(f.$t("settings.vendor.test.clearHistory")),1)]),_:1},8,["disabled"]),o(K,{theme:"primary",size:"small",loading:t(b),disabled:!t(P).trim(),onClick:h},{icon:s(()=>[o(r,{theme:"outline"})]),default:s(()=>[R(" "+c(f.$t("settings.vendor.test.send")),1)]),_:1},8,["loading","disabled"])])])])])]),_:1},8,["visible","header"])}}}),qn=he(On,[["__scopeId","data-v-d6a4bd65"]]),zn={class:"imageTestDialog"},En={class:"modeBar"},Kn={class:"inputSection"},Hn={key:0,class:"uploadRow"},jn=["src"],Wn={class:"uploadText"},Gn={class:"uploadHint"},Jn={key:0,class:"resultSection"},Yn={class:"resultLabel"},Zn={class:"resultImg"},Xn=["src"],Qn={key:1,class:"loadingSection"},eo={class:"dialogFooter"},to=$e({__name:"ImageModelTest",props:He({vendorId:{},modelName:{},supportedModes:{}},{modelVisible:{type:Boolean},modelVisibleModifiers:{}}),emits:["update:modelVisible"],setup(I){const J=Ke(I,"modelVisible"),D=I,U=[{value:"text",label:$t("settings.vendor.test.textToImage")},{value:"singleImage",label:$t("settings.vendor.test.imageToImage")},{value:"multiReference",label:$t("settings.vendor.test.multiRef")}],P=ue(()=>U.filter(w=>D.supportedModes.includes(w.value))),b=y("text");ce(()=>D.supportedModes,w=>{w.length>0&&!w.includes(b.value)&&(b.value=w[0])},{immediate:!0}),ce(b,()=>{E.value=null,h.value="",f.value=""});const S=y(""),E=y(null),h=y(""),V=y(null),v=y(!1),f=y(""),$=ue(()=>v.value?!1:b.value==="text"?!!S.value.trim():b.value==="singleImage"||b.value==="multiReference"?!!E.value:!1);function x(){var w;(w=V.value)==null||w.click()}function O(w){var i;const C=(i=w.target.files)==null?void 0:i[0];C&&(E.value=C,h.value=URL.createObjectURL(C),w.target.value="")}function K(w){var i,u;const C=(u=(i=w.dataTransfer)==null?void 0:i.files)==null?void 0:u[0];C&&C.type.startsWith("image/")&&(E.value=C,h.value=URL.createObjectURL(C))}const r=w=>new Promise((C,i)=>{const u=new FileReader;u.onload=()=>C(u.result),u.onerror=i,u.readAsDataURL(w)});async function q(){v.value=!0,f.value="";try{const w={modelName:D.modelName,id:D.vendorId},C=S.value.trim();C&&(w.prompt=C),E.value&&(w.imageBase64=await r(E.value));const{data:i}=await Z.post("/setting/vendorConfig/modelTest/imageTest",w);f.value=i,window.$message.success($t("settings.vendor.msg.imageGenSuccess"))}catch(w){window.$message.error(w.message??`${$t("settings.vendor.msg.requestFailed")}`)}finally{v.value=!1}}function N(){S.value="",E.value=null,h.value="",f.value="",v.value=!1}return(w,C)=>{const i=Ge,u=We,F=ne("i-picture"),X=je,oe=Je,Q=vt,z=Ue,pe=ne("i-lightning"),me=xe;return a(),B(me,{placement:"center",width:"56vw",visible:J.value,"onUpdate:visible":C[4]||(C[4]=j=>J.value=j),header:w.$t("settings.vendor.test.imageTitle")+" - "+I.modelName,footer:!1,onClosed:N},{default:s(()=>[d("div",zn,[d("div",En,[o(u,{modelValue:t(b),"onUpdate:modelValue":C[0]||(C[0]=j=>L(b)?b.value=j:null),variant:"default-filled"},{default:s(()=>[(a(!0),m(T,null,G(t(P),j=>(a(),B(i,{key:j.value,value:j.value},{default:s(()=>[R(c(j.label),1)]),_:2},1032,["value"]))),128))]),_:1},8,["modelValue"])]),d("div",Kn,[t(b)==="singleImage"?(a(),m("div",Hn,[d("div",{class:"uploadBox",onClick:x,onDragover:C[1]||(C[1]=le(()=>{},["prevent"])),onDrop:le(K,["prevent"])},[t(h)?(a(),m("img",{key:0,src:t(h),class:"previewImg",alt:"preview"},null,8,jn)):(a(),m(T,{key:1},[o(F,{theme:"outline",size:"32",fill:"var(--td-brand-color)"}),d("p",Wn,c(w.$t("settings.vendor.test.uploadImage")),1),d("p",Gn,c(w.$t("settings.vendor.test.supportFormat")),1)],64))],32),d("input",{ref_key:"imageInputRef",ref:V,type:"file",accept:"image/*",style:{display:"none"},onChange:O},null,544)])):A("",!0),o(oe,{label:w.$t("settings.vendor.test.prompt")},{default:s(()=>[o(X,{modelValue:t(S),"onUpdate:modelValue":C[2]||(C[2]=j=>L(S)?S.value=j:null),placeholder:w.$t("settings.vendor.test.promptPlaceholder"),autosize:{minRows:2,maxRows:4},disabled:t(v)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])]),t(f)?(a(),m("div",Jn,[d("div",Yn,c(w.$t("settings.vendor.test.result")),1),d("div",Zn,[d("img",{src:t(f),alt:"generated"},null,8,Xn)])])):t(v)?(a(),m("div",Qn,[o(Q,{size:"large",text:w.$t("settings.vendor.generating")},null,8,["text"])])):A("",!0),d("div",eo,[o(z,{variant:"outline",onClick:C[3]||(C[3]=j=>J.value=!1)},{default:s(()=>[R(c(w.$t("settings.vendor.test.cancel")),1)]),_:1}),o(z,{theme:"primary",loading:t(v),disabled:!t($),onClick:q},{icon:s(()=>[o(pe,{theme:"outline"})]),default:s(()=>[R(" "+c(w.$t("settings.vendor.test.startTest")),1)]),_:1},8,["loading","disabled"])])])]),_:1},8,["visible","header"])}}}),no=he(to,[["__scopeId","data-v-0d1acb95"]]),oo=["src"],lo={class:"boxText"},so={key:0,class:"optionalTag"},ao=$e({__name:"ImageUploadBox",props:{modelValue:{},optional:{type:Boolean},label:{}},emits:["update:modelValue"],setup(I,{emit:J}){const D=I,U=J,P=y(null),b=y("");ce(()=>D.modelValue,v=>{v?b.value=URL.createObjectURL(v):b.value=""});function S(){var v;(v=P.value)==null||v.click()}function E(v){var $;const f=(($=v.target.files)==null?void 0:$[0])??null;U("update:modelValue",f),v.target.value=""}function h(v){var $,x;const f=((x=($=v.dataTransfer)==null?void 0:$.files)==null?void 0:x[0])??null;f!=null&&f.type.startsWith("image/")&&U("update:modelValue",f)}function V(){U("update:modelValue",null)}return(v,f)=>{const $=ne("i-picture"),x=ne("i-close");return a(),m("div",{class:Ae(["imageUploadBox",{optional:I.optional,hasFile:!!I.modelValue}]),onClick:S,onDragover:f[0]||(f[0]=le(()=>{},["prevent"])),onDrop:le(h,["prevent"])},[I.modelValue?(a(),m("img",{key:0,src:t(b),class:"preview",alt:"preview"},null,8,oo)):(a(),m(T,{key:1},[o($,{theme:"outline",size:"26",fill:"var(--td-brand-color)"}),d("p",lo,c(I.label||v.$t("settings.vendor.test.uploadImage")),1),I.optional?(a(),m("p",so,c(v.$t("settings.vendor.test.optional")),1)):A("",!0)],64)),I.modelValue?(a(),m("button",{key:2,class:"clearBtn",onClick:le(V,["stop"])},[o(x,{theme:"outline",size:"12"})])):A("",!0),d("input",{ref_key:"inputRef",ref:P,type:"file",accept:"image/*",style:{display:"none"},onChange:E},null,544)],34)}}}),ve=he(ao,[["__scopeId","data-v-99cf3305"]]),io=["src"],ro={class:"boxText"},uo=$e({__name:"VideoUploadBox",props:{modelValue:{},label:{}},emits:["update:modelValue"],setup(I,{emit:J}){const D=I,U=J,P=y(null),b=y("");ce(()=>D.modelValue,v=>{v?b.value=URL.createObjectURL(v):b.value=""});function S(){var v;(v=P.value)==null||v.click()}function E(v){var $;const f=(($=v.target.files)==null?void 0:$[0])??null;U("update:modelValue",f),v.target.value=""}function h(v){var $,x;const f=((x=($=v.dataTransfer)==null?void 0:$.files)==null?void 0:x[0])??null;f!=null&&f.type.startsWith("video/")&&U("update:modelValue",f)}function V(){U("update:modelValue",null)}return(v,f)=>{const $=ne("i-video-one"),x=ne("i-close");return a(),m("div",{class:Ae(["videoUploadBox",{hasFile:!!I.modelValue}]),onClick:S,onDragover:f[0]||(f[0]=le(()=>{},["prevent"])),onDrop:le(h,["prevent"])},[I.modelValue&&t(b)?(a(),m("video",{key:0,src:t(b),class:"preview",muted:""},null,8,io)):(a(),m(T,{key:1},[o($,{theme:"outline",size:"26",fill:"var(--td-brand-color)"}),d("p",ro,c(I.label||v.$t("settings.vendor.test.uploadVideo")),1)],64)),I.modelValue?(a(),m("button",{key:2,class:"clearBtn",onClick:le(V,["stop"])},[o(x,{theme:"outline",size:"12"})])):A("",!0),d("input",{ref_key:"inputRef",ref:P,type:"file",accept:"video/*",style:{display:"none"},onChange:E},null,544)],34)}}}),mo=he(uo,[["__scopeId","data-v-f2dd17b6"]]),co={class:"boxText fileName"},go={class:"boxText"},vo=$e({__name:"AudioUploadBox",props:{modelValue:{},label:{}},emits:["update:modelValue"],setup(I,{emit:J}){const D=J,U=y(null);function P(){var h;(h=U.value)==null||h.click()}function b(h){var v;const V=((v=h.target.files)==null?void 0:v[0])??null;D("update:modelValue",V),h.target.value=""}function S(h){var v,f;const V=((f=(v=h.dataTransfer)==null?void 0:v.files)==null?void 0:f[0])??null;V!=null&&V.type.startsWith("audio/")&&D("update:modelValue",V)}function E(){D("update:modelValue",null)}return(h,V)=>{const v=ne("i-music-one"),f=ne("i-close");return a(),m("div",{class:Ae(["audioUploadBox",{hasFile:!!I.modelValue}]),onClick:P,onDragover:V[0]||(V[0]=le(()=>{},["prevent"])),onDrop:le(S,["prevent"])},[I.modelValue?(a(),m(T,{key:0},[o(v,{theme:"filled",size:"26",fill:"var(--td-success-color)"}),d("p",co,c(I.modelValue.name),1)],64)):(a(),m(T,{key:1},[o(v,{theme:"outline",size:"26",fill:"var(--td-brand-color)"}),d("p",go,c(I.label||h.$t("settings.vendor.test.uploadAudio")),1)],64)),I.modelValue?(a(),m("button",{key:2,class:"clearBtn",onClick:le(E,["stop"])},[o(f,{theme:"outline",size:"12"})])):A("",!0),d("input",{ref_key:"inputRef",ref:U,type:"file",accept:"audio/*",style:{display:"none"},onChange:b},null,544)],34)}}}),po=he(vo,[["__scopeId","data-v-3928fb29"]]),fo={class:"videoTestDialog"},yo={class:"modeBar"},bo={class:"modeLabel"},$o={key:0,class:"modeDesc"},ho={key:1,class:"inputSection"},_o={class:"uploadRow"},Vo={class:"frameRow"},ko={class:"frameRow"},Ro={class:"frameRow"},wo={class:"multiRefSection"},Co={class:"multiRefRow"},Mo={key:2,class:"resultSection"},Io={class:"resultLabel"},To=["src"],Ao={key:3,class:"loadingSection"},xo={class:"dialogFooter"},Uo=$e({__name:"VideoModelTest",props:He({vendorId:{},modelName:{},rawModes:{}},{modelVisible:{type:Boolean},modelVisibleModifiers:{}}),emits:["update:modelVisible"],setup(I){const J=I,D=Ke(I,"modelVisible"),U={text:{label:$t("settings.vendor.test.textToVideo"),desc:$t("settings.vendor.test.textToVideoDesc")},singleImage:{label:$t("settings.vendor.test.singleImageMode"),desc:$t("settings.vendor.test.singleImageDesc")},startEndRequired:{label:$t("settings.vendor.startEndRequired"),desc:$t("settings.vendor.test.startEndRequiredDesc")},endFrameOptional:{label:$t("settings.vendor.endFrameOptional"),desc:$t("settings.vendor.test.endFrameOptionalDesc")},startFrameOptional:{label:$t("settings.vendor.startFrameOptional"),desc:$t("settings.vendor.test.startFrameOptionalDesc")}},P=ue(()=>{const i=[];for(const u of J.rawModes)if(Array.isArray(u)){const F=[];for(const X of u){const oe=String(X).match(/^(videoReference|imageReference|audioReference):(\d+)$/);oe&&F.push({type:oe[1],count:Number(oe[2])})}if(F.length>0){const X=F.map(oe=>`${oe.type==="imageReference"?$t("settings.vendor.imageRef"):oe.type==="videoReference"?$t("settings.vendor.videoRef"):$t("settings.vendor.audioRef")}×${oe.count}`).join(" + ");i.push({key:JSON.stringify(u),label:X,desc:`${$t("settings.vendor.test.multiRefDesc")}: ${X}`,refs:F})}}else{const F=U[String(u)];F&&i.push({key:String(u),label:F.label,desc:F.desc})}return i}),b=y("");ce(P,i=>{var u;i.length>0&&!i.find(F=>F.key===b.value)&&(b.value=((u=i[0])==null?void 0:u.key)??"")},{immediate:!0}),ce(b,()=>{O(),x.value=""});const S=ue(()=>P.value.find(i=>i.key===b.value)??null),E=ue(()=>{var i;return((i=S.value)==null?void 0:i.refs)??[]}),h=y(""),V=y(Array(30).fill(null)),v=y(Array(30).fill(null)),f=y(Array(30).fill(null)),$=y(!1),x=y("");function O(){V.value=Array(30).fill(null),v.value=Array(30).fill(null),f.value=Array(30).fill(null)}function K(i){return i.type==="imageReference"?`${$t("settings.vendor.imageRef")} (×${i.count})`:i.type==="videoReference"?`${$t("settings.vendor.videoRef")} (×${i.count})`:`${$t("settings.vendor.audioRef")} (×${i.count})`}function r(i){return new Promise((u,F)=>{const X=new FileReader;X.onload=()=>u(X.result),X.onerror=F,X.readAsDataURL(i)})}function q(i=""){return i.startsWith("image/")?"image":i.startsWith("video/")?"video":i.startsWith("audio/")?"audio":""}async function N(i){const u=(i||[]).filter(Boolean);return Promise.all(u.map(async F=>({type:q(F.type),base64:await r(F)})))}async function w(){$.value=!0,x.value="";try{const i={modelName:J.modelName,id:J.vendorId,mode:b.value,...h.value.trim()?{prompt:h.value.trim()}:{},images:await N(V.value.filter(Boolean)),videos:await N(v.value.filter(Boolean)),audios:await N(f.value.filter(Boolean))},{data:u}=await Z.post("/setting/vendorConfig/modelTest/videoTest",i,{timeout:30*60*1e3});x.value=u,window.$message.success($t("settings.vendor.msg.videoGenSuccess"))}catch(i){window.$message.error((i==null?void 0:i.message)??`${$t("settings.vendor.msg.requestFailed")}`)}finally{$.value=!1}}function C(){h.value="",O(),x.value="",$.value=!1}return(i,u)=>{const F=Ge,X=We,oe=pt,Q=je,z=Je,pe=vt,me=Ue,j=ne("i-lightning"),_e=xe;return a(),B(_e,{placement:"center",width:"58vw",visible:D.value,"onUpdate:visible":u[15]||(u[15]=p=>D.value=p),header:i.$t("settings.vendor.test.videoTitle")+" - "+I.modelName,footer:!1,onClosed:C},{default:s(()=>[d("div",fo,[d("div",yo,[d("div",bo,c(i.$t("settings.vendor.test.selectMode")),1),o(X,{modelValue:t(b),"onUpdate:modelValue":u[0]||(u[0]=p=>L(b)?b.value=p:null),variant:"default-filled"},{default:s(()=>[(a(!0),m(T,null,G(t(P),p=>(a(),B(F,{key:p.key,value:p.key},{default:s(()=>[R(c(p.label),1)]),_:2},1032,["value"]))),128))]),_:1},8,["modelValue"])]),t(S)?(a(),m("div",$o,[o(oe,{name:"info-circle-filled",size:"14px"}),R(" "+c(t(S).desc),1)])):A("",!0),R(" "+c(t(b))+" ",1),t(b)?(a(),m("div",ho,[t(b)==="text"?(a(),B(z,{key:0,label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(Q,{modelValue:t(h),"onUpdate:modelValue":u[1]||(u[1]=p=>L(h)?h.value=p:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:4},disabled:t($)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])):t(b)==="singleImage"?(a(),m(T,{key:1},[o(z,{label:i.$t("settings.vendor.test.referenceImage")},{default:s(()=>[d("div",_o,[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":u[2]||(u[2]=p=>t(V)[0]=p)},null,8,["modelValue"])])]),_:1},8,["label"]),o(z,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(Q,{modelValue:t(h),"onUpdate:modelValue":u[3]||(u[3]=p=>L(h)?h.value=p:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t($)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(b)==="startEndRequired"?(a(),m(T,{key:2},[d("div",Vo,[o(z,{label:i.$t("settings.vendor.test.startFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":u[4]||(u[4]=p=>t(V)[0]=p)},null,8,["modelValue"])]),_:1},8,["label"]),o(z,{label:i.$t("settings.vendor.test.endFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[1],"onUpdate:modelValue":u[5]||(u[5]=p=>t(V)[1]=p)},null,8,["modelValue"])]),_:1},8,["label"])]),o(z,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(Q,{modelValue:t(h),"onUpdate:modelValue":u[6]||(u[6]=p=>L(h)?h.value=p:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t($)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(b)==="endFrameOptional"?(a(),m(T,{key:3},[d("div",ko,[o(z,{label:i.$t("settings.vendor.test.startFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":u[7]||(u[7]=p=>t(V)[0]=p)},null,8,["modelValue"])]),_:1},8,["label"]),o(z,{label:i.$t("settings.vendor.test.endFrameOptional")},{default:s(()=>[o(ve,{modelValue:t(V)[1],"onUpdate:modelValue":u[8]||(u[8]=p=>t(V)[1]=p),optional:!0},null,8,["modelValue"])]),_:1},8,["label"])]),o(z,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(Q,{modelValue:t(h),"onUpdate:modelValue":u[9]||(u[9]=p=>L(h)?h.value=p:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t($)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(b)==="startFrameOptional"?(a(),m(T,{key:4},[d("div",Ro,[o(z,{label:i.$t("settings.vendor.test.startFrameOptional")},{default:s(()=>[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":u[10]||(u[10]=p=>t(V)[0]=p),optional:!0},null,8,["modelValue"])]),_:1},8,["label"]),o(z,{label:i.$t("settings.vendor.test.endFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[1],"onUpdate:modelValue":u[11]||(u[11]=p=>t(V)[1]=p)},null,8,["modelValue"])]),_:1},8,["label"])]),o(z,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(Q,{modelValue:t(h),"onUpdate:modelValue":u[12]||(u[12]=p=>L(h)?h.value=p:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t($)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(b).startsWith("[")?(a(),m(T,{key:5},[o(z,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(Q,{modelValue:t(h),"onUpdate:modelValue":u[13]||(u[13]=p=>L(h)?h.value=p:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),disabled:t($)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"]),d("div",wo,[(a(!0),m(T,null,G(t(E),(p,se)=>(a(),B(z,{key:se,label:K(p)},{default:s(()=>[d("div",Co,[p.type==="imageReference"?(a(!0),m(T,{key:0},G(p.count,H=>(a(),B(ve,{key:H,modelValue:t(V)[se*10+H-1],"onUpdate:modelValue":de=>t(V)[se*10+H-1]=de,label:`${i.$t("settings.vendor.test.image")} ${H}`},null,8,["modelValue","onUpdate:modelValue","label"]))),128)):p.type==="videoReference"?(a(!0),m(T,{key:1},G(p.count,H=>(a(),B(mo,{key:H,modelValue:t(v)[se*10+H-1],"onUpdate:modelValue":de=>t(v)[se*10+H-1]=de,label:`${i.$t("settings.vendor.test.video")} ${H}`},null,8,["modelValue","onUpdate:modelValue","label"]))),128)):p.type==="audioReference"?(a(!0),m(T,{key:2},G(p.count,H=>(a(),B(po,{key:H,modelValue:t(f)[se*10+H-1],"onUpdate:modelValue":de=>t(f)[se*10+H-1]=de,label:`${i.$t("settings.vendor.test.audio")} ${H}`},null,8,["modelValue","onUpdate:modelValue","label"]))),128)):A("",!0)])]),_:2},1032,["label"]))),128))])],64)):A("",!0)])):A("",!0),t(x)?(a(),m("div",Mo,[d("div",Io,c(i.$t("settings.vendor.test.result")),1),d("video",{src:t(x),controls:"",autoplay:"",loop:"",class:"resultVideo"},null,8,To)])):t($)?(a(),m("div",Ao,[o(pe,{size:"large",text:i.$t("settings.vendor.videoGenerating")},null,8,["text"])])):A("",!0),d("div",xo,[o(me,{variant:"outline",onClick:u[14]||(u[14]=p=>D.value=!1)},{default:s(()=>[R(c(i.$t("settings.vendor.test.cancel")),1)]),_:1}),o(me,{theme:"primary",loading:t($),onClick:w},{icon:s(()=>[o(j,{theme:"outline"})]),default:s(()=>[R(" "+c(i.$t("settings.vendor.test.startTest")),1)]),_:1},8,["loading"])])])]),_:1},8,["visible","header"])}}}),Bo=he(Uo,[["__scopeId","data-v-7a4f4b9a"]]),Po={class:"modelServe"},So={class:"modelList"},No={class:"listFooter"},Fo={class:"listContent"},Lo={key:0,class:"modelParameter"},Do={class:"configuration"},Oo={class:"infoBox ac jb"},qo={class:"idBox"},zo={class:"author"},Eo={class:"vendorNameRow"},Ko={class:"requiredLabel"},Ho={class:"requiredText"},jo={class:"inputHelp"},Wo={key:1,class:"optionalSection"},Go={class:"inputHelp"},Jo={class:"jb ac"},Yo={class:"sectionTitle"},Zo={class:"topInfo jb ac"},Xo={class:"modelCardNameWrap"},Qo={class:"modelCardName"},el={class:"actionBtns"},tl={class:"tags"},nl={class:"updateAction"},ol={class:"addBox"},ll={style:{display:"flex","flex-direction":"column","align-items":"flex-start",gap:"0"}},sl={key:0,style:{border:"1px solid #ddd","border-radius":"6px",padding:"6px 12px","margin-top":"6px"}},al={class:"drmEditor"},il={class:"drmHeader"},dl={class:"drmHeaderLabel"},rl={class:"drmHeaderLabel"},ul={class:"drmRowIndex"},ml={class:"data"},cl={key:0,class:"linkAdd"},gl={style:{"margin-top":"10px","text-align":"right",width:"100%"}},vl={key:1,class:"importAdd"},pl={class:"dragIcon"},fl={class:"uploadText"},yl={class:"uploadHint"},bl={key:2,class:"codeAdd"},$l={class:"editorToolbar"},hl={class:"editorInfo"},_l={class:"editorActions"},Vl={class:"editorWrapper"},kl=700,Rl=$e({__name:"vendorConfig",setup(I){const{themeSetting:J}=Xt(Qt()),D={text:"settings.vendor.textModel",image:"settings.vendor.imageModel",video:"settings.vendor.videoModel"},U={singleImage:"settings.vendor.singleImage",multiReference:"settings.vendor.multiReference",startEndRequired:"settings.vendor.startEndRequired",endFrameOptional:"settings.vendor.endFrameOptional",startFrameOptional:"settings.vendor.startFrameOptional",audioReference:"settings.vendor.audioRef",videoReference:"settings.vendor.videoRef",imageReference:"settings.vendor.imageRef"};function P(e){return D[e]||e}function b(e,n){if(e==="text")return $t(n==="image"?"settings.vendor.textToImage":"settings.vendor.textToVideo");const g=String(e).match(/^(videoReference|imageReference|audioReference):(\d+)$/);if(g){const k=U[g[1]];return k?`${$t(k)} ×${g[2]}`:e}return U[e]?$t(U[e]):e}const S={fontSize:14,automaticLayout:!0,tabSize:2,scrollBeyondLastLine:!1,formatOnPaste:!0,formatOnType:!0},E=[{value:"text",label:"settings.vendor.textModel"},{value:"image",label:"settings.vendor.imageModel"},{value:"video",label:"settings.vendor.videoModel"}],h=[{label:"settings.vendor.textToImage",value:"text"},{label:"settings.vendor.singleImage",value:"singleImage"},{label:"settings.vendor.multiReference",value:"multiReference"}],V=[{label:"settings.vendor.singleImage",value:"singleImage"},{label:"settings.vendor.startEndRequired",value:"startEndRequired"},{label:"settings.vendor.endFrameOptional",value:"endFrameOptional"},{label:"settings.vendor.startFrameOptional",value:"startFrameOptional"},{label:"settings.vendor.textToVideo",value:"text"},{label:"settings.vendor.multiReferenceMode",value:"multiReference"}],v=[{label:"settings.vendor.videoRef",value:"videoReference"},{label:"settings.vendor.imageRef",value:"imageReference"},{label:"settings.vendor.audioRef",value:"audioReference"}],f=[{label:"settings.vendor.audioOptional",value:"optional"},{label:"settings.vendor.audioOnly",value:!0},{label:"settings.vendor.noAudio",value:!1}],$=y([]),x=y(!1);async function O(){x.value=!0;try{const e=await Z.post("/setting/vendorConfig/getVendorList");$.value=e.data.map(n=>({...n,enable:n.enable})),$.value.length&&!$.value.some(n=>n.id===K.value)&&(K.value=$.value[0].id)}catch(e){window.$message.error(`${$t("settings.vendor.msg.getVendorListFailed")}${e.message}`)}finally{x.value=!1,Ee(()=>{me.value=Ce.value,pe.value=!0})}}en(()=>{O()});const K=y(),r=ue(()=>$.value.find(e=>e.id===K.value)),q=ue(()=>{var e,n;return((e=r.value)==null?void 0:e.models)||((n=r.value)==null?void 0:n.model)||[]}),N=ue(()=>{var e,n;return((n=(e=r.value)==null?void 0:e.inputs)==null?void 0:n.filter(g=>g.required))||[]}),w=ue(()=>{var e,n;return((n=(e=r.value)==null?void 0:e.inputs)==null?void 0:n.filter(g=>!g.required))||[]}),C=y(!1),i=y(!1),u=y(ze),F=y(null),X=y(!1),oe=y(!1),Q=y(""),z=y(!1),pe=y(!1),me=y("");let j=null,_e=!1;const p=y(null),se=y(!1),H=y(!1),de=y(!1);function Ye(e){return e==="password"?"secured":e==="url"?"link":"edit-1"}function we(e){var n;return((n=e.placeholder)==null?void 0:n.trim())||""}function ft(e){return e?/^(?:data:[^;]+;base64,)?[A-Za-z0-9+/]*={0,2}$/.test(e)&&e.length>0:!1}function yt(e){if(!e.version)return!0;const n=parseFloat(e.version);return isNaN(n)||n<2}function Ze(e){if(!e)return null;const n=an.find(g=>g.pattern.test(e));return n?dn[n.provider]:null}function Xe(e){return{id:e.id,inputValues:e.inputValues}}const Ce=ue(()=>r.value?JSON.stringify(Xe(r.value)):"");function Qe(){j&&clearTimeout(j),j=setTimeout(()=>{bt()},kl)}async function bt(){if(!r.value||!pe.value||x.value)return;const e=Ce.value;if(!(!e||e===me.value)){if(z.value){_e=!0;return}z.value=!0;try{await Z.post("/setting/vendorConfig/updateVendorInputs",Xe(r.value)),me.value=e}catch(n){window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${n.message}`)}finally{z.value=!1,_e&&(_e=!1,Qe())}}}ce(Ce,e=>{!e||!pe.value||x.value||e!==me.value&&Qe()},{flush:"post"}),ce(K,()=>{j&&(clearTimeout(j),j=null),_e=!1,Ee(()=>{me.value=Ce.value})},{flush:"post"}),ce(r,e=>{Q.value=(e==null?void 0:e.name)??""},{immediate:!0});const ht=ue(()=>r.value?Q.value.trim()!==r.value.name:!1);async function et(){if(!r.value)return;const e=Q.value.trim();if(!e){window.$message.error("请填写供应商显示名称");return}oe.value=!0;try{await Z.post("/setting/vendorConfig/updateVendorName",{id:r.value.id,name:e}),window.$message.success("供应商显示名称已更新"),await O()}catch(n){window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${n.message}`)}finally{oe.value=!1}}const Me=y();function _t(){ge.value="importAdd",Me.value=void 0,u.value=ze,C.value=!0,i.value=!1}function Vt(){if(Me.value){const e=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.updateVendorRiskBody"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{e.destroy();const n=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.updateVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndUpdate"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{Z.post("/setting/vendorConfig/updateCode",{id:Me.value,tsCode:u.value}).then(g=>{window.$message.success($t("settings.vendor.msg.updateSuccess")),C.value=!1,i.value=!1,O()}).catch(g=>{window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${g.message}`)}).finally(()=>{n.destroy()})},onClose:()=>n.hide()})},onClose:()=>e.hide()})}else{const e=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.addVendorRiskBody"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{e.destroy();const n=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.addVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndAdd"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{Z.post("/setting/vendorConfig/addVendor",{tsCode:u.value}).then(g=>{window.$message.success($t("settings.vendor.msg.vendorAdded")),C.value=!1,i.value=!1,O()}).catch(g=>{window.$message.error(g.message??`${$t("settings.vendor.msg.addFailed")}`)}).finally(()=>{n.destroy()})},onClose:()=>n.hide()})},onClose:()=>e.hide()})}}const fe=y(!1),ye=y(null),tt=y(null),_=y({name:"",modelName:"",type:"text",think:!1,mode:[],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]});function kt(e="text"){_.value={name:"",modelName:"",type:e,think:!1,mode:[],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]}}function nt(){return r.value?(Array.isArray(r.value.models)||(r.value.models=Array.isArray(r.value.model)?[...r.value.model]:[]),r.value.model=r.value.models,r.value.models):[]}function Rt(){const e=_.value.name.trim(),n=_.value.modelName.trim();if(!e)return window.$message.error($t("settings.vendor.msg.fillDisplayName")),null;if(!n)return window.$message.error($t("settings.vendor.msg.fillModelId")),null;if(_.value.type==="text")return{name:e,modelName:n,type:"text",think:_.value.think};if(_.value.type==="image"){const M=_.value.mode;return M.length?{name:e,modelName:n,type:"image",mode:M}:(window.$message.error($t("settings.vendor.msg.selectImageMode")),null)}const g=[..._.value.mode].filter(M=>M!=="multiReference");if(_.value.mixedMode.length>0){const M=_.value.mixedMode.map(W=>{const Y=_.value.mixedModeCount[W]??1;return`${W}:${Y}`});g.push(M)}if(!g.length)return window.$message.error($t("settings.vendor.msg.selectVideoMode")),null;const k=[];for(let M=0;M<_.value.durationResolutionMap.length;M++){const W=_.value.durationResolutionMap[M],Y=W.duration.map(Number).filter(Ve=>Number.isFinite(Ve)&&Ve>0),re=W.resolution.filter(Boolean);if(!Y.length)return window.$message.error(`${$t("settings.vendor.msg.groupPrefix",{n:M+1})}${$t("settings.vendor.msg.addDuration")}`),null;if(!re.length)return window.$message.error(`${$t("settings.vendor.msg.groupPrefix",{n:M+1})}${$t("settings.vendor.msg.addResolution")}`),null;k.push({duration:Y,resolution:re})}return{name:e,modelName:n,type:"video",mode:g,audio:_.value.audio,durationResolutionMap:k}}function wt(){if(!r.value){window.$message.error($t("settings.vendor.msg.selectVendorFirst"));return}ye.value=null,kt("text"),fe.value=!0}async function Ct(){const e=nt();if(!e.length&&!r.value)return;const n=Rt();if(!n)return;if(e.findIndex((k,M)=>ye.value!==null&&M===ye.value?!1:k.modelName===n.modelName)!==-1){window.$message.error($t("settings.vendor.msg.modelIdExists"));return}if(ye.value===null){try{await Z.post("/setting/vendorConfig/addVendorModel",{id:r.value.id,model:n}),window.$message.success($t("settings.vendor.msg.modelAdded")),fe.value=!1,O()}catch(k){window.$message.error(k.message??$t("settings.vendor.msg.operationFailed"))}return}if(ye.value!==null)try{await Z.post("/setting/vendorConfig/upVendorModel",{id:r.value.id,modelName:tt.value,model:n}),window.$message.success($t("settings.vendor.msg.modelUpdated")),fe.value=!1,O()}catch(k){window.$message.error(k.message??$t("settings.vendor.msg.operationFailed"))}}function Mt(e){var g;const n=nt();if(ye.value=n.findIndex(k=>k.modelName===e.modelName),tt.value=e.modelName,e.type==="text"&&(_.value={name:e.name,modelName:e.modelName,type:"text",think:e.think,mode:[],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]}),e.type==="image"&&(_.value={name:e.name,modelName:e.modelName,type:"image",think:!1,mode:[...e.mode],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]}),e.type==="video"){const k=((g=e.durationResolutionMap)==null?void 0:g.length)>0?e.durationResolutionMap.map(re=>({duration:re.duration.map(String),resolution:[...re.resolution]})):[{duration:[],resolution:[]}],M=[];let W=[];const Y={};for(const re of e.mode)if(Array.isArray(re))for(const Ve of re){const be=String(Ve).match(/^(videoReference|imageReference|audioReference):(\d+)$/);be&&(W.push(be[1]),Y[be[1]]=Number(be[2]))}else M.push(re);_.value={name:e.name,modelName:e.modelName,type:"video",think:!1,mode:W.length>0?[...M,"multiReference"]:M,mixedMode:W,mixedModeCount:Y,audio:e.audio,durationResolutionMap:k}}fe.value=!0}function It(e){p.value=e,e.type==="text"?se.value=!0:e.type==="image"?H.value=!0:e.type==="video"&&(de.value=!0)}function Tt(e){if(!r.value)return;const n=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.deleteModelConfirm"),body:`${$t("settings.vendor.msg.deleteModelBody",{name:e})}`,confirmBtn:{content:$t("settings.vendor.msg.confirmDelete"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:async()=>{try{await Z.post("/setting/vendorConfig/delVendorModel",{id:r.value.id,modelName:e}),window.$message.success($t("settings.vendor.msg.modelDeleted")),O()}catch(g){window.$message.error(g.message??$t("settings.vendor.msg.operationFailed"))}finally{n.destroy()}}})}function At(){r.value&&(Me.value=r.value.id,u.value=r.value.code,i.value=!0)}function xt(){if(!r.value)return;const e=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.deleteVendorConfirm"),body:`${$t("settings.vendor.msg.deleteVendorBody",{name:r.value.name})}`,confirmBtn:{content:$t("settings.vendor.msg.confirmDelete"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{var n;Z.post("/setting/vendorConfig/deleteVendor",{id:(n=r.value)==null?void 0:n.id}).then(()=>{var g;window.$message.success($t("settings.vendor.msg.vendorDeleted")),K.value===((g=r.value)==null?void 0:g.id)&&(K.value=void 0),O(),e.destroy()}).catch(g=>{window.$message.error(`${$t("settings.vendor.msg.deleteFailed")}${g.message}`)})}})}function ot(){var e,n;Z.post("/setting/vendorConfig/updateVendorInputs",{id:(e=r.value)==null?void 0:e.id,inputValues:(n=r.value)==null?void 0:n.inputValues}).then(()=>{window.$message.success($t("settings.vendor.msg.vendorConfigUpdated")),O()}).catch(g=>{window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${g.message}`)})}function Ut(e,n){const g=n===1?0:1;Z.post("/setting/vendorConfig/enableVendor",{id:e.id,enable:n}).then(()=>{}).catch(k=>{e.enable=g})}const ge=y("importAdd"),Re=y(""),Ie=y(!1);ce(ge,e=>{e=="codeAdd"?i.value=!0:i.value=!1});function Bt(){if(Ie.value)return;const e=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.linkAddVendorRiskBody"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{e.destroy();const n=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.addVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndAdd"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{const g=qe({fullscreen:!0,attach:"body",preventScrollThrough:!1}),k=setTimeout(()=>{g.hide(),clearTimeout(k)},1e3);Ie.value=!0;try{const{data:M}=await Z.post("/setting/vendorConfig/getCodeByLink",{link:Re.value});if(!M.includes("vendor")){let W=null;M.includes("<html>")?W=ie.alert({theme:"danger",header:"链接返回了一个网页，添加供应商需要返回TS代码，请确认链接是否正确",body:"请勿输入中转站地址，如需使用中转站请修改OpenAI标准接口的baseUrl使用中转站地址",onConfirm:({e:Y})=>{W.hide()}}):ie.alert({theme:"danger",header:"链接返回的内容不正确，添加供应商需要返回TS代码，请确认链接是否正确",onConfirm:({e:Y})=>{W.hide()}});return}M?(Z.post("/setting/vendorConfig/addVendor",{tsCode:M}),window.$message.success($t("settings.vendor.msg.vendorAdded")),C.value=!1,i.value=!1,O()):(window.$message.error($t("settings.vendor.msg.linkAddFailed")),i.value=!1)}catch(M){window.$message.error(`${$t("settings.vendor.msg.addFailed")}${M.message}`)}finally{clearTimeout(k),g.hide(),Ie.value=!1,n.destroy()}},onClose:()=>n.hide()})},onClose:()=>e.hide()})}const lt=y();async function st(e){const n=e.raw;if(!n)return window.$message.error($t("workbench.novel.import.msg.selectFile")),!1;qe(!0);try{const g=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.importAdd"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{g.destroy();const k=ie.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.addVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndAdd"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{const M=new FileReader;M.readAsText(n),M.onload=()=>{const W=M.result;Z.post("/setting/vendorConfig/addVendor",{tsCode:W}).then(Y=>{window.$message.success($t("settings.vendor.msg.vendorAdded")),C.value=!1,i.value=!1,O()}).catch(Y=>{window.$message.error(Y.message??`${$t("settings.vendor.msg.addFailed")}`)}).finally(()=>{k.destroy()})}},onClose:()=>k.hide()})},onClose:()=>g.hide()})}catch{window.$message.error($t("workbench.novel.import.msg.parseFailed"))}finally{qe(!1)}return!1}const Be=y([]);function Pt(){var e;(e=lt.value)==null||e.triggerUpload()}function St(){return Promise.resolve({response:{},status:"success"})}async function Nt(e){var g;const n=(g=e.dataTransfer)==null?void 0:g.files;n&&n.length>0&&await st({raw:n[0]})}function Ft(e){var M;const n=e.target,g=(M=n.files)==null?void 0:M[0];if(!g)return;const k=new FileReader;k.onload=W=>{var Y;u.value=((Y=W.target)==null?void 0:Y.result)||""},k.readAsText(g),n.value=""}return(e,n)=>{var ut,mt,ct;const g=pt,k=Ue,M=sn,W=on,Y=mn,re=cn,Ve=gn,be=vn,ke=pn,ae=Je,Lt=bn,Dt=yn,at=ne("i-plus"),Ot=ne("i-lightning"),qt=ne("i-pencil"),it=ne("i-delete"),Te=hn,zt=$n,dt=un,Et=Vn,Kt=_n,Pe=rn,Se=We,Ne=wn,Fe=Rn,Ht=Cn,rt=kn,Le=xe,De=Ge,jt=Mn,Wt=ne("i-upload-one"),Gt=tn("loading");return a(),m("div",Po,[d("div",So,[d("div",No,[o(k,{block:"",theme:"primary",onClick:_t},{icon:s(()=>[o(g,{name:"add"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.addVendor")),1)]),_:1})]),nn((a(),m("div",Fo,[t($).length>0?(a(),B(re,{key:0,modelValue:t(K),"onUpdate:modelValue":n[1]||(n[1]=l=>L(K)?K.value=l:null),theme:"light"},{default:s(()=>[(a(!0),m(T,null,G(t($),(l,ee)=>(a(),B(Y,{key:ee,value:l.id,onClick:te=>K.value=l.id,style:{position:"relative"}},Oe({default:s(()=>[d("span",null,c(l.name),1),o(W,{modelValue:l.enable,"onUpdate:modelValue":te=>l.enable=te,customValue:[1,0],onClick:n[0]||(n[0]=le(()=>{},["stop"])),onChange:te=>Ut(l,te),style:{position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)","z-index":"10"}},null,8,["modelValue","onUpdate:modelValue","onChange"])]),_:2},[ft(l.icon)?{name:"icon",fn:s(()=>[o(M,{size:"24px",shape:"round",image:l.icon},null,8,["image"])]),key:"0"}:void 0]),1032,["value","onClick"]))),128))]),_:1},8,["modelValue"])):(a(),B(Ve,{key:1,title:e.$t("settings.vendor.noVendor"),style:{"margin-top":"16px"}},null,8,["title"]))])),[[Gt,t(x)]])]),t(r)?(a(),m("div",Lo,[d("div",Do,[o(dt,{data:t(r),labelAlign:"top"},{default:s(()=>[d("div",Oo,[d("span",qo,"#"+c(t(r).id),1),d("span",zo,"@"+c(t(r).author),1)]),yt(t(r))?(a(),B(be,{key:0,theme:"warning",message:e.$t("settings.vendor.msg.vendorNeedsUpdate"),style:{"margin-bottom":"12px"}},null,8,["message"])):A("",!0),o(ae,{label:"供应商显示名称"},{help:s(()=>[...n[27]||(n[27]=[d("span",{class:"inputHelp"},"只修改页面显示名称，不改变供应商 ID 或已配置模型。",-1)])]),default:s(()=>[d("div",Eo,[o(ke,{class:"vendorNameInput",modelValue:t(Q),"onUpdate:modelValue":n[2]||(n[2]=l=>L(Q)?Q.value=l:null),placeholder:"例如：uocode",clearable:"",onKeyup:gt(et,["enter"])},null,8,["modelValue"]),o(k,{theme:"primary",loading:t(oe),disabled:!t(ht),onClick:et},{default:s(()=>[...n[26]||(n[26]=[R("保存名称",-1)])]),_:1},8,["loading","disabled"])])]),_:1}),o(ae,null,{default:s(()=>[o(t(fn),{modelValue:t(r).description,"onUpdate:modelValue":n[3]||(n[3]=l=>t(r).description=l),theme:t(J).mode},null,8,["modelValue","theme"])]),_:1}),(a(!0),m(T,null,G(t(N),l=>(a(),B(ae,{key:l.key,name:l.key},Oe({label:s(()=>[d("span",Ko,[R(c(l.label)+" ",1),n[28]||(n[28]=d("span",{class:"requiredMark"},"*",-1)),d("span",Ho,c(e.$t("settings.vendor.required")),1)])]),default:s(()=>[o(ke,{modelValue:t(r).inputValues[l.key],"onUpdate:modelValue":ee=>t(r).inputValues[l.key]=ee,type:l.type,clearable:"",onBlur:ot},{"prefix-icon":s(()=>[o(g,{name:Ye(l.type)},null,8,["name"])]),_:2},1032,["modelValue","onUpdate:modelValue","type"])]),_:2},[we(l)?{name:"help",fn:s(()=>[d("span",jo,c(we(l)),1)]),key:"0"}:void 0]),1032,["name"]))),128)),t(w).length>0?(a(),m("div",Wo,[o(Dt,null,{default:s(()=>[o(Lt,{value:"optional-inputs",header:e.$t("settings.vendor.optionalSection")},{default:s(()=>[(a(!0),m(T,null,G(t(w),l=>(a(),B(ae,{key:l.key,name:l.key,label:l.label},Oe({default:s(()=>[o(ke,{modelValue:t(r).inputValues[l.key],"onUpdate:modelValue":ee=>t(r).inputValues[l.key]=ee,type:l.type,clearable:"",onBlur:ot},{"prefix-icon":s(()=>[o(g,{name:Ye(l.type)},null,8,["name"])]),_:2},1032,["modelValue","onUpdate:modelValue","type"])]),_:2},[we(l)?{name:"help",fn:s(()=>[d("span",Go,c(we(l)),1)]),key:"0"}:void 0]),1032,["name","label"]))),128))]),_:1},8,["header"])]),_:1})])):A("",!0),d("div",Jo,[d("h4",Yo,c(e.$t("settings.vendor.modelSettings")),1),o(k,{variant:"outline",size:"small",onClick:wt},{icon:s(()=>[o(at,{theme:"outline"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.addManually")),1)]),_:1})]),(a(!0),m(T,null,G(t(q),(l,ee)=>(a(),B(zt,{key:ee,class:"modelCard"},{default:s(()=>[d("div",Zo,[d("div",Xo,[Ze(l.modelName)?(a(),B(M,{key:0,size:"24px",shape:"round",image:Ze(l.modelName)},null,8,["image"])):A("",!0),d("span",Qo,c(l.name),1)]),d("div",el,[o(k,{size:"small",variant:"text",onClick:te=>It(l)},{icon:s(()=>[o(Ot,{theme:"outline"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.testModel")),1)]),_:1},8,["onClick"]),o(k,{variant:"text",size:"small",onClick:te=>Mt(l)},{icon:s(()=>[o(qt,{theme:"outline"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.edit")),1)]),_:1},8,["onClick"]),o(k,{variant:"text",size:"small",theme:"danger",onClick:te=>Tt(l.modelName)},{icon:s(()=>[o(it,{theme:"outline"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.delete")),1)]),_:1},8,["onClick"])])]),d("div",tl,[o(Te,{theme:"primary"},{default:s(()=>[R(c(e.$t(P(l.type))),1)]),_:2},1024),l.type==="text"&&l.think?(a(),B(Te,{key:0,variant:"light"},{default:s(()=>[R(c(e.$t("settings.vendor.think")),1)]),_:1})):A("",!0),(a(!0),m(T,null,G(l.mode,(te,Jt)=>(a(),m(T,{key:Jt},[Array.isArray(te)?(a(!0),m(T,{key:1},G(te,(Yt,Zt)=>(a(),B(Te,{variant:"light",key:Zt},{default:s(()=>[R(c(b(Yt,l.type)),1)]),_:2},1024))),128)):(a(),B(Te,{key:0,variant:"light"},{default:s(()=>[R(c(b(te,l.type)),1)]),_:2},1024))],64))),128))])]),_:2},1024))),128))]),_:1},8,["data"]),d("div",nl,[o(k,{theme:"danger",loading:t(X),onClick:xt},{default:s(()=>[R(c(e.$t("settings.vendor.deleteVendor")),1)]),_:1},8,["loading"]),o(k,{theme:"default",loading:t(X),onClick:At},{default:s(()=>[R(c(e.$t("settings.vendor.editCode")),1)]),_:1},8,["loading"])])])])):A("",!0),o(Le,{placement:"center",width:"40vw",visible:t(fe),"onUpdate:visible":n[13]||(n[13]=l=>L(fe)?fe.value=l:null),header:t(ye)===null?e.$t("settings.vendor.addModel"):e.$t("settings.vendor.editModel"),maskClosable:!1,onConfirm:Ct},{default:s(()=>[d("div",ol,[o(dt,{data:t(_),labelAlign:"top"},{default:s(()=>[o(ae,{name:"name",label:e.$t("settings.vendor.displayName")},{default:s(()=>[o(ke,{modelValue:t(_).name,"onUpdate:modelValue":n[4]||(n[4]=l=>t(_).name=l),placeholder:e.$t("settings.vendor.displayNamePlaceholder"),clearable:""},null,8,["modelValue","placeholder"])]),_:1},8,["label"]),o(ae,{name:"modelName",label:e.$t("settings.vendor.modelId")},{default:s(()=>[o(ke,{modelValue:t(_).modelName,"onUpdate:modelValue":n[5]||(n[5]=l=>t(_).modelName=l),placeholder:e.$t("settings.vendor.modelIdPlaceholder"),clearable:""},null,8,["modelValue","placeholder"])]),_:1},8,["label"]),o(ae,{name:"type",label:e.$t("settings.vendor.modelType")},{default:s(()=>[o(Kt,{modelValue:t(_).type,"onUpdate:modelValue":n[6]||(n[6]=l=>t(_).type=l)},{default:s(()=>[(a(),m(T,null,G(E,l=>o(Et,{key:l.value,value:l.value},{default:s(()=>[R(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"])]),_:1},8,["label"]),t(_).type==="text"?(a(),B(ae,{key:0,name:"think",label:e.$t("settings.vendor.think")},{default:s(()=>[o(Se,{modelValue:t(_).think,"onUpdate:modelValue":n[7]||(n[7]=l=>t(_).think=l)},{default:s(()=>[o(Pe,{value:!0},{default:s(()=>[R(c(e.$t("settings.vendor.supported")),1)]),_:1}),o(Pe,{value:!1},{default:s(()=>[R(c(e.$t("settings.vendor.notSupported")),1)]),_:1})]),_:1},8,["modelValue"])]),_:1},8,["label"])):A("",!0),t(_).type==="image"?(a(),B(ae,{key:1,name:"mode",label:e.$t("settings.vendor.imageMode")},{default:s(()=>[o(Fe,{modelValue:t(_).mode,"onUpdate:modelValue":n[8]||(n[8]=l=>t(_).mode=l)},{default:s(()=>[(a(),m(T,null,G(h,l=>o(Ne,{key:l.value,value:l.value},{default:s(()=>[R(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"])]),_:1},8,["label"])):A("",!0),t(_).type==="video"?(a(),m(T,{key:2},[o(ae,{name:"mode",label:e.$t("settings.vendor.videoMode")},{default:s(()=>[d("div",ll,[o(Fe,{modelValue:t(_).mode,"onUpdate:modelValue":n[9]||(n[9]=l=>t(_).mode=l)},{default:s(()=>[(a(),m(T,null,G(V,l=>o(Ne,{key:l.value,value:l.value},{default:s(()=>[R(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"]),t(_).mode.includes("multiReference")?(a(),m("div",sl,[o(Fe,{modelValue:t(_).mixedMode,"onUpdate:modelValue":n[10]||(n[10]=l=>t(_).mixedMode=l),style:{display:"flex","flex-direction":"row",gap:"8px","flex-wrap":"wrap","align-items":"center"}},{default:s(()=>[(a(),m(T,null,G(v,l=>(a(),m(T,{key:l.value},[o(Ne,{value:l.value},{default:s(()=>[R(c(e.$t(l.label)),1)]),_:2},1032,["value"]),t(_).mixedMode.includes(l.value)?(a(),B(Ht,{key:0,modelValue:t(_).mixedModeCount[l.value],"onUpdate:modelValue":ee=>t(_).mixedModeCount[l.value]=ee,min:1,max:99,size:"small",style:{width:"80px"},placeholder:e.$t("settings.vendor.count")},null,8,["modelValue","onUpdate:modelValue","placeholder"])):A("",!0)],64))),64))]),_:1},8,["modelValue"])])):A("",!0)])]),_:1},8,["label"]),o(ae,{name:"audio",label:e.$t("settings.vendor.audioOutput")},{default:s(()=>[o(Se,{modelValue:t(_).audio,"onUpdate:modelValue":n[11]||(n[11]=l=>t(_).audio=l)},{default:s(()=>[(a(),m(T,null,G(f,l=>o(Pe,{key:String(l.value),value:l.value},{default:s(()=>[R(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"])]),_:1},8,["label"]),o(ae,{name:"durationResolutionMap",label:e.$t("settings.vendor.durationResolution")},{default:s(()=>[d("div",al,[d("div",il,[n[29]||(n[29]=d("div",{class:"drmHeaderIndex"},null,-1)),d("div",dl,c(e.$t("settings.vendor.durationSec")),1),n[30]||(n[30]=d("div",{class:"drmHeaderArrow"},null,-1)),d("div",rl,c(e.$t("settings.vendor.resolution")),1),n[31]||(n[31]=d("div",{class:"drmHeaderAction"},null,-1))]),(a(!0),m(T,null,G(t(_).durationResolutionMap,(l,ee)=>(a(),m("div",{key:ee,class:"drmRow"},[d("div",ul,c(ee+1),1),o(rt,{modelValue:l.duration,"onUpdate:modelValue":te=>l.duration=te,placeholder:e.$t("settings.vendor.enterAndPress"),class:"drmInput"},null,8,["modelValue","onUpdate:modelValue","placeholder"]),n[32]||(n[32]=d("div",{class:"drmArrow"},"→",-1)),o(rt,{modelValue:l.resolution,"onUpdate:modelValue":te=>l.resolution=te,placeholder:e.$t("settings.vendor.enterAndPress"),class:"drmInput"},null,8,["modelValue","onUpdate:modelValue","placeholder"]),o(k,{variant:"text",theme:"danger",size:"small",disabled:t(_).durationResolutionMap.length===1,onClick:te=>t(_).durationResolutionMap.splice(ee,1)},{icon:s(()=>[o(it,{theme:"outline"})]),_:1},8,["disabled","onClick"])]))),128)),o(k,{style:{"margin-top":"16px"},variant:"dashed",block:"",onClick:n[12]||(n[12]=l=>t(_).durationResolutionMap.push({duration:[],resolution:[]}))},{icon:s(()=>[o(at,{theme:"outline"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.addDurationResolution")),1)]),_:1})])]),_:1},8,["label"])],64)):A("",!0)]),_:1},8,["data"])])]),_:1},8,["visible","header"]),((ut=t(p))==null?void 0:ut.type)==="text"&&t(se)?(a(),B(qn,{key:1,modelVisible:t(se),"onUpdate:modelVisible":n[14]||(n[14]=l=>L(se)?se.value=l:null),vendorId:t(r).id,modelName:t(p).modelName},null,8,["modelVisible","vendorId","modelName"])):A("",!0),((mt=t(p))==null?void 0:mt.type)==="image"&&t(H)?(a(),B(no,{key:2,modelVisible:t(H),"onUpdate:modelVisible":n[15]||(n[15]=l=>L(H)?H.value=l:null),vendorId:t(r).id,modelName:t(p).modelName,supportedModes:t(p).mode||[]},null,8,["modelVisible","vendorId","modelName","supportedModes"])):A("",!0),((ct=t(p))==null?void 0:ct.type)==="video"&&t(de)?(a(),B(Bo,{key:3,modelVisible:t(de),"onUpdate:modelVisible":n[16]||(n[16]=l=>L(de)?de.value=l:null),vendorId:t(r).id,modelName:t(p).modelName,rawModes:t(p).mode||[]},null,8,["modelVisible","vendorId","modelName","rawModes"])):A("",!0),o(Le,{width:"30vw",placement:"center",top:"10vh",footer:!1,visible:t(C),"onUpdate:visible":n[21]||(n[21]=l=>L(C)?C.value=l:null),header:e.$t("settings.vendor.addVendorDialog"),maskClosable:!1},{default:s(()=>[d("div",ml,[o(Se,{variant:"default-filled",modelValue:t(ge),"onUpdate:modelValue":n[17]||(n[17]=l=>L(ge)?ge.value=l:null)},{default:s(()=>[o(De,{value:"importAdd"},{default:s(()=>[...n[33]||(n[33]=[R("通过文件导入",-1)])]),_:1}),o(De,{value:"linkAdd"},{default:s(()=>[...n[34]||(n[34]=[R("通过链接添加",-1)])]),_:1}),o(De,{value:"codeAdd"},{default:s(()=>[...n[35]||(n[35]=[R("通过代码添加",-1)])]),_:1})]),_:1},8,["modelValue"]),t(ge)=="linkAdd"?(a(),m("div",cl,[o(be,{theme:"warning",style:{"margin-bottom":"20px"}},{default:s(()=>[...n[36]||(n[36]=[R(" 请填写 TypeScript 代码文件的链接（.ts 文件），不要填 API 地址或其他无关链接。 确认后 Toonflow 会自动加载该代码，请确保链接来源可信。 ",-1)])]),_:1}),o(ke,{modelValue:t(Re),"onUpdate:modelValue":n[18]||(n[18]=l=>L(Re)?Re.value=l:null),placeholder:e.$t("settings.vendor.linkAddPlaceholder")},null,8,["modelValue","placeholder"]),d("div",gl,[o(k,{loading:t(Ie),disabled:!t(Re).trim(),onClick:Bt},{default:s(()=>[R(c(e.$t("settings.vendor.linkAdd")),1)]),_:1},8,["loading","disabled"])])])):A("",!0),t(ge)=="importAdd"?(a(),m("div",vl,[d("div",{class:"uploadArea",onClick:Pt,onDragover:n[20]||(n[20]=le(()=>{},["prevent"])),onDrop:le(Nt,["prevent"])},[o(jt,{ref_key:"uploadRef",ref:lt,modelValue:t(Be),"onUpdate:modelValue":n[19]||(n[19]=l=>L(Be)?Be.value=l:null),theme:"file",multiple:!1,max:1,accept:".ts","before-upload":st,"request-method":St,style:{display:"none"}},null,8,["modelValue"]),d("div",pl,[o(Wt,{theme:"outline",size:"32",fill:"var(--td-brand-color)"})]),d("p",fl,c(e.$t("workbench.novel.import.importAdd")),1),d("p",yl,c(e.$t("workbench.novel.import.limit")),1)],32)])):A("",!0),t(ge)=="codeAdd"?(a(),m("div",bl)):A("",!0)])]),_:1},8,["visible","header"]),o(Le,{width:"70vw",placement:"center",top:"10vh",visible:t(i),"onUpdate:visible":n[25]||(n[25]=l=>L(i)?i.value=l:null),header:e.$t("settings.vendor.code"),maskClosable:!1,onConfirm:Vt},{default:s(()=>[d("div",$l,[d("div",hl,[o(g,{name:"info-circle",size:"16px"}),d("span",null,c(e.$t("settings.vendor.codeEditorInfo")),1)]),d("div",_l,[o(k,{variant:"text",size:"small",onClick:n[22]||(n[22]=l=>u.value=t(ze))},{icon:s(()=>[o(g,{name:"rollback"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.reset")),1)]),_:1}),o(k,{variant:"outline",size:"small",onClick:n[23]||(n[23]=l=>{var ee;return(ee=t(F))==null?void 0:ee.click()})},{icon:s(()=>[o(g,{name:"upload"})]),default:s(()=>[R(" "+c(e.$t("settings.vendor.importFile")),1)]),_:1}),d("input",{ref_key:"fileInputRef",ref:F,type:"file",accept:".ts,.js,.txt,.json",style:{display:"none"},onChange:Ft},null,544)])]),d("div",Vl,[o(t(ln),{value:t(u),"onUpdate:value":n[24]||(n[24]=l=>L(u)?u.value=l:null),language:"typescript",theme:"vs-dark",height:600,options:S},null,8,["value"])])]),_:1},8,["visible","header"])])}}}),ds=he(Rl,[["__scopeId","data-v-0533b731"]]);export{ds as default};
