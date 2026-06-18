import type { Match } from "@/types/api";

/**
 * Динамічно визначає зрозумілу назву раунду (етапу) для відображення в інтерфейсі.
 * Вираховує назви відносно фіналів на основі формату сітки.
 *
 * @param match Поточний поєдинок
 * @param allMatches Усі поєдинки турніру/категорії для розрахунку глибини сітки
 * @param bracketFormat Явно переданий формат сітки (пріоритетний)
 */
export function getRoundName(match: Match, allMatches: Match[], bracketFormat?: string): string {
  if (!match) return "";

  const categoryId = match.category_id || (typeof match.category === "object" ? (match.category as unknown as Record<string, unknown>)?.id : match.category);

  // Визначаємо формат сітки: пріоритет у переданого аргументу, потім шукаємо в об'єкті
  const format = bracketFormat || match.category_bracket_format || (typeof match.category === "object" ? (match.category as unknown as Record<string, unknown>)?.bracket_format : undefined);

  // Фільтруємо всі матчі цієї категорії для аналізу структури раундів
  const catMatches = allMatches.filter((m) => {
    const mCatId = m.category_id || (typeof m.category === "object" ? (m.category as unknown as Record<string, unknown>)?.id : m.category);
    return mCatId === categoryId;
  });

  // Збираємо унікальні раунди для Winners та Losers сіток
  const winnersRounds = Array.from(
    new Set(catMatches.filter((m) => m.round_index < 100).map((m) => m.round_index))
  ).sort((a, b) => a - b);

  const losersRounds = Array.from(
    new Set(catMatches.filter((m) => m.round_index >= 100 && m.round_index < 200).map((m) => m.round_index))
  ).sort((a, b) => a - b);

  const roundIdx = match.round_index;
  const isBracketReset = match.is_bracket_reset;

  // 1. Double Elimination
  if (format === "double_elimination") {
    // Суперфінали
    if (roundIdx >= 200) {
      return isBracketReset || roundIdx === 201 ? "Суперфінал (Матч-реванш)" : "Суперфінал";
    }

    // Нижня сітка (Losers)
    if (roundIdx >= 100 && roundIdx < 200) {
      const losersOrderIndex = losersRounds.indexOf(roundIdx);
      const totalLosers = losersRounds.length;

      if (losersOrderIndex === totalLosers - 1 && totalLosers > 0) return "Фінал нижньої сітки";
      if (losersOrderIndex === totalLosers - 2 && totalLosers > 1) return "Півфінал нижньої сітки";
      if (losersOrderIndex === totalLosers - 3 && totalLosers > 2) return "Чвертьфінал нижньої сітки";

      return `Нижня сітка — Раунд ${losersOrderIndex + 1}`;
    }

    // Верхня сітка (Winners)
    const winnersOrderIndex = winnersRounds.indexOf(roundIdx);
    const totalWinners = winnersRounds.length;

    if (winnersOrderIndex === totalWinners - 1 && totalWinners > 0) return "Фінал верхньої сітки";
    if (winnersOrderIndex === totalWinners - 2 && totalWinners > 1) return "Півфінал";
    if (winnersOrderIndex === totalWinners - 3 && totalWinners > 2) return "Чвертьфінал";

    return `Раунд ${winnersOrderIndex + 1}`;
  }

  // 2. Швейцарська система (Swiss)
  if (format === "swiss") {
    return `Тур ${roundIdx + 1}`;
  }

  // 3. Кругова сітка (Round Robin)
  if (format === "round_robin") {
    return `Раунд ${roundIdx}`;
  }

  // 4. Олімпійська сітка (Single Elimination / Single Repechage)
  const winnersOrderIndex = winnersRounds.indexOf(roundIdx);
  const totalWinners = winnersRounds.length;

  if (winnersOrderIndex === totalWinners - 1 && totalWinners > 0) return "Фінал";
  if (winnersOrderIndex === totalWinners - 2 && totalWinners > 1) return "Півфінал";
  if (winnersOrderIndex === totalWinners - 3 && totalWinners > 2) return "Чвертьфінал";

  return `Раунд ${winnersOrderIndex + 1}`;
}
