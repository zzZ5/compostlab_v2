import type { AxiosError } from "axios";

export function getErrorMessage(err: unknown, fallback = "操作失败"): string {
	const e = err as any;
	// axios: err.response.data.detail
	const detail = e?.response?.data?.detail;
	if (typeof detail === "string" && detail.trim()) return detail;
	const msg = e?.message;
	if (typeof msg === "string" && msg.trim()) return msg;
	return fallback;
}

export function getHttpStatus(err: unknown): number | undefined {
	const e = err as any;
	return e?.response?.status;
}
