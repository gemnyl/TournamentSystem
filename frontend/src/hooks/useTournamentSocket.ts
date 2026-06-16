import { useCallback } from "react";
import type { Registration } from "@/types/api";
import { useWebSocket } from "./useWebSocket";

interface UseTournamentSocketOptions {
  onConnect?:    () => void;
  onDisconnect?: () => void;
}

/**
 * Хук підписки на WebSocket-оновлення турніру (реєстрації тощо).
 *
 * Підключається до ws://localhost:8000/ws/tournament/{tournamentId}/
 * через Vite proxy.
 * При розриві повторно підключається з exponential backoff.
 *
 * @param tournamentId          — id турніру
 * @param onRegistrationUpdate  — callback при зміні статусу реєстрації
 * @param options               — опційні колбеки connect/disconnect
 */
export function useTournamentSocket(
  tournamentId: number,
  onRegistrationUpdate: (registration: Registration) => void,
  options?: UseTournamentSocketOptions,
) {
  const urlPath = tournamentId ? `/ws/tournament/${tournamentId}/` : null;

  const handleMessage = useCallback((msg: unknown) => {
    const payload = msg as { type?: string; registration?: Registration };
    if (payload && payload.type === "registration.update" && payload.registration) {
      onRegistrationUpdate(payload.registration);
    }
  }, [onRegistrationUpdate]);

  useWebSocket(urlPath, handleMessage, options);
}
