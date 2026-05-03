(function () {
  const rootId = "toonflow-upload-root";
  const labels = { role: "角色", scene: "场景", tool: "道具" };
  const state = {
    visible: false,
    loading: false,
    projects: [],
    assets: [],
    projectId: null,
    type: "role",
    assetId: "",
    file: null,
    previewUrl: "",
  };

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function apiBase() {
    const setting = readJson("setting");
    const baseUrl = setting && typeof setting.baseUrl === "string" ? setting.baseUrl : "";
    return (baseUrl || `${window.location.origin}/api`).replace(/\/$/, "");
  }

  async function post(path, body) {
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: localStorage.getItem("token") || "",
      },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({ message: response.statusText }));
    if (!response.ok || payload.code >= 400) {
      throw new Error(payload.message || "请求失败");
    }
    return payload.data;
  }

  function currentProject() {
    const store = readJson("project");
    return store && store.project && store.project.id ? store.project : null;
  }

  function canShow() {
    return Boolean(localStorage.getItem("token")) && /^\/(?:cornerScape|assets)(?:\/|$)/.test(window.location.pathname);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(message, type) {
    if (window.$message && typeof window.$message[type || "info"] === "function") {
      window.$message[type || "info"](message);
      return;
    }
    const el = document.createElement("div");
    el.className = "tfu-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
  }

  function selectedAsset() {
    const id = Number(state.assetId);
    return state.assets.find((item) => Number(item.id) === id);
  }

  function filteredAssets() {
    return state.assets.filter((item) => item.type === state.type);
  }

  async function loadProjects() {
    const stored = currentProject();
    try {
      state.projects = await post("/project/getProject");
    } catch {
      state.projects = stored ? [stored] : [];
    }
    if (!state.projectId) {
      state.projectId = stored && stored.id ? stored.id : state.projects[0] && state.projects[0].id;
    }
  }

  async function loadAssets() {
    if (!state.projectId) return;
    state.loading = true;
    render();
    try {
      state.assets = await post("/cornerScape/getAllAssets", {
        projectId: Number(state.projectId),
        type: ["role", "scene", "tool"],
      });
      if (!filteredAssets().some((item) => String(item.id) === String(state.assetId))) {
        state.assetId = filteredAssets()[0] ? String(filteredAssets()[0].id) : "";
      }
    } finally {
      state.loading = false;
      render();
    }
  }

  async function openModal() {
    state.visible = true;
    state.file = null;
    state.previewUrl = "";
    state.assetId = "";
    render();
    try {
      await loadProjects();
      await loadAssets();
    } catch (err) {
      state.loading = false;
      render();
      toast(err.message || "加载失败", "error");
    }
  }

  function closeModal() {
    state.visible = false;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
    render();
  }

  async function upload() {
    const asset = selectedAsset();
    if (!state.projectId) return toast("请先选择项目", "warning");
    if (!asset) return toast("请先选择资产", "warning");
    if (!state.file) return toast("请先选择图片", "warning");
    if (!/^image\/(png|jpe?g|webp)$/i.test(state.file.type)) return toast("仅支持 PNG、JPG、WEBP", "warning");
    if (state.file.size > 20 * 1024 * 1024) return toast("图片不能超过 20MB", "warning");

    state.loading = true;
    render();
    try {
      await post("/assets/saveAssets", {
        id: Number(asset.id),
        projectId: Number(state.projectId),
        type: asset.type,
        prompt: asset.prompt || "",
        base64: await fileToDataUrl(state.file),
      });
      toast("上传成功", "success");
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      state.loading = false;
      render();
      toast(err.message || "上传失败", "error");
    }
  }

  function root() {
    let el = document.getElementById(rootId);
    if (el) return el;
    el = document.createElement("div");
    el.id = rootId;
    document.body.appendChild(el);
    return el;
  }

  function render() {
    const mount = root();
    const showButton = canShow();
    const assets = filteredAssets();
    const projectOptions = state.projects
      .map((project) => `<option value="${project.id}" ${String(project.id) === String(state.projectId) ? "selected" : ""}>${escapeHtml(project.name || project.title || project.id)}</option>`)
      .join("");
    const assetOptions = assets
      .map((asset) => `<option value="${asset.id}" ${String(asset.id) === String(state.assetId) ? "selected" : ""}>${escapeHtml(asset.name || asset.id)}</option>`)
      .join("");
    const typeButtons = Object.keys(labels)
      .map((type) => `<button class="tfu-segment ${state.type === type ? "active" : ""}" data-tfu-type="${type}" type="button">${labels[type]}</button>`)
      .join("");

    mount.innerHTML = `
      <style>
        #${rootId}{position:relative;z-index:10020;font-family:var(--td-font-family,"Inter","PingFang SC","Microsoft YaHei",sans-serif)}
        .tfu-fab{position:fixed;right:24px;bottom:88px;height:36px;padding:0 16px;border:0;border-radius:6px;background:var(--td-brand-color,#0052d9);color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.18);font-size:14px;line-height:36px;cursor:pointer}
        .tfu-fab:hover{background:var(--td-brand-color-hover,#366ef4)}
        .tfu-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}
        .tfu-dialog{width:min(520px,100%);background:var(--td-bg-color-container,#fff);color:var(--td-text-color-primary,#111);border-radius:8px;box-shadow:0 12px 36px rgba(0,0,0,.22);overflow:hidden}
        .tfu-head,.tfu-foot{height:56px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--td-component-border,#e7e7e7)}
        .tfu-foot{border-top:1px solid var(--td-component-border,#e7e7e7);border-bottom:0;justify-content:flex-end;gap:12px}
        .tfu-title{font-size:16px;font-weight:600}
        .tfu-close{width:32px;height:32px;border:0;background:transparent;color:inherit;font-size:22px;line-height:32px;cursor:pointer}
        .tfu-body{padding:20px;display:grid;gap:16px}
        .tfu-field{display:grid;gap:8px}
        .tfu-label{font-size:13px;color:var(--td-text-color-secondary,#666)}
        .tfu-select,.tfu-file{width:100%;height:36px;border:1px solid var(--td-component-border,#dcdcdc);border-radius:6px;background:var(--td-bg-color-container,#fff);color:inherit;padding:0 10px;box-sizing:border-box}
        .tfu-segments{display:flex;gap:8px}
        .tfu-segment{flex:1;height:34px;border:1px solid var(--td-component-border,#dcdcdc);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
        .tfu-segment.active{border-color:var(--td-brand-color,#0052d9);background:rgba(0,82,217,.08);color:var(--td-brand-color,#0052d9)}
        .tfu-preview{width:100%;height:180px;border:1px dashed var(--td-component-border,#dcdcdc);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--td-bg-color-page,#f7f8fa);font-size:13px;color:var(--td-text-color-placeholder,#999)}
        .tfu-preview img{max-width:100%;max-height:100%;object-fit:contain}
        .tfu-btn{height:34px;padding:0 16px;border-radius:6px;border:1px solid var(--td-component-border,#dcdcdc);background:var(--td-bg-color-container,#fff);color:inherit;cursor:pointer}
        .tfu-btn.primary{border-color:var(--td-brand-color,#0052d9);background:var(--td-brand-color,#0052d9);color:#fff}
        .tfu-btn:disabled,.tfu-fab:disabled{opacity:.55;cursor:not-allowed}
        .tfu-empty{height:40px;display:flex;align-items:center;color:var(--td-text-color-placeholder,#999);font-size:13px}
        .tfu-toast{position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:10030;background:rgba(0,0,0,.78);color:#fff;border-radius:6px;padding:9px 14px;font-size:14px}
        @media (max-width:640px){.tfu-fab{right:16px;bottom:76px}.tfu-mask{align-items:flex-end;padding:12px}.tfu-dialog{width:100%}}
      </style>
      ${showButton ? `<button class="tfu-fab" type="button" data-tfu-open>上传图片</button>` : ""}
      ${state.visible ? `
        <div class="tfu-mask" data-tfu-close>
          <div class="tfu-dialog" role="dialog" aria-modal="true" aria-label="上传图片" data-tfu-dialog>
            <div class="tfu-head">
              <div class="tfu-title">上传图片</div>
              <button class="tfu-close" type="button" data-tfu-close-btn aria-label="关闭">×</button>
            </div>
            <div class="tfu-body">
              <label class="tfu-field">
                <span class="tfu-label">项目</span>
                <select class="tfu-select" data-tfu-project ${state.loading ? "disabled" : ""}>${projectOptions}</select>
              </label>
              <div class="tfu-field">
                <span class="tfu-label">类型</span>
                <div class="tfu-segments">${typeButtons}</div>
              </div>
              <label class="tfu-field">
                <span class="tfu-label">资产</span>
                ${assets.length ? `<select class="tfu-select" data-tfu-asset ${state.loading ? "disabled" : ""}>${assetOptions}</select>` : `<div class="tfu-empty">当前类型没有资产</div>`}
              </label>
              <label class="tfu-field">
                <span class="tfu-label">图片</span>
                <input class="tfu-file" type="file" accept="image/png,image/jpeg,image/webp" data-tfu-file ${state.loading ? "disabled" : ""}>
              </label>
              <div class="tfu-preview">${state.previewUrl ? `<img src="${state.previewUrl}" alt="">` : "未选择图片"}</div>
            </div>
            <div class="tfu-foot">
              <button class="tfu-btn" type="button" data-tfu-cancel ${state.loading ? "disabled" : ""}>取消</button>
              <button class="tfu-btn primary" type="button" data-tfu-submit ${state.loading ? "disabled" : ""}>${state.loading ? "处理中" : "上传"}</button>
            </div>
          </div>
        </div>
      ` : ""}
    `;

    bindEvents(mount);
  }

  function bindEvents(mount) {
    const open = mount.querySelector("[data-tfu-open]");
    if (open) open.addEventListener("click", openModal);

    const mask = mount.querySelector("[data-tfu-close]");
    const dialog = mount.querySelector("[data-tfu-dialog]");
    const close = mount.querySelector("[data-tfu-close-btn]");
    const cancel = mount.querySelector("[data-tfu-cancel]");
    const submit = mount.querySelector("[data-tfu-submit]");
    if (mask) mask.addEventListener("click", closeModal);
    if (dialog) dialog.addEventListener("click", (event) => event.stopPropagation());
    if (close) close.addEventListener("click", closeModal);
    if (cancel) cancel.addEventListener("click", closeModal);
    if (submit) submit.addEventListener("click", upload);

    const project = mount.querySelector("[data-tfu-project]");
    if (project) {
      project.addEventListener("change", async (event) => {
        state.projectId = event.target.value;
        state.assetId = "";
        await loadAssets();
      });
    }

    mount.querySelectorAll("[data-tfu-type]").forEach((button) => {
      button.addEventListener("click", () => {
        state.type = button.getAttribute("data-tfu-type");
        state.assetId = filteredAssets()[0] ? String(filteredAssets()[0].id) : "";
        render();
      });
    });

    const asset = mount.querySelector("[data-tfu-asset]");
    if (asset) {
      asset.addEventListener("change", (event) => {
        state.assetId = event.target.value;
      });
    }

    const file = mount.querySelector("[data-tfu-file]");
    if (file) {
      file.addEventListener("change", (event) => {
        const nextFile = event.target.files && event.target.files[0];
        state.file = nextFile || null;
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = nextFile ? URL.createObjectURL(nextFile) : "";
        render();
      });
    }
  }

  function scheduleRender() {
    window.requestAnimationFrame(render);
  }

  function patchHistory() {
    ["pushState", "replaceState"].forEach((name) => {
      const original = history[name];
      history[name] = function () {
        const result = original.apply(this, arguments);
        scheduleRender();
        return result;
      };
    });
    window.addEventListener("popstate", scheduleRender);
  }

  function init() {
    patchHistory();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
