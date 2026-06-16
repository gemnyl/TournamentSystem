/* eslint-disable @typescript-eslint/no-unused-vars */
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { useParams } from "react-router-dom";
import { ExternalLink, Trophy, Wifi, WifiOff, ShieldAlert, LayoutGrid, Play, RefreshCw, Layers, GitBranch, Award, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn, formatRegistrationName, formatRegistrationClub, formatAthleteName } from "@/lib/utils";
import api from "@/lib/api";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";
import KumiteWKFOperatorPanel from "@/components/operator/KumiteWKFOperatorPanel";
import KataOperatorPanel from "@/components/operator/KataOperatorPanel";
import { BracketView } from "@/components/bracket/BracketView";
import { RoundRobinTable } from "@/components/bracket/RoundRobinTable";
import type { Match, RulesetInfo, Tatami, Tournament, BracketResponse, Category, Athlete } from "@/types/api";

interface CategoryResult {
  place: number | null;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scores_scored: number;
  scores_conceded: number;
  name?: string;
  club?: string;
  registration: {
    id: number;
    place?: number | null;
    athlete?: {
      full_name: string;
      club?: { name?: string } | null;
    } | null;
    team?: {
      name: string;
      club?: { name?: string } | null;
    } | null;
  };
}

function matchToTimerState(m: Match): TimerState {
  return {
    status: m.timer_status,
    started_at_ms: m.timer_started_at ? new Date(m.timer_started_at).getTime() : null,
    elapsed_ms: m.timer_elapsed_ms,
    duration_ms: m.timer_duration_ms,
  };
}

function getTatamiMatchId(currentMatch: Match | null | number | Record<string, unknown> | undefined): number | null {
  if (!currentMatch) return null;
  if (typeof currentMatch === "object") return (currentMatch as { id?: number }).id ?? null;
  return currentMatch;
}

function updateBracketRounds(rounds: Match[][], updatedMatch: Match): Match[][] {
  return rounds.map((round) =>
    round.map((m) => m.id === updatedMatch.id ? updatedMatch : m)
  );
}

function getMedalLabel(placeVal: number | null | undefined): string {
  if (placeVal === 1) return "🥇";
  if (placeVal === 2) return "🥈";
  if (placeVal === 3) return "🥉";
  if (placeVal != null) return `${placeVal}`;
  return "—";
}

function formatParticipant(reg: { team?: { name?: string } | null; athlete?: { first_name?: string; last_name?: string } | null } | null | undefined, ath: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!reg) return "TBD";
  const teamName = (reg as { team?: { name?: string } | null }).team?.name;
  const athleteName = formatAthleteName(ath as Parameters<typeof formatAthleteName>[0]) || formatAthleteName((reg as { athlete?: Parameters<typeof formatAthleteName>[0] | null }).athlete ?? null);
  if (teamName && athleteName) return `${teamName} (${athleteName})`;
  return formatRegistrationName(reg as Parameters<typeof formatRegistrationName>[0]) || "TBD";
}

function resolveRoundLabel(roundIdx: number, bracketFormat: string | undefined, totalRounds: number): string {
  if (!bracketFormat || bracketFormat === "round_robin") return `Раунд ${roundIdx}`;
  const fromEnd = totalRounds - roundIdx;
  if (fromEnd === 0) return "Фінал";
  if (fromEnd === 1) return "Півфінал";
  if (fromEnd === 2) return "Чвертьфінал";
  return `Раунд ${roundIdx}`;
}

interface OperatorResultRowProps {
  readonly res: CategoryResult;
  readonly resultsPersisted: boolean;
  readonly placeOverride: number | null;
  readonly onOverrideChange: (regId: number, val: number | null) => void;
}

