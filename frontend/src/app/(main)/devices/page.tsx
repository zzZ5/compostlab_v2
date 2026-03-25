"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	Button,
	Card,
	Col,
	Grid,
	Input,
	Modal,
	Row,
	Select,
	Space,
	Spin,
	Switch,
	Table,
	Tag,
	Typography,
	Tooltip,
	Pagination,
	message,
} from "antd";

import Page from "@/components/Page";
import DeviceFormModal, { type DeviceFormValues } from "@/components/DeviceFormModal";
import { useDevicesTree } from "@/features/devices/queries";
import { useCreateDevice } from "@/features/devices/mutations";
import { useUpdateDevice } from "@/features/devices/mutations";
import { useDeleteDevice } from "@/features/devices/mutations";

import { getErrorMessage } from "@/lib/errors";

import { getOnlineState, onlineTag } from "@/lib/status";
import { evalO2, evalTemp } from "@/lib/alerts";
import { MetricKey, metricLabel, detectChannelMetric } from "@/lib/metrics";
import { groupChannelsByMetric } from "@/lib/channelGroups";

const { Text } = Typography;
const { useBreakpoint } = Grid;

type DeviceProfile = "cp500-v3" | "smart-compost" | "mmcgs" | "generic";

function inferDeviceProfile(device: any): DeviceProfile {
	const text = `${device?.code || ""} ${device?.name || ""} ${device?.meta?.profile || ""} ${device?.meta?.model || ""} ${device?.meta?.device_type || ""}`.toLowerCase();
	const channelCodes = new Set((device?.channels || []).map((channel: any) => String(channel.code || "").toLowerCase()));

	if (text.includes("mmcgs") || channelCodes.has("point1") || channelCodes.has("point2") || channelCodes.has("purge")) {
		return "mmcgs";
	}
	if (text.includes("cp500") || channelCodes.has("tempin") || channelCodes.has("tanktemp") || channelCodes.has("heater")) {
		return "cp500-v3";
	}
	if (text.includes("smartcompost") || text.includes("smart-compost") || channelCodes.has("roomtemp") || channelCodes.has("airhumidity")) {
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

function getProfileColor(profile: DeviceProfile): string {
	switch (profile) {
		case "cp500-v3":
			return "blue";
		case "smart-compost":
			return "green";
		case "mmcgs":
			return "purple";
		default:
			return "default";
	}
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

function isMmcgsDevice(d: any): boolean {
	const text = `${d?.code || ""} ${d?.name || ""} ${d?.meta?.profile || ""} ${d?.meta?.model || ""}`.toLowerCase();
	return text.includes("mmcgs");
}

function sevRank(sev: "danger" | "warn" | "ok" | "none") {
	if (sev === "danger") return 3;
	if (sev === "warn") return 2;
	if (sev === "ok") return 1;
	return 0;
}

function overallSev(tempSev: any, o2Sev: any): "danger" | "warn" | "ok" | "none" {
	const r = Math.max(sevRank(tempSev), sevRank(o2Sev));
	return r === 3 ? "danger" : r === 2 ? "warn" : r === 1 ? "ok" : "none";
}

function latestNumber(ch: any): number | null {
	const v = ch?.latest?.value;
	if (typeof v === "number") return v;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function maxLatest(chs: any[]): number | null {
	let best: number | null = null;
	for (const ch of chs || []) {
		const v = latestNumber(ch);
		if (v === null) continue;
		best = best === null ? v : Math.max(best, v);
	}
	return best;
}

function minLatest(chs: any[]): number | null {
	let best: number | null = null;
	for (const ch of chs || []) {
		const v = latestNumber(ch);
		if (v === null) continue;
		best = best === null ? v : Math.min(best, v);
	}
	return best;
}

export default function DevicesPage() {
	const screens = useBreakpoint();
	const isMobile = !screens.md;
	const router = useRouter();

	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [q, setQ] = useState("");
	const devicesQ = useDevicesTree(true, page, pageSize, q.trim() || undefined);
	const devices = devicesQ.data?.data || [];
	const total = devicesQ.data?.pagination?.total ?? devicesQ.data?.count ?? devices.length;
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [alertFilter, setAlertFilter] = useState<string>("all");
	const [manage, setManage] = useState(true);

	useEffect(() => {
		setPage(1);
	}, [q, statusFilter, alertFilter]);

	const createDevice = useCreateDevice();
	const [editing, setEditing] = useState<any | null>(null);
	const updateDevice = useUpdateDevice(editing?.device_id || 0);
	const deleteDevice = useDeleteDevice();

	const [modalOpen, setModalOpen] = useState(false);

	function openCreate() {
		setEditing(null);
		setModalOpen(true);
	}

	function openEdit(d: any) {
		setEditing(d);
		setModalOpen(true);
	}

	async function submitDevice(values: DeviceFormValues) {
		try {
			const body: any = {
				code: String(values.code || "").trim(),
				name: String(values.name || "").trim(),
				post_topic: (values.post_topic || "").trim() || null,
				response_topic: (values.response_topic || "").trim() || null,
				note: (values.note || "").trim(),
				is_active: !!values.is_active,
			};
			// meta: 空对象时发送null来清空服务器端的meta
			if (values.meta !== undefined) {
				if (!values.meta || Object.keys(values.meta).length === 0) {
					body.meta = null;
				} else {
					body.meta = values.meta;
				}
			}

			if (editing) {
				await updateDevice.mutateAsync(body);
				message.success("设备已更新");
			} else {
				await createDevice.mutateAsync(body);
				message.success("设备已创建");
			}
			setModalOpen(false);
		} catch (e: any) {
			message.error(getErrorMessage(e, editing ? "更新失败" : "创建失败"));
		}
	}

	function confirmDelete(d: any) {
		Modal.confirm({
			title: "确认删除设备？",
			content: `将删除设备：${d?.name || d?.code || d?.device_id}（同时可能影响关联数据）`,
			okText: "删除",
			okButtonProps: { danger: true },
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteDevice.mutateAsync({ device_id: d.device_id });
					message.success("设备已删除");
				} catch (e) {
					message.error(getErrorMessage(e, "删除失败"));
				}
			},
		});
	}

	const filtered = useMemo(() => {
		const qq = q.trim().toLowerCase();

		return devices
			.filter((d) => {
				const state = getOnlineState(d.last_seen_at);
				if (statusFilter !== "all" && state !== statusFilter) return false;

				const tempChs = (d.channels || []).filter((ch: any) => detectChannelMetric(ch) === "temperature");
				const o2Chs = (d.channels || []).filter((ch: any) => detectChannelMetric(ch) === "o2");
				const tempV = maxLatest(tempChs);
				const o2V = minLatest(o2Chs);

				const tA = evalTemp(tempV);
				const oA = evalO2(o2V);
				const ov = overallSev(tA.sev, oA.sev);
				if (alertFilter !== "all" && ov !== alertFilter) return false;

				if (!qq) return true;
				const hay = `${d.name || ""} ${d.code || ""}`.toLowerCase();
				return hay.includes(qq);
			})
			.sort((a, b) => b.device_id - a.device_id); // 按device_id降序排列，新设备在前
	}, [devices, q, statusFilter, alertFilter]);

	const displayDevices = useMemo(() => {
		const mmcgsGroups = new Map<string, any[]>();
		const normalDevices: any[] = [];

		for (const device of filtered) {
			if (!isMmcgsDevice(device)) {
				normalDevices.push(device);
				continue;
			}
			const controllerCode = getMmcgsControllerCode(device.code);
			if (!mmcgsGroups.has(controllerCode)) mmcgsGroups.set(controllerCode, []);
			mmcgsGroups.get(controllerCode)!.push(device);
		}

		const mmcgsControllers = Array.from(mmcgsGroups.values()).map((group) => {
			const controller =
				group.find((item) => getMmcgsPointIndex(item.code) === null) ||
				group.slice().sort((a, b) => a.device_id - b.device_id)[0];
			const points = group
				.filter((item) => getMmcgsPointIndex(item.code) !== null)
				.sort((a, b) => (getMmcgsPointIndex(a.code) || 0) - (getMmcgsPointIndex(b.code) || 0));
			return {
				...controller,
				mmcgs_points: points,
				mmcgs_controller_code: getMmcgsControllerCode(controller.code),
			};
		});

		return [...normalDevices, ...mmcgsControllers].sort((a, b) => b.device_id - a.device_id);
	}, [filtered]);

	const columns = useMemo(() => {
		const cols: any[] = [
			{
				title: "Device",
				key: "device",
				render: (_: any, d: any) => (
					<Space orientation="vertical" size={2}>
						<Link href={`/devices/${d.device_id}`} style={{ fontWeight: 700 }}>
							{d.name || d.code}
						</Link>
						<Text type="secondary" style={{ fontSize: 12 }}>
							{d.code}
						</Text>
						{d.mmcgs_points?.length ? (
							<Space wrap size={4}>
								<Tag color="purple">MMCGS</Tag>
								{d.mmcgs_points.map((point: any) => (
									<Link key={point.device_id} href={`/devices/${point.device_id}`}>
										<Tag style={{ cursor: "pointer" }}>{`P${getMmcgsPointIndex(point.code) ?? "?"}`}</Tag>
									</Link>
								))}
							</Space>
						) : null}
					</Space>
				),
			},
			{
				title: "Status",
				key: "status",
				width: 140,
				render: (_: any, d: any) => {
					const st = onlineTag(getOnlineState(d.last_seen_at));
					return <Tag color={st.color}>{st.text}</Tag>;
				},
			},
			{
				title: "Type",
				key: "type",
				width: 150,
				render: (_: any, d: any) => {
					const profile = inferDeviceProfile(d);
					return <Tag color={getProfileColor(profile)}>{getProfileLabel(profile)}</Tag>;
				},
			},
			{
				title: "Alerts",
				key: "alerts",
				width: 160,
				render: (_: any, d: any) => {
					const tempChs = (d.channels || []).filter((ch: any) => detectChannelMetric(ch) === "temperature");
					const o2Chs = (d.channels || []).filter((ch: any) => detectChannelMetric(ch) === "o2");
					const tempV = maxLatest(tempChs);
					const o2V = minLatest(o2Chs);

					const tA = evalTemp(tempV);
					const oA = evalO2(o2V);
					const ov = overallSev(tA.sev, oA.sev);

					const color = ov === "danger" ? "red" : ov === "warn" ? "orange" : ov === "ok" ? "green" : "default";
					const text = ov === "danger" ? "Danger" : ov === "warn" ? "Warn" : ov === "ok" ? "OK" : "No Data";

					return (
						<Space>
							<Tag color={color}>{text}</Tag>
							<Tooltip title={`温度（取最大）：${tA.tip}；氧气（取最小）：${oA.tip}`}>
								<span style={{ color: "rgba(0,0,0,.45)" }}>ⓘ</span>
							</Tooltip>
						</Space>
					);
				},
			},
			{
				title: "Metrics",
				key: "metrics",
				render: (_: any, d: any) => {
					const metricGroups = groupChannelsByMetric(d.channels || []);
					const ms = metricGroups.map((g) => g.key).filter((m) => m !== "unknown") as MetricKey[];

					return ms.length ? (
						<Space wrap size={6}>
							{ms.map((m) => (
								<Tag key={m}>{metricLabel(m)}</Tag>
							))}
						</Space>
					) : (
						<Tag>未分类</Tag>
					);
				},
			},
			{
				title: "Structure",
				key: "structure",
				width: 220,
				render: (_: any, d: any) => (
					<Space wrap size={6}>
						<Tag>{`${d.channels?.length || 0} 通道`}</Tag>
						{d.mmcgs_points?.length ? <Tag color="purple">{`${d.mmcgs_points.length} 点位`}</Tag> : null}
						{d.is_active === false ? <Tag color="default">已停用</Tag> : <Tag color="green">启用中</Tag>}
					</Space>
				),
			},
			{
				title: "Last seen",
				dataIndex: "last_seen_at",
				key: "last_seen_at",
				width: 170,
				render: (v: any) => <Text style={{ fontSize: 12 }}>{v || "-"}</Text>,
				sorter: (a: any, b: any) => String(a.last_seen_at || "").localeCompare(String(b.last_seen_at || "")),
			},
		];

		if (manage) {
			cols.push({
				title: "操作",
				key: "actions",
				width: 180,
				render: (_: any, d: any) => (
					<Space>
						<Button size="small" onClick={() => openEdit(d)}>
							编辑
						</Button>
						<Button size="small" danger onClick={() => confirmDelete(d)}>
							删除
						</Button>
					</Space>
				),
			});
		}

		return cols;
	}, [manage]);

	if (devicesQ.isLoading) {
		return (
			<div style={{ padding: 48 }}>
				<Spin />
			</div>
		);
	}

	return (
		<Page
			title="设备管理"
			extra={
				<Space wrap>
					<Input.Search
						placeholder="搜索设备（name / code）"
						allowClear
						style={{ width: isMobile ? "100%" : 320 }}
						value={q}
						onChange={(e) => setQ(e.target.value)}
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
						style={{ width: isMobile ? "100%" : 160 }}
						value={alertFilter}
						onChange={setAlertFilter}
						options={[
							{ value: "all", label: "全部告警" },
							{ value: "danger", label: "Danger" },
							{ value: "warn", label: "Warn" },
							{ value: "ok", label: "OK" },
							{ value: "none", label: "No Data" },
						]}
					/>
					<Space size={6}>
						<Text type="secondary">管理模式</Text>
						<Switch checked={manage} onChange={setManage} />
					</Space>
					{manage && (
						<Button type="primary" onClick={openCreate}>
							新建设备
						</Button>
					)}
				</Space>
			}
		>
			{/* Mobile CardList */}
			{isMobile ? (
				<Row gutter={[12, 12]}>
					{displayDevices.map((d) => {
						const st = onlineTag(getOnlineState(d.last_seen_at));
						const profile = inferDeviceProfile(d);

						const metricGroups = groupChannelsByMetric(d.channels || []);

						return (
							<Col xs={24} key={d.device_id}>
								<Card hoverable onClick={() => router.push(`/devices/${d.device_id}`)}>
									<div style={{ marginBottom: 8 }}>
										<div
											style={{
												fontSize: 16,
												fontWeight: 600,
												marginBottom: 6,
											}}
										>
											{d.name || d.code}
										</div>
										<Space size={4} wrap>
											<Tag color={st.color}>{st.text}</Tag>
											<Tag color="blue">{d.code}</Tag>
											<Tag color={getProfileColor(profile)}>{getProfileLabel(profile)}</Tag>
											{d.mmcgs_points?.length ? <Tag color="purple">{`MMCGS · ${d.mmcgs_points.length} 点位`}</Tag> : null}
											<Tag>{`${d.channels?.length || 0} 通道`}</Tag>
										</Space>
									</div>

									{d.mmcgs_points?.length ? (
										<div style={{ marginBottom: 10 }}>
											<Space wrap size={6}>
												{d.mmcgs_points.map((point: any) => (
													<Button
														key={point.device_id}
														size="small"
														onClick={(e) => {
															e.stopPropagation();
															router.push(`/devices/${point.device_id}`);
														}}
													>
														{`P${getMmcgsPointIndex(point.code) ?? "?"}`}
													</Button>
												))}
											</Space>
										</div>
									) : null}

									{metricGroups.length > 0 && (
										<div style={{ marginTop: 8 }}>
											<Space wrap size={6}>
												{metricGroups.map((group) => (
													<Tag key={group.key}>{`${metricLabel(group.key as MetricKey)} · ${group.channels.length}`}</Tag>
												))}
											</Space>
										</div>
									)}

									{manage && (
										<div style={{ marginTop: 10 }}>
											<Space>
												<Button
													size="small"
													onClick={(e) => {
														e.stopPropagation();
														openEdit(d);
													}}
												>
													编辑
												</Button>
												<Button
													size="small"
													danger
													onClick={(e) => {
														e.stopPropagation();
														confirmDelete(d);
													}}
												>
													删除
												</Button>
											</Space>
										</div>
									)}
								</Card>
							</Col>
						);
					})}
				</Row>
			) : (
				// Desktop Table
					<Table
						rowKey="device_id"
						columns={columns as any}
						dataSource={displayDevices as any}
					pagination={{
						current: page,
						pageSize,
						total,
						showSizeChanger: true,
						onChange: (nextPage, nextPageSize) => {
							setPage(nextPage);
							if (nextPageSize && nextPageSize !== pageSize) {
								setPageSize(nextPageSize);
								setPage(1);
							}
						},
					}}
				/>
			)}

			{isMobile && (
				<Pagination
					style={{ marginTop: 16, textAlign: "right" }}
					current={page}
					pageSize={pageSize}
					total={total}
					showSizeChanger
					onChange={(nextPage, nextPageSize) => {
						setPage(nextPage);
						if (nextPageSize && nextPageSize !== pageSize) {
							setPageSize(nextPageSize);
							setPage(1);
						}
					}}
				/>
			)}

			<DeviceFormModal
				open={modalOpen}
				title={editing ? "编辑设备" : "新建设备"}
				okText={editing ? "保存" : "创建"}
				initialValues={
					editing
						? {
							code: editing.code,
							name: editing.name,
							device_type: editing.meta?.profile || editing.meta?.device_type || undefined,
							post_topic: editing.post_topic || "",
							response_topic: editing.response_topic || "",
							note: editing.note || "",
							is_active: editing.is_active !== false,
							meta: editing.meta || {},
						}
						: { is_active: true, meta: {} }
				}
				confirmLoading={createDevice.isPending || updateDevice.isPending}
				onCancel={() => setModalOpen(false)}
				onSubmit={submitDevice}
			/>
		</Page>
	);
}
