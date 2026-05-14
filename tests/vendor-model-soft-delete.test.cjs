const assert = require("assert");

require("tsx/cjs");

const { deleteVendorModelConfig, mergeVendorModels, upsertVendorModelConfig } = require("../src/utils/vendorModels.ts");

function testCodeModelCanBeHidden() {
  const codeModels = [{ name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false }];
  const result = deleteVendorModelConfig([], "gpt-4o", codeModels);

  assert.strictEqual(result.found, true);
  assert.deepStrictEqual(result.models, [{ modelName: "gpt-4o", deleted: true }]);
  assert.deepStrictEqual(mergeVendorModels(codeModels, result.models), []);
}

function testCustomModelStillDeletesPhysically() {
  const custom = { name: "Custom", modelName: "custom-model", type: "text", think: false };
  const result = deleteVendorModelConfig([custom], "custom-model", []);

  assert.strictEqual(result.found, true);
  assert.deepStrictEqual(result.models, []);
}

function testReAddingSameNameRestoresModel() {
  const codeModels = [{ name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false }];
  const tombstone = [{ modelName: "gpt-4o", deleted: true }];
  const restored = { name: "GPT-4o Restored", modelName: "gpt-4o", type: "text", think: true };
  const dbModels = upsertVendorModelConfig(tombstone, restored);

  assert.deepStrictEqual(dbModels, [restored]);
  assert.deepStrictEqual(mergeVendorModels(codeModels, dbModels), [restored]);
}

function testRenameRemovesPreviousDbEntry() {
  const previous = { name: "Old", modelName: "old-model", type: "text", think: false };
  const next = { name: "New", modelName: "new-model", type: "text", think: false };

  assert.deepStrictEqual(upsertVendorModelConfig([previous], next, "old-model"), [next]);
}

testCodeModelCanBeHidden();
testCustomModelStillDeletesPhysically();
testReAddingSameNameRestoresModel();
testRenameRemovesPreviousDbEntry();

console.log("vendor model soft-delete tests passed");
