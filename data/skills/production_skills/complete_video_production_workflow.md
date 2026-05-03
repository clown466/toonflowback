---
name: complete_video_production_workflow
description: >-
  Toonflow 完整视频生产流程技能。用于从上传剧本/图片/PDF/文本开始，按阶段完成剧本解析、Final_Video_Spec、分镜设计、元素/角色/场景/道具资产生成或绑定、关键帧确认、Seedance 2.0 Fast 镜头视频生成与最终剪辑装配；强调脚本忠实、逐阶段暂停确认、单镜头不超过 15 秒、视频生成前必须获得用户明确批准。
---
# Toonflow 完整视频生产流程技能（分区版）

> 来源：用户提供的 `modified_video_skill_keep_format_v2.md`。原始 planner / storyboard_designer 等格式已映射为 Toonflow 分区格式；旧版加载器仍会看到完整正文，新版 `getSkillContentForAgent` 只注入匹配当前子 Agent 的分区。

<toonflow-skill target="productionAgent:* production:*" priority="10">
## 全生产 Agent 通用约束

- 严格忠实源剧本/Final_Video_Spec，不新增、删改、翻译台词，除非用户或规格明确要求。
- 若输入或工作区已有 `Final_Video_Spec.md`，后续拍摄计划、分镜表、分镜面板必须读取并继承其中的 title/type/aspect ratio/duration/visual style/output language/model preferences；若缺失，先补写或要求确认规格后再推进。
- 生产流程必须按依赖推进，不能一次性全自动跑完；视频生成前必须获得用户对具体镜头的明确批准。
- 单镜头视频模型硬上限 15 秒；分镜表阶段优先控制在 8 秒以内，长台词必须拆分。
- 用户已提供的图片、视频、声音、角色参考等资源优先绑定为资产，不重复生成。
- 默认不单独生成对白/旁白音频；对白/旁白写入对应视频生成提示词，声音参考只作为 Seedance reference。
</toonflow-skill>

<toonflow-skill target="productionAgent:decisionAgent production:decisionAgent productionAgent:supervisionAgent production:supervisionAgent" priority="20">
## 完整视频阶段逻辑与暂停点

**Complete Video Stage Logic and Dependency Relationships:**
1. Analyze the uploaded script file (image/PDF/text): extract the full text, then parse it into a professional shot-level storyboard script that preserves the source pacing, narrative rhythm, dialogue, narration, action, and story structure -> **resource_prepare_and_analyze**.
2. Write `Final_Video_Spec.md` (title, type, aspect ratio, duration, visual style, language, model preferences) -> **text_editor**.
3. Generate a storyboard (key elements, shot list, audio_layers) consistent with Steps 1 and 2 -> **storyboard_designer**.
4. Set up elements:
   *   If the user has already uploaded element resources (e.g., character images or referenced characters), bind them directly as assets for the corresponding key_elements. Otherwise, generate missing character, scene, and prop images -> **media_generator**.
   *   Do not generate standalone dialogue or narration audio. If character voice/timbre references are available, bind them as `voice_reference` assets for Seedance reference only -> **media_generator**.
5. Generate and confirm keyframes for each shot when needed:
   *   Use approved key_elements, character references, scene references, prop references, and continuity states.
   *   Generate start frame, end frame, or highlight frame according to the shot's needs.
   *   Pause for user confirmation before any final shot video generation -> **media_generator**.
6. Generate the final video for each shot only after explicit user approval for that specific shot:
   *   Strictly reference the shot's element images, keyframe images, and any available
`voice_reference` inputs.
   *   Do not generate independent dialogue or narration audio_layers.
   *   Put all exact script dialogue/narration directly into the video-generation prompt so the video model can understand and generate the spoken performance inside the shot.
   *   Pass any available character voice/timbre references together with the shot prompt when applicable -> **media_generator**.
7. Perform final editing when all approved assets and generated shots are ready; then guide the user to export -> **video_assembler**.

**Dependency Relationships:**
- Step 2 depends on Step 1.
- Step 3 depends on Steps 1 and 2.
- Step 4 depends on Step 3.
- Step 5 depends on Steps 2, 3, and 4.
- Step 6 depends on approved Steps 2, 3, 4, and 5, and always requires explicit user approval for each specific shot video generation.
- Step 7 depends on completed Steps 3, 4, 5, and 6.

