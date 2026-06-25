/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Search, Loader2, Check, Award, Calendar, MapPin, RefreshCw, Trophy, AlertTriangle, Lock as LockIcon, History as HistoryIcon, Info, Wallet, CreditCard, CheckCircle } from "lucide-react";
import api, { formatAxiosError, AxiosError, ErrorDetail } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentSocket } from "@/hooks/useTournamentSocket";
import { toast } from "@/hooks/use-toast";
import { formatRegistrationName, formatRegistrationClub, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { BracketView } from "@/components/bracket/BracketView";
import { MatchCard } from "@/components/bracket/MatchCard";
import type { Tournament, Registration, Category, Match, BracketResponse, RoleRequest, Invoice } from "@/types/api";
import { InvoiceDetailsDialog } from "@/components/tournament/InvoiceDetailsDialog";

const ROLE_LABELS: Record<string, string> = {
  organizer: "Організатор",
  coach:     "Тренер",
  judge:     "Суддя",
  spectator: "Глядач",
  staff:     "Персонал",
};

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-600/20 text-emerald-400 border border-emerald-500/20";
    case "withdrawn":
      return "bg-rose-600/20 text-rose-400 border border-rose-500/20";
    default:
      return "bg-yellow-600/20 text-yellow-400 border border-yellow-500/20";
  }
}

function getCategoryStatusLabel(status: string) {
  if (status === "registration") return "Реєстрація";
  if (status === "active") return "Активний";
  return "Завершено";
}

interface FinanceReport {
  total_revenue: number;
  total_entries_count: number;
  online_funds: number;
  online_entries_count: number;
  offline_funds: number;
  offline_entries_count: number;
  platform_fee_total: number;
  platform_fee_held: number;
  platform_fee_offline_debt: number;
  platform_fee_paid: number;
  platform_fee_debt: number;
  organizer_credit_limit: number;
  organizer_total_debt: number;
  withdrawn_funds: number;
  pending_withdrawn_funds: number;
  available_balance: number;
}

interface PayoutRequestItem {
  id: number;
  amount: number;
  bank_details: string;
  iban?: string;
  recipient_name?: string;
  recipient_code?: string;
  purpose?: string;
  status: string;
  created_at: string;
}

interface UnpaidTournament {
  id: number;
  title: string;
  platform_fee_amount: number;
}

interface AdminOrganizer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  credit_limit: number;
}

interface AdminDebt {
  tournament_id: number;
  title: string;
  organizer_name: string;
  organizer_email: string;
  amount: number;
  completed_at: string;
}

interface WeighInGroup {
  id: string;
  type: "athlete" | "team";
  athleteId?: number;
  teamId?: number;
  name: string;
  club: string;
  coach: string;
  gender?: string;
  age?: number;
  baseWeight?: number | null;
  registrations: Registration[];
  checkedIn: boolean;
  recordedWeight?: number | null;
}

