/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Wifi, WifiOff, Trophy, Check, Plus, Printer, Download } from "lucide-react";
import api from "@/lib/api";
import { cn, formatRegistrationName, formatRegistrationClub, formatAthleteName } from "@/lib/utils";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { BracketView } from "@/components/bracket/BracketView";
import { MatchCard } from "@/components/bracket/MatchCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { BracketResponse, Category, Match, MatchEvent, Tournament } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface CategoryStanding {
  place?: number | null;
  id?: number;
  name?: string;
  club?: string;
  registration?: {
    id?: number;
    athlete?: {
      full_name?: string;
      club?: { name?: string; region?: string };
    };
    team?: {
      name?: string;
      club?: { name?: string; region?: string };
      athletes?: { last_name: string }[];
    };
  };
}

function getMatchStatusLabel(isDone: boolean, isLive: boolean): string {
  if (isDone) return "Завершено";
  if (isLive) return "У процесі";
  return "Очікує";
}

export default function BracketPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isOrganizer, isJudge } = useAuth();
  const [bracket, setBracket]   = useState<BracketResponse | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPlaceholders, setShowPlaceholders] = useState(() => {
    try {
      return localStorage.getItem("showPlaceholders") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("showPlaceholders", String(showPlaceholders));
    } catch {
      // no-op
    }
  }, [showPlaceholders]);

  const matchStats = useMemo(() => {
    const all = bracket?.rounds.flat() ?? [];
    const technical = all.filter(m => {
      return m.status === "completed" && m.win_method === "walkover";
    }).length;
    const real = all.length - technical;
    return { total: all.length, technical, real };
  }, [bracket]);

  const [wsConnected, setWsConnected] = useState(false);
  const [standings, setStandings] = useState<CategoryStanding[]>([]);

  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [matchBouts, setMatchBouts] = useState<Match[]>([]);
  const [loadingBouts, setLoadingBouts] = useState(false);
  const [matchEvents, setMatchEvents] = useState<MatchEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (!selectedMatch) {
      setMatchEvents([]);
      return;
    }
    const fetchEvents = async () => {
      setLoadingEvents(true);
      try {
        const res = await api.get<MatchEvent[]>(`/matches/${selectedMatch.id}/events/`);
        setMatchEvents(res.data);
      } catch (err) {
        console.error("Failed to fetch match events", err);
      } finally {
        setLoadingEvents(false);
      }
    };
    fetchEvents();
  }, [selectedMatch]);

  const [generatingNextRound, setGeneratingNextRound] = useState(false);
  const [tatamis, setTatamis] = useState<any[]>([]);

  const categoryMatches = useMemo(() => {
    return bracket?.rounds.flat() ?? [];
  }, [bracket]);

  const swissCurrentRound = useMemo(() => {
    if (category?.bracket_format !== "swiss" || categoryMatches.length === 0) return 0;
    return Math.max(...categoryMatches.map((m) => m.round_index), 0);
  }, [category, categoryMatches]);

  const swissMaxRounds = useMemo(() => {
    const activeRegs = category?.confirmed_registrations_count ?? 0;
    return activeRegs > 1 ? Math.ceil(Math.log2(activeRegs)) : 1;
  }, [category]);

  const canGenerateNextSwissRound = useMemo(() => {
    if (category?.bracket_format !== "swiss") return false;
    if (categoryMatches.length === 0) return false;
    if (swissCurrentRound >= swissMaxRounds) return false;

    const currentRoundMatches = categoryMatches.filter((m) => m.round_index === swissCurrentRound);
    return currentRoundMatches.length > 0 && currentRoundMatches.every((m) => m.status === "completed");
  }, [category, categoryMatches, swissCurrentRound, swissMaxRounds]);

  const isCompleted = category?.status === "completed";
  const isChiefJudge = tournament?.chief_judge === user?.id;

  const categoryTatami = useMemo(() => {
    const firstMatchWithTatami = categoryMatches?.find((m) => m.tatami !== null);
    return (firstMatchWithTatami && Array.isArray(tatamis))
      ? tatamis.find((t) => t.id === firstMatchWithTatami.tatami)
      : undefined;
  }, [categoryMatches, tatamis]);

  const canManageSwiss = useMemo(() => {
    return !isCompleted && (
      isOrganizer ||
      (isJudge && categoryTatami && categoryTatami.assigned_judge === user?.id)
    );
  }, [isCompleted, isOrganizer, isJudge, categoryTatami, user]);

  const canPrint = useMemo(() => {
    return !!user && (
      user.role === "admin" ||
      user.role === "organizer" ||
      user.role === "staff" ||
      user.role === "judge" ||
      tournament?.organizer === user.id ||
      tournament?.staff_members?.includes(user.id) ||
      tournament?.judges?.includes(user.id) ||
      isChiefJudge
    );
  }, [user, tournament, isChiefJudge]);

  const handleGenerateNextRound = async () => {
    setGeneratingNextRound(true);
    try {
      await api.post(`/categories/${id}/generate_next_swiss_round/`);
      toast({ title: "Наступний тур успішно згенеровано!" });
      fetchBracket();
    } catch {
      // toast з interceptor
    } finally {
      setGeneratingNextRound(false);
    }
  };

  const fetchBracket = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [bracketRes, catRes] = await Promise.all([
        api.get<unknown>(`/matches/bracket/?category=${id}`),
        api.get<Category>(`/categories/${id}/`),
      ]);

      const roundsData = bracketRes.data as {round_index: number, matches: Match[]}[];
      const rounds = roundsData.map(r => r.matches);

      setBracket({
        format: catRes.data.bracket_format,
        rounds: rounds
      });
      setCategory(catRes.data);

      try {
        const [res, tatamiRes, tournRes] = await Promise.all([
          api.get<CategoryStanding[]>(`/categories/${id}/results/`),
          api.get<any[] | { results: any[] }>(`/tatamis/?tournament=${catRes.data.tournament}`),
          api.get<Tournament>(`/tournaments/${catRes.data.tournament}/`),
        ]);
        setStandings(res.data.filter(r => r.place != null && (r.place ?? 0) > 0).sort((a, b) => (a.place ?? 0) - (b.place ?? 0)));
        const tatamiData = tatamiRes.data;
        setTatamis(Array.isArray(tatamiData) ? tatamiData : (tatamiData.results ?? []));
        setTournament(tournRes.data);
      } catch {
        setStandings([]);
        setTatamis([]);
        setTournament(null);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchBracket(); }, [fetchBracket]);

  // WebSocket: оновлення конкретного матчу в сітці без перезавантаження
  const handleMatchUpdate = useCallback((updatedMatch: Match) => {
    if (!updatedMatch) {
      // General results update event
      fetchBracket(true);
      return;
    }
    setBracket((prev) => {
      if (!prev) return prev;

      const matchExists = prev.rounds.some((round) =>
        round.some((m) => m.id === updatedMatch.id)
      );

      if (!matchExists || updatedMatch.status === "completed" || updatedMatch.is_bracket_reset || (updatedMatch as any).redirect_to_match_id) {
        setTimeout(() => fetchBracket(true), 0);
        return prev;
      }

      return {
        ...prev,
        rounds: prev.rounds.map((round) =>
          round.map((m) => m.id === updatedMatch.id ? updatedMatch : m)
        ),
      };
    });

    setSelectedMatch((prev) => (prev?.id === updatedMatch.id ? updatedMatch : prev));

    setMatchBouts((prevBouts) => {
      return prevBouts.map((b) => b.id === updatedMatch.id ? updatedMatch : b);
    });

    // Silently re-fetch standings to keep standings updated in real-time
    api.get<CategoryStanding[]>(`/categories/${id}/results/`).then((res) => {
      const filtered = res.data.filter(r => r.place != null && (r.place ?? 0) > 0);
      const sortedStandings = [...filtered].sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
      setStandings(sortedStandings);
    }).catch(() => {});
  }, [id, fetchBracket]);

  useMatchUpdates(Number(id), handleMatchUpdate, {
    onConnect: () => {
      setWsConnected(true);
      fetchBracket(true);
    },
    onDisconnect: () => setWsConnected(false),
  });

  const handleMatchClick = useCallback(async (match: Match) => {
    setSelectedMatch(match);
    if (category?.is_team) {
      setLoadingBouts(true);
      setMatchBouts([]);
      try {
        const res = await api.get<Match[]>(`/matches/?parent_team_match=${match.id}`);
        const sortedBouts = [...res.data].sort((a, b) => (a.bout_index ?? 0) - (b.bout_index ?? 0));
        setMatchBouts(sortedBouts);
      } catch (err) {
        console.error("Error fetching team sub-bouts", err);
      } finally {
        setLoadingBouts(false);
      }
    }
  }, [category]);

  const renderBoutsSection = () => {
    if (loadingBouts) {
      return (
        <div className="flex justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
        </div>
      );
    }

    if (matchBouts.length === 0) {
      return (
        <div className="text-center py-6 text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
          Немає призначених поєдинків
        </div>
      );
    }

    const getBoutScore = (mode: string, flags: number | null | undefined, score: number | null | undefined) =>
      mode === "flags" ? (flags ?? 0) : (score ?? 0);

    return (
      <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
        {matchBouts.map((bout) => {
          const boutAka = bout.athlete_first ? formatAthleteName(bout.athlete_first) : "TBD";
          const boutAo = bout.athlete_second ? formatAthleteName(bout.athlete_second) : "TBD";
          const boutAkaClub = bout.athlete_first?.club?.name ?? "";
          const boutAoClub = bout.athlete_second?.club?.name ?? "";

          const boutIsDone = bout.status === "completed";
          const boutIsLive = bout.status === "ongoing";

          const boutScoreAka = getBoutScore(bout.judging_mode, bout.flags_aka, bout.score_first);
          const boutScoreAo = getBoutScore(bout.judging_mode, bout.flags_ao, bout.score_second);

          const boutAkaWon = boutIsDone && bout.winner === selectedMatch?.reg_first?.id;
          const boutAoWon = boutIsDone && bout.winner === selectedMatch?.reg_second?.id;

          return (
            <div
              key={bout.id}
              className={cn(
                "grid grid-cols-7 items-center gap-2 p-3 bg-zinc-950/30 border rounded-xl transition-all",
                boutIsLive ? "border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/10" : "border-zinc-800/80 hover:border-zinc-800"
              )}
            >
              {/* Bout Number */}
              <div className="col-span-7 flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider pb-1 border-b border-zinc-800/40">
                <span>Бій #{bout.bout_index}</span>
                {boutIsLive && <span className="text-red-400 animate-pulse">LIVE</span>}
                {boutIsDone && bout.win_method && <span className="text-zinc-500">{bout.win_method}</span>}
              </div>

              {/* Aka Athlete */}
              <div className="col-span-3 text-left">
                <div className="font-semibold text-xs whitespace-normal break-words text-red-300 flex items-center gap-1">
                  {boutAkaWon && <span className="text-emerald-400 font-bold">✓</span>}
                  {boutAka}
                </div>
                {boutAkaClub && <div className="text-[9px] text-zinc-500 whitespace-normal break-words">{boutAkaClub}</div>}
              </div>

              {/* Bout Score */}
              <div className="col-span-1 text-center font-mono font-bold text-xs text-white">
                {boutScoreAka} : {boutScoreAo}
              </div>

              {/* Ao Athlete */}
              <div className="col-span-3 text-right">
                <div className="font-semibold text-xs whitespace-normal break-words text-blue-300 flex items-center gap-1 justify-end">
                  {boutAo}
                  {boutAoWon && <span className="text-emerald-400 font-bold">✓</span>}
                </div>
                {boutAoClub && <div className="text-[9px] text-zinc-500 whitespace-normal break-words">{boutAoClub}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="container py-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  const formatLabel: Record<string, string> = {
    single_elimination: "Single Elimination",
    double_elimination: "Double Elimination",
    round_robin:        "Round Robin",
    single_repechage:   "Single Elimination with Repechage",
    swiss:              "Швейцарська система",
  };

  return (
    <div className="container py-8 space-y-6">
      {/* Навігація */}
      <Link
        to={`/categories/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> До категорії
      </Link>

      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            {category?.name ?? "Сітка"}
          </h1>
          {bracket && (
            <p className="text-sm text-muted-foreground mt-1 select-none">
              {formatLabel[bracket.format] ?? bracket.format}
              {" · "}
              {showPlaceholders
                ? `${matchStats.real} боїв + ${matchStats.technical} технічних (всього ${matchStats.total})`
                : `${matchStats.real} боїв (приховано ${matchStats.technical} технічних)`
              }
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Статус WebSocket */}
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
            wsConnected
              ? "border-green-500/40 text-green-400 bg-green-500/5"
              : "border-muted text-muted-foreground"
          }`}>
            {wsConnected
              ? <><Wifi className="w-3 h-3" /> Live</>
              : <><WifiOff className="w-3 h-3" /> Offline</>}
          </div>

          {canManageSwiss && canGenerateNextSwissRound && (
            <Button
              variant="sport"
              size="sm"
              disabled={generatingNextRound}
              onClick={handleGenerateNextRound}
            >
              {generatingNextRound ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Згенерувати наступний тур ({swissCurrentRound + 1}/{swissMaxRounds})
            </Button>
          )}

          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 cursor-pointer select-none mr-2">
            <input
              type="checkbox"
              checked={showPlaceholders}
              onChange={(e) => setShowPlaceholders(e.target.checked)}
              className="rounded border-zinc-800 bg-zinc-950 text-amber-500 focus:ring-amber-500 focus:ring-offset-zinc-950 w-3.5 h-3.5 cursor-pointer"
            />{' '}
            Показувати технічні бої (BYE/TBD)
          </label>

          {canPrint && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/categories/${id}/print?action=print`, "_blank")}
                className="flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Друк сітки
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/categories/${id}/print?action=download`, "_blank")}
                className="flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" /> Завантажити сітку
              </Button>
            </>
          )}

          <Button variant="outline" size="sm" onClick={() => fetchBracket()}>
            <RefreshCw className="w-4 h-4" /> Оновити
          </Button>
        </div>
      </div>

      {/* Призери категорії */}
      {category?.results_finalized && standings && standings.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-3 max-w-3xl">
          <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 select-none">
            <Trophy className="w-4 h-4 text-yellow-500" /> Переможці та призери
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            {standings.map((res) => {
              const place = res.place;
              const name = formatRegistrationName(res.registration) || res.name;
              const club = formatRegistrationClub(res.registration) || res.club || "Без клубу";
              let badge = "🥇";
              if (place === 2) badge = "🥈";
              else if (place === 3) badge = "🥉";
              else if ((place ?? 0) > 3) badge = "🎖️";

              return (
                <div key={res.registration?.id ?? res.id} className="flex items-center gap-2 p-2 bg-zinc-950/60 border border-zinc-800/50 rounded-lg">
                  <span className="text-xl select-none shrink-0">{badge}</span>
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="font-bold text-xs text-white whitespace-normal break-words leading-tight">{name}</span>
                    <span className="text-[10px] text-zinc-400 whitespace-normal break-words leading-normal">{club}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Сітка */}
      {bracket && bracket.rounds.length > 0 ? (
        <div className="rounded-xl border border-border bg-card/30 p-4">
          <BracketView bracket={bracket} showPlaceholders={showPlaceholders} onMatchClick={handleMatchClick} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground">Сітку ще не згенеровано</p>
          <p className="text-xs text-muted-foreground/60">
            Поверніться до категорії та натисніть "Згенерувати сітку"
          </p>
        </div>
      )}

      {/* Втішні поєдинки (Репешаж) */}
      {category?.bracket_format === "single_repechage" && bracket && (
        <div className="rounded-xl border border-border bg-card/30 p-6 space-y-4">
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2 select-none">
            <Trophy className="w-5 h-5 text-amber-500" /> Втішні поєдинки (Репешаж)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Пул А */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2 select-none">
                Пул А (Верхня половина сітки)
              </div>
              <div className="flex flex-col items-center gap-4">
                {bracket.rounds
                  .flat()
                  .filter((m) => m.round_index >= 300 && m.match_order === 1)
                  .filter((m) => {
                    if (showPlaceholders) return true;
                    const isTechnical = m.status === "completed" && m.win_method === "walkover";
                    return !isTechnical;
                  })
                  .sort((a, b) => a.round_index - b.round_index)
                  .map((match) => (
                    <div key={match.id} className="relative flex items-center justify-center w-full">
                      <MatchCard match={match} onClick={handleMatchClick} />
                    </div>
                  ))}
                {bracket.rounds.flat().filter((m) => m.round_index >= 300 && m.match_order === 1).length === 0 && (
                  <div className="text-xs text-zinc-500 italic py-4 select-none">Очікує результатів півфіналів...</div>
                )}
              </div>
            </div>

            {/* Пул Б */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2 select-none">
                Пул Б (Нижня половина сітки)
              </div>
              <div className="flex flex-col items-center gap-4">
                {bracket.rounds
                  .flat()
                  .filter((m) => m.round_index >= 300 && m.match_order === 2)
                  .filter((m) => {
                    if (showPlaceholders) return true;
                    const isTechnical = m.status === "completed" && m.win_method === "walkover";
                    return !isTechnical;
                  })
                  .sort((a, b) => a.round_index - b.round_index)
                  .map((match) => (
                    <div key={match.id} className="relative flex items-center justify-center w-full">
                      <MatchCard match={match} onClick={handleMatchClick} />
                    </div>
                  ))}
                {bracket.rounds.flat().filter((m) => m.round_index >= 300 && m.match_order === 2).length === 0 && (
                  <div className="text-xs text-zinc-500 italic py-4 select-none">Очікує результатів півфіналів...</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальне вікно деталей матчу / поєдинків */}
      <Dialog open={selectedMatch !== null} onOpenChange={(open) => !open && setSelectedMatch(null)}>
        <DialogContent className="max-w-2xl bg-zinc-900 border border-zinc-800 text-white rounded-2xl shadow-2xl p-6">
          {selectedMatch && (() => {
            const formatParticipant = (reg: any, ath: any) => {
              if (!reg) return { name: "BYE", club: "" };
              const teamName = reg.team?.name;
              const athleteName = formatAthleteName(ath) || formatAthleteName(reg?.athlete);
              const clubName = ath?.club?.name ?? reg.athlete?.club?.name ?? reg.team?.club?.name ?? "";
              if (teamName && athleteName) {
                return { name: `${teamName} (${athleteName})`, club: clubName };
              }
              return { name: formatRegistrationName(reg), club: clubName };
            };

            const aka = formatParticipant(selectedMatch.reg_first, selectedMatch.athlete_first);
            const ao = formatParticipant(selectedMatch.reg_second, selectedMatch.athlete_second);

            const isKata = selectedMatch.judging_mode === "flags";
            const scoreFirst = isKata ? (selectedMatch.flags_aka ?? 0) : (selectedMatch.score_first ?? 0);
            const scoreSecond = isKata ? (selectedMatch.flags_ao ?? 0) : (selectedMatch.score_second ?? 0);

            const isDone = selectedMatch.status === "completed";
            const isLive = selectedMatch.status === "ongoing";

            const akaWon = isDone && selectedMatch.winner === selectedMatch.reg_first?.id;
            const aoWon = isDone && selectedMatch.winner === selectedMatch.reg_second?.id;

            return (
              <div className="space-y-6">
                <DialogHeader className="space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-500/80">
                    Раунд {selectedMatch.round_index} · Порядок {selectedMatch.match_order}
                  </div>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    Деталі поєдинку
                    {isLive && (
                      <Badge className="bg-red-500 text-white border-none font-bold animate-pulse text-[10px] px-2 py-0.5 rounded-full">
                        LIVE
                      </Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription className="text-zinc-400 text-xs">
                    {category?.name} {category?.is_team && "• Командна зустріч"}
                  </DialogDescription>
                </DialogHeader>

                {/* Scoreboard Block */}
                <div className="grid grid-cols-7 items-center gap-2 bg-zinc-950/45 p-4 rounded-xl border border-zinc-800/80">
                  {/* AKA */}
                  <div className="col-span-3 text-left space-y-1 pl-2 border-l-4 border-red-500 bg-red-500/5 py-2.5 rounded-r-lg">
                    <span className="text-[9px] font-black tracking-widest text-red-500 block">AKA</span>
                    <div className="font-bold text-sm whitespace-normal break-words flex items-center gap-1">
                      {akaWon && <Check className="w-4 h-4 text-emerald-500 shrink-0 stroke-[3px]" />}
                      {aka.name}
                    </div>
                    {aka.club && <div className="text-[10px] text-zinc-400 whitespace-normal break-words">{aka.club}</div>}
                  </div>

                  {/* SCORE */}
                  <div className="col-span-1 text-center flex flex-col items-center justify-center">
                    <div className="font-mono text-2xl font-black tracking-tight text-amber-400">
                      {selectedMatch.reg_first && selectedMatch.reg_second ? `${scoreFirst} : ${scoreSecond}` : "—"}
                    </div>
                    <div className="text-[9px] font-bold text-zinc-500 uppercase mt-1">
                      {getMatchStatusLabel(isDone, isLive)}
                    </div>
                  </div>

                  {/* AO */}
                  <div className="col-span-3 text-right space-y-1 pr-2 border-r-4 border-blue-500 bg-blue-500/5 py-2.5 rounded-l-lg">
                    <span className="text-[9px] font-black tracking-widest text-blue-500 block">AO</span>
                    <div className="font-bold text-sm whitespace-normal break-words flex items-center gap-1 justify-end">
                      {ao.name}
                      {aoWon && <Check className="w-4 h-4 text-emerald-500 shrink-0 stroke-[3px]" />}
                    </div>
                    {ao.club && <div className="text-[10px] text-zinc-400 whitespace-normal break-words">{ao.club}</div>}
                  </div>
                </div>

                {/* Win method details if completed */}
                {isDone && selectedMatch.win_method && (
                  <div className="text-center text-xs bg-zinc-950/30 border border-zinc-800/40 rounded-lg py-2 px-3 text-amber-500 font-bold uppercase tracking-wider">
                    Перемога: {selectedMatch.win_method}
                  </div>
                )}

                {/* Team Sub-bouts List */}
                {category?.is_team && selectedMatch.is_team_bouts_supported && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400">
                      Склад індивідуальних боїв
                    </h4>

                    {renderBoutsSection()}
                  </div>
                )}

                {/* Хронологія поєдинку */}
                <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400">
                    Хронологія подій поєдинку
                  </h4>

                  {loadingEvents ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                    </div>
                  ) : matchEvents.length === 0 ? (
                    <div className="text-zinc-500 text-xs italic py-2">
                      Подій у цьому поєдинку ще не зафіксовано.
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto pr-1 space-y-2.5">
                      {matchEvents.map((ev) => {
                        const formatEventDescription = (eVal: MatchEvent) => {
                          const t = eVal.event_type;
                          const p = eVal.payload;
                          const cornerText = p.corner ? (p.corner === "aka" ? "AKA (Червоний)" : "AO (Синій)") : "";
                          const isUndo = p.is_undo === true;

                          switch (t) {
                            case "score":
                              return isUndo
                                ? `Скасування балів: ${p.action_key?.toUpperCase()} для ${cornerText}`
                                : `Нарахування балів: ${p.action_key?.toUpperCase()} для ${cornerText}`;
                            case "warning":
                              return isUndo
                                ? `Скасування попередження: ${p.action_key?.toUpperCase()} для ${cornerText}`
                                : `Попередження: ${p.action_key?.toUpperCase()} для ${cornerText}`;
                            case "senshu":
                              return `Сенсю (перший бал): ${p.value ? "Призначено" : "Скасовано"} для ${cornerText}`;
                            case "start":
                              return "Початок поєдинку";
                            case "finish":
                              return "Завершення поєдинку";
                            case "reset":
                              return "Скидання стану поєдинку";
                            case "timer_start":
                              return "Старт таймера";
                            case "timer_pause":
                              return "Пауза таймера";
                            case "timer_resume":
                              return "Продовження таймера";
                            case "timer_reset":
                              return "Скидання таймера";
                            case "timer_set_dur":
                              if (p.duration_ms !== undefined) {
                                return `Встановлено тривалість таймера: ${p.duration_ms / 1000} сек`;
                              }
                              if (p.delta_ms !== undefined) {
                                return `Зміна часу таймера на: ${p.delta_ms / 1000} сек`;
                              }
                              return "Зміна тривалості таймера";
                            case "timer_toggle":
                              return "Відображення таймера змінено";
                            case "flags_decision":
                              return `Рішення суддів (Kata): AKA ${p.flags_aka ?? 0} vs AO ${p.flags_ao ?? 0}`;
                            case "judges_count_change":
                              return `Зміна кількості суддів на татамі: ${p.judges_count ?? 0}`;
                            case "ruleset_event": {
                              const reType = p.ruleset_event_type;
                              const rePayload = p.payload || {};
                              const reCorner = rePayload.corner;

                              const getReCornerText = (c: string) => {
                                if (!c) return "";
                                const isWT = selectedMatch.ruleset_key === "taekwondo_wt";
                                const isJudo = selectedMatch.ruleset_key === "judo_ijf";
                                if (isWT) {
                                  return c === "chung" ? "Chung (Синій)" : "Hong (Червоний)";
                                } else if (isJudo) {
                                  return c === "shiro" ? "Shiro (Білий)" : "Ao (Синій)";
                                } else {
                                  return c === "aka" ? "AKA (Червоний)" : "AO (Синій)";
                                }
                              };

                              const reCornerText = getReCornerText(reCorner);

                              switch (reType) {
                                case "ADD_POINTS":
                                  return `Нарахування балів: +${rePayload.points} для ${reCornerText}`;
                                case "SUB_POINTS":
                                  return `Скасування балів: -${rePayload.points} для ${reCornerText}`;
                                case "ADD_GAM_JEOM": {
                                  const isPassive = rePayload.is_passive === true;
                                  const remSecs = rePayload.remaining_seconds ?? 999;
                                  const passiveText = (isPassive && remSecs <= 10) ? " (пасивна дія в останні 10 сек)" : "";
                                  return `Gam-jeom для ${reCornerText}${passiveText}`;
                                }
                                case "SUB_GAM_JEOM":
                                  return `Скасування Gam-jeom для ${reCornerText}`;
                                case "NEXT_ROUND": {
                                  const rw = rePayload.round_winner;
                                  return rw
                                    ? `Перехід до наступного раунду (Переможець раунду: ${getReCornerText(rw)})`
                                    : "Перехід до наступного раунду";
                                }
                                case "RESET_ROUND":
                                  return "Скидання раунду";
                                case "UNDO_ROUND":
                                  return "Назад (раунд)";
                                case "ADD_WAZA_ARI":
                                   return `Ваза-арі для ${reCornerText}`;
                                case "SUB_WAZA_ARI":
                                   return `Скасування Ваза-арі для ${reCornerText}`;
                                case "ADD_IPPON":
                                   return `Іппон для ${reCornerText}`;
                                case "SUB_IPPON":
                                   return `Скасування Іппон для ${reCornerText}`;
                                case "ADD_SHIDO":
                                   return `Шідо для ${reCornerText}`;
                                case "SUB_SHIDO":
                                   return `Скасування Шідо для ${reCornerText}`;
                                case "START_OSAEKOMI":
                                   return `Початок утримання (Осаєкомі) для ${reCornerText}`;
                                case "STOP_OSAEKOMI":
                                   return "Зупинка утримання (Осаєкомі)";
                                default:
                                  return reType || "Подія правил";
                              }
                            }
                            default:
                              return t;
                          }
                        };

                        const getEventBadgeStyles = (t: string, isUndo: boolean) => {
                          if (isUndo) {
                            return "bg-zinc-800/80 text-zinc-450 border-zinc-700/50";
                          }
                          switch (t) {
                            case "score":
                              return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                            case "warning":
                              return "bg-red-500/10 text-red-500 border-red-500/20";
                            case "start":
                            case "finish":
                              return "bg-amber-500/10 text-amber-500 border-amber-500/20";
                            case "senshu":
                              return "bg-purple-500/10 text-purple-500 border-purple-500/20";
                            case "timer_start":
                            case "timer_resume":
                              return "bg-blue-500/10 text-blue-500 border-blue-500/20";
                            case "timer_pause":
                              return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
                            default:
                              return "bg-zinc-800 text-zinc-300 border-zinc-700/50";
                          }
                        };

                        const formatEventTime = (isoString: string) => {
                          try {
                            const d = new Date(isoString);
                            return d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                          } catch {
                            return "";
                          }
                        };

                        return (
                          <div key={ev.id} className="flex items-start gap-3 text-xs bg-zinc-950/20 p-2.5 rounded-lg border border-zinc-800/40 hover:bg-zinc-950/45 transition-colors">
                            <span className="font-mono text-[10px] text-zinc-500 pt-0.5 select-none shrink-0">
                              {formatEventTime(ev.created_at)}
                            </span>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={cn(
                                  "text-[9px] px-1.5 py-0.5 rounded font-extrabold uppercase border select-none",
                                  getEventBadgeStyles(ev.event_type, ev.payload.is_undo === true)
                                )}>
                                  {ev.event_type} {ev.payload.is_undo === true ? "(UNDO)" : ""}
                                </span>
                                <span className="font-semibold text-zinc-200">
                                  {formatEventDescription(ev)}
                                </span>
                              </div>
                              {ev.judge_name && (
                                <div className="text-[10px] text-zinc-500">
                                  Оператор / Суддя: <span className="text-zinc-400 font-medium">{ev.judge_name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