**Note — User-provided or pre-existing media (mainly affects Steps 3–6):** Before filling in generated content, bind and assign user-provided media to the appropriate storyboard positions via **media_generator**; avoid regenerating content already provided by the user.

**When to Pause:** Do not complete all steps at once. Stop at each key stage above (e.g., after script/spec confirmation, after storyboard generation, after element image generation or binding, after keyframe generation, before every shot video generation, and after each shot video generation) to confirm with the user before proceeding. Video generation must always require explicit user permission for each specific shot; never generate video automatically or on behalf of the user without approval. Use cards or reply_to_user to invite the user to review before continuing.
</toonflow-skill>

<toonflow-skill target="productionAgent:directorPlanAgent production:directorPlanAgent productionAgent:storyboardGenAgent production:storyboardGenAgent" priority="30">
## 上传脚本解析

**Uploaded Script File (Image/PDF/Text) Analysis Guidelines**
- **Goal:** **Completely and faithfully** extract the script from the uploaded content, then output a **high-quality shot breakdown (storyboard narrative)** suitable for production, **strictly adhering** to the source script's pacing (if any), narrative rhythm, dialogue, and story structure.
- **Timeline and Shot Splitting Rules:** If the script **contains a timeline:** execute according to each shot's designated time. Determine each shot duration primarily by dialogue length and performance density, using the rhythm of fast-paced American short-form drama as the pacing reference. **Hard cap: each shot must be ≤15 seconds** (the video model's maximum). If a story beat or dialogue block would exceed 15 seconds at a natural delivery pace, **split** it into multiple shots — explain the splitting logic and what each sub-shot contains to maintain rhythm, emotional fullness, and narrative integrity. Never plan or output a single shot exceeding 15 seconds under any circumstances.
- **Output Format:**
  - With script timing: each line formatted as `Shot N: 00:00-00:15s, <shot description>` (timecode style may match the script, e.g., `MM:SS`-`MM:SS`).
  - Without timing: each line formatted as `Shot N: <shot description>` (no timecode needed in the breakdown, but still plan timing during storyboarding to make each shot duration appropriate to its action and dialogue).
- **Prohibitions:** Do not omit lines or narration from the script; do not merge scenes in a way that loses information; do not cut necessary actions or shot instructions from the script for brevity; do not add, delete, or rewrite dialogue. All dialogue must strictly follow the novel/story plot and source wording.
</toonflow-skill>

<toonflow-skill target="productionAgent:directorPlanAgent production:directorPlanAgent productionAgent:storyboardGenAgent production:storyboardGenAgent productionAgent:storyboardTableAgent production:storyboardTableAgent" priority="40">
## 分镜设计

**Script Fidelity (Highest Priority)**
- **Dialogue, narration, action outcomes, and scene order** in the storyboard must match the uploaded script and Step 1 breakdown. Only **technical** edits are permitted: **splitting shots**, adding **shot language** fields, and adjusting shot duration to fit the amount of action and dialogue. **Do not** fabricate plot points or rewrite lines. Dialogue must strictly follow the novel/story plot and source wording; do not add, delete, or modify any line.

**How to Design Key Elements**
- Always include **key subjects** (characters, objects, etc.), **key locations/scenes**, and **key props** (if any).
- **How to plan element_id:** Assign an element_id to each entity when each character, prop, or scene is an independent entity (e.g., `[Element_Detective_Li]`, `[Element_Boss_Zhao]`; `[Element_Observation_Room]`, `[Element_Chief_Office]`). Do not change existing variable names or field names.
- **How to write descriptions:**
   - **Characters:** If a character has multiple states or appearances in the project (e.g., different clothing, ages), clearly describe each in the description (e.g., Appearance 1: ...; Appearance 2: ...). Include the character's **voice/timbre** as a Seedance reference when available, but do not generate separate dialogue/narration audio from it. For every new character, generate a four-view reference first (front, side, back, and expressive three-quarter view) before using the character in shots.
   - **Key Locations/Scenes:** Describe the position and orientation of important objects in the scene, especially props or areas where major actions/performances occur. For every new scene/location, generate a reference image before using it in shots.
   - **User-provided assets:** If the user provided reference media and designated it as a key element, the description **must match** that asset; do not contradict what is seen or heard. For recurring new props or objects, generate a prop reference image before repeated use.
