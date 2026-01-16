import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Run } from "@/types/api";
import { runKeys } from "./keys";

export function useCreateRun() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (body: {
			name: string;
			start_at?: string | null;
			end_at?: string | null;
			note?: string;
			recipe?: any;
			settings?: any;
		}) => {
			const res = await api.post("/runs", body);
			return res.data;
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.all }),
	});
}

export type UpdateRunBody = Partial<{
	name: string;
	note: string;
	recipe: any;
	settings: any;
	start_at: string;
	end_at: string | null;
}>;

export function useUpdateRun(runId: number) {
	const qc = useQueryClient();
	return useMutation<Run, any, UpdateRunBody>({
		mutationFn: async (body) => {
			const res = await api.patch<Run>(`/runs/${runId}`, body);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: runKeys.all });
			qc.invalidateQueries({ queryKey: runKeys.detail(runId) });
			qc.invalidateQueries({ queryKey: runKeys.windowsBase(runId) });
		},
	});
}

export function useDeleteRun() {
	const qc = useQueryClient();
	return useMutation<{ detail: string; run_id: number }, any, { run_id: number }>({
		mutationFn: async ({ run_id }) => {
			const res = await api.delete(`/runs/${run_id}`);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: runKeys.all });
		},
	});
}

export function useUploadRunAttachment(runId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (data: { file: File; category: string; description: string }) => {
			const formData = new FormData();
			formData.append('file', data.file);
			formData.append('category', data.category);
			formData.append('description', data.description);

			const res = await api.post(`/runs/${runId}/attachments`, formData, {
				headers: {
					'Content-Type': 'multipart/form-data',
				},
			});
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: runKeys.attachments(runId) });
		},
	});
}

export function useUpdateRunAttachment(runId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (data: { attachmentId: number; category?: string; description?: string }) => {
			const res = await api.patch(`/runs/${runId}/attachments/${data.attachmentId}`, {
				category: data.category,
				description: data.description,
			});
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: runKeys.attachments(runId) });
		},
	});
}

export function useDeleteRunAttachment(runId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (attachmentId: number) => {
			await api.delete(`/runs/${runId}/attachments/${attachmentId}`);
			return attachmentId;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: runKeys.attachments(runId) });
		},
	});
}
