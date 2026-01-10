export function setBasicAuth(user: string, pass: string) {
	const token = btoa(`${user}:${pass}`);
	// ✅ 使用 localStorage 替代 sessionStorage，避免关闭浏览器后需要重新登录
	localStorage.setItem("basic_auth", token);
}

export function clearBasicAuth() {
	localStorage.removeItem("basic_auth");
}

export function hasBasicAuth(): boolean {
	return !!localStorage.getItem("basic_auth");
}
