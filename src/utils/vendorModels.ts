export function parseVendorModels(models?: string | null): Array<any> {
  if (!models) return [];
  const parsed = JSON.parse(models);
  return Array.isArray(parsed) ? parsed : [];
}

export function mergeVendorModels(codeModels: Array<any>, dbModels: Array<any>): Array<any> {
  const map = new Map<string, any>();
  for (const model of codeModels) {
    if (typeof model?.modelName === "string") map.set(model.modelName, model);
  }
  for (const model of dbModels) {
    if (typeof model?.modelName !== "string") continue;
    if (model.deleted === true) {
      map.delete(model.modelName);
      continue;
    }
    map.set(model.modelName, model);
  }
  return [...map.values()];
}

export function upsertVendorModelConfig(models: Array<any>, model: any, previousModelName = model.modelName): Array<any> {
  return [...models.filter((item) => item?.modelName !== previousModelName && item?.modelName !== model.modelName), model];
}

export function deleteVendorModelConfig(models: Array<any>, modelName: string, codeModels: Array<any>): { models: Array<any>; found: boolean } {
  const isCodeModel = codeModels.some((model) => model?.modelName === modelName);
  const isDbModel = models.some((model) => model?.modelName === modelName && model.deleted !== true);
  const nextModels = models.filter((model) => model?.modelName !== modelName);

  if (isCodeModel) {
    nextModels.push({ modelName, deleted: true });
  }

  return { models: nextModels, found: isCodeModel || isDbModel };
}
