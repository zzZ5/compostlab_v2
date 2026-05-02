Page({
  onLoad() {
    const token = wx.getStorageSync("access_token");
    wx.redirectTo({
      url: token ? "/pages/dashboard/index" : "/pages/login/index",
    });
  },
});
