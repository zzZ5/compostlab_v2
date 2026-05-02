import axios, { AxiosError, AxiosInstance } from "axios";
import type { APIError } from "@/types/api";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "@/lib/auth";

function getApiBase(): string {
	const base = (process.env.NEXT_PUBLIC_API_BASE || "").trim() || "/api/v2";
	return base.replace(/\/+$/, "");
}

function authHeader(): string | null {
	if (typeof window === "undefined") return null;

	const token = getAccessToken();
	if (token) return `Bearer ${token}`;

	const basicToken = localStorage.getItem("basic_auth");
	if (basicToken) return `Basic ${basicToken}`;

	return null;
}

export function buildQuery(params: Record<string, unknown>): string {
	const usp = new URLSearchParams();

	Object.entries(params || {}).forEach(([k, v]) => {
		if (v === undefined || v === null) return;
		if (typeof v === "string" && v.trim() === "") return;

		if (Array.isArray(v)) {
			// The backend expects a comma-separated channels parameter.
			if (k === "channels") {
				const s = v.filter((x) => x !== undefined && x !== null && String(x).trim() !== "").join(",");
				if (s) usp.set(k, s);
				return;
			}

			v.forEach((x) => {
				if (x === undefined || x === null) return;
				usp.append(k, String(x));
			});
			return;
		}
		usp.set(k, String(v));
	});

	const qs = usp.toString();
	return qs ? `?${qs}` : "";
}

export function getErrorMessage(err: unknown, fallback = "Request failed"): string {
	if (!err) return fallback;

	const ax = err as AxiosError<APIError>;
	const status = ax?.response?.status;
	const data = ax?.response?.data as unknown;

	if (data) {
		if (typeof data === "string") return data;
		if (typeof data === "object") {
			const body = data as Record<string, unknown>;
			if (typeof body.detail === "string") return body.detail;
			if (typeof body.message === "string") return body.message;
		}
	}

	if (typeof ax?.message === "string" && ax.message) {
		return status ? `${fallback} (HTTP ${status}): ${ax.message}` : ax.message;
	}

	return fallback;
}

export async function downloadBlob(
	apiClient: AxiosInstance,
	url: string,
	filename: string,
	mime = "application/octet-stream"
) {
	const res = await apiClient.get(url, { responseType: "blob" });

	const blob = new Blob([res.data], { type: mime });
	const blobUrl = window.URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = blobUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();

	window.URL.revokeObjectURL(blobUrl);
}

export const api = axios.create({
	baseURL: getApiBase(),
	timeout: 20000,
	headers: {
		"Content-Type": "application/json",
	},
});

let refreshPromise: Promise<string | null> | null = null;

api.interceptors.request.use(async (config) => {
	config.headers = config.headers ?? {};
	const h = authHeader();
	if (h) config.headers["Authorization"] = h;
	if (!h && refreshPromise) {
		const token = await refreshPromise;
		if (token) config.headers["Authorization"] = `Bearer ${token}`;
	}
	return config;
});

api.interceptors.response.use(
	(res) => res,
	async (err) => {
		const status = err?.response?.status;
		const originalRequest = err.config;

		if (status === 401 && !originalRequest._retry && typeof window !== "undefined") {
			const refreshToken = getRefreshToken();

			if (refreshToken) {
				originalRequest._retry = true;

				try {
					if (!refreshPromise) {
						refreshPromise = axios
							.post(`${getApiBase()}/auth/refresh`, { refresh: refreshToken })
							.then((res) => {
								const newAccessToken = res.data.access;
								if (newAccessToken) {
									setTokens(newAccessToken, refreshToken);
									api.defaults.headers.common["Authorization"] = `Bearer ${newAccessToken}`;
									return newAccessToken;
								}
								return null;
							})
							.finally(() => {
								refreshPromise = null;
							});
					}

					const newAccessToken = await refreshPromise;
					if (newAccessToken) {
						originalRequest.headers = originalRequest.headers ?? {};
						originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
						return api(originalRequest);
					}
				} catch (refreshError) {
					clearTokens();
					if (!window.location.pathname.startsWith("/login")) {
						const next = encodeURIComponent(window.location.pathname + window.location.search);
						window.location.href = `/login?next=${next}`;
					}
					return Promise.reject(refreshError);
				}
			}

			if (!window.location.pathname.startsWith("/login")) {
				const next = encodeURIComponent(window.location.pathname + window.location.search);
				window.location.href = `/login?next=${next}`;
			}
		}

		return Promise.reject(err);
	}
);
