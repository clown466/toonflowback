export type TimeOfDay = "day" | "night" | "dusk" | "dawn" | "morning" | "unknown";

export type TimeEnvironmentAssetType = "role" | "scene" | "tool" | "storyboard";

export interface TimeEnvironmentInferenceInput {
  assetType?: TimeEnvironmentAssetType;
  project?: {
    id?: number;
    name?: string | null;
    intro?: string | null;
    type?: string | null;
    artStyle?: string | null;
  };
  asset?: {
    id?: number;
    type?: TimeEnvironmentAssetType;
    name?: string | null;
    describe?: string | null;
    prompt?: string | null;
  };
  userRequirement?: string | null;
  assetName?: string | null;
  assetDescribe?: string | null;
  assetPrompt?: string | null;
  novelEvents?: string[];
  chapterTexts?: string[];
}

export interface TimeEnvironmentResult {
  applies: boolean;
  timeOfDay: TimeOfDay;
  timeExpression?: string | null;
  lighting?: string | null;
  weather?: string | null;
  locationState?: string | null;
  confidence: number;
  evidence: string[];
  contextText: string;
  neutralLightingText: string;
}

interface SourceText {
  label: string;
  text: string;
  priority: number;
  isUserRequirement: boolean;
}

interface TimeMatch {
  timeOfDay: Exclude<TimeOfDay, "unknown">;
  expression: string;
  source: SourceText;
}

const TIME_PATTERNS: Array<{ timeOfDay: Exclude<TimeOfDay, "unknown">; pattern: RegExp }> = [
  { timeOfDay: "night", pattern: /雨夜|雪夜|雾夜|月夜|星夜|夜晚|夜里|夜间|深夜|午夜|子夜|黑夜|入夜|夜色|晚上/ },
  { timeOfDay: "dusk", pattern: /黄昏|傍晚|夕阳|落日|日落|暮色|薄暮/ },
  { timeOfDay: "dawn", pattern: /凌晨|黎明|破晓|拂晓|天蒙蒙亮|天刚亮/ },
  { timeOfDay: "morning", pattern: /清晨|早晨|早上|上午|晨光|朝阳/ },
  { timeOfDay: "day", pattern: /白天|日间|中午|正午|午后|下午|阳光明媚|烈日|日光/ },
];

const WEATHER_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "雨", pattern: /暴雨|大雨|小雨|细雨|雨夜|下雨|雨中|雨天|雨幕|雨水|阵雨|雷雨/ },
  { value: "雪", pattern: /暴雪|大雪|小雪|飘雪|雪夜|下雪|雪中|雪天|雪地|风雪/ },
  { value: "雾", pattern: /大雾|薄雾|浓雾|晨雾|雾夜|雾中|雾气|雾天|迷雾/ },
];

const LIGHTING_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "冷色室内灯光", pattern: /室内.*?(冷光|冷色|灯光|灯|台灯|顶灯)|冷光.*?室内|冷色.*?室内/ },
  { value: "暖色室内灯光", pattern: /室内.*?(暖光|暖色|灯光|灯|台灯|顶灯|烛光)|暖光.*?室内|暖色.*?室内|烛光/ },
  { value: "室内灯光", pattern: /室内|房间|屋内|店内|办公室|大厅|走廊|室内灯|灯光/ },
  { value: "自然日光", pattern: /室外|户外|街道|广场|森林|山谷|海边|庭院|阳光|日光|自然光/ },
  { value: "月光与低照度环境光", pattern: /月光|星光|夜色|夜景|黑夜|暗处|昏暗/ },
  { value: "夕阳暖光", pattern: /夕阳|落日|黄昏|傍晚|暮色/ },
  { value: "黎明柔光", pattern: /黎明|破晓|拂晓|晨光|清晨|早晨/ },
];

const LOCATION_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "室内", pattern: /室内|屋内|房间|店内|办公室|大厅|走廊|卧室|客厅|厨房|教室|车内/ },
  { value: "室外", pattern: /室外|户外|街道|广场|森林|山谷|海边|庭院|路上|雨中|雪地|夜空|天空/ },
];

const EXPLICIT_USER_PATTERN = /强制|必须|务必|改成|改为|换成|变成|设为|设置为|指定|要求|请用|使用/;

export function buildNeutralAssetLightingText(assetType?: TimeEnvironmentAssetType): string {
  if (assetType === "role") return "中性标准角色展示光，均匀柔和布光，纯净背景，不绑定剧情时间、天气或场景光源。";
  if (assetType === "tool") return "中性标准道具展示光，均匀柔和布光，清晰展示结构与材质，不绑定剧情时间、天气或场景光源。";
  if (assetType === "scene") return "中性环境光，均匀柔和布光，不额外编造具体时间、天气或戏剧化光源。";
  return "中性环境光，均匀柔和布光，不额外编造具体时间、天气或戏剧化光源。";
}

