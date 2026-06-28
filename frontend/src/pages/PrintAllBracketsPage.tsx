import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import type { BracketResponse, Category, Tournament } from "@/types/api";
import { useAuth } from "@/hooks/useAuth";
// @ts-ignore
import html2pdf from "html2pdf.js";
import { checkPrintAccess, getHtml2PdfOptions } from "@/lib/printUtils";
import { PrintErrorState, PrintLoadingState, PrintNoAccessState } from "@/components/PrintStateTemplates";
import { PrintBracketSheet } from "@/components/PrintBracketSheet";


export default function PrintAllBracketsPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isInitialized, fetchMe } = useAuth();
  const [searchParams] = useSearchParams();
  const action = searchParams.get("action") || "print";
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [brackets, setBrackets] = useState<Record<number, BracketResponse>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasAutoPrinted = useRef(false);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    async function loadAllData() {
      try {
        const tournRes = await api.get<Tournament>(`/tournaments/${id}/`);
        setTournament(tournRes.data);

        const catsRes = await api.get<Category[] | { results: Category[] }>(`/categories/?tournament=${id}`);
        const catsList = Array.isArray(catsRes.data) ? catsRes.data : catsRes.data.results;

        // Filter categories that have brackets
        const activeCats = catsList.filter(c => c.has_bracket);
        setCategories(activeCats);
        setSelectedCategoryIds(activeCats.map(c => c.id));

        if (activeCats.length === 0) {
          setIsLoading(false);
          return;
        }

        const bracketsMap: Record<number, BracketResponse> = {};
        let loadedCount = 0;

        await Promise.all(
          activeCats.map(async (cat) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const res = await api.get<any>(`/matches/bracket/?category=${cat.id}`);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const roundsData = res.data as { round_index: number; matches: any[] }[];
              const rounds = roundsData.map(r => r.matches);

              bracketsMap[cat.id] = {
                format: cat.bracket_format,
                rounds: rounds
              };
            } catch (err) {
              console.error(`Failed to load bracket for category ${cat.id}`, err);
            } finally {
              loadedCount++;
              setLoadingProgress(Math.round((loadedCount / activeCats.length) * 100));
            }
          })
        );

        setBrackets(bracketsMap);
      } catch (err) {
        console.error(err);
        setError("Помилка завантаження даних турніру.");
      } finally {
        setIsLoading(false);
      }
    }
    loadAllData();
  }, [id]);

  const hasAccess = useMemo(() => {
    return checkPrintAccess(user, isInitialized, tournament);
  }, [user, isInitialized, tournament]);

  const selectedCategories = useMemo(() => {
    return categories.filter(c => selectedCategoryIds.includes(c.id));
  }, [categories, selectedCategoryIds]);

  useEffect(() => {
    if (tournament) {
      document.title = `Усі сітки - ${tournament.title}`;
    }
  }, [tournament]);

  const handleDownloadPdf = () => {
    const element = document.querySelector(".print-container");
    if (element && html2pdf) {
      const opt = getHtml2PdfOptions(`Усі_сітки_${tournament?.title || "турнір"}.pdf`);
      html2pdf().set(opt).from(element as HTMLElement).save();
    }
  };

  useEffect(() => {
    if (!isLoading && isInitialized && hasAccess && categories.length > 0 && Object.keys(brackets).length > 0 && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      if (action === "download") {
        const element = document.querySelector(".print-container");
        if (element && html2pdf) {
          const opt = getHtml2PdfOptions(`Усі_сітки_${tournament?.title || "турнір"}.pdf`);
          html2pdf().set(opt).from(element as HTMLElement).save().then(() => {
            setTimeout(() => window.close(), 1500);
          });
        } else if (element) {
          window.print();
        }
      } else {
        const timer = setTimeout(() => {
          window.print();
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, isInitialized, hasAccess, categories, brackets, action, tournament]);

  if (isLoading || !isInitialized) {
    return <PrintLoadingState message="Завантаження сіток..." progress={loadingProgress} />;
  }

  if (error) {
    return <PrintErrorState message={error} />;
  }

  if (!hasAccess) {
    return <PrintNoAccessState />;
  }

  if (categories.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4 text-center">
        <div className="max-w-md space-y-2 p-6 border border-zinc-800 rounded-2xl bg-zinc-900/50">
          <h2 className="text-xl font-bold text-zinc-300">Сіток не знайдено</h2>
          <p className="text-xs text-zinc-500">
            У цього турніру немає категорій зі згенерованими сітками.
          </p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-1.5 rounded-lg bg-zinc-800 text-xs font-bold hover:bg-zinc-700 text-zinc-100 transition-colors"
          >
            Закрити вкладку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="light min-h-screen bg-white text-zinc-900 font-sans antialiased">

      {/* Панель керування */}
      <div className="no-print bg-zinc-900 border-b border-zinc-800 p-4 sticky top-0 flex flex-col gap-3.5 z-50 text-white select-none">
        <div className="flex items-center justify-between w-full">
          <div className="flex flex-col text-left">
            <span className="font-bold text-xs uppercase tracking-wider text-amber-500">Друк усіх сіток турніру</span>
            <span className="text-sm font-bold text-white truncate max-w-xs sm:max-w-md">{tournament?.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.close()}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-850 bg-zinc-950 text-xs font-bold hover:bg-zinc-800 text-zinc-300 transition-colors"
            >
              Закрити
            </button>
            <button
              onClick={() => window.print()}
              disabled={selectedCategoryIds.length === 0}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-850 bg-zinc-950 text-xs font-bold hover:bg-zinc-800 text-zinc-300 transition-colors"
            >
              Друк ({selectedCategoryIds.length})
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={selectedCategoryIds.length === 0}
              className="px-4 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-black hover:bg-amber-400 transition-all shadow-md shadow-amber-500/10 disabled:opacity-55 disabled:cursor-not-allowed"
            >
              Завантажити PDF ({selectedCategoryIds.length})
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-zinc-800/80 text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200 shrink-0">Категорії для експорту:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedCategoryIds(categories.map(c => c.id))}
              className="text-amber-500 hover:text-amber-400 font-bold px-1 transition-colors"
            >
              Обрати всі
            </button>
            <span className="text-zinc-700">|</span>
            <button
              onClick={() => setSelectedCategoryIds([])}
              className="text-zinc-500 hover:text-zinc-400 font-bold px-1 transition-colors"
            >
              Зняти всі
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 w-full pt-1 sm:pt-0 max-h-24 overflow-y-auto">
            {categories.map((cat) => {
              const isChecked = selectedCategoryIds.includes(cat.id);
              return (
                <label
                  key={cat.id}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                    isChecked
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                      : "bg-zinc-950/40 border-zinc-800/80 text-zinc-500 hover:bg-zinc-850 hover:text-zinc-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isChecked}
                    onChange={() => {
                      setSelectedCategoryIds(prev =>
                        isChecked ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                      );
                    }}
                  />
                  {cat.name}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Контент друку */}
      <div className="print-container p-2 w-full flex flex-col items-center">
        {selectedCategories.length === 0 ? (
          <div className="py-20 text-center text-zinc-400 italic text-sm no-print">
            Будь ласка, виберіть хоча б одну категорію для друку.
          </div>
        ) : (
          selectedCategories.map((cat, idx) => {
            const isLast = idx === selectedCategories.length - 1;
            const bracket = brackets[cat.id];

            return (
              <div
                key={cat.id}
                className={`w-full flex flex-col items-center pb-8 ${
                  isLast ? "" : "bracket-print-section border-b border-dashed border-zinc-200 mb-8"
                }`}
              >
                <PrintBracketSheet
                  tournament={tournament}
                  category={cat}
                  bracket={bracket}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
