import { useQuery } from "@tanstack/react-query";
import { api, buildQuery } from "@/lib/api";
import type { RunWindow, RunWindowsResp } from "@/types/api";
import { runKeys } from "@/features/runs/keys";

/**
 * Runs Windows
 * - 永远只返回 RunWindow[]
 * - 支持 group / treatment 过滤（与你后端一致）
 */
export function useRunWindows(
	runId: number,
	args?: { group?: string | null; treatment?: string | null }
) {
	const group = args?.group || "";
	const treatment = args?.treatment || "";

	return useQuery<RunWindow[]>({
		queryKey: runKeys.windows(runId, group, treatment),
		queryFn: async () => {
			const qs = buildQuery({
				group: args?.group ?? null,
				treatment: args?.treatment ?? null,
			});

			const res = await api.get<RunWindowsResp>(`/runs/${runId}/windows${qs}`);
			return res.data.data;
		},
		enabled: Number.isFinite(runId),
	});
}
