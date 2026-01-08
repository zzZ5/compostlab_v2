import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { runKeys } from "@/features/runs/keys";

export function useCreateRunWindow(runId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (body: {
			device_id: number;
			group?: string;
			treatment?: string;
			follow_run?: boolean;
			note?: string;
			settings?: any;
			meta?: any;
			start_at?: string | null;
			end_at?: string | null;
		}) => {
			const res = await api.post(`/runs/${runId}/windows`, body);
			return res.data;
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.windowsBase(runId) }),
	});
}

export function useUpdateRunWindow(runId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { windowId: number; body: any }) => {
			const res = await api.patch(`/runs/${runId}/windows/${args.windowId}`, args.body);
			return res.data;
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.windowsBase(runId) }),
	});
}

export function useDeleteRunWindow(runId: number) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (windowId: number) => {
			const res = await api.delete(`/runs/${runId}/windows/${windowId}`);
			return res.data;
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.windowsBase(runId) }),
	});
}
