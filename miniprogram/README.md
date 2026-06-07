# 下一场发布会 · 微信小程序

原生小程序前端，**复用网页版同一后端**（`../server/`，数据互通）。网页版代码完全独立、不受影响。

## 目录

```
miniprogram/
  app.js / app.json / app.wxss   # 入口、全局配置、主题
  config.js                       # ⚠️ 后端地址 + 订阅消息模板ID（按环境改）
  project.config.json             # ⚠️ 填入你的小程序 AppID
  utils/api.js                    # wx.request 封装（带 JWT）
  utils/util.js                   # 头像/日期/状态 工具
  pages/index      时间线列表（分类筛选 + 搜索 + 进行中直播）
  pages/detail     事件详情 + 订阅(微信订阅消息) + 评论
  pages/reminders  我的提醒
  pages/profile    微信登录 + 昵称/头像 + 退出/注销
```

## 本地开发（备案前）

1. 微信开发者工具 → 导入项目，目录选 `miniprogram/`，填入 **AppID**（个人主体注册后获得）
2. `project.config.json` 的 `appid` 与 `config.js` 的 `API_BASE` 确认无误
3. 开发者工具 → 详情 → 本地设置 → 勾选 **不校验合法域名**（备案前对着 `http://121.40.54.69` 调试）
4. 后端需配 `WX_APPID` / `WX_SECRET`（否则 `/api/wx/login` 返回 503）

## 上线前必改

- `config.js` 的 `API_BASE` → `https://nextlaunch.cn`（ICP 备案 + HTTPS 完成后）
- mp 后台「request 合法域名」配置 `https://nextlaunch.cn`
- 申请订阅消息模板 →把 template_id 填到 `config.js` 的 `SUBSCRIBE_TEMPLATE_ID` 和后端 `WX_TEMPLATE_ID`，并核对订阅消息字段（后端 `scan-reminders.ts` 的 `data` key 需与模板一致）
- 取消开发者工具的「不校验合法域名」

## 与网页版的关系

- 同一后端、同一数据库：评论/事件互通；用户分两种登录态（网页 email / 小程序 openid），各自独立账号
- 后端微信相关代码集中在 `../server/src/wx.ts`，其余文件仅做了向后兼容的追加改动
