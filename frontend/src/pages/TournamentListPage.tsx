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
import { TournamentCard } from "@/components/tournament/TournamentCard";
import type { Tournament, PaginatedResponse } from "@/types/api";

// ── Схема форми створення турніру ──
const createSchema = z.object({
  title:       z.string().min(3, "Мінімум 3 символи"),
  sport_type:  z.string().min(2, "Введіть вид спорту"),
  location:    z.string().min(2, "Введіть місце проведення"),
  start_date:  z.string().min(1, "Оберіть дату початку"),
  end_date:    z.string().min(1, "Оберіть дату кінця"),
});
type CreateForm = z.infer<typeof createSchema>;

export default function TournamentListPage() {
  const { isOrganizer } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
  });

  // Завантаження турнірів
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

  useEffect(() => { fetchTournaments(); }, []);

  // Фільтрація на клієнті за пошуком
  const filtered = tournaments.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.location.toLowerCase().includes(search.toLowerCase())
  );

  // Створення турніру
  const onCreateSubmit = async (data: CreateForm) => {
    setIsCreating(true);
    try {
      await api.post("/tournaments/", data);
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
          {filtered.map((t) => {
            try {
              return <TournamentCard key={t.id} tournament={t} />;
            } catch {
              return (
                <div key={t.id} className="rounded-xl border border-destructive/30 p-4 text-sm text-muted-foreground">
                  Помилка відображення турніру #{t.id}
                </div>
              );
            }
          })}
        </div>
      )}

      {/* Діалог створення */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
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
              <Input placeholder="Карате, Дзюдо, Тхеквондо..." {...register("sport_type")} />
              {errors.sport_type && <p className="text-xs text-destructive">{errors.sport_type.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Місце проведення</Label>
              <Input placeholder="Чернівці, СК Олімп" {...register("location")} />
              {errors.location && <p className="text-xs text-destructive">{errors.location.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок</Label>
                <Input type="date" {...register("start_date")} />
                {errors.start_date && <p className="text-xs text-destructive">{errors.start_date.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець</Label>
                <Input type="date" {...register("end_date")} />
                {errors.end_date && <p className="text-xs text-destructive">{errors.end_date.message}</p>}
              </div>
            </div>
            <DialogFooter>
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