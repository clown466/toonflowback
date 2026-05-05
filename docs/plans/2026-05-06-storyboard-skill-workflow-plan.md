# Storyboard Skill Workflow Plan

## Current Finding

Toonflow already has storyboard-related markdown skills. They live under shared skills directories, for example:

- `production_execution_storyboard_gen.md`
- `production_execution_storyboard_table.md`
- `production_skills/storyboard_prompt_techniques.md`
- `production_skills/storyboard_table_techniques.md`
- `art_skills/*/driector_skills/director_storyboard.md`
- `story_skills/*/driector_skills/director_storyboard_table_narrative.md`

The missing part is not the existence of markdown skills. The missing part is the product workflow that lets a user select or write a storyboard-generation skill and makes the Flova storyboard generator actually use it.

At the moment, the command pipeline routes "generate storyboard" to `generateProjectStoryboardDraft()`, which creates a fast template draft. That path reads novel chapters, event summaries, and assets, then writes storyboard rows directly. It does not run a text-model director pass using the storyboard markdown skills.

## Product Goal

Make storyboard generation work like a real director workflow:

1. The user asks Flova to generate storyboards for a specific chapter or range.
2. The workspace agent resolves the chapter scope safely.
3. The system selects a storyboard skill automatically, or uses the user-selected/user-mentioned skill.
4. A text model reads only the selected chapter context plus project-level constraints.
5. The model outputs validated structured storyboard JSON.
6. The backend writes `o_storyboard`, `o_assets2Storyboard`, and `o_agentWorkData` for the Flova canvas.
7. The legacy template generator remains as fallback only.

## Definitions

- `Storyboard Skill`: a markdown instruction file whose target is storyboard generation or storyboard table generation.
- `Storyboard Table`: a structured shot list / storyboard script, not an image prompt list.
- `Storyboard Image Prompt`: the prompt used to generate a still image for one storyboard item.
- `Storyboard Item`: one row in `o_storyboard`, containing `videoDesc`, `prompt`, duration, track, and associated asset IDs.

## Skill Metadata

Existing skills can remain where they are, but the system should recognize storyboard skills through frontmatter:

```md
---
id: cinematic_chapter_storyboard
name: Cinematic Chapter Storyboard
description: Generate structured chapter storyboards with cinematic rhythm.
target: storyboard_generation
tags: cinematic,chapter,action,comedy
output: storyboard_json
defaultShotsPerBeat: 2-4
---
```

Supported targets:

- `storyboard_generation`: creates storyboard items.
- `storyboard_table`: creates or refines the storyboard table / script.
- `storyboard_image_prompt`: converts a storyboard item into image-generation prompt text.

## Context Used By Storyboard Inference

The storyboard director should infer shots from these inputs:

- Project data: name, intro, type, art style, director manual.
- Selected chapter: `o_novel.chapterIndex`, `chapter`, `chapterData`, `event`.
- Existing assets: `o_assets` rows for roles, scenes, tools.
- Asset chosen images: `o_assets.imageId` and completed `o_image` records.
- Character facts: role fact cards inferred from text and uploaded reference images.
- Visual manual: art and director markdown under project style/manual.
- User requirement: the current message, including requested shot count, style, pacing, references, and selected skill.
- Optional user reference images: uploaded images attached to a storyboard request.

Chapter isolation is mandatory. When generating `juben10`, do not include `juben11+` chapter text. If global context is needed, use only short project-level summaries, asset facts, and visual manuals.

## Output Contract

The text model must output JSON, not freeform prose:

```json
{
  "chapterIndex": 10,
  "chapterName": "juben10",
  "skillId": "cinematic_chapter_storyboard",
  "storyboardTable": "| Shot | Duration | Visual | Assets |",
  "shots": [
    {
      "index": 1,
      "duration": 4,
      "beat": "Opening conflict",
      "scene": "Safe Bunker",
      "shotSize": "wide",
      "cameraMove": "slow push in",
      "action": "Chloe checks the shotgun while Bob watches the monitor.",
      "emotion": "tense dark comedy",
      "lighting": "cold bunker light",
      "videoDesc": "Wide establishing shot...",
      "imagePrompt": "3D anthropomorphic dark comedy storyboard keyframe...",
      "associateAssetNames": ["Chloe", "Bob", "Safe Bunker"],
      "shouldGenerateImage": true
    }
  ],
  "missingAssets": []
}
```

Validation rules:

- `shots` must be non-empty.
- `duration` must be positive.
- `videoDesc` must be present.
- `imagePrompt` must be present unless `shouldGenerateImage=false`.
- Associated asset names must be mapped to existing asset IDs when possible.
- A model output that includes other chapter text should be rejected.

## Execution Plan

### Phase 1: Catalog Existing Storyboard Skills

- Add a backend scanner that recognizes storyboard-related markdown files.
- Parse frontmatter from existing production, art director, and story director skills.
- If frontmatter is missing, infer category from path and filename.
- Expose a list endpoint for Flova and settings.

### Phase 2: Skill Selection

- Let the workspace agent choose a storyboard skill based on:
  - explicit user mention,
  - selected project art style/director manual,
  - keywords like "四宫格", "多角度", "动作戏", "美剧节奏",
  - skill tags and description.
- Let users explicitly select a skill in Flova before generation.
- If no skill matches, use a default storyboard-generation skill.

### Phase 3: Model-Based Storyboard Generator

- Add a new service, tentatively `storyboardSkillGeneration.ts`.
- Inputs:
  - `projectId`,
  - `novelIds` or `chapterIndexes`,
  - `skillId`,
  - `userRequirement`,
  - optional reference image IDs.
- Render the selected storyboard skill with project/chapter/assets/facts context.
- Call the configured text model.
- Parse and validate structured JSON.
- Retry once with a repair prompt if validation fails.

### Phase 4: Database Write

- Write validated shots into `o_storyboard`.
- Write asset links into `o_assets2Storyboard`.
- Write `storyboardTable` and storyboard panel data into `o_agentWorkData`.
- Preserve existing behavior for `force`, `append`, and existing production containers.

### Phase 5: Flova UI

- Add a storyboard skill selector in the Flova workbench.
- Show selected skill, chapter scope, and generation status in chat.
- Let the user pass reference images for storyboard generation.
- Keep the generated storyboard table visible separately from image prompts.

### Phase 6: Prompt Template Ownership

- Use the storyboard skill for shot logic and image prompt style.
- If a user provides a custom storyboard image prompt template, apply it when building `imagePrompt`.
- If no custom template is provided, use the skill's default prompt section and project visual manual.

### Phase 7: Fallback

- Keep `generateProjectStoryboardDraft()` as a fallback only.
- Use fallback when:
  - no text model is configured,
  - model call fails,
  - JSON validation fails after retry,
  - user explicitly requests "快速草稿".

## Acceptance Criteria

- User can write/edit a markdown storyboard skill.
- Flova can list and select storyboard skills.
- "Generate storyboard for juben10" only reads `juben10` chapter text.
- The system generates a storyboard table and storyboard rows, not only image prompts.
- Existing selected asset images are respected as references.
- User-provided storyboard prompt templates can influence imagePrompt generation.
- Legacy template generation is not the default for normal Flova storyboard requests.
