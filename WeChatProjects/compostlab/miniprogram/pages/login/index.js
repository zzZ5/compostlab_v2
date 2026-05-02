const { request, setTokens, errorMessage } = require("../../utils/request");

Page({
  data: {
    username: "",
    password: "",
    loading: false,
    next: "/pages/dashboard/index",
  },

  onLoad(query) {
    if (query && query.next) {
      this.setData({ next: decodeURIComponent(query.next) });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  async onLogin() {
    const username = this.data.username.trim();
    const password = this.data.password;
    if (!username || !password) {
      wx.showToast({ title: "Enter account and password", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    try {
      const data = await request({
        url: "/auth/login",
        method: "POST",
        data: { username, password },
        skipRefresh: true,
      });

      setTokens(data.access, data.refresh);
      wx.setStorageSync("user", data.user);

      wx.showToast({ title: "Signed in", icon: "success" });
      wx.redirectTo({ url: this.data.next || "/pages/dashboard/index" });
    } catch (err) {
      wx.showToast({ title: errorMessage(err, "Sign in failed"), icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
