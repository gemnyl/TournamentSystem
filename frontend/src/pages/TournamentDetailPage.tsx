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
import type { Tournament, Category, PaginatedResponse, RulesetInfo, Tatami, Match } from "@/types/api";
import { formatSportType } from "@/lib/utils";
import { estimateSchedule } from "@/lib/scheduler";

const categorySchema = z.object({
  name:                   z.string().min(2, "Введіть назву"),
  allowed_gender:         z.enum(["male", "female", "mixed"]),
  min_age:                z.coerce.number().min(5).max(100),
  max_age:                z.coerce.number().min(5).max(100),
  min_weight:             z.string().optional().transform(v => v === "" || v === undefined || v === null ? null : Number(v)),
  max_weight:             z.string().optional().transform(v => v === "" || v === undefined || v === null ? null : Number(v)),
  ruleset_key:            z.string().min(1, "Оберіть правила"),
  match_duration_seconds: z.string().optional().transform(v => v === "" || v === undefined ? undefined : Number(v)),
  allowed_skill_level:    z.string().optional(),
}).refine((data) => {
  if (data.min_weight !== null && data.max_weight !== null) {
    return data.max_weight > data.min_weight;
  }
  return true;
}, {
  message: "Максимальна вага має бути більшою за мінімальну вагу",
  path: ["max_weight"]
});
type CategoryForm = z.infer<typeof categorySchema>;

