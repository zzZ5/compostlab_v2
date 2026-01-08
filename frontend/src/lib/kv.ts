export type KVType = "string" | "number" | "boolean" | "json" | "null";

export type KVRow = {
	/** unique id for react rendering */
	id: string;
	key: string;
	type: KVType;
	/**
	 * For:
	 * - string/number/boolean: store value directly
	 * - json: store a JSON string (editable)
	 * - null: unused
	 */
	value?: any;
};

function uid() {
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function objectToKVPairs(obj: any): KVRow[] {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];

	return Object.entries(obj).map(([k, v]) => {
		let type: KVType = "string";
		let value: any = "";

		if (v === null || v === undefined) {
			type = "null";
			value = null;
		} else if (typeof v === "boolean") {
			type = "boolean";
			value = v;
		} else if (typeof v === "number") {
			type = "number";
			value = v;
		} else if (typeof v === "string") {
			type = "string";
			value = v;
		} else {
			type = "json";
			try {
				value = JSON.stringify(v, null, 2);
			} catch {
				value = String(v);
			}
		}

		return { id: uid(), key: k, type, value };
	});
}

export function kvPairsToObject(rows: KVRow[] | undefined | null): {
	obj: any | undefined;
	warnings: string[];
} {
	const warnings: string[] = [];
	if (!rows || !Array.isArray(rows) || rows.length === 0) return { obj: undefined, warnings };

	const out: any = {};
	for (const r of rows) {
		const k = String(r?.key || "").trim();
		if (!k) continue;

		const t = (r?.type || "string") as KVType;
		const v = r?.value;

		if (t === "null") {
			out[k] = null;
			continue;
		}
		if (t === "boolean") {
			out[k] = !!v;
			continue;
		}
		if (t === "number") {
			const n = typeof v === "number" ? v : Number(v);
			out[k] = Number.isFinite(n) ? n : 0;
			continue;
		}
		if (t === "json") {
			if (typeof v !== "string") {
				out[k] = v;
				continue;
			}
			const s = v.trim();
			if (!s) {
				out[k] = null;
				continue;
			}
			try {
				out[k] = JSON.parse(s);
			} catch {
				// 容错：JSON 解析失败时按字符串发送，同时给出提示
				out[k] = v;
				warnings.push(`Key '${k}' JSON 解析失败，已按字符串发送`);
			}
			continue;
		}

		// default string
		out[k] = v === undefined ? "" : String(v);
	}

	if (Object.keys(out).length === 0) return { obj: undefined, warnings };
	return { obj: out, warnings };
}

export function emptyObjectToUndefined(obj: any): any | undefined {
	if (!obj || typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj;
	return Object.keys(obj).length ? obj : undefined;
}
