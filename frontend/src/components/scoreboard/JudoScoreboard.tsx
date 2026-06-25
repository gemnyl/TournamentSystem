import { cn, parseJudoMatchState, getFighterName, getFighterClub } from "@/lib/utils";
import type { Match, JudoMatchState, CategoryResult } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import ScoreboardStandings from "./ScoreboardStandings";

interface JudoScoreboardProps {
  match: Match | null;
  timerState: TimerState;
  remainingMs: number;
  tatamiNumber: string;
  categoryResults?: CategoryResult[];
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



  const renderStandings = () => (
    <ScoreboardStandings
      categoryResults={categoryResults}
      resultsCategoryName={resultsCategoryName}
      sportAccentClass="bg-[#0b0f15]"
    />
  );

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
              {getFighterName(match, "ao")}
            </span>
            <span className="text-lg text-white/70 uppercase tracking-widest mt-1">
              {getFighterClub(match, "ao") || "Без клубу"}
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
              {getFighterName(match, "shiro")}
            </span>
            <span className="text-lg text-zinc-400 uppercase tracking-widest mt-1">
              {getFighterClub(match, "shiro") || "Без клубу"}
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
