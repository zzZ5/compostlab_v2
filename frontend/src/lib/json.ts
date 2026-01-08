export function safeJsonStringify(value: any, space = 2): string {
	try {
		if (value === undefined || value === null) return "";
		return JSON.stringify(value, null, space);
	} catch {
		return "";
	}
}

/**
 * 将用户输入的 JSON 字符串转为对象：
 * - 空字符串 / undefined / null -> undefined（表示不传该字段）
 * - 非法 JSON -> throw Error（用于表单提示）
 */
export function parseJsonInput(text: unknown): any | undefined {
	if (text === undefined || text === null) return undefined;
	if (typeof text !== "string") return text;
	const s = text.trim();
	if (!s) return undefined;
	try {
		return JSON.parse(s);
	} catch (e: any) {
		throw new Error("JSON 格式错误：" + (e?.message || "无法解析"));
	}
}
