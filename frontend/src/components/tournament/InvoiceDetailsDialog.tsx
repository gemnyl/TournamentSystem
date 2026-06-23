import * as React from "react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Download, CreditCard, Calendar, Receipt, FileText, CheckCircle2, XCircle, AlertCircle, Search } from "lucide-react";

interface RegistrationDetail {
  id: number;
  athlete_name: string;
  category_name: string;
}

interface Invoice {
  id: number;
  invoice_id?: string;
  payment_type: string;
  payment_type_display?: string;
  amount: number;
  status: string;
  status_display?: string;
  payment_url?: string;
  created_at: string;
  registration_details?: RegistrationDetail[];
}

interface InvoiceDetailsDialogProps {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
}

export const InvoiceDetailsDialog: React.FC<InvoiceDetailsDialogProps> = ({
  invoice,
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  React.useEffect(() => {
    if (!isOpen) {
      setSearchTerm("");
    }
  }, [isOpen]);

  if (!invoice) return null;

  const details = invoice.registration_details || [];

  const filteredDetails = details.filter(
    (d) =>
      d.athlete_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.category_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case "pending":
        return <AlertCircle className="w-5 h-5 text-amber-500 animate-pulse" />;
      default:
        return <XCircle className="w-5 h-5 text-rose-500" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      case "pending":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
      default:
        return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    }
  };

  const formatTextList = () => {
    const titleLine = `Рахунок № ${invoice.invoice_id || invoice.id} від ${new Date(invoice.created_at).toLocaleString("uk-UA")}`;
    const amountLine = `Сума: ${invoice.amount} UAH`;
    const statusLine = `Статус: ${invoice.status === "paid" ? "Сплачено" : invoice.status === "pending" ? "Очікує оплати" : "Скасовано/Помилка"}`;
    const typeLine = `Тип: ${invoice.payment_type === "registrations" ? "Стартові внески" : "Комісія платформи"}`;

    let listContent = "";
    if (details.length > 0) {
      listContent = "\nСписок спортсменів та категорій:\n" +
        details.map((d, index) => `${index + 1}. ${d.athlete_name} — ${d.category_name}`).join("\n");
    } else {
      listContent = "\nНемає прив'язаних реєстрацій.";
    }

    return `${titleLine}\n${amountLine}\n${statusLine}\n${typeLine}${listContent}`;
  };

  const handleCopy = () => {
    const text = formatTextList();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = formatTextList();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `invoice_${invoice.invoice_id || invoice.id}_details.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl rounded-2xl p-6">
        <DialogHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
              <Receipt className="w-5 h-5 text-amber-500" />
              Деталі рахунку
            </DialogTitle>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadgeClass(invoice.status)}`}>
              {getStatusIcon(invoice.status)}
              {invoice.status === "paid" ? "Сплачено" : invoice.status === "pending" ? "Очікує оплати" : "Скасовано/Помилка"}
            </span>
          </div>
          <DialogDescription className="text-slate-400 text-xs">
            Перегляд списку спортсменів та інформації про платіж.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 my-4">
          {/* Main info card */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block">ID рахунку</span>
              <span className="text-sm font-semibold text-slate-200 block font-mono truncate" title={invoice.invoice_id || String(invoice.id)}>
                {invoice.invoice_id || invoice.id}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Сума платежу</span>
              <span className="text-sm font-bold text-white block font-mono">
                {invoice.amount} UAH
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Дата створення</span>
              <span className="text-xs text-slate-350 block flex items-center gap-1 mt-0.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {new Date(invoice.created_at).toLocaleString("uk-UA")}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Призначення</span>
              <span className="text-xs text-slate-350 block flex items-center gap-1 mt-0.5">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                {invoice.payment_type === "registrations" ? "Стартові внески" : "Комісія платформи"}
              </span>
            </div>
          </div>

          {/* Athletes List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <FileText className="w-4 h-4 text-slate-500" />
                Заявлені учасники ({details.length})
              </h4>
            </div>

            {details.length > 5 && (
              <div className="relative">
                <Search className="absolute left-3 top-2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Пошук учасника або категорії..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-650"
                />
              </div>
            )}

            {details.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl bg-slate-950/20 text-xs text-slate-500">
                Цей рахунок не містить окремих спортсменів (наприклад, комісія платформи).
              </div>
            ) : filteredDetails.length === 0 ? (
              <div className="text-center py-8 border border-slate-800 rounded-xl bg-slate-950/20 text-xs text-slate-400 italic">
                Нічого не знайдено за вашим запитом.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/45 max-h-[220px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs table-fixed">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-2.5 px-3 w-12 text-center select-none">№</th>
                      <th className="py-2.5 px-3 w-1/2">Спортсмен / Команда</th>
                      <th className="py-2.5 px-3 w-[40%]">Категорія</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDetails.map((d, index) => (
                      <tr key={d.id} className="border-b border-slate-850 last:border-0 hover:bg-slate-900/40">
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-center select-none">{index + 1}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-200 break-words">{d.athlete_name}</td>
                        <td className="py-2.5 px-3 text-slate-400 break-words leading-relaxed">{d.category_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-850 pt-4">
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="flex-1 sm:flex-none h-9 text-xs border-slate-800 hover:bg-slate-850 hover:text-white bg-slate-900 text-slate-350"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                  Скопійовано
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Копіювати текст
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="flex-1 sm:flex-none h-9 text-xs border-slate-800 hover:bg-slate-850 hover:text-white bg-slate-900 text-slate-350"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Скачати список
            </Button>
          </div>
          <Button
            variant="sport"
            onClick={onClose}
            className="w-full sm:w-auto h-9 text-xs"
          >
            Закрити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
