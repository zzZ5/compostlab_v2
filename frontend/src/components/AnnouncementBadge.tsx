import { Badge, Button, Dropdown, Space, Typography, Tabs, Tag, Empty } from "antd";
import { BellOutlined, HistoryOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useMyAnnouncements, useMyHistory } from "@/features/announcements/queries";
import { useMarkAnnouncementAsRead } from "@/features/announcements/mutations";
import type { MyAnnouncement } from "@/types/api";

const { Text } = Typography;

// 格式化日期显示（用于创建时间等过去的时间）
function formatDate(dateString: string | null) {
	if (!dateString) return "永不过期";
	const date = new Date(dateString);
	const now = new Date();

	// 设置为同一天的午夜进行比较
	const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	const diffDays = Math.floor((nowMidnight.getTime() - dateMidnight.getTime()) / (1000 * 60 * 60 * 24));

	// 今天显示时间
	if (diffDays === 0) {
		const hours = date.getHours().toString().padStart(2, "0");
		const minutes = date.getMinutes().toString().padStart(2, "0");
		return `今天 ${hours}:${minutes}`;
	}

	// 昨天
	if (diffDays === 1) return "昨天";

	// 一周内
	if (diffDays < 7) return `${diffDays}天前`;

	// 一个月内
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;

	// 超过一个月，显示具体日期
	const year = date.getFullYear();
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");

	// 如果是今年，不显示年份
	const currentYear = now.getFullYear();
	if (year === currentYear) {
		return `${month}-${day}`;
	}

	// 否则显示完整日期
	return `${year}-${month}-${day}`;
}

