/**
 * Model capability list tests for Task G.
 * Tests:
 * 1. getModelList({ type: 'all' }) returns ALL types including video
 * 2. getImageAndVideoModel returns image + video models
 * 3. getModelDetail returns business error (not success(undefined)) when model not found
 * 4. isTypeImplemented correctly identifies empty stubs vs real implementations
 */

const assert = require("assert");

// We need to test the source code logic since these are Express route handlers
// that depend on DB and runtime imports. We test the core logic by:
// - Reading vendor source files directly
// - Verifying the implementation detection works

const fs = require("fs");
const path = require("path");

// ── Helpers (mirroring vendor.ts isTypeImplemented logic) ──

function readVendorFile(id) {
  // Try data/vendor first, then the runtime vendor dir
  const paths = [
    path.join(__dirname, "..", "data", "vendor", `${id}.ts`),
    path.join(__dirname, "..", "vendor", `${id}.ts`),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  return "";
}

function detectIsTypeImplemented(code, type) {
  if (!code) return false;
  const funcName = `${type}Request`;
  const declRegex = new RegExp(`const\\s+${funcName}\\s*=`);
  const lines = code.split("\n");
  const startIdx = lines.findIndex((l) => declRegex.test(l));
  if (startIdx === -1) return false;

  let braceDepth = 0;
  let braceStarted = false;
  const bodyLines = [];
  for (let j = startIdx; j < lines.length; j++) {
    const line = lines[j];
    bodyLines.push(line);
    for (const ch of line) {
      if (ch === "{") { braceDepth++; braceStarted = true; }
      else if (ch === "}") braceDepth--;
    }
    if (braceStarted && braceDepth <= 0) {
      if (line.trimEnd().endsWith(";")) break;
      if (j + 1 < lines.length && lines[j + 1].trim() === ";") {
        bodyLines.push(lines[j + 1]);
        break;
      }
    }
  }

  const bodyText = bodyLines.join("\n");
  const stripped = bodyText.replace(/\s/g, "");
  if (stripped.includes('return""')) return false;
  if (/throw/.test(stripped)) {
    const stmts = bodyText.split(";").filter(s => s.trim().length > 0);
    const nonThrow = stmts.filter(
      (s) =>
        s.trim() !== "}" &&
        !s.trim().match(new RegExp("^const\\s+" + funcName)) &&
        !s.trim().startsWith("throw")
    );
    if (nonThrow.length === 0) return false;
  }
  return true;
}

// Return all model types declared in a vendor file's `models: [...]` section
function getDeclaredModelTypes(code) {
  if (!code) return [];
  const types = [];
  const regex = /type:\s*"(text|image|video|tts)"/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    types.push(match[1]);
  }
  return types;
}

// ── Tests ──

function testGetModelListAllIncludesVideo() {
  console.log("[TEST] getModelList({ type: 'all' }) should NOT filter out video");

  // The original code had: type === "all" ? models.filter(i => i.type !== "video") : ...
  // Verify the fix returns all models without video filtering
  const modelListCode = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "modelSelect", "getModelList.ts"),
    "utf-8"
  );

  // Check that "all" path does NOT filter out video
  const hasVideoFilter = modelListCode.includes('type !== "video"');
  assert.strictEqual(
    hasVideoFilter,
    false,
    "getModelList should NOT filter out video models for type='all'"
  );
  console.log("  ✓ type='all' no longer filters out video");

  // Check the original bug pattern is gone
  const hasOldPattern = modelListCode.includes(
    'type === "all"'
  );
  // It should still have the type === "all" check but without the filter
  assert.ok(
    hasOldPattern,
    "getModelList should still have type === 'all' check"
  );
  console.log("  ✓ type='all' check exists, returning all models");
}

function testGetImageAndVideoModelReturnsBoth() {
  console.log("[TEST] getImageAndVideoModel should return image + video models");

  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "setting", "modelMap", "getImageAndVideoModel.ts"),
    "utf-8"
  );

  // Should filter for image OR video, not just video
  const hasImageOrVideo = code.includes('m.type === "image" || m.type === "video"');
  assert.ok(
    hasImageOrVideo,
    "getImageAndVideoModel should filter for BOTH image and video types"
  );

  // Should NOT filter only video
  const hasOnlyVideo = code.includes("m.type === \"video\"") && !code.includes("m.type === \"image\"");
  assert.strictEqual(
    hasOnlyVideo,
    false,
    "getImageAndVideoModel should not filter only video"
  );
  console.log("  ✓ getImageAndVideoModel returns both image and video models");
}

