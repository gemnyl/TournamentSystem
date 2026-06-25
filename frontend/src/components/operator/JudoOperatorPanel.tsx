import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeAdjustmentInput } from "./TimeAdjustmentInput";
import { AbsoluteTimeInput } from "./AbsoluteTimeInput";
import { TimePresetSelect } from "./TimePresetSelect";
import { CompletedBanner } from "./CompletedBanner";
import { WinnerSelectDialog } from "./WinnerSelectDialog";
import { ResetMatchDialog } from "./ResetMatchDialog";
import { toast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { cn, formatAthleteName, formatRegistrationName, parseJudoMatchState } from "@/lib/utils";
import type { Match, JudoMatchState } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { formatTimer } from "@/hooks/useTimer";
import { getRoundName } from "@/lib/bracketUtils";

interface JudoOperatorPanelProps {
  match: Match;
  timerState: TimerState;
  remainingMs: number;
  serverTimeOffset: number;
  onMatchUpdate: (match: Match) => void;
  onRelease: () => void;
  onCompleteAndNext?: (winner: "shiro" | "ao", winMethod: string) => void;
  onNextMatch?: () => void;
  disabled?: boolean;
  allMatches?: Match[];
  bracketFormat?: string;
}

export default function JudoOperatorPanel({
  match,
  timerState,
  remainingMs,
  serverTimeOffset,
  onMatchUpdate,
  onRelease,
  onNextMatch,
  allMatches,
  bracketFormat,
}: Readonly<JudoOperatorPanelProps>) {
  const [busy, setBusy] = useState(false);
  const [undoMode, setUndoMode] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [winnerDialog, setWinnerDialog] = useState<"shiro" | "ao" | null>(null);
  const [winMethod, setWinMethod] = useState("ippon");

  const customTimeInputRef = useRef<HTMLInputElement>(null);
  const { tid } = useParams<{ tid: string }>();
  const absoluteTimeInputRef = useRef<HTMLInputElement>(null);

  const openScoreboard = () =>
    window.open(`/scoreboard/tournament/${tid}/tatami/${match.tatami}`, "_blank");

  const handleScoreAction = (corner: "shiro" | "ao", actionType: string) => {
    if (undoMode) {
      handleRulesetEvent(`SUB_${actionType}`, { corner });
      setUndoMode(false);
    } else {
      handleRulesetEvent(`ADD_${actionType}`, { corner });
    }
  };

  const handleCustomTimeAdjust = (sign: number) => {
    const inputElement = customTimeInputRef.current;
    if (!inputElement || !inputElement.value) return;
    const secs = parseInt(inputElement.value, 10);
    if (isNaN(secs) || secs <= 0) return;
    timerAction("add_time", { delta_ms: sign * secs * 1000 });
    inputElement.value = "";
  };

  const isCompleted = match.status === "completed";
  const rawState = match.match_state || {};
  const state: JudoMatchState = parseJudoMatchState(rawState);

  const [osaekomiSec, setOsaekomiSec] = useState(0);

  useEffect(() => {
    if (!state.osaekomi.active_for || !state.osaekomi.start_timestamp) {
      setOsaekomiSec(0);
      return;
    }
    const interval = setInterval(() => {
      const start = Number(state.osaekomi.start_timestamp);
      const elapsed = Math.floor((Date.now() + serverTimeOffset - start) / 1000);
      setOsaekomiSec(Math.max(0, elapsed));
    }, 100);
    return () => clearInterval(interval);
  }, [state.osaekomi.active_for, state.osaekomi.start_timestamp, serverTimeOffset]);

  const handleRulesetEvent = async (
    typeOfEvent: string,
    eventPayload: Record<string, unknown> = {}
  ) => {
    if (busy || isCompleted) {
      return;
    }
    setBusy(true);
    try {
      const response = await api.post<Match>(`/matches/${match.id}/ruleset_event/`, {
        event_type: typeOfEvent,
        payload: eventPayload,
      });
      if (response.data) {
        onMatchUpdate(response.data);
      }
    } catch (err: unknown) {
      const errMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Помилка при виконанні дії";
      toast({ title: errMsg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeclareWinner = async () => {
    if (!winnerDialog) {
      return;
    }
    setBusy(true);
    try {
      const payload = {
        corner: winnerDialog === "shiro" ? "aka" : "ao",
        win_method: winMethod,
      };
      const response = await api.post<Match>(
        `/matches/${match.id}/set_winner/`,
        payload
      );
      if (response.data) {
        onMatchUpdate(response.data);
      }
      toast({ title: "Переможця успішно оголошено!" });
      setWinnerDialog(null);
    } catch (err: unknown) {
      toast({ title: "Помилка при оголошенні переможця", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleResetMatch = async () => {
    setBusy(true);
    try {
      const response = await api.post<Match>(`/matches/${match.id}/reset_match/`);
      toast({ title: "Поєдинок успішно скинуто!" });
      setResetDialogOpen(false);
      if (response.data) {
        onMatchUpdate(response.data);
      }
    } catch (err: unknown) {
      toast({ title: "Не вдалося скинути поєдинок", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const timerAction = async (actionPath: string, actionBody?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await api.post<Match>(
        `/matches/${match.id}/timer/${actionPath}/`,
        actionBody ?? {}
      );
      if (response.data) {
        onMatchUpdate(response.data);
      }
    } catch (err: unknown) {
      toast({ title: "Помилка керування таймером", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const getFighterName = (corner: "shiro" | "ao") => {
    const reg = corner === "shiro" ? match.reg_first : match.reg_second;
    const athlete = corner === "shiro" ? match.athlete_first : match.athlete_second;
    if (athlete) return formatAthleteName(athlete);
    if (reg) return formatRegistrationName(reg);
    return "TBD";
  };

  const getFighterClub = (corner: "shiro" | "ao") => {
    const reg = corner === "shiro" ? match.reg_first : match.reg_second;
    const athlete = corner === "shiro" ? match.athlete_first : match.athlete_second;
    if (athlete) return reg?.team?.name ?? "";
    return reg?.athlete?.club?.name ?? reg?.team?.club?.name ?? "";
  };

  const winnerDisplayName = match.winner ? (
    match.winner === match.reg_first?.id ? getFighterName("shiro") : getFighterName("ao")
  ) : "Невідомо";

  // Display timer counts forward in Golden Score
  const displayTimer = () => {
    if (state.is_golden_score) {
      let gsMs = timerState.elapsed_ms;
      if (timerState.status === "running" && timerState.started_at_ms) {
        gsMs += (Date.now() + serverTimeOffset - timerState.started_at_ms);
      }
      const totalSeconds = Math.floor(gsMs / 1000);
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return formatTimer(remainingMs);
  };

  return (
    <div className="flex flex-col gap-6 w-full p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-white shadow-2xl">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h2 className="text-lg font-black tracking-wide text-zinc-100">
            ДЗЮДО IJF · {getRoundName(match, allMatches ?? [], bracketFormat)}
          </h2>
          <p className="text-xs text-zinc-400">
            Категорія: {match.category_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.is_golden_score && (
            <span className="text-xs font-extrabold uppercase px-2 py-1 bg-[hsl(var(--sport-accent))]/20 border border-[hsl(var(--sport-accent))]/40 text-[hsl(var(--sport-accent))] rounded animate-pulse">
              Golden Score
            </span>
          )}
        </div>
      </div>

      {/* Undo Action Toggle & Alert */}
      <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-zinc-800/40 bg-zinc-950/40 shadow-inner">
        <Button
          size="sm"
          variant={undoMode ? "destructive" : "outline"}
          onClick={() => setUndoMode((prev) => !prev)}
          disabled={busy || isCompleted}
          className={cn(
            "h-8 px-4 text-xs gap-1.5 font-bold transition-all duration-200",
            undoMode ? "animate-pulse" : ""
          )}
        >
          ⟲ {undoMode ? "Режим скасування активний..." : "Скасувати попередню дію (Undo)"}
        </Button>
        {undoMode && (
          <span className="text-[10px] font-bold text-destructive animate-pulse mt-0.5 text-center block">
            ⚠ Увага! Оберіть дію нижче, яку необхідно скасувати.
          </span>
        )}
      </div>

      {/* Time Expired / Decision Banner */}
      {remainingMs === 0 && !isCompleted && !state.is_golden_score && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/20 text-amber-300 text-center space-y-3 shadow-lg">
          <div className="text-xs font-bold uppercase tracking-wider opacity-90">
            ⏰ Регулярний час поєдинку вичерпано!
          </div>
          {state.scores.shiro.waza_ari !== state.scores.ao.waza_ari ? (
            (() => {
              const suggestedWinner = state.scores.shiro.waza_ari > state.scores.ao.waza_ari ? "shiro" : "ao";
              return (
                <>
                  <div className="text-sm font-black uppercase text-white tracking-wide">
                    Рекомендоване рішення: Перемога{" "}
                    <span className={suggestedWinner === "shiro" ? "text-zinc-300" : "text-blue-400"}>
                      {suggestedWinner === "shiro" ? "Shiro (Білий)" : "Ao (Синій)"}
                    </span>
                  </div>
                  <div className="text-xs opacity-75 font-medium italic">
                    Причина: перевага за оцінками Waza-ari ({state.scores.shiro.waza_ari}:{state.scores.ao.waza_ari})
                  </div>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setWinMethod("wazaari");
                      setWinnerDialog(suggestedWinner);
                    }}
                    className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-2 uppercase tracking-wide text-xs"
                  >
                    Підтвердити перемогу {suggestedWinner === "shiro" ? "Shiro" : "Ao"}
                  </Button>
                </>
              );
            })()
          ) : (
            <>
              <div className="text-sm font-black uppercase text-white tracking-wide">
                Оцінки рівні: {state.scores.shiro.waza_ari}:{state.scores.ao.waza_ari}. Необхідно перейти до Golden Score!
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => handleRulesetEvent("TOGGLE_GOLDEN_SCORE")}
                className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold px-6 py-2 uppercase tracking-wide text-xs animate-pulse"
              >
                Увімкнути Golden Score
              </Button>
            </>
          )}
        </div>
      )}

      {/* Main split screen */}
      <div className="grid grid-cols-[1fr_180px_1fr] gap-4 items-stretch">

        {/* Left Side: Shiro (White) */}
        <div className="flex flex-col gap-4 p-4 rounded-xl border border-zinc-700 bg-zinc-800/40 text-center">
          <div>
            <span className="text-xs font-bold text-zinc-400 tracking-widest uppercase">SHIRO (Білий)</span>
            <h3 className="font-extrabold text-base truncate text-white">{getFighterName("shiro")}</h3>
            <p className="text-xs text-zinc-400">{getFighterClub("shiro") || "Без клубу"}</p>
          </div>

          <div className="flex justify-around items-center py-2 bg-black/10 rounded-lg">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Waza-ari</span>
              <span className="font-display font-black text-5xl text-zinc-200">
                {state.scores.shiro.waza_ari}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Ippon</span>
              <span className="font-display font-black text-5xl text-yellow-500">
                {state.scores.shiro.ippon}
              </span>
            </div>
          </div>

          {/* Penalties Shido */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
            <span>Shido:</span>
            <div className="flex gap-1">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={`shiro-shido-${idx}`}
                  className={cn(
                    "w-3 h-4 border rounded transition-all duration-300",
                    state.penalties.shiro.shido > idx
                      ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]"
                      : "bg-transparent border-zinc-600"
                  )}
                />
              ))}
            </div>
            {state.penalties.shiro.hansoku_make && (
              <span className="text-red-500 font-extrabold uppercase ml-1 animate-pulse">HC</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              className="bg-gray-100 hover:bg-gray-200 text-zinc-900 font-black py-4 text-xs uppercase"
              disabled={busy || isCompleted}
              onClick={() => handleScoreAction("shiro", "IPPON")}
            >
              Ippon
            </Button>
            <Button
              className="bg-gray-100 hover:bg-gray-200 text-zinc-900 font-bold border border-zinc-300 text-xs py-2 uppercase"
              disabled={busy || isCompleted}
              onClick={() => handleScoreAction("shiro", "WAZA_ARI")}
            >
              Waza-ari
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="bg-[hsl(var(--sport-accent))] hover:bg-[hsl(var(--sport-accent))]/90 text-black font-extrabold text-xs"
                disabled={busy || isCompleted}
                onClick={() => handleScoreAction("shiro", "SHIDO")}
              >
                Shido
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs"
                disabled={busy || isCompleted}
                onClick={() => handleScoreAction("shiro", "HANSOKU_MAKE")}
              >
                H-Make
              </Button>
            </div>
          </div>
        </div>

        {/* Center: Osaekomi & GS Controls */}
        <div className="flex flex-col items-center justify-between py-2 border-l border-r border-zinc-800 px-3 min-w-[140px]">
          {/* Timer Display */}
          <div className="flex flex-col items-center gap-1 text-center w-full">
            <div className={cn(
              "font-mono text-3xl font-black tracking-wider tabular-nums leading-none",
              state.is_golden_score ? "text-yellow-400" : "text-white"
            )}>
              {displayTimer()}
            </div>
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest">{timerState.status}</span>

            {/* Timer Actions */}
            <div className="flex gap-1 w-full mt-2">
              {timerState.status === "not_started" && (
                <Button size="sm" className="flex-1 bg-green-700 hover:bg-green-600 text-white font-bold text-[10px] py-1"
                  disabled={busy || isCompleted}
                  onClick={() => timerAction("start")}>
                  Start
                </Button>
              )}
              {timerState.status === "running" && (
                <Button size="sm" className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px] py-1"
                  disabled={busy}
                  onClick={() => timerAction("pause")}>
                  Pause
                </Button>
              )}
              {timerState.status === "paused" && (
                <Button size="sm" className="flex-1 bg-green-700 hover:bg-green-600 text-white font-bold text-[10px] py-1"
                  disabled={busy}
                  onClick={() => timerAction("resume")}>
                  Resume
                </Button>
              )}
              {timerState.status !== "not_started" && (
                <Button size="sm" variant="outline" className="px-1 text-zinc-500 text-[9px]"
                  disabled={busy}
                  onClick={() => timerAction("reset")}>
                  Reset
                </Button>
              )}
            </div>

            {/* Time adjustments */}
            {(timerState.status === "paused" || timerState.status === "not_started") && !isCompleted && (
              <div className="flex flex-col gap-1.5 w-full mt-3 border-t border-zinc-800 pt-2 px-1">
                <div className="grid grid-cols-2 gap-1 w-full">
                  <Button
                    onClick={() => timerAction("add_time", { delta_ms: 30000 })}
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px] font-bold"
                  >
                    +30s
                  </Button>
                  <Button
                    onClick={() => timerAction("add_time", { delta_ms: -30000 })}
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px] font-bold"
                  >
                    -30s
                  </Button>
                  <Button
                    onClick={() => timerAction("add_time", { delta_ms: 10000 })}
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px] font-bold"
                  >
                    +10s
                  </Button>
                  <Button
                    onClick={() => timerAction("add_time", { delta_ms: -10000 })}
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px] font-bold"
                  >
                    -10s
                  </Button>
                </div>
                <TimeAdjustmentInput
                  onAdjust={handleCustomTimeAdjust}
                  inputRef={customTimeInputRef}
                  disabled={busy}
                />
                 <AbsoluteTimeInput
                  onSetDuration={(val) => timerAction("set_duration", { duration_ms: val * 1000 })}
                  inputRef={absoluteTimeInputRef}
                  disabled={busy}
                />
                <TimePresetSelect
                  disabled={busy}
                  onSelectDuration={(val) => timerAction("set_duration", { duration_ms: val * 1000 })}
                />
              </div>
            )}
          </div>

          {/* Osaekomi Section */}
          <div className="w-full flex flex-col gap-2 border-t border-zinc-800 pt-3 mt-3">
            <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 text-center">Osaekomi</span>

            {state.osaekomi.active_for ? (
              <div className="flex flex-col items-center gap-1 bg-zinc-950 p-2 rounded border border-zinc-800">
                <span className={cn("text-xs font-black uppercase", state.osaekomi.active_for === "shiro" ? "text-white" : "text-blue-400")}>
                  {state.osaekomi.active_for === "shiro" ? "SHIRO" : "AO"}
                </span>
                <span className="font-mono text-2xl font-black text-[hsl(var(--sport-accent))]">
                  {osaekomiSec}s
                </span>
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-extrabold text-[10px] mt-1 h-7"
                  disabled={busy || isCompleted}
                  onClick={() => handleRulesetEvent("STOP_OSAEKOMI")}
                >
                  Toketa (Stop)
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Button
                  className="bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] h-7"
                  disabled={busy || isCompleted}
                  onClick={() => handleRulesetEvent("START_OSAEKOMI", { corner: "shiro", start_timestamp: Date.now() + serverTimeOffset })}
                >
                  Osaekomi Shiro
                </Button>
                <Button
                  className="bg-zinc-800 hover:bg-zinc-700 text-blue-400 text-[10px] h-7"
                  disabled={busy || isCompleted}
                  onClick={() => handleRulesetEvent("START_OSAEKOMI", { corner: "ao", start_timestamp: Date.now() + serverTimeOffset })}
                >
                  Osaekomi Ao
                </Button>
              </div>
            )}
          </div>

          {/* Golden Score Mode Toggle */}
          <div className="w-full border-t border-zinc-800 pt-3 mt-3">
            <Button
              className={cn(
                "w-full text-[10px] font-black h-8 border uppercase tracking-wider",
                state.is_golden_score
                  ? "bg-[hsl(var(--sport-accent))]/20 border-[hsl(var(--sport-accent))]/40 text-[hsl(var(--sport-accent))]"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
              )}
              disabled={busy || isCompleted}
              onClick={() => handleRulesetEvent("TOGGLE_GOLDEN_SCORE")}
            >
              Golden Score
            </Button>
          </div>
        </div>

        {/* Right Side: Ao (Blue) */}
        <div className="flex flex-col gap-4 p-4 rounded-xl border border-blue-900 bg-blue-950/20 text-center">
          <div>
            <span className="text-xs font-bold text-blue-400 tracking-widest uppercase">AO (Синій)</span>
            <h3 className="font-extrabold text-base truncate text-white">{getFighterName("ao")}</h3>
            <p className="text-xs text-zinc-400">{getFighterClub("ao") || "Без клубу"}</p>
          </div>

          <div className="flex justify-around items-center py-2 bg-black/10 rounded-lg">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Waza-ari</span>
              <span className="font-display font-black text-5xl text-blue-300">
                {state.scores.ao.waza_ari}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Ippon</span>
              <span className="font-display font-black text-5xl text-yellow-500">
                {state.scores.ao.ippon}
              </span>
            </div>
          </div>

          {/* Penalties Shido */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
            <span>Shido:</span>
            <div className="flex gap-1">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={`ao-shido-${idx}`}
                  className={cn(
                    "w-3 h-4 border rounded transition-all duration-300",
                    state.penalties.ao.shido > idx
                      ? "bg-[hsl(var(--sport-accent))] border-[hsl(var(--sport-accent))]"
                      : "bg-transparent border-zinc-600"
                  )}
                />
              ))}
            </div>
            {state.penalties.ao.hansoku_make && (
              <span className="text-red-500 font-extrabold uppercase ml-1 animate-pulse">HC</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              className="bg-blue-800 hover:bg-blue-900 text-white font-black py-4 text-xs uppercase"
              disabled={busy || isCompleted}
              onClick={() => handleScoreAction("ao", "IPPON")}
            >
              Ippon
            </Button>
            <Button
              className="bg-blue-800 hover:bg-blue-900 text-white font-bold border border-blue-900 text-xs py-2 uppercase"
              disabled={busy || isCompleted}
              onClick={() => handleScoreAction("ao", "WAZA_ARI")}
            >
              Waza-ari
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="bg-[hsl(var(--sport-accent))] hover:bg-[hsl(var(--sport-accent))]/90 text-black font-extrabold text-xs"
                disabled={busy || isCompleted}
                onClick={() => handleScoreAction("ao", "SHIDO")}
              >
                Shido
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs"
                disabled={busy || isCompleted}
                onClick={() => handleScoreAction("ao", "HANSOKU_MAKE")}
              >
                H-Make
              </Button>
            </div>
          </div>
        </div>

      </div>

      {/* Completed State Banner */}
      {isCompleted && (
        <CompletedBanner
          winnerDisplayName={winnerDisplayName}
          winMethodText={match.win_method === "ippon" ? "Ippon" : match.win_method === "wazaari" ? "Waza-ari" : match.win_method === "hansoku" ? "Hansoku-make (HC)" : "Рішення (Decision)"}
          busy={busy}
          onNextMatch={onNextMatch}
        />
      )}

      {/* Bottom Actions */}
      <div className="flex justify-between items-center pt-3 border-t border-zinc-800">
          <div className="flex gap-2">
            {!isCompleted && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => { setWinMethod("ippon"); setWinnerDialog("shiro"); }}
                >
                  Переможець SHIRO
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="border-blue-900 text-blue-400 hover:bg-blue-950/30"
                  onClick={() => { setWinMethod("ippon"); setWinnerDialog("ao"); }}
                >
                  Переможець AO
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setResetDialogOpen(true)}
              disabled={busy}
              className="border-red-500/30 text-red-400 hover:bg-red-950/30"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Скинути бій
            </Button>
          </div>
        <div className="flex gap-2 pt-0.5">
          <Button size="sm" variant="outline" onClick={onRelease} disabled={busy}>
            Звільнити татамі
          </Button>
          <Button size="sm" variant="outline" onClick={openScoreboard} disabled={busy}>
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Scoreboard
          </Button>
        </div>
      </div>

      {/* Winner Dialog */}
      <WinnerSelectDialog
        open={!!winnerDialog}
        onOpenChange={(o) => !o && setWinnerDialog(null)}
        winnerName={winnerDialog ? getFighterName(winnerDialog) : ""}
        winnerColorClass={winnerDialog === "shiro" ? "text-zinc-300" : "text-blue-400"}
        winMethod={winMethod}
        onWinMethodChange={setWinMethod}
        options={[
          { value: "ippon", label: "Ippon" },
          { value: "wazaari", label: "Waza-ari" },
          { value: "hansoku", label: "Hansoku-make (HC)" },
          { value: "withdrawal", label: "Зняття суперника (Withdrawal)" }
        ]}
        onCancel={() => setWinnerDialog(null)}
        onConfirm={handleDeclareWinner}
        busy={busy}
      />

      {/* Reset dialog */}
      <ResetMatchDialog
        onConfirm={handleResetMatch}
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        busy={busy}
      >
        <li>Скидання всіх балів, попереджень, утримань та Golden Score</li>
      </ResetMatchDialog>

    </div>
  );
}
