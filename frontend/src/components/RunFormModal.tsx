"use client";

import { useEffect } from "react";
import dayjs, { Dayjs } from "dayjs";
import { Collapse, DatePicker, Form, Input, Modal } from "antd";

import KeyValueEditor from "@/components/KeyValueEditor";

export type RunFormValues = {
	name: string;
	start_at?: Dayjs | null;
	end_at?: Dayjs | null;
	note?: string;
	recipe?: Record<string, any>;
	settings?: Record<string, any>;
};

type Props = {
	open: boolean;
	title: string;
	okText?: string;
	initialValues?: Partial<RunFormValues>;
	confirmLoading?: boolean;
	onCancel: () => void;
	onSubmit: (values: {
		name: string;
		start_at: string | null;
		end_at: string | null;
		note: string;
		recipe?: Record<string, any>;
		settings?: Record<string, any>;
	}) => Promise<void> | void;
};

export default function RunFormModal(props: Props) {
	const { open, title, okText, initialValues, confirmLoading, onCancel, onSubmit } = props;
	const [form] = Form.useForm<RunFormValues>();

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		form.setFieldsValue({
			name: "",
			start_at: dayjs(),
			end_at: null,
			note: "",
			recipe: {},
			settings: {},
			...(initialValues || {}),
		});
	}, [open, initialValues, form]);

	async function handleOk() {
		const v = await form.validateFields();
		await onSubmit({
			name: String(v.name || "").trim(),
			note: String(v.note || ""),
			start_at: v.start_at ? dayjs(v.start_at).format("YYYY-MM-DD HH:mm:ss") : null,
			end_at: v.end_at ? dayjs(v.end_at).format("YYYY-MM-DD HH:mm:ss") : null,
			recipe: v.recipe || {},
			settings: v.settings || {},
		});
	}

	return (
		<Modal
			open={open}
			title={title}
			okText={okText || "保存"}
			confirmLoading={confirmLoading}
			onCancel={onCancel}
			onOk={handleOk}
			destroyOnHidden
		>
			<Form form={form} layout="vertical">
				<Form.Item name="name" label="name" rules={[{ required: true, message: "请输入 run 名称" }]}>
					<Input placeholder="例如 2026-01 CP500 试验" />
				</Form.Item>
				<Form.Item name="note" label="note">
					<Input.TextArea rows={2} placeholder="可选" />
				</Form.Item>
				<Form.Item name="start_at" label="start_at">
					<DatePicker showTime style={{ width: "100%" }} />
				</Form.Item>
				<Form.Item name="end_at" label="end_at">
					<DatePicker showTime style={{ width: "100%" }} />
				</Form.Item>

				<Collapse
					items={[
						{
							key: "recipe",
							label: "recipe",
							children: (
								<Form.Item name="recipe" noStyle>
									<KeyValueEditor />
								</Form.Item>
							),
						},
						{
							key: "settings",
							label: "settings",
							children: (
								<Form.Item name="settings" noStyle>
									<KeyValueEditor />
								</Form.Item>
							),
						},
					]}
				/>
			</Form>
		</Modal>
	);
}
