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
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer } from "@/hooks/useTimer";
import type { TimerState } from "@/hooks/useTimer";
import KumiteWKFOperatorPanel from "@/components/operator/KumiteWKFOperatorPanel";
import KataOperatorPanel from "@/components/operator/KataOperatorPanel";
import { BracketView } from "@/components/bracket/BracketView";
import { RoundRobinTable } from "@/components/bracket/RoundRobinTable";
import type { Match, RulesetInfo, Tatami, Tournament, BracketResponse, Category } from "@/types/api";

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
    athlete: {
      full_name: string;
      club?: { name?: string } | null;
    };
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

function getTatamiMatchId(currentMatch: Match | null | number | Record<string, unknown>): number | null {
  if (!currentMatch) return null;
  if (typeof currentMatch === "object") return currentMatch.id;
  return currentMatch;
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
      const rounds = bracketRes.data.map(r => r.matches);
      setSelectedCategoryBracket({
        format: catRes.data.bracket_format,
        rounds: rounds
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

  useTatamiSocket(tid!, n!, {
    onClockOffsetUpdate: setServerTimeOffset,
    onSnapshot(data) {
      setConnected(true);
      setTatami(data.tatami);
      setCurrentMatch((prev) => {
        const isViewingPastMatch = prev !== null && prev.status === "completed";
        if (isViewingPastMatch) {
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
      setSelectedCategoryBracket((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rounds: prev.rounds.map((round) =>
            round.map((m) => m.id === match.id ? match : m)
          ),
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
      setTatami(data.tatami);
      setCurrentMatch((prev) => {
        const isViewingPastMatch = prev !== null && prev.status === "completed";
        if (isViewingPastMatch) {
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

  const handleNextMatch = async () => {
    if (!tatami || !currentMatch) return;
    setBusy(true);
    try {
      const nextMatch = tatamiMatches.find(
        (m) => m.status === "scheduled" && m.id !== currentMatch.id && m.category === currentMatch.category
      );

      if (nextMatch) {
        const { data } = await api.post<Tatami>(`/tatamis/${tatami.id}/assign_match/`, { match_id: nextMatch.id });
        setTatami(data);
        setCurrentMatch(nextMatch);
        setTimerState(matchToTimerState(nextMatch));
        toast({ title: `Перехід до наступного бою: ${nextMatch.reg_first?.athlete?.full_name ?? "—"} vs ${nextMatch.reg_second?.athlete?.full_name ?? "—"}` });
      } else {
        const nextAnyMatch = tatamiMatches.find(
          (m) => m.status === "scheduled" && m.id !== currentMatch.id
        );
        if (nextAnyMatch) {
          const { data } = await api.post<Tatami>(`/tatamis/${tatami.id}/assign_match/`, { match_id: nextAnyMatch.id });
          setTatami(data);
          setCurrentMatch(nextAnyMatch);
          setTimerState(matchToTimerState(nextAnyMatch));
          toast({ title: `Перехід до наступного бою: ${nextAnyMatch.reg_first?.athlete?.full_name ?? "—"} vs ${nextAnyMatch.reg_second?.athlete?.full_name ?? "—"}` });
        } else {
          toast({ title: "Всі бої на татамі завершено!" });
        }
      }
      fetchMatches();
      fetchCategories();
      fetchCategoryResults();
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

      // Автоматичний пошук та призначення наступного поєдинку в БД
      const nextMatch = tatamiMatches.find(
        (m) => m.status === "scheduled" && m.id !== currentMatch.id && m.category === currentMatch.category
      );

      if (nextMatch) {
        const { data } = await api.post<Tatami>(`/tatamis/${tatami.id}/assign_match/`, { match_id: nextMatch.id });
        setTatami(data);
        setCurrentMatch(nextMatch);
        setTimerState(matchToTimerState(nextMatch));
        toast({ title: `Перехід до наступного бою: ${nextMatch.reg_first?.athlete?.full_name ?? "—"} vs ${nextMatch.reg_second?.athlete?.full_name ?? "—"}` });
      } else {
        const nextAnyMatch = tatamiMatches.find(
          (m) => m.status === "scheduled" && m.id !== currentMatch.id
        );
        if (nextAnyMatch) {
          const { data } = await api.post<Tatami>(`/tatamis/${tatami.id}/assign_match/`, { match_id: nextAnyMatch.id });
          setTatami(data);
          setCurrentMatch(nextAnyMatch);
          setTimerState(matchToTimerState(nextAnyMatch));
          toast({ title: `Перехід до наступного бою: ${nextAnyMatch.reg_first?.athlete?.full_name ?? "—"} vs ${nextAnyMatch.reg_second?.athlete?.full_name ?? "—"}` });
        } else {
          toast({ title: "Всі бої на татамі завершено!" });
        }
      }
      fetchMatches();
      fetchCategories();
      fetchCategoryResults();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Помилка фіксації результату";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const tatamiMatches = useMemo(() => {
    if (!tatami) return [];
    return matches.filter((m) => m.tatami === tatami.id);
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
      cat.totalMatches++;
      if (m.status === "completed") {
        cat.completedMatches++;
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

    return cats.sort((a, b) => a.schedule_order - b.schedule_order || a.id - b.id);
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
      roundsMap[Number(r)].sort((a, b) => a.match_order - b.match_order);
    });

    return roundsMap;
  }, [selectedCategoryMatches]);

  // Upcoming matches across the entire tatami
  const nextUpcomingMatches = useMemo(() => {
    const activeMatchId = getTatamiMatchId(tatami?.current_match);
    const scheduled = tatamiMatches.filter((m) => m.status === "scheduled" && m.id !== activeMatchId);
    return scheduled
      .sort((a, b) => {
        const orderA = a.category_order ?? 0;
        const orderB = b.category_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.category === b.category
          ? a.round_index === b.round_index
            ? a.match_order - b.match_order
            : a.round_index - b.round_index
          : a.category - b.category;
      })
      .slice(0, 3);
  }, [tatamiMatches, tatami]);

  const nextMatchId = nextUpcomingMatches[0]?.id ?? null;

  const renderMatchCard = (m: Match, isCurrent: boolean) => {
    const isCompleted = m.status === "completed";
    const isNext = m.id === nextMatchId;
    const aoName = m.reg_second?.athlete?.full_name ?? "TBD";
    const akaName = m.reg_first?.athlete?.full_name ?? "TBD";
    const winnerReg = m.winner === m.reg_first?.id ? m.reg_first : m.reg_second;

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
          if (getTatamiMatchId(tatami?.current_match) === m.id) {
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
          <span className="font-semibold text-[10px]">R{m.round_index}.{m.match_order}</span>
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
        <p className="truncate text-[11px] font-medium leading-tight">
          <span className="text-blue-400">{aoName}</span>
          <span className="text-muted-foreground text-[9px] font-normal px-0.5"> vs </span>
          <span className="text-red-400">{akaName}</span>
        </p>
        {isCompleted && winnerReg && (
          <p className="text-green-400 text-[10px] mt-1 truncate flex items-center gap-1 font-semibold">
            ✓ {winnerReg.athlete?.full_name}
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
              onClick={() => window.open(`/categories/${selectedCategoryId}/bracket`, "_blank")}
              className="text-xs font-medium"
            >
              <GitBranch className="w-3.5 h-3.5 mr-1 text-amber-500" /> Публічна сітка
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/scoreboard/tournament/${tid}/tatami/${n}?spectator=true`, "_blank")}
            className="text-xs font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1 text-blue-400" /> Глядацьке табло
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/scoreboard/tournament/${tid}/tatami/${n}`, "_blank")}
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
                  const ao = nm.reg_second?.athlete?.full_name ?? "TBD";
                  const aka = nm.reg_first?.athlete?.full_name ?? "TBD";

                  return (
                    <div
                      key={nm.id}
                      className={cn(
                        "rounded-lg border p-2 text-[10px] transition-all flex flex-col gap-1 bg-background/50",
                        isFirst ? "border-amber-500/50 bg-amber-500/5 shadow-sm" : "border-border/50"
                      )}
                    >
                      <div className="flex items-center justify-between text-[8px] text-muted-foreground">
                        <span>R{nm.round_index}.{nm.match_order} · {nm.category_name}</span>
                        {isFirst && (
                          <Badge className="text-[7px] px-1 py-0 bg-amber-500 text-black border-none font-bold uppercase leading-none">
                            Next
                          </Badge>
                        )}
                      </div>
                      <p className="truncate font-medium leading-normal text-[10px]">
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

                        // Format round labels
                        let roundLabel = `Раунд ${roundIdx}`;
                        if (selectedCategoryBracket && selectedCategoryBracket.format !== "round_robin") {
                          const total = selectedCategoryBracket.rounds.length;
                          const fromEnd = total - roundIdx;
                          if (fromEnd === 0) roundLabel = "Фінал";
                          else if (fromEnd === 1) roundLabel = "Півфінал";
                          else if (fromEnd === 2) roundLabel = "Чвертьфінал";
                        }

                        return (
                          <div key={roundIdx} className="space-y-1.5">
                            <p className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-widest px-1">
                              {roundLabel}
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

                        return categoryResults.map((res: CategoryResult) => {
                          const placeVal = resultsPersisted ? res.registration?.place : placeOverrides[res.registration.id];

                          const medal =
                            placeVal === 1
                              ? "🥇"
                              : placeVal === 2
                              ? "🥈"
                              : placeVal === 3
                              ? "🥉"
                              : placeVal != null
                              ? `${placeVal}`
                              : "—";

                          return (
                            <div key={res.registration.id} className="flex items-center justify-between p-3 text-xs hover:bg-muted/10 transition-colors">
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
                                    value={placeOverrides[res.registration.id] ?? ""}
                                    onChange={(e) => {
                                      const val = e.target.value === "" ? null : Number(e.target.value);
                                      setPlaceOverrides(prev => ({ ...prev, [res.registration.id]: val }));
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
                                  <span className="font-semibold text-foreground">{res.registration.athlete.full_name}</span>
                                  <span className="text-[10px] text-muted-foreground">{res.registration.athlete.club?.name || "Без клубу"}</span>
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
                        });
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
            currentMatch.judging_mode === "points" ? (
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
                              const name = res.registration?.athlete?.full_name ?? res.name ?? "—";
                              const club = res.registration?.athlete?.club?.name ?? res.club ?? "Без клубу";

                              let badgeClass = "bg-zinc-800 text-zinc-400";
                              if (place === 1) badgeClass = "bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 text-black font-black";
                              else if (place === 2) badgeClass = "bg-gradient-to-r from-slate-300 via-zinc-200 to-slate-400 text-black font-black";
                              else if (place === 3) badgeClass = "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 text-white font-black";

                              return (
                                <div
                                  key={res.registration?.id || res.id}
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
                          const name = res.registration?.athlete?.full_name ?? res.name;
                          const club = res.registration?.athlete?.club?.name ?? res.club ?? "Без клубу";
                          let badge = "🥇";
                          if (place === 2) badge = "🥈";
                          else if (place === 3) badge = "🥉";
                          else if ((place ?? 0) > 3) badge = "🎖️";

                          return (
                            <div key={res.registration?.id || res.id} className="flex items-center gap-2 p-1.5 bg-zinc-950/60 border border-zinc-800/50 rounded-lg">
                              <span className="text-base select-none shrink-0">{badge}</span>
                              <div className="flex flex-col min-w-0 text-left">
                                <span className="font-bold text-[11px] text-white truncate leading-tight">{name}</span>
                                <span className="text-[9px] text-zinc-400 truncate leading-normal">{club}</span>
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
