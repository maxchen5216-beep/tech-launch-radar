// 卡通预设头像（与网页版一致）
const PRESETS = ["🤖", "🚀", "👾", "🛸", "📡", "🦾", "🛰️", "⚡"];
const PRESET_BG = ["#0e2a22", "#1a2233", "#251a33", "#10262e", "#2a2114", "#1c2a17", "#22182a", "#2a1a17"];
const { API_BASE } = require("../config.js");

/** 把 avatar 字段解析为可渲染对象：{ type:'emoji'|'img', value, bg } */
function parseAvatar(avatar) {
  if (avatar && avatar.indexOf("u:") === 0) {
    return { type: "img", value: API_BASE + "/avatars/" + avatar.slice(2) };
  }
  let idx = 0;
  if (avatar && avatar.indexOf("p:") === 0) idx = parseInt(avatar.slice(2), 10) % PRESETS.length;
  if (isNaN(idx)) idx = 0;
  return { type: "emoji", value: PRESETS[idx], bg: PRESET_BG[idx] };
}

/** 今天 YYYY-MM-DD（本地） */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** 事件是否进行中：今天在 [date_sort, date_end] 内 */
function isLive(e) {
  const t = todayStr();
  const end = e.date_end || e.date_sort;
  return e.date_sort <= t && t <= end;
}

/** 是否已过期（结束日 < 今天） */
function isPast(e) {
  return (e.date_end || e.date_sort) < todayStr();
}

const STATUS_TEXT = { confirmed: "官方确认", expected: "预计", rumored: "传闻" };
const CAT_TEXT = { consumer: "消费电子", ai_software: "AI·软件", expo: "行业展会", gaming: "游戏", auto: "智能汽车", frontier: "前沿科技", quiet_launch: "悄悄新品", recap: "往期总结" };

module.exports = { PRESETS, PRESET_BG, parseAvatar, todayStr, isLive, isPast, STATUS_TEXT, CAT_TEXT };
