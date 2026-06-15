import { useEffect, useState } from "react";
import { Plus, Search, Loader2, Trophy } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TournamentCard } from "@/components/tournament/TournamentCard";
import type { Tournament, PaginatedResponse } from "@/types/api";
import { formatSportType, cn } from "@/lib/utils";

const getTodayAtTime = (hours: number, minutes: number) => {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hh}:${mm}`;
};

// Helper to get relative path from absolute URL returned by django backend
const getRelativePathForApi = (url: string | null) => {
  if (!url) return null;
  let path = url;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    // already relative
  }
  if (path.startsWith("/api")) {
    path = path.slice(4);
  }
  return path;
};

// ── Схема форми створення турніру ──
const createSchema = z.object({
  title:              z.string().min(3, "Мінімум 3 символи"),
  sport_type:         z.string().min(2, "Введіть вид спорту"),
  location:           z.string().min(2, "Введіть місце проведення"),
  start_date:         z.string().min(1, "Оберіть дату початку"),
  end_date:           z.string().min(1, "Оберіть дату кінця"),
  registration_start: z.string().optional().nullable(),
  registration_end:   z.string().optional().nullable(),
}).refine((data) => {
  const start = new Date(data.start_date).getTime();
  const now = Date.now() - 5 * 60 * 1000; // 5-minute buffer
  return start >= now;
}, {
  message: "Дата початку не може бути в минулому",
  path: ["start_date"]
}).refine((data) => {
  const start = new Date(data.start_date).getTime();
  const end = new Date(data.end_date).getTime();
  return end > start;
}, {
  message: "Дата кінця має бути пізнішою за дату початку",
  path: ["end_date"]
}).refine((data) => {
  if (data.registration_start && data.registration_end) {
    const regStart = new Date(data.registration_start).getTime();
    const regEnd = new Date(data.registration_end).getTime();
    return regEnd > regStart;
  }
  return true;
}, {
  message: "Кінець реєстрації має бути пізнішим за початок реєстрації",
  path: ["registration_end"]
});

type CreateForm = z.infer<typeof createSchema>;

export default function TournamentListPage() {
  const { user, isOrganizer } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  const [searchParams, setSearchParams] = useSearchParams();
  const showOnlyMy = searchParams.get("my") === "true";

  const handleToggleMy = (checked: boolean) => {
    const nextParams = new URLSearchParams(searchParams);
    if (checked) {
      nextParams.set("my", "true");
    } else {
      nextParams.delete("my");
    }
    setSearchParams(nextParams, { replace: true });
  };
  const [rulesets, setRulesets] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Стан фільтрації та пагінації
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "completed" | "draft">("active");
  const [sortBy, setSortBy] = useState<"date_asc" | "date_desc" | "title_asc">("date_asc");
  const [isPayingId, setIsPayingId] = useState<number | null>(null);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      start_date: getTodayAtTime(9, 0),
      end_date: getTodayAtTime(18, 0),
      registration_start: "",
      registration_end: "",
      sport_type: "",
    }
  });

  // Завантаження правил та турнірів
  const fetchRulesets = async () => {
    try {
      const { data } = await api.get("/rulesets/");
      setRulesets(data);
    } catch (e) {
      console.error("Помилка завантаження правил:", e);
    }
  };

  const fetchTournaments = async (resetList = true) => {
    if (resetList) {
      setIsLoading(true);
    }
    try {
      const endpoint = resetList ? "/tournaments/" : getRelativePathForApi(nextUrl);
      if (!endpoint) return;

      const { data } = await api.get<PaginatedResponse<Tournament> | Tournament[]>(endpoint);
      if (Array.isArray(data)) {
        setTournaments(data);
        setNextUrl(null);
      } else {
        setTournaments((prev) => (resetList ? data.results : [...prev, ...data.results]));
        setNextUrl(data.next);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTournaments(true);
    fetchRulesets();
  }, []);

  // Визначення заборгованості організатора перед платформою
  const debtorTournaments = tournaments.filter(
    (t) =>
      isOrganizer &&
      t.organizer === user?.id &&
      t.status === "completed" &&
      t.platform_fee_status === "unpaid"
  );
  const hasDebt = debtorTournaments.length > 0;

  // Фільтрація за вкладками
  const tabFiltered = tournaments.filter((t) => {
    if (showOnlyMy && t.organizer !== user?.id) {
      return false;
    }
    if (activeTab === "completed") {
      return t.status === "completed";
    }
    if (activeTab === "draft") {
      return t.status === "draft";
    }
    // "active" вкладка показує registration та active статуси
    return t.status === "registration" || t.status === "active";
  });

  // Пошук
  const searchFiltered = tabFiltered.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.location.toLowerCase().includes(search.toLowerCase())
  );

  // Сортування
  const sortedTournaments = [...searchFiltered].sort((a, b) => {
    if (sortBy === "date_asc") {
      return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
    }
    if (sortBy === "date_desc") {
      return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
    }
    if (sortBy === "title_asc") {
      return a.title.localeCompare(b.title);
    }
    return 0;
  });

  // Створення турніру
  const onCreateSubmit = async (data: CreateForm) => {
    setIsCreating(true);
    try {
      const payload = {
        ...data,
        registration_start: data.registration_start || null,
        registration_end: data.registration_end || null,
      };
      await api.post("/tournaments/", payload);
      toast({ title: "Турнір створено!", variant: "default" });
      setDialogOpen(false);
      reset();
      fetchTournaments(true);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="container py-8 space-y-6">
      {/* Заборгованість перед платформою */}
      {hasDebt && (
        <div className="p-4 border border-destructive/30 bg-destructive/10 text-destructive rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h4 className="font-bold text-lg flex items-center gap-2">
              ⚠️ Заборгованість перед платформою!
            </h4>
            <p className="text-sm mt-1">
              У вас є завершені турніри з несплаченою комісією за офлайн-заявки. Створення нових турнірів та реєстрація заблоковані.
            </p>
            <div className="mt-2 space-y-1">
              {debtorTournaments.map((t) => (
                <div key={t.id} className="text-xs font-semibold flex items-center gap-4">
                  <span>• {t.title}</span>
                  <span>Сума: <strong className="text-amber-500 font-bold">{t.platform_fee_amount} UAH</strong></span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {debtorTournaments.map((t) => (
              <Button
                key={t.id}
                variant="destructive"
                size="sm"
                disabled={isPayingId === t.id}
                onClick={async () => {
                  setIsPayingId(t.id);
                  try {
                    await api.post(`/tournaments/${t.id}/pay_platform_fee/`);
                    toast({ title: "Комісію успішно сплачено!", description: `Турнір: ${t.title}` });
                    fetchTournaments(true);
                  } catch {
                    // toast handled by interceptor
                  } finally {
                    setIsPayingId(null);
                  }
                }}
              >
                {isPayingId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : `Сплатити ${t.platform_fee_amount} UAH`}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Заголовок */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            Турніри
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {tournaments.length} турнірів у системі
          </p>
        </div>
        {isOrganizer && (
          <Button
            variant="sport"
            onClick={() => setDialogOpen(true)}
            disabled={hasDebt}
            className={cn(hasDebt && "opacity-50 cursor-not-allowed")}
          >
            <Plus className="w-4 h-4" />
            Новий турнір
          </Button>
        )}
      </div>

      {/* Пошук та сортування */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="relative max-w-sm w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Пошук за назвою або місцем..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isOrganizer && (
            <div className="flex items-center gap-2 border border-border/80 bg-zinc-900/40 px-3 h-10 rounded-lg text-sm">
              <input
                id="showOnlyMy"
                type="checkbox"
                checked={showOnlyMy}
                onChange={(e) => handleToggleMy(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 cursor-pointer accent-amber-500"
              />
              <label htmlFor="showOnlyMy" className="text-zinc-300 font-medium cursor-pointer select-none">
                Тільки мої турніри
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">Сортування:</Label>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_asc">Найближчі спочатку</SelectItem>
              <SelectItem value="date_desc">Новіші спочатку</SelectItem>
              <SelectItem value="title_asc">За назвою (А-Я)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Вкладки */}
      <div className="flex border-b border-border/30 gap-6">
        <button
          onClick={() => setActiveTab("active")}
          className={cn(
            "pb-3 text-sm font-medium border-b-2 transition-all",
            activeTab === "active"
              ? "border-amber-500 text-amber-500 font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Активні та майбутні
        </button>
        <button
          onClick={() => setActiveTab("completed")}
          className={cn(
            "pb-3 text-sm font-medium border-b-2 transition-all",
            activeTab === "completed"
              ? "border-amber-500 text-amber-500 font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Завершені
        </button>
        {isOrganizer && (
          <button
            onClick={() => setActiveTab("draft")}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-all",
              activeTab === "draft"
                ? "border-amber-500 text-amber-500 font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Чернетки
          </button>
        )}
      </div>

      {/* Список */}
      {isLoading && sortedTournaments.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : sortedTournaments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Trophy className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">Турнірів не знайдено</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? "Спробуйте змінити пошуковий запит" : "У цій категорії поки немає турнірів"}
            </p>
          </div>
          {isOrganizer && !search && activeTab === "active" && (
            <Button variant="sport" size="sm" onClick={() => setDialogOpen(true)} disabled={hasDebt}>
              <Plus className="w-4 h-4" /> Створити турнір
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedTournaments.map((t) => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </div>

          {/* Пагінація "Завантажити ще" */}
          {nextUrl && (
            <div className="flex justify-center pt-6">
              <Button
                variant="outline"
                onClick={() => fetchTournaments(false)}
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Завантажити ще
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Діалог створення */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новий турнір</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва</Label>
              <Input placeholder="Відкритий чемпіонат Чернівців" {...register("title")} />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Вид спорту</Label>
              <Select onValueChange={(v) => setValue("sport_type", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть вид спорту..." />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set(rulesets.map(r => r.sport_type as string).filter(Boolean))).map((sport) => (
                    <SelectItem key={sport} value={sport}>
                      {formatSportType(sport)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.sport_type && <p className="text-xs text-destructive">{errors.sport_type.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Місце проведення</Label>
              <Input placeholder="Чернівці, СК Олімп" {...register("location")} />
              {errors.location && <p className="text-xs text-destructive">{errors.location.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок турніру</Label>
                <Input type="datetime-local" {...register("start_date")} />
                {errors.start_date && <p className="text-xs text-destructive">{errors.start_date.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець турніру</Label>
                <Input type="datetime-local" {...register("end_date")} />
                {errors.end_date && <p className="text-xs text-destructive">{errors.end_date.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок реєстрації <span className="text-muted-foreground text-xs">(опціонально)</span></Label>
                <Input type="datetime-local" {...register("registration_start")} />
                {errors.registration_start && <p className="text-xs text-destructive">{errors.registration_start.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець реєстрації <span className="text-muted-foreground text-xs">(опціонально)</span></Label>
                <Input type="datetime-local" {...register("registration_end")} />
                {errors.registration_end && <p className="text-xs text-destructive">{errors.registration_end.message}</p>}
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isCreating}>
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Створити"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
