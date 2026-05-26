import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, GitBranch, Plus, Loader2, CheckCircle, Scale
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/tournament/StatusBadge";
import type { Category, Registration, Athlete, PaginatedResponse } from "@/types/api";

const weighInSchema = z.object({ weight: z.coerce.number().min(20).max(300) });
type WeighInForm = z.infer<typeof weighInSchema>;

export default function CategoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isOrganizer, isCoach } = useAuth();

  const [category, setCategory] = useState<Category | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generatingBracket, setGeneratingBracket] = useState(false);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [weighInDialog, setWeighInDialog] = useState<Registration | null>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<string>("");
  const [isRegistering, setIsRegistering] = useState(false);

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
    } finally {
      setIsLoading(false);
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
      await api.post(`/categories/${id}/generate_bracket/`);
      toast({ title: "Сітку згенеровано!" });
      fetchAll();
    } finally {
      setGeneratingBracket(false);
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
          <p className="text-sm text-muted-foreground">
            {category.confirmed_registrations_count} учасників · {category.min_weight}–{category.max_weight} кг · {category.min_age}–{category.max_age} р.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canRegister && (
            <Button variant="outline" size="sm" onClick={() => setRegDialogOpen(true)}>
              <Plus className="w-4 h-4" /> Зареєструвати атлета
            </Button>
          )}
          {canGenerateBracket && (
            <Button variant="sport" size="sm" onClick={handleGenerateBracket} disabled={generatingBracket}>
              {generatingBracket ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
              Згенерувати сітку
            </Button>
          )}
          {category.status === "active" || category.status === "completed" ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/categories/${id}/bracket`}>
                <GitBranch className="w-4 h-4" /> Переглянути сітку
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Таблиця реєстрацій */}
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Атлет</TableHead>
              <TableHead>Клуб</TableHead>
              <TableHead>Вага (факт.)</TableHead>
              <TableHead>Статус</TableHead>
              {isOrganizer && <TableHead className="w-28">Дії</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Реєстрацій поки немає
                </TableCell>
              </TableRow>
            ) : registrations.map((reg) => (
              <TableRow key={reg.id}>
                <TableCell className="font-medium">{reg.athlete.full_name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{reg.athlete.club?.name}</TableCell>
                <TableCell className="font-mono text-sm">
                  {reg.recorded_weight != null ? `${reg.recorded_weight} кг` : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={reg.status} type="registration" />
                </TableCell>
                {isOrganizer && (
                  <TableCell>
                    {reg.status === "pending" && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setWeighInDialog(reg)}
                      >
                        <Scale className="w-3.5 h-3.5" /> Зважити
                      </Button>
                    )}
                    {reg.status === "confirmed" && (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle className="w-3.5 h-3.5" /> OK
                      </span>
                    )}
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
    </div>
  );
}
