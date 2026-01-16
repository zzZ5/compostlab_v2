"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactECharts from "echarts-for-react";
import {
	Button,
	Card,
	Col,
	DatePicker,
	Divider,
	Grid,
	Form,
	Input,
	Modal,
	message,
	Row,
	Select,
	Space,
	Switch,
	Collapse,
	Spin,
	Alert,
	Tag,
	Typography,
} from "antd";
import Link from "next/link";

const { CheckableTag } = Tag;
import dayjs from "dayjs";

import Page from "@/components/Page";
import KeyValueEditor from "@/components/KeyValueEditor";

import { useDevicesTree } from "@/features/devices/queries";
import { useRunDetail } from "@/features/runs/queries";
import { useRunWindows } from "@/features/runWindows/queries";
import { useCreateRunWindow } from "@/features/runWindows/mutations";
import { useUpdateRunWindow } from "@/features/runWindows/mutations";
import { useDeleteRunWindow } from "@/features/runWindows/mutations";
import { useUpdateRun } from "@/features/runs/mutations";
import { useDeleteRun } from "@/features/runs/mutations";
import { useRunTelemetry } from "@/features/runs/queries";

import { api, buildQuery, downloadBlob, getErrorMessage } from "@/lib/api";
import { normalizeMetric, MetricKey, metricLabel } from "@/lib/metrics";
import { emptyObjectToUndefined } from "@/lib/kv";

import type { RunWindow } from "@/types/api";

const { Text } = Typography;
const { useBreakpoint } = Grid;

type Opt = { value: string; label: string };

