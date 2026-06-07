const app = getApp();
const api = require("../../utils/api.js");
const util = require("../../utils/util.js");
const { SUBSCRIBE_TEMPLATE_ID } = require("../../config.js");

Page({
  data: {
    id: "",
    event: null,
    sub: null,          // 当前订阅 { mode, lead_days, status }
    comments: [],
    input: "",
    posting: false,
    leadOptions: [1, 3, 7],
  },

  onLoad(q) {
    this.setData({ id: q.id });
    this.load();
  },

  async load() {
    try {
      const r = await api.get("/api/events");
      const e = (r.events || []).find((x) => x.id === this.data.id);
      if (e) {
        e._live = util.isLive(e);
        e._statusText = util.STATUS_TEXT[e.status] || e.status;
        e._catText = util.CAT_TEXT[e.category] || e.category;
      }
      this.setData({ event: e });
      wx.setNavigationBarTitle({ title: e ? e.name_zh : "详情" });
      this.loadComments();
      this.loadSub();
    } catch (_) {
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  loadComments() {
    const opts = app.loggedIn() ? { auth: true } : {};
    api.get("/api/comments/" + this.data.id, opts).then((r) => {
      const comments = (r.comments || []).map((c) => ({ ...c, _av: util.parseAvatar(c.avatar) }));
      this.setData({ comments });
    }).catch(() => {});
  },

  loadSub() {
    if (!app.loggedIn()) { this.setData({ sub: null }); return; }
    api.get("/api/subscriptions", { auth: true }).then((r) => {
      const sub = (r.subscriptions || []).find((s) => s.event_id === this.data.id && s.status !== "fired") || null;
      this.setData({ sub });
    }).catch(() => {});
  },

  // ---- 订阅 ----
  async onSubscribe(e) {
    const mode = e.currentTarget.dataset.mode;
    const lead = e.currentTarget.dataset.lead;
    try {
      await app.ensureLogin();
    } catch (_) {
      return wx.showToast({ title: "请先登录", icon: "none" });
    }
    // 已订阅则取消
    if (this.data.sub) {
      await api.del("/api/subscriptions/" + this.data.id, { auth: true });
      this.loadSub();
      return;
    }
    // 引导微信订阅消息授权（一次性）
    let wxAuthorized = false;
    if (SUBSCRIBE_TEMPLATE_ID) {
      wxAuthorized = await new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds: [SUBSCRIBE_TEMPLATE_ID],
          success: (res) => resolve(res[SUBSCRIBE_TEMPLATE_ID] === "accept"),
          fail: () => resolve(false),
        });
      });
    }
    const body = mode === "before_event"
      ? { event_id: this.data.id, mode, lead_days: lead, wx_authorized: wxAuthorized }
      : { event_id: this.data.id, mode, wx_authorized: wxAuthorized };
    try {
      await api.post("/api/subscriptions", body, { auth: true });
      wx.showToast({ title: wxAuthorized ? "已设提醒" : "已订阅（未授权推送）", icon: "none" });
      this.loadSub();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
    }
  },

  // ---- 评论 ----
  onInput(e) { this.setData({ input: e.detail.value }); },

  async onPost() {
    const content = this.data.input.trim();
    if (!content) return;
    try {
      await app.ensureLogin();
    } catch (_) {
      return wx.showToast({ title: "请先登录", icon: "none" });
    }
    this.setData({ posting: true });
    try {
      await api.post("/api/comments", { event_id: this.data.id, content }, { auth: true });
      this.setData({ input: "" });
      this.loadComments();
    } catch (err) {
      wx.showModal({ title: "发布失败", content: (err && err.message) || "请稍后再试", showCancel: false });
    } finally {
      this.setData({ posting: false });
    }
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.cid;
    await api.del("/api/comments/" + id, { auth: true });
    this.loadComments();
  },

  copyOfficial() {
    wx.setClipboardData({ data: this.data.event.official_url });
  },
  copyLive() {
    wx.setClipboardData({ data: this.data.event.live_url });
  },
});
