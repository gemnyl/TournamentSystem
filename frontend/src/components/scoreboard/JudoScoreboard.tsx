import { cn, formatRegistrationName, formatAthleteName, parseJudoMatchState } from "@/lib/utils";
import type { Match, JudoMatchState } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";

interface JudoScoreboardProps {
  match: Match | null;
  timerState: TimerState;
  remainingMs: number;
  tatamiNumber: string;
  categoryResults?: any[];
  resultsCategoryName?: string;
  serverTimeOffset?: number;
}

export default function JudoScoreboard({
  match,
  timerState,
  remainingMs,
  tatamiNumber,
  categoryResults = [],
  resultsCategoryName = "",
  serverTimeOffset = 0,
}: Readonly<JudoScoreboardProps>) {
  const isCompleted = match?.status === "completed";
  const rawState = match?.match_state || {};
  const state: JudoMatchState = parseJudoMatchState(rawState);

  const [osaekomiSec, setOsaekomiSec] = useState(0);

  useEffect(() => {
    const activeFor = state.osaekomi?.active_for;
    const startTimestamp = state.osaekomi?.start_timestamp;

    if (!activeFor || !startTimestamp) {
      setOsaekomiSec(0);
      return;
    }

    const intervalTimer = setInterval(() => {
      const startMs = new Date(startTimestamp).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() + serverTimeOffset - startMs) / 1000));
      setOsaekomiSec(elapsedSeconds);
    }, 250);

    const startMs = new Date(startTimestamp).getTime();
    setOsaekomiSec(Math.max(0, Math.floor((Date.now() + serverTimeOffset - startMs) / 1000)));

    return () => clearInterval(intervalTimer);
  }, [state.osaekomi, serverTimeOffset]);

  const isSpectator = typeof globalThis.window !== 'undefined' && new URLSearchParams(globalThis.window.location.search).get('spectator') === 'true';
  const tidFromUrl = typeof globalThis.window !== 'undefined' ? globalThis.window.location.pathname.split('/')[3] : '1';
  const backUrl = `/tournaments/${tidFromUrl}/day`;

  const finalStandings = categoryResults
    .filter((r): r is typeof r & { place: number } => r.place != null && r.place > 0)
    .sort((a, b) => a.place - b.place);

  const getFighterName = (corner: "shiro" | "ao") => {
    if (!match) return "";
    const reg = corner === "shiro" ? match.reg_first : match.reg_second;
    const athlete = corner === "shiro" ? match.athlete_first : match.athlete_second;
    if (athlete) return formatAthleteName(athlete);
    if (reg) return formatRegistrationName(reg);
    return "TBD";
  };

  const getFighterClub = (corner: "shiro" | "ao") => {
    if (!match) return "";
    const reg = corner === "shiro" ? match.reg_first : match.reg_second;
    const athlete = corner === "shiro" ? match.athlete_first : match.athlete_second;
    if (athlete) return reg?.team?.name ?? "";
    return reg?.athlete?.club?.name ?? reg?.team?.club?.name ?? "";
  };

  const renderStandings = () => {
    return (
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

        <div className="w-full max-w-3xl bg-zinc-950/60 border border-zinc-800/60 rounded-2xl p-6 shadow-2xl backdrop-blur-md space-y-3">
          {finalStandings.map((res) => {
            const place = res.place;
            const name = formatRegistrationName(res.registration) || res.name || "—";
            const club = res.registration?.athlete?.club?.name ?? res.registration?.team?.club?.name ?? res.club ?? "Без клубу";
            const region = res.registration?.athlete?.club?.region ?? res.registration?.team?.club?.region;

            return (
              <div
                key={res.registration?.id || res.id}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                  place === 1 && "bg-yellow-500/5 border-yellow-500/20",
                  place === 2 && "bg-slate-300/5 border-slate-300/10",
                  place === 3 && "bg-amber-700/5 border-amber-700/10",
                  place > 3 && "bg-zinc-900/40 border-zinc-800/50"
                )}
              >
                <div className="flex items-center gap-5">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center text-xl uppercase tracking-wider font-bold shrink-0",
                    place === 1 && "bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 text-black font-black shadow-[0_0_20px_rgba(234,179,8,0.25)]",
                    place === 2 && "bg-gradient-to-r from-slate-300 via-zinc-200 to-slate-400 text-black font-black shadow-[0_0_20px_rgba(203,213,225,0.2)]",
                    place === 3 && "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 text-white font-black shadow-[0_0_15px_rgba(180,83,9,0.25)]",
                    place > 3 && "bg-zinc-800 text-zinc-400"
                  )}>
                    {place}
                  </div>

                  <div className="flex flex-col">
                    <span className="text-2xl font-bold tracking-wide uppercase text-white">
                      {name}
                    </span>
                    <span className="text-sm text-zinc-400 font-medium uppercase tracking-wider">
                      {club}{region ? ` (${region})` : ""}
                    </span>
                  </div>
                </div>

                <div className="text-2xl select-none">
                  {place === 1 && "🥇"}
                  {place === 2 && "🥈"}
                  {place === 3 && "🥉"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const formatJudoTimer = (ms: number, isGoldenScore: boolean): string => {
    const totalSeconds = isGoldenScore ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const getTimerMs = () => {
    if (state.is_golden_score) {
      let gsMs = timerState.elapsed_ms;
      if (timerState.status === "running" && timerState.started_at_ms) {
        gsMs += (Date.now() + serverTimeOffset - timerState.started_at_ms);
      }
      return gsMs;
    }
    return remainingMs;
  };

  const renderActiveMatch = () => {
    if (!match) return null;
    const winnerIsShiro = isCompleted && match.winner === match.reg_first?.id;
    const winnerIsAo = isCompleted && match.winner === match.reg_second?.id;

    return (
      <div className="grid grid-cols-[1fr_clamp(180px,18vw,260px)_1fr] h-full w-full overflow-hidden bg-background">

        {/* Left Side: AO (Blue) */}
        <div className="bg-blue-800 text-white flex flex-col justify-between p-8 relative overflow-hidden">
          {/* Athlete Info */}
          <div className="bg-black/20 p-6 rounded-lg border border-black/10 flex flex-col gap-1 z-10">
            <span className="text-5xl font-extrabold uppercase text-white tracking-wide truncate">
              {getFighterName("ao")}
            </span>
            <span className="text-lg text-white/70 uppercase tracking-widest mt-1">
              {getFighterClub("ao") || "Без клубу"}
            </span>
            {/* Shido cards under name */}
            <div className="flex gap-2 mt-3">
              {Array.from({ length: 3 }).map((_, idx) => {
                const isLit = state.penalties.ao.shido > idx;
                return (
                  <div
                    key={`ao-card-${idx}`}
                    className={cn(
                      "w-6 h-8 border rounded transition-all duration-300 shadow",
                      isLit
                        ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]"
                        : "bg-transparent border-white/20"
                    )}
                  />
                );
              })}
              {state.penalties.ao.hansoku_make && (
                <div className="w-6 h-8 bg-red-600 border-2 border-red-500 rounded shadow animate-pulse flex items-center justify-center text-[10px] font-black text-white">
                   HC
                </div>
              )}
            </div>
          </div>

          {/* Scores Display */}
          <div className="flex-1 grid grid-cols-2 gap-4 items-center justify-center p-6 z-10">
            {/* Waza-ari */}
            <div className="flex flex-col items-center justify-center border-r border-black/10 py-4">
              <span className="text-sm font-bold uppercase tracking-wider text-white/60 mb-2">Waza-ari</span>
              <span className="font-display font-black text-[clamp(6rem,22vh,12rem)] leading-none text-blue-200">
                {state.scores.ao.waza_ari}
              </span>
            </div>
            {/* Ippon */}
            <div className="flex flex-col items-center justify-center py-4">
              <span className="text-sm font-bold uppercase tracking-wider text-white/60 mb-2">Ippon</span>
              <span className={cn(
                "font-display font-black text-[clamp(6rem,22vh,12rem)] leading-none text-yellow-500",
                winnerIsAo && "animate-pulse"
              )}>
                {state.scores.ao.ippon}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Main Timer, Osaekomi, Golden Score highlight */}
        <div className="bg-[#111820] flex flex-col justify-between items-center py-10 border-l border-r border-black z-20">
          <div className="text-zinc-500 font-bold uppercase tracking-[0.2em] text-xs">
            {state.is_golden_score ? "Golden Score" : "Match Time"}
          </div>

          {/* Main Timer Display */}
          <div className={cn(
            "p-4 rounded-xl transition-all duration-300 w-full text-center select-none",
            state.is_golden_score && "bg-[hsl(var(--sport-accent))]/10 border border-[hsl(var(--sport-accent))]/25 shadow-md shadow-[hsl(var(--sport-accent))]/5"
          )}>
            <div className="font-mono text-5xl font-black text-white tabular-nums leading-none">
              {formatJudoTimer(getTimerMs(), state.is_golden_score)}
            </div>
          </div>

          {/* Osaekomi timer in center */}
          {state.osaekomi.active_for ? (
            <div className="flex flex-col items-center gap-1.5 bg-zinc-950/70 p-4 rounded-xl border border-zinc-800 animate-pulse w-[90%]">
              <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Hold (Osaekomi)</span>
              <span className={cn("text-lg font-black tracking-wider uppercase", state.osaekomi.active_for === "shiro" ? "text-white" : "text-blue-400")}>
                {state.osaekomi.active_for === "shiro" ? "SHIRO" : "AO"}
              </span>
              <span className="font-mono text-4xl font-black text-[hsl(var(--sport-accent))]">
                {osaekomiSec}s
              </span>
            </div>
          ) : (
            <div className="text-zinc-600 text-[10px] tracking-widest uppercase font-bold">
              {match.timer_status}
            </div>
          )}
        </div>

        {/* Right Side: SHIRO (White) */}
        <div className="bg-card text-card-foreground flex flex-col justify-between p-8 relative overflow-hidden border-r border-zinc-800">
          {/* Athlete Info */}
          <div className="bg-zinc-800/10 p-6 rounded-lg border border-zinc-700/50 flex flex-col gap-1 z-10">
            <span className="text-5xl font-extrabold uppercase text-white tracking-wide truncate">
              {getFighterName("shiro")}
            </span>
            <span className="text-lg text-zinc-400 uppercase tracking-widest mt-1">
              {getFighterClub("shiro") || "Без клубу"}
            </span>
            {/* Shido cards under name */}
            <div className="flex gap-2 mt-3">
              {Array.from({ length: 3 }).map((_, idx) => {
                const isLit = state.penalties.shiro.shido > idx;
                return (
                  <div
                    key={`shiro-card-${idx}`}
                    className={cn(
                      "w-6 h-8 border rounded transition-all duration-300 shadow",
                      isLit
                        ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]"
                        : "bg-transparent border-zinc-700/50"
                    )}
                  />
                );
              })}
              {state.penalties.shiro.hansoku_make && (
                <div className="w-6 h-8 bg-red-600 border-2 border-red-500 rounded shadow animate-pulse flex items-center justify-center text-[10px] font-black text-white">
                  HC
                </div>
              )}
            </div>
          </div>

          {/* Scores Display */}
          <div className="flex-1 grid grid-cols-2 gap-4 items-center justify-center p-6 z-10">
            {/* Waza-ari */}
            <div className="flex flex-col items-center justify-center border-r border-zinc-850 py-4">
              <span className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-2">Waza-ari</span>
              <span className="font-display font-black text-[clamp(6rem,22vh,12rem)] leading-none text-zinc-200">
                {state.scores.shiro.waza_ari}
              </span>
            </div>
            {/* Ippon */}
            <div className="flex flex-col items-center justify-center py-4">
              <span className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-2">Ippon</span>
              <span className={cn(
                "font-display font-black text-[clamp(6rem,22vh,12rem)] leading-none text-yellow-500",
                winnerIsShiro && "animate-pulse"
              )}>
                {state.scores.shiro.ippon}
              </span>
            </div>
          </div>
        </div>

      </div>
    );
  };

  return (
    <div className="w-screen h-screen grid grid-rows-[auto_1fr] bg-[#000] text-white overflow-hidden select-none">
      {/* Header */}
      <header className="bg-[#1c1c1c] grid grid-template-columns-3 items-center px-6 h-14 border-b-2 border-zinc-800 flex justify-between z-30 font-scoreboard">
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
