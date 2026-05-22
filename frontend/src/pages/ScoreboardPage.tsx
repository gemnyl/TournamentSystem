import { useState } from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer, formatTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";
import type { Match } from "@/types/api";

// Scoreboard is mirrored vs operator: Aka LEFT, Ao RIGHT

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

// ── Athlete column ────────────────────────────────────────────────────────────
interface AthleteColumnProps {
  side: "aka" | "ao";
  name: string;
  club: string;
  score: number;
  warnings: number;
  hasSenshu: boolean;
}

function AthleteColumn({ side, name, club, score, warnings, hasSenshu }: Readonly<AthleteColumnProps>) {
  const isAka = side === "aka";
  return (
    <div className={cn(
      "flex flex-col items-center justify-between py-8 px-6 select-none",
      isAka ? "bg-red-800" : "bg-blue-800",
    )}>
      {/* Senshu */}
      <div className={cn(
        "text-5xl font-black h-16 flex items-center",
        hasSenshu ? "opacity-100" : "opacity-0",
      )}>
        S
      </div>

      {/* Score */}
      <div className="font-mono font-black leading-none text-white"
        style={{ fontSize: "clamp(8rem, 16vw, 14rem)" }}>
        {score}
      </div>

      {/* Warnings */}
      <div className="flex gap-2 h-10 items-center">
        {Array.from({ length: warnings }).map((_, i) => (
          <span key={`w-${i}`} className="text-4xl leading-none">⚠</span>
        ))}
      </div>

      {/* Name + club */}
      <div className="text-center mt-4">
        <p className="font-bold text-white leading-tight"
          style={{ fontSize: "clamp(1.5rem, 3vw, 2.5rem)" }}>
          {name || "—"}
        </p>
        {club && (
          <p className="text-white/60 mt-1" style={{ fontSize: "clamp(1rem, 1.8vw, 1.5rem)" }}>
            {club}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ScoreboardPage() {
  const { tid, n } = useParams<{ tid: string; n: string }>();

  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  const { state: timerState, setState: setTimerState, remainingMs } = useTimer(
    DEFAULT_TIMER,
    serverTimeOffset,
  );

  useTatamiSocket(tid!, n!, {
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
    },
    onTimerState(state, server_ts_ms) {
      setServerTimeOffset(server_ts_ms - Date.now());
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

  // ── No match ──
  if (!currentMatch) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center gap-6 select-none">
        <p className="text-white/30 font-bold tracking-widest uppercase"
          style={{ fontSize: "clamp(1.5rem, 4vw, 3rem)" }}>
          Tatami {n}
        </p>
        <p className="text-white/20" style={{ fontSize: "clamp(1rem, 2.5vw, 2rem)" }}>
          Очікування бою
        </p>
      </div>
    );
  }

  // Aka = reg_first (LEFT on scoreboard)
  // Ao  = reg_second (RIGHT on scoreboard)
  const aka = currentMatch.reg_first;
  const ao  = currentMatch.reg_second;

  const timerColor = (() => {
    if (remainingMs === 0 && timerState.status === "running") return "text-red-400 animate-pulse";
    if (timerState.status === "paused") return "text-amber-300";
    if (timerState.status === "not_started") return "text-white/40";
    return "text-white";
  })();

  const isCompleted = currentMatch.status === "completed";
  const winnerIsAka = isCompleted && currentMatch.winner === currentMatch.reg_first?.id;
  const winnerIsAo  = isCompleted && currentMatch.winner === currentMatch.reg_second?.id;

  return (
    <div className="h-screen w-screen bg-black flex flex-col overflow-hidden select-none">

      {/* ── Header ── */}
      <div className="flex items-center justify-center gap-4 py-2 bg-black/80 shrink-0">
        <span className="text-white/50 font-bold tracking-widest uppercase text-sm">
          Tatami {n}
        </span>
        <span className="text-white/30">·</span>
        <span className="text-white/50 text-sm">
          R{currentMatch.round_index}.{currentMatch.match_order}
        </span>
        {isCompleted && (
          <span className="text-green-400 font-bold text-sm uppercase tracking-widest">
            Завершено
          </span>
        )}
      </div>

      {/* ── Main grid: Aka | Timer | Ao ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* AKA (left on scoreboard, reg_first) */}
        <div className={cn(
          "flex-1 relative",
          winnerIsAka && "ring-4 ring-inset ring-yellow-400"
        )}>
          <AthleteColumn
            side="aka"
            name={aka?.athlete?.full_name ?? ""}
            club={aka?.athlete?.club?.name ?? ""}
            score={currentMatch.score_first}
            warnings={currentMatch.warnings_first}
            hasSenshu={currentMatch.senshu === "aka"}
          />
          {winnerIsAka && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-yellow-400 font-black tracking-widest uppercase"
                style={{ fontSize: "clamp(3rem, 6vw, 5rem)" }}>
                🏆 Переможець
              </span>
            </div>
          )}
        </div>

        {/* Timer (center) */}
        <div className="flex flex-col items-center justify-center bg-black px-4 shrink-0"
          style={{ width: "clamp(200px, 22vw, 320px)" }}>
          <div className={cn("font-mono font-black tabular-nums leading-none", timerColor)}
            style={{ fontSize: "clamp(4rem, 10vw, 8rem)" }}>
            {formatTimer(remainingMs)}
          </div>
          <div className="text-white/30 text-xs uppercase tracking-widest mt-2">
            {timerState.status === "running"  && "Йде"}
            {timerState.status === "paused"   && "Пауза"}
            {timerState.status === "not_started" && "Готово"}
            {timerState.status === "finished" && "Завершено"}
          </div>
        </div>

        {/* AO (right on scoreboard, reg_second) */}
        <div className={cn(
          "flex-1 relative",
          winnerIsAo && "ring-4 ring-inset ring-yellow-400"
        )}>
          <AthleteColumn
            side="ao"
            name={ao?.athlete?.full_name ?? ""}
            club={ao?.athlete?.club?.name ?? ""}
            score={currentMatch.score_second}
            warnings={currentMatch.warnings_second}
            hasSenshu={currentMatch.senshu === "ao"}
          />
          {winnerIsAo && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-yellow-400 font-black tracking-widest uppercase"
                style={{ fontSize: "clamp(3rem, 6vw, 5rem)" }}>
                🏆 Переможець
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
