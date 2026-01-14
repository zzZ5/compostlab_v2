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
// 安全改进：使用 sessionStorage（关闭页面即失效）并只存储非敏感信息

/**
 * 设置用户基本信息（仅用于显示）
 * 只存储非敏感信息，避免 XSS 窃取敏感字段
 */
export function setUser(user: any) {
	if (typeof window === "undefined") return;
	// 只存储非敏感信息，避免 XSS 窃取敏感字段
	const safeUser = {
		id: user.id,
		username: user.username,
		real_name: user.real_name,
		role_display: user.role_display,
		// 不存储 role、is_staff、is_superuser 等敏感字段
		// 这些字段应该通过 API 动态获取
	};
	sessionStorage.setItem("user", JSON.stringify(safeUser));
}

/**
 * 获取用户基本信息（仅用于显示）
 * 注意：此函数返回的用户信息不包含敏感权限字段
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

/**
 * 获取完整的用户信息（包含权限字段）
 * 通过 API 动态获取，避免在本地存储敏感信息
 */
export async function fetchFullUserInfo(): Promise<any> {
	const token = getAccessToken();
	if (!token) return null;

	try {
		const response = await fetch("/api/v2/auth/me", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			return null;
		}

		const user = await response.json();
		return user;
	} catch {
		return null;
	}
}

/**
 * 检查用户是否有特定角色
 * 通过 API 获取最新用户信息进行比较
 */
export async function hasRequiredRole(requiredRole: string): Promise<boolean> {
	const userInfo = await fetchFullUserInfo();
	if (!userInfo) return false;

	const roleLevels: Record<string, number> = {
		readonly: 1,
		operator: 2,
		admin: 3,
	};

	const userLevel = roleLevels[userInfo.role] || 0;
	const requiredLevel = roleLevels[requiredRole] || 999;

	return userLevel >= requiredLevel;
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
