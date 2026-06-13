import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Trophy, ExternalLink, RotateCcw, AlertTriangle, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { cn, getErrorMessage, getOptimisticTimerUpdate, formatRegistrationName } from "@/lib/utils";
import type { Match } from "@/types/api";
import { formatTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";

interface KataOperatorPanelProps {
  match: Match;
  timerState: TimerState;
  remainingMs: number;
  serverTimeOffset: number;
  onMatchUpdate: (match: Match) => void;
  onRelease: () => void;
  onNextMatch?: () => void;
  disabled?: boolean;
}

export default function KataOperatorPanel({
  match,
  timerState,
  remainingMs,
  serverTimeOffset,
  onMatchUpdate,
  onRelease,
  onNextMatch,
  disabled,
}: Readonly<KataOperatorPanelProps>) {
  const { tid } = useParams<{ tid: string }>();
  const [busy, setBusy] = useState(false);
  const [selectedAka, setSelectedAka] = useState<number | null>(null);
  const [selectedAo, setSelectedAo] = useState<number | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [changeJudgesOpen, setChangeJudgesOpen] = useState(false);

  const customTimeInputRef = useRef<HTMLInputElement>(null);
  const absoluteTimeInputRef = useRef<HTMLInputElement>(null);

  const isCompleted = match.status === "completed";
  const judgesCount = match.judges_count;

  // Reset selected flags when match changes
  useEffect(() => {
    setSelectedAka(null);
    setSelectedAo(null);
  }, [match.id]);

  const updateCategoryJudges = async (count: number, closeModal = false) => {
    setBusy(true);
    try {
      await api.post(`/categories/${match.category}/set_judges_count/`, {
        judges_count: count,
      });
      // Fetch fresh match state since category updates cascades to matches
      const { data } = await api.get<Match>(`/matches/${match.id}/`);
      onMatchUpdate(data);
      setSelectedAka(null);
      setSelectedAo(null);
      toast({ title: `Категорію налаштовано на ${count} суддів.` });
      if (closeModal) {
        setChangeJudgesOpen(false);
      }
    } catch (error_: unknown) {
      const msg = getErrorMessage(error_, "Помилка встановлення кількості суддів");
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleSetJudgesCount = (count: number) => updateCategoryJudges(count, false);

  const handleSetMatchJudgesCount = async (count: number) => {
    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/set_judges_count/`, {
        judges_count: count,
      });
      onMatchUpdate(data);
      setSelectedAka(null);
      setSelectedAo(null);
      toast({ title: `Поєдинок налаштовано на ${count} суддів.` });
      setChangeJudgesOpen(false);
    } catch (error_: unknown) {
      const msg = getErrorMessage(error_, "Помилка встановлення кількості суддів");
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleSetCategoryJudgesCount = (count: number) => updateCategoryJudges(count, true);

  const handleToggleTimer = async (checked: boolean) => {
    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/toggle_timer/`, {
        show_timer: checked,
      });
      onMatchUpdate(data);
      toast({
        title: checked ? "Таймер увімкнено на табло" : "Таймер вимкнено з табло",
      });
    } catch {
      toast({ title: "Помилка керування таймером", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const timerAction = async (path: string, body?: Record<string, unknown>) => {
    const { updatedMatch, reqBody } = getOptimisticTimerUpdate(
      path,
      timerState,
      serverTimeOffset,
      match
    );
    if (updatedMatch) {
      onMatchUpdate(updatedMatch);
    }
    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/timer/${path}/`, {
        ...body,
        ...reqBody,
      });
      onMatchUpdate(data);
    } catch {
      toast({ title: "Помилка керування таймером", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeclareWinner = async () => {
    if (!judgesCount) return;
    if (selectedAka === null || selectedAo === null) {
      toast({ title: "Необхідно обрати рішення суддів", variant: "destructive" });
      return;
    }

    if (selectedAka + selectedAo !== judgesCount) {
      toast({ title: "Некоректна кількість прапорців", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/submit_flags/`, {
        flags_aka: selectedAka,
        flags_ao: selectedAo,
      });
      onMatchUpdate(data);
      toast({ title: "Результат Ката зафіксовано!" });
    } catch (error_: unknown) {
      const msg = getErrorMessage(error_, "Помилка фіксації результату");
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleResetMatch = async () => {
    setBusy(true);
    try {
      const resp = await api.post<Match>(`/matches/${match.id}/reset_match/`);
      onMatchUpdate(resp.data);
      setSelectedAka(null);
      setSelectedAo(null);
      setResetDialogOpen(false);
      toast({ title: "Поєдинок успішно скинуто!" });
    } catch (error_: unknown) {
      toast({
        title: "Не вдалося скинути поєдинок",
        description: getErrorMessage(error_, "Помилка скидання поєдинку"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const openScoreboard = () =>
    window.open(`/scoreboard/tournament/${tid}/tatami/${match.tatami}`, "_blank");

  // Calculations
  const flagsAka = isCompleted ? (match.flags_aka ?? 0) : (selectedAka ?? 0);
  const flagsAo = isCompleted ? (match.flags_ao ?? 0) : (selectedAo ?? 0);
  const allVoted = isCompleted ? true : (selectedAka !== null && selectedAo !== null);

  const suggestedWinner = allVoted
    ? (flagsAka > flagsAo ? "aka" : "ao")
    : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Match info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground bg-zinc-950/20 px-3 py-1.5 rounded-lg border border-border/20">
        <div>
          Раунд {match.round_index}, Поєдинок {match.match_order} · Категорія:{" "}
          <span className="font-bold text-foreground">
            {match.category_name || (match.category as unknown as { name?: string })?.name}
          </span>
        </div>
        {isCompleted && (
          <span className="text-green-400 font-bold uppercase tracking-wider">Завершено</span>
        )}
      </div>

      {judgesCount && judgesCount > 0 ? (
        /* Scoring Screen */
        <div className="space-y-6">
          {/* Header scoring bar with Judges count and change button */}
          <div className="flex justify-between items-center bg-zinc-950/20 px-4 py-2.5 rounded-xl border border-border/20 shadow-md">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Кількість суддів: <span className="text-white font-black">{judgesCount}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-[10px] uppercase tracking-wider font-extrabold border-zinc-700 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-all duration-200"
                onClick={() => setChangeJudgesOpen(true)}
                disabled={disabled || busy}
              >
                Змінити
              </Button>
            </div>
            {isCompleted && (
              <span className="text-[10px] bg-green-500/10 border border-green-500/30 text-green-400 font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full">
                Завершено
              </span>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            {/* AO (Blue) side */}
            <div className="rounded-xl border border-blue-600/30 bg-blue-950/10 p-4 flex flex-col justify-between space-y-4">
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-1">AO</p>
                <p className="font-semibold text-sm text-white/90 whitespace-normal break-words leading-tight">
                  {formatRegistrationName(match.reg_second) || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{match.reg_second?.athlete?.club?.name ?? match.reg_second?.team?.club?.name}</p>
              </div>
              <div className="text-center py-4">
                <span
                  className={cn(
                    "font-mono text-7xl font-black leading-none transition-all duration-300",
                    isCompleted && match.winner === match.reg_second?.id
                      ? "animate-pulse text-green-400"
                      : "text-blue-300"
                  )}
                >
                  {flagsAo}
                </span>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Прапорців</p>
              </div>
            </div>

            {/* Middle Divider / VS */}
            <div className="flex flex-col items-center justify-center px-4 font-black text-muted-foreground text-sm">
              VS
            </div>

            {/* AKA (Red) side */}
            <div className="rounded-xl border border-red-600/30 bg-red-950/10 p-4 flex flex-col justify-between space-y-4">
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-red-400 mb-1">AKA</p>
                <p className="font-semibold text-sm text-white/90 whitespace-normal break-words leading-tight">
                  {formatRegistrationName(match.reg_first) || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{match.reg_first?.athlete?.club?.name ?? match.reg_first?.team?.club?.name}</p>
              </div>
              <div className="text-center py-4">
                <span
                  className={cn(
                    "font-mono text-7xl font-black leading-none transition-all duration-300",
                    isCompleted && match.winner === match.reg_first?.id
                      ? "animate-pulse text-green-400"
                      : "text-red-300"
                  )}
                >
                  {flagsAka}
                </span>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Прапорців</p>
              </div>
            </div>
          </div>

          {/* Linear Flags Selection Panel */}
          <div className="bg-zinc-900/40 border border-zinc-800 p-5 rounded-2xl space-y-6 shadow-lg">
            <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground text-center mb-1">
              {isCompleted ? "Зафіксоване рішення" : "Виберіть кількість прапорців"}
            </h4>

            <div className="space-y-6">
              {/* AKA Row */}
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                    AKA (Червоні)
                  </span>
                  {(isCompleted || selectedAka !== null) && (
                    <span className="text-xs font-mono font-bold text-red-400">
                      Обрано: {flagsAka}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 w-full">
                  {Array.from({ length: judgesCount + 1 }).map((_, k) => {
                    const active = flagsAka === k;
                    return (
                      <Button
                        key={`aka-flag-${k}`}
                        type="button"
                        variant={active ? "destructive" : "outline"}
                        className={cn(
                          "flex-1 font-mono text-lg font-black h-12 rounded-xl transition-all duration-200 border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900",
                          active && "bg-red-600 hover:bg-red-700 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)] scale-105"
                        )}
                        onClick={() => {
                          if (isCompleted || disabled || busy) return;
                          setSelectedAka(k);
                          setSelectedAo(judgesCount - k);
                        }}
                        disabled={disabled || busy || isCompleted}
                      >
                        {k}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* AO Row */}
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                    AO (Сині)
                  </span>
                  {(isCompleted || selectedAo !== null) && (
                    <span className="text-xs font-mono font-bold text-blue-400">
                      Обрано: {flagsAo}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 w-full">
                  {Array.from({ length: judgesCount + 1 }).map((_, m) => {
                    const active = flagsAo === m;
                    return (
                      <Button
                        key={`ao-flag-${m}`}
                        type="button"
                        variant={active ? "default" : "outline"}
                        className={cn(
                          "flex-1 font-mono text-lg font-black h-12 rounded-xl transition-all duration-200 border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900",
                          active && "bg-blue-600 hover:bg-blue-700 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)] scale-105"
                        )}
                        onClick={() => {
                          if (isCompleted || disabled || busy) return;
                          setSelectedAo(m);
                          setSelectedAka(judgesCount - m);
                        }}
                        disabled={disabled || busy || isCompleted}
                      >
                        {m}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Voting Summary and Action */}
            {!isCompleted && (
              <div className="pt-5 border-t border-zinc-800 flex flex-col items-center gap-4">
                {allVoted && suggestedWinner && (
                  <div className="text-center space-y-1 bg-zinc-950/40 px-6 py-2.5 rounded-xl border border-zinc-800/80">
                    <p className="text-sm font-bold uppercase text-white tracking-wide">
                      Рішення:{" "}
                      <span className={suggestedWinner === "aka" ? "text-red-400" : "text-blue-400"}>
                        {suggestedWinner === "aka" ? "Перемога AKA" : "Перемога AO"}
                      </span>{" "}
                      ({flagsAka} : {flagsAo})
                    </p>
                  </div>
                )}
                <Button
                  size="lg"
                  disabled={!allVoted || busy || disabled}
                  onClick={handleDeclareWinner}
                  className="bg-green-600 hover:bg-green-500 text-white font-bold px-10 uppercase tracking-wider text-xs shadow-lg h-11 rounded-xl transition-all duration-200 hover:scale-105"
                >
                  Оголосити переможця
                </Button>
              </div>
            )}
          </div>

          {/* Finished Match Banner */}
          {isCompleted && (
            <div className="p-5 rounded-xl border border-green-500/30 bg-green-950/20 text-green-300 text-center space-y-3 shadow-lg backdrop-blur-md transition-all duration-300">
              <div className="text-xs font-bold uppercase tracking-wider opacity-90 flex items-center justify-center gap-1">
                <Trophy className="w-4 h-4 text-yellow-500 animate-bounce" /> Поєдинок завершено!
              </div>
              <div className="text-lg font-black uppercase text-white tracking-wide">
                Переможець:{" "}
                {match.winner === match.reg_first?.id ? (
                  <span className="text-red-400">AKA ({formatRegistrationName(match.reg_first) || "AKA"})</span>
                ) : (
                  <span className="text-blue-400">AO ({formatRegistrationName(match.reg_second) || "AO"})</span>
                )}
              </div>
              <div className="text-xs opacity-75 font-medium italic">
                Рішення суддів: AKA ({match.flags_aka ?? 0}) vs AO ({match.flags_ao ?? 0})
              </div>
              {onNextMatch && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={onNextMatch}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-6 py-2 shadow-lg border border-amber-400/50 uppercase tracking-wide text-xs animate-pulse"
                >
                  Наступний бій
                </Button>
              )}
            </div>
          )}

          {/* Optional Timer Control Section */}
          <div className="bg-zinc-900/20 border border-border/20 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  Таймер на табло
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Відображати таймер для виступу на глядацькому табло
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={match.show_timer}
                disabled={busy || disabled}
                onClick={() => handleToggleTimer(!match.show_timer)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                  match.show_timer ? "bg-blue-600" : "bg-zinc-700"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out",
                    match.show_timer ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {match.show_timer && (
              <div className="flex flex-col items-center justify-center p-4 border border-zinc-800 bg-zinc-950/40 rounded-xl space-y-4">
                <div className="text-center">
                  <div className="font-mono text-5xl font-black text-yellow-400">
                    {formatTimer(remainingMs)}
                  </div>
                  <div className="text-[10px] text-muted-foreground capitalize mt-1">
                    {timerState.status.replace("_", " ")}
                  </div>
                </div>

                <div className="flex flex-col gap-2 w-full max-w-xs">
                  {timerState.status === "not_started" && (
                    <Button
                      size="sm"
                      className="w-full bg-green-700 hover:bg-green-600 text-white font-bold h-8"
                      disabled={busy || isCompleted}
                      onClick={() => timerAction("start")}
                    >
                      <Play className="w-3.5 h-3.5 mr-1" /> Старт
                    </Button>
                  )}
                  {timerState.status === "running" && (
                    <Button
                      size="sm"
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold h-8"
                      disabled={busy}
                      onClick={() => timerAction("pause")}
                    >
                      <Pause className="w-3.5 h-3.5 mr-1" /> Пауза
                    </Button>
                  )}
                  {timerState.status === "paused" && (
                    <>
                      <Button
                        size="sm"
                        className="w-full bg-green-700 hover:bg-green-600 text-white font-bold h-8"
                        disabled={busy}
                        onClick={() => timerAction("resume")}
                      >
                        <Play className="w-3.5 h-3.5 mr-1" /> Продовжити
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8"
                        disabled={busy}
                        onClick={() => timerAction("reset")}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" /> Скинути
                      </Button>
                    </>
                  )}
                  {timerState.status === "finished" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-8"
                      disabled={busy}
                      onClick={() => timerAction("reset")}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Скинути
                    </Button>
                  )}

                  {/* Time adjustments */}
                  {(timerState.status === "paused" || timerState.status === "not_started") && !isCompleted && (
                    <div className="space-y-2 pt-2 border-t border-border/20">
                      <div className="grid grid-cols-2 gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] font-bold"
                          disabled={busy}
                          onClick={() => timerAction("add_time", { delta_ms: 10000 })}
                        >
                          +10с
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] font-bold"
                          disabled={busy}
                          onClick={() => timerAction("add_time", { delta_ms: -10000 })}
                        >
                          -10с
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] font-bold"
                          disabled={busy}
                          onClick={() => timerAction("add_time", { delta_ms: 30000 })}
                        >
                          +30с
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] font-bold"
                          disabled={busy}
                          onClick={() => timerAction("add_time", { delta_ms: -30000 })}
                        >
                          -30с
                        </Button>
                      </div>

                      {/* Custom input */}
                      <div className="flex gap-1 items-center w-full">
                        <input
                          type="number"
                          placeholder="± сек"
                          ref={customTimeInputRef}
                          disabled={busy}
                          className="w-full h-7 text-xs px-1 border border-input rounded bg-zinc-950 text-white text-center font-mono"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const val = Number.parseInt((e.target as HTMLInputElement).value || "0");
                              if (val !== 0) {
                                timerAction("add_time", { delta_ms: val * 1000 });
                                (e.target as HTMLInputElement).value = "";
                              }
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs font-bold shrink-0 px-2.5"
                          disabled={busy}
                          onClick={() => {
                            const val = Number.parseInt(customTimeInputRef.current?.value || "0");
                            if (val !== 0) {
                              timerAction("add_time", { delta_ms: val * 1000 });
                              if (customTimeInputRef.current) customTimeInputRef.current.value = "";
                            }
                          }}
                        >
                          ОК
                        </Button>
                      </div>

                      {/* Absolute input */}
                      <div className="flex gap-1 items-center w-full">
                        <input
                          type="number"
                          placeholder="Задати сек"
                          ref={absoluteTimeInputRef}
                          disabled={busy}
                          className="w-full h-7 text-xs px-1 border border-input rounded bg-zinc-950 text-white text-center font-mono"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const val = Number.parseInt((e.target as HTMLInputElement).value || "0");
                              if (val > 0) {
                                timerAction("set_duration", { duration_ms: val * 1000 });
                                (e.target as HTMLInputElement).value = "";
                              }
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs font-bold shrink-0 px-2.5"
                          disabled={busy}
                          onClick={() => {
                            const val = Number.parseInt(absoluteTimeInputRef.current?.value || "0");
                            if (val > 0) {
                              timerAction("set_duration", { duration_ms: val * 1000 });
                              if (absoluteTimeInputRef.current) absoluteTimeInputRef.current.value = "";
                            }
                          }}
                        >
                          ОК
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-border/40">
            {isCompleted && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setResetDialogOpen(true)}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Переграти бій (Скинути)
              </Button>
            )}

            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={onRelease} disabled={busy || disabled}>
                Звільнити татамі
              </Button>
              <Button variant="outline" size="sm" onClick={openScoreboard} disabled={busy}>
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Scoreboard
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* Setup Screen */
        <div className="flex flex-col items-center justify-center py-16 px-4 border border-border bg-zinc-900/40 backdrop-blur-md rounded-2xl shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <Trophy className="w-12 h-12 text-yellow-500 mx-auto opacity-80" />
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Налаштування Карате Ката</h3>
            <p className="text-xs text-muted-foreground max-w-md">
              Оберіть кількість суддів для цієї категорії. Це рішення буде застосовано до всіх поєдинків у цій категорії.
            </p>
          </div>
          <div className="flex gap-4">
            <Button
              size="lg"
              disabled={busy || disabled}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold px-8 py-6 rounded-xl text-base transition-all duration-200 hover:scale-105"
              onClick={() => handleSetJudgesCount(3)}
            >
              3 судді
            </Button>
            <Button
              size="lg"
              disabled={busy || disabled}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold px-8 py-6 rounded-xl text-base transition-all duration-200 hover:scale-105"
              onClick={() => handleSetJudgesCount(5)}
            >
              5 суддів
            </Button>
          </div>
        </div>
      )}

      {/* ── Reset dialog ── */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Скинути та переграти поєдинок
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>Ви впевнені, що хочете повністю скинути стан поєдинку Ката?</p>
            <p className="font-semibold text-foreground/90">Це призведе до:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Скидання прапорців AKA та AO на 0</li>
              <li>Повернення поєдинку до статусу "Заплановано"</li>
              <li>Вилучення поточного переможця з наступного кола змагань</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Скасувати
            </Button>
            <Button variant="destructive" disabled={busy} onClick={handleResetMatch}>
              Скинути та почати заново
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Judges count dialog ── */}
      <Dialog open={changeJudgesOpen} onOpenChange={setChangeJudgesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" /> Зміна кількості суддів
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-4">
            <p>
              Ви можете змінити кількість суддів (3 або 5) для цього поєдинку або для всієї категорії.
            </p>
            {(isCompleted || match.flags_aka !== null || match.flags_ao !== null) && (
              <div className="p-3 bg-red-950/20 border border-red-500/30 rounded-lg flex gap-2 text-red-200 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>
                  <strong>Увага:</strong> Цей поєдинок уже оцінено. Зміна кількості суддів призведе до <strong>скидання поточних результатів</strong>!
                </span>
              </div>
            )}

            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <p className="text-xs font-bold text-white uppercase tracking-wider">Для цього поєдинку:</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full font-bold"
                    onClick={() => handleSetMatchJudgesCount(3)}
                    disabled={busy}
                  >
                    3 судді
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full font-bold"
                    onClick={() => handleSetMatchJudgesCount(5)}
                    disabled={busy}
                  >
                    5 суддів
                  </Button>
                </div>
              </div>

              <div className="space-y-1 pt-2 border-t border-zinc-800">
                <p className="text-xs font-bold text-white uppercase tracking-wider">Для всієї категорії (всі бої):</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full font-bold bg-zinc-800 hover:bg-zinc-700 text-white"
                    onClick={() => handleSetCategoryJudgesCount(3)}
                    disabled={busy}
                  >
                    3 судді
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full font-bold bg-zinc-800 hover:bg-zinc-700 text-white"
                    onClick={() => handleSetCategoryJudgesCount(5)}
                    disabled={busy}
                  >
                    5 суддів
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setChangeJudgesOpen(false)}>
              Скасувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
