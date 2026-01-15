"use client";

import { useState } from "react";
import {
	Button,
	Card,
	Col,
	Form,
	Input,
	message,
	Modal,
	Row,
	Select,
	Space,
	Switch,
	Table,
	Tag,
	Typography,
	Drawer,
	DatePicker,
	Empty,
	Divider,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import type { RangePickerProps } from "antd/es/date-picker";

import Page from "@/components/Page";
import { useAnnouncementsList } from "@/features/announcements/queries";
import { useCreateAnnouncement, useUpdateAnnouncement, useDeleteAnnouncement } from "@/features/announcements/mutations";
import type { AnnouncementCategory, AnnouncementPriority, AnnouncementTargetRole, AnnouncementListItem } from "@/types/api";

const { Text, Paragraph } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

const categoryLabels: Record<AnnouncementCategory, string> = {
	system: "系统通知",
	maintenance: "维护通知",
	feature: "功能更新",
	announcement: "公告",
};

const priorityLabels: Record<AnnouncementPriority, string> = {
	low: "低",
	medium: "中",
	high: "高",
	urgent: "紧急",
};

const priorityColors: Record<AnnouncementPriority, string> = {
	low: "default",
	medium: "blue",
	high: "orange",
	urgent: "red",
};

const targetRoleLabels: Record<AnnouncementTargetRole, string> = {
	all: "所有用户",
	admin: "管理员",
	operator: "操作员",
	readonly: "只读用户",
};

export default function AnnouncementsPage() {
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [selectedAnnouncement, setSelectedAnnouncement] = useState<AnnouncementListItem | null>(null);
	const [editingAnnouncement, setEditingAnnouncement] = useState<AnnouncementListItem | null>(null);
	const [form] = Form.useForm();

	// 查询参数
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState<AnnouncementCategory | "">("");
	const [priority, setPriority] = useState<AnnouncementPriority | "">("");
	const [targetRole, setTargetRole] = useState<AnnouncementTargetRole | "">("");
	const [isActive, setIsActive] = useState<"">("");
	const [isExpired, setIsExpired] = useState<"">("");
	const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);

	const { data: listData, isLoading } = useAnnouncementsList({
		page,
		page_size: pageSize,
		search,
		category: category || undefined,
		priority: priority || undefined,
		target_role: targetRole || undefined,
		is_active: isActive || undefined,
		is_expired: isExpired || undefined,
		created_after: dateRange[0]?.toISOString(),
		created_before: dateRange[1]?.toISOString(),
	});

	const createMutation = useCreateAnnouncement();
	const updateMutation = useUpdateAnnouncement(editingAnnouncement?.id || 0);
	const deleteMutation = useDeleteAnnouncement();

	function openCreateModal() {
		setEditingAnnouncement(null);
		form.resetFields();
		setCreateModalOpen(true);
	}

	function openEditModal(announcement: AnnouncementListItem) {
		setEditingAnnouncement(announcement);
		form.setFieldsValue({
			title: announcement.title,
			content: announcement.content,
			category: announcement.category,
			priority: announcement.priority,
			target_role: announcement.target_role,
			is_active: announcement.is_active,
			is_pinned: announcement.is_pinned,
			expiry_at: announcement.expiry_at ? dayjs(announcement.expiry_at) : null,
		});
		setCreateModalOpen(true);
	}

	function openDetailDrawer(announcement: AnnouncementListItem) {
		setSelectedAnnouncement(announcement);
		setDrawerOpen(true);
	}

	function closeModal() {
		setCreateModalOpen(false);
		setEditingAnnouncement(null);
		form.resetFields();
	}

	async function handleSubmit() {
		try {
			const values = await form.validateFields();
			// 转换 expiry_at 为 ISO 字符串格式
			if (values.expiry_at) {
				values.expiry_at = (values.expiry_at as Dayjs).format("YYYY-MM-DD HH:mm:ss");
			} else {
				values.expiry_at = null;
			}
			if (editingAnnouncement) {
				await updateMutation.mutateAsync(values);
				message.success("公告更新成功");
			} else {
				await createMutation.mutateAsync(values);
				message.success("公告创建成功");
			}
			closeModal();
		} catch (error: any) {
			if (error.errorFields) return;
			message.error(error.message || "操作失败");
		}
	}

	function confirmDelete(id: number, title: string) {
		Modal.confirm({
			title: `确认删除公告"${title}"？`,
			okText: "删除",
			okButtonProps: { danger: true },
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteMutation.mutateAsync(id);
					message.success("公告删除成功");
				} catch (error: any) {
					message.error(error.message || "删除失败");
				}
			},
		});
	}

	const columns = [
		{
			title: "标题",
			dataIndex: "title",
			key: "title",
			render: (title: string, record: AnnouncementListItem) => (
				<Space orientation="vertical" size={0}>
					<Text strong>{title}</Text>
					{record.is_pinned && <Tag color="blue">置顶</Tag>}
					{record.is_expired && <Tag color="red">已过期</Tag>}
				</Space>
			),
		},
		{
			title: "分类",
			dataIndex: "category",
			key: "category",
			render: (cat: AnnouncementCategory) => <Tag>{categoryLabels[cat]}</Tag>,
			width: 120,
		},
		{
			title: "优先级",
			dataIndex: "priority",
			key: "priority",
			sorter: true,
			render: (pri: AnnouncementPriority) => <Tag color={priorityColors[pri]}>{priorityLabels[pri]}</Tag>,
			width: 100,
		},
		{
			title: "目标角色",
			dataIndex: "target_role",
			key: "target_role",
			render: (role: AnnouncementTargetRole) => <Tag>{targetRoleLabels[role]}</Tag>,
			width: 120,
		},
		{
			title: "状态",
			key: "status",
			render: (_: any, record: AnnouncementListItem) => (
				<Space size={8}>
					{record.is_active ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>}
				</Space>
			),
			width: 120,
		},
		{
			title: "阅读数",
			dataIndex: "read_count",
			key: "read_count",
			sorter: true,
			width: 100,
		},
		{
			title: "创建人",
			dataIndex: "created_by",
			key: "created_by",
			width: 100,
		},
		{
			title: "创建时间",
			dataIndex: "created_at",
			key: "created_at",
			sorter: true,
			width: 180,
			render: (date: string) => (
				<Text type="secondary" style={{ fontSize: 12 }}>
					{date}
				</Text>
			),
		},
		{
			title: "过期时间",
			dataIndex: "expiry_at",
			key: "expiry_at",
			sorter: true,
			width: 180,
			render: (date: string | null) => (
				<Text type={date && new Date(date) < new Date() ? "danger" : "secondary"} style={{ fontSize: 12 }}>
					{date || "永不过期"}
				</Text>
			),
		},
		{
			title: "操作",
			key: "actions",
			render: (_: any, record: AnnouncementListItem) => (
				<Space size={8}>
					<Button size="small" type="link" onClick={() => openDetailDrawer(record)}>
						查看详情
					</Button>
					<Button size="small" onClick={() => openEditModal(record)}>
						编辑
					</Button>
					<Button size="small" danger onClick={() => confirmDelete(record.id, record.title)}>
						删除
					</Button>
				</Space>
			),
			width: 200,
			fixed: "right" as const,
		},
	];

	// 日期范围选择变化
	const handleDateRangeChange: RangePickerProps["onChange"] = (dates) => {
		setDateRange(dates as [Dayjs | null, Dayjs | null]);
	};

	// 重置所有筛选条件
	function handleResetFilters() {
		setSearch("");
		setCategory("");
		setPriority("");
		setTargetRole("");
		setIsActive("");
		setIsExpired("");
		setDateRange([null, null]);
		setPage(1);
	}

	return (
		<Page
			title="公告管理"
			extra={
				<Space>
					<Button onClick={handleResetFilters}>重置筛选</Button>
					<Button type="primary" onClick={openCreateModal}>
						发布公告
					</Button>
				</Space>
			}
		>
			<Card
				style={{
					borderRadius: 8,
					boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
				}}
			>
				{/* 筛选栏 - 重新设计 */}
				<div
					style={{
						background: "#fafafa",
						padding: "16px 20px",
						borderRadius: 6,
						marginBottom: 20,
						border: "1px solid #f0f0f0",
					}}
				>
					<Row gutter={[16, 16]}>
						<Col xs={24} sm={12} md={8} lg={6}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>搜索</div>
								<Input
									placeholder="标题/内容"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									allowClear
									prefix={<span style={{ color: "#8c8c8c" }}>🔍</span>}
								/>
							</div>
						</Col>
						<Col xs={24} sm={12} md={8} lg={4}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>分类</div>
								<Select value={category} onChange={setCategory} allowClear placeholder="全部分类" style={{ width: "100%" }}>
									<Option value="system">系统通知</Option>
									<Option value="maintenance">维护通知</Option>
									<Option value="feature">功能更新</Option>
									<Option value="announcement">公告</Option>
								</Select>
							</div>
						</Col>
						<Col xs={24} sm={12} md={8} lg={4}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>优先级</div>
								<Select value={priority} onChange={setPriority} allowClear placeholder="全部优先级" style={{ width: "100%" }}>
									<Option value="low">低</Option>
									<Option value="medium">中</Option>
									<Option value="high">高</Option>
									<Option value="urgent">紧急</Option>
								</Select>
							</div>
						</Col>
						<Col xs={24} sm={12} md={8} lg={4}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>目标角色</div>
								<Select value={targetRole} onChange={setTargetRole} allowClear placeholder="全部角色" style={{ width: "100%" }}>
									<Option value="all">所有用户</Option>
									<Option value="admin">管理员</Option>
									<Option value="operator">操作员</Option>
									<Option value="readonly">只读用户</Option>
								</Select>
							</div>
						</Col>
						<Col xs={24} sm={12} md={8} lg={3}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>状态</div>
								<Select value={isActive} onChange={setIsActive} allowClear placeholder="全部状态" style={{ width: "100%" }}>
									<Option value="true">启用</Option>
									<Option value="false">禁用</Option>
								</Select>
							</div>
						</Col>
						<Col xs={24} sm={12} md={8} lg={3}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>过期状态</div>
								<Select value={isExpired} onChange={setIsExpired} allowClear placeholder="全部状态" style={{ width: "100%" }}>
									<Option value="true">已过期</Option>
									<Option value="false">未过期</Option>
								</Select>
							</div>
						</Col>
						<Col xs={24} sm={24} md={24} lg={8}>
							<div>
								<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>创建日期</div>
								<RangePicker
									value={dateRange}
									onChange={handleDateRangeChange}
									style={{ width: "100%" }}
									allowClear
									placeholder={["开始日期", "结束日期"]}
									size="middle"
								/>
							</div>
						</Col>
					</Row>
				</div>

				<Divider style={{ margin: "0 0 16px 0" }} />

				<Table
					rowKey="id"
					columns={columns}
					dataSource={listData?.data || []}
					loading={isLoading}
					pagination={{
						current: page,
						pageSize,
						showSizeChanger: true,
						onChange: setPage,
						onShowSizeChange: (_, size) => {
							setPageSize(size);
							setPage(1);
						},
						showTotal: (total) => `共 ${total} 条`,
					}}
					scroll={{ x: 1600 }}
					onChange={(pagination, filters, sorter) => {
						// Ant Design Table 内部排序处理
						console.log("Sort:", sorter);
					}}
				/>

				{listData?.data && listData.data.length === 0 && (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description="暂无符合条件的公告"
						style={{ padding: "60px 0" }}
					/>
				)}
			</Card>

			{/* 公告详情抽屉 */}
			<Drawer
				open={drawerOpen}
				title="公告详情"
				onClose={() => setDrawerOpen(false)}
				size="large"
				destroyOnHidden
			>
				{selectedAnnouncement && (
					<Space orientation="vertical" size={16} style={{ width: "100%" }}>
						<div>
							<Text strong style={{ fontSize: 18 }}>
								{selectedAnnouncement.title}
							</Text>
							{selectedAnnouncement.is_pinned && <Tag color="blue">置顶</Tag>}
							{selectedAnnouncement.is_expired && <Tag color="red">已过期</Tag>}
						</div>

						<Row gutter={16}>
							<Col span={8}>
								<Text type="secondary">分类：</Text>
								<Tag style={{ marginTop: 4 }}>
									{categoryLabels[selectedAnnouncement.category]}
								</Tag>
							</Col>
							<Col span={8}>
								<Text type="secondary">优先级：</Text>
								<Tag color={priorityColors[selectedAnnouncement.priority]} style={{ marginTop: 4 }}>
									{priorityLabels[selectedAnnouncement.priority]}
								</Tag>
							</Col>
							<Col span={8}>
								<Text type="secondary">状态：</Text>
								<Tag color={selectedAnnouncement.is_active ? "green" : "red"} style={{ marginTop: 4 }}>
									{selectedAnnouncement.is_active ? "启用" : "禁用"}
								</Tag>
							</Col>
						</Row>

						<div style={{ background: "#f5f5f5", padding: 16, borderRadius: 8 }}>
							<Text type="secondary" strong>
								公告内容
							</Text>
							<Paragraph
								style={{
									marginTop: 12,
									whiteSpace: "pre-wrap",
									lineHeight: 1.8,
									fontSize: 14,
								}}
							>
								{selectedAnnouncement.content}
							</Paragraph>
						</div>

						<Row gutter={16}>
							<Col span={12}>
								<Text type="secondary">创建人：</Text>
								<Text style={{ marginLeft: 8 }}>
									{selectedAnnouncement.created_by}
								</Text>
							</Col>
							<Col span={12}>
								<Text type="secondary">目标角色：</Text>
								<Tag style={{ marginLeft: 8 }}>
									{targetRoleLabels[selectedAnnouncement.target_role]}
								</Tag>
							</Col>
						</Row>

						<Row gutter={16}>
							<Col span={12}>
								<Text type="secondary">创建时间：</Text>
								<Text style={{ marginLeft: 8 }}>
									{selectedAnnouncement.created_at}
								</Text>
							</Col>
							<Col span={12}>
								<Text type="secondary">过期时间：</Text>
								<Text
									type={selectedAnnouncement.expiry_at && new Date(selectedAnnouncement.expiry_at) < new Date() ? "danger" : undefined}
									style={{ marginLeft: 8 }}
								>
									{selectedAnnouncement.expiry_at || "永不过期"}
								</Text>
							</Col>
						</Row>

						<Row gutter={16}>
							<Col span={12}>
								<Text type="secondary">阅读人数：</Text>
								<Text strong style={{ marginLeft: 8 }}>
									{selectedAnnouncement.read_count}
								</Text>
							</Col>
							<Col span={12}>
								<Text type="secondary">最后更新：</Text>
								<Text style={{ marginLeft: 8 }}>
									{selectedAnnouncement.updated_at}
								</Text>
							</Col>
						</Row>
					</Space>
				)}
			</Drawer>

			{/* 创建/编辑公告模态框 */}
			<Modal
				open={createModalOpen}
				title={editingAnnouncement ? "编辑公告" : "发布公告"}
				onCancel={closeModal}
				onOk={handleSubmit}
				okText={editingAnnouncement ? "保存" : "发布"}
				cancelText="取消"
				destroyOnHidden
				confirmLoading={createMutation.isPending || updateMutation.isPending}
				width={700}
			>
				<Form form={form} layout="vertical">
					<Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
						<Input placeholder="请输入公告标题" />
					</Form.Item>
					<Form.Item label="内容" name="content" rules={[{ required: true, message: "请输入内容" }]}>
						<Input.TextArea rows={6} placeholder="请输入公告内容" />
					</Form.Item>
					<Row gutter={16}>
						<Col span={8}>
							<Form.Item label="分类" name="category" initialValue="announcement">
								<Select>
									<Option value="system">系统通知</Option>
									<Option value="maintenance">维护通知</Option>
									<Option value="feature">功能更新</Option>
									<Option value="announcement">公告</Option>
								</Select>
							</Form.Item>
						</Col>
						<Col span={8}>
							<Form.Item label="优先级" name="priority" initialValue="medium">
								<Select>
									<Option value="low">低</Option>
									<Option value="medium">中</Option>
									<Option value="high">高</Option>
									<Option value="urgent">紧急</Option>
								</Select>
							</Form.Item>
						</Col>
						<Col span={8}>
							<Form.Item label="目标角色" name="target_role" initialValue="all">
								<Select>
									<Option value="all">所有用户</Option>
									<Option value="admin">管理员</Option>
									<Option value="operator">操作员</Option>
									<Option value="readonly">只读用户</Option>
								</Select>
							</Form.Item>
						</Col>
					</Row>
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item label="过期时间" name="expiry_at">
								<DatePicker
									showTime
									format="YYYY-MM-DD HH:mm:ss"
									style={{ width: "100%" }}
									placeholder="选择过期时间（留空表示永不过期）"
									allowClear
								/>
							</Form.Item>
						</Col>
						<Col span={6}>
							<Form.Item label="是否启用" name="is_active" valuePropName="checked" initialValue={true}>
								<Switch />
							</Form.Item>
						</Col>
						<Col span={6}>
							<Form.Item label="是否置顶" name="is_pinned" valuePropName="checked" initialValue={false}>
								<Switch />
							</Form.Item>
						</Col>
					</Row>
				</Form>
			</Modal>
		</Page>
	);
}

