import { useSearchParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import api, { formatAxiosError, AxiosError, ErrorDetail } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function MockPayPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const invoiceIdStr = searchParams.get("invoiceId") || "";
  const amount = searchParams.get("amount") || "0";

  const [loading, setLoading] = useState(false);

  // Extract database invoice ID from "mock-{id}"
  const dbInvoiceId = invoiceIdStr.replace("mock-", "");

  const handleSimulate = async (success: boolean) => {
    if (!dbInvoiceId) return;
    setLoading(true);
    try {
      if (success) {
        // Trigger manual synchronization endpoint which queries status
        await api.post(`/billing/invoices/${dbInvoiceId}/sync/`, {}, { skipGlobalToast: true });
        toast({
          title: "Симуляція успішна!",
          description: "Платіж успішно проведено через Monobank Sandbox.",
        });
        // Redirect back to coach dashboard
        navigate("/coach/dashboard?tab=billing");
      } else {
        toast({
          title: "Симуляція скасування",
          description: "Оплату скасовано користувачем.",
          variant: "destructive"
        });
        navigate("/coach/dashboard");
      }
    } catch (err) {
      toast({
        title: "Помилка симуляції",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 shadow-2xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            💳
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-white">
            Monobank Acquiring Sandbox
          </CardTitle>
          <CardDescription className="text-slate-400">
            Симуляція платіжного шлюзу Monobank Checkout
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-slate-950 p-4 border border-slate-850">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Отримувач:</span>
              <span className="font-medium text-slate-200">Турнірна Платформа</span>
            </div>
            <div className="flex justify-between text-sm text-slate-400 mt-2">
              <span>Номер рахунку:</span>
              <span className="font-mono text-slate-200">{invoiceIdStr}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-400 mt-2">
              <span>Призначення:</span>
              <span className="text-slate-200">Стартові внески за участь</span>
            </div>
            <div className="border-t border-slate-800 my-3" />
            <div className="flex justify-between items-center">
              <span className="text-base font-semibold text-slate-200">Сума до сплати:</span>
              <span className="text-2xl font-extrabold text-amber-500">{amount} UAH</span>
            </div>
          </div>

          <div className="text-xs text-center text-slate-500 bg-slate-900/50 p-2.5 rounded border border-slate-800/40">
            Це тестова сторінка еквайрингу для вашої дипломної роботи. Жодні реальні кошти не списуються.
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2.5 pt-2">
          <Button
            onClick={() => handleSimulate(true)}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-2 py-5"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                Симулювати успішну оплату
              </>
            )}
          </Button>
          <Button
            onClick={() => handleSimulate(false)}
            disabled={loading}
            variant="outline"
            className="w-full border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white gap-2 py-5"
          >
            <XCircle className="h-5 w-5 text-rose-500" />
            Скасувати платіж
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
