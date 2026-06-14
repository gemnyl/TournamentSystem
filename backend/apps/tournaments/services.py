"""
Сервіс для розрахунку результатів та призових місць у категоріях.
"""

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import Category, Registration


def _calculate_basic_stats(
    category: Category, registrations: list[Registration], matches: list[Match]
) -> dict[int, dict]:
    completed_matches = [
        m for m in matches if m.status == Match.Status.COMPLETED and m.parent_team_match_id is None
    ]
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

    for m in completed_matches:
        reg_first_id = m.reg_first_id
        reg_second_id = m.reg_second_id

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
    return stats


def _find_final_match(matches: list[Match]) -> Match | None:
    final_match = None
    for m in matches:
        if m.next_match_id is None:
            if final_match is None or m.round_index > final_match.round_index:
                final_match = m
    return final_match


def _loser_sort_key(r_id: int, stats: dict[int, dict]) -> tuple:
    s = stats[r_id]
    return (
        s["points"],
        s["wins"],
        s["scores_scored"] - s["scores_conceded"],
        s["scores_scored"],
    )


def _get_semi_losers(
    final_match_id: int, matches: list[Match], stats: dict[int, dict]
) -> list[int]:
    semi_final_matches = [m for m in matches if m.next_match_id == final_match_id]
    semi_losers = []
    for sf in semi_final_matches:
        if sf.status == Match.Status.COMPLETED and sf.winner_id:
            sf_winner = sf.winner_id
            sf_loser = sf.reg_second_id if sf_winner == sf.reg_first_id else sf.reg_first_id
            if sf_loser in stats:
                semi_losers.append(sf_loser)
    return semi_losers


def _assign_semi_losers_places(
    final_match_id: int, matches: list[Match], category: Category, stats: dict[int, dict]
) -> None:
    semi_losers = _get_semi_losers(final_match_id, matches, stats)
    if not semi_losers:
        return

    if category.two_third_places:
        for sl in semi_losers:
            stats[sl]["place"] = 3
    else:
        semi_losers.sort(key=lambda r_id: _loser_sort_key(r_id, stats), reverse=True)
        stats[semi_losers[0]]["place"] = 3
        if len(semi_losers) > 1:
            stats[semi_losers[1]]["place"] = 5


def _assign_top_places_single_elimination(
    final_match: Match, matches: list[Match], category: Category, stats: dict[int, dict]
) -> None:
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

    _assign_semi_losers_places(final_match.id, matches, category, stats)


def _calculate_single_elimination_standings(
    category: Category, matches: list[Match], stats: dict[int, dict]
) -> list[dict]:
    final_match = _find_final_match(matches)

    if final_match and final_match.status == Match.Status.COMPLETED:
        _assign_top_places_single_elimination(final_match, matches, category, stats)

    placed = []
    unplaced = []
    for s in stats.values():
        if s["place"] is not None:
            placed.append(s)
        else:
            unplaced.append(s)

    placed.sort(key=lambda x: x["place"])
    unplaced.sort(key=lambda x: (x["points"], x["wins"]), reverse=True)
    return placed + unplaced


def _find_h2h_match(id1: int, id2: int, completed_matches: list[Match]) -> Match | None:
    for m in completed_matches:
        if (m.reg_first_id == id1 and m.reg_second_id == id2) or (
            m.reg_first_id == id2 and m.reg_second_id == id1
        ):
            return m
    return None


def _resolve_round_robin_group(
    group_ids: list[int], completed_matches: list[Match], stats: dict[int, dict]
) -> list[int]:
    if len(group_ids) == 1:
        return group_ids
    if len(group_ids) == 2:
        id1, id2 = group_ids
        h2h = _find_h2h_match(id1, id2, completed_matches)
        if h2h and h2h.winner_id in (id1, id2):
            if h2h.winner_id == id1:
                return [id1, id2]
            else:
                return [id2, id1]

    def score_key(r_id):
        s = stats[r_id]
        return (s["scores_scored"] - s["scores_conceded"], s["scores_scored"])

    return sorted(group_ids, key=score_key, reverse=True)


def _calculate_round_robin_standings(matches: list[Match], stats: dict[int, dict]) -> list[dict]:
    completed_matches = [m for m in matches if m.status == Match.Status.COMPLETED]
    groups = {}
    for r_id, s in stats.items():
        key = (s["points"], s["wins"])
        groups.setdefault(key, []).append(r_id)

    sorted_group_keys = sorted(groups.keys(), key=lambda x: (x[0], x[1]), reverse=True)

    sorted_ids = []
    for key in sorted_group_keys:
        sorted_ids.extend(_resolve_round_robin_group(groups[key], completed_matches, stats))

    for idx, r_id in enumerate(sorted_ids):
        place = idx + 1
        stats[r_id]["place"] = place if place <= 3 else None

    return [stats[r_id] for r_id in sorted_ids]


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
    stats = _calculate_basic_stats(category, registrations, matches)

    if category.bracket_format == Category.BracketFormat.SINGLE_ELIMINATION:
        sorted_results = _calculate_single_elimination_standings(category, matches, stats)
    elif category.bracket_format == Category.BracketFormat.ROUND_ROBIN:
        sorted_results = _calculate_round_robin_standings(matches, stats)
    else:
        sorted_results = list(stats.values())

    if persist:
        with transaction.atomic():
            Registration.objects.filter(category=category).update(place=None)
            for item in sorted_results:
                if item["place"] is not None:
                    Registration.objects.filter(id=item["registration"].id).update(
                        place=item["place"]
                    )

    return sorted_results
