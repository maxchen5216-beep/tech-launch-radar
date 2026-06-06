/* 登录模块：邮箱 + 验证码（无密码）。
 * 邮件推送未上线：mock 模式下后端会回显 dev_code，本模块自动填入并提示。 */
(function () {
  const API = window.API_BASE || "";
  const $ = (s, r) => (r || document).querySelector(s);

  // 后端不可用时降级为纯浏览版：隐藏登录与提醒入口（纯静态托管如 GitHub Pages 时自动生效）
  fetch(API + "/api/health")
    .then((r) => { if (!r.ok) throw 0; document.body.classList.remove("tlr-static"); })
    .catch(() => document.body.classList.add("tlr-static"));

  const I = {
    zh: {
      login: "登录", myReminders: "🔔 我的提醒", logout: "退出",
      title: "邮箱验证码登录", emailPh: "输入邮箱", codePh: "6位验证码",
      send: "获取验证码", resend: "重新获取", verify: "登录",
      devHint: "开发模式：邮件推送未上线，验证码已自动填入 →",
      agree: "登录即代表同意将邮箱用于接收你订阅的发布会提醒",
      netErr: "网络错误，请确认本地服务已启动（bun run server）",
    },
    en: {
      login: "Sign in", myReminders: "🔔 My reminders", logout: "Sign out",
      title: "Sign in with email code", emailPh: "Email address", codePh: "6-digit code",
      send: "Send code", resend: "Resend", verify: "Sign in",
      devHint: "Dev mode: email delivery not live — code auto-filled →",
      agree: "By signing in you agree to receive event reminders at this email",
      netErr: "Network error — is the local server running?",
    },
  };
  const lang = () => localStorage.getItem("tlr-lang") || "zh";
  const t = (k) => I[lang()][k];

  const state = {
    token: localStorage.getItem("tlr-token") || null,
    email: localStorage.getItem("tlr-email") || null,
  };

  async function apiFetch(path, opts = {}) {
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (state.token) opts.headers["Authorization"] = "Bearer " + state.token;
    const res = await fetch(API + path, opts);
    if (res.status === 401 && state.token) { logout(); openLogin(); }
    return res;
  }

  function setSession(token, email) {
    state.token = token; state.email = email;
    localStorage.setItem("tlr-token", token);
    localStorage.setItem("tlr-email", email);
    renderHeader();
    document.dispatchEvent(new CustomEvent("tlr-auth", { detail: { loggedIn: true } }));
  }

  function logout() {
    state.token = null; state.email = null;
    localStorage.removeItem("tlr-token");
    localStorage.removeItem("tlr-email");
    renderHeader();
    document.dispatchEvent(new CustomEvent("tlr-auth", { detail: { loggedIn: false } }));
  }

  // ---- header 槽位 ----
  function renderHeader() {
    const slot = $("#auth-slot");
    if (!slot) return;
    if (state.token) {
      const short = state.email.length > 22 ? state.email.slice(0, 19) + "…" : state.email;
      slot.innerHTML =
        '<button class="auth-btn primary" id="btn-my-reminders">' + t("myReminders") + "</button>" +
        '<span class="auth-email" title="' + state.email + '">' + short + "</span>" +
        '<button class="auth-btn ghost" id="btn-logout">' + t("logout") + "</button>";
      $("#btn-logout").onclick = logout;
      $("#btn-my-reminders").onclick = () => window.TLR_OPEN_DRAWER && window.TLR_OPEN_DRAWER();
    } else {
      slot.innerHTML = '<button class="auth-btn primary" id="btn-login">' + t("login") + "</button>";
      $("#btn-login").onclick = openLogin;
    }
  }

  // ---- 登录弹窗 ----
  let overlay = null;
  function openLogin() {
    if (overlay) overlay.remove();
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
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $(".modal-close", overlay).onclick = close;
    function close() { overlay.remove(); overlay = null; }

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
        setSession(j.token, j.email);
        close();
      } catch { err(t("netErr")); }
    };
    setTimeout(() => $("#li-email").focus(), 50);
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
