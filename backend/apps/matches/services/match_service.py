from dataclasses import replace

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.matches.models import Match, MatchEvent
from apps.rulesets.base import MatchState, ScoreEvent


def _broadcast_timer(match: Match) -> None:
    from apps.common.broadcast import broadcast_timer_state

    transaction.on_commit(lambda: broadcast_timer_state(match))


class MatchService:
    """Координує зміни стану матчу: ruleset → MatchEvent → Match."""

    def __init__(self, match: Match):
        self.match = match
        self._ruleset = None

    @property
    def ruleset(self):
        if self._ruleset is None:
            from apps.rulesets.registry import get_ruleset

            self._ruleset = get_ruleset(self.match.category.ruleset_key)
        return self._ruleset

    def _build_state(self) -> MatchState:
        m = self.match
        return MatchState(
            score_aka=m.score_first,
            score_ao=m.score_second,
            warnings_aka=m.warnings_first,
            warnings_ao=m.warnings_second,
            senshu=m.senshu,
            flags_aka=m.flags_aka,
            flags_ao=m.flags_ao,
            judges_count=m.judges_count,
        )

    def _next_sequence(self) -> int:
        agg = self.match.events.aggregate(Max("sequence"))
        return (agg["sequence__max"] or 0) + 1

    def _write_event(self, event_type: str, payload: dict, judge=None) -> MatchEvent:
        return MatchEvent.objects.create(
            match=self.match,
            sequence=self._next_sequence(),
            event_type=event_type,
            payload=payload,
            judge=judge,
        )

    @transaction.atomic
    def apply_score(self, corner: str, action_key: str, judge=None, is_undo=False) -> Match:
        """Застосовує ігрову подію (бал або попередження) через активний рулсет або скасовує її."""
        m = self.match
        if m.status == Match.Status.COMPLETED and not is_undo:
            raise ValueError("Поєдинок вже завершено.")

        if corner not in ("aka", "ao"):
            raise ValueError(f"Invalid corner: '{corner}'. Must be 'aka' or 'ao'.")

        actions = {a.key: a for a in self.ruleset.get_score_actions()}
        action = actions.get(action_key)
        if action is None:
            raise ValueError(f"Unknown action_key: '{action_key}'.")

        if is_undo:
            return self._apply_score_undo(corner, action_key, action, judge)
        else:
            return self._apply_score_normal(corner, action_key, action, judge)

    def _apply_score_undo(self, corner: str, action_key: str, action, judge) -> Match:
        m = self.match
        if action.is_warning:
            if corner == "aka":
                m.warnings_first = max(0, m.warnings_first - 1)
            else:
                m.warnings_second = max(0, m.warnings_second - 1)
        else:
            if corner == "aka":
                m.score_first = max(0, m.score_first - action.points)
            else:
                m.score_second = max(0, m.score_second - action.points)

        update_fields = [
            "score_first",
            "score_second",
            "warnings_first",
            "warnings_second",
        ]

        # Автоматичне скидання сеншу для WKF при обнуленні рахунку
        if m.category.ruleset_key == "karate_wkf" and m.senshu == corner:
            if m.score_first == 0 and m.score_second == 0:
                m.senshu = Match.Senshu.NONE
                update_fields.append("senshu")
            self._clear_winner_from_next_match()

            m.status = Match.Status.ONGOING
            m.winner = None
            m.win_method = ""
            m.completed_at = None
            update_fields += ["status", "winner", "win_method", "completed_at"]

        m.save(update_fields=update_fields)

        event_type = (
            MatchEvent.EventType.WARNING if action.is_warning else MatchEvent.EventType.SCORE
        )
        self._write_event(
            event_type, {"corner": corner, "action_key": action_key, "is_undo": True}, judge
        )

        return m

    def _apply_score_normal(self, corner: str, action_key: str, action, judge) -> Match:
        m = self.match
        state = self._build_state()
        score_event = ScoreEvent(corner=corner, action_key=action_key)
        new_state = self.ruleset.apply_score_event(state, score_event)

        # Автоматичне призначення сеншу для карате WKF за перший набраний бал
        if m.category.ruleset_key == "karate_wkf" and state.senshu == "none":
            actions = {a.key: a for a in self.ruleset.get_score_actions()}
            act = actions.get(action_key)
            if act and not act.is_warning and act.points > 0:
                if state.score_aka == 0 and state.score_ao == 0:
                    new_state = replace(new_state, senshu=corner)

        new_state = self.ruleset.check_auto_finish(new_state)

        m.score_first = new_state.score_aka
        m.score_second = new_state.score_ao
        m.warnings_first = new_state.warnings_aka
        m.warnings_second = new_state.warnings_ao

        old_senshu = m.senshu
        m.senshu = new_state.senshu

        if m.status == Match.Status.SCHEDULED:
            m.status = Match.Status.ONGOING

        if m.parent_team_match and m.parent_team_match.status == Match.Status.SCHEDULED:
            m.parent_team_match.status = Match.Status.ONGOING
            m.parent_team_match.save(update_fields=["status"])
            from apps.common.broadcast import broadcast_match_update

            broadcast_match_update(m.parent_team_match)

        update_fields = [
            "score_first",
            "score_second",
            "warnings_first",
            "warnings_second",
            "status",
        ]
        if m.senshu != old_senshu:
            update_fields.append("senshu")

        if new_state.is_finished:
            winner_reg = m.reg_first if new_state.winner == "aka" else m.reg_second
            m.winner = winner_reg
            m.win_method = new_state.win_method
            m.status = Match.Status.COMPLETED
            m.completed_at = timezone.now()

            # Примусово зупиняємо таймер при авто-завершенні
            m.timer_status = Match.TimerStatus.PAUSED
            m.timer_started_at = None
            update_fields += [
                "winner",
                "win_method",
                "completed_at",
                "timer_status",
                "timer_started_at",
            ]

            m.save(update_fields=update_fields)
            m.advance_participant()
        else:
            m.save(update_fields=update_fields)

        event_type = (
            MatchEvent.EventType.WARNING if action.is_warning else MatchEvent.EventType.SCORE
        )
        self._write_event(event_type, {"corner": corner, "action_key": action_key}, judge)

        return m

    @transaction.atomic
    def apply_ruleset_event(self, event_type: str, payload: dict, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")

        if not hasattr(self.ruleset, "apply_ruleset_event"):
            raise ValueError(f"Ruleset '{self.ruleset.key}' does not support custom events.")

        state = m.match_state
        if not state:
            state = self.ruleset.get_default_state()

        # Capture old values BEFORE mutation to avoid in-place dictionary mutation comparison issues
        old_round = state.get("current_round", 1)
        old_history_len = len(state.get("round_history", []))

        new_state, is_finished, winner_key, win_method = self.ruleset.apply_ruleset_event(
            state, event_type, payload
        )

        m.match_state = new_state

        # Synchronize base fields to keep compatibility with existing list / tree views
        if m.category.ruleset_key == "taekwondo_wt":
            m.score_first = new_state["scores"]["chung"]
            m.score_second = new_state["scores"]["hong"]
            m.warnings_first = new_state["gam_jeoms"]["chung"]
            m.warnings_second = new_state["gam_jeoms"]["hong"]
        elif m.category.ruleset_key == "judo_ijf":
            shiro_scores = new_state["scores"]["shiro"]
            ao_scores = new_state["scores"]["ao"]
            m.score_first = shiro_scores["ippon"] * 10 + shiro_scores["waza_ari"]
            m.score_second = ao_scores["ippon"] * 10 + ao_scores["waza_ari"]
            m.warnings_first = new_state["penalties"]["shiro"]["shido"]
            m.warnings_second = new_state["penalties"]["ao"]["shido"]

        update_fields = [
            "match_state",
            "score_first",
            "score_second",
            "warnings_first",
            "warnings_second",
        ]

        new_round = new_state.get("current_round", 1)
        new_history_len = len(new_state.get("round_history", []))

        is_round_or_golden_change = (
            new_round != old_round
            or new_history_len != old_history_len
            or event_type in ("RESET_ROUND", "UNDO_ROUND", "TOGGLE_GOLDEN_SCORE")
        )
        if is_round_or_golden_change:
            m.timer_status = "not_started"
            m.timer_elapsed_ms = 0
            m.timer_started_at = None
            update_fields += ["timer_status", "timer_elapsed_ms", "timer_started_at"]
            # Trigger a broadcast of the reset timer state
            _broadcast_timer(m)

        if m.status == Match.Status.SCHEDULED:
            m.status = Match.Status.ONGOING
            update_fields.append("status")

        if m.parent_team_match and m.parent_team_match.status == Match.Status.SCHEDULED:
            m.parent_team_match.status = Match.Status.ONGOING
            m.parent_team_match.save(update_fields=["status"])
            from apps.common.broadcast import broadcast_match_update

            broadcast_match_update(m.parent_team_match)

        if is_finished:
            if m.category.ruleset_key == "taekwondo_wt":
                winner_reg = m.reg_first if winner_key == "chung" else m.reg_second
            elif m.category.ruleset_key == "judo_ijf":
                winner_reg = m.reg_first if winner_key == "shiro" else m.reg_second
            else:
                winner_reg = None

            m.winner = winner_reg
            m.win_method = win_method
            m.status = Match.Status.COMPLETED
            m.completed_at = timezone.now()

            # Force pause timer on auto finish
            m.timer_status = Match.TimerStatus.PAUSED
            m.timer_started_at = None
            update_fields += [
                "winner",
                "win_method",
                "completed_at",
                "timer_status",
                "timer_started_at",
                "status",
            ]

            m.save(update_fields=update_fields)
            m.advance_participant()
        else:
            m.save(update_fields=update_fields)

        self._write_event(
            MatchEvent.EventType.RULESET_EVENT,
            {"ruleset_event_type": event_type, "payload": payload},
            judge,
        )

        return m

    @transaction.atomic
    def set_senshu(self, value: str, judge=None) -> Match:
        """Встановлює senshu (перша атака) для 'aka', 'ao' або скидає на 'none'."""
        valid = {c[0] for c in Match.Senshu.choices}
        if value not in valid:
            raise ValueError(f"Invalid senshu value: '{value}'. Must be one of {valid}.")

        m = self.match
        m.senshu = value
        m.save(update_fields=["senshu"])

        self._write_event(MatchEvent.EventType.SENSHU, {"value": value}, judge)
        return m

    @transaction.atomic
    def timer_start(self, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")
        if m.timer_status != Match.TimerStatus.NOT_STARTED:
            raise ValueError("Таймер вже запущено або завершено.")
        m.timer_started_at = timezone.now()
        m.timer_status = Match.TimerStatus.RUNNING

        update_fields = ["timer_started_at", "timer_status"]
        if m.status == Match.Status.SCHEDULED:
            m.status = Match.Status.ONGOING
            update_fields.append("status")

        if m.parent_team_match and m.parent_team_match.status == Match.Status.SCHEDULED:
            m.parent_team_match.status = Match.Status.ONGOING
            m.parent_team_match.save(update_fields=["status"])
            from apps.common.broadcast import broadcast_match_update

            broadcast_match_update(m.parent_team_match)

        m.save(update_fields=update_fields)
        self._write_event(MatchEvent.EventType.TIMER_START, {}, judge)
        _broadcast_timer(m)
        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(m)
        return m

    @transaction.atomic
    def timer_pause(self, elapsed_ms=None, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")
        if m.timer_status != Match.TimerStatus.RUNNING:
            raise ValueError("Таймер не запущено.")

        server_delta = int((timezone.now() - m.timer_started_at).total_seconds() * 1000)
        calculated_elapsed = m.timer_elapsed_ms + server_delta

        if elapsed_ms is not None:
            try:
                client_elapsed = int(elapsed_ms)
                # Безпекова перевірка: відхилення від сервера не має перевищувати 5 секунд
                if abs(calculated_elapsed - client_elapsed) < 5000:
                    m.timer_elapsed_ms = client_elapsed
                else:
                    m.timer_elapsed_ms = calculated_elapsed
            except (ValueError, TypeError):
                m.timer_elapsed_ms = calculated_elapsed
        else:
            m.timer_elapsed_ms = calculated_elapsed

        m.timer_started_at = None
        m.timer_status = Match.TimerStatus.PAUSED
        m.save(update_fields=["timer_elapsed_ms", "timer_started_at", "timer_status"])
        self._write_event(MatchEvent.EventType.TIMER_PAUSE, {}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_resume(self, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")
        if m.timer_status != Match.TimerStatus.PAUSED:
            raise ValueError("Таймер не на паузі.")
        m.timer_started_at = timezone.now()
        m.timer_status = Match.TimerStatus.RUNNING

        update_fields = ["timer_started_at", "timer_status"]
        if m.status == Match.Status.SCHEDULED:
            m.status = Match.Status.ONGOING
            update_fields.append("status")

        if m.parent_team_match and m.parent_team_match.status == Match.Status.SCHEDULED:
            m.parent_team_match.status = Match.Status.ONGOING
            m.parent_team_match.save(update_fields=["status"])
            from apps.common.broadcast import broadcast_match_update

            broadcast_match_update(m.parent_team_match)

        m.save(update_fields=update_fields)
        self._write_event(MatchEvent.EventType.TIMER_RESUME, {}, judge)
        _broadcast_timer(m)
        from apps.common.broadcast import broadcast_match_update

        broadcast_match_update(m)
        return m

    @transaction.atomic
    def timer_reset(self, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")
        m.timer_status = Match.TimerStatus.NOT_STARTED
        m.timer_elapsed_ms = 0
        m.timer_started_at = None
        m.save(update_fields=["timer_status", "timer_elapsed_ms", "timer_started_at"])
        self._write_event(MatchEvent.EventType.TIMER_RESET, {}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_set_duration(self, duration_ms: int, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")
        if m.timer_status == Match.TimerStatus.RUNNING:
            raise ValueError("Не можна змінювати тривалість під час бою.")
        m.timer_duration_ms = duration_ms
        m.save(update_fields=["timer_duration_ms"])
        self._write_event(MatchEvent.EventType.TIMER_SET_DUR, {"duration_ms": duration_ms}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def timer_add_time(self, delta_ms: int, judge=None) -> Match:
        m = self.match
        if m.status == Match.Status.COMPLETED:
            raise ValueError("Поєдинок вже завершено.")
        if m.timer_status == Match.TimerStatus.RUNNING:
            raise ValueError("Не можна змінювати тривалість під час бою.")
        new_duration = m.timer_duration_ms + delta_ms
        if new_duration < 0:
            raise ValueError("Тривалість не може бути від'ємною")
        m.timer_duration_ms = max(m.timer_elapsed_ms, new_duration)
        m.save(update_fields=["timer_duration_ms"])
        self._write_event(MatchEvent.EventType.TIMER_SET_DUR, {"delta_ms": delta_ms}, judge)
        _broadcast_timer(m)
        return m

    @transaction.atomic
    def set_winner(self, corner: str, win_method: str, judge=None) -> Match:
        """Вручну фіксує переможця (hantei, kiken тощо)."""
        if corner not in ("aka", "ao"):
            raise ValueError(f"Invalid corner: '{corner}'. Must be 'aka' or 'ao'.")

        m = self.match
        winner_reg = m.reg_first if corner == "aka" else m.reg_second
        if winner_reg is None:
            raise ValueError(f"No participant registered in corner '{corner}'.")

        m.set_winner(winner_reg, win_method)

        # For Taekwondo WT, manual completion should transition/append the current
        # round to round_history
        if m.category.ruleset_key == "taekwondo_wt":
            state = m.match_state or {}
            curr_round = state.get("current_round", 1)
            history = state.get("round_history", [])
            existing_rounds = {h.get("round") for h in history}
            if curr_round not in existing_rounds:
                round_winner = "chung" if corner == "aka" else "hong"
                s_chung = state.get("scores", {}).get("chung", 0)
                s_hong = state.get("scores", {}).get("hong", 0)

                if "round_history" not in state:
                    state["round_history"] = []
                state["round_history"].append(
                    {
                        "round": curr_round,
                        "scores": {"chung": s_chung, "hong": s_hong},
                        "gam_jeoms": {
                            "chung": state.get("gam_jeoms", {}).get("chung", 0),
                            "hong": state.get("gam_jeoms", {}).get("hong", 0),
                        },
                        "winner": round_winner,
                        "win_method": win_method,
                    }
                )
                if "rounds_won" not in state:
                    state["rounds_won"] = {"chung": 0, "hong": 0}
                state["rounds_won"][round_winner] = state["rounds_won"].get(round_winner, 0) + 1

                m.match_state = state
                m.save(update_fields=["match_state"])

        self._write_event(
            MatchEvent.EventType.FINISH,
            {"corner": corner, "win_method": win_method},
            judge,
        )
        return m

    @transaction.atomic
    def set_draw(self, win_method="draw", judge=None) -> Match:
        """Вручну встановлює нічию (лише для кругового формату)."""
        m = self.match
        if m.category.bracket_format != "round_robin":
            raise ValidationError("Нічия дозволена тільки в круговому форматі.")

        m.winner = None
        m.win_method = win_method
        m.status = Match.Status.COMPLETED
        m.completed_at = timezone.now()
        m.save(update_fields=["winner", "win_method", "status", "completed_at"])

        event = self._write_event(
            MatchEvent.EventType.FINISH,
            {"win_method": win_method},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        transaction.on_commit(lambda: broadcast_match_event(m, event))

        pass

        return m

    def _can_clear_match_cascade(self, match: Match) -> tuple[bool, str]:
        """
        Рекурсивно перевіряє, чи можна безпечно очистити поєдинок у каскаді скидання.
        """
        match.refresh_from_db()

        # Якщо матч запланований, перевіряємо відсутність балів/попереджень
        if match.status == Match.Status.SCHEDULED:
            if (
                match.score_first > 0
                or match.score_second > 0
                or match.warnings_first > 0
                or match.warnings_second > 0
            ):
                return (
                    False,
                    "Не можна скинути бій, оскільки в одному з наступних поєдинків "
                    "уже є набрані бали або попередження.",
                )
            return True, ""

        # Якщо матч завершений як технічний BYE (walkover), його можна скинути,
        # але тільки якщо його власні наступні матчі теж можна безпечно скинути.
        if match.status == Match.Status.COMPLETED and match.win_method == Match.WinMethod.WALKOVER:
            if match.next_match:
                can_clear, err = self._can_clear_match_cascade(match.next_match)
                if not can_clear:
                    return False, err
            if match.loser_next_match:
                can_clear, err = self._can_clear_match_cascade(match.loser_next_match)
                if not can_clear:
                    return False, err
            return True, ""

        # Будь-який інший статус (триває, або завершений із реальними боями) не можна скинути
        return (
            False,
            "Не можна скинути бій, оскільки один з наступних поєдинків "
            "уже розпочався або заверсився.",
        )

    def can_reset_match(self) -> tuple[bool, str]:
        """Перевіряє, чи можна безпечно скинути поєдинок."""
        m = self.match
        if m.next_match:
            can_clear, err = self._can_clear_match_cascade(m.next_match)
            if not can_clear:
                return False, err

        if m.loser_next_match:
            can_clear, err = self._can_clear_match_cascade(m.loser_next_match)
            if not can_clear:
                return False, err

        return True, ""

    def _reset_match_fields(self, m: Match):
        m.score_first = 0
        m.score_second = 0
        m.warnings_first = 0
        m.warnings_second = 0
        m.senshu = Match.Senshu.NONE
        m.winner = None
        m.win_method = ""
        m.status = Match.Status.SCHEDULED
        m.timer_status = Match.TimerStatus.NOT_STARTED
        m.timer_elapsed_ms = 0
        m.timer_started_at = None
        m.completed_at = None
        m.started_at = None
        m.flags_aka = None
        m.flags_ao = None
        m.match_state = {}

    def _reset_team_bouts(self, m: Match):
        from apps.common.broadcast import broadcast_match_update

        for bout in m.team_bouts.all():
            self._reset_match_fields(bout)
            bout.save()
            broadcast_match_update(bout)

    def _resolve_default_duration(self, m: Match) -> int:
        category_duration = m.category.match_duration_seconds
        if not category_duration:
            try:
                from apps.rulesets.registry import get_ruleset

                ruleset = get_ruleset(m.category.ruleset_key)
                from apps.rulesets.base import PointsRuleSet

                if isinstance(ruleset, PointsRuleSet):
                    category_duration = ruleset.get_default_duration_seconds()
            except Exception:
                pass
        return category_duration or 180

    def _handle_parent_reset_update(self, m: Match):
        parent = m.parent_team_match
        parent.refresh_from_db()

        # Перераховуємо рахунок батьківського матчу
        completed_bouts = parent.team_bouts.filter(status=Match.Status.COMPLETED)
        parent.score_first = completed_bouts.filter(winner_id=parent.reg_first_id).count()
        parent.score_second = completed_bouts.filter(winner_id=parent.reg_second_id).count()

        from apps.rulesets.registry import get_ruleset

        try:
            ruleset = get_ruleset(parent.category.ruleset_key)
            is_finished, parent_winner_id, parent_win_method = ruleset.determine_team_winner(parent)
        except Exception:
            is_finished, parent_winner_id, parent_win_method = False, None, ""

        if is_finished and parent_winner_id:
            parent_winner_reg = (
                parent.reg_first if parent.reg_first_id == parent_winner_id else parent.reg_second
            )
            parent.set_winner(parent_winner_reg, parent_win_method)
        else:
            # Батьківська зустріч більше не завершена (якщо була завершена)
            if parent.status == Match.Status.COMPLETED or parent.winner is not None:
                # Очищуємо переможця батьківської зустрічі з наступного кола сітки
                parent_svc = MatchService(parent)
                parent_svc._clear_winner_from_next_match()

                parent.winner = None
                parent.win_method = ""
                parent.completed_at = None

            # Визначаємо новий статус батьківської зустрічі
            active_statuses = [Match.Status.ONGOING, Match.Status.COMPLETED]
            has_active = parent.team_bouts.filter(status__in=active_statuses).exists()
            parent.status = Match.Status.ONGOING if has_active else Match.Status.SCHEDULED
            parent.save(
                update_fields=[
                    "score_first",
                    "score_second",
                    "winner",
                    "win_method",
                    "completed_at",
                    "status",
                ]
            )

            from apps.common.broadcast import broadcast_match_update

            broadcast_match_update(parent)

    @transaction.atomic
    def reset_match(self, judge=None) -> Match:
        """Повністю скидає стан поєдинку, з каскадним видаленням переможця з наступного бою."""
        m = self.match
        can_reset, error_msg = self.can_reset_match()
        if not can_reset:
            raise ValidationError(error_msg)

        # Якщо це батьківський командний поєдинок, скидаємо також усі його суб-бої
        if m.category.is_team and not m.parent_team_match:
            self._reset_team_bouts(m)

        self._clear_winner_from_next_match()

        self._reset_match_fields(m)
        category_duration = self._resolve_default_duration(m)
        m.timer_duration_ms = category_duration * 1000

        # Очищуємо зафіксовані місця в категорії, бо результати вже не є остаточними
        from apps.tournaments.models import Registration

        Registration.objects.filter(category=m.category).update(place=None)

        m.save()

        # Якщо це суб-бой командного матчу, оновлюємо рахунок та статус батьківського матчу
        if m.parent_team_match:
            self._handle_parent_reset_update(m)

        # Знаходимо татамі, які пов'язані з цим матчем або наступними матчами
        # (куди помилково просунувся атлет)
        from django.db.models import Q

        from apps.tatamis.models import Tatami

        next_matches_ids = []
        if m.next_match_id:
            next_matches_ids.append(m.next_match_id)
        if m.loser_next_match_id:
            next_matches_ids.append(m.loser_next_match_id)

        query = Q(current_match=m)
        if next_matches_ids:
            query |= Q(current_match_id__in=next_matches_ids)
        if m.tatami_id:
            query |= Q(id=m.tatami_id)

        tatamis_to_sync = list(Tatami.objects.filter(query).distinct())

        for t in tatamis_to_sync:
            # Скидаємо на цей відкочений поєдинок
            t.current_match = m
            t.active_results_category = None
            t.save(update_fields=["current_match", "active_results_category"])

        event = self._write_event(MatchEvent.EventType.RESET, {}, judge)

        from apps.common.broadcast import broadcast_match_event, broadcast_tatami_state

        # Викликаємо бродкасти після успішного коміту транзакції
        transaction.on_commit(lambda: broadcast_match_event(m, event))
        for t in tatamis_to_sync:
            transaction.on_commit(lambda t_inst=t: broadcast_tatami_state(t_inst))

        return m

    @transaction.atomic
    def submit_flags_decision(self, flags_aka: int, flags_ao: int, judge=None) -> Match:
        """Застосовує рішення прапорами для рулсетів типу FlagsRuleSet."""
        from apps.rulesets.base import FlagsRuleSet

        m = self.match
        if not isinstance(self.ruleset, FlagsRuleSet):
            raise ValidationError(
                "Рішення прапорами підтримується тільки для FlagsRuleSet рулсетів."
            )

        judges_count = m.judges_count or m.category.judges_count
        if not judges_count:
            raise ValidationError(
                "Не встановлено кількість суддів для цього поєдинку або категорії."
            )

        if flags_aka + flags_ao != judges_count:
            raise ValidationError(
                f"Сума прапорів ({flags_aka} + {flags_ao}) повинна "
                f"дорівнювати кількості суддів ({judges_count})."
            )

        # Застосовуємо логіку рулсету
        state = self._build_state()
        new_state = self.ruleset.apply_flags_decision(state, flags_aka, flags_ao, judges_count)

        m.flags_aka = new_state.flags_aka
        m.flags_ao = new_state.flags_ao
        m.judges_count = new_state.judges_count
        m.save(update_fields=["flags_aka", "flags_ao", "judges_count"])

        winner_reg = m.reg_first if new_state.winner == "aka" else m.reg_second
        if winner_reg is None:
            raise ValidationError(f"Немає учасника в кутку '{new_state.winner}'.")

        m.set_winner(winner_reg, new_state.win_method)

        event = self._write_event(
            MatchEvent.EventType.FLAGS_DECISION,
            {"flags_aka": flags_aka, "flags_ao": flags_ao, "winner": new_state.winner},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m

    @transaction.atomic
    def toggle_timer(self, show: bool, judge=None) -> Match:
        """Вмикає або вимикає показ таймера на табло."""
        m = self.match
        m.show_timer = show
        m.save(update_fields=["show_timer"])

        event = self._write_event(
            MatchEvent.EventType.TIMER_TOGGLE,
            {"show_timer": show},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m

    def _clear_registration_from_match_tree(self, match: Match, reg) -> None:
        """
        Рекурсивно очищає учасника (реєстрацію) з матчу та каскадно скидає
        всі його подальші поєдинки в сітці.
        """
        if not reg:
            return

        match.refresh_from_db()

        # Перевіряємо, чи є цей учасник у матчі
        if match.reg_first_id != reg.id and match.reg_second_id != reg.id:
            return

        old_winner = None
        old_loser = None
        if match.status == Match.Status.COMPLETED or match.winner_id is not None:
            old_winner = match.winner
            if match.winner_id == match.reg_first_id:
                old_loser = match.reg_second
            else:
                old_loser = match.reg_first

        # Очищаємо відповідний слот
        if match.reg_first_id == reg.id:
            match.reg_first = None
        else:
            match.reg_second = None

        # Скидаємо поля матчу
        match.status = Match.Status.SCHEDULED
        match.winner = None
        match.win_method = ""
        match.score_first = 0
        match.score_second = 0
        match.save(
            update_fields=[
                "reg_first",
                "reg_second",
                "status",
                "winner",
                "win_method",
                "score_first",
                "score_second",
            ]
        )
        from apps.common.broadcast import broadcast_match_update

        transaction.on_commit(lambda: broadcast_match_update(match))

        # Рекурсивний каскад:
        # 1. Очищаємо старого переможця з next_match
        if old_winner and match.next_match:
            self._clear_registration_from_match_tree(match.next_match, old_winner)
        # 2. Очищаємо старого програвшого з loser_next_match
        if old_loser and match.loser_next_match:
            self._clear_registration_from_match_tree(match.loser_next_match, old_loser)

    def _clear_winner_from_next_match(self):
        m = self.match
        # Якщо це Grand Final у Double Elimination, видаляємо створений Bracket Reset
        if m.round_index == 200:
            bracket_resets = Match.objects.filter(category=m.category, round_index=201)
            for br in bracket_resets:
                if br.tatami and br.tatami.current_match_id == br.id:
                    br.tatami.current_match = m
                    br.tatami.save(update_fields=["current_match"])
            bracket_resets.delete()
            m.redirect_to_match_id = None

        # Визначаємо переможця та програвшого поточного матчу перед скиданням
        winner = m.winner
        loser = m.reg_second if m.winner == m.reg_first else m.reg_first

        # Рекурсивно очищаємо переможця з наступного матчу (якщо є)
        if m.next_match and winner:
            self._clear_registration_from_match_tree(m.next_match, winner)

        # Рекурсивно очищаємо програвшого з наступного матчу для тих, хто програв (якщо є)
        if m.loser_next_match and loser:
            self._clear_registration_from_match_tree(m.loser_next_match, loser)

    @transaction.atomic
    def set_judges_count(self, judges_count: int, judge=None) -> Match:
        """Встановлює кількість суддів для конкретного поєдинку (3 або 5)."""
        from apps.rulesets.base import FlagsRuleSet

        if not isinstance(self.ruleset, FlagsRuleSet):
            raise ValidationError(
                "Зміна кількості суддів підтримується тільки для рулсетів із прапорцями."
            )

        options = self.ruleset.get_judges_count_options()
        if judges_count not in options:
            raise ValidationError(f"Кількість суддів повинна бути {', '.join(map(str, options))}.")

        m = self.match

        # Якщо поєдинок завершено або встановлено прапори, скидаємо результати цього поєдинку
        if m.flags_aka is not None or m.flags_ao is not None or m.status == Match.Status.COMPLETED:
            can_reset, error_msg = self.can_reset_match()
            if not can_reset:
                raise ValidationError(f"Не можна змінити кількість суддів: {error_msg}")

            # Скидаємо просування переможця в наступний поєдинок, якщо є
            self._clear_winner_from_next_match()

            m.flags_aka = None
            m.flags_ao = None
            m.winner = None
            m.win_method = ""
            m.status = Match.Status.SCHEDULED
            m.completed_at = None

            # Очищуємо зафіксовані місця в категорії, бо результати вже не є остаточними
            from apps.tournaments.models import Registration

            Registration.objects.filter(category=m.category).update(place=None)

        m.judges_count = judges_count
        m.save(
            update_fields=[
                "judges_count",
                "flags_aka",
                "flags_ao",
                "winner",
                "win_method",
                "status",
                "completed_at",
            ]
        )

        event = self._write_event(
            MatchEvent.EventType.JUDGES_COUNT_CHANGE,
            {"judges_count": judges_count},
            judge,
        )

        from apps.common.broadcast import broadcast_match_event

        broadcast_match_event(m, event)
        return m
