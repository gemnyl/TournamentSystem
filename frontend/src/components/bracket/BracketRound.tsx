import { MatchCard } from "./MatchCard";
import type { Match } from "@/types/api";

interface BracketRoundProps {
  roundIndex: number;
  totalRounds: number;
  matches: Match[];
  onMatchClick?: (match: Match) => void;
}

/**
 * Колонка одного раунду в single-elimination сітці.
 * Вертикальний відступ між матчами збільшується в міру просування по раундах,
 * щоб переможці "зливались" до центру (приблизна візуалізація без SVG-ліній).
 */
export function BracketRound({ roundIndex, totalRounds, matches, onMatchClick }: BracketRoundProps) {
  // Назва раунду
  const roundLabel = () => {
    const fromEnd = totalRounds - 1 - roundIndex;
    if (fromEnd === 0) return "Фінал";
    if (fromEnd === 1) return "Півфінал";
    if (fromEnd === 2) return "Чвертьфінал";
    return `Раунд ${roundIndex + 1}`;
  };

  /**
   * Відступ між матчами: у першому раунді — 0, далі збільшується.
   * gap = cardHeight * (2^roundIndex - 1), де cardHeight ≈ 88px
   */
  const gapBetween = roundIndex === 0 ? 12 : Math.pow(2, roundIndex) * 44 - 44 + 12;
  // Верхній відступ: половина першого gap, щоб перший матч центрувався
  const paddingTop = roundIndex === 0 ? 0 : gapBetween / 2;

  return (
    <div className="flex flex-col items-center min-w-[220px]">
      {/* Заголовок раунду */}
      <div className="mb-4 px-3 py-1 rounded-md bg-muted/50 border border-border">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {roundLabel()}
        </span>
      </div>

      {/* Матчі */}
      <div className="flex flex-col" style={{ gap: gapBetween, paddingTop }}>
        {matches.map((match) => (
          <MatchCard key={match.id} match={match} onClick={onMatchClick} />
        ))}
      </div>
    </div>
  );
}
