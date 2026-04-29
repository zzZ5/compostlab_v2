"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, Col, Grid, Input, Popover, Row, Select, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { ExclamationCircleOutlined, InfoCircleOutlined } from "@ant-design/icons";

import Page from "@/components/Page";
import { useDevicesTree } from "@/features/devices/queries";
import { useRuns } from "@/features/runs/queries";
import { api } from "@/lib/api";
import { evalO2, evalTemp, sevToColor } from "@/lib/alerts";
import { groupChannelsByMetric, sortChannels } from "@/lib/channelGroups";
import {
	getDeviceAlertSummary as resolveDeviceAlertSummary,
	getProfileOnlineState as resolveProfileOnlineState,
	inferDeviceProfile as resolveDeviceProfile,
} from "@/lib/deviceRules";
import { detectChannelMetric, getChannelDisplayName, metricLabel, type MetricKey } from "@/lib/metrics";
import { onlineTag } from "@/lib/status";

const { Text } = Typography;
const { useBreakpoint } = Grid;

type DeviceProfile = "cp500-v3" | "smart-compost" | "mmcgs" | "generic";

type DashboardDevice = {
	device_id: number;
	code?: string | null;
	name?: string | null;
	last_seen_at?: string | null;
	channels?: any[];
	meta?: Record<string, unknown> | null;
	configuration?: Record<string, unknown> | null;
	dashboard_members: any[];
	dashboard_profile: DeviceProfile;
	dashboard_is_mmcgs_group: boolean;
	dashboard_controller_code?: string;
	dashboard_points?: any[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getTextTokens(...values: unknown[]): string {
	return values
		.flatMap((value) => {
			if (typeof value === "string") return [value];
			if (value && typeof value === "object" && !Array.isArray(value)) return Object.values(value);
			return [];
		})
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
}

function inferDeviceProfile(device: any): DeviceProfile {
	const meta = asRecord(device?.meta);
	const text = getTextTokens(
		device?.code,
		device?.name,
		meta?.profile,
		meta?.model,
		meta?.device_type,
		device?.configuration,
	);
	const channelCodes = new Set((device?.channels || []).map((channel: any) => String(channel.code || "").toLowerCase()));

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

function getMmcgsControllerCode(code: string | null | undefined): string {
	if (!code) return "";
	return String(code).replace(/-P\d+$/i, "");
}

function getMmcgsPointIndex(code: string | null | undefined): number | null {
	if (!code) return null;
	const match = String(code).match(/-P(\d+)$/i);
	return match ? Number(match[1]) : null;
}

function isMmcgsDevice(device: any): boolean {
	return inferDeviceProfile(device) === "mmcgs";
}

function getLastSeenMs(lastSeen?: string | null): number | null {
	if (!lastSeen) return null;
	const parsed = new Date(String(lastSeen).replace(" ", "T"));
	return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function pickLatestLastSeen(devices: any[]): string | null {
	let best: { ms: number; value: string } | null = null;
	for (const device of devices || []) {
		const lastSeen = typeof device?.last_seen_at === "string" ? device.last_seen_at : null;
		const ms = getLastSeenMs(lastSeen);
		if (lastSeen && ms !== null && (!best || ms > best.ms)) {
			best = { ms, value: lastSeen };
		}
	}
	return best?.value ?? null;
}

function buildDashboardDevices(devices: any[]): DashboardDevice[] {
	const mmcgsGroups = new Map<string, any[]>();
	const normalDevices: DashboardDevice[] = [];

	for (const device of devices || []) {
		if (!isMmcgsDevice(device)) {
			normalDevices.push({
				...device,
				dashboard_members: [device],
				dashboard_profile: resolveDeviceProfile(device),
				dashboard_is_mmcgs_group: false,
			});
			continue;
		}
		const controllerCode = getMmcgsControllerCode(device?.code);
		if (!controllerCode) {
			normalDevices.push({
				...device,
				dashboard_members: [device],
				dashboard_profile: "mmcgs",
				dashboard_is_mmcgs_group: false,
			});
			continue;
		}
		if (!mmcgsGroups.has(controllerCode)) mmcgsGroups.set(controllerCode, []);
		mmcgsGroups.get(controllerCode)!.push(device);
	}

	const groupedDevices = Array.from(mmcgsGroups.entries()).map(([controllerCode, group]) => {
		const controller =
			group.find((item) => getMmcgsPointIndex(item?.code) === null) ||
			group.slice().sort((a, b) => Number(a?.device_id || 0) - Number(b?.device_id || 0))[0];
		const points = group
			.filter((item) => getMmcgsPointIndex(item?.code) !== null)
			.sort((a, b) => (getMmcgsPointIndex(a?.code) || 0) - (getMmcgsPointIndex(b?.code) || 0));

		const mergedChannels = group.flatMap((member) => {
			const pointIndex = getMmcgsPointIndex(member?.code);
			const pointPrefix = pointIndex ? `P${pointIndex}` : null;
			return (member?.channels || []).map((channel: any) => {
				if (!pointPrefix) return channel;
				const displayName = getChannelDisplayName(channel);
				return {
					...channel,
					display_name: `${pointPrefix} ${displayName}`,
					_dashboard_source_device_id: member.device_id,
				};
			});
		});

		return {
			...controller,
			code: controllerCode,
			name: controller?.name || controllerCode,
			last_seen_at: pickLatestLastSeen(group),
			channels: mergedChannels,
			dashboard_members: group,
			dashboard_profile: "mmcgs" as DeviceProfile,
			dashboard_is_mmcgs_group: true,
			dashboard_controller_code: controllerCode,
			dashboard_points: points,
		} satisfies DashboardDevice;
	});

	return [...normalDevices, ...groupedDevices].sort((a, b) => Number(a.device_id || 0) - Number(b.device_id || 0));
}

function sevRank(sev: "danger" | "warn" | "ok" | "none") {
	if (sev === "danger") return 3;
	if (sev === "warn") return 2;
	if (sev === "ok") return 1;
	return 0;
}

function overallSev(tempSev: "danger" | "warn" | "ok" | "none", o2Sev: "danger" | "warn" | "ok" | "none"): "danger" | "warn" | "ok" | "none" {
	const rank = Math.max(sevRank(tempSev), sevRank(o2Sev));
	return rank === 3 ? "danger" : rank === 2 ? "warn" : rank === 1 ? "ok" : "none";
}

function getProfileOnlineState(lastSeen: string | null | undefined, profile: DeviceProfile): "online" | "idle" | "offline" | "unknown" {
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

function getQualityInfo(channel: any): { quality: string; color: string; isBad: boolean } {
	if (!channel?.latest) return { quality: "NO DATA", color: "default", isBad: true };
	const quality = String(channel.latest.quality || channel.latest.quality_flag || "OK").toUpperCase();
	if (quality === "OK") return { quality: "OK", color: "green", isBad: false };
	if (quality === "WARN" || quality === "WARNING") return { quality: "WARN", color: "orange", isBad: true };
	if (quality === "BAD" || quality === "ERROR" || quality === "ERR") return { quality, color: "red", isBad: true };
	return { quality, color: "default", isBad: false };
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

function getAlertSourceChannels(device: DashboardDevice) {
	const channels = device.channels || [];
	const profile = device.dashboard_profile;

	const allTempChannels = channels.filter((channel: any) => detectChannelMetric(channel) === "temperature");
	const allO2Channels = channels.filter((channel: any) => detectChannelMetric(channel) === "o2");

	if (profile === "cp500-v3") {
		const tempChannels = findChannelsByCodes(channels, ["TempIn"]);
		const o2Channels = findChannelsByCodes(channels, ["O2"]);
		return {
			tempChannels: tempChannels.length ? tempChannels : allTempChannels,
			o2Channels: o2Channels.length ? o2Channels : allO2Channels,
		};
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
			return metric === "temperature" && (code === "airtemp" || code === "temp" || code.endsWith(":airtemp") || code.endsWith(":temp"));
		});
		const o2Channels = channels.filter((channel: any) => {
			const code = String(channel?.code || "").toLowerCase();
			return detectChannelMetric(channel) === "o2" || code === "o2" || code.endsWith(":o2");
		});
		return {
			tempChannels: tempChannels.length ? tempChannels : allTempChannels,
			o2Channels: o2Channels.length ? o2Channels : allO2Channels,
		};
	}

	return { tempChannels: allTempChannels, o2Channels: allO2Channels };
}

function getAlertSummary(device: DashboardDevice) {
	const { tempChannels, o2Channels } = getAlertSourceChannels(device);
	const validTempChannels = tempChannels.filter((channel) => !getQualityInfo(channel).isBad);
	const validO2Channels = o2Channels.filter((channel) => !getQualityInfo(channel).isBad);

	const maxTemp = maxLatest(validTempChannels.length ? validTempChannels : tempChannels);
	const minO2 = minLatest(validO2Channels.length ? validO2Channels : o2Channels);

	const profile = device.dashboard_profile;
	const hasTempSignal = tempChannels.length > 0;
	const hasO2Signal = o2Channels.length > 0;
	const tempAlert = hasTempSignal ? evalTemp(maxTemp) : { sev: "none" as const, tip: "无温度数据" };
	const o2Alert = hasO2Signal ? evalO2(minO2) : { sev: "none" as const, tip: "无氧气数据" };

	let overall: "danger" | "warn" | "ok" | "none" = "none";
	if (profile === "cp500-v3") {
		overall = tempAlert.sev;
	} else if (profile === "smart-compost" || profile === "mmcgs") {
		overall = overallSev(tempAlert.sev, o2Alert.sev);
	} else if (hasTempSignal || hasO2Signal) {
		overall = overallSev(tempAlert.sev, o2Alert.sev);
	}

	return {
		tempChannels,
		o2Channels,
		maxTemp,
		minO2,
		tempAlert,
		o2Alert,
		overall,
	};
}

function getChannelByCodes(device: any, codes: string[]) {
	const wanted = new Set(codes.map((code) => code.toLowerCase()));
	return (device?.channels || []).find((channel: any) => wanted.has(String(channel?.code || "").toLowerCase())) || null;
}

function formatChannelValue(channel: any): string {
	if (!channel?.latest) return "-";
	const value = channel.latest.value;
	return `${value ?? "-"}${channel?.unit ? ` ${channel.unit}` : ""}`;
}

function compactChannelValue(channel: any): string {
	if (!channel?.latest) return "-";
	const value = channel.latest.value;
	const unit = String(channel?.unit || "").trim();
	if (!unit) {
		const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
		if (normalized === 1 || normalized === "1" || normalized === true || normalized === "true" || normalized === "on") return "开";
		if (normalized === 0 || normalized === "0" || normalized === false || normalized === "false" || normalized === "off") return "关";
		return String(value ?? "-");
	}
	if (unit === "℃") return `${value}°C`;
	return `${value}${unit}`;
}

function formatSwitchChannelValue(channel: any): string {
	if (!channel?.latest) return "-";
	const raw = channel.latest.value;
	const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
	if (normalized === 1 || normalized === "1" || normalized === true || normalized === "true" || normalized === "on") return "开";
	if (normalized === 0 || normalized === "0" || normalized === false || normalized === "false" || normalized === "off") return "关";
	return compactChannelValue(channel);
}

function getPointSummaryItems(device: any) {
	const tempChannel = getChannelByCodes(device, ["AirTemp", "Temp"]);
	const o2Channel = getChannelByCodes(device, ["O2"]);
	const co2Channel = getChannelByCodes(device, ["CO2"]);

	return [
		{ label: "温度", value: compactChannelValue(tempChannel) },
		{ label: "O2", value: compactChannelValue(o2Channel) },
		{ label: "CO2", value: compactChannelValue(co2Channel) },
	];
}

function getPointDetailItems(device: any) {
	const channels = device?.channels || [];
	const preferredCodes = ["AirTemp", "Temp", "O2", "CO2", "AirHumidity", "Humidity", "CH4", "CO", "H2S"];
	const preferred = preferredCodes
		.map((code) => getChannelByCodes(device, [code]))
		.filter(Boolean);
	const remaining = channels.filter(
		(channel: any) => !preferred.some((item: any) => String(item?.code || "").toLowerCase() === String(channel?.code || "").toLowerCase()),
	);
	const ordered = [...preferred, ...remaining].slice(0, 8);

	return ordered.map((channel: any) => ({
		label: getChannelDisplayName(channel),
		value: formatChannelValue(channel),
		quality: getQualityInfo(channel),
	}));
}

function pointStateColors(stateColor: string) {
	if (stateColor === "green") {
		return { border: "#eceff3", bg: "#fafafa", accent: "#52c41a", text: "#262626" };
	}
	if (stateColor === "gold") {
		return { border: "#eceff3", bg: "#fafafa", accent: "#faad14", text: "#262626" };
	}
	if (stateColor === "red") {
		return { border: "#eceff3", bg: "#fafafa", accent: "#ff4d4f", text: "#262626" };
	}
	return { border: "#eceff3", bg: "#fafafa", accent: "#bfbfbf", text: "#262626" };
}

function kpiCardTone(kind: "total" | "online" | "danger" | "shown") {
	if (kind === "online") return { border: "#eceff3", accent: "#262626" };
	if (kind === "danger") return { border: "#eceff3", accent: "#262626" };
	if (kind === "shown") return { border: "#eceff3", accent: "#262626" };
	return { border: "#eceff3", accent: "#262626" };
}

function overallTone(sev: "danger" | "warn" | "ok" | "none") {
	if (sev === "danger") return { border: "#eceff3", shadow: "0 8px 24px rgba(15, 23, 42, 0.05)", glow: "#ffffff" };
	if (sev === "warn") return { border: "#eceff3", shadow: "0 8px 24px rgba(15, 23, 42, 0.05)", glow: "#ffffff" };
	if (sev === "ok") return { border: "#eceff3", shadow: "0 8px 24px rgba(15, 23, 42, 0.05)", glow: "#ffffff" };
	return { border: "#eceff3", shadow: "0 8px 24px rgba(15, 23, 42, 0.05)", glow: "#ffffff" };
}

function profileBadge(profile: DeviceProfile): { text: string; color: string } {
	if (profile === "cp500-v3") return { text: "CP500", color: "blue" };
	if (profile === "smart-compost") return { text: "Smart", color: "green" };
	if (profile === "mmcgs") return { text: "MMCGS", color: "purple" };
	return { text: "Generic", color: "default" };
}

function compactMetricValue(value: number | null, unit = ""): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "-";
	return `${Number(value).toFixed(1)}${unit}`;
}

function firstChannelByCodes(device: DashboardDevice, codes: string[]) {
	return getChannelByCodes(device, codes);
}

function getDeviceSummaryItems(device: DashboardDevice, alerts: ReturnType<typeof getAlertSummary>) {
	if (device.dashboard_profile === "cp500-v3") {
		const aerationChannel = firstChannelByCodes(device, ["Aeration"]);
		const heaterChannel = firstChannelByCodes(device, ["Heater"]);
		const pumpChannel = firstChannelByCodes(device, ["Pump"]);
		const actuatorSummary =
			aerationChannel
				? { label: "曝气", value: compactChannelValue(aerationChannel) }
				: heaterChannel
					? { label: "加热", value: compactChannelValue(heaterChannel) }
					: pumpChannel
						? { label: "循环泵", value: compactChannelValue(pumpChannel) }
						: { label: "执行器", value: "-" };
		return [
			{ label: "堆体温度", value: compactChannelValue(firstChannelByCodes(device, ["TempIn"])) },
			{ label: "水箱温度", value: compactChannelValue(firstChannelByCodes(device, ["TankTemp"])) },
			actuatorSummary,
		];
	}

	if (device.dashboard_profile === "smart-compost") {
		return [
			{ label: "CO2", value: compactChannelValue(firstChannelByCodes(device, ["CO2"])) },
			{ label: "O2", value: compactChannelValue(firstChannelByCodes(device, ["O2"])) },
			{ label: "空气温度", value: compactChannelValue(firstChannelByCodes(device, ["AirTemp", "RoomTemp"])) },
		];
	}

	return [
		{ label: "温度", value: compactMetricValue(alerts.maxTemp, "°C") },
		{ label: "O2", value: compactMetricValue(alerts.minO2, "%") },
		{ label: "通道数", value: String((device.channels || []).length || 0) },
	];
}

function channelNumber(device: DashboardDevice, codes: string[]): number | null {
	const channel = getChannelByCodes(device, codes);
	const raw = channel?.latest?.value;
	if (typeof raw === "number") return raw;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

function channelSwitchState(device: DashboardDevice, codes: string[]): boolean | null {
	const channel = getChannelByCodes(device, codes);
	if (!channel?.latest) return null;
	const raw = channel.latest.value;
	const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
	if (normalized === 1 || normalized === "1" || normalized === true || normalized === "true" || normalized === "on") return true;
	if (normalized === 0 || normalized === "0" || normalized === false || normalized === "false" || normalized === "off") return false;
	return null;
}

type Cp500TempTier = "unknown" | "cool" | "mild" | "active" | "warm" | "hot";

function cp500TempTier(temp: number | null): Cp500TempTier {
	if (temp === null) return "unknown";
	if (temp >= 75) return "hot";
	if (temp >= 65) return "warm";
	if (temp >= 50) return "active";
	if (temp >= 35) return "mild";
	return "cool";
}

function cp500TempColor(temp: number | null) {
	const tier = cp500TempTier(temp);
	if (tier === "unknown") return "#d9d9d9";
	if (tier === "cool") return "#9ad8a4";
	if (tier === "mild") return "#4dbf71";
	if (tier === "active") return "#8acb42";
	if (tier === "warm") return "#e0b144";
	return "#de6f5d";
}

function cp500MixColor(hex: string, target: string, amount: number) {
	const normalize = (value: string) => value.replace("#", "");
	const source = normalize(hex);
	const goal = normalize(target);
	const parse = (value: string, index: number) => Number.parseInt(value.slice(index, index + 2), 16);
	const mixChannel = (start: number, end: number) => Math.round(start + (end - start) * amount);
	const sr = parse(source, 0);
	const sg = parse(source, 2);
	const sb = parse(source, 4);
	const tr = parse(goal, 0);
	const tg = parse(goal, 2);
	const tb = parse(goal, 4);
	const toHex = (value: number) => value.toString(16).padStart(2, "0");
	return `#${toHex(mixChannel(sr, tr))}${toHex(mixChannel(sg, tg))}${toHex(mixChannel(sb, tb))}`;
}

function cp500PaletteFromTemp(temp: number | null) {
	const base = cp500TempColor(temp);
	if (temp === null) {
		return {
			accent: "#d3ddd5",
			bodyTop: "#cce0d0",
			bodyBottom: "#aec7b5",
			bodyCap: "#bfd5c5",
			jacketTop: "#e1efe3",
			jacketBottom: "#cbe0cf",
			waterFill: "#b7dfc3",
			waterSurface: "#d3edd9",
			waterGlow: "#e8f5eb",
		};
	}
	return {
		accent: cp500MixColor(base, "ffffff", 0.18),
		bodyTop: cp500MixColor(base, "ffffff", 0.26),
		bodyBottom: cp500MixColor(base, "000000", 0.14),
		bodyCap: cp500MixColor(base, "ffffff", 0.4),
		jacketTop: cp500MixColor(base, "ffffff", 0.72),
		jacketBottom: cp500MixColor(base, "ffffff", 0.44),
		waterFill: cp500MixColor(base, "ffffff", 0.22),
		waterSurface: cp500MixColor(base, "ffffff", 0.46),
		waterGlow: cp500MixColor(base, "ffffff", 0.72),
	};
}

function cp500ShellColor(temp: number | null) {
	return cp500PaletteFromTemp(temp).accent;
}

function cp500WaterPalette(temp: number | null) {
	const palette = cp500PaletteFromTemp(temp);
	return { fill: palette.waterFill, surface: palette.waterSurface, glow: palette.waterGlow };
}

function cp500BodyPalette(temp: number | null) {
	const palette = cp500PaletteFromTemp(temp);
	return { top: palette.bodyTop, bottom: palette.bodyBottom, cap: palette.bodyCap };
}

function cp500JacketPalette(temp: number | null) {
	const palette = cp500PaletteFromTemp(temp);
	return { top: palette.jacketTop, bottom: palette.jacketBottom };
}

function cp500ActuatorColor(kind: "aeration" | "heater" | "pump", active: boolean | null) {
	if (active !== true) {
		return active === false ? "#d6dee6" : "#bcc8d2";
	}
	if (kind === "aeration") return "#4fba74";
	if (kind === "heater") return "#d87d69";
	return "#66be84";
}

function switchText(active: boolean | null) {
	if (active === true) return "开启";
	if (active === false) return "关闭";
	return "-";
}

function Cp500SiloMini({ device }: { device: DashboardDevice }) {
	const screens = useBreakpoint();
	const isMobile = !screens.md;
	const reactorChannel = getChannelByCodes(device, ["TempIn"]);
	const shellChannel1 = getChannelByCodes(device, ["TempOut1"]);
	const shellChannel2 = getChannelByCodes(device, ["TempOut2"]);
	const shellChannel3 = getChannelByCodes(device, ["TempOut3"]);
	const tankChannel = getChannelByCodes(device, ["TankTemp"]);
	const aerationChannel = getChannelByCodes(device, ["Aeration"]);
	const heaterChannel = getChannelByCodes(device, ["Heater"]);
	const pumpChannel = getChannelByCodes(device, ["Pump"]);
	const reactorTemp = channelNumber(device, ["TempIn"]);
	const shellTemp1 = channelNumber(device, ["TempOut1"]);
	const shellTemp2 = channelNumber(device, ["TempOut2"]);
	const shellTemp3 = channelNumber(device, ["TempOut3"]);
	const tankTemp = channelNumber(device, ["TankTemp"]);
	const shellTemps = [shellTemp1, shellTemp2, shellTemp3].filter((value): value is number => value !== null && value !== undefined && !Number.isNaN(value));
	const shellAvgTemp = shellTemps.length ? shellTemps.reduce((sum, value) => sum + value, 0) / shellTemps.length : null;
	const waterDelta = reactorTemp === null || tankTemp === null ? null : tankTemp - reactorTemp;
	const aerationOn = channelSwitchState(device, ["Aeration"]);
	const heaterOn = channelSwitchState(device, ["Heater"]);
	const pumpOn = channelSwitchState(device, ["Pump"]);
	const bodyColor = cp500TempColor(reactorTemp);
	const bodyPalette = cp500BodyPalette(reactorTemp);
	const jacketPalette = cp500JacketPalette(tankTemp ?? shellAvgTemp);
	const tankColor = cp500TempColor(tankTemp);
	const tankWaterPalette = cp500WaterPalette(tankTemp);
	const shellColor1 = cp500ShellColor(shellTemp1);
	const shellColor2 = cp500ShellColor(shellTemp2);
	const shellColor3 = cp500ShellColor(shellTemp3);
	const shellAccent = cp500ShellColor(shellAvgTemp ?? tankTemp);
	const uiText = {
		summaryShell: "\u7b52\u58c1\u5747\u6e29",
		summaryDelta: "\u6c34\u6d74\u6e29\u5dee",
		summaryActive: "\u8fd0\u884c\u5355\u5143",
		hoverTemps: "\u6e29\u5ea6\u70b9\u4f4d",
		hoverStatus: "\u6267\u884c\u72b6\u6001",
		hoverNote:
			"\u52a0\u70ed\u4f5c\u7528\u4e8e\u6c34\u7bb1\uff0c\u5faa\u73af\u6c34\u6cf5\u5c06\u70ed\u6c34\u9001\u5165\u5939\u5c42\uff0c\u66dd\u6c14\u4ece\u6876\u5e95\u8fdb\u5165\u5806\u4f53\u3002",
	} as const;
	const statusItems = [
		{ label: getChannelDisplayName(aerationChannel) || "Aeration", active: aerationOn },
		{ label: getChannelDisplayName(heaterChannel) || "Heater", active: heaterOn },
		{ label: getChannelDisplayName(pumpChannel) || "Pump", active: pumpOn },
	];
	const activeStatusCount = statusItems.filter((item) => item.active === true).length;
	const tempItems = [
		{ label: getChannelDisplayName(reactorChannel) || "TempIn", value: reactorTemp },
		{ label: getChannelDisplayName(shellChannel1) || "TempOut1", value: shellTemp1 },
		{ label: getChannelDisplayName(shellChannel2) || "TempOut2", value: shellTemp2 },
		{ label: getChannelDisplayName(shellChannel3) || "TempOut3", value: shellTemp3 },
		{ label: getChannelDisplayName(tankChannel) || "TankTemp", value: tankTemp },
	];
	const tempUnit = String(reactorChannel?.unit || shellChannel1?.unit || shellChannel2?.unit || shellChannel3?.unit || tankChannel?.unit || "\u2103");
	const summaryItems = [
		{
			label: uiText.summaryShell,
			value: shellAvgTemp === null ? "-" : `${shellAvgTemp.toFixed(1)}${tempUnit}`,
			color: cp500ShellColor(shellAvgTemp),
		},
		{
			label: uiText.summaryDelta,
			value: waterDelta === null ? "-" : `${waterDelta >= 0 ? "+" : ""}${waterDelta.toFixed(1)}${tempUnit}`,
			color: shellAccent,
		},
		{
			label: uiText.summaryActive,
			value: `${activeStatusCount}/3`,
			color: activeStatusCount ? "#52c41a" : "#b8c0cc",
		},
	];
	const infoCardStyle = {
		background: "linear-gradient(180deg, #fbfcfd 0%, #f7f9fb 100%)",
		border: "1px solid #e9edf2",
		boxShadow: "inset 0 1px 0 rgba(255,255,255,0.92)",
	};
	const detailCardStyle = {
		borderRadius: 12,
		padding: "10px 11px",
		...infoCardStyle,
	} satisfies React.CSSProperties;
	const contentBlockStyle = {
		width: "100%",
		maxWidth: isMobile ? 360 : 324,
		margin: "0 auto",
	} satisfies React.CSSProperties;
	const hoverContent = (
		<div
			style={{
				minWidth: 228,
				maxWidth: isMobile ? 286 : 300,
				display: "grid",
				gap: 8,
			}}
		>
			<div style={detailCardStyle}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
					<Text strong style={{ fontSize: 12 }}>{uiText.hoverTemps}</Text>
					<Text type="secondary" style={{ fontSize: 10.5 }}>{`${tempItems.length} pts`}</Text>
				</div>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5 }}>
					{tempItems.map((item) => (
						<div
							key={item.label}
							style={{
								padding: "5px 7px",
								borderRadius: 9,
								background: "#ffffff",
								border: "1px solid #edf0f3",
								minWidth: 0,
							}}
						>
							<Text type="secondary" style={{ fontSize: 10, display: "block", lineHeight: 1.2 }}>{item.label}</Text>
							<Text strong style={{ fontSize: 11.5 }}>{item.value === null ? "-" : `${item.value.toFixed(1)}${tempUnit}`}</Text>
						</div>
					))}
				</div>
			</div>
			<div style={detailCardStyle}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
					<Text strong style={{ fontSize: 12 }}>{uiText.hoverStatus}</Text>
					<Text type="secondary" style={{ fontSize: 10.5 }}>{`${activeStatusCount}/3 on`}</Text>
				</div>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
					{statusItems.map((item) => (
						<div
							key={item.label}
							style={{
								padding: "5px 6px",
								borderRadius: 9,
								background: "#ffffff",
								border: "1px solid #edf0f3",
								textAlign: "center",
							}}
						>
							<div
								style={{
									width: 7,
									height: 7,
									borderRadius: "50%",
									background:
										item.label === (getChannelDisplayName(aerationChannel) || "Aeration")
											? cp500ActuatorColor("aeration", item.active)
											: item.label === (getChannelDisplayName(heaterChannel) || "Heater")
												? cp500ActuatorColor("heater", item.active)
												: cp500ActuatorColor("pump", item.active),
									margin: "0 auto 5px",
								}}
							/>
							<Text type="secondary" style={{ fontSize: 10, display: "block", lineHeight: 1.2 }}>{item.label}</Text>
							<Text strong style={{ fontSize: 10.5 }}>{switchText(item.active)}</Text>
						</div>
					))}
				</div>
			</div>
			<div style={{ padding: "0 2px" }}>
				<Text type="secondary" style={{ fontSize: 10.5, lineHeight: 1.45 }}>
					{uiText.hoverNote}
				</Text>
			</div>
		</div>
	);

	return (
		<div
			style={{
				display: "grid",
				gap: 8,
			}}
		>
			<Popover
				content={hoverContent}
				trigger={isMobile ? [] : "hover"}
				open={isMobile ? false : undefined}
				mouseEnterDelay={0.12}
				placement="topLeft"
				overlayStyle={{ maxWidth: isMobile ? 300 : 320 }}
			>
				<div
					style={{
						cursor: "pointer",
						borderRadius: 16,
						padding: isMobile ? "14px 8px 12px" : "18px 10px 14px",
						background: "radial-gradient(circle at 50% 18%, #ffffff 0%, #f7f9fb 58%, #f1f4f7 100%)",
						border: "1px solid #e9edf2",
						display: "flex",
						justifyContent: "center",
						boxShadow: "inset 0 1px 0 rgba(255,255,255,0.92)",
						transition: "border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
						...contentBlockStyle,
					}}
					onMouseEnter={(event) => {
						event.currentTarget.style.borderColor = "#b8dce7";
						event.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.92), 0 8px 22px rgba(62, 142, 186, 0.12)";
						event.currentTarget.style.transform = "translateY(-1px)";
					}}
					onMouseLeave={(event) => {
						event.currentTarget.style.borderColor = "#e9edf2";
						event.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.92)";
						event.currentTarget.style.transform = "translateY(0)";
					}}
				>
					<svg
						viewBox="0 0 224 228"
						width="100%"
						height="auto"
						aria-hidden="true"
						style={{
							display: "block",
							width: "100%",
							maxWidth: isMobile ? 318 : 278,
							aspectRatio: "224 / 228",
						}}
					>
						<style>
							{`
								@keyframes cp500-flow-dash {
									from { stroke-dashoffset: 0; }
									to { stroke-dashoffset: -18; }
								}
								@keyframes cp500-water-pulse {
									0%, 100% { opacity: 0.42; }
									50% { opacity: 0.62; }
								}
							`}
						</style>
						<defs>
							<linearGradient id={`cp500-shell-${device.device_id}`} x1="0%" y1="0%" x2="0%" y2="100%">
								<stop offset="0%" stopColor="#ffffff" />
								<stop offset="100%" stopColor="#eef2f6" />
							</linearGradient>
							<linearGradient id={`cp500-core-${device.device_id}`} x1="0%" y1="0%" x2="0%" y2="100%">
								<stop offset="0%" stopColor={bodyPalette.top} />
								<stop offset="100%" stopColor={bodyPalette.bottom} />
							</linearGradient>
							<linearGradient id={`cp500-water-${device.device_id}`} x1="0%" y1="0%" x2="0%" y2="100%">
								<stop offset="0%" stopColor={jacketPalette.top} />
								<stop offset="100%" stopColor={jacketPalette.bottom} />
							</linearGradient>
							<linearGradient id={`cp500-tank-${device.device_id}`} x1="0%" y1="0%" x2="0%" y2="100%">
								<stop offset="0%" stopColor="#ffffff" />
								<stop offset="55%" stopColor="#f3f6fa" />
								<stop offset="100%" stopColor="#e6ebf1" />
							</linearGradient>
							<filter id={`cp500-shadow-${device.device_id}`} x="-20%" y="-20%" width="140%" height="160%">
								<feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#d9e0e7" floodOpacity="0.55" />
							</filter>
						</defs>
						<g filter={`url(#cp500-shadow-${device.device_id})`}>
							<ellipse cx="84" cy="46" rx="34" ry="10" fill="#f8fafc" stroke="#cfd4dc" strokeWidth="2" />
							<rect x="50" y="46" width="68" height="96" rx="30" fill={`url(#cp500-shell-${device.device_id})`} stroke="#cfd4dc" strokeWidth="2" />
							<rect x="53" y="51" width="62" height="87" rx="26" fill={`url(#cp500-water-${device.device_id})`} opacity="0.93" />
							<rect x="61" y="58" width="46" height="72" rx="19" fill={`url(#cp500-core-${device.device_id})`} />
							<ellipse cx="84" cy="58" rx="23" ry="6.8" fill={bodyPalette.cap} opacity="0.92" />
						</g>
						<text x="84" y="88" textAnchor="middle" fontSize="10.5" fill="rgba(255,255,255,0.84)" fontWeight="600">{tempItems[0]?.label || "TempIn"}</text>
						<text x="84" y="113" textAnchor="middle" fontSize="16" fill="#ffffff" fontWeight="700">{reactorTemp === null ? "-" : `${reactorTemp.toFixed(1)}${tempUnit}`}</text>
						<line x1="108" y1="72" x2="126" y2="72" stroke="#d4dae1" strokeWidth="1.6" />
						<line x1="108" y1="94" x2="126" y2="94" stroke="#d4dae1" strokeWidth="1.6" />
						<line x1="108" y1="116" x2="126" y2="116" stroke="#d4dae1" strokeWidth="1.6" />
						<circle cx="109" cy="72" r="3.2" fill={shellColor1} stroke="#ffffff" strokeWidth="1.2" />
						<circle cx="109" cy="94" r="3.2" fill={shellColor2} stroke="#ffffff" strokeWidth="1.2" />
						<circle cx="109" cy="116" r="3.2" fill={shellColor3} stroke="#ffffff" strokeWidth="1.2" />
						<circle cx="132" cy="72" r="4.8" fill={shellColor1} stroke="#ffffff" strokeWidth="1.4" />
						<circle cx="132" cy="94" r="4.8" fill={shellColor2} stroke="#ffffff" strokeWidth="1.4" />
						<circle cx="132" cy="116" r="4.8" fill={shellColor3} stroke="#ffffff" strokeWidth="1.4" />
						<text x="146" y="70" fontSize="8.5" fill="#7f8a96">{tempItems[1]?.label || "TempOut1"}</text>
						<text x="146" y="84" fontSize="12" fill="#2f3943" fontWeight="700">{shellTemp1 === null ? "-" : `${shellTemp1.toFixed(1)}${tempUnit}`}</text>
						<text x="146" y="98" fontSize="8.5" fill="#7f8a96">{tempItems[2]?.label || "TempOut2"}</text>
						<text x="146" y="112" fontSize="12" fill="#2f3943" fontWeight="700">{shellTemp2 === null ? "-" : `${shellTemp2.toFixed(1)}${tempUnit}`}</text>
						<text x="146" y="126" fontSize="8.5" fill="#7f8a96">{tempItems[3]?.label || "TempOut3"}</text>
						<text x="146" y="140" fontSize="12" fill="#2f3943" fontWeight="700">{shellTemp3 === null ? "-" : `${shellTemp3.toFixed(1)}${tempUnit}`}</text>
						<g filter={`url(#cp500-shadow-${device.device_id})`}>
							<ellipse cx="136" cy="175" rx="18" ry="5.5" fill="#ffffff" stroke="#cfd4dc" strokeWidth="1.6" />
							<rect x="118" y="175" width="36" height="43" rx="12" fill={`url(#cp500-tank-${device.device_id})`} stroke="#cfd4dc" strokeWidth="1.6" />
							<ellipse cx="136" cy="218" rx="18" ry="5.5" fill="#edf1f5" stroke="#cfd4dc" strokeWidth="1.6" />
							<rect
								x="122"
								y="183"
								width="28"
								height="31"
								rx="6.4"
								fill={tankWaterPalette.fill}
								opacity={heaterOn ? 0.56 : 0.46}
								style={heaterOn ? { animation: "cp500-water-pulse 1.8s ease-in-out infinite" } : undefined}
							/>
							<ellipse cx="136" cy="183" rx="14" ry="3.8" fill={tankWaterPalette.surface} opacity={heaterOn ? 0.78 : 0.64} />
							<ellipse cx="136" cy="194" rx="10.5" ry="2.7" fill={tankWaterPalette.glow} opacity={heaterOn ? 0.3 : 0.22} />
							<path d="M127.8 179 C129.4 191, 129.4 205, 127.8 216" fill="none" stroke="rgba(255,255,255,0.76)" strokeWidth="1.5" strokeLinecap="round" />
						</g>
						<rect x="126" y="221" width="20" height="3.2" rx="1.6" fill="#dfe4ea" />
						<text x="136" y="183" textAnchor="middle" fontSize="8.5" fill="#7f8a96">{tempItems[4]?.label || "TankTemp"}</text>
						<text x="136" y="202" textAnchor="middle" fontSize="12.5" fill="#2f3943" fontWeight="700">{tankTemp === null ? "-" : `${tankTemp.toFixed(1)}${tempUnit}`}</text>
						<circle cx="175" cy="180" r="6" fill={cp500ActuatorColor("heater", heaterOn)} stroke="#ffffff" strokeWidth="1.5" />
						<circle cx="175" cy="202" r="6" fill={cp500ActuatorColor("pump", pumpOn)} stroke="#ffffff" strokeWidth="1.5" />
						<text x="187" y="183" fontSize="8.2" fill="#7f8a96">{statusItems[1]?.label || "Heater"}</text>
						<text x="187" y="205" fontSize="8.2" fill="#7f8a96">{statusItems[2]?.label || "Pump"}</text>
						<circle cx="20" cy="132" r="6" fill={cp500ActuatorColor("aeration", aerationOn)} stroke="#ffffff" strokeWidth="1.5" />
						<text x="20" y="148" textAnchor="middle" fontSize="8.5" fill="#7f8a96">{statusItems[0]?.label || "Aeration"}</text>
						<path d="M26 132 C44 132, 56 136, 66 136" fill="none" stroke="#64b788" strokeWidth="2.4" strokeLinecap="round" />
						<path d="M66 136 C74 136, 78 132, 84 128" fill="none" stroke="#64b788" strokeWidth="2.4" strokeLinecap="round" />
						<path d="M175 202 C193 202, 194 165, 165 150" fill="none" stroke={shellAccent} strokeWidth="2.2" strokeLinecap="round" />
						<path d="M165 150 C148 141, 131 132, 113 123" fill="none" stroke={shellAccent} strokeWidth="2.2" strokeLinecap="round" />
						<path d="M114 136 C132 150, 152 163, 171 195" fill="none" stroke={shellAccent} strokeWidth="1.7" strokeLinecap="round" opacity="0.82" />
						{aerationOn ? (
							<>
								<path
									d="M26 132 C44 132, 56 136, 66 136"
									fill="none"
									stroke="#d5f0df"
									strokeWidth="2"
									strokeLinecap="round"
									strokeDasharray="3 6"
									style={{ animation: "cp500-flow-dash 0.9s linear infinite" }}
								/>
								<path
									d="M66 136 C74 136, 78 132, 84 128"
									fill="none"
									stroke="#d5f0df"
									strokeWidth="2"
									strokeLinecap="round"
									strokeDasharray="3 6"
									style={{ animation: "cp500-flow-dash 0.9s linear infinite" }}
								/>
							</>
						) : null}
						{pumpOn ? (
							<>
								<path
									d="M175 202 C193 202, 194 165, 165 150"
									fill="none"
									stroke="#ddf4e1"
									strokeWidth="2"
									strokeLinecap="round"
									strokeDasharray="3 6"
									style={{ animation: "cp500-flow-dash 0.95s linear infinite" }}
								/>
								<path
									d="M165 150 C148 141, 131 132, 113 123"
									fill="none"
									stroke="#ddf4e1"
									strokeWidth="2"
									strokeLinecap="round"
									strokeDasharray="3 6"
									style={{ animation: "cp500-flow-dash 0.95s linear infinite" }}
								/>
								<path
									d="M114 136 C132 150, 152 163, 171 195"
									fill="none"
									stroke="#ddf4e1"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeDasharray="3 6"
									style={{ animation: "cp500-flow-dash 1.05s linear infinite" }}
								/>
							</>
						) : null}
					</svg>
				</div>
			</Popover>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
					gap: 0,
					overflow: "hidden",
					borderRadius: 12,
					...contentBlockStyle,
					...infoCardStyle,
				}}
			>
				{summaryItems.map((item, index) => (
					<div
						key={item.label}
						style={{
							padding: "8px 10px",
							minWidth: 0,
							borderLeft: index === 0 ? "none" : "1px solid #e9edf2",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
							<div
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: item.color,
									flex: "0 0 auto",
								}}
							/>
							<Text type="secondary" style={{ fontSize: 10.5, lineHeight: 1.2, color: "#6b7785" }}>
								{item.label}
							</Text>
						</div>
						<Text strong style={{ fontSize: 12.5, color: "#1f2d3d", lineHeight: 1.2 }}>
							{item.value}
						</Text>
					</div>
				))}
			</div>
		</div>
	);
}

