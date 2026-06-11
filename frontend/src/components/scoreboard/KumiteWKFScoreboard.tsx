import { cn } from "@/lib/utils";
import { formatTimer } from "@/hooks/useTimer";
import type { Match } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { Link } from "react-router-dom";

interface AthleteColumnProps {
  side: "aka" | "ao";
  name: string;
  club: string;
  score: number;
  warnings: number;
  hasSenshu: boolean;
  isWinner: boolean;
  isKata?: boolean;
}

function AthleteColumn({ side, name, club, score, warnings, hasSenshu, isWinner, isKata = false }: Readonly<AthleteColumnProps>) {
  const isAka = side === "aka";
  return (
    <div className={cn("panel", isAka ? "panel-red" : "panel-blue")}>
      {/* Name block */}
      <div className="name-block">
        <div className="name-row">
          <span className="athlete-name">{name || "—"}</span>
          {hasSenshu && !isKata && <span className="senshu">Senshu</span>}
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
      {!isKata && (
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
      )}
    </div>
  );
}

interface KumiteWKFScoreboardProps {
  match: Match | null;
  timerState: TimerState;
  remainingMs: number;
  tatamiNumber: string;
  categoryResults?: { place?: number | null; id?: number; name?: string; club?: string; registration?: { id?: number; athlete?: { full_name?: string; club?: { name?: string; region?: string } } } }[];
  resultsCategoryName?: string;
}

function getStandingRowClass(place: number): string {
  if (place === 1) return "bg-yellow-500/5 border-yellow-500/20";
  if (place === 2) return "bg-slate-300/5 border-slate-300/10";
  if (place === 3) return "bg-amber-700/5 border-amber-700/10";
  return "bg-zinc-900/40 border-zinc-800/50";
}

function getStandingBadgeClass(place: number): string {
  if (place === 1) return "bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 text-black font-black shadow-[0_0_20px_rgba(234,179,8,0.25)]";
  if (place === 2) return "bg-gradient-to-r from-slate-300 via-zinc-200 to-slate-400 text-black font-black shadow-[0_0_20px_rgba(203,213,225,0.2)]";
  if (place === 3) return "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 text-white font-black shadow-[0_0_15px_rgba(180,83,9,0.25)]";
  return "bg-zinc-800 text-zinc-400";
}

function getStandingMedal(place: number): string {
  if (place === 1) return "🥇";
  if (place === 2) return "🥈";
  if (place === 3) return "🥉";
  return "";
}

