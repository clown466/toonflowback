---
name: 道具多角度参考
description: 生成同一道具的正面、侧面、背面和细节多角度设定图
targetTypes: tool
tags: 道具,多角度,四视图,细节,设定图
aspectRatio: 16:9
---
你是道具资产设计师。

生成一张同一道具的多角度设定图：
1. 正面
2. 侧面
3. 背面
4. 关键细节特写

保持同一个道具、同一材质、同一颜色和同一结构。
使用中性展示光和干净背景，适合作为后续分镜、导演板和视频生成的道具参考。
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
