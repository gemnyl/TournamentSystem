import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Match } from "@/types/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SPORT_TYPE_MAP: Record<string, string> = {
  karate: "Карате",
  judo: "Дзюдо",
  taekwondo: "Тхеквондо",
  grappling: "Грепплінг",
  boxing: "Бокс",
  kickboxing: "Кікбоксинг",
  wrestling: "Вільна боротьба",
};

export function formatSportType(sport: string | null | undefined): string {
  if (!sport) return "";
  const lower = sport.trim().toLowerCase();
  return SPORT_TYPE_MAP[lower] || sport;
}

export function getErrorMessage(error: unknown, defaultMessage: string): string {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? defaultMessage;
}

export function getOptimisticTimerUpdate(
  path: string,
  timerState: { started_at_ms: number | null; elapsed_ms: number },
  serverTimeOffset: number,
  match: Match
): { updatedMatch: Match | null; reqBody: { elapsed_ms: number } | undefined } {
  if (path === "pause") {
    const serverNow = Date.now() + serverTimeOffset;
    const currentElapsed = timerState.started_at_ms === null
      ? timerState.elapsed_ms
      : timerState.elapsed_ms + (serverNow - timerState.started_at_ms);
    const elapsed_ms = Math.round(Math.max(0, currentElapsed));
    return {
      updatedMatch: {
        ...match,
        timer_status: "paused" as const,
        timer_started_at: null,
        timer_elapsed_ms: elapsed_ms,
      },
      reqBody: { elapsed_ms }
    };
  } else if (path === "resume" || path === "start") {
    const estimatedStart = Date.now() + serverTimeOffset;
    return {
      updatedMatch: {
        ...match,
        timer_status: "running" as const,
        timer_started_at: new Date(estimatedStart).toISOString(),
      },
      reqBody: undefined
    };
  }
  return { updatedMatch: null, reqBody: undefined };
}
