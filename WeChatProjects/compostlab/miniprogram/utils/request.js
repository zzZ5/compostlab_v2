const API_BASE = "https://compostlab-backend-v2.cpolar.cn/api/v2";

function getAccessToken() {
  return wx.getStorageSync("access_token") || "";
}

function getRefreshToken() {
  return wx.getStorageSync("refresh_token") || "";
}

function setTokens(access, refresh) {
  if (access) wx.setStorageSync("access_token", access);
  if (refresh) wx.setStorageSync("refresh_token", refresh);
}

function clearAuth() {
  wx.removeStorageSync("access_token");
  wx.removeStorageSync("refresh_token");
  wx.removeStorageSync("user");
}

function redirectToLogin() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  const route = current ? `/${current.route}` : "/pages/dashboard/index";
  wx.redirectTo({
    url: `/pages/login/index?next=${encodeURIComponent(route)}`,
  });
}

function errorMessage(err, fallback) {
  if (err && err.data) {
    if (typeof err.data === "string") return err.data;
    if (typeof err.data.detail === "string") return err.data.detail;
    if (typeof err.data.message === "string") return err.data.message;
  }
  if (err && err.errMsg) return err.errMsg;
  return fallback || "Request failed";
}

function requestRaw(options) {
  const token = getAccessToken();

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      timeout: options.timeout || 20000,
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(res);
      },
      fail: reject,
    });
  });
}

async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  const data = await new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}/auth/refresh`,
      method: "POST",
      data: { refresh },
      timeout: 15000,
      header: { "Content-Type": "application/json" },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(res);
      },
      fail: reject,
    });
  });

  if (data && data.access) {
    setTokens(data.access, refresh);
    return data.access;
  }
  return null;
}

async function request(options) {
  try {
    return await requestRaw(options);
  } catch (err) {
    if (err && err.statusCode === 401 && !options.skipRefresh) {
      try {
        const token = await refreshAccessToken();
        if (token) return await requestRaw({ ...options, skipRefresh: true });
      } catch (refreshErr) {
        clearAuth();
        redirectToLogin();
        throw refreshErr;
      }
      clearAuth();
      redirectToLogin();
    }
    throw err;
  }
}

function requireLogin() {
  if (!getAccessToken() && !getRefreshToken()) {
    redirectToLogin();
    return false;
  }
  return true;
}

module.exports = {
  API_BASE,
  request,
  setTokens,
  clearAuth,
  requireLogin,
  errorMessage,
};
