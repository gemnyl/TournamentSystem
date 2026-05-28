import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Plus, Loader2, Edit, Trash2, Shield, Info, Check, X, RefreshCw
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
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
import type { Tatami, Tournament } from "@/types/api";

const tatamiSchema = z.object({
  number: z.coerce.number().min(1, "Номер татамі має бути не менше 1"),
  name: z.string().optional().default(""),
  is_active: z.boolean().default(true),
  assigned_judge: z.string().optional().transform(v => v === "" || v === undefined ? null : Number(v)),
});

type TatamiForm = z.infer<typeof tatamiSchema>;

export default function TatamiAdminPage() {
  const { tid } = useParams<{ tid: string }>();
  const { toast } = useToast();

  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTatami, setEditingTatami] = useState<Tatami | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Tatami | null>(null);
  const [judges, setJudges] = useState<any[]>([]);

  const { register, handleSubmit, setValue, reset, formState: { errors }, watch } = useForm<TatamiForm>({
    resolver: zodResolver(tatamiSchema),
    defaultValues: { number: 1, name: "", is_active: true, assigned_judge: "" as any }
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [tRes, tatamiRes, judgeRes] = await Promise.all([
        api.get<Tournament>(`/tournaments/${tid}/`),
        api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${tid}`),
        api.get<any[] | { results: any[] }>("/auth/users/?role=judge"),
      ]);
      setTournament(tRes.data);
      const list = Array.isArray(tatamiRes.data)
        ? tatamiRes.data
        : (tatamiRes.data as { results: Tatami[] }).results;
      setTatamis(list);

      const judgeList = Array.isArray(judgeRes.data)
        ? judgeRes.data
        : (judgeRes.data as { results: any[] }).results;
      setJudges(judgeList);
    } catch {
      toast({ title: "Помилка завантаження даних", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  const handleOpenCreate = () => {
    setEditingTatami(null);
    const nextNum = tatamis.length > 0 ? Math.max(...tatamis.map(t => t.number)) + 1 : 1;
    reset({ number: nextNum, name: "", is_active: true, assigned_judge: "" as any });
    setDialogOpen(true);
  };

  const handleOpenEdit = (t: Tatami) => {
    setEditingTatami(t);
    reset({
      number: t.number,
      name: t.name ?? "",
      is_active: t.is_active,
      assigned_judge: t.assigned_judge ? String(t.assigned_judge) as any : "",
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

  const onSubmit = async (data: TatamiForm) => {
    setIsSubmitting(true);
    try {
      if (editingTatami) {
        // Редагування
        const res = await api.put<Tatami>(`/tatamis/${editingTatami.id}/`, {
          tournament: Number(tid),
          ...data,
        });
        setTatamis((prev) => prev.map((item) => (item.id === editingTatami.id ? res.data : item)));
        toast({ title: "Татамі оновлено!" });
      } else {
        // Створення
        const res = await api.post<Tatami>("/tatamis/", {
          tournament: Number(tid),
          ...data,
        });
        setTatamis((prev) => [...prev, res.data].sort((a, b) => a.number - b.number));
        toast({ title: "Татамі успішно створено!" });
      }
      setDialogOpen(false);
    } catch (err: any) {
      const detail = err.response?.data?.detail ?? err.response?.data?.non_field_errors?.[0] ?? "Помилка при збереженні татамі";
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
          <Button variant="outline" size="sm" onClick={fetchData}>
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
                const currentMatchObj = t.current_match as any;
                const hasMatch = currentMatchObj && typeof currentMatchObj === "object";
                const matchText = hasMatch
                  ? `R${currentMatchObj.round_index}.${currentMatchObj.match_order}: ${
                      currentMatchObj.reg_second?.athlete?.full_name ?? "TBD"
                    } vs ${currentMatchObj.reg_first?.athlete?.full_name ?? "TBD"}`
                  : "—";

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
                    <TableCell className="text-sm truncate max-w-xs">
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
              <select
                id="assigned_judge"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                {...register("assigned_judge")}
              >
                <option value="">-- Не закріплено --</option>
                {judges.map((j) => (
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
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
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
