import { useEffect, useState } from "react";
import { Plus, Search, Loader2, Trophy } from "lucide-react";
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
import { formatSportType } from "@/lib/utils";

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
  const { isOrganizer } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [rulesets, setRulesets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

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

  const fetchTournaments = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Tournament> | Tournament[]>("/tournaments/");
      // DRF може повертати пагінацію або простий масив
      setTournaments(Array.isArray(data) ? data : data.results);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTournaments();
    fetchRulesets();
  }, []);

  // Фільтрація на клієнті за пошуком
  const filtered = tournaments.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.location.toLowerCase().includes(search.toLowerCase())
  );

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
      fetchTournaments();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="container py-8 space-y-6">
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
          <Button variant="sport" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Новий турнір
          </Button>
        )}
      </div>

      {/* Пошук */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Пошук за назвою або місцем..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Список */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Trophy className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">Турнірів не знайдено</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? "Спробуйте змінити пошуковий запит" : "Будьте першим, хто створить турнір"}
            </p>
          </div>
          {isOrganizer && !search && (
            <Button variant="sport" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4" /> Створити турнір
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <TournamentCard key={t.id} tournament={t} />
          ))}
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
                  {Array.from(new Set(rulesets.map(r => r.sport_type).filter(Boolean))).map((sport: any) => (
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
