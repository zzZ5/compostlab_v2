"use client";

import React from "react";
import { Input, Typography } from "antd";

const { Text } = Typography;

export default function JsonTextArea(props: {
	placeholder?: string;
	rows?: number;
}) {
	return (
		<div>
			<Input.TextArea
				autoSize={{ minRows: props.rows ?? 4, maxRows: 12 }}
				placeholder={props.placeholder || "可选：输入 JSON（例如 {\n  \"k\": \"v\"\n} ）"}
				spellCheck={false}
			/>
			<Text type="secondary" style={{ fontSize: 12 }}>
				留空表示不修改/不传该字段。
			</Text>
		</div>
	);
}
