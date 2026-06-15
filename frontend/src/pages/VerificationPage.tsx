/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  CheckCircle2,
  Scale,
  CreditCard,
  UserCheck,
  MapPin,
  ArrowLeft,
  Loader2,
  ShieldAlert,
  Calendar,
  Layers,
  Sparkles,
  Users,
} from "lucide-react";

const REGIONS_MAP: Record<string, string> = {
  vinnytsia: "Вінницька область",
  volyn: "Волинська область",
  dnipro: "Дніпропетровська область",
  donetsk: "Донецька область",
  zhytomyr: "Житомирська область",
  zakarpattia: "Закарпатська область",
  zaporizhzhia: "Запорізька область",
  "ivano-frankivsk": "Івано-Франківська область",
  kyiv_oblast: "Київська область",
  kyiv_city: "м. Київ",
  kirovohrad: "Кіровоградська область",
  luhansk: "Луганська область",
  lviv: "Львівська область",
  mykolaiv: "Миколаївська область",
  odesa: "Одеська область",
  poltava: "Полтавська область",
  rivne: "Рівненська область",
  sumy: "Сумська область",
  ternopil: "Тернопільська область",
  kharkiv: "Харківська область",
  kherson: "Херсонська область",
  khmelnytskyi: "Хмельницька область",
  cherkasy: "Черкаська область",
  chernivtsi: "Чернівецька область",
  chernihiv: "Чернігівська область",
  crimea: "АР Крим",
  sevastopol: "м. Севастополь",
};

