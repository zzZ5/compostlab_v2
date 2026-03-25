"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
	Button,
	Card,
	Col,
	Collapse,
	DatePicker,
	Divider,
	Form,
	Grid,
	Input,
	Modal,
	Row,
	Select,
	Slider,
	Space,
	Spin,
	Switch,
	Table,
	Tabs,
	Tag,
	Typography,
	message,
} from "antd";
import dayjs from "dayjs";

import Page from "@/components/Page";
import KeyValueEditor from "@/components/KeyValueEditor";

import { useDevicesTree, useDeviceLatest, useDeviceCommands } from "@/features/devices/queries";
import { useDeviceTelemetry } from "@/features/telemetry/queries";
import { useDeviceChannels } from "@/features/channels/queries";
import { useCreateChannel } from "@/features/channels/mutations";
import { useUpdateChannel } from "@/features/channels/mutations";
import { useDeleteChannel } from "@/features/channels/mutations";
import { useUpdateDevice } from "@/features/devices/mutations";
import { useDeleteDevice } from "@/features/devices/mutations";
import { useSendDeviceCommand } from "@/features/devices/mutations";
import {
	useControlTemplates,
	useCreateControlTemplate,
	useDeleteControlTemplate,
} from "@/features/templates/queries";

import { api, buildQuery, downloadBlob, getErrorMessage } from "@/lib/api";
import { channelByMetric } from "@/lib/channel";
import { MetricKey, getChannelDisplayName, metricLabel, normalizeMetric } from "@/lib/metrics";
import { getChannelGroupKey, groupChannelsByMetric, isKnownMetricKey, sortChannels } from "@/lib/channelGroups";

import type { Channel, DeviceTreeItem } from "@/types/api";

// Metric 颜色映射（简洁配色）
function getMetricColor(metric: MetricKey): string {
	const colors: Record<MetricKey, string> = {
		temperature: "#1890ff",  // 蓝色 - 温度
		o2: "#52c41a",          // 绿色 - 氧气
		co2: "#fa8c16",         // 橙色 - CO2
		ch4: "#eb2f96",          // 粉色 - CH4
		co: "#f5222d",           // 红色 - CO
		h2s: "#722ed1",          // 紫色 - H2S
		nh3: "#9254de",          // 紫色 - NH3
		moisture: "#13c2c2",     // 青色 - 水分
		humidity: "#13c2c2",     // 青色 - 湿度
		ph: "#faad14",           // 黄色 - pH
		flow: "#52c41a",          // 绿色 - 流量
		switch: "#fa8c16",       // 橙色 - 开关
		unknown: "#d9d9d9",
	};
	return colors[metric] || colors.unknown;
}

const { Text } = Typography;

type CmdBody = {
	commands: Record<string, unknown>[];
};

type DeviceProfile = "cp500-v3" | "smart-compost" | "mmcgs" | "generic";

function fmt(dt?: string | number | Date | dayjs.Dayjs | null) {
	if (!dt) return null;
	return dayjs(dt).format("YYYY-MM-DD HH:mm:ss");
}

function getTextTokens(...values: unknown[]): string {
	return values
		.flatMap((value) => {
			if (typeof value === "string") return [value];
			if (value && typeof value === "object") return Object.values(value);
			return [];
		})
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
}

function inferDeviceProfile(device: Record<string, unknown> | null | undefined, channels: Channel[]): DeviceProfile {
	const text = getTextTokens(
		device?.code,
		device?.name,
		device?.meta?.profile,
		device?.meta?.model,
		device?.meta?.device_type,
		device?.configuration
	);
	const channelCodes = new Set(channels.map((channel) => String(channel.code || "").toLowerCase()));

	if (
		text.includes("mmcgs") ||
		channelCodes.has("point1") ||
		channelCodes.has("point2") ||
		channelCodes.has("purge")
	) {
		return "mmcgs";
	}

	if (
		text.includes("cp500") ||
		channelCodes.has("tempin") ||
		channelCodes.has("tanktemp") ||
		channelCodes.has("heater") ||
		channelCodes.has("aeration")
	) {
		return "cp500-v3";
	}

	if (
		text.includes("smartcompost") ||
		text.includes("smart-compost") ||
		channelCodes.has("roomtemp") ||
		channelCodes.has("airtemp") ||
		channelCodes.has("airhumidity")
	) {
		return "smart-compost";
	}

	return "generic";
}

function getProfileLabel(profile: DeviceProfile): string {
	switch (profile) {
		case "cp500-v3":
			return "CP500 控制器";
		case "smart-compost":
			return "Smart Compost";
		case "mmcgs":
			return "MMCGS";
		default:
			return "通用设备";
	}
}

function getProfileDescription(profile: DeviceProfile): string {
	switch (profile) {
		case "cp500-v3":
			return "适合堆体控温场景，优先提供加热、循环泵和曝气的常用操作。";
		case "smart-compost":
			return "适合气体监测和气路控制场景，优先提供曝气、排气和重启操作。";
		case "mmcgs":
			return "适合多点采样设备，优先提供各采样点和清洗泵的直接操作。";
		default:
			return "这里保留基础控制；更复杂的命令请使用下方开发者工具。";
	}
}

