"""
Модуль для розрахунку статистики турніру та глобальних рейтингів областей і клубів.
"""

from django.db.models import Avg, Count, Q

from apps.accounts.models import UKRAINIAN_REGIONS
from apps.matches.models import Match
from apps.tournaments.models import Category, Registration


def get_tournament_statistics(tournament_id):
    """
    Обчислює та повертає статистику конкретного турніру:
    - Медальний залік клубів
    - Медальний залік областей
    - Загальну статистику (учасники, гендерний розподіл, категорії)
    - Статистику матчів (тривалість, типи перемог)
    """
    # Завантажуємо всі підтверджені заявки з необхідними зв'язками
    registrations = list(
        Registration.objects.filter(
            category__tournament_id=tournament_id, status=Registration.Status.CONFIRMED
        )
        .select_related("athlete", "athlete__club", "team", "team__club", "category")
        .prefetch_related("team__athletes")
    )

    region_map = dict(UKRAINIAN_REGIONS)

    club_standings = {}
    region_standings = {
        code: {
            "region_code": code,
            "region_name": name,
            "gold": 0,
            "silver": 0,
            "bronze": 0,
            "total_medals": 0,
            "points": 0,
            "athletes_count": set(),
            "clubs_count": set(),
        }
        for code, name in UKRAINIAN_REGIONS
    }

    # Заповнюємо медальний залік
    for reg in registrations:
        club = None
        if reg.category.is_team and reg.team:
            club = reg.team.club
        elif not reg.category.is_team and reg.athlete:
            club = reg.athlete.club

        if club:
            # Ініціалізація клубу в статистиці
            if club.id not in club_standings:
                club_standings[club.id] = {
                    "club_id": club.id,
                    "club_name": club.name,
                    "region": club.region,
                    "region_name": region_map.get(club.region, club.region or "Невідомий регіон"),
                    "gold": 0,
                    "silver": 0,
                    "bronze": 0,
                    "total_medals": 0,
                    "points": 0,
                    "athletes_count": set(),
                }

            # Додаємо спортсменів до клубу (унікальність за id)
            if reg.athlete_id:
                club_standings[club.id]["athletes_count"].add(reg.athlete_id)
            elif reg.team_id:
                for ath in reg.team.athletes.all():
                    club_standings[club.id]["athletes_count"].add(ath.id)

            # Нараховуємо медалі та бали
            if reg.place == 1:
                club_standings[club.id]["gold"] += 1
                club_standings[club.id]["points"] += 7
            elif reg.place == 2:
                club_standings[club.id]["silver"] += 1
                club_standings[club.id]["points"] += 5
            elif reg.place == 3:
                club_standings[club.id]["bronze"] += 1
                club_standings[club.id]["points"] += 3

            # Обласна статистика
            region_code = club.region or "unknown"
            if region_code not in region_standings:
                region_standings[region_code] = {
                    "region_code": region_code,
                    "region_name": region_map.get(region_code, "Невідомий регіон"),
                    "gold": 0,
                    "silver": 0,
                    "bronze": 0,
                    "total_medals": 0,
                    "points": 0,
                    "athletes_count": set(),
                    "clubs_count": set(),
                }

            region_standings[region_code]["clubs_count"].add(club.id)
            if reg.athlete_id:
                region_standings[region_code]["athletes_count"].add(reg.athlete_id)
            elif reg.team_id:
                for ath in reg.team.athletes.all():
                    region_standings[region_code]["athletes_count"].add(ath.id)

            if reg.place == 1:
                region_standings[region_code]["gold"] += 1
                region_standings[region_code]["points"] += 7
            elif reg.place == 2:
                region_standings[region_code]["silver"] += 1
                region_standings[region_code]["points"] += 5
            elif reg.place == 3:
                region_standings[region_code]["bronze"] += 1
                region_standings[region_code]["points"] += 3

    # Приводимо набори спортсменів/клубів до чисел (кількості)
    for cs in club_standings.values():
        cs["athletes_count"] = len(cs["athletes_count"])
        cs["total_medals"] = cs["gold"] + cs["silver"] + cs["bronze"]

    for rs in region_standings.values():
        rs["athletes_count"] = len(rs["athletes_count"])
        rs["clubs_count"] = len(rs["clubs_count"])
        rs["total_medals"] = rs["gold"] + rs["silver"] + rs["bronze"]

    # Сортування медального заліку
    sorted_club_standings = sorted(
        club_standings.values(),
        key=lambda x: (-x["gold"], -x["silver"], -x["bronze"], -x["points"], x["club_name"]),
    )

    sorted_region_standings = sorted(
        region_standings.values(),
        key=lambda x: (-x["gold"], -x["silver"], -x["bronze"], -x["points"], x["region_name"]),
    )

    # Загальна статистика турніру
    unique_athletes = set()
    unique_clubs = set()
    unique_regions = set()
    all_athlete_genders = []

    for reg in registrations:
        club = None
        if reg.category.is_team and reg.team:
            club = reg.team.club
        elif not reg.category.is_team and reg.athlete:
            club = reg.athlete.club

        if club:
            unique_clubs.add(club.id)
            if club.region:
                unique_regions.add(club.region)

        if reg.athlete_id:
            if reg.athlete_id not in unique_athletes:
                unique_athletes.add(reg.athlete_id)
                all_athlete_genders.append(reg.athlete.gender)
        elif reg.team_id:
            for ath in reg.team.athletes.all():
                if ath.id not in unique_athletes:
                    unique_athletes.add(ath.id)
                    all_athlete_genders.append(ath.gender)

    total_athletes = len(unique_athletes)
    male_count = all_athlete_genders.count("male")
    female_count = all_athlete_genders.count("female")
    total_genders = len(all_athlete_genders)

    gender_split = {
        "male": {
            "count": male_count,
            "percentage": round((male_count / total_genders * 100), 1) if total_genders > 0 else 0,
        },
        "female": {
            "count": female_count,
            "percentage": round((female_count / total_genders * 100), 1)
            if total_genders > 0
            else 0,
        },
    }

    # Розподіл по категоріях
    category_split = []
    categories = Category.objects.filter(tournament_id=tournament_id).annotate(
        confirmed_count=Count(
            "registrations", filter=Q(registrations__status=Registration.Status.CONFIRMED)
        )
    )
    for cat in categories:
        category_split.append(
            {"category_id": cat.id, "category_name": cat.name, "count": cat.confirmed_count}
        )

    # Статистика поєдинків (виключаємо технічні автопроходи BYE)
    matches = Match.objects.filter(
        category__tournament_id=tournament_id,
        reg_first__isnull=False,
        reg_second__isnull=False,
    )
    total_matches = matches.count()
    completed_matches = matches.filter(status=Match.Status.COMPLETED)
    completed_matches_count = completed_matches.count()

    # Беремо поєдинки без parent_team_match, щоб не подвоювати статистику
    completed_bouts = completed_matches.filter(parent_team_match__isnull=True)

    win_method_counts = {}
    win_method_display = {
        "decision": "Рішенням суддів (Hantei)",
        "disqualification": "Дискваліфікація (Hansoku)",
        "walkover": "Неявка (Kiken)",
        "withdrawal": "Відмова (Shikaku)",
        "points": "По балах",
        "draw": "Нічия",
        "ippon": "Іппон (Shobu Ippon)",
        "waza_ari": "Ваза-арі",
        "hansoku": "Дискваліфікація (Hansoku)",
        "kiken": "Неявка (Kiken)",
        "shikaku": "Зняття (Shikaku)",
    }

    for m in completed_bouts:
        method = m.win_method or "points"
        win_method_counts[method] = win_method_counts.get(method, 0) + 1

    formatted_win_methods = [
        {
            "method": method,
            "label": win_method_display.get(method, method.capitalize()),
            "count": count,
        }
        for method, count in win_method_counts.items()
    ]

    # Середня тривалість поєдинків
    avg_duration_ms = completed_bouts.aggregate(avg_dur=Avg("timer_elapsed_ms"))["avg_dur"] or 0
    avg_duration_seconds = round(avg_duration_ms / 1000)

    match_stats = {
        "total_matches": total_matches,
        "completed_matches": completed_matches_count,
        "average_duration_seconds": avg_duration_seconds,
        "win_methods": formatted_win_methods,
    }

    return {
        "club_standings": sorted_club_standings,
        "region_standings": sorted_region_standings,
        "general_stats": {
            "total_athletes": total_athletes,
            "total_clubs": len(unique_clubs),
            "total_regions": len(unique_regions),
            "gender_split": gender_split,
            "category_split": category_split,
        },
        "match_stats": match_stats,
    }


