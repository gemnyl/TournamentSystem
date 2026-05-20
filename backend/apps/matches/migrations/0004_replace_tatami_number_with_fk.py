import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("matches", "0003_add_match_event"),
        ("tatamis", "0001_initial"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="match",
            name="tatami_number",
        ),
        migrations.AddField(
            model_name="match",
            name="tatami",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="tatami_matches",
                to="tatamis.tatami",
                verbose_name="Татамі",
            ),
        ),
    ]
