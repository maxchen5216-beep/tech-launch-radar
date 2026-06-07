// wx.request 封装：自动带 JWT、统一错误处理、Promise 化。
const { API_BASE } = require("../config.js");

function getToken() {
  return wx.getStorageSync("tlr_token") || "";
}

function request(path, { method = "GET", data = null, auth = false } = {}) {
  return new Promise((resolve, reject) => {
    const header = { "Content-Type": "application/json" };
    if (auth) {
      const t = getToken();
      if (t) header["Authorization"] = "Bearer " + t;
    }
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode === 401) {
          // 登录态失效：清掉本地，交由页面引导重新登录
          wx.removeStorageSync("tlr_token");
          wx.removeStorageSync("tlr_profile");
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(res.data || { error: "http_" + res.statusCode });
      },
      fail() {
        reject({ error: "network", message: "网络异常，请稍后再试" });
      },
    });
  });
}

module.exports = {
  get: (p, opts) => request(p, { ...opts, method: "GET" }),
  post: (p, data, opts) => request(p, { ...opts, method: "POST", data }),
  del: (p, opts) => request(p, { ...opts, method: "DELETE" }),
  getToken,
};
