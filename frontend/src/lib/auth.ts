export function setBasicAuth(user: string, pass: string) {
	const token = btoa(`${user}:${pass}`);
	sessionStorage.setItem("basic_auth", token);
}

export function clearBasicAuth() {
	sessionStorage.removeItem("basic_auth");
}

export function hasBasicAuth(): boolean {
	return !!sessionStorage.getItem("basic_auth");
}
