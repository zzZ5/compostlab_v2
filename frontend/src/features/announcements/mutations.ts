import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
	AnnouncementCategory,
	AnnouncementPriority,
	AnnouncementTargetRole,
} from "@/types/api";

// =========================
// Create Announcement
// =========================

export function useCreateAnnouncement() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: {
			title: string;
			content: string;
			category?: AnnouncementCategory;
			priority?: AnnouncementPriority;
			target_role?: AnnouncementTargetRole;
			is_active?: boolean;
			is_pinned?: boolean;
		}) => {
			const response = await api.post("/announcements/create", data);
			return response.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["announcements"] });
		},
	});
}

// =========================
// Update Announcement
// =========================

export function useUpdateAnnouncement(id: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: Partial<{
			title: string;
			content: string;
			category: AnnouncementCategory;
			priority: AnnouncementPriority;
			target_role: AnnouncementTargetRole;
			is_active: boolean;
			is_pinned: boolean;
			expiry_at: string | null;
		}>) => {
			const response = await api.put(`/announcements/${id}/update`, data);
			return response.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["announcements"] });
			queryClient.invalidateQueries({ queryKey: ["announcements", id] });
		},
	});
}

// =========================
// Delete Announcement
// =========================

export function useDeleteAnnouncement() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: number) => {
			const response = await api.delete(`/announcements/${id}/delete`);
			return response.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["announcements"] });
		},
	});
}

// =========================
// Mark as Read
// =========================

export function useMarkAnnouncementAsRead() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: number) => {
			const response = await api.post(`/announcements/${id}/read`);
			return response.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["announcements"] });
			queryClient.invalidateQueries({ queryKey: ["announcements", "my"] });
		},
	});
}
