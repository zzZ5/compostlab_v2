function fmtValue(value, unit) {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  const text = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(value);
  return unit ? `${text} ${unit}` : text;
}

function channelTitle(channel) {
  if (!channel) return "";
  return channel.display_name || channel.name || channel.code || "";
}

function onlineState(lastSeen) {
  if (!lastSeen) return { text: "Unknown", className: "state-unknown" };
  const parsed = new Date(String(lastSeen).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return { text: "Unknown", className: "state-unknown" };

  const diffMin = (Date.now() - parsed.getTime()) / 60000;
  if (diffMin <= 5) return { text: "Online", className: "state-online" };
  if (diffMin <= 30) return { text: "Idle", className: "state-idle" };
  return { text: "Offline", className: "state-offline" };
}

function summarizeDevice(device) {
  const channels = device.channels || [];
  const featured = channels
    .filter((channel) => channel.latest)
    .slice(0, 4)
    .map((channel) => ({
      code: channel.code,
      name: channelTitle(channel),
      valueText: fmtValue(channel.latest.value, channel.latest.unit || channel.unit),
      ts: channel.latest.ts || "",
    }));

  const state = onlineState(device.last_seen_at);

  return {
    ...device,
    displayName: device.name || device.code,
    stateText: state.text,
    stateClass: state.className,
    featured,
    lastSeenText: device.last_seen_at || "No data",
  };
}

module.exports = {
  fmtValue,
  channelTitle,
  onlineState,
  summarizeDevice,
};
