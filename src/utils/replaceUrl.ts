export default function replaceUrl(url: string): string {
  if (typeof url !== "string" || !url.trim()) return "";
  let cleanedPath = url.trim();
  try {
    cleanedPath = new URL(cleanedPath, "http://toonflow.local").pathname;
  } catch {
    // 如果不是有效 URL，则继续按普通路径处理。
  }
  return cleanedPath.replace(/^\/oss(?=\/|$)/, "").replace(/^\/smallImage(?=\/|$)/, "");
}
