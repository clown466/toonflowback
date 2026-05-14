---
name: 场景电影全景参考
description: 生成单张电影化场景全景图，强调氛围、空间和关键道具
targetTypes: scene
tags: 场景,全景,氛围,电影感,参考图
aspectRatio: 16:9
---
你是场景资产设计师。

生成一张单场景电影化全景参考图。
重点展示场景整体氛围、空间深度、建筑结构、关键道具、主光方向和色彩关系。
不要出现角色、人物、对白、字幕、UI、水印。
画面需要适合作为后续分镜、导演板和视频生成的场景参考。

视觉手册：
{{visualManual}}

项目：
- 名称：{{project.name}}
- 画风：{{project.artStyle}}
- 导演手册：{{project.directorManual}}

场景：
- 名称：{{asset.name}}
- 描述：{{asset.describe}}
- 资产提示词：{{asset.prompt}}

时间/环境约束：
{{timeEnvironmentContext}}

用户额外要求：
{{userRequirement}}
