import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, GitBranch, Plus, Loader2, CheckCircle, Scale, Trash2, Clock
} from "lucide-react";
import { estimateSchedule } from "@/lib/scheduler";
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
import { formatSportType } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/tournament/StatusBadge";
import type { Category, Registration, Athlete, PaginatedResponse, Tournament, Tatami, Match } from "@/types/api";

const weighInSchema = z.object({ weight: z.coerce.number().min(20).max(300) });
type WeighInForm = z.infer<typeof weighInSchema>;

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
});
type EditCategoryForm = z.infer<typeof editCategorySchema>;

export default function CategoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isOrganizer, isCoach, isJudge } = useAuth();

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
  // Re-use rulesets
  const [rulesets, setRulesets] = useState<any[]>([]);

  // Delete registration state
  const [deleteRegDialog, setDeleteRegDialog] = useState<Registration | null>(null);
  const [isDeletingReg, setIsDeletingReg] = useState(false);

  const editCategoryForm = useForm<EditCategoryForm>({
    resolver: zodResolver(editCategorySchema),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<WeighInForm>({
    resolver: zodResolver(weighInSchema),
  });

  const fetchAll = async () => {
    setIsLoading(true);
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
      setTatamis(tatamiRes.data);
      setTournament(tournRes.data);

      const allMatches = Array.isArray(matchRes.data) ? matchRes.data : (matchRes.data as any).results || [];
      setMatches(allMatches);

      const categoryMatches = allMatches.filter((m: any) => m.category === Number(id));
      const firstMatchWithTatami = categoryMatches?.find((m: any) => m.tatami !== null);
      if (firstMatchWithTatami) {
        setSelectedTatamiId(String(firstMatchWithTatami.tatami));
      } else {
        setSelectedTatamiId("");
      }
    } finally {
      setIsLoading(false);
    }
  };

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
      const { data } = await api.get<any[]>("/rulesets/");
      setRulesets(data);
    } catch {}
    editCategoryForm.reset({
      name: category.name,
      allowed_gender: category.allowed_gender as any,
      min_age: category.min_age,
      max_age: category.max_age,
      min_weight: category.min_weight ?? undefined,
      max_weight: category.max_weight ?? undefined,
      bracket_format: category.bracket_format as any,
      ruleset_key: category.ruleset_key,
      match_duration_seconds: category.match_duration_seconds ? String(category.match_duration_seconds) as any : "",
      allowed_skill_level: category.allowed_skill_level ?? "",
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

  if (isLoading) {
    return (
      <div className="container py-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }
  if (!category) return null;

  const canGenerateBracket = isOrganizer && category.status === "active" && registrations.some(r => r.status === "confirmed");
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
      estimateBanner = estimate.isLive ? (
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
            <div className="flex items-center gap-2 mt-3 bg-zinc-50 dark:bg-zinc-900 border border-border rounded-lg px-3 py-1.5 w-fit">
              <span className="text-xs font-bold text-muted-foreground">Призначений татамі:</span>
              <Select
                value={selectedTatamiId}
                onValueChange={(v) => {
                  setSelectedTatamiId(v);
                  handleAssignTatami(v);
                }}
                disabled={assigningTatami}
              >
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue placeholder="Оберіть татамі" />
                </SelectTrigger>
                <SelectContent>
                  {tatamis.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
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

      {/* Таблиця реєстрацій */}
      <div className="rounded-xl border border-border overflow-hidden">
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
                  onValueChange={(v) => editCategoryForm.setValue("allowed_gender", v as any)}
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