export default function StaffDashboardPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial states from URL search parameters, with fallback to default values
  const initialTab = searchParams.get("tab") || "registrations";
  const initialTournamentId = searchParams.get("tournamentId") || "";
  const initialSearch = searchParams.get("search") || "";
  const initialCategory = searchParams.get("category") || "all";
  const initialPayment = searchParams.get("payment") || "all";
  const initialStatus = searchParams.get("status") || "all";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedBracketCategoryId, setSelectedBracketCategoryId] = useState<number | null>(null);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  // WebSocket connection status
  const [isConnected, setIsConnected] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState(initialCategory);
  const [paymentFilter, setPaymentFilter] = useState(initialPayment);
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  // Weigh-in dialog
  const [weighInReg, setWeighInReg] = useState<Registration | null>(null);
  const [weighInValue, setWeighInValue] = useState("");
  const [submittingWeighIn, setSubmittingWeighIn] = useState(false);

  // Role verification states
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [loadingRoleRequests, setLoadingRoleRequests] = useState(false);
  const [reviewDialogReq, setReviewDialogReq] = useState<RoleRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected" | "">("");
  const [activeReviewReq, setActiveReviewReq] = useState<RoleRequest | null>(null);

  // Secretary Bulk Actions & Organizer Finance states
  const [selectedRegIds, setSelectedRegIds] = useState<number[]>([]);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [financeReport, setFinanceReport] = useState<FinanceReport | null>(null);
  const [isLoadingFinance, setIsLoadingFinance] = useState(false);
  const [isPayingPlatformFee, setIsPayingPlatformFee] = useState(false);

  // Financial details & withdrawals states
  const [financeSubTab, setFinanceSubTab] = useState<"summary" | "details" | "withdrawals">("summary");
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequestItem[]>([]);
  const [isLoadingPayouts, setIsLoadingPayouts] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutIBAN, setPayoutIBAN] = useState("");
  const [payoutRecipientName, setPayoutRecipientName] = useState("");
  const [payoutRecipientCode, setPayoutRecipientCode] = useState("");
  const [payoutPurpose, setPayoutPurpose] = useState("");
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);
  const [unpaidTournaments, setUnpaidTournaments] = useState<UnpaidTournament[]>([]);
  const [selectedUnpaidTournaments, setSelectedUnpaidTournaments] = useState<number[]>([]);
  const [isPayingBulkFee, setIsPayingBulkFee] = useState(false);
  const [paymentDetailsSearch, setPaymentDetailsSearch] = useState("");
  const [paymentDetailsStatusFilter, setPaymentDetailsStatusFilter] = useState("all");

  // Invoice Details Modal
  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState<Invoice | null>(null);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);

  const handleOpenInvoiceModal = (invoice: Invoice) => {
    setSelectedInvoiceForModal(invoice);
    setIsInvoiceModalOpen(true);
  };

  // Admin limits management states
  const [adminOrganizers, setAdminOrganizers] = useState<AdminOrganizer[]>([]);
  const [isLoadingAdminOrganizers, setIsLoadingAdminOrganizers] = useState(false);
  const [adminDebts, setAdminDebts] = useState<AdminDebt[]>([]);
  const [isLoadingAdminDebts, setIsLoadingAdminDebts] = useState(false);
  const [editingOrganizerLimit, setEditingOrganizerLimit] = useState<AdminOrganizer | null>(null);
  const [newLimitValue, setNewLimitValue] = useState("");
  const [isSavingLimit, setIsSavingLimit] = useState(false);
  const [adminOrganizersSearch, setAdminOrganizersSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "athlete">("list");
  const [weighInGroup, setWeighInGroup] = useState<WeighInGroup | null>(null);

  useEffect(() => {
    if (reviewDialogReq) {
      setActiveReviewReq(reviewDialogReq);
    }
  }, [reviewDialogReq]);

  const updateQueryParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  const handleActiveTabChange = (val: string) => {
    setActiveTab(val);
    updateQueryParam("tab", val);
  };

  const handleSearchQueryChange = (val: string) => {
    setSearchQuery(val);
    updateQueryParam("search", val);
  };

  const handleCategoryFilterChange = (val: string) => {
    setSelectedCategoryFilter(val);
    updateQueryParam("category", val);
  };

  const handlePaymentFilterChange = (val: string) => {
    setPaymentFilter(val);
    updateQueryParam("payment", val);
  };

  const handleStatusFilterChange = (val: string) => {
    setStatusFilter(val);
    updateQueryParam("status", val);
  };

  const handleSelectTournament = (t: Tournament | null) => {
    setSelectedTournament(t);
    updateQueryParam("tournamentId", t ? String(t.id) : "");
  };

  // Fetch staff tournaments
  useEffect(() => {
    async function fetchTournaments() {
      try {
        setLoadingTournaments(true);
        // GET /api/tournaments/?staff_member=me
        const res = await api.get<Tournament[] | { results: Tournament[] }>("/tournaments/?staff_member=me&page_size=1000");
        const list = Array.isArray(res.data) ? res.data : (res.data.results || []);
        setTournaments(list);
        if (list.length > 0) {
          const preselected = list.find((t) => String(t.id) === initialTournamentId);
          handleSelectTournament(preselected || list[0]);
        } else {
          setActiveTab("role_requests");
        }
      } catch (err) {
        console.error("fetchTournaments error:", err);
        toast({
          title: "Помилка завантаження",
          description: "Не вдалося завантажити призначені турніри.",
          variant: "destructive",
        });
      } finally {
        setLoadingTournaments(false);
      }
    }
    fetchTournaments();
  }, []);

  // Fetch registrations and categories for selected tournament
  const fetchData = async (tournamentId: number) => {
    try {
      setLoadingData(true);
      setSelectedRegIds([]); // Clear selection when data changes
      const [regRes, catRes] = await Promise.all([
        api.get<Registration[] | { results: Registration[] }>(`/registrations/?tournament=${tournamentId}`),
        api.get<Category[] | { results: Category[] }>(`/categories/?tournament=${tournamentId}`),
      ]);

      const regs = Array.isArray(regRes.data) ? regRes.data : (regRes.data.results || []);
      const cats = Array.isArray(catRes.data) ? catRes.data : (catRes.data.results || []);

      console.log("StaffDashboard loaded categories:", cats);
      console.log("StaffDashboard loaded registrations:", regs);

      setRegistrations(regs);
      setCategories(cats);
    } catch (err) {
      console.error("StaffDashboard fetchData error:", err);
      toast({
        title: "Помилка завантаження",
        description: "Не вдалося завантажити деталі турніру.",
        variant: "destructive",
      });
    } finally {
      setLoadingData(false);
    }
  };

  // Fetch financial report for tournament
  const fetchFinanceReport = async (tournamentId: number) => {
    setIsLoadingFinance(true);
    try {
      const { data } = await api.get(`/tournaments/${tournamentId}/finance_report/`);
      setFinanceReport(data);
    } catch (err) {
      console.error("fetchFinanceReport error:", err);
      const error = err as { response?: { data?: { detail?: string } } };
      toast({
        title: "Помилка завантаження фінансів",
        description: error.response?.data?.detail || "Не вдалося завантажити фінансовий звіт.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingFinance(false);
    }
  };

  const fetchPayoutRequests = async (tournamentId: number) => {
    setIsLoadingPayouts(true);
    try {
      const { data } = await api.get(`/billing/payout-requests/?tournament=${tournamentId}&page_size=1000`);
      const list = Array.isArray(data) ? data : (data.results || []);
      setPayoutRequests(list);
    } catch (err) {
      console.error("fetchPayoutRequests error:", err);
    } finally {
      setIsLoadingPayouts(false);
    }
  };

  const fetchUnpaidTournaments = async (currentTournamentId: number) => {
    try {
      const { data } = await api.get("/tournaments/?staff_member=me&page_size=1000");
      const list = Array.isArray(data) ? data : (data.results || []);
      const unpaid = list.filter((t: Tournament) =>
        t.status === "completed" &&
        t.platform_fee_status === "unpaid" &&
        (t.platform_fee_amount ?? 0) > 0
      );
      setUnpaidTournaments(unpaid);

      // Auto-select current tournament if it is in the unpaid list
      if (unpaid.some((t: Tournament) => t.id === currentTournamentId)) {
        setSelectedUnpaidTournaments([currentTournamentId]);
      } else if (unpaid.length > 0) {
        setSelectedUnpaidTournaments([unpaid[0].id]);
      } else {
        setSelectedUnpaidTournaments([]);
      }
    } catch (err) {
      console.error("fetchUnpaidTournaments error:", err);
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTournament || !financeReport) return;
    const amountNum = parseInt(payoutAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast({
        title: "Некоректна сума",
        description: "Будь ласка, вкажіть суму більшу за нуль.",
        variant: "destructive",
      });
      return;
    }
    if (amountNum > financeReport.available_balance) {
      toast({
        title: "Недостатньо коштів",
        description: `Сума перевищує доступний баланс для виведення (${financeReport.available_balance} UAH).`,
        variant: "destructive",
      });
      return;
    }
    if (!payoutIBAN.trim()) {
      toast({
        title: "Некоректні реквізити",
        description: "Будь ласка, вкажіть IBAN отримувача.",
        variant: "destructive",
      });
      return;
    }
    if (!payoutRecipientName.trim()) {
      toast({
        title: "Некоректні реквізити",
        description: "Будь ласка, вкажіть ПІБ отримувача / назву організації.",
        variant: "destructive",
      });
      return;
    }
    if (!payoutRecipientCode.trim()) {
      toast({
        title: "Некоректні реквізити",
        description: "Будь ласка, вкажіть код ЄДРПОУ або ІПН отримувача.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmittingPayout(true);
    try {
      await api.post("/billing/payout-requests/", {
        tournament: selectedTournament.id,
        amount: amountNum,
        iban: payoutIBAN.trim(),
        recipient_name: payoutRecipientName.trim(),
        recipient_code: payoutRecipientCode.trim(),
        purpose: payoutPurpose.trim(),
      }, { skipGlobalToast: true });
      toast({
        title: "Запит створено",
        description: `Запит на виплату ${amountNum} UAH успішно надіслано адміністратору.`,
      });
      setPayoutAmount("");
      setPayoutIBAN("");
      setPayoutRecipientName("");
      setPayoutRecipientCode("");
      setPayoutPurpose("");
      fetchFinanceReport(selectedTournament.id);
      fetchPayoutRequests(selectedTournament.id);
    } catch (err) {
      console.error("handleRequestPayout error:", err);
      toast({
        title: "Помилка запиту виплати",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setIsSubmittingPayout(false);
    }
  };

  const handlePayBulkPlatformFee = async () => {
    if (selectedUnpaidTournaments.length === 0) return;
    setIsPayingBulkFee(true);
    try {
      const redirectUrl = `${window.location.origin}/staff/dashboard?tab=finance&tournamentId=${selectedTournament?.id}`;
      const { data } = await api.post("/billing/invoices/", {
        payment_type: "platform_fee",
        tournament_ids: selectedUnpaidTournaments,
        redirect_url: redirectUrl,
      }, { skipGlobalToast: true });

      toast({
        title: "Оплату ініційовано",
        description: "Перенаправлення на сторінку оплати Monobank Checkout...",
      });

      let paymentUrl = data.payment_url;
      if (paymentUrl && paymentUrl.includes("/billing/mock-pay")) {
        const urlObj = new URL(paymentUrl);
        paymentUrl = `/billing/mock-pay${urlObj.search}`;
      }
      window.location.href = paymentUrl;
    } catch (err) {
      console.error("handlePayBulkPlatformFee error:", err);
      toast({
        title: "Помилка ініціалізації оплати",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setIsPayingBulkFee(false);
    }
  };

  useEffect(() => {
    if (selectedTournament) {
      fetchData(selectedTournament.id);
    } else {
      setRegistrations([]);
      setCategories([]);
    }
  }, [selectedTournament]);

  useEffect(() => {
    if (selectedTournament && activeTab === "finance") {
      fetchFinanceReport(selectedTournament.id);
      fetchPayoutRequests(selectedTournament.id);
      fetchUnpaidTournaments(selectedTournament.id);
    }
  }, [selectedTournament, activeTab]);

  const fetchPendingRoleRequests = async () => {
    try {
      setLoadingRoleRequests(true);
      const res = await api.get<RoleRequest[] | { results: RoleRequest[] }>("/auth/role-requests/pending/");
      const list = Array.isArray(res.data) ? res.data : (res.data as { results?: RoleRequest[] }).results || [];
      setRoleRequests(list);
    } catch (err) {
      console.error("Error fetching role requests", err);
    } finally {
      setLoadingRoleRequests(false);
    }
  };

  const handleReviewRoleRequest = async (reqId: number, status: "approved" | "rejected") => {
    try {
      await api.post(`/auth/role-requests/${reqId}/review/`, {
        status,
        review_notes: reviewNotes,
      }, { skipGlobalToast: true });
      toast({
        title: status === "approved" ? "Запит схвалено" : "Запит відхилено",
        description: `Запит успішно ${status === "approved" ? "схвалено" : "відхилено"}.`,
      });
      setReviewDialogReq(null);
      setReviewNotes("");
      fetchPendingRoleRequests();
    } catch (err) {
      console.error("Error reviewing role request", err);
      toast({
        variant: "destructive",
        title: "Помилка перевірки запиту",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
      });
    }
  };

  useEffect(() => {
    fetchPendingRoleRequests();
  }, []);

  const renderAdminLimitsTab = () => {
    return (
      <div className="space-y-6">
        {/* Admin Debts View */}
        <Card className="border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
            🚨 Заборгованості за завершені змагання
          </h3>

          {isLoadingAdminDebts ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : adminDebts.length === 0 ? (
            <p className="text-slate-500 text-sm">Немає неврегульованих заборгованостей по завершених змаганнях.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <Table>
                <TableHeader className="bg-slate-900 border-slate-800">
                  <TableRow className="border-slate-800 text-slate-350 text-xs">
                    <TableHead>Турнір</TableHead>
                    <TableHead>Організатор</TableHead>
                    <TableHead>Дата завершення</TableHead>
                    <TableHead className="text-right">Сума боргу</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-slate-300 text-sm">
                  {adminDebts.map((debt) => (
                    <TableRow key={debt.tournament_id} className="border-slate-800 hover:bg-slate-950/20">
                      <TableCell className="font-semibold text-white">
                        {debt.title}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-200">{debt.organizer_name}</p>
                        <p className="text-xs text-slate-500 font-mono">{debt.organizer_email}</p>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {new Date(debt.completed_at).toLocaleDateString("uk-UA")}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-rose-500">
                        {debt.amount} UAH
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Organizer Limits View */}
        <Card className="border-slate-800 bg-slate-900/40 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              🛡️ Кредитні ліміти організаторів
            </h3>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-500" />
              <Input
                placeholder="Пошук організатора..."
                className="pl-10 border-slate-800 bg-slate-950 text-slate-200 placeholder-slate-550 h-9 text-xs"
                value={adminOrganizersSearch}
                onChange={(e) => setAdminOrganizersSearch(e.target.value)}
              />
            </div>
          </div>

          {isLoadingAdminOrganizers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : adminOrganizers.length === 0 ? (
            <p className="text-slate-500 text-sm">Організаторів не знайдено.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <Table>
                <TableHeader className="bg-slate-900 border-slate-800">
                  <TableRow className="border-slate-800 text-slate-350 text-xs">
                    <TableHead>Організатор</TableHead>
                    <TableHead className="text-center">Кредитний ліміт</TableHead>
                    <TableHead className="text-right">Дії</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-slate-300 text-sm">
                  {adminOrganizers.map((org) => (
                    <TableRow key={org.id} className="border-slate-800 hover:bg-slate-950/20">
                      <TableCell>
                        <p className="font-semibold text-white">{org.last_name} {org.first_name}</p>
                        <p className="text-xs text-slate-500 font-mono">{org.email}</p>
                      </TableCell>
                      <TableCell className="text-center font-mono font-bold text-indigo-400">
                        {org.credit_limit ?? 0} UAH
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-slate-800 text-xs text-slate-300 hover:bg-slate-800"
                          onClick={() => {
                            setEditingOrganizerLimit(org);
                            setNewLimitValue(String(org.credit_limit ?? 0));
                          }}
                        >
                          Змінити ліміт
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Dialog to edit credit limit */}
        <Dialog open={editingOrganizerLimit !== null} onOpenChange={(open) => !open && setEditingOrganizerLimit(null)}>
          <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Зміна кредитного ліміту</DialogTitle>
              <DialogDescription className="text-slate-400">
                Встановіть новий кредитний ліміт для організатора{" "}
                <strong>
                  {editingOrganizerLimit?.last_name} {editingOrganizerLimit?.first_name}
                </strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3">
              <div className="space-y-2">
                <label htmlFor="limit-input" className="text-sm font-medium text-slate-300">
                  Кредитний ліміт (UAH):
                </label>
                <Input
                  id="limit-input"
                  type="number"
                  value={newLimitValue}
                  onChange={(e) => setNewLimitValue(e.target.value)}
                  className="border-slate-800 bg-slate-950 text-slate-100 placeholder-slate-600"
                  placeholder="Введіть ліміт..."
                />
                <p className="text-xs text-slate-500">
                  * Організатор буде заблокований від створення або активації нових турнірів, якщо його загальний завершений борг перевищить цей ліміт.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="border-slate-800 hover:bg-slate-800 bg-slate-950 text-slate-300"
                onClick={() => setEditingOrganizerLimit(null)}
              >
                Скасувати
              </Button>
              <Button
                onClick={handleUpdateOrganizerLimit}
                disabled={isSavingLimit}
                className="bg-indigo-600 hover:bg-indigo-750 text-white font-semibold"
              >
                {isSavingLimit ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Зберегти ліміт
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const renderRoleRequestsCard = () => {
    return (
      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg font-bold">Очікуючі заявки на верифікацію</CardTitle>
            <CardDescription>Розгляньте та підтвердіть або відхиліть ролі користувачів.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPendingRoleRequests}
            disabled={loadingRoleRequests}
            className="border-slate-800 hover:bg-slate-800 text-slate-300"
          >
            {loadingRoleRequests ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </CardHeader>
        <CardContent>
          {loadingRoleRequests ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : roleRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              Немає очікуючих заявок на верифікацію ролей.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <Table>
                <TableHeader className="bg-slate-900 border-slate-800">
                  <TableRow className="border-slate-800 text-slate-300">
                    <TableHead className="w-[180px]">Користувач</TableHead>
                    <TableHead className="w-[150px]">Бажана роль</TableHead>
                    <TableHead>Деталі</TableHead>
                    <TableHead className="w-[150px]">Дата подачі</TableHead>
                    <TableHead className="w-[180px] text-right">Дії</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-slate-300">
                  {roleRequests.map((req) => (
                    <TableRow key={req.id} className="border-slate-800 hover:bg-slate-950/20">
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-400">
                            {req.user?.photo ? (
                              <img src={req.user.photo} alt="Avatar" className="w-full h-full object-cover rounded-full" />
                            ) : (
                              req.user?.first_name?.[0]?.toUpperCase() || "?"
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white">
                              {req.user?.last_name} {req.user?.first_name}
                            </p>
                            <p className="text-xs text-slate-400 font-mono">{req.user?.email}</p>
                            {req.user?.phone && (
                              <p className="text-[11px] text-slate-500 font-sans mt-0.5">
                                Тел: {req.user.phone}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {req.requested_role === "coach" && (
                          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15">Тренер</Badge>
                        )}
                        {req.requested_role === "judge" && (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15">Суддя</Badge>
                        )}
                        {req.requested_role === "organizer" && (
                          <Badge className="bg-purple-500/15 text-purple-400 border border-purple-500/20 hover:bg-purple-500/15">Організатор</Badge>
                        )}
                        {req.requested_role === "spectator" && (
                          <Badge className="bg-slate-500/15 text-slate-400 border border-slate-500/20 hover:bg-slate-500/15">Глядач</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        {req.requested_role === "coach" && req.club && (
                          <div className="mb-1 text-xs">
                            <span className="text-slate-500 font-medium">Клуб:</span>{" "}
                            <span className="text-amber-400 font-bold">{req.club.name}{req.club.region ? ` (${req.club.region})` : ""}</span>
                          </div>
                        )}
                        {req.requested_role === "judge" && req.referee_category && (
                          <div className="mb-1 text-xs">
                            <span className="text-slate-500 font-medium">Суддівська категорія:</span>{" "}
                            <span className="text-emerald-400 font-bold">{req.referee_category}</span>
                          </div>
                        )}
                        {req.details && (
                          <div className="text-xs text-slate-400 italic mt-0.5 line-clamp-2" title={req.details}>
                            &ldquo;{req.details}&rdquo;
                          </div>
                        )}
                        {req.document && (
                          <div className="mt-1.5">
                            <a
                              href={req.document}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline font-semibold"
                            >
                              📎 Дивитись документ
                            </a>
                          </div>
                        )}
                        {req.photo_with_id && (
                          <div className="mt-1.5">
                            <a
                              href={req.photo_with_id}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline font-semibold"
                            >
                              📸 Фото з посвідченням
                            </a>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {new Date(req.created_at).toLocaleDateString("uk-UA", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs font-semibold"
                            onClick={() => {
                              setReviewStatus("rejected");
                              setReviewDialogReq(req);
                              setReviewNotes("");
                            }}
                          >
                            Відхилити
                          </Button>
                          <Button
                            size="sm"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                            onClick={() => {
                              setReviewStatus("approved");
                              setReviewDialogReq(req);
                              setReviewNotes("");
                            }}
                          >
                            Схвалити
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Connect to WebSocket for real-time registration sync
  useTournamentSocket(
    selectedTournament?.id || 0,
    (updatedReg) => {
      console.log("WS registration update received:", updatedReg);
      // Live update the updated registration
      setRegistrations((prev) => {
        const index = prev.findIndex((r) => r.id === updatedReg.id);
        if (index === -1) {
          return [updatedReg, ...prev];
        } else {
          const next = [...prev];
          next[index] = updatedReg;
          return next;
        }
      });
    },
    {
      onConnect: () => setIsConnected(true),
      onDisconnect: () => setIsConnected(false),
    }
  );

  // Toggle check-in
  const handleCheckInToggle = async (reg: Registration) => {
    try {
      const res = await api.post<Registration>(`/registrations/${reg.id}/check_in/`, {}, { skipGlobalToast: true });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === reg.id ? res.data : r))
      );
    } catch (err) {
      console.error("Failed to toggle check-in:", err);
      toast({
        title: "Помилка відмітки прибуття",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    }
  };

  // Open weigh-in dialog
  const openWeighIn = (reg: Registration) => {
    setWeighInReg(reg);
    setWeighInValue(reg.recorded_weight ? reg.recorded_weight.toString() : "");
  };

  // Submit weigh-in weight
  const handleWeighInSubmit = async () => {
    if (!weighInReg) return;
    let weightVal = 0;
    if (!weighInReg.team) {
      weightVal = Number.parseFloat(weighInValue);
      if (Number.isNaN(weightVal) || weightVal <= 0) {
        toast({
          title: "Некоректна вага",
          description: "Будь ласка, введіть дійсне число більше нуля.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setSubmittingWeighIn(true);
      const res = await api.post<Registration>(`/registrations/${weighInReg.id}/confirm_weigh_in/`, {
        weight: weightVal,
      }, { skipGlobalToast: true });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === weighInReg.id ? res.data : r))
      );
      toast({
        title: "Зважування підтверджено",
        description: `${
          weighInReg.team
            ? `Команда: ${weighInReg.team.name}`
            : `Спортсмен: ${weighInReg.athlete?.full_name || weighInReg.athlete?.last_name}`
        }, вага: ${weightVal}.`,
      });
      setWeighInReg(null);
    } catch (err) {
      console.error("Failed to submit weigh-in:", err);
      toast({
        title: "Помилка зважування",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setSubmittingWeighIn(false);
    }
  };

  // Toggle check-in for grouped athlete
  const handleAthleteCheckInToggle = async (group: WeighInGroup) => {
    const newCheckedIn = !group.checkedIn;
    const registrationIds = group.registrations.map((r: Registration) => r.id);
    try {
      await api.post("/registrations/bulk_update_secretary/", {
        registration_ids: registrationIds,
        checked_in: newCheckedIn,
      }, { skipGlobalToast: true });
      setRegistrations((prev) =>
        prev.map((r) =>
          registrationIds.includes(r.id) ? { ...r, checked_in: newCheckedIn } : r
        )
      );
      toast({
        title: "Статус прибуття оновлено",
        description: `Спортсмен: ${group.name}, статус: ${newCheckedIn ? "Прибув" : "Немає"}.`,
      });
    } catch (err) {
      console.error("Failed to toggle athlete check-in:", err);
      toast({
        title: "Помилка відмітки прибуття",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    }
  };

  // Open athlete weigh-in dialog
  const openAthleteWeighIn = (group: WeighInGroup) => {
    setWeighInGroup(group);
    setWeighInValue(group.recordedWeight ? group.recordedWeight.toString() : "");
  };

  // Submit athlete weigh-in
  const handleAthleteWeighInSubmit = async () => {
    if (!weighInGroup || !selectedTournament) return;
    let weightVal = 0;
    if (weighInGroup.type === "athlete") {
      weightVal = Number.parseFloat(weighInValue);
      if (Number.isNaN(weightVal) || weightVal <= 0) {
        toast({
          title: "Некоректна вага",
          description: "Будь ласка, введіть дійсне число більше нуля.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setSubmittingWeighIn(true);
      await api.post(`/registrations/athlete_weigh_in/`, {
        athlete_id: weighInGroup.athleteId,
        team_id: weighInGroup.teamId,
        tournament_id: selectedTournament.id,
        weight: weightVal,
      }, { skipGlobalToast: true });

      // Update local state
      setRegistrations((prev) =>
        prev.map((r) => {
          const matches =
            weighInGroup.type === "athlete"
              ? r.athlete?.id === weighInGroup.athleteId
              : r.team?.id === weighInGroup.teamId;
          if (matches && r.tournament_id === selectedTournament.id) {
            return { ...r, recorded_weight: weightVal, status: "confirmed", status_display: "Підтверджено" };
          }
          return r;
        })
      );

      toast({
        title: "Зважування підтверджено",
        description: `Спортсмен: ${weighInGroup.name}, вага: ${weightVal} кг для всіх категорій.`,
      });
      setWeighInGroup(null);
    } catch (err) {
      console.error("Failed to submit weigh-in:", err);
      toast({
        title: "Помилка зважування",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setSubmittingWeighIn(false);
    }
  };

  // Quick status update (PATCH registrations)
  const handleStatusChange = async (regId: number, newStatus: string) => {
    try {
      const res = await api.patch<Registration>(`/registrations/${regId}/`, { status: newStatus }, { skipGlobalToast: true });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === regId ? res.data : r))
      );
      toast({
        title: "Статус оновлено",
        description: "Статус реєстрації було успішно змінено.",
      });
    } catch (err) {
      console.error("Failed to change registration status:", err);
      toast({
        title: "Помилка зміни статусу",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    }
  };

  // Quick payment status update
  const handlePaymentStatusChange = async (regId: number, newPaymentStatus: string) => {
    try {
      const res = await api.patch<Registration>(`/registrations/${regId}/`, {
        payment_status: newPaymentStatus,
        payment_method: "offline",
      }, { skipGlobalToast: true });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === regId ? res.data : r))
      );
      toast({
        title: "Оплату оновлено",
        description: "Статус оплати було успішно змінено.",
      });
    } catch (err) {
      console.error("Failed to change payment status:", err);
      toast({
        title: "Помилка оновлення оплати",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    }
  };

  // Secretary bulk update handler
  const handleBulkUpdateSecretary = async (params: {
    checked_in?: boolean;
    status?: "confirmed" | "withdrawn";
    payment_status?: "paid" | "unpaid";
  }) => {
    if (selectedRegIds.length === 0) return;
    setIsBulkUpdating(true);
    try {
      const { data } = await api.post("/registrations/bulk_update_secretary/", {
        registration_ids: selectedRegIds,
        ...params,
      }, { skipGlobalToast: true });
      toast({
        title: "Групове оновлення успішне",
        description: data.detail || `Оновлено ${selectedRegIds.length} заявок.`,
      });
      setSelectedRegIds([]);
      if (selectedTournament) {
        fetchData(selectedTournament.id);
        if (activeTab === "finance") {
          fetchFinanceReport(selectedTournament.id);
        }
      }
    } catch (err) {
      console.error("handleBulkUpdateSecretary error:", err);
      toast({
        title: "Помилка групового оновлення",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const [isBulkRefunding, setIsBulkRefunding] = useState(false);

  const handleRowMarkOfflineRefunded = async (regId: number) => {
    try {
      const { data } = await api.post("/registrations/bulk_mark_offline_refunded/", {
        registration_ids: [regId],
      }, { skipGlobalToast: true });
      toast({
        title: "Повернення зафіксовано",
        description: data.detail || "Позначено як повернуто (очікує підтвердження від тренера).",
      });
      if (selectedTournament) {
        fetchData(selectedTournament.id);
      }
    } catch (err) {
      console.error("Failed to mark offline refunded:", err);
      toast({
        title: "Помилка відмітки повернення",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    }
  };

  const handleBulkMarkOfflineRefunded = async () => {
    if (selectedRegIds.length === 0) return;
    setIsBulkRefunding(true);
    try {
      const { data } = await api.post("/registrations/bulk_mark_offline_refunded/", {
        registration_ids: selectedRegIds,
      }, { skipGlobalToast: true });
      toast({
        title: "Повернення зафіксовано",
        description: data.detail || `Позначено як повернуті ${selectedRegIds.length} заявок (очікує підтвердження від тренера).`,
      });
      setSelectedRegIds([]);
      if (selectedTournament) {
        fetchData(selectedTournament.id);
      }
    } catch (err) {
      console.error("handleBulkMarkOfflineRefunded error:", err);
      toast({
        title: "Помилка відмітки повернення",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setIsBulkRefunding(false);
    }
  };

  // Pay platform fee online handler
  const handlePayPlatformFee = async () => {
    if (!selectedTournament) return;
    setIsPayingPlatformFee(true);
    try {
      const redirectUrl = `${window.location.origin}/staff/dashboard?tab=finance&tournamentId=${selectedTournament.id}`;
      const { data } = await api.post("/billing/invoices/", {
        payment_type: "platform_fee",
        tournament_id: selectedTournament.id,
        redirect_url: redirectUrl,
      }, { skipGlobalToast: true });

      toast({
        title: "Оплату ініційовано",
        description: "Перенаправлення на сторінку оплати Monobank Checkout...",
      });

      let paymentUrl = data.payment_url;
      if (paymentUrl && paymentUrl.includes("/billing/mock-pay")) {
        const urlObj = new URL(paymentUrl);
        paymentUrl = `/billing/mock-pay${urlObj.search}`;
      }
      window.location.href = paymentUrl;
    } catch (err) {
      console.error("handlePayPlatformFee error:", err);
      toast({
        title: "Помилка ініціалізації оплати",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setIsPayingPlatformFee(false);
    }
  };

  // Fetch organizers for admin limits tab
  const fetchAdminOrganizers = async (search = "") => {
    setIsLoadingAdminOrganizers(true);
    try {
      const { data } = await api.get(`/users/?role=organizer&search=${search}`);
      const list = Array.isArray(data) ? data : data.results || [];
      setAdminOrganizers(list);
    } catch (err) {
      console.error("fetchAdminOrganizers error:", err);
    } finally {
      setIsLoadingAdminOrganizers(false);
    }
  };

  // Fetch completed unpaid tournament platform debts
  const fetchAdminDebts = async () => {
    setIsLoadingAdminDebts(true);
    try {
      const { data } = await api.get("/tournaments/admin_platform_debts/");
      setAdminDebts(data);
    } catch (err) {
      console.error("fetchAdminDebts error:", err);
    } finally {
      setIsLoadingAdminDebts(false);
    }
  };

  // Update organizer credit limit handler
  const handleUpdateOrganizerLimit = async () => {
    if (!editingOrganizerLimit) return;
    setIsSavingLimit(true);
    try {
      await api.post(`/users/${editingOrganizerLimit.id}/update_credit_limit/`, {
        credit_limit: Number(newLimitValue),
      }, { skipGlobalToast: true });
      toast({
        title: "Ліміт оновлено",
        description: `Кредитний ліміт для ${editingOrganizerLimit.first_name} ${editingOrganizerLimit.last_name} успішно встановлено.`,
      });
      setEditingOrganizerLimit(null);
      fetchAdminOrganizers(adminOrganizersSearch);
    } catch (err) {
      console.error("handleUpdateOrganizerLimit error:", err);
      toast({
        title: "Помилка оновлення ліміту",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive",
      });
    } finally {
      setIsSavingLimit(false);
    }
  };

  // Trigger admin data fetching when tab is "limits"
  useEffect(() => {
    if (activeTab === "limits" && user?.role === "admin") {
      fetchAdminOrganizers(adminOrganizersSearch);
      fetchAdminDebts();
    }
  }, [activeTab, adminOrganizersSearch, user]);

  // Filtered registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      const athleteName = reg.athlete
        ? `${reg.athlete.first_name} ${reg.athlete.last_name}`.toLowerCase()
        : reg.team?.name.toLowerCase() || "";
      const clubName = reg.athlete?.club?.name.toLowerCase() || reg.team?.club?.name.toLowerCase() || "";
      const matchesSearch =
        athleteName.includes(searchQuery.toLowerCase()) ||
        clubName.includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategoryFilter === "all" || reg.category?.toString() === selectedCategoryFilter;

      const matchesPayment =
        paymentFilter === "all" || reg.payment_status === paymentFilter;

      const matchesStatus =
        statusFilter === "all" || reg.status === statusFilter;

      return matchesSearch && matchesCategory && matchesPayment && matchesStatus;
    });
  }, [registrations, searchQuery, selectedCategoryFilter, paymentFilter, statusFilter]);

  // Grouped athletes for athlete-centric view
  const groupedAthletes = useMemo(() => {
    const groups: WeighInGroup[] = [];
    filteredRegistrations.forEach((reg) => {
      if (reg.athlete) {
        const key = `athlete-${reg.athlete.id}`;
        let existing = groups.find((g) => g.id === key);
        if (!existing) {
          existing = {
            id: key,
            type: "athlete",
            athleteId: reg.athlete.id,
            name: `${reg.athlete.last_name} ${reg.athlete.first_name}`,
            club: formatRegistrationClub(reg) || "Особисто",
            coach: reg.coach_name_short || "—",
            gender: reg.athlete.gender,
            age: reg.athlete.birth_date ? new Date().getFullYear() - new Date(reg.athlete.birth_date).getFullYear() : 0,
            baseWeight: reg.athlete.base_weight,
            registrations: [],
            checkedIn: false,
            recordedWeight: null,
          };
          groups.push(existing);
        }
        existing.registrations.push(reg);
      } else if (reg.team) {
        const key = `team-${reg.team.id}`;
        let existing = groups.find((g) => g.id === key);
        if (!existing) {
          existing = {
            id: key,
            type: "team",
            teamId: reg.team.id,
            name: `${reg.team.name} (Команда)`,
            club: formatRegistrationClub(reg) || "Особисто",
            coach: reg.coach_name_short || "—",
            registrations: [],
            checkedIn: false,
            recordedWeight: null,
          };
          groups.push(existing);
        }
        existing.registrations.push(reg);
      }
    });

    // Calculate collective status
    groups.forEach((g) => {
      g.checkedIn = g.registrations.some((r: Registration) => r.checked_in);
      const withWeight = g.registrations.find((r: Registration) => r.recorded_weight !== null && r.recorded_weight !== undefined);
      if (withWeight) {
        g.recordedWeight = withWeight.recorded_weight;
      }
    });

    return groups;
  }, [filteredRegistrations]);

  const renderRegistrationsTableBody = () => {
    if (!selectedTournament) return null;
    const colSpanCount = selectedTournament.use_check_in ? 10 : 9;
    if (loadingData) {
      return (
        <TableRow>
          <TableCell colSpan={colSpanCount} className="h-40 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
            <p className="mt-2 text-sm text-slate-400">Завантаження реєстрацій...</p>
          </TableCell>
        </TableRow>
      );
    }
    if (filteredRegistrations.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={colSpanCount} className="h-32 text-center text-slate-500">
            Не знайдено реєстрацій за вказаними фільтрами.
          </TableCell>
        </TableRow>
      );
    }
    return filteredRegistrations.map((reg) => {
      const athlete = reg.athlete;
      return (
        <TableRow key={reg.id} className="hover:bg-slate-900/40 border-b border-slate-800/80 transition-colors">
          <TableCell className="w-[40px] text-center">
            <input
              type="checkbox"
              className="rounded border-slate-800 bg-slate-950 text-indigo-650 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
              checked={selectedRegIds.includes(reg.id)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedRegIds((prev) => [...prev, reg.id]);
                } else {
                  setSelectedRegIds((prev) => prev.filter((id) => id !== reg.id));
                }
              }}
            />
          </TableCell>
          <TableCell className="font-medium">
            <div>
              {athlete ? (
                <>
                  <p className="text-sm text-slate-200 flex items-center gap-1.5 flex-wrap">
                    {athlete.last_name} {athlete.first_name}
                    {reg.checked_in && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Прибув(ла)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {athlete.gender === "male" ? "Чоловік" : "Жінка"},{" "}
                    {new Date().getFullYear() - new Date(athlete.birth_date).getFullYear()} років,{" "}
                    Вага: {athlete.base_weight} кг
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-200 font-semibold flex items-center gap-1.5 flex-wrap">
                  {formatRegistrationName(reg)} (Команда)
                  {reg.checked_in && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Прибули
                    </span>
                  )}
                </p>
              )}
            </div>
          </TableCell>
          <TableCell className="text-sm text-slate-300">
            {formatRegistrationClub(reg) || "Особисто"}
          </TableCell>
          <TableCell className="text-sm text-slate-300">
            {reg.coach_name_short || "—"}
          </TableCell>
          <TableCell className="text-xs text-slate-400 max-w-[180px] truncate">
            {reg.category_name}
          </TableCell>
          {selectedTournament.weigh_in_required && (
            <TableCell>
              {reg.recorded_weight ? (
                <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {reg.recorded_weight} кг
                </Badge>
              ) : (
                <span className="text-xs text-slate-500">—</span>
              )}
            </TableCell>
          )}
          <TableCell className="text-center">
            {reg.payment_method === "online" && reg.payment_status === "paid" ? (
              <Badge className="bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-semibold py-0.5 px-2 rounded-xl mx-auto flex items-center justify-center gap-1 w-[90px]">
                🔒 Онлайн
              </Badge>
            ) : reg.status === "withdrawn" && reg.payment_method === "offline" ? (
              <div className="flex flex-col items-center gap-1">
                {reg.offline_refund_status === "none" ? (
                  <Button
                    size="sm"
                    className="h-7 text-[10px] bg-amber-600 hover:bg-amber-700 text-white font-medium rounded px-2"
                    onClick={() => handleRowMarkOfflineRefunded(reg.id)}
                  >
                    Повернути готівку
                  </Button>
                ) : reg.offline_refund_status === "pending" ? (
                  <Badge className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 text-[9px] py-0.5 px-1.5">
                    Очікує тренера
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[9px] py-0.5 px-1.5">
                    Повернено
                  </Badge>
                )}
              </div>
            ) : (
              <Select
                value={reg.payment_status}
                onValueChange={(val) => handlePaymentStatusChange(reg.id, val)}
              >
                <SelectTrigger className="h-7 w-[100px] mx-auto text-xs border-slate-800 bg-slate-950 text-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                  <SelectItem value="paid">Сплачено</SelectItem>
                  <SelectItem value="unpaid">Борг</SelectItem>
                </SelectContent>
              </Select>
            )}
          </TableCell>
          <TableCell className="text-center">
            <Badge className={getStatusBadgeClass(reg.status)}>
              {reg.status_display}
            </Badge>
          </TableCell>

          {selectedTournament.use_check_in && (
            <TableCell className="text-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCheckInToggle(reg)}
                className={`h-7 px-2.5 text-xs rounded transition-all ${
                  reg.checked_in
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                    : "bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800"
                }`}
              >
                {reg.checked_in ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Прибув
                  </>
                ) : (
                  "Немає"
                )}
              </Button>
            </TableCell>
          )}

          <TableCell className="text-right">
            <div className="flex justify-end gap-1.5">
              {/* Confirm Weigh-in Button */}
              {selectedTournament.weigh_in_required && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/10"
                  onClick={() => openWeighIn(reg)}
                >
                  {reg.team ? "Допуск" : "Зважити"}
                </Button>
              )}

              {/* Quick Status Select */}
              <Select
                value={reg.status}
                onValueChange={(val) => handleStatusChange(reg.id, val)}
              >
                <SelectTrigger className="h-7 w-[120px] text-xs border-slate-800 bg-slate-950 text-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                  <SelectItem value="pending">Очікує</SelectItem>
                  <SelectItem value="confirmed">Підтверджено</SelectItem>
                  <SelectItem value="withdrawn">Знято</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TableCell>
        </TableRow>
      );
    });
  };

  const renderAthleteCentricTableBody = () => {
    if (!selectedTournament) return null;
    const colSpanCount = 4 + (selectedTournament.use_check_in ? 1 : 0) + (selectedTournament.weigh_in_required ? 1 : 0) + 1;
    if (loadingData) {
      return (
        <TableRow>
          <TableCell colSpan={colSpanCount} className="h-40 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
            <p className="mt-2 text-sm text-slate-400">Завантаження реєстрацій...</p>
          </TableCell>
        </TableRow>
      );
    }
    if (groupedAthletes.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={colSpanCount} className="h-32 text-center text-slate-500">
            Не знайдено спортсменів за вказаними фільтрами.
          </TableCell>
        </TableRow>
      );
    }

    return groupedAthletes.map((group) => {
      return (
        <TableRow key={group.id} className="hover:bg-slate-900/40 border-b border-slate-800/80 transition-colors">
          <TableCell className="w-[40px] text-center">
            <input
              type="checkbox"
              className="rounded border-slate-800 bg-slate-950 text-indigo-650 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
              checked={
                group.registrations.length > 0 &&
                group.registrations.every((r) => selectedRegIds.includes(r.id))
              }
              onChange={(e) => {
                const regIds = group.registrations.map((r) => r.id);
                if (e.target.checked) {
                  setSelectedRegIds((prev) => {
                    const next = [...prev];
                    regIds.forEach((id) => {
                      if (!next.includes(id)) {
                        next.push(id);
                      }
                    });
                    return next;
                  });
                } else {
                  setSelectedRegIds((prev) => prev.filter((id) => !regIds.includes(id)));
                }
              }}
            />
          </TableCell>
          {/* Athlete Info */}
          <TableCell className="font-medium py-4">
            <div>
              <p className="text-sm font-semibold text-slate-200">
                {group.name}
              </p>
              {group.type === "athlete" ? (
                <p className="text-xs text-slate-400 mt-0.5">
                  {group.gender === "male" ? "Чоловік" : "Жінка"},{" "}
                  {group.age} років,{" "}
                  Базова вага: {group.baseWeight} кг
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-0.5">Команда</p>
              )}
            </div>
          </TableCell>

          {/* Club */}
          <TableCell className="text-sm text-slate-300">
            {group.club}
          </TableCell>

          {/* Coach */}
          <TableCell className="text-sm text-slate-300">
            {group.coach}
          </TableCell>

          {/* Categories list */}
          <TableCell className="max-w-[300px]">
            <div className="flex flex-wrap gap-2">
              {group.registrations.map((reg: Registration) => (
                <div key={reg.id} className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-850 text-[11px]">
                  <span className="text-slate-300 font-medium max-w-[100px] truncate" title={reg.category_name}>
                    {reg.category_name}
                  </span>

                  {/* Payment tag */}
                  {reg.payment_method === "online" && reg.payment_status === "paid" ? (
                    <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1 py-0.2 rounded border border-indigo-500/20">
                      🔒 Онлайн
                    </span>
                  ) : reg.status === "withdrawn" && reg.payment_method === "offline" ? (
                    reg.offline_refund_status === "none" ? (
                      <button
                        type="button"
                        className="text-[9px] bg-amber-600/80 hover:bg-amber-600 text-white px-1 py-0.2 rounded border border-amber-500/20"
                        onClick={() => handleRowMarkOfflineRefunded(reg.id)}
                      >
                        Повернути готівку
                      </button>
                    ) : reg.offline_refund_status === "pending" ? (
                      <span className="text-[9px] bg-yellow-500/10 text-yellow-400 px-1 py-0.2 rounded border border-yellow-500/20">
                        Очікує тренера
                      </span>
                    ) : (
                      <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.2 rounded border border-emerald-500/20">
                        Повернено
                      </span>
                    )
                  ) : reg.payment_status === "paid" ? (
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.2 rounded border border-emerald-500/20">
                      Готівка
                    </span>
                  ) : (
                    <span className="text-[9px] bg-rose-500/10 text-rose-400 px-1 py-0.2 rounded border border-rose-500/20">
                      Борг
                    </span>
                  )}

                  {/* Status tag */}
                  <span className={`text-[9px] px-1 py-0.2 rounded border ${
                    reg.status === "confirmed"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : reg.status === "withdrawn"
                        ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }`}>
                    {reg.status_display}
                  </span>
                </div>
              ))}
            </div>
          </TableCell>

          {/* Check-in action */}
          {selectedTournament.use_check_in && (
            <TableCell className="text-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAthleteCheckInToggle(group)}
                className={`h-7 px-2.5 text-xs rounded transition-all ${
                  group.checkedIn
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                    : "bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800"
                }`}
              >
                {group.checkedIn ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Прибув
                  </>
                ) : (
                  "Немає"
                )}
              </Button>
            </TableCell>
          )}

          {/* Weigh-in action */}
          {selectedTournament.weigh_in_required && (
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                {group.recordedWeight ? (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 h-7 text-xs font-mono">
                    {group.recordedWeight} кг
                  </Badge>
                ) : (
                  <span className="text-xs text-slate-500 mr-1">—</span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/10"
                  onClick={() => openAthleteWeighIn(group)}
                >
                  Зважити
                </Button>
              </div>
            </TableCell>
          )}
        </TableRow>
      );
    });
  };

  if (loadingTournaments) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-500" />
          <p className="mt-4 text-slate-400">Завантаження призначених турнірів...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 shadow-xl">
          <div className="absolute right-0 top-0 h-40 w-40 bg-indigo-500/10 blur-3xl" />
          <div className="absolute left-1/3 bottom-0 h-28 w-28 bg-emerald-500/5 blur-3xl" />

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/5 px-2.5 py-0.5">
                  Панель секретаря
                </Badge>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
                  <span className="text-xs text-slate-400">
                    {isConnected ? "WS підключено" : "WS офлайн"}
                  </span>
                </div>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                Управління явкою та зважуванням
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Відмічайте присутність атлетів на місці та затверджуйте їхню вагу перед сіткою.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400 whitespace-nowrap">Оберіть турнір:</span>
              <SearchableSelect
                options={tournaments.map((t) => ({
                  value: t.id.toString(),
                  label: t.title,
                }))}
                value={selectedTournament?.id.toString() || ""}
                onValueChange={(val) => {
                  const found = tournaments.find((t) => t.id.toString() === val);
                  if (found) handleSelectTournament(found);
                }}
                placeholder="Оберіть турнір..."
                searchPlaceholder="Пошук турніру..."
                className="w-[280px]"
              />
            </div>
          </div>
        </div>

        {selectedTournament ? (
          <div className="grid grid-cols-1 gap-6">
            {/* Tournament short stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Дата проведення</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {new Date(selectedTournament.start_date).toLocaleDateString("uk-UA")}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Місце</p>
                    <p className="text-sm font-semibold mt-0.5 truncate max-w-[200px]">
                      {selectedTournament.location}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400">
                    <Award className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Всього заявок</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {registrations.length} ({registrations.filter(r => r.checked_in).length} з'явились)
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="w-full space-y-4">
              <TabsList className="bg-slate-900 border border-slate-800 p-1">
                <TabsTrigger value="registrations" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Реєстрації ({filteredRegistrations.length})
                </TabsTrigger>
                <TabsTrigger value="categories" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Категорії змагань ({categories.length})
                </TabsTrigger>
                <TabsTrigger value="finance" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Фінанси
                </TabsTrigger>
                {user?.role === "admin" && (
                  <TabsTrigger value="role_requests" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                    Заявки на ролі ({roleRequests.length})
                  </TabsTrigger>
                )}
                {user?.role === "admin" && (
                  <TabsTrigger value="limits" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                    Кредитні ліміти
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="registrations" className="space-y-4 outline-none">
                {/* Search & Filters */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                  <div className="relative w-full md:w-80">
                    <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-500" />
                    <Input
                      placeholder="Пошук атлета чи клубу..."
                      className="pl-10 border-slate-800 bg-slate-950 text-slate-200 placeholder-slate-500"
                      value={searchQuery}
                      onChange={(e) => handleSearchQueryChange(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 w-full md:w-auto">
                    {/* Category Filter */}
                    <SearchableSelect
                      options={[
                        { value: "all", label: "Всі категорії" },
                        ...categories.map((cat) => ({ value: cat.id.toString(), label: cat.name }))
                      ]}
                      value={selectedCategoryFilter}
                      onValueChange={handleCategoryFilterChange}
                      placeholder="Категорія"
                      searchPlaceholder="Пошук категорії..."
                      className="w-[180px]"
                    />

                    {/* Status Filter */}
                    <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                      <SelectTrigger className="w-[140px] border-slate-800 bg-slate-950 text-slate-200">
                        <SelectValue placeholder="Статус" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                        <SelectItem value="all">Всі статуси</SelectItem>
                        <SelectItem value="pending">Очікує</SelectItem>
                        <SelectItem value="confirmed">Підтверджено</SelectItem>
                        <SelectItem value="withdrawn">Знято</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Payment Filter */}
                    <Select value={paymentFilter} onValueChange={handlePaymentFilterChange}>
                      <SelectTrigger className="w-[140px] border-slate-800 bg-slate-950 text-slate-200">
                        <SelectValue placeholder="Оплата" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                        <SelectItem value="all">Вся оплата</SelectItem>
                        <SelectItem value="paid">Оплачено</SelectItem>
                        <SelectItem value="unpaid">Неоплачено</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      size="icon"
                      className="border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white"
                      onClick={() => fetchData(selectedTournament.id)}
                      disabled={loadingData}
                    >
                      <RefreshCw className={`h-4.5 w-4.5 ${loadingData ? "animate-spin text-cyan-400" : ""}`} />
                    </Button>

                    <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 shrink-0">
                      <button
                        type="button"
                        className={`h-8 text-xs px-3 rounded transition-all font-semibold ${viewMode === "list" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white bg-transparent"}`}
                        onClick={() => setViewMode("list")}
                      >
                        Список заявок
                      </button>
                      <button
                        type="button"
                        className={`h-8 text-xs px-3 rounded transition-all font-semibold ${viewMode === "athlete" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white bg-transparent"}`}
                        onClick={() => setViewMode("athlete")}
                      >
                        По спортсменах
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table */}
                {viewMode === "list" ? (
                  <Card className="border-slate-800 bg-slate-900/30 overflow-hidden shadow-inner">
                    <Table>
                      <TableHeader className="bg-slate-900/70 border-b border-slate-800">
                        <TableRow className="hover:bg-slate-900/40 border-b border-slate-800">
                          <TableHead className="w-[40px] text-center">
                            <input
                              type="checkbox"
                              className="rounded border-slate-800 bg-slate-950 text-indigo-650 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                              checked={
                                filteredRegistrations.length > 0 &&
                                filteredRegistrations.every((r) => selectedRegIds.includes(r.id))
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedRegIds(filteredRegistrations.map((r) => r.id));
                                } else {
                                  setSelectedRegIds([]);
                                }
                              }}
                            />
                          </TableHead>
                          <TableHead className="text-slate-400">Спортсмен</TableHead>
                          <TableHead className="text-slate-400">Клуб</TableHead>
                          <TableHead className="text-slate-400">Тренер</TableHead>
                          <TableHead className="text-slate-400">Категорія</TableHead>
                          {selectedTournament.weigh_in_required && (
                            <TableHead className="text-slate-400">Зважування</TableHead>
                          )}
                          <TableHead className="text-slate-400 text-center">Оплата</TableHead>
                          <TableHead className="text-slate-400 text-center">Статус</TableHead>
                          {selectedTournament.use_check_in && (
                            <TableHead className="text-slate-400 text-center">Явка</TableHead>
                          )}
                          <TableHead className="text-slate-400 text-right">Дії</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renderRegistrationsTableBody()}
                      </TableBody>
                    </Table>
                  </Card>
                ) : (
                  <Card className="border-slate-800 bg-slate-900/30 overflow-hidden shadow-inner">
                    <Table>
                      <TableHeader className="bg-slate-900/70 border-b border-slate-800">
                        <TableRow className="hover:bg-slate-900/40 border-b border-slate-800">
                          <TableHead className="w-[40px] text-center">
                            <input
                              type="checkbox"
                              className="rounded border-slate-800 bg-slate-950 text-indigo-650 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                              checked={
                                groupedAthletes.length > 0 &&
                                groupedAthletes.every((group) =>
                                  group.registrations.every((r) => selectedRegIds.includes(r.id))
                                )
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const allIds: number[] = [];
                                  groupedAthletes.forEach((group) => {
                                    group.registrations.forEach((r) => {
                                      if (!allIds.includes(r.id)) {
                                        allIds.push(r.id);
                                      }
                                    });
                                  });
                                  setSelectedRegIds(allIds);
                                } else {
                                  setSelectedRegIds([]);
                                }
                              }}
                            />
                          </TableHead>
                          <TableHead className="text-slate-400">Спортсмен</TableHead>
                          <TableHead className="text-slate-400">Клуб</TableHead>
                          <TableHead className="text-slate-400">Тренер</TableHead>
                          <TableHead className="text-slate-400">Категорії та статуси</TableHead>
                          {selectedTournament.use_check_in && (
                            <TableHead className="text-slate-400 text-center">Явка</TableHead>
                          )}
                          {selectedTournament.weigh_in_required && (
                            <TableHead className="text-slate-400 text-right">Зважування</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renderAthleteCentricTableBody()}
                      </TableBody>
                    </Table>
                  </Card>
                )}

                {selectedRegIds.length > 0 && (
                  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 backdrop-blur border border-indigo-500/30 px-6 py-4 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] flex flex-col sm:flex-row items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="text-sm font-semibold text-slate-200">
                      Обрано: <strong className="text-indigo-400 font-mono text-base">{selectedRegIds.length}</strong> {selectedRegIds.length === 1 ? 'заявка' : selectedRegIds.length < 5 ? 'заявки' : 'заявок'}
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl px-4 py-2 flex items-center gap-1.5"
                        onClick={() => handleBulkUpdateSecretary({ checked_in: true })}
                        disabled={isBulkUpdating}
                      >
                        {isBulkUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Прибув
                      </Button>
                      <Button
                        size="sm"
                        className="bg-indigo-655 hover:bg-indigo-750 text-white font-medium text-xs rounded-xl px-4 py-2 flex items-center gap-1.5"
                        onClick={() => handleBulkUpdateSecretary({ payment_status: 'paid' })}
                        disabled={isBulkUpdating}
                      >
                        {isBulkUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Сплачено (Готівка)
                      </Button>
                      <Button
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs rounded-xl px-4 py-2 flex items-center gap-1.5"
                        onClick={handleBulkMarkOfflineRefunded}
                        disabled={isBulkUpdating || isBulkRefunding}
                      >
                        {isBulkRefunding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Повернути готівку
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="font-medium text-xs rounded-xl px-4 py-2 flex items-center gap-1.5"
                        onClick={() => {
                          if (window.confirm(`Ви впевнені, що хочете вилучити ${selectedRegIds.length} обраних учасників?`)) {
                            handleBulkUpdateSecretary({ status: 'withdrawn' });
                          }
                        }}
                        disabled={isBulkUpdating}
                      >
                        {isBulkUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Зняти з турніру
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-400 hover:text-white text-xs"
                        onClick={() => setSelectedRegIds([])}
                        disabled={isBulkUpdating}
                      >
                        Скасувати
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="categories" className="outline-none">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categories.map((cat) => (
                    <Card key={cat.id} className="border-slate-800 bg-slate-900/40 hover:border-indigo-500/50 transition-all flex flex-col justify-between">
                      <div>
                        <CardHeader className="pb-3">
                          <Link to={`/categories/${cat.id}`} className="hover:text-indigo-400 transition-colors">
                            <CardTitle className="text-md font-bold text-slate-200 truncate">{cat.name}</CardTitle>
                          </Link>
                          <CardDescription className="text-xs text-slate-500">
                            {cat.bracket_format_display}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="text-sm space-y-2 text-slate-400">
                          <div className="flex justify-between">
                            <span>Всього учасників:</span>
                            <span className="text-slate-200 font-semibold">{cat.confirmed_registrations_count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Статус:</span>
                            <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800/80">
                              {getCategoryStatusLabel(cat.status)}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Сітка:</span>
                            <Badge
                              className={cn(
                                cat.has_bracket
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-all"
                                  : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                              )}
                              onClick={() => {
                                if (cat.has_bracket) {
                                  setSelectedBracketCategoryId(cat.id);
                                }
                              }}
                            >
                              {cat.has_bracket ? "Сформована" : "Немає сітки"}
                            </Badge>
                          </div>
                        </CardContent>
                      </div>
                      <CardFooter className="pt-2 pb-4 border-t border-slate-850 flex justify-between items-center text-xs">
                        <Link to={`/categories/${cat.id}`} className="text-indigo-450 hover:text-indigo-300 font-medium transition-colors">
                          Деталі категорії →
                        </Link>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="finance" className="outline-none space-y-6">
                {isLoadingFinance ? (
                  <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  </div>
                ) : !financeReport ? (
                  <Card className="border-slate-800 bg-slate-900/40 p-6 text-center text-slate-400">
                    Не вдалося завантажити фінансові дані.
                  </Card>
                ) : (
                  <div className="space-y-6">
                    {/* Sub-tabs header navigation */}
                    <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl w-fit">
                      <Button
                        variant={financeSubTab === "summary" ? "sport" : "ghost"}
                        size="sm"
                        className="h-8 text-xs px-4 rounded-lg font-semibold"
                        onClick={() => setFinanceSubTab("summary")}
                      >
                        <Trophy className="w-3.5 h-3.5 mr-1.5 text-indigo-400" /> Загальне
                      </Button>
                      <Button
                        variant={financeSubTab === "details" ? "sport" : "ghost"}
                        size="sm"
                        className="h-8 text-xs px-4 rounded-lg font-semibold"
                        onClick={() => setFinanceSubTab("details")}
                      >
                        <Info className="w-3.5 h-3.5 mr-1.5 text-amber-500" /> Деталі платежів
                      </Button>
                      <Button
                        variant={financeSubTab === "withdrawals" ? "sport" : "ghost"}
                        size="sm"
                        className="h-8 text-xs px-4 rounded-lg font-semibold"
                        onClick={() => setFinanceSubTab("withdrawals")}
                      >
                        <Wallet className="w-3.5 h-3.5 mr-1.5 text-emerald-500" /> Виплата коштів (Виведення)
                      </Button>
                    </div>

                    {/* 1. SUMMARY TAB */}
                    {financeSubTab === "summary" && (
                      <div className="space-y-6">
                        {/* Financial Metrics Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Revenue */}
                          <Card className="border-slate-800 bg-slate-900/50 p-6 flex flex-col justify-between shadow-inner">
                            <div>
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Загальний збір внесків</p>
                              <h3 className="text-3xl font-extrabold text-white font-mono mt-2">
                                {financeReport.total_revenue} UAH
                              </h3>
                            </div>
                            <div className="border-t border-slate-850 mt-4 pt-3 flex justify-between text-xs text-slate-400">
                              <span>Всього реєстрацій:</span>
                              <span className="font-semibold text-slate-350">{financeReport.total_entries_count} чол.</span>
                            </div>
                          </Card>

                          {/* Online payments */}
                          <Card className="border-slate-800 bg-slate-900/50 p-6 flex flex-col justify-between shadow-inner">
                            <div>
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Сплачено Онлайн (Monobank)</p>
                              <h3 className="text-3xl font-extrabold text-indigo-400 font-mono mt-2">
                                {financeReport.online_funds} UAH
                              </h3>
                            </div>
                            <div className="border-t border-slate-850 mt-4 pt-3 flex justify-between text-xs text-slate-400">
                              <span>Через еквайринг:</span>
                              <span className="font-semibold text-slate-350">{financeReport.online_entries_count} чол.</span>
                            </div>
                          </Card>

                          {/* Offline cash */}
                          <Card className="border-slate-800 bg-slate-900/50 p-6 flex flex-col justify-between shadow-inner">
                            <div>
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Готівка на місці (Офлайн)</p>
                              <h3 className="text-3xl font-extrabold text-amber-500 font-mono mt-2">
                                {financeReport.offline_funds} UAH
                              </h3>
                            </div>
                            <div className="border-t border-slate-850 mt-4 pt-3 flex justify-between text-xs text-slate-400">
                              <span>Готівкові внески:</span>
                              <span className="font-semibold text-slate-350">{financeReport.offline_entries_count} / {financeReport.total_entries_count} чол.</span>
                            </div>
                          </Card>
                        </div>

                        {/* Platform Fee & Credit Limit Section */}
                        <Card className="border-slate-800 bg-slate-900/40 p-6">
                          <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                            💳 Взаєморозрахунки з платформою
                          </h3>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                            {/* Breakdown */}
                            <div className="space-y-4 text-sm text-slate-400">
                              <div className="flex justify-between pb-2 border-b border-slate-850">
                                <span>Загальна комісія платформи (5%):</span>
                                <span className="font-mono font-semibold text-slate-200">{financeReport.platform_fee_total} UAH</span>
                              </div>
                              <div className="flex justify-between pb-2 border-b border-slate-850">
                                <span>Утримано з онлайн-оплат (автоматично):</span>
                                <span className="font-mono font-semibold text-indigo-400">{financeReport.platform_fee_held} UAH</span>
                              </div>
                              <div className="flex justify-between pb-2 border-b border-slate-850">
                                <span>Нараховано до сплати за офлайн-реєстрації:</span>
                                <span className="font-mono font-semibold text-amber-500">{financeReport.platform_fee_offline_debt} UAH</span>
                              </div>
                              <div className="flex justify-between pb-2 border-b border-slate-850">
                                <span>Сплачено організатором за офлайн:</span>
                                <span className="font-mono font-semibold text-emerald-500">{financeReport.platform_fee_paid} UAH</span>
                              </div>
                              <div className="flex justify-between pt-2 text-base font-bold text-slate-200">
                                <span>Поточний борг перед платформою:</span>
                                <span className={`font-mono ${financeReport.platform_fee_debt > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                                  {financeReport.platform_fee_debt} UAH
                                </span>
                              </div>
                            </div>

                            {/* Actions & Alerts */}
                            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-850 space-y-4">
                              <div className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-400">
                                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                  <strong className="text-slate-200 block mb-1">Інформація про ліміти та комісії</strong>
                                  <p className="mb-2">
                                    Комісія за участь формується та нараховується автоматично після переведення турніру в статус <span className="text-indigo-400 font-semibold">«Завершено»</span>.
                                  </p>
                                  <div className="grid grid-cols-2 gap-4 bg-slate-900/60 p-3 rounded-lg border border-slate-800/60 mb-2">
                                    <div>
                                      <span className="text-[10px] text-slate-500 block">Ваш ліміт кредиту:</span>
                                      <span className="text-sm font-bold text-slate-350 font-mono">{financeReport.organizer_credit_limit} UAH</span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-slate-500 block">Сумарний борг:</span>
                                      <span className={`text-sm font-bold font-mono ${financeReport.organizer_total_debt > financeReport.organizer_credit_limit ? "text-rose-400 animate-pulse" : "text-slate-350"}`}>
                                        {financeReport.organizer_total_debt} UAH
                                      </span>
                                    </div>
                                  </div>
                                  {financeReport.organizer_total_debt > financeReport.organizer_credit_limit && (
                                    <p className="text-rose-400 font-semibold text-[11px] mb-2">
                                      ⚠️ Увага! Ваш ліміт боргу вичерпано. Створення та активація нових турнірів заблоковані до погашення заборгованості.
                                    </p>
                                  )}
                                  <p className="text-[11px] text-slate-500">
                                    Для подачі запиту на збільшення кредитного ліміту зверніться на email: <span className="text-indigo-400 underline">admin@tournament-platform.com</span>
                                  </p>
                                </div>
                              </div>

                              <div className="border-t border-slate-850 my-3" />

                              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div>
                                  <span className="text-xs text-slate-500 block">Сума до сплати комісії</span>
                                  <span className="text-xl font-bold font-mono text-white">{financeReport.platform_fee_debt} UAH</span>
                                </div>

                                <Button
                                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl px-5 py-2.5 flex items-center gap-1.5"
                                  onClick={handlePayPlatformFee}
                                  disabled={financeReport.platform_fee_debt <= 0 || isPayingPlatformFee}
                                >
                                  {isPayingPlatformFee ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                  Сплатити комісію online
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>

                        {/* Bulk debt payment checklist */}
                        {unpaidTournaments.length > 1 && (
                          <Card className="border-slate-800 bg-slate-900/40 p-6 mt-6">
                            <h3 className="text-lg font-bold text-slate-200 mb-2 flex items-center gap-2">
                              💰 Групова оплата заборгованостей платформи
                            </h3>
                            <p className="text-xs text-slate-400 mb-4">
                              Ви можете сплатити комісію за кілька завершених турнірів одним платежем через Monobank Sandbox.
                            </p>
                            <div className="border border-slate-800 rounded-xl overflow-hidden mb-4 bg-slate-950/40">
                              <Table>
                                <TableHeader className="bg-slate-900/40">
                                  <TableRow className="hover:bg-transparent border-b border-slate-850">
                                    <TableHead className="w-[50px] text-center">
                                      <input
                                        type="checkbox"
                                        className="rounded border-slate-800 bg-slate-950 text-indigo-650 w-4 h-4 cursor-pointer"
                                        checked={
                                          unpaidTournaments.length > 0 &&
                                          unpaidTournaments.every((t) => selectedUnpaidTournaments.includes(t.id))
                                        }
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedUnpaidTournaments(unpaidTournaments.map((t) => t.id));
                                          } else {
                                            setSelectedUnpaidTournaments([]);
                                          }
                                        }}
                                      />
                                    </TableHead>
                                    <TableHead className="text-xs text-slate-400">Турнір</TableHead>
                                    <TableHead className="text-xs text-slate-400 text-right">Сума боргу</TableHead>
                                    <TableHead className="text-xs text-slate-400">Статус</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {unpaidTournaments.map((t) => (
                                    <TableRow key={t.id} className="hover:bg-slate-900/10 border-b border-slate-850">
                                      <TableCell className="text-center py-3">
                                        <input
                                          type="checkbox"
                                          className="rounded border-slate-800 bg-slate-950 text-indigo-650 w-4 h-4 cursor-pointer"
                                          checked={selectedUnpaidTournaments.includes(t.id)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedUnpaidTournaments((prev) => [...prev, t.id]);
                                            } else {
                                              setSelectedUnpaidTournaments((prev) => prev.filter((id) => id !== t.id));
                                            }
                                          }}
                                        />
                                      </TableCell>
                                      <TableCell className="py-3 font-semibold text-slate-200 text-xs">
                                        {t.title} {t.id === selectedTournament?.id && <span className="text-[10px] text-indigo-400 ml-1.5">(Поточний)</span>}
                                      </TableCell>
                                      <TableCell className="py-3 text-right font-mono font-bold text-rose-450 text-xs">
                                        {t.platform_fee_amount} UAH
                                      </TableCell>
                                      <TableCell className="py-3 text-xs text-rose-500">
                                        Не сплачено
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-850">
                              <div>
                                <span className="text-xs text-slate-500 block">Вибрано до сплати ({selectedUnpaidTournaments.length} турнірів):</span>
                                <span className="text-xl font-bold font-mono text-white">
                                  {unpaidTournaments
                                    .filter((t) => selectedUnpaidTournaments.includes(t.id))
                                    .reduce((sum, t) => sum + (t.platform_fee_amount || 0), 0)}{" "}
                                  UAH
                                </span>
                              </div>
                              <Button
                                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl px-5 py-2.5 flex items-center gap-1.5 border-none"
                                onClick={handlePayBulkPlatformFee}
                                disabled={selectedUnpaidTournaments.length === 0 || isPayingBulkFee}
                              >
                                {isPayingBulkFee ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                Сплатити вибрані заборгованості online
                              </Button>
                            </div>
                          </Card>
                        )}
                      </div>
                    )}

                    {/* 2. PAYMENTS DETAIL TAB */}
                    {financeSubTab === "details" && (
                      <Card className="border-slate-800 bg-slate-900/40 p-6 space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-bold text-slate-200">Перегляд стартових внесків</h3>
                            <p className="text-xs text-slate-400">Детальний список платежів за участь спортсменів у цьому турнірі.</p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                              <Input
                                placeholder="Пошук спортсмена..."
                                value={paymentDetailsSearch}
                                onChange={(e) => setPaymentDetailsSearch(e.target.value)}
                                className="pl-9 h-9 w-[200px] bg-slate-950 border-slate-800 text-slate-200 rounded-xl"
                              />
                            </div>

                            <Select value={paymentDetailsStatusFilter} onValueChange={setPaymentDetailsStatusFilter}>
                              <SelectTrigger className="h-9 w-[130px] bg-slate-950 border-slate-800 text-slate-200 rounded-xl text-xs">
                                <SelectValue placeholder="Статус" />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                                <SelectItem value="all">Усі</SelectItem>
                                <SelectItem value="paid">Сплачено</SelectItem>
                                <SelectItem value="unpaid">Борг</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                          <Table>
                            <TableHeader className="bg-slate-900/40">
                              <TableRow className="hover:bg-transparent border-b border-slate-850">
                                <TableHead className="text-xs text-slate-400">Спортсмен / Команда</TableHead>
                                <TableHead className="text-xs text-slate-400">Категорія</TableHead>
                                <TableHead className="text-xs text-slate-400">Тренер / Клуб</TableHead>
                                <TableHead className="text-xs text-slate-400 text-right">Сума</TableHead>
                                <TableHead className="text-xs text-slate-400">Метод</TableHead>
                                <TableHead className="text-xs text-slate-400 text-right">Статус</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {registrations
                                .filter((r) => {
                                  const name = formatRegistrationName(r).toLowerCase();
                                  const cat = r.category_name.toLowerCase();
                                  const coach = (r.coach_name_short || "").toLowerCase();
                                  const club = formatRegistrationClub(r).toLowerCase();
                                  const q = paymentDetailsSearch.toLowerCase();
                                  const matchesSearch = name.includes(q) || cat.includes(q) || coach.includes(q) || club.includes(q);
                                  const matchesStatus = paymentDetailsStatusFilter === "all" || r.payment_status === paymentDetailsStatusFilter;
                                  return matchesSearch && matchesStatus && r.status !== "withdrawn";
                                })
                                .map((reg) => (
                                  <TableRow key={reg.id} className="hover:bg-slate-900/10 border-b border-slate-850">
                                    <TableCell className="py-3 font-semibold text-slate-200 text-xs">
                                      {formatRegistrationName(reg)}
                                    </TableCell>
                                    <TableCell className="py-3 text-xs text-slate-400">
                                      {reg.category_name}
                                    </TableCell>
                                    <TableCell className="py-3 text-xs text-slate-400">
                                      {reg.coach_name_short || "—"} / {formatRegistrationClub(reg)}
                                    </TableCell>
                                    <TableCell className="py-3 text-right font-mono font-semibold text-slate-200 text-xs">
                                      {reg.fee || 500} UAH
                                    </TableCell>
                                    <TableCell className="py-3 text-xs text-slate-400">
                                      {reg.payment_method === "online" ? (
                                        reg.payment_invoice ? (
                                          <span
                                            role="button"
                                            tabIndex={0}
                                            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer hover:underline focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
                                            onClick={() => handleOpenInvoiceModal(reg.payment_invoice)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                handleOpenInvoiceModal(reg.payment_invoice);
                                              }
                                            }}
                                          >
                                            <CreditCard className="w-3 h-3" /> Онлайн
                                          </span>
                                        ) : (
                                          <span className="flex items-center gap-1 text-indigo-400 font-medium">
                                            <CreditCard className="w-3 h-3" /> Онлайн
                                          </span>
                                        )
                                      ) : reg.payment_method === "offline" ? (
                                        <span className="flex items-center gap-1 text-amber-500 font-medium">
                                          <Wallet className="w-3 h-3" /> Готівка
                                        </span>
                                      ) : (
                                        <span className="text-slate-500">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-3 text-right">
                                      {reg.payment_status === "paid" ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                          {reg.payment_method === "online" && <LockIcon className="w-2.5 h-2.5" />} Сплачено
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                          Борг
                                        </span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              {registrations.filter((r) => r.status !== "withdrawn").length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-8 text-slate-500 text-xs">
                                    Не знайдено жодного платежу.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </Card>
                    )}

                    {/* 3. WITHDRAWALS (PAYOUTS) TAB */}
                    {financeSubTab === "withdrawals" && (
                      <div className="space-y-6">
                        {/* Balance Metrics Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Available Balance */}
                          <Card className="border-slate-850 bg-slate-900/50 p-6 flex flex-col justify-between shadow-inner">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-xs font-semibold text-emerald-550 uppercase tracking-wider">Доступно до виведення</p>
                                <h3 className="text-3xl font-extrabold text-emerald-400 font-mono mt-2">
                                  {financeReport.available_balance} UAH
                                </h3>
                              </div>
                              <Wallet className="w-7 h-7 text-emerald-500/30" />
                            </div>
                            <p className="text-[10px] text-slate-500 mt-4 pt-3 border-t border-slate-850 leading-relaxed">
                              Баланс онлайн-оплат (за вирахуванням утриманої 5% комісії та оброблених виплат).
                            </p>
                          </Card>

                          {/* Pending Payout Requests */}
                          <Card className="border-slate-850 bg-slate-900/50 p-6 flex flex-col justify-between shadow-inner">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">У процесі виведення</p>
                                <h3 className="text-3xl font-extrabold text-amber-500 font-mono mt-2">
                                  {financeReport.pending_withdrawn_funds} UAH
                                </h3>
                              </div>
                              <RefreshCw className="w-7 h-7 text-amber-500/30" />
                            </div>
                            <p className="text-[10px] text-slate-500 mt-4 pt-3 border-t border-slate-850 leading-relaxed">
                              Сума за запитами на виплату, які очікують підтвердження від адміністрації.
                            </p>
                          </Card>

                          {/* Completed Withdrawals */}
                          <Card className="border-slate-850 bg-slate-900/50 p-6 flex flex-col justify-between shadow-inner">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Усього виплачено</p>
                                <h3 className="text-3xl font-extrabold text-white font-mono mt-2">
                                  {financeReport.withdrawn_funds} UAH
                                </h3>
                              </div>
                              <CheckCircle className="w-7 h-7 text-slate-500/30" />
                            </div>
                            <p className="text-[10px] text-slate-500 mt-4 pt-3 border-t border-slate-850 leading-relaxed">
                              Кошти, успішно перераховані на ваші банківські реквізити.
                            </p>
                          </Card>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                          {/* Request Form */}
                          <Card className="border-slate-800 bg-slate-900/40 p-6 lg:col-span-1">
                            <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-1.5">
                              📥 Створити запит на виплату
                            </h3>
                            <form onSubmit={handleRequestPayout} className="space-y-4">
                              {selectedTournament?.status !== "completed" && (
                                <div className="p-3 border border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs rounded-xl flex gap-2.5 items-start">
                                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                                  <div>
                                    <strong className="font-bold block mb-1">Виведення коштів обмежено</strong>
                                    Виведення коштів доступне лише для завершених турнірів. Поточний статус турніру: <span className="font-semibold">{selectedTournament?.status_display || selectedTournament?.status || "—"}</span>.
                                  </div>
                                </div>
                              )}

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">Сума виплати (UAH)</label>
                                <Input
                                  type="number"
                                  placeholder={`Макс. ${financeReport.available_balance}`}
                                  value={payoutAmount}
                                  onChange={(e) => setPayoutAmount(e.target.value)}
                                  className="h-9 bg-slate-950 border-slate-800 text-slate-200 rounded-xl font-mono text-sm"
                                  min="1"
                                  max={financeReport.available_balance}
                                  required
                                  disabled={selectedTournament?.status !== "completed"}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">IBAN отримувача *</label>
                                <Input
                                  placeholder="UA0030000000000000000000000"
                                  value={payoutIBAN}
                                  onChange={(e) => setPayoutIBAN(e.target.value)}
                                  className="h-9 bg-slate-950 border-slate-800 text-slate-200 rounded-xl text-xs font-mono"
                                  maxLength={34}
                                  required
                                  disabled={selectedTournament?.status !== "completed"}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">ПІБ отримувача / Назва організації *</label>
                                <Input
                                  placeholder="ФОП Шевченко Тарас Григорович"
                                  value={payoutRecipientName}
                                  onChange={(e) => setPayoutRecipientName(e.target.value)}
                                  className="h-9 bg-slate-950 border-slate-800 text-slate-200 rounded-xl text-xs"
                                  maxLength={255}
                                  required
                                  disabled={selectedTournament?.status !== "completed"}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">Код ЄДРПОУ / ІПН отримувача *</label>
                                <Input
                                  placeholder="1234567890"
                                  value={payoutRecipientCode}
                                  onChange={(e) => setPayoutRecipientCode(e.target.value)}
                                  className="h-9 bg-slate-950 border-slate-800 text-slate-200 rounded-xl text-xs font-mono"
                                  maxLength={20}
                                  required
                                  disabled={selectedTournament?.status !== "completed"}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-semibold text-slate-500 block uppercase tracking-wider">Призначення платежу (необов'язково)</label>
                                <Input
                                  placeholder="Виплата коштів за участь у турнірі..."
                                  value={payoutPurpose}
                                  onChange={(e) => setPayoutPurpose(e.target.value)}
                                  className="h-9 bg-slate-950 border-slate-800 text-slate-200 rounded-xl text-xs"
                                  maxLength={255}
                                  disabled={selectedTournament?.status !== "completed"}
                                />
                              </div>

                              <Button
                                type="submit"
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl py-2 flex items-center justify-center gap-1.5 border-none"
                                disabled={financeReport.available_balance <= 0 || isSubmittingPayout || selectedTournament?.status !== "completed"}
                              >
                                {isSubmittingPayout ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                Замовити виплату
                              </Button>
                            </form>
                            <div className="p-3 border border-slate-850/50 bg-slate-950/20 rounded-xl mt-4 text-[10px] text-slate-500 leading-relaxed">
                              💡 Обробка запитів на виплату триває зазвичай 1-3 банківських днів. Переказ здійснюється адміністрацією платформи вручну на вказані реквізити.
                            </div>
                          </Card>

                          {/* Payout History List */}
                          <Card className="border-slate-800 bg-slate-900/40 p-6 lg:col-span-2 space-y-4">
                            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                              <HistoryIcon className="w-4 h-4 text-slate-500" /> Історія запитів на виведення
                            </h3>
                            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                              <Table>
                                <TableHeader className="bg-slate-900/40">
                                  <TableRow className="hover:bg-transparent border-b border-slate-850">
                                    <TableHead className="text-xs text-slate-400">ID / Дата</TableHead>
                                    <TableHead className="text-xs text-slate-400">Реквізити</TableHead>
                                    <TableHead className="text-xs text-slate-400 text-right">Сума</TableHead>
                                    <TableHead className="text-xs text-slate-400 text-right">Статус</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {isLoadingPayouts ? (
                                    <TableRow>
                                      <TableCell colSpan={4} className="text-center py-6">
                                        <Loader2 className="w-5 h-5 animate-spin text-slate-500 mx-auto" />
                                      </TableCell>
                                    </TableRow>
                                  ) : payoutRequests.map((req) => (
                                    <TableRow key={req.id} className="hover:bg-slate-900/10 border-b border-slate-850">
                                      <TableCell className="py-3 text-xs text-slate-400">
                                        <div className="font-semibold text-slate-200">#PR-{req.id}</div>
                                        <div className="text-[10px] text-slate-550 mt-0.5">
                                          {new Date(req.created_at).toLocaleDateString()}
                                        </div>
                                      </TableCell>
                                      <TableCell className="py-3 text-slate-300 text-xs max-w-[200px]">
                                        {req.iban ? (
                                          <div className="space-y-0.5 text-left">
                                            <div className="font-mono font-semibold text-slate-200 truncate">{req.iban}</div>
                                            <div className="text-[10px] text-slate-400 truncate">{req.recipient_name}</div>
                                            <div className="text-[9px] text-slate-550 truncate">
                                              Код: {req.recipient_code}
                                              {req.purpose && ` | Призначення: ${req.purpose}`}
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="font-mono text-[10px] truncate">{req.bank_details}</div>
                                        )}
                                      </TableCell>
                                      <TableCell className="py-3 text-right font-mono font-bold text-slate-200 text-xs">
                                        {req.amount} UAH
                                      </TableCell>
                                      <TableCell className="py-3 text-right">
                                        {req.status === "completed" ? (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            Виплачено
                                          </span>
                                        ) : req.status === "rejected" ? (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                            Відхилено
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                            Очікує
                                          </span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                  {payoutRequests.length === 0 && !isLoadingPayouts && (
                                    <TableRow>
                                      <TableCell colSpan={4} className="text-center py-6 text-slate-500 text-xs">
                                        Не знайдено жодного запиту на виплату.
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </div>
                          </Card>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {user?.role === "admin" && (
                <TabsContent value="role_requests" className="outline-none space-y-4">
                  {renderRoleRequestsCard()}
                </TabsContent>
              )}

              {user?.role === "admin" && (
                <TabsContent value="limits" className="outline-none space-y-4">
                  {renderAdminLimitsTab()}
                </TabsContent>
              )}
            </Tabs>
          </div>
        ) : (
          <div className="space-y-6">
            {user?.role === "admin" ? (
              <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="w-full space-y-4">
                <TabsList className="bg-slate-900 border border-slate-800 p-1">
                  <TabsTrigger value="role_requests" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                    Заявки на ролі ({roleRequests.length})
                  </TabsTrigger>
                  <TabsTrigger value="limits" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                    Кредитні ліміти
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="role_requests" className="outline-none space-y-4">
                  {renderRoleRequestsCard()}
                </TabsContent>

                <TabsContent value="limits" className="outline-none space-y-4">
                  {renderAdminLimitsTab()}
                </TabsContent>
              </Tabs>
            ) : (
              <Card className="border-slate-800 bg-slate-900/40 p-12 text-center max-w-2xl mx-auto">
                <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                <h2 className="text-lg font-bold text-slate-200">Немає призначених турнірів</h2>
                <p className="text-sm text-slate-400 mt-2">
                  Ви не є організатором або секретарським персоналом для жодного активного турніру. Будь ласка, зверніться до адміністратора для призначення вас на змагання.
                </p>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Weigh-in dialog */}
      <Dialog open={weighInReg !== null || weighInGroup !== null} onOpenChange={(open) => {
        if (!open) {
          setWeighInReg(null);
          setWeighInGroup(null);
        }
      }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {weighInGroup
                ? `Зважування: ${weighInGroup.name}`
                : weighInReg?.team
                  ? "Допуск команди до змагань"
                  : "Підтвердження зважування"
              }
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {weighInGroup
                ? `Введіть вагу для спортсмена ${weighInGroup.name}. Вага буде збережена для всіх його категорій.`
                : weighInReg?.team
                  ? "Перевірте склад команди та підтвердьте її допуск до змагань."
                  : "Введіть фактичну вагу спортсмена на вагах. Заявка автоматично перейде в статус 'Підтверджено'."
              }
            </DialogDescription>
          </DialogHeader>

          {(weighInReg || weighInGroup) && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800">
                {weighInGroup ? (
                  <>
                    <p className="text-sm font-semibold text-slate-300">
                      {weighInGroup.name} ({weighInGroup.club})
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Категорії: {weighInGroup.registrations.map((r: Registration) => r.category_name).join(", ")}
                    </p>
                    {weighInGroup.baseWeight && (
                      <p className="text-xs text-slate-400">
                        Початкова вага (з профілю): {weighInGroup.baseWeight} кг
                      </p>
                    )}
                  </>
                ) : weighInReg?.team ? (
                  <>
                    <p className="text-sm font-semibold text-slate-300">
                      Команда: {weighInReg?.team?.name} ({weighInReg?.team?.club?.name || "Особисто"})
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Категорія: {weighInReg?.category_name}
                    </p>
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-semibold text-slate-400">Склад команди:</p>
                      <ul className="text-xs text-slate-300 list-disc pl-4 space-y-1">
                        {weighInReg?.team?.athletes?.map((ath) => (
                          <li key={ath.id}>
                            {ath.last_name} {ath.first_name} (Базова вага: {ath.base_weight} кг)
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-300">
                      {weighInReg?.athlete?.last_name} {weighInReg?.athlete?.first_name}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Категорія: {weighInReg?.category_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      Початкова вага (з профілю): {weighInReg?.athlete?.base_weight} кг
                    </p>
                  </>
                )}
              </div>

              {((weighInReg && weighInReg.team) || (weighInGroup && weighInGroup.type === "team")) ? (
                <p className="text-xs text-amber-500 font-semibold italic bg-amber-500/10 border border-amber-500/20 rounded p-2.5 text-center">
                  Команда виступає в абсолютній категорії і не потребує фіксації ваги.
                </p>
              ) : (
                <div className="space-y-2">
                  <label htmlFor="weigh-in-weight-input" className="text-sm font-medium text-slate-300">
                    Фактична вага спортсмена (кг):
                  </label>
                  <Input
                    id="weigh-in-weight-input"
                    type="number"
                    step="0.01"
                    placeholder="Наприклад: 73.4"
                    className="border-slate-800 bg-slate-950 text-slate-200 placeholder-slate-600 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    value={weighInValue}
                    onChange={(e) => setWeighInValue(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="border-slate-800 hover:bg-slate-800 bg-slate-950 text-slate-300" onClick={() => {
              setWeighInReg(null);
              setWeighInGroup(null);
            }}>
              Скасувати
            </Button>
            <Button
              onClick={weighInGroup ? handleAthleteWeighInSubmit : handleWeighInSubmit}
              disabled={submittingWeighIn}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {submittingWeighIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Збереження...
                </>
              ) : weighInGroup?.type === "team" || weighInReg?.team ? (
                "Допустити команду"
              ) : (
                "Підтвердити"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedBracketCategoryId !== null && (
        <CategoryBracketDialog
          categoryId={selectedBracketCategoryId}
          onClose={() => setSelectedBracketCategoryId(null)}
        />
      )}

      {/* Role Request Review Dialog */}
      <Dialog open={reviewDialogReq !== null} onOpenChange={(open) => !open && setReviewDialogReq(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {reviewStatus === "approved" ? "Схвалення запиту на роль" : "Відхилення запиту на роль"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {reviewStatus === "approved"
                ? `Ви підтверджуєте зміну ролі для ${activeReviewReq?.user?.last_name} ${activeReviewReq?.user?.first_name} на ${ROLE_LABELS[activeReviewReq?.requested_role || ""] || activeReviewReq?.requested_role}.`
                : `Ви відхиляєте запит на роль ${ROLE_LABELS[activeReviewReq?.requested_role || ""] || activeReviewReq?.requested_role} для користувача ${activeReviewReq?.user?.last_name} ${activeReviewReq?.user?.first_name}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <label htmlFor="review-notes-textarea" className="text-sm font-medium text-slate-300">
                Коментар секретаря/адміністратора (необов'язково для схвалення, бажано для відхилення):
              </label>
              <textarea
                id="review-notes-textarea"
                rows={3}
                placeholder="Введіть причину відхилення або додаткові вказівки для схвалення..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-slate-200"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-800 hover:bg-slate-800 bg-slate-950 text-slate-300"
              onClick={() => setReviewDialogReq(null)}
            >
              Скасувати
            </Button>
            <Button
              onClick={() => {
                if (reviewDialogReq && reviewStatus) {
                  handleReviewRoleRequest(reviewDialogReq.id, reviewStatus as "approved" | "rejected");
                }
              }}
              className={reviewStatus === "approved" ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white"}
            >
              Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvoiceDetailsDialog
        invoice={selectedInvoiceForModal}
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false);
          setSelectedInvoiceForModal(null);
        }}
      />
    </div>
  );
}

function updateMatchInRounds(rounds: Match[][], updatedMatch: Match): Match[][] {
  return rounds.map(round =>
    round.map(m => m.id === updatedMatch.id ? updatedMatch : m)
  );
}

interface CategoryBracketDialogProps {
  categoryId: number;
  onClose: () => void;
}

function CategoryBracketDialog({ categoryId, onClose }: Readonly<CategoryBracketDialogProps>) {
  const [bracket, setBracket] = useState<BracketResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBracket = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [bracketRes, catRes] = await Promise.all([
        api.get<unknown>(`/matches/bracket/?category=${categoryId}`),
        api.get<Category>(`/categories/${categoryId}/`),
      ]);

      const roundsData = bracketRes.data as {round_index: number, matches: Match[]}[];
      const rounds = roundsData.map(r => r.matches);

      setBracket({
        format: catRes.data.bracket_format,
        rounds: rounds
      });
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    fetchBracket();
  }, [fetchBracket]);

  const handleMatchUpdate = useCallback((updatedMatch: Match) => {
    if (!updatedMatch) {
      fetchBracket(true);
      return;
    }
    setBracket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rounds: updateMatchInRounds(prev.rounds, updatedMatch),
      };
    });
  }, [fetchBracket]);

  useMatchUpdates(Number(categoryId), handleMatchUpdate, {
    onConnect: () => {
      fetchBracket(true);
    },
  });

  const renderBracketContent = () => {
    if (isLoading && !bracket) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      );
    }
    if (bracket && bracket.rounds.length > 0) {
      return (
        <div className="w-full space-y-6">
          <BracketView bracket={bracket} />
          {bracket.format === "single_repechage" && (
            <div className="mt-8 border-t border-slate-800 pt-6 space-y-4">
              <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2 select-none">
                <Trophy className="w-4 h-4 text-amber-500" /> Втішні поєдинки (Репешаж)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Пул А */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 select-none">
                    Пул А (Верхня половина сітки)
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    {bracket.rounds
                      .flat()
                      .filter((m) => m.round_index >= 300 && m.match_order === 1)
                      .sort((a, b) => a.round_index - b.round_index)
                      .map((match) => (
                        <div key={match.id} className="relative flex items-center justify-center w-full">
                          <MatchCard match={match} />
                        </div>
                      ))}
                    {bracket.rounds.flat().filter((m) => m.round_index >= 300 && m.match_order === 1).length === 0 && (
                      <div className="text-xs text-slate-500 italic py-4 select-none">Очікує результатів півфіналів...</div>
                    )}
                  </div>
                </div>

                {/* Пул Б */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 select-none">
                    Пул Б (Нижня половина сітки)
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    {bracket.rounds
                      .flat()
                      .filter((m) => m.round_index >= 300 && m.match_order === 2)
                      .sort((a, b) => a.round_index - b.round_index)
                      .map((match) => (
                        <div key={match.id} className="relative flex items-center justify-center w-full">
                          <MatchCard match={match} />
                        </div>
                      ))}
                    {bracket.rounds.flat().filter((m) => m.round_index >= 300 && m.match_order === 2).length === 0 && (
                      <div className="text-xs text-slate-500 italic py-4 select-none">Очікує результатів півфіналів...</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-500 text-sm">Сітка порожня або виникла помилка завантаження.</p>
      </div>
    );
  };

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            Турнірна сітка
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Відображення сітки в реальному часі. Зміни в поєдинках оновлюються автоматично.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 min-h-[300px] flex flex-col justify-start">
          {renderBracketContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
