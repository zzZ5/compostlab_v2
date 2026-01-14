# Generated migration for announcement audit actions

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0002_alter_auditlog_action'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('login', '登录'),
                    ('logout', '登出'),
                    ('device_create', '创建设备'),
                    ('device_update', '更新设备'),
                    ('device_delete', '删除设备'),
                    ('channel_create', '创建通道'),
                    ('channel_update', '更新通道'),
                    ('channel_delete', '删除通道'),
                    ('run_create', '创建运行批次'),
                    ('run_update', '更新运行批次'),
                    ('run_delete', '删除运行批次'),
                    ('command_send', '发送命令'),
                    ('script_create', '创建脚本'),
                    ('script_update', '更新脚本'),
                    ('script_delete', '删除脚本'),
                    ('script_execute', '执行脚本'),
                    ('user_create', '创建用户'),
                    ('user_update', '更新用户'),
                    ('user_delete', '删除用户'),
                    ('user_enable', '启用用户'),
                    ('user_disable', '禁用用户'),
                    ('announcement_create', '创建公告'),
                    ('announcement_update', '更新公告'),
                    ('announcement_delete', '删除公告'),
                ],
                db_index=True,
                help_text='操作类型',
                max_length=50
            ),
        ),
    ]