export default function VerificationPage() {
  const { type, token } = useParams<{ type: string; token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passData, setPassData] = useState<any | null>(null);

  // Quick Action states
  const [isWeighInOpen, setIsWeighInOpen] = useState(false);
  const [weighInValue, setWeighInValue] = useState("");
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const isStaffOrOrganizer = user?.role === "staff" || user?.role === "organizer";

  const fetchPassDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<{ type: string; data: any }>("/auth/verify-pass/", {
        params: { token },
      });
      setPassData(res.data.data);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "Помилка при перевірці підпису бейджа.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchPassDetails();
    }
  }, [token]);

  const [targetRegId, setTargetRegId] = useState<number | null>(null);

  const updateRegistrationInState = (updatedReg: any) => {
    if (!passData) return;

    if (type === "registration") {
      if (passData.id === updatedReg.id) {
        setPassData({
          ...updatedReg,
          other_registrations: passData.other_registrations
        });
      } else if (passData.other_registrations) {
        setPassData({
          ...passData,
          other_registrations: passData.other_registrations.map((r: any) =>
            r.id === updatedReg.id ? updatedReg : r
          )
        });
      }
    } else if (type === "athlete") {
      if (passData.registrations) {
        setPassData({
          ...passData,
          registrations: passData.registrations.map((r: any) =>
            r.id === updatedReg.id ? updatedReg : r
          )
        });
      }
    }
  };

  const handleWeighInSubmit = async () => {
    if (!passData || !targetRegId) return;
    const weightVal = parseFloat(weighInValue);
    if (isNaN(weightVal) || weightVal <= 0) {
      toast({
        title: "Некоректна вага",
        description: "Будь ласка, введіть дійсне число більше нуля.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsSubmittingAction(true);
      const res = await api.post(`/registrations/${targetRegId}/confirm_weigh_in/`, {
        weight: weightVal,
      });
      updateRegistrationInState(res.data);
      toast({
        title: "Зважування підтверджено",
        description: `Збережено вагу: ${weightVal} кг. Статус допуску оновлено.`,
      });
      setIsWeighInOpen(false);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const togglePaymentStatus = async (regId: number, currentPaymentStatus: string) => {
    if (!passData) return;
    const newPaymentStatus = currentPaymentStatus === "paid" ? "debt" : "paid";
    try {
      setIsSubmittingAction(true);
      const res = await api.patch(`/registrations/${regId}/`, {
        payment_status: newPaymentStatus,
        payment_method: "offline",
      });
      updateRegistrationInState(res.data);
      toast({
        title: "Оплату оновлено",
        description: `Статус оплати змінено на: ${newPaymentStatus === "paid" ? "СПЛАЧЕНО" : "БОРГ"}.`,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const changeStatus = async (regId: number, newStatus: string) => {
    if (!passData) return;
    try {
      setIsSubmittingAction(true);
      const res = await api.patch(`/registrations/${regId}/`, { status: newStatus });
      updateRegistrationInState(res.data);
      toast({
        title: "Статус участі оновлено",
        description: "Статус заявки успішно змінено в базі даних.",
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Helper extraction values
  const athlete = type === "registration" ? passData?.athlete : passData;
  const isTeamReg = type === "registration" && passData?.team;
  const nameLabel = athlete
    ? `${athlete.last_name} ${athlete.first_name} ${athlete.patronymic || ""}`.trim()
    : isTeamReg
    ? passData?.team?.name
    : "—";

  const clubName = athlete?.club?.name
    ? athlete.club.name
    : isTeamReg
    ? (passData?.team?.club?.name || "Без клубу")
    : "Без клубу";

  const clubRegionCode = athlete?.club?.region
    ? athlete.club.region
    : isTeamReg
    ? passData?.team?.club?.region
    : undefined;
  const clubRegion = clubRegionCode ? (REGIONS_MAP[clubRegionCode] || clubRegionCode) : "";

  const mainReg = type === "registration" ? passData : null;
  const otherRegs = type === "registration" ? (passData?.other_registrations || []) : (passData?.registrations || []);
  const registrations = mainReg ? [mainReg, ...otherRegs] : otherRegs;

  const displayedRegistrations = registrations.filter((r: any) => {
    const isCurrentScanned = mainReg && mainReg.id === r.id;
    return r.tournament_status !== "completed" || isCurrentScanned;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 font-sans relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="text-slate-400 hover:text-slate-100 hover:bg-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Головна
        </Button>
        <span className="text-xs font-bold tracking-widest text-slate-500 uppercase flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          Tournament Pass
        </span>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center max-w-md w-full mx-auto my-4">
        {loading ? (
          <Card className="w-full bg-slate-900/60 border-slate-800/80 backdrop-blur-md shadow-2xl py-12 text-center">
            <CardContent className="space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto" />
              <p className="text-sm text-slate-400">Перевірка цифрового підпису та завантаження...</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="w-full bg-slate-900/60 border-red-500/20 backdrop-blur-md shadow-2xl overflow-hidden">
            <div className="h-2 bg-red-500" />
            <CardHeader className="text-center pt-8">
              <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-8 h-8 text-red-500" />
              </div>
              <CardTitle className="text-xl font-bold text-red-400 uppercase tracking-wide">Недійсний бейдж</CardTitle>
              <CardDescription className="text-slate-400 text-xs mt-1">
                Системи безпеки не підтвердили оригінальність перепустки.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-8 text-center space-y-4">
              <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl text-xs text-red-300 leading-relaxed max-w-xs mx-auto">
                {error}
              </div>
              <p className="text-[11px] text-slate-500 leading-normal max-w-xs mx-auto">
                Даний QR-код не містить валідного криптографічного ключа нашого сервера. Можливо, бейдж було змінено, скопійовано або підроблено.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="w-full space-y-6">
            {/* Athlete/Team Profile Card */}
            <Card className="w-full bg-slate-900/60 border-slate-800/80 backdrop-blur-md shadow-2xl overflow-hidden relative">
              {mainReg && mainReg.tournament_status === "completed" ? (
                <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-3 flex items-center justify-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
                  <span className="text-xs font-black uppercase tracking-wider text-red-400">
                    ТЕРМІН ДІЇ ЗАКІНЧИВСЯ / EXPIRED PASS
                  </span>
                </div>
              ) : (
                <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-3 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                    ВЕРИФІКОВАНО / VERIFIED PASS
                  </span>
                </div>
              )}

              <CardContent className="p-6 space-y-5">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-24 h-24 rounded-full border-3 border-emerald-500 bg-slate-950 overflow-hidden flex items-center justify-center relative shadow-inner">
                    {athlete?.photo ? (
                      <img src={athlete.photo} alt="" className="w-full h-full object-cover animate-fade-in" />
                    ) : (
                      <span className="text-3xl font-black text-slate-700">
                        {isTeamReg ? "T" : athlete?.first_name?.[0] || "?"}
                      </span>
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-100 tracking-tight leading-tight">
                      {nameLabel}
                    </h2>
                    <p className="text-xs text-amber-500 font-bold uppercase tracking-wider mt-1.5 flex items-center justify-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {clubName} {clubRegion && `(${clubRegion})`}
                    </p>
                  </div>
                </div>

                {athlete && (
                  <div className="grid grid-cols-3 gap-2 bg-slate-950/40 border border-slate-800/40 rounded-2xl p-4 text-center">
                    <div>
                      <div className="text-[8px] font-black uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        Вік
                      </div>
                      <span className="font-bold text-slate-200 text-xs">
                        {athlete.age || (athlete.birth_date ? new Date().getFullYear() - new Date(athlete.birth_date).getFullYear() : "—")} років
                      </span>
                    </div>
                    <div>
                      <div className="text-[8px] font-black uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-center gap-1">
                        <Scale className="w-3 h-3 text-slate-400" />
                        Вага
                      </div>
                      <span className="font-mono font-bold text-slate-200 text-xs">
                        {athlete.base_weight} кг
                      </span>
                    </div>
                    <div>
                      <div className="text-[8px] font-black uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-center gap-1">
                        <UserCheck className="w-3 h-3 text-slate-400" />
                        Рівень
                      </div>
                      <span className="font-bold text-slate-200 text-xs">
                        {athlete.skill_level || "—"}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Registrations List */}
            <div className="w-full space-y-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-400 mt-6 mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                Заявлені категорії ({displayedRegistrations.length})
              </h3>
              {displayedRegistrations.length === 0 ? (
                <Card className="w-full bg-slate-900/40 border-slate-800/80 py-8 text-center">
                  <CardContent className="text-xs text-slate-500">
                    Не знайдено активних реєстрацій для цього спортсмена на поточні турніри.
                  </CardContent>
                </Card>
              ) : (
                displayedRegistrations.map((reg: any) => {
                  const isCurrentScanned = mainReg && mainReg.id === reg.id;
                  const isTeamRegCard = !!reg.team;
                  return (
                    <Card
                      key={reg.id}
                      className={`w-full bg-slate-900/60 backdrop-blur-md shadow-xl overflow-hidden transition-all duration-200 ${
                        isCurrentScanned
                          ? "border-amber-500 shadow-amber-500/5 ring-1 ring-amber-500/30"
                          : "border-slate-800/80"
                      }`}
                    >
                      {isCurrentScanned && (
                        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                            Зчитаний бейдж / Scanned Pass
                          </span>
                          <span className="text-[10px] font-mono text-amber-500 font-bold">
                            ID: {reg.id}
                          </span>
                        </div>
                      )}
                      {!isCurrentScanned && (
                        <div className="bg-slate-950/40 border-b border-slate-900 px-4 py-1.5 flex items-center justify-between">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                            Категорія
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 font-bold">
                            ID: {reg.id}
                          </span>
                        </div>
                      )}

                      <CardContent className="p-5 space-y-4">
                        {/* Tournament & Category Info */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-wide text-slate-400">
                              {reg.tournament_title}
                            </span>
                            {reg.tournament_status === "completed" && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                Завершено / Ended
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-extrabold text-slate-100 leading-tight">
                            {reg.category_name}
                          </div>
                          {isTeamRegCard && (
                            <div className="mt-2 p-2.5 bg-blue-950/20 border border-blue-900/30 rounded-xl space-y-1">
                              <div className="text-[10px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5" />
                                Групова категорія: {reg.team?.name}
                              </div>
                              {reg.team?.athletes && reg.team.athletes.length > 0 && (
                                <div className="text-[10px] text-slate-400 leading-normal">
                                  Склад: {reg.team.athletes.map((a: any) => `${a.last_name} ${a.first_name}`).join(", ")}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Status Badges Row */}
                        <div className="grid grid-cols-3 gap-2 bg-slate-950/30 border border-slate-900/60 rounded-xl p-3 text-center">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-500 mb-1">
                              Зважування
                            </div>
                            <span className="text-[10px] font-bold text-slate-200">
                              {isTeamRegCard
                                ? "—"
                                : reg.recorded_weight !== null
                                ? `${reg.recorded_weight} кг`
                                : "Не пройдено"}
                            </span>
                          </div>
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-500 mb-1">
                              Оплата
                            </div>
                            <span
                              className={`font-bold uppercase text-[9px] px-1.5 py-0.5 rounded ${
                                reg.payment_status === "paid"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-red-500/10 text-red-400 border border-red-500/20"
                              }`}
                            >
                              {reg.payment_status === "paid" ? "Сплачено" : "Борг"}
                            </span>
                          </div>
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-500 mb-1">
                              Допуск
                            </div>
                            <span
                              className={`font-bold uppercase text-[9px] px-1.5 py-0.5 rounded ${
                                reg.status === "confirmed"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : reg.status === "withdrawn"
                                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              }`}
                            >
                              {reg.status_display}
                            </span>
                          </div>
                        </div>

                        {/* Actions Panel */}
                        {isStaffOrOrganizer && (
                          <div className="border-t border-slate-900 pt-4 mt-1 space-y-3">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                              <ShieldAlert className="w-3.5 h-3.5 text-blue-500" />
                              Адміністрування категорії
                            </div>
                            {reg.tournament_status === "completed" ? (
                              <div className="p-3 bg-slate-950/40 border border-slate-900 rounded-xl text-center text-xs text-slate-500 font-semibold">
                                🔒 Турнір завершено. Редагування даних заблоковано.
                              </div>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  {!isTeamRegCard && (
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        setWeighInValue(reg.recorded_weight ? reg.recorded_weight.toString() : "");
                                        setTargetRegId(reg.id);
                                        setIsWeighInOpen(true);
                                      }}
                                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl"
                                    >
                                      <Scale className="w-3.5 h-3.5" />
                                      Зважити
                                    </Button>
                                  )}
                                  {isTeamRegCard && (
                                    <Button
                                      size="sm"
                                      onClick={() => changeStatus(reg.id, reg.status === "confirmed" ? "pending" : "confirmed")}
                                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl"
                                    >
                                      <UserCheck className="w-3.5 h-3.5" />
                                      {reg.status === "confirmed" ? "Зняти допуск" : "Дати допуск"}
                                    </Button>
                                  )}

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => togglePaymentStatus(reg.id, reg.payment_status)}
                                    className="border-slate-800 text-slate-300 hover:bg-slate-950 font-bold flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl"
                                  >
                                    <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
                                    {reg.payment_status === "paid" ? "Борг" : "Оплачено"}
                                  </Button>
                                </div>

                                <div className="flex gap-2 pt-1">
                                  <Button
                                    size="sm"
                                    variant={reg.status === "pending" ? "default" : "outline"}
                                    onClick={() => changeStatus(reg.id, "pending")}
                                    className="text-[10px] font-bold py-1 flex-1 rounded-lg"
                                  >
                                    Очікує
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={reg.status === "confirmed" ? "sport" : "outline"}
                                    onClick={() => changeStatus(reg.id, "confirmed")}
                                    className="text-[10px] font-bold py-1 flex-1 rounded-lg"
                                  >
                                    Допущено
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={reg.status === "withdrawn" ? "destructive" : "outline"}
                                    onClick={() => changeStatus(reg.id, "withdrawn")}
                                    className="text-[10px] font-bold py-1 flex-1 rounded-lg"
                                  >
                                    Знято
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer copyright */}
      <footer className="text-center text-[10px] text-slate-600 max-w-md w-full mx-auto border-t border-slate-900 pt-4 mt-4">
        © 2026 Tournament WebService. Захищено криптографічним сертифікатом.
      </footer>

      {/* Weigh-in Dialog */}
      <Dialog open={isWeighInOpen} onOpenChange={setIsWeighInOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Scale className="w-5 h-5 text-blue-500" />
              Введення ваги при зважуванні
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Введіть фактичну вагу спортсмена. Система перевірить допуск по вагових рамках категорії.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-2">
            <label className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Фактична вага (кг):</label>
            <Input
              type="number"
              step="0.01"
              value={weighInValue}
              onChange={(e) => setWeighInValue(e.target.value)}
              placeholder="Приклад: 55.45"
              className="bg-slate-900 border-slate-800 text-slate-100 rounded-xl"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsWeighInOpen(false)}
              className="border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-900 rounded-xl"
            >
              Скасувати
            </Button>
            <Button
              onClick={handleWeighInSubmit}
              disabled={isSubmittingAction}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-1.5"
            >
              {isSubmittingAction && <Loader2 className="w-4 h-4 animate-spin" />}
              Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
