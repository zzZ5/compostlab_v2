"use client";

import Link from "next/link";
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

					const cardBody = (
						<Card
							hoverable={!device.dashboard_is_mmcgs_group}
							style={{
								borderRadius: 16,
								height: "100%",
								borderColor: cardTone.border,
								boxShadow: cardTone.shadow,
								background: "#ffffff",
							}}
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

									<div style={{ marginBottom: 8 }}>
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
										) : metrics.length ? (
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
										) : (
											<Tag style={{ fontSize: 11, padding: "0 4px" }}>未分类</Tag>
										)}
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
															trigger="hover"
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
															<Link href={`/devices/${point.device_id}`} style={{ display: "block" }}>
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
										{!device.dashboard_is_mmcgs_group && metricGroups.length ? (
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
										) : !device.dashboard_is_mmcgs_group ? (
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
						<Col key={`${device.device_id}-${device.code || ""}`} xs={24} md={12} lg={6}>
							{device.dashboard_is_mmcgs_group ? cardBody : <Link href={`/devices/${device.device_id}`} style={{ display: "block" }}>{cardBody}</Link>}
						</Col>
					);
				})}
			</Row>
		</Page>
	);
}
