import { cn } from "@/lib/utils";
import type { Match, Registration } from "@/types/api";

interface MatchCardProps {
  match: Match;
  /** Якщо true — менший режим (у списку) */
  compact?: boolean;
  onClick?: (match: Match) => void;
}

/** Ім'я учасника або "BYE" */
function participantName(reg: Registration | null): string {
  if (!reg) return "BYE";
  return reg.athlete?.full_name ?? `Учасник #${reg.id}`;
}

/** Назва клубу */
function participantClub(reg: Registration | null): string {
  if (!reg) return "";
  return reg.athlete?.club?.name ?? "";
}

export function MatchCard({ match, compact = false, onClick }: MatchCardProps) {
  const isBye   = !match.reg_first || !match.reg_second;
  const isDone  = match.status === "completed";
  const isLive  = match.status === "ongoing";

  const firstWon  = isDone && match.winner === match.reg_first?.id;
  const secondWon = isDone && match.winner === match.reg_second?.id;

  const handleClick = () => { if (onClick && !isBye) onClick(match); };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "rounded-lg border bg-card transition-all duration-200 overflow-hidden",
        !isBye && onClick && "cursor-pointer hover:border-amber-500/50 hover:shadow-md hover:shadow-amber-500/5",
        isLive && "border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30",
        isBye && "opacity-40",
        compact ? "min-w-[160px] w-40" : "min-w-[200px] w-52"
      )}
    >
      {/* Live-індикатор */}
      {isLive && (
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Live</span>
        </div>
      )}

      {/* Учасник 1 */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-2",
        firstWon && "bg-green-500/10",
        isDone && !firstWon && match.reg_first && "opacity-50",
      )}>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          {match.reg_first && (
            <span className="text-[9px] font-black text-red-500 bg-red-500/10 border border-red-500/20 px-1 rounded shrink-0 leading-none">
              AKA
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-sm font-medium truncate leading-tight",
              !match.reg_first && "text-muted-foreground italic",
              firstWon && "text-green-400 font-semibold",
            )}>
              {participantName(match.reg_first)}
            </p>
            {!compact && match.reg_first && (
              <p className="text-[10px] text-muted-foreground truncate">{participantClub(match.reg_first)}</p>
            )}
          </div>
        </div>
        <span className={cn(
          "font-mono text-base font-bold shrink-0 w-6 text-right",
          firstWon ? "text-green-400" : "text-foreground",
        )}>
          {match.reg_first ? match.score_first : ""}
        </span>
      </div>

      {/* Роздільник */}
      <div className="h-px bg-border mx-3" />

      {/* Учасник 2 */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-2",
        secondWon && "bg-green-500/10",
        isDone && !secondWon && match.reg_second && "opacity-50",
      )}>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          {match.reg_second && (
            <span className="text-[9px] font-black text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1 rounded shrink-0 leading-none">
              AO
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-sm font-medium truncate leading-tight",
              !match.reg_second && "text-muted-foreground italic",
              secondWon && "text-green-400 font-semibold",
            )}>
              {isBye && !match.reg_first ? "BYE" : participantName(match.reg_second)}
            </p>
            {!compact && match.reg_second && (
              <p className="text-[10px] text-muted-foreground truncate">{participantClub(match.reg_second)}</p>
            )}
          </div>
        </div>
        <span className={cn(
          "font-mono text-base font-bold shrink-0 w-6 text-right",
          secondWon ? "text-green-400" : "text-foreground",
        )}>
          {match.reg_second ? match.score_second : ""}
        </span>
      </div>

      {/* Метод перемоги */}
      {isDone && match.win_method && !compact && (
        <div className="px-3 pb-2">
          <span className="text-[10px] text-amber-500 uppercase font-bold tracking-wider">
            {match.win_method}
          </span>
        </div>
      )}
    </div>
  );
}
