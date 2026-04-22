import { evalO2, evalTemp, type Sev } from "@/lib/alerts";
import { detectChannelMetric } from "@/lib/metrics";

export type DeviceProfile = "cp500-v3" | "smart-compost" | "mmcgs" | "generic";
export type OnlineState = "online" | "idle" | "offline" | "unknown";

function textParts(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value && typeof value === "object" && !Array.isArray(value)) return Object.values(value).filter((item): item is string => typeof item === "string");
	return [];
}

function allText(...values: unknown[]): string {
	return values.flatMap(textParts).join(" ").toLowerCase();
}

export function inferDeviceProfile(device: any): DeviceProfile {
	const text = allText(
		device?.code,
		device?.name,
		device?.meta?.profile,
		device?.meta?.model,
		device?.meta?.device_type,
		device?.configuration,
	);
	const channelCodes = new Set((device?.channels || []).map((channel: any) => String(channel?.code || "").toLowerCase()));

	if (text.includes("mmcgs") || channelCodes.has("point1") || channelCodes.has("point2") || channelCodes.has("purge")) {
		return "mmcgs";
	}
	if (text.includes("cp500") || channelCodes.has("tempin") || channelCodes.has("tanktemp") || channelCodes.has("heater") || channelCodes.has("aeration")) {
		return "cp500-v3";
	}
	if (text.includes("smartcompost") || text.includes("smart-compost") || channelCodes.has("roomtemp") || channelCodes.has("airtemp") || channelCodes.has("airhumidity")) {
		return "smart-compost";
	}
	return "generic";
}

export function getProfileOnlineState(lastSeen: string | null | undefined, profile: DeviceProfile): OnlineState {
	if (!lastSeen) return "unknown";
	const parsed = new Date(String(lastSeen).replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) return "unknown";

	const diffMin = (Date.now() - parsed.getTime()) / 60000;

	if (profile === "mmcgs") {
		if (diffMin <= 30) return "online";
		if (diffMin <= 180) return "idle";
		return "offline";
	}
	if (profile === "cp500-v3") {
		if (diffMin <= 20) return "online";
		if (diffMin <= 120) return "idle";
		return "offline";
	}
	if (profile === "smart-compost") {
		if (diffMin <= 20) return "online";
		if (diffMin <= 90) return "idle";
		return "offline";
	}
	if (diffMin <= 15) return "online";
	if (diffMin <= 60) return "idle";
	return "offline";
}

function latestNumber(channel: any): number | null {
	const raw = channel?.latest?.value;
	if (typeof raw === "number") return raw;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

function maxLatest(channels: any[]): number | null {
	let best: number | null = null;
	for (const channel of channels || []) {
		const value = latestNumber(channel);
		if (value === null) continue;
		best = best === null ? value : Math.max(best, value);
	}
	return best;
}

function minLatest(channels: any[]): number | null {
	let best: number | null = null;
	for (const channel of channels || []) {
		const value = latestNumber(channel);
		if (value === null) continue;
		best = best === null ? value : Math.min(best, value);
	}
	return best;
}

function findChannelsByCodes(channels: any[], codes: string[]): any[] {
	const wanted = new Set(codes.map((code) => code.toLowerCase()));
	return (channels || []).filter((channel) => wanted.has(String(channel?.code || "").toLowerCase()));
}

function severityRank(sev: Sev | "none") {
	if (sev === "danger") return 3;
	if (sev === "warn") return 2;
	if (sev === "ok") return 1;
	return 0;
}

function combineSeverity(a: Sev | "none", b: Sev | "none"): Sev | "none" {
	const rank = Math.max(severityRank(a), severityRank(b));
	return rank === 3 ? "danger" : rank === 2 ? "warn" : rank === 1 ? "ok" : "none";
}

function getAlertSourceChannels(device: any) {
	const channels = device?.channels || [];
	const profile = inferDeviceProfile(device);
	const allTempChannels = channels.filter((channel: any) => detectChannelMetric(channel) === "temperature");
	const allO2Channels = channels.filter((channel: any) => detectChannelMetric(channel) === "o2");

	if (profile === "cp500-v3") {
		const tempChannels = findChannelsByCodes(channels, ["TempIn"]);
		return { tempChannels: tempChannels.length ? tempChannels : allTempChannels, o2Channels: [] };
	}

	if (profile === "smart-compost") {
		const tempChannels = findChannelsByCodes(channels, ["AirTemp", "RoomTemp"]);
		const o2Channels = findChannelsByCodes(channels, ["O2"]);
		return {
			tempChannels: tempChannels.length ? tempChannels : allTempChannels,
			o2Channels: o2Channels.length ? o2Channels : allO2Channels,
		};
	}

	if (profile === "mmcgs") {
		const tempChannels = channels.filter((channel: any) => {
			const code = String(channel?.code || "").toLowerCase();
			const metric = detectChannelMetric(channel);
			return metric === "temperature" && (code === "airtemp" || code === "temp");
		});
		const o2Channels = channels.filter((channel: any) => {
			const code = String(channel?.code || "").toLowerCase();
			return detectChannelMetric(channel) === "o2" || code === "o2";
		});
		return {
			tempChannels: tempChannels.length ? tempChannels : allTempChannels,
			o2Channels: o2Channels.length ? o2Channels : allO2Channels,
		};
	}

	return { tempChannels: allTempChannels, o2Channels: allO2Channels };
}

export function getDeviceAlertSummary(device: any) {
	const { tempChannels, o2Channels } = getAlertSourceChannels(device);
	const maxTemp = maxLatest(tempChannels);
	const minO2 = minLatest(o2Channels);
	const profile = inferDeviceProfile(device);
	const hasTempSignal = tempChannels.length > 0;
	const hasO2Signal = o2Channels.length > 0;
	const tempAlert = hasTempSignal ? evalTemp(maxTemp) : { sev: "none" as const, tip: "无温度数据" };
	const o2Alert = hasO2Signal ? evalO2(minO2) : { sev: "none" as const, tip: "无氧气数据" };

	let overall: Sev | "none" = "none";
	if (profile === "cp500-v3") {
		overall = tempAlert.sev;
	} else if (profile === "smart-compost" || profile === "mmcgs") {
		overall = combineSeverity(tempAlert.sev, o2Alert.sev);
	} else if (hasTempSignal || hasO2Signal) {
		overall = combineSeverity(tempAlert.sev, o2Alert.sev);
	}

	return {
		tempAlert,
		o2Alert,
		overall,
		maxTemp,
		minO2,
		tempChannels,
		o2Channels,
	};
}
