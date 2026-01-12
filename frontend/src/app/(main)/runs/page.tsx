"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Button, Card, Col, Grid, Input, Modal, Row, Space, Spin, Switch, Table, Tag, Typography, message } from "antd";

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

function getRunStatus(r: any) {
	if (!r.start_at) return { text: "未开始", color: "default" };
	if (r.end_at) return { text: "已结束", color: "success" };
	return { text: "进行中", color: "processing" };
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
	const keys = Object.keys(recipe || {});
	if (!keys.length) return "-";
	return keys.slice(0, 3).join(", ") + (keys.length > 3 ? " ..." : "");
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
	// ✅ 管理模式默认开启（更符合“用户可直接维护 Run / Window”的场景）
	const [manage, setManage] = useState(true);
	const runsQ = useRuns({ q: q.trim() || "" });
	const runs = runsQ.data || [];
	const createRun = useCreateRun();
	const deleteRun = useDeleteRun();
	const [editing, setEditing] = useState<any | null>(null);
	const updateRun = useUpdateRun(editing?.run_id || 0);
	const [modalOpen, setModalOpen] = useState(false);

	function openCreate() {
		setEditing(null);
		setModalOpen(true);
	}

	function openEdit(r: any) {
		setEditing(r);
		setModalOpen(true);
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

	const data = useMemo(() => runs, [runs]);

	const columns: any[] = [
		{
			title: "Run",
			key: "run",
			dataIndex: "name",
			width: 220,
			render: (name: any, r: any) => (
				<Space orientation="vertical" size={2}>
					<Link href={`/runs/${r.run_id}`} style={{ fontWeight: 600, color: "#1890ff" }}>
						{r.name || `Run #${r.run_id}`}
					</Link>
					<Text type="secondary" style={{ fontSize: 12 }}>
						ID: {r.run_id}
					</Text>
				</Space>
			),
		},
		{
			title: "概览",
			key: "overview",
			width: 160,
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
			title: "状态 / 时长",
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
			title: "时间",
			key: "time",
			width: 200,
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
			width: 150,
			ellipsis: { showTitle: false },
			render: (_: any, r: any) => (
				<Text style={{ fontSize: 12 }} title={getRecipeSummary(r.recipe)}>
					{getRecipeSummary(r.recipe)}
				</Text>
			),
		},
		{
			title: "备注",
			dataIndex: "note",
			key: "note",
			width: 120,
			ellipsis: { showTitle: false },
			render: (v: any) => (
				<Text type="secondary" style={{ fontSize: 12 }} title={v || "-"}>
					{v || "-"}
				</Text>
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
					{data.map((r: any) => (
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
									</Space>
								</div>

								<div style={{ marginTop: 8, fontSize: 13 }}>
									{(() => {
										const status = getRunStatus(r);
										return (
											<>
												<Space size={12} wrap>
													<Space size={4}>
														<Text type="secondary" style={{ fontSize: 12 }}>状态:</Text>
														<Tag color={status.color} style={{ margin: 0, fontSize: 11 }}>{status.text}</Tag>
													</Space>
													<Space size={4}>
														<Text type="secondary" style={{ fontSize: 12 }}>时长:</Text>
														<Text style={{ fontSize: 11 }}>{getRunDuration(r)}</Text>
													</Space>
												</Space>
												<Space size={12} wrap style={{ marginTop: 6 }}>
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
															设备: {r.device_list.join(", ")}
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
											</>
										);
									})()}
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
					dataSource={data as any} 
					pagination={{ pageSize: 10 }}
					scroll={{ x: 1200 }}
					size="middle"
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