export default function RunDetailPage() {
	const params = useParams<{ id: string }>();
	const runId = Number(params.id);
	const router = useRouter();

	const screens = useBreakpoint();
	const isMobile = !screens.md;

	const runQ = useRunDetail(runId);
	const devicesQ = useDevicesTree(true);

	// filters
	const [group, setGroup] = useState<string | null>(null);
	const [treatment, setTreatment] = useState<string | null>(null);
	// windows view mode: "window" | "device"
	const [windowViewMode, setWindowViewMode] = useState<"window" | "device">("window");
	// ✅ 管理模式默认开启（Run / Window 面向用户可编辑）
	const [manage, setManage] = useState(true);

	const windowsQ = useRunWindows(runId, { group, treatment });
	const windows: RunWindow[] = windowsQ.data || [];
	// 用于下拉选项（不被当前筛选限制）
	const windowsAllQ = useRunWindows(runId, { group: null, treatment: null });
	const windowsAll: RunWindow[] = windowsAllQ.data || [];

	const createWindow = useCreateRunWindow(runId);
	const updateWindow = useUpdateRunWindow(runId);
	const deleteWindow = useDeleteRunWindow(runId);
	const updateRun = useUpdateRun(runId);
	const deleteRun = useDeleteRun();

	const [runModalOpen, setRunModalOpen] = useState(false);
	const [windowModalOpen, setWindowModalOpen] = useState(false);
	const [editingWindow, setEditingWindow] = useState<RunWindow | null>(null);
	const [runForm] = Form.useForm();
	const [windowForm] = Form.useForm();

	const fmt = (d: any) => (d ? dayjs(d).format("YYYY-MM-DD HH:mm:ss") : null);

	function openRunEdit() {
		const r = runQ.data;
		if (!r) return;
		runForm.resetFields();
		runForm.setFieldsValue({
			name: r.name,
			note: r.note || "",
			start_at: r.start_at ? dayjs(r.start_at) : null,
			end_at: r.end_at ? dayjs(r.end_at) : null,
			recipe: r.recipe || {},
			settings: r.settings || {},
		});
		setRunModalOpen(true);
	}

	async function submitRun() {
		try {
			const v = await runForm.validateFields();
			const body: any = {
				name: (v.name || "").trim(),
				note: (v.note || "").trim(),
				start_at: fmt(v.start_at),
				end_at: fmt(v.end_at),
			};
			const recipe = emptyObjectToUndefined(v.recipe);
			const settings = emptyObjectToUndefined(v.settings);
			if (recipe !== undefined) body.recipe = recipe;
			if (settings !== undefined) body.settings = settings;
			await updateRun.mutateAsync(body);
			message.success("Run 已更新");
			setRunModalOpen(false);
		} catch (err) {
			// 表单校验失败时，antd 会 throw 一个对象，不提示即可
			if ((err as any)?.errorFields) return;
			message.error(getErrorMessage(err, "更新失败"));
		}
	}

	function confirmDeleteRun() {
		Modal.confirm({
			title: "删除 Run",
			content: "删除后不可恢复。确认删除该 Run 吗？",
			okType: "danger",
			async onOk() {
				try {
					await deleteRun.mutateAsync({ run_id: runId });
					message.success("Run 已删除");
					router.push("/runs");
				} catch (err) {
					message.error(getErrorMessage(err, "删除失败"));
				}
			},
		});
	}

	function openWindowCreate() {
		setEditingWindow(null);
		windowForm.resetFields();
		windowForm.setFieldsValue({
			device_ids: undefined,
			group: "",
			treatment: "",
			follow_run: true,
			note: "",
			start_at: null,
			end_at: null,
			settings: {},
			meta: {},
		});
		setWindowModalOpen(true);
	}

	function openWindowEdit(w: RunWindow) {
		setEditingWindow(w);
		windowForm.resetFields();
		windowForm.setFieldsValue({
			device_ids: w.device_ids || [],
			group: w.group || "",
			treatment: w.treatment || "",
			follow_run: w.follow_run !== false,
			note: w.note || "",
			start_at: w.start_at ? dayjs(w.start_at) : null,
			end_at: w.end_at ? dayjs(w.end_at) : null,
			settings: w.settings || {},
			meta: w.meta || {},
		});
		setWindowModalOpen(true);
	}

	async function submitWindow() {
		try {
			const v = await windowForm.validateFields();
			const body: any = {
				device_ids: (v.device_ids || []).map(Number),
				group: (v.group || "").trim() || undefined,
				treatment: (v.treatment || "").trim() || undefined,
				follow_run: !!v.follow_run,
				note: (v.note || "").trim(),
				start_at: fmt(v.start_at),
				end_at: fmt(v.end_at),
			};
			const settings = emptyObjectToUndefined(v.settings);
			const meta = emptyObjectToUndefined(v.meta);
			if (settings !== undefined) body.settings = settings;
			if (meta !== undefined) body.meta = meta;

			if (editingWindow) {
				await updateWindow.mutateAsync({ windowId: editingWindow.window_id, body });
				message.success("Window 已更新");
			} else {
				await createWindow.mutateAsync(body);
				message.success("Window 已创建");
			}
			setWindowModalOpen(false);
		} catch (err) {
			if ((err as any)?.errorFields) return;
			message.error(getErrorMessage(err, "保存失败"));
		}
	}

	function confirmDeleteWindow(w: RunWindow) {
		const deviceInfo = (w.device_ids || [])
			.map((did: number) => {
				const dev = deviceMap.get(did);
				return dev ? dev.code : `ID:${did}`;
			})
			.join(", ");

		Modal.confirm({
			title: "删除 Window",
			content: `确认删除该 Window 吗？（设备: ${deviceInfo}）`,
			okType: "danger",
			async onOk() {
				try {
					await deleteWindow.mutateAsync(w.window_id);
					message.success("Window 已删除");
				} catch (err) {
					message.error(getErrorMessage(err, "删除失败"));
				}
			},
		});
	}

	// metric & time
	const [activeMetrics, setActiveMetrics] = useState<Set<MetricKey>>(new Set(["temperature"]));
	const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
	const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);
	const [range, setRange] = useState<[any, any] | null>(null);

	/**
	 * bucket：
	 * - 为了最大兼容你的后端 parse_bucket：
	 *   raw 用空字符串表示"不传 bucket"
	 * - export_wide 必须 bucket 不能为空（raw 不支持）
	 */
	const [bucket, setBucket] = useState<string>("10m");

	/**
	 * 数据量限制：
	 * - Runs 页面可能包含多设备长时间数据，需要更大的数据量
	 * - 默认 20000，最大支持 200000
	 */
	const [dataLimit, setDataLimit] = useState<number>(20000);

	const from = range?.[0] ? dayjs(range[0]).format("YYYY-MM-DD HH:mm:ss") : null;
	const to = range?.[1] ? dayjs(range[1]).format("YYYY-MM-DD HH:mm:ss") : null;

	// window devices
	const windowDeviceIds = useMemo(() => {
		const s = new Set<number>();
		for (const w of windows) {
			// ✅ 支持多设备：收集所有窗口的设备 ID
			const ids = w.device_ids || [];
			for (const id of ids) {
				if (typeof id === "number") s.add(id);
			}
		}
		return Array.from(s);
	}, [windows]);

	const devices = devicesQ.data || [];
	const deviceMap = useMemo(() => {
		const m = new Map<number, any>();
		for (const d of devices) m.set(d.device_id, d);
		return m;
	}, [devices]);

	const deviceOptions = useMemo(() => {
		return devices
			.map((d: any) => ({
				value: d.device_id,
				label: `${d.code}${d.name ? ` · ${d.name}` : ""}`,
			}))
			.sort((a, b) => String(a.label).localeCompare(String(b.label)));
	}, [devices]);

	const windowDevices = useMemo(() => {
		return windowDeviceIds.map((id) => deviceMap.get(id)).filter(Boolean);
	}, [windowDeviceIds, deviceMap]);

	// 获取所有可用的 channels（每个设备的每个通道）
	const allChannels = useMemo(() => {
		const channels: Array<{ code: string; metric: string; deviceId: number; deviceCode: string; label: string; displayName: string }> = [];
		for (const d of windowDevices) {
			for (const ch of d.channels || []) {
				if (ch?.code) {
					const displayName = ch.display_name || ch.name || ch.code;
					channels.push({
						code: ch.code,
						metric: ch.metric || "unknown",
						deviceId: d.device_id,
						deviceCode: d.code,
						label: `${d.code}:${displayName}`,
						displayName: displayName,
					});
				}
			}
		}
		return channels.sort((a, b) => a.label.localeCompare(b.label));
	}, [windowDevices]);

	// 按 metric 分组的 channels
	const channelsByMetric = useMemo(() => {
		const map = new Map<string, typeof allChannels>();

		// 分配 channels（包括 switch 等所有 metric）
		for (const ch of allChannels) {
			const metric = ch.metric || "unknown";
			if (!map.has(metric)) {
				map.set(metric, []);
			}
			map.get(metric)!.push(ch);
		}

		return map;
	}, [allChannels]);

	// 创建 (deviceId:code) -> displayName 的映射，用于绘图时查找
	const channelDisplayNameMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const ch of allChannels) {
			const key = `${ch.deviceId}:${ch.code}`;
			const device = deviceMap.get(ch.deviceId);
			const deviceName = device?.code || `Device#${ch.deviceId}`;
			map.set(key, `${deviceName}:${ch.displayName}`);
		}
		return map;
	}, [allChannels, deviceMap]);

	// 可用的 metrics
	const availableMetrics = useMemo(() => {
		return Array.from(channelsByMetric.keys()).sort();
	}, [channelsByMetric]);

	// 当选中 Window 时，自动选中该 Window 的所有 channels
	// 当 activeMetrics 变化时，仅清空 selectedChannels，不自动选中
	useEffect(() => {
		// activeMetrics 变化时清空通道选择，让用户自己选择
		if (activeMetrics.size > 0) {
			// 不自动选中，保持手动选择
		}
	}, [activeMetrics]);

	// 当前选中的 codes
	const selectedCodes = useMemo(() => {
		return Array.from(selectedChannels);
	}, [selectedChannels]);

	const telemetryQ = useRunTelemetry({
		runId,
		from: selectedWindowId ? null : from, // 选中 Window 时使用 Window 的时间范围
		to: selectedWindowId ? null : to,
		bucket: bucket ? bucket : null, // raw -> null
		group: selectedWindowId ? null : group, // 选中 Window 时忽略 group 筛选
		treatment: selectedWindowId ? null : treatment,
		channels: selectedCodes.length > 0 ? selectedCodes : [],
		limit: dataLimit,
	});

	const points = (telemetryQ.isSuccess && telemetryQ.data?.data && selectedCodes.length > 0) ? telemetryQ.data.data : [];

	// options from windows (不受当前筛选限制)
	const groupOptions: Opt[] = useMemo(() => {
		const s = new Set<string>();
		for (const w of windowsAll) if (w.group) s.add(w.group);
		return Array.from(s)
			.sort()
			.map((x) => ({ value: x, label: x }));
	}, [windowsAll]);

	const treatmentOptions: Opt[] = useMemo(() => {
		const s = new Set<string>();
		for (const w of windowsAll) if (w.treatment) s.add(w.treatment);
		return Array.from(s)
			.sort()
			.map((x) => ({ value: x, label: x }));
	}, [windowsAll]);

	const chartOption = useMemo(() => {
		// ✅ 支持多设备：按 "device_id:code" 分组，避免不同设备的相同 code 混在一起
		const byKey = new Map<string, { name: string; data: Array<[string, number]>; metric: string }>();
		for (const p of points as any[]) {
			const code = p.code || "UNKNOWN";
			const deviceId = p.device_id;
			if (deviceId == null) continue;
			const key = `${Number(deviceId)}:${code}`;
			const v = typeof p.value === "number" ? p.value : Number(p.value);
			if (!Number.isFinite(v)) continue;

			// 从预先构建的映射中获取显示名称（使用 displayName）
			const label = channelDisplayNameMap.get(key) || `${deviceId}:${code}`;

			// 获取该 channel 的 metric
			const channel = allChannels.find((ch) => ch.deviceId === deviceId && ch.code === code);
			const metric = channel?.metric || "unknown";

			if (!byKey.has(key)) {
				byKey.set(key, { name: label, data: [], metric });
			}
			byKey.get(key)!.data.push([p.ts, v]);
		}

		// sort by time (避免线段回折)
		for (const { data } of byKey.values()) {
			data.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
		}

		// 当数据点过少时，隐藏 slider（否则容易"挤到上面"）
		const uniqueTs = new Set<string>();
		for (const p of points as any[]) if (p?.ts) uniqueTs.add(String(p.ts));
		// 数据点太少时 slider 容易把布局挤乱（尤其是只有 1-2 个点/不成线时）；设更稳阈值
		const enableSlider = uniqueTs.size >= 6;

		const series = Array.from(byKey.values()).map((s) => {
			// 根据 metric 类型决定图表类型
			const isSwitch = s.metric === "switch";
			return {
				name: s.name,
				type: isSwitch ? "bar" : "line",
				smooth: !isSwitch,
				showSymbol: s.data.length <= 1,
				symbolSize: 4,
				data: s.data,
			};
		});

		// 说明：默认 slider dataZoom 会占用底部空间，若 grid.bottom 太小，
		// 会造成 x 轴时间标签与 dataZoom/legend 视觉重叠。
		const dz = enableSlider
			? isMobile
				? [{ type: "inside" }]
				: [{ type: "inside" }, { type: "slider", xAxisIndex: 0, height: 16, bottom: 6 }]
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
			bottom: isMobile ? 44 : enableSlider ? 46 : 40,
				containLabel: true,
			},
			xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 6 } },
			yAxis: { type: "value" },
			series,
			dataZoom: dz,
		};
	}, [points, isMobile, channelDisplayNameMap, allChannels]);

	async function exportRunRaw() {
		try {
			const qs = buildQuery({
				from,
				to,
				group,
				treatment,
				// raw export 不要求 bucket/channels，但允许你带上（也不影响）
				bucket: bucket ? bucket : null,
				channels: selectedCodes.length ? selectedCodes : null,
			});

			await downloadBlob(
				api,
				`/runs/${runId}/export${qs}`,
				`run_${runId}_raw.csv`,
				"text/csv;charset=utf-8"
			);
		} catch (e) {
			message.error(getErrorMessage(e, "导出 Raw 失败"));
		}
	}

	async function exportRunWide() {
		// 你的后端 export_wide：必须 bucket + channels
		if (!bucket) {
			message.warning("Wide 导出必须选择 bucket（例如 10m/1h），raw 不支持。");
			return;
		}
		if (!selectedCodes.length) {
			message.warning("Wide 导出必须指定 channels（请至少选择一个 Channel）。");
			return;
		}

		try {
			const qs = buildQuery({
				from,
				to,
				group,
				treatment,
				bucket, // ✅ 必须
				channels: selectedCodes, // ✅ 必须
			});

			await downloadBlob(
				api,
				`/runs/${runId}/export_wide${qs}`,
				`run_${runId}_wide_${bucket}.csv`,
				"text/csv;charset=utf-8"
			);
		} catch (e) {
			message.error(getErrorMessage(e, "导出 Wide 失败"));
		}
	}

	const loading = runQ.isLoading || devicesQ.isLoading || windowsQ.isLoading;

	if (loading) {
		return (
			<div style={{ padding: 48 }}>
				<Spin />
			</div>
		);
	}

	const run = runQ.data;

	if (!run) {
		return (
			<div style={{ padding: 24 }}>
				<Text type="secondary">Run not found.</Text>
			</div>
		);
	}

	return (
		<Page
			title={run.name || `Run #${runId}`}
			extra={
				<Space wrap>
					<Tag color="blue">ID {runId}</Tag>
					<Space size={6}>
						<Text type="secondary">管理</Text>
						<Switch checked={manage} onChange={setManage} />
					</Space>

					{manage && (
						<>
							<Button onClick={openRunEdit}>编辑 Run</Button>
							<Button danger onClick={confirmDeleteRun}>
								删除 Run
							</Button>
							<Button type="primary" onClick={openWindowCreate}>
								新建 Window
							</Button>
						</>
					)}

					<Button onClick={exportRunRaw}>导出 Raw</Button>
					<Button onClick={exportRunWide}>导出 Wide</Button>
				</Space>
			}
		>
			<Row gutter={[12, 12]}>
				<Col xs={24}>
					<Card size="small" title="Run 信息">
						<Space size="middle" wrap style={{ width: "100%" }}>
							{/* ID */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>ID</Text>
								<div style={{ marginTop: 2 }}>
									<Tag color="blue">{runId}</Tag>
								</div>
							</div>

							{/* 名称 */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>名称</Text>
								<div style={{ marginTop: 2, fontSize: 13, fontWeight: 500 }}>
									{run.name || "-"}
								</div>
							</div>

							{/* 状态 */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>状态</Text>
								<div style={{ marginTop: 2 }}>
									{!run.start_at ? (
										<Tag color="default">未开始</Tag>
									) : run.end_at ? (
										<Tag color="success">已结束</Tag>
									) : (
										<Tag color="processing">进行中</Tag>
									)}
								</div>
							</div>

							{/* 时长 */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>时长</Text>
								<div style={{ marginTop: 2, fontSize: 13 }}>
									{(() => {
										if (!run.start_at) return "-";
										const start = dayjs(run.start_at);
										const end = run.end_at ? dayjs(run.end_at) : dayjs();
										const minutes = end.diff(start, "minute");
										if (minutes <= 0) return "-";
										const hours = Math.floor(minutes / 60);
										const mins = minutes % 60;
										if (hours === 0) return `${mins} 分钟`;
										if (mins === 0) return `${hours} 小时`;
										return `${hours} 小时 ${mins} 分钟`;
									})()}
								</div>
							</div>

							{/* 时间范围 */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>时间范围</Text>
								<div style={{ marginTop: 2, fontSize: 12 }}>
									{run.start_at || "-"} ~ {run.end_at || "-"}
								</div>
							</div>

							{/* Windows 数量 */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>Windows</Text>
								<div style={{ marginTop: 2 }}>
									<Tag color="green">{windows.length} 个</Tag>
								</div>
							</div>

							{/* 设备数量 */}
							<div>
								<Text type="secondary" style={{ fontSize: 11 }}>设备</Text>
								<div style={{ marginTop: 2 }}>
									<Tag color="purple">{windowDevices.length} 个</Tag>
								</div>
							</div>

							{/* Recipe */}
							{run.recipe && Object.keys(run.recipe).length > 0 && (
								<div>
									<Text type="secondary" style={{ fontSize: 11 }}>Recipe</Text>
									<div style={{ marginTop: 2 }}>
										<Space size={4} wrap>
											{Object.entries(run.recipe).map(([key, value]) => (
												<Tag key={key} color="cyan" style={{ fontSize: 11 }}>
													{key}: {String(value)}
												</Tag>
											))}
										</Space>
									</div>
								</div>
							)}

							{/* Settings */}
							{run.settings && Object.keys(run.settings).length > 0 && (
								<div>
									<Text type="secondary" style={{ fontSize: 11 }}>Settings</Text>
									<div style={{ marginTop: 2 }}>
										<Space size={4} wrap>
											{Object.entries(run.settings).slice(0, 5).map(([key, value]) => (
												<Tag key={key} color="orange" style={{ fontSize: 11 }}>
													{key}: {String(value)}
												</Tag>
											))}
											{Object.keys(run.settings).length > 5 && (
												<Tag color="orange" style={{ fontSize: 11 }}>
													+{Object.keys(run.settings).length - 5} more
												</Tag>
											)}
										</Space>
									</div>
								</div>
							)}

							{/* 备注 */}
							{run.note && (
								<div style={{ flex: 1, minWidth: 200 }}>
									<Text type="secondary" style={{ fontSize: 11 }}>备注</Text>
									<div style={{ marginTop: 2, fontSize: 12, color: "#595959" }}>
										{run.note}
									</div>
								</div>
							)}
						</Space>
					</Card>
				</Col>
				<Col xs={24}>
					<Row gutter={[12, 12]}>
						{/* Windows 列表侧边栏 */}
						<Col xs={24} xl={8}>
							<Card
								title="窗口列表"
								extra={
									<Space>
										<Select
											size="small"
											value={windowViewMode}
											onChange={(v) => setWindowViewMode(v as "window" | "device")}
											options={[
												{ label: "按 Window", value: "window" },
												{ label: "按设备", value: "device" },
											]}
										/>
										{manage && (
											<Button size="small" type="primary" onClick={openWindowCreate}>
												新建 Window
											</Button>
										)}
									</Space>
								}
							>
								{windowViewMode === "window" ? (
									<>
										<Space wrap size="small" style={{ marginBottom: 12 }}>
											<Text type="secondary">group:</Text>
											<Select
												style={{ width: 120 }}
												allowClear
												placeholder="全部"
												value={group}
												onChange={(v) => setGroup((v as string) ?? null)}
												options={groupOptions}
												disabled={selectedWindowId !== null}
											/>
											<Text type="secondary" style={{ marginLeft: 8 }}>treatment:</Text>
											<Select
												style={{ width: 120 }}
												allowClear
												placeholder="全部"
												value={treatment}
												onChange={(v) => setTreatment((v as string) ?? null)}
												options={treatmentOptions}
												disabled={selectedWindowId !== null}
											/>
											{selectedWindowId && (
												<Button size="small" onClick={() => setSelectedWindowId(null)}>
													清除选中 Window
												</Button>
											)}
										</Space>
										<Divider style={{ margin: "8px 0" }} />

										<Space orientation="vertical" style={{ width: "100%" }} size={8}>
											<Space wrap size="small">
												<Text type="secondary">参与设备：</Text>
												<Tag color="blue">{windowDevices.length} 个</Tag>
												<Text type="secondary">数据点：</Text>
												<Tag color="green">{points.length.toLocaleString()}</Tag>
											</Space>
											<Divider style={{ margin: "8px 0" }} />

											<div style={{ maxHeight: 400, overflow: "auto" }}>
												<Row gutter={[8, 8]}>
													{windows.map((w) => {
														const devicesForWindow = (w.device_ids || [])
															.map((did: number) => deviceMap.get(did))
															.filter(Boolean);
														return (
															<Col xs={24} md={12} lg={24} key={w.window_id}>
																<Card
																	size="small"
																	style={{
																		border: selectedWindowId === w.window_id ? "2px solid #1890ff" : undefined,
																		cursor: "pointer",
																		transition: "all 0.3s",
																		background: selectedWindowId === w.window_id ? "rgba(24, 144, 255, 0.03)" : undefined,
																	}}
																	onClick={() => setSelectedWindowId(w.window_id)}
																	title={
																		<Space size={4}>
																			<Tag color="purple">#{w.window_id}</Tag>
																			{w.group && <Tag color="blue">{w.group}</Tag>}
																			{w.treatment && <Tag color="orange">{w.treatment}</Tag>}
																		</Space>
																	}
																	extra={
																		manage ? (
																			<Space size={4}>
																				<Button size="small" onClick={(e) => { e.stopPropagation(); openWindowEdit(w); }}>
																					编辑
																				</Button>
																				<Button size="small" danger onClick={(e) => { e.stopPropagation(); confirmDeleteWindow(w); }}>
																					删除
																				</Button>
																			</Space>
																		) : null
																	}
																	styles={{ body: { padding: "8px 12px" } }}
																>
																	{/* 关联设备信息 */}
																	<div style={{ marginBottom: 8 }}>
																		<Text type="secondary" style={{ fontSize: 11 }}>关联设备 ({devicesForWindow.length})</Text>
																		<div style={{ marginTop: 4 }}>
																			{devicesForWindow.length > 0 ? (
																				<Space size={4} wrap>
																					{devicesForWindow.map((d: any) => (
																						<Link key={d.device_id} href={`/devices/${d.device_id}`} onClick={(e) => e.stopPropagation()}>
																							<Tag color="green" style={{ margin: 0, fontSize: 12, cursor: "pointer" }}>
																								{d.code}{d.name ? ` · ${d.name}` : ""}
																							</Tag>
																						</Link>
																					))}
																				</Space>
																			) : (
																				<Text type="secondary" style={{ fontSize: 12 }}>无关联设备</Text>
																			)}
																		</div>
																	</div>

																	{/* 备注信息 */}
																	{w.note && (
																		<div>
																			<Text type="secondary" style={{ fontSize: 11 }}>备注</Text>
																			<div style={{ marginTop: 2, fontSize: 12, color: "#595959" }}>
																				{w.note}
																			</div>
																		</div>
																	)}
																</Card>
															</Col>
														);
													})}
												</Row>
											</div>
										</Space>
									</>
								) : (
									<Space orientation="vertical" style={{ width: "100%" }} size={8}>
										<Space wrap size="small">
											<Text type="secondary">参与设备：</Text>
											<Tag color="blue">{windowDevices.length} 个</Tag>
											<Text type="secondary">Windows：</Text>
											<Tag color="green">{windows.length} 个</Tag>
										</Space>
										<Divider style={{ margin: "8px 0" }} />

										<div style={{ maxHeight: 400, overflow: "auto" }}>
											<Row gutter={[8, 8]}>
												{windowDevices.map((d: any) => {
													const windowsForDevice = windows.filter((w) =>
														(w.device_ids || []).includes(d.device_id)
													);
													return (
														<Col xs={24} md={12} lg={24} key={d.device_id}>
															<Card
																size="small"
																style={{
																	border: selectedWindowId === d.device_id ? "2px solid #1890ff" : undefined,
																	transition: "all 0.3s",
																	background: selectedWindowId === d.device_id ? "rgba(24, 144, 255, 0.03)" : undefined,
																}}
																onClick={() => setSelectedWindowId(d.device_id)}
																title={
																	<Link href={`/devices/${d.device_id}`} onClick={(e) => e.stopPropagation()}>
																		<Space size={4}>
																			<Tag color="green">{d.code}</Tag>
																			{d.name && <Text type="secondary" style={{ fontSize: 12 }}>· {d.name}</Text>}
																		</Space>
																	</Link>
																}
																styles={{ body: { padding: "8px 12px" } }}
															>
																{/* 关联 Windows 信息 */}
																<div>
																	<Text type="secondary" style={{ fontSize: 11 }}>关联 Windows ({windowsForDevice.length})</Text>
																	<div style={{ marginTop: 4 }}>
																		{windowsForDevice.length > 0 ? (
																			<Space size={4} wrap>
																				{windowsForDevice.map((w) => (
																					<Tag
																						key={w.window_id}
																						color="purple"
																						style={{ margin: 0, fontSize: 11 }}
																					>
																						#{w.window_id}
																						{w.group && ` ${w.group}`}
																						{w.treatment && ` / ${w.treatment}`}
																					</Tag>
																				))}
																			</Space>
																		) : (
																			<Text type="secondary" style={{ fontSize: 12 }}>无关联 Window</Text>
																		)}
																	</div>
																</div>

																{/* 设备备注 */}
																{d.note && (
																	<div style={{ marginTop: 8 }}>
																		<Text type="secondary" style={{ fontSize: 11 }}>备注</Text>
																		<div style={{ marginTop: 2, fontSize: 12, color: "#595959" }}>
																			{d.note}
																		</div>
																	</div>
																)}
															</Card>
														</Col>
													);
												})}
											</Row>
										</div>
									</Space>
								)}
							</Card>
						</Col>

						{/* 右侧内容区：图表 */}
						<Col xs={24} xl={16}>
							<Card
								title={selectedWindowId ? `数据图表 - Window #${selectedWindowId}` : "数据图表"}
								extra={
									selectedWindowId && (
										<Space>
											<Button size="small" onClick={() => setSelectedWindowId(null)}>
												显示全部
											</Button>
										</Space>
									)
								}
							>
								<Space orientation="vertical" style={{ width: "100%" }} size={12}>
									{selectedWindowId && (() => {
										const w = windows.find((win) => win.window_id === selectedWindowId);
										if (!w) return null;
										return (
											<Alert
												title={
													<Space>
														<Text strong>当前选中 Window</Text>
														<Tag color="purple">#{w.window_id}</Tag>
														{w.group && <Tag color="blue">{w.group}</Tag>}
														{w.treatment && <Tag color="orange">{w.treatment}</Tag>}
													</Space>
												}
												description={`时间范围: ${w.start_at || "-"} ~ ${w.end_at || "-"}`}
												type="info"
												showIcon
												closable
												onClose={() => setSelectedWindowId(null)}
											/>
										);
									})()}

									<Space wrap>
										<Text type="secondary">start</Text>
										<Tag>{run.start_at || "-"}</Tag>
										<Text type="secondary">end</Text>
										<Tag>{run.end_at || "-"}</Tag>
									</Space>

									<Space wrap>
										<DatePicker.RangePicker
											showTime
											value={range as any}
											onChange={(v) => setRange(v as any)}
											style={{ width: isMobile ? "100%" : 380 }}
											disabled={selectedWindowId !== null}
											allowEmpty
											presets={[
												{ label: "最近1小时", value: [dayjs().subtract(1, "hour"), dayjs()] as any },
												{ label: "今天", value: [dayjs().startOf("day"), dayjs()] as any },
												{ label: "最近7天", value: [dayjs().subtract(7, "day"), dayjs()] as any },
												{ label: "最近30天", value: [dayjs().subtract(30, "day"), dayjs()] as any },
												...(runQ.data?.start_at ? [{ label: "运行全时段", value: [dayjs(runQ.data.start_at), dayjs(runQ.data.end_at || dayjs())] as any }] : [])
											]}
										/>
										<Select
											style={{ width: 120 }}
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
											style={{ width: 120 }}
											value={dataLimit}
											onChange={setDataLimit}
											options={[
												{ value: 10000, label: "10K" },
												{ value: 20000, label: "20K" },
												{ value: 50000, label: "50K" },
												{ value: 100000, label: "100K" },
												{ value: 200000, label: "200K" },
											]}
										/>
										{selectedWindowId && (
											<Text type="secondary" style={{ fontSize: 11 }}>（已选中 Window，使用 Window 时间范围）</Text>
										)}
									</Space>

									{/* Channel 选择区域 */}
									{allChannels.length > 0 ? (
										<div style={{ marginBottom: 12 }}>
											<Space orientation="vertical" style={{ width: "100%" }} size={8}>
												{/* Metric 选择 - 支持多选 */}
												<Space align="center" wrap>
													<Text type="secondary" style={{ marginRight: 8 }}>选择指标（可多选）：</Text>
													<Space wrap>
														{availableMetrics.map((m) => (
															<CheckableTag
																key={m}
																checked={activeMetrics.has(m as MetricKey)}
																onChange={(checked) => {
																	const newSet = new Set(activeMetrics);
																	if (checked) {
																		newSet.add(m as MetricKey);
																	} else {
																		newSet.delete(m as MetricKey);
																	}
																	setActiveMetrics(newSet);
																}}
																style={{ fontSize: 12 }}
															>
																{m}
															</CheckableTag>
														))}
													</Space>
												</Space>

												{/* Channel 选择 - 显示所有选中 metric 的通道 */}
												{activeMetrics.size > 0 ? (
													<>
														<Divider style={{ margin: "4px 0" }} />
														<Space align="center" wrap>
															<Text type="secondary" style={{ marginRight: 8 }}>通道选择：</Text>
															<Button size="small" onClick={() => {
																const allMetricChannels: string[] = [];
																for (const m of activeMetrics) {
																	const channels = channelsByMetric.get(m) || [];
																	allMetricChannels.push(...channels.map(ch => ch.code));
																}
																setSelectedChannels(new Set(allMetricChannels));
															}}>
																全选所有指标
															</Button>
															<Button size="small" onClick={() => setSelectedChannels(new Set())}>
																清空
															</Button>
															<Tag color="blue">已选 {selectedChannels.size}</Tag>
														</Space>

														<div style={{ marginBottom: 8 }}>
															<Space size={[4, 8]} wrap>
																{Array.from(activeMetrics).map((m) => {
																	const channels = channelsByMetric.get(m) || [];
																	if (channels.length === 0) return null;
																	return (
																		<div key={m} style={{ marginRight: 12 }}>
																			<Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
																				{m} ({channels.length})
																			</Text>
																			<Space size={[4, 8]} wrap>
																				{channels.map((ch) => (
																					<CheckableTag
																						key={ch.code}
																						checked={selectedChannels.has(ch.code)}
																						onChange={(checked) => {
																							const newSet = new Set(selectedChannels);
																							if (checked) {
																								newSet.add(ch.code);
																							} else {
																								newSet.delete(ch.code);
																							}
																							setSelectedChannels(newSet);
																						}}
																						style={{ fontSize: 11 }}
																					>
																						{ch.label}
																					</CheckableTag>
																				))}
																			</Space>
																		</div>
																	);
																})}
															</Space>
														</div>
													</>
												) : (
													<Text type="secondary" style={{ fontSize: 12 }}>请先选择至少一个指标</Text>
												)}
											</Space>
										</div>
									) : (
										<Alert type="info" showIcon title="该 Run 的 Window 中暂未检测到可用的通道" />
									)}

									<Space wrap>
										<Tag>已选 Channels: {selectedCodes.length}</Tag>
										<Tag>总 Channels: {allChannels.length}</Tag>
										<Tag>devices: {windowDevices.length}</Tag>
										<Tag>windows: {windows.length}</Tag>
									</Space>

									<div style={{ height: 420 }}>
										<ReactECharts
											key={`${runId}-${selectedCodes.join(",")}-${bucket}-${from || ""}-${to || ""}-${group || ""}-${treatment || ""}-${selectedWindowId || ""}`}
											option={chartOption}
											notMerge
											lazyUpdate
											style={{ height: "100%", width: "100%" }}
										/>
									</div>

									{telemetryQ.isFetching && <Text type="secondary">加载中...</Text>}
									{telemetryQ.isError && <Text type="danger">Telemetry 加载失败</Text>}
									{!telemetryQ.isFetching && !points.length && (
										<Text type="secondary">暂无数据（请选择至少一个 Channel）</Text>
									)}
								</Space>
							</Card>
						</Col>
					</Row>
				</Col>
			</Row>

			{/* ===== Run 编辑 ===== */}
			<Modal
				open={runModalOpen}
				title="编辑 Run"
				onCancel={() => {
					setRunModalOpen(false);
					runForm.resetFields();
				}}
				onOk={submitRun}
				okText="保存"
				destroyOnHidden
				confirmLoading={updateRun.isPending}
			>
				<Form layout="vertical" form={runForm}>
					<Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入 run 名称" }]}>
						<Input placeholder="例如：2026-01-07 CK vs EFH" />
					</Form.Item>
					<Row gutter={12}>
						<Col xs={24} md={12}>
							<Form.Item label="开始时间" name="start_at">
								<DatePicker showTime style={{ width: "100%" }} />
							</Form.Item>
						</Col>
						<Col xs={24} md={12}>
							<Form.Item label="结束时间" name="end_at">
								<DatePicker showTime style={{ width: "100%" }} />
							</Form.Item>
						</Col>
					</Row>
					<Form.Item label="备注" name="note">
						<Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="可选" />
					</Form.Item>

					<Collapse
						items={[
							{
								key: "recipe",
								label: "高级：recipe（Key-Value）",
								children: (
									<Form.Item name="recipe">
										<KeyValueEditor placeholderKey="key" placeholderValue="value" />
									</Form.Item>
								),
							},
							{
								key: "settings",
								label: "高级：settings（Key-Value）",
								children: (
									<Form.Item name="settings">
										<KeyValueEditor placeholderKey="key" placeholderValue="value" />
									</Form.Item>
								),
							},
						]}
					/>
				</Form>
			</Modal>

			{/* ===== Window 新建 / 编辑 ===== */}
			<Modal
				open={windowModalOpen}
				title={editingWindow ? `编辑 Window #${editingWindow.window_id}` : "新建 Window"}
				onCancel={() => {
					setWindowModalOpen(false);
					windowForm.resetFields();
				}}
				onOk={submitWindow}
				okText={editingWindow ? "保存" : "创建"}
				destroyOnHidden
				confirmLoading={createWindow.isPending || updateWindow.isPending}
			>
				<Form layout="vertical" form={windowForm}>
					<Form.Item
						label="绑定设备"
						name="device_ids"
						rules={[{ required: true, message: "请至少选择一个设备" }]}
					>
						<Select
							mode="multiple"
							showSearch
							filterOption={(input, option) =>
								String(option?.label ?? '').toLowerCase().includes(String(input).toLowerCase())
							}
							placeholder="选择设备（可多选）"
							options={deviceOptions as any}
							maxTagCount="responsive"
						/>
					</Form.Item>

					<Row gutter={12}>
						<Col xs={24} md={12}>
							<Form.Item label="group" name="group">
								<Input placeholder="可选" />
							</Form.Item>
						</Col>
						<Col xs={24} md={12}>
							<Form.Item label="treatment" name="treatment">
								<Input placeholder="可选" />
							</Form.Item>
						</Col>
					</Row>

					<Form.Item label="跟随 Run 时间范围" name="follow_run" valuePropName="checked">
						<Switch />
					</Form.Item>

					<Form.Item shouldUpdate={(p, c) => p.follow_run !== c.follow_run} noStyle>
						{({ getFieldValue }) => {
							const fr = !!getFieldValue("follow_run");
							return (
								<Row gutter={12}>
									<Col xs={24} md={12}>
										<Form.Item label="start_at" name="start_at">
											<DatePicker showTime style={{ width: "100%" }} disabled={fr} />
										</Form.Item>
									</Col>
									<Col xs={24} md={12}>
										<Form.Item label="end_at" name="end_at">
											<DatePicker showTime style={{ width: "100%" }} disabled={fr} />
										</Form.Item>
									</Col>
								</Row>
							);
						}}
					</Form.Item>

					<Form.Item label="备注" name="note">
						<Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="可选" />
					</Form.Item>

					<Collapse
						items={[
							{
								key: "settings",
								label: "高级：settings（Key-Value）",
								children: (
									<Form.Item name="settings">
										<KeyValueEditor placeholderKey="key" placeholderValue="value" />
									</Form.Item>
								),
							},
							{
								key: "meta",
								label: "高级：meta（Key-Value）",
								children: (
									<Form.Item name="meta">
										<KeyValueEditor placeholderKey="key" placeholderValue="value" />
									</Form.Item>
								),
							},
						]}
					/>
				</Form>
			</Modal>
		</Page>
	);
}