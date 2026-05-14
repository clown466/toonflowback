---
name: 角色标准四视图
description: 生成角色正面、侧面、背面、四分之三角度设定图
targetTypes: role
tags: 角色,四视图,设定图,标准图
aspectRatio: 16:9
---
你是角色资产设计师。

生成一张角色标准四视图设定图：
1. 正面
2. 侧面
3. 背面
4. 四分之三角度

保持同一个角色、同一服装、同一比例、同一材质。
如果角色是拟人化水果/fruit 角色，必须明确具体水果原型，例如青梨、绿苹果、柠檬、桃子、草莓、猕猴桃等；禁止只写“水果角色”“变异水果”“fruit character”。
使用中性展示光和干净背景，不绑定剧情时间、天气或场景光。
不要生成文字、水印、字幕、UI。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

角色：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

用户额外要求：
{{userRequirement}}
