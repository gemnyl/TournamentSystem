import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeAdjustmentInput } from "./TimeAdjustmentInput";
import { AbsoluteTimeInput } from "./AbsoluteTimeInput";
import { TimePresetSelect } from "./TimePresetSelect";
import { CompletedBanner } from "./CompletedBanner";
import { WinnerSelectDialog } from "./WinnerSelectDialog";
import { ResetMatchDialog } from "./ResetMatchDialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { cn, formatAthleteName, formatRegistrationName, parseTaekwondoMatchState } from "@/lib/utils";
import type { Match, TaekwondoMatchState } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { formatTimer } from "@/hooks/useTimer";
import { getRoundName } from "@/lib/bracketUtils";

interface TaekwondoOperatorPanelProps {
  match: Match;
  timerState: TimerState;
  remainingMs: number;
  serverTimeOffset: number;
  onMatchUpdate: (match: Match) => void;
  onRelease: () => void;
  onCompleteAndNext?: (winner: "chung" | "hong", winMethod: string) => void;
  onNextMatch?: () => void;
  disabled?: boolean;
  allMatches?: Match[];
  bracketFormat?: string;
}

export default function TaekwondoOperatorPanel({
  match,
  timerState,
  remainingMs,
  onMatchUpdate,
  onRelease,
  onNextMatch,
  allMatches,
  bracketFormat,
}: Readonly<TaekwondoOperatorPanelProps>) {
  const [busy, setBusy] = useState(false);
  const [undoMode, setUndoMode] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [nextRoundConfirmOpen, setNextRoundConfirmOpen] = useState(false);
  const [tieDialogOpen, setTieDialogOpen] = useState(false);
  const [winnerDialog, setWinnerDialog] = useState<"chung" | "hong" | null>(null);
  const [winMethod, setWinMethod] = useState("points");
  const [gamJeomConfirmOpen, setGamJeomConfirmOpen] = useState<{ corner: "chung" | "hong"; isUndo: boolean } | null>(null);

  const handlePointsAction = (corner: "chung" | "hong", points: number) => {
    if (undoMode) {
      handleRulesetEvent("SUB_POINTS", { corner, points });
      setUndoMode(false);
    } else {
      handleRulesetEvent("ADD_POINTS", { corner, points });
    }
  };

  const handleGamJeomAction = (corner: "chung" | "hong") => {
    if (remainingMs <= 10000) {
      setGamJeomConfirmOpen({ corner, isUndo: undoMode });
    } else {
      if (undoMode) {
        handleRulesetEvent("SUB_GAM_JEOM", { corner, is_passive: false, remaining_seconds: Math.ceil(remainingMs / 1000) });
        setUndoMode(false);
      } else {
        handleRulesetEvent("ADD_GAM_JEOM", { corner, is_passive: false, remaining_seconds: Math.ceil(remainingMs / 1000) });
      }
    }
  };

  const customTimeInputRef = useRef<HTMLInputElement>(null);
  const { tid } = useParams<{ tid: string }>();
  const absoluteTimeInputRef = useRef<HTMLInputElement>(null);

  const openScoreboard = () =>
    window.open(`/scoreboard/tournament/${tid}/tatami/${match.tatami}`, "_blank");

  const handleCustomTimeAdjust = (sign: number) => {
    const val = customTimeInputRef.current?.value;
    if (!val) return;
    const secs = parseInt(val, 10);
    if (isNaN(secs) || secs <= 0) return;
    timerAction("add_time", { delta_ms: sign * secs * 1000 });
    if (customTimeInputRef.current) {
      customTimeInputRef.current.value = "";
    }
  };

  const handleNextRoundClick = () => {
    if (state.scores.chung === state.scores.hong) {
      setTieDialogOpen(true);
    } else {
      setNextRoundConfirmOpen(true);
    }
  };

  const isCompleted = match.status === "completed";
  const rawState = match.match_state || {};
  const state: TaekwondoMatchState = parseTaekwondoMatchState(rawState);

  const handleRulesetEvent = async (eventType: string, payload: Record<string, unknown> = {}) => {
    if (busy || isCompleted) return;
    setBusy(true);
    try {
      const { data } = await api.post<Match>(
        `/matches/${match.id}/ruleset_event/`,
        { event_type: eventType, payload }
      );
      onMatchUpdate(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка при виконанні дії";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeclareWinner = async () => {
    if (!winnerDialog) return;
    setBusy(true);
    try {
      const { data } = await api.post<Match>(
        `/matches/${match.id}/set_winner/`,
        { corner: winnerDialog === "chung" ? "aka" : "ao", win_method: winMethod },
      );
      onMatchUpdate(data);
      toast({ title: "Переможця успішно оголошено!" });
      setWinnerDialog(null);
    } catch {
      toast({ title: "Помилка при оголошенні переможця", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleResetMatch = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/reset_match/`);
      toast({ title: "Поєдинок успішно скинуто!" });
      setResetDialogOpen(false);
      onMatchUpdate(data);
    } catch {
      toast({ title: "Не вдалося скинути поєдинок", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const timerAction = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/timer/${path}/`, body ?? {});
      onMatchUpdate(data);
    } catch {
      toast({ title: "Помилка керування таймером", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const getFighterName = (corner: "chung" | "hong") => {
    const reg = corner === "chung" ? match.reg_first : match.reg_second;
    const athlete = corner === "chung" ? match.athlete_first : match.athlete_second;
    if (athlete) return formatAthleteName(athlete);
    if (reg) return formatRegistrationName(reg);
    return "TBD";
  };

  const getFighterClub = (corner: "chung" | "hong") => {
    const reg = corner === "chung" ? match.reg_first : match.reg_second;
    const athlete = corner === "chung" ? match.athlete_first : match.athlete_second;
    if (athlete) return reg?.team?.name ?? "";
    return reg?.athlete?.club?.name ?? reg?.team?.club?.name ?? "";
  };

  const winnerDisplayName = match.winner ? (
    match.winner === match.reg_first?.id ? getFighterName("chung") : getFighterName("hong")
  ) : "Невідомо";

  return (
    <div className="flex flex-col gap-6 w-full p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-white shadow-2xl">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h2 className="text-lg font-black tracking-wide text-zinc-100">
            ТХЕКВОНДО WT · {getRoundName(match, allMatches ?? [], bracketFormat)}
          </h2>
          <p className="text-xs text-zinc-400">
            Категорія: {match.category_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-2 py-1 bg-zinc-800 rounded text-zinc-400">
            Раунд {state.current_round}
          </span>
        </div>
      </div>

      {/* Undo Action Toggle & Alert */}
      <div className="flex flex-col items-center gap-1 bg-zinc-950/40 p-2.5 rounded-xl border border-zinc-800/40">
        <Button
          variant={undoMode ? "destructive" : "outline"}
          size="sm"
          disabled={isCompleted || busy}
          onClick={() => setUndoMode(!undoMode)}
          className={cn(
            "gap-1.5 font-bold transition-all duration-200 text-xs px-4 h-8",
            undoMode && "animate-pulse"
          )}
        >
          ⟲ {undoMode ? "Скасування... Оберіть дію для зняття" : "Скасувати дію (Undo)"}
        </Button>
        {undoMode && (
          <div className="text-[11px] font-bold text-destructive animate-pulse mt-1">
            ⚠ Режим скасування активний! Натисніть кнопку відповідного балу або Gam-jeom нижче, щоб зняти його.
          </div>
        )}
      </div>

      {/* Time Expired / Next Round Banner */}
      {remainingMs === 0 && !isCompleted && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/20 text-amber-300 text-center space-y-3 shadow-lg">
          <div className="text-xs font-bold uppercase tracking-wider opacity-90">
            ⏰ Час раунду вичерпано!
          </div>
          {state.scores.chung === state.scores.hong ? (
            <>
              <div className="text-sm font-black uppercase text-white">
                Визначення переможця за рішенням суддів (Superiority)
              </div>
              <div className="text-xs opacity-90">
                Рахунок рівний: {state.scores.chung}:{state.scores.hong}. Оберіть переможця раунду на основі рішення суддів:
              </div>
              <div className="flex justify-center gap-3 mt-2">
                <Button
                  disabled={busy}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 uppercase text-xs"
                  onClick={() => handleRulesetEvent("NEXT_ROUND", { round_winner: "chung" })}
                >
                  Chung (Синій)
                </Button>
                <Button
                  disabled={busy}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-2 uppercase text-xs"
                  onClick={() => handleRulesetEvent("NEXT_ROUND", { round_winner: "hong" })}
                >
                  Hong (Червоний)
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-black uppercase text-white">
                Очікується перехід до наступного раунду
              </div>
              <div className="text-xs opacity-90">
                Рахунок раунду: {state.scores.chung} (Chung) : {state.scores.hong} (Hong)
              </div>
              <Button
                disabled={busy}
                className="bg-green-700 hover:bg-green-600 text-white font-bold px-6 py-2 uppercase text-xs"
                onClick={() => handleRulesetEvent("NEXT_ROUND")}
              >
                Зафіксувати та перейти
              </Button>
            </>
          )}
        </div>
      )}

      {/* Main split screen */}
      <div className="grid grid-cols-[1fr_160px_1fr] gap-4 items-stretch">

        {/* Left Side: Chung (Blue) */}
        <div className="flex flex-col gap-4 p-4 rounded-xl border border-blue-900/50 bg-blue-950/20 text-center">
          <div>
            <span className="text-xs font-bold text-blue-400 tracking-widest uppercase">CHUNG (Синій)</span>
            <h3 className="font-extrabold text-base truncate">{getFighterName("chung")}</h3>
            <p className="text-xs text-zinc-400">{getFighterClub("chung") || "Без клубу"}</p>
          </div>

          <div className="flex flex-col items-center">
            <span className="font-display font-black text-8xl text-blue-300 leading-none">
              {state.scores.chung}
            </span>
            <div className="flex gap-1 mt-2 text-xs text-zinc-400">
              <span>Виграно раундів:</span>
              <span className="font-bold text-yellow-400">{state.rounds_won.chung}</span>
            </div>
            <div className="flex gap-1 mt-1 text-xs text-zinc-400">
              <span>Gam-jeom (GJ):</span>
              <span className="font-bold text-[hsl(var(--sport-accent))]">{state.gam_jeoms.chung}/10</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("chung", 1)}
            >
              +1 Punch
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("chung", 2)}
            >
              +2 Body
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("chung", 3)}
            >
              +3 Head
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("chung", 4)}
            >
              +4 Turn Body
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold col-span-2"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("chung", 6)}
            >
              +6 Turn Head
            </Button>
            <Button
              className="bg-[hsl(var(--sport-accent))] text-black font-extrabold col-span-2"
              disabled={busy || isCompleted}
              onClick={() => handleGamJeomAction("chung")}
            >
              Gam-jeom (GJ)
            </Button>
          </div>
        </div>

        {/* Center: Timer & Next Round */}
        <div className="flex flex-col items-center justify-between py-4 min-w-[140px]">
          {/* Timer Display */}
          <div className="flex flex-col items-center gap-1 text-center w-full">
            <div className={cn(
              "font-mono text-4xl font-black tracking-wider tabular-nums leading-none",
              remainingMs === 0 && timerState.status === "running" ? "text-red-500 animate-pulse" : "text-white"
            )}>
              {formatTimer(remainingMs)}
            </div>
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{timerState.status}</span>

            {/* Timer Actions */}
            <div className="flex flex-col gap-1 w-full mt-3 px-2">
              {timerState.status === "not_started" && (
                <Button size="sm" className="bg-green-700 hover:bg-green-600 text-white font-bold text-xs"
                  disabled={busy || isCompleted}
                  onClick={() => timerAction("start")}>
                  Start
                </Button>
              )}
              {timerState.status === "running" && (
                <Button size="sm" className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs"
                  disabled={busy}
                  onClick={() => timerAction("pause")}>
                  Pause
                </Button>
              )}
              {timerState.status === "paused" && (
                <>
                  <Button size="sm" className="bg-green-700 hover:bg-green-600 text-white font-bold text-xs"
                    disabled={busy}
                    onClick={() => timerAction("resume")}>
                    Resume
                  </Button>
                  <Button size="sm" variant="outline" className="text-zinc-400 hover:text-white"
                    disabled={busy}
                    onClick={() => timerAction("reset")}>
                    Reset
                  </Button>
                </>
              )}
            </div>

            {/* Time adjustments */}
            {(timerState.status === "paused" || timerState.status === "not_started") && !isCompleted && (
              <div className="flex flex-col gap-1.5 w-full mt-3 border-t border-zinc-800 pt-2 px-1">
                <div className="grid grid-cols-2 gap-1 w-full">
                  <Button size="sm" variant="outline" className="h-6 text-[9px] font-bold"
                    disabled={busy}
                    onClick={() => timerAction("add_time", { delta_ms: 10000 })}>
                    +10s
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[9px] font-bold"
                    disabled={busy}
                    onClick={() => timerAction("add_time", { delta_ms: -10000 })}>
                    -10s
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[9px] font-bold"
                    disabled={busy}
                    onClick={() => timerAction("add_time", { delta_ms: 30000 })}>
                    +30s
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[9px] font-bold"
                    disabled={busy}
                    onClick={() => timerAction("add_time", { delta_ms: -30000 })}>
                    -30s
                  </Button>
                </div>
                <TimeAdjustmentInput
                  inputRef={customTimeInputRef}
                  disabled={busy}
                  onAdjust={handleCustomTimeAdjust}
                />
                <AbsoluteTimeInput
                  inputRef={absoluteTimeInputRef}
                  disabled={busy}
                  onSetDuration={(val) => timerAction("set_duration", { duration_ms: val * 1000 })}
                />
                <TimePresetSelect
                  disabled={busy}
                  onSelectDuration={(val) => timerAction("set_duration", { duration_ms: val * 1000 })}
                />
              </div>
            )}
          </div>

          {/* Next Round Button */}
          <div className="w-full px-1 mt-4">
            <Button
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-yellow-400 border border-zinc-700 font-extrabold py-5 h-auto text-xs uppercase tracking-wide leading-tight shadow-md"
              disabled={busy || isCompleted}
              onClick={handleNextRoundClick}
            >
              Наступний<br />раунд
            </Button>
          </div>
        </div>

        {/* Right Side: Hong (Red) */}
        <div className="flex flex-col gap-4 p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-center">
          <div>
            <span className="text-xs font-bold text-red-400 tracking-widest uppercase">HONG (Червоний)</span>
            <h3 className="font-extrabold text-base truncate">{getFighterName("hong")}</h3>
            <p className="text-xs text-zinc-400">{getFighterClub("hong") || "Без клубу"}</p>
          </div>

          <div className="flex flex-col items-center">
            <span className="font-display font-black text-8xl text-red-300 leading-none">
              {state.scores.hong}
            </span>
            <div className="flex gap-1 mt-2 text-xs text-zinc-400">
              <span>Виграно раундів:</span>
              <span className="font-bold text-yellow-400">{state.rounds_won.hong}</span>
            </div>
            <div className="flex gap-1 mt-1 text-xs text-zinc-400">
              <span>Gam-jeom (GJ):</span>
              <span className="font-bold text-[hsl(var(--sport-accent))]">{state.gam_jeoms.hong}/10</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("hong", 1)}
            >
              +1 Punch
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("hong", 2)}
            >
              +2 Body
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("hong", 3)}
            >
              +3 Head
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("hong", 4)}
            >
              +4 Turn Body
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold col-span-2"
              disabled={busy || isCompleted}
              onClick={() => handlePointsAction("hong", 6)}
            >
              +6 Turn Head
            </Button>
            <Button
              className="bg-[hsl(var(--sport-accent))] text-black font-extrabold col-span-2"
              disabled={busy || isCompleted}
              onClick={() => handleGamJeomAction("hong")}
            >
              Gam-jeom (GJ)
            </Button>
          </div>
        </div>

      </div>

      {/* Completed State Banner */}
      {isCompleted && (
        <CompletedBanner
          winnerDisplayName={winnerDisplayName}
          winMethodText={(match.win_method as string) === "ptg" ? "Point Gap (PTG)" : (match.win_method as string) === "pun" ? "10 Gam-jeoms (PUN)" : "За очками (Points)"}
          busy={busy}
          onNextMatch={onNextMatch}
        />
      )}

      {/* Bottom Actions */}
      <div className="flex justify-between items-center pt-3 border-t border-zinc-800">
          <div className="flex flex-wrap gap-2">
            {!isCompleted && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="border-blue-900 text-blue-400 hover:bg-blue-950/30"
                  onClick={() => { setWinMethod("points"); setWinnerDialog("chung"); }}
                >
                  Переможець CHUNG
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="border-red-900 text-red-400 hover:bg-red-950/30"
                  onClick={() => { setWinMethod("points"); setWinnerDialog("hong"); }}
                >
                  Переможець HONG
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => handleRulesetEvent("RESET_ROUND")}
                >
                  Скинути раунд
                </Button>
                {state.round_history.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    onClick={() => handleRulesetEvent("UNDO_ROUND")}
                  >
                    Назад (раунд)
                  </Button>
                )}
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="border-red-500/30 text-red-400 hover:bg-red-950/30"
              onClick={() => setResetDialogOpen(true)}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Скинути бій
            </Button>
          </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRelease} disabled={busy}>
            Звільнити татамі
          </Button>
          <Button variant="outline" size="sm" onClick={openScoreboard} disabled={busy}>
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Scoreboard
          </Button>
        </div>
      </div>

      {/* Next Round Confirm Dialog */}
      <Dialog open={nextRoundConfirmOpen} onOpenChange={setNextRoundConfirmOpen}>
        <DialogContent className="bg-zinc-950 text-white border-zinc-800">
          <DialogHeader>
            <DialogTitle>Підтвердження переходу до наступного раунду</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-400 space-y-2">
            <p>Ви впевнені, що хочете завершити поточний раунд?</p>
            <div className="p-3 bg-zinc-900 rounded border border-zinc-800 font-mono text-center">
              Рахунок раунду: {state.scores.chung} (Chung) : {state.scores.hong} (Hong)
            </div>
            <p className="text-xs text-[hsl(var(--sport-accent))]">
              * Це зафіксує результат раунду в історії, нарахує +1 перемогу за більшою кількістю балів та оновить рахунок раунду до 0:0.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNextRoundConfirmOpen(false)}>Скасувати</Button>
            <Button disabled={busy} className="bg-blue-600 hover:bg-blue-700" onClick={() => { setNextRoundConfirmOpen(false); handleRulesetEvent("NEXT_ROUND"); }}>
              Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Winner Dialog */}
      <WinnerSelectDialog
        open={!!winnerDialog}
        onOpenChange={(o) => !o && setWinnerDialog(null)}
        winnerName={winnerDialog ? getFighterName(winnerDialog) : ""}
        winnerColorClass={winnerDialog === "chung" ? "text-blue-400" : "text-red-400"}
        winMethod={winMethod}
        onWinMethodChange={setWinMethod}
        options={[
          { value: "points", label: "За очками (Points)" },
          { value: "ptg", label: "Point Gap (PTG)" },
          { value: "pun", label: "Gam-jeom (PUN)" },
          { value: "withdrawal", label: "Зняття суперника (Withdrawal)" }
        ]}
        busy={busy}
        onConfirm={handleDeclareWinner}
        onCancel={() => setWinnerDialog(null)}
      />

      {/* Reset dialog */}
      <ResetMatchDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        busy={busy}
        onConfirm={handleResetMatch}
      >
        <li>Скидання всіх балів, раундів та Gam-jeoms</li>
      </ResetMatchDialog>

      {/* Tie Round Winner Selector Dialog (Superiority Decision) */}
      <Dialog open={tieDialogOpen} onOpenChange={setTieDialogOpen}>
        <DialogContent className="bg-zinc-950 text-white border-zinc-800">
          <DialogHeader>
            <DialogTitle>Визначення переможця за рішенням суддів</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-400 space-y-3">
            <p>
              Рахунок раунду рівний: <strong className="text-white font-mono">{state.scores.chung}:{state.scores.hong}</strong>.
            </p>
            <p>
              Оберіть переможця цього раунду на основі критеріїв WT (superiority):
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 text-xs uppercase"
                disabled={busy}
                onClick={() => {
                  setTieDialogOpen(false);
                  handleRulesetEvent("NEXT_ROUND", { round_winner: "chung" });
                }}
              >
                Chung (Синій)
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-xs uppercase"
                disabled={busy}
                onClick={() => {
                  setTieDialogOpen(false);
                  handleRulesetEvent("NEXT_ROUND", { round_winner: "hong" });
                }}
              >
                Hong (Червоний)
              </Button>
            </div>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button variant="outline" size="sm" onClick={() => setTieDialogOpen(false)}>Скасувати</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gam-jeom Type Selector Dialog (Last 10 Seconds Rule) */}
      <Dialog open={!!gamJeomConfirmOpen} onOpenChange={(open: boolean) => !open && setGamJeomConfirmOpen(null)}>
        <DialogContent className="bg-zinc-950 text-white border-zinc-800 max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {gamJeomConfirmOpen?.isUndo ? "Скасування Gam-jeom" : "Призначення Gam-jeom"} (Останні 10 сек)
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-400 space-y-3">
            <p>
              Оберіть тип порушення для {gamJeomConfirmOpen?.corner === "chung" ? "Chung (Синій)" : "Hong (Червоний)"} на останніх 10 секундах раунду:
            </p>
            <div className="flex flex-col gap-2 mt-2">
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 text-xs justify-start h-auto text-left"
                onClick={() => {
                  if (gamJeomConfirmOpen) {
                    handleRulesetEvent(gamJeomConfirmOpen.isUndo ? "SUB_GAM_JEOM" : "ADD_GAM_JEOM", {
                      corner: gamJeomConfirmOpen.corner,
                      is_passive: true,
                      remaining_seconds: Math.ceil(remainingMs / 1000),
                    });
                    if (gamJeomConfirmOpen.isUndo) setUndoMode(false);
                    setGamJeomConfirmOpen(null);
                  }
                }}
              >
                <div>
                  <div className="font-extrabold">Пасивна дія</div>
                  <div className="text-[10px] opacity-85 mt-0.5">
                    Уникнення бою, падіння, вихід за лінію ({gamJeomConfirmOpen?.isUndo ? "-2 бали супернику" : "+2 бали супернику"})
                  </div>
                </div>
              </Button>
              <Button
                className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 text-xs justify-start h-auto text-left border border-zinc-700"
                onClick={() => {
                  if (gamJeomConfirmOpen) {
                    handleRulesetEvent(gamJeomConfirmOpen.isUndo ? "SUB_GAM_JEOM" : "ADD_GAM_JEOM", {
                      corner: gamJeomConfirmOpen.corner,
                      is_passive: false,
                      remaining_seconds: Math.ceil(remainingMs / 1000),
                    });
                    if (gamJeomConfirmOpen.isUndo) setUndoMode(false);
                    setGamJeomConfirmOpen(null);
                  }
                }}
              >
                <div>
                  <div className="font-extrabold">Інше порушення</div>
                  <div className="text-[10px] opacity-85 mt-0.5">
                    Будь-яке інше попередження ({gamJeomConfirmOpen?.isUndo ? "-1 бал супернику" : "+1 бал супернику"})
                  </div>
                </div>
              </Button>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button size="sm" variant="outline" className="w-full text-zinc-400" onClick={() => setGamJeomConfirmOpen(null)}>
              Скасувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Round History Display */}
      {state.round_history.length > 0 && (
        <div className="flex flex-col gap-2 p-4 mt-4 rounded-xl border border-zinc-800 bg-zinc-950/20">
          <h4 className="text-xs font-bold text-zinc-400 tracking-wider uppercase">Результати раундів</h4>
          <div className="divide-y divide-zinc-800 font-mono text-sm">
            {state.round_history.map((rh, idx) => (
              <div key={`rh-${idx}`} className="flex justify-between py-1.5 items-center">
                <span className="text-zinc-400">Раунд {rh.round}</span>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "font-bold",
                    rh.winner === "chung" ? "text-blue-400" : rh.winner === "hong" ? "text-red-400" : "text-zinc-500"
                  )}>
                    {rh.scores?.chung ?? 0} (Chung) : {rh.scores?.hong ?? 0} (Hong)
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    {rh.win_method === "ptg" ? "PTG" : rh.win_method === "gam_jeom" ? "Gam-jeom" : "Очки"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
