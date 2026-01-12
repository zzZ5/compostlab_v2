export type OnlineState = "online" | "idle" | "offline" | "unknown";

export function getOnlineState(lastSeen?: string | null): OnlineState {
	if (!lastSeen) return "unknown";
	// 后端时间是 "YYYY-MM-DD HH:mm:ss"
	const t = new Date(lastSeen.replace(" ", "T"));
	if (Number.isNaN(t.getTime())) return "unknown";

	const diffMs = Date.now() - t.getTime();
	const diffMin = diffMs / 60000;

	// 约束：15分钟内有数据视为 Online
	if (diffMin <= 15) return "online";
	if (diffMin <= 60) return "idle";
	return "offline";
}

export function onlineTag(s: OnlineState) {
	if (s === "online") return { color: "green", text: "Online" };
	if (s === "idle") return { color: "gold", text: "Idle" };
	if (s === "offline") return { color: "red", text: "Offline" };
	return { color: "default", text: "Unknown" };
}