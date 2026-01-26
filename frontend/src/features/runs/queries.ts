import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildQuery, getErrorMessage } from "@/lib/api";
import type { Run, RunDetailResp, RunListResp, RunTelemetryResp, RunAttachment } from "@/types/api";
import { runKeys } from "./keys";

export function useRuns(args?: { q?: string; page?: number; page_size?: number }) {
	const q = args?.q || "";
	return useQuery<RunListResp>({
		queryKey: runKeys.list(`${q}|${args?.page || 0}|${args?.page_size || 0}`),
		queryFn: async () => {
			const qs = buildQuery({ q: q || null, page: args?.page, page_size: args?.page_size });
			const res = await api.get<RunListResp>(`/runs${qs}`);
			return res.data as any;
		},
	});
}

export function useRunDetail(runId: number) {
	return useQuery<Run>({
		queryKey: runKeys.detail(runId),
		queryFn: async () => {
			const res = await api.get<RunDetailResp>(`/runs/${runId}`);
			return res.data as any;
		},
		enabled: Number.isFinite(runId),
	});
}

export function useRunTelemetry(args: {
	runId: number;
	from?: string | null;
	to?: string | null;
	channels?: string[] | null;
	bucket?: string | null;
	group?: string | null;
	treatment?: string | null;
	limit?: number;
}) {
	const { runId, from, to, channels, bucket, group, treatment, limit } = args;
	// 确保依赖数组长度稳定，使用固定顺序和空字符串代替 null/undefined
	const argsKey = [
		from || "",
		to || "",
		channels?.join(",") || "",
		bucket || "",
		group || "",
		treatment || "",
		limit ?? ""
	].join("|");

	return useQuery<RunTelemetryResp>({
		queryKey: runKeys.telemetry(runId, argsKey),
		queryFn: async () => {
			const qs = buildQuery({
				from,
				to,
				channels: channels && channels.length > 0 ? channels : null,
				bucket,
				group,
				treatment,
				limit,
			});
			const res = await api.get<RunTelemetryResp>(`/runs/${runId}/telemetry${qs}`);
			return res.data;
		},
		enabled: Number.isFinite(runId) && (channels === undefined || channels === null || channels.length > 0),
	});
}

export function useRunAttachments(runId: number, enabled: boolean = true) {
	return useQuery<{ count: number; results: RunAttachment[] }>({
		queryKey: runKeys.attachments(runId),
		queryFn: async () => {
			const res = await api.get(`/runs/${runId}/attachments`);
			return res.data;
		},
		enabled: Number.isFinite(runId) && enabled,
	});
}
