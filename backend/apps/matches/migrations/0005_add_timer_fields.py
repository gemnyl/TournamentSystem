from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("matches", "0004_replace_tatami_number_with_fk"),
    ]

    operations = [
        migrations.AddField(
            model_name="match",
            name="timer_status",
            field=models.CharField(
                choices=[
                    ("not_started", "Not started"),
                    ("running", "Running"),
                    ("paused", "Paused"),
                    ("finished", "Finished"),
                ],
                default="not_started",
                max_length=15,
                verbose_name="Статус таймера",
            ),
        ),
        migrations.AddField(
            model_name="match",
            name="timer_started_at",
            field=models.DateTimeField(
                blank=True, null=True, verbose_name="Таймер запущено о"
            ),
        ),
        migrations.AddField(
            model_name="match",
            name="timer_elapsed_ms",
            field=models.PositiveIntegerField(default=0, verbose_name="Накопичено мс"),
        ),
        migrations.AddField(
            model_name="match",
            name="timer_duration_ms",
            field=models.PositiveIntegerField(default=180000, verbose_name="Тривалість мс"),
        ),
    ]
