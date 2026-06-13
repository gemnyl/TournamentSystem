import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Plus, Loader2, Edit, Trash2, Shield, Info, Check, X, RefreshCw, Clock, LayoutGrid,
  ArrowUp, ArrowDown
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { cn, formatRegistrationName, formatAthleteName } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Tatami, Tournament, Category, Match } from "@/types/api";

interface JudgeUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

function compareTatamiMatches(
  a: Match,
  b: Match,
  currentId: number | null,
  categories: Category[]
): number {
  if (a.id === currentId) return -1;
  if (b.id === currentId) return 1;
  if (a.status === "ongoing" && b.status !== "ongoing") return -1;
  if (b.status === "ongoing" && a.status !== "ongoing") return 1;
  if (a.category !== b.category) {
    const catA = categories.find((c) => c.id === a.category);
    const catB = categories.find((c) => c.id === b.category);
    const orderA = catA?.schedule_order ?? 0;
    const orderB = catB?.schedule_order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.category - b.category;
  }
  return a.round_index === b.round_index
    ? a.match_order - b.match_order
    : a.round_index - b.round_index;
}

interface TatamiWorkloadCardProps {
  readonly tatami: Tatami;
  readonly durationMs: number;
  readonly finishTime: number;
  readonly tatamiCats: Category[];
  readonly matchCount: number;
  readonly maxDurationMs: number;
  readonly matches: Match[];
  readonly tatamis: Tatami[];
  readonly isReassigning: number | null;
  readonly handleMoveCategory: (catId: number, direction: "up" | "down", currentTatamiCats: Category[]) => Promise<void>;
  readonly handleReassignCategory: (catId: number, newTatamiIdStr: string) => Promise<void>;
  readonly formatFinishTime: (timestamp: number) => string;
  readonly formatDuration: (ms: number) => string;
}

