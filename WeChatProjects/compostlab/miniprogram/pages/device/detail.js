const { request, requireLogin } = require("../../utils/request");
const { fmtValue, channelTitle, onlineState } = require("../../utils/format");

function normalizeChannel(channel) {
  const latest = channel.latest || null;
  return {
    ...channel,
    title: channelTitle(channel),
    valueText: latest ? fmtValue(latest.value, latest.unit || channel.unit) : "--",
    tsText: latest && latest.ts ? latest.ts : "No time",
    metricText: channel.metric || "Unclassified",
  };
}

Page({
  data: {
    id: null,
    loading: false,
    device: null,
    channels: [],
    canControl: false,
  },

  onLoad(query) {
    if (!requireLogin()) return;
    const user = wx.getStorageSync("user") || {};
    this.setData({
      id: Number(query.id),
      canControl: user.role === "operator" || user.role === "admin" || user.is_superuser,
    });
    this.loadDevice();
  },

  onPullDownRefresh() {
    this.loadDevice();
  },

  async loadDevice() {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      const device = await request({ url: `/devices/${this.data.id}` });
      const latest = await request({ url: `/devices/${this.data.id}/latest` });
      const latestMap = {};
      (latest.data || []).forEach((item) => {
        latestMap[item.code] = item;
      });

      const channelsResp = await request({ url: `/devices/${this.data.id}/channels` });
      const rawChannels = channelsResp.data || [];
      const state = onlineState(device.last_seen_at);
      const channels = rawChannels.map((channel) =>
        normalizeChannel({
          ...channel,
          latest: latestMap[channel.code] || null,
        })
      );

      this.setData({
        device: {
          ...device,
          displayName: device.name || device.code,
          stateText: state.text,
          stateClass: state.className,
          lastSeenText: device.last_seen_at || "No data",
          ipText: device.ip_address || "No data",
        },
        channels,
      });
    } catch (err) {
      wx.showToast({ title: "Load device failed", icon: "none" });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  openControl() {
    if (!this.data.canControl) {
      wx.showToast({ title: "No control permission", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/device/control?id=${this.data.id}` });
  },
});
