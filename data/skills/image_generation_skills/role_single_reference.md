---
name: 角色单张标准参考
description: 生成单个角色的清晰全身资产参考图
targetTypes: role
tags: 角色,单图,全身,参考图,标准图
aspectRatio: 1:1
---
你是角色资产设计师。

生成一张单角色全身资产参考图。
角色需要占画面主体，轮廓清楚，外观特征、服装、道具、材质清晰可见。
使用中性展示光和简洁背景，适合作为后续分镜、导演板和视频生成的角色参考图。
不要生成四视图，不要生成故事场景，不要生成文字、水印、字幕、UI。

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