function formatSummaryMetricValue(value: number | null, suffix: string): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "-";
	return `${Number(value).toFixed(1)}${suffix}`;
}

function matchesRunFilter(device: DashboardDevice, runFilter: string | undefined, runs: any[], windowsMap: Map<number, any[]>) {
	if (!runFilter) return true;
	const run = runs.find((item: any) => String(item?.run_id) === String(runFilter));
	if (!run) return true;
	const windows = windowsMap.get(Number(runFilter)) || [];
	const memberIds = new Set((device.dashboard_members || []).map((item) => item?.device_id));
	return windows.some((windowItem: any) => (windowItem?.device_ids || []).some((deviceId: number) => memberIds.has(deviceId)));
}

export default function DashboardPage() {
	const screens = useBreakpoint();
	const isMobile = !screens.md;
	const router = useRouter();

	const devicesQ = useDevicesTree(true);
	const rawDevices = devicesQ.data?.data || [];
	const runsQ = useRuns();
	const runs = runsQ.data?.data || [];
	const [windowsMap, setWindowsMap] = useState<Map<number, any[]>>(new Map());

	useEffect(() => {
		const loadRunWindows = async () => {
			if (!runs.length) return;
			const nextMap = new Map<number, any[]>();

			await Promise.all(
				runs.map(async (run: any) => {
					try {
						const response = await api.get(`/runs/${run.run_id}/windows`);
						nextMap.set(run.run_id, response.data.data || []);
					} catch (error) {
						console.error(`Failed to load windows for run ${run.run_id}`, error);
					}
				}),
			);

			setWindowsMap(nextMap);
		};

		loadRunWindows();
	}, [runs]);

	const [q, setQ] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [alertFilter, setAlertFilter] = useState<string>("all");
	const [runFilter, setRunFilter] = useState<string | undefined>(undefined);

	const dashboardDevices = useMemo(() => buildDashboardDevices(rawDevices), [rawDevices]);

	const filtered = useMemo(() => {
		const keyword = q.trim().toLowerCase();

		return dashboardDevices.filter((device) => {
			if (!matchesRunFilter(device, runFilter, runs, windowsMap)) return false;

			const state = resolveProfileOnlineState(device.last_seen_at, device.dashboard_profile);
			if (statusFilter !== "all" && state !== statusFilter) return false;

			const alerts = resolveDeviceAlertSummary(device);
			if (alertFilter !== "all" && alerts.overall !== alertFilter) return false;

			if (!keyword) return true;
			const searchText = [
				device.name || "",
				device.code || "",
				device.dashboard_controller_code || "",
				...(device.dashboard_members || []).flatMap((item) => [item?.name || "", item?.code || ""]),
			]
				.join(" ")
				.toLowerCase();
			return searchText.includes(keyword);
		});
	}, [alertFilter, dashboardDevices, q, runFilter, runs, statusFilter, windowsMap]);

	const kpi = useMemo(() => {
		let online = 0;
		let danger = 0;

		for (const device of dashboardDevices) {
			if (resolveProfileOnlineState(device.last_seen_at, device.dashboard_profile) === "online") online += 1;
			if (resolveDeviceAlertSummary(device).overall === "danger") danger += 1;
		}

		return {
			total: dashboardDevices.length,
			online,
			danger,
		};
	}, [dashboardDevices]);

	if (devicesQ.isLoading) {
		return (
			<div style={{ padding: 48 }}>
				<Spin />
			</div>
		);
	}

	return (
		<Page
			title="仪表盘"
			extra={
				<Space
					wrap
					size={10}
					style={{
						padding: isMobile ? "10px 12px" : "12px 14px",
						background: "#ffffff",
						border: "1px solid #eceff3",
						borderRadius: 14,
						boxShadow: "0 4px 14px rgba(15, 23, 42, 0.03)",
					}}
				>
					<Input.Search
						placeholder="搜索设备名称或编码"
						allowClear
						style={{ width: isMobile ? "100%" : 320 }}
						value={q}
						onChange={(event) => setQ(event.target.value)}
					/>
					<Select
						style={{ width: isMobile ? "100%" : 150 }}
						value={statusFilter}
						onChange={setStatusFilter}
						options={[
							{ value: "all", label: "全部状态" },
							{ value: "online", label: "Online" },
							{ value: "idle", label: "Idle" },
							{ value: "offline", label: "Offline" },
							{ value: "unknown", label: "Unknown" },
						]}
					/>
					<Select
						style={{ width: isMobile ? "100%" : 180 }}
						value={alertFilter}
						onChange={setAlertFilter}
						options={[
							{ value: "all", label: "全部告警" },
							{ value: "danger", label: "仅危险" },
							{ value: "warn", label: "仅预警" },
							{ value: "ok", label: "仅正常" },
							{ value: "none", label: "仅无数据" },
						]}
					/>
					<Select
						style={{ width: isMobile ? "100%" : 200 }}
						value={runFilter}
						onChange={setRunFilter}
						placeholder="按批次筛选"
						allowClear
						options={[
							{ value: "", label: "全部批次" },
							...runs.map((run: any) => ({
								value: String(run.run_id),
								label: run.name,
							})),
						]}
					/>
				</Space>
			}
		>
			<Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
				<Col xs={12} md={6}>
					<Card style={{ borderRadius: 14, background: "#ffffff", borderColor: kpiCardTone("total").border, boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)" }}>
						<Text type="secondary">设备总数</Text>
						<div style={{ fontSize: 26, fontWeight: 700, color: kpiCardTone("total").accent }}>{kpi.total}</div>
					</Card>
				</Col>
				<Col xs={12} md={6}>
					<Card style={{ borderRadius: 14, background: "#ffffff", borderColor: kpiCardTone("online").border, boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)" }}>
						<Text type="secondary">在线设备</Text>
						<div style={{ fontSize: 26, fontWeight: 700, color: kpiCardTone("online").accent }}>{kpi.online}</div>
					</Card>
				</Col>
				<Col xs={12} md={6}>
					<Card style={{ borderRadius: 14, background: "#ffffff", borderColor: kpiCardTone("danger").border, boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)" }}>
						<Text type="secondary">危险告警</Text>
						<div style={{ fontSize: 26, fontWeight: 700, color: kpiCardTone("danger").accent }}>{kpi.danger}</div>
					</Card>
				</Col>
				<Col xs={12} md={6}>
					<Card style={{ borderRadius: 14, background: "#ffffff", borderColor: kpiCardTone("shown").border, boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)" }}>
						<Text type="secondary">当前展示</Text>
						<div style={{ fontSize: 26, fontWeight: 700, color: kpiCardTone("shown").accent }}>{filtered.length}</div>
					</Card>
				</Col>
			</Row>

			<Row gutter={[8, 8]}>
				{filtered.map((device) => {
					const stateTag = onlineTag(resolveProfileOnlineState(device.last_seen_at, device.dashboard_profile));
					const alerts = resolveDeviceAlertSummary(device);
					const overallTagColor =
						alerts.overall === "danger" ? "red" : alerts.overall === "warn" ? "orange" : alerts.overall === "ok" ? "green" : "default";
					const overallText =
						alerts.overall === "danger" ? "Danger" : alerts.overall === "warn" ? "Warn" : alerts.overall === "ok" ? "OK" : "No Data";
					const metricGroups = device.dashboard_is_mmcgs_group ? [] : groupChannelsByMetric(device.channels || []);
					const metrics = metricGroups.map((group) => group.key).filter((key) => key !== "unknown") as MetricKey[];
					const onlinePointCount =
						device.dashboard_points?.filter((point: any) => resolveProfileOnlineState(point?.last_seen_at, "mmcgs") === "online").length || 0;
					const cardTone = overallTone(alerts.overall);
					const profile = profileBadge(device.dashboard_profile);
					const summaryItems = getDeviceSummaryItems(device, alerts);
					const isCardClickable = !device.dashboard_is_mmcgs_group;

					const cardBody = (
						<Card
							hoverable={!device.dashboard_is_mmcgs_group}
							style={{
								borderRadius: 16,
								height: "100%",
								borderColor: cardTone.border,
								boxShadow: cardTone.shadow,
								background: "#ffffff",
								cursor: "pointer",
							}}
							onClick={device.dashboard_is_mmcgs_group ? () => router.push(`/devices/${device.device_id}`) : undefined}
						>
									<div style={{ marginBottom: 10 }}>
										<div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
											<div style={{ minWidth: 0 }}>
												<div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, lineHeight: 1.3 }}>{device.name || device.code}</div>
												<Text type="secondary" style={{ fontSize: 12 }}>
													{device.code}
												</Text>
											</div>
											<Tag color={profile.color} style={{ margin: 0, fontSize: 11, padding: "0 6px", lineHeight: "18px", borderRadius: 999 }}>
												{profile.text}
											</Tag>
										</div>
										<Space size={3} wrap>
											<Tag color={stateTag.color} style={{ fontSize: 11, padding: "0 4px", margin: 0 }}>
												{stateTag.text}
											</Tag>
											<Tag color={overallTagColor} style={{ fontSize: 11, padding: "0 4px", margin: 0 }}>
												{overallText}
											</Tag>
											{device.dashboard_is_mmcgs_group ? (
												<Tag color="purple" style={{ fontSize: 11, padding: "0 4px", margin: 0 }}>
													{`点位 ${device.dashboard_points?.length || 0}`}
												</Tag>
											) : null}
										</Space>
									</div>

									<div style={{ marginBottom: device.dashboard_profile === "cp500-v3" ? 4 : 8 }}>
										{device.dashboard_profile === "cp500-v3" && !device.dashboard_is_mmcgs_group ? <Cp500SiloMini device={device} /> : null}
										{device.dashboard_is_mmcgs_group ? (
											<div
												style={{
													display: "grid",
													gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
													gap: 6,
													marginTop: 2,
												}}
											>
												<div style={{ borderRadius: 10, padding: "6px 8px", background: "#fafafa", border: "1px solid #f0f0f0" }}>
													<Text type="secondary" style={{ fontSize: 10, display: "block", lineHeight: 1.2 }}>
														在线点位
													</Text>
													<Text strong style={{ fontSize: 12 }}>
														{`${onlinePointCount}/${device.dashboard_points?.length || 0}`}
													</Text>
												</div>
												<div style={{ borderRadius: 10, padding: "6px 8px", background: "#fafafa", border: "1px solid #f0f0f0" }}>
													<Text type="secondary" style={{ fontSize: 10, display: "block", lineHeight: 1.2 }}>
														最高温
													</Text>
													<Text strong style={{ fontSize: 12 }}>
														{formatSummaryMetricValue(alerts.maxTemp, "°C")}
													</Text>
												</div>
												<div style={{ borderRadius: 10, padding: "6px 8px", background: "#fafafa", border: "1px solid #f0f0f0" }}>
													<Text type="secondary" style={{ fontSize: 10, display: "block", lineHeight: 1.2 }}>
														最低 O2
													</Text>
													<Text strong style={{ fontSize: 12 }}>
														{formatSummaryMetricValue(alerts.minO2, "%")}
													</Text>
												</div>
											</div>
										) : device.dashboard_profile !== "cp500-v3" && metrics.length ? (
											<div
												style={{
													display: "grid",
													gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
													gap: 6,
													marginTop: 2,
												}}
											>
												{summaryItems.map((item) => (
													<div key={item.label} style={{ borderRadius: 10, padding: "6px 8px", background: "#fafafa", border: "1px solid #f0f0f0" }}>
														<Text type="secondary" style={{ fontSize: 10, display: "block", lineHeight: 1.2 }}>
															{item.label}
														</Text>
														<Text strong style={{ fontSize: 12 }}>
															{item.value}
														</Text>
													</div>
												))}
											</div>
										) : null}
									</div>

									{device.dashboard_is_mmcgs_group && device.dashboard_points?.length ? (
										<div style={{ marginTop: 10 }}>
											<div
												style={{
													display: "grid",
													gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))",
													gap: 5,
												}}
											>
												{device.dashboard_points.map((point: any) => {
													const pointIndex = getMmcgsPointIndex(point?.code);
													const pointState = onlineTag(resolveProfileOnlineState(point?.last_seen_at, "mmcgs"));
													const summaryItems = getPointSummaryItems(point);
													const detailItems = getPointDetailItems(point);
													const pointTitle = point.name || point.code || `P${pointIndex ?? "?"}`;
													const pointStateTone = pointStateColors(pointState.color);
													const prioritizedDetailItems = detailItems
														.slice()
														.sort((a, b) => Number(a.quality.isBad) === Number(b.quality.isBad) ? 0 : a.quality.isBad ? -1 : 1);
													return (
														<Popover
															key={point.device_id}
															trigger={isMobile ? [] : "hover"}
															open={isMobile ? false : undefined}
															mouseEnterDelay={0.12}
															placement="topLeft"
															overlayStyle={{ maxWidth: 320 }}
															content={
																<div
																	style={{
																		minWidth: 240,
																		maxWidth: 300,
																	}}
																>
																	<div
																		style={{
																			marginBottom: 10,
																			padding: "10px 12px",
																			borderRadius: 12,
																			border: `1px solid ${pointStateTone.border}`,
																			background: pointStateTone.bg,
																		}}
																	>
																		<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
																			<div style={{ minWidth: 0 }}>
																				<Text strong style={{ fontSize: 13 }}>
																					{pointTitle}
																				</Text>
																				<div>
																					<Text type="secondary" style={{ fontSize: 11 }}>
																						{point.code || `P${pointIndex ?? "?"}`}
																					</Text>
																				</div>
																			</div>
																			<span
																				style={{
																					display: "inline-flex",
																					alignItems: "center",
																					gap: 5,
																					fontSize: 11,
																					fontWeight: 600,
																					color: pointStateTone.text,
																				}}
																			>
																				<span
																					style={{
																						width: 7,
																						height: 7,
																						borderRadius: "50%",
																						background: pointStateTone.accent,
																					}}
																				/>
																				{pointState.text}
																			</span>
																		</div>
																	</div>
																	<div
																		style={{
																			display: "grid",
																			gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
																			gap: 8,
																		}}
																	>
																		{prioritizedDetailItems.length ? (
																			prioritizedDetailItems.map((item) => (
																				<div
																					key={item.label}
																					style={{
																						border: `1px solid ${item.quality.isBad ? "#ffd8bf" : "#eef0f3"}`,
																						background: item.quality.isBad ? "#fff7e6" : "#fafcff",
																						borderRadius: 10,
																						padding: "7px 8px",
																						minWidth: 0,
																					}}
																				>
																					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 4 }}>
																						<Text type="secondary" style={{ fontSize: 11 }}>
																							{item.label}
																						</Text>
																						<Tag color={item.quality.color} style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
																							{item.quality.quality}
																						</Tag>
																					</div>
																					<Text
																						strong
																						style={{
																							fontSize: 12,
																							display: "block",
																							whiteSpace: "nowrap",
																							overflow: "hidden",
																							textOverflow: "ellipsis",
																						}}
																					>
																						{item.value}
																					</Text>
																				</div>
																			))
																		) : (
																			<Text type="secondary" style={{ fontSize: 12 }}>
																				暂无点位数据
																			</Text>
																		)}
																	</div>
																	<div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #f0f0f0" }}>
																		<Text type="secondary" style={{ fontSize: 11 }}>
																			点击进入该点位详情页
																		</Text>
																	</div>
																</div>
															}
														>
															<Link
																href={`/devices/${point.device_id}`}
																style={{ display: "block" }}
																onClick={(event) => event.stopPropagation()}
															>
																<div
																	style={{
																		border: "1px solid #e8edf3",
																		borderRadius: 10,
																		padding: "6px 8px",
																		background: "linear-gradient(180deg, #fcfdff 0%, #f7faff 100%)",
																		boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
																		transition: "transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
																	}}
																	onMouseEnter={(event) => {
																		event.currentTarget.style.transform = "translateY(-1px)";
																		event.currentTarget.style.borderColor = "#91caff";
																		event.currentTarget.style.boxShadow = "0 6px 16px rgba(22, 119, 255, 0.12)";
																		event.currentTarget.style.background = "linear-gradient(180deg, #f3f8ff 0%, #eef6ff 100%)";
																	}}
																	onMouseLeave={(event) => {
																		event.currentTarget.style.transform = "translateY(0)";
																		event.currentTarget.style.borderColor = "#e8edf3";
																		event.currentTarget.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.04)";
																		event.currentTarget.style.background = "linear-gradient(180deg, #fcfdff 0%, #f7faff 100%)";
																	}}
																>
																<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3, gap: 6 }}>
																	<Text strong style={{ fontSize: 11 }}>
																		{`P${pointIndex ?? "?"}`}
																	</Text>
																	<span
																		style={{
																			display: "inline-flex",
																			alignItems: "center",
																			gap: 4,
																			fontSize: 10,
																			color: pointState.color === "green" ? "#389e0d" : pointState.color === "gold" ? "#d48806" : pointState.color === "red" ? "#cf1322" : "#8c8c8c",
																		}}
																	>
																		<span
																			style={{
																				width: 6,
																				height: 6,
																				borderRadius: "50%",
																				background:
																					pointState.color === "green"
																						? "#52c41a"
																						: pointState.color === "gold"
																							? "#faad14"
																							: pointState.color === "red"
																								? "#ff4d4f"
																								: "#bfbfbf",
																			}}
																		/>
																		{pointState.text}
																	</span>
																</div>
																<div style={{ display: "grid", gap: 1 }}>
																	{summaryItems.map((item) => (
																		<div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
																			<Text type="secondary" style={{ fontSize: 10 }}>
																				{item.label}
																			</Text>
																			<Text
																				style={{
																					fontSize: 10,
																					maxWidth: 68,
																					overflow: "hidden",
																					textOverflow: "ellipsis",
																					whiteSpace: "nowrap",
																					textAlign: "right",
																				}}
																			>
																				{item.value}
																			</Text>
																		</div>
																	))}
																</div>
																</div>
															</Link>
														</Popover>
													);
												})}
											</div>
										</div>
									) : null}

									<div style={{ marginTop: 8 }}>
										{!device.dashboard_is_mmcgs_group && device.dashboard_profile !== "cp500-v3" && metricGroups.length ? (
											<div>
												{metricGroups.map((group, index) => (
													<div key={group.key}>
														{index > 0 ? <div style={{ height: 1, background: "#f0f0f0", margin: "8px 0" }} /> : null}
														{sortChannels(group.channels).map((channel: any) => {
															const metric = detectChannelMetric(channel) as MetricKey;
															const value = latestNumber(channel);
															const isTemp = metric === "temperature";
															const isO2 = metric === "o2";
															const alert = isTemp ? evalTemp(value) : isO2 ? evalO2(value) : null;
															const qualityInfo = getQualityInfo(channel);
															const tagText = channel?.latest ? `${channel.latest.value ?? "-"} ${channel.unit || ""}` : "-";
															const displayName = getChannelDisplayName(channel);

															return (
																<div
																	key={`${channel.code}-${channel.display_name || ""}-${channel._dashboard_source_device_id || ""}`}
																	style={{
																		display: "flex",
																		justifyContent: "space-between",
																		alignItems: "center",
																		padding: "3px 0",
																	}}
																>
																	<Text type="secondary" style={{ fontSize: 13 }}>
																		{displayName}
																	</Text>
																	<Space size={6}>
																		<Tag color={alert ? sevToColor(alert.sev) : undefined} style={{ fontSize: 12 }}>
																			{tagText}
																		</Tag>
																		<Tag color={qualityInfo.color} style={{ fontSize: 11 }}>
																			{qualityInfo.quality}
																		</Tag>
																		{alert && alert.sev !== "ok" && alert.sev !== "none" && !qualityInfo.isBad ? (
																			<Tooltip title={alert.tip}>
																				{alert.sev === "danger" ? (
																					<ExclamationCircleOutlined style={{ color: "#ff4d4f", fontSize: 15, cursor: "help" }} />
																				) : (
																					<InfoCircleOutlined style={{ color: "#faad14", fontSize: 15, cursor: "help" }} />
																				)}
																			</Tooltip>
																		) : null}
																	</Space>
																</div>
															);
														})}
													</div>
												))}
											</div>
										) : !device.dashboard_is_mmcgs_group && device.dashboard_profile !== "cp500-v3" ? (
											<Text type="secondary">暂无通道数据</Text>
										) : null}
									</div>

									{device.last_seen_at ? (
										<div style={{ marginTop: 6, paddingTop: 4, borderTop: "1px solid #f0f0f0" }}>
											<Text type="secondary" style={{ fontSize: 11 }}>
												最后更新：{device.last_seen_at}
											</Text>
										</div>
									) : null}
								</Card>
					);

					return (
						<Col key={`${device.device_id}-${device.code || ""}`} xs={24} md={12} lg={device.dashboard_profile === "cp500-v3" ? 8 : 6} xl={device.dashboard_profile === "cp500-v3" ? 6 : 6}>
							{device.dashboard_is_mmcgs_group ? (
								cardBody
							) : (
								<Link href={`/devices/${device.device_id}`} style={{ display: "block", height: "100%" }}>
									{cardBody}
								</Link>
							)}
						</Col>
					);
				})}
			</Row>
		</Page>
	);
}
