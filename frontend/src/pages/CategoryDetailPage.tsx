import { useEffect, useState} from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, GitBranch, Plus, Loader2, CheckCircle, Scale, Trash2, Clock, Trophy, Award, Unlock
} from "lucide-react";
import { estimateSchedule } from "@/lib/scheduler";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { formatSportType } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/tournament/StatusBadge";
import type { Category, Registration, Athlete, PaginatedResponse, Tournament, Tatami, Match } from "@/types/api";

const weighInSchema = z.object({ weight: z.coerce.number().min(20).max(300) });
type WeighInForm = z.infer<typeof weighInSchema>;

interface CategoryResult {
  place: number | null;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scores_scored: number;
  scores_conceded: number;
  registration: {
    id: number;
    place?: number | null;
    athlete: {
      full_name: string;
      club?: { name?: string; region?: string } | null;
    };
  };
}

interface RulesetOption {
  key: string;
  label?: string;
  name?: string;
}

const editCategorySchema = z.object({
  name:                   z.string().min(2, "Введіть назву"),
  allowed_gender:         z.enum(["male", "female", "mixed"]),
  min_age:                z.coerce.number().min(5).max(100),
  max_age:                z.coerce.number().min(5).max(100),
  min_weight: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(1, "Мін. 1 кг").max(500, "Макс. 500 кг").optional()
  ),
  max_weight: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(1, "Мін. 1 кг").max(500, "Макс. 500 кг").optional()
  ),
  bracket_format:         z.enum(["single_elimination", "round_robin"]),
  ruleset_key:            z.string().min(1, "Оберіть правила"),
  match_duration_seconds: z.string().optional().transform(v => v === "" || v === undefined ? undefined : Number(v)),
  allowed_skill_level:    z.string().optional(),
  two_third_places:       z.boolean().default(true),
});
type EditCategoryForm = z.infer<typeof editCategorySchema>;

