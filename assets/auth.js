/* 登录/注册模块：邮箱 + 验证码（注册登录一体，无密码）。
 * 新用户验证通过后进入「完善资料」步骤：昵称 + 头像（卡通预设 / 自行上传）。
 * mock 模式下后端回显 dev_code，本模块自动填入并提示。 */
(function () {
  const API = window.API_BASE || "";
  const $ = (s, r) => (r || document).querySelector(s);

  // 后端不可用时降级为纯浏览版：隐藏登录与提醒入口（纯静态托管如 GitHub Pages 时自动生效）
  fetch(API + "/api/health")
    .then((r) => { if (!r.ok) throw 0; document.body.classList.remove("tlr-static"); })
    .catch(() => document.body.classList.add("tlr-static"));

  // 8 个科技风卡通头像预设（与站点配色一致）
  const PRESETS = [
    { e: "🤖", bg: "#0e2a22" }, { e: "🚀", bg: "#1a2233" }, { e: "👾", bg: "#251a33" }, { e: "🛸", bg: "#10262e" },
    { e: "📡", bg: "#2a2114" }, { e: "🦾", bg: "#1c2a17" }, { e: "🛰️", bg: "#22182a" }, { e: "⚡", bg: "#2a1a17" },
  ];

  const I = {
    zh: {
      login: "登录 / 注册", myReminders: "🔔 我的提醒", logout: "退出",
      title: "邮箱验证码 · 登录 / 注册", emailPh: "输入邮箱", codePh: "6位验证码",
      send: "获取验证码", resend: "重新获取", verify: "继续",
      devHint: "开发模式：邮件推送未上线，验证码已自动填入 →",
      agree: "继续即代表同意将邮箱用于接收你订阅的发布会提醒",
      netErr: "网络错误，请稍后再试",
      profileTitleNew: "欢迎！完善你的资料", profileTitleEdit: "编辑资料",
      nickPh: "用户名（1-20字符）", chooseAvatar: "选择头像", uploadTile: "＋ 上传",
      uploadTip: "支持 PNG / JPG / WebP，不超过 1MB", save: "完成", nickErr: "请填写用户名（1-20字符）",
      editProfile: "编辑资料",
    },
    en: {
      login: "Sign in / up", myReminders: "🔔 My reminders", logout: "Sign out",
      title: "Email code · Sign in / up", emailPh: "Email address", codePh: "6-digit code",
      send: "Send code", resend: "Resend", verify: "Continue",
      devHint: "Dev mode: email delivery not live — code auto-filled →",
      agree: "By continuing you agree to receive event reminders at this email",
      netErr: "Network error, please retry",
      profileTitleNew: "Welcome! Set up your profile", profileTitleEdit: "Edit profile",
      nickPh: "Username (1-20 chars)", chooseAvatar: "Pick an avatar", uploadTile: "＋ Upload",
      uploadTip: "PNG / JPG / WebP, up to 1MB", save: "Done", nickErr: "Username must be 1-20 characters",
      editProfile: "Edit profile",
    },
  };
  const lang = () => localStorage.getItem("tlr-lang") || "zh";
  const t = (k) => I[lang()][k];

  const state = {
    token: localStorage.getItem("tlr-token") || null,
    email: localStorage.getItem("tlr-email") || null,
    profile: JSON.parse(localStorage.getItem("tlr-profile") || "null"),
  };

  async function apiFetch(path, opts = {}) {
    opts.headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) opts.headers["Content-Type"] = "application/json";
    if (state.token) opts.headers["Authorization"] = "Bearer " + state.token;
    const res = await fetch(API + path, opts);
    if (res.status === 401 && state.token) { logout(); openLogin(); }
    return res;
  }

  function setSession(token, email, profile) {
    state.token = token; state.email = email; state.profile = profile || null;
    localStorage.setItem("tlr-token", token);
    localStorage.setItem("tlr-email", email);
    localStorage.setItem("tlr-profile", JSON.stringify(state.profile));
    renderHeader();
    document.dispatchEvent(new CustomEvent("tlr-auth", { detail: { loggedIn: true } }));
  }

  function setProfile(profile) {
    state.profile = profile;
    localStorage.setItem("tlr-profile", JSON.stringify(profile));
    renderHeader();
  }

  function logout() {
    state.token = null; state.email = null; state.profile = null;
    ["tlr-token", "tlr-email", "tlr-profile"].forEach((k) => localStorage.removeItem(k));
    renderHeader();
    document.dispatchEvent(new CustomEvent("tlr-auth", { detail: { loggedIn: false } }));
  }

  // ---- 头像渲染 ----
  function avatarHTML(avatar, cls) {
    if (avatar && avatar.startsWith("u:")) {
      return '<img class="avatar ' + (cls || "") + '" src="' + API + "/avatars/" + avatar.slice(2) + '" alt="">';
    }
    const idx = avatar && avatar.startsWith("p:") ? parseInt(avatar.slice(2), 10) % PRESETS.length : 0;
    const p = PRESETS[isNaN(idx) ? 0 : idx];
    return '<span class="avatar ' + (cls || "") + '" style="background:' + p.bg + '">' + p.e + "</span>";
  }

  // ---- header 槽位 ----
  function renderHeader() {
    const slot = $("#auth-slot");
    if (!slot) return;
    if (state.token) {
      const name = (state.profile && state.profile.nickname) || state.email || "";
      const short = name.length > 14 ? name.slice(0, 12) + "…" : name;
      slot.innerHTML =
        '<button class="user-chip" id="btn-profile" title="' + t("editProfile") + '">' +
          avatarHTML(state.profile && state.profile.avatar, "sm") +
          '<span class="auth-email">' + short + "</span>" +
        "</button>" +
        '<button class="auth-btn primary" id="btn-my-reminders">' + t("myReminders") + "</button>" +
        '<button class="auth-btn ghost" id="btn-logout">' + t("logout") + "</button>";
      $("#btn-logout").onclick = logout;
      $("#btn-my-reminders").onclick = () => window.TLR_OPEN_DRAWER && window.TLR_OPEN_DRAWER();
      $("#btn-profile").onclick = () => openProfile(false);
    } else {
      slot.innerHTML = '<button class="auth-btn primary" id="btn-login">' + t("login") + "</button>";
      $("#btn-login").onclick = openLogin;
    }
  }

  // ---- 登录/注册弹窗 ----
  let overlay = null;
  function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }

  function openLogin() {
    closeOverlay();
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-box" role="dialog" aria-modal="true">' +
        '<button class="modal-close" aria-label="close">×</button>' +
        '<div class="modal-title">' + t("title") + "</div>" +
        '<div class="field"><input id="li-email" type="email" placeholder="' + t("emailPh") + '" autocomplete="email"></div>' +
        '<div class="field row"><input id="li-code" type="text" inputmode="numeric" maxlength="6" placeholder="' + t("codePh") + '">' +
          '<button class="auth-btn primary" id="li-send">' + t("send") + "</button></div>" +
        '<div class="dev-hint" id="li-dev" hidden></div>' +
        '<div class="modal-err" id="li-err"></div>' +
        '<button class="auth-btn primary block" id="li-verify">' + t("verify") + "</button>" +
        '<div class="modal-agree">' + t("agree") + "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
    $(".modal-close", overlay).onclick = closeOverlay;

    const err = (m) => { $("#li-err").textContent = m || ""; };

    let cd = 0, timer = null;
    $("#li-send").onclick = async () => {
      if (cd > 0) return;
      err("");
      const email = $("#li-email").value.trim();
      try {
        const res = await apiFetch("/api/auth/send-code", { method: "POST", body: JSON.stringify({ email }) });
        const j = await res.json();
        if (!res.ok) return err(j.message || j.error);
        if (j.dev_code) {
          $("#li-code").value = j.dev_code;
          const d = $("#li-dev"); d.hidden = false;
          d.textContent = t("devHint") + " " + j.dev_code;
        }
        cd = 60;
        timer = setInterval(() => {
          cd--;
          const btn = $("#li-send");
          if (!btn) return clearInterval(timer);
          btn.textContent = cd > 0 ? cd + "s" : t("resend");
          if (cd <= 0) clearInterval(timer);
        }, 1000);
      } catch { err(t("netErr")); }
    };

    $("#li-verify").onclick = async () => {
      err("");
      const email = $("#li-email").value.trim();
      const code = $("#li-code").value.trim();
      try {
        const res = await apiFetch("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) });
        const j = await res.json();
        if (!res.ok) return err(j.message || j.error);
        setSession(j.token, j.email, j.profile);
        closeOverlay();
        if (j.needs_profile) openProfile(true); // 新用户 → 完善资料
      } catch { err(t("netErr")); }
    };
    setTimeout(() => $("#li-email").focus(), 50);
  }

  // ---- 完善/编辑资料弹窗 ----
  function openProfile(isNew) {
    closeOverlay();
    const cur = state.profile || {};
    let selected = cur.avatar || "p:0"; // 当前选中的头像
    let uploadFile = null;              // 待上传的文件

    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-box" role="dialog" aria-modal="true">' +
        (isNew ? "" : '<button class="modal-close" aria-label="close">×</button>') +
        '<div class="modal-title">' + (isNew ? t("profileTitleNew") : t("profileTitleEdit")) + "</div>" +
        '<div class="field"><input id="pf-nick" type="text" maxlength="20" placeholder="' + t("nickPh") + '" value="' + (cur.nickname ? cur.nickname.replace(/"/g, "&quot;") : "") + '"></div>' +
        '<div class="pf-label">' + t("chooseAvatar") + "</div>" +
        '<div class="avatar-grid" id="pf-grid"></div>' +
        '<div class="upload-tip">' + t("uploadTip") + "</div>" +
        '<input id="pf-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>' +
        '<div class="modal-err" id="pf-err"></div>' +
        '<button class="auth-btn primary block" id="pf-save">' + t("save") + "</button>" +
      "</div>";
    document.body.appendChild(overlay);
    if (!isNew) {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
      $(".modal-close", overlay).onclick = closeOverlay;
    }

    const err = (m) => { $("#pf-err").textContent = m || ""; };

    // 渲染头像网格：8 预设 + 上传块
    function renderGrid() {
      const grid = $("#pf-grid");
      let html = PRESETS.map((p, i) =>
        '<button class="avatar-opt' + (selected === "p:" + i ? " sel" : "") + '" data-av="p:' + i + '" style="background:' + p.bg + '">' + p.e + "</button>"
      ).join("");
      // 上传块：有待上传文件或已是上传头像时显示预览
      if (uploadFile) {
        html += '<button class="avatar-opt sel" data-av="__upload"><img class="avatar-img" src="' + URL.createObjectURL(uploadFile) + '"></button>';
      } else if (selected.startsWith("u:")) {
        html += '<button class="avatar-opt sel" data-av="' + selected + '"><img class="avatar-img" src="' + API + "/avatars/" + selected.slice(2) + '"></button>';
      }
      html += '<button class="avatar-opt upload-tile" data-av="__pick">' + t("uploadTile") + "</button>";
      grid.innerHTML = html;
      grid.querySelectorAll(".avatar-opt").forEach((b) => {
        b.onclick = () => {
          const av = b.dataset.av;
          if (av === "__pick") return $("#pf-file").click();
          if (av === "__upload") return;
          uploadFile = null;
          selected = av;
          renderGrid();
        };
      });
    }
    renderGrid();

    $("#pf-file").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) return err(t("uploadTip"));
      uploadFile = f;
      selected = "__upload";
      err("");
      renderGrid();
    };

    $("#pf-save").onclick = async () => {
      err("");
      const nickname = $("#pf-nick").value.trim();
      if (nickname.length < 1 || nickname.length > 20) return err(t("nickErr"));
      try {
        let avatar = selected;
        if (uploadFile) {
          const fd = new FormData();
          fd.append("file", uploadFile);
          const up = await apiFetch("/api/auth/me/avatar", { method: "POST", body: fd });
          const uj = await up.json();
          if (!up.ok) return err(uj.message || uj.error);
          avatar = uj.avatar;
        }
        const res = await apiFetch("/api/auth/me", { method: "POST", body: JSON.stringify({ nickname, avatar }) });
        const j = await res.json();
        if (!res.ok) return err(j.message || j.error);
        setProfile(j.profile);
        closeOverlay();
      } catch { err(t("netErr")); }
    };
    setTimeout(() => $("#pf-nick").focus(), 50);
  }

  // 已登录但资料缺失（如老账号）→ 自动弹完善资料
  if (state.token && (!state.profile || !state.profile.nickname)) {
    apiFetch("/api/auth/me").then(async (res) => {
      if (!res.ok) return;
      const j = await res.json();
      if (j.needs_profile) openProfile(true);
      else setProfile({ nickname: j.nickname, avatar: j.avatar });
    }).catch(() => {});
  }

  window.TLR_AUTH = {
    get token() { return state.token; },
    get email() { return state.email; },
    loggedIn: () => !!state.token,
    apiFetch, openLogin, logout, lang, renderHeader,
  };

  // 语言切换时 index.html 的 renderAll 会调用此钩子链
  const prevAfterAll = window.TLR_AFTER_ALL;
  window.TLR_AFTER_ALL = function () {
    if (prevAfterAll) prevAfterAll();
    renderHeader();
  };

  renderHeader();
})();
