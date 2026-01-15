# apps/devices/api_script.py
# -*- coding: utf-8 -*-
"""
控制脚本管理 API
支持阈值触发、定时执行、Python脚本等自动化控制
"""

from __future__ import annotations

from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.utils import timezone

from apps.api.mixins import BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin
from apps.devices.models import Device, ScriptTemplate, ScriptExecution
from apps.devices.services.script_executor import ScriptExecutor, ThresholdMonitor
from apps.accounts.utils import log_audit
from apps.accounts.models import AuditLog


# -------------------------
# helpers
# -------------------------
def _dt_local_str(dt) -> str:
    """将 datetime 转成本地时区并输出为字符串"""
    if not dt:
        return ""
    dt_local = timezone.localtime(dt)
    return dt_local_str


def _script_to_dict(script: ScriptTemplate) -> dict:
    """ScriptTemplate -> dict"""
    device_ids = list(script.devices.values_list("id", flat=True))
    return {
        "id": script.id,
        "name": script.name,
        "description": script.description,
        "script_type": script.script_type,
        "script_type_display": script.get_script_type_display(),
        "threshold_config": script.threshold_config,
        "schedule_config": script.schedule_config,
        "python_code": script.python_code,
        "command_template": script.command_template,
        "device_ids": device_ids,
        "run_id": script.run.id if script.run else None,
        "is_active": script.is_active,
        "priority": script.priority,
        "created_by": script.created_by.username if script.created_by else None,
        "created_at": _dt_local_str(script.created_at),
        "updated_at": _dt_local_str(script.updated_at),
    }


def _execution_to_dict(execution: ScriptExecution) -> dict:
    """ScriptExecution -> dict"""
    return {
        "execution_id": execution.id,
        "script_id": execution.script.id,
        "script_name": execution.script.name,
        "device_id": execution.device.id,
        "device_code": execution.device.code,
        "status": execution.status,
        "status_display": execution.get_status_display(),
        "trigger_reason": execution.trigger_reason,
        "commands": execution.commands,
        "result": execution.result,
        "error_message": execution.error_message,
        "scheduled_at": _dt_local_str(execution.scheduled_at),
        "started_at": _dt_local_str(execution.started_at),
        "completed_at": _dt_local_str(execution.completed_at),
        "created_by": execution.created_by.username if execution.created_by else None,
        "created_at": _dt_local_str(execution.created_at),
    }