**How to Design Shots**
- Each shot description must include: **Scene (elements)**, **Story and performance (specific lines)**, **Shot language** (framing, angle, movement).
- **Visual design and story facts** must match the script. If the script omits shot coverage, you may **professionally infer** composition and movement from genre and tone, but **never** change plot facts or dialogue.
- **Hard duration limit: each shot MUST NOT exceed 15 seconds.** This is a firm constraint imposed by the video generation model (Seedance 2.0 Fast max = 15s). If a scene's dialogue and action cannot fit in 15 seconds at a natural, fast-paced American short-drama pace, **split it into multiple shots** — never plan a single shot over 15s. Design cuts *within* the shot (internal cuts) rather than splitting into many short shots; cutting frequency should follow story rhythm. Determine shot duration according to dialogue length first, then action density and emotional beats: quick, punchy, emotionally heightened, and easy to understand. The frame plan should be spacious enough to make the content rich, emotionally full, tightly paced, physically exaggerated, highly expressive, and supported by master-level camera movement.
- **When a shot has internal cuts:** After the scene/setting, arrange story content and shot language in cut order. Use explicit time and cut markers, e.g., *"Shot1 (0-4s): [Scene], [Character] does X, close-up. Shot2 cut to (4-8s): ... Shot3 cut to (8-12s): ..."*
- **Each shot description must include:**
  - **Scene:** Reference the location/set (using scene element IDs, e.g., `[Element_Office_Noir]`).
  - **Story content:** Actions and dynamics of characters and key objects; dialogue and performance. Write **exact lines** (spoken dialogue or inner monologue/voice-over). Reference characters using element IDs.
  - **Shot language:** Framing, angle, movement.
- **Performance continuity:** Track each character's state across adjacent shots, including accessories, injuries, held objects, clothing changes, posture, facial emotion, and location. If a character gains an accessory or holds an object in one shot, preserve it in the next shot, or generate an updated character reference image carrying/wearing that item at the character reference stage.
  - **Expression and emotion:** Clearly describe each character's facial expression and emotional state in every shot. Push the expression toward exaggerated American-animation performance: larger eye shapes, stronger mouth poses, broader gestures, sharper silhouettes, and heightened emotional readability.
  - **Anthropomorphic fruit zombies:** If zombies appear, treat them as anthropomorphic fruits. Their blood is fruit juice, not generic red blood; juice color must match the fruit type (e.g., orange juice for orange zombies, purple juice for grape zombies, pale yellow juice for banana zombies, watermelon-red juice for watermelon zombies).
  - **Duration by dialogue length:** For each storyboard shot, estimate duration from the exact amount of dialogue that must be spoken, then compress or split the visual beats to match a fast-paced American short-drama rhythm. Keep the delivery energetic and tight, but never so rushed that the original lines become unclear.

**How to Design Independent Audio**
- **Background Music:** At least one global background track; style and tempo matching the reference or "Final Video Spec"; if the reference has clear rhythm/mood changes, split BGM segments and define ranges. (Each with its own `audio_id` and range).
- **Dialogue and Narration:** Do **not** generate independent dialogue or narration audio_layers. Put all dialogue and narration directly inside the video-generation prompt for the corresponding shot, integrated into the camera/subject/space/audio description so the video model can understand the performance. If a character has a voice/timbre reference, pass it along with that character's speaking shot as reference material for Seedance. New characters may appear without a voice reference at first; after the first video containing the new character is generated and approved, the user may extract that character's voice from the first video and provide it as the future `voice_reference`.
- **Voice References:** Character voice/timbre references are reference inputs only. They do not replace the need to write the actual dialogue in the shot prompt. For each speaking line, specify who is speaking and attach that speaker's voice reference when available.
- **audio_layers:** Keep audio_layers for BGM and non-dialogue sound design if needed. Do not create separate narration/dialogue audio assets unless the user explicitly overrides this workflow.
</toonflow-skill>

<toonflow-skill target="productionAgent:deriveAssetsAgent production:deriveAssetsAgent productionAgent:generateAssetsAgent production:generateAssetsAgent productionAgent:storyboardPanelAgent production:storyboardPanelAgent" priority="50">
## 元素/关键帧/视频生成规则