function OperatorResultRow({
  res,
  resultsPersisted,
  placeOverride,
  onOverrideChange,
}: OperatorResultRowProps) {
  const placeVal = resultsPersisted ? res.registration?.place : placeOverride;
  const medal = getMedalLabel(placeVal);

  return (
    <div className="flex items-center justify-between p-3 text-xs hover:bg-muted/10 transition-colors">
      <div className="flex items-center gap-3">
        {resultsPersisted ? (
          <span className={cn(
            "font-black text-base w-8 text-center",
            placeVal === 1 && "text-yellow-400",
            placeVal === 2 && "text-slate-300",
            placeVal === 3 && "text-amber-600"
          )}>{medal}</span>
        ) : (
          <select
            value={placeOverride ?? ""}
            onChange={(e) => {
              const val = e.target.value === "" ? null : Number(e.target.value);
              onOverrideChange(res.registration.id, val);
            }}
            className="bg-zinc-800 text-foreground border border-zinc-700 rounded px-1 py-0.5 text-xs font-semibold focus:outline-none focus:border-amber-500 w-10 text-center shrink-0"
          >
            <option value="">—</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
          </select>
        )}
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">{formatRegistrationName(res.registration)}</span>
          <span className="text-[10px] text-muted-foreground">{formatRegistrationClub(res.registration) || "Без клубу"}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="font-bold text-amber-500">{res.points} очок</span>
        <span className="text-[9px] text-muted-foreground font-mono">
          {res.wins}В / {res.draws}Н / {res.losses}П
        </span>
      </div>
    </div>
  );
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

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [isBracketModalOpen, setIsBracketModalOpen] = useState(false);
  const [selectedCategoryBracket, setSelectedCategoryBracket] = useState<BracketResponse | null>(null);
  const [loadingBracket, setLoadingBracket] = useState(false);

  // States for WKF Team Bouts
  const [subBouts, setSubBouts] = useState<Match[]>([]);
  const [loadingSubBouts, setLoadingSubBouts] = useState(false);
  const [selectedBoutAthletes, setSelectedBoutAthletes] = useState<Record<number, { athlete_first_id: string; athlete_second_id: string }>>({});
  const lastParentMatchIdRef = useRef<number | null>(null);

  // Reset states when tournament or tatami changes to prevent rendering stale data
  useEffect(() => {
    setConnected(false);
    setTatami(null);
    setCurrentMatch(null);
    setMatches([]);
    setTimerState(DEFAULT_TIMER);
    setSelectedCategoryId(null);
    setIsBracketModalOpen(false);
    setSelectedCategoryBracket(null);
    setSubBouts([]);
    setSelectedBoutAthletes({});
    lastParentMatchIdRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, n]);


  // Winner dialog

  const [winnerDialog, setWinnerDialog] = useState<"ao" | "aka" | null>(null);
  const [winMethod, setWinMethod] = useState("points");
  const [busy, setBusy] = useState(false);
  const [savingResultsCategoryId, setSavingResultsCategoryId] = useState<number | null>(null);

  const [middleTab, setMiddleTab] = useState<"matches" | "results">("matches");
  const [categoryResults, setCategoryResults] = useState<CategoryResult[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [placeOverrides, setPlaceOverrides] = useState<Record<number, number | null>>({});

  const fetchCategories = useCallback(async () => {
    if (!tid) return;
    try {
      const { data } = await api.get<Category[]>(`/categories/?tournament=${tid}`);
      const list = Array.isArray(data) ? data : (data as { results: Category[] }).results || [];
      setCategories(list);
    } catch { /* no-op */ }
  }, [tid]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const fetchCategoryResults = useCallback(async () => {
    if (!selectedCategoryId) {
      setCategoryResults([]);
      return;
    }
    try {
      const { data } = await api.get<CategoryResult[]>(`/categories/${selectedCategoryId}/results/`);
      setCategoryResults(data);
    } catch {
      setCategoryResults([]);
    }
  }, [selectedCategoryId]);

  useEffect(() => {
    if (categoryResults.length > 0) {
      const initialOverrides: Record<number, number | null> = {};
      categoryResults.forEach((res) => {
        initialOverrides[res.registration.id] = res.place;
      });
      setPlaceOverrides(initialOverrides);
    } else {
      setPlaceOverrides({});
    }
  }, [categoryResults]);

  useEffect(() => {
    fetchCategoryResults();
    setMiddleTab("matches");
  }, [selectedCategoryId, fetchCategoryResults]);

  const handleSaveCategoryResults = async (catId: number, overrides?: Record<number, number | null>) => {
    setSavingResultsCategoryId(catId);
    try {
      await api.post(`/categories/${catId}/save_results/`, { overrides });
      toast({ title: "Результати успішно зафіксовані!" });
      fetchMatches();
      fetchCategoryResults();
      fetchCategories();
    } catch {
      toast({ title: "Помилка фіксації результатів", variant: "destructive" });
    } finally {
      setSavingResultsCategoryId(null);
    }
  };

  const handleUnlockCategoryResults = async (catId: number) => {
    setSavingResultsCategoryId(catId);
    try {
      await api.post(`/categories/${catId}/unlock_results/`);
      toast({ title: "Фіксацію результатів скасовано!" });
      fetchMatches();
      fetchCategoryResults();
      fetchCategories();
    } catch {
      toast({ title: "Помилка скасування фіксації", variant: "destructive" });
    } finally {
      setSavingResultsCategoryId(null);
    }
  };

  const handleSetScoreboardCategory = async (catId: number | null) => {
    if (!tatami) return;
    try {
      await api.post(`/tatamis/${tatami.id}/set_active_results_category/`, { category_id: catId });
      toast({ title: catId ? "Трансляцію результатів запущено!" : "Трансляцію результатів зупинено." });
    } catch {
      toast({ title: "Помилка керування трансляцією", variant: "destructive" });
    }
  };

  const { state: timerState, setState: setTimerState, remainingMs } = useTimer(
    DEFAULT_TIMER,
    serverTimeOffset,
  );

  // fetch match queue for this specific tatami
  const fetchMatches = useCallback(async () => {
    if (!tid || !n) return;
    try {
      const { data } = await api.get<Match[]>(`/matches/?tournament=${tid}&tatami_number=${n}`);
      const list = Array.isArray(data) ? data : (data as { results: Match[] }).results;
      setMatches(list);
    } catch {/* handled by api interceptor */}
  }, [tid, n]);

  // initial data
  useEffect(() => {
    if (!tid) return;
    api.get<RulesetInfo[]>("/rulesets/").then(({ data }) => setRulesets(data)).catch(() => {});
    api.get<Tournament>(`/tournaments/${tid}/`).then(({ data }) => setTournament(data)).catch(() => {});
  }, [tid]);

  // fetch category bracket
  const fetchSelectedCategoryBracket = useCallback(async () => {
    if (!selectedCategoryId) {
      setSelectedCategoryBracket(null);
      return;
    }
    setLoadingBracket(true);
    try {
      const [bracketRes, catRes] = await Promise.all([
        api.get<Record<string, unknown>[]>(`/matches/bracket/?category=${selectedCategoryId}`),
        api.get<Category>(`/categories/${selectedCategoryId}/`),
      ]);
      const rawRounds = bracketRes.data.map(r => (r as { matches?: Match[] }).matches ?? []);
      setSelectedCategoryBracket({
        format: catRes.data.bracket_format,
        rounds: rawRounds
      });
    } catch {
      setSelectedCategoryBracket(null);
    } finally {
      setLoadingBracket(false);
    }
  }, [selectedCategoryId]);

  useEffect(() => {
    fetchSelectedCategoryBracket();
  }, [selectedCategoryId, fetchSelectedCategoryBracket]);

  // Periodic polling for matches
  useEffect(() => {
    fetchMatches();
    const interval = setInterval(fetchMatches, 10000);
    return () => clearInterval(interval);
  }, [fetchMatches]);

  // Fetch WKF Team sub-bouts
  const fetchSubBouts = useCallback(async (parentId: number) => {
    setLoadingSubBouts(true);
    try {
      const { data } = await api.get<Match[]>(`/matches/?parent_team_match=${parentId}`);
      const list = Array.isArray(data) ? data : (data as { results: Match[] }).results || [];
      setSubBouts(list);
    } catch {
      setSubBouts([]);
    } finally {
      setLoadingSubBouts(false);
    }
  }, []);

  useEffect(() => {
    if (currentMatch && currentMatch.category_is_team && !currentMatch.parent_team_match) {
      if (lastParentMatchIdRef.current !== currentMatch.id) {
        lastParentMatchIdRef.current = currentMatch.id;
        setSubBouts([]);
      }
      fetchSubBouts(currentMatch.id);
    }
  }, [currentMatch, fetchSubBouts]);

  useEffect(() => {
    const initial: Record<number, { athlete_first_id: string; athlete_second_id: string }> = {};
    subBouts.forEach((bout) => {
      initial[bout.id] = {
        athlete_first_id: bout.athlete_first?.id?.toString() ?? "",
        athlete_second_id: bout.athlete_second?.id?.toString() ?? "",
      };
    });
    setSelectedBoutAthletes(initial);
  }, [subBouts]);

  const getAvailableAkaAthletes = useCallback((_boutId?: number) => {
    const allAthletes = currentMatch?.reg_first?.team?.athletes ?? [];
    const assignedIds = subBouts
      .filter(b => b.athlete_first)
      .map(b => b.athlete_first?.id);
    return allAthletes.filter(a => !assignedIds.includes(a.id));
  }, [currentMatch, subBouts]);

  const getAvailableAoAthletes = useCallback((_boutId?: number) => {
    const allAthletes = currentMatch?.reg_second?.team?.athletes ?? [];
    const assignedIds = subBouts
      .filter(b => b.athlete_second)
      .map(b => b.athlete_second?.id);
    return allAthletes.filter(a => !assignedIds.includes(a.id));
  }, [currentMatch, subBouts]);

  const handleSaveLineup = async (boutId: number) => {
    const selection = selectedBoutAthletes[boutId];
    setBusy(true);
    try {
      await api.post(`/matches/${boutId}/assign_bout_athletes/`, {
        athlete_first_id: selection?.athlete_first_id ? Number(selection.athlete_first_id) : null,
        athlete_second_id: selection?.athlete_second_id ? Number(selection.athlete_second_id) : null,
      });
      toast({ title: "Склад бою оновлено!" });
      if (currentMatch) {
        fetchSubBouts(currentMatch.id);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка збереження складу";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleStartBout = async (boutId: number, isExtraBout = false) => {
    setBusy(true);
    try {
      if (isExtraBout) {
        const selection = selectedBoutAthletes[boutId];
        if (!selection?.athlete_first_id || !selection?.athlete_second_id) {
          toast({ title: "Будь ласка, оберіть обох спортсменів для додаткового бою.", variant: "destructive" });
          setBusy(false);
          return;
        }
        // 1. Assign athletes
        await api.post(`/matches/${boutId}/assign_bout_athletes/`, {
          athlete_first_id: Number(selection.athlete_first_id),
          athlete_second_id: Number(selection.athlete_second_id),
        });
      }
      // 2. Assign to tatami
      await handleAssignMatch(boutId, true);
      toast({ title: "Бій успішно запущено!" });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка при запуску бою";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleSpawnExtraBout = async () => {
    if (!currentMatch) return;
    setBusy(true);
    try {
      await api.post(`/matches/${currentMatch.id}/spawn_extra_bout/`);
      toast({ title: "Додатковий бій успішно створено!" });
      fetchSubBouts(currentMatch.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка створення додаткового бою";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const getAthleteName = (ath?: Athlete | null) => {
    if (!ath) return "—";
    return formatAthleteName(ath) || "—";
  };

  const handleTatamiData = useCallback((data: { tatami: Tatami; current_match: Match | null }) => {
    setTatami(data.tatami);
    setCurrentMatch((prev) => {
      const isViewingPastMatch = prev !== null && prev.status === "completed";
      if (isViewingPastMatch) {
        // If the new active match is another sub-bout of the same team match, transition to it
        if (
          prev.parent_team_match &&
          data.current_match &&
          data.current_match.parent_team_match === prev.parent_team_match
        ) {
          setTimerState(matchToTimerState(data.current_match));
          return data.current_match;
        }

        // If the new active match is the parent match of this sub-bout, ignore it and stay on the completed sub-bout view
        if (
          prev.parent_team_match &&
          data.current_match &&
          data.current_match.id === prev.parent_team_match
        ) {
          return prev;
        }

        const wasActiveMatchOnTatami = tatami && getTatamiMatchId(tatami.current_match) === prev.id;
        if (wasActiveMatchOnTatami) {
          if (data.current_match) {
            setTimerState(matchToTimerState(data.current_match));
            return data.current_match;
          } else {
            setTimerState(DEFAULT_TIMER);
            return null;
          }
        }
        if (data.current_match && data.current_match.id === prev.id) {
          setTimerState(matchToTimerState(data.current_match));
          return data.current_match;
        }
        return prev;
      }

      if (data.current_match) {
        // If the new active match is the parent match of this sub-bout, ignore it and stay on the ongoing sub-bout view
        if (
          prev &&
          prev.parent_team_match &&
          data.current_match.id === prev.parent_team_match
        ) {
          return prev;
        }

        setTimerState(matchToTimerState(data.current_match));
        return data.current_match;
      } else {
        setTimerState(DEFAULT_TIMER);
        return null;
      }
    });
    fetchMatches();
    fetchCategories();
    fetchCategoryResults();
  }, [tatami, fetchMatches, fetchCategories, fetchCategoryResults, setTimerState]);

  useTatamiSocket(tid || "", n || "", {
    onClockOffsetUpdate: setServerTimeOffset,
    onSnapshot(data) {
      setConnected(true);
      handleTatamiData(data);
    },
    onMatchEvent(_event, match) {
      setCurrentMatch((prev) => {
        if (prev && prev.id === match.id) {
          setTimerState(matchToTimerState(match));
          return match;
        }
        const isViewingPastMatch = prev !== null && prev.status === "completed";
        if (!isViewingPastMatch) {
          setTimerState(matchToTimerState(match));
          return match;
        }
        return prev;
      });
      setMatches((prev) => prev.map((m) => m.id === match.id ? match : m));
      setSubBouts((prev) => prev.map((b) => b.id === match.id ? match : b));
      setSelectedCategoryBracket((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rounds: updateBracketRounds(prev.rounds, match),
        };
      });
      fetchCategories();
      fetchCategoryResults();
    },
    onTimerState(state) {
      setTimerState({
        status: state.status,
        started_at_ms: state.started_at_ms,
        elapsed_ms: state.elapsed_ms,
        duration_ms: state.duration_ms,
      });
    },
    onTatamiState(data) {
      handleTatamiData(data);
    },
  });

  // Підписка на оновлення обраної категорії (для синхронізації результатів та плашок фіксації)
  useMatchUpdates(selectedCategoryId ?? 0, () => {
    fetchMatches();
    fetchCategories();
    fetchCategoryResults();
  }, {
    onConnect: () => {
      fetchCategories();
      fetchCategoryResults();
    }
  });


  // derived
  const ruleset = rulesets.find((r) => r.key === currentMatch?.ruleset_key);
  const rulesetActions = ruleset?.score_actions ?? [];
  const winMethods = ruleset?.win_methods ?? [{ key: "points", label: "За очками" }];

  const [assignConfirmDialog, setAssignConfirmDialog] = useState<number | null>(null);

  const handleAssignMatch = async (matchId: number, force = false) => {
    if (!tatami) return;
    if (currentMatch && currentMatch.status === "ongoing" && !force) {
      setAssignConfirmDialog(matchId);
      return;
    }
    setAssignConfirmDialog(null);
    try {
      const { data } = await api.post<Tatami>(`/tatamis/${tatami.id}/assign_match/`, { match_id: matchId });
      const targetMatch = matches.find((m) => m.id === matchId);
      setTatami(data);
      if (targetMatch) {
        setCurrentMatch(targetMatch);
        setTimerState(matchToTimerState(targetMatch));
      }
      fetchMatches();
      fetchCategories();
      fetchCategoryResults();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка при призначенні поєдинку";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleRelease = async () => {
    if (!tatami) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/tatamis/${tatami.id}/release/`);
      setTatami(data);
      setCurrentMatch(null);
      setTimerState(DEFAULT_TIMER);
      toast({ title: "Татамі успішно звільнено" });
      fetchMatches();
      fetchCategories();
      fetchCategoryResults();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка при звільненні татамі";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
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

  const assignNextAvailableMatch = async () => {
    if (!tatami || !currentMatch) return;

    const nextInQueue = nextUpcomingMatches[0];
    if (nextInQueue) {
      const nameFirst = formatParticipant(nextInQueue.reg_first, nextInQueue.athlete_first);
      const nameSecond = formatParticipant(nextInQueue.reg_second, nextInQueue.athlete_second);
      toast({ title: `Перехід до наступного бою: ${nameFirst} vs ${nameSecond}` });
      await handleAssignMatch(nextInQueue.id, true);
      return;
    }

    if (currentMatch.parent_team_match) {
      const parentMatch = matches.find((m) => m.id === currentMatch.parent_team_match);
      if (parentMatch) {
        if (parentMatch.status !== "completed") {
          toast({ title: "Всі індивідуальні бої завершено. Повернення до командної зустрічі..." });
        } else {
          toast({ title: "Командну зустріч завершено!" });
        }
        await handleAssignMatch(parentMatch.id, true);
        return;
      }
    }

    toast({ title: "Всі бої на татамі завершено!" });
  };

  const handleNextMatch = async () => {
    if (!tatami || !currentMatch) return;
    setBusy(true);
    try {
      await assignNextAvailableMatch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка переходу до наступного бою";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteAndNext = async (winnerCorner: "aka" | "ao" | "draw", winMethodStr: string) => {
    if (!currentMatch || !tatami) return;
    setBusy(true);
    try {
      if (winnerCorner === "draw") {
        await api.post(`/matches/${currentMatch.id}/set_draw/`);
      } else {
        await api.post(`/matches/${currentMatch.id}/set_winner/`, {
          corner: winnerCorner,
          win_method: winMethodStr,
        });
      }

      if (!currentMatch.parent_team_match) {
        await assignNextAvailableMatch();
      } else {
        fetchMatches();
        fetchCategories();
        fetchCategoryResults();
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка фіксації результату";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const tatamiMatches = useMemo(() => {
    if (!tatami) return [];
    return matches.filter((m) => {
      if (m.tatami === tatami.id) return true;
      if (m.parent_team_match) {
        const parent = matches.find(p => p.id === m.parent_team_match);
        return parent ? parent.tatami === tatami.id : false;
      }
      return false;
    });
  }, [matches, tatami]);

  // Categories present on this tatami
  const tatamiCategories = useMemo(() => {
    const cats: {
      id: number;
      name: string;
      schedule_order: number;
      totalMatches: number;
      completedMatches: number;
      status: "completed" | "ongoing" | "scheduled";
      results_finalized: boolean;
    }[] = [];

    tatamiMatches.forEach((m) => {
      if (!m.category) return;
      let cat = cats.find((c) => c.id === m.category);
      if (!cat) {
        cat = {
          id: m.category,
          name: m.category_name ?? `Категорія ${m.category}`,
          schedule_order: m.category_order ?? 0,
          totalMatches: 0,
          completedMatches: 0,
          status: "scheduled",
          results_finalized: false,
        };
        cats.push(cat);
      }
      if (!m.parent_team_match) {
        cat.totalMatches++;
        if (m.status === "completed") {
          cat.completedMatches++;
        }
      }
    });

    cats.forEach((cat) => {
      const catMatches = tatamiMatches.filter((m) => m.category === cat.id);
      const hasOngoing = catMatches.some((m) => m.status === "ongoing");
      const hasScheduled = catMatches.some((m) => m.status === "scheduled");

      if (hasOngoing) {
        cat.status = "ongoing";
      } else if (hasScheduled) {
        cat.status = "scheduled";
      } else {
        cat.status = "completed";
      }

      const dbCat = categories.find((c) => c.id === cat.id);
      cat.results_finalized = dbCat?.results_finalized ?? false;
    });

    return [...cats].sort((a, b) => a.schedule_order - b.schedule_order || a.id - b.id);
  }, [tatamiMatches, categories]);

  // Ref to track last active match ID, so we only auto-focus category when the match changes
  const lastActiveMatchIdRef = useRef<number | null>(null);

  // Auto-selection of active category when a new match starts/assigns
  useEffect(() => {
    if (currentMatch) {
      if (currentMatch.id !== lastActiveMatchIdRef.current) {
        lastActiveMatchIdRef.current = currentMatch.id;
        setSelectedCategoryId(currentMatch.category);
      }
    } else {
      lastActiveMatchIdRef.current = null;
    }
  }, [currentMatch]);

  // Fallback auto-selection when no match is active and no category is selected
  useEffect(() => {
    if (!currentMatch && !selectedCategoryId && tatamiCategories.length > 0) {
      const activeCat =
        tatamiCategories.find((c) => c.status === "ongoing") ||
        tatamiCategories.find((c) => c.status === "scheduled") ||
        tatamiCategories[0];
      if (activeCat) {
        setSelectedCategoryId(activeCat.id);
      }
    }
  }, [currentMatch, tatamiCategories, selectedCategoryId]);

  // Matches of the selected category
  const selectedCategoryMatches = useMemo(() => {
    if (!selectedCategoryId) return [];
    return tatamiMatches.filter((m) => m.category === selectedCategoryId);
  }, [tatamiMatches, selectedCategoryId]);

  // Group matches of selected category by round
  const matchesByRound = useMemo(() => {
    const roundsMap: { [round: number]: Match[] } = {};
    selectedCategoryMatches.forEach((m) => {
      if (!roundsMap[m.round_index]) {
        roundsMap[m.round_index] = [];
      }
      roundsMap[m.round_index].push(m);
    });

    // Sort matches in each round by match_order
    Object.keys(roundsMap).forEach((r) => {
      roundsMap[Number(r)] = [...roundsMap[Number(r)]].sort((a, b) => {
        if (a.match_order !== b.match_order) return a.match_order - b.match_order;
        const aIsParent = !a.parent_team_match;
        const bIsParent = !b.parent_team_match;
        if (aIsParent && !bIsParent) return -1;
        if (!aIsParent && bIsParent) return 1;
        return (a.bout_index ?? 0) - (b.bout_index ?? 0);
      });
    });

    return roundsMap;
  }, [selectedCategoryMatches]);

  // Upcoming matches across the entire tatami
  const nextUpcomingMatches = useMemo(() => {
    const activeMatchId = getTatamiMatchId(tatami?.current_match ?? null);

    // Фільтруємо заплановані бої (крім активного)
    const scheduled = tatamiMatches.filter((m) => m.status === "scheduled" && m.id !== activeMatchId);

    // Збираємо список боїв для відображення черги:
    // - Якщо це одиночний поєдинок (!m.category_is_team), додаємо його.
    // - Якщо це саб-баут (m.parent_team_match != null), додаємо його.
    // - Якщо це головний командний поєдинок (m.category_is_team && !m.parent_team_match), ми додаємо його
    //   тільки якщо у нього ще немає жодних запланованих саб-боїв.
    const list = scheduled.filter((m) => {
      if (!m.category_is_team) return true;
      if (m.parent_team_match) return true;
      const hasScheduledBouts = scheduled.some((x) => x.parent_team_match === m.id);
      return !hasScheduledBouts;
    });

    return [...list]
      .sort((a, b) => {
        const orderA = a.category_order ?? 0;
        const orderB = b.category_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;

        if (a.parent_team_match && b.parent_team_match && a.parent_team_match === b.parent_team_match) {
          return (a.bout_index ?? 0) - (b.bout_index ?? 0);
        }

        return a.category === b.category
          ? a.round_index === b.round_index
            ? a.match_order - b.match_order
            : a.round_index - b.round_index
          : a.category - b.category;
      })
      .slice(0, 5);
  }, [tatamiMatches, tatami]);

  const nextMatchId = nextUpcomingMatches[0]?.id ?? null;

  const renderMatchCard = (m: Match, isCurrent: boolean) => {
    const isCompleted = m.status === "completed";
    const isNext = m.id === nextMatchId;

    const aoName = formatParticipant(m.reg_second, m.athlete_second);
    const akaName = formatParticipant(m.reg_first, m.athlete_first);
    const winnerReg = m.winner === m.reg_first?.id ? m.reg_first : m.reg_second;
    const winnerAthlete = m.winner === m.reg_first?.id ? m.athlete_first : m.athlete_second;
    const winnerName = winnerReg ? formatParticipant(winnerReg, winnerAthlete) : "";

    let matchItemClass: string;
    if (isCurrent) {
      matchItemClass = "border-amber-500/80 bg-amber-500/10 shadow-sm shadow-amber-500/5";
    } else if (isCompleted) {
      matchItemClass = "border-border/45 bg-muted/20 opacity-60 hover:opacity-90 transition-opacity cursor-pointer";
    } else if (isNext) {
      matchItemClass = "border-amber-500 bg-amber-500/5 animate-pulse cursor-pointer shadow-md";
    } else {
      matchItemClass = "border-border hover:border-border/80 hover:bg-muted/30 cursor-pointer";
    }

    return (
      <button
        key={m.id}
        disabled={isCurrent}
        onClick={() => {
          if (getTatamiMatchId(tatami?.current_match ?? null) === m.id) {
            setCurrentMatch(m);
            setTimerState(matchToTimerState(m));
            return;
          }
          if (isCompleted) {
            setCurrentMatch(m);
            setTimerState(matchToTimerState(m));
          } else {
            handleAssignMatch(m.id);
          }
        }}
        className={cn(
          "w-full text-left rounded-lg border px-3 py-2 text-xs transition-all relative overflow-hidden",
          matchItemClass,
        )}
      >
        <div className="flex items-center justify-between text-muted-foreground mb-0.5">
          <span className="font-semibold text-[10px]">
            R{m.round_index}.{m.match_order}
            {m.parent_team_match ? ` · Бій #${m.bout_index}` : m.category_is_team ? " · Команда" : ""}
          </span>
          {isNext && (
            <Badge className="text-[8px] px-1 py-0.5 uppercase tracking-wider bg-amber-500 text-black border-none font-bold">
              Наступний
            </Badge>
          )}
          {isCurrent && (
            <Badge variant="outline" className="text-[8px] px-1 py-0.5 uppercase tracking-wider text-amber-500 border-amber-500/40 bg-amber-500/5 font-bold">
              Активний
            </Badge>
          )}
        </div>
        <p className="whitespace-normal break-words text-[11px] font-medium leading-tight">
          <span className="text-blue-400">{aoName}</span>
          <span className="text-muted-foreground text-[9px] font-normal px-0.5"> vs </span>
          <span className="text-red-400">{akaName}</span>
        </p>
          {isCompleted && winnerReg && (
            <p className="text-green-400 text-[10px] mt-1 whitespace-normal break-words flex items-center gap-1 font-semibold">
              ✓ {winnerName}
            </p>
          )}
      </button>
    );
  };

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
          <Button variant="outline" onClick={() => globalThis.window.history.back()}>
            Назад
          </Button>
          <Button variant="sport" onClick={() => globalThis.window.location.reload()}>
            Оновити сторінку
          </Button>
        </div>
      </div>
    );
  }

  const renderTeamMatchDashboard = () => {
    if (!currentMatch) return null;

    const completedBouts = subBouts.filter(b => b.status === "completed");
    const winsAka = completedBouts.filter(b => b.winner === currentMatch.reg_first?.id).length;
    const winsAo = completedBouts.filter(b => b.winner === currentMatch.reg_second?.id).length;
    const pointsAka = completedBouts.reduce((sum, b) => sum + (b.score_first || 0), 0);
    const pointsAo = completedBouts.reduce((sum, b) => sum + (b.score_second || 0), 0);

    const categoryInfo = categories.find(c => c.id === currentMatch.category);
    const teamSize = categoryInfo?.team_size || 3;

    const regularBouts = subBouts.filter(b => (b.bout_index || 0) <= teamSize);
    const allRegularCompleted = regularBouts.length === teamSize && regularBouts.every(b => b.status === "completed");
    const isTie = allRegularCompleted && winsAka === winsAo && pointsAka === pointsAo;

    const firstTeamName = formatRegistrationName(currentMatch.reg_first) || "TBD Aka";
    const firstTeamClub = formatRegistrationClub(currentMatch.reg_first) || "Без клубу";
    const secondTeamName = formatRegistrationName(currentMatch.reg_second) || "TBD Ao";
    const secondTeamClub = formatRegistrationClub(currentMatch.reg_second) || "Без клубу";

    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Scoreboard Header */}
        <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:20px_20px] pointer-events-none" />

          <div className="relative flex items-center justify-between">
            {/* AKA Team Info */}
            <div className="flex-1 text-center pr-4 border-r border-zinc-800/60">
              <Badge className="bg-red-500 hover:bg-red-600 text-white font-bold uppercase tracking-wider text-[10px] mb-2 px-2.5 py-0.5 rounded-full border-none">
                AKA (Червоні)
              </Badge>
              <h2 className="text-xl font-black text-white whitespace-normal break-words mx-auto">
                {firstTeamName}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5 whitespace-normal break-words mx-auto">
                {firstTeamClub}
              </p>
            </div>

            {/* Large Scores Display */}
            <div className="flex items-center gap-6 px-8 select-none">
              <div className="text-center">
                <span className="block text-4xl font-extrabold text-red-500 font-mono">
                  {winsAka}
                </span>
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">
                  Перемог
                </span>
              </div>

              <div className="flex flex-col items-center justify-center">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                  VS
                </span>
                <div className="h-8 w-px bg-zinc-800 my-1" />
                <span className="text-[10px] text-zinc-500 font-mono">
                  {pointsAka} : {pointsAo} (бали)
                </span>
              </div>

              <div className="text-center">
                <span className="block text-4xl font-extrabold text-blue-500 font-mono">
                  {winsAo}
                </span>
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">
                  Перемог
                </span>
              </div>
            </div>

            {/* AO Team Info */}
            <div className="flex-1 text-center pl-4 border-l border-zinc-800/60">
              <Badge className="bg-blue-500 hover:bg-blue-600 text-white font-bold uppercase tracking-wider text-[10px] mb-2 px-2.5 py-0.5 rounded-full border-none">
                AO (Сині)
              </Badge>
              <h2 className="text-xl font-black text-white whitespace-normal break-words mx-auto">
                {secondTeamName}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5 whitespace-normal break-words mx-auto">
                {secondTeamClub}
              </p>
            </div>
          </div>

          {/* Global Controls inside Header */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-zinc-800/60 relative z-10">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleRelease}
                className="text-xs text-zinc-400 hover:text-white border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900"
              >
                Звільнити татамі
              </Button>
            </div>

            {isTie && currentMatch.status !== "completed" && (
              <Button
                variant="sport"
                onClick={handleSpawnExtraBout}
                disabled={busy}
                className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black shadow-lg shadow-amber-500/15"
              >
                Створити додатковий бій (Extra Bout)
              </Button>
            )}

            {currentMatch.status === "completed" && (
              <Badge className="bg-green-500/10 text-green-400 border border-green-500/25 py-1 px-3 rounded-lg text-xs font-semibold">
                Зустріч завершена
              </Badge>
            )}
          </div>
        </div>

        {/* Bouts List Directly on Page */}
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-zinc-300 select-none">
            <Layers className="w-4 h-4 text-amber-500" />
            Список боїв зустрічі ({subBouts.length})
          </h3>

          <div className="space-y-4">
            {loadingSubBouts && subBouts.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 border border-zinc-800 rounded-2xl bg-zinc-900/10 select-none">
                <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mb-2" />
                <p className="text-xs text-zinc-500">Завантаження боїв...</p>
              </div>
            ) : subBouts.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {subBouts.map((bout) => {
                  const isBoutCompleted = bout.status === "completed";
                  const isBoutOngoing = bout.status === "ongoing";
                  const isExtra = (bout.bout_index || 0) > teamSize;

                  const selection = selectedBoutAthletes[bout.id] || { athlete_first_id: "", athlete_second_id: "" };

                  const availableAka = getAvailableAkaAthletes(bout.id);
                  const availableAo = getAvailableAoAthletes(bout.id);

                  const assignedAka = bout.athlete_first;
                  const assignedAo = bout.athlete_second;

                  return (
                    <div
                      key={bout.id}
                      className={cn(
                        "border rounded-2xl p-5 transition-all relative overflow-hidden backdrop-blur-sm",
                        isBoutOngoing
                          ? "border-green-500/40 bg-green-500/5 shadow-md shadow-green-500/5"
                          : isBoutCompleted
                          ? "border-zinc-800/80 bg-zinc-900/10 opacity-85"
                          : "border-zinc-800 bg-zinc-900/20"
                      )}
                    >
                      <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-800/60 select-none">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">
                            {isExtra ? "Додатковий бій (Tie-breaker)" : `Бій №${bout.bout_index}`}
                          </span>
                          {isBoutOngoing && (
                            <Badge className="bg-green-500 text-black text-[9px] uppercase tracking-wider font-bold animate-pulse">
                              В ефірі
                            </Badge>
                          )}
                          {isBoutCompleted && (
                            <Badge className="bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider font-semibold">
                              Завершено
                            </Badge>
                          )}
                        </div>

                        {isBoutCompleted && bout.winner && (
                          <div className="text-xs font-semibold text-green-400 flex items-center gap-1.5">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Переможець: {bout.winner === currentMatch.reg_first?.id ? "Aka" : "Ao"} ({bout.winner === currentMatch.reg_first?.id ? getAthleteName(assignedAka) : getAthleteName(assignedAo)})
                          </div>
                        )}
                      </div>

                      {isBoutCompleted ? (
                        /* Completed Bout View */
                        <div className="flex items-center justify-between text-xs py-1">
                          <div className="flex-1 text-left min-w-0">
                            <p className="font-bold text-red-400 text-sm truncate">{getAthleteName(assignedAka)}</p>
                            <p className="text-[10px] text-zinc-500 truncate">{firstTeamName}</p>
                          </div>

                          <div className="px-6 py-2 rounded-xl bg-zinc-950/60 border border-zinc-800/60 text-center font-mono shrink-0 select-none">
                            <span className="text-lg font-black text-white px-2">
                              {bout.score_first}
                            </span>
                            <span className="text-zinc-600 font-normal">:</span>
                            <span className="text-lg font-black text-white px-2">
                              {bout.score_second}
                            </span>
                            {bout.win_method && (
                              <span className="block text-[8px] text-zinc-500 uppercase mt-0.5 tracking-wider">
                                {bout.win_method_display || bout.win_method}
                              </span>
                            )}
                          </div>

                          <div className="flex-1 text-right min-w-0">
                            <p className="font-bold text-blue-400 text-sm truncate">{getAthleteName(assignedAo)}</p>
                            <p className="text-[10px] text-zinc-500 truncate">{secondTeamName}</p>
                          </div>
                        </div>
                      ) : (
                        /* Scheduled / Ongoing Bout Form */
                        <div className="space-y-4">
                          {!isExtra ? (
                            /* Regular Bout: Read-only pre-assigned athletes */
                            <div className="flex items-center justify-between text-xs py-1">
                              <div className="flex-1 text-left min-w-0">
                                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider block mb-0.5 select-none">AKA (Червоний)</span>
                                <p className="font-bold text-white text-sm truncate">{assignedAka ? getAthleteName(assignedAka) : "BYE / Очікується"}</p>
                                <p className="text-[10px] text-zinc-500 truncate">{firstTeamName}</p>
                              </div>

                              <div className="px-4 py-2 font-mono text-zinc-500 text-xs shrink-0 select-none">
                                VS
                              </div>

                              <div className="flex-1 text-right min-w-0">
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-0.5 select-none">AO (Синій)</span>
                                <p className="font-bold text-white text-sm truncate">{assignedAo ? getAthleteName(assignedAo) : "BYE / Очікується"}</p>
                                <p className="text-[10px] text-zinc-500 truncate">{secondTeamName}</p>
                              </div>
                            </div>
                          ) : (
                            /* Extra Bout: Dropdowns to choose athletes */
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* AKA Athlete selection */}
                              <div className="space-y-1.5 text-left">
                                <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider block select-none">
                                  Боєць AKA (Червоний)
                                </label>
                                <Select
                                  value={selection.athlete_first_id}
                                  onValueChange={(val) => {
                                    setSelectedBoutAthletes(prev => ({
                                      ...prev,
                                      [bout.id]: { ...prev[bout.id], athlete_first_id: val }
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-white text-xs" disabled={availableAka.length === 0 && !assignedAka}>
                                    <SelectValue placeholder={availableAka.length === 0 && !assignedAka ? "Немає доступних бійців" : "Оберіть бійця зі складу"} />
                                  </SelectTrigger>
                                  <SelectContent className="bg-zinc-950 border-zinc-800 text-white">
                                    {assignedAka && (
                                      <SelectItem key={assignedAka.id} value={assignedAka.id.toString()}>
                                        {getAthleteName(assignedAka)} (обрано)
                                      </SelectItem>
                                    )}
                                    {availableAka.map((ath) => (
                                      <SelectItem key={ath.id} value={ath.id.toString()}>
                                        {getAthleteName(ath)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* AO Athlete selection */}
                              <div className="space-y-1.5 text-left">
                                <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block select-none">
                                  Боєць AO (Синій)
                                </label>
                                <Select
                                  value={selection.athlete_second_id}
                                  onValueChange={(val) => {
                                    setSelectedBoutAthletes(prev => ({
                                      ...prev,
                                      [bout.id]: { ...prev[bout.id], athlete_second_id: val }
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-white text-xs" disabled={availableAo.length === 0 && !assignedAo}>
                                    <SelectValue placeholder={availableAo.length === 0 && !assignedAo ? "Немає доступних бійців" : "Оберіть бійця зі складу"} />
                                  </SelectTrigger>
                                  <SelectContent className="bg-zinc-950 border-zinc-800 text-white">
                                    {assignedAo && (
                                      <SelectItem key={assignedAo.id} value={assignedAo.id.toString()}>
                                        {getAthleteName(assignedAo)} (обрано)
                                      </SelectItem>
                                    )}
                                    {availableAo.map((ath) => (
                                      <SelectItem key={ath.id} value={ath.id.toString()}>
                                        {getAthleteName(ath)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}

                          {/* Action buttons for this specific bout */}
                          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800/40 select-none">
                            {isExtra && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => handleSaveLineup(bout.id)}
                                className="text-xs h-8 border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                              >
                                Зберегти склад
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="sport"
                              disabled={busy || (!isExtra && (!assignedAka || !assignedAo))}
                              onClick={() => handleStartBout(bout.id, isExtra)}
                              className="text-xs h-8 font-bold flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-black border-none disabled:opacity-50"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              Викликати на татамі
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/10 select-none">
                Помилка: суб-бої для цієї зустрічі ще не згенеровані.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (tournament && tournament.status === "completed") {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground p-6 text-center">
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-extrabold text-destructive">Турнір завершено</h2>
          <p className="text-muted-foreground text-sm">
            Цей турнір завершився. Доступ до суддівської панелі татамі закритий, зміни в поєдинках заборонені.
          </p>
          <a
            href={`/tournaments/${tid}`}
            className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-accent text-accent-foreground hover:bg-accent/80 font-bold transition-all text-xs"
          >
            Повернутися до турніру
          </a>
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
        <span className="text-sm font-semibold">Татамі №{n}</span>
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ml-1",
          connected
            ? "border-green-500/40 text-green-400 bg-green-500/5"
            : "border-muted text-muted-foreground"
        )}>
          {connected
            ? <><Wifi className="w-3 h-3 text-green-400" /> Live</>
            : <><WifiOff className="w-3 h-3 text-muted-foreground" /> Offline</>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selectedCategoryId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => globalThis.window.open(`/categories/${selectedCategoryId}/bracket`, "_blank")}
              className="text-xs font-medium"
            >
              <GitBranch className="w-3.5 h-3.5 mr-1 text-amber-500" /> Публічна сітка
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => globalThis.window.open(`/scoreboard/tournament/${tid}/tatami/${n}?spectator=true`, "_blank")}
            className="text-xs font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1 text-blue-400" /> Глядацьке табло
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => globalThis.window.open(`/scoreboard/tournament/${tid}/tatami/${n}`, "_blank")}
            className="text-xs font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1 text-red-400" /> Табло проектора
          </Button>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Column 1: Categories List + Next Up Preview (left) ── */}
        <div className="w-72 border-r flex flex-col shrink-0 h-full overflow-hidden bg-card/50">
          <div className="p-3 border-b flex items-center justify-between bg-card shrink-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Категорії татамі
            </p>
            <Badge variant="outline" className="font-mono text-[10px] bg-background">
              {tatamiCategories.length}
            </Badge>
          </div>

          {/* Categories Scrollable List */}
          <div className="p-2 space-y-1 overflow-y-auto flex-1 select-none">
            {tatamiCategories.length > 0 ? (
              tatamiCategories.map((cat) => {
                const isSelected = selectedCategoryId === cat.id;
                const percent = cat.totalMatches > 0 ? Math.round((cat.completedMatches / cat.totalMatches) * 100) : 0;

                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={cn(
                      "w-full text-left rounded-xl p-2.5 transition-all relative overflow-hidden border flex flex-col gap-1.5",
                      isSelected
                        ? "border-amber-500 bg-amber-500/10 shadow-sm shadow-amber-500/5 font-medium"
                        : "border-transparent hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          cat.status === "ongoing" && "bg-green-500 animate-pulse",
                          cat.status === "scheduled" && "bg-amber-500",
                          cat.status === "completed" && "bg-slate-600"
                        )} />
                        <span className="truncate text-xs leading-none">{cat.name}</span>
                        {cat.results_finalized && (
                          <Trophy className="w-3 h-3.5 text-yellow-400 fill-yellow-400/20 shrink-0 ml-1" />
                        )}
                      </div>
                      <span className="font-mono text-[9px] text-muted-foreground shrink-0">
                        {cat.completedMatches}/{cat.totalMatches}
                      </span>
                    </div>

                    {/* Compact progress bar */}
                    <div className="w-full h-1 bg-muted rounded-full overflow-hidden shrink-0">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          cat.status === "completed" ? "bg-slate-500" : "bg-amber-500"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">
                Немає призначених категорій
              </p>
            )}
          </div>

          {/* Next Up Queue Preview (Bottom) */}
          {nextUpcomingMatches.length > 0 && (
            <div className="p-3 border-t bg-card/80 shrink-0 space-y-2 select-none">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                  Наступні бої (Черга)
                </p>
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-background font-mono">
                  {nextUpcomingMatches.length}
                </Badge>
              </div>

              <div className="space-y-1.5">
                {nextUpcomingMatches.map((nm, idx) => {
                  const isFirst = idx === 0;
                  const ao = formatParticipant(nm.reg_second, nm.athlete_second);
                  const aka = formatParticipant(nm.reg_first, nm.athlete_first);

                  return (
                    <div
                      key={nm.id}
                      className={cn(
                        "rounded-lg border p-2 text-[10px] transition-all flex flex-col gap-1 bg-background/50",
                        isFirst ? "border-amber-500/50 bg-amber-500/5 shadow-sm" : "border-border/50"
                      )}
                    >
                      <div className="flex items-center justify-between text-[8px] text-muted-foreground">
                        <span>
                          R{nm.round_index}.{nm.match_order}
                          {nm.parent_team_match ? ` · Бій #${nm.bout_index}` : nm.category_is_team ? " · Команда" : ""}
                          {` · ${nm.category_name}`}
                        </span>
                        {isFirst && (
                          <Badge className="text-[7px] px-1 py-0 bg-amber-500 text-black border-none font-bold uppercase leading-none">
                            Next
                          </Badge>
                        )}
                      </div>
                      <p className="whitespace-normal break-words font-medium leading-normal text-[10px]">
                        <span className="text-blue-400">{ao}</span>
                        <span className="text-muted-foreground px-0.5"> vs </span>
                        <span className="text-red-400">{aka}</span>
                      </p>
                      {isFirst && (
                        <Button
                          size="sm"
                          variant="sport"
                          onClick={() => handleAssignMatch(nm.id)}
                          className="w-full text-[9px] py-1 h-6 mt-1 font-bold flex items-center justify-center gap-1"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" /> Викликати на татамі
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>


        {/* ── Column 2: Matches of Selected Category (middle) ── */}
        <div className="w-80 border-r flex flex-col shrink-0 h-full overflow-hidden bg-card/25">
          {selectedCategoryId ? (() => {
            const cat = tatamiCategories.find((c) => c.id === selectedCategoryId);
            const roundsKeys = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b);

            return (
              <>
                <div className="p-3 border-b bg-card shrink-0 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none">
                        Обрана категорія
                      </p>
                      <h3 className="font-bold text-xs truncate mt-1 text-foreground" title={cat?.name}>
                        {cat?.name}
                      </h3>
                    </div>
                    {cat?.status && (
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0 mt-1",
                        cat.status === "ongoing" && "bg-green-500 animate-pulse",
                        cat.status === "scheduled" && "bg-amber-500",
                        cat.status === "completed" && "bg-slate-600"
                      )} />
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-1.5">
                    {selectedCategoryBracket && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs h-8 border-amber-500/30 text-amber-500 hover:bg-amber-500/5 font-semibold flex items-center justify-center gap-1"
                        onClick={() => setIsBracketModalOpen(true)}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" /> Показати сітку категорії
                      </Button>
                    )}
                    {(() => {
                      const dbCat = categories.find(c => c.id === selectedCategoryId);
                      const resultsPersisted = dbCat?.results_finalized ?? false;

                      if (resultsPersisted && selectedCategoryId) {
                        return (
                          <div className="flex flex-col gap-1.5 w-full">
                            <div className="flex items-center gap-1.5 justify-center py-1.5 px-3 rounded-lg border border-green-500/30 text-green-400 bg-green-500/5 text-xs font-semibold select-none">
                              <CheckCircle className="w-4 h-4 text-green-400" /> Результати зафіксовано
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full text-xs h-8 text-destructive border-destructive/20 hover:bg-destructive/10 font-semibold flex items-center justify-center gap-1"
                              onClick={() => handleUnlockCategoryResults(selectedCategoryId)}
                              disabled={savingResultsCategoryId === selectedCategoryId}
                            >
                              <RefreshCw className={cn("w-3.5 h-3.5 mr-1", savingResultsCategoryId === selectedCategoryId && "animate-spin")} />
                              Скасувати фіксацію
                            </Button>
                          </div>
                        );
                      }

                      if (cat && cat.status === "completed") {
                        return (
                          <Button
                            size="sm"
                            variant="sport"
                            className="w-full text-xs h-8 font-bold flex items-center justify-center gap-1 shadow-sm shadow-amber-500/10"
                            onClick={() => handleSaveCategoryResults(cat.id, placeOverrides)}
                            disabled={savingResultsCategoryId === cat.id}
                          >
                            {savingResultsCategoryId === cat.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                            ) : (
                              <Award className="w-3.5 h-3.5 mr-1" />
                            )}
                            Зафіксувати результати
                          </Button>
                        );
                      }

                      return null;
                    })()}
                  </div>
                </div>

                {/* Tabs for Matches / Results */}
                <div className="flex border-b border-border text-center shrink-0 bg-muted/20">
                  <button
                    onClick={() => setMiddleTab("matches")}
                    className={cn(
                      "flex-1 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all",
                      middleTab === "matches"
                        ? "text-amber-500 border-amber-500 bg-amber-500/5"
                        : "text-muted-foreground border-transparent hover:text-foreground"
                    )}
                  >
                    Поєдинки
                  </button>
                  <button
                    onClick={() => setMiddleTab("results")}
                    className={cn(
                      "flex-1 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all",
                      middleTab === "results"
                        ? "text-amber-500 border-amber-500 bg-amber-500/5"
                        : "text-muted-foreground border-transparent hover:text-foreground"
                    )}
                  >
                    Результати / Залік
                  </button>
                </div>

                {middleTab === "matches" ? (
                  /* Matches grouped by round */
                  <div className="p-2 space-y-4 overflow-y-auto flex-1 select-none">
                    {roundsKeys.length > 0 ? (
                      roundsKeys.map((roundIdx) => {
                        const roundMatches = matchesByRound[roundIdx];

                        return (
                          <div key={roundIdx} className="space-y-1.5">
                            <p className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-widest px-1">
                              {resolveRoundLabel(roundIdx, selectedCategoryBracket?.format, selectedCategoryBracket?.rounds.length ?? 0)}
                            </p>
                            <div className="space-y-1.5">
                              {roundMatches.map((m) => renderMatchCard(m, currentMatch?.id === m.id))}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        Немає матчів у цій категорії
                      </p>
                    )}
                  </div>
                ) : (
                  /* Results/Standings Table */
                  <div className="p-3 space-y-4 overflow-y-auto flex-1 select-none">
                    {selectedCategoryBracket?.format === "round_robin" && (
                      <div className="mb-4">
                        <RoundRobinTable matches={selectedCategoryMatches} />
                      </div>
                    )}
                    <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">Залікова таблиця</h3>
                    <div className="rounded-xl border border-border bg-card/30 overflow-hidden divide-y divide-border/50">
                      {categoryResults.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">Немає даних для заліку</p>
                      ) : (() => {
                        const dbCat = categories.find(c => c.id === selectedCategoryId);
                        const resultsPersisted = dbCat?.results_finalized ?? false;

                        return categoryResults.map((res: CategoryResult) => (
                          <OperatorResultRow
                            key={res.registration.id}
                            res={res}
                            resultsPersisted={resultsPersisted}
                            placeOverride={placeOverrides[res.registration.id] ?? null}
                            onOverrideChange={(regId, val) => {
                              setPlaceOverrides((prev) => ({ ...prev, [regId]: val }));
                            }}
                          />
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </>
            );
          })() : (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center text-muted-foreground">
              <Layers className="w-8 h-8 opacity-25 mb-2" />
              <p className="text-xs">Виберіть категорію для перегляду її матчів</p>
            </div>
          )}
        </div>


        {/* ── Column 3: Current Match / Scoring Controls (right) ── */}
        <div className="flex-1 overflow-y-auto p-6 bg-background/30">
          {currentMatch ? (
            currentMatch.category_is_team && !currentMatch.parent_team_match && currentMatch.is_team_bouts_supported ? (
              renderTeamMatchDashboard()
            ) : currentMatch.judging_mode === "points" ? (
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
                  fetchCategories();
                  fetchCategoryResults();
                }}
                onRelease={handleRelease}
                onCompleteAndNext={handleCompleteAndNext}
                onNextMatch={handleNextMatch}
                disabled={busy}
              />
            ) : (
              <KataOperatorPanel
                match={currentMatch}
                timerState={timerState}
                remainingMs={remainingMs}
                serverTimeOffset={serverTimeOffset}
                onMatchUpdate={(m) => {
                  setCurrentMatch(m);
                  setMatches((prev) => prev.map((x) => x.id === m.id ? m : x));
                  setTimerState(matchToTimerState(m));
                  fetchCategories();
                  fetchCategoryResults();
                }}
                onRelease={handleRelease}
                onNextMatch={handleNextMatch}
                disabled={busy}
              />
            )
          ) : (
            (() => {
              if (selectedCategoryId) {
                const activeCat = tatamiCategories.find((c) => c.id === selectedCategoryId);
                const isProjected = tatami?.active_results_category === selectedCategoryId;

                return (
                  <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto space-y-6 select-none py-6">
                    <div className="text-center space-y-1.5">
                      <Badge variant="outline" className="text-[10px] bg-card px-2 py-0.5 text-muted-foreground uppercase tracking-widest font-mono">
                        Татамі вільне
                      </Badge>
                      <h3 className="font-extrabold text-base text-foreground uppercase tracking-wide mt-2">
                        {activeCat?.name}
                      </h3>
                      <div className="w-12 h-1 bg-amber-500 mx-auto mt-2 rounded-full" />
                    </div>

                    {categoryResults.length > 0 ? (
                      <div className="w-full bg-card/40 border border-border/80 rounded-2xl p-5 space-y-5 backdrop-blur-sm shadow-md">
                        <div className="flex items-center justify-between border-b border-border/60 pb-3">
                          <div className="flex items-center gap-2">
                            <Trophy className="w-4.5 h-4.5 text-amber-500" />
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Прев'ю списку призерів</span>
                          </div>
                          <div className="flex gap-2">
                            {isProjected ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleSetScoreboardCategory(null)}
                                className="text-[10px] h-7 px-2.5 font-semibold"
                              >
                                Прибрати з табло
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="sport"
                                onClick={() => handleSetScoreboardCategory(selectedCategoryId)}
                                className="text-[10px] h-7 px-2.5 font-bold"
                              >
                                Вивести на табло
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Standings List Preview */}
                        <div className="space-y-2.5 max-w-md mx-auto">
                          {categoryResults
                            .filter((r) => r.place != null && (r.place ?? 0) > 0)
                            .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
                            .map((res: CategoryResult) => {
                              const place = res.place;
                              const name = formatRegistrationName(res.registration) || res.name || "—";
                              const club = formatRegistrationClub(res.registration) || res.club || "Без клубу";

                              let badgeClass = "bg-zinc-800 text-zinc-400";
                              if (place === 1) badgeClass = "bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 text-black font-black";
                              else if (place === 2) badgeClass = "bg-gradient-to-r from-slate-300 via-zinc-200 to-slate-400 text-black font-black";
                              else if (place === 3) badgeClass = "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 text-white font-black";

                              return (
                                <div
                                  key={res.registration?.id}
                                  className={cn(
                                    "flex items-center justify-between p-3 rounded-xl border text-xs",
                                    place === 1 ? "bg-yellow-500/5 border-yellow-500/20" :
                                    place === 2 ? "bg-slate-300/5 border-slate-300/10" :
                                    place === 3 ? "bg-amber-700/5 border-amber-700/10" :
                                    "bg-zinc-900/40 border-zinc-800/50"
                                  )}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0", badgeClass)}>
                                      {place}
                                    </div>
                                    <div className="flex flex-col text-left">
                                      <span className="font-bold text-foreground text-sm leading-tight">
                                        {name}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground leading-normal">
                                        {club}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-lg select-none">
                                    {place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : ""}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full border border-dashed rounded-xl p-8 text-center text-muted-foreground text-xs">
                        Турнірна сітка порожня або бої ще не розпочалися
                      </div>
                    )}

                    {nextUpcomingMatches.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => handleAssignMatch(nextUpcomingMatches[0].id)}
                        className="font-bold flex items-center gap-1.5 text-xs py-2 px-4 border-amber-500/30 text-amber-500 hover:bg-amber-500/5"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" /> Викликати наступний бій
                      </Button>
                    )}
                  </div>
                );
              }

              return (
                <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center space-y-4 select-none">
                  <div className="w-16 h-16 rounded-2xl border border-dashed flex items-center justify-center text-muted-foreground/40">
                    <Trophy className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-foreground">Татамі вільне</h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                      Наразі немає активного поєдинку. Оберіть бій із розкладу категорії ліворуч або скористайтеся швидким викликом.
                    </p>
                  </div>
                  {nextUpcomingMatches.length > 0 && (
                    <Button
                      variant="sport"
                      onClick={() => handleAssignMatch(nextUpcomingMatches[0].id)}
                      className="font-bold flex items-center gap-1.5 text-xs py-2 px-4"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Викликати наступний бій
                    </Button>
                  )}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* ── Live Category Bracket Modal ── */}
      <Dialog open={isBracketModalOpen} onOpenChange={setIsBracketModalOpen}>
        <DialogContent className="max-w-6xl w-[94vw] h-[85vh] flex flex-col bg-card border-border shadow-2xl rounded-2xl overflow-hidden p-0 gap-0">
          <DialogHeader className="p-4 border-b shrink-0 flex flex-row items-center justify-between gap-4 bg-muted/20">
            <div>
              <DialogTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Інтерактивна сітка змагань
              </DialogTitle>
              <h2 className="text-base font-bold text-foreground mt-1">
                {tatamiCategories.find(c => c.id === selectedCategoryId)?.name}
              </h2>
            </div>
            {loadingBracket && (
              <RefreshCw className="w-4 h-4 animate-spin text-amber-500 mr-8" />
            )}
          </DialogHeader>

          <div className="flex-1 overflow-auto p-6 bg-background/25">
            {(() => {
              const dbCat = categories.find(c => c.id === selectedCategoryId);
              const resultsPersisted = dbCat?.results_finalized ?? false;
              const standings = categoryResults.filter(r => r.place != null && (r.place ?? 0) > 0).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));

              return (
                <>
                  {resultsPersisted && standings.length > 0 && (
                    <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-3 space-y-2 max-w-4xl mx-auto mb-4 select-none">
                      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Trophy className="w-3.5 h-3.5 text-yellow-500" /> Переможці та призери
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                        {standings.map((res: CategoryResult) => {
                          const place = res.place;
                          const name = formatRegistrationName(res.registration) || res.name;
                          const club = res.registration?.athlete?.club?.name ?? res.registration?.team?.club?.name ?? res.club ?? "Без клубу";
                        let badge = "🥇";
                          if ((place ?? 0) > 3) badge = "🎖️";
                          else if (place === 3) badge = "🥉";
                          else if (place === 2) badge = "🥈";

                          return (
                            <div key={res.registration?.id} className="flex items-center gap-2 p-1.5 bg-zinc-950/60 border border-zinc-800/50 rounded-lg">
                              <span className="text-base select-none shrink-0">{badge}</span>
                              <div className="flex flex-col min-w-0 text-left">
                                <span className="font-bold text-[11px] text-white whitespace-normal break-words leading-tight">{name}</span>
                                <span className="text-[9px] text-zinc-400 whitespace-normal break-words leading-normal">{club}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedCategoryBracket ? (
                    selectedCategoryBracket.rounds.length > 0 ? (
                      <BracketView
                        bracket={selectedCategoryBracket}
                        onMatchClick={(m) => {
                          if (m.status === "scheduled") {
                            handleAssignMatch(m.id);
                            setIsBracketModalOpen(false);
                          }
                        }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
                        Матчі сітки ще не сформовані
                      </div>
                    )
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
                      {loadingBracket ? "Завантаження сітки..." : "Помилка завантаження сітки"}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Winner dialog for legacy rulesets ── */}
      <Dialog open={!!winnerDialog} onOpenChange={(o) => !o && setWinnerDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Оголосити переможця:{" "}
              <span className={winnerDialog === "ao" ? "text-blue-400" : "text-red-400"}>
                {winnerDialog === "ao"
                  ? (formatRegistrationName(currentMatch?.reg_second) || "AO")
                  : (formatRegistrationName(currentMatch?.reg_first) || "AKA")}
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

      {/* ── Assign confirmation dialog if a match is already ongoing ── */}
      <Dialog open={assignConfirmDialog !== null} onOpenChange={(o) => !o && setAssignConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5" /> Увага! Бій уже триває
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              На татамі наразі встановлено інший активний бій, який перебуває в статусі **"Триває"**.
            </p>
            <p>
              Призначення нового поєдинку призупинить поточний бій і зніме його з татамі. Ви впевнені, що хочете продовжити?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignConfirmDialog(null)}>Скасувати</Button>
            <Button variant="destructive" onClick={() => assignConfirmDialog && handleAssignMatch(assignConfirmDialog, true)}>
              Так, призначити новий бій
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
