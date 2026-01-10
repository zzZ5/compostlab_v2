from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("devices", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ControlTemplate",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.CharField(max_length=128)),
                (
                    "description",
                    models.CharField(max_length=256, blank=True, default=""),
                ),
                ("payload", models.JSONField(default=dict)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "device",
                    models.ForeignKey(
                        related_name="control_templates",
                        on_delete=django.db.models.deletion.CASCADE,
                        blank=True,
                        to="devices.Device",
                        null=True,
                        help_text="关联设备（可选）",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        related_name="control_templates",
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                        null=True,
                        blank=True,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["device", "is_active"]),
                    models.Index(fields=["is_active"]),
                ],
            },
        ),
    ]