**Element Generation**
- **Images:** If the user has designated an asset for an element (e.g., product image, character image), use it directly; do not generate. Otherwise, for characters, scenes, props, use **TextToImage** (or project convention). For multiple states of the same character, use **ImageToImage** referencing the first for consistency. Recommended resolution and model per project (e.g., 2K); recommend multi-view for characters to maintain cross-shot consistency, assigning separate `asset_id` for each view and generating individually.
- Recommended model: **Nano Banana 2 (Gemini 3.1 Flash Image)**, resolution **2K**. For character elements, prioritize **four-view** (front/side/back/expressive three-quarter view) to support cross-shot consistency. New characters must receive a four-view reference before video generation. New scenes must receive a scene reference image before video generation. Recurring new props/items must receive a prop reference image before repeated use.
  - When a character's state changes across shots (wearing an accessory, holding a weapon/tool, carrying an object, visible injury, costume damage), create or update a reference image for that state when needed so the next shot preserves continuity.
- **Voice_references:** Do not generate standalone dialogue/narration audio. If the user provides a character voice/timbre reference, bind it as `voice_reference` for Seedance reference only. New characters may appear without `voice_reference` at first; after the first approved video containing the new character, the user may extract that character's voice from that video and provide it as a future `voice_reference`.

**Final Shot Video Generation**
- Use **MultiModalToVideo** only after explicit user approval for that specific video generation. **Model is strictly locked to: Seedance 2.0 Fast, resolution 720p.** Do not use any other video model or resolution unless the user explicitly overrides this. Reference the shot's **element images**, **keyframe images**, and any available speaker `voice_reference` inputs. All actual dialogue must be written directly into the video prompt, assigned to the correct speaker, and kept faithful to the source script. Each shot must be ≤15 seconds; never attempt to generate a shot exceeding this limit.

**Narration, Dialogue, and BGM**
- **Narration/Dialogue:** Do not generate separate narration/dialogue audio. Put the exact narration/dialogue text inside the video-generation prompt for the relevant shot. The dialogue must strictly follow the source script and novel/story plot, without additions, deletions, or rewrites. For each speaking character, include that character's available `voice_reference` as a reference input; if no reference exists for a new character, proceed only after user approval and let the user extract a voice reference from the first generated video if needed.
- **BGM:** Style and tempo match the Final Video Spec/reference; duration and range follow the storyboard. Keep BGM separate unless the user specifically requests in-model music.
</toonflow-skill>

<toonflow-skill target="productionAgent:storyboardPanelAgent production:storyboardPanelAgent productionAgent:generateAssetsAgent production:generateAssetsAgent" priority="60">
## 图像与视频提示词写作规则

**Highest priority, applicable to all prompt writing situations: When the user inputs in Chinese or a Chinese language environment is loaded, prompts must be written in Chinese. However, narration/dialogue content in the prompt must strictly follow the source script and the Output Language in Final_Video_Spec. If the source script language differs from the Output Language in Final_Video_Spec, do not translate automatically unless `Final_Video_Spec.md` explicitly requires translation; by default, preserve the source dialogue/narration exactly.**

**Image Generation Prompts (TextToImage, ImageToImage)**
**Universal Principles for All Image Prompts**
- The prompt is not merely a description of "what is in the picture"; it is more like a real film director and colorist guiding the team.
- Use fluent natural language to describe scene content (subject + action + environment, etc.), and use short phrases to describe visual aesthetics (style, color, light, composition). Reject strange metaphors or literary embellishments because the model may generate literal metaphorical content. Do not explain the character's motivation or inner state to the AI (e.g., "as if he doesn't care about this photo"). Do not describe off-screen or invisible elements. Only describe what is physically visible. The rhythm may be more thrilling and faster, the emotion stronger, and the content should be substantial rather than empty.
- For all image prompts (any character): You must globally apply the "6 Core Rules of Cinematic Prompts" across all target styles to ensure cinematic quality. Write the prompt as a fluent, natural English description, weaving these 6 rules together. Do not output them as labeled sections:
  - Professional style terms: Combine professional art or film terms with style terms for accuracy. (e.g., introduce "auteur" and specific cinematic visual anchors, use `Neo-Noir style, David Fincher Style, inspired by Se7en` as style anchors rather than vaguely stating `Neo-Noir` style).
  - Composition and shots: Explicitly state cinematic composition (e.g., `Over-the-shoulder shot`, `Dutch angle`) and framing (e.g., `Close-up`, `Medium shot`).
  - Lighting: Detail the key light and emphasize "negative fill" to increase contrast and drama (e.g., `Strong chiaroscuro contrast`, `dramatic interplay of light and shadow`, or `deep facial shadows emphasizing facial structure`).