// 格式化过期时间（用于未来的时间）
function formatExpiryDate(expiryDateString: string) {
	const expiryDate = new Date(expiryDateString);
	const now = new Date();

	// 设置为同一天的午夜进行比较
	const expiryMidnight = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
	const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	const diffDays = Math.floor((expiryMidnight.getTime() - nowMidnight.getTime()) / (1000 * 60 * 60 * 24));

	// 今天过期
	if (diffDays === 0) {
		const hours = expiryDate.getHours().toString().padStart(2, "0");
		const minutes = expiryDate.getMinutes().toString().padStart(2, "0");
		return `今天 ${hours}:${minutes}`;
	}

	// 明天过期
	if (diffDays === 1) return "明天";

	// 一周内过期
	if (diffDays < 7) return `${diffDays}天后`;

	// 一个月内过期
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}周后`;

	// 超过一个月，显示具体日期
	const year = expiryDate.getFullYear();
	const month = (expiryDate.getMonth() + 1).toString().padStart(2, "0");
	const day = expiryDate.getDate().toString().padStart(2, "0");

	// 如果是今年，不显示年份
	const currentYear = now.getFullYear();
	if (year === currentYear) {
		return `${month}-${day}`;
	}

	// 否则显示完整日期
	return `${year}-${month}-${day}`;
}

// 判断是否已过期
function isExpired(expiryDate: string | null) {
	if (!expiryDate) return false;
	return new Date(expiryDate) < new Date();
}

export default function AnnouncementBadge() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [activeTab, setActiveTab] = useState("unread");
	const [isMobile, setIsMobile] = useState(false);

	// 检测是否为移动端
	useEffect(() => {
		const checkMobile = () => {
			setIsMobile(window.innerWidth < 768);
		};
		checkMobile();
		window.addEventListener("resize", checkMobile);
		return () => window.removeEventListener("resize", checkMobile);
	}, []);

	// 获取未读公告
	const { data: myAnnouncementsData, isLoading: isLoadingUnread } = useMyAnnouncements({
		page: 1,
		page_size: 5,
		unread_only: true,
		enabled: open && activeTab === "unread",
	});

	// 获取历史公告
	const { data: historyData, isLoading: isLoadingHistory } = useMyHistory({
		page: 1,
		page_size: 5,
		enabled: open && activeTab === "history",
	});

	// 标记已读
	const markAsReadMutation = useMarkAnnouncementAsRead();

	const unreadCount = myAnnouncementsData?.unread_count || 0;
	const unreadAnnouncements = myAnnouncementsData?.data || [];
	const historyAnnouncements = historyData?.data || [];

	// 点击查看公告
	async function handleViewAnnouncement(announcement: MyAnnouncement) {
		// 标记为已读
		if (!announcement.is_read) {
			try {
				await markAsReadMutation.mutateAsync(announcement.id);
			} catch (error) {
				console.error("标记已读失败:", error);
			}
		}
		// 跳转到公告详情页（无刷新）
		setOpen(false);
		router.push(`/announcements/${announcement.id}`);
	}

	// 查看全部
	function handleViewAll() {
		setOpen(false);
		if (activeTab === "unread") {
			router.push("/announcements");
		} else {
			router.push("/announcements/history");
		}
	}

	// 优先级颜色
	const priorityColors: Record<string, string> = {
		urgent: "#ff4d4f",
		high: "#fa8c16",
		medium: "#1890ff",
		low: "#52c41a",
	};

	// 优先级标签
	const priorityLabels: Record<string, string> = {
		urgent: "紧急",
		high: "重要",
		medium: "普通",
		low: "低",
	};

	// 渲染公告项
	function renderAnnouncementItem(announcement: MyAnnouncement) {
		const expired = isExpired(announcement.expiry_at);
		return (
			<div
				key={announcement.id}
				style={{
					padding: "12px",
					borderBottom: "1px solid #f0f0f0",
					cursor: "pointer",
					transition: "background-color 0.2s",
				}}
				onClick={() => handleViewAnnouncement(announcement)}
				onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f5f5f5"}
				onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
			>
				<Space orientation="vertical" size={6} style={{ width: "100%" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
						<Text strong ellipsis style={{ flex: 1, fontSize: 14 }}>
							{announcement.title}
							{expired && <Tag color="red" style={{ marginLeft: 8, fontSize: 11 }}>已过期</Tag>}
							{announcement.is_pinned && <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>置顶</Tag>}
						</Text>
						{announcement.priority && (
							<Tag color={priorityColors[announcement.priority]} style={{ fontSize: 11, marginLeft: 8 }}>
								{priorityLabels[announcement.priority]}
							</Tag>
						)}
					</div>
					<Text type="secondary" ellipsis style={{ fontSize: 12, display: "block" }}>
						{announcement.content.substring(0, 80)}
						{announcement.content.length > 80 ? "..." : ""}
					</Text>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<Space size={8}>
							<Text type="secondary" style={{ fontSize: 11 }}>
								📅 {formatDate(announcement.created_at)}
							</Text>
							{announcement.expiry_at && (
								<Text
									type={expired ? "danger" : "secondary"}
									style={{ fontSize: 11 }}
								>
									⏰ {expired ? "已过期" : formatExpiryDate(announcement.expiry_at)}
								</Text>
							)}
						</Space>
					</div>
				</Space>
			</div>
		);
	}

	// 未读公告列表
	const unreadList = (
		<div style={{ maxHeight: 400, overflow: "auto" }}>
			{unreadAnnouncements.length === 0 ? (
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description="暂无未读公告"
					style={{ padding: "20px 0" }}
				/>
			) : (
				unreadAnnouncements.map(renderAnnouncementItem)
			)}
		</div>
	);

	// 历史公告列表
	const historyList = (
		<div style={{ maxHeight: 400, overflow: "auto" }}>
			{historyAnnouncements.length === 0 ? (
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description="暂无历史记录"
					style={{ padding: "20px 0" }}
				/>
			) : (
				historyAnnouncements.map(renderAnnouncementItem)
			)}
		</div>
	);

	// 标签页内容
	const tabItems = [
		{
			key: "unread",
			label: (
				<Space size={4}>
					<BellOutlined />
					未读 ({unreadCount})
				</Space>
			),
			children: unreadList,
		},
		{
			key: "history",
			label: (
				<Space size={4}>
					<HistoryOutlined />
					历史记录
				</Space>
			),
			children: historyList,
		},
	];

return (
	<Dropdown
			trigger={["click"]}
			placement={isMobile ? "bottomLeft" : "bottomRight"}
			open={open}
			onOpenChange={setOpen}
			getPopupContainer={(trigger) => trigger.parentElement || document.body}
			popupRender={(menu) => (
				<div
					style={{
						background: "#fff",
						borderRadius: 8,
						boxShadow: "0 3px 6px -4px rgba(0,0,0,.12), 0 6px 16px 0 rgba(0,0,0,.08), 0 9px 28px 8px rgba(0,0,0,.05)",
						width: isMobile ? "calc(100vw - 32px)" : 420,
						maxWidth: isMobile ? "calc(100vw - 32px)" : 420,
						marginLeft: isMobile ? "16px" : 0,
					}}
				>
					<Tabs
						activeKey={activeTab}
						onChange={setActiveTab}
						items={tabItems}
						size="small"
						style={{ width: "100%" }}
					/>
					<div
						style={{
							padding: "8px 12px",
							textAlign: "center",
							borderTop: "1px solid #f0f0f0",
							background: "#fafafa",
						}}
					>
						<Link href={`/announcements/${activeTab === "unread" ? "" : "history"}`}>
							<Text style={{ fontSize: 12, color: "#1890ff", cursor: "pointer" }}>
								查看全部{activeTab === "unread" ? "未读公告" : "历史记录"} →
							</Text>
						</Link>
					</div>
				</div>
			)}
	>
			<Badge count={unreadCount} overflowCount={99}>
				<Button
					type="text"
					icon={<BellOutlined />}
					loading={isLoadingUnread || isLoadingHistory}
					style={{ color: "#1890ff", fontSize: 18 }}
				/>
			</Badge>
		</Dropdown>
	);
}

