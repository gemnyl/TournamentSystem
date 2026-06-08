import type { Match, Tatami, Category } from "@/types/api";
import { SCHEDULER_SETTINGS } from "./constants";

export interface ScheduleEstimates {
  matchStarts: Record<number, number>; // matchId -> timestamp ms
  categoryEstimates: Record<number, {
    startTime: number;
    tatamiNumber: number | null;
    isLive: boolean;
    isTatamiActive: boolean;
  }>;
}

/**
 * Прораховує орієнтовний час початку поєдинків та категорій у реальному часі.
 */
export function estimateSchedule(
  tatamis: Tatami[],
  matches: Match[],
  categories: Category[],
  settings = {
    athletePrepSeconds: SCHEDULER_SETTINGS.ATHLETE_PREP_SEC,
    categoryChangeoverSeconds: SCHEDULER_SETTINGS.CATEGORY_CHANGEOVER_SEC
  }
): ScheduleEstimates {
  const now = Date.now();
  const matchStarts: Record<number, number> = {};
  const categoryEstimates: Record<number, { startTime: number; tatamiNumber: number | null; isLive: boolean; isTatamiActive: boolean }> = {};

  // 1. Прораховуємо час початку поєдинків на кожному активному татамі
  tatamis.forEach(tatami => {
    if (!tatami.is_active) return;

    // Всі незавершені матчі цього татамі
    const tatamiMatches = matches.filter(m => m.tatami === tatami.id && m.status !== "completed");

    // Поточний матч ставимо першим, далі за чергою раундів
    const currentId = tatami.current_match;
    const sorted = [...tatamiMatches].sort((a, b) => {
      if (a.id === currentId) return -1;
      if (b.id === currentId) return 1;
      if (a.status === "ongoing" && b.status !== "ongoing") return -1;
      if (b.status === "ongoing" && a.status !== "ongoing") return 1;
      if (a.category !== b.category) {
        const catA = categories.find(c => c.id === a.category);
        const catB = categories.find(c => c.id === b.category);
        const orderA = catA?.schedule_order ?? 0;
        const orderB = catB?.schedule_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.category - b.category;
      }
      return a.round_index === b.round_index
        ? a.match_order - b.match_order
        : a.round_index - b.round_index;
    });

    let timeAccumulator = now;

    sorted.forEach((match, idx) => {
      matchStarts[match.id] = timeAccumulator;

      // Тривалість поєдинку (за замовчуванням 180с / 3хв)
      let durationMs = match.timer_duration_ms || 180_000;
      if (match.status === "ongoing") {
        // Для активного бою враховуємо скільки часу лишилось
        durationMs = Math.max(0, durationMs - match.timer_elapsed_ms);
      }
      timeAccumulator += durationMs;

      // Буфери між боями
      if (idx < sorted.length - 1) {
        timeAccumulator += settings.athletePrepSeconds * 1000;

        // Зміна категорії
        if (match.category !== sorted[idx + 1].category) {
          timeAccumulator += settings.categoryChangeoverSeconds * 1000;
        }
      }
    });
  });

  // 2. Визначаємо орієнтовний час для кожної категорії
  categories.forEach(cat => {
    const catMatches = matches.filter(m => m.category === cat.id);
    const remaining = catMatches.filter(m => m.status !== "completed");

    if (catMatches.length === 0) return;

    const isCompleted = catMatches.every(m => m.status === "completed");
    if (isCompleted) return;

    const firstRemaining = remaining[0];
    const tatamiId = firstRemaining?.tatami;
    const tatami = tatamis.find(t => t.id === tatamiId);

    const currentMatchId = tatami?.current_match && typeof tatami.current_match === "object"
      ? (tatami.current_match as any).id
      : tatami?.current_match;
    const isLive = !!catMatches.find(m => m.status === "ongoing") || (currentMatchId === firstRemaining?.id && currentMatchId !== null && currentMatchId !== undefined);

    // Шукаємо найменший час початку серед незіграних матчів
    let minStart = Infinity;
    remaining.forEach(m => {
      const start = matchStarts[m.id];
      if (start && start < minStart) minStart = start;
    });

    categoryEstimates[cat.id] = {
      startTime: minStart === Infinity ? now : minStart,
      tatamiNumber: tatami ? tatami.number : null,
      isLive: !!isLive,
      isTatamiActive: tatami ? tatami.is_active : true
    };
  });

  return { matchStarts, categoryEstimates };
}
