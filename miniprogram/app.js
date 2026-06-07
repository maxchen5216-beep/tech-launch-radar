const api = require("./utils/api.js");

App({
  globalData: {
    token: "",
    profile: null, // { nickname, avatar }
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync("tlr_token") || "";
    this.globalData.profile = wx.getStorageSync("tlr_profile") || null;
  },

  /** 微信一键登录：wx.login → code → 后端换 openid → 存 JWT。返回 {needs_profile} */
  login() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: async ({ code }) => {
          try {
            const r = await api.post("/api/wx/login", { code });
            this.setSession(r.token, r.profile);
            resolve({ needs_profile: r.needs_profile });
          } catch (e) {
            reject(e);
          }
        },
        fail: reject,
      });
    });
  },

  setSession(token, profile) {
    this.globalData.token = token;
    this.globalData.profile = profile || null;
    wx.setStorageSync("tlr_token", token);
    wx.setStorageSync("tlr_profile", profile || null);
  },

  setProfile(profile) {
    this.globalData.profile = profile;
    wx.setStorageSync("tlr_profile", profile);
  },

  loggedIn() {
    return !!this.globalData.token;
  },

  logout() {
    this.globalData.token = "";
    this.globalData.profile = null;
    wx.removeStorageSync("tlr_token");
    wx.removeStorageSync("tlr_profile");
  },

  /** 确保已登录：未登录则触发微信登录。返回 Promise<boolean 是否新用户需完善资料> */
  async ensureLogin() {
    if (this.loggedIn()) return false;
    const { needs_profile } = await this.login();
    return needs_profile;
  },
});