export function inferTimeEnvironment(input: TimeEnvironmentInferenceInput): TimeEnvironmentResult {
  const assetType = input.assetType ?? input.asset?.type;
  const neutralLightingText = buildNeutralAssetLightingText(assetType);

  if (assetType === "role" || assetType === "tool") {
    return {
      applies: false,
      timeOfDay: "unknown",
      timeExpression: null,
      lighting: neutralLightingText,
      weather: null,
      locationState: null,
      confidence: 1,
      evidence: [`${assetType} 标准资产图不注入剧情时间环境。`],
      contextText: `时间环境：不适用；${neutralLightingText}`,
      neutralLightingText,
    };
  }

  const sources = buildSources(input);
  const userTimeMatches = collectTimeMatches(sources.filter((source) => source.isUserRequirement));
  const allTimeMatches = collectTimeMatches(sources);
  const explicitUserTimeMatches = userTimeMatches.filter((match) => isExplicitUserTime(match.source.text, match.expression));
  const chosenTime = chooseTime(explicitUserTimeMatches.length ? explicitUserTimeMatches : allTimeMatches);
  const weather = chooseSingleValue(WEATHER_PATTERNS, sources);
  const locationState = chooseSingleValue(LOCATION_PATTERNS, sources);
  const lighting = chooseLighting(sources, chosenTime.timeOfDay, weather.value, locationState.value, neutralLightingText);
  const evidence = [
    ...chosenTime.evidence,
    ...weather.evidence,
    ...locationState.evidence,
    ...lighting.evidence,
  ];
  const confidence = calculateConfidence(chosenTime, weather.value, locationState.value, lighting.value, explicitUserTimeMatches.length > 0);
  const contextText = buildContextText({
    timeOfDay: chosenTime.timeOfDay,
    timeExpression: chosenTime.expression,
    lighting: lighting.value,
    weather: weather.value,
    locationState: locationState.value,
    neutralLightingText,
  });

  return {
    applies: true,
    timeOfDay: chosenTime.timeOfDay,
    timeExpression: chosenTime.expression,
    lighting: lighting.value,
    weather: weather.value,
    locationState: locationState.value,
    confidence,
    evidence: evidence.length ? evidence : ["未识别到明确时间环境线索，使用中性环境光。"],
    contextText,
    neutralLightingText,
  };
}

function buildSources(input: TimeEnvironmentInferenceInput): SourceText[] {
  const sources: SourceText[] = [];
  addSource(sources, "用户要求", input.userRequirement, 100, true);
  addSource(sources, "资产名称", input.assetName ?? input.asset?.name, 55, false);
  addSource(sources, "资产描述", input.assetDescribe ?? input.asset?.describe, 50, false);
  addSource(sources, "资产提示词", input.assetPrompt ?? input.asset?.prompt, 50, false);
  input.novelEvents?.forEach((text, index) => addSource(sources, `小说事件#${index + 1}`, text, 35, false));
  input.chapterTexts?.forEach((text, index) => addSource(sources, `章节文本#${index + 1}`, text, 25, false));
  return sources;
}

function addSource(sources: SourceText[], label: string, value: string | null | undefined, priority: number, isUserRequirement: boolean) {
  const text = value?.trim();
  if (!text) return;
  sources.push({ label, text, priority, isUserRequirement });
}

function collectTimeMatches(sources: SourceText[]) {
  const matches: TimeMatch[] = [];
  for (const source of sources) {
    for (const config of TIME_PATTERNS) {
      const match = source.text.match(config.pattern);
      if (match?.[0]) matches.push({ timeOfDay: config.timeOfDay, expression: match[0], source });
    }
  }
  return matches;
}

function isExplicitUserTime(text: string, expression: string) {
  if (EXPLICIT_USER_PATTERN.test(text)) return true;
  return new RegExp(`.{0,8}${escapeRegExp(expression)}|${escapeRegExp(expression)}.{0,8}`).test(text);
}

function chooseTime(matches: TimeMatch[]): { timeOfDay: TimeOfDay; expression: string | null; evidence: string[]; conflict: boolean } {
  if (!matches.length) return { timeOfDay: "unknown", expression: null, evidence: [], conflict: false };

  const scores = new Map<Exclude<TimeOfDay, "unknown">, number>();
  const examples = new Map<Exclude<TimeOfDay, "unknown">, TimeMatch>();
  for (const match of matches) {
    scores.set(match.timeOfDay, (scores.get(match.timeOfDay) || 0) + match.source.priority);
    if (!examples.has(match.timeOfDay) || examples.get(match.timeOfDay)!.source.priority < match.source.priority) {
      examples.set(match.timeOfDay, match);
    }
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return {
      timeOfDay: "unknown",
      expression: null,
      evidence: [`存在冲突时间线索：${ranked.map(([time]) => timeLabel(time)).join("、")}，未使用具体时间。`],
      conflict: true,
    };
  }

  const [timeOfDay] = ranked[0];
  const example = examples.get(timeOfDay)!;
  return {
    timeOfDay,
    expression: example.expression,
    evidence: [`${example.source.label} 命中时间线索“${example.expression}”，推理为${timeLabel(timeOfDay)}。`],
    conflict: false,
  };
}

