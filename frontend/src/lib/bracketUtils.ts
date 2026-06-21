import type { Match } from "@/types/api";

/**
 * Допоміжна функція для отримання назви етапу відносно фіналу.
 */
function getStageName(
  orderIndex: number,
  total: number,
  labels: { final: string; semifinal: string; quarterfinal: string; defaultPrefix: string }
): string {
  if (orderIndex === total - 1 && total > 0) return labels.final;
  if (orderIndex === total - 2 && total > 1) return labels.semifinal;
  if (orderIndex === total - 3 && total > 2) return labels.quarterfinal;
  return `${labels.defaultPrefix} ${orderIndex + 1}`;
}

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

  const categoryId = match.category;
  const format = bracketFormat || "";

  // Фільтруємо всі матчі цієї категорії для аналізу структури раундів
  const catMatches = allMatches.filter((m) => m.category === categoryId);

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
      return getStageName(losersOrderIndex, losersRounds.length, {
        final: "Фінал нижньої сітки",
        semifinal: "Півфінал нижньої сітки",
        quarterfinal: "Чвертьфінал нижньої сітки",
        defaultPrefix: "Нижня сітка — Раунд",
      });
    }

    // Верхня сітка (Winners)
    const winnersOrderIndex = winnersRounds.indexOf(roundIdx);
    return getStageName(winnersOrderIndex, winnersRounds.length, {
      final: "Фінал верхньої сітки",
      semifinal: "Півфінал",
      quarterfinal: "Чвертьфінал",
      defaultPrefix: "Раунд",
    });
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
  return getStageName(winnersOrderIndex, winnersRounds.length, {
    final: "Фінал",
    semifinal: "Півфінал",
    quarterfinal: "Чвертьфінал",
    defaultPrefix: "Раунд",
  });
}
