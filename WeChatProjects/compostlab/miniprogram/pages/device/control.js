const { request, requireLogin } = require("../../utils/request");

Page({
  data: {
    id: null,
    loading: false,
    command: "aeration",
    commandLabel: "Aeration",
    action: "on",
    actionLabel: "On",
    duration: "60000",
    jsonText: "{\n  \"commands\": [\n    { \"command\": \"aeration\", \"action\": \"on\", \"duration_ms\": 60000 }\n  ]\n}",
    commandOptions: [
      { value: "aeration", label: "Aeration" },
      { value: "pump", label: "Pump" },
      { value: "heater", label: "Heater" },
      { value: "exhaust", label: "Exhaust" },
      { value: "restart", label: "Restart" },
    ],
    actionOptions: [
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
  },

  onLoad(query) {
    if (!requireLogin()) return;
    const user = wx.getStorageSync("user") || {};
    const canControl = user.role === "operator" || user.role === "admin" || user.is_superuser;
    if (!canControl) {
      wx.showToast({ title: "No control permission", icon: "none" });
      wx.navigateBack();
      return;
    }
    this.setData({ id: Number(query.id) });
  },

  onCommandChange(e) {
    const item = this.data.commandOptions[e.detail.value];
    this.setData({ command: item.value, commandLabel: item.label });
  },

  onActionChange(e) {
    const item = this.data.actionOptions[e.detail.value];
    this.setData({ action: item.value, actionLabel: item.label });
  },

  onDurationInput(e) {
    this.setData({ duration: e.detail.value });
  },

  onJsonInput(e) {
    this.setData({ jsonText: e.detail.value });
  },

  async sendQuickCommand() {
    const command = this.data.command;
    const action = this.data.action;
    const duration = Number(this.data.duration);
    const item = { command };

    if (command !== "restart") item.action = action;
    if (Number.isFinite(duration) && duration > 0 && action === "on") item.duration_ms = duration;

    await this.sendCommands([item]);
  },

  async sendCustomCommand() {
    try {
      const parsed = JSON.parse(this.data.jsonText);
      if (!parsed || !Array.isArray(parsed.commands) || parsed.commands.length === 0) {
        wx.showToast({ title: "commands must be a non-empty array", icon: "none" });
        return;
      }
      await this.sendCommands(parsed.commands);
    } catch (err) {
      wx.showToast({ title: "Invalid JSON", icon: "none" });
    }
  },

  async sendCommands(commands) {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      await request({
        url: `/devices/${this.data.id}/commands`,
        method: "POST",
        data: { commands },
        timeout: 30000,
      });
      wx.showToast({ title: "Command sent", icon: "success" });
    } catch (err) {
      const msg = (err && err.data && err.data.detail) || "Send failed";
      wx.showToast({ title: msg, icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
