import base64
import json

from django.contrib.auth import authenticate
from django.http import JsonResponse


class BasicAuthMixin:
    """
    HTTP Basic Auth:
      Authorization: Basic base64(username:password)
    """

    def dispatch(self, request, *args, **kwargs):
        auth = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth.startswith("Basic "):
            return JsonResponse(
                {"detail": "Authentication required (Basic)."},
                status=401,
                headers={"WWW-Authenticate": 'Basic realm="CompostLab API"'},
            )

        try:
            b64 = auth.split(" ", 1)[1].strip()
            raw = base64.b64decode(b64).decode("utf-8")
            username, password = raw.split(":", 1)
        except Exception:
            return JsonResponse({"detail": "Invalid Authorization header."}, status=401)

        user = authenticate(username=username, password=password)
        if not user:
            return JsonResponse(
                {"detail": "Invalid username or password."},
                status=401,
                headers={"WWW-Authenticate": 'Basic realm="CompostLab API"'},
            )

        request.user = user
        return super().dispatch(request, *args, **kwargs)


class StaffRequiredMixin:
    """
    写接口只允许管理员（is_staff）。
    """

    def dispatch(self, request, *args, **kwargs):
        if not getattr(request, "user", None) or not request.user.is_staff:
            return JsonResponse({"detail": "Admin permission required."}, status=403)
        return super().dispatch(request, *args, **kwargs)


class JsonBodyMixin:
    """
    解析 JSON body，失败返回 400
    """

    def json_body(self, request):
        if not request.body:
            return {}
        try:
            return json.loads(request.body.decode("utf-8"))
        except Exception:
            raise ValueError("Invalid JSON body.")
