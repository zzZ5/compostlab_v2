App({
  globalData: {
    apiBase: "https://compostlab-backend-v2.cpolar.cn/api/v2",
    user: null,
  },

  onLaunch() {
    this.globalData.user = wx.getStorageSync("user") || null;
  },
});
