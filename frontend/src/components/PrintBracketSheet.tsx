import { useMemo } from "react";
import { BracketView } from "@/components/bracket/BracketView";
import type { BracketResponse, Category, Tournament } from "@/types/api";
import { getSortedParticipantsFromBracket } from "@/lib/printUtils";

interface PrintBracketSheetProps {
  tournament: Tournament | null;
  category: Category;
  bracket: BracketResponse | null;
}

export function PrintBracketSheet({
  tournament,
  category,
  bracket,
}: PrintBracketSheetProps) {
  const participantsList = useMemo(() => {
    return getSortedParticipantsFromBracket(bracket);
  }, [bracket]);

  return (
    <div className="w-full text-zinc-950 text-left border-b border-zinc-300 pb-4 mb-4">
      <div className="flex justify-between items-start gap-6">
        {/* Лівий блок: Інформація про турнір та категорію */}
        <div className="flex-1">
          <h1 className="text-xl font-black uppercase text-zinc-900 tracking-tight leading-tight">
            {tournament?.title}
          </h1>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mt-0.5">
            {tournament?.location} · {tournament && new Date(tournament.start_date).toLocaleDateString("uk-UA")}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-sm font-extrabold text-amber-600 uppercase">
              Категорія: {category.name}
            </span>
            <span className="text-[10px] bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-bold uppercase border border-zinc-200">
              {category.bracket_format_display}
            </span>
          </div>
        </div>

        {/* Правий блок: Фінальні результати для заповнення */}
        <div className="w-[45%] shrink-0 text-xs font-semibold">
          <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 border-b border-zinc-200 pb-0.5">
            🏆 Фінальні результати (вписує суддя)
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1.5">
            <div className="flex items-center gap-1">
              <span className="font-bold">🥇 1:</span>
              <span className="border-b border-zinc-400 flex-1 h-4 select-none min-w-[100px]"></span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold">🥈 2:</span>
              <span className="border-b border-zinc-400 flex-1 h-4 select-none min-w-[100px]"></span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold">🥉 3:</span>
              <span className="border-b border-zinc-400 flex-1 h-4 select-none min-w-[100px]"></span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold">🥉 3:</span>
              <span className="border-b border-zinc-400 flex-1 h-4 select-none min-w-[100px]"></span>
            </div>
          </div>
        </div>
      </div>

      {/* Нижній рядок: Список учасників в один рядок */}
      <div className="mt-3 text-[10px] text-zinc-600 border-t border-zinc-100 pt-2 flex flex-wrap gap-x-2 gap-y-1">
        <span className="font-extrabold text-zinc-800 uppercase tracking-wider">
          Учасники ({participantsList.length}):
        </span>
        <span className="font-medium text-zinc-700 leading-normal">
          {participantsList.map((reg, idx) => {
            const fullName = reg.athlete
              ? `${reg.athlete.last_name} ${reg.athlete.first_name[0]}.`
              : (reg.team?.name || "Команда");
            return `${idx + 1}. ${fullName}`;
          }).join(", ") || "немає зареєстрованих"}
        </span>
      </div>

      {bracket && bracket.rounds.length > 0 ? (
        <div className="w-full flex justify-center bg-white p-4 mt-2">
          <BracketView bracket={bracket} showPlaceholders={true} forcePrintMode={true} />
        </div>
      ) : (
        <div className="py-20 text-center text-zinc-400 italic text-sm">
          Сітку ще не згенеровано
        </div>
      )}
    </div>
  );
}
