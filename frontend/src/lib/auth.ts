// Token 管理（JWT）
export function setTokens(access: string, refresh: string) {
	if (typeof window === "undefined") return;
	localStorage.setItem("access_token", access);
	localStorage.setItem("refresh_token", refresh);
}

export function getAccessToken(): string | null {
	if (typeof window === "undefined") return null;
	return localStorage.getItem("access_token");
}

export function getRefreshToken(): string | null {
	if (typeof window === "undefined") return null;
	return localStorage.getItem("refresh_token");
}

export function clearTokens() {
	if (typeof window === "undefined") return;
	localStorage.removeItem("access_token");
	localStorage.removeItem("refresh_token");
	localStorage.removeItem("user");
}

export function hasToken(): boolean {
	return !!getAccessToken();
}

// 用户信息管理
export function setUser(user: any) {
	if (typeof window === "undefined") return;
	localStorage.setItem("user", JSON.stringify(user));
}

export function getUser(): any | null {
	if (typeof window === "undefined") return null;
	const str = localStorage.getItem("user");
	if (!str) return null;
	try {
		return JSON.parse(str);
	} catch {
		return null;
	}
}

// 兼容旧的 Basic Auth（暂时保留）
export function setBasicAuth(user: string, pass: string) {
	const token = btoa(`${user}:${pass}`);
	localStorage.setItem("basic_auth", token);
}

export function clearBasicAuth() {
	localStorage.removeItem("basic_auth");
}

export function hasBasicAuth(): boolean {
	return !!localStorage.getItem("basic_auth");
}
