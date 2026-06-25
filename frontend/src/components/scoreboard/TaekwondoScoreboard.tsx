import { cn, formatRegistrationName, formatAthleteName, parseTaekwondoMatchState } from "@/lib/utils";
import type { Match, TaekwondoMatchState } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { formatTimer } from "@/hooks/useTimer";
import { Link } from "react-router-dom";

interface TaekwondoScoreboardProps {
  match: Match | null;
  timerState: TimerState;
  remainingMs: number;
  tatamiNumber: string;
  categoryResults?: any[];
  resultsCategoryName?: string;
}

export default function TaekwondoScoreboard({
  match,
  timerState,
  remainingMs,
  tatamiNumber,
  categoryResults = [],
  resultsCategoryName = "",
}: Readonly<TaekwondoScoreboardProps>) {
  void timerState;

  const isCompleted = match?.status === "completed";
  const rawState = match?.match_state || {};
  const state: TaekwondoMatchState = parseTaekwondoMatchState(rawState);

  const isSpectator = typeof globalThis.window !== 'undefined' && new URLSearchParams(globalThis.window.location.search).get('spectator') === 'true';
  const tidFromUrl = typeof globalThis.window !== 'undefined' ? globalThis.window.location.pathname.split('/')[3] : '1';
  const backUrl = `/tournaments/${tidFromUrl}/day`;

  const finalStandings = categoryResults
    .filter((r): r is typeof r & { place: number } => r.place != null && r.place > 0)
    .sort((a, b) => a.place - b.place);

  const getFighterName = (corner: "chung" | "hong") => {
    if (!match) return "";
    const reg = corner === "chung" ? match.reg_first : match.reg_second;
    const athlete = corner === "chung" ? match.athlete_first : match.athlete_second;
    if (athlete) return formatAthleteName(athlete);
    if (reg) return formatRegistrationName(reg);
    return "TBD";
  };

  const getFighterClub = (corner: "chung" | "hong") => {
    if (!match) return "";
    const reg = corner === "chung" ? match.reg_first : match.reg_second;
    const athlete = corner === "chung" ? match.athlete_first : match.athlete_second;
    const hasAthlete = !!athlete;
    if (hasAthlete) {
      return reg?.team?.name ?? "";
    }
    return reg?.athlete?.club?.name ?? reg?.team?.club?.name ?? "";
  };

  const renderStandings = () => {
    return (
      <div className="col-span-3 h-full w-full bg-[#0a0d13] flex flex-col items-center justify-center p-10 md:p-12 z-50 select-none">
        <div className="text-center space-y-3 mb-8 w-full max-w-4xl">
          <h2 className="text-white font-extrabold tracking-tighter text-5xl uppercase font-scoreboard">
            {resultsCategoryName}
          </h2>
          <div className="text-amber-500 font-semibold tracking-[0.22em] uppercase text-sm font-scoreboard">
            ПІДСУМКОВИЙ ЗАЛІК ЗМАГАНЬ
          </div>
          <div className="w-28 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent mx-auto mt-2" />
        </div>

        <div className="w-full max-w-3xl bg-zinc-950/70 border border-zinc-800/50 rounded-2xl p-6 shadow-2xl backdrop-blur-sm space-y-3">
          {finalStandings.map((result) => {
            const currentPlace = result.place;
            const displayName = formatRegistrationName(result.registration) || result.name || "—";
            const competitorClub = result.registration?.athlete?.club?.name ?? result.registration?.team?.club?.name ?? result.club ?? "Без клубу";
            const clubRegion = result.registration?.athlete?.club?.region ?? result.registration?.team?.club?.region;

            return (
              <div
                key={result.registration?.id || result.id}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                  currentPlace === 1 && "bg-yellow-500/5 border-yellow-500/20",
                  currentPlace === 2 && "bg-slate-300/5 border-slate-300/10",
                  currentPlace === 3 && "bg-amber-700/5 border-amber-700/10",
                  currentPlace > 3 && "bg-zinc-900/40 border-zinc-800/50"
                )}
              >
                <div className="flex items-center gap-5">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center text-xl uppercase tracking-wider font-bold shrink-0",
                    currentPlace === 1 && "bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 text-black font-black shadow-[0_0_20px_rgba(234,179,8,0.25)]",
                    currentPlace === 2 && "bg-gradient-to-r from-slate-300 via-zinc-200 to-slate-400 text-black font-black shadow-[0_0_20px_rgba(203,213,225,0.2)]",
                    currentPlace === 3 && "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 text-white font-black shadow-[0_0_15px_rgba(180,83,9,0.25)]",
                    currentPlace > 3 && "bg-zinc-800 text-zinc-400"
                  )}>
                    {currentPlace}
                  </div>

                  <div className="flex flex-col">
                    <span className="text-2xl font-bold tracking-wide uppercase text-white">
                      {displayName}
                    </span>
                    <span className="text-sm text-zinc-400 font-medium uppercase tracking-wider">
                      {competitorClub}{clubRegion ? ` (${clubRegion})` : ""}
                    </span>
                  </div>
                </div>

                <div className="text-2xl select-none">
                  {currentPlace === 1 && "🥇"}
                  {currentPlace === 2 && "🥈"}
                  {currentPlace === 3 && "🥉"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderActiveMatch = () => {
    if (!match) return null;
    const winnerIsChung = isCompleted && match.winner === match.reg_first?.id;
    const winnerIsHong = isCompleted && match.winner === match.reg_second?.id;

    return (
      <div className="grid grid-cols-[1fr_clamp(180px,18vw,260px)_1fr] h-full w-full overflow-hidden">
        {/* Left Side: HONG (Red) */}
        <div className="bg-red-600 flex flex-col justify-between p-8 relative overflow-hidden">
          {/* Athlete Info */}
          <div className="bg-black/20 p-6 rounded-lg border-b border-black/10 flex flex-col gap-1 z-10">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-5xl font-extrabold uppercase text-white tracking-wide">
                {getFighterName("hong")}
              </span>
            </div>
            <span className="text-lg text-white/70 uppercase tracking-widest mt-1">
              {getFighterClub("hong") || "Без клубу"}
            </span>
            {/* Rounds won circles */}
            <div className="flex gap-2.5 mt-3">
              <div className={cn("w-6 h-6 rounded-full border-2 border-white/40 transition-all duration-300 shadow", state.rounds_won.hong >= 1 ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]" : "bg-transparent")} />
              <div className={cn("w-6 h-6 rounded-full border-2 border-white/40 transition-all duration-300 shadow", state.rounds_won.hong >= 2 ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]" : "bg-transparent")} />
            </div>
          </div>

          {/* Big Score */}
          <div className="flex-1 flex flex-col items-center justify-center z-10">
            <span className={cn(
              "font-display font-black text-[clamp(10rem,42vh,24rem)] leading-none text-white transition-all select-none transform scale-y-110",
              winnerIsHong && "animate-pulse"
            )}>
              {state.scores.hong}
            </span>

            {/* Gam-jeoms counter */}
            <div className="text-3xl font-extrabold tracking-wider text-[hsl(var(--sport-accent))] mt-4 select-none drop-shadow">
              GJ: {state.gam_jeoms.hong}/10
            </div>
          </div>
        </div>

        {/* Center: Timer & Round index */}
        <div className="bg-[#111820] flex flex-col items-center justify-center gap-6 border-l-2 border-r-2 border-black z-20">
          <div className="text-zinc-500 font-bold uppercase tracking-[0.2em] text-xs">
            Round {state.current_round}
          </div>
          <div className="font-mono text-5xl font-black text-white tabular-nums leading-none">
            {formatTimer(remainingMs)}
          </div>
          <div className="text-zinc-500 text-[10px] tracking-widest uppercase">
            {match.timer_status}
          </div>
        </div>

        {/* Right Side: CHUNG (Blue) */}
        <div className="bg-blue-600 flex flex-col justify-between p-8 relative overflow-hidden">
          {/* Athlete Info */}
          <div className="bg-black/20 p-6 rounded-lg border-b border-black/10 flex flex-col gap-1 z-10">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-5xl font-extrabold uppercase text-white tracking-wide">
                {getFighterName("chung")}
              </span>
            </div>
            <span className="text-lg text-white/70 uppercase tracking-widest mt-1">
              {getFighterClub("chung") || "Без клубу"}
            </span>
            {/* Rounds won circles */}
            <div className="flex gap-2.5 mt-3">
              <div className={cn("w-6 h-6 rounded-full border-2 border-white/40 transition-all duration-300 shadow", state.rounds_won.chung >= 1 ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]" : "bg-transparent")} />
              <div className={cn("w-6 h-6 rounded-full border-2 border-white/40 transition-all duration-300 shadow", state.rounds_won.chung >= 2 ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]" : "bg-transparent")} />
            </div>
          </div>

          {/* Big Score */}
          <div className="flex-1 flex flex-col items-center justify-center z-10">
            <span className={cn(
              "font-display font-black text-[clamp(10rem,42vh,24rem)] leading-none text-white transition-all select-none transform scale-y-110",
              winnerIsChung && "animate-pulse"
            )}>
              {state.scores.chung}
            </span>

            {/* Gam-jeoms counter */}
            <div className="text-3xl font-extrabold tracking-wider text-[hsl(var(--sport-accent))] mt-4 select-none drop-shadow">
              GJ: {state.gam_jeoms.chung}/10
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-screen h-screen grid grid-rows-[auto_1fr] bg-[#000] text-white overflow-hidden select-none">
      {/* Header */}
      <header className="bg-[#1c1c1c] grid grid-template-columns-3 items-center px-6 h-14 border-b-2 border-zinc-800 flex justify-between z-30">
        {isSpectator ? (
          <Link
            to={backUrl}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/50 text-white text-xs font-semibold uppercase tracking-wider transition-all shadow shadow-md"
          >
            ← Назад
          </Link>
        ) : (
          <div className="text-zinc-500 font-bold uppercase tracking-wider text-sm">
            Category: <span className="text-white">{match?.category_name || resultsCategoryName || "—"}</span>
          </div>
        )}
        <div className="text-zinc-400 font-extrabold uppercase tracking-widest text-base">
          Tatami {tatamiNumber}
        </div>
        <div className="text-zinc-500 font-bold uppercase tracking-wider text-sm text-right">
          {match ? `Round ${match.round_index} - Match ${match.match_order}` : "—"}
        </div>
      </header>

      {/* Main Content */}
      <div className="relative flex-1 overflow-hidden">
        {match ? renderActiveMatch() : renderStandings()}
      </div>
    </div>
  );
}