- Color grading: Use high-end Hollywood color grading techniques to set restrained palettes (e.g., `deep teal-cyan shadows dominating 90%, zero warm fill` or `muted watercolor wash`). Unless explicitly requested by the user, never use red-blue neon clashes (e.g., prohibit `crimson bleed`, neon magenta vs. cyan). Limit the image to approximately 90% of the area using only one dominant color (e.g., deep teal) — extreme restraint.
  - Visual rendering: Describe the overall visual quality and texture of the content (e.g., `fine rendering quality`, `rich and intricate details`, `soft-focus effect with subtle Gaussian blur`).
  - Atmosphere, emotion, and performance: Describe visible emotional expression and micro-expressions, freezing the action at dramatic moments. Avoid strange metaphors and abstract poetic phrasing that may be rendered literally. Reject stiff, posed looks. For characters, push facial expressions and body poses toward exaggerated American-animation performance when the project style allows it. For inanimate objects, describe their visible physical state and cinematic mood without metaphorical wording.
  - Conditional elements (include only when relevant):
    - Accurate on-screen text: When relevant, if text appears in the scene (e.g., screen text), integrate it naturally. You must wrap the exact text content to be rendered in quotation marks for emphasis. For example: 'A neon sign in the background reads "DANGER".'

**When the Target is a `key_element`**
Provide a clear, detailed visual definition of the element to ensure consistency across shots. Prompt structure should revolve around:
- Subject and identity: Clearly state what the element is — character, prop, scene, or creature. For characters, include defining identity traits (age, build, ethnicity (if specified), notable features, voice/timbre reference if available). For anthropomorphic fruit zombies, clearly state the fruit type and the matching fruit-juice blood color.
- Feature details: Specifically describe the element's key visual characteristics. Prioritize features that must remain consistent across shots:
  - Characters: Facial features (eye shape, jawline, hairstyle/color), makeup and styling (if relevant), clothing and accessories (material, cut, color, condition), expression range, exaggerated animation-ready facial poses, and continuity states such as held objects or worn accessories.
  - Props/Objects: Shape, material, color, size, condition (new/weathered/damaged), unique markings.
  - Atmosphere/Emotional tone: Describe the emotional subtext that defines the scene (e.g., tension, melancholy, hope, serenity, unease, warmth, oppression, fear, nostalgia, isolation, intimacy), but avoid strange metaphors or comparisons that could be rendered literally.
  - To keep the image clean, do not generate text in the image.

