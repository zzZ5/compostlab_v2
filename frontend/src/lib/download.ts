import { api } from "@/lib/api";

function inferFilename(contentDisposition?: string | null, fallback = "export.csv") {
	if (!contentDisposition) return fallback;
	// Content-Disposition: attachment; filename="xxx.csv"
	const m = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(contentDisposition);
	if (!m?.[1]) return fallback;
	try {
		return decodeURIComponent(m[1].replace(/"/g, ""));
	} catch {
		return m[1].replace(/"/g, "");
	}
}

export async function downloadCsv(url: string, fallbackFilename: string) {
	const res = await api.get(url, { responseType: "blob" });

	const cd = (res.headers?.["content-disposition"] || res.headers?.["Content-Disposition"]) as
		| string
		| undefined;

	const filename = inferFilename(cd, fallbackFilename);

	const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
	const blobUrl = window.URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = blobUrl;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();

	window.URL.revokeObjectURL(blobUrl);
}