export default function CategoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isOrganizer, isCoach, isJudge } = useAuth();

  const [category, setCategory] = useState<Category | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generatingBracket, setGeneratingBracket] = useState(false);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [weighInDialog, setWeighInDialog] = useState<Registration | null>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<string>("");
  const [isRegistering, setIsRegistering] = useState(false);

  // Edit / Delete category states
  const [editCatDialogOpen, setEditCatDialogOpen] = useState(false);
  const [deleteCatDialogOpen, setDeleteCatDialogOpen] = useState(false);
  const [deleteBracketDialogOpen, setDeleteBracketDialogOpen] = useState(false);
  const [generateBracketDialogOpen, setGenerateBracketDialogOpen] = useState(false);
  const [chosenFormat, setChosenFormat] = useState<string>("single_elimination");
  const [isEditingCat, setIsEditingCat] = useState(false);
  const [isDeletingCat, setIsDeletingCat] = useState(false);
  const [isDeletingBracket, setIsDeletingBracket] = useState(false);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedTatamiId, setSelectedTatamiId] = useState<string>("");
  const [assigningTatami, setAssigningTatami] = useState(false);
  const [rulesets, setRulesets] = useState<RulesetOption[]>([]);

  const categoryMatches = matches.filter((m: Match) => m.category === Number(id));
  const firstMatchWithTatami = categoryMatches?.find((m: Match) => m.tatami !== null);
  const categoryTatami = (firstMatchWithTatami && Array.isArray(tatamis))
    ? tatamis.find((t: Tatami) => t.id === firstMatchWithTatami.tatami)
    : undefined;
  const canFinalizeOrUnlock = isOrganizer || (isJudge && categoryTatami && categoryTatami.assigned_judge === user?.id);

  // Delete registration state
  const [deleteRegDialog, setDeleteRegDialog] = useState<Registration | null>(null);
  const [isDeletingReg, setIsDeletingReg] = useState(false);

  // Tab states and results engine states
  const [activeTab, setActiveTab] = useState<"registrations" | "results">("registrations");
  const [results, setResults] = useState<CategoryResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [isSavingResults, setIsSavingResults] = useState(false);
  const [placeOverrides, setPlaceOverrides] = useState<Record<number, number | null>>({});

  const editCategoryForm = useForm<EditCategoryForm>({
    resolver: zodResolver(editCategorySchema),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<WeighInForm>({
    resolver: zodResolver(weighInSchema),
  });

  const fetchAll = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [catRes, regRes] = await Promise.all([
        api.get<Category>(`/categories/${id}/`),
        api.get<PaginatedResponse<Registration> | Registration[]>(`/registrations/?category=${id}`),
      ]);
      setCategory(catRes.data);
      setRegistrations(Array.isArray(regRes.data) ? regRes.data : regRes.data.results);

      const [tatamiRes, tournRes, matchRes] = await Promise.all([
        api.get<Tatami[]>(`/tatamis/?tournament=${catRes.data.tournament}`),
        api.get<Tournament>(`/tournaments/${catRes.data.tournament}/`),
        api.get<Match[] | { results: Match[] }>(`/matches/?tournament=${catRes.data.tournament}`),
      ]);
      setTatamis(Array.isArray(tatamiRes.data) ? tatamiRes.data : (tatamiRes.data as { results: Tatami[] }).results || []);
      setTournament(tournRes.data);

      const allMatches = Array.isArray(matchRes.data) ? matchRes.data : (matchRes.data as { results: Match[] }).results || [];
      setMatches(allMatches);

      const categoryMatches = allMatches.filter((m: Match) => m.category === Number(id));
      const firstMatchWithTatami = categoryMatches?.find((m: Match) => m.tatami !== null);
      if (firstMatchWithTatami) {
        setSelectedTatamiId(String(firstMatchWithTatami.tatami));
      } else {
        setSelectedTatamiId("");
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // WebSocket: real-time updates for category details page
  useMatchUpdates(Number(id), () => {
    fetchAll(true);
    fetchResults(true);
  }, {
    onConnect: () => {
      fetchAll(true);
      fetchResults(true);
    }
  });

  const handleAssignTatami = async (tatamiIdStr: string) => {
    if (!tatamiIdStr) return;
    setAssigningTatami(true);
    try {
      await api.post(`/categories/${id}/assign_tatami/`, { tatami_id: Number(tatamiIdStr) });
      toast({ title: "Татамі успішно призначено!" });
      fetchAll();
    } catch {
      toast({ title: "Помилка призначення татамі", variant: "destructive" });
    } finally {
      setAssigningTatami(false);
    }
  };

  const fetchAthletes = async () => {
    const { data } = await api.get<PaginatedResponse<Athlete> | Athlete[]>("/athletes/");
    setAthletes(Array.isArray(data) ? data : data.results);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [id]);
  useEffect(() => { if (regDialogOpen) fetchAthletes(); }, [regDialogOpen]);

  // Генерація сітки
  const handleGenerateBracket = async () => {
    setGeneratingBracket(true);
    try {
      await api.post(`/categories/${id}/generate_bracket/`, { bracket_format: chosenFormat });
      toast({ title: "Сітку згенеровано!" });
      setGenerateBracketDialogOpen(false);
      fetchAll();
    } catch {
      // toast з interceptor
    } finally {
      setGeneratingBracket(false);
    }
  };

  const handleOpenEditCat = async () => {
    if (!category) return;
    try {
      const { data } = await api.get<RulesetOption[]>("/rulesets/");
      setRulesets(data);
    } catch {
      // intentionally empty
    }
    editCategoryForm.reset({
      name: category.name,
      allowed_gender: category.allowed_gender as "male" | "female" | "mixed",
      min_age: category.min_age,
      max_age: category.max_age,
      min_weight: category.min_weight ?? undefined,
      max_weight: category.max_weight ?? undefined,
      bracket_format: category.bracket_format as "single_elimination" | "round_robin",
      ruleset_key: category.ruleset_key,
      match_duration_seconds: category.match_duration_seconds ? String(category.match_duration_seconds) : "",
      allowed_skill_level: category.allowed_skill_level ?? "",
      two_third_places: category.two_third_places ?? true,
    });
    setEditCatDialogOpen(true);
  };

  const onEditCatSubmit = async (data: EditCategoryForm) => {
    setIsEditingCat(true);
    try {
      const payload = {
        ...data,
        tournament: category?.tournament,
        min_weight: data.min_weight ?? null,
        max_weight: data.max_weight ?? null,
      };
      const { data: updated } = await api.put<Category>(`/categories/${id}/`, payload);
      setCategory(updated);
      toast({ title: "Категорію успішно оновлено!" });
      setEditCatDialogOpen(false);
      fetchAll();
    } catch {
      toast({ title: "Помилка оновлення категорії", variant: "destructive" });
    } finally {
      setIsEditingCat(false);
    }
  };

  const onDeleteCat = async () => {
    setIsDeletingCat(true);
    try {
      await api.delete(`/categories/${id}/`);
      toast({ title: "Категорію вилучено!" });
      setDeleteCatDialogOpen(false);
      window.location.href = `/tournaments/${category?.tournament}`;
    } catch {
      toast({ title: "Помилка вилучення категорії", variant: "destructive" });
    } finally {
      setIsDeletingCat(false);
    }
  };

  const handleDeleteBracket = async () => {
    setIsDeletingBracket(true);
    try {
      await api.post(`/categories/${id}/delete_bracket/`);
      toast({ title: "Сітку успішно вилучено!" });
      setDeleteBracketDialogOpen(false);
      fetchAll();
    } catch {
      toast({ title: "Помилка видалення сітки", variant: "destructive" });
    } finally {
      setIsDeletingBracket(false);
    }
  };

  // Реєстрація атлета
  const handleRegister = async () => {
    if (!selectedAthlete) return;
    setIsRegistering(true);
    try {
      await api.post("/registrations/", { category: Number(id), athlete_id: Number(selectedAthlete) });
      toast({ title: "Атлета зареєстровано!" });
      setRegDialogOpen(false);
      setSelectedAthlete("");
      fetchAll();
    } finally {
      setIsRegistering(false);
    }
  };

  // Зважування
  const handleWeighIn = async (data: WeighInForm) => {
    if (!weighInDialog) return;
    try {
      await api.post(`/registrations/${weighInDialog.id}/confirm_weigh_in/`, data);
      toast({ title: "Зважування підтверджено!" });
      setWeighInDialog(null);
      reset();
      fetchAll();
    } catch {
      // toast з interceptor
    }
  };

  // Видалення заявки
  const handleDeleteRegistration = async () => {
    if (!deleteRegDialog) return;
    setIsDeletingReg(true);
    try {
      await api.delete(`/registrations/${deleteRegDialog.id}/`);
      toast({ title: "Заявку успішно видалено!" });
      setDeleteRegDialog(null);
      fetchAll();
    } catch {
      toast({ title: "Помилка видалення заявки", variant: "destructive" });
    } finally {
      setIsDeletingReg(false);
    }
  };

  const fetchResults = async (silent = false) => {
    if (!silent) setIsLoadingResults(true);
    try {
      const [resultsRes, regRes] = await Promise.all([
        api.get<CategoryResult[]>(`/categories/${id}/results/`),
        api.get<PaginatedResponse<Registration> | Registration[]>(`/registrations/?category=${id}`),
      ]);
      setResults(resultsRes.data);
      setRegistrations(Array.isArray(regRes.data) ? regRes.data : regRes.data.results);

      const initialOverrides: Record<number, number | null> = {};
      resultsRes.data.forEach((res) => {
        initialOverrides[res.registration.id] = res.place;
      });
      setPlaceOverrides(initialOverrides);
    } catch {
      toast({ title: "Помилка завантаження результатів", variant: "destructive" });
    } finally {
      if (!silent) setIsLoadingResults(false);
    }
  };

  const handleSaveResults = async () => {
    setIsSavingResults(true);
    try {
      await api.post(`/categories/${id}/save_results/`, { overrides: placeOverrides });
      toast({ title: "Результати успішно зафіксовані!" });
      fetchResults();
      fetchAll();
    } catch {
      toast({ title: "Помилка фіксації результатів", variant: "destructive" });
    } finally {
      setIsSavingResults(false);
    }
  };

  const handleUnlockResults = async () => {
    setIsSavingResults(true);
    try {
      await api.post(`/categories/${id}/unlock_results/`);
      toast({ title: "Фіксацію результатів скасовано!" });
      fetchResults();
      fetchAll();
    } catch {
      toast({ title: "Помилка скасування фіксації", variant: "destructive" });
    } finally {
      setIsSavingResults(false);
    }
  };


  useEffect(() => {
    if (activeTab === "results") {
      fetchResults();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id]);

  if (isLoading) {
    return (
      <div className="container py-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }
  if (!category) return null;

  const canGenerateBracket = isOrganizer && category.status !== "completed" && registrations.some(r => r.status === "confirmed");
  const canRegister = (isOrganizer || isCoach) && category.status === "registration";

  // Обчислюємо оцінку розкладу для поточної категорії
  let estimateBanner = null;
  if (category && tatamis.length > 0 && matches.length > 0) {
    const { categoryEstimates } = estimateSchedule(tatamis, matches, [category]);
    const estimate = categoryEstimates[category.id];
    if (estimate) {
      const timeStr = new Date(estimate.startTime).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      });
      estimateBanner = !estimate.isTatamiActive ? (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20 mt-3 w-fit">
          <Clock className="w-3.5 h-3.5" />
          Роботу татамі №{estimate.tatamiNumber} призупинено (черга не активна)
        </div>
      ) : estimate.isLive ? (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20 mt-3 w-fit animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
          ТРИВАЄ ЗАРАЗ НА ТАТАМІ №{estimate.tatamiNumber}
        </div>
      ) : (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 mt-3 w-fit">
          <Clock className="w-3.5 h-3.5" />
          Очікуваний час початку: {timeStr} {estimate.tatamiNumber ? `(Татамі №${estimate.tatamiNumber})` : ""}
        </div>
      );
    }
  }

  return (
    <div className="container py-8 space-y-6">
      <Link to={`/tournaments/${category.tournament}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> До турніру
      </Link>

      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight">{category.name}</h1>
            <StatusBadge status={category.status} type="category" />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {category.confirmed_registrations_count} учасників · {
                category.min_weight !== null && category.max_weight !== null
                  ? `${category.min_weight}–${category.max_weight} кг`
                  : category.min_weight !== null
                  ? `від ${category.min_weight} кг`
                  : category.max_weight !== null
                  ? `до ${category.max_weight} кг`
                  : "без обмежень за вагою"
              } · {category.min_age}–{category.max_age} р.
            </p>
            {estimateBanner}
          </div>
          {isOrganizer && tatamis.length > 0 && category.has_bracket && (
            <div
              className="flex items-center gap-2 mt-3 border rounded-lg px-3 py-1.5 w-fit shadow-md text-zinc-100"
              style={{ backgroundColor: '#18181b', borderColor: '#27272a' }}
            >
              <span className="text-xs font-bold text-zinc-400">Призначений татамі:</span>
              <Select
                value={selectedTatamiId}
                onValueChange={(v) => {
                  setSelectedTatamiId(v);
                  handleAssignTatami(v);
                }}
                disabled={assigningTatami}
              >
                <SelectTrigger
                  className="h-7 w-36 text-xs hover:bg-zinc-800 hover:text-zinc-50 focus:ring-0 focus:ring-offset-0"
                  style={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#e4e4e7' }}
                >
                  <SelectValue placeholder="Оберіть татамі" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
                  {tatamis.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)} className="hover:bg-zinc-900 focus:bg-zinc-900 focus:text-zinc-100 cursor-pointer">
                      Татамі №{t.number} {t.name ? `(${t.name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canRegister && (
            <Button variant="outline" size="sm" onClick={() => setRegDialogOpen(true)}>
              <Plus className="w-4 h-4" /> Зареєструвати атлета
            </Button>
          )}
          {canGenerateBracket && !category.has_bracket && (
            <Button variant="sport" size="sm" onClick={() => { setChosenFormat(category.bracket_format); setGenerateBracketDialogOpen(true); }}>
              <GitBranch className="w-4 h-4" />
              Згенерувати сітку
            </Button>
          )}
          {isOrganizer && category.has_bracket && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteBracketDialogOpen(true)}>
              Вилучити сітку
            </Button>
          )}
          {category.has_bracket ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/categories/${id}/bracket`}>
                <GitBranch className="w-4 h-4" /> Переглянути сітку
              </Link>
            </Button>
          ) : null}
          {isOrganizer && (
            <>
              <Button variant="outline" size="sm" onClick={handleOpenEditCat}>
                Редагувати
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleteCatDialogOpen(true)}>
                Вилучити категорію
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Вкладки: Учасники та Результати */}
      <div className="flex border-b border-border gap-6">
        <button
          onClick={() => setActiveTab("registrations")}
          className={cn(
            "pb-3 text-sm font-bold tracking-wide uppercase transition-all relative border-b-2",
            activeTab === "registrations"
              ? "text-amber-500 border-amber-500"
              : "text-muted-foreground hover:text-foreground border-transparent"
          )}
        >
          Реєстрації ({registrations.length})
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={cn(
            "pb-3 text-sm font-bold tracking-wide uppercase transition-all relative border-b-2",
            activeTab === "results"
              ? "text-amber-500 border-amber-500"
              : "text-muted-foreground hover:text-foreground border-transparent"
          )}
        >
          Результати
        </button>
      </div>

      {activeTab === "registrations" ? (
        /* Таблиця реєстрацій */
        <div className="rounded-xl border border-border overflow-hidden bg-card/25 backdrop-blur-md">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Атлет</TableHead>
                <TableHead>Клуб</TableHead>
                {(isOrganizer || isCoach || isJudge) && <TableHead>Вага (факт.)</TableHead>}
                <TableHead>Статус</TableHead>
                {isOrganizer && <TableHead className="w-28 text-right">Дії</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isOrganizer ? 5 : 4} className="text-center text-muted-foreground py-8">
                    Реєстрацій поки немає
                  </TableCell>
                </TableRow>
              ) : registrations.map((reg) => (
                <TableRow key={reg.id}>
                  <TableCell className="font-medium">{reg.athlete.full_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{reg.athlete.club?.name}</TableCell>
                  {(isOrganizer || isCoach || isJudge) && (
                    <TableCell className="font-mono text-sm">
                      {reg.recorded_weight != null ? `${reg.recorded_weight} кг` : "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge status={reg.status} type="registration" />
                  </TableCell>
                  {isOrganizer && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {reg.status === "pending" && tournament?.weigh_in_required !== false && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setWeighInDialog(reg)}
                          >
                            <Scale className="w-3.5 h-3.5 mr-1" /> Зважити
                          </Button>
                        )}
                        {reg.status === "confirmed" && (
                          <span className="flex items-center gap-1 text-xs text-green-500 mr-2">
                            <CheckCircle className="w-3.5 h-3.5" /> OK
                          </span>
                        )}
                        <Button
                          variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteRegDialog(reg)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Видалити
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        /* Вкладка Результати */
        <div className="space-y-6">
          {isLoadingResults ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : (
            (() => {
              const hasMatches = categoryMatches.length > 0;
              const allMatchesCompleted = hasMatches && categoryMatches.every((m: Match) => m.status === "completed");
              const resultsPersisted = category.results_finalized ?? false;

              if (!hasMatches) {
                return (
                  <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border/80 bg-card/25 backdrop-blur-md">
                    <Trophy className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-bold text-foreground">Залік відсутній</h3>
                    <p className="text-sm text-muted-foreground max-w-md mt-1">
                      Турнірна сітка ще не згенерована. Створіть сітку та проведіть сутички, щоб сформувати залік.
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Банери статусу */}
                  {canFinalizeOrUnlock && (
                    <>
                      {!allMatchesCompleted ? (
                        <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-500 text-sm font-semibold select-none">
                          <Clock className="w-5 h-5 shrink-0" />
                          <span>Сутички в категорії ще тривають. Відображено поточні проміжні результати.</span>
                        </div>
                      ) : resultsPersisted ? (
                        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-500 text-sm font-semibold select-none">
                          <div className="flex items-center gap-3">
                            <CheckCircle className="w-5 h-5 shrink-0" />
                            <span>Результати змагань зафіксовано в базі даних та внесено до загального заліку.</span>
                          </div>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleUnlockResults}
                            disabled={isSavingResults}
                            className="shadow-sm"
                          >
                            {isSavingResults ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-1" />
                            ) : (
                              <Unlock className="w-4 h-4 mr-1" />
                            )}
                            Скасувати фіксацію
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-500 text-sm font-semibold select-none">
                          <div className="flex items-center gap-3">
                            <Award className="w-5 h-5 shrink-0" />
                            <span>Всі сутички завершено! Організатор або призначений суддя може зафіксувати результати.</span>
                          </div>
                          <Button
                            size="sm"
                            variant="sport"
                            onClick={handleSaveResults}
                            disabled={isSavingResults}
                            className="shadow-sm shadow-amber-500/10"
                          >
                            {isSavingResults ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-1" />
                            ) : (
                              <Trophy className="w-4 h-4 mr-1" />
                            )}
                            Зафіксувати результати
                          </Button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Таблиця результатів */}
                  <div className="rounded-xl border border-border overflow-hidden bg-card/25 backdrop-blur-md">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-24 text-center font-bold">Місце</TableHead>
                          <TableHead className="font-bold">Атлет</TableHead>
                          <TableHead className="font-bold">Клуб / Регіон</TableHead>
                          <TableHead className="text-center w-28 font-bold">В / Н / П</TableHead>
                          <TableHead className="text-center w-24 font-bold">Очки</TableHead>
                          <TableHead className="text-center w-32 font-bold">Співвідношення балів</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              Немає даних для заліку
                            </TableCell>
                          </TableRow>
                        ) : results.map((res: CategoryResult) => {
                            const placeVal = resultsPersisted ? res.registration?.place : placeOverrides[res.registration.id];
                            const medal =
                              placeVal === 1
                                ? "🥇"
                                : placeVal === 2
                                ? "🥈"
                                : placeVal === 3
                                ? "🥉"
                                : placeVal != null
                                ? `${placeVal}`
                                : "—";

                            return (
                              <TableRow key={res.registration.id} className="hover:bg-muted/10">
                                <TableCell className="text-center py-2">
                                  {resultsPersisted ? (
                                    <span
                                      className={cn(
                                        "font-black text-lg",
                                        placeVal === 1 && "text-yellow-400 scale-110",
                                        placeVal === 2 && "text-slate-300 scale-105",
                                        placeVal === 3 && "text-amber-600",
                                        (placeVal ?? 0) > 3 && "text-muted-foreground text-sm font-normal"
                                      )}
                                    >
                                      {medal}
                                    </span>
                                  ) : canFinalizeOrUnlock ? (
                                    <select
                                      value={placeOverrides[res.registration.id] ?? ""}
                                      onChange={(e) => {
                                        const val = e.target.value === "" ? null : Number(e.target.value);
                                        setPlaceOverrides((prev) => ({ ...prev, [res.registration.id]: val }));
                                      }}
                                      className="bg-background text-foreground border border-input rounded px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 w-16 text-center"
                                    >
                                      <option value="">—</option>
                                      <option value="1">1</option>
                                      <option value="2">2</option>
                                      <option value="3">3</option>
                                      <option value="5">5</option>
                                    </select>
                                  ) : (
                                    <span className="text-muted-foreground text-sm font-semibold">
                                      {medal}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="font-bold text-foreground">
                                  {res.registration.athlete.full_name}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {res.registration.athlete.club ? (
                                    <span>
                                      {res.registration.athlete.club.name}
                                      {res.registration.athlete.club.region && (
                                        <span className="text-xs text-muted-foreground/60 ml-2 px-1.5 py-0.5 rounded bg-muted">
                                          {res.registration.athlete.club.region}
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                                <TableCell className="text-center font-semibold text-sm">
                                  <span className="text-green-500 font-bold">{res.wins}</span>
                                  <span className="text-muted-foreground mx-1">/</span>
                                  <span className="text-amber-500 font-bold">{res.draws}</span>
                                  <span className="text-muted-foreground mx-1">/</span>
                                  <span className="text-red-500 font-bold">{res.losses}</span>
                                </TableCell>
                                <TableCell className="text-center font-black text-amber-500 bg-amber-500/5">
                                  {res.points}
                                </TableCell>
                                <TableCell className="text-center font-mono text-xs text-muted-foreground">
                                  {res.scores_scored} : {res.scores_conceded}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        }
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* Діалог реєстрації атлета */}
      <Dialog open={regDialogOpen} onOpenChange={setRegDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Реєстрація атлета</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Оберіть атлета</Label>
            <Select value={selectedAthlete} onValueChange={setSelectedAthlete}>
              <SelectTrigger>
                <SelectValue placeholder="Пошук атлета..." />
              </SelectTrigger>
              <SelectContent>
                {athletes.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.full_name ?? `${a.first_name} ${a.last_name}`} — {a.club?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegDialogOpen(false)}>Скасувати</Button>
            <Button variant="sport" onClick={handleRegister} disabled={!selectedAthlete || isRegistering}>
              {isRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зареєструвати"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог зважування */}
      <Dialog open={!!weighInDialog} onOpenChange={(o) => !o && setWeighInDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Підтвердити зважування</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{weighInDialog?.athlete?.full_name}</p>
          <form onSubmit={handleSubmit(handleWeighIn)} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Фактична вага (кг)</Label>
              <Input type="number" step="0.1" placeholder="49.8" {...register("weight")} />
              {errors.weight && <p className="text-xs text-destructive">{errors.weight.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWeighInDialog(null)}>Скасувати</Button>
              <Button type="submit" variant="sport">Підтвердити</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог вибору формату сітки */}
      <Dialog open={generateBracketDialogOpen} onOpenChange={setGenerateBracketDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Згенерувати сітку змагань</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Формат турнірної сітки</Label>
              <Select value={chosenFormat} onValueChange={setChosenFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_elimination">Олімпійська (на вибування)</SelectItem>
                  <SelectItem value="round_robin">Кругова (кожен з кожним)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Формат сітки визначить спосіб розподілу поєдинків та просування переможців. Переконайтеся, що всі спортсмени пройшли зважування перед генерацією.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateBracketDialogOpen(false)}>Скасувати</Button>
            <Button variant="sport" onClick={handleGenerateBracket} disabled={generatingBracket}>
              {generatingBracket ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Згенерувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог видалення сітки */}
      <Dialog open={deleteBracketDialogOpen} onOpenChange={setDeleteBracketDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити турнірну сітку</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете видалити згенеровану сітку поєдинків для категорії <span className="font-bold text-foreground">{category.name}</span>? Це видалить всі створені матчі. Ця дія є незворотною.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBracketDialogOpen(false)}>Скасувати</Button>
            <Button variant="destructive" onClick={handleDeleteBracket} disabled={isDeletingBracket}>
              {isDeletingBracket ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити сітку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог видалення категорії */}
      <Dialog open={deleteCatDialogOpen} onOpenChange={setDeleteCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити категорію</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете вилучити категорію <span className="font-bold text-foreground">{category.name}</span>? Ця дія повністю видалить категорію та всі пов'язані з нею реєстрації та поєдинки.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCatDialogOpen(false)}>Скасувати</Button>
            <Button variant="destructive" onClick={onDeleteCat} disabled={isDeletingCat}>
              {isDeletingCat ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог редагування категорії */}
      <Dialog open={editCatDialogOpen} onOpenChange={setEditCatDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Редагувати категорію</DialogTitle>
          </DialogHeader>
          <form onSubmit={editCategoryForm.handleSubmit(onEditCatSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва категорії</Label>
              <Input placeholder="Кадети до 50 кг..." {...editCategoryForm.register("name")} />
              {editCategoryForm.formState.errors.name && (
                <p className="text-xs text-destructive">{editCategoryForm.formState.errors.name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Стать</Label>
                <Select
                  value={editCategoryForm.watch("allowed_gender") || "male"}
                  onValueChange={(v) => editCategoryForm.setValue("allowed_gender", v as "male" | "female" | "mixed")}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Чоловіча</SelectItem>
                    <SelectItem value="female">Жіноча</SelectItem>
                    <SelectItem value="mixed">Змішана</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вік від</Label>
                <Input type="number" placeholder="14" {...editCategoryForm.register("min_age")} />
                {editCategoryForm.formState.errors.min_age && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.min_age.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Вік до</Label>
                <Input type="number" placeholder="17" {...editCategoryForm.register("max_age")} />
                {editCategoryForm.formState.errors.max_age && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.max_age.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вага від (кг, <span className="text-muted-foreground text-xs font-normal">необов'язково</span>)</Label>
                <Input type="number" placeholder="45" {...editCategoryForm.register("min_weight")} />
                {editCategoryForm.formState.errors.min_weight && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.min_weight.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Вага до (кг, <span className="text-muted-foreground text-xs font-normal">необов'язково</span>)</Label>
                <Input type="number" placeholder="50" {...editCategoryForm.register("max_weight")} />
                {editCategoryForm.formState.errors.max_weight && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.max_weight.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Правила (Рулсет)</Label>
              <Select
                value={editCategoryForm.watch("ruleset_key") || ""}
                onValueChange={(v) => editCategoryForm.setValue("ruleset_key", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть правила..." />
                </SelectTrigger>
                <SelectContent>
                  {rulesets.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name} ({formatSportType(r.sport_type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Тривалість поєдинку (сек, опціонально)</Label>
              <Input type="number" placeholder="180" {...editCategoryForm.register("match_duration_seconds")} />
            </div>

            <div className="space-y-1.5">
              <Label>Допустимий рівень майстерності (опціонально)</Label>
              <Input placeholder="напр. Чорний пояс" {...editCategoryForm.register("allowed_skill_level")} />
            </div>

            <div className="flex items-center space-x-2 py-2">
              <input
                type="checkbox"
                id="edit_two_third_places"
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                {...editCategoryForm.register("two_third_places")}
              />
              <Label htmlFor="edit_two_third_places" className="cursor-pointer">
                Два третіх місця (обидва півфіналісти отримують бронзу)
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditCatDialogOpen(false)}>Скасувати</Button>
              <Button type="submit" variant="sport" disabled={isEditingCat}>
                {isEditingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зберегти"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог підтвердження видалення заявки */}
      <Dialog open={deleteRegDialog !== null} onOpenChange={(open) => !open && setDeleteRegDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити заявку</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете видалити заявку атлета{" "}
            <span className="font-bold text-foreground">{deleteRegDialog?.athlete.full_name}</span>?
            Ця дія незворотна.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRegDialog(null)}>
              Скасувати
            </Button>
            <Button variant="destructive" onClick={handleDeleteRegistration} disabled={isDeletingReg}>
              {isDeletingReg ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
