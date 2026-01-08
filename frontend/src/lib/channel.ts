import type { Channel } from "@/types/api";
import { normalizeMetric, MetricKey } from "@/lib/metrics";

export function channelByMetric(channels: Channel[] | undefined, metric: MetricKey): Channel | null {
	const list = channels || [];
	// 优先 active
	const active = list.filter((c) => c.is_active !== false);
	const hit = (arr: Channel[]) => arr.find((c) => normalizeMetric(c.metric) === metric) || null;
	return hit(active) || hit(list);
}

export function codesByMetrics(channels: Channel[] | undefined, metrics: MetricKey[]) {
	const out: string[] = [];
	for (const m of metrics) {
		const ch = channelByMetric(channels, m);
		if (ch?.code) out.push(ch.code);
	}
	return out;
}
