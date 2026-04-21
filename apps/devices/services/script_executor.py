# -*- coding: utf-8 -*-
# docstring removed
import json
import logging
import pickle
from copy import deepcopy
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from pathlib import Path
from django.conf import settings
from django.utils import timezone
from django.db import transaction
from django.db.models import Q

from apps.devices.models import Device, ScriptTemplate, ScriptExecution, ScriptRuntimeState
from apps.devices.services.mqtt_pub import publish_json, MqttPublishError
from apps.telemetry.models import TelemetryKV

logger = logging.getLogger(__name__)

try:
    import joblib  # type: ignore
except Exception:
    joblib = None


def _min_auto_check_interval_seconds(script: ScriptTemplate) -> int:
    cfg = script.threshold_config if isinstance(script.threshold_config, dict) else {}
    raw = cfg.get("min_check_interval_seconds")
    if raw is None or raw == "":
        return 0
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(0, n)


def _cron_field_matches(field: str, value: int) -> bool:
    field = (field or "").strip()
    if not field or field == "*":
        return True

    for part in field.split(","):
        token = part.strip()
        if not token:
            continue

        if token == "*":
            return True

        if "/" in token:
            base, step_text = token.split("/", 1)
            try:
                step = int(step_text)
            except ValueError:
                continue
            if step <= 0:
                continue
            if base in ("", "*"):
                if value % step == 0:
                    return True
                continue
            if "-" in base:
                try:
                    start_text, end_text = base.split("-", 1)
                    start = int(start_text)
                    end = int(end_text)
                except ValueError:
                    continue
                if start <= value <= end and (value - start) % step == 0:
                    return True
                continue
            try:
                start = int(base)
            except ValueError:
                continue
            if value >= start and (value - start) % step == 0:
                return True
            continue

        if "-" in token:
            try:
                start_text, end_text = token.split("-", 1)
                start = int(start_text)
                end = int(end_text)
            except ValueError:
                continue
            if start <= value <= end:
                return True
            continue

        try:
            if int(token) == value:
                return True
        except ValueError:
            continue

    return False


def _cron_matches_now(expr: str, dt: datetime) -> bool:
    parts = [part.strip() for part in str(expr or "").split() if part.strip()]
    if len(parts) == 5:
        minute, hour, day, month, weekday = parts
        return (
            _cron_field_matches(minute, dt.minute)
            and _cron_field_matches(hour, dt.hour)
            and _cron_field_matches(day, dt.day)
            and _cron_field_matches(month, dt.month)
            and _cron_field_matches(weekday, (dt.weekday() + 1) % 7)
        )

    if len(parts) == 6:
        second, minute, hour, day, month, weekday = parts
        return (
            _cron_field_matches(second, dt.second)
            and _cron_field_matches(minute, dt.minute)
            and _cron_field_matches(hour, dt.hour)
            and _cron_field_matches(day, dt.day)
            and _cron_field_matches(month, dt.month)
            and _cron_field_matches(weekday, (dt.weekday() + 1) % 7)
        )

    return False


