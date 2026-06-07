const app = getApp();
const api = require("../../utils/api.js");
const util = require("../../utils/util.js");
const { API_BASE } = require("../../config.js");

Page({
  data: {
    loggedIn: false,
    profile: null,
    av: null,            // 当前头像渲染对象
    presets: util.PRESETS,
    presetBg: util.PRESET_BG,
    editing: false,      // 是否在编辑资料
    nick: "",
    selAvatar: "p:0",    // 选中的头像值
    uploadPath: "",      // 待上传的本地头像路径
  },

  onShow() {
    const loggedIn = app.loggedIn();
    const profile = app.globalData.profile;
    this.setData({
      loggedIn,
      profile,
      av: profile ? util.parseAvatar(profile.avatar) : null,
      editing: loggedIn && (!profile || !profile.nickname), // 新用户自动进入编辑
      nick: (profile && profile.nickname) || "",
      selAvatar: (profile && profile.avatar) || "p:0",
    });
  },

  async onLogin() {
    try {
      await app.ensureLogin();
      this.onShow();
    } catch (_) {
      wx.showToast({ title: "登录失败", icon: "none" });
    }
  },

  startEdit() { this.setData({ editing: true }); },

  onNick(e) { this.setData({ nick: e.detail.value }); },

  pickPreset(e) {
    this.setData({ selAvatar: "p:" + e.currentTarget.dataset.i, uploadPath: "" });
  },

  // 微信头像选择能力
  onChooseAvatar(e) {
    this.setData({ uploadPath: e.detail.avatarUrl, selAvatar: "__upload" });
  },

  async onSave() {
    const nick = this.data.nick.trim();
    if (nick.length < 1 || nick.length > 20) {
      return wx.showToast({ title: "用户名需1-20字符", icon: "none" });
    }
    wx.showLoading({ title: "保存中" });
    try {
      let avatar = this.data.selAvatar;
      if (this.data.uploadPath) {
        // 上传微信头像到后端
        const up = await new Promise((resolve, reject) => {
          wx.uploadFile({
            url: API_BASE + "/api/auth/me/avatar",
            filePath: this.data.uploadPath,
            name: "file",
            header: { Authorization: "Bearer " + api.getToken() },
            success: (r) => resolve(JSON.parse(r.data)),
            fail: reject,
          });
        });
        if (!up.avatar) throw new Error(up.message || "头像上传失败");
        avatar = up.avatar;
      }
      const r = await api.post("/api/auth/me", { nickname: nick, avatar }, { auth: true });
      app.setProfile(r.profile);
      wx.hideLoading();
      this.setData({ editing: false });
      this.onShow();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || "保存失败", icon: "none" });
    }
  },

  onLogout() {
    app.logout();
    this.onShow();
  },

  onDelete() {
    wx.showModal({
      title: "注销账号",
      content: "将永久删除你的资料、订阅与全部评论，不可恢复。确定？",
      confirmColor: "#ff7a6b",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.del("/api/auth/account", { auth: true });
          app.logout();
          this.onShow();
          wx.showToast({ title: "已注销", icon: "none" });
        } catch (_) {
          wx.showToast({ title: "操作失败", icon: "none" });
        }
      },
    });
  },
});
