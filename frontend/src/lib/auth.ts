// Token 管理（JWT）
export function setTokens(access: string, refresh: string) {
	if (typeof window === "undefined") return;
	// Token 使用 localStorage 存储（因为需要持久化）
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
	sessionStorage.removeItem("user");
}

export function hasToken(): boolean {
	return !!getAccessToken();
}

// 用户信息管理
// 安全改进：使用 sessionStorage（关闭页面即失效）

/**
 * 设置用户基本信息
 * 使用 sessionStorage 存储可以显示的字段（关闭页面即失效）
 */
export function setUser(user: any) {
	if (typeof window === "undefined") return;
	const safeUser = {
		id: user.id,
		username: user.username,
		real_name: user.real_name,
		role: user.role,
		role_display: user.role_display,
	};
	sessionStorage.setItem("user", JSON.stringify(safeUser));
}

/**
 * 获取用户基本信息（用于显示和权限判断）
 */
export function getUser(): any | null {
	if (typeof window === "undefined") return null;
	const str = sessionStorage.getItem("user");
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
