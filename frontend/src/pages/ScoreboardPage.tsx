import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer, formatTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";
import type { Match, Tatami } from "@/types/api";

// Scoreboard is mirrored vs operator: Aka LEFT (Red), Ao RIGHT (Blue)

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
  isWinner: boolean;
}

function AthleteColumn({ side, name, club, score, warnings, hasSenshu, isWinner }: Readonly<AthleteColumnProps>) {
  const isAka = side === "aka";
  return (
    <div className={cn("panel", isAka ? "panel-red" : "panel-blue")}>
      {/* Name block */}
      <div className="name-block">
        <div className="name-row">
          <span className="athlete-name">{name || "—"}</span>
          {hasSenshu && <span className="senshu">Senshu</span>}
        </div>
        <span className="club-name">{club || "—"}</span>
      </div>

      {/* Big score */}
      <div className="score-area">
        <span className={cn("score", isWinner && "animate-winner-blink")}>
          {score}
        </span>
      </div>

      {/* Penalty row */}
      <div className="penalties-container">
        <div className="penalty-panel">
          <div className="penalty-grid">
            {['1C', '2C', '3C', 'HC', 'H'].map((label, idx) => {
              const isLit = warnings >= idx + 1;
              return (
                <div key={`${side}-p-${idx}`} className="penalty-col">
                  <span className={cn("penalty-label", isLit ? "text-white font-bold" : "text-white/40")}>
                    {label}
                  </span>
                  <div
                    className={cn(
                      "penalty-circle transition-all duration-150",
                      isLit
                        ? "bg-white border-white"
                        : "border-white/20 bg-transparent"
                    )}
                  />
                </div>
              );
            })}
          </div>
        </div>
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

  // Helper to prevent the running client-side clock from jumping back and forth
  // due to periodic database snapshots overriding the running elapsed time
  const updateTimerIfNecessary = (newState: TimerState) => {
    setTimerState(prev => {
      // If currently running and stays running, keep local countdown uninterrupted
      if (prev.status === "running" && newState.status === "running") {
        if (prev.duration_ms !== newState.duration_ms) {
          return newState; // update only if operator adjusted duration
        }
        return prev;
      }
      return newState;
    });
  };

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
          updateTimerIfNecessary(matchToTimerState(matchObj));
        }
      } catch (err) {
        console.error("Error loading initial tatami state:", err);
      }
    };
    loadInitialState();
  }, [tid, n]);

  useTatamiSocket(tid!, n!, {
    onSnapshot(data) {
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        updateTimerIfNecessary(matchToTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        updateTimerIfNecessary(DEFAULT_TIMER);
      }
    },
    onMatchEvent(_event, match) {
      setCurrentMatch(match);
    },
    onTimerState(state, server_ts_ms) {
      const newOffset = server_ts_ms - Date.now();
      setServerTimeOffset(prev => {
        // Only update if latency shift is >200ms to eliminate WebSocket message network jitter
        if (Math.abs(newOffset - prev) > 200) {
          return newOffset;
        }
        return prev;
      });
      updateTimerIfNecessary({
        status: state.status,
        started_at_ms: state.started_at_ms,
        elapsed_ms: state.elapsed_ms,
        duration_ms: state.duration_ms,
      });
    },
    onTatamiState(data) {
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        updateTimerIfNecessary(matchToTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        updateTimerIfNecessary(DEFAULT_TIMER);
      }
    },
  });

  // Aka = reg_first (LEFT on scoreboard)
  // Ao  = reg_second (RIGHT on scoreboard)
  const aka = currentMatch?.reg_first;
  const ao  = currentMatch?.reg_second;

  const isCompleted = currentMatch?.status === "completed";
  const winnerIsAka = isCompleted && currentMatch?.winner === currentMatch?.reg_first?.id;
  const winnerIsAo  = isCompleted && currentMatch?.winner === currentMatch?.reg_second?.id;

  return (
    <div className="board font-scoreboard">
      {/* Dynamic styles matching WKF professional layout and Oswald fonts */}
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap');

        :root {
          --red:    #b01820;
          --blue:   #1a4b85;
          --dark:   #111820;
          --header: #1c1c1c;
          --text:   #ffffff;
        }

        .font-scoreboard {
          font-family: 'Oswald', sans-serif;
        }

        /* ─── WRAPPER ─────────────────────────────────────────── */
        .board {
          width: 100vw;
          height: 100vh;
          display: grid;
          grid-template-rows: auto 1fr;
          background: #000;
          color: var(--text);
          overflow: hidden;
        }

        /* ─── HEADER ──────────────────────────────────────────── */
        .header {
          background: var(--header);
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          align-items: center;
          padding: 0 2vw;
          height: clamp(36px, 6vh, 56px);
          border-bottom: 2px solid #2a2a2a;
        }
        .header-item {
          font-size: clamp(0.65rem, 1.4vw, 1rem);
          letter-spacing: 0.12em;
          color: #888;
          text-transform: uppercase;
          font-weight: 400;
        }
        .header-item span {
          color: #fff;
          font-weight: 600;
        }
        .header-item.center { text-align: center; }
        .header-item.right  { text-align: right; }

        /* ─── MAIN 3-COLUMN GRID (Aka - center gap - Ao) ──────── */
        .columns {
          display: grid;
          grid-template-columns: 1fr clamp(180px, 18vw, 260px) 1fr;
          height: 100%;
          overflow: hidden;
        }

        /* ─── COMPETITOR PANELS ───────────────────────────────── */
        .panel {
          display: grid;
          grid-template-rows: auto 1fr auto;
          height: 100%;
          overflow: hidden;
        }
        .panel-red  { background: var(--red); }
        .panel-blue { background: var(--blue); }

        /* Shaded name block at the top of the panel */
        .name-block {
          background: rgba(0, 0, 0, 0.2); /* Darkened overlay */
          padding: clamp(16px, 2.8vh, 28px) clamp(20px, 3.5vw, 48px);
          border-bottom: 2px solid rgba(0, 0, 0, 0.1);
          display: flex;
          flex-direction: column;
          gap: 0.25em;
        }
        .name-row { display: flex; align-items: center; gap: 0.6em; flex-wrap: wrap; }
        .athlete-name {
          font-size: clamp(1.4rem, 3.2vw, 2.8rem);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          line-height: 1;
        }
        .club-name {
          font-size: clamp(0.75rem, 1.5vw, 1.15rem);
          font-weight: 400;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          opacity: 0.75;
          margin-top: 0.3em;
        }

        /* Senshu badge - high contrast pure white and black */
        .senshu {
          background: #ffffff;
          color: #111820;
          font-size: clamp(0.6rem, 1.2vw, 0.9rem);
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 0.2em 0.55em;
          border-radius: 4px;
          white-space: nowrap;
          align-self: center;
        }

        /* Big score - Sized relative to viewport height to avoid name/penalty collision */
        .score-area {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(10px, 2vh, 40px);
        }
        .score {
          font-size: clamp(8rem, 36vh, 22rem);
          font-weight: 700;
          line-height: 0.85;
          transform: scaleX(0.72);
          display: inline-block;
          letter-spacing: -0.02em;
        }

        /* Penalty panel styling at the bottom */
        .penalties-container {
          padding-bottom: clamp(20px, 4vh, 48px);
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .penalty-panel {
          background: rgba(0, 0, 0, 0.3);
          border: 1.5px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          padding: clamp(8px, 1.5vh, 16px) clamp(12px, 2.5vw, 28px);
          width: fit-content;
          margin: 0 auto;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .penalty-grid {
          display: flex;
          gap: clamp(12px, 2.5vw, 28px);
          justify-content: center;
          align-items: center;
        }
        .penalty-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(4px, 0.8vh, 10px);
          width: clamp(24px, 4vw, 44px);
        }
        .penalty-label {
          font-size: clamp(0.75rem, 1.4vw, 1.15rem);
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .penalty-circle {
          width: clamp(10px, 1.2vw, 16px);
          height: clamp(10px, 1.2vw, 16px);
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.15);
        }

        /* ─── CENTER COLUMN (TIMER ONLY) ───────────────────────── */
        .center-col {
          background: #111820;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          border-left: 2px solid #000;
          border-right: 2px solid #000;
        }
        .timer-digits {
          font-size: clamp(2.5rem, 5.5vw, 5.2rem);
          font-weight: 700;
          color: #ffffff; /* Pure white, clean timer digits with no special effects */
          letter-spacing: -0.02em;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
          text-align: center;
        }

        /* Scoreboard blink animations */
        @keyframes scoreboard-score-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .animate-winner-blink {
          animation: scoreboard-score-blink 1.5s infinite step-end;
        }

        @keyframes timer-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .animate-timer-blink {
          animation: timer-blink 1s infinite step-end;
        }
      ` }} />

      {/* HEADER */}
      <header className="header">
        <div className="header-item">Category: <span>{currentMatch?.category_name || "Official Category"}</span></div>
        <div className="header-item center"><span>Tatami {n}</span></div>
        <div className="header-item right">Stage: <span>
          {currentMatch ? `Round ${currentMatch.round_index} - Match ${currentMatch.match_order}` : "—"}
        </span></div>
      </header>

      {/* COLUMNS */}
      <div className="columns">
        {/* No active match state overlay */}
        {!currentMatch ? (
          <div className="col-span-3 h-full w-full bg-black flex flex-col items-center justify-center gap-6 z-50">
            <p className="text-gray-400 font-bold tracking-[0.3em] uppercase text-4xl">
              TATAMI {n}
            </p>
            <div className="w-16 h-1 bg-[#b01820] rounded-full animate-pulse" />
            <p className="text-gray-500 font-medium tracking-[0.25em] uppercase text-lg">
              WAITING FOR MATCH
            </p>
          </div>
        ) : (
          <>
            {/* RED / AKA (LEFT) */}
            <AthleteColumn
              side="aka"
              name={aka?.athlete?.full_name ?? ""}
              club={aka?.athlete?.club?.name ?? ""}
              score={currentMatch.score_first}
              warnings={currentMatch.warnings_first}
              hasSenshu={currentMatch.senshu === "aka"}
              isWinner={winnerIsAka}
            />

            {/* CENTER COLUMN (TIMER ONLY) */}
            <div className="center-col">
              <div className={cn(
                "timer-digits",
                (isCompleted || timerState.status === "finished") && "animate-timer-blink"
              )}>
                {formatTimer(remainingMs)}
              </div>
            </div>

            {/* BLUE / AO (RIGHT) */}
            <AthleteColumn
              side="ao"
              name={ao?.athlete?.full_name ?? ""}
              club={ao?.athlete?.club?.name ?? ""}
              score={currentMatch.score_second}
              warnings={currentMatch.warnings_second}
              hasSenshu={currentMatch.senshu === "ao"}
              isWinner={winnerIsAo}
            />
          </>
        )}
      </div>
    </div>
  );
}
