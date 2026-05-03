import{d as $e,ap as Ee,a9 as te,aa as B,w as s,a as d,f as t,o as a,c as m,ab as c,ac as A,J as T,aj as G,an as Te,b as o,e as w,br as Gt,ao as oe,ad as z,aq as Ke,z as h,a3 as ze,_ as _e,ah as ge,L as ut,g as me,a4 as Wt,a5 as Jt,I as Yt,bw as Xt,aG as Zt,bo as De,ar as Oe}from"./index-CcWaFW2J.js";import{S as Qt,_ as en}from"./index-CcrEPLcP.js";import{i as ee}from"./axios-n5VlCZnn.js";import{A as tn,m as nn,p as on}from"./providersLogo-DI_zIUkU.js";import{D as Ae}from"./index-vx3qbvAR.js";import{T as He}from"./index-CmUY2Bql.js";import{B as xe}from"./index-DjdURnqo.js";import{R as je,a as Ge,b as ln}from"./index-CYCE6mFD.js";import{a as We,F as sn}from"./index-DwZytNA3.js";import{I as mt}from"./index-xBf2eNdw.js";import{M as an,a as dn}from"./index-JRwGoufq.js";import{E as rn}from"./index-Cefcveil.js";import{A as un}from"./index-BjqWr5sC.js";import{a as mn}from"./index3-C_GutCbx.js";import{I as cn}from"./index-3l0r9e0-.js";import{C as gn,a as pn}from"./index-C7sbrPSJ.js";import{C as vn}from"./index-DssIqjI-.js";import{T as fn}from"./index-DswpgE5v.js";import{S as yn,O as bn,T as hn}from"./index-BR6RXeX1.js";import{a as $n,C as _n}from"./index-WZdkWDOd.js";import{I as Vn}from"./index-P43Qdszg.js";import{U as kn}from"./index-CObWG-Ca.js";import{D as ae}from"./plugin-DQi24oOY.js";import"./index-CEZxyaid.js";import"./index-DC-PldJa.js";import"./dialog-luBO2yFS.js";import"./dep-6fcd3856-D9zSHuJ8.js";import"./form-model-dYOJpQ9u.js";import"./index-DcqnMQ0P.js";import"./add-dYY7QXNZ.js";import"./chevron-right-CoYnG0xG.js";import"./fake-arrow-d6ISTZ_H.js";import"./index-BdLjdNYg.js";import"./index-o7Z6V7R0.js";import"./index-i0GKFdkZ.js";import"./index-Cy0q3VkN.js";import"./index-BOS2ehe8.js";import"./check-8bbEChYD.js";import"./refresh-CA8UcN2j.js";import"./dep-c171b67b-CP9VMDKK.js";import"./index-DlmR2IVU.js";import"./index-u4XLM9QT.js";import"./delete-sU3-ZxIT.js";import"./dep-fe7c938f-1ZCkdsSs.js";const qe=`/**
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
`,Rn={class:"textTestDialog"},wn={key:0,class:"emptyHint"},Cn={class:"bubble"},Mn={class:"role"},In={key:0,class:"content"},Tn={key:0,class:"thinkContent"},An={key:1,class:"cursor"},xn={key:1,class:"content"},Un={class:"inputArea"},Bn={class:"inputActions"},Pn={class:"hint"},Sn={class:"btns"},Fn=$e({__name:"TextModelTest",props:Ke({vendorId:{},modelName:{}},{modelVisible:{type:Boolean},modelVisibleModifiers:{}}),emits:["update:modelVisible"],setup(I){const W=I,O=Ee(I,"modelVisible"),U=h([]),P=h(""),f=h(!1),S=h(null);function E(){ze(()=>{S.value&&(S.value.scrollTop=S.value.scrollHeight)})}async function $(){var x,K,H;const v=P.value.trim();if(!v||f.value)return;U.value.push({role:"user",content:v}),P.value="",f.value=!0;const y={role:"assistant",content:"",loading:!0};U.value.push(y),E();try{const u=U.value.slice(0,-1).map(F=>({role:F.role,content:F.content})),{data:q}=await ee.post("/setting/vendorConfig/modelTest/textTest",{modelName:W.modelName,id:W.vendorId,messages:u});y.content=typeof q=="string"?q:(q==null?void 0:q.content)??JSON.stringify(q),y.thinking=(q==null?void 0:q.thinking)??void 0,y.loading=!1}catch(u){const q=((K=(x=u==null?void 0:u.response)==null?void 0:x.data)==null?void 0:K.message)||((H=u==null?void 0:u.response)==null?void 0:H.data)||(u==null?void 0:u.message)||String(u);y.content=`❌ ${typeof q=="string"?q:JSON.stringify(q)}`,y.loading=!1}finally{f.value=!1,E()}}function V(){U.value=[]}function p(){U.value=[],P.value="",f.value=!1}return(v,y)=>{const x=te("i-thinking-problem"),K=He,H=xe,u=te("i-send"),q=Ae;return a(),B(q,{placement:"center",width:"60vw",visible:O.value,"onUpdate:visible":y[1]||(y[1]=F=>O.value=F),header:v.$t("settings.vendor.test.textTitle")+" - "+I.modelName,footer:!1,onClosed:p},{default:s(()=>[d("div",Rn,[d("div",{class:"messageList",ref_key:"messageListRef",ref:S},[t(U).length===0?(a(),m("div",wn,c(v.$t("settings.vendor.test.textEmptyHint")),1)):A("",!0),(a(!0),m(T,null,G(t(U),(F,k)=>(a(),m("div",{key:k,class:Te(["messageItem",F.role])},[d("div",Cn,[d("div",Mn,c(F.role==="user"?v.$t("settings.vendor.test.you"):v.$t("settings.vendor.test.assistant")),1),F.role==="assistant"?(a(),m("div",In,[F.thinking?(a(),m("span",Tn,[o(x,{theme:"outline",size:"14"}),w(" "+c(F.thinking),1)])):A("",!0),d("span",null,c(F.content),1),F.loading?(a(),m("span",An,"▌")):A("",!0)])):(a(),m("div",xn,c(F.content),1))])],2))),128))],512),d("div",Un,[o(K,{modelValue:t(P),"onUpdate:modelValue":y[0]||(y[0]=F=>z(P)?P.value=F:null),placeholder:v.$t("settings.vendor.test.textInputPlaceholder"),autosize:{minRows:2,maxRows:5},disabled:t(f),onKeydown:Gt(oe($,["ctrl","exact"]),["enter"])},null,8,["modelValue","placeholder","disabled","onKeydown"]),d("div",Bn,[d("span",Pn,"Ctrl + Enter "+c(v.$t("settings.vendor.test.send")),1),d("div",Sn,[o(H,{variant:"outline",size:"small",disabled:t(f)||t(U).length===0,onClick:V},{default:s(()=>[w(c(v.$t("settings.vendor.test.clearHistory")),1)]),_:1},8,["disabled"]),o(H,{theme:"primary",size:"small",loading:t(f),disabled:!t(P).trim(),onClick:$},{icon:s(()=>[o(u,{theme:"outline"})]),default:s(()=>[w(" "+c(v.$t("settings.vendor.test.send")),1)]),_:1},8,["loading","disabled"])])])])])]),_:1},8,["visible","header"])}}}),Ln=_e(Fn,[["__scopeId","data-v-d6a4bd65"]]),Nn={class:"imageTestDialog"},Dn={class:"modeBar"},On={class:"inputSection"},qn={key:0,class:"uploadRow"},zn=["src"],En={class:"uploadText"},Kn={class:"uploadHint"},Hn={key:0,class:"resultSection"},jn={class:"resultLabel"},Gn={class:"resultImg"},Wn=["src"],Jn={key:1,class:"loadingSection"},Yn={class:"dialogFooter"},Xn=$e({__name:"ImageModelTest",props:Ke({vendorId:{},modelName:{},supportedModes:{}},{modelVisible:{type:Boolean},modelVisibleModifiers:{}}),emits:["update:modelVisible"],setup(I){const W=Ee(I,"modelVisible"),O=I,U=[{value:"text",label:$t("settings.vendor.test.textToImage")},{value:"singleImage",label:$t("settings.vendor.test.imageToImage")},{value:"multiReference",label:$t("settings.vendor.test.multiRef")}],P=me(()=>U.filter(k=>O.supportedModes.includes(k.value))),f=h("text");ge(()=>O.supportedModes,k=>{k.length>0&&!k.includes(f.value)&&(f.value=k[0])},{immediate:!0}),ge(f,()=>{E.value=null,$.value="",v.value=""});const S=h(""),E=h(null),$=h(""),V=h(null),p=h(!1),v=h(""),y=me(()=>p.value?!1:f.value==="text"?!!S.value.trim():f.value==="singleImage"||f.value==="multiReference"?!!E.value:!1);function x(){var k;(k=V.value)==null||k.click()}function K(k){var i;const C=(i=k.target.files)==null?void 0:i[0];C&&(E.value=C,$.value=URL.createObjectURL(C),k.target.value="")}function H(k){var i,r;const C=(r=(i=k.dataTransfer)==null?void 0:i.files)==null?void 0:r[0];C&&C.type.startsWith("image/")&&(E.value=C,$.value=URL.createObjectURL(C))}const u=k=>new Promise((C,i)=>{const r=new FileReader;r.onload=()=>C(r.result),r.onerror=i,r.readAsDataURL(k)});async function q(){p.value=!0,v.value="";try{const k={modelName:O.modelName,id:O.vendorId},C=S.value.trim();C&&(k.prompt=C),E.value&&(k.imageBase64=await u(E.value));const{data:i}=await ee.post("/setting/vendorConfig/modelTest/imageTest",k);v.value=i,window.$message.success($t("settings.vendor.msg.imageGenSuccess"))}catch(k){window.$message.error(k.message??`${$t("settings.vendor.msg.requestFailed")}`)}finally{p.value=!1}}function F(){S.value="",E.value=null,$.value="",v.value="",p.value=!1}return(k,C)=>{const i=Ge,r=je,N=te("i-picture"),X=He,ne=We,le=ut,L=xe,re=te("i-lightning"),ce=Ae;return a(),B(ce,{placement:"center",width:"56vw",visible:W.value,"onUpdate:visible":C[4]||(C[4]=D=>W.value=D),header:k.$t("settings.vendor.test.imageTitle")+" - "+I.modelName,footer:!1,onClosed:F},{default:s(()=>[d("div",Nn,[d("div",Dn,[o(r,{modelValue:t(f),"onUpdate:modelValue":C[0]||(C[0]=D=>z(f)?f.value=D:null),variant:"default-filled"},{default:s(()=>[(a(!0),m(T,null,G(t(P),D=>(a(),B(i,{key:D.value,value:D.value},{default:s(()=>[w(c(D.label),1)]),_:2},1032,["value"]))),128))]),_:1},8,["modelValue"])]),d("div",On,[t(f)==="singleImage"?(a(),m("div",qn,[d("div",{class:"uploadBox",onClick:x,onDragover:C[1]||(C[1]=oe(()=>{},["prevent"])),onDrop:oe(H,["prevent"])},[t($)?(a(),m("img",{key:0,src:t($),class:"previewImg",alt:"preview"},null,8,zn)):(a(),m(T,{key:1},[o(N,{theme:"outline",size:"32",fill:"var(--td-brand-color)"}),d("p",En,c(k.$t("settings.vendor.test.uploadImage")),1),d("p",Kn,c(k.$t("settings.vendor.test.supportFormat")),1)],64))],32),d("input",{ref_key:"imageInputRef",ref:V,type:"file",accept:"image/*",style:{display:"none"},onChange:K},null,544)])):A("",!0),o(ne,{label:k.$t("settings.vendor.test.prompt")},{default:s(()=>[o(X,{modelValue:t(S),"onUpdate:modelValue":C[2]||(C[2]=D=>z(S)?S.value=D:null),placeholder:k.$t("settings.vendor.test.promptPlaceholder"),autosize:{minRows:2,maxRows:4},disabled:t(p)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])]),t(v)?(a(),m("div",Hn,[d("div",jn,c(k.$t("settings.vendor.test.result")),1),d("div",Gn,[d("img",{src:t(v),alt:"generated"},null,8,Wn)])])):t(p)?(a(),m("div",Jn,[o(le,{size:"large",text:k.$t("settings.vendor.generating")},null,8,["text"])])):A("",!0),d("div",Yn,[o(L,{variant:"outline",onClick:C[3]||(C[3]=D=>W.value=!1)},{default:s(()=>[w(c(k.$t("settings.vendor.test.cancel")),1)]),_:1}),o(L,{theme:"primary",loading:t(p),disabled:!t(y),onClick:q},{icon:s(()=>[o(re,{theme:"outline"})]),default:s(()=>[w(" "+c(k.$t("settings.vendor.test.startTest")),1)]),_:1},8,["loading","disabled"])])])]),_:1},8,["visible","header"])}}}),Zn=_e(Xn,[["__scopeId","data-v-0d1acb95"]]),Qn=["src"],eo={class:"boxText"},to={key:0,class:"optionalTag"},no=$e({__name:"ImageUploadBox",props:{modelValue:{},optional:{type:Boolean},label:{}},emits:["update:modelValue"],setup(I,{emit:W}){const O=I,U=W,P=h(null),f=h("");ge(()=>O.modelValue,p=>{p?f.value=URL.createObjectURL(p):f.value=""});function S(){var p;(p=P.value)==null||p.click()}function E(p){var y;const v=((y=p.target.files)==null?void 0:y[0])??null;U("update:modelValue",v),p.target.value=""}function $(p){var y,x;const v=((x=(y=p.dataTransfer)==null?void 0:y.files)==null?void 0:x[0])??null;v!=null&&v.type.startsWith("image/")&&U("update:modelValue",v)}function V(){U("update:modelValue",null)}return(p,v)=>{const y=te("i-picture"),x=te("i-close");return a(),m("div",{class:Te(["imageUploadBox",{optional:I.optional,hasFile:!!I.modelValue}]),onClick:S,onDragover:v[0]||(v[0]=oe(()=>{},["prevent"])),onDrop:oe($,["prevent"])},[I.modelValue?(a(),m("img",{key:0,src:t(f),class:"preview",alt:"preview"},null,8,Qn)):(a(),m(T,{key:1},[o(y,{theme:"outline",size:"26",fill:"var(--td-brand-color)"}),d("p",eo,c(I.label||p.$t("settings.vendor.test.uploadImage")),1),I.optional?(a(),m("p",to,c(p.$t("settings.vendor.test.optional")),1)):A("",!0)],64)),I.modelValue?(a(),m("button",{key:2,class:"clearBtn",onClick:oe(V,["stop"])},[o(x,{theme:"outline",size:"12"})])):A("",!0),d("input",{ref_key:"inputRef",ref:P,type:"file",accept:"image/*",style:{display:"none"},onChange:E},null,544)],34)}}}),ve=_e(no,[["__scopeId","data-v-99cf3305"]]),oo=["src"],lo={class:"boxText"},so=$e({__name:"VideoUploadBox",props:{modelValue:{},label:{}},emits:["update:modelValue"],setup(I,{emit:W}){const O=I,U=W,P=h(null),f=h("");ge(()=>O.modelValue,p=>{p?f.value=URL.createObjectURL(p):f.value=""});function S(){var p;(p=P.value)==null||p.click()}function E(p){var y;const v=((y=p.target.files)==null?void 0:y[0])??null;U("update:modelValue",v),p.target.value=""}function $(p){var y,x;const v=((x=(y=p.dataTransfer)==null?void 0:y.files)==null?void 0:x[0])??null;v!=null&&v.type.startsWith("video/")&&U("update:modelValue",v)}function V(){U("update:modelValue",null)}return(p,v)=>{const y=te("i-video-one"),x=te("i-close");return a(),m("div",{class:Te(["videoUploadBox",{hasFile:!!I.modelValue}]),onClick:S,onDragover:v[0]||(v[0]=oe(()=>{},["prevent"])),onDrop:oe($,["prevent"])},[I.modelValue&&t(f)?(a(),m("video",{key:0,src:t(f),class:"preview",muted:""},null,8,oo)):(a(),m(T,{key:1},[o(y,{theme:"outline",size:"26",fill:"var(--td-brand-color)"}),d("p",lo,c(I.label||p.$t("settings.vendor.test.uploadVideo")),1)],64)),I.modelValue?(a(),m("button",{key:2,class:"clearBtn",onClick:oe(V,["stop"])},[o(x,{theme:"outline",size:"12"})])):A("",!0),d("input",{ref_key:"inputRef",ref:P,type:"file",accept:"video/*",style:{display:"none"},onChange:E},null,544)],34)}}}),ao=_e(so,[["__scopeId","data-v-f2dd17b6"]]),io={class:"boxText fileName"},ro={class:"boxText"},uo=$e({__name:"AudioUploadBox",props:{modelValue:{},label:{}},emits:["update:modelValue"],setup(I,{emit:W}){const O=W,U=h(null);function P(){var $;($=U.value)==null||$.click()}function f($){var p;const V=((p=$.target.files)==null?void 0:p[0])??null;O("update:modelValue",V),$.target.value=""}function S($){var p,v;const V=((v=(p=$.dataTransfer)==null?void 0:p.files)==null?void 0:v[0])??null;V!=null&&V.type.startsWith("audio/")&&O("update:modelValue",V)}function E(){O("update:modelValue",null)}return($,V)=>{const p=te("i-music-one"),v=te("i-close");return a(),m("div",{class:Te(["audioUploadBox",{hasFile:!!I.modelValue}]),onClick:P,onDragover:V[0]||(V[0]=oe(()=>{},["prevent"])),onDrop:oe(S,["prevent"])},[I.modelValue?(a(),m(T,{key:0},[o(p,{theme:"filled",size:"26",fill:"var(--td-success-color)"}),d("p",io,c(I.modelValue.name),1)],64)):(a(),m(T,{key:1},[o(p,{theme:"outline",size:"26",fill:"var(--td-brand-color)"}),d("p",ro,c(I.label||$.$t("settings.vendor.test.uploadAudio")),1)],64)),I.modelValue?(a(),m("button",{key:2,class:"clearBtn",onClick:oe(E,["stop"])},[o(v,{theme:"outline",size:"12"})])):A("",!0),d("input",{ref_key:"inputRef",ref:U,type:"file",accept:"audio/*",style:{display:"none"},onChange:f},null,544)],34)}}}),mo=_e(uo,[["__scopeId","data-v-3928fb29"]]),co={class:"videoTestDialog"},go={class:"modeBar"},po={class:"modeLabel"},vo={key:0,class:"modeDesc"},fo={key:1,class:"inputSection"},yo={class:"uploadRow"},bo={class:"frameRow"},ho={class:"frameRow"},$o={class:"frameRow"},_o={class:"multiRefSection"},Vo={class:"multiRefRow"},ko={key:2,class:"resultSection"},Ro={class:"resultLabel"},wo=["src"],Co={key:3,class:"loadingSection"},Mo={class:"dialogFooter"},Io=$e({__name:"VideoModelTest",props:Ke({vendorId:{},modelName:{},rawModes:{}},{modelVisible:{type:Boolean},modelVisibleModifiers:{}}),emits:["update:modelVisible"],setup(I){const W=I,O=Ee(I,"modelVisible"),U={text:{label:$t("settings.vendor.test.textToVideo"),desc:$t("settings.vendor.test.textToVideoDesc")},singleImage:{label:$t("settings.vendor.test.singleImageMode"),desc:$t("settings.vendor.test.singleImageDesc")},startEndRequired:{label:$t("settings.vendor.startEndRequired"),desc:$t("settings.vendor.test.startEndRequiredDesc")},endFrameOptional:{label:$t("settings.vendor.endFrameOptional"),desc:$t("settings.vendor.test.endFrameOptionalDesc")},startFrameOptional:{label:$t("settings.vendor.startFrameOptional"),desc:$t("settings.vendor.test.startFrameOptionalDesc")}},P=me(()=>{const i=[];for(const r of W.rawModes)if(Array.isArray(r)){const N=[];for(const X of r){const ne=String(X).match(/^(videoReference|imageReference|audioReference):(\d+)$/);ne&&N.push({type:ne[1],count:Number(ne[2])})}if(N.length>0){const X=N.map(ne=>`${ne.type==="imageReference"?$t("settings.vendor.imageRef"):ne.type==="videoReference"?$t("settings.vendor.videoRef"):$t("settings.vendor.audioRef")}×${ne.count}`).join(" + ");i.push({key:JSON.stringify(r),label:X,desc:`${$t("settings.vendor.test.multiRefDesc")}: ${X}`,refs:N})}}else{const N=U[String(r)];N&&i.push({key:String(r),label:N.label,desc:N.desc})}return i}),f=h("");ge(P,i=>{var r;i.length>0&&!i.find(N=>N.key===f.value)&&(f.value=((r=i[0])==null?void 0:r.key)??"")},{immediate:!0}),ge(f,()=>{K(),x.value=""});const S=me(()=>P.value.find(i=>i.key===f.value)??null),E=me(()=>{var i;return((i=S.value)==null?void 0:i.refs)??[]}),$=h(""),V=h(Array(30).fill(null)),p=h(Array(30).fill(null)),v=h(Array(30).fill(null)),y=h(!1),x=h("");function K(){V.value=Array(30).fill(null),p.value=Array(30).fill(null),v.value=Array(30).fill(null)}function H(i){return i.type==="imageReference"?`${$t("settings.vendor.imageRef")} (×${i.count})`:i.type==="videoReference"?`${$t("settings.vendor.videoRef")} (×${i.count})`:`${$t("settings.vendor.audioRef")} (×${i.count})`}function u(i){return new Promise((r,N)=>{const X=new FileReader;X.onload=()=>r(X.result),X.onerror=N,X.readAsDataURL(i)})}function q(i=""){return i.startsWith("image/")?"image":i.startsWith("video/")?"video":i.startsWith("audio/")?"audio":""}async function F(i){const r=(i||[]).filter(Boolean);return Promise.all(r.map(async N=>({type:q(N.type),base64:await u(N)})))}async function k(){y.value=!0,x.value="";try{const i={modelName:W.modelName,id:W.vendorId,mode:f.value,...$.value.trim()?{prompt:$.value.trim()}:{},images:await F(V.value.filter(Boolean)),videos:await F(p.value.filter(Boolean)),audios:await F(v.value.filter(Boolean))},{data:r}=await ee.post("/setting/vendorConfig/modelTest/videoTest",i,{timeout:30*60*1e3});x.value=r,window.$message.success($t("settings.vendor.msg.videoGenSuccess"))}catch(i){window.$message.error((i==null?void 0:i.message)??`${$t("settings.vendor.msg.requestFailed")}`)}finally{y.value=!1}}function C(){$.value="",K(),x.value="",y.value=!1}return(i,r)=>{const N=Ge,X=je,ne=mt,le=He,L=We,re=ut,ce=xe,D=te("i-lightning"),fe=Ae;return a(),B(fe,{placement:"center",width:"58vw",visible:O.value,"onUpdate:visible":r[15]||(r[15]=b=>O.value=b),header:i.$t("settings.vendor.test.videoTitle")+" - "+I.modelName,footer:!1,onClosed:C},{default:s(()=>[d("div",co,[d("div",go,[d("div",po,c(i.$t("settings.vendor.test.selectMode")),1),o(X,{modelValue:t(f),"onUpdate:modelValue":r[0]||(r[0]=b=>z(f)?f.value=b:null),variant:"default-filled"},{default:s(()=>[(a(!0),m(T,null,G(t(P),b=>(a(),B(N,{key:b.key,value:b.key},{default:s(()=>[w(c(b.label),1)]),_:2},1032,["value"]))),128))]),_:1},8,["modelValue"])]),t(S)?(a(),m("div",vo,[o(ne,{name:"info-circle-filled",size:"14px"}),w(" "+c(t(S).desc),1)])):A("",!0),w(" "+c(t(f))+" ",1),t(f)?(a(),m("div",fo,[t(f)==="text"?(a(),B(L,{key:0,label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(le,{modelValue:t($),"onUpdate:modelValue":r[1]||(r[1]=b=>z($)?$.value=b:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:4},disabled:t(y)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])):t(f)==="singleImage"?(a(),m(T,{key:1},[o(L,{label:i.$t("settings.vendor.test.referenceImage")},{default:s(()=>[d("div",yo,[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":r[2]||(r[2]=b=>t(V)[0]=b)},null,8,["modelValue"])])]),_:1},8,["label"]),o(L,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(le,{modelValue:t($),"onUpdate:modelValue":r[3]||(r[3]=b=>z($)?$.value=b:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t(y)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(f)==="startEndRequired"?(a(),m(T,{key:2},[d("div",bo,[o(L,{label:i.$t("settings.vendor.test.startFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":r[4]||(r[4]=b=>t(V)[0]=b)},null,8,["modelValue"])]),_:1},8,["label"]),o(L,{label:i.$t("settings.vendor.test.endFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[1],"onUpdate:modelValue":r[5]||(r[5]=b=>t(V)[1]=b)},null,8,["modelValue"])]),_:1},8,["label"])]),o(L,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(le,{modelValue:t($),"onUpdate:modelValue":r[6]||(r[6]=b=>z($)?$.value=b:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t(y)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(f)==="endFrameOptional"?(a(),m(T,{key:3},[d("div",ho,[o(L,{label:i.$t("settings.vendor.test.startFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":r[7]||(r[7]=b=>t(V)[0]=b)},null,8,["modelValue"])]),_:1},8,["label"]),o(L,{label:i.$t("settings.vendor.test.endFrameOptional")},{default:s(()=>[o(ve,{modelValue:t(V)[1],"onUpdate:modelValue":r[8]||(r[8]=b=>t(V)[1]=b),optional:!0},null,8,["modelValue"])]),_:1},8,["label"])]),o(L,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(le,{modelValue:t($),"onUpdate:modelValue":r[9]||(r[9]=b=>z($)?$.value=b:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t(y)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(f)==="startFrameOptional"?(a(),m(T,{key:4},[d("div",$o,[o(L,{label:i.$t("settings.vendor.test.startFrameOptional")},{default:s(()=>[o(ve,{modelValue:t(V)[0],"onUpdate:modelValue":r[10]||(r[10]=b=>t(V)[0]=b),optional:!0},null,8,["modelValue"])]),_:1},8,["label"]),o(L,{label:i.$t("settings.vendor.test.endFrame")},{default:s(()=>[o(ve,{modelValue:t(V)[1],"onUpdate:modelValue":r[11]||(r[11]=b=>t(V)[1]=b)},null,8,["modelValue"])]),_:1},8,["label"])]),o(L,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(le,{modelValue:t($),"onUpdate:modelValue":r[12]||(r[12]=b=>z($)?$.value=b:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),autosize:{minRows:2,maxRows:3},disabled:t(y)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"])],64)):t(f).startsWith("[")?(a(),m(T,{key:5},[o(L,{label:i.$t("settings.vendor.test.prompt")},{default:s(()=>[o(le,{modelValue:t($),"onUpdate:modelValue":r[13]||(r[13]=b=>z($)?$.value=b:null),placeholder:i.$t("settings.vendor.test.videoPromptPlaceholder"),disabled:t(y)},null,8,["modelValue","placeholder","disabled"])]),_:1},8,["label"]),d("div",_o,[(a(!0),m(T,null,G(t(E),(b,se)=>(a(),B(L,{key:se,label:H(b)},{default:s(()=>[d("div",Vo,[b.type==="imageReference"?(a(!0),m(T,{key:0},G(b.count,J=>(a(),B(ve,{key:J,modelValue:t(V)[se*10+J-1],"onUpdate:modelValue":ue=>t(V)[se*10+J-1]=ue,label:`${i.$t("settings.vendor.test.image")} ${J}`},null,8,["modelValue","onUpdate:modelValue","label"]))),128)):b.type==="videoReference"?(a(!0),m(T,{key:1},G(b.count,J=>(a(),B(ao,{key:J,modelValue:t(p)[se*10+J-1],"onUpdate:modelValue":ue=>t(p)[se*10+J-1]=ue,label:`${i.$t("settings.vendor.test.video")} ${J}`},null,8,["modelValue","onUpdate:modelValue","label"]))),128)):b.type==="audioReference"?(a(!0),m(T,{key:2},G(b.count,J=>(a(),B(mo,{key:J,modelValue:t(v)[se*10+J-1],"onUpdate:modelValue":ue=>t(v)[se*10+J-1]=ue,label:`${i.$t("settings.vendor.test.audio")} ${J}`},null,8,["modelValue","onUpdate:modelValue","label"]))),128)):A("",!0)])]),_:2},1032,["label"]))),128))])],64)):A("",!0)])):A("",!0),t(x)?(a(),m("div",ko,[d("div",Ro,c(i.$t("settings.vendor.test.result")),1),d("video",{src:t(x),controls:"",autoplay:"",loop:"",class:"resultVideo"},null,8,wo)])):t(y)?(a(),m("div",Co,[o(re,{size:"large",text:i.$t("settings.vendor.videoGenerating")},null,8,["text"])])):A("",!0),d("div",Mo,[o(ce,{variant:"outline",onClick:r[14]||(r[14]=b=>O.value=!1)},{default:s(()=>[w(c(i.$t("settings.vendor.test.cancel")),1)]),_:1}),o(ce,{theme:"primary",loading:t(y),onClick:k},{icon:s(()=>[o(D,{theme:"outline"})]),default:s(()=>[w(" "+c(i.$t("settings.vendor.test.startTest")),1)]),_:1},8,["loading"])])])]),_:1},8,["visible","header"])}}}),To=_e(Io,[["__scopeId","data-v-7a4f4b9a"]]),Ao={class:"modelServe"},xo={class:"modelList"},Uo={class:"listFooter"},Bo={class:"listContent"},Po={key:0,class:"modelParameter"},So={class:"configuration"},Fo={class:"infoBox ac jb"},Lo={class:"idBox"},No={class:"author"},Do={class:"requiredLabel"},Oo={class:"requiredText"},qo={class:"inputHelp"},zo={key:1,class:"optionalSection"},Eo={class:"inputHelp"},Ko={class:"jb ac"},Ho={class:"sectionTitle"},jo={class:"topInfo jb ac"},Go={class:"modelCardNameWrap"},Wo={class:"modelCardName"},Jo={class:"actionBtns"},Yo={class:"tags"},Xo={class:"updateAction"},Zo={class:"addBox"},Qo={style:{display:"flex","flex-direction":"column","align-items":"flex-start",gap:"0"}},el={key:0,style:{border:"1px solid #ddd","border-radius":"6px",padding:"6px 12px","margin-top":"6px"}},tl={class:"drmEditor"},nl={class:"drmHeader"},ol={class:"drmHeaderLabel"},ll={class:"drmHeaderLabel"},sl={class:"drmRowIndex"},al={class:"data"},il={key:0,class:"linkAdd"},dl={style:{"margin-top":"10px","text-align":"right",width:"100%"}},rl={key:1,class:"importAdd"},ul={class:"dragIcon"},ml={class:"uploadText"},cl={class:"uploadHint"},gl={key:2,class:"codeAdd"},pl={class:"editorToolbar"},vl={class:"editorInfo"},fl={class:"editorActions"},yl={class:"editorWrapper"},bl=700,hl=$e({__name:"vendorConfig",setup(I){const{themeSetting:W}=Wt(Jt()),O={text:"settings.vendor.textModel",image:"settings.vendor.imageModel",video:"settings.vendor.videoModel"},U={singleImage:"settings.vendor.singleImage",multiReference:"settings.vendor.multiReference",startEndRequired:"settings.vendor.startEndRequired",endFrameOptional:"settings.vendor.endFrameOptional",startFrameOptional:"settings.vendor.startFrameOptional",audioReference:"settings.vendor.audioRef",videoReference:"settings.vendor.videoRef",imageReference:"settings.vendor.imageRef"};function P(e){return O[e]||e}function f(e,n){if(e==="text")return $t(n==="image"?"settings.vendor.textToImage":"settings.vendor.textToVideo");const g=String(e).match(/^(videoReference|imageReference|audioReference):(\d+)$/);if(g){const R=U[g[1]];return R?`${$t(R)} ×${g[2]}`:e}return U[e]?$t(U[e]):e}const S={fontSize:14,automaticLayout:!0,tabSize:2,scrollBeyondLastLine:!1,formatOnPaste:!0,formatOnType:!0},E=[{value:"text",label:"settings.vendor.textModel"},{value:"image",label:"settings.vendor.imageModel"},{value:"video",label:"settings.vendor.videoModel"}],$=[{label:"settings.vendor.textToImage",value:"text"},{label:"settings.vendor.singleImage",value:"singleImage"},{label:"settings.vendor.multiReference",value:"multiReference"}],V=[{label:"settings.vendor.singleImage",value:"singleImage"},{label:"settings.vendor.startEndRequired",value:"startEndRequired"},{label:"settings.vendor.endFrameOptional",value:"endFrameOptional"},{label:"settings.vendor.startFrameOptional",value:"startFrameOptional"},{label:"settings.vendor.textToVideo",value:"text"},{label:"settings.vendor.multiReferenceMode",value:"multiReference"}],p=[{label:"settings.vendor.videoRef",value:"videoReference"},{label:"settings.vendor.imageRef",value:"imageReference"},{label:"settings.vendor.audioRef",value:"audioReference"}],v=[{label:"settings.vendor.audioOptional",value:"optional"},{label:"settings.vendor.audioOnly",value:!0},{label:"settings.vendor.noAudio",value:!1}],y=h([]),x=h(!1);async function K(){x.value=!0;try{const e=await ee.post("/setting/vendorConfig/getVendorList");y.value=e.data.map(n=>({...n,enable:n.enable})),y.value.length&&!y.value.some(n=>n.id===H.value)&&(H.value=y.value[0].id)}catch(e){window.$message.error(`${$t("settings.vendor.msg.getVendorListFailed")}${e.message}`)}finally{x.value=!1,ze(()=>{L.value=we.value,le.value=!0})}}Yt(()=>{K()});const H=h(),u=me(()=>y.value.find(e=>e.id===H.value)),q=me(()=>{var e,n;return((e=u.value)==null?void 0:e.models)||((n=u.value)==null?void 0:n.model)||[]}),F=me(()=>{var e,n;return((n=(e=u.value)==null?void 0:e.inputs)==null?void 0:n.filter(g=>g.required))||[]}),k=me(()=>{var e,n;return((n=(e=u.value)==null?void 0:e.inputs)==null?void 0:n.filter(g=>!g.required))||[]}),C=h(!1),i=h(!1),r=h(qe),N=h(null),X=h(!1),ne=h(!1),le=h(!1),L=h("");let re=null,ce=!1;const D=h(null),fe=h(!1),b=h(!1),se=h(!1);function J(e){return e==="password"?"secured":e==="url"?"link":"edit-1"}function ue(e){var n;return((n=e.placeholder)==null?void 0:n.trim())||""}function ct(e){return e?/^(?:data:[^;]+;base64,)?[A-Za-z0-9+/]*={0,2}$/.test(e)&&e.length>0:!1}function gt(e){if(!e.version)return!0;const n=parseFloat(e.version);return isNaN(n)||n<2}function Je(e){if(!e)return null;const n=nn.find(g=>g.pattern.test(e));return n?on[n.provider]:null}function Ye(e){return{id:e.id,inputValues:e.inputValues}}const we=me(()=>u.value?JSON.stringify(Ye(u.value)):"");function Xe(){re&&clearTimeout(re),re=setTimeout(()=>{pt()},bl)}async function pt(){if(!u.value||!le.value||x.value)return;const e=we.value;if(!(!e||e===L.value)){if(ne.value){ce=!0;return}ne.value=!0;try{await ee.post("/setting/vendorConfig/updateVendorInputs",Ye(u.value)),L.value=e}catch(n){window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${n.message}`)}finally{ne.value=!1,ce&&(ce=!1,Xe())}}}ge(we,e=>{!e||!le.value||x.value||e!==L.value&&Xe()},{flush:"post"}),ge(H,()=>{re&&(clearTimeout(re),re=null),ce=!1,ze(()=>{L.value=we.value})},{flush:"post"});const Ce=h();function vt(){pe.value="importAdd",Ce.value=void 0,r.value=qe,C.value=!0,i.value=!1}function ft(){if(Ce.value){const e=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.updateVendorRiskBody"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{e.destroy();const n=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.updateVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndUpdate"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{ee.post("/setting/vendorConfig/updateCode",{id:Ce.value,tsCode:r.value}).then(g=>{window.$message.success($t("settings.vendor.msg.updateSuccess")),C.value=!1,i.value=!1,K()}).catch(g=>{window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${g.message}`)}).finally(()=>{n.destroy()})},onClose:()=>n.hide()})},onClose:()=>e.hide()})}else{const e=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.addVendorRiskBody"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{e.destroy();const n=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.addVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndAdd"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{ee.post("/setting/vendorConfig/addVendor",{tsCode:r.value}).then(g=>{window.$message.success($t("settings.vendor.msg.vendorAdded")),C.value=!1,i.value=!1,K()}).catch(g=>{window.$message.error(g.message??`${$t("settings.vendor.msg.addFailed")}`)}).finally(()=>{n.destroy()})},onClose:()=>n.hide()})},onClose:()=>e.hide()})}}const ye=h(!1),be=h(null),Ze=h(null),_=h({name:"",modelName:"",type:"text",think:!1,mode:[],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]});function yt(e="text"){_.value={name:"",modelName:"",type:e,think:!1,mode:[],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]}}function Qe(){return u.value?(Array.isArray(u.value.models)||(u.value.models=Array.isArray(u.value.model)?[...u.value.model]:[]),u.value.model=u.value.models,u.value.models):[]}function bt(){const e=_.value.name.trim(),n=_.value.modelName.trim();if(!e)return window.$message.error($t("settings.vendor.msg.fillDisplayName")),null;if(!n)return window.$message.error($t("settings.vendor.msg.fillModelId")),null;if(_.value.type==="text")return{name:e,modelName:n,type:"text",think:_.value.think};if(_.value.type==="image"){const M=_.value.mode;return M.length?{name:e,modelName:n,type:"image",mode:M}:(window.$message.error($t("settings.vendor.msg.selectImageMode")),null)}const g=[..._.value.mode].filter(M=>M!=="multiReference");if(_.value.mixedMode.length>0){const M=_.value.mixedMode.map(j=>{const Y=_.value.mixedModeCount[j]??1;return`${j}:${Y}`});g.push(M)}if(!g.length)return window.$message.error($t("settings.vendor.msg.selectVideoMode")),null;const R=[];for(let M=0;M<_.value.durationResolutionMap.length;M++){const j=_.value.durationResolutionMap[M],Y=j.duration.map(Number).filter(Ve=>Number.isFinite(Ve)&&Ve>0),ie=j.resolution.filter(Boolean);if(!Y.length)return window.$message.error(`${$t("settings.vendor.msg.groupPrefix",{n:M+1})}${$t("settings.vendor.msg.addDuration")}`),null;if(!ie.length)return window.$message.error(`${$t("settings.vendor.msg.groupPrefix",{n:M+1})}${$t("settings.vendor.msg.addResolution")}`),null;R.push({duration:Y,resolution:ie})}return{name:e,modelName:n,type:"video",mode:g,audio:_.value.audio,durationResolutionMap:R}}function ht(){if(!u.value){window.$message.error($t("settings.vendor.msg.selectVendorFirst"));return}be.value=null,yt("text"),ye.value=!0}async function _t(){const e=Qe();if(!e.length&&!u.value)return;const n=bt();if(!n)return;if(e.findIndex((R,M)=>be.value!==null&&M===be.value?!1:R.modelName===n.modelName)!==-1){window.$message.error($t("settings.vendor.msg.modelIdExists"));return}if(be.value===null){try{await ee.post("/setting/vendorConfig/addVendorModel",{id:u.value.id,model:n}),window.$message.success($t("settings.vendor.msg.modelAdded")),ye.value=!1,K()}catch(R){window.$message.error(R.message??$t("settings.vendor.msg.operationFailed"))}return}if(be.value!==null)try{await ee.post("/setting/vendorConfig/upVendorModel",{id:u.value.id,modelName:Ze.value,model:n}),window.$message.success($t("settings.vendor.msg.modelUpdated")),ye.value=!1,K()}catch(R){window.$message.error(R.message??$t("settings.vendor.msg.operationFailed"))}}function Vt(e){var g;const n=Qe();if(be.value=n.findIndex(R=>R.modelName===e.modelName),Ze.value=e.modelName,e.type==="text"&&(_.value={name:e.name,modelName:e.modelName,type:"text",think:e.think,mode:[],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]}),e.type==="image"&&(_.value={name:e.name,modelName:e.modelName,type:"image",think:!1,mode:[...e.mode],mixedMode:[],mixedModeCount:{},audio:"optional",durationResolutionMap:[{duration:[],resolution:[]}]}),e.type==="video"){const R=((g=e.durationResolutionMap)==null?void 0:g.length)>0?e.durationResolutionMap.map(ie=>({duration:ie.duration.map(String),resolution:[...ie.resolution]})):[{duration:[],resolution:[]}],M=[];let j=[];const Y={};for(const ie of e.mode)if(Array.isArray(ie))for(const Ve of ie){const he=String(Ve).match(/^(videoReference|imageReference|audioReference):(\d+)$/);he&&(j.push(he[1]),Y[he[1]]=Number(he[2]))}else M.push(ie);_.value={name:e.name,modelName:e.modelName,type:"video",think:!1,mode:j.length>0?[...M,"multiReference"]:M,mixedMode:j,mixedModeCount:Y,audio:e.audio,durationResolutionMap:R}}ye.value=!0}function kt(e){D.value=e,e.type==="text"?fe.value=!0:e.type==="image"?b.value=!0:e.type==="video"&&(se.value=!0)}function Rt(e){if(!u.value)return;const n=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.deleteModelConfirm"),body:`${$t("settings.vendor.msg.deleteModelBody",{name:e})}`,confirmBtn:{content:$t("settings.vendor.msg.confirmDelete"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:async()=>{try{await ee.post("/setting/vendorConfig/delVendorModel",{id:u.value.id,modelName:e}),window.$message.success($t("settings.vendor.msg.modelDeleted")),K()}catch(g){window.$message.error(g.message??$t("settings.vendor.msg.operationFailed"))}finally{n.destroy()}}})}function wt(){u.value&&(Ce.value=u.value.id,r.value=u.value.code,i.value=!0)}function Ct(){if(!u.value)return;const e=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.deleteVendorConfirm"),body:`${$t("settings.vendor.msg.deleteVendorBody",{name:u.value.name})}`,confirmBtn:{content:$t("settings.vendor.msg.confirmDelete"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{var n;ee.post("/setting/vendorConfig/deleteVendor",{id:(n=u.value)==null?void 0:n.id}).then(()=>{var g;window.$message.success($t("settings.vendor.msg.vendorDeleted")),H.value===((g=u.value)==null?void 0:g.id)&&(H.value=void 0),K(),e.destroy()}).catch(g=>{window.$message.error(`${$t("settings.vendor.msg.deleteFailed")}${g.message}`)})}})}function et(){var e,n;ee.post("/setting/vendorConfig/updateVendorInputs",{id:(e=u.value)==null?void 0:e.id,inputValues:(n=u.value)==null?void 0:n.inputValues}).then(()=>{window.$message.success($t("settings.vendor.msg.vendorConfigUpdated")),K()}).catch(g=>{window.$message.error(`${$t("settings.vendor.msg.updateFailed")}${g.message}`)})}function Mt(e,n){const g=n===1?0:1;ee.post("/setting/vendorConfig/enableVendor",{id:e.id,enable:n}).then(()=>{}).catch(R=>{e.enable=g})}const pe=h("importAdd"),ke=h(""),Me=h(!1);ge(pe,e=>{e=="codeAdd"?i.value=!0:i.value=!1});function It(){if(Me.value)return;const e=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.linkAddVendorRiskBody"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{e.destroy();const n=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.addVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndAdd"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{const g=Oe({fullscreen:!0,attach:"body",preventScrollThrough:!1}),R=setTimeout(()=>{g.hide(),clearTimeout(R)},1e3);Me.value=!0;try{const{data:M}=await ee.post("/setting/vendorConfig/getCodeByLink",{link:ke.value});if(!M.includes("vendor")){let j=null;M.includes("<html>")?j=ae.alert({theme:"danger",header:"链接返回了一个网页，添加供应商需要返回TS代码，请确认链接是否正确",body:"请勿输入中转站地址，如需使用中转站请修改OpenAI标准接口的baseUrl使用中转站地址",onConfirm:({e:Y})=>{j.hide()}}):ae.alert({theme:"danger",header:"链接返回的内容不正确，添加供应商需要返回TS代码，请确认链接是否正确",onConfirm:({e:Y})=>{j.hide()}});return}M?(ee.post("/setting/vendorConfig/addVendor",{tsCode:M}),window.$message.success($t("settings.vendor.msg.vendorAdded")),C.value=!1,i.value=!1,K()):(window.$message.error($t("settings.vendor.msg.linkAddFailed")),i.value=!1)}catch(M){window.$message.error(`${$t("settings.vendor.msg.addFailed")}${M.message}`)}finally{clearTimeout(R),g.hide(),Me.value=!1,n.destroy()}},onClose:()=>n.hide()})},onClose:()=>e.hide()})}const tt=h();async function nt(e){const n=e.raw;if(!n)return window.$message.error($t("workbench.novel.import.msg.selectFile")),!1;Oe(!0);try{const g=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.highRiskConfirm"),body:$t("settings.vendor.msg.importAdd"),confirmBtn:{content:$t("settings.vendor.msg.iKnowRisk"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.cancel"),onConfirm:()=>{g.destroy();const R=ae.confirm({theme:"danger",header:$t("settings.vendor.msg.confirmAgain"),body:$t("settings.vendor.msg.addVendorConfirmBody"),confirmBtn:{content:$t("settings.vendor.msg.confirmAndAdd"),theme:"danger"},cancelBtn:$t("settings.vendor.msg.goBackCheck"),onConfirm:async()=>{const M=new FileReader;M.readAsText(n),M.onload=()=>{const j=M.result;ee.post("/setting/vendorConfig/addVendor",{tsCode:j}).then(Y=>{window.$message.success($t("settings.vendor.msg.vendorAdded")),C.value=!1,i.value=!1,K()}).catch(Y=>{window.$message.error(Y.message??`${$t("settings.vendor.msg.addFailed")}`)}).finally(()=>{R.destroy()})}},onClose:()=>R.hide()})},onClose:()=>g.hide()})}catch{window.$message.error($t("workbench.novel.import.msg.parseFailed"))}finally{Oe(!1)}return!1}const Ue=h([]);function Tt(){var e;(e=tt.value)==null||e.triggerUpload()}function At(){return Promise.resolve({response:{},status:"success"})}async function xt(e){var g;const n=(g=e.dataTransfer)==null?void 0:g.files;n&&n.length>0&&await nt({raw:n[0]})}function Ut(e){var M;const n=e.target,g=(M=n.files)==null?void 0:M[0];if(!g)return;const R=new FileReader;R.onload=j=>{var Y;r.value=((Y=j.target)==null?void 0:Y.result)||""},R.readAsText(g),n.value=""}return(e,n)=>{var it,dt,rt;const g=mt,R=xe,M=tn,j=Qt,Y=an,ie=dn,Ve=rn,he=un,de=We,Re=cn,Bt=pn,Pt=gn,ot=te("i-plus"),St=te("i-lightning"),Ft=te("i-pencil"),lt=te("i-delete"),Ie=fn,Lt=vn,st=sn,Nt=bn,Dt=yn,Be=ln,Pe=je,Se=_n,Fe=$n,Ot=Vn,at=hn,Le=Ae,Ne=Ge,qt=kn,zt=te("i-upload-one"),Et=Xt("loading");return a(),m("div",Ao,[d("div",xo,[d("div",Uo,[o(R,{block:"",theme:"primary",onClick:vt},{icon:s(()=>[o(g,{name:"add"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.addVendor")),1)]),_:1})]),Zt((a(),m("div",Bo,[t(y).length>0?(a(),B(ie,{key:0,modelValue:t(H),"onUpdate:modelValue":n[1]||(n[1]=l=>z(H)?H.value=l:null),theme:"light"},{default:s(()=>[(a(!0),m(T,null,G(t(y),(l,Z)=>(a(),B(Y,{key:Z,value:l.id,onClick:Q=>H.value=l.id,style:{position:"relative"}},De({default:s(()=>[d("span",null,c(l.name),1),o(j,{modelValue:l.enable,"onUpdate:modelValue":Q=>l.enable=Q,customValue:[1,0],onClick:n[0]||(n[0]=oe(()=>{},["stop"])),onChange:Q=>Mt(l,Q),style:{position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)","z-index":"10"}},null,8,["modelValue","onUpdate:modelValue","onChange"])]),_:2},[ct(l.icon)?{name:"icon",fn:s(()=>[o(M,{size:"24px",shape:"round",image:l.icon},null,8,["image"])]),key:"0"}:void 0]),1032,["value","onClick"]))),128))]),_:1},8,["modelValue"])):(a(),B(Ve,{key:1,title:e.$t("settings.vendor.noVendor"),style:{"margin-top":"16px"}},null,8,["title"]))])),[[Et,t(x)]])]),t(u)?(a(),m("div",Po,[d("div",So,[o(st,{data:t(u),labelAlign:"top"},{default:s(()=>[d("div",Fo,[d("span",Lo,"#"+c(t(u).id),1),d("span",No,"@"+c(t(u).author),1)]),gt(t(u))?(a(),B(he,{key:0,theme:"warning",message:e.$t("settings.vendor.msg.vendorNeedsUpdate"),style:{"margin-bottom":"12px"}},null,8,["message"])):A("",!0),o(de,null,{default:s(()=>[o(t(mn),{modelValue:t(u).description,"onUpdate:modelValue":n[2]||(n[2]=l=>t(u).description=l),theme:t(W).mode},null,8,["modelValue","theme"])]),_:1}),(a(!0),m(T,null,G(t(F),l=>(a(),B(de,{key:l.key,name:l.key},De({label:s(()=>[d("span",Do,[w(c(l.label)+" ",1),n[25]||(n[25]=d("span",{class:"requiredMark"},"*",-1)),d("span",Oo,c(e.$t("settings.vendor.required")),1)])]),default:s(()=>[o(Re,{modelValue:t(u).inputValues[l.key],"onUpdate:modelValue":Z=>t(u).inputValues[l.key]=Z,type:l.type,clearable:"",onBlur:et},{"prefix-icon":s(()=>[o(g,{name:J(l.type)},null,8,["name"])]),_:2},1032,["modelValue","onUpdate:modelValue","type"])]),_:2},[ue(l)?{name:"help",fn:s(()=>[d("span",qo,c(ue(l)),1)]),key:"0"}:void 0]),1032,["name"]))),128)),t(k).length>0?(a(),m("div",zo,[o(Pt,null,{default:s(()=>[o(Bt,{value:"optional-inputs",header:e.$t("settings.vendor.optionalSection")},{default:s(()=>[(a(!0),m(T,null,G(t(k),l=>(a(),B(de,{key:l.key,name:l.key,label:l.label},De({default:s(()=>[o(Re,{modelValue:t(u).inputValues[l.key],"onUpdate:modelValue":Z=>t(u).inputValues[l.key]=Z,type:l.type,clearable:"",onBlur:et},{"prefix-icon":s(()=>[o(g,{name:J(l.type)},null,8,["name"])]),_:2},1032,["modelValue","onUpdate:modelValue","type"])]),_:2},[ue(l)?{name:"help",fn:s(()=>[d("span",Eo,c(ue(l)),1)]),key:"0"}:void 0]),1032,["name","label"]))),128))]),_:1},8,["header"])]),_:1})])):A("",!0),d("div",Ko,[d("h4",Ho,c(e.$t("settings.vendor.modelSettings")),1),o(R,{variant:"outline",size:"small",onClick:ht},{icon:s(()=>[o(ot,{theme:"outline"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.addManually")),1)]),_:1})]),(a(!0),m(T,null,G(t(q),(l,Z)=>(a(),B(Lt,{key:Z,class:"modelCard"},{default:s(()=>[d("div",jo,[d("div",Go,[Je(l.modelName)?(a(),B(M,{key:0,size:"24px",shape:"round",image:Je(l.modelName)},null,8,["image"])):A("",!0),d("span",Wo,c(l.name),1)]),d("div",Jo,[o(R,{size:"small",variant:"text",onClick:Q=>kt(l)},{icon:s(()=>[o(St,{theme:"outline"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.testModel")),1)]),_:1},8,["onClick"]),o(R,{variant:"text",size:"small",onClick:Q=>Vt(l)},{icon:s(()=>[o(Ft,{theme:"outline"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.edit")),1)]),_:1},8,["onClick"]),o(R,{variant:"text",size:"small",theme:"danger",onClick:Q=>Rt(l.modelName)},{icon:s(()=>[o(lt,{theme:"outline"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.delete")),1)]),_:1},8,["onClick"])])]),d("div",Yo,[o(Ie,{theme:"primary"},{default:s(()=>[w(c(e.$t(P(l.type))),1)]),_:2},1024),l.type==="text"&&l.think?(a(),B(Ie,{key:0,variant:"light"},{default:s(()=>[w(c(e.$t("settings.vendor.think")),1)]),_:1})):A("",!0),(a(!0),m(T,null,G(l.mode,(Q,Kt)=>(a(),m(T,{key:Kt},[Array.isArray(Q)?(a(!0),m(T,{key:1},G(Q,(Ht,jt)=>(a(),B(Ie,{variant:"light",key:jt},{default:s(()=>[w(c(f(Ht,l.type)),1)]),_:2},1024))),128)):(a(),B(Ie,{key:0,variant:"light"},{default:s(()=>[w(c(f(Q,l.type)),1)]),_:2},1024))],64))),128))])]),_:2},1024))),128))]),_:1},8,["data"]),d("div",Xo,[o(R,{theme:"danger",loading:t(X),onClick:Ct},{default:s(()=>[w(c(e.$t("settings.vendor.deleteVendor")),1)]),_:1},8,["loading"]),o(R,{theme:"default",loading:t(X),onClick:wt},{default:s(()=>[w(c(e.$t("settings.vendor.editCode")),1)]),_:1},8,["loading"])])])])):A("",!0),o(Le,{placement:"center",width:"40vw",visible:t(ye),"onUpdate:visible":n[12]||(n[12]=l=>z(ye)?ye.value=l:null),header:t(be)===null?e.$t("settings.vendor.addModel"):e.$t("settings.vendor.editModel"),maskClosable:!1,onConfirm:_t},{default:s(()=>[d("div",Zo,[o(st,{data:t(_),labelAlign:"top"},{default:s(()=>[o(de,{name:"name",label:e.$t("settings.vendor.displayName")},{default:s(()=>[o(Re,{modelValue:t(_).name,"onUpdate:modelValue":n[3]||(n[3]=l=>t(_).name=l),placeholder:e.$t("settings.vendor.displayNamePlaceholder"),clearable:""},null,8,["modelValue","placeholder"])]),_:1},8,["label"]),o(de,{name:"modelName",label:e.$t("settings.vendor.modelId")},{default:s(()=>[o(Re,{modelValue:t(_).modelName,"onUpdate:modelValue":n[4]||(n[4]=l=>t(_).modelName=l),placeholder:e.$t("settings.vendor.modelIdPlaceholder"),clearable:""},null,8,["modelValue","placeholder"])]),_:1},8,["label"]),o(de,{name:"type",label:e.$t("settings.vendor.modelType")},{default:s(()=>[o(Dt,{modelValue:t(_).type,"onUpdate:modelValue":n[5]||(n[5]=l=>t(_).type=l)},{default:s(()=>[(a(),m(T,null,G(E,l=>o(Nt,{key:l.value,value:l.value},{default:s(()=>[w(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"])]),_:1},8,["label"]),t(_).type==="text"?(a(),B(de,{key:0,name:"think",label:e.$t("settings.vendor.think")},{default:s(()=>[o(Pe,{modelValue:t(_).think,"onUpdate:modelValue":n[6]||(n[6]=l=>t(_).think=l)},{default:s(()=>[o(Be,{value:!0},{default:s(()=>[w(c(e.$t("settings.vendor.supported")),1)]),_:1}),o(Be,{value:!1},{default:s(()=>[w(c(e.$t("settings.vendor.notSupported")),1)]),_:1})]),_:1},8,["modelValue"])]),_:1},8,["label"])):A("",!0),t(_).type==="image"?(a(),B(de,{key:1,name:"mode",label:e.$t("settings.vendor.imageMode")},{default:s(()=>[o(Fe,{modelValue:t(_).mode,"onUpdate:modelValue":n[7]||(n[7]=l=>t(_).mode=l)},{default:s(()=>[(a(),m(T,null,G($,l=>o(Se,{key:l.value,value:l.value},{default:s(()=>[w(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"])]),_:1},8,["label"])):A("",!0),t(_).type==="video"?(a(),m(T,{key:2},[o(de,{name:"mode",label:e.$t("settings.vendor.videoMode")},{default:s(()=>[d("div",Qo,[o(Fe,{modelValue:t(_).mode,"onUpdate:modelValue":n[8]||(n[8]=l=>t(_).mode=l)},{default:s(()=>[(a(),m(T,null,G(V,l=>o(Se,{key:l.value,value:l.value},{default:s(()=>[w(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"]),t(_).mode.includes("multiReference")?(a(),m("div",el,[o(Fe,{modelValue:t(_).mixedMode,"onUpdate:modelValue":n[9]||(n[9]=l=>t(_).mixedMode=l),style:{display:"flex","flex-direction":"row",gap:"8px","flex-wrap":"wrap","align-items":"center"}},{default:s(()=>[(a(),m(T,null,G(p,l=>(a(),m(T,{key:l.value},[o(Se,{value:l.value},{default:s(()=>[w(c(e.$t(l.label)),1)]),_:2},1032,["value"]),t(_).mixedMode.includes(l.value)?(a(),B(Ot,{key:0,modelValue:t(_).mixedModeCount[l.value],"onUpdate:modelValue":Z=>t(_).mixedModeCount[l.value]=Z,min:1,max:99,size:"small",style:{width:"80px"},placeholder:e.$t("settings.vendor.count")},null,8,["modelValue","onUpdate:modelValue","placeholder"])):A("",!0)],64))),64))]),_:1},8,["modelValue"])])):A("",!0)])]),_:1},8,["label"]),o(de,{name:"audio",label:e.$t("settings.vendor.audioOutput")},{default:s(()=>[o(Pe,{modelValue:t(_).audio,"onUpdate:modelValue":n[10]||(n[10]=l=>t(_).audio=l)},{default:s(()=>[(a(),m(T,null,G(v,l=>o(Be,{key:String(l.value),value:l.value},{default:s(()=>[w(c(e.$t(l.label)),1)]),_:2},1032,["value"])),64))]),_:1},8,["modelValue"])]),_:1},8,["label"]),o(de,{name:"durationResolutionMap",label:e.$t("settings.vendor.durationResolution")},{default:s(()=>[d("div",tl,[d("div",nl,[n[26]||(n[26]=d("div",{class:"drmHeaderIndex"},null,-1)),d("div",ol,c(e.$t("settings.vendor.durationSec")),1),n[27]||(n[27]=d("div",{class:"drmHeaderArrow"},null,-1)),d("div",ll,c(e.$t("settings.vendor.resolution")),1),n[28]||(n[28]=d("div",{class:"drmHeaderAction"},null,-1))]),(a(!0),m(T,null,G(t(_).durationResolutionMap,(l,Z)=>(a(),m("div",{key:Z,class:"drmRow"},[d("div",sl,c(Z+1),1),o(at,{modelValue:l.duration,"onUpdate:modelValue":Q=>l.duration=Q,placeholder:e.$t("settings.vendor.enterAndPress"),class:"drmInput"},null,8,["modelValue","onUpdate:modelValue","placeholder"]),n[29]||(n[29]=d("div",{class:"drmArrow"},"→",-1)),o(at,{modelValue:l.resolution,"onUpdate:modelValue":Q=>l.resolution=Q,placeholder:e.$t("settings.vendor.enterAndPress"),class:"drmInput"},null,8,["modelValue","onUpdate:modelValue","placeholder"]),o(R,{variant:"text",theme:"danger",size:"small",disabled:t(_).durationResolutionMap.length===1,onClick:Q=>t(_).durationResolutionMap.splice(Z,1)},{icon:s(()=>[o(lt,{theme:"outline"})]),_:1},8,["disabled","onClick"])]))),128)),o(R,{style:{"margin-top":"16px"},variant:"dashed",block:"",onClick:n[11]||(n[11]=l=>t(_).durationResolutionMap.push({duration:[],resolution:[]}))},{icon:s(()=>[o(ot,{theme:"outline"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.addDurationResolution")),1)]),_:1})])]),_:1},8,["label"])],64)):A("",!0)]),_:1},8,["data"])])]),_:1},8,["visible","header"]),((it=t(D))==null?void 0:it.type)==="text"&&t(fe)?(a(),B(Ln,{key:1,modelVisible:t(fe),"onUpdate:modelVisible":n[13]||(n[13]=l=>z(fe)?fe.value=l:null),vendorId:t(u).id,modelName:t(D).modelName},null,8,["modelVisible","vendorId","modelName"])):A("",!0),((dt=t(D))==null?void 0:dt.type)==="image"&&t(b)?(a(),B(Zn,{key:2,modelVisible:t(b),"onUpdate:modelVisible":n[14]||(n[14]=l=>z(b)?b.value=l:null),vendorId:t(u).id,modelName:t(D).modelName,supportedModes:t(D).mode||[]},null,8,["modelVisible","vendorId","modelName","supportedModes"])):A("",!0),((rt=t(D))==null?void 0:rt.type)==="video"&&t(se)?(a(),B(To,{key:3,modelVisible:t(se),"onUpdate:modelVisible":n[15]||(n[15]=l=>z(se)?se.value=l:null),vendorId:t(u).id,modelName:t(D).modelName,rawModes:t(D).mode||[]},null,8,["modelVisible","vendorId","modelName","rawModes"])):A("",!0),o(Le,{width:"30vw",placement:"center",top:"10vh",footer:!1,visible:t(C),"onUpdate:visible":n[20]||(n[20]=l=>z(C)?C.value=l:null),header:e.$t("settings.vendor.addVendorDialog"),maskClosable:!1},{default:s(()=>[d("div",al,[o(Pe,{variant:"default-filled",modelValue:t(pe),"onUpdate:modelValue":n[16]||(n[16]=l=>z(pe)?pe.value=l:null)},{default:s(()=>[o(Ne,{value:"importAdd"},{default:s(()=>[...n[30]||(n[30]=[w("通过文件导入",-1)])]),_:1}),o(Ne,{value:"linkAdd"},{default:s(()=>[...n[31]||(n[31]=[w("通过链接添加",-1)])]),_:1}),o(Ne,{value:"codeAdd"},{default:s(()=>[...n[32]||(n[32]=[w("通过代码添加",-1)])]),_:1})]),_:1},8,["modelValue"]),t(pe)=="linkAdd"?(a(),m("div",il,[o(he,{theme:"warning",style:{"margin-bottom":"20px"}},{default:s(()=>[...n[33]||(n[33]=[w(" 请填写 TypeScript 代码文件的链接（.ts 文件），不要填 API 地址或其他无关链接。 确认后 Toonflow 会自动加载该代码，请确保链接来源可信。 ",-1)])]),_:1}),o(Re,{modelValue:t(ke),"onUpdate:modelValue":n[17]||(n[17]=l=>z(ke)?ke.value=l:null),placeholder:e.$t("settings.vendor.linkAddPlaceholder")},null,8,["modelValue","placeholder"]),d("div",dl,[o(R,{loading:t(Me),disabled:!t(ke).trim(),onClick:It},{default:s(()=>[w(c(e.$t("settings.vendor.linkAdd")),1)]),_:1},8,["loading","disabled"])])])):A("",!0),t(pe)=="importAdd"?(a(),m("div",rl,[d("div",{class:"uploadArea",onClick:Tt,onDragover:n[19]||(n[19]=oe(()=>{},["prevent"])),onDrop:oe(xt,["prevent"])},[o(qt,{ref_key:"uploadRef",ref:tt,modelValue:t(Ue),"onUpdate:modelValue":n[18]||(n[18]=l=>z(Ue)?Ue.value=l:null),theme:"file",multiple:!1,max:1,accept:".ts","before-upload":nt,"request-method":At,style:{display:"none"}},null,8,["modelValue"]),d("div",ul,[o(zt,{theme:"outline",size:"32",fill:"var(--td-brand-color)"})]),d("p",ml,c(e.$t("workbench.novel.import.importAdd")),1),d("p",cl,c(e.$t("workbench.novel.import.limit")),1)],32)])):A("",!0),t(pe)=="codeAdd"?(a(),m("div",gl)):A("",!0)])]),_:1},8,["visible","header"]),o(Le,{width:"70vw",placement:"center",top:"10vh",visible:t(i),"onUpdate:visible":n[24]||(n[24]=l=>z(i)?i.value=l:null),header:e.$t("settings.vendor.code"),maskClosable:!1,onConfirm:ft},{default:s(()=>[d("div",pl,[d("div",vl,[o(g,{name:"info-circle",size:"16px"}),d("span",null,c(e.$t("settings.vendor.codeEditorInfo")),1)]),d("div",fl,[o(R,{variant:"text",size:"small",onClick:n[21]||(n[21]=l=>r.value=t(qe))},{icon:s(()=>[o(g,{name:"rollback"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.reset")),1)]),_:1}),o(R,{variant:"outline",size:"small",onClick:n[22]||(n[22]=l=>{var Z;return(Z=t(N))==null?void 0:Z.click()})},{icon:s(()=>[o(g,{name:"upload"})]),default:s(()=>[w(" "+c(e.$t("settings.vendor.importFile")),1)]),_:1}),d("input",{ref_key:"fileInputRef",ref:N,type:"file",accept:".ts,.js,.txt,.json",style:{display:"none"},onChange:Ut},null,544)])]),d("div",yl,[o(t(en),{value:t(r),"onUpdate:value":n[23]||(n[23]=l=>z(r)?r.value=l:null),language:"typescript",theme:"vs-dark",height:600,options:S},null,8,["value"])])]),_:1},8,["visible","header"])])}}}),us=_e(hl,[["__scopeId","data-v-4efe8a38"]]);export{us as default};
