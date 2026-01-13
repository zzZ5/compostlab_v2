import { Alert, Button, Space, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { useState } from "react";

import { useMyAnnouncements, useMarkAnnouncementAsRead } from "@/features/announcements/queries";
import type { MyAnnouncement } from "@/types/api";

const { Text } = Typography;

interface AnnouncementBannerProps {
	maxVisible?: number; // 最多显示几条公告，默认 3
}

export default function AnnouncementBanner({ maxVisible = 3 }: AnnouncementBannerProps) {
	const [dismissedAnnouncements, setDismissedAnnouncements] = useState<Set<number>>(new Set());

	const { data: myAnnouncementsData } = useMyAnnouncements({
		page: 1,
		page_size: maxVisible,
		unread_only: true,
	});

	const markAsReadMutation = useMarkAnnouncementAsRead();

	// 过滤未关闭的公告
	const announcements = (myAnnouncementsData?.data || []).filter(
		(announcement) => !dismissedAnnouncements.has(announcement.id)
	);

	// 关闭公告
	function handleDismiss(announcementId: number, e: React.MouseEvent) {
		e.stopPropagation();
		setDismissedAnnouncements((prev) => new Set([...prev, announcementId]));
	}

	// 标记已读
	async function handleMarkAsRead(announcement: MyAnnouncement) {
		try {
			await markAsReadMutation.mutateAsync(announcement.id);
		} catch (error) {
			console.error("标记已读失败:", error);
		}
	}

	if (announcements.length === 0) {
		return null;
	}

	return (
		<div style={{ marginBottom: 16 }}>
			{announcements.map((announcement) => (
				<Alert
					key={announcement.id}
					message={
						<Space direction="vertical" size={4} style={{ width: "100%" }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "flex-start",
								}}
							>
								<Space size={8}>
									<Text strong style={{ fontSize: 14 }}>
										{announcement.title}
									</Text>
									{announcement.priority === "urgent" && (
										<span style={{ color: "#ff4d4f", fontSize: 12, fontWeight: 600 }}>
											[紧急]
										</span>
									)}
									{announcement.priority === "high" && (
										<span style={{ color: "#fa8c16", fontSize: 12, fontWeight: 600 }}>
											[重要]
										</span>
									)}
								</Space>
								<Button
									type="text"
									size="small"
									icon={<CloseOutlined />}
									onClick={(e) => handleDismiss(announcement.id, e)}
									style={{ padding: 0, minWidth: "auto" }}
								/>
							</div>
							<Text style={{ fontSize: 13 }}>{announcement.content}</Text>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
								<Text type="secondary" style={{ fontSize: 11 }}>
									{announcement.created_at}
								</Text>
								{!announcement.is_read && (
									<Button
										type="link"
										size="small"
										onClick={() => handleMarkAsRead(announcement)}
										style={{ padding: 0, height: "auto", fontSize: 12 }}
									>
										标记已读
									</Button>
								)}
							</div>
						</Space>
					}
					type={
						announcement.priority === "urgent"
							? "error"
							: announcement.priority === "high"
							? "warning"
							: "info"
					}
					closable={false}
					style={{ marginBottom: 8 }}
				/>
			))}
		</div>
	);
}
