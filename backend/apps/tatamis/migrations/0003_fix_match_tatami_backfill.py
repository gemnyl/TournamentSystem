"""
Data migration: виправляємо match.tatami для існуючих записів.

Проблема: при assign_match раніше встановлювався лише tatami.current_match,
але НЕ match.tatami. Через це broadcast_match_event не міг знайти tatami group
і повідомлення ніколи не доходили до Scoreboard.

Ця міграція: для кожного Tatami з current_match != null встановлює
current_match.tatami = tatami.
"""

from django.db import migrations


def backfill_match_tatami(apps, schema_editor):
    Tatami = apps.get_model("tatamis", "Tatami")

    updated = 0
    for tatami in Tatami.objects.select_related("current_match").filter(
        current_match__isnull=False
    ):
        match = tatami.current_match
        if match.tatami_id != tatami.pk:
            match.tatami_id = tatami.pk
            match.save(update_fields=["tatami_id"])
            updated += 1

    print(f"\n  [backfill_match_tatami] Оновлено {updated} матч(ів).")


def reverse_backfill(apps, schema_editor):
    # Скасування: обнулити tatami_id для матчів що є current_match татамі
    Tatami = apps.get_model("tatamis", "Tatami")
    for tatami in Tatami.objects.select_related("current_match").filter(
        current_match__isnull=False
    ):
        match = tatami.current_match
        match.tatami_id = None
        match.save(update_fields=["tatami_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("tatamis", "0002_tatami_assigned_judge"),
        ("matches", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill_match_tatami, reverse_code=reverse_backfill),
    ]
