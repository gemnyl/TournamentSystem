import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Plus, Loader2, Play, CheckCircle2, ClipboardList, GitBranch
} from "lucide-react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/tournament/StatusBadge";
import { CategoryCard } from "@/components/tournament/CategoryCard";
import type { Tournament, Category, PaginatedResponse } from "@/types/api";

const categorySchema = z.object({
  name:           z.string().min(2, "Введіть назву"),
  allowed_gender: z.enum(["male", "female", "mixed"]),
  min_age:        z.coerce.number().min(5).max(100),
  max_age:        z.coerce.number().min(5).max(100),
  min_weight:     z.coerce.number().min(20).max(300),
  max_weight:     z.coerce.number().min(20).max(300),
  bracket_format: z.enum(["single_elimination", "double_elimination", "round_robin"]),
});
type CategoryForm = z.infer<typeof categorySchema>;

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isOrganizer } = useAuth();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [isCreatingCat, setIsCreatingCat] = useState(false);
  const [catGender, setCatGender] = useState<"male" | "female" | "mixed">("male");
  const [catFormat, setCatFormat] = useState<CategoryForm["bracket_format"]>("single_elimination");

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<CategoryForm>({
    resolver: zodResolver(categorySchema),
    defaultValues: { allowed_gender: "male", bracket_format: "single_elimination" },
  });

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const [tRes, cRes] = await Promise.all([
        api.get<Tournament>(`/tournaments/${id}/`),
        api.get<PaginatedResponse<Category> | Category[]>(`/categories/?tournament=${id}`),
      ]);
      setTournament(tRes.data);
      setCategories(Array.isArray(cRes.data) ? cRes.data : cRes.data.results);
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [id]);

  // Зміна статусу турніру
  const handleAction = async (action: "open_registration" | "start" | "complete") => {
    setActionLoading(action);
    try {
      await api.post(`/tournaments/${id}/${action}/`);
      const labels = { open_registration: "Реєстрацію відкрито", start: "Турнір розпочато", complete: "Турнір завершено" };
      toast({ title: labels[action] });
      fetchAll();
    } finally {
      setActionLoading(null);
    }
  };

  // Створення категорії
  const onCreateCategory = async (data: CategoryForm) => {
    setIsCreatingCat(true);
    try {
      await api.post("/categories/", { ...data, tournament: Number(id) });
      toast({ title: "Категорію створено!" });
      setCatDialogOpen(false);
      reset();
      fetchAll();
    } finally {
      setIsCreatingCat(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container py-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!tournament) return null;

  const canOpenReg  = tournament.status === "draft";
  const canStart    = tournament.status === "registration";
  const canComplete = tournament.status === "ongoing";

  return (
    <div className="container py-8 space-y-6">
      {/* Назад */}
      <Link to="/tournaments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Всі турніри
      </Link>

      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">{tournament.title}</h1>
            <StatusBadge status={tournament.status} type="tournament" />
          </div>
          <p className="text-muted-foreground text-sm">
            {tournament.location} · {new Date(tournament.start_date).toLocaleDateString("uk-UA")} — {new Date(tournament.end_date).toLocaleDateString("uk-UA")}
          </p>
          {tournament.sport_type && (
            <p className="text-sm text-muted-foreground/80 max-w-2xl">{tournament.sport_type}</p>
          )}
        </div>

        {/* Кнопки управління (тільки організатор) */}
        {isOrganizer && (
          <div className="flex flex-wrap gap-2">
            {canOpenReg && (
              <Button
                variant="outline" size="sm"
                disabled={actionLoading === "open_registration"}
                onClick={() => handleAction("open_registration")}
              >
                {actionLoading === "open_registration" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                Відкрити реєстрацію
              </Button>
            )}
            {canStart && (
              <Button
                variant="sport" size="sm"
                disabled={actionLoading === "start"}
                onClick={() => handleAction("start")}
              >
                {actionLoading === "start" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Розпочати
              </Button>
            )}
            {canComplete && (
              <Button
                variant="outline" size="sm"
                disabled={actionLoading === "complete"}
                onClick={() => handleAction("complete")}
              >
                {actionLoading === "complete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Завершити
              </Button>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Категорії */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">
            Категорії
            <span className="ml-2 text-base font-normal text-muted-foreground">({categories.length})</span>
          </h2>
          {isOrganizer && (
            <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
              <Plus className="w-4 h-4" /> Додати категорію
            </Button>
          )}
        </div>

        {categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border border-dashed border-border rounded-xl">
            <GitBranch className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Категорій поки немає</p>
            {isOrganizer && (
              <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
                <Plus className="w-4 h-4" /> Додати першу категорію
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {categories.map((c) => <CategoryCard key={c.id} category={c} />)}
          </div>
        )}
      </div>

      {/* Діалог нової категорії */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Нова категорія</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onCreateCategory)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва категорії</Label>
              <Input placeholder="Кадети до 50 кг, чол." {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Стать</Label>
                <Select value={catGender} onValueChange={(v) => { setCatGender(v as CategoryForm["allowed_gender"]); setValue("allowed_gender", v as CategoryForm["allowed_gender"]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Чоловіки</SelectItem>
                    <SelectItem value="female">Жінки</SelectItem>
                    <SelectItem value="mixed">Мікст</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вік від</Label>
                <Input type="number" placeholder="14" {...register("min_age")} />
                {errors.min_age && <p className="text-xs text-destructive">{errors.min_age.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Вік до</Label>
                <Input type="number" placeholder="17" {...register("max_age")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вага від (кг)</Label>
                <Input type="number" placeholder="45" {...register("min_weight")} />
              </div>
              <div className="space-y-1.5">
                <Label>Вага до (кг)</Label>
                <Input type="number" placeholder="50" {...register("max_weight")} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Формат</Label>
              <Select value={catFormat} onValueChange={(v) => { setCatFormat(v as CategoryForm["bracket_format"]); setValue("bracket_format", v as CategoryForm["bracket_format"]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_elimination">Single Elimination</SelectItem>
                  <SelectItem value="double_elimination">Double Elimination</SelectItem>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCatDialogOpen(false)}>Скасувати</Button>
              <Button type="submit" variant="sport" disabled={isCreatingCat}>
                {isCreatingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : "Створити"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
