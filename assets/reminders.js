/* 提醒订阅模块：confirmed 事件 → 开始前 1/3/7 天提醒；expected/rumored → 官宣后通知。
 * 依赖 assets/auth.js（window.TLR_AUTH）。邮件推送未上线：所有提醒仅在后端记录。 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const A = () => window.TLR_AUTH;

  const I = {
    zh: {
      remind: "🔔 提醒我", watch: "📌 关注官宣",
      remindSet: (d) => "✓ 已设提醒 · 提前" + d + "天", watchSet: "✓ 已关注官宣",
      cancelHint: "（点击取消）",
      chooseTitle: "发布会开始前多久提醒？", d1: "提前 1 天", d3: "提前 3 天", d7: "提前 7 天",
      drawerTitle: "我的提醒", empty: "还没有订阅任何提醒", cancel: "取消",
      modeBefore: (d) => "开始前 " + d + " 天提醒", modeAnnounce: "官宣后通知",
      fired: "已通知", close: "关闭",
      notice: "ⓘ 邮件推送功能尚未上线：当前订阅会被记录，提醒触发时暂不会真正发送邮件。",
    },
    en: {
      remind: "🔔 Remind me", watch: "📌 Watch for date",
      remindSet: (d) => "✓ Reminder · " + d + "d before", watchSet: "✓ Watching",
      cancelHint: " (tap to cancel)",
      chooseTitle: "Remind me before the event:", d1: "1 day before", d3: "3 days before", d7: "7 days before",
      drawerTitle: "My reminders", empty: "No reminders yet", cancel: "Cancel",
      modeBefore: (d) => d + " days before", modeAnnounce: "Notify on announcement",
      fired: "Notified", close: "Close",
      notice: "ⓘ Email delivery is not live yet: subscriptions are recorded, but no real email will be sent when reminders fire.",
    },
  };
  const t = () => I[A().lang()];

  let subs = new Map(); // event_id -> {mode, lead_days, status, ...}

  async function refreshSubs() {
    subs = new Map();
    if (A().loggedIn()) {
      try {
        const res = await A().apiFetch("/api/subscriptions");
        if (res.ok) {
          const j = await res.json();
          j.subscriptions.forEach((s) => subs.set(s.event_id, s));
        }
      } catch { /* 服务未启动时静默降级，页面仍可浏览 */ }
    }
    decorate();
    renderDrawerIfOpen();
  }

  // 给时间线上的按钮贴标签与状态
  function decorate() {
    document.querySelectorAll(".remind-btn").forEach((btn) => {
      const id = btn.dataset.eventId;
      const status = btn.dataset.eventStatus;
      const sub = subs.get(id);
      const L = t();
      if (sub && sub.status !== "fired") {
        btn.classList.add("is-set");
        btn.textContent = (sub.mode === "before_event" ? L.remindSet(sub.lead_days) : L.watchSet) + L.cancelHint;
      } else {
        btn.classList.remove("is-set");
        btn.textContent = status === "confirmed" ? L.remind : L.watch;
      }
    });
  }

  // ---- 点击订阅/取消（事件委托，时间线重渲染不影响） ----
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".remind-btn");
    if (!btn) return;
    if (!A().loggedIn()) return A().openLogin();

    const id = btn.dataset.eventId;
    const status = btn.dataset.eventStatus;
    const sub = subs.get(id);

    if (sub && sub.status !== "fired") {
      await A().apiFetch("/api/subscriptions/" + encodeURIComponent(id), { method: "DELETE" });
      return refreshSubs();
    }
    if (status === "confirmed") {
      openLeadChooser(id);
    } else {
      await A().apiFetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ event_id: id, mode: "on_announce" }) });
      refreshSubs();
    }
  });

  // ---- 提前天数选择 ----
  function openLeadChooser(eventId) {
    const L = t();
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal-box small">' +
        '<button class="modal-close">×</button>' +
        '<div class="modal-title">' + L.chooseTitle + "</div>" +
        '<div class="lead-row">' +
          '<button class="auth-btn primary" data-d="1">' + L.d1 + "</button>" +
          '<button class="auth-btn primary" data-d="3">' + L.d3 + "</button>" +
          '<button class="auth-btn primary" data-d="7">' + L.d7 + "</button>" +
        "</div>" +
        '<div class="modal-agree">' + L.notice + "</div>" +
      "</div>";
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    $(".modal-close", ov).onclick = close;
    ov.querySelectorAll("[data-d]").forEach((b) => {
      b.onclick = async () => {
        await A().apiFetch("/api/subscriptions", {
          method: "POST",
          body: JSON.stringify({ event_id: eventId, mode: "before_event", lead_days: Number(b.dataset.d) }),
        });
        close();
        refreshSubs();
      };
    });
  }

  // ---- 我的提醒抽屉 ----
  let drawer = null;
  function openDrawer() {
    closeDrawer();
    drawer = document.createElement("div");
    drawer.className = "drawer-overlay";
    drawer.innerHTML = '<aside class="drawer"><div class="drawer-head"><span></span><button class="modal-close">×</button></div><div class="drawer-body"></div><div class="drawer-note"></div></aside>';
    document.body.appendChild(drawer);
    drawer.addEventListener("click", (e) => { if (e.target === drawer) closeDrawer(); });
    $(".modal-close", drawer).onclick = closeDrawer;
    renderDrawerIfOpen();
  }
  function closeDrawer() { if (drawer) { drawer.remove(); drawer = null; } }

  function renderDrawerIfOpen() {
    if (!drawer) return;
    const L = t();
    $(".drawer-head span", drawer).textContent = L.drawerTitle + " (" + subs.size + ")";
    $(".drawer-note", drawer).textContent = L.notice;
    const body = $(".drawer-body", drawer);
    if (!subs.size) { body.innerHTML = '<div class="drawer-empty">' + L.empty + "</div>"; return; }
    const zh = A().lang() === "zh";
    body.innerHTML = [...subs.values()]
      .map((s) => {
        const name = zh ? s.name_zh : s.name_en;
        const mode = s.mode === "before_event" ? L.modeBefore(s.lead_days) : L.modeAnnounce;
        const fired = s.status === "fired" ? ' <span class="sub-fired">' + L.fired + "</span>" : "";
        return (
          '<div class="sub-item"><div><div class="sub-name">' + (name || s.event_id) + "</div>" +
          '<div class="sub-meta">' + (s.date_sort || "") + " · " + mode + fired + "</div></div>" +
          '<button class="auth-btn ghost sub-cancel" data-id="' + s.event_id + '">' + L.cancel + "</button></div>"
        );
      })
      .join("");
    body.querySelectorAll(".sub-cancel").forEach((b) => {
      b.onclick = async () => {
        await A().apiFetch("/api/subscriptions/" + encodeURIComponent(b.dataset.id), { method: "DELETE" });
        refreshSubs();
      };
    });
  }

  window.TLR_OPEN_DRAWER = openDrawer;

  // 时间线每次重渲染后重新贴按钮状态
  const prevAfterRender = window.TLR_AFTER_RENDER;
  window.TLR_AFTER_RENDER = function () {
    if (prevAfterRender) prevAfterRender();
    decorate();
  };

  document.addEventListener("tlr-auth", refreshSubs);
  refreshSubs();
})();
