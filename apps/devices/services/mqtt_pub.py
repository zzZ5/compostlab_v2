import json
import os
import time
import paho.mqtt.client as mqtt


class MqttPublishError(RuntimeError):
    pass


def publish_json(
    topic: str, payload: dict, qos: int = 1, retain: bool = False, timeout: float = 3.0
):
    host = os.getenv("MQTT_HOST", "118.25.108.254")
    port = int(os.getenv("MQTT_PORT", "1883"))
    user = os.getenv("MQTT_USER", "admin")
    pwd = os.getenv("MQTT_PASS", "L05b03j..")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if user:
        client.username_pw_set(user, pwd)

    rc = client.connect(host, port, keepalive=30)
    if rc != mqtt.MQTT_ERR_SUCCESS:
        raise MqttPublishError(f"connect failed rc={rc}")

    client.loop_start()
    try:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        info = client.publish(topic, payload=data, qos=qos, retain=retain)

        t0 = time.time()
        while not info.is_published():
            if time.time() - t0 > timeout:
                raise MqttPublishError("publish timeout (no PUBACK processed)")
            time.sleep(0.02)

        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise MqttPublishError(f"publish failed rc={info.rc}")
    finally:
        client.loop_stop()
        client.disconnect()
