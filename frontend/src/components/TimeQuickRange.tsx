"use client";

import { Button, Space } from "antd";
import dayjs from "dayjs";

export default function TimeQuickRange(props: {
	onPick: (range: [dayjs.Dayjs, dayjs.Dayjs]) => void;
}) {
	const { onPick } = props;

	return (
		<Space>
			<Button onClick={() => onPick([dayjs().subtract(6, "hour"), dayjs()])}>近6h</Button>
			<Button onClick={() => onPick([dayjs().subtract(24, "hour"), dayjs()])}>近24h</Button>
			<Button onClick={() => onPick([dayjs().subtract(7, "day"), dayjs()])}>近7d</Button>
		</Space>
	);
}
