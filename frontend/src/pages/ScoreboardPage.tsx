import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";
import type { Match, Tatami } from "@/types/api";
import KumiteWKFScoreboard from "@/components/scoreboard/KumiteWKFScoreboard";

function matchToTimerState(m: Match): TimerState {
  return {
    status: m.timer_status,
    started_at_ms: m.timer_started_at ? new Date(m.timer_started_at).getTime() : null,
    elapsed_ms: m.timer_elapsed_ms,
    duration_ms: m.timer_duration_ms,
  };
}

const DEFAULT_TIMER: TimerState = {
  status: "not_started",
  started_at_ms: null,
  elapsed_ms: 0,
  duration_ms: 180_000,
};

export default function ScoreboardPage() {
  const { tid, n } = useParams<{ tid: string; n: string }>();

  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  const { state: timerState, setState: setTimerState, remainingMs } = useTimer(
    DEFAULT_TIMER,
    serverTimeOffset,
  );

  // ── Instant Load on Mount (REST fallback to bypass WS handshake delay) ──
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const { data } = await api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${tid}`);
        const list = Array.isArray(data) ? data : (data as { results: Tatami[] }).results;
        const matchingTatami = list.find(t => t.number === Number(n));
        if (matchingTatami && matchingTatami.current_match) {
          const matchObj = matchingTatami.current_match as any;
          setCurrentMatch(matchObj);
          setTimerState(matchToTimerState(matchObj));
        }
      } catch (err) {
        console.error("Error loading initial tatami state:", err);
      }
    };
    loadInitialState();
  }, [tid, n]);

  useTatamiSocket(tid!, n!, {
    onClockOffsetUpdate: setServerTimeOffset,
    onSnapshot(data) {
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        setTimerState(matchToTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        setTimerState(DEFAULT_TIMER);
      }
    },
    onMatchEvent(_event, match) {
      setCurrentMatch(match);
      setTimerState(matchToTimerState(match));
    },
    onTimerState(state, _server_ts_ms) {
      setTimerState({
        status: state.status,
        started_at_ms: state.started_at_ms,
        elapsed_ms: state.elapsed_ms,
        duration_ms: state.duration_ms,
      });
    },
    onTatamiState(data) {
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        setTimerState(matchToTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        setTimerState(DEFAULT_TIMER);
      }
    },
  });

  // Default to Kumite WKF Scoreboard.
  // If we add another ruleset in the future (e.g., Judo), we can switch components here.
  return (
    <KumiteWKFScoreboard
      match={currentMatch}
      timerState={timerState}
      remainingMs={remainingMs}
      tatamiNumber={n!}
    />
  );
}
