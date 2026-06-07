const app = getApp();
const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

Page({
  data: { loggedIn: false, list: [] },

  onShow() {
    const loggedIn = app.loggedIn();
    this.setData({ loggedIn });
    if (loggedIn) this.load();
    else this.setData({ list: [] });
  },

  load() {
    api.get("/api/subscriptions", { auth: true }).then((r) => {
      const list = (r.subscriptions || []).map((s) => ({
        ...s,
        _modeText: s.mode === "before_event" ? "开始前 " + s.lead_days + " 天提醒" : "官宣后通知",
        _fired: s.status === "fired",
      }));
      this.setData({ list });
    }).catch(() => {});
  },

  async onLogin() {
    try {
      const needsProfile = await app.ensureLogin();
      this.setData({ loggedIn: true });
      if (needsProfile) wx.switchTab({ url: "/pages/profile/profile" });
      else this.load();
    } catch (_) {
      wx.showToast({ title: "登录失败", icon: "none" });
    }
  },

  async onCancel(e) {
    const id = e.currentTarget.dataset.id;
    await api.del("/api/subscriptions/" + id, { auth: true });
    this.load();
  },

  goDetail(e) {
    wx.navigateTo({ url: "/pages/detail/detail?id=" + e.currentTarget.dataset.id });
  },
});
