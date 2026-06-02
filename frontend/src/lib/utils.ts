import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
