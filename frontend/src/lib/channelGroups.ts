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

/**
 * channel 排序：display_name > name > code
 * 支持中文排序（使用 localeCompare 和 zh-CN）
 */
export function sortChannels(channels: Channel[]): Channel[] {
	return [...channels].sort((a, b) => {
		// 先按 display_name 排序（支持中文）
		const displayNameA = (a.display_name || "").trim();
		const displayNameB = (b.display_name || "").trim();
		if (displayNameA && displayNameB) {
			const cmp = displayNameA.localeCompare(displayNameB, "zh-CN");
			if (cmp !== 0) return cmp;
		}
		if (displayNameA && !displayNameB) return -1;
		if (!displayNameA && displayNameB) return 1;

		// 再按 name 排序（支持中文）
		const nameA = (a.name || "").trim();
		const nameB = (b.name || "").trim();
		if (nameA && nameB) {
			const cmp = nameA.localeCompare(nameB, "zh-CN");
			if (cmp !== 0) return cmp;
		}
		if (nameA && !nameB) return -1;
		if (!nameA && nameB) return 1;

		// 最后按 code 排序
		const codeA = (a.code || "").trim();
		const codeB = (b.code || "").trim();
		return codeA.localeCompare(codeB, "zh-CN");
	});
}

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
		// 尝试将 raw 转换为标准 metric 并返回中文标签
		const normalized = normalizeMetric(raw);
		if (normalized !== "unknown") {
			return metricLabel(normalized);
		}
		return raw ? raw.toUpperCase() : "未分类";
	}
	// fallback: 尝试转换 sample 的 metric
	if (sample?.metric) {
		const normalized = normalizeMetric(sample.metric);
		if (normalized !== "unknown") {
			return metricLabel(normalized);
		}
		return String(sample.metric);
	}
	return "未分类";
}

export function groupChannelsByMetric(channels: Channel[]): ChannelGroup[] {
	const list = channels || [];
	const sortedList = sortChannels(list);

	const m = new Map<string, Channel[]>();
	for (const ch of sortedList) {
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
		return a.label.localeCompare(b.label, "zh-CN");
	});

	return groups;
}

export function pickFeaturedChannels(channels: Channel[], maxRows = 5): Channel[] {
	// ✅ 展示全部 channels，不再限制数量
	const groups = groupChannelsByMetric(channels);

	const out: Channel[] = [];
	const add = (arr: Channel[]) => {
		for (const ch of arr) {
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
	const rest = channels
		.filter((c) => !out.some((x) => x.code === c.code))
		.sort((a, b) => {
			const ah = a.latest ? 0 : 1;
			const bh = b.latest ? 0 : 1;
			if (ah !== bh) return ah - bh;
			// 使用统一排序（display_name > name > code，支持中文）
			return sortChannels([a, b])[0] === a ? -1 : 1;
		});
	add(rest);

	return out;
}