def get_global_ratings():
    """
    Обчислює та повертає глобальні рейтинги областей та клубів за всю історію.
    Враховуються тільки підтверджені призові місця (1, 2, 3) у CONFIRMED реєстраціях.
    """
    registrations = list(
        Registration.objects.filter(place__isnull=False, status=Registration.Status.CONFIRMED)
        .select_related(
            "athlete", "athlete__club", "team", "team__club", "category", "category__tournament"
        )
        .prefetch_related("team__athletes")
    )

    region_map = dict(UKRAINIAN_REGIONS)

    club_ratings = {}
    region_ratings = {
        code: {
            "region_code": code,
            "region_name": name,
            "gold": 0,
            "silver": 0,
            "bronze": 0,
            "total_medals": 0,
            "points": 0,
            "athletes_count": set(),
            "clubs_count": set(),
            "tournaments_count": set(),
        }
        for code, name in UKRAINIAN_REGIONS
    }

    for reg in registrations:
        club = None
        if reg.category.is_team and reg.team:
            club = reg.team.club
        elif not reg.category.is_team and reg.athlete:
            club = reg.athlete.club

        if club:
            # Клубний рейтинг
            if club.id not in club_ratings:
                club_ratings[club.id] = {
                    "club_id": club.id,
                    "club_name": club.name,
                    "region": club.region,
                    "region_name": region_map.get(club.region, club.region or "Невідомий регіон"),
                    "gold": 0,
                    "silver": 0,
                    "bronze": 0,
                    "total_medals": 0,
                    "points": 0,
                    "athletes_count": set(),
                    "tournaments_count": set(),
                }

            if reg.athlete_id:
                club_ratings[club.id]["athletes_count"].add(reg.athlete_id)
            elif reg.team_id:
                for ath in reg.team.athletes.all():
                    club_ratings[club.id]["athletes_count"].add(ath.id)

            club_ratings[club.id]["tournaments_count"].add(reg.category.tournament_id)

            if reg.place == 1:
                club_ratings[club.id]["gold"] += 1
                club_ratings[club.id]["points"] += 7
            elif reg.place == 2:
                club_ratings[club.id]["silver"] += 1
                club_ratings[club.id]["points"] += 5
            elif reg.place == 3:
                club_ratings[club.id]["bronze"] += 1
                club_ratings[club.id]["points"] += 3

            # Обласний рейтинг
            region_code = club.region or "unknown"
            if region_code not in region_ratings:
                region_ratings[region_code] = {
                    "region_code": region_code,
                    "region_name": region_map.get(region_code, "Невідомий регіон"),
                    "gold": 0,
                    "silver": 0,
                    "bronze": 0,
                    "total_medals": 0,
                    "points": 0,
                    "athletes_count": set(),
                    "clubs_count": set(),
                    "tournaments_count": set(),
                }

            region_ratings[region_code]["clubs_count"].add(club.id)
            region_ratings[region_code]["tournaments_count"].add(reg.category.tournament_id)

            if reg.athlete_id:
                region_ratings[region_code]["athletes_count"].add(reg.athlete_id)
            elif reg.team_id:
                for ath in reg.team.athletes.all():
                    region_ratings[region_code]["athletes_count"].add(ath.id)

            if reg.place == 1:
                region_ratings[region_code]["gold"] += 1
                region_ratings[region_code]["points"] += 7
            elif reg.place == 2:
                region_ratings[region_code]["silver"] += 1
                region_ratings[region_code]["points"] += 5
            elif reg.place == 3:
                region_ratings[region_code]["bronze"] += 1
                region_ratings[region_code]["points"] += 3

    # Приведення множин до числових значень
    for cs in club_ratings.values():
        cs["athletes_count"] = len(cs["athletes_count"])
        cs["tournaments_count"] = len(cs["tournaments_count"])
        cs["total_medals"] = cs["gold"] + cs["silver"] + cs["bronze"]

    for rs in region_ratings.values():
        rs["athletes_count"] = len(rs["athletes_count"])
        rs["clubs_count"] = len(rs["clubs_count"])
        rs["tournaments_count"] = len(rs["tournaments_count"])
        rs["total_medals"] = rs["gold"] + rs["silver"] + rs["bronze"]

    # Сортування
    sorted_club_ratings = sorted(
        club_ratings.values(),
        key=lambda x: (-x["gold"], -x["silver"], -x["bronze"], -x["points"], x["club_name"]),
    )

    sorted_region_ratings = sorted(
        region_ratings.values(),
        key=lambda x: (-x["gold"], -x["silver"], -x["bronze"], -x["points"], x["region_name"]),
    )

    return {
        "club_ratings": sorted_club_ratings,
        "region_ratings": sorted_region_ratings,
    }
