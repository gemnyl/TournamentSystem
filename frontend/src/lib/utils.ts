/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
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

export function formatAthleteName(ath: any): string {
  if (!ath) return "";

  let first = (ath.first_name || "").trim();
  let last = (ath.last_name || "").trim();
  let full = (ath.full_name || "").trim();

  // Якщо немає імені та прізвища окремо, але є full_name, розбиваємо його
  if (!first && !last && full) {
    const parts = full.split(/\s+/);
    if (parts.length >= 3) {
      // Відкидаємо по-батькові (останнє слово), якщо є 3 або більше слів
      return parts.slice(0, 2).join(" ");
    }
    return full;
  }

  // Якщо ім'я містить по-батькові (наприклад, "Євген Олександрович")
  if (first) {
    const firstParts = first.split(/\s+/);
    if (firstParts.length > 1) {
      const lastPart = firstParts[firstParts.length - 1].toLowerCase();
      // Перевіряємо закінчення типових патронімів (по-батькові)
      if (
        lastPart.endsWith("ович") ||
        lastPart.endsWith("евич") ||
        lastPart.endsWith("євич") ||
        lastPart.endsWith("івна") ||
        lastPart.endsWith("евна") ||
        lastPart.endsWith("євна") ||
        lastPart.endsWith("ївна") ||
        lastPart.endsWith("ич") ||
        lastPart.endsWith("іч")
      ) {
        first = firstParts.slice(0, -1).join(" ");
      }
    }
  }

  if (last && first) {
    return `${last} ${first}`;
  }
  return first || last || full;
}

export function formatRegistrationName(reg: any): string {
  if (!reg) return "";
  if (reg.athlete) {
    const name = formatAthleteName(reg.athlete);
    if (name) return name;
  }
  if (reg.team) {
    const teamName = reg.team.name;
    const athletesList = reg.team.athletes?.map((a: any) => formatAthleteName(a)).join(", ");
    const name = athletesList ? `${teamName} (${athletesList})` : teamName;
    if (name) return name;
  }
  return reg.id ? `Учасник #${reg.id}` : "";
}

export function formatRegistrationClub(reg: any): string {
  if (!reg) return "";
  return reg.athlete?.club?.name ?? reg.team?.club?.name ?? "";
}

// Calculate age as of reference date
export function getAgeAsOf(birthDateStr: string, refDateStr: string): number {
  const birthDate = new Date(birthDateStr);
  const refDate = new Date(refDateStr);
  let age = refDate.getFullYear() - birthDate.getFullYear();
  const m = refDate.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
