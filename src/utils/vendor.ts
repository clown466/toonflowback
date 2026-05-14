import { transform } from "sucrase";
import fs from "fs";
import path from "path";
import u from "@/utils";
import { deleteVendorModelConfig, mergeVendorModels, parseVendorModels, upsertVendorModelConfig } from "@/utils/vendorModels";

export { deleteVendorModelConfig, mergeVendorModels, parseVendorModels, upsertVendorModelConfig } from "@/utils/vendorModels";

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

export function getCodeModelList(id: string): Array<any> {
  const code = getCode(id);
  if (!code) return [];
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  if (!vendorData || !vendorData.vendor || !Array.isArray(vendorData.vendor.models)) return [];
  return JSON.parse(JSON.stringify(vendorData.vendor.models));
}

export async function getModelList(id: string): Promise<Array<any>> {
  const models = await u.db("o_vendorConfig").where("id", id).select("models").first();
  if (!models || !models.models) return [];
  return mergeVendorModels(getCodeModelList(id), parseVendorModels(models.models));
}

export function getVendor(id: string) {
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  return vendorData.vendor;
}

function findClosingToken(code: string, openIndex: number, openToken: string, closeToken: string): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === openToken) depth++;
    if (ch === closeToken) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findVendorObjectRange(code: string): { open: number; close: number } {
  const vendorDecl = code.match(/\bconst\s+vendor\b/);
  if (!vendorDecl || vendorDecl.index === undefined) throw new Error("未找到 const vendor 配置对象");

  const equalIndex = code.indexOf("=", vendorDecl.index);
  if (equalIndex === -1) throw new Error("vendor 配置对象格式不正确");

  const open = code.indexOf("{", equalIndex);
  if (open === -1) throw new Error("vendor 配置对象格式不正确");

  const close = findClosingToken(code, open, "{", "}");
  if (close === -1) throw new Error("vendor 配置对象格式不正确");

  return { open, close };
}

function readStringLiteral(code: string, start: number): { value: string; end: number } | null {
  const quote = code[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let value = "";
  for (let i = start + 1; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\\") {
      value += ch + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === quote) return { value, end: i + 1 };
    value += ch;
  }

  return null;
}

function readIdentifierProperty(code: string, index: number, propertyName: string): { colon: number } | null {
  if (!code.startsWith(propertyName, index)) return null;

  const prev = code[index - 1] ?? "";
  const next = code[index + propertyName.length] ?? "";
  if (/[$_\p{L}\p{N}]/u.test(prev) || /[$_\p{L}\p{N}]/u.test(next)) return null;

  let cursor = index + propertyName.length;
  while (/\s/.test(code[cursor] ?? "")) cursor++;
  if (code[cursor] !== ":") return null;

  return { colon: cursor };
}

function readQuotedProperty(code: string, index: number, propertyName: string): { colon: number } | null {
  const literal = readStringLiteral(code, index);
  if (!literal || literal.value !== propertyName) return null;

  let cursor = literal.end;
  while (/\s/.test(code[cursor] ?? "")) cursor++;
  if (code[cursor] !== ":") return null;

  return { colon: cursor };
}

function findTopLevelProperty(code: string, start: number, end: number, propertyName: string): { colon: number } | null {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = start; i < end; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      if (depth === 0) {
        const quoted = readQuotedProperty(code, i, propertyName);
        if (quoted) return quoted;
      }
      quote = ch;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      continue;
    }

    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      continue;
    }

    if (depth === 0) {
      const identifier = readIdentifierProperty(code, i, propertyName);
      if (identifier) return identifier;
    }
  }

  return null;
}

export function updateVendorNameInCode(code: string, name: string): string {
  const range = findVendorObjectRange(code);
  const property = findTopLevelProperty(code, range.open + 1, range.close, "name");
  const nextName = JSON.stringify(name);

  if (!property) {
    const firstLineStart = code.indexOf("\n", range.open);
    const indentStart = firstLineStart === -1 ? range.open + 1 : firstLineStart + 1;
    const indent = code.slice(indentStart).match(/^[ \t]*/)?.[0] ?? "  ";
    return `${code.slice(0, range.open + 1)}\n${indent}name: ${nextName},${code.slice(range.open + 1)}`;
  }

  let valueStart = property.colon + 1;
  while (/\s/.test(code[valueStart] ?? "")) valueStart++;

  const currentValue = readStringLiteral(code, valueStart);
  if (!currentValue) throw new Error("vendor.name 必须是字符串字面量");

  return `${code.slice(0, valueStart)}${nextName}${code.slice(currentValue.end)}`;
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
