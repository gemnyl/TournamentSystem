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
import type { Tournament, Category, PaginatedResponse, RulesetInfo } from "@/types/api";

const categorySchema = z.object({
  name:                   z.string().min(2, "Введіть назву"),
  allowed_gender:         z.enum(["male", "female", "mixed"]),
  min_age:                z.coerce.number().min(5).max(100),
  max_age:                z.coerce.number().min(5).max(100),
  min_weight:             z.coerce.number().min(20).max(300),
  max_weight:             z.coerce.number().min(20).max(300),
  ruleset_key:            z.string().min(1, "Оберіть правила"),
  match_duration_seconds: z.string().optional().transform(v => v === "" || v === undefined ? undefined : Number(v)),
  allowed_skill_level:    z.string().optional(),
});
type CategoryForm = z.infer<typeof categorySchema>;

const editTournamentSchema = z.object({
  title:             z.string().min(3, "Мінімум 3 символи"),
  sport_type:        z.string().min(2, "Введіть вид спорту"),
  location:          z.string().min(2, "Введіть місце проведення"),
  start_date:        z.string().min(1, "Оберіть дату початку"),
  end_date:          z.string().min(1, "Оберіть дату кінця"),
  weigh_in_required: z.boolean(),
});
type EditTournamentForm = z.infer<typeof editTournamentSchema>;

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

  const [rulesets, setRulesets] = useState<RulesetInfo[]>([]);
  const [selectedRuleset, setSelectedRuleset] = useState<RulesetInfo | null>(null);

  // Edit / Delete tournament states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [generatingAllBrackets, setGeneratingAllBrackets] = useState(false);
  const [distributingTatamis, setDistributingTatamis] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [rrMin, setRrMin] = useState(2);
  const [rrMax, setRrMax] = useState(5);
  const [seMin, setSeMin] = useState(6);
  const [seMax, setSeMax] = useState(32);

  const editTournamentForm = useForm<EditTournamentForm>({
    resolver: zodResolver(editTournamentSchema),
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<CategoryForm>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      allowed_gender: "male",
      ruleset_key: "karate_wkf",
    },
  });

  const handleOpenEditDialog = () => {
    if (!tournament) return;
    editTournamentForm.reset({
      title: tournament.title,
      sport_type: tournament.sport_type,
      location: tournament.location,
      start_date: tournament.start_date ? new Date(tournament.start_date).toISOString().split("T")[0] : "",
      end_date: tournament.end_date ? new Date(tournament.end_date).toISOString().split("T")[0] : "",
      weigh_in_required: tournament.weigh_in_required,
    });
    setEditDialogOpen(true);
  };

  const onEditTournamentSubmit = async (data: EditTournamentForm) => {
    setIsEditing(true);
    try {
      const res = await api.put<Tournament>(`/tournaments/${id}/`, data);
      setTournament(res.data);
      toast({ title: "Турнір успішно оновлено!" });
      setEditDialogOpen(false);
    } catch {
      toast({ title: "Помилка оновлення турніру", variant: "destructive" });
    } finally {
      setIsEditing(false);
    }
  };

  const onDeleteTournament = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/tournaments/${id}/`);
      toast({ title: "Турнір успішно видалено!" });
      setDeleteDialogOpen(false);
      window.location.href = "/tournaments";
    } catch {
      toast({ title: "Помилка видалення турніру", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAutoDistributeTatamis = async () => {
    setDistributingTatamis(true);
    try {
      const res = await api.post<{ detail: string }>(`/tournaments/${id}/auto_distribute_tatamis/`);
      toast({ title: "Розподіл завершено!", description: res.data.detail });
      fetchAll();
    } catch (err: any) {
      const msg = err.response?.data?.detail || "Помилка розподілу по татамі";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setDistributingTatamis(false);
    }
  };

  const handleGenerateAllBracketsWithThresholds = async () => {
    setGeneratingAllBrackets(true);
    try {
      const res = await api.post<{ detail: string }>(`/tournaments/${id}/generate_all_brackets/`, {
        round_robin_min: rrMin,
        round_robin_max: rrMax,
        single_elimination_min: seMin,
        single_elimination_max: seMax,
      });
      toast({ title: "Генерація завершена!", description: res.data.detail });
      setBulkDialogOpen(false);
      fetchAll();
    } catch {
      toast({ title: "Помилка генерації сіток", variant: "destructive" });
    } finally {
      setGeneratingAllBrackets(false);
    }
  };

  const watchRulesetKey = watch("ruleset_key");

  // Завантаження рулсетів
  const fetchRulesets = async () => {
    try {
      const { data } = await api.get<RulesetInfo[]>("/rulesets/");
      setRulesets(data);
      if (data.length > 0) {
        // Якщо ruleset_key не обрано або порожній, ставимо перший
        setValue("ruleset_key", data[0].key);
        setSelectedRuleset(data[0]);
      }
    } catch {
      // ігноруємо помилки
    }
  };

  useEffect(() => {
    if (catDialogOpen) {
      fetchRulesets();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catDialogOpen]);

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
  const canComplete = tournament.status === "active";

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
            <Button variant="outline" size="sm" asChild>
              <Link to={`/tournaments/${id}/tatamis`}>Керування татамі</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/tournaments/${id}/day`}>Дашборд змагань</Link>
            </Button>
            {tournament.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoDistributeTatamis}
                disabled={distributingTatamis}
              >
                {distributingTatamis ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Авто-розподіл по татамі
              </Button>
            )}
            {tournament.status !== "completed" && categories.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDialogOpen(true)}
                disabled={generatingAllBrackets}
              >
                Згенерувати всі сітки
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenEditDialog}>
              Редагувати
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
              Вилучити турнір
            </Button>
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
              <Label>Правила (Рулсет)</Label>
              <Select
                value={watchRulesetKey || ""}
                onValueChange={(v) => {
                  setValue("ruleset_key", v);
                  const r = rulesets.find((item) => item.key === v);
                  setSelectedRuleset(r || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть правила..." />
                </SelectTrigger>
                <SelectContent>
                  {rulesets.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name} ({r.sport_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.ruleset_key && <p className="text-xs text-destructive">{errors.ruleset_key.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Тривалість поєдинку (сек, опціонально)</Label>
              <Input
                type="number"
                placeholder={
                  selectedRuleset?.default_duration_seconds
                    ? `${selectedRuleset.default_duration_seconds} (за замовчуванням)`
                    : "180"
                }
                {...register("match_duration_seconds")}
              />
              {errors.match_duration_seconds && <p className="text-xs text-destructive">{errors.match_duration_seconds.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Допустимий рівень майстерності (опціонально)</Label>
              <Input placeholder="напр. Чорний пояс 1 дан" {...register("allowed_skill_level")} />
              {errors.allowed_skill_level && <p className="text-xs text-destructive">{errors.allowed_skill_level.message}</p>}
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

      {/* Діалог редагування турніру */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редагувати турнір</DialogTitle>
          </DialogHeader>
          <form onSubmit={editTournamentForm.handleSubmit(onEditTournamentSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва</Label>
              <Input placeholder="Відкритий чемпіонат" {...editTournamentForm.register("title")} />
              {editTournamentForm.formState.errors.title && (
                <p className="text-xs text-destructive">{editTournamentForm.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Вид спорту</Label>
              <Input placeholder="Карате, Дзюдо..." {...editTournamentForm.register("sport_type")} />
              {editTournamentForm.formState.errors.sport_type && (
                <p className="text-xs text-destructive">{editTournamentForm.formState.errors.sport_type.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Місце проведення</Label>
              <Input placeholder="Спорткомплекс" {...editTournamentForm.register("location")} />
              {editTournamentForm.formState.errors.location && (
                <p className="text-xs text-destructive">{editTournamentForm.formState.errors.location.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок</Label>
                <Input type="date" {...editTournamentForm.register("start_date")} />
                {editTournamentForm.formState.errors.start_date && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.start_date.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець</Label>
                <Input type="date" {...editTournamentForm.register("end_date")} />
                {editTournamentForm.formState.errors.end_date && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.end_date.message}</p>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-2 py-2">
              <input
                type="checkbox"
                id="weigh_in_required"
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                {...editTournamentForm.register("weigh_in_required")}
              />
              <Label htmlFor="weigh_in_required" className="cursor-pointer">
                Потрібне зважування (якщо вимкнено, спортсмени підтверджуються одразу)
              </Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isEditing}>
                {isEditing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зберегти"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог видалення турніру */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити турнір</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете вилучити турнір <span className="font-bold text-foreground">{tournament.title}</span>? Ця дія повністю видалить турнір, його категорії та всі дані поєдинків.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Скасувати
            </Button>
            <Button variant="destructive" onClick={onDeleteTournament} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог групової генерації сіток */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Налаштування групової генерації сіток</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Вкажіть межі кількості учасників для кожного типу сітки. Система автоматично розподілить формат та згенерує сітки для всіх нестворених категорій.
            </p>

            <div className="border border-border rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900 space-y-3">
              <span className="text-xs font-bold text-amber-500 uppercase tracking-widest block">Кругова сітка (Round Robin)</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Мінімум людей</Label>
                  <Input type="number" value={rrMin} onChange={(e) => setRrMin(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Максимум людей</Label>
                  <Input type="number" value={rrMax} onChange={(e) => setRrMax(Number(e.target.value))} />
                </div>
              </div>
            </div>

            <div className="border border-border rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900 space-y-3">
              <span className="text-xs font-bold text-blue-500 uppercase tracking-widest block">Олімпійська сітка (Single Elimination)</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Мінімум людей</Label>
                  <Input type="number" value={seMin} onChange={(e) => setSeMin(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Максимум людей</Label>
                  <Input type="number" value={seMax} onChange={(e) => setSeMax(Number(e.target.value))} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>
              Скасувати
            </Button>
            <Button variant="sport" onClick={handleGenerateAllBracketsWithThresholds} disabled={generatingAllBrackets}>
              {generatingAllBrackets ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Згенерувати сітки
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
