import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Loader2, RefreshCw, Layers, ShieldCheck, Wifi, WifiOff, Info, Trophy
} from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useTatamiSocket } from "@/hooks/useTatamiSocket";
import { useTimer, formatTimer } from "@/hooks/useTimer";
import { MatchCard } from "@/components/bracket/MatchCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tatami, Match, Tournament } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
import { formatRegistrationName } from "@/lib/utils";

const DEFAULT_TIMER = {
  status: "not_started" as const,
  started_at_ms: null,
  elapsed_ms: 0,
  duration_ms: 180_000,
};

interface TatamiCardProps {
  readonly tatami: Tatami;
  readonly tid: string;
  readonly isCompleted: boolean;
}

function mapMatchTimerState(match: Match) {
  return {
    status: match.timer_status,
    started_at_ms: match.timer_started_at
      ? new Date(match.timer_started_at).getTime()
      : null,
    elapsed_ms: match.timer_elapsed_ms,
    duration_ms: match.timer_duration_ms,
  };
}

interface UpcomingQueueProps {
  readonly tatami: Tatami;
  readonly currentMatch: Match | null;
}

function UpcomingQueueSection({ tatami, currentMatch }: Readonly<UpcomingQueueProps>) {
  const upcoming = (tatami.upcoming_matches ?? []).filter(m => m.id !== currentMatch?.id);
  if (upcoming.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-2 border-t border-border/40">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        Черга сутичок (наступні):
      </p>
      <div className="space-y-1">
        {upcoming.slice(0, 3).map((nm) => {
          const ao = formatRegistrationName(nm.reg_second) || "TBD";
          const aka = formatRegistrationName(nm.reg_first) || "TBD";
          return (
            <div key={nm.id} className="text-[10px] py-1 px-2 rounded bg-card/60 border border-border/30 flex flex-col gap-0.5">
              <div className="flex items-center justify-between text-[8px] text-muted-foreground font-semibold">
                <span>
                  Раунд {nm.round_index} · Бій {nm.match_order}
                </span>
                {nm.category_name && (
                  <span className="truncate max-w-[120px] text-amber-500/80">
                    {nm.category_name}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 mt-0.5">
                <div className="flex items-start gap-1 text-[11px] font-medium min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />
                  <span className="text-muted-foreground text-[9px] uppercase font-bold shrink-0 mt-0.5">AO:</span>
                  <span className="text-foreground break-words flex-1 min-w-0 leading-tight">{ao}</span>
                </div>
                <div className="flex items-start gap-1 text-[11px] font-medium min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1" />
                  <span className="text-muted-foreground text-[9px] uppercase font-bold shrink-0 mt-0.5">AKA:</span>
                  <span className="text-foreground break-words flex-1 min-w-0 leading-tight">{aka}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TatamiDashboardCard({ tatami: initialTatami, tid, isCompleted }: TatamiCardProps) {
  const { isOrganizer, user } = useAuth();
  const [tatami, setTatami] = useState<Tatami>(initialTatami);
  const [currentMatch, setCurrentMatch] = useState<Match | null>(null);
  const [connected, setConnected] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);

  const { state: timerState, setState: setTimerState, remainingMs } = useTimer(
    DEFAULT_TIMER,
    serverOffset
  );

  useTatamiSocket(tid, initialTatami.number, {
    onClockOffsetUpdate: setServerOffset,
    onSnapshot(data) {
      setConnected(true);
      setTatami(data.tatami);
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        setTimerState(mapMatchTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        setTimerState(DEFAULT_TIMER);
      }
    },
    onMatchEvent(_event, match) {
      setCurrentMatch((prev) => {
        if (prev && prev.id !== match.id) {
          return prev;
        }
        setTimerState(mapMatchTimerState(match));
        return match;
      });
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
      if (data.current_match) {
        setCurrentMatch(data.current_match);
        setTimerState(mapMatchTimerState(data.current_match));
      } else {
        setCurrentMatch(null);
        setTimerState(DEFAULT_TIMER);
      }
    },
  });

  const isActive = tatami.is_active;

  return (
    <Card className={`transition-all duration-300 relative overflow-hidden flex flex-col h-full bg-card/40 border-border/80 ${
      isActive
        ? "hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5 cursor-pointer"
        : "opacity-60 cursor-default"
    }`}>
      {/* Top Banner / Color Accent */}
      <div className={`h-1.5 w-full shrink-0 ${
        isActive
          ? currentMatch?.status === "ongoing"
            ? "bg-green-500 animate-pulse"
            : "bg-amber-500/60"
          : "bg-slate-700"
      }`} />

      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg font-bold flex items-baseline gap-2">
            <span className="font-mono text-xl text-amber-500">#{tatami.number}</span>
            <span className="truncate text-base">{tatami.name || `Татамі ${tatami.number}`}</span>
          </CardTitle>

          <div className="flex items-center gap-1.5">
            {isActive && (
              <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-all ${
                connected
                  ? "border-green-500/40 text-green-400 bg-green-500/5"
                  : "border-muted text-muted-foreground"
              }`}>
                {connected ? (
                  <><Wifi className="w-2.5 h-2.5" /> Live</>
                ) : (
                  <><WifiOff className="w-2.5 h-2.5" /> Off</>
                )}
              </div>
            )}
            {isActive ? null : (
              <Badge variant="outline" className="border-red-500/30 text-red-500 bg-red-500/5 text-[10px] px-1.5 py-0">
                Неактивне
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between pt-0 pb-5">
        {/* Match and Timer Body */}
        {isActive ? (
          <div className="space-y-4 flex-1 flex flex-col justify-between">
            {/* Timer section */}
            <div className="flex items-baseline justify-between py-2.5 px-3 rounded-lg bg-card/60 border border-border/50">
              <span className="text-xs text-muted-foreground font-medium">Час поєдинку:</span>
              <span className={`font-mono text-2xl font-bold tracking-tight ${
                timerState.status === "running"
                  ? "text-amber-400"
                  : timerState.status === "finished"
                    ? "text-red-500"
                    : "text-foreground"
              }`}>
                {formatTimer(remainingMs)}
              </span>
            </div>

            {/* Match info or Free State */}
            <div className="flex-1 flex flex-col justify-center py-2 space-y-3">
              {currentMatch ? (
                <div className="space-y-2 flex flex-col items-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground self-start">
                    Поточний поєдинок:
                  </p>
                  {currentMatch.category_name && (
                    <Link
                      to={`/categories/${currentMatch.category}`}
                      className="text-xs font-bold text-amber-500 hover:text-amber-400 hover:underline flex items-center gap-1 max-w-full"
                    >
                      <Trophy className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{currentMatch.category_name}</span>
                    </Link>
                  )}
                  <div className="flex justify-center w-full">
                    <MatchCard match={currentMatch} compact />
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 border border-dashed border-border/50 rounded-lg bg-card/20">
                  <p className="text-xs text-muted-foreground italic">Татамі вільне</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">Судді ще не призначили поєдинок</p>
                </div>
              )}

              {/* Upcoming Matches Queue */}
              <UpcomingQueueSection tatami={tatami} currentMatch={currentMatch} />
            </div>

            {/* Open operator panel link for organizer/judge, scoreboard for spectator */}
            {!isCompleted && (isOrganizer || (user?.role === "judge" && tatami.assigned_judge === user.id)) ? (
              <Link
                to={`/operator/tournament/${tid}/tatami/${tatami.number}`}
                className="block mt-auto text-center text-xs font-semibold text-amber-500 hover:text-amber-400 hover:underline pt-2"
              >
                Панель оператора →
              </Link>
            ) : (
              <Link
                to={`/scoreboard/tournament/${tid}/tatami/${tatami.number}?spectator=true`}
                className="block mt-auto text-center text-xs font-semibold text-amber-500 hover:text-amber-400 hover:underline pt-2"
              >
                Дивитись табло (Live) →
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center flex-1">
            <p className="text-sm text-muted-foreground italic">Татамі вимкнене</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Активуйте його в меню керування, щоб почати поєдинки
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DayDashboardPage() {
  const { tid } = useParams<{ tid: string }>();
  const { toast } = useToast();
  const { isOrganizer } = useAuth();

  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTatamis = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${tid}`);
      const list = Array.isArray(data) ? data : (data as { results: Tatami[] }).results;
      setTatamis(list);
    } catch {
      toast({ title: "Помилка завантаження татамі", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTatamis();
    api.get<Tournament>(`/tournaments/${tid}/`).then(({ data }) => setTournament(data)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  return (
    <div className="container py-8 space-y-6">
      {/* Назад */}
      <Link
        to={`/tournaments/${tid}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> До деталей турніру
      </Link>

      {/* Заголовок */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">Дашборд змагань</h1>
            <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/5 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> live-моніторинг
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Моніторинг поєдинків та стану таймерів на всіх татамі в реальному часі
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchTatamis}>
            <RefreshCw className="w-4 h-4 mr-1" /> Оновити
          </Button>
          {isOrganizer && tournament?.status !== "completed" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/tournaments/${tid}/tatamis`}>
                <Layers className="w-4 h-4 mr-1" /> Керування татамі
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Список карт татамі */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : tatamis.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center border border-dashed border-border rounded-xl">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Info className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">Татамі не знайдено</p>
            <p className="text-sm text-muted-foreground mt-1">
              {isOrganizer
                ? "Перейдіть до панелі керування, щоб додати татамі для цього турніру"
                : "Організатор ще не додав жодного татамі для цього турніру"}
            </p>
          </div>
          {isOrganizer && tournament?.status !== "completed" && (
            <Button variant="sport" size="sm" asChild>
              <Link to={`/tournaments/${tid}/tatamis`}>Додати татамі</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {tatamis.map((t) => (
            <TatamiDashboardCard key={t.id} tatami={t} tid={tid || ""} isCompleted={tournament?.status === "completed"} />
          ))}
        </div>
      )}
    </div>
  );
}
