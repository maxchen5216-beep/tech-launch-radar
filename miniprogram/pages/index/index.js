const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

const CATS = [
  { key: "all", label: "全部" },
  { key: "consumer", label: "消费电子" },
  { key: "ai_dev", label: "AI·开发者" },
  { key: "expo", label: "行业展会" },
  { key: "gaming_auto", label: "游戏·汽车" },
  { key: "frontier", label: "前沿科技" },
];

Page({
  data: {
    cats: CATS,
    activeCat: "all",
    keyword: "",
    loading: true,
    list: [],     // 经过筛选后的展示列表
    all: [],      // 全量（已附 _live/_past/标签文案）
    updated: "",
  },

  onLoad() {
    this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents(() => wx.stopPullDownRefresh());
  },

  loadEvents(done) {
    this.setData({ loading: true });
    api.get("/api/events").then((r) => {
      const all = (r.events || [])
        .map((e) => ({
          ...e,
          _live: util.isLive(e),
          _past: util.isPast(e),
          _statusText: util.STATUS_TEXT[e.status] || e.status,
          _catText: util.CAT_TEXT[e.category] || e.category,
        }))
        .sort((a, b) => (a.date_sort < b.date_sort ? -1 : 1));
      this.setData({ all, loading: false });
      this.applyFilter();
      done && done();
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: "加载失败", icon: "none" });
      done && done();
    });
  },

  onCat(e) {
    this.setData({ activeCat: e.currentTarget.dataset.key });
    this.applyFilter();
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  applyFilter() {
    const { all, activeCat, keyword } = this.data;
    const q = keyword.trim().toLowerCase();
    const list = all.filter((e) => {
      if (activeCat !== "all" && e.category !== activeCat) return false;
      if (q && (e.name_zh + e.name_en + (e.organizer || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    this.setData({ list });
  },

  goDetail(e) {
    wx.navigateTo({ url: "/pages/detail/detail?id=" + e.currentTarget.dataset.id });
  },

  openLive(e) {
    const url = e.currentTarget.dataset.url;
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: "直播链接已复制", icon: "none" }) });
  },
});
