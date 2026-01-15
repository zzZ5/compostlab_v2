"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { 
	Button, 
	Card, 
	Col, 
	Grid, 
	Input, 
	Modal, 
	Row, 
	Space, 
	Spin, 
	Switch, 
	Table, 
	Tag, 
	Typography, 
	message, 
	Select,
	Dropdown,
	Empty,
	Skeleton 
} from "antd";
import { 
	ArrowUpOutlined, 
	ArrowDownOutlined, 
	FilterOutlined,
	SortAscendingOutlined,
	MoreOutlined 
} from "@ant-design/icons";

import Page from "@/components/Page";
import { useRuns } from "@/features/runs/queries";
import { useCreateRun } from "@/features/runs/mutations";
import { useUpdateRun } from "@/features/runs/mutations";
import { useDeleteRun } from "@/features/runs/mutations";
import RunFormModal from "@/components/RunFormModal";
import { emptyObjectToUndefined } from "@/lib/kv";
import { getErrorMessage } from "@/lib/errors";

const { Text } = Typography;
const { useBreakpoint } = Grid;

type SortField = "run_id" | "name" | "start_at" | "end_at" | "window_count" | "device_count";
type SortOrder = "asc" | "desc";

interface FilterState {
	status: "all" | "running" | "finished" | "not_started";
}

function getRunStatus(r: any) {
	if (!r.start_at) return { text: "未开始", color: "default", value: "not_started" };
	if (r.end_at) return { text: "已结束", color: "success", value: "finished" };
	return { text: "进行中", color: "processing", value: "running" };
}

