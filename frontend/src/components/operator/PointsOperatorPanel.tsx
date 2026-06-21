import { useState } from "react";
import { useParams } from "react-router-dom";
import { Trophy, ExternalLink, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import api from "@/lib/api";
import KumiteOperatorControls from "./KumiteOperatorControls";
import { cn, getErrorMessage, formatAthleteName, formatRegistrationName } from "@/lib/utils";
import { getRoundName } from "@/lib/bracketUtils";
import type { Match, ScoreAction } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";

interface PointsOperatorPanelProps {
  match: Match;
  timerState: TimerState;
  remainingMs: number;
  rulesetActions: ScoreAction[];
  winMethods: { key: string; label: string }[];
  serverTimeOffset: number;
  onMatchUpdate: (match: Match) => void;
  onRelease: () => void;
  onCompleteAndNext?: (winner: "aka" | "ao" | "draw", winMethod: string) => void;
  onNextMatch?: () => void;
  disabled?: boolean;
  allMatches?: Match[];
  bracketFormat?: string;
}

function getSuggestedWinner(
  match: Match,
  isRoundRobin: boolean
): { suggestedWinner: "aka" | "ao" | "draw" | null; suggestionReason: string } {
  let suggestedWinner: "aka" | "ao" | "draw" | null = null;
  let suggestionReason = "";

  const isWkf = match.ruleset_key === "karate_wkf";

  if (match.score_first > match.score_second) {
    suggestedWinner = "aka";
    suggestionReason = `перевага за балами (${match.score_first}:${match.score_second})`;
  } else if (match.score_second > match.score_first) {
    suggestedWinner = "ao";
    suggestionReason = `перевага за балами (${match.score_second}:${match.score_first})`;
  } else if (match.score_first === match.score_second) {
    if (isWkf && match.senshu === "aka") {
      suggestedWinner = "aka";
      suggestionReason = "рівний рахунок, перевага Senshu";
    } else if (isWkf && match.senshu === "ao") {
      suggestedWinner = "ao";
      suggestionReason = "рівний рахунок, перевага Senshu";
    } else {
      if (isRoundRobin) {
        suggestedWinner = "draw";
        suggestionReason = match.score_first > 0
          ? `рівний рахунок ${match.score_first}:${match.score_second}${isWkf ? " без Senshu" : ""} (нічия)`
          : "рахунок 0:0 (нічия)";
      } else {
        suggestedWinner = null;
        suggestionReason = match.score_first > 0
          ? `рівний рахунок ${match.score_first}:${match.score_second}${isWkf ? " без Senshu" : ""} (Hantei)`
          : "рахунок 0:0 (Hantei)";
      }
    }
  }

  return { suggestedWinner, suggestionReason };
}

export default function PointsOperatorPanel({
  match,
  timerState,
  remainingMs,
  rulesetActions,
  winMethods,
  serverTimeOffset,
  onMatchUpdate,
  onRelease,
  onNextMatch,
  disabled,
  allMatches,
  bracketFormat,
}: Readonly<PointsOperatorPanelProps>) {
  const { tid } = useParams<{ tid: string }>();
  const [winnerDialog, setWinnerDialog] = useState<"ao" | "aka" | null>(null);
  const [winMethod, setWinMethod] = useState("points");
  const [busy, setBusy] = useState(false);

  // Dialog states for Draw and Reset
  const [drawDialogOpen, setDrawDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const isCompleted = match.status === "completed";
  const isRoundRobin = (match.category as unknown as { bracket_format?: string })?.bracket_format === "round_robin";

  const handleDeclareWinner = async () => {
    if (!winnerDialog) return;
    setBusy(true);
    try {
      const { data } = await api.post<Match>(
        `/matches/${match.id}/set_winner/`,
        { corner: winnerDialog, win_method: winMethod },
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

  const handleSetDraw = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<Match>(`/matches/${match.id}/set_draw/`);
      onMatchUpdate(data);
      toast({ title: "Зафіксовано нічию!" });
      setDrawDialogOpen(false);
    } catch (error_: unknown) {
      const msg = (error_ as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Помилка встановлення нічиєї";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleResetMatch = async () => {
    setBusy(true);
    try {
      const resp = await api.post<Match>(`/matches/${match.id}/reset_match/`);
      toast({ title: "Поєдинок успішно скинуто!" });
      setResetDialogOpen(false);
      onMatchUpdate(resp.data);
    } catch (err) {
      toast({
        title: "Не вдалося скинути поєдинок",
        description: getErrorMessage(err, "Помилка скидання поєдинку"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const openScoreboard = () =>
    window.open(`/scoreboard/tournament/${tid}/tatami/${match.tatami}`, "_blank");

  // Розрахунок рекомендованого переможця (suggestion) через хелпер
  const { suggestedWinner, suggestionReason } = getSuggestedWinner(match, isRoundRobin);

  const getFirstFighterName = () => {
    if (match.athlete_first) {
      const name = formatAthleteName(match.athlete_first);
      const team = match.reg_first?.team?.name;
      return team ? `${name} (${team})` : name;
    }
    return formatRegistrationName(match.reg_first) || "AKA";
  };

  const getSecondFighterName = () => {
    if (match.athlete_second) {
      const name = formatAthleteName(match.athlete_second);
      const team = match.reg_second?.team?.name;
      return team ? `${name} (${team})` : name;
    }
    return formatRegistrationName(match.reg_second) || "AO";
  };

  const handleSuggestedComplete = async () => {
    if (!suggestedWinner) return;
    setBusy(true);
    try {
      let updated: Match;
      if (suggestedWinner === "draw") {
        const { data } = await api.post<Match>(`/matches/${match.id}/set_draw/`);
        updated = data;
      } else {
        const { data } = await api.post<Match>(`/matches/${match.id}/set_winner/`, {
          corner: suggestedWinner,
          win_method: "points",
        });
        updated = data;
      }
      onMatchUpdate(updated);
      toast({ title: "Результат успішно зафіксовано!" });
    } catch {
      toast({ title: "Помилка при фіксації результату", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Local variables to avoid nested ternaries in JSX
  let suggestedWinnerDisplayName = "Нічия";
  if (suggestedWinner === "ao") {
    suggestedWinnerDisplayName = "Перемога AO";
  } else if (suggestedWinner === "aka") {
    suggestedWinnerDisplayName = "Перемога AKA";
  }

  let suggestedWinnerClass = "text-amber-400";
  if (suggestedWinner === "ao") {
    suggestedWinnerClass = "text-blue-400";
  } else if (suggestedWinner === "aka") {
    suggestedWinnerClass = "text-red-400";
  }

  let winnerDisplayName = <span className="text-amber-400">Нічия</span>;
  if (match.winner) {
    if (match.winner === match.reg_first?.id) {
      winnerDisplayName = <span className="text-red-400">AKA ({getFirstFighterName()})</span>;
    } else {
      winnerDisplayName = <span className="text-blue-400">AO ({getSecondFighterName()})</span>;
    }
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Match info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground bg-zinc-950/20 px-3 py-1.5 rounded-lg border border-border/20">
        <div>
          {getRoundName(match, allMatches ?? [], bracketFormat)}, Поєдинок {match.match_order} · Категорія: <span className="font-bold text-foreground">{match.category_name || (match.category as unknown as { name?: string })?.name}</span>
        </div>
        {match.status === "completed" && (
          <span className="text-green-400 font-bold uppercase tracking-wider">Завершено</span>
        )}
      </div>

      {/* Controls */}
      {match.judging_mode === "points" ? (
        <KumiteOperatorControls
          match={match}
          rulesetActions={rulesetActions}
          timerState={timerState}
          remainingMs={remainingMs}
          serverTimeOffset={serverTimeOffset}
          onMatchUpdate={onMatchUpdate}
        />
      ) : (
        <div className="flex items-center justify-center py-16 border border-dashed rounded-xl text-muted-foreground text-sm">
          Kata UI — coming soon
        </div>
      )}

      {/* Suggested Winner Banner */}
      {remainingMs === 0 && !isCompleted && (
        <div className={cn(
          "p-4 rounded-xl border text-center space-y-3 shadow-lg backdrop-blur-md transition-all duration-300",
          suggestedWinner
            ? "border-green-500/30 bg-green-950/20 text-green-300"
            : "border-amber-500/30 bg-amber-950/20 text-amber-300"
        )}>
          <div className="text-xs font-bold uppercase tracking-wider opacity-90">
            ⏰ Час поєдинку вичерпано!
          </div>
          {suggestedWinner ? (
            <>
              <div className="text-lg font-black uppercase text-white tracking-wide">
                Рекомендоване рішення:{" "}
                <span className={suggestedWinnerClass}>
                  {suggestedWinnerDisplayName}
                </span>
              </div>
              <div className="text-xs opacity-75 font-medium italic">
                Причина: {suggestionReason}
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={handleSuggestedComplete}
                className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-2 shadow-lg border border-green-500/50 uppercase tracking-wide text-xs animate-pulse"
              >
                {suggestedWinner === "aka" ? "Підтвердити перемогу AKA" : suggestedWinner === "ao" ? "Підтвердити перемогу AO" : "Підтвердити нічию"}
              </Button>
            </>
          ) : (
            <>
              <div className="text-lg font-black uppercase text-white tracking-wide">
                Рішення суддів Hantei
              </div>
              <div className="text-xs opacity-75 font-medium italic">
                Причина: {suggestionReason}
              </div>
              <div className="text-xs opacity-90">
                Будь ласка, оберіть переможця AKA або AO за рішенням суддів Hantei вручну за допомогою кнопок нижче.
              </div>
            </>
          )}
        </div>
      )}

      {/* Completed Match Banner */}
      {isCompleted && (
        <div className="p-5 rounded-xl border border-green-500/30 bg-green-950/20 text-green-300 text-center space-y-3 shadow-lg backdrop-blur-md transition-all duration-300">
          <div className="text-xs font-bold uppercase tracking-wider opacity-90 flex items-center justify-center gap-1">
            <Trophy className="w-4 h-4 text-yellow-500 animate-bounce" /> Поєдинок завершено!
          </div>
          <div className="text-lg font-black uppercase text-white tracking-wide">
            Переможець: {winnerDisplayName}
          </div>
          <div className="text-xs opacity-75 font-medium italic">
            Рахунок: {match.score_first} (Red/AKA) : {match.score_second} (Blue/AO)
            {match.win_method && ` · Метод: ${
              winMethods.find((w) => w.key === match.win_method)?.label ?? match.win_method
            }`}
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

      {/* Bottom actions */}
      <div className="flex flex-wrap gap-2 pt-3 border-t border-border/40">
        {isCompleted ? (
          /* Переграти бій (reset match) active when completed */
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setResetDialogOpen(true)}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Переграти бій (Скинути)
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
              onClick={() => { setWinMethod(winMethods[0]?.key ?? "points"); setWinnerDialog("ao"); }}
            >
              <Trophy className="w-3.5 h-3.5 mr-1.5" /> Переможець: AO
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="border-red-500/50 text-red-400 hover:bg-red-500/10"
              onClick={() => { setWinMethod(winMethods[0]?.key ?? "points"); setWinnerDialog("aka"); }}
            >
              <Trophy className="w-3.5 h-3.5 mr-1.5" /> Переможець: AKA
            </Button>
            {isRoundRobin && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                onClick={() => setDrawDialogOpen(true)}
              >
                Нічия
              </Button>
            )}
          </>
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

      {/* ── Winner dialog ── */}
      <Dialog open={!!winnerDialog} onOpenChange={(o) => !o && setWinnerDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Оголосити переможця:{" "}
              <span className={winnerDialog === "ao" ? "text-blue-400" : "text-red-400"}>
                {winnerDialog === "ao" ? getSecondFighterName() : getFirstFighterName()}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Метод перемоги</p>
            <Select value={winMethod} onValueChange={setWinMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {winMethods.map((w) => (
                  <SelectItem key={w.key} value={w.key}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWinnerDialog(null)}>Скасувати</Button>
            <Button disabled={busy} onClick={handleDeclareWinner}>
              <Trophy className="w-4 h-4 mr-1" /> Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset dialog ── */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Скинути та переграти поєдинок
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Ви впевнені, що хочете повністю скинути стан поєдинку?
            </p>
            <p className="font-semibold text-foreground/90">
              Це призведе до:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Скидання всіх балів, попереджень та сенсю на 0</li>
              <li>Повернення поєдинку до статусу "Заплановано"</li>
              <li>Вилучення поточного переможця з наступного кола змагань (якщо сітка олімпійська)</li>
            </ul>
            <p className="text-xs text-amber-500 font-medium mt-2">
              Примітка: якщо в наступному поєдинку вже розпочався бій або нараховані бали, скидання буде заблоковано системою для збереження цілісності сітки.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Скасувати</Button>
            <Button variant="destructive" disabled={busy} onClick={handleResetMatch}>
              Скинути та почати заново
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Draw dialog ── */}
      <Dialog open={drawDialogOpen} onOpenChange={setDrawDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Зафіксувати нічию</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете зафіксувати результат цього поєдинку як нічию? Ця дія доступна лише для кругової сітки.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDrawDialogOpen(false)}>Скасувати</Button>
            <Button disabled={busy} onClick={handleSetDraw}>
              Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