function testGetModelDetailReturnsBusinessErrorForNotFound() {
  console.log("[TEST] getModelDetail should return business error when model not found");

  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "modelSelect", "getModelDetail.ts"),
    "utf-8"
  );

  // Should have a not-found check
  const hasNotFoundCheck = code.includes('error: `模型 ${modelId} 未找到`') || code.includes("error:");
  assert.ok(
    hasNotFoundCheck,
    "getModelDetail should return an error when model is not found"
  );

  // Should return 404, not success(undefined)
  const has404 = code.includes("res.status(404)");
  assert.ok(
    has404,
    "getModelDetail should return 404 status for not-found"
  );

  // Should NOT return success(undefined) — there must be a guard before success(findData)
  const guardBeforeSuccess = code.indexOf("if (!findData)") < code.indexOf("success(findData)");
  assert.ok(
    guardBeforeSuccess,
    "getModelDetail should have a guard (if !findData) before success(findData)"
  );
  console.log("  ✓ getModelDetail returns business error for not-found models");
}

function testEmptyStubDetection() {
  console.log("[TEST] isTypeImplemented correctly detects empty stubs");

  // Read actual vendor files
  const openaiCode = readVendorFile("openai");
  const nullCode = readVendorFile("null");
  const volcengineCode = readVendorFile("volcengine");
  const grsaiCode = readVendorFile("grsai");
  const viduCode = readVendorFile("vidu");

  // OpenAI vendor: text is real, image/video/tts throw errors (not implemented)
  if (openaiCode) {
    assert.strictEqual(detectIsTypeImplemented(openaiCode, "text"), true,
      "openai textRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(openaiCode, "image"), false,
      "openai imageRequest throws Error -> not implemented");
    assert.strictEqual(detectIsTypeImplemented(openaiCode, "video"), false,
      "openai videoRequest throws Error -> not implemented");
    assert.strictEqual(detectIsTypeImplemented(openaiCode, "tts"), false,
      "openai ttsRequest throws Error -> not implemented");
    console.log("  ✓ openai vendor: text=implemented, image/video/tts=throws (not implemented)");
  }

  // Volcengine vendor: text/image/video are real, tts is empty stub
  if (volcengineCode) {
    assert.strictEqual(detectIsTypeImplemented(volcengineCode, "text"), true,
      "volcengine textRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(volcengineCode, "image"), true,
      "volcengine imageRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(volcengineCode, "video"), true,
      "volcengine videoRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(volcengineCode, "tts"), false,
      "volcengine ttsRequest should be empty stub");
    console.log("  ✓ volcengine vendor: text/image/video=implemented, tts=empty stub");
  }

  // GRS AI vendor: text/image/video are real, tts is empty stub
  if (grsaiCode) {
    assert.strictEqual(detectIsTypeImplemented(grsaiCode, "image"), true,
      "grsai imageRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(grsaiCode, "video"), true,
      "grsai videoRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(grsaiCode, "tts"), false,
      "grsai ttsRequest should be empty stub");
    console.log("  ✓ grsai vendor: image/video=implemented, tts=empty stub");
  }

  // Vidu vendor: text throws (not implemented), image/video are real, tts throws
  if (viduCode) {
    assert.strictEqual(detectIsTypeImplemented(viduCode, "text"), false,
      "vidu textRequest throws error -> not implemented");
    assert.strictEqual(detectIsTypeImplemented(viduCode, "image"), true,
      "vidu imageRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(viduCode, "video"), true,
      "vidu videoRequest should be implemented");
    assert.strictEqual(detectIsTypeImplemented(viduCode, "tts"), false,
      "vidu ttsRequest throws error -> not implemented");
    console.log("  ✓ vidu vendor: image/video=implemented, text/tts=throws (not implemented)");
  }

  console.log("  ✓ Empty stub detection works correctly");
}

function testRuntimeImplementationDetectorUsesInterpolatedRegex() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "utils", "vendor.ts"),
    "utf-8"
  );

  assert.ok(
    source.includes("new RegExp(`^const\\\\s+${funcName}`)"),
    "src/utils/vendor.ts should interpolate funcName when filtering declaration lines"
  );
  assert.ok(
    !source.includes("match(/^const\\s+${funcName}/)"),
    "src/utils/vendor.ts should not use a regex literal with an uninterpolated funcName"
  );
}

function testModelListReturnedWithImplementedFlag() {
  console.log("[TEST] getModelList should return implemented flag with each model");

  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "modelSelect", "getModelList.ts"),
    "utf-8"
  );

  // Should include `implemented` in the response for each model
  const hasImplemented = code.includes("implemented:");
  assert.ok(
    hasImplemented,
    "getModelList response should include `implemented` field for each model"
  );

  const callsIsTypeImplemented = code.includes("u.vendor.isTypeImplemented");
  assert.ok(
    callsIsTypeImplemented,
    "getModelList should call u.vendor.isTypeImplemented"
  );
  console.log("  ✓ getModelList returns implemented flag via isTypeImplemented");
}

// ── Run all tests ──

function run() {
  const tests = [
    testGetModelListAllIncludesVideo,
    testGetImageAndVideoModelReturnsBoth,
	    testGetModelDetailReturnsBusinessErrorForNotFound,
	    testEmptyStubDetection,
	    testRuntimeImplementationDetectorUsesInterpolatedRegex,
	    testModelListReturnedWithImplementedFlag,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
