import express from "express";
import { serializeError } from "serialize-error";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";
const router = express.Router();

type ScanState = {
  quote: "'" | "\"" | "`" | null;
  lineComment: boolean;
  blockComment: boolean;
};

function isEscaped(input: string, index: number) {
  let count = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

function stepState(input: string, index: number, state: ScanState) {
  const char = input[index];
  const next = input[index + 1];

  if (state.lineComment) {
    if (char === "\n") state.lineComment = false;
    return 0;
  }
  if (state.blockComment) {
    if (char === "*" && next === "/") {
      state.blockComment = false;
      return 1;
    }
    return 0;
  }
  if (state.quote) {
    if (char === state.quote && !isEscaped(input, index)) state.quote = null;
    return 0;
  }
  if (char === "/" && next === "/") {
    state.lineComment = true;
    return 1;
  }
  if (char === "/" && next === "*") {
    state.blockComment = true;
    return 1;
  }
  if (char === "'" || char === "\"" || char === "`") state.quote = char;
  return 0;
}

function findVendorObjectRange(code: string) {
  const marker = "const vendor";
  const markerIndex = code.indexOf(marker);
  if (markerIndex < 0) throw new Error("未找到 const vendor 配置");
  const equalsIndex = code.indexOf("=", markerIndex);
  const start = code.indexOf("{", equalsIndex);
  if (equalsIndex < 0 || start < 0) throw new Error("vendor 配置格式无效");

  const state: ScanState = { quote: null, lineComment: false, blockComment: false };
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const skipped = stepState(code, i, state);
    if (skipped) {
      i += skipped;
      continue;
    }
    if (state.quote || state.lineComment || state.blockComment) continue;
    if (code[i] === "{") depth += 1;
    if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i };
    }
  }
  throw new Error("vendor 配置对象未闭合");
}

function isIdentifierBoundary(char: string | undefined) {
  return !char || !/[A-Za-z0-9_$]/.test(char);
}

function replaceVendorName(code: string, name: string) {
  const range = findVendorObjectRange(code);
  const state: ScanState = { quote: null, lineComment: false, blockComment: false };
  let depth = 0;

  for (let i = range.start; i <= range.end; i += 1) {
    const skipped = stepState(code, i, state);
    if (skipped) {
      i += skipped;
      continue;
    }
    if (state.quote || state.lineComment || state.blockComment) continue;

    const char = code[i];
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 1) continue;

    let propStart = -1;
    let propEnd = -1;
    if (code.startsWith("name", i) && isIdentifierBoundary(code[i - 1]) && isIdentifierBoundary(code[i + 4])) {
      propStart = i;
      propEnd = i + 4;
    } else if ((char === "\"" || char === "'") && code.slice(i + 1, i + 5) === "name" && code[i + 5] === char) {
      propStart = i;
      propEnd = i + 6;
    }
    if (propStart < 0) continue;

    let colon = propEnd;
    while (/\s/.test(code[colon] || "")) colon += 1;
    if (code[colon] !== ":") continue;
    let valueStart = colon + 1;
    while (/\s/.test(code[valueStart] || "")) valueStart += 1;
    const quote = code[valueStart];
    if (quote !== "\"" && quote !== "'") throw new Error("vendor.name 必须是字符串字面量");
    let valueEnd = valueStart + 1;
    while (valueEnd < code.length) {
      if (code[valueEnd] === quote && !isEscaped(code, valueEnd)) break;
      valueEnd += 1;
    }
    if (valueEnd >= code.length) throw new Error("vendor.name 字符串未闭合");
    return `${code.slice(0, valueStart)}${JSON.stringify(name)}${code.slice(valueEnd + 1)}`;
  }

  throw new Error("未找到 vendor.name 字段");
}

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    name: z.string().trim().min(1).max(80),
  }),
  async (req, res) => {
    try {
      const { id, name } = req.body as { id: string; name: string };
      const currentCode = u.vendor.getCode(id);
      if (!currentCode) return res.status(404).send(error("未找到供应商代码"));
      const nextCode = replaceVendorName(currentCode, name.trim());
      const jsCode = transform(nextCode, { transforms: ["typescript"] }).code;
      const exports = u.vm(jsCode);
      if (!exports?.vendor) return res.status(400).send(error("脚本文件必须导出vendor对象"));
      if (exports.vendor.id !== id) return res.status(400).send(error("供应商ID不允许通过改名接口修改"));

      u.vendor.writeCode(id, nextCode);
      res.status(200).send(success({ id, name: exports.vendor.name, code: nextCode }));
    } catch (err) {
      res.status(400).send(error(serializeError(err).message || "未知错误"));
    }
  },
);
