/**
 * The on-device model sometimes says "I added it" without calling any tool.
 * This detects such claims so the loop can refuse to relay them.
 */
const CLAIM =
  /\b(added|created|saved|updated|appended|renamed|moved|deleted|removed|inserted|written|adicionei|adicionad[oa]|criei|criad[oa]|salvei|salv[oa]|atualizei|atualizad[oa]|inseri|inserid[oa]|renomeei|renomead[oa]|movi|movid[oa]|apaguei|exclu[ií]|escrevi)\b/i;
const NEGATION = /(n't|\bnot\b|\bcannot\b|\bunable\b|\bn[aã]o\b|\bnenhum)/i;

export function claimsChange(message: string): boolean {
  return CLAIM.test(message) && !NEGATION.test(message);
}