export default function KumiteWKFScoreboard({
  match,
  timerState,
  remainingMs,
  tatamiNumber,
  categoryResults = [],
  resultsCategoryName = "",
}: Readonly<KumiteWKFScoreboardProps>) {
  void timerState;
  const aka = match?.reg_first;
  const ao  = match?.reg_second;

  const isCompleted = match?.status === "completed";
  const winnerIsAka = isCompleted && match?.winner === match?.reg_first?.id;
  const winnerIsAo  = isCompleted && match?.winner === match?.reg_second?.id;

  const isSpectator = typeof globalThis.window !== 'undefined' && new URLSearchParams(globalThis.window.location.search).get('spectator') === 'true';
  const tidFromUrl = typeof globalThis.window !== 'undefined' ? globalThis.window.location.pathname.split('/')[3] : '1';
  const backUrl = `/tournaments/${tidFromUrl}/day`;

  const finalStandings = categoryResults
    .filter((r): r is typeof r & { place: number } => r.place != null && r.place > 0)
    .sort((a, b) => a.place - b.place);

  return (
    <div className="board font-scoreboard">
      <style>{`
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
      `}</style>

      {/* HEADER */}
      <header className="header flex items-center justify-between">
        {isSpectator ? (
          <Link
            to={backUrl}
            className="z-50 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/50 text-white text-xs font-semibold uppercase tracking-wider transition-all shadow-lg hover:border-zinc-500 w-fit"
          >
            ← Назад до моніторингу
          </Link>
        ) : (
          <div className="header-item">Category: <span>{match?.category_name || resultsCategoryName || "—"}</span></div>
        )}
        <div className="header-item center"><span>Tatami {tatamiNumber}</span></div>
        <div className="header-item right">Stage: <span>
          {match ? `Round ${match.round_index} - Match ${match.match_order}` : "—"}
        </span></div>
      </header>

      {/* COLUMNS */}
      <div className="columns">
        {match ? (
          <>
            {/* RED / AKA (LEFT) */}
            <AthleteColumn
              side="aka"
              name={aka?.athlete?.full_name ?? ""}
              club={aka?.athlete?.club?.name ?? ""}
              score={match.judging_mode === "flags" ? (match.flags_aka ?? 0) : match.score_first}
              warnings={match.warnings_first}
              hasSenshu={match.senshu === "aka"}
              isWinner={winnerIsAka}
              isKata={match.judging_mode === "flags"}
            />

            {/* CENTER COLUMN (TIMER ONLY) */}
            <div className="center-col">
              {(match.judging_mode !== "flags" || match.show_timer) && (
                <div className="timer-digits">
                  {formatTimer(remainingMs)}
                </div>
              )}
            </div>

            {/* BLUE / AO (RIGHT) */}
            <AthleteColumn
              side="ao"
              name={ao?.athlete?.full_name ?? ""}
              club={ao?.athlete?.club?.name ?? ""}
              score={match.judging_mode === "flags" ? (match.flags_ao ?? 0) : match.score_second}
              warnings={match.warnings_second}
              hasSenshu={match.senshu === "ao"}
              isWinner={winnerIsAo}
              isKata={match.judging_mode === "flags"}
            />
          </>
        ) : categoryResults && finalStandings.length > 0 ? (
          <div className="col-span-3 h-full w-full bg-[#0b0f15] flex flex-col items-center justify-center p-12 z-50 select-none">
            <div className="text-center space-y-3 mb-10 w-full max-w-4xl">
              <h1 className="text-white font-extrabold tracking-tight text-5xl uppercase font-scoreboard">
                {resultsCategoryName}
              </h1>
              <div className="text-amber-500 font-bold tracking-[0.2em] uppercase text-sm font-scoreboard">
                ПІДСУМКОВИЙ ЗАЛІК ЗМАГАНЬ
              </div>
              <div className="w-32 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent mx-auto mt-2" />
            </div>

            {/* Standings List */}
            <div className="w-full max-w-3xl bg-zinc-950/60 border border-zinc-800/60 rounded-2xl p-6 shadow-2xl backdrop-blur-md space-y-3">
              {finalStandings.map((res) => {
                const place = res.place;
                const name = res.registration?.athlete?.full_name ?? res.name ?? "—";
                const club = res.registration?.athlete?.club?.name ?? res.club ?? "Без клубу";
                const region = res.registration?.athlete?.club?.region;

                const badgeClass = getStandingBadgeClass(place);
                const rowClass = getStandingRowClass(place);
                const medal = getStandingMedal(place);

                return (
                  <div
                    key={res.registration?.id || res.id}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                      rowClass
                    )}
                  >
                    <div className="flex items-center gap-5">
                      {/* Place Number */}
                      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-xl uppercase tracking-wider font-bold shrink-0", badgeClass)}>
                        {place}
                      </div>

                      {/* Name and Club */}
                      <div className="flex flex-col">
                        <span className="text-2xl font-bold tracking-wide uppercase text-white">
                          {name}
                        </span>
                        <span className="text-sm text-zinc-400 font-medium uppercase tracking-wider">
                          {club}{region ? ` (${region})` : ""}
                        </span>
                      </div>
                    </div>

                    {/* Medals/Icons if desired, or just clean layout */}
                    <div className="text-2xl select-none">
                      {medal}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="col-span-3 h-full w-full bg-black flex flex-col items-center justify-center gap-6 z-50">
            <p className="text-gray-400 font-bold tracking-[0.3em] uppercase text-4xl">
              TATAMI {tatamiNumber}
            </p>
            <div className="w-16 h-1 bg-[#b01820] rounded-full animate-pulse" />
            <p className="text-gray-500 font-medium tracking-[0.25em] uppercase text-lg">
              WAITING FOR MATCH
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
