// Les types de lectureSeule.mjs, pour le test qui l'importe (src/lib/gardefouLectureSeule.test.ts).

export interface Jeton {
  type: 'mot' | 'ident' | 'chaine' | 'nombre' | 'parametre' | 'signe'
  texte?: string
}

export interface Verdict {
  lectureSimple: boolean
  raison: string
}

export interface Decision {
  decision: 'allow' | 'ask' | 'deny'
  raison: string
}

export interface ReponseDuHook {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'allow' | 'ask' | 'deny'
    permissionDecisionReason: string
  }
}

export function lireLesJetons(sql: string): { jetons: Jeton[]; erreur?: undefined } | { erreur: string; jetons?: undefined }
export function jugerLaRequete(sql: unknown): Verdict
export function deciderPourLAppel(appel: unknown): Decision
export function lireLAppel(texte: string): unknown
export function reponseDuHook(decision: Decision): ReponseDuHook
export function repondreAuHook(entree: string): string
