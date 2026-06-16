import { useCallback } from "react";
import type { Match } from "@/types/api";
import { useWebSocket } from "./useWebSocket";

interface UseMatchUpdatesOptions {
  onConnect?:    () => void;
  onDisconnect?: () => void;
}

/**
 * Хук підписки на WebSocket-оновлення матчів категорії.
 *
 * Підключається до ws://localhost:8000/ws/category/{categoryId}/
 * через Vite proxy (/ws → ws://localhost:8000/ws).
 * При розриві повторно підключається з exponential backoff (до 30с).
 *
 * @param categoryId  — id категорії
 * @param onUpdate    — callback при надходженні оновлення матчу
 * @param options     — опційні колбеки connect/disconnect
 */
export function useMatchUpdates(
  categoryId: number,
  onUpdate: (match: Match) => void,
  options?: UseMatchUpdatesOptions,
) {
  const urlPath = categoryId ? `/ws/category/${categoryId}/` : null;

  const handleMessage = useCallback((msg: unknown) => {
    const payload = msg as { type?: string; match?: Match };
    if (payload && payload.type === "match.event" && payload.match) {
      onUpdate(payload.match);
    }
  }, [onUpdate]);

  useWebSocket(urlPath, handleMessage, options);
}
