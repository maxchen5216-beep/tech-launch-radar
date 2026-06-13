// 后端接口地址。
// 开发：用微信开发者工具「详情 → 本地设置 → 不校验合法域名」对着服务器 IP 调试。
// 上线：必须改为已 ICP 备案 + HTTPS 的正式域名，并在 mp 后台「request 合法域名」里配置。
module.exports = {
  // 开发期（备案前，开发者工具免校验域名）：
  API_BASE: "http://121.40.54.69",
  // 备案+HTTPS 后改为：
  // API_BASE: "https://fabushike.com",

  // 订阅消息模板 ID（在 mp 后台「订阅消息」申请「活动提醒」模板后填入；与后端 WX_TEMPLATE_ID 一致）
  SUBSCRIBE_TEMPLATE_ID: "",
};
