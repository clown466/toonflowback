const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const generateVideoPromptSrc = fs.readFileSync(
  path.join(root, 'src/routes/production/workbench/generateVideoPrompt.ts'),
  'utf8'
);

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

// 1. XML <storyboardItem> must include prompt attribute
assertIncludes(
  generateVideoPromptSrc,
  `prompt='`,
  'storyboardItem XML should include prompt attribute'
);

// 2. XML must include track attribute
assertIncludes(
  generateVideoPromptSrc,
  `track='`,
  'storyboardItem XML should include track attribute'
);

// 3. XML must include associateAssetsIds attribute
assertIncludes(
  generateVideoPromptSrc,
  `associateAssetsIds='`,
  'storyboardItem XML should include associateAssetsIds attribute'
);

// 4. XML must include shouldGenerateImage attribute
assertIncludes(
  generateVideoPromptSrc,
  `shouldGenerateImage='`,
  'storyboardItem XML should include shouldGenerateImage attribute'
);

// 5. storyboard object is constructed with all four fields
assertIncludes(
  generateVideoPromptSrc,
  'prompt: item.prompt',
  'storyboard push should include prompt'
);
assertIncludes(
  generateVideoPromptSrc,
  'track: item.track',
  'storyboard push should include track'
);
assertIncludes(
  generateVideoPromptSrc,
  'associateAssetsIds: item.associateAssetsIds',
  'storyboard push should include associateAssetsIds'
);
assertIncludes(
  generateVideoPromptSrc,
  'shouldGenerateImage: item.shouldGenerateImage',
  'storyboard push should include shouldGenerateImage'
);

// 6. DB query selects all four fields
assertIncludes(
  generateVideoPromptSrc,
  '"videoDesc", "prompt", "track", "duration", "shouldGenerateImage"',
  'DB query should select all required storyboard fields'
);

// 7. shouldGenerateImage logic handles both boolean/number types
assertIncludes(
  generateVideoPromptSrc,
  'i.shouldGenerateImage !== false && i.shouldGenerateImage !== 0',
  'shouldGenerateImage rendering should handle number and boolean'
);

// 8. Director-board video prompts must be split by shot, not merged into one paragraph
assertIncludes(
  generateVideoPromptSrc,
  '输出必须按镜头拆分',
  'director board video prompt should force shot-by-shot output'
);
assertIncludes(
  generateVideoPromptSrc,
  '`镜头1：`、`镜头2：`',
  'director board video prompt should include numbered shot labels'
);
assertIncludes(
  generateVideoPromptSrc,
  '每个 <storyboardItem> 至少对应一个独立镜头段落',
  'director board video prompt should map storyboard items to shot paragraphs'
);

// 9. Director-board references must hydrate their covered storyboards, otherwise prompt generation sees 0 shots
assertIncludes(
  generateVideoPromptSrc,
  'parseNumberArray(board.storyboardIds)',
  'director board storyboardIds should be parsed'
);
assertIncludes(
  generateVideoPromptSrc,
  'loadStoryboardsWithAssets(directorBoardStoryboardIds, projectId)',
  'director board storyboardIds should load storyboard text context'
);
assertIncludes(
  generateVideoPromptSrc,
  '**本次实际分镜数量**',
  'prompt context should include the actual hydrated storyboard count'
);

// 10. Prompt generation should respect the selected video duration and project language
assertIncludes(
  generateVideoPromptSrc,
  'duration: z.number().optional()',
  'generateVideoPrompt should accept the selected video duration'
);
assertIncludes(
  generateVideoPromptSrc,
  'Video prompt output language override',
  'English projects should override Chinese-only model prompt defaults'
);
assertIncludes(
  generateVideoPromptSrc,
  '目标时长=',
  'prompt context should include target video duration'
);

console.log('video-prompt-context checks passed');
