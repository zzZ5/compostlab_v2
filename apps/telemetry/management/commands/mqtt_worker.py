"""
MQTT worker: 订阅 CompostLab V2 遥测主题，并将数据交给 ingest 服务入库。

设计原则
--------
1. mqtt_worker 只做三件事：
   - 订阅 MQTT topic
   - 基本校验 payload 是否“像 V2 数据”
   - 把 topic + payload 原样交给 ingest_payload()

2. 所有“业务判断”全部放在 ingest_payload()：
   - device_code 提取与一致性校验
   - Channel 自动注册
   - metric / role / display_name 语义补齐（只补空，不覆盖 admin）
   - RunWindow 匹配
   - TelemetryRaw / TelemetryKV 写入

⚠️ mqtt_worker 不做：
   - 数据类型判断（TEMP/O2 等）
   - 语义推断
   - ts 解析
   - channel 管理

这样可以保证：
**MQTT / HTTP / 未来 Kafka 等入口，行为完全一致。**
"""

import os
import json
import time
import paho.mqtt.client as mqtt
from django.core.management.base import BaseCommand

from apps.telemetry.services.ingest import ingest_payload


class Command(BaseCommand):
    help = "Subscribe MQTT and ingest V2 telemetry into DB."

    def handle(self, *args, **options):
        # =============================
        # MQTT 基础连接配置
        # =============================
        host = os.getenv("MQTT_HOST", "118.25.108.254")
        port = int(os.getenv("MQTT_PORT", "1883"))
        user = os.getenv("MQTT_USER", "")
        pwd = os.getenv("MQTT_PASS", "")

        # ✅ 默认只订阅 V2 协议的 telemetry topic
        # 规范格式：compostlab/v2/{device_code}/telemetry
        # 你现在用 compostlab/v2/# 也可以，但会收到更多非 telemetry 主题
        topic = os.getenv("MQTT_SUB_TOPIC", "compostlab/v2/+/telemetry")

        self.stdout.write(
            self.style.SUCCESS(f"[MQTT] connect {host}:{port}, sub={topic}")
        )

        # 使用 paho-mqtt v2 API
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if user:
            client.username_pw_set(user, pwd)

        # =============================
        # ReasonCode 兼容处理
        # =============================
        def _rc_to_int(reason) -> int:
            """
            paho-mqtt v2 中 on_connect 的 reasonCode 可能是：
            - int（某些版本/场景）
            - paho.mqtt.reasoncodes.ReasonCode（最常见）
            - str / None（异常场景）
            我们统一转换成 int，转换失败返回 -1。
            """
            if reason is None:
                return -1
            # 已经是 int
            if isinstance(reason, int):
                return reason
            # ReasonCode 对象通常有 value 属性
            v = getattr(reason, "value", None)
            if isinstance(v, int):
                return v
            # 有些实现可以 str() 后解析
            try:
                return int(str(reason))
            except Exception:
                return -1

        # =============================
        # MQTT 回调：连接成功
        # =============================
        def on_connect(c, userdata, flags, reasonCode, properties=None):
            """
            paho-mqtt v2 中：
            - reasonCode.value == 0 表示连接成功
            """
            rc = _rc_to_int(reasonCode)
            if rc == 0:
                self.stdout.write(self.style.SUCCESS("[MQTT] connected"))
                c.subscribe(topic, qos=1)
            else:
                # ReasonCode 也可打印名字，便于排查
                name = getattr(reasonCode, "getName", None)
                rc_name = name() if callable(name) else str(reasonCode)
                self.stdout.write(
                    self.style.ERROR(f"[MQTT] connect failed rc={rc} ({rc_name})")
                )

        # =============================
        # 最小化 V2 payload 校验
        # =============================
        def _validate_payload_v2(payload: dict) -> bool:
            """
            这里只做“是否像 V2 遥测数据”的最小校验，
            绝不在这里拦截可能有价值的数据。

            V2 最小要求：
            - payload 是 dict
            - schema_version >= 2
            - 至少包含 channels[] 或 values{}

            ❗ 注意：
            - ts 不强制（缺失时 ingest 会使用 server time）
            - 不校验 metric / role / display_name
            """
            if not isinstance(payload, dict):
                return False

            sv = payload.get("schema_version")
            if not (isinstance(sv, int) and sv >= 2):
                return False

            has_channels = (
                isinstance(payload.get("channels"), list)
                and len(payload["channels"]) > 0
            )
            has_values = (
                isinstance(payload.get("values"), dict) and len(payload["values"]) > 0
            )
            if not (has_channels or has_values):
                return False

            # 如果是 channels[] 模式，至少要有 code + value
            if has_channels:
                for ch in payload["channels"]:
                    if not isinstance(ch, dict):
                        return False
                    if not ch.get("code") and not ch.get("channel_code"):
                        return False
                    if "value" not in ch:
                        return False

            return True

        # =============================
        # MQTT 回调：收到消息
        # =============================
        def on_message(c, userdata, msg):
            """
            收到 MQTT 消息后的处理流程：

            1. 解析 JSON
            2. 做最小 V2 校验
            3. 直接调用 ingest_payload()
               - 不在这里解析 device_code
               - 不在这里处理 channel
            """
            try:
                payload = json.loads(msg.payload.decode("utf-8"))
            except Exception:
                self.stdout.write(
                    self.style.WARNING(f"[MQTT] invalid JSON, topic={msg.topic}")
                )
                return

            if not _validate_payload_v2(payload):
                self.stdout.write(
                    self.style.WARNING(f"[MQTT] invalid V2 payload, topic={msg.topic}")
                )
                return

            try:
                raw_id, n = ingest_payload(
                    topic=msg.topic,
                    payload=payload,
                    source="mqtt",
                )
                self.stdout.write(f"[INGEST] topic={msg.topic} raw={raw_id} points={n}")
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"[INGEST] failed: {e}"))

        # =============================
        # 带重连的 MQTT 主循环
        # =============================
        def loop_forever_with_reconnect():
            """
            断线自动重连，指数退避（最大 60s）
            """
            backoff = 1
            while True:
                try:
                    client.connect(host, port, keepalive=60)
                    client.loop_forever()
                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(f"[MQTT] error: {e}, retry in {backoff}s")
                    )
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 60)

        client.on_connect = on_connect
        client.on_message = on_message
        loop_forever_with_reconnect()
