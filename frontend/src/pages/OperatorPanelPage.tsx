import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, Trophy, Wifi, WifiOff, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";
import KumiteOperatorControls from "@/components/operator/KumiteOperatorControls";
import KumiteWKFOperatorPanel from "@/components/operator/KumiteWKFOperatorPanel";
import type { Match, RulesetInfo, Tatami, Tournament } from "@/types/api";

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

export default function OperatorPanelPage() {
  const { tid, n } = useParams<{ tid: string; n: string }>();
  const { user } = useAuth();

  const [connected, setConnected] = useState(false);
  const [tatami, setTatami] = useState<Tatami | null>(null);
  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [rulesets, setRulesets] = useState<RulesetInfo[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  // Winner dialog
  const [winnerDialog, setWinnerDialog] = useState<"ao" | "aka" | null>(null);
  const [winMethod, setWinMethod] = useState("points");
  const [busy, setBusy] = useState(false);

  const { state: timerState, setState: setTimerState, remainingMs } = useTimer(
    DEFAULT_TIMER,
    serverTimeOffset,
  );

  // fetch match queue for tournament
  const fetchMatches = useCallback(async () => {
    if (!tid) return;
    try {
      const { data } = await api.get<Match[]>(`/matches/?tournament=${tid}`);
      const list = Array.isArray(data) ? data : (data as { results: Match[] }).results;
      setMatches(list);
    } catch {/* handled by api interceptor */}
  }, [tid]);

  // initial data
  useEffect(() => {
    if (!tid) return;
    api.get<RulesetInfo[]>("/rulesets/").then(({ data }) => setRulesets(data)).catch(() => {});
    api.get<Tournament>(`/tournaments/${tid}/`).then(({ data }) => setTournament(data)).catch(() => {});
    fetchMatches();
  }, [tid, fetchMatches]);

  useTatamiSocket(tid!, n!, {
    onClockOffsetUpdate: setServerTimeOffset,
    onSnapshot(data) {
      setConnected(true);
      setTatami(data.tatami);
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
      setMatches((prev) => prev.map((m) => m.id === match.id ? match : m));
      setTimerState(matchToTimerState(match));
    },
    onTimerState(state, _server_ts_ms) {
      setTimerState({
        status: state.status,
        started_at_ms: state.started_at_ms,
        elapsed_ms: state.elapsed_ms,
        duration_ms: state.duration_ms,
      });
    },
    onTatamiState(data) {
      setTatami(data.tatami);
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        setTimerState(matchToTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        setTimerState(DEFAULT_TIMER);
      }
      fetchMatches();
    },
  });

  // derived
  const ruleset = rulesets.find((r) => r.key === currentMatch?.ruleset_key);
  const rulesetActions = ruleset?.score_actions ?? [];
  const winMethods = ruleset?.win_methods ?? [{ key: "points", label: "За очками" }];

  const handleAssignMatch = async (matchId: number) => {
    if (!tatami) return;
    try {
      await api.post(`/tatamis/${tatami.id}/assign_match/`, { match_id: matchId });
    } catch {/* toast */}
  };

  const handleRelease = async () => {
    if (!tatami) return;
    try {
      await api.post(`/tatamis/${tatami.id}/release/`);
    } catch {/* toast */}
  };

  const handleDeclareWinner = async () => {
    if (!currentMatch || !winnerDialog) return;
    setBusy(true);
    try {
      const { data } = await api.post<Match>(
        `/matches/${currentMatch.id}/set_winner/`,
        { corner: winnerDialog, win_method: winMethod },
      );
      setCurrentMatch(data);
      setMatches((prev) => prev.map((m) => m.id === data.id ? data : m));
      setWinnerDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const openScoreboard = () =>
    window.open(`/scoreboard/tournament/${tid}/tatami/${n}`, "_blank");

  // sorted matches for queue
  const sortedMatches = [...matches].sort((a, b) =>
    a.round_index === b.round_index
      ? a.match_order - b.match_order
      : a.round_index - b.round_index
  );

  const isLocked = user?.role === "judge" && tatami && tatami.assigned_judge !== user.id;

  if (isLocked) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-20 h-20 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-6 animate-bounce">
          <ShieldAlert className="w-10 h-10 text-destructive" />
        </div>
        <h1 className="text-3xl font-black tracking-tight text-foreground uppercase">Доступ обмежено!</h1>
        <div className="w-12 h-1 bg-destructive/40 rounded my-4" />
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          Ви авторизовані як суддя, проте ви не закріплені за цим татамі (Татамі №{n}). Зверніться до організатора для призначення.
        </p>
        <div className="flex gap-3 mt-8">
          <Button variant="outline" onClick={() => window.history.back()}>
            Назад
          </Button>
          <Button variant="sport" onClick={() => window.location.reload()}>
            Оновити сторінку
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0 bg-card">
        <span className="font-bold text-sm">
          {tournament?.title ?? `Tournament ${tid}`}
        </span>
        <span className="text-muted-foreground text-sm">·</span>
        <span className="text-sm">Tatami {n}</span>
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ml-1",
          connected
            ? "border-green-500/40 text-green-400 bg-green-500/5"
            : "border-muted text-muted-foreground"
        )}>
          {connected
            ? <><Wifi className="w-3 h-3" /> Live</>
            : <><WifiOff className="w-3 h-3" /> Offline</>}
        </div>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={openScoreboard}>
            <ExternalLink className="w-3 h-3 mr-1" /> Scoreboard
          </Button>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Match Queue (left) ── */}
        <div className="w-72 border-r overflow-y-auto shrink-0">
          <div className="p-3 border-b">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Match Queue
            </p>
          </div>
          <div className="p-2 space-y-1">
            {sortedMatches.map((m) => {
              const isCurrent = currentMatch?.id === m.id;
              const isCompleted = m.status === "completed";
              const aoName = m.reg_second?.athlete?.full_name ?? "TBD";
              const akaName = m.reg_first?.athlete?.full_name ?? "TBD";
              const winnerReg = m.winner === m.reg_first?.id ? m.reg_first : m.reg_second;
              let matchItemClass: string;
              if (isCurrent) {
                matchItemClass = "border-amber-500/60 bg-amber-500/10";
              } else if (isCompleted) {
                matchItemClass = "border-border/40 bg-muted/20 opacity-50 cursor-default";
              } else {
                matchItemClass = "border-border hover:border-border/80 hover:bg-muted/30 cursor-pointer";
              }

              return (
                <button
                  key={m.id}
                  disabled={isCurrent}
                  onClick={() => handleAssignMatch(m.id)}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2 text-xs transition-all",
                    matchItemClass,
                  )}
                >
                  <p className="font-medium text-muted-foreground mb-0.5">
                    R{m.round_index}.{m.match_order}
                  </p>
                  <p className="truncate">
                    <span className="text-blue-400">{aoName}</span>
                    <span className="text-muted-foreground"> vs </span>
                    <span className="text-red-400">{akaName}</span>
                  </p>
                  {isCompleted && winnerReg && (
                    <p className="text-green-400 text-xs mt-0.5 truncate">
                      ✓ {winnerReg.athlete?.full_name}
                    </p>
                  )}
                </button>
              );
            })}
            {sortedMatches.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">
                Матчі не знайдено
              </p>
            )}
          </div>
        </div>

        {/* ── Current Match (right) ── */}
        <div className="flex-1 overflow-y-auto p-4">
          {currentMatch ? (
            currentMatch.ruleset_key === "karate_wkf" ? (
              <KumiteWKFOperatorPanel
                match={currentMatch}
                timerState={timerState}
                remainingMs={remainingMs}
                rulesetActions={rulesetActions}
                winMethods={winMethods}
                serverTimeOffset={serverTimeOffset}
                onMatchUpdate={(m) => {
                  setCurrentMatch(m);
                  setMatches((prev) => prev.map((x) => x.id === m.id ? m : x));
                  setTimerState(matchToTimerState(m));
                }}
                onRelease={handleRelease}
              />
            ) : currentMatch.judging_mode === "points" ? (
              <div className="space-y-4 max-w-4xl mx-auto">
                <div className="text-xs text-muted-foreground">
                  R{currentMatch.round_index}.{currentMatch.match_order}
                  {currentMatch.status === "completed" && (
                    <span className="ml-2 text-green-400 font-bold uppercase">Завершено</span>
                  )}
                </div>
                <KumiteOperatorControls
                  match={currentMatch}
                  rulesetActions={rulesetActions}
                  timerState={timerState}
                  remainingMs={remainingMs}
                  serverTimeOffset={serverTimeOffset}
                  onMatchUpdate={(m) => {
                    setCurrentMatch(m);
                    setMatches((prev) => prev.map((x) => x.id === m.id ? m : x));
                    setTimerState(matchToTimerState(m));
                  }}
                />
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  {currentMatch.status !== "completed" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                        onClick={() => { setWinMethod(winMethods[0]?.key ?? "points"); setWinnerDialog("ao"); }}
                      >
                        <Trophy className="w-3 h-3 mr-1" /> Winner: AO
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                        onClick={() => { setWinMethod(winMethods[0]?.key ?? "points"); setWinnerDialog("aka"); }}
                      >
                        <Trophy className="w-3 h-3 mr-1" /> Winner: AKA
                      </Button>
                    </>
                  )}
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleRelease}>
                      Release Tatami
                    </Button>
                    <Button variant="outline" size="sm" onClick={openScoreboard}>
                      <ExternalLink className="w-3 h-3 mr-1" /> Open Scoreboard
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-16 border border-dashed rounded-xl text-muted-foreground text-sm">
                Kata UI — coming soon
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <p className="text-muted-foreground">
                Виберіть матч зі списку або призначте з черги
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Winner dialog for legacy rulesets ── */}
      <Dialog open={!!winnerDialog} onOpenChange={(o) => !o && setWinnerDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Оголосити переможця:{" "}
              <span className={winnerDialog === "ao" ? "text-blue-400" : "text-red-400"}>
                {winnerDialog === "ao"
                  ? (currentMatch?.reg_second?.athlete?.full_name ?? "AO")
                  : (currentMatch?.reg_first?.athlete?.full_name ?? "AKA")}
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
    </div>
  );
}
