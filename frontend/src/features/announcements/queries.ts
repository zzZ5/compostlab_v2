import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
	AnnouncementListItem,
	MyAnnouncement,
	MyHistoryResp,
	PaginatedResp,
	UnreadCountResp,
} from "@/types/api";

// =========================
// Admin Queries
// =========================

export function useAnnouncementsList(params?: {
	page?: number;
	page_size?: number;
	search?: string;
	category?: string;
	priority?: string;
	target_role?: string;
	is_active?: string;
	is_pinned?: string;
	is_expired?: string;
	created_after?: string;
	created_before?: string;
}) {
	return useQuery({
		queryKey: ["announcements", "list", params],
		queryFn: async () => {
			const searchParams = new URLSearchParams();
			if (params?.page) searchParams.append("page", params.page.toString());
			if (params?.page_size) searchParams.append("page_size", params.page_size.toString());
			if (params?.search) searchParams.append("search", params.search);
			if (params?.category) searchParams.append("category", params.category);
			if (params?.priority) searchParams.append("priority", params.priority);
			if (params?.target_role) searchParams.append("target_role", params.target_role);
			if (params?.is_active) searchParams.append("is_active", params.is_active);
			if (params?.is_pinned) searchParams.append("is_pinned", params.is_pinned);
			if (params?.is_expired) searchParams.append("is_expired", params.is_expired);
			if (params?.created_after) searchParams.append("created_after", params.created_after);
			if (params?.created_before) searchParams.append("created_before", params.created_before);

			const queryString = searchParams.toString();
			const response = await api.get(`/announcements${queryString ? `?${queryString}` : ""}`);
			return response.data as PaginatedResp<AnnouncementListItem>;
		},
	});
}

export function useAnnouncementDetail(id: number) {
	return useQuery({
		queryKey: ["announcements", id],
		queryFn: async () => {
			const response = await api.get(`/announcements/${id}`);
			return response.data as AnnouncementListItem;
		},
		enabled: !!id,
	});
}

// =========================
// User Queries
// =========================

export function useMyAnnouncements(params?: {
	page?: number;
	page_size?: number;
	unread_only?: boolean;
}) {
	return useQuery({
		queryKey: ["announcements", "my", params],
		queryFn: async () => {
			const searchParams = new URLSearchParams();
			if (params?.page) searchParams.append("page", params.page.toString());
			if (params?.page_size) searchParams.append("page_size", params.page_size.toString());
			if (params?.unread_only !== undefined) searchParams.append("unread_only", params.unread_only.toString());

			const queryString = searchParams.toString();
			const response = await api.get(`/announcements/my${queryString ? `?${queryString}` : ""}`);
			return response.data as PaginatedResp<MyAnnouncement> & { unread_count: number };
		},
	});
}

export function useUnreadAnnouncementCount() {
	return useQuery({
		queryKey: ["announcements", "unread-count"],
		queryFn: async () => {
			const response = await api.get("/announcements/unread-count");
			return response.data as UnreadCountResp;
		},
		refetchInterval: 30000, // 每30秒刷新一次
	});
}

export function useMyHistory(params?: {
	page?: number;
	page_size?: number;
	category?: string;
	priority?: string;
}) {
	return useQuery({
		queryKey: ["announcements", "my", "history", params],
		queryFn: async () => {
			const searchParams = new URLSearchParams();
			if (params?.page) searchParams.append("page", params.page.toString());
			if (params?.page_size) searchParams.append("page_size", params.page_size.toString());
			if (params?.category) searchParams.append("category", params.category);
			if (params?.priority) searchParams.append("priority", params.priority);

			const queryString = searchParams.toString();
			const response = await api.get(`/announcements/my/history${queryString ? `?${queryString}` : ""}`);
			return response.data as MyHistoryResp;
		},
	});
}
