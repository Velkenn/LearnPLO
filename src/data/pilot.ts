// The For schools page's pilot request: checking it and writing it up as a feedback message.
// No DOM, so tests can import it.

export const KINDS = { school: 'Dealer school', card_room: 'Card room', other: 'Something else' } as const;
export const SIZES = ['1–10', '11–25', '26–50', 'More than 50'] as const;

export interface PilotRequest { name: string; org: string; kind: keyof typeof KINDS; email: string; size: string; notes: string }

/** What's missing or wrong, in the order the boxes appear, or null when it's ready to send. */
export function checkPilot(r: PilotRequest): { field: string; msg: string } | null {
  if (!r.name) return { field: 'pName', msg: 'Enter your name.' };
  if (!r.org) return { field: 'pOrg', msg: 'Enter your school or card room’s name.' };
  if (!r.email) return { field: 'pEmail', msg: 'Enter your email so I can write back.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return { field: 'pEmail', msg: 'That email doesn’t look right.' };
  return null;
}

/** The message as it reads on the stats dashboard. */
export function pilotMessage(r: PilotRequest): string {
  return [
    `Pilot request: ${r.org} (${KINDS[r.kind]})`,
    `From: ${r.name}`,
    r.size ? `Students per class: ${r.size}` : '',
    r.notes ? `\n${r.notes}` : '',
  ].filter(Boolean).join('\n').slice(0, 2000);
}
