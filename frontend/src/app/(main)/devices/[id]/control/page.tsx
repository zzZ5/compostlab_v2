"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, Card, Form, InputNumber, Space, Table, Tag, Typography, message } from "antd";
import { useSendDeviceCommand } from "@/features/devices/mutations";
import { useDeviceCommands } from "@/features/devices/queries";

const { Title, Text } = Typography;

function statusTag(status: string) {
	const color =
		status === "sent" ? "blue" :
			status === "acked" ? "green" :
				status === "failed" ? "red" :
					"default";
	return <Tag color={color}>{status}</Tag>;
}

export default function DeviceControlPage() {
	const params = useParams();
	const router = useRouter();
	const deviceId = Number(params?.id);

	const [form] = Form.useForm();

	const sendMut = useSendDeviceCommand(deviceId);
	const cmdQ = useDeviceCommands(deviceId, 50);

	const send = async (commands: any[]) => {
		try {
			await sendMut.mutateAsync({ commands });
			message.success("命令已下发（已发布到 MQTT）");
		} catch (e: any) {
			message.error(`下发失败：${e?.message || String(e)}`);
		}
	};

	return (
		<div>
			<Space style={{ marginBottom: 12 }}>
				<Title level={3} style={{ margin: 0 }}>Device Control</Title>
				<Text type="secondary">#{deviceId}</Text>
				<Button onClick={() => router.push(`/devices/${deviceId}`)}>返回设备详情</Button>
			</Space>

			<Space orientation="vertical" style={{ width: "100%" }} size={16}>
				{/* 快捷控制 */}
				<Card title="快捷控制">
					<Space wrap>
						<Button
							type="primary"
							loading={sendMut.isPending}
							onClick={() => send([{ command: "pump", action: "on" }])}
						>
							Pump ON
						</Button>
						<Button
							danger
							loading={sendMut.isPending}
							onClick={() => send([{ command: "pump", action: "off" }])}
						>
							Pump OFF
						</Button>
					</Space>
				</Card>

				{/* 配置更新 */}
				<Card title="配置更新（config_update）">
					<Form
						form={form}
						layout="inline"
						initialValues={{
							post_interval_min: 10,
							read_interval_min: 10,
							pump_run_time_s: 60,
						}}
						onFinish={(v) => {
							const post_interval = Math.round((v.post_interval_min ?? 10) * 60 * 1000);
							const read_interval = Math.round((v.read_interval_min ?? 10) * 60 * 1000);
							const pump_run_time = Math.round((v.pump_run_time_s ?? 60) * 1000);

							return send([
								{
									command: "config_update",
									config: { post_interval, read_interval, pump_run_time },
								},
							]);
						}}
					>
						<Form.Item label="post_interval (min)" name="post_interval_min">
							<InputNumber min={1} max={1440} />
						</Form.Item>
						<Form.Item label="read_interval (min)" name="read_interval_min">
							<InputNumber min={1} max={1440} />
						</Form.Item>
						<Form.Item label="pump_run_time (s)" name="pump_run_time_s">
							<InputNumber min={1} max={3600} />
						</Form.Item>

						<Form.Item>
							<Button type="primary" htmlType="submit" loading={sendMut.isPending}>
								Apply
							</Button>
						</Form.Item>
					</Form>
				</Card>

				{/* 命令历史 */}
				<Card title="命令历史（最近 50 条）">
					<Table
						rowKey="command_id"
						loading={cmdQ.isLoading}
						dataSource={cmdQ.data?.data || []}
						pagination={false}
						size="small"
						columns={[
							{ title: "ID", dataIndex: "command_id", width: 80 },
							{ title: "Status", dataIndex: "status", width: 100, render: statusTag },
							{ title: "Command", dataIndex: "command", width: 140, render: (v) => v || "-" },
							{ title: "Created", dataIndex: "created_at", width: 200, render: (v) => v || "-" },
							{ title: "Sent", dataIndex: "sent_at", width: 200, render: (v) => v || "-" },
							{
								title: "Payload",
								dataIndex: "payload",
								render: (v) => (
									<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
										{JSON.stringify(v, null, 2)}
									</pre>
								),
							},
						]}
					/>
				</Card>
			</Space>
		</div>
	);
}
