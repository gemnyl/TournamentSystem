import { cn } from "@/lib/utils";
import type { Match, Registration } from "@/types/api";

interface MatchCardProps {
  match: Match;
  /** Якщо true — менший режим (у списку) */
  compact?: boolean;
  onClick?: (match: Match) => void;
}

/** Ім'я учасника або "BYE" або "Очікується переможець" */
function participantName(reg: Registration | null, roundIndex: number): string {
  if (!reg) {
    return roundIndex > 1 ? "Очікується переможець" : "BYE";
  }
  return reg.athlete?.full_name ?? `Учасник #${reg.id}`;
}

/** Назва клубу */
function participantClub(reg: Registration | null): string {
  if (!reg) return "";
  return reg.athlete?.club?.name ?? "";
}

/** Повертає значок призового місця */
function getPlaceBadge(place: number | null | undefined): string {
  if (!place) return "";
  if (place === 1) return "🥇";
  if (place === 2) return "🥈";
  if (place === 3) return "🥉";
  return `(${place})`;
}

/** Повертає колір лівого бордера відповідно до рівня (поясу) атлета */
function getBeltColorClass(skillLevel?: string): string {
  if (!skillLevel) return "border-l-transparent";
  const belt = skillLevel.toLowerCase();
  if (belt.includes("білий") || belt.includes("жовтий") || belt.includes("white") || belt.includes("yellow")) {
    return "border-l-yellow-400";
  }
  if (belt.includes("помаранч") || belt.includes("зелен") || belt.includes("orange") || belt.includes("green")) {
    return "border-l-green-400";
  }
  if (belt.includes("синій") || belt.includes("blue")) {
    return "border-l-blue-400";
  }
  if (belt.includes("коричн") || belt.includes("brown")) {
    return "border-l-amber-700";
  }
  if (belt.includes("чорн") || belt.includes("black")) {
    return "border-l-zinc-800";
  }
  return "border-l-transparent";
}

export function MatchCard({ match, compact = false, onClick }: MatchCardProps) {
  const isBye   = !match.reg_first || !match.reg_second;
  const isDone  = match.status === "completed";
  const isLive  = match.status === "ongoing";
  const isKata  = match.judging_mode === "flags";

  const firstWon  = isDone && match.winner === match.reg_first?.id;
  const secondWon = isDone && match.winner === match.reg_second?.id;

  const displayScoreFirst = isKata ? (match.flags_aka ?? 0) : match.score_first;
  const displayScoreSecond = isKata ? (match.flags_ao ?? 0) : match.score_second;

  const handleClick = () => { if (onClick && !isBye) onClick(match); };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "rounded-xl border backdrop-blur-md bg-card/65 border-border/70 transition-all duration-300 overflow-hidden shadow-sm",
        "h-[108px] flex flex-col justify-center",
        !isBye && onClick && "cursor-pointer hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/5 hover:translate-y-[-1px]",
        isLive && "border-amber-500/80 shadow-md shadow-amber-500/20 ring-2 ring-amber-500/55 animate-pulse bg-amber-500/5",
        isBye && "opacity-30",
        compact ? "min-w-[190px] w-52" : "min-w-[210px] w-56"
      )}
    >
      {/* Live-індикатор */}
      {isLive && (
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">LIVE MATCH</span>
        </div>
      )}

      {/* Учасник 1 (AKA) */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-2.5 border-l-[4px] transition-all",
        getBeltColorClass(match.reg_first?.athlete?.skill_level),
        firstWon && "bg-emerald-500/10",
        isDone && !firstWon && match.reg_first && "opacity-40 filter grayscale-[20%]",
      )}>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="text-[8px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-1 py-0.5 rounded shrink-0 leading-none">
            AKA
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-xs font-semibold break-normal leading-tight text-foreground/90 flex items-center gap-1",
              !match.reg_first && "text-muted-foreground italic",
              firstWon && "text-emerald-400 font-bold",
            )}>
              {firstWon && <span className="text-emerald-500 shrink-0 font-bold">✓</span>}
              <span className="truncate">{participantName(match.reg_first, match.round_index)}</span>
              {match.reg_first?.place && match.reg_first.place > 0 && (
                <span className="text-[10px] shrink-0 font-bold" title={`${match.reg_first.place} місце`}>
                  {getPlaceBadge(match.reg_first.place)}
                </span>
              )}
            </p>
            {!compact && match.reg_first && (
              <p className="text-[9px] text-muted-foreground truncate">{participantClub(match.reg_first)}</p>
            )}
          </div>
        </div>
        <span className={cn(
          "font-mono text-base font-black shrink-0 w-6 text-right",
          firstWon ? "text-emerald-400" : "text-foreground/80",
        )}>
          {match.reg_first ? displayScoreFirst : ""}
        </span>
      </div>

      {/* Роздільник */}
      <div className="h-px bg-border/60 mx-3" />

      {/* Учасник 2 (AO) */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-2.5 border-l-[4px] transition-all",
        getBeltColorClass(match.reg_second?.athlete?.skill_level),
        secondWon && "bg-emerald-500/10",
        isDone && !secondWon && match.reg_second && "opacity-40 filter grayscale-[20%]",
      )}>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="text-[8px] font-bold text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1 py-0.5 rounded shrink-0 leading-none">
            AO
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-xs font-semibold break-normal leading-tight text-foreground/90 flex items-center gap-1",
              !match.reg_second && "text-muted-foreground italic",
              secondWon && "text-emerald-400 font-bold",
            )}>
              {secondWon && <span className="text-emerald-500 shrink-0 font-bold">✓</span>}
              <span className="truncate">{participantName(match.reg_second, match.round_index)}</span>
              {match.reg_second?.place && match.reg_second.place > 0 && (
                <span className="text-[10px] shrink-0 font-bold" title={`${match.reg_second.place} місце`}>
                  {getPlaceBadge(match.reg_second.place)}
                </span>
              )}
            </p>
            {!compact && match.reg_second && (
              <p className="text-[9px] text-muted-foreground truncate">{participantClub(match.reg_second)}</p>
            )}
          </div>
        </div>
        <span className={cn(
          "font-mono text-base font-black shrink-0 w-6 text-right",
          secondWon ? "text-emerald-400" : "text-foreground/80",
        )}>
          {match.reg_second ? displayScoreSecond : ""}
        </span>
      </div>

      {/* Метод перемоги */}
      {isDone && match.win_method && !compact && (
        <div className="px-3 pb-2.5 pt-1 border-t border-border/30 bg-muted/10">
          <span className="text-[9px] text-amber-500/90 font-bold tracking-wider uppercase">
            Перемога: {match.win_method}
          </span>
        </div>
      )}
    </div>
  );
}
