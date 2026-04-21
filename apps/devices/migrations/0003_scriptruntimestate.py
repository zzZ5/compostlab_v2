from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("devices", "0002_device_registration_fields"),
        ("devices", "0002_scripttemplate_scriptexecution_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScriptRuntimeState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("state", models.JSONField(blank=True, default=dict, help_text="脚本持久变量")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "device",
                    models.ForeignKey(
                        help_text="状态绑定设备",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="script_runtime_states",
                        to="devices.device",
                    ),
                ),
                (
                    "script",
                    models.ForeignKey(
                        help_text="所属脚本",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="runtime_states",
                        to="devices.scripttemplate",
                    ),
                ),
            ],
            options={
                "db_table": "devices_scriptruntimestate",
                "ordering": ["script_id", "device_id"],
            },
        ),
        migrations.AddConstraint(
            model_name="scriptruntimestate",
            constraint=models.UniqueConstraint(
                fields=("script", "device"),
                name="uq_script_runtime_state_script_device",
            ),
        ),
        migrations.AddIndex(
            model_name="scriptruntimestate",
            index=models.Index(fields=["script", "device"], name="devices_scr_script__c90932_idx"),
        ),
        migrations.AddIndex(
            model_name="scriptruntimestate",
            index=models.Index(fields=["device", "updated_at"], name="devices_scr_device__df21f4_idx"),
        ),
    ]