**When the Target is a Keyframe (Start Frame, End Frame, or Highlight Frame)**
First, locate the corresponding moment in the shot's `Description`: identify the exact beat — start state, end state, or the visually/dramatically strongest instant — and build from there. If the shot description does not clearly depict that moment, mentally simulate the shot (subject movement + camera movement + environment change), imagine what the scene looks like at that instant, then fill in the details yourself. Either way, only describe that instant as a static image — what is visible, how it is composed, and the state of everything:
- **Start Frame:** Show the scene before the action begins — the subject's posture and intent before movement (weight shift, gaze direction, limb preload), the environment's base state, and the camera's initial composition and angle.
- **End Frame:** Show the direct result after the action completes — the subject's final pose or expression, the environment's changed state, and the camera's final position preparing for the next cut.
- **Highlight Frame:** Identify the moment of strongest visual or emotional impact in the shot (e.g., the peak of impact, the moment revelation lands on the character's face, the crystallization of the lens theme). Freeze and describe that frame with maximum detail — pose, expression, lighting state, camera composition — so it can stand alone as the most powerful still image from that shot.

**Video Generation Prompts**
**Follow this Seedance order (Camera -> Subject -> Space -> Audio) when appending motion/dynamic prompts:**
- When writing prompts, follow this order:
  1. **Camera** — movement or shot/cut change (e.g., `static -> push-in`, `cut to new angle`, `orbit`, `pan`).
  2. **Subject** — action and expression (who does what, facial action beats). Clearly show each character's facial expression and emotion; favor exaggerated American-animation expression when suitable.
  3. **Space** — position or environment change (subject or camera position relative to space; background movement; depth/layout transformation). Preserve continuity of accessories, injuries, held objects, clothing, and character state from the previous shot.
  4. **Audio** — dialogue (if any), sound effects, speaker voice/timbre references if available, and notes if no music in the model (see below). All actual dialogue must be placed directly in the shot prompt; do not generate it separately. Dialogue length should guide the intended shot duration and beat structure, with fast-paced American short-form drama as the pacing reference.
**Action Details**
  - When relevant, base on **specific body parts**: hands, legs, head, shoulders, eyes, brows, mouth, cheeks, torso, fingers, etc.
  - Add **degree**: amplitude, speed, intensity (e.g., *slowly raises one hand*, *snaps head left*, *pushes hard off the ground*). Make pacing more thrilling and compact when appropriate, while leaving enough duration for dialogue to be spoken clearly.
- For multiple beats in one prompt, list **primary action, then secondary action** (in chronological story order).
**Multi-beat and "Shot 1 / Shot 2" (Official Guide)**
  - When the tool accepts long prompts, you may mark **Shot 1, Shot 2, Shot 3** in a single generation for **camera or story beat** sequences, but do not overload one video with more dialogue than can be naturally spoken.
  - **Precise clock timing** (e.g., "0-3 seconds", "3-6 seconds") **cannot be reliably executed** — do not force split prompts by exact second ranges, nor write explicit second-by-second plans (e.g., "at 2 seconds...", "from 5-8 seconds..."). Describe **what happens in sequence**, not a timed shot list.
**Optional Polish (when the brief is cinematic live-action):** You may add slight handheld micro-shake or subtle film grain based on other strategy rules — keep it subordinate to the four-layer order above.
**Special Character Conventions (for Seedance 2.0)**
Seedance accepts natural language prompts; these wrappers help the model distinguish **music**, **sound effects**, **dialogue**, and **on-screen title text**:
  - Music (describe what is playing): `(...)`, e.g., (fast-paced rock playing in the background).
  - Sound effects: `<...>`, e.g., <distant dog barking>.
  - Spoken dialogue: `{...}`, e.g., {Hello, world} — if the line is **not** the project's original language (e.g., Japanese monologue in an English short), **label the language** before the braces, e.g., *Says in Japanese:* `{こんにちは}`. Do not keep quotation marks from the storyboard planning; only include the dialogue text inside `{...}`. Dialogue must be the exact source-script line with no additions, deletions, or rewrites. Identify the speaker before each line and include that speaker's available `voice_reference` as a Seedance reference input; a new character can speak without a voice reference only with user approval.
- On-screen titles/chapters/subtitle text: `【...】`, e.g., 【Chapter One: Departure】.

**Note:** You must always include the following negative constraints in the prompt to ensure clean post-production output:
- Do not create separate narration/dialogue tracks by default; put exact dialogue/narration directly into the video prompt so the model can perform it inside the shot.
- To prevent the model from adding unwanted background music, you should almost always include 'no music'.
- Subtitles are added during post-production editing, so you must always include 'no subtitles'.
- Video generation must always wait for explicit user approval. Never trigger video generation automatically.
- Avoid strange metaphors, abstract symbolic descriptions, or poetic comparisons that could be rendered literally.
- For anthropomorphic fruit zombies, describe fruit-juice blood color according to the fruit type, not generic red blood.
</toonflow-skill>

<toonflow-skill target="productionAgent:generateAssetsAgent production:generateAssetsAgent productionAgent:supervisionAgent production:supervisionAgent" priority="70">
## 最终剪辑装配规则

Assemble all approved shot videos, BGM, non-dialogue sound design, and any user-approved post-production audio in storyboard and timeline order; when editing is ready, guide the user to export. Do not expect separately generated narration/dialogue tracks by default, because dialogue and narration should be embedded in the shot video prompts unless the user explicitly requests a separate-audio workflow.
</toonflow-skill>
