import type { Channel } from "@/types/api";
import { MetricKey, metricLabel, normalizeMetric } from "@/lib/metrics";

export type ChannelGroup = {
	key: string;
	label: string;
	/** known metric key if normalized, otherwise undefined */
	norm?: MetricKey;
	channels: Channel[];
};

const KNOWN_ORDER: MetricKey[] = ["temperature", "o2", "co2", "moisture", "unknown"];

export function isKnownMetricKey(k: string): k is MetricKey {
	return (KNOWN_ORDER as string[]).includes(k);
}

export function getChannelGroupKey(ch: Channel): string {
	const norm = normalizeMetric(ch.metric);
	if (norm !== "unknown") return norm;
	const raw = String(ch.metric || "").trim().toLowerCase();
	return raw ? `metric:${raw}` : "unknown";
}

export function getChannelGroupLabel(key: string, sample?: Channel): string {
	if (isKnownMetricKey(key)) return metricLabel(key);
	if (key.startsWith("metric:")) {
		const raw = key.slice("metric:".length);
		return raw ? raw.toUpperCase() : "未分类";
	}
	// fallback
	return (sample?.metric ? String(sample.metric) : "未分类") || "未分类";
}

export function groupChannelsByMetric(channels: Channel[]): ChannelGroup[] {
	const list = channels || [];
	const activeFirst = [...list].sort((a, b) => {
		const aa = a.is_active === false ? 1 : 0;
		const bb = b.is_active === false ? 1 : 0;
		if (aa !== bb) return aa - bb;
		return String(a.code || "").localeCompare(String(b.code || ""));
	});

	const m = new Map<string, Channel[]>();
	for (const ch of activeFirst) {
		const k = getChannelGroupKey(ch);
		if (!m.has(k)) m.set(k, []);
		m.get(k)!.push(ch);
	}

	const groups: ChannelGroup[] = Array.from(m.entries()).map(([key, chs]) => {
		const norm = isKnownMetricKey(key) ? (key as MetricKey) : undefined;
		return { key, norm, label: getChannelGroupLabel(key, chs[0]), channels: chs };
	});

	groups.sort((a, b) => {
		const ai = a.norm ? KNOWN_ORDER.indexOf(a.norm) : 999;
		const bi = b.norm ? KNOWN_ORDER.indexOf(b.norm) : 999;
		if (ai !== bi) return ai - bi;
		return a.label.localeCompare(b.label);
	});

	return groups;
}

export function pickFeaturedChannels(channels: Channel[], maxRows = 5): Channel[] {
	// 目标：温度可展示多个，其它指标各取 1 个，再补充其他
	const groups = groupChannelsByMetric(channels);

	const out: Channel[] = [];
	const add = (arr: Channel[]) => {
		for (const ch of arr) {
			if (out.length >= maxRows) return;
			if (out.some((x) => x.code === ch.code)) continue;
			out.push(ch);
		}
	};

	// prefer temperature up to 3
	const temp = groups.find((g) => g.key === "temperature");
	if (temp) add(temp.channels.slice(0, 3));

	// then o2/co2/moisture one each
	for (const k of ["o2", "co2", "moisture"] as const) {
		const g = groups.find((x) => x.key === k);
		if (g && g.channels.length) add(g.channels.slice(0, 1));
	}

	// fill remaining with anything that has latest first
	if (out.length < maxRows) {
		const rest = channels
			.filter((c) => !out.some((x) => x.code === c.code))
			.sort((a, b) => {
				const ah = a.latest ? 0 : 1;
				const bh = b.latest ? 0 : 1;
				if (ah !== bh) return ah - bh;
				return String(a.code || "").localeCompare(String(b.code || ""));
			});
		add(rest);
	}

	return out.slice(0, maxRows);
}
