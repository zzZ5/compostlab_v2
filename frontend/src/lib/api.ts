import axios, { AxiosError, AxiosInstance } from "axios";
import type { APIError } from "@/types/api";
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "@/lib/auth";

/**
 * 统一读取 API_BASE
 * - NEXT_PUBLIC_API_BASE 建议类似：http://127.0.0.1:8000/api/v2
 */
function getApiBase(): string {
	/**
	 * ✅ 默认同域反代：/api/v2
	 * - 你的后端 urls.py 已把 v2 API 挂载到 /api/v2/...
	 * - 因此在绝大多数部署（Nginx/Next 同域反代）下无需额外配置
	 * - 如果你需要指向其它域（例如本地独立后端），再配置 NEXT_PUBLIC_API_BASE
	 */
	const base = (process.env.NEXT_PUBLIC_API_BASE || "").trim() || "/api/v2";
	return base.replace(/\/+$/, ""); // 去掉末尾 /
}

/**
 * Auth header（JWT Token 优先，兼容 Basic Auth）
 */
function authHeader(): string | null {
	if (typeof window === "undefined") return null;
	
	// 优先使用 JWT Token
	const token = getAccessToken();
	if (token) return `Bearer ${token}`;
	
	// 向后兼容 Basic Auth
	const basicToken = localStorage.getItem("basic_auth");
	if (basicToken) return `Basic ${basicToken}`;
	
	return null;
}

/**
 * query 序列化：过滤 undefined/null/""，数组按重复 key 形式
 * 例如：{ channels:["TEMP","O2"], from:"..." } -> channels=TEMP&channels=O2&from=...
 */
export function buildQuery(params: Record<string, any>): string {
	const usp = new URLSearchParams();

	Object.entries(params || {}).forEach(([k, v]) => {
		if (v === undefined || v === null) return;
		if (typeof v === "string" && v.trim() === "") return;

		if (Array.isArray(v)) {
			// 后端对 channels 参数使用逗号分隔（request.GET.get("channels")），
			// 若使用重复的 channels=... 会只取到第一个值，导致多通道无法生效。
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

/**
 * 统一提取后端错误信息（detail / message / fallback）
 */
export function getErrorMessage(err: unknown, fallback = "Request failed"): string {
	if (!err) return fallback;

	// Axios error
	const ax = err as AxiosError<APIError>;
	const status = ax?.response?.status;
	const data: any = ax?.response?.data;

	if (data) {
		if (typeof data === "string") return data;
		if (typeof data?.detail === "string") return data.detail;
		if (typeof data?.message === "string") return data.message;
	}

	if (typeof ax?.message === "string" && ax.message) {
		return status ? `${fallback} (HTTP ${status}): ${ax.message}` : ax.message;
	}

	return fallback;
}

/**
 * 下载工具：用于 export CSV 等（会自动带 Authorization）
 */
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

/* =========================
 * axios instance
 * ========================= */

export const api = axios.create({
	baseURL: getApiBase(),
	timeout: 20000,
	headers: {
		"Content-Type": "application/json",
	},
});

// request: inject Authorization
api.interceptors.request.use((config) => {
	config.headers = config.headers ?? {};
	const h = authHeader();
	if (h) config.headers["Authorization"] = h;
	return config;
});

// response: handle 401 redirect and token refresh
api.interceptors.response.use(
	(res) => res,
	async (err) => {
		const status = err?.response?.status;
		const originalRequest = err.config;

		// Token 过期，尝试刷新
		if (status === 401 && !originalRequest._retry && typeof window !== "undefined") {
			const refreshToken = getRefreshToken();
			
			if (refreshToken) {
				originalRequest._retry = true;
				
				try {
					const res = await axios.post(`${getApiBase()}/auth/refresh`, {
						refresh: refreshToken,
					});
					
					const newAccessToken = res.data.access;
					setTokens(newAccessToken, refreshToken);
					
					// 重试原请求
					originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
					return api(originalRequest);
				} catch (refreshError) {
					// Refresh 失败，清除 token 并跳转登录
					clearTokens();
					if (!window.location.pathname.startsWith("/login")) {
						const next = encodeURIComponent(window.location.pathname + window.location.search);
						window.location.href = `/login?next=${next}`;
					}
					return Promise.reject(refreshError);
				}
			}
			
			// 没有 refresh token，直接跳转登录
			if (!window.location.pathname.startsWith("/login")) {
				const next = encodeURIComponent(window.location.pathname + window.location.search);
				window.location.href = `/login?next=${next}`;
			}
		}

		return Promise.reject(err);
	}
);
