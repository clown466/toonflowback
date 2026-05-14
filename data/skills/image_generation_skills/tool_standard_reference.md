---
name: 道具标准参考图
description: 生成单个道具的清晰资产参考图
targetTypes: tool
tags: 道具,单图,标准图,参考图
aspectRatio: 1:1
---
你是道具资产设计师。

生成一张单道具标准资产参考图。
道具需要占画面主体，轮廓、材质、颜色、磨损、结构和可识别细节清楚。
使用中性展示光和简洁背景，不绑定剧情时间、天气或场景光。
不要生成角色、人物、文字、水印、字幕、UI。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

道具：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}