class ScriptExecutor:
    # docstring removed

    def __init__(self):
        self.result_cache = {}
        self.model_cache: Dict[str, Any] = {}

    def _get_or_create_runtime_state(
        self, script: ScriptTemplate, device: Device
    ) -> ScriptRuntimeState:
        state_obj = (
            ScriptRuntimeState.objects.select_for_update()
            .filter(script=script, device=device)
            .first()
        )
        if state_obj:
            return state_obj
        return ScriptRuntimeState.objects.create(script=script, device=device, state={})

    def _normalize_runtime_value(self, value: Any) -> Any:
        try:
            json.dumps(value)
        except TypeError as exc:
            raise ValueError(
                "runtime variable must be JSON-serializable"
            ) from exc
        return deepcopy(value)

    def _build_runtime_state_helpers(
        self, script: ScriptTemplate, device: Device
    ) -> Dict[str, Any]:
        with transaction.atomic():
            state_obj = self._get_or_create_runtime_state(script, device)
            state_data = (
                deepcopy(state_obj.state)
                if isinstance(state_obj.state, dict)
                else {}
            )

        touched_keys: Dict[str, Any] = {}

        def _key(name: Any) -> str:
            text = str(name or "").strip()
            if not text:
                raise ValueError("runtime variable name is required")
            return text

        def _save_state() -> None:
            if not touched_keys:
                return
            with transaction.atomic():
                current = self._get_or_create_runtime_state(script, device)
                next_state = deepcopy(current.state) if isinstance(current.state, dict) else {}
                next_state.update(deepcopy(state_data))
                current.state = next_state
                current.save(update_fields=["state", "updated_at"])

        def _get_var(name: Any, default: Any = None) -> Any:
            return deepcopy(state_data.get(_key(name), default))

        def _set_var(name: Any, value: Any) -> Any:
            k = _key(name)
            normalized = self._normalize_runtime_value(value)
            state_data[k] = normalized
            touched_keys[k] = deepcopy(normalized)
            _save_state()
            return deepcopy(normalized)

        def _del_var(name: Any) -> None:
            k = _key(name)
            if k in state_data:
                state_data.pop(k, None)
                touched_keys[k] = None
                with transaction.atomic():
                    current = self._get_or_create_runtime_state(script, device)
                    next_state = deepcopy(current.state) if isinstance(current.state, dict) else {}
                    next_state.pop(k, None)
                    current.state = next_state
                    current.save(update_fields=["state", "updated_at"])

        def _incr_var(name: Any, step: Any = 1, default: Any = 0) -> Any:
            k = _key(name)
            current = state_data.get(k, default)
            try:
                next_value = current + step
            except Exception as exc:
                raise ValueError(
                    f"runtime variable '{k}' does not support increment"
                ) from exc
            return _set_var(k, next_value)

        def _get_vars() -> Dict[str, Any]:
            return deepcopy(state_data)

        return {
            "get_var": _get_var,
            "set_var": _set_var,
            "del_var": _del_var,
            "incr_var": _incr_var,
            "get_vars": _get_vars,
            "state_snapshot": lambda: deepcopy(state_data),
            "state_writes": lambda: deepcopy(touched_keys),
        }

    def _resolve_source_device(self, script: ScriptTemplate, fallback_device: Device) -> Device:
        source_device_id = None
        if isinstance(script.threshold_config, dict):
            source_device_id = script.threshold_config.get("source_device_id")
        if not source_device_id and isinstance(script.schedule_config, dict):
            source_device_id = script.schedule_config.get("source_device_id")

        if isinstance(source_device_id, int):
            return Device.objects.filter(id=source_device_id, is_active=True).first() or fallback_device
        return fallback_device

    def _resolve_target_device(self, script: ScriptTemplate, fallback_device: Device) -> Device:
        target_device_id = None
        if isinstance(script.command_template, dict):
            target_device_id = script.command_template.get("target_device_id")

        if isinstance(target_device_id, int):
            return Device.objects.filter(id=target_device_id, is_active=True).first() or fallback_device
        return fallback_device

    def _resolve_device_ref(
        self,
        default_device: Device,
        device_id: Optional[int] = None,
        device_code: Optional[str] = None,
    ) -> Device:
        if isinstance(device_id, int):
            return Device.objects.filter(id=device_id, is_active=True).first() or default_device

        code = str(device_code or "").strip()
        if code:
            return Device.objects.filter(code__iexact=code, is_active=True).first() or default_device

        return default_device

    def execute_script(
        self,
        script: ScriptTemplate,
        device: Device,
        trigger_reason: str = "manual",
        scheduled_at: Optional[datetime] = None,
        created_by=None
    ) -> ScriptExecution:
        # docstring removed
        source_device = self._resolve_source_device(script, device)
        target_device = self._resolve_target_device(script, device)

        # 创建执行记录
        execution = ScriptExecution.objects.create(
            script=script,
            device=target_device,
            status=ScriptExecution.Status.RUNNING,
            trigger_reason=trigger_reason,
            scheduled_at=scheduled_at,
            started_at=timezone.now(),
            created_by=created_by
        )

        try:
            action_plan = None
            commands: List[Dict[str, Any]] = []
            python_meta: Dict[str, Any] = {}
            allow_else = trigger_reason != "threshold_check"

            if script.script_type == ScriptTemplate.ScriptType.THRESHOLD:
                commands = self._execute_threshold_script(script, source_device, allow_else=allow_else)
            elif script.script_type == ScriptTemplate.ScriptType.SCHEDULE:
                commands = self._execute_schedule_script(script)
            elif script.script_type == ScriptTemplate.ScriptType.PYTHON:
                python_result = self._execute_python_script(script, source_device)
                if isinstance(python_result, dict):
                    python_meta = python_result.get("_meta", {}) if isinstance(python_result.get("_meta"), dict) else {}
                    if isinstance(python_result.get("actions"), list):
                        action_plan = python_result.get("actions") or []
                    elif isinstance(python_result.get("commands"), list):
                        commands = python_result.get("commands") or []
                else:
                    commands = python_result if isinstance(python_result, list) else []
            else:
                commands = self._execute_hybrid_script(script, source_device, allow_else=allow_else)

            if action_plan:
                success, result, executed_commands = self._send_action_plan(target_device, action_plan)
                execution.commands = executed_commands
                execution.result = {
                    **result,
                    "source_device": source_device.code,
                    "target_device": target_device.code,
                    **({"python_meta": python_meta} if python_meta else {}),
                }
                execution.status = ScriptExecution.Status.SUCCESS if success else ScriptExecution.Status.FAILED
            elif commands:
                has_per_command_target = any(
                    isinstance(item, dict)
                    and (
                        isinstance(item.get("target_device_id"), int)
                        or bool(str(item.get("target_device_code") or "").strip())
                    )
                    for item in commands
                )
                if has_per_command_target:
                    action_plan = self._build_action_plan_from_commands(target_device, commands)
                    success, result, executed_commands = self._send_action_plan(target_device, action_plan)
                    execution.commands = executed_commands
                    execution.result = {
                        **result,
                        "source_device": source_device.code,
                        "target_device": target_device.code,
                        **({"python_meta": python_meta} if python_meta else {}),
                    }
                    execution.status = ScriptExecution.Status.SUCCESS if success else ScriptExecution.Status.FAILED
                else:
                    effective_commands, skipped_config_updates = self._filter_noop_config_updates(target_device, commands)
                    if effective_commands:
                        success, result = self._send_commands(target_device, effective_commands)
                        execution.commands = effective_commands
                        execution.result = {
                            **result,
                            "source_device": source_device.code,
                            "target_device": target_device.code,
                            **(
                                {"skipped_commands": skipped_config_updates}
                                if skipped_config_updates
                                else {}
                            ),
                            **({"python_meta": python_meta} if python_meta else {}),
                        }
                        execution.status = ScriptExecution.Status.SUCCESS if success else ScriptExecution.Status.FAILED
                    else:
                        execution.status = ScriptExecution.Status.SKIPPED
                        execution.result = {
                            "message": "No effective commands generated",
                            "source_device": source_device.code,
                            "target_device": target_device.code,
                            "skipped_commands": skipped_config_updates,
                            **({"python_meta": python_meta} if python_meta else {}),
                        }
            else:
                execution.status = ScriptExecution.Status.SKIPPED
                execution.result = {
                    "message": "No commands generated",
                    "source_device": source_device.code,
                    "target_device": target_device.code,
                    **({"python_meta": python_meta} if python_meta else {}),
                }

            execution.completed_at = timezone.now()
            execution.save()

            return execution

        except Exception as e:
            logger.error(f"Script execution failed: {e}", exc_info=True)
            execution.status = ScriptExecution.Status.FAILED
            execution.error_message = str(e)
            execution.completed_at = timezone.now()
            execution.save()
            return execution

    def _execute_threshold_script(
        self, script: ScriptTemplate, device: Device, allow_else: bool = True
    ) -> List[Dict[str, Any]]:
        config = script.threshold_config or {}
        condition_mode = "any" if config.get("condition_mode") == "any" else "all"
        conditions = config.get("conditions") if isinstance(config.get("conditions"), list) else None
        if not conditions:
            conditions = [
                {
                    "metric": config.get("metric"),
                    "channel_code": config.get("channel_code"),
                    "operator": config.get("operator"),
                    "value": config.get("value"),
                }
            ]

        matches: List[bool] = []
        for condition in conditions:
            metric = condition.get("metric")
            channel_code = condition.get("channel_code")
            operator = condition.get("operator")
            threshold_value = condition.get("value")

            if not all([metric, operator, threshold_value is not None]):
                logger.warning(f"Invalid threshold condition for script {script.name}")
                return []

            condition_device = self._resolve_device_ref(
                device,
                condition.get("source_device_id") if isinstance(condition.get("source_device_id"), int) else None,
                condition.get("source_device_code") if isinstance(condition.get("source_device_code"), str) else None,
            )
            latest_value = self._get_latest_metric_value(condition_device, metric, channel_code)
            if latest_value is None:
                logger.warning(f"No data found for metric {metric} on device {condition_device.code}")
                matches.append(False)
                continue

            matches.append(self._check_threshold(latest_value, operator, threshold_value))

        if not matches:
            return []

        should_execute = any(matches) if condition_mode == "any" else all(matches)
        if should_execute:
            logger.info(
                "Threshold triggered for %s: %s conditions matched",
                device.code,
                "any" if condition_mode == "any" else "all",
            )
            return script.command_template.get("commands", [])
        if allow_else:
            return script.command_template.get("else_commands", []) or []
        return []

    def _execute_schedule_script(
        self, script: ScriptTemplate
    ) -> List[Dict[str, Any]]:
        return script.command_template.get("commands", [])

    def _build_action_plan_from_commands(
        self,
        default_target_device: Device,
        commands: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        grouped: Dict[str, Dict[str, Any]] = {}

        for item in commands:
            if not isinstance(item, dict):
                continue

            target_device = self._resolve_device_ref(
                default_target_device,
                item.get("target_device_id") if isinstance(item.get("target_device_id"), int) else None,
                item.get("target_device_code") if isinstance(item.get("target_device_code"), str) else None,
            )
            command = dict(item)
            command.pop("target_device_id", None)
            command.pop("target_device_code", None)
            key = f"{target_device.id}:{target_device.code}"

            if key not in grouped:
                grouped[key] = {
                    "target_device_id": target_device.id,
                    "target_device_code": target_device.code,
                    "commands": [],
                }

            grouped[key]["commands"].append(command)

        return list(grouped.values())

    def _execute_python_script(
        self, script: ScriptTemplate, device: Device
    ) -> Any:
        if not script.python_code:
            return []

        try:
            model_trace: List[Dict[str, Any]] = []
            features_trace: Dict[str, Any] = {}
            runtime_helpers = self._build_runtime_state_helpers(script, device)

            def _predict(model_name: str, features: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
                prediction = self._predict_rule_model(model_name, features or {})
                model_kind = self._get_model_kind(model_name)
                model_trace.append(
                    {
                        "model_name": model_name,
                        "model_kind": model_kind,
                        "features": deepcopy(features or {}),
                        "output": deepcopy(prediction),
                    }
                )
                return prediction

            exec_globals = {
                "__builtins__": {
                    "print": print,
                    "len": len,
                    "range": range,
                    "enumerate": enumerate,
                    "int": int,
                    "float": float,
                    "bool": bool,
                    "str": str,
                    "list": list,
                    "tuple": tuple,
                    "dict": dict,
                    "sum": sum,
                    "min": min,
                    "max": max,
                    "abs": abs,
                    "round": round,
                    "True": True,
                    "False": False,
                    "None": None,
                },
                "get_latest_value": lambda metric, channel_code=None, device_id=None, device_code=None: self._get_latest_metric_value(
                    self._resolve_device_ref(device, device_id, device_code),
                    metric,
                    channel_code,
                ),
                "get_latest_channel_value": lambda channel_code, device_id=None, device_code=None: self._get_latest_channel_value(
                    self._resolve_device_ref(device, device_id, device_code),
                    channel_code,
                ),
                "get_history": lambda metric, minutes, channel_code=None, device_id=None, device_code=None: self._get_history_values(
                    self._resolve_device_ref(device, device_id, device_code),
                    metric,
                    minutes,
                    channel_code,
                ),
                "get_history_points": lambda metric, minutes, channel_code=None, device_id=None, device_code=None: self._get_history_points(
                    self._resolve_device_ref(device, device_id, device_code),
                    metric,
                    minutes,
                    channel_code,
                ),
                "predict": _predict,
                "clamp": lambda value, min_v, max_v: max(min_v, min(max_v, value)),
                "now_ts": lambda: timezone.now().strftime("%Y-%m-%d %H:%M:%S"),
                "device": device,
                "datetime": datetime,
                "timedelta": timedelta,
                "FEATURES": features_trace,
                "get_var": runtime_helpers["get_var"],
                "set_var": runtime_helpers["set_var"],
                "del_var": runtime_helpers["del_var"],
                "incr_var": runtime_helpers["incr_var"],
                "get_vars": runtime_helpers["get_vars"],
            }

            exec_result = {}
            exec(script.python_code, exec_globals, exec_result)

            if "actions" in exec_result:
                return {
                    "actions": exec_result["actions"],
                    "_meta": {
                        "model_trace": model_trace,
                        "features_snapshot": exec_result.get("FEATURES", features_trace),
                        "runtime_state": runtime_helpers["state_snapshot"](),
                        "runtime_writes": runtime_helpers["state_writes"](),
                    },
                }
            if "commands" in exec_result:
                return {
                    "commands": exec_result["commands"],
                    "_meta": {
                        "model_trace": model_trace,
                        "features_snapshot": exec_result.get("FEATURES", features_trace),
                        "runtime_state": runtime_helpers["state_snapshot"](),
                        "runtime_writes": runtime_helpers["state_writes"](),
                    },
                }
            logger.warning(f"Python script {script.name} did not return 'commands' or 'actions'")
            return []

        except Exception as e:
            logger.error(f"Python script execution failed: {e}", exc_info=True)
            raise Exception(f"Python script error: {str(e)}")

    def _execute_hybrid_script(
        self, script: ScriptTemplate, device: Device, allow_else: bool = True
    ) -> List[Dict[str, Any]]:
        commands = self._execute_threshold_script(script, device, allow_else=allow_else)
        if commands:
            logger.info(f"Hybrid script {script.name} triggered by threshold")
            return commands

        if script.schedule_config:
            logger.info(f"Hybrid script {script.name} using schedule config")
            return script.command_template.get("commands", [])

        return []

    def _get_latest_metric_value(
        self, device: Device, metric: str, channel_code: Optional[str] = None
    ) -> Optional[float]:
        try:
            if channel_code:
                return self._get_latest_channel_value(device, channel_code)

            channel = device.channels.filter(metric__iexact=metric).first()
            if not channel:
                return None

            latest = TelemetryKV.objects.filter(device=device, code=channel.code).order_by("-ts").first()
            if latest:
                return float(latest.value)
            return None
        except Exception as e:
            logger.error(f"Failed to get latest value: {e}")
            return None

    def _get_latest_channel_value(
        self, device: Device, channel_code: str
    ) -> Optional[float]:
        try:
            code = str(channel_code or "").strip()
            if not code:
                return None

            channel = device.channels.filter(code__iexact=code).first()
            if not channel:
                return None

            latest = TelemetryKV.objects.filter(device=device, code=channel.code).order_by("-ts").first()
            if latest:
                return float(latest.value)
            return None
        except Exception as e:
            logger.error(f"Failed to get latest channel value: {e}")
            return None

    def _get_history_points(
        self,
        device: Device,
        metric: str,
        minutes: int,
        channel_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        try:
            window_minutes = max(1, int(minutes))
        except Exception:
            window_minutes = 1
        since = timezone.now() - timedelta(minutes=window_minutes)

        try:
            code = str(channel_code or "").strip()
            if not code:
                channel = device.channels.filter(metric__iexact=metric).first()
                if not channel:
                    return []
                code = channel.code

            values = (
                TelemetryKV.objects.filter(device=device, code__iexact=code, ts__gte=since)
                .order_by("ts")
                .values("ts", "value")
            )
            points: List[Dict[str, Any]] = []
            for item in values:
                try:
                    numeric_value = float(item.get("value"))
                except Exception:
                    continue
                ts = item.get("ts")
                points.append(
                    {
                        "ts": timezone.localtime(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else None,
                        "value": numeric_value,
                    }
                )
            return points
        except Exception as e:
            logger.error(f"Failed to get history points: {e}")
            return []

    def _get_history_values(
        self,
        device: Device,
        metric: str,
        minutes: int,
        channel_code: Optional[str] = None,
    ) -> List[float]:
        points = self._get_history_points(device, metric, minutes, channel_code)
        return [float(item["value"]) for item in points if isinstance(item, dict) and item.get("value") is not None]

    def _get_model_registry(self) -> Dict[str, Any]:
        registry = getattr(settings, "CONTROL_MODEL_REGISTRY", None)
        if isinstance(registry, dict):
            return registry
        return {}

    def _get_model_config(self, model_name: str) -> Optional[Dict[str, Any]]:
        registry = self._get_model_registry()
        raw_name = str(model_name or "").strip()
        if not raw_name:
            return None
        if isinstance(registry.get(raw_name), dict):
            return registry.get(raw_name)
        lowered = raw_name.lower()
        if isinstance(registry.get(lowered), dict):
            return registry.get(lowered)
        for key, value in registry.items():
            if str(key).strip().lower() == lowered and isinstance(value, dict):
                return value
        return None

    def _get_model_kind(self, model_name: str) -> str:
        config = self._get_model_config(model_name)
        if isinstance(config, dict):
            return str(config.get("kind", "rule")).lower()
        return "rule"

    def _resolve_model_path(self, raw_path: str) -> Path:
        raw = str(raw_path or "").strip()
        if not raw:
            raise ValueError("model path is empty")
        path = Path(raw)
        if path.as_posix() in (".", ""):
            raise ValueError("model path is empty")
        if path.is_absolute():
            return path
        base_dir = getattr(settings, "BASE_DIR", None)
        if base_dir:
            return Path(base_dir) / path
        return path

    def _load_sklearn_model(self, model_path: str):
        resolved = self._resolve_model_path(model_path)
        cache_key = str(resolved)
        if cache_key in self.model_cache:
            return self.model_cache[cache_key]

        if not resolved.exists():
            raise FileNotFoundError(f"model file not found: {resolved}")

        model = None
        if joblib is not None:
            try:
                model = joblib.load(resolved)
            except Exception:
                model = None
        if model is None:
            with open(resolved, "rb") as fp:
                model = pickle.load(fp)
        self.model_cache[cache_key] = model
        return model

    def _to_number(self, value: Any) -> Optional[float]:
        try:
            if value is None:
                return None
            return float(value)
        except Exception:
            return None

    def _predict_aeration_rule(self, model_name: str, model_config: Dict[str, Any], features: Dict[str, Any]) -> Dict[str, Any]:
        thresholds = model_config.get("thresholds", {}) if isinstance(model_config.get("thresholds"), dict) else {}
        suggestions = model_config.get("suggestions", {}) if isinstance(model_config.get("suggestions"), dict) else {}
        confidence_cfg = model_config.get("confidence", {}) if isinstance(model_config.get("confidence"), dict) else {}

        temp_key = str(thresholds.get("temp_feature", "temp_avg_5m"))
        o2_key = str(thresholds.get("o2_feature", "o2_min_5m"))
        temp_high = self._to_number(thresholds.get("temp_high"))
        o2_low = self._to_number(thresholds.get("o2_low"))

        temp_value = self._to_number(features.get(temp_key))
        o2_value = self._to_number(features.get(o2_key))

        if temp_value is None and o2_value is None:
            return {
                "decision": "hold",
                "confidence": self._to_number(confidence_cfg.get("hold")) or 0.2,
                "suggestions": {"duration_ms": int(self._to_number(suggestions.get("hold_duration_ms")) or 30000)},
                "reason": "missing_features",
            }

        hit_temp = temp_high is not None and temp_value is not None and temp_value >= temp_high
        hit_o2 = o2_low is not None and o2_value is not None and o2_value <= o2_low
        if hit_temp or hit_o2:
            return {
                "decision": "on",
                "confidence": self._to_number(confidence_cfg.get("on")) or 0.78,
                "suggestions": {"duration_ms": int(self._to_number(suggestions.get("on_duration_ms")) or 120000)},
                "reason": "temp_high_or_o2_low",
            }

        return {
            "decision": "off",
            "confidence": self._to_number(confidence_cfg.get("off")) or 0.72,
            "suggestions": {"duration_ms": int(self._to_number(suggestions.get("off_duration_ms")) or 0)},
            "reason": "within_comfort_band",
        }

    def _predict_heater_rule(self, model_name: str, model_config: Dict[str, Any], features: Dict[str, Any]) -> Dict[str, Any]:
        thresholds = model_config.get("thresholds", {}) if isinstance(model_config.get("thresholds"), dict) else {}
        suggestions = model_config.get("suggestions", {}) if isinstance(model_config.get("suggestions"), dict) else {}
        confidence_cfg = model_config.get("confidence", {}) if isinstance(model_config.get("confidence"), dict) else {}

        temp_key = str(thresholds.get("temp_feature", "temp_avg_5m"))
        temp_low = self._to_number(thresholds.get("temp_low"))
        temp_high = self._to_number(thresholds.get("temp_high"))
        temp_value = self._to_number(features.get(temp_key))

        if temp_value is None:
            return {
                "decision": "hold",
                "confidence": self._to_number(confidence_cfg.get("hold")) or 0.2,
                "suggestions": {"duration_ms": int(self._to_number(suggestions.get("hold_duration_ms")) or 30000)},
                "reason": "missing_temperature_feature",
            }

        if temp_low is not None and temp_value <= temp_low:
            return {
                "decision": "on",
                "confidence": self._to_number(confidence_cfg.get("on")) or 0.76,
                "suggestions": {"duration_ms": int(self._to_number(suggestions.get("on_duration_ms")) or 90000)},
                "reason": "temperature_too_low",
            }

        if temp_high is not None and temp_value >= temp_high:
            return {
                "decision": "off",
                "confidence": self._to_number(confidence_cfg.get("off")) or 0.74,
                "suggestions": {"duration_ms": int(self._to_number(suggestions.get("off_duration_ms")) or 0)},
                "reason": "temperature_recovered",
            }

        return {
            "decision": "hold",
            "confidence": self._to_number(confidence_cfg.get("hold")) or 0.5,
            "suggestions": {"duration_ms": int(self._to_number(suggestions.get("hold_duration_ms")) or 30000)},
            "reason": "temperature_in_deadband",
        }

    def _predict_sklearn_model(self, model_name: str, model_config: Dict[str, Any], features: Dict[str, Any]) -> Dict[str, Any]:
        model_path = str(model_config.get("path", "")).strip()
        feature_names = model_config.get("features", [])
        if not model_path:
            return {
                "decision": "hold",
                "confidence": 0.1,
                "suggestions": {"duration_ms": 30000},
                "reason": "model_path_missing",
            }
        if not isinstance(feature_names, list) or not feature_names:
            return {
                "decision": "hold",
                "confidence": 0.1,
                "suggestions": {"duration_ms": 30000},
                "reason": "model_features_missing",
            }

        missing_strategy = str(model_config.get("missing_feature_strategy", "hold")).lower()
        default_feature_value = self._to_number(model_config.get("default_feature_value"))
        vector: List[float] = []
        missing_features: List[str] = []

        for feature_name in feature_names:
            key = str(feature_name)
            value = self._to_number(features.get(key))
            if value is None:
                missing_features.append(key)
                if missing_strategy == "fill" and default_feature_value is not None:
                    value = default_feature_value
                elif missing_strategy == "zero":
                    value = 0.0
                else:
                    return {
                        "decision": "hold",
                        "confidence": 0.2,
                        "suggestions": {"duration_ms": 30000},
                        "reason": f"missing_features:{','.join(missing_features)}",
                    }
            vector.append(float(value))

        try:
            model = self._load_sklearn_model(model_path)
            confidence = None
            raw_label = None

            if hasattr(model, "predict_proba") and callable(getattr(model, "predict_proba")):
                proba = model.predict_proba([vector])[0]
                best_idx = 0
                best_val = float(proba[0]) if len(proba) else 0.0
                for i, item in enumerate(proba):
                    v = float(item)
                    if v > best_val:
                        best_idx = i
                        best_val = v
                confidence = best_val
                if hasattr(model, "classes_") and len(getattr(model, "classes_", [])) > best_idx:
                    raw_label = getattr(model, "classes_")[best_idx]
            if raw_label is None and hasattr(model, "predict") and callable(getattr(model, "predict")):
                raw_label = model.predict([vector])[0]

            decision_map = model_config.get("decision_map", {}) if isinstance(model_config.get("decision_map"), dict) else {}
            decision = str(decision_map.get(str(raw_label), decision_map.get(str(raw_label).lower(), raw_label))).lower()
            if decision not in ("on", "off", "hold"):
                if str(raw_label).lower() in ("1", "on", "true"):
                    decision = "on"
                elif str(raw_label).lower() in ("0", "off", "false"):
                    decision = "off"
                else:
                    decision = "hold"

            suggestions_cfg = model_config.get("suggestions", {}) if isinstance(model_config.get("suggestions"), dict) else {}
            duration_key = f"{decision}_duration_ms"
            duration_ms = int(self._to_number(suggestions_cfg.get(duration_key)) or self._to_number(suggestions_cfg.get("hold_duration_ms")) or 30000)
            return {
                "decision": decision,
                "confidence": confidence if confidence is not None else 0.6,
                "suggestions": {"duration_ms": duration_ms},
                "reason": f"sklearn_prediction:{model_name}",
            }
        except Exception as exc:
            logger.error("sklearn model prediction failed for %s: %s", model_name, exc, exc_info=True)
            return {
                "decision": "hold",
                "confidence": 0.1,
                "suggestions": {"duration_ms": 30000},
                "reason": f"model_error:{exc}",
            }

    def _predict_rule_model(self, model_name: str, features: Dict[str, Any]) -> Dict[str, Any]:
        name = str(model_name or "").strip().lower()
        legacy_aliases = {
            "aeration_test_v1": "cp500_demo_control_v1",
            "aeration_sklearn_v1": "cp500_demo_control_v1",
        }
        name = legacy_aliases.get(name, name)
        model_config = self._get_model_config(name)

        if isinstance(model_config, dict):
            kind = str(model_config.get("kind", "rule")).lower()
            rule_type = str(model_config.get("rule_type", "")).lower()
            if kind in ("sklearn", "ml", "model"):
                return self._predict_sklearn_model(name, model_config, features)
            if kind == "rule" and rule_type in ("aeration", "aeration_v1"):
                return self._predict_aeration_rule(name, model_config, features)
            if kind == "rule" and rule_type in ("heater", "heater_v1"):
                return self._predict_heater_rule(name, model_config, features)

        if name in ("aeration_v1", "aeration-rule-v1", "rule_aeration_v1"):
            return self._predict_aeration_rule(
                name,
                {
                    "thresholds": {"temp_feature": "temp_avg_5m", "temp_high": 70, "o2_feature": "o2_min_5m", "o2_low": 8},
                    "suggestions": {"on_duration_ms": 120000, "off_duration_ms": 0, "hold_duration_ms": 30000},
                    "confidence": {"on": 0.78, "off": 0.72, "hold": 0.2},
                },
                features,
            )

        return {
            "decision": "hold",
            "confidence": 0.1,
            "suggestions": {"duration_ms": 30000},
            "reason": f"unknown_model:{model_name}",
        }

    def _check_threshold(
        self, value: float, operator: str, threshold: float
    ) -> bool:
        try:
            if operator == ">":
                return value > threshold
            elif operator == ">=":
                return value >= threshold
            elif operator == "<":
                return value < threshold
            elif operator == "<=":
                return value <= threshold
            elif operator == "==":
                return value == threshold
            elif operator == "!=":
                return value != threshold
            else:
                return False
        except Exception:
            return False

    def _merge_config_patch(self, base: Optional[dict], patch: Optional[dict]) -> dict:
        """Merge partial config patch with same semantics as device API."""
        if patch is None:
            return {}
        if not isinstance(base, dict):
            base = {}
        result = deepcopy(base)
        for key, value in patch.items():
            if value is None:
                result.pop(key, None)
                continue
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = self._merge_config_patch(result.get(key), value)
                continue
            result[key] = deepcopy(value)
        return result

    def _extract_config_patch(self, command: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        cfg = command.get("config")
        if isinstance(cfg, dict):
            return cfg
        raw_text = command.get("config_text")
        if isinstance(raw_text, str) and raw_text.strip():
            try:
                parsed = json.loads(raw_text)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return None
        return None

    def _filter_noop_config_updates(
        self, device: Device, commands: List[Dict[str, Any]]
    ) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        current_config = getattr(device, "configuration", {}) or {}
        if not isinstance(current_config, dict):
            current_config = {}

        effective_commands: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []

        for command in commands:
            if not isinstance(command, dict) or command.get("command") != "config_update":
                effective_commands.append(command)
                continue

            patch = self._extract_config_patch(command)
            if not isinstance(patch, dict):
                effective_commands.append(command)
                continue

            expected_config = self._merge_config_patch(current_config, patch)
            if expected_config == current_config:
                skipped.append(
                    {
                        "command": "config_update",
                        "reason": "no_configuration_change",
                        "config": patch,
                    }
                )
                continue

            effective_commands.append(command)
            current_config = expected_config

        return effective_commands, skipped


    def _send_commands(
        self, device: Device, commands: List[Dict[str, Any]]
    ) -> tuple[bool, Dict[str, Any]]:
        if not commands or not device.response_topic:
            return False, {"detail": "No commands or topic"}

        payload = {
            "device": device.code,
            "commands": commands,
            "server_ts": timezone.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        try:
            publish_json(device.response_topic, payload, qos=1, retain=False)
            return True, {
                "mqtt": "published",
                "topic": device.response_topic,
                "command_count": len(commands),
            }
        except MqttPublishError as e:
            return False, {"detail": str(e)}
        except Exception as e:
            return False, {"detail": f"Unexpected: {str(e)}"}

    def _send_action_plan(
        self,
        default_target_device: Device,
        actions: List[Dict[str, Any]],
    ) -> tuple[bool, Dict[str, Any], List[Dict[str, Any]]]:
        targets_result = []
        executed_commands: List[Dict[str, Any]] = []
        overall_success = True

        for item in actions:
            if not isinstance(item, dict):
                overall_success = False
                targets_result.append({"detail": "Invalid action item"})
                continue

            target_device = self._resolve_device_ref(
                default_target_device,
                item.get("target_device_id"),
                item.get("target_device_code"),
            )
            commands = item.get("commands")
            if not isinstance(commands, list) or not commands:
                overall_success = False
                targets_result.append(
                    {
                        "target_device": target_device.code,
                        "detail": "No commands for target device",
                    }
                )
                continue

            effective_commands, skipped_config_updates = self._filter_noop_config_updates(target_device, commands)
            if not effective_commands:
                targets_result.append(
                    {
                        "target_device": target_device.code,
                        "success": True,
                        "skipped": True,
                        "detail": "No effective commands for target device",
                        "skipped_commands": skipped_config_updates,
                    }
                )
                continue

            success, result = self._send_commands(target_device, effective_commands)
            overall_success = overall_success and success
            executed_commands.extend(effective_commands)
            targets_result.append(
                {
                    "target_device": target_device.code,
                    "success": success,
                    "commands": effective_commands,
                    **(
                        {"skipped_commands": skipped_config_updates}
                        if skipped_config_updates
                        else {}
                    ),
                    "result": result,
                }
            )

        return overall_success, {"targets": targets_result}, executed_commands


class ThresholdMonitor:
    def __init__(self):
        self.executor = ScriptExecutor()

    def check_and_execute_all(self) -> Dict[str, Any]:
        results = {"checked": 0, "executed": 0, "skipped": 0, "failed": 0}
        scripts = ScriptTemplate.objects.filter(
            is_active=True,
            script_type__in=[ScriptTemplate.ScriptType.THRESHOLD, ScriptTemplate.ScriptType.HYBRID],
        ).order_by("-priority", "-created_at")

        for script in scripts:
            results["checked"] += 1

            running = ScriptExecution.objects.filter(
                script=script,
                status=ScriptExecution.Status.RUNNING,
                created_at__gte=timezone.now() - timedelta(minutes=5),
            ).exists()
            if running:
                results["skipped"] += 1
                continue

            devices = script.devices.filter(is_active=True)
            if not devices.exists() and script.run:
                devices = Device.objects.filter(runwindow__run=script.run, is_active=True).distinct()

            if not devices.exists():
                results["skipped"] += 1
                continue

            for device in devices:
                interval = _min_auto_check_interval_seconds(script)
                if interval > 0:
                    target_device = self.executor._resolve_target_device(script, device)
                    last_start = (
                        ScriptExecution.objects.filter(
                            script=script,
                            device=target_device,
                            trigger_reason="threshold_check",
                        )
                        .order_by("-started_at")
                        .values_list("started_at", flat=True)
                        .first()
                    )
                    if last_start:
                        elapsed = (timezone.now() - last_start).total_seconds()
                        if elapsed < interval:
                            results["skipped"] += 1
                            continue

                try:
                    execution = self.executor.execute_script(script, device, trigger_reason="threshold_check")
                    if execution.status == ScriptExecution.Status.SUCCESS:
                        results["executed"] += 1
                    elif execution.status == ScriptExecution.Status.SKIPPED:
                        results["skipped"] += 1
                    else:
                        results["failed"] += 1
                except Exception as exc:
                    logger.error(f"Failed to execute threshold script {script.name} on device {device.code}: {exc}")
                    results["failed"] += 1

        return results


class ScheduleMonitor:
    def __init__(self):
        self.executor = ScriptExecutor()

    def check_and_execute_all(self, now: Optional[datetime] = None) -> Dict[str, Any]:
        current = now or timezone.localtime(timezone.now())
        scheduled_at = current.replace(second=0, microsecond=0)
        results = {"checked": 0, "matched": 0, "executed": 0, "skipped": 0, "failed": 0}

        scripts = ScriptTemplate.objects.filter(
            is_active=True,
            script_type__in=[
                ScriptTemplate.ScriptType.SCHEDULE,
                ScriptTemplate.ScriptType.HYBRID,
                ScriptTemplate.ScriptType.PYTHON,
            ],
        ).order_by("-priority", "-created_at")

        for script in scripts:
            results["checked"] += 1
            schedule_config = script.schedule_config or {}
            cron_expr = str(schedule_config.get("cron") or "").strip()
            if not cron_expr or not _cron_matches_now(cron_expr, current):
                continue

            results["matched"] += 1

            already_executed = ScriptExecution.objects.filter(
                script=script,
                trigger_reason="schedule_check",
                scheduled_at=scheduled_at,
            ).exists()
            if already_executed:
                results["skipped"] += 1
                continue

            running = ScriptExecution.objects.filter(
                script=script,
                status=ScriptExecution.Status.RUNNING,
                created_at__gte=timezone.now() - timedelta(minutes=5),
            ).exists()
            if running:
                results["skipped"] += 1
                continue

            devices = script.devices.filter(is_active=True)
            if not devices.exists() and script.run:
                devices = Device.objects.filter(runwindow__run=script.run, is_active=True).distinct()

            if not devices.exists():
                results["skipped"] += 1
                continue

            for device in devices:
                interval = _min_auto_check_interval_seconds(script)
                if interval > 0:
                    target_device = self.executor._resolve_target_device(script, device)
                    last_start = (
                        ScriptExecution.objects.filter(
                            script=script,
                            device=target_device,
                            trigger_reason="schedule_check",
                        )
                        .order_by("-started_at")
                        .values_list("started_at", flat=True)
                        .first()
                    )
                    if last_start:
                        elapsed = (timezone.now() - last_start).total_seconds()
                        if elapsed < interval:
                            results["skipped"] += 1
                            continue

                try:
                    execution = self.executor.execute_script(
                        script,
                        device,
                        trigger_reason="schedule_check",
                        scheduled_at=scheduled_at,
                    )
                    if execution.status == ScriptExecution.Status.SUCCESS:
                        results["executed"] += 1
                    elif execution.status == ScriptExecution.Status.SKIPPED:
                        results["skipped"] += 1
                    else:
                        results["failed"] += 1
                except Exception as exc:
                    logger.error(f"Failed to execute scheduled script {script.name} on device {device.code}: {exc}")
                    results["failed"] += 1

        return results
