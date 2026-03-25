import type { Channel } from "@/types/api";
import {
	MetricKey,
	metricLabel,
	normalizeMetric,
	isIgnoredMetricRaw,
	detectChannelMetric,
} from "@/lib/metrics";

export type ChannelGroup = {
	key: string;
	label: string;
	norm?: MetricKey;
	channels: Channel[];
};

const KNOWN_ORDER: MetricKey[] = [
	"temperature",
	"o2",
	"co2",
	"ch4",
	"co",
	"h2s",
	"nh3",
	"moisture",
	"humidity",
	"ph",
	"flow",
	"switch",
	"unknown",
];

export function sortChannels(channels: Channel[]): Channel[] {
	return [...channels].sort((a, b) => {
		const displayNameA = (a.display_name || "").trim();
		const displayNameB = (b.display_name || "").trim();
		if (displayNameA && displayNameB) {
			const cmp = displayNameA.localeCompare(displayNameB, "zh-CN");
			if (cmp !== 0) return cmp;
		}
		if (displayNameA && !displayNameB) return -1;
		if (!displayNameA && displayNameB) return 1;

		const nameA = (a.name || "").trim();
		const nameB = (b.name || "").trim();
		if (nameA && nameB) {
			const cmp = nameA.localeCompare(nameB, "zh-CN");
			if (cmp !== 0) return cmp;
		}
		if (nameA && !nameB) return -1;
		if (!nameA && nameB) return 1;

		const codeA = (a.code || "").trim();
		const codeB = (b.code || "").trim();
		return codeA.localeCompare(codeB, "zh-CN");
	});
}

export function isKnownMetricKey(k: string): k is MetricKey {
	return (KNOWN_ORDER as string[]).includes(k);
}

export function getChannelGroupKey(ch: Channel): string {
	const norm = detectChannelMetric(ch);
	if (norm !== "unknown") return norm;
	const raw = String(ch.metric || "").trim().toLowerCase();
	if (!raw || isIgnoredMetricRaw(raw)) return "unknown";
	return `metric:${raw}`;
}

export function getChannelGroupLabel(key: string, sample?: Channel): string {
	if (isKnownMetricKey(key)) return metricLabel(key);
	if (key.startsWith("metric:")) {
		const raw = key.slice("metric:".length);
		const normalized = normalizeMetric(raw);
		if (normalized !== "unknown") {
			return metricLabel(normalized);
		}
		return raw ? raw.toUpperCase() : "未分类";
	}
	if (sample) {
		const normalized = detectChannelMetric(sample);
		if (normalized !== "unknown") {
			return metricLabel(normalized);
		}
		if (sample.metric) return String(sample.metric);
	}
	return "未分类";
}

export function groupChannelsByMetric(channels: Channel[]): ChannelGroup[] {
	const list = channels || [];
	const sortedList = sortChannels(list);

	const groupsByKey = new Map<string, Channel[]>();
	for (const ch of sortedList) {
		const key = getChannelGroupKey(ch);
		if (!groupsByKey.has(key)) groupsByKey.set(key, []);
		groupsByKey.get(key)!.push(ch);
	}

	const groups: ChannelGroup[] = Array.from(groupsByKey.entries()).map(([key, chs]) => {
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
	const groups = groupChannelsByMetric(channels);

	const out: Channel[] = [];
	const add = (arr: Channel[]) => {
		for (const ch of arr) {
			if (out.some((x) => x.code === ch.code)) continue;
			out.push(ch);
		}
	};

	const temp = groups.find((g) => g.key === "temperature");
	if (temp) add(temp.channels.slice(0, Math.max(1, Math.min(3, maxRows))));

	for (const k of ["o2", "co2", "moisture"] as const) {
		const g = groups.find((x) => x.key === k);
		if (g && g.channels.length) add(g.channels.slice(0, 1));
	}

	const rest = channels
		.filter((c) => !out.some((x) => x.code === c.code))
		.sort((a, b) => {
			const ah = a.latest ? 0 : 1;
			const bh = b.latest ? 0 : 1;
			if (ah !== bh) return ah - bh;
			return sortChannels([a, b])[0] === a ? -1 : 1;
		});
	add(rest);

	return out;
}
