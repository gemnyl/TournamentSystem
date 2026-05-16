import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import api from "@/lib/api";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { BracketView } from "@/components/bracket/BracketView";
import { Button } from "@/components/ui/button";
import type { BracketResponse, Category, Match } from "@/types/api";

export default function BracketPage() {
  const { id } = useParams<{ id: string }>();
  const [bracket, setBracket]   = useState<BracketResponse | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  const fetchBracket = useCallback(async () => {
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchBracket(); }, [fetchBracket]);

  // WebSocket: оновлення конкретного матчу в сітці без перезавантаження
  const handleMatchUpdate = useCallback((updatedMatch: Match) => {
    setBracket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rounds: prev.rounds.map((round) =>
          round.map((m) => m.id === updatedMatch.id ? updatedMatch : m)
        ),
      };
    });
  }, []);

  useMatchUpdates(Number(id), handleMatchUpdate, {
    onConnect:    () => setWsConnected(true),
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

          <Button variant="outline" size="sm" onClick={fetchBracket}>
            <RefreshCw className="w-4 h-4" /> Оновити
          </Button>
        </div>
      </div>

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