function getRunDuration(r: any) {
	if (!r.start_at) return "-";
	const start = dayjs(r.start_at);
	const end = r.end_at ? dayjs(r.end_at) : dayjs();
	const minutes = end.diff(start, "minute");
	if (minutes <= 0) return "-";
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins} 分钟`;
	if (mins === 0) return `${hours} 小时`;
	return `${hours} 小时 ${mins} 分钟`;
}

function getRecipeSummary(recipe: any) {
	if (!recipe || typeof recipe !== "object") return "-";
	const entries = Object.entries(recipe || {});
	if (!entries.length) return "-";
	return entries.slice(0, 4).map(([key, value]) => `${key}: ${value}`).join("; ") + (entries.length > 4 ? " ..." : "");
}

function getSettingsSummary(settings: any) {
	if (!settings || typeof settings !== "object") return "-";
	const keys = Object.keys(settings || {});
	if (!keys.length) return "-";
	return keys.slice(0, 3).join(", ") + (keys.length > 3 ? " ..." : "");
}

export default function RunsPage() {
	const screens = useBreakpoint();
	const isMobile = !screens.md;
	const router = useRouter();

	const [q, setQ] = useState("");
	const [manage, setManage] = useState(true);
	const [sortField, setSortField] = useState<SortField>("run_id");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
	const [filter, setFilter] = useState<FilterState>({ status: "all" });
	
	const runsQ = useRuns({ q: q.trim() || "" });
	const runs = runsQ.data || [];
	
	const createRun = useCreateRun();
	const deleteRun = useDeleteRun();
	const [editing, setEditing] = useState<any | null>(null);
	const updateRun = useUpdateRun(editing?.run_id || 0);
	const [modalOpen, setModalOpen] = useState(false);

	// 过滤和排序
	const filteredAndSortedRuns = useMemo(() => {
		let result = [...runs];
		
		// 状态筛选
		if (filter.status !== "all") {
			result = result.filter(r => getRunStatus(r).value === filter.status);
		}
		
		// 排序
		result.sort((a, b) => {
			let aVal: any, bVal: any;
			
			switch (sortField) {
				case "name":
					aVal = (a.name || "").toLowerCase();
					bVal = (b.name || "").toLowerCase();
					break;
				case "start_at":
					aVal = a.start_at || "";
					bVal = b.start_at || "";
					break;
				case "end_at":
					aVal = a.end_at || "";
					bVal = b.end_at || "";
					break;
				case "window_count":
					aVal = a.window_count || 0;
					bVal = b.window_count || 0;
					break;
				case "device_count":
					aVal = a.device_count || 0;
					bVal = b.device_count || 0;
					break;
				default:
					aVal = a.run_id || 0;
					bVal = b.run_id || 0;
			}
			
			if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
			if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
			return 0;
		});
		
		return result;
	}, [runs, filter, sortField, sortOrder]);

	function openCreate() {
		setEditing(null);
		setModalOpen(true);
	}

	function openEdit(r: any) {
		setEditing(r);
		setModalOpen(true);
	}

	function handleSort(field: SortField) {
		if (sortField === field) {
			setSortOrder(sortOrder === "asc" ? "desc" : "asc");
		} else {
			setSortField(field);
			setSortOrder("desc");
		}
	}

	function SortHeader({ title, field }: { title: string; field: SortField }) {
		const isCurrent = sortField === field;
		return (
			<Space 
				size={4} 
				onClick={() => handleSort(field)}
				style={{ cursor: "pointer", userSelect: "none" }}
			>
				<Text strong>{title}</Text>
				{isCurrent && (
					sortOrder === "asc" ? <ArrowUpOutlined /> : <ArrowDownOutlined />
				)}
			</Space>
		);
	}

	async function submitRun(payload: {
		name: string;
		start_at: string | null;
		end_at: string | null;
		note: string;
		recipe?: Record<string, any>;
		settings?: Record<string, any>;
	}) {
		try {
			const body: any = {
				name: String(payload.name || "").trim(),
				note: String(payload.note || ""),
				start_at: payload.start_at,
				end_at: payload.end_at,
			};
			const recipe = emptyObjectToUndefined(payload.recipe || {});
			const settings = emptyObjectToUndefined(payload.settings || {});
			if (recipe !== undefined) body.recipe = recipe;
			if (settings !== undefined) body.settings = settings;

			if (editing) {
				await updateRun.mutateAsync(body);
				message.success("已更新 run");
			} else {
				const created: any = await createRun.mutateAsync(body);
				message.success("已创建 run");
				if (created?.run_id) router.push(`/runs/${created.run_id}`);
			}
			setModalOpen(false);
		} catch (err: any) {
			message.error(getErrorMessage(err));
		}
	}

	function confirmDelete(r: any) {
		Modal.confirm({
			title: "删除 run",
			content: `确定删除 ${r.name || `Run #${r.run_id}`} 吗？该操作不可撤销。`,
			okText: "删除",
			okType: "danger",
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteRun.mutateAsync({ run_id: r.run_id });
					message.success("已删除 run");
				} catch (err: any) {
					message.error(getErrorMessage(err));
				}
			},
		});
	}

	const columns: any[] = [
		{
			title: <SortHeader title="Run" field="name" />,
			key: "run",
			dataIndex: "name",
			width: 200,
			render: (name: any, r: any) => (
				<Space orientation="vertical" size={4}>
					<Link
						href={`/runs/${r.run_id}`}
						style={{
							fontWeight: 500,
							color: "#1677ff",
							fontSize: 14,
							lineHeight: 1.4,
							transition: "all 0.2s",
						}}
						onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
						onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
					>
						{r.name || `Run #${r.run_id}`}
					</Link>
					<Text type="secondary" style={{ fontSize: 12, color: "#8c8c8c" }}>
						#{r.run_id}
					</Text>
				</Space>
			),
		},
		{
			title: <SortHeader title="状态 / 时长" field="start_at" />,
			key: "status",
			width: 140,
			render: (_: any, r: any) => {
				const status = getRunStatus(r);
				return (
					<Space orientation="vertical" size={2}>
						<Space size={4}>
							<Tag color={status.color}>{status.text}</Tag>
						</Space>
						<Text type="secondary" style={{ fontSize: 12 }}>
							{getRunDuration(r)}
						</Text>
					</Space>
				);
			},
		},
		{
			title: "概览",
			key: "overview",
			width: 180,
			render: (_: any, r: any) => (
				<Space orientation="vertical" size={2}>
					<Space size={4}>
						<Text type="secondary" style={{ fontSize: 12 }}>窗:</Text>
						<Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
							{r.window_count ?? 0}
						</Tag>
					</Space>
					<Space size={4}>
						<Text type="secondary" style={{ fontSize: 12 }}>设备:</Text>
						<Tag color="green" style={{ margin: 0, fontSize: 11 }}>
							{r.device_count ?? 0}
						</Tag>
					</Space>
					{r.device_list && r.device_list.length > 0 && (
						<Text type="secondary" style={{ fontSize: 11 }} ellipsis title={r.device_list.join(", ")}>
							{r.device_list.join(", ")}
						</Text>
					)}
				</Space>
			),
		},
		{
			title: "时间",
			key: "time",
			width: 180,
			render: (_: any, r: any) => (
				<Space orientation="vertical" size={2}>
					<Text style={{ fontSize: 12 }}>开始: {r.start_at ? r.start_at.split(" ")[0] : "-"}</Text>
					<Text style={{ fontSize: 12 }}>结束: {r.end_at ? r.end_at.split(" ")[0] : "-"}</Text>
				</Space>
			),
		},
		{
			title: "配方",
			key: "recipe",
			width: 200,
			render: (_: any, r: any) => (
				<div
					style={{
						fontSize: 12,
						lineHeight: 1.6,
						whiteSpace: "normal",
						wordBreak: "break-word",
					}}
					title={getRecipeSummary(r.recipe)}
				>
					{getRecipeSummary(r.recipe)}
				</div>
			),
		},
		{
			title: "备注",
			dataIndex: "note",
			key: "note",
			width: 250,
			render: (v: any) => (
				<div
					style={{
						fontSize: 12,
						color: "#595959",
						lineHeight: 1.6,
						whiteSpace: "normal",
						wordBreak: "break-word",
						overflow: "hidden",
						display: "-webkit-box",
						WebkitLineClamp: 3,
						WebkitBoxOrient: "vertical",
						maxHeight: 57,
					}}
					title={v || "-"}
				>
					{v || "-"}
				</div>
			),
		},
	];

	const columnsWithActions = useMemo(() => {
		if (!manage) return columns as any[];
		return [...(columns as any[]), {
			title: "操作",
			key: "actions",
			width: 120,
			fixed: "right",
			render: (_: any, r: any) => (
				<Space>
					<Button size="small" onClick={() => openEdit(r)}>编辑</Button>
					<Button size="small" danger onClick={() => confirmDelete(r)}>删除</Button>
				</Space>
			),
		}];
	}, [manage, columns]);

	// 空状态
	if (filteredAndSortedRuns.length === 0 && !runsQ.isLoading) {
		return (
			<Page
				title="运行批次"
				extra={
					<Space wrap>
						<Input.Search
							placeholder="搜索 run（name）"
							allowClear
							style={{ width: isMobile ? "100%" : 320 }}
							value={q}
							onChange={(e) => setQ(e.target.value)}
						/>
						<Select
							value={filter.status}
							onChange={(v) => setFilter({ ...filter, status: v as any })}
							style={{ width: isMobile ? "100%" : 140 }}
							options={[
								{ label: "全部状态", value: "all" },
								{ label: "进行中", value: "running" },
								{ label: "已结束", value: "finished" },
								{ label: "未开始", value: "not_started" }
							]}
						/>
						<Dropdown menu={{
							items: [
								{ key: "run_id", label: "按 ID 排序", onClick: () => setSortField("run_id") },
								{ key: "name", label: "按名称排序", onClick: () => setSortField("name") },
								{ key: "start_at", label: "按开始时间排序", onClick: () => setSortField("start_at") },
								{ key: "window_count", label: "按窗口数排序", onClick: () => setSortField("window_count") },
								{ key: "device_count", label: "按设备数排序", onClick: () => setSortField("device_count") }
							]
						}} trigger={["click"]}>
							<Button icon={<SortAscendingOutlined />}>
								{sortOrder === "asc" ? "升序" : "降序"}
							</Button>
						</Dropdown>
						<Space size={6}>
							<Text type="secondary">管理模式</Text>
							<Switch checked={manage} onChange={setManage} />
						</Space>
						{manage && (
							<Button type="primary" onClick={openCreate}>
								新建 Run
							</Button>
						)}
					</Space>
				}
			>
				<div style={{ padding: 80, textAlign: "center" }}>
					<Empty 
						description={
							q || filter.status !== "all" 
								? "没有找到匹配的运行批次" 
								: "暂无运行批次"
						}
					/>
					{manage && (
						<div style={{ marginTop: 24 }}>
							<Button type="primary" onClick={openCreate}>
								创建第一个运行批次
							</Button>
						</div>
					)}
				</div>
			</Page>
		);
	}

	if (runsQ.isLoading) {
		return (
			<div style={{ padding: 48 }}>
				<Spin />
			</div>
		);
	}

	return (
		<Page
			title="运行批次"
			extra={
				<Space wrap>
					<Input.Search
						placeholder="搜索 run（name）"
						allowClear
						style={{ width: isMobile ? "100%" : 320 }}
						value={q}
						onChange={(e) => setQ(e.target.value)}
					/>
					<Select
						value={filter.status}
						onChange={(v) => setFilter({ ...filter, status: v as any })}
						style={{ width: isMobile ? "100%" : 140 }}
						options={[
							{ label: "全部状态", value: "all" },
							{ label: "进行中", value: "running" },
							{ label: "已结束", value: "finished" },
							{ label: "未开始", value: "not_started" }
						]}
					/>
					<Dropdown menu={{
						items: [
							{ key: "run_id", label: "按 ID 排序", onClick: () => setSortField("run_id") },
							{ key: "name", label: "按名称排序", onClick: () => setSortField("name") },
							{ key: "start_at", label: "按开始时间排序", onClick: () => setSortField("start_at") },
							{ key: "window_count", label: "按窗口数排序", onClick: () => setSortField("window_count") },
							{ key: "device_count", label: "按设备数排序", onClick: () => setSortField("device_count") }
						]
					}} trigger={["click"]}>
						<Button icon={<SortAscendingOutlined />}>
							{sortOrder === "asc" ? "升序" : "降序"}
						</Button>
					</Dropdown>
					<Space size={6}>
						<Text type="secondary">管理模式</Text>
						<Switch checked={manage} onChange={setManage} />
					</Space>
					{manage && (
						<Button type="primary" onClick={openCreate}>
							新建 Run
						</Button>
					)}
				</Space>
			}
		>
			{isMobile ? (
				<Row gutter={[12, 12]}>
					{filteredAndSortedRuns.map((r: any) => (
						<Col xs={24} key={r.run_id}>
							<Card hoverable onClick={() => router.push(`/runs/${r.run_id}`)}>
								<div style={{ marginBottom: 8 }}>
									<div
										style={{
											fontSize: 16,
											fontWeight: 600,
											marginBottom: 6,
										}}
									>
										{r.name || `Run #${r.run_id}`}
									</div>
									<Space size={4} wrap>
										<Tag color="blue">ID {r.run_id}</Tag>
										{(() => {
											const status = getRunStatus(r);
											return <Tag color={status.color}>{status.text}</Tag>;
										})()}
									</Space>
								</div>

								<div style={{ marginTop: 8, fontSize: 13 }}>
									<Space size={12} wrap>
										<Space size={4}>
											<Text type="secondary" style={{ fontSize: 12 }}>时长:</Text>
											<Text style={{ fontSize: 11 }}>{getRunDuration(r)}</Text>
										</Space>
										<Space size={4}>
											<Text type="secondary" style={{ fontSize: 12 }}>Windows:</Text>
											<Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{r.window_count ?? 0}</Tag>
										</Space>
										<Space size={4}>
											<Text type="secondary" style={{ fontSize: 12 }}>设备:</Text>
											<Tag color="green" style={{ margin: 0, fontSize: 11 }}>{r.device_count ?? 0}</Tag>
										</Space>
									</Space>
									{r.device_list && r.device_list.length > 0 && (
										<div style={{ marginTop: 6 }}>
											<Text type="secondary" style={{ fontSize: 11 }} ellipsis title={r.device_list.join(", ")}>
												{r.device_list.join(", ")}
											</Text>
										</div>
									)}
									{r.note && (
										<div style={{ marginTop: 4 }}>
											<Text type="secondary" ellipsis style={{ fontSize: 12 }}>
												{r.note}
											</Text>
										</div>
									)}
								</div>

								{manage && (
									<div style={{ marginTop: 10 }}>
										<Space>
											<Button
												size="small"
												onClick={(e) => {
													e.stopPropagation();
													openEdit(r);
												}}
											>
												编辑
											</Button>
											<Button
												size="small"
												danger
												onClick={(e) => {
													e.stopPropagation();
													confirmDelete(r);
												}}
											>
												删除
											</Button>
										</Space>
									</div>
								)}
							</Card>
						</Col>
					))}
				</Row>
			) : (
				<Table 
					rowKey="run_id" 
					columns={columnsWithActions as any} 
					dataSource={filteredAndSortedRuns as any} 
					pagination={{ 
						pageSize: 20,
						showSizeChanger: true,
						pageSizeOptions: ["10", "20", "50", "100"],
						showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`
					}}
					scroll={{ x: 1200, y: "calc(100vh - 320px)" }}
					size="middle"
					sticky
				/>
			)}

			<RunFormModal
				open={modalOpen}
				title={editing ? "编辑 Run" : "新建 Run"}
				okText={editing ? "保存" : "创建"}
				confirmLoading={createRun.isPending || updateRun.isPending}
				initialValues={
					editing
						? {
							name: editing.name || "",
							start_at: editing.start_at ? dayjs(editing.start_at) : null,
							end_at: editing.end_at ? dayjs(editing.end_at) : null,
							note: editing.note || "",
							recipe: editing.recipe || {},
							settings: editing.settings || {},
						}
						: { name: "", start_at: dayjs(), end_at: null, note: "", recipe: {}, settings: {} }
				}
				onCancel={() => setModalOpen(false)}
				onSubmit={submitRun}
			/>
		</Page>
	);
}