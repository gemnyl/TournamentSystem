import { useEffect, useState, useCallback } from "react";
import { Loader2, Wifi, WifiOff, Trophy, AlertTriangle, Minus, Plus } from "lucide-react";
import api from "@/lib/api";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Category, Match, Registration, PaginatedResponse, WinMethod } from "@/types/api";

// ── Блок одного учасника ──────────────────────────────────────────────────────
interface ParticipantBlockProps {
  label:       "1" | "2";
  reg:         Registration | null;
  score:       number;
  warnings:    number;
  isWinner:    boolean;
  onScore:     (delta: number) => void;
  onWarning:   () => void;
  onDeclareWinner: () => void;
  disabled:    boolean;
}

function ParticipantBlock({
  label, reg, score, warnings, isWinner,
  onScore, onWarning, onDeclareWinner, disabled,
}: ParticipantBlockProps) {
  return (
    <div className={cn(
      "flex-1 rounded-2xl border p-5 flex flex-col gap-4 transition-all",
      isWinner
        ? "border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/20"
        : "border-border bg-card"
    )}>
      {/* Ім'я */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mb-1">
          Учасник {label}
        </p>
        <p className={cn("font-display text-xl font-bold truncate", isWinner && "text-amber-500")}>
          {reg?.athlete?.full_name ?? "—"}
        </p>
        {reg && <p className="text-xs text-muted-foreground">{reg.athlete?.club?.name}</p>}
      </div>

      {/* Рахунок */}
      <div className="text-center">
        <span className={cn(
          "font-display text-8xl font-black tabular-nums leading-none",
          isWinner ? "text-amber-500" : "text-foreground"
        )}>
          {score}
        </span>
      </div>

      {/* Кнопки рахунку */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline" size="sm"
          className="text-xs font-bold"
          disabled={disabled || score <= 0}
          onClick={() => onScore(-1)}
        >
          <Minus className="w-3 h-3" /> 1
        </Button>
        <Button
          variant="outline" size="sm"
          className="text-xs font-bold"
          disabled={disabled}
          onClick={() => onScore(1)}
        >
          <Plus className="w-3 h-3" /> 1
        </Button>
        <Button
          variant="sport" size="sm"
          className="text-xs font-bold"
          disabled={disabled}
          onClick={() => onScore(3)}
        >
          IPPON
        </Button>
      </div>

      {/* Попередження */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-mono font-bold">{warnings}</span>
          <span className="text-xs text-muted-foreground">попер.</span>
        </div>
        <Button
          variant="outline" size="sm"
          className="text-xs"
          disabled={disabled}
          onClick={onWarning}
        >
          +1 Попередження
        </Button>
      </div>

      {/* Оголосити переможцем */}
      {!isWinner && !disabled && reg && (
        <Button
          variant="sport" size="lg"
          className="w-full font-display font-bold text-base mt-auto"
          onClick={onDeclareWinner}
        >
          <Trophy className="w-5 h-5" /> Оголосити переможцем
        </Button>
      )}
      {isWinner && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          <span className="font-display font-bold text-amber-500 text-lg">ПЕРЕМОЖЕЦЬ</span>
        </div>
      )}
    </div>
  );
}

// ── Головна сторінка ──────────────────────────────────────────────────────────
export default function JudgePanelPage() {
  const [categories,   setCategories]   = useState<Category[]>([]);
  const [selectedCat,  setSelectedCat]  = useState<string>("");
  const [matches,      setMatches]      = useState<Match[]>([]);
  const [activeMatch,  setActiveMatch]  = useState<Match | null>(null);
  const [isLoading,    setIsLoading]    = useState(false);
  const [wsConnected,  setWsConnected]  = useState(false);
  const [winnerDialog, setWinnerDialog] = useState<1 | 2 | null>(null);
  const [winMethod,    setWinMethod]    = useState<WinMethod>("points");

  // Завантаження категорій
  useEffect(() => {
    api.get<PaginatedResponse<Category> | Category[]>("/categories/")
      .then(({ data }) => setCategories(Array.isArray(data) ? data : data.results))
      .catch(() => {});
  }, []);

  // Завантаження матчів вибраної категорії
  const fetchMatches = useCallback(async (catId: string) => {
    setIsLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Match> | Match[]>(`/matches/?category=${catId}`);
      const list = Array.isArray(data) ? data : data.results;
      setMatches(list);
      // Автовибір першого ongoing або scheduled матчу
      const live = list.find((m) => m.status === "ongoing") ?? list.find((m) => m.status === "scheduled" && m.reg_first && m.reg_second);
      if (live) setActiveMatch(live);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCat) fetchMatches(selectedCat);
  }, [selectedCat, fetchMatches]);

  // WebSocket — оновлення активного матчу
  const handleMatchUpdate = useCallback((updated: Match) => {
    setMatches((prev) => prev.map((m) => m.id === updated.id ? updated : m));
    setActiveMatch((prev) => prev?.id === updated.id ? updated : prev);
  }, []);

  useMatchUpdates(Number(selectedCat), handleMatchUpdate, {
    onConnect:    () => setWsConnected(true),
    onDisconnect: () => setWsConnected(false),
  });

  // Дії
  const handleScore = async (participant: 1 | 2, delta: number) => {
    if (!activeMatch) return;
    try {
      const { data } = await api.post<Match>(`/matches/${activeMatch.id}/update_score/`, { participant, delta });
      setActiveMatch(data);
      setMatches((prev) => prev.map((m) => m.id === data.id ? data : m));
    } catch {/* toast з interceptor */}
  };

  const handleWarning = async (participant: 1 | 2) => {
    if (!activeMatch) return;
    try {
      const { data } = await api.post<Match>(`/matches/${activeMatch.id}/add_warning/`, { participant });
      setActiveMatch(data);
      setMatches((prev) => prev.map((m) => m.id === data.id ? data : m));
    } catch {/* toast */}
  };

  const handleSetWinner = async () => {
    if (!activeMatch || !winnerDialog) return;
    const reg = winnerDialog === 1 ? activeMatch.reg_first : activeMatch.reg_second;
    if (!reg) return;
    try {
      const { data } = await api.post<Match>(`/matches/${activeMatch.id}/set_winner/`, {
        winner_id: reg.id, method: winMethod,
      });
      setActiveMatch(data);
      setMatches((prev) => prev.map((m) => m.id === data.id ? data : m));
      setWinnerDialog(null);
      toast({ title: `Переможець: ${reg.athlete?.full_name}` });
    } catch {/* toast */}
  };

  const matchesByStatus = {
    ongoing:   matches.filter((m) => m.status === "ongoing"),
    scheduled: matches.filter((m) => m.status === "scheduled" && m.reg_first && m.reg_second),
    completed: matches.filter((m) => m.status === "completed"),
  };

  const isDone = activeMatch?.status === "completed";

  return (
    <div className="container py-6 space-y-6">
      {/* Заголовок */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl font-bold tracking-tight">Панель судді</h1>
        {selectedCat && (
          <div className={cn(
            "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border",
            wsConnected
              ? "border-green-500/40 text-green-400 bg-green-500/5"
              : "border-muted text-muted-foreground"
          )}>
            {wsConnected ? <><Wifi className="w-3 h-3" /> Live</> : <><WifiOff className="w-3 h-3" /> Offline</>}
          </div>
        )}
      </div>

      {/* Вибір категорії */}
      <div className="max-w-sm space-y-1.5">
        <Label>Категорія</Label>
        <Select value={selectedCat} onValueChange={setSelectedCat}>
          <SelectTrigger>
            <SelectValue placeholder="Оберіть категорію..." />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name} ({c.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>}

      {selectedCat && !isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">

          {/* Список матчів */}
          <div className="space-y-3">
            {(["ongoing", "scheduled", "completed"] as const).map((status) => (
              matchesByStatus[status].length > 0 && (
                <div key={status}>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    {status === "ongoing" ? "● Зараз" : status === "scheduled" ? "Заплановані" : "Завершені"}
                  </p>
                  <div className="space-y-1.5">
                    {matchesByStatus[status].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setActiveMatch(m)}
                        className={cn(
                          "w-full text-left rounded-lg border px-3 py-2 text-sm transition-all",
                          activeMatch?.id === m.id
                            ? "border-amber-500/60 bg-amber-500/10"
                            : "border-border hover:border-border/80 hover:bg-muted/30"
                        )}
                      >
                        <p className="font-medium truncate">{m.reg_first?.athlete?.full_name ?? "BYE"}</p>
                        <p className="text-muted-foreground text-xs">vs {m.reg_second?.athlete?.full_name ?? "BYE"}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>

          {/* Активний матч — табло */}
          {activeMatch ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-muted-foreground">
                  Раунд {activeMatch.round_index} · Матч {activeMatch.match_order}
                </span>
                {isDone && (
                  <span className="text-xs font-bold text-green-500 uppercase tracking-wider">Завершено</span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <ParticipantBlock
                  label="1"
                  reg={activeMatch.reg_first}
                  score={activeMatch.score_first}
                  warnings={activeMatch.warnings_first}
                  isWinner={activeMatch.winner === activeMatch.reg_first?.id}
                  onScore={(d) => handleScore(1, d)}
                  onWarning={() => handleWarning(1)}
                  onDeclareWinner={() => setWinnerDialog(1)}
                  disabled={isDone || !activeMatch.reg_first}
                />

                {/* Центр — VS */}
                <div className="flex sm:flex-col items-center justify-center gap-2 sm:min-w-[40px]">
                  <span className="font-display text-2xl font-black text-muted-foreground/40">VS</span>
                </div>

                <ParticipantBlock
                  label="2"
                  reg={activeMatch.reg_second}
                  score={activeMatch.score_second}
                  warnings={activeMatch.warnings_second}
                  isWinner={activeMatch.winner === activeMatch.reg_second?.id}
                  onScore={(d) => handleScore(2, d)}
                  onWarning={() => handleWarning(2)}
                  onDeclareWinner={() => setWinnerDialog(2)}
                  disabled={isDone || !activeMatch.reg_second}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 border border-dashed border-border rounded-xl">
              <p className="text-muted-foreground">Оберіть матч зі списку</p>
            </div>
          )}
        </div>
      )}

      {/* Діалог оголошення переможця */}
      <Dialog open={!!winnerDialog} onOpenChange={(o) => !o && setWinnerDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Оголосити переможця</DialogTitle>
          </DialogHeader>
          {winnerDialog && activeMatch && (
            <p className="text-sm">
              {winnerDialog === 1 ? activeMatch.reg_first?.athlete?.full_name : activeMatch.reg_second?.athlete?.full_name}
            </p>
          )}
          <div className="space-y-1.5">
            <Label>Метод перемоги</Label>
            <Select value={winMethod} onValueChange={(v) => setWinMethod(v as WinMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="points">За очками</SelectItem>
                <SelectItem value="ippon">Іппон</SelectItem>
                <SelectItem value="waza_ari">Ваза-арі</SelectItem>
                <SelectItem value="disqualification">Дискваліфікація</SelectItem>
                <SelectItem value="withdrawal">Знято</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWinnerDialog(null)}>Скасувати</Button>
            <Button variant="sport" onClick={handleSetWinner}>
              <Trophy className="w-4 h-4" /> Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