function getConfigValue(source: unknown, path: string[]): unknown {
	let current: unknown = source;
	for (const key of path) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function getMmcgsPointIndex(code: string | null | undefined): number | null {
	if (!code) return null;
	const match = String(code).match(/-P(\d+)$/i);
	return match ? Number(match[1]) : null;
}

function getMmcgsControllerCode(code: string | null | undefined): string {
	if (!code) return "";
	return String(code).replace(/-P\d+$/i, "");
}

function getDeviceChannelValue(device: DeviceTreeItem | null | undefined, codes: string[]): string {
	if (!device?.channels?.length) return "-";
	for (const code of codes) {
		const channel = device.channels.find((item) => String(item.code || "").toLowerCase() === code.toLowerCase());
		const value = channel?.latest?.value;
		if (value !== undefined && value !== null && value !== "") {
			return `${value}${channel?.unit ? ` ${channel.unit}` : ""}`;
		}
	}
	return "-";
}

export default function DeviceDetailPage() {
	const params = useParams<{ id: string }>();
	const deviceId = Number(params.id);
	const router = useRouter();

	const screens = Grid.useBreakpoint();
	const isMobile = !screens.md;

	// ✅ 管理模式默认开启
	const [manage, setManage] = useState(true);

	// === 基础数据：device / channels ===
	const devicesQ = useDevicesTree(true);
	const allDevices = useMemo(() => devicesQ.data?.data || [], [devicesQ.data]);
	const device = useMemo(() => {
		return allDevices.find((d) => d.device_id === deviceId) || null;
	}, [allDevices, deviceId]);

	const channelsQ = useDeviceChannels(deviceId);
	const channelsFromApi: Channel[] = channelsQ.data || [];
	const channels: Channel[] = useMemo(() => {
		// 优先使用 /devices/<id>/channels（更"权威"），否则退回 tree 里的 channels
		if (channelsFromApi.length) return channelsFromApi;
		return device?.channels || [];
	}, [channelsFromApi, device?.channels]);

	const latestByCode = useMemo(() => {
		const m = new Map<string, any>();
		for (const ch of device?.channels || []) m.set(ch.code, ch.latest);
		return m;
	}, [device?.channels]);

	// ✅ /devices/<id>/channels 默认不带 latest，因此用 /devices/<id>/latest 补齐最新值
	const allCodes = useMemo(() => channels.map((c) => c.code).filter(Boolean), [channels]);
	const latestQ = useDeviceLatest(deviceId, allCodes);
	const latestMap = useMemo(() => {
		const m = new Map<string, any>();
		for (const row of (latestQ.data as any)?.data || []) {
			if (row?.code) m.set(String(row.code), row);
		}
		return m;
	}, [latestQ.data]);

	function getLatest(ch: Channel): any | null {
		return latestMap.get(ch.code) || (ch as any).latest || latestByCode.get(ch.code) || null;
	}

	const deviceProfile = useMemo(() => inferDeviceProfile(device, channels), [device, channels]);
	const mmcgsControllerCode = useMemo(() => getMmcgsControllerCode(String(device?.code || "")), [device?.code]);
	const mmcgsFamilyDevices = useMemo(() => {
		if (deviceProfile !== "mmcgs" || !mmcgsControllerCode) return [];
		return allDevices
			.filter((item) => getMmcgsControllerCode(String(item.code || "")) === mmcgsControllerCode)
			.sort((a, b) => {
				const aIndex = getMmcgsPointIndex(String(a.code || ""));
				const bIndex = getMmcgsPointIndex(String(b.code || ""));
				if (aIndex === null && bIndex === null) return String(a.code).localeCompare(String(b.code));
				if (aIndex === null) return -1;
				if (bIndex === null) return 1;
				return aIndex - bIndex;
			});
	}, [allDevices, deviceProfile, mmcgsControllerCode]);
	const mmcgsControllerDevice = useMemo(() => {
		if (deviceProfile !== "mmcgs") return null;
		return mmcgsFamilyDevices.find((item) => getMmcgsPointIndex(String(item.code || "")) === null) || device;
	}, [deviceProfile, mmcgsFamilyDevices, device]);
	const mmcgsPointDevices = useMemo(() => {
		if (deviceProfile !== "mmcgs") return [];
		return mmcgsFamilyDevices.filter((item) => getMmcgsPointIndex(String(item.code || "")) !== null);
	}, [deviceProfile, mmcgsFamilyDevices]);
	const effectiveConfigDevice = useMemo(() => {
		if (deviceProfile === "mmcgs") return mmcgsControllerDevice || device;
		return device;
	}, [deviceProfile, mmcgsControllerDevice, device]);
	const [quickDurationMinutes, setQuickDurationMinutes] = useState<number>(10);
	const [cp500AutoIntervalMinutes, setCp500AutoIntervalMinutes] = useState<number>(10);
	const [cp500AutoDurationMinutes, setCp500AutoDurationMinutes] = useState<number>(5);
	const [smartReadIntervalMinutes, setSmartReadIntervalMinutes] = useState<number>(10);
	const [mmcgsSampleSeconds, setMmcgsSampleSeconds] = useState<number>(60);

	// === Telemetry: metric(group) + channels selector（支持多通道对比） ===
	// activeMetric 既可以是标准 MetricKey（temperature/o2/...），也可以是自定义 metric:* 分组
	const [activeMetric, setActiveMetric] = useState<string>("");
	const [selectedCodes, setSelectedCodes] = useState<string[]>([]);

	const metricGroups = useMemo(() => groupChannelsByMetric(channels), [channels]);
	const activeMetricLabel = useMemo(() => {
		return metricGroups.find((g) => g.key === activeMetric)?.label || (activeMetric ? String(activeMetric) : "-");
	}, [metricGroups, activeMetric]);

	// 默认选第一个"存在的"分组，而不是强行预设温度/氧气
	useEffect(() => {
		if (!metricGroups.length) return;
		if (!activeMetric || !metricGroups.some((g) => g.key === activeMetric)) {
			setActiveMetric(metricGroups[0].key);
		}
	}, [metricGroups, activeMetric]);

	const metricChannels = useMemo(() => {
		const g = metricGroups.find((x) => x.key === activeMetric);
		return sortChannels(g?.channels || []);
	}, [metricGroups, activeMetric]);

	const primaryChannel = useMemo(() => {
		if (!channels?.length) return null;
		if (isKnownMetricKey(activeMetric)) return channelByMetric(channels, activeMetric as MetricKey);
		return metricChannels[0] || null;
	}, [channels, metricChannels, activeMetric]);

	// 避免首次渲染时的多重状态更新
	const isInitializedRef = useRef(false);

	// 当 metric 切换 / 通道加载完成时：默认勾选该 metric 下前几个通道，便于直接对比
	useEffect(() => {
		if (!isInitializedRef.current) {
			isInitializedRef.current = true;
			return;
		}
		if (!metricChannels.length) {
			setSelectedCodes([]);
			return;
		}
		const next = metricChannels.slice(0, 3).map((c) => c.code);
		setSelectedCodes(next);
	}, [activeMetric, metricChannels]);

	const effectiveCodes = useMemo(() => {
		if (selectedCodes.length) return selectedCodes;
		return [];
	}, [selectedCodes]);

	// time range
	const [range, setRange] = useState<[any, any] | null>(null);
	// bucket: "" 表示 raw
	const [bucket, setBucket] = useState<string>("");
	// 数据量限制
	const [dataLimit, setDataLimit] = useState<number>(5000);

	const from = range?.[0] ? fmt(range[0]) : null;
	const to = range?.[1] ? fmt(range[1]) : null;

	const telemetryQ = useDeviceTelemetry({
		deviceId,
		from,
		to,
		bucket: bucket ? bucket : null,
		channels: effectiveCodes.length ? effectiveCodes : null,
		limit: dataLimit,
	});
	const points = (telemetryQ.isSuccess && effectiveCodes.length > 0) ? (telemetryQ.data?.data || []) : [];

	// ✅ 按时间倒序排列（最新的在前），用于数据表展示
	const pointsDesc = useMemo(() => {
		return [...(points as any[])].sort((a, b) => {
			const tA = Date.parse(a.ts || "");
			const tB = Date.parse(b.ts || "");
			return tB - tA; // 降序
		});
	}, [points]);

	// 创建 code -> displayName 的映射
	const channelDisplayNameMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const ch of channels) {
			const displayName = getChannelDisplayName(ch);
			map.set(ch.code, displayName);
		}
		return map;
	}, [channels]);

	const chartOption = useMemo(() => {
		// group by code
		const byCode = new Map<string, Array<[string, number]>>();
		for (const p of points as any[]) {
			// 质量控制：筛掉无效质量的数据
			if (p.quality && ['ERR', 'NULL', 'INVALID', 'BAD'].includes(String(p.quality).toUpperCase())) {
				continue;
			}

			const code = p.code || "UNKNOWN";
			const v = typeof p.value === "number" ? p.value : Number(p.value);
			if (!Number.isFinite(v)) continue;
			if (!byCode.has(code)) byCode.set(code, []);
			byCode.get(code)!.push([p.ts, v]);
		}

		// sort by time (避免线段回折)
		for (const [, arr] of byCode) {
			arr.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
		}

		// 当数据点过少时，隐藏 slider（否则容易"挤到上面"）
		const uniqueTs = new Set<string>();
		for (const p of points as any[]) if (p?.ts) uniqueTs.add(String(p.ts));
		// 数据点太少时 slider 容易把布局"挤乱"（跑到上面）；这里设一个更稳的阈值
		const enableSlider = uniqueTs.size >= 6;

		const series = Array.from(byCode.entries()).map(([code, data]) => ({
			name: channelDisplayNameMap.get(code) || code,
			type: "line",
			smooth: true,
			showSymbol: data.length <= 1,
			symbolSize: 4,
			data,
		}));

		const dz = enableSlider
			? isMobile
				? [{ type: "inside" }]
				: [
					{ type: "inside" },
					// 固定在底部；bottom/height 与 grid.bottom 配套，避免太多空白
					{ type: "slider", xAxisIndex: 0, height: 16, bottom: 6 },
				]
			: [];

		return {
			tooltip: {
				trigger: "axis",
				formatter: (params: any) => {
					if (!Array.isArray(params) || params.length === 0) return '';
					const time = params[0].axisValue;
					let html = `<div style="margin-bottom: 4px; font-weight: bold;">${time}</div>`;
					params.forEach((p: any) => {
						const value = typeof p.value === 'number' ? p.value.toFixed(2) : p.value;
						html += `<div style="display: flex; align-items: center; margin: 2px 0;">
							<span style="display: inline-block; width: 10px; height: 10px; background: ${p.color}; border-radius: 50%; margin-right: 8px;"></span>
							<span style="flex: 1;">${p.seriesName}</span>
							<span style="font-weight: bold; margin-left: 12px;">${value}</span>
						</div>`;
					});
					return html;
				},
			},
			legend: { type: "scroll", top: 8, left: 0, right: 0 },
			grid: {
				left: 56,
				right: 18,
				top: 64,
				// slider 与坐标轴之间更紧凑
				bottom: isMobile ? 44 : enableSlider ? 46 : 40,
				containLabel: true,
			},
			xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 6 } },
			yAxis: { type: "value" },
			series,
			dataZoom: dz,
		};
	}, [points, isMobile, channelDisplayNameMap]);

	// 顶部 KPI：不再预设 4 个传感器，而是按设备实际通道分组展示（温度可多路）
	const kpiGroups = useMemo(() => {
		return metricGroups;
	}, [metricGroups]);

	// === Export ===
	async function exportCsv() {
		if (!device) return;
		try {
			const qs = buildQuery({
				from,
				to,
				channels: effectiveCodes.length ? effectiveCodes : null,
				bucket: bucket ? bucket : null,
			});

			const safeMetric = String(activeMetric || "metric").replace(/[^a-z0-9_-]+/gi, "_");
			await downloadBlob(
				api,
				`/devices/${deviceId}/export${qs}`,
				`device_${device.code}_${safeMetric}_${effectiveCodes.length ? `ch${effectiveCodes.length}` : "all"}.csv`,
				"text/csv;charset=utf-8"
			);
		} catch (e) {
			message.error(getErrorMessage(e, "导出失败"));
		}
	}

	// === Device CRUD ===
	const [deviceModalOpen, setDeviceModalOpen] = useState(false);
	const [deviceForm] = Form.useForm();
	const updateDevice = useUpdateDevice(deviceId);
	const deleteDevice = useDeleteDevice();

	function openDeviceEdit() {
		if (!device) return;
		deviceForm.resetFields();
		deviceForm.setFieldsValue({
			code: device.code,
			name: device.name || "",
			post_topic: device.post_topic || "",
			response_topic: device.response_topic || "",
			note: device.note || "",
			is_active: device.is_active !== false,
			meta: device.meta || {},
			configuration: device.configuration || {},
		});
		setDeviceModalOpen(true);
	}

	async function submitDevice() {
		try {
			const v = await deviceForm.validateFields();
			const body: any = {
				code: String(v.code || "").trim(),
				name: (v.name || "").trim() || null,
				post_topic: (v.post_topic || "").trim() || null,
				response_topic: (v.response_topic || "").trim() || null,
				note: (v.note || "").trim() || "",
				is_active: v.is_active !== false,
			};
			// 当meta为空时，显式设置为null以清空服务器端的meta
			if (!v.meta || Object.keys(v.meta).length === 0) {
				body.meta = null;
			} else {
				body.meta = v.meta;
			}
			// configuration 不在设备编辑中修改，仅在Control页面的配置编辑Modal中修改

			await updateDevice.mutateAsync(body);
			message.success("设备已保存");
			setDeviceModalOpen(false);
		} catch (err) {
			if ((err as any)?.errorFields) return;
			message.error(getErrorMessage(err, "保存失败"));
		}
	}

	function confirmDeleteDevice() {
		Modal.confirm({
			title: "确认删除该设备？",
			content: "删除后将无法恢复。",
			okText: "删除",
			okButtonProps: { danger: true },
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteDevice.mutateAsync({ device_id: deviceId });
					message.success("设备已删除");
					router.push("/devices");
				} catch (e) {
					message.error(getErrorMessage(e, "删除失败"));
				}
			},
		});
	}

	// === Channel CRUD ===
	const [channelModalOpen, setChannelModalOpen] = useState(false);
	const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
	const [channelForm] = Form.useForm();

	// ⚠️ 避免 antd 警告：不要在 Form 未挂载时调用 resetFields / setFieldsValue
	useEffect(() => {
		if (!channelModalOpen) return;
		channelForm.resetFields();
		if (editingChannel) {
			channelForm.setFieldsValue({
				code: editingChannel.code,
				name: editingChannel.name || "",
				display_name: editingChannel.display_name || "",
				metric: (editingChannel.metric as any) || "unknown",
				role: editingChannel.role || "",
				unit: editingChannel.unit || "",
				is_active: editingChannel.is_active !== false,
				meta: editingChannel.meta || {},
			});
		} else {
			channelForm.setFieldsValue({
				code: "",
				name: "",
				display_name: "",
				metric: activeMetric,
				role: "",
				unit: "",
				is_active: true,
				meta: {},
			});
		}
	}, [channelModalOpen, editingChannel, activeMetric, channelForm]);










	const createChannel = useCreateChannel(deviceId);
	const updateChannel = useUpdateChannel(deviceId, editingChannel?.channel_id || 0);
	const deleteChannel = useDeleteChannel(deviceId);

	function openChannelCreate() {
		setEditingChannel(null);
		setChannelModalOpen(true);
	}

	function openChannelEdit(ch: Channel) {
		setEditingChannel(ch);
		setChannelModalOpen(true);
	}

	async function submitChannel() {
		try {
			const v = await channelForm.validateFields();
			const body: any = {
				// code 统一转大写（与后端 normalizeCode 逻辑保持一致）
				code: String(v.code || "").trim().toUpperCase(),
				name: (v.name || "").trim() || null,
				display_name: (v.display_name || "").trim() || null,
				metric: (v.metric || "").trim() || null,
				role: (v.role || "").trim() || null,
				unit: (v.unit || "").trim() || null,
				is_active: v.is_active !== false,
			};
			// 当meta为空时，显式设置为null以清空服务器端的meta
			if (!v.meta || Object.keys(v.meta).length === 0) {
				body.meta = null;
			} else {
				body.meta = v.meta;
			}

			if (editingChannel) {
				await updateChannel.mutateAsync(body);
				message.success("通道已更新");
			} else {
				await createChannel.mutateAsync(body);
				message.success("通道已创建");
			}

			setChannelModalOpen(false);
		} catch (err) {
			if ((err as any)?.errorFields) return;
			message.error(getErrorMessage(err, "操作失败"));
		}
	}

	function confirmDeleteChannel(ch: Channel) {
		Modal.confirm({
			title: `确认删除通道 ${ch.code}？`,
			okText: "删除",
			okButtonProps: { danger: true },
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteChannel.mutateAsync({ channel_id: ch.channel_id });
					message.success("通道已删除");
				} catch (e) {
					message.error(getErrorMessage(e, "删除失败"));
				}
			},
		});
	}

	// === Commands ===
	const sendCmd = useSendDeviceCommand(deviceId);
	const commandsQ = useDeviceCommands(deviceId, 30);

	// 控制模板相关
	const templatesQ = useControlTemplates(deviceId, true);
	const createTemplate = useCreateControlTemplate();
	const deleteTemplate = useDeleteControlTemplate();
	const queryClient = useQueryClient();

	// === 设备配置管理 ===
	const [configModalOpen, setConfigModalOpen] = useState(false);
	const [configForm] = Form.useForm();
	const [configSubmitting, setConfigSubmitting] = useState(false);

	// === IP地理位置查询 ===
	const [ipLocation, setIpLocation] = useState<string>("");
	const [ipLocationLoading, setIpLocationLoading] = useState(false);

	// 查询IP地理位置
	async function fetchIpLocation(ip: string) {
		if (!ip || ipLocationLoading) return;
		setIpLocationLoading(true);
		try {
			const response = await fetch(`https://v2.xxapi.cn/api/ip?ip=${ip}`, {
				headers: {
					'User-Agent': 'xiaoxiaoapi/1.0.0'
				}
			});
			const data = await response.json();
			if (data.code === 200 && data.data?.address) {
				setIpLocation(data.data.address);
			} else {
				setIpLocation("未知位置");
			}
		} catch (e) {
			console.error("IP地理位置查询失败:", e);
			setIpLocation("查询失败");
		} finally {
			setIpLocationLoading(false);
		}
	}

	// 打开配置编辑
	function openConfigEdit() {
		if (!effectiveConfigDevice) return;
		if (deviceProfile === "mmcgs" && effectiveConfigDevice.device_id !== deviceId) {
			message.info(`MMCGS 配置统一在控制器 ${effectiveConfigDevice.code} 上维护，正在跳转。`);
			router.push(`/devices/${effectiveConfigDevice.device_id}`);
			return;
		}
		configForm.resetFields();
		configForm.setFieldsValue({
			configuration: effectiveConfigDevice.configuration || {},
		});
		setConfigModalOpen(true);
	}

	// 提交配置修改
	async function submitConfig() {
		setConfigSubmitting(true);
		try {
			const v = await configForm.validateFields();
			const body: any = {
				// 当configuration为空时，显式设置为null以清空服务器端的configuration
				configuration: (!v.configuration || Object.keys(v.configuration).length === 0) ? null : v.configuration,
			};

			await updateDevice.mutateAsync(body);
			message.success("设备配置已保存");
			setConfigModalOpen(false);
		} catch (err) {
			if ((err as any)?.errorFields) return;
			message.error(getErrorMessage(err, "保存失败"));
		} finally {
			setConfigSubmitting(false);
		}
	}

	const [templateModalOpen, setTemplateModalOpen] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<any>(null);
	const [templateForm] = Form.useForm();
	const [templateSubmitting, setTemplateSubmitting] = useState(false);

	const [cmdJson, setCmdJson] = useState<string>(
		JSON.stringify({ commands: [] }, null, 2)
	);

	// 从保存的模板插入命令
	function insertSavedTemplate(template: any) {
		setCmdJson(JSON.stringify(template.payload, null, 2));
	}

	// 打开模板编辑/新建
	function openTemplateEdit(template?: any) {
		setEditingTemplate(template || null);
		setTemplateModalOpen(true);
		// 注意：setFieldsValue 需要在 Modal 打开后 Form 挂载后再调用
	}

	// 当 Modal 打开时设置表单值
	useEffect(() => {
		if (!templateModalOpen) return;
		templateForm.resetFields();
		if (editingTemplate) {
			templateForm.setFieldsValue({
				name: editingTemplate.name,
				description: editingTemplate.description || "",
				payload: typeof editingTemplate.payload === 'string'
					? editingTemplate.payload
					: JSON.stringify(editingTemplate.payload, null, 2),
				is_active: editingTemplate.is_active,
				is_global: editingTemplate.device_id === null,
			});
		} else {
			templateForm.setFieldsValue({
				name: "",
				description: "",
				payload: JSON.stringify({ commands: [] }, null, 2),
				is_active: true,
				is_global: false,
			});
		}
	}, [templateModalOpen, editingTemplate]);

	// 查询IP地理位置
	useEffect(() => {
		if (device?.ip_address) {
			fetchIpLocation(device.ip_address);
		}
	}, [device?.ip_address]);

	// 更新模板（内部调用）
	async function updateTemplate(id: number, data: any) {
		const res = await api.patch(`/control-templates/${id}`, data);
		return res.data;
	}

	// 提交模板
	async function submitTemplate() {
		setTemplateSubmitting(true);
		try {
			const v = await templateForm.validateFields();
			const body: any = {
				name: v.name.trim(),
				description: v.description?.trim() || "",
				payload: v.payload,
				is_active: v.is_active !== false,
				device_id: v.is_global ? null : deviceId,
			};

			if (editingTemplate) {
				await updateTemplate(editingTemplate.id, body);
				message.success("模板已更新");
			} else {
				await createTemplate.mutateAsync(body);
				message.success("模板已创建");
			}
			// 刷新列表
			queryClient.invalidateQueries({ queryKey: ["control-templates"] });
			setTemplateModalOpen(false);
		} catch (err) {
			if ((err as any)?.errorFields) return;
			message.error(getErrorMessage(err, "操作失败"));
		} finally {
			setTemplateSubmitting(false);
		}
	}

	// 删除模板
	function confirmDeleteTemplate(template: any) {
		Modal.confirm({
			title: `确认删除模板 "${template.name}"？`,
			okText: "删除",
			okButtonProps: { danger: true },
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteTemplate.mutateAsync(template.id);
					message.success("模板已删除");
				} catch (e) {
					message.error(getErrorMessage(e, "删除失败"));
				}
			},
		});
	}

	async function sendCommand() {
		if (!device) return;

		let body: CmdBody;
		try {
			body = JSON.parse(cmdJson);
		} catch {
			message.error("命令 JSON 格式错误");
			return;
		}

		if (!body?.commands || !Array.isArray(body.commands) || body.commands.length === 0) {
			message.error("commands 必须是非空数组");
			return;
		}

		try {
			await sendCmd.mutateAsync(body);
			message.success("已下发（MQTT publish 已触发）");
		} catch (e) {
			message.error(getErrorMessage(e, "下发失败"));
		}
	}

	async function sendQuickCommands(commands: Record<string, unknown>[], successText: string) {
		if (!device || !commands.length) return;
		try {
			await sendCmd.mutateAsync({ commands });
			message.success(successText);
		} catch (e) {
			message.error(getErrorMessage(e, "下发失败"));
		}
	}

	async function sendQuickToggle(command: string, action: "on" | "off", durationMs?: number) {
		const body: Record<string, unknown> = { command, action };
		if (durationMs && durationMs > 0) body.duration = durationMs;
		await sendQuickCommands([body], `${command} 已${action === "on" ? "开启" : "关闭"}`);
	}

	async function sendQuickConfigUpdate(config: Record<string, unknown>, successText: string) {
		await sendQuickCommands([{ command: "config_update", config }], successText);
	}

	// === Channels table ===
	const channelRows = useMemo(() => {
		// 先按 metric 分组，然后对每个组内的通道进行排序
		const groups = groupChannelsByMetric(channels);
		// 展平所有分组，每个组内的通道已排序
		const sortedChannels = groups.flatMap((g) => sortChannels(g.channels));
		return sortedChannels;
	}, [channels]);
	const channelColumns: any[] = [
		{
			title: "名称",
			key: "name",
			render: (_: any, r: Channel) => {
				const displayName = getChannelDisplayName(r);
				return (
					<Space orientation="vertical" size={0}>
						<Text strong>{displayName}</Text>
						<Text type="secondary" style={{ fontSize: 12 }}>
							{r.code}
						</Text>
					</Space>
				);
			},
		},
		{
			title: "Metric",
			dataIndex: "metric",
			key: "metric",
			render: (v: any) => {
				const norm = normalizeMetric(v);
				return <Tag>{norm !== "unknown" ? metricLabel(norm) : "-"}</Tag>;
			},
		},
		{
			title: "Unit",
			dataIndex: "unit",
			key: "unit",
		},
		{
			title: "Active",
			dataIndex: "is_active",
			key: "is_active",
			render: (v: any) => (v === false ? <Tag color="red">OFF</Tag> : <Tag color="green">ON</Tag>),
		},
		{
			title: "Latest",
			key: "latest",
			render: (_: any, r: Channel) => {
				const l = getLatest(r);
				if (!l) return <Text type="secondary">-</Text>;
				return (
					<Space orientation="vertical" size={0}>
						<Text>
							{l.value ?? "-"} {r.unit || l.unit || ""}
						</Text>
						<Text type="secondary" style={{ fontSize: 12 }}>
							{l.ts || "-"}
						</Text>
					</Space>
				);
			},
		},
		{
			title: "操作",
			key: "actions",
			render: (_: any, r: Channel) => (
				<Space size={6} wrap>
					<Button
						size="small"
						onClick={() => {
							setActiveMetric(getChannelGroupKey(r));
							setSelectedCodes([r.code]);
						}}
					>
						查看
					</Button>
					{manage && (
						<>
							<Button size="small" onClick={() => openChannelEdit(r)}>
								编辑
							</Button>
							<Button size="small" danger onClick={() => confirmDeleteChannel(r)}>
								删除
							</Button>
						</>
					)}
				</Space>
			),
		},
	];

	const controlStatusChannels = useMemo(() => {
		const preferredCodes =
			deviceProfile === "cp500-v3"
				? ["TempIn", "TankTemp", "Heater", "Pump", "Aeration", "EmergencyState"]
				: deviceProfile === "smart-compost"
					? ["CO2", "O2", "AirTemp", "AirHumidity"]
					: deviceProfile === "mmcgs"
						? ["CO2", "Temp", "Humidity", "Pump"]
						: [];

		const fromPreferred = preferredCodes
			.map((code) => channels.find((channel) => channel.code === code))
			.filter((channel): channel is Channel => Boolean(channel));

		if (fromPreferred.length) return fromPreferred;

		return channels
			.filter((channel) => normalizeMetric(channel.metric as any) !== "unknown")
			.slice(0, 5);
	}, [channels, deviceProfile]);

	const controlStatusMap = useMemo(() => {
		const map = new Map<string, { label: string; value: string; active: boolean; tone: string }>();
		for (const channel of controlStatusChannels) {
			const latest = getLatest(channel);
			const metric = normalizeMetric(channel.metric as any);
			const rawValue = latest?.value;
			let value = rawValue ?? "-";
			let active = false;
			let tone = "#d9d9d9";

			if (channel.code === "EmergencyState") {
				active = Number(rawValue) > 0;
				value = active ? "急停中" : "正常";
				tone = active ? "#ff4d4f" : "#52c41a";
			} else if (metric === "switch") {
				active = Number(rawValue) > 0;
				value = active ? "开启" : "关闭";
				tone = active ? "#1677ff" : "#bfbfbf";
			} else if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
				value = `${rawValue}${channel.unit ? ` ${channel.unit}` : ""}`;
				tone = "#1677ff";
			}

			map.set(channel.code, {
				label: getChannelDisplayName(channel),
				value: String(value),
				active,
				tone,
			});
		}
		return map;
	}, [controlStatusChannels, latestMap]);

	const profileConfigSummary = useMemo(() => {
		const configuration = effectiveConfigDevice?.configuration || {};
		switch (deviceProfile) {
			case "cp500-v3":
				return [
					{ label: "定时曝气", value: getConfigValue(configuration, ["aeration_timer", "enabled"]) ? "启用" : "停用" },
					{ label: "曝气间隔", value: getConfigValue(configuration, ["aeration_timer", "interval"]) ? `${Math.round(Number(getConfigValue(configuration, ["aeration_timer", "interval"])) / 60000)} 分钟` : "-" },
					{ label: "曝气时长", value: getConfigValue(configuration, ["aeration_timer", "duration"]) ? `${Math.round(Number(getConfigValue(configuration, ["aeration_timer", "duration"])) / 60000)} 分钟` : "-" },
					{ label: "加热最短开机", value: getConfigValue(configuration, ["heater_guard", "min_on_ms"]) ? `${Math.round(Number(getConfigValue(configuration, ["heater_guard", "min_on_ms"])) / 1000)} 秒` : "-" },
				];
			case "smart-compost":
				return [
					{ label: "抽气时长", value: configuration.pump_run_time ? `${Math.round(Number(configuration.pump_run_time) / 1000)} 秒` : "-" },
					{ label: "采集周期", value: configuration.read_interval ? `${Math.round(Number(configuration.read_interval) / 1000)} 秒` : "-" },
				];
			case "mmcgs":
				return [
					{ label: "采样泵时长", value: configuration.sample_pump_time ? `${Math.round(Number(configuration.sample_pump_time) / 1000)} 秒` : "-" },
					{ label: "清洗泵时长", value: configuration.purge_pump_time ? `${Math.round(Number(configuration.purge_pump_time) / 1000)} 秒` : "-" },
					{ label: "轮询周期", value: configuration.read_interval ? `${Math.round(Number(configuration.read_interval) / 1000)} 秒` : "-" },
				];
			default:
				return Object.entries(configuration)
					.slice(0, 4)
					.map(([label, value]) => ({
						label,
						value: typeof value === "object" ? JSON.stringify(value) : String(value),
					}));
		}
	}, [effectiveConfigDevice?.configuration, deviceProfile]);

	useEffect(() => {
		const configuration = effectiveConfigDevice?.configuration || {};
		const cpInterval = Number(getConfigValue(configuration, ["aeration_timer", "interval"]));
		const cpDuration = Number(getConfigValue(configuration, ["aeration_timer", "duration"]));
		const smartInterval = Number(configuration.read_interval);
		const mmcgsSample = Number(configuration.sample_pump_time);

		if (Number.isFinite(cpInterval) && cpInterval > 0) {
			setCp500AutoIntervalMinutes(Math.max(1, Math.round(cpInterval / 60000)));
		}
		if (Number.isFinite(cpDuration) && cpDuration > 0) {
			setCp500AutoDurationMinutes(Math.max(1, Math.round(cpDuration / 60000)));
		}
		if (Number.isFinite(smartInterval) && smartInterval > 0) {
			setSmartReadIntervalMinutes(Math.max(1, Math.round(smartInterval / 60000)));
		}
		if (Number.isFinite(mmcgsSample) && mmcgsSample > 0) {
			setMmcgsSampleSeconds(Math.max(5, Math.round(mmcgsSample / 1000)));
		}
	}, [effectiveConfigDevice?.configuration]);

	const durationSliderMarks = {
		1: "1m",
		10: "10m",
		30: "30m",
		60: "60m",
	};

	const cp500IntervalMarks = {
		5: "5m",
		15: "15m",
		30: "30m",
		60: "60m",
	};

	const cp500DurationMarks = {
		1: "1m",
		5: "5m",
		10: "10m",
		20: "20m",
	};

	const mmcgsSampleMarks = {
		5: "5s",
		30: "30s",
		60: "60s",
		120: "120s",
		180: "180s",
	};


	// === 分开的数据表tab管理 ===
	const [activeDataTableTab, setActiveDataTableTab] = useState<string>("all");

	// === Loading / Not found ===
	if (devicesQ.isLoading) {
		return (
			<div style={{ padding: 48 }}>
				<Spin />
			</div>
		);
	}

	if (!device) {
		return (
			<div style={{ padding: 24 }}>
				<Text type="secondary">Device not found.</Text>
			</div>
		);
	}

	return (
		<Page
			title={device.name || device.code}
			extra={
				<Space wrap>
					<Button onClick={() => router.back()}>返回</Button>
					<Tag color="blue">{device.code}</Tag>
					<Tag>{device.is_active === false ? "Inactive" : "Active"}</Tag>

					<Space size={6}>
						<Text type="secondary">管理</Text>
						<Switch checked={manage} onChange={setManage} />
					</Space>

					<Button onClick={exportCsv}>导出 CSV</Button>

					{manage && (
						<>
							<Button onClick={openDeviceEdit}>编辑设备</Button>
							<Button danger onClick={confirmDeleteDevice}>
								删除设备
							</Button>
							<Button type="primary" onClick={openChannelCreate}>
								新建通道
							</Button>
						</>
					)}
				</Space>
			}
		>
			{/* 设备信息展示区 */}
			{device && (
				<Card size="small" style={{ marginBottom: 12 }}>
					<Row gutter={[16, 12]}>
						{/* 基本信息 */}
							<Col xs={24} sm={12} md={6}>
								<Space orientation="vertical" size={6} style={{ width: '100%' }}>
									<Space wrap size={8}>
										<Text strong style={{ fontSize: 14 }}>{device.name || '-'}</Text>
										<Tag color="blue">{device.code}</Tag>
										<Tag color={device.is_active === false ? 'red' : 'green'}>
											{device.is_active === false ? '未激活' : '已激活'}
										</Tag>
										<Tag color={deviceProfile === "cp500-v3" ? "blue" : deviceProfile === "smart-compost" ? "green" : deviceProfile === "mmcgs" ? "purple" : "default"}>
											{getProfileLabel(deviceProfile)}
										</Tag>
										{deviceProfile === "mmcgs" ? (
											<Tag color="purple">
												{getMmcgsPointIndex(String(device.code || "")) !== null ? `点位 P${getMmcgsPointIndex(String(device.code || ""))}` : "控制器"}
											</Tag>
										) : null}
									</Space>
									<Text type="secondary">通道: {channels.length}</Text>
									{device.ip_address && (
										<Text type="secondary">
											IP: {device.ip_address}
											{ipLocation && (
												<>
													{ipLocationLoading && <Spin size="small" style={{ marginLeft: 4 }} />}
													{!ipLocationLoading && ipLocation && <span style={{ marginLeft: 8 }}>({ipLocation})</span>}
												</>
											)}
										</Text>
									)}
								</Space>
							</Col>

						{/* 注册信息 */}
						{(device.register_at || device.last_seen_at) && (
							<Col xs={24} sm={12} md={6}>
								<div>
									<Text type="secondary" style={{ fontSize: 12 }}>注册信息</Text>
									<Space orientation="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
										{device.register_at && (
											<Text type="secondary" style={{ fontSize: 12 }}>
												注册: {device.register_at}
											</Text>
										)}
										{device.last_seen_at && (
											<Text type="secondary" style={{ fontSize: 12 }}>
												上线: {device.last_seen_at}
											</Text>
										)}
									</Space>
								</div>
							</Col>
						)}

						{/* 备注 */}
						{device.note && (
							<Col xs={24} sm={12} md={6}>
								<div>
									<Text type="secondary" style={{ fontSize: 12 }}>备注</Text>
									<Text type="secondary" style={{ display: 'block', marginTop: 4, whiteSpace: 'pre-wrap', fontSize: 13 }}>
										{device.note}
									</Text>
								</div>
							</Col>
						)}

						{/* 元数据 */}
						{device.meta && Object.keys(device.meta).length > 0 && (
							<Col xs={24} sm={12} md={6}>
								<div>
									<Text type="secondary" style={{ fontSize: 12 }}>元数据</Text>
									<Space orientation="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
										{Object.entries(device.meta).map(([key, value]) => (
											<div key={key} style={{ display: 'flex', gap: 8 }}>
												<Text style={{ fontSize: 12, minWidth: 80 }}>{key}:</Text>
												<Text type="secondary" style={{ fontSize: 12 }}>
													{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
												</Text>
											</div>
										))}
									</Space>
								</div>
							</Col>
						)}
					</Row>
				</Card>
			)}

			{deviceProfile === "mmcgs" && mmcgsFamilyDevices.length > 0 && (
				<Card
					size="small"
					title="MMCGS 快速切换"
					style={{ marginBottom: 12, borderRadius: 16, background: "#fafcff" }}
				>
					<Space direction="vertical" size={10} style={{ width: "100%" }}>
						<Text type="secondary">
							当前系统：{mmcgsControllerCode}。配置统一在控制器维护，数据可按点位快速切换查看。
						</Text>
						<Space wrap size={8}>
							{mmcgsControllerDevice ? (
								<Button
									type={mmcgsControllerDevice.device_id === deviceId ? "primary" : "default"}
									style={{ borderRadius: 999 }}
									onClick={() => router.push(`/devices/${mmcgsControllerDevice.device_id}`)}
								>
									控制器
								</Button>
							) : null}
							{mmcgsPointDevices.map((pointDevice) => {
								const pointIndex = getMmcgsPointIndex(String(pointDevice.code || ""));
								const isCurrent = pointDevice.device_id === deviceId;
								return (
									<Button
										key={pointDevice.device_id}
										type={isCurrent ? "primary" : "default"}
										style={{ borderRadius: 999 }}
										onClick={() => router.push(`/devices/${pointDevice.device_id}`)}
									>
										{`P${pointIndex ?? "?"}`}
									</Button>
								);
							})}
						</Space>
						<Text type="secondary" style={{ fontSize: 12 }}>
							当前页面：{getMmcgsPointIndex(String(device.code || "")) ? `点位 P${getMmcgsPointIndex(String(device.code || ""))}` : "控制器"}
						</Text>
					</Space>
				</Card>
			)}

			<Tabs
				defaultActiveKey="telemetry"
				items={[
					{
						key: "telemetry",
						label: "Telemetry",
						children: (
							<>
								{/* KPI - 紧凑布局 */}
								<Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
									{kpiGroups.map((g) => {
										const latestTs = g.channels
											.map((c) => getLatest(c)?.ts)
											.filter(Boolean)
											.sort()
											.pop();

										const metricColor = getMetricColor(g.key as MetricKey);
										const isSelected = g.key === activeMetric;

										return (
											<Col xs={24} sm={12} md={8} lg={6} xl={6} xxl={4} key={g.key}>
												<Card
													size="small"
													hoverable
													onClick={() => {
														// 只切换 metric，不重置 selectedCodes
														if (activeMetric !== g.key) {
															setActiveMetric(g.key);
														}
													}}
													style={{
														cursor: "pointer",
														border: isSelected ? `2px solid ${metricColor}` : "1px solid #f0f0f0",
														borderRadius: 6,
														transition: "all 0.3s",
														background: isSelected ? "rgba(22,119,255,0.02)" : undefined,
													}}
													styles={{ body: { padding: "8px 12px" } }}
												>
													<Space
														style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}
														size={4}
													>
														<Text style={{
															fontSize: 13,
															fontWeight: 600,
															color: isSelected ? metricColor : undefined
														}}>
															{g.label}
														</Text>
														<Space size={2}>
															<Tag color={isSelected ? metricColor : "default"} style={{ margin: 0, fontSize: 11, padding: '0 4px' }}>
																{g.channels.length}
															</Tag>
															<Button
																size="small"
																type="text"
																onClick={(e) => {
																	e.stopPropagation();
																	// 判断当前是否已全选
																	const allCodes = g.channels.map(c => c.code);
																	const allSelected = allCodes.every(code => selectedCodes.includes(code));
																	if (allSelected) {
																		// 全不选
																		setSelectedCodes(selectedCodes.filter(c => !allCodes.includes(c)));
																	} else {
																		// 全选
																		const newCodes = new Set(selectedCodes);
																		allCodes.forEach(code => newCodes.add(code));
																		setSelectedCodes(Array.from(newCodes));
																	}
																}}
																style={{ padding: "0 4px", fontSize: 11, height: "auto", lineHeight: "20px" }}
															>
																{(() => {
																	const allCodes = g.channels.map(c => c.code);
																	const allSelected = allCodes.every(code => selectedCodes.includes(code));
																	return allSelected ? "全不选" : "全选";
																})()}
															</Button>
														</Space>
													</Space>

													<div
														style={{
															display: "grid",
															gap: 2,
															maxHeight: 140,
															overflowY: g.channels.length > 6 ? "auto" : "visible",
															paddingRight: g.channels.length > 6 ? 4 : 0,
														}}
													>
														{sortChannels(g.channels).map((ch) => {
															const l = getLatest(ch);
															const v =
																l && l.value !== undefined
																	? l.value
																	: ch.latest?.value;
															const u = ch.unit || l?.unit || "";
															const isCodeSelected = selectedCodes.includes(ch.code);

															return (
																<div
																	key={ch.code}
																	onClick={(e) => {
																		e.stopPropagation();
																		// 切换 channel 选中状态（多选）
																		const newCodes = selectedCodes.includes(ch.code)
																			? selectedCodes.filter(c => c !== ch.code)
																			: [...selectedCodes, ch.code];
																		setSelectedCodes(newCodes);
																	}}
																	style={{
																		display: "flex",
																		justifyContent: "space-between",
																		gap: 6,
																		alignItems: "center",
																		padding: "4px 6px",
																		borderRadius: 3,
																		background: isCodeSelected ? `rgba(${parseInt(metricColor.slice(1, 3), 16)}, ${parseInt(metricColor.slice(3, 5), 16)}, ${parseInt(metricColor.slice(5, 7), 16)}, 0.1)` : "#fafafa",
																		border: isCodeSelected ? `1px solid ${metricColor}` : "1px solid transparent",
																		transition: "all 0.2s",
																		cursor: "pointer",
																	}}
																	onMouseEnter={(e) => {
																		e.currentTarget.style.background = "#f0f5ff";
																	}}
																	onMouseLeave={(e) => {
																		e.currentTarget.style.background = isCodeSelected ? `rgba(${parseInt(metricColor.slice(1, 3), 16)}, ${parseInt(metricColor.slice(3, 5), 16)}, ${parseInt(metricColor.slice(5, 7), 16)}, 0.1)` : "#fafafa";
																	}}
																>
																	<Text
																		type="secondary"
																		style={{
																			fontSize: 11,
																			minWidth: 0,
																			flex: 1,
																			overflow: "hidden",
																			textOverflow: "ellipsis",
																			whiteSpace: "nowrap",
																			color: "#666",
																		}}
																	>
																		{getChannelDisplayName(ch)}
																	</Text>
																	<Text style={{
																		fontSize: 12,
																		fontWeight: 600,
																		color: "#262626",
																		whiteSpace: "nowrap",
																	}}>
																		{v !== undefined && v !== null ? v : "-"}{" "}
																		<Text type="secondary" style={{ fontSize: 10, fontWeight: 400 }}>
																			{u}
																		</Text>
																	</Text>
																</div>
															);
														})}
													</div>

													<div style={{ width: "100%", marginTop: 6, paddingTop: 4, borderTop: "1px solid #f0f0f0" }}>
														<Text
															type="secondary"
															style={{
																fontSize: 10,
																color: "#999",
																whiteSpace: "nowrap",
															}}
														>
															{latestQ.isFetching ? "加载中..." : latestTs ? `更新: ${latestTs}` : "暂无数据"}
														</Text>
													</div>
												</Card>
											</Col>
										);
									})}
								</Row>

								<Row gutter={[8, 8]}>
									{/* Chart */}
									<Col xs={24} md={24}>
										<Card size="small">
											<Space orientation="vertical" style={{ width: "100%" }} size={8}>
												<Tabs
													activeKey={activeMetric}
													onChange={(k) => setActiveMetric(k)}
													items={metricGroups.map((g) => ({ key: g.key, label: g.label }))}
													size="small"
												/>

												<Space wrap size={8}>
													<DatePicker.RangePicker
														size="small"
														showTime
														value={range as any}
														onChange={(v) => setRange(v as any)}
														style={{ width: isMobile ? "100%" : 340 }}
														presets={[
															{
																label: '最近1小时',
																value: [dayjs().subtract(1, 'hour'), dayjs()],
															},
															{
																label: '今天',
																value: [dayjs().startOf('day'), dayjs()],
															},
															{
																label: '最近7天',
																value: [dayjs().subtract(7, 'day'), dayjs()],
															},
															{
																label: '最近30天',
																value: [dayjs().subtract(30, 'day'), dayjs()],
															},
														]}
													/>

													<Select
														size="small"
														style={{ width: 100 }}
														value={bucket}
														onChange={setBucket}
														options={[
															{ value: "", label: "raw" },
															{ value: "1m", label: "1m" },
															{ value: "10m", label: "10m" },
															{ value: "1h", label: "1h" },
														]}
													/>

													<Select
														size="small"
														style={{ width: 100 }}
														value={dataLimit}
														onChange={setDataLimit}
														options={[
															{ value: 1000, label: "1K" },
															{ value: 5000, label: "5K" },
															{ value: 10000, label: "10K" },
															{ value: 20000, label: "20K" },
															{ value: 50000, label: "50K" },
														]}
													/>

												<Space.Compact size="small" style={{ width: isMobile ? "100%" : 360 }}>
													<Select
														size="small"
														style={{ width: "100%" }}
														mode="multiple"
														value={selectedCodes}
														placeholder="选择通道（可多选，用于对比）"
														options={metricChannels.map((c) => ({
															value: c.code,
															label: `${c.code}${c.display_name ? ` · ${c.display_name}` : ""}${c.unit ? ` (${c.unit})` : ""}`,
														}))}
														onChange={(v) => setSelectedCodes((v as string[]) || [])}
														allowClear
														maxTagCount="responsive"
													/>
													<Button
														size="small"
														onClick={() => setSelectedCodes(metricChannels.map((c) => c.code))}
														disabled={!metricChannels.length}
													>
														全选
													</Button>
													<Button
														size="small"
														onClick={() => setSelectedCodes(primaryChannel?.code ? [primaryChannel.code] : [])}
														disabled={!primaryChannel?.code}
													>
														仅主通道
													</Button>
												</Space.Compact>

											<Tag color="blue" style={{ fontSize: 12 }}>
												当前：{effectiveCodes.length ? `${effectiveCodes.length} 个通道` : "-"}（{activeMetricLabel}）
											</Tag>
												</Space>

									<div style={{ height: 520 }}>
										<ReactECharts
											key={`${deviceId}-${activeMetric}-${effectiveCodes.join(",")}-${bucket}-${from || ""}-${to || ""}`}
											option={chartOption}
											notMerge
											lazyUpdate
											style={{ height: "100%", width: "100%" }}
										/>
									</div>

											{telemetryQ.isFetching && <Text type="secondary">加载中...</Text>}
											{telemetryQ.isError && <Text type="danger">Telemetry 加载失败</Text>}
											{!telemetryQ.isFetching && !points.length && (
												<Text type="secondary">暂无数据（检查时间范围 / bucket / 通道）</Text>
											)}

											<Divider style={{ margin: "4px 0" }} />
											<Text type="secondary">数据表（{points.length}）</Text>
											<Tabs
												activeKey={activeDataTableTab}
												onChange={setActiveDataTableTab}
												items={[
													{
														key: "all",
														label: `全部 (${points.length})`,
														children: (
															<Table
																size="small"
																rowKey={(r: any) => `${r.device_id || deviceId}-${r.code}-${r.ts}-${r.value}`}
																dataSource={pointsDesc as any}
																pagination={{
																	pageSize: 50,
																	showSizeChanger: true,
																	pageSizeOptions: [20, 50, 100],
																	showTotal: (total) => `共 ${total} 条`,
																}}
																scroll={{ x: 900 }}
																columns={[
																	{ title: "时间", dataIndex: "ts", key: "ts", width: 180 },
																	{
																		title: "通道",
																		dataIndex: "code",
																		key: "code",
																		width: 160,
																		render: (code: string) => {
																			const ch = channels.find(c => c.code === code);
																			return ch ? getChannelDisplayName(ch) : code;
																		},
																	},
																	{
																		title: "数值",
																		dataIndex: "value",
																		key: "value",
																		width: 140,
																		render: (v: any) => (typeof v === "number" ? v : Number(v)),
																	},
																	{ title: "单位", dataIndex: "unit", key: "unit", width: 100 },
																	{
																		title: "质量",
																		dataIndex: "quality",
																		key: "quality",
																		width: 120,
																		render: (_: any, r: any) => {
																			if (r && r.quality) return r.quality;
																			return "-";
																		},
																	},
																	{
																		title: "来源",
																		dataIndex: "source",
																		key: "source",
																		render: (_: any, r: any) => {
																			if (r && r.source) return r.source;
																			return "-";
																		},
																	},
																]}
															/>
														),
													},
													...effectiveCodes.map((code) => {
														const ch = channels.find(c => c.code === code);
														const displayName = ch ? getChannelDisplayName(ch) : code;
														return {
															key: code,
															label: `${displayName} (${pointsDesc.filter((p: any) => p.code === code).length})`,
															children: (
															<Table
																size="small"
																rowKey={(r: any) => `${r.device_id || deviceId}-${r.code}-${r.ts}-${r.value}`}
																dataSource={pointsDesc.filter((p: any) => p.code === code) as any}
																pagination={{
																	pageSize: 50,
																	showSizeChanger: true,
																	pageSizeOptions: [20, 50, 100],
																	showTotal: (total) => `共 ${total} 条`,
																}}
																scroll={{ x: 900 }}
																columns={[
																	{ title: "时间", dataIndex: "ts", key: "ts", width: 180 },
																	{
																		title: "数值",
																		dataIndex: "value",
																		key: "value",
																		width: 140,
																		render: (v: any) => (typeof v === "number" ? v : Number(v)),
																	},
																	{ title: "单位", dataIndex: "unit", key: "unit", width: 100 },
																	{
																		title: "质量",
																		dataIndex: "quality",
																		key: "quality",
																		width: 120,
																		render: (_: any, r: any) => {
																			if (r && r.quality) return r.quality;
																			return "-";
																		},
																	},
																	{
																		title: "来源",
																		dataIndex: "source",
																		key: "source",
																		render: (_: any, r: any) => {
																			if (r && r.source) return r.source;
																			return "-";
																		},
																	},
																]}
															/>
														),
													};
													}),
												]}
											/>
											</Space>
										</Card>
									</Col>
								</Row>
							</>
						),
					},
					{
						key: "channels",
						label: "Channels",
						children: (
							<Card
								title="通道列表"
								extra={
									manage ? (
										<Button type="primary" onClick={openChannelCreate}>
											新建通道
										</Button>
									) : null
								}
							>
								<Space orientation="vertical" style={{ width: "100%" }} size={10}>
									<Text type="secondary">
										说明：metric/role/display_name 用于把原始 code 映射到"温度/氧气/二氧化碳/含水率"等语义层。
									</Text>
									<Table
										rowKey="channel_id"
										columns={channelColumns}
										dataSource={channelRows}
										pagination={{ pageSize: 12, hideOnSinglePage: true }}
										size="small"
										scroll={isMobile ? { x: 820 } : undefined}
										loading={channelsQ.isLoading}
									/>
								</Space>
							</Card>
						),
					},
					{
						key: "control",
						label: "Control",
						children: (
							<Row gutter={[12, 12]}>
								{deviceProfile === "mmcgs" && (
									<Col xs={24}>
										<Card
											title="MMCGS 系统总览"
											style={{ borderRadius: 20, background: "linear-gradient(135deg, #f7fbff 0%, #f9f7ff 100%)" }}
										>
											<Space direction="vertical" size={14} style={{ width: "100%" }}>
												<Row gutter={[12, 12]}>
													<Col xs={24} lg={8}>
														<Card
															size="small"
															title="控制器"
															style={{ borderRadius: 16 }}
															extra={
																mmcgsControllerDevice && mmcgsControllerDevice.device_id !== deviceId ? (
																	<Button size="small" onClick={() => router.push(`/devices/${mmcgsControllerDevice.device_id}`)}>
																		前往控制器
																	</Button>
																) : null
															}
														>
															<Space direction="vertical" size={8} style={{ width: "100%" }}>
																<Text strong>{mmcgsControllerDevice?.name || mmcgsControllerCode}</Text>
																<Text type="secondary">设备编码：{mmcgsControllerCode}</Text>
																<Text type="secondary">点位数量：{mmcgsPointDevices.length}</Text>
																<Text type="secondary">采样泵时长：{mmcgsControllerDevice?.configuration?.sample_pump_time ? `${Math.round(Number(mmcgsControllerDevice.configuration.sample_pump_time) / 1000)} 秒` : "-"}</Text>
																<Text type="secondary">清洗泵时长：{mmcgsControllerDevice?.configuration?.purge_pump_time ? `${Math.round(Number(mmcgsControllerDevice.configuration.purge_pump_time) / 1000)} 秒` : "-"}</Text>
																<Text type="secondary">轮询周期：{mmcgsControllerDevice?.configuration?.read_interval ? `${Math.round(Number(mmcgsControllerDevice.configuration.read_interval) / 1000)} 秒` : "-"}</Text>
															</Space>
														</Card>
													</Col>
													<Col xs={24} lg={16}>
														<Row gutter={[12, 12]}>
															{mmcgsPointDevices.map((pointDevice) => {
																const pointIndex = getMmcgsPointIndex(String(pointDevice.code || ""));
																return (
																	<Col xs={24} sm={12} xl={8} key={pointDevice.device_id}>
																		<Card
																			size="small"
																			title={`点位 ${pointIndex ?? "-"}`}
																			extra={
																				pointDevice.device_id === deviceId ? (
																					<Tag color="blue">当前</Tag>
																				) : (
																					<Button size="small" onClick={() => router.push(`/devices/${pointDevice.device_id}`)}>
																						查看
																					</Button>
																				)
																			}
																			style={{ borderRadius: 16, height: "100%" }}
																		>
																			<Space direction="vertical" size={6} style={{ width: "100%" }}>
																				<Text strong>{pointDevice.name || pointDevice.code}</Text>
																				<div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
																					<Text type="secondary">CO2</Text>
																					<Text>{getDeviceChannelValue(pointDevice, ["CO2"])}</Text>
																				</div>
																				<div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
																					<Text type="secondary">O2</Text>
																					<Text>{getDeviceChannelValue(pointDevice, ["O2"])}</Text>
																				</div>
																				<div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
																					<Text type="secondary">温度</Text>
																					<Text>{getDeviceChannelValue(pointDevice, ["AirTemp", "Temp"])}</Text>
																				</div>
																				<div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
																					<Text type="secondary">湿度</Text>
																					<Text>{getDeviceChannelValue(pointDevice, ["AirHumidity", "Humidity"])}</Text>
																				</div>
																			</Space>
																		</Card>
																	</Col>
																);
															})}
														</Row>
													</Col>
												</Row>
												<Text type="secondary">
													这一组点位属于同一个 MMCGS 系统。建议后续把它按“1 个控制器 + 多个采样点”管理，而不是当成多个独立设备分别配置。
												</Text>
												{effectiveConfigDevice && effectiveConfigDevice.device_id !== deviceId ? (
													<Text type="secondary">
														当前页面是点位设备，配置参数统一读取控制器 {effectiveConfigDevice.code}。
													</Text>
												) : null}
											</Space>
										</Card>
									</Col>
								)}

								<Col xs={24}>
									<Card
										title="设备控制"
										style={{
											borderRadius: 20,
											overflow: "hidden",
											background: "linear-gradient(135deg, #f7fbff 0%, #f7f8f2 100%)",
										}}
									>
										<Row gutter={[16, 16]}>
											<Col xs={24} lg={15}>
												<Space direction="vertical" size={10} style={{ width: "100%" }}>
													<Space wrap>
														<Tag color="blue" style={{ borderRadius: 999, paddingInline: 10 }}>
															{getProfileLabel(deviceProfile)}
														</Tag>
														<Tag color={device.is_active === false ? "red" : "green"} style={{ borderRadius: 999, paddingInline: 10 }}>
															{device.is_active === false ? "未启用" : "可控制"}
														</Tag>
														{device.last_seen_at ? (
															<Tag style={{ borderRadius: 999, paddingInline: 10 }}>最近上线: {device.last_seen_at}</Tag>
														) : null}
													</Space>
													<Text strong style={{ fontSize: 18 }}>
														面向设备操作的详情页控制
													</Text>
													<Text type="secondary" style={{ fontSize: 14 }}>
														{getProfileDescription(deviceProfile)}
													</Text>
													<Text type="secondary" style={{ fontSize: 13 }}>
														这里优先提供研究人员日常会用到的操作。原始 JSON、模板编辑和完整配置在下方“开发者工具”里。
													</Text>
												</Space>
											</Col>
											<Col xs={24} lg={9}>
												<Card
													size="small"
													title="当前状态"
													style={{ borderRadius: 16, background: "#ffffffcc" }}
													bodyStyle={{ paddingBlock: 14 }}
												>
													<Space direction="vertical" size={8} style={{ width: "100%" }}>
														{deviceProfile === "cp500-v3" && (
															<Space wrap size={8}>
																{["Heater", "Pump", "Aeration", "EmergencyState"].map((code) => {
																	const item = controlStatusMap.get(code);
																	if (!item) return null;
																	return (
																		<Tag
																			key={code}
																			style={{
																				borderRadius: 999,
																				padding: "6px 12px",
																				background: item.tone,
																				color: "#fff",
																				border: "none",
																				fontSize: 12,
																			}}
																		>
																			{item.label}: {item.value}
																		</Tag>
																	);
																})}
															</Space>
														)}
														{deviceProfile === "smart-compost" && (
															<Space wrap size={8}>
																{["CO2", "O2", "AirTemp", "AirHumidity"].map((code) => {
																	const item = controlStatusMap.get(code);
																	if (!item) return null;
																	return (
																		<Tag key={code} style={{ borderRadius: 999, padding: "6px 12px", background: "#eef4ff", borderColor: "#d6e4ff" }}>
																			{item.label}: {item.value}
																		</Tag>
																	);
																})}
															</Space>
														)}
														{controlStatusChannels.length ? (
															controlStatusChannels.map((channel) => {
																const item = controlStatusMap.get(channel.code);
																return (
																	<div
																		key={channel.channel_id || channel.code}
																		style={{
																			display: "flex",
																			justifyContent: "space-between",
																			gap: 12,
																			padding: "8px 10px",
																			borderRadius: 12,
																			background: "#f7f8fa",
																		}}
																	>
																		<Text>{getChannelDisplayName(channel)}</Text>
																		<Text strong>{item?.value || "-"}</Text>
																	</div>
																);
															})
														) : (
															<Text type="secondary">暂无状态数据</Text>
														)}
													</Space>
												</Card>
											</Col>
										</Row>
									</Card>
								</Col>

								<Col xs={24} lg={14}>
									<Card title="常用操作" style={{ borderRadius: 20 }}>
										<Space direction="vertical" size={16} style={{ width: "100%" }}>
											{deviceProfile === "cp500-v3" && (
												<>
													<Card size="small" title="手动控制" style={{ borderRadius: 16, background: "#fafcff" }}>
														<Space wrap size={10}>
															<Button type="primary" style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("heater", "on")}>开启加热</Button>
															<Button style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("heater", "off")}>关闭加热</Button>
															<Button type="primary" style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("pump", "on")}>开启循环泵</Button>
															<Button style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("pump", "off")}>关闭循环泵</Button>
														</Space>
													</Card>
													<Card size="small" title="曝气任务" style={{ borderRadius: 16, background: "#fffdf7" }}>
														<Space direction="vertical" size={10} style={{ width: "100%" }}>
															<Text type="secondary">拖动滑块设置本轮曝气时长，然后一键执行。</Text>
															<div>
																<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
																	<Text>曝气时长</Text>
																	<Text strong>
																		当前设定 {quickDurationMinutes} 分钟
																		{controlStatusMap.get("Aeration") ? ` · 状态 ${controlStatusMap.get("Aeration")?.value}` : ""}
																	</Text>
																</div>
																<Slider min={1} max={60} marks={durationSliderMarks} value={quickDurationMinutes} onChange={setQuickDurationMinutes} tooltip={{ open: false }} />
															</div>
															<Space wrap align="center">
																<Button
																	type="primary"
																	style={{ minWidth: 132, height: 40, borderRadius: 12 }}
																	onClick={() => sendQuickToggle("aeration", "on", quickDurationMinutes * 60 * 1000)}
																>
																	开始定时曝气
																</Button>
																<Button style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("aeration", "off")}>
																	停止曝气
																</Button>
															</Space>
														</Space>
													</Card>
													<Card size="small" title="自动模式" style={{ borderRadius: 16, background: "#f7fbf7" }}>
														<Space direction="vertical" size={12} style={{ width: "100%" }}>
															<div>
																<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
																	<Text>曝气间隔</Text>
																	<Text strong>当前配置 {cp500AutoIntervalMinutes} 分钟</Text>
																</div>
																<Slider min={5} max={60} step={5} marks={cp500IntervalMarks} value={cp500AutoIntervalMinutes} onChange={setCp500AutoIntervalMinutes} tooltip={{ open: false }} />
															</div>
															<div>
																<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
																	<Text>单次曝气时长</Text>
																	<Text strong>当前配置 {cp500AutoDurationMinutes} 分钟</Text>
																</div>
																<Slider min={1} max={20} marks={cp500DurationMarks} value={cp500AutoDurationMinutes} onChange={setCp500AutoDurationMinutes} tooltip={{ open: false }} />
															</div>
															<Space wrap size={10}>
																<Button
																	type="primary"
																	style={{ minWidth: 152, height: 40, borderRadius: 12 }}
																	onClick={() =>
																		sendQuickConfigUpdate(
																			{
																				aeration_timer: {
																					enabled: true,
																					interval: cp500AutoIntervalMinutes * 60 * 1000,
																					duration: cp500AutoDurationMinutes * 60 * 1000,
																				},
																			},
																			"已更新自动曝气参数"
																		)
																	}
																>
																	保存自动曝气
																</Button>
															<Button style={{ minWidth: 132, height: 40, borderRadius: 12 }} onClick={() => sendQuickConfigUpdate({ aeration_timer: { enabled: true } }, "已启用定时曝气")}>
																启用自动曝气
															</Button>
															<Button style={{ minWidth: 132, height: 40, borderRadius: 12 }} onClick={() => sendQuickConfigUpdate({ aeration_timer: { enabled: false } }, "已停用定时曝气")}>
																停用自动曝气
															</Button>
															</Space>
														</Space>
													</Card>
													<Card size="small" title="安全控制" style={{ borderRadius: 16, background: "#fff6f6", borderColor: "#ffd6d6" }}>
														<Space direction="vertical" size={10} style={{ width: "100%" }}>
															<Text type="secondary">急停会立即阻止手动控制，适合异常情况下快速切断操作。</Text>
															<Space wrap size={10}>
																<Button
																	danger
																	type="primary"
																	style={{ minWidth: 132, height: 42, borderRadius: 12 }}
																	onClick={() => sendQuickCommands([{ command: "emergency", action: "on" }], "已发送急停命令")}
																>
																	立即急停
																</Button>
																<Button
																	style={{ minWidth: 132, height: 42, borderRadius: 12 }}
																	onClick={() => sendQuickCommands([{ command: "emergency", action: "off" }], "已发送解除急停命令")}
																>
																	解除急停
																</Button>
															</Space>
														</Space>
													</Card>
												</>
											)}

											{deviceProfile === "smart-compost" && (
												<>
													<Card size="small" title="气路控制" style={{ borderRadius: 16, background: "#fafcff" }}>
														<Space direction="vertical" size={10} style={{ width: "100%" }}>
															<Text type="secondary">按分钟设置本轮动作时长，适合实验过程中的临时干预。</Text>
															<div>
																<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
																	<Text>动作时长</Text>
																	<Text strong>当前设定 {quickDurationMinutes} 分钟</Text>
																</div>
																<Slider min={1} max={60} marks={durationSliderMarks} value={quickDurationMinutes} onChange={setQuickDurationMinutes} tooltip={{ open: false }} />
															</div>
															<Space wrap align="center">
																<Button
																	type="primary"
																	style={{ minWidth: 118, height: 40, borderRadius: 12 }}
																	onClick={() => sendQuickToggle("aeration", "on", quickDurationMinutes * 60 * 1000)}
																>
																	曝气运行
																</Button>
																<Button
																	style={{ minWidth: 118, height: 40, borderRadius: 12 }}
																	onClick={() => sendQuickToggle("exhaust", "on", quickDurationMinutes * 60 * 1000)}
																>
																	排气运行
																</Button>
															</Space>
															<div>
																<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
																	<Text>采集周期</Text>
																	<Text strong>当前配置 {smartReadIntervalMinutes} 分钟</Text>
																</div>
																<Slider min={1} max={60} marks={durationSliderMarks} value={smartReadIntervalMinutes} onChange={setSmartReadIntervalMinutes} tooltip={{ open: false }} />
															</div>
															<Space wrap size={10}>
																<Button
																	type="primary"
																	style={{ minWidth: 132, height: 40, borderRadius: 12 }}
																	onClick={() =>
																		sendQuickConfigUpdate(
																			{ read_interval: smartReadIntervalMinutes * 60 * 1000 },
																			"已更新采集周期"
																		)
																	}
																>
																	保存采集周期
																</Button>
																<Button style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("aeration", "off")}>停止曝气</Button>
																<Button style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickToggle("exhaust", "off")}>停止排气</Button>
																<Button danger style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickCommands([{ command: "restart" }], "已发送重启命令")}>
																	重启设备
																</Button>
															</Space>
														</Space>
													</Card>
												</>
											)}

											{deviceProfile === "mmcgs" && (
												<>
													<Card size="small" title="采样任务" style={{ borderRadius: 16, background: "#fafcff" }}>
														<Space direction="vertical" size={10} style={{ width: "100%" }}>
															<Text type="secondary">点击采样点后，会自动运行对应时长。</Text>
															<div>
																<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
																	<Text>采样时长</Text>
																	<Text strong>当前设定 {mmcgsSampleSeconds} 秒</Text>
																</div>
																<Slider min={5} max={180} step={5} marks={mmcgsSampleMarks} value={mmcgsSampleSeconds} onChange={setMmcgsSampleSeconds} tooltip={{ open: false }} />
															</div>
															<Space wrap size={10}>
																{Array.from({ length: 6 }, (_, index) => (
																	<Button
																		key={`point-${index + 1}`}
																		style={{ minWidth: 110, height: 40, borderRadius: 12 }}
																		onClick={() => sendQuickToggle(`point${index + 1}`, "on", mmcgsSampleSeconds * 1000)}
																	>
																		采样点 {index + 1}
																	</Button>
																))}
																<Button
																	type="primary"
																	style={{ minWidth: 118, height: 40, borderRadius: 12 }}
																	onClick={() => sendQuickToggle("purge", "on", mmcgsSampleSeconds * 1000)}
																>
																	清洗泵
																</Button>
															</Space>
															<Button danger style={{ width: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickCommands([{ command: "restart" }], "已发送重启命令")}>
																重启设备
															</Button>
														</Space>
													</Card>
												</>
											)}

											{deviceProfile === "generic" && (
												<>
													<Card size="small" title="基础操作" style={{ borderRadius: 16, background: "#fafcff" }}>
														<Space direction="vertical" size={10} style={{ width: "100%" }}>
															<Text type="secondary">
																当前设备还没有专属控制面板，建议先通过“编辑配置”或下方开发者工具进行操作。
															</Text>
															<Space wrap>
																<Button type="primary" style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={openConfigEdit}>编辑配置</Button>
																<Button danger style={{ minWidth: 118, height: 40, borderRadius: 12 }} onClick={() => sendQuickCommands([{ command: "restart" }], "已发送重启命令")}>
															重启设备
																</Button>
															</Space>
														</Space>
													</Card>
												</>
											)}
										</Space>
									</Card>
								</Col>

								<Col xs={24} lg={10}>
									<Card
										title="常用参数"
										style={{ borderRadius: 20 }}
										extra={
											<Button type="primary" onClick={openConfigEdit}>
												编辑配置
											</Button>
										}
									>
										<Space direction="vertical" size={10} style={{ width: "100%" }}>
											{profileConfigSummary.length ? (
												profileConfigSummary.map((item) => (
													<div
														key={item.label}
														style={{
															display: "flex",
															justifyContent: "space-between",
															gap: 12,
															padding: "10px 12px",
															borderRadius: 12,
															background: "#f7f8fa",
														}}
													>
														<Text>{item.label}</Text>
														<Text strong>{item.value || "-"}</Text>
													</div>
												))
											) : (
												<Text type="secondary">暂无可展示的参数</Text>
											)}
											{deviceProfile === "mmcgs" && effectiveConfigDevice ? (
												<Text type="secondary">
													当前参数来源：{effectiveConfigDevice.code}
												</Text>
											) : null}
											<Text type="secondary">
												这里只展示适合研究人员理解的摘要，完整配置对象请展开开发者工具。
											</Text>
										</Space>
									</Card>
								</Col>

								<Col xs={24}>
									<Collapse
										items={[
											{
												key: "developer-tools",
												label: "开发者工具",
												children: (
													<Row gutter={[12, 12]}>
														<Col xs={24}>
									<Card
										title="设备配置管理"
										extra={
											<Button type="primary" onClick={openConfigEdit}>
												编辑配置
											</Button>
										}
									>
										<Space orientation="vertical" size={12} style={{ width: "100%" }}>
											<Text type="secondary">
												管理设备的配置参数。不同设备的配置参数可能差别较大，例如采样间隔、上报频率、阈值设置等。
											</Text>

											{device?.configuration && Object.keys(device.configuration).length > 0 ? (
												<>
													<Text strong>当前配置：</Text>
													<div style={{
														background: "#f5f5f5",
														padding: 12,
														borderRadius: 4,
														fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
														fontSize: 12,
														maxHeight: 300,
														overflow: "auto"
													}}>
														{Object.entries(device.configuration).map(([key, value]) => (
															<div key={key} style={{ marginBottom: 6 }}>
																<span style={{ color: "#1890ff", fontWeight: 600 }}>{key}:</span>{" "}
																<span style={{ color: "#666" }}>
																	{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
																</span>
															</div>
														))}
													</div>
												</>
											) : (
												<Text type="secondary">暂无配置参数</Text>
											)}
										</Space>
									</Card>
								</Col>

								<Col xs={24} md={12}>
									<Card
										title="下发命令"
										extra={
											<Button type="primary" onClick={() => openTemplateEdit()}>
												新建模板
											</Button>
										}
									>
										<Space orientation="vertical" style={{ width: "100%" }} size={10}>
											<Text type="secondary">
												这里直接下发结构化 JSON 命令到设备的 response_topic。当前阶段不需要 ack 回执，因此请求不会长轮询。
											</Text>

											<Divider style={{ margin: "8px 0" }} />

											{/* 保存的模板列表 */}
											{templatesQ.data?.data && templatesQ.data.data.length > 0 && (
												<>
													<Text strong>保存的模板</Text>
													<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
														{templatesQ.data.data.map((tpl) => (
															<Tag
																key={tpl.id}
																color="blue"
																style={{ cursor: "pointer", padding: "4px 8px", fontSize: 13 }}
																onClick={() => insertSavedTemplate(tpl)}
															>
																{tpl.name}
															</Tag>
														))}
													</div>
													<Divider style={{ margin: "8px 0" }} />
												</>
											)}

											<Text strong>Command JSON</Text>
											<Input.TextArea
												value={cmdJson}
												onChange={(e) => setCmdJson(e.target.value)}
												rows={isMobile ? 12 : 14}
												placeholder='例如：{ "commands": [{ "command": "set_aeration", "params": { "on": 1, "ms": 60000 } }] }'
												style={{
													fontFamily:
														"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
												}}
											/>

											<Button type="primary" onClick={sendCommand} block loading={sendCmd.isPending}>
												下发命令
											</Button>

											<Divider style={{ margin: "8px 0" }} />

											<Text type="secondary">Topics</Text>
											<Tag style={{ wordBreak: "break-all" }}>post: {device.post_topic || "-"}</Tag>
											<Tag style={{ wordBreak: "break-all" }}>resp: {device.response_topic || "-"}</Tag>
										</Space>
									</Card>
								</Col>

								<Col xs={24} md={12}>
									<Card
										title="控制模板管理"
										extra={
											manage ? (
												<Button type="primary" size="small" onClick={() => openTemplateEdit()}>
													新建模板
												</Button>
											) : null
										}
									>
										<Table
											rowKey="id"
											size="small"
											pagination={{ pageSize: 10, hideOnSinglePage: true }}
											dataSource={templatesQ.data?.data || []}
											loading={templatesQ.isLoading}
											columns={[
												{
													title: "名称",
													dataIndex: "name",
													render: (v: string, r: any) => (
														<Space orientation="vertical" size={0}>
															<Text strong>{v}</Text>
															{r.description && (
																<Text type="secondary" style={{ fontSize: 12 }}>
																	{r.description}
																</Text>
															)}
														</Space>
													),
												},
												{
													title: "状态",
													dataIndex: "is_active",
													render: (v: boolean) => (
														<Tag color={v ? "green" : "red"}>{v ? "启用" : "禁用"}</Tag>
													),
													width: 70,
												},
												{
													title: "操作",
													key: "actions",
													render: (_: any, r: any) => (
														<Space size={6}>
															<Button size="small" onClick={() => insertSavedTemplate(r)}>
																使用
															</Button>
															{manage && (
																<>
																	<Button size="small" onClick={() => openTemplateEdit(r)}>
																		编辑
																	</Button>
																	<Button size="small" danger onClick={() => confirmDeleteTemplate(r)}>
																		删除
																	</Button>
																</>
															)}
														</Space>
													),
												},
											]}
											expandable={{
												expandedRowRender: (r: any) => (
													<pre style={{ margin: 0, fontSize: 12, background: "#f5f5f5", padding: 8 }}>
														{JSON.stringify(r.payload, null, 2)}
													</pre>
												),
												rowExpandable: () => true,
											}}
										/>
									</Card>
								</Col>

								<Col xs={24}>
									<Card title="命令历史（最近30条）" extra={commandsQ.isFetching ? <Text type="secondary">刷新中…</Text> : null}>
										<Table
											rowKey="command_id"
											size="small"
											pagination={{ pageSize: 10, hideOnSinglePage: true }}
											dataSource={commandsQ.data?.data || []}
											columns={[
												{
													title: "ID",
													dataIndex: "command_id",
													width: 80,
												},
												{
													title: "status",
													dataIndex: "status",
													render: (v: string) => {
														const color = v === "failed" ? "red" : v === "acked" ? "green" : v === "sent" ? "blue" : "gold";
														return <Tag color={color}>{v}</Tag>;
													},
													width: 90,
												},
												{
													title: "command",
													dataIndex: "command",
													render: (v: any) => <Text>{v || "-"}</Text>,
												},
												{
													title: "created",
													dataIndex: "created_at",
													render: (v: any) => <Text style={{ fontSize: 12 }}>{v || "-"}</Text>,
												},
											]}
											expandable={{
												expandedRowRender: (r: any) => (
													<div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
														<div style={{ marginBottom: 8 }}>
															<Text type="secondary">payload</Text>
															<pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(r.payload, null, 2)}</pre>
														</div>
														<div>
															<Text type="secondary">result</Text>
															<pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(r.result, null, 2)}</pre>
														</div>
													</div>
												),
												rowExpandable: () => true,
											}}
											loading={commandsQ.isLoading}
										/>
									</Card>
														</Col>
													</Row>
												),
											},
										]}
									/>
								</Col>
							</Row>
						),
					},
				]}
			/>

			{/* ===== Device 编辑 ===== */}
			<Modal
				open={deviceModalOpen}
				title="编辑设备"
				onCancel={() => setDeviceModalOpen(false)}
				onOk={submitDevice}
				okText="保存"
				afterOpenChange={(open) => {
					if (!open) {
						deviceForm.resetFields();
					}
				}}
				confirmLoading={updateDevice.isPending}
				maskClosable={!updateDevice.isPending}
			>
				<Form layout="vertical" form={deviceForm}>
					<Row gutter={12}>
						<Col xs={24} md={12}>
							<Form.Item label="code" name="code" rules={[{ required: true, message: "请输入 code" }]}>
								<Input placeholder="例如：KgSERnY2Zn" />
							</Form.Item>
						</Col>
						<Col xs={24} md={12}>
							<Form.Item label="name" name="name" rules={[{ required: true, message: "请输入 name" }]}>
								<Input placeholder="设备名称" />
							</Form.Item>
						</Col>
					</Row>

					<Form.Item label="post_topic" name="post_topic">
						<Input placeholder="可留空" />
					</Form.Item>
					<Form.Item label="response_topic" name="response_topic">
						<Input placeholder="可留空" />
					</Form.Item>
					<Form.Item label="note" name="note">
						<Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="可选" />
					</Form.Item>

					<Form.Item label="is_active" name="is_active" valuePropName="checked">
						<Switch />
					</Form.Item>

					<Divider style={{ margin: "8px 0" }} />
					<Text strong>meta（Key-Value）</Text>
					<Form.Item name="meta" style={{ marginTop: 8 }} getValueProps={(value) => ({ value })}>
						<KeyValueEditor placeholderKey="key" placeholderValue="value" />
					</Form.Item>
				</Form>
			</Modal>

			{/* ===== 设备配置编辑 ===== */}
			<Modal
				open={configModalOpen}
				title="编辑设备配置"
				onCancel={() => setConfigModalOpen(false)}
				onOk={submitConfig}
				okText="保存"
				afterOpenChange={(open) => {
					if (!open) {
						configForm.resetFields();
					}
				}}
				confirmLoading={configSubmitting}
				maskClosable={!configSubmitting}
				width={700}
			>
				<Form layout="vertical" form={configForm}>
					<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
						配置设备的运行参数。不同设备的配置参数可能差别较大，请根据实际设备类型和需求进行配置。
					</Text>

					<Form.Item
						name="configuration"
						style={{ marginBottom: 0 }}
						getValueProps={(value) => ({ value })}
					>
						<KeyValueEditor
							placeholderKey="参数名（例如：sample_interval）"
							placeholderValue="参数值（例如：60）"
						/>
					</Form.Item>

					<Divider style={{ margin: "12px 0" }} />
					<Text type="secondary" style={{ fontSize: 11 }}>
						常见配置参数示例：
					</Text>
					<ul style={{ fontSize: 12, marginTop: 8, color: "#666", paddingLeft: 20 }}>
						<li>sample_interval: 采样间隔（秒）</li>
						<li>report_interval: 上报间隔（秒）</li>
						<li>threshold_temp: 温度阈值</li>
						<li>threshold_humidity: 湿度阈值</li>
						<li>auto_start: 自动启动开关</li>
						<li>mode: 运行模式</li>
					</ul>
				</Form>
			</Modal>

			{/* ===== Channel 新建 / 编辑 ===== */}
			<Modal
				open={channelModalOpen}
				title={editingChannel ? `编辑通道 ${editingChannel.code}` : "新建通道"}
				onCancel={() => setChannelModalOpen(false)}
				onOk={submitChannel}
				okText={editingChannel ? "保存" : "创建"}
				afterOpenChange={(open) => {
					if (!open) {
						channelForm.resetFields();
					}
				}}
				confirmLoading={createChannel.isPending || updateChannel.isPending}
				maskClosable={!(createChannel.isPending || updateChannel.isPending)}
			>
				<Form layout="vertical" form={channelForm}>
					<Row gutter={12}>
						<Col xs={24} md={12}>
							<Form.Item label="code" name="code" rules={[{ required: true, message: "请输入 code" }]}>
								<Input placeholder="例如：Temp" />
							</Form.Item>
						</Col>
						<Col xs={24} md={12}>
							<Form.Item label="metric" name="metric" rules={[{ required: true, message: "请选择 metric" }]}>
								<Select
									showSearch
									optionFilterProp="label"
									options={[
										{ value: "temperature", label: "temperature (温度)" },
										{ value: "o2", label: "O2 (氧气)" },
										{ value: "co2", label: "CO2 (二氧化碳)" },
										{ value: "ch4", label: "CH4 (甲烷)" },
										{ value: "co", label: "CO (一氧化碳)" },
										{ value: "h2s", label: "H2S (硫化氢)" },
										{ value: "nh3", label: "NH3 (氨气)" },
										{ value: "moisture", label: "moisture (含水率)" },
										{ value: "humidity", label: "humidity (湿度)" },
										{ value: "ph", label: "pH (酸碱度)" },
										{ value: "flow", label: "flow (流量)" },
										{ value: "switch", label: "switch (开关)" },
										{ value: "unknown", label: "unknown (未分类)" },
									]}
								/>
							</Form.Item>
						</Col>
					</Row>

					<Row gutter={12}>
						<Col xs={24} md={12}>
							<Form.Item label="display_name" name="display_name">
								<Input placeholder="例如：堆体温度" />
							</Form.Item>
						</Col>
						<Col xs={24} md={12}>
							<Form.Item label="unit" name="unit">
								<Input placeholder="例如：℃ / %" />
							</Form.Item>
						</Col>
					</Row>

					<Row gutter={12}>
						<Col xs={24} md={12}>
							<Form.Item label="name" name="name">
								<Input placeholder="可选" />
							</Form.Item>
						</Col>
						<Col xs={24} md={12}>
							<Form.Item label="role" name="role">
								<Input placeholder="可选（例如：T1/T2/T3）" />
							</Form.Item>
						</Col>
					</Row>

					<Form.Item label="is_active" name="is_active" valuePropName="checked">
						<Switch />
					</Form.Item>

					<Divider style={{ margin: "8px 0" }} />
					<Text strong>meta（Key-Value）</Text>
					<Form.Item name="meta" style={{ marginTop: 8 }} getValueProps={(value) => ({ value })}>
						<KeyValueEditor placeholderKey="key" placeholderValue="value" />
					</Form.Item>
				</Form>
			</Modal>

			{/* ===== Control Template 新建 / 编辑 ===== */}
			<Modal
				open={templateModalOpen}
				title={editingTemplate ? `编辑模板 ${editingTemplate.name}` : "新建控制模板"}
				onCancel={() => setTemplateModalOpen(false)}
				onOk={submitTemplate}
				okText={editingTemplate ? "保存" : "创建"}
				afterOpenChange={(open) => {
					if (!open) {
						templateForm.resetFields();
					}
				}}
				confirmLoading={templateSubmitting || createTemplate.isPending}
				maskClosable={!(templateSubmitting || createTemplate.isPending)}
				width={600}
			>
				<Form layout="vertical" form={templateForm}>
					<Form.Item label="模板名称" name="name" rules={[{ required: true, message: "请输入模板名称" }]}>
						<Input placeholder="例如：曝气开启" />
					</Form.Item>

					<Form.Item label="描述" name="description">
						<Input.TextArea placeholder="可选，例如：开启曝气泵60秒" autoSize={{ minRows: 2, maxRows: 4 }} />
					</Form.Item>

					<Form.Item
						label="Payload (JSON)"
						name="payload"
						rules={[
							{ required: true, message: "请输入 JSON payload" },
							{
								validator: (_, value) => {
									try {
										JSON.parse(value);
										return Promise.resolve();
									} catch {
										return Promise.reject(new Error("JSON 格式错误"));
									}
								},
							},
						]}
					>
						<Input.TextArea
							placeholder='{ "commands": [{ "command": "set_aeration", "params": { "on": 1, "ms": 60000 } }] }'
							rows={12}
							style={{
								fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
							}}
						/>
					</Form.Item>

					<Form.Item label="启用状态" name="is_active" valuePropName="checked">
						<Switch />
					</Form.Item>

					<Form.Item
						label="全局模板"
						name="is_global"
						valuePropName="checked"
						tooltip="全局模板可用于所有设备，不绑定到当前设备"
					>
						<Switch />
					</Form.Item>
				</Form>
			</Modal>
		</Page>
	);
}
