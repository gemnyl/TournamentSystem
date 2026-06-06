"""
Сервіс для розрахунку результатів та призових місць у категоріях.
"""

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import Category, Registration


def calculate_category_standings(category: Category, persist: bool = False):
    """
    Розраховує результати для категорії відповідно до формату сітки.
    Повертає список словників зі статистикою та місцями для кожного учасника.

    Якщо persist=True, зберігає розраховані місця (1, 2, 3) у базу даних для моделі Registration.
    """
    registrations = list(
        Registration.objects.filter(
            category=category, status=Registration.Status.CONFIRMED
        ).select_related("athlete", "athlete__club")
    )

    matches = list(Match.objects.filter(category=category))
    completed_matches = [m for m in matches if m.status == Match.Status.COMPLETED]

    # Ініціалізація базової статистики
    stats = {}
    for r in registrations:
        stats[r.id] = {
            "registration": r,
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "points": 0,
            "scores_scored": 0,
            "scores_conceded": 0,
            "place": None,
        }

    # Розрахунок базової статистики на основі завершених сутичок
    for m in completed_matches:
        reg_first_id = m.reg_first_id
        reg_second_id = m.reg_second_id

        # Накопичення балів (для Ката використовуємо прапори)
        score_first = m.flags_aka if category.ruleset_key == "karate_kata" else m.score_first
        score_second = m.flags_ao if category.ruleset_key == "karate_kata" else m.score_second

        score_first = score_first or 0
        score_second = score_second or 0

        if reg_first_id in stats:
            stats[reg_first_id]["scores_scored"] += score_first
            stats[reg_first_id]["scores_conceded"] += score_second
        if reg_second_id in stats:
            stats[reg_second_id]["scores_scored"] += score_second
            stats[reg_second_id]["scores_conceded"] += score_first

        # Визначення переможця / нічиєї
        if m.win_method == Match.WinMethod.DRAW:
            if reg_first_id in stats:
                stats[reg_first_id]["draws"] += 1
                stats[reg_first_id]["points"] += 1
            if reg_second_id in stats:
                stats[reg_second_id]["draws"] += 1
                stats[reg_second_id]["points"] += 1
        elif m.winner_id:
            w_id = m.winner_id
            l_id = reg_second_id if w_id == reg_first_id else reg_first_id

            if w_id in stats:
                stats[w_id]["wins"] += 1
                stats[w_id]["points"] += 3
            if l_id in stats:
                stats[l_id]["losses"] += 1

    if category.bracket_format == Category.BracketFormat.SINGLE_ELIMINATION:
        # Для олімпійської сітки розраховуємо місця на основі дерева матчів
        # 1. Знаходимо фінальний поєдинок (next_match is None та максимальний round_index)
        final_match = None
        for m in matches:
            if m.next_match_id is None:
                if final_match is None or m.round_index > final_match.round_index:
                    final_match = m

        if final_match and final_match.status == Match.Status.COMPLETED:
            winner_id = final_match.winner_id
            loser_id = (
                final_match.reg_second_id
                if winner_id == final_match.reg_first_id
                else final_match.reg_first_id
            )

            if winner_id in stats:
                stats[winner_id]["place"] = 1
            if loser_id in stats:
                stats[loser_id]["place"] = 2

            # 2. Знаходимо півфінальні матчі (їх next_match — це фінал)
            semi_final_matches = [m for m in matches if m.next_match_id == final_match.id]
            semi_losers = []
            for sf in semi_final_matches:
                if sf.status == Match.Status.COMPLETED and sf.winner_id:
                    sf_winner = sf.winner_id
                    sf_loser = sf.reg_second_id if sf_winner == sf.reg_first_id else sf.reg_first_id
                    if sf_loser in stats:
                        semi_losers.append(sf_loser)

            if len(semi_losers) > 0:
                if category.two_third_places:
                    for sl in semi_losers:
                        stats[sl]["place"] = 3
                else:
                    # Сортуємо тих, хто програв у півфіналах, за очками, перемогами, різницею балів
                    def loser_sort_key(r_id):
                        s = stats[r_id]
                        return (
                            s["points"],
                            s["wins"],
                            s["scores_scored"] - s["scores_conceded"],
                            s["scores_scored"],
                        )

                    semi_losers.sort(key=loser_sort_key, reverse=True)
                    stats[semi_losers[0]]["place"] = 3
                    if len(semi_losers) > 1:
                        stats[semi_losers[1]]["place"] = 5

        # Сортуємо: спочатку призові місця (1, 2, 3), потім за очками/перемогами
        sorted_results = []
        # Розділяємо на тих, у кого є місце, і тих, у кого немає
        placed = []
        unplaced = []
        for s in stats.values():
            if s["place"] is not None:
                placed.append(s)
            else:
                unplaced.append(s)

        # Сортуємо призові місця за зростанням місця (1, 2, 3)
        placed.sort(key=lambda x: x["place"])

        # Сортуємо інших за очками та перемогами для красивого відображення
        unplaced.sort(key=lambda x: (x["points"], x["wins"]), reverse=True)
        sorted_results = placed + unplaced

    elif category.bracket_format == Category.BracketFormat.ROUND_ROBIN:
        # Для кругової сітки групуємо учасників за (очки, перемоги) для tie-break зустрічей
        groups = {}
        for r_id, s in stats.items():
            key = (s["points"], s["wins"])
            groups.setdefault(key, []).append(r_id)

        # Сортуємо групи за спаданням очок та перемог
        sorted_group_keys = sorted(groups.keys(), key=lambda x: (x[0], x[1]), reverse=True)

        sorted_ids = []
        for key in sorted_group_keys:
            group_ids = groups[key]
            if len(group_ids) == 1:
                sorted_ids.append(group_ids[0])
            elif len(group_ids) == 2:
                # Рівно 2 учасники ділять місце. Особиста зустріч має пріоритет
                id1, id2 = group_ids
                h2h = [
                    m
                    for m in completed_matches
                    if (m.reg_first_id == id1 and m.reg_second_id == id2)
                    or (m.reg_first_id == id2 and m.reg_second_id == id1)
                ]
                id1_won = False
                id2_won = False
                if h2h:
                    m = h2h[0]
                    if m.winner_id == id1:
                        id1_won = True
                    elif m.winner_id == id2:
                        id2_won = True

                if id1_won:
                    sorted_ids.extend([id1, id2])
                elif id2_won:
                    sorted_ids.extend([id2, id1])
                else:
                    # Нічия або не зіграно. Порівнюємо різницю балів та набрані бали
                    def score_key(r_id):
                        s = stats[r_id]
                        return (s["scores_scored"] - s["scores_conceded"], s["scores_scored"])

                    sub_sorted = sorted(group_ids, key=score_key, reverse=True)
                    sorted_ids.extend(sub_sorted)
            else:
                # 3 або більше учасників. Особисті зустрічі циклічні.
                # Порівнюємо різницю балів, потім набрані бали.
                def score_key(r_id):
                    s = stats[r_id]
                    return (s["scores_scored"] - s["scores_conceded"], s["scores_scored"])

                sub_sorted = sorted(group_ids, key=score_key, reverse=True)
                sorted_ids.extend(sub_sorted)

        # Присвоюємо місця (1, 2, 3) для перших трьох учасників
        for idx, r_id in enumerate(sorted_ids):
            place = idx + 1
            if place <= 3:
                stats[r_id]["place"] = place
            else:
                stats[r_id]["place"] = None

        sorted_results = [stats[r_id] for r_id in sorted_ids]
    else:
        sorted_results = list(stats.values())

    if persist:
        with transaction.atomic():
            # Очищуємо старі місця в цій категорії
            Registration.objects.filter(category=category).update(place=None)
            # Записуємо нові призові місця
            for item in sorted_results:
                if item["place"] is not None:
                    Registration.objects.filter(id=item["registration"].id).update(
                        place=item["place"]
                    )

    return sorted_results