function TatamiWorkloadCard({
  tatami,
  durationMs,
  finishTime,
  tatamiCats,
  matchCount,
  maxDurationMs,
  matches,
  tatamis,
  isReassigning,
  handleMoveCategory,
  handleReassignCategory,
  formatFinishTime,
  formatDuration,
}: TatamiWorkloadCardProps) {
  const isOverloaded = durationMs > 3 * 3600 * 1000; // > 3 годин
  const progressPercent = maxDurationMs > 0 ? (durationMs / maxDurationMs) * 100 : 0;
  const isActive = tatami.is_active;

  return (
    <div
      className={cn(
        "rounded-xl border p-5 flex flex-col justify-between space-y-4 transition-all duration-300",
        isActive
          ? "border-border bg-card/10"
          : "border-muted-foreground/25 bg-muted/5 opacity-75 border-dashed"
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg">Татамі {tatami.number}</h3>
              {!isActive && (
                <Badge variant="outline" className="border-red-500/30 text-red-500 bg-red-500/5 text-[10px] px-1.5 py-0 font-normal shrink-0">
                  Неактивне
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{tatami.name || `Килим ${tatami.number}`}</p>
          </div>
          <Badge variant={isOverloaded && isActive ? "destructive" : "secondary"} className="font-mono font-semibold">
            {matchCount} {matchCount === 1 ? "матч" : [2, 3, 4].includes(matchCount % 10) && ![12, 13, 14].includes(matchCount % 100) ? "матчі" : "матців"}
          </Badge>
        </div>

        {/* Час завершення */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Орієнтовний фініш:
          </span>
          <span className="font-bold text-foreground">
            {isActive ? (durationMs > 0 ? formatFinishTime(finishTime) : "Завершено") : "Призупинено"}
          </span>
        </div>

        {/* Навантаження у годинах */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Загальний час роботи:</span>
          <span className="font-medium text-foreground">{formatDuration(durationMs)}</span>
        </div>

        {/* Візуальний таймлайн */}
        <div className="space-y-1">
          <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isActive ? (isOverloaded ? "bg-gradient-to-r from-red-500 to-orange-500" : (durationMs > 0 ? "bg-gradient-to-r from-amber-500 to-yellow-400" : "bg-muted")) : "bg-muted-foreground/30"
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Список категорій */}
      <div className="space-y-2 pt-2 border-t border-border/60">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Категорії на татамі
        </h4>
        {tatamiCats.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">Немає призначених категорій</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {tatamiCats.map((cat) => {
              const catMatches = matches.filter(
                (m) => m.category === cat.id && m.status !== "completed"
              );
              const catMatchesCount = catMatches.length;

              return (
                <div
                  key={cat.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border text-xs animate-in fade-in duration-200"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <Link
                      to={`/categories/${cat.id}`}
                      className="font-semibold text-foreground hover:text-amber-500 hover:underline truncate"
                    >
                      {cat.name}
                    </Link>
                    <span className="text-[10px] text-muted-foreground">
                      {catMatchesCount} {catMatchesCount === 1 ? "матч" : [2, 3, 4].includes(catMatchesCount % 10) && ![12, 13, 14].includes(catMatchesCount % 100) ? "матчі" : "матців"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {tatamiCats.length > 1 && (
                      <div className="flex items-center gap-0.5 border border-input bg-background/50 rounded-md px-1 h-8 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isReassigning === cat.id || tatamiCats.indexOf(cat) === 0}
                          onClick={() => handleMoveCategory(cat.id, "up", tatamiCats)}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-all"
                          title="Перемістити вгору"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <div className="w-px h-4 bg-border" />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isReassigning === cat.id || tatamiCats.indexOf(cat) === tatamiCats.length - 1}
                          onClick={() => handleMoveCategory(cat.id, "down", tatamiCats)}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-all"
                          title="Перемістити вниз"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                    <select
                      value={tatami.id}
                      disabled={isReassigning === cat.id}
                      onChange={(e) => handleReassignCategory(cat.id, e.target.value)}
                      className="h-8 text-xs rounded-md border border-input bg-background px-2 py-1 focus-visible:ring-1 focus-visible:ring-amber-500 font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {tatamis.map((tat) => (
                        <option key={tat.id} value={tat.id}>
                          {tat.id === tatami.id
                            ? `Татамі ${tat.number}`
                            : `→ Татамі ${tat.number}`}
                          {!tat.is_active ? " (Неактивне)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const tatamiSchema = z.object({
  number: z.coerce.number().min(1, "Номер татамі має бути не менше 1"),
  name: z.string().optional().default(""),
  is_active: z.boolean().default(true),
  assigned_judge: z.string().optional(),
});

type TatamiFormValues = z.infer<typeof tatamiSchema>;

export default function TatamiAdminPage() {
  const { tid } = useParams<{ tid: string }>();
  const { toast } = useToast();

  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTatami, setEditingTatami] = useState<Tatami | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Tatami | null>(null);
  const [judges, setJudges] = useState<JudgeUser[]>([]);
  const [judgeSearch, setJudgeSearch] = useState("");
  const [isReassigning, setIsReassigning] = useState<number | null>(null);

  // Helper for formatting finish time
  const formatFinishTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  };

  // Helper for formatting duration
  const formatDuration = (ms: number) => {
    if (ms <= 0) return "0 хв";
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours} год ${minutes} хв`;
    }
    return `${minutes} хв`;
  };

  // 1. Розрахунок навантаження для кожного татамі
  const tatamiWorkloads = useMemo(() => {
    const now = Date.now();

    const workloads = tatamis.map(t => {
      // Фільтруємо незавершені поєдинки на цьому татамі
      const tatamiMatches = matches.filter(m => m.tatami === t.id && m.status !== "completed");

      // Сортуємо поєдинки за чергою
      const currentId = t.current_match;
      const sorted = [...tatamiMatches].sort((a, b) => compareTatamiMatches(a, b, currentId, categories));

      let durationMs = 0;
      sorted.forEach((match, idx) => {
        let mDuration = match.timer_duration_ms || 180_000;
        if (match.status === "ongoing") {
          mDuration = Math.max(0, mDuration - match.timer_elapsed_ms);
        }
        durationMs += mDuration;

        if (idx < sorted.length - 1) {
          durationMs += 45 * 1000; // ATHLETE_PREP_SEC
          if (match.category !== sorted[idx + 1].category) {
            durationMs += 300 * 1000; // CATEGORY_CHANGEOVER_SEC
          }
        }
      });

      // Категорії на цьому татамі (ті, що мають незіграні поєдинки тут)
      const catIds = Array.from(new Set(tatamiMatches.map(m => m.category)));
      const tatamiCats = [...categories]
        .filter(c => catIds.includes(c.id))
        .sort((a, b) => (a.schedule_order ?? 0) - (b.schedule_order ?? 0) || a.name.localeCompare(b.name));

      return {
        tatami: t,
        durationMs,
        finishTime: now + durationMs,
        categories: tatamiCats,
        matchCount: tatamiMatches.length,
      };
    });

    return workloads;
  }, [tatamis, matches, categories]);

  // Максимальне навантаження серед усіх татамі (для відносного розрахунку прогрес-бару)
  const maxDurationMs = useMemo(() => {
    return Math.max(...tatamiWorkloads.map(w => w.durationMs), 1);
  }, [tatamiWorkloads]);

  // 2. Нерозподілені категорії (мають незіграні матчі, але всі вони без татамі)
  const unassignedCategories = useMemo(() => {
    return categories.filter(cat => {
      const catMatches = matches.filter(m => m.category === cat.id && m.status !== "completed");
      if (catMatches.length === 0) return false;
      return catMatches.every(m => m.tatami === null);
    });
  }, [categories, matches]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TatamiFormValues>({
    resolver: zodResolver(tatamiSchema),
    defaultValues: { number: 1, name: "", is_active: true, assigned_judge: "" }
  });

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [tRes, tatamiRes, judgeRes, catRes, matchRes] = await Promise.all([
        api.get<Tournament>(`/tournaments/${tid}/`),
        api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${tid}`),
        api.get<JudgeUser[] | { results: JudgeUser[] }>("/auth/users/?role=judge"),
        api.get<Category[] | { results: Category[] }>(`/categories/?tournament=${tid}`),
        api.get<Match[] | { results: Match[] }>(`/matches/?tournament=${tid}`),
      ]);
      setTournament(tRes.data);
      const list = Array.isArray(tatamiRes.data)
        ? tatamiRes.data
        : (tatamiRes.data as { results: Tatami[] }).results;
      setTatamis(list);

      const judgeList = Array.isArray(judgeRes.data)
          ? judgeRes.data
          : (judgeRes.data as { results: JudgeUser[] }).results;
      setJudges(judgeList);

      const catList = Array.isArray(catRes.data)
        ? catRes.data
        : (catRes.data as { results: Category[] }).results;
      setCategories(catList);

      const matchList = Array.isArray(matchRes.data)
        ? matchRes.data
        : (matchRes.data as { results: Match[] }).results;
      setMatches(matchList);
    } catch {
      toast({ title: "Помилка завантаження даних", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [tid, toast]);

  const handleReassignCategory = async (catId: number, newTatamiIdStr: string) => {
    setIsReassigning(catId);
    const newTatamiId = newTatamiIdStr === "none" || newTatamiIdStr === "" ? null : Number(newTatamiIdStr);

    // 1. Оптимістичне оновлення локального стейту для миттєвого перерахунку на екрані
    const backupMatches = [...matches];
    setMatches((prev) =>
      prev.map((m) =>
        m.category === catId
          ? { ...m, tatami: newTatamiId }
          : m
      )
    );

    try {
      // 2. Відправка запиту на бекенд
      // Наш бекенд очікує POST /api/categories/{id}/assign_tatami/ з body { tatami_id: ID | null }
      await api.post(`/categories/${catId}/assign_tatami/`, { tatami_id: newTatamiId });
      toast({ title: "Категорію успішно перепризначено!" });
    } catch (err: unknown) {
      // Відкат змін при помилці
      setMatches(backupMatches);
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Не вдалося перепризначити татамі";
      toast({ title: detail, variant: "destructive" });
    } finally {
      setIsReassigning(null);
      fetchData(); // Синхронізація з сервером для підтвердження даних
    }
  };

  const handleMoveCategory = async (catId: number, direction: "up" | "down", currentTatamiCats: Category[]) => {
    const idx = currentTatamiCats.findIndex(c => c.id === catId);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === currentTatamiCats.length - 1) return;

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;

    setIsReassigning(catId);
    try {
      // Assign sequential orders to make it safe and swap them
      const newOrders = currentTatamiCats.map((c, i) => ({
        id: c.id,
        order: i * 10
      }));

      const tmp = newOrders[idx].order;
      newOrders[idx].order = newOrders[targetIdx].order;
      newOrders[targetIdx].order = tmp;

      await Promise.all(
        newOrders.map(item => api.patch(`/categories/${item.id}/`, { schedule_order: item.order }))
      );

      toast({ title: "Чергу категорій змінено!" });
      fetchData();
    } catch {
      toast({ title: "Не вдалося перемістити категорію", variant: "destructive" });
    } finally {
      setIsReassigning(null);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleOpenCreate = () => {
    setEditingTatami(null);
    const nextNum = tatamis.length > 0 ? Math.max(...tatamis.map(t => t.number)) + 1 : 1;
    reset({ number: nextNum, name: "", is_active: true, assigned_judge: "" });
    setDialogOpen(true);
  };

  const handleOpenEdit = (t: Tatami) => {
    setEditingTatami(t);
    reset({
      number: t.number,
      name: t.name ?? "",
      is_active: t.is_active,
      assigned_judge: t.assigned_judge ? String(t.assigned_judge) : "",
    });
    setDialogOpen(true);
  };

  const handleToggleActive = async (t: Tatami) => {
    try {
      const { data } = await api.patch<Tatami>(`/tatamis/${t.id}/`, {
        is_active: !t.is_active,
      });
      setTatamis((prev) => prev.map((item) => (item.id === t.id ? data : item)));
      toast({ title: t.is_active ? "Татамі деактивовано!" : "Татамі активовано!" });
    } catch {
      toast({ title: "Не вдалося оновити статус татамі", variant: "destructive" });
    }
  };

  const onSubmit = async (data: TatamiFormValues) => {
    const assignedJudge = data.assigned_judge === "" || data.assigned_judge === undefined
      ? null
      : Number(data.assigned_judge);
    setIsSubmitting(true);
    try {
      if (editingTatami) {
        // Редагування
        const res = await api.put<Tatami>(`/tatamis/${editingTatami.id}/`, {
          tournament: Number(tid),
          ...data,
          assigned_judge: assignedJudge,
        });
        setTatamis((prev) => prev.map((item) => (item.id === editingTatami.id ? res.data : item)));
        toast({ title: "Татамі оновлено!" });
      } else {
        // Створення
        const res = await api.post<Tatami>("/tatamis/", {
          tournament: Number(tid),
          ...data,
          assigned_judge: assignedJudge,
        });
        setTatamis((prev) => [...prev, res.data].sort((a, b) => a.number - b.number));
        toast({ title: "Татамі успішно створено!" });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string; non_field_errors?: string[] } } }).response?.data?.detail ?? (err as { response?: { data?: { non_field_errors?: string[] } } }).response?.data?.non_field_errors?.[0] ?? "Помилка при збереженні татамі";
      toast({ title: detail, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/tatamis/${deleteConfirm.id}/`);
      setTatamis((prev) => prev.filter((item) => item.id !== deleteConfirm.id));
      toast({ title: "Татамі успішно видалено!" });
      setDeleteConfirm(null);
    } catch {
      toast({ title: "Не вдалося видалити татамі", variant: "destructive" });
    }
  };

  if (tournament && tournament.status === "completed") {
    return (
      <div className="container py-12 flex flex-col items-center justify-center min-h-[50vh] text-center gap-4">
        <h2 className="text-3xl font-extrabold text-destructive">Турнір завершено</h2>
        <p className="text-muted-foreground text-sm max-w-md">
          Цей турнір завершився. Керування татамі закрите, зміни заборонені.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={`/tournaments/${tid}`} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> До деталей турніру
          </Link>
        </Button>
      </div>
    );
  }

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">Керування татамі</h1>
            <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/5 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" /> Організатор
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {tournament?.title ?? `Tournament ${tid}`} · {tatamis.length} татамі в системі
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchData()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Оновити
          </Button>
          <Button variant="sport" size="sm" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4" /> Додати татамі
          </Button>
        </div>
      </div>

      {/* Головний контент */}
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
            <p className="font-medium text-foreground">Татамі ще не створено</p>
            <p className="text-sm text-muted-foreground mt-1">
              Створіть перше татамі для цього турніру, щоб судді могли керувати поєдинками
            </p>
          </div>
          <Button variant="sport" size="sm" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4" /> Додати татамі
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card/10">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20 text-center">Номер</TableHead>
                <TableHead>Назва</TableHead>
                <TableHead>Суддя</TableHead>
                <TableHead className="text-center">Статус</TableHead>
                <TableHead>Поточний поєдинок</TableHead>
                <TableHead className="text-center">Матчів у черзі</TableHead>
                <TableHead className="text-right w-36">Дії</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tatamis.map((t) => {
                const currentMatchObj = t.current_match as Match | number | null;
                const hasMatch = currentMatchObj && typeof currentMatchObj === "object";
                const formatMatchParticipant = (reg: any, ath: any) => {
                  if (!reg) return "TBD";
                  const teamName = reg.team?.name;
                  const athleteName = formatAthleteName(ath) || formatAthleteName(reg?.athlete);
                  if (teamName && athleteName) return `${teamName} (${athleteName})`;
                  return formatRegistrationName(reg) || "TBD";
                };

                let nameFirst = "—";
                let nameSecond = "—";
                let matchText = "—";

                if (hasMatch) {
                  const m = currentMatchObj as Match;
                  nameFirst = formatMatchParticipant(m.reg_first, m.athlete_first);
                  nameSecond = formatMatchParticipant(m.reg_second, m.athlete_second);
                  matchText = `R${m.round_index}.${m.match_order}: ${nameFirst} vs ${nameSecond}`;
                }

                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-center font-mono font-bold text-base">
                      {t.number}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {t.name || `Татамі ${t.number}`}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {t.assigned_judge_name || (
                        <span className="text-muted-foreground italic text-xs">Не закріплено</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() => handleToggleActive(t)}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold transition-all border ${
                          t.is_active
                            ? "border-green-500/40 text-green-400 bg-green-500/5 hover:bg-green-500/10"
                            : "border-red-500/40 text-red-400 bg-red-500/5 hover:bg-red-500/10"
                        }`}
                      >
                        {t.is_active ? (
                          <><Check className="w-3 h-3" /> Активне</>
                        ) : (
                          <><X className="w-3 h-3" /> Неактивне</>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm max-w-md whitespace-normal break-words leading-tight">
                      {hasMatch ? (
                        <Link
                          to={`/operator/tournament/${tid}/tatami/${t.number}`}
                          className="text-amber-500 hover:underline hover:text-amber-400 font-medium"
                        >
                          {matchText}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground italic">Немає поєдинку</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono font-medium">
                      {t.matches_count ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(t)}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(t)}
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Інтерактивна панель балансування навантаження татамі */}
      {tatamis.length > 0 && (
        <div className="mt-8 space-y-6 pt-6 border-t border-border">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight">Панель балансування часу та навантаження</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Прогнозоване навантаження майданчиків та миттєвий перерозподіл категорій в реальному часі
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tatamiWorkloads.map(({ tatami, durationMs, finishTime, categories: tatamiCats, matchCount }) => (
              <TatamiWorkloadCard
                key={tatami.id}
                tatami={tatami}
                durationMs={durationMs}
                finishTime={finishTime}
                tatamiCats={tatamiCats}
                matchCount={matchCount}
                maxDurationMs={maxDurationMs}
                matches={matches}
                tatamis={tatamis}
                isReassigning={isReassigning}
                handleMoveCategory={handleMoveCategory}
                handleReassignCategory={handleReassignCategory}
                formatFinishTime={formatFinishTime}
                formatDuration={formatDuration}
              />
            ))}

            {/* Нерозподілені категорії */}
            {unassignedCategories.length > 0 && (
              <div className="rounded-xl border border-dashed border-amber-500/30 p-5 bg-amber-500/5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-lg text-amber-500">Нерозподілені</h3>
                      <p className="text-xs text-muted-foreground">Категорії без призначеного татамі</p>
                    </div>
                    <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/5 font-mono">
                      {unassignedCategories.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ці категорії мають незіграні матчі, але вони не призначені на жодне татамі. Оберіть майданчик для запуску.
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-border/60 max-h-60 overflow-y-auto pr-1">
                  {unassignedCategories.map((cat) => {
                    const catMatches = matches.filter(
                      (m) => m.category === cat.id && m.status !== "completed"
                    );
                    const catMatchesCount = catMatches.length;

                    return (
                      <div
                        key={cat.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border text-xs"
                      >
                        <div className="flex flex-col min-w-0 flex-1">
                          <Link
                            to={`/categories/${cat.id}`}
                            className="font-semibold text-foreground hover:text-amber-500 hover:underline truncate"
                          >
                            {cat.name}
                          </Link>
                          <span className="text-[10px] text-muted-foreground">
                            {catMatchesCount} {catMatchesCount === 1 ? "матч" : [2, 3, 4].includes(catMatchesCount % 10) && ![12, 13, 14].includes(catMatchesCount % 100) ? "матчі" : "матчів"}
                          </span>
                        </div>
                        <select
                          value="none"
                          disabled={isReassigning === cat.id}
                          onChange={(e) => handleReassignCategory(cat.id, e.target.value)}
                          className="h-8 text-xs rounded-md border border-amber-500/40 bg-background px-2 py-1 focus-visible:ring-1 focus-visible:ring-amber-500 font-semibold text-amber-500 hover:text-amber-400 cursor-pointer shrink-0"
                        >
                          <option value="none">Оберіть...</option>
                          {tatamis.map((tat) => (
                            <option key={tat.id} value={tat.id}>
                              Татамі {tat.number}
                              {!tat.is_active ? " (Неактивне)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Діалог Створення/Редагування */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingTatami ? `Редагувати: Татамі ${editingTatami.number}` : "Нове татамі"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="number">Номер татамі</Label>
              <Input
                id="number"
                type="number"
                placeholder="1"
                {...register("number")}
              />
              {errors.number && (
                <p className="text-xs text-destructive">{errors.number.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">Назва (опціонально)</Label>
              <Input
                id="name"
                placeholder="напр. Tatami A, Головний килим..."
                {...register("name")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assigned_judge">Призначений суддя</Label>
              <Input
                type="text"
                placeholder="Шукати суддю за прізвищем/email..."
                className="h-8 text-xs mb-1.5 border-slate-800 bg-slate-950 text-slate-300 placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                value={judgeSearch}
                onChange={(e) => setJudgeSearch(e.target.value)}
              />
              <select
                id="assigned_judge"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                {...register("assigned_judge")}
              >
                <option value="">-- Не закріплено --</option>
                {judges
                  .filter((j) =>
                    `${j.last_name} ${j.first_name} ${j.email}`
                      .toLowerCase()
                      .includes(judgeSearch.toLowerCase())
                  )
                  .map((j) => (
                    <option key={j.id} value={String(j.id)}>
                      {j.last_name} {j.first_name} ({j.email})
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                id="is_active"
                type="checkbox"
                className="w-4 h-4 rounded border-input focus:ring-amber-500"
                {...register("is_active")}
              />
              <Label htmlFor="is_active" className="cursor-pointer font-normal text-sm select-none">
                Активне (доступне для проведення поєдинків)
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editingTatami ? "Зберегти" : "Створити"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог підтвердження видалення */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-1.5">
              <Trash2 className="w-5 h-5" /> Видалити татамі
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете видалити{" "}
            <span className="font-bold text-foreground">
              {deleteConfirm?.name || `Татамі ${deleteConfirm?.number}`}
            </span>
            ? Ця дія є незворотною.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Скасувати
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Видалити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
