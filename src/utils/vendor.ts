import { transform } from "sucrase";
import fs from "fs";
import path from "path";
import u from "@/utils";

export function writeCode(id: string | number, tsCode: string) {
  const rootDir = u.getPath("vendor");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, `${id}.ts`), tsCode);
}

export function getCode(id: string): string {
  const rootDir = u.getPath("vendor");
  const targetFile = path.join(rootDir, `${id}.ts`);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

export async function getModelList(id: string): Promise<Array<any>> {
  const models = await u.db("o_vendorConfig").where("id", id).select("models", "hiddenModels").first();
  if (!models || !models.models) return [];
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  if(!vendorData || !vendorData.vendor || !vendorData.vendor.models) return [];
  const hiddenModels = new Set(JSON.parse(models.hiddenModels ?? "[]"));
  const combined = [...JSON.parse(JSON.stringify(vendorData.vendor.models)), ...JSON.parse(models?.models ?? "[]")];
  const map = new Map<string, any>();
  for (const m of combined) {
    if (hiddenModels.has(m.modelName)) continue;
    map.set(m.modelName, m);
  }
  return [...map.values()];
}

export function getVendor(id: string) {
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  return vendorData.vendor;
}

/**
 * Check if a vendor's adapter function for the given model type has a real implementation,
 * rather than just being an empty stub (return "") or throwing an error.
 */
export function isTypeImplemented(id: string, type: string): boolean {
  const code = getCode(id);
  if (!code) return false;

  const funcName = `${type}Request`;

  // Find the function declaration
  const declRegex = new RegExp(`const\\s+${funcName}\\s*=`);
  const lines = code.split("\n");
  const startIdx = lines.findIndex((l) => declRegex.test(l));
  if (startIdx === -1) return false;

  // Collect body lines until balanced braces followed by ";"
  let braceDepth = 0;
  let braceStarted = false;
  const bodyLines: string[] = [];
  for (let j = startIdx; j < lines.length; j++) {
    const line = lines[j];
    bodyLines.push(line);
    for (const ch of line) {
      if (ch === "{") { braceDepth++; braceStarted = true; }
      else if (ch === "}") braceDepth--;
    }
    if (braceStarted && braceDepth <= 0) {
      // Check if this line ends with ";" (function end)
      if (line.trimEnd().endsWith(";")) break;
      // Look ahead one more line for ";"
      if (j + 1 < lines.length && lines[j + 1].trim() === ";") {
        bodyLines.push(lines[j + 1]);
        break;
      }
    }
  }

  const bodyText = bodyLines.join("\n");
  const stripped = bodyText.replace(/\s/g, "");

  // Check for empty return "" stub
  if (stripped.includes('return""')) return false;

  // Check for throw-only implementation (no real logic)
  if (/throw/.test(stripped)) {
    const stmts = bodyText.split(";").filter(s => s.trim().length > 0);
    const nonThrow = stmts.filter(
      (s) =>
        s.trim() !== "}" &&
        !s.trim().match(new RegExp(`^const\\s+${funcName}`)) &&
        !s.trim().startsWith("throw")
    );
    if (nonThrow.length === 0) return false;
  }

  return true;
}
