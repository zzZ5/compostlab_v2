"use client";

import { useEffect } from "react";
import { Form, Input, Modal, Switch } from "antd";

import KeyValueEditor from "@/components/KeyValueEditor";

export type DeviceFormValues = {
	code: string;
	name: string;
	post_topic?: string | null;
	response_topic?: string | null;
	note?: string;
	is_active: boolean;
	meta?: Record<string, any>;
};

type Props = {
	open: boolean;
	title: string;
	okText?: string;
	initialValues?: Partial<DeviceFormValues>;
	confirmLoading?: boolean;
	onCancel: () => void;
	onSubmit: (values: DeviceFormValues) => Promise<void> | void;
};

export default function DeviceFormModal(props: Props) {
	const { open, title, okText, initialValues, confirmLoading, onCancel, onSubmit } = props;
	const [form] = Form.useForm<DeviceFormValues>();

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		form.setFieldsValue({
			code: "",
			name: "",
			post_topic: "",
			response_topic: "",
			note: "",
			is_active: true,
			meta: {},
			...(initialValues || {}),
		});
	}, [open, initialValues, form]);

	async function handleOk() {
		const v = await form.validateFields();
		const values: any = {
			...v,
			code: String(v.code || "").trim(),
			name: String(v.name || "").trim(),
			note: String(v.note || ""),
			is_active: !!v.is_active,
			meta: v.meta || {},
		};
		// topic 为空则不发送，后端会使用默认格式
		if (v.post_topic && v.post_topic.trim()) {
			values.post_topic = v.post_topic.trim();
		}
		if (v.response_topic && v.response_topic.trim()) {
			values.response_topic = v.response_topic.trim();
		}
		await onSubmit(values);
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
				<Form.Item
					name="code"
					label="code"
					rules={[{ required: true, message: "请输入设备 code" }]}
				>
					<Input placeholder="例如 KgSERnY2Zn" />
				</Form.Item>

				<Form.Item
					name="name"
					label="name"
					rules={[{ required: true, message: "请输入设备名称" }]}
				>
					<Input placeholder="例如 CP500 #1" />
				</Form.Item>

				<Form.Item name="post_topic" label="post_topic">
					<Input placeholder="可留空" />
				</Form.Item>

				<Form.Item name="response_topic" label="response_topic">
					<Input placeholder="可留空" />
				</Form.Item>

				<Form.Item name="note" label="note">
					<Input.TextArea rows={3} placeholder="可选" />
				</Form.Item>

				<Form.Item name="is_active" label="is_active" valuePropName="checked">
					<Switch />
				</Form.Item>

				<Form.Item name="meta" label="meta (Key-Value)" trigger="onChange">
					<KeyValueEditor />
				</Form.Item>
			</Form>
		</Modal>
	);
}
