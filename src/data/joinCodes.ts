// Class join codes and links, with no Supabase calls (so unit tests and any page can use them).
// A code is 8 letters and digits with no 0, O, 1, I or L (made by new_join_code() in the
// database), shown as K7Q2-PMXA. Dashes, spaces and case don't matter when typed.

/** "k7q2-pmxa", "K7Q2 PMXA" → "K7Q2PMXA". */
export const cleanCode = (code: string): string => code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** "K7Q2PMXA" → "K7Q2-PMXA". */
export const formatCode = (code: string): string => code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

/** The link a student opens to join: https://feltready.com/join/K7Q2PMXA. */
export const joinLink = (code: string, origin: string): string => `${origin}/join/${code}`;

/** The code in a join link's path (/join/K7Q2PMXA), or its ?code= for a link that lost the path. '' if none. */
export function codeFromUrl(path: string, search: string): string {
  const m = /^\/join\/([A-Za-z0-9-]+)\/?$/.exec(path);
  return cleanCode(m?.[1] || new URLSearchParams(search).get('code') || '');
}
