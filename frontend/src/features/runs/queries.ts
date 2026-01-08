import { useQuery } from "@tanstack/react-query";
import { api, buildQuery } from "@/lib/api";
import type { Run, RunDetailResp, RunListResp, RunTelemetryResp } from "@/types/api";
import { runKeys } from "./keys";

export function useRuns(args?: { q?: string }) {
	const q = args?.q || "";
	return useQuery<Run[]>({
		queryKey: runKeys.list(q),
		queryFn: async () => {
			const qs = buildQuery({ q: q || null });
			const res = await api.get<RunListResp>(`/runs${qs}`);
			return res.data.data;
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
}) {
	const { runId, from, to, channels, bucket, group, treatment } = args;
	const argsKey = [from, to, channels?.join(",") || "", bucket || "", group || "", treatment || ""].join("|");

	return useQuery<RunTelemetryResp>({
		queryKey: runKeys.telemetry(runId, argsKey),
		queryFn: async () => {
			const qs = buildQuery({
				from,
				to,
				channels: channels && channels.length ? channels : null,
				bucket,
				group,
				treatment,
			});
			const res = await api.get<RunTelemetryResp>(`/runs/${runId}/telemetry${qs}`);
			return res.data;
		},
		enabled: Number.isFinite(runId),
	});
}
