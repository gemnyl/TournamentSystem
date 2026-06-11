import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Wifi, WifiOff, Trophy } from "lucide-react";
import api from "@/lib/api";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { BracketView } from "@/components/bracket/BracketView";
import { Button } from "@/components/ui/button";
import type { BracketResponse, Category, Match } from "@/types/api";

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
  };
}

export default function BracketPage() {
  const { id } = useParams<{ id: string }>();
  const [bracket, setBracket]   = useState<BracketResponse | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [standings, setStandings] = useState<CategoryStanding[]>([]);

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
        const res = await api.get<CategoryStanding[]>(`/categories/${id}/results/`);
        setStandings(res.data.filter(r => r.place != null && (r.place ?? 0) > 0).sort((a, b) => (a.place ?? 0) - (b.place ?? 0)));
      } catch {
        setStandings([]);
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
      return {
        ...prev,
        rounds: prev.rounds.map((round) =>
          round.map((m) => m.id === updatedMatch.id ? updatedMatch : m)
        ),
      };
    });
    // Silently re-fetch standings to keep standings updated in real-time
    api.get<CategoryStanding[]>(`/categories/${id}/results/`).then((res) => {
      setStandings(res.data.filter(r => r.place != null && (r.place ?? 0) > 0).sort((a, b) => (a.place ?? 0) - (b.place ?? 0)));
    }).catch(() => {});
  }, [id, fetchBracket]);

  useMatchUpdates(Number(id), handleMatchUpdate, {
    onConnect: () => {
      setWsConnected(true);
      fetchBracket(true);
    },
    onDisconnect: () => setWsConnected(false),
  });

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
            <p className="text-sm text-muted-foreground mt-1">
              {formatLabel[bracket.format] ?? bracket.format}
              {" · "}{bracket.rounds.flat().length} матчів
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

          <Button variant="outline" size="sm" onClick={() => fetchBracket()}>
            <RefreshCw className="w-4 h-4" /> Оновити
          </Button>
        </div>
      </div>

      {/* Призери категорії */}
      {standings && standings.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-3 max-w-3xl">
          <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 select-none">
            <Trophy className="w-4 h-4 text-yellow-500" /> Переможці та призери
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            {standings.map((res: Record<string, unknown>) => {
              const place = res.place;
              const name = res.registration?.athlete?.full_name ?? res.name;
              const club = res.registration?.athlete?.club?.name ?? res.club ?? "Без клубу";
              let badge = "🥇";
              if (place === 2) badge = "🥈";
              else if (place === 3) badge = "🥉";
              else if ((place ?? 0) > 3) badge = "🎖️";

              return (
                <div key={res.registration?.id || res.id} className="flex items-center gap-2 p-2 bg-zinc-950/60 border border-zinc-800/50 rounded-lg">
                  <span className="text-xl select-none shrink-0">{badge}</span>
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="font-bold text-xs text-white truncate leading-tight">{name}</span>
                    <span className="text-[10px] text-zinc-400 truncate leading-normal">{club}</span>
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
          <BracketView bracket={bracket} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground">Сітку ще не згенеровано</p>
          <p className="text-xs text-muted-foreground/60">
            Поверніться до категорії та натисніть "Згенерувати сітку"
          </p>
        </div>
      )}
    </div>
  );
}
