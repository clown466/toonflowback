const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const webDir = path.resolve(process.argv[2] || "data/web");
const indexPath = path.join(webDir, "index.html");

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function gzipFile(filePath) {
  const content = fs.readFileSync(filePath);
  if (content.length < 1024) return;
  fs.writeFileSync(`${filePath}.gz`, zlib.gzipSync(content, { level: 9 }));
}

function gzipStaticFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      gzipStaticFiles(filePath);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".gz")) continue;
    if (/\.(html|js|css|ico|svg|json|png|jpe?g|webp|woff2?|ttf|eot|worker)$/i.test(entry.name)) {
      gzipFile(filePath);
    }
  }
}

function sanitizeExtractedJavaScript(content) {
  return content
    .replace(/"\u200b\n\u180e"/g, '"\\u200b\\u180e"')
    .replace(/'\u200b\n\u180e'/g, "'\\u200b\\u180e'");
}

function removeGeneratedAssets() {
  for (const file of fs.readdirSync(webDir)) {
    if (/^toonflow-(?:app|style)\.[a-f0-9]{12}\.(?:js|css)(?:\.gz)?$/.test(file)) {
      fs.rmSync(path.join(webDir, file), { force: true });
    }
  }
}

function repack() {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html not found: ${indexPath}`);
  }

  let html = fs.readFileSync(indexPath, "utf8");
  const scriptMatch = html.match(/<script\s+type="module"\s+crossorigin>([\s\S]*?)<\/script>/);
  const styleMatch = html.match(/<style\s+rel="stylesheet"\s+crossorigin>([\s\S]*?)<\/style>/);

  if (!scriptMatch || !styleMatch) {
    console.log("[repack-web-assets] index.html already repacked or no inline bundle found");
  } else {
    removeGeneratedAssets();

    const js = sanitizeExtractedJavaScript(scriptMatch[1]);
    const css = styleMatch[1];
    const jsName = `toonflow-app.${hashContent(js)}.js`;
    const cssName = `toonflow-style.${hashContent(css)}.css`;

    fs.writeFileSync(path.join(webDir, jsName), js);
    fs.writeFileSync(path.join(webDir, cssName), css);

    html = html
      .replace(scriptMatch[0], `<script type="module" crossorigin src="/${jsName}"></script>`)
      .replace(styleMatch[0], `<link rel="stylesheet" crossorigin href="/${cssName}">`);
    fs.writeFileSync(indexPath, html);

    console.log(`[repack-web-assets] extracted ${jsName} (${js.length} bytes)`);
    console.log(`[repack-web-assets] extracted ${cssName} (${css.length} bytes)`);
  }

  gzipStaticFiles(webDir);
}

repack();