function chooseSingleValue(configs: Array<{ value: string; pattern: RegExp }>, sources: SourceText[]) {
  const scores = new Map<string, { score: number; label: string; expression: string }>();
  for (const source of sources) {
    for (const config of configs) {
      const match = source.text.match(config.pattern);
      if (!match?.[0]) continue;
      const current = scores.get(config.value);
      const nextScore = (current?.score || 0) + source.priority;
      scores.set(config.value, { score: nextScore, label: source.label, expression: match[0] });
    }
  }
  const ranked = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return { value: null as string | null, evidence: [] };
  if (ranked.length > 1 && ranked[0][1].score === ranked[1][1].score) return { value: null as string | null, evidence: [] };
  return {
    value: ranked[0][0],
    evidence: [`${ranked[0][1].label} 命中环境线索“${ranked[0][1].expression}”，推理为${ranked[0][0]}。`],
  };
}

function chooseLighting(
  sources: SourceText[],
  timeOfDay: TimeOfDay,
  weather: string | null,
  locationState: string | null,
  neutralLightingText: string,
) {
  const matched = chooseSingleValue(LIGHTING_PATTERNS, sources);
  if (matched.value) return matched;
  if (weather === "雨") return { value: "阴雨漫反射环境光", evidence: ["根据雨天线索补充阴雨漫反射光照。"] };
  if (weather === "雪") return { value: "雪天高反射柔光", evidence: ["根据雪天线索补充雪地柔和反射光。"] };
  if (weather === "雾") return { value: "雾天低对比漫射光", evidence: ["根据雾天线索补充低对比漫射光。"] };
  if (timeOfDay === "night") return { value: locationState === "室内" ? "冷色室内灯光" : "月光与低照度环境光", evidence: ["根据夜晚线索补充低照度光照。"] };
  if (timeOfDay === "dusk") return { value: "夕阳暖光", evidence: ["根据黄昏线索补充夕阳暖光。"] };
  if (timeOfDay === "dawn" || timeOfDay === "morning") return { value: "清晨柔和自然光", evidence: ["根据清晨/黎明线索补充柔和自然光。"] };
  if (timeOfDay === "day") return { value: "自然日光", evidence: ["根据白天线索补充自然日光。"] };
  return { value: neutralLightingText, evidence: [] };
}

function calculateConfidence(
  chosenTime: { timeOfDay: TimeOfDay; conflict: boolean },
  weather: string | null,
  locationState: string | null,
  lighting: string | null,
  hasExplicitUserTime: boolean,
) {
  if (chosenTime.conflict) return 0.2;
  let confidence = chosenTime.timeOfDay === "unknown" ? 0.35 : 0.68;
  if (hasExplicitUserTime) confidence += 0.2;
  if (weather) confidence += 0.04;
  if (locationState) confidence += 0.04;
  if (lighting) confidence += 0.04;
  return Math.min(Number(confidence.toFixed(2)), 0.98);
}

function buildContextText(input: {
  timeOfDay: TimeOfDay;
  timeExpression: string | null;
  lighting: string | null;
  weather: string | null;
  locationState: string | null;
  neutralLightingText: string;
}) {
  if (input.timeOfDay === "unknown" && !input.weather && !input.locationState) {
    return `时间环境：未识别到明确剧情时间；光照：${input.neutralLightingText}`;
  }

  const parts = [
    `推理时间：${input.timeOfDay === "unknown" ? "未知" : timeLabel(input.timeOfDay)}`,
    input.timeExpression ? `原始表达：${input.timeExpression}` : null,
    input.lighting ? `光照：${input.lighting}` : null,
    input.weather ? `天气：${input.weather}` : null,
    input.locationState ? `空间状态：${input.locationState}` : null,
  ].filter((part): part is string => Boolean(part));

  return `时间环境：${parts.join("；")}。`;
}

function timeLabel(timeOfDay: Exclude<TimeOfDay, "unknown">) {
  const labels: Record<Exclude<TimeOfDay, "unknown">, string> = {
    day: "白天",
    night: "夜晚",
    dusk: "黄昏",
    dawn: "凌晨/黎明",
    morning: "清晨/上午",
  };
  return labels[timeOfDay];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
