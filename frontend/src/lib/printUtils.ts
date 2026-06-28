export interface PrintUser {
  id: number;
  role: string;
}

export interface PrintTournament {
  organizer: number;
  staff_members?: number[];
  judges?: number[];
  chief_judge?: number | null;
}

/**
 * Checks if the user has permission to print/download brackets for a tournament.
 */
export function checkPrintAccess(
  user: PrintUser | null,
  isInitialized: boolean,
  tournament?: PrintTournament | null
): boolean {
  if (!isInitialized) return false;
  if (!user) return false;

  // High-level roles have absolute access
  if (
    user.role === "admin" ||
    user.role === "organizer" ||
    user.role === "staff" ||
    user.role === "judge"
  ) {
    return true;
  }

  // Tournament-specific permissions
  if (tournament) {
    if (tournament.organizer === user.id) return true;
    if (tournament.staff_members?.includes(user.id)) return true;
    if (tournament.judges?.includes(user.id)) return true;
    if (tournament.chief_judge === user.id) return true;
  }

  return false;
}

export function getHtml2PdfOptions(filename: string) {
  return {
    margin: 8,
    filename,
    image: { type: "jpeg" as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
  };
}

/**
 * Extracts unique participants from a bracket and sorts them alphabetically by name/team.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSortedParticipantsFromBracket(bracket?: any | null): any[] {
  if (!bracket || !bracket.rounds) return [];
  const seen = new Set<number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bracket.rounds.forEach((round: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    round.forEach((m: any) => {
      if (m.reg_first && !seen.has(m.reg_first.id)) {
        seen.add(m.reg_first.id);
        list.push(m.reg_first);
      }
      if (m.reg_second && !seen.has(m.reg_second.id)) {
        seen.add(m.reg_second.id);
        list.push(m.reg_second);
      }
    });
  });
  return list.sort((a, b) => {
    const nameA = a.athlete ? `${a.athlete.last_name} ${a.athlete.first_name}` : (a.team?.name || "");
    const nameB = b.athlete ? `${b.athlete.last_name} ${b.athlete.first_name}` : (b.team?.name || "");
    return nameA.localeCompare(nameB, "uk");
  });
}
