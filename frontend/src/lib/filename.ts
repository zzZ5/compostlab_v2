export function safeName(s: string) {
	return (s || "")
		.trim()
		.replace(/[\/\\:*?"<>|]+/g, "_")
		.replace(/\s+/g, "_")
		.slice(0, 80);
}

export function formatRange(from: string, to: string) {
	// from/to: "YYYY-MM-DD HH:mm:ss"
	const f = from.replace(/[:\s]/g, "").replace("-", "").replace("-", "");
	const t = to.replace(/[:\s]/g, "").replace("-", "").replace("-", "");
	return `${f}_${t}`;
}

export function exportFilename(prefix: string, name: string, from: string, to: string, channels: string[], suffix = "csv") {
	const range = formatRange(from, to);
	const ch = channels.length ? channels.join("-") : "all";
	return `${safeName(prefix)}_${safeName(name)}_${range}_${safeName(ch)}.${suffix}`;
}
