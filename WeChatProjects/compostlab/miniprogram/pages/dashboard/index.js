const { request, requireLogin } = require("../../utils/request");
const { summarizeDevice } = require("../../utils/format");

Page({
  data: {
    loading: false,
    devices: [],
    total: 0,
    q: "",
    hasLoaded: false,
  },

  onLoad() {
    if (!requireLogin()) return;
    this.loadDevices();
  },

  onShow() {
    if (this.data.hasLoaded && wx.getStorageSync("access_token")) {
      this.loadDevices(false);
    }
  },

  onPullDownRefresh() {
    this.loadDevices(true);
  },

  onSearchInput(e) {
    this.setData({ q: e.detail.value });
  },

  onSearch() {
    this.loadDevices(true);
  },

  async loadDevices(showLoading = true) {
    if (showLoading) this.setData({ loading: true });
    try {
      const q = this.data.q.trim();
      const qs = q ? `&q=${encodeURIComponent(q)}` : "";
      const data = await request({
        url: `/devices/tree?with_latest=1&page=1&page_size=100${qs}`,
      });
      const devices = (data.data || []).map(summarizeDevice);
      this.setData({
        devices,
        total: data.count || devices.length,
        hasLoaded: true,
      });
    } catch (err) {
      wx.showToast({ title: "Load devices failed", icon: "none" });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  openDevice(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/device/detail?id=${id}` });
  },

  openProfile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
});
