import { BracketRound } from "./BracketRound";
import { RoundRobinTable } from "./RoundRobinTable";
import type { BracketResponse, Match } from "@/types/api";

interface BracketViewProps {
  bracket: BracketResponse;
  onMatchClick?: (match: Match) => void;
}

/**
 * Головний компонент візуалізації сітки.
 * Для single/double_elimination — горизонтальна прокрутка з колонками раундів.
 * Для round_robin — таблиця RoundRobinTable.
 */
export function BracketView({ bracket, onMatchClick }: BracketViewProps) {
  if (bracket.format === "round_robin") {
    const allMatches = bracket.rounds.flat();
    return <RoundRobinTable matches={allMatches} />;
  }

  // single_elimination / double_elimination
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex items-start gap-12 min-w-max px-2 py-2">
        {bracket.rounds.map((roundMatches, idx) => (
          <BracketRound
            key={idx}
            roundIndex={idx}
            totalRounds={bracket.rounds.length}
            matches={roundMatches}
            onMatchClick={onMatchClick}
          />
        ))}
      </div>
    </div>
  );
}