const editTournamentSchema = z.object({
  title:              z.string().min(3, "Мінімум 3 символи"),
  sport_type:         z.string().min(2, "Введіть вид спорту"),
  location:           z.string().min(2, "Введіть місце проведення"),
  start_date:         z.string().min(1, "Оберіть дату початку"),
  end_date:           z.string().min(1, "Оберіть дату кінця"),
  registration_start: z.string().optional().nullable(),
  registration_end:   z.string().optional().nullable(),
  weigh_in_required:  z.boolean(),
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
type EditTournamentForm = z.infer<typeof editTournamentSchema>;

const formatLocalDateTime = (dateStr: string | null) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hh}:${mm}`;
};

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isOrganizer, user } = useAuth();
  const isCoach = user?.role === "coach";

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
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

  // Bulk import categories states
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);

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
      start_date: formatLocalDateTime(tournament.start_date),
      end_date: formatLocalDateTime(tournament.end_date),
      registration_start: formatLocalDateTime(tournament.registration_start),
      registration_end: formatLocalDateTime(tournament.registration_end),
      weigh_in_required: tournament.weigh_in_required,
    });
    setEditDialogOpen(true);
  };

  const onEditTournamentSubmit = async (data: EditTournamentForm) => {
    setIsEditing(true);
    try {
      const payload = {
        ...data,
        registration_start: data.registration_start || null,
        registration_end: data.registration_end || null,
      };
      const res = await api.put<Tournament>(`/tournaments/${id}/`, payload);
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
        const filtered = data.filter(r => r.sport_type === tournament?.sport_type);
        const defaultRuleset = filtered.length > 0 ? filtered[0] : data[0];
        setValue("ruleset_key", defaultRuleset.key);
        setSelectedRuleset(defaultRuleset);
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
      const [tRes, cRes, tatamiRes, matchRes] = await Promise.all([
        api.get<Tournament>(`/tournaments/${id}/`),
        api.get<PaginatedResponse<Category> | Category[]>(`/categories/?tournament=${id}`),
        api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${id}`),
        api.get<Match[] | { results: Match[] }>(`/matches/?tournament=${id}`),
      ]);
      setTournament(tRes.data);
      setCategories(Array.isArray(cRes.data) ? cRes.data : cRes.data.results);
      setTatamis(Array.isArray(tatamiRes.data) ? tatamiRes.data : (tatamiRes.data as any).results || []);
      setMatches(Array.isArray(matchRes.data) ? matchRes.data : (matchRes.data as any).results || []);
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

  const getRegistrationStatus = () => {
    if (!tournament.registration_start && !tournament.registration_end) {
      return { status: "opened", label: "Реєстрація відкрита (без обмежень)" };
    }
    const now = new Date().getTime();
    const start = tournament.registration_start ? new Date(tournament.registration_start).getTime() : null;
    const end = tournament.registration_end ? new Date(tournament.registration_end).getTime() : null;

    if (start && now < start) {
      return { status: "not_started", label: `Реєстрація не розпочалась (відкриється ${new Date(start).toLocaleString("uk-UA")})` };
    }
    if (end && now > end) {
      return { status: "closed", label: `Реєстрація закрита (завершилась ${new Date(end).toLocaleString("uk-UA")})` };
    }
    return { status: "opened", label: "Реєстрація відкрита" };
  };

  const regInfo = getRegistrationStatus();

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
            <p className="text-sm text-muted-foreground/80 max-w-2xl">{formatSportType(tournament.sport_type)}</p>
          )}
          {isOrganizer || isCoach ? (
            <div className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
              regInfo.status === "opened" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
              regInfo.status === "not_started" ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" :
              "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}>
              {regInfo.label}
            </div>
          ) : null}
        </div>

        {/* Кнопки дій */}
        <div className="flex flex-wrap gap-2">
          {tournament.status !== "draft" && (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="border-green-500/30 text-green-500 hover:bg-green-500/5 hover:text-green-400 relative"
            >
              <Link to={`/tournaments/${id}/day`} className="flex items-center gap-1.5 font-semibold">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                Live-табло татамі
              </Link>
            </Button>
          )}

          {isOrganizer && (
            <>
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
            </>
          )}
        </div>
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
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                Імпорт категорій
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
                <Plus className="w-4 h-4" /> Додати категорію
              </Button>
            </div>
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
            {(() => {
              const { categoryEstimates } = estimateSchedule(tatamis, matches, categories);
              return categories.map((c) => (
                <CategoryCard key={c.id} category={c} estimate={categoryEstimates[c.id]} />
              ));
            })()}
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
                <Label>Вага від (кг) <span className="text-muted-foreground text-xs">(необов'язково)</span></Label>
                <Input type="number" placeholder="45" {...register("min_weight")} />
                {errors.min_weight && <p className="text-xs text-destructive">{errors.min_weight.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Вага до (кг) <span className="text-muted-foreground text-xs">(необов'язково)</span></Label>
                <Input type="number" placeholder="50" {...register("max_weight")} />
                {errors.max_weight && <p className="text-xs text-destructive">{errors.max_weight.message}</p>}
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
                  {rulesets.filter(r => r.sport_type === tournament.sport_type || !tournament.sport_type).map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name} ({formatSportType(r.sport_type)})
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
              <Select
                value={editTournamentForm.watch("sport_type") || ""}
                onValueChange={(v) => editTournamentForm.setValue("sport_type", v)}
              >
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
                <Label>Початок турніру</Label>
                <Input type="datetime-local" {...editTournamentForm.register("start_date")} />
                {editTournamentForm.formState.errors.start_date && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.start_date.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець турніру</Label>
                <Input type="datetime-local" {...editTournamentForm.register("end_date")} />
                {editTournamentForm.formState.errors.end_date && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.end_date.message}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок реєстрації <span className="text-muted-foreground text-xs">(опціонально)</span></Label>
                <Input type="datetime-local" {...editTournamentForm.register("registration_start")} />
                {editTournamentForm.formState.errors.registration_start && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.registration_start.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець реєстрації <span className="text-muted-foreground text-xs">(опціонально)</span></Label>
                <Input type="datetime-local" {...editTournamentForm.register("registration_end")} />
                {editTournamentForm.formState.errors.registration_end && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.registration_end.message}</p>
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

            <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-3">
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

            <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-3">
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

      {/* Діалог імпорту категорій */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Імпорт категорій</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Введіть назви категорій (кожна з нового рядка). Наша система автоматично визначить стать, вік та вагові межі на основі тексту!
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-7"
                onClick={() => setImportText(
                  "12-13 років, хлопці, до 40 кг\n12-13 років, дівчата, до 45 кг\n14-15 років, хлопці, понад 60 кг\n16-17 років, хлопці, 55-60 кг"
                )}
              >
                Шаблон WKF (Хлопці / Дівчата)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-7"
                onClick={() => setImportText(
                  "U10, -30kg, Male\nU12, -35kg, Female\nU14, +45kg, Mixed"
                )}
              >
                Шаблон English (U10 / U12)
              </Button>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Введіть категорії..."
              rows={8}
              className="w-full text-sm p-3 border border-input rounded bg-zinc-950 text-white font-mono focus-visible:outline-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Скасувати</Button>
            <Button
              variant="sport"
              disabled={isImporting || !importText.trim()}
              onClick={async () => {
                setIsImporting(true);
                try {
                  const names = importText.split("\n").map(n => n.trim()).filter(Boolean);
                  await api.post(`/tournaments/${id}/import_categories/`, { names });
                  toast({ title: "Категорії успішно імпортовано!" });
                  setImportDialogOpen(false);
                  setImportText("");
                  fetchAll();
                } catch {
                  toast({ title: "Помилка імпорту категорій", variant: "destructive" });
                } finally {
                  setIsImporting(false);
                }
              }}
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Імпортувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