# -------------------------
# Script Templates CRUD
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class ScriptTemplateListView(
    BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View
):
    """
    GET  /api/v2/scripts
    GET  /api/v2/scripts?device_id=<id>&is_active=1
    POST /api/v2/scripts

    POST body（阈值触发示例）:
    {
      "name": "高温自动降温",
      "description": "温度超过75度时关闭水泵",
      "script_type": "threshold",
      "threshold_config": {
        "metric": "temperature",
        "operator": ">=",
        "value": 75
      },
      "command_template": {
        "commands": [{"command": "pump", "action": "off"}]
      },
      "device_ids": [1, 2, 3],
      "is_active": true,
      "priority": 10
    }
    """

    def get(self, request):
        qs = ScriptTemplate.objects.all().order_by("-priority", "-created_at")

        # 筛选
        device_id = request.GET.get("device_id")
        if device_id:
            qs = qs.filter(devices__id=device_id)

        is_active = request.GET.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == "true")

        script_type = request.GET.get("script_type")
        if script_type:
            qs = qs.filter(script_type=script_type)

        items = [_script_to_dict(x) for x in qs[:100]]
        return JsonResponse({"count": len(items), "data": items}, status=200)

    def post(self, request):
        data = self.json_body(request)
        name = data.get("name", "").strip()
        if not name:
            return JsonResponse({"detail": "name is required"}, status=400)

        script_type = data.get("script_type", ScriptTemplate.ScriptType.THRESHOLD)
        if script_type not in [choice[0] for choice in ScriptTemplate.ScriptType.choices]:
            return JsonResponse({"detail": f"Invalid script_type: {script_type}"}, status=400)

        # 创建脚本
        script = ScriptTemplate.objects.create(
            name=name,
            description=data.get("description", "").strip() or "",
            script_type=script_type,
            threshold_config=data.get("threshold_config", {}),
            schedule_config=data.get("schedule_config", {}),
            python_code=data.get("python_code", ""),
            command_template=data.get("command_template", {}),
            is_active=data.get("is_active", True),
            priority=data.get("priority", 0),
            created_by=request.user if request.user.is_authenticated else None,
        )

        # 关联设备
        device_ids = data.get("device_ids", [])
        if device_ids:
            script.devices.set(device_ids)

        # 记录审计日志
        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_CREATE,
            resource_type="script_template",
            resource_id=script.id,
            description=f"创建控制脚本：{script.name}",
            request=request,
        )

        return JsonResponse(_script_to_dict(script), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class ScriptTemplateDetailView(
    BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View
):
    """
    GET    /api/v2/scripts/<id>
    PATCH  /api/v2/scripts/<id>
    PUT    /api/v2/scripts/<id>
    DELETE  /api/v2/scripts/<id>
    """

    def dispatch(self, request, *args, **kwargs):
        from apps.permissions import check_permission, ResourceType, ActionType

        # 对于 DELETE 方法，需要 admin 权限
        if request.method == "DELETE":
            user = getattr(request, "user", None)
            if not check_permission(user, ResourceType.SCRIPT, ActionType.DELETE):
                return JsonResponse(
                    {"detail": "Permission denied. Admin role required for script deletion."},
                    status=403,
                )

        return super().dispatch(request, *args, **kwargs)

    def get(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)
        return JsonResponse(_script_to_dict(script), status=200)

    def patch(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        data = self.json_body(request)

        if "name" in data:
            name = data["name"].strip()
            if not name:
                return JsonResponse({"detail": "name cannot be empty"}, status=400)
            script.name = name

        if "description" in data:
            script.description = data["description"].strip() or ""

        if "script_type" in data:
            script_type = data["script_type"]
            if script_type in [choice[0] for choice in ScriptTemplate.ScriptType.choices]:
                script.script_type = script_type

        if "threshold_config" in data:
            script.threshold_config = data["threshold_config"]

        if "schedule_config" in data:
            script.schedule_config = data["schedule_config"]

        if "python_code" in data:
            script.python_code = data["python_code"]

        if "command_template" in data:
            script.command_template = data["command_template"]

        if "is_active" in data:
            script.is_active = bool(data["is_active"])

        if "priority" in data:
            script.priority = int(data["priority"])

        # 更新设备关联
        if "device_ids" in data:
            device_ids = data["device_ids"]
            script.devices.set(device_ids)

        script.save()

        # 记录审计日志
        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_UPDATE,
            resource_type="script_template",
            resource_id=script.id,
            description=f"更新控制脚本：{script.name}",
            request=request,
        )

        return JsonResponse(_script_to_dict(script), status=200)

    def put(self, request, script_id: int):
        return self.patch(request, script_id)

    def delete(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        script.delete()

        # 记录审计日志
        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_DELETE,
            resource_type="script_template",
            resource_id=script_id,
            description=f"删除控制脚本：{script.name}",
            request=request,
        )

        return JsonResponse({"detail": "deleted", "id": script_id}, status=200)


# -------------------------
# Script Execution
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class ScriptExecutionListView(
    BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View
):
    """
    GET  /api/v2/scripts/<script_id>/executions?device_id=<id>&status=success
    POST /api/v2/scripts/<script_id>/execute

    POST body（手动执行）:
    {
      "device_ids": [1, 2, 3]  // 可选，默认使用脚本关联的所有设备
    }
    """

    def get(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        qs = ScriptExecution.objects.filter(script=script).order_by("-created_at")

        # 筛选
        device_id = request.GET.get("device_id")
        if device_id:
            qs = qs.filter(device_id=device_id)

        status = request.GET.get("status")
        if status:
            qs = qs.filter(status=status)

        limit = int(request.GET.get("limit", "50"))
        limit = max(1, min(limit, 500))

        items = [_execution_to_dict(x) for x in qs[:limit]]
        return JsonResponse({"count": len(items), "data": items}, status=200)

    def post(self, request, script_id: int):
        """手动执行脚本"""
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        if not script.is_active:
            return JsonResponse({"detail": "Script is not active."}, status=400)

        data = self.json_body(request)
        executor = ScriptExecutor()

        # 确定目标设备列表
        device_ids = data.get("device_ids", [])
        if device_ids:
            devices = Device.objects.filter(id__in=device_ids, is_active=True)
        else:
            devices = script.devices.filter(is_active=True)
            if not devices.exists():
                return JsonResponse(
                    {"detail": "No devices configured for this script"},
                    status=400
                )

        # 批量执行
        results = []
        for device in devices:
            execution = executor.execute_script(
                script,
                device,
                trigger_reason="manual",
                created_by=request.user if request.user.is_authenticated else None
            )
            results.append(_execution_to_dict(execution))

        # 记录审计日志
        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_EXECUTE,
            resource_type="script_execution",
            resource_id=script_id,
            description=f"手动执行脚本：{script.name}，设备数：{len(devices)}",
            request=request,
        )

        return JsonResponse(
            {
                "script_id": script_id,
                "script_name": script.name,
                "executed_count": len(results),
                "executions": results
            },
            status=201
        )


@method_decorator(csrf_exempt, name="dispatch")
class ScriptExecutionDetailView(
    BasicAuthMixin, StaffRequiredMixin, View
):
    """GET /api/v2/script-executions/<execution_id>"""

    def get(self, request, execution_id: int):
        try:
            execution = ScriptExecution.objects.get(id=execution_id)
        except ScriptExecution.DoesNotExist:
            return JsonResponse({"detail": "Execution not found."}, status=404)
        return JsonResponse(_execution_to_dict(execution), status=200)


# -------------------------
# Auto Control / Monitoring
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class AutoControlView(
    BasicAuthMixin, StaffRequiredMixin, View
):
    """
    POST /api/v2/scripts/check-and-execute
    POST /api/v2/scripts/check-thresholds

    检查所有阈值脚本并执行（由定时任务调用）
    """

    def post(self, request):
        """手动触发阈值检查"""
        monitor = ThresholdMonitor()
        results = monitor.check_and_execute_all()
        return JsonResponse(results, status=200)
