const { request, clearAuth, requireLogin } = require("../../utils/request");

function getInitial(user) {
  const name = (user && (user.real_name || user.username)) || "U";
  return String(name).slice(0, 1).toUpperCase();
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    displayName: user.real_name || user.username,
    roleText: user.role_display || user.role || "Unknown",
    departmentText: user.department || "Not set",
  };
}

Page({
  data: {
    user: null,
    initial: "U",
  },

  onLoad() {
    if (!requireLogin()) return;
    this.loadMe();
  },

  async loadMe() {
    try {
      const user = normalizeUser(await request({ url: "/auth/me" }));
      wx.setStorageSync("user", user);
      this.setData({ user, initial: getInitial(user) });
    } catch (err) {
      const user = normalizeUser(wx.getStorageSync("user") || null);
      this.setData({ user, initial: getInitial(user) });
    }
  },

  logout() {
    clearAuth();
    wx.redirectTo({ url: "/pages/login/index" });
  },
});
