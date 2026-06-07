/* 评论模块：每个活动卡片可展开评论区。
 * 规则（用户已确认）：登录可评、≤200字、可删自己的（管理员可删任何）、
 * 敏感词由后端拦截——命中时阻止发布并提示具体词条。 */
(function () {
  const API = window.API_BASE || "";
  const A = () => window.TLR_AUTH;

  const I = {
    zh: {
      btn: (n) => "💬 评论" + (n ? " " + n : ""),
      title: "评论", empty: "还没有评论，来抢沙发",
      ph: "友善交流，≤200字（含敏感词将无法发布）",
      post: "发布", del: "删除", needLogin: "登录后参与评论",
      netErr: "网络错误，请稍后再试",
    },
    en: {
      btn: (n) => "💬 Comments" + (n ? " " + n : ""),
      title: "Comments", empty: "No comments yet — be the first",
      ph: "Be kind. Up to 200 chars (sensitive words are blocked)",
      post: "Post", del: "Delete", needLogin: "Sign in to comment",
      netErr: "Network error, please retry",
    },
  };
  const t = () => I[A().lang()];

  let counts = {};

  async function refreshCounts() {
    try {
      const res = await fetch(API + "/api/comments/counts");
      if (res.ok) counts = (await res.json()).counts || {};
    } catch { /* 静态模式下静默 */ }
    decorate();
  }

  function decorate() {
    document.querySelectorAll(".cmt-btn").forEach((b) => {
      b.textContent = t().btn(counts[b.dataset.eventId] || 0);
    });
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 头像渲染（与 auth.js 的预设保持一致）
  const PRESETS = [
    { e: "🤖", bg: "#0e2a22" }, { e: "🚀", bg: "#1a2233" }, { e: "👾", bg: "#251a33" }, { e: "🛸", bg: "#10262e" },
    { e: "📡", bg: "#2a2114" }, { e: "🦾", bg: "#1c2a17" }, { e: "🛰️", bg: "#22182a" }, { e: "⚡", bg: "#2a1a17" },
  ];
  function avatarHTML(avatar) {
    if (avatar && avatar.startsWith("u:")) return '<img class="avatar sm" src="' + API + "/avatars/" + esc(avatar.slice(2)) + '" alt="">';
    const idx = avatar && avatar.startsWith("p:") ? parseInt(avatar.slice(2), 10) % PRESETS.length : 0;
    const p = PRESETS[isNaN(idx) ? 0 : idx];
    return '<span class="avatar sm" style="background:' + p.bg + '">' + p.e + "</span>";
  }

  // ---- 展开/收起评论区 ----
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".cmt-btn");
    if (!btn) return;
    const card = btn.closest(".card");
    const existing = card.querySelector(".cmt-section");
    if (existing) { existing.remove(); return; }
    const sec = document.createElement("div");
    sec.className = "cmt-section";
    sec.dataset.eventId = btn.dataset.eventId;
    sec.innerHTML = '<div class="cmt-list"></div><div class="cmt-composer"></div>';
    card.appendChild(sec);
    renderComposer(sec);
    await loadList(sec);
  });

  async function loadList(sec) {
    const list = sec.querySelector(".cmt-list");
    try {
      // 登录用户走 apiFetch（带 token + 统一 401 处理）；未登录用裸 fetch 读公开列表
      const path = "/api/comments/" + encodeURIComponent(sec.dataset.eventId);
      const res = A().loggedIn() ? await A().apiFetch(path) : await fetch(API + path);
      const j = await res.json();
      if (!j.comments || !j.comments.length) {
        list.innerHTML = '<div class="cmt-empty">' + t().empty + "</div>";
        return;
      }
      list.innerHTML = j.comments
        .map(
          (cm) =>
            '<div class="cmt-item">' +
              avatarHTML(cm.avatar) +
              '<div class="cmt-body"><div class="cmt-meta"><span class="cmt-nick">' + esc(cm.nickname) + '</span><span class="cmt-time">' + fmtTime(cm.created_at) + "</span>" +
              (cm.can_delete ? '<button class="cmt-del" data-id="' + cm.id + '">' + t().del + "</button>" : "") +
              '</div><div class="cmt-text">' + esc(cm.content) + "</div></div>" +
            "</div>"
        )
        .join("");
      list.querySelectorAll(".cmt-del").forEach((b) => {
        b.onclick = async () => {
          await A().apiFetch("/api/comments/" + b.dataset.id, { method: "DELETE" });
          await refreshCounts();
          loadList(sec);
        };
      });
    } catch {
      list.innerHTML = '<div class="cmt-empty">' + t().netErr + "</div>";
    }
  }

  function renderComposer(sec) {
    const box = sec.querySelector(".cmt-composer");
    if (!A().loggedIn()) {
      box.innerHTML = '<button class="auth-btn primary block cmt-login">' + t().needLogin + "</button>";
      box.querySelector(".cmt-login").onclick = () => A().openLogin();
      return;
    }
    box.innerHTML =
      '<textarea class="cmt-input" maxlength="200" rows="2" placeholder="' + t().ph + '"></textarea>' +
      '<div class="cmt-foot"><span class="cmt-count">0/200</span><span class="cmt-err"></span>' +
      '<button class="auth-btn primary cmt-post">' + t().post + "</button></div>";

    const input = box.querySelector(".cmt-input");
    const count = box.querySelector(".cmt-count");
    const err = box.querySelector(".cmt-err");
    input.addEventListener("input", () => { count.textContent = input.value.length + "/200"; err.textContent = ""; });

    box.querySelector(".cmt-post").onclick = async () => {
      err.textContent = "";
      const content = input.value.trim();
      if (!content) return;
      try {
        const res = await A().apiFetch("/api/comments", {
          method: "POST",
          body: JSON.stringify({ event_id: sec.dataset.eventId, content }),
        });
        const j = await res.json();
        if (!res.ok) { err.textContent = j.message || j.error; return; } // 敏感词命中等都在 message 里
        input.value = ""; count.textContent = "0/200";
        await refreshCounts();
        loadList(sec);
      } catch { err.textContent = t().netErr; }
    };
  }

  // 登录态变化 → 重渲染已展开的评论区
  document.addEventListener("tlr-auth", () => {
    document.querySelectorAll(".cmt-section").forEach((sec) => { renderComposer(sec); loadList(sec); });
  });

  // 时间线重渲染后补按钮文字
  const prev = window.TLR_AFTER_RENDER;
  window.TLR_AFTER_RENDER = function () {
    if (prev) prev();
    decorate();
  };

  refreshCounts();
})();
