import { useEffect, useState, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import type { BracketResponse, Category, Tournament } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
// @ts-ignore
import html2pdf from "html2pdf.js";
import { checkPrintAccess, getHtml2PdfOptions } from "@/lib/printUtils";
import { PrintErrorState, PrintLoadingState, PrintNoAccessState } from "@/components/PrintStateTemplates";
import { PrintBracketSheet } from "@/components/PrintBracketSheet";


export default function PrintCategoryBracketPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isInitialized, fetchMe } = useAuth();
  const [searchParams] = useSearchParams();
  const action = searchParams.get("action") || "print";

  const [category, setCategory] = useState<Category | null>(null);
  const [bracket, setBracket] = useState<BracketResponse | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user && isInitialized) {
      fetchMe();
    }
  }, [user, isInitialized]);

  useEffect(() => {
    async function loadData() {
      try {
        const catRes = await api.get<Category>(`/categories/${id}/`);
        const [bracketRes, tournRes] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          api.get<any>(`/matches/bracket/?category=${id}`),
          api.get<Tournament>(`/tournaments/${catRes.data.tournament}/`),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const roundsData = bracketRes.data as { round_index: number; matches: any[] }[];
        const rounds = roundsData.map(r => r.matches);

        setCategory(catRes.data);
        setBracket({
          format: catRes.data.bracket_format,
          rounds: rounds
        });
        setTournament(tournRes.data);
      } catch (err) {
        console.error(err);
        setError("Помилка завантаження даних.");
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [id]);

  const hasAccess = useMemo(() => {
    return checkPrintAccess(user, isInitialized, tournament);
  }, [user, isInitialized, tournament]);

  const handleDownloadPdf = () => {
    const element = document.querySelector(".print-container");
    if (element && html2pdf) {
      const opt = getHtml2PdfOptions(`Сітка_${category?.name || "категорія"}.pdf`);
      html2pdf().set(opt).from(element as HTMLElement).save();
    }
  };

  useEffect(() => {
    if (!isLoading && isInitialized && hasAccess && category && bracket) {
      if (action === "download") {
        const element = document.querySelector(".print-container");
        if (element && html2pdf) {
          const opt = getHtml2PdfOptions(`Сітка_${category?.name || "категорія"}.pdf`);
          html2pdf().set(opt).from(element as HTMLElement).save().then(() => {
            setTimeout(() => window.close(), 1500);
          });
        }
      } else {
        const timer = setTimeout(() => {
          window.print();
        }, 600);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, isInitialized, hasAccess, bracket, action, category]);

  if (isLoading || !isInitialized) {
    return <PrintLoadingState message="Завантаження сітки..." />;
  }

  if (error) {
    return <PrintErrorState message={error} />;
  }

  if (!hasAccess) {
    return <PrintNoAccessState />;
  }

  return (
    <div className="light min-h-screen bg-white text-zinc-900 font-sans antialiased">

      {/* Панель керування */}
      <div className="no-print bg-zinc-900 border-b border-zinc-800 p-4 sticky top-0 flex items-center justify-between z-50 text-white select-none">
        <div className="flex flex-col text-left">
          <span className="font-bold text-xs uppercase tracking-wider text-amber-500">Друк сітки категорії</span>
          <span className="text-sm font-bold text-white truncate max-w-xs sm:max-w-md">{category?.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.close()}
            className="px-3.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-bold hover:bg-zinc-800 text-zinc-300 transition-colors"
          >
            Закрити
          </button>
          <button
            onClick={() => window.print()}
            className="px-3.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-bold hover:bg-zinc-800 text-zinc-300 transition-colors"
          >
            Друк
          </button>
          <button
            onClick={handleDownloadPdf}
            className="px-4 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-black hover:bg-amber-400 transition-all shadow-md shadow-amber-500/10"
          >
            Завантажити PDF
          </button>
        </div>
      </div>

      {/* Контент друку */}
      <div className="print-container p-2 w-full flex flex-col items-center">
        {category && (
          <PrintBracketSheet
            tournament={tournament}
            category={category}
            bracket={bracket}
          />
        )}
      </div>
    </div>
  );
}
