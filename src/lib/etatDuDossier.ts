// L'ÉTAT DU DOSSIER CHEZ LE CABINET, MONTRÉ AU CLIENT (ligne 51.5, partie C, étape C2 ; MEG3-Q6, « oui ») — la règle et
// les mots, sans lecture (la lecture : lib/etatDuDossierLecture.ts ; la carte : components/CarteEtatDuDossier.tsx).
//
// La base rend, par exercice, une PHASE et, pour un exercice validé, le jour de sa validation et si sa 2035 y est gardée
// (`phase_des_exercices`, supabase/preparees/20261106120000_phase_des_exercices.sql) — jamais un montant, un compte, un
// nombre, un libellé ni un nom. Ce module n'en déduit rien de plus : une réponse qu'il ne sait pas lire n'est ni « rien à
// dire » ni une liste, elle se SIGNALE ; et chaque phase se dit avec ce que la base prouve, pas davantage — « enregistrée »,
// jamais « déposée » (la base ne sait rien du dépôt), « en cours » pour ce qui ne se prouve pas.
//
// LE DRAPEAU : la migration est PRÉPARÉE, pas appliquée (une lecture neuve ouverte au client se présente au cabinet
// d'abord). Baissé, la carte de l'accueil ne lit rien et ne montre rien ; il se lève quand l'export porte la fonction
// (etatDuDossier.test.ts le confronte à l'export).
import type { ReponseDeLaBase } from './couvertureReleve'
import { formatDate } from './format'
import { messageErreur } from './messageErreur'

export const ETAT_DU_DOSSIER_EXPORTE: boolean = false

export type PhaseDUnExercice = 'pieces_attendues' | 'en_revision' | 'en_cours' | 'validee'

export interface EtatDUnExercice {
  annee: number
  phase: PhaseDUnExercice
  /** Le jour de la validation, à Paris (AAAA-MM-JJ) ; nul sauf pour un exercice validé. */
  valideLe: string | null
  /** La 2035 gardée avec l'exercice validé (un dossier en trésorerie) ; faux sinon. */
  declaration2035: boolean
}

export type LectureDeLEtat =
  | { complete: true; exercices: EtatDUnExercice[] }
  | { complete: false; motif: string }

const PHASES = new Set<string>(['pieces_attendues', 'en_revision', 'en_cours', 'validee'])
const CLES = ['annee', 'declaration_2035', 'phase', 'valide_le']

function estUnJourCivil(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/**
 * Les exercices rendus par `phase_des_exercices`, chacun `{ annee, phase, valide_le, declaration_2035 }`, du plus récent
 * au plus ancien. Toute autre forme rend `null` : une clé de plus (la base ne doit rien rendre d'autre), une phase
 * inconnue, une date sur un exercice non validé ou une 2035 hors d'un exercice validé, deux fois la même année, un ordre
 * qui n'est pas celui de la base.
 */
export function exercicesDeLaBase(rendu: unknown): EtatDUnExercice[] | null {
  if (!Array.isArray(rendu)) return null
  const exercices: EtatDUnExercice[] = []
  for (const element of rendu) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return null
    const ligne = element as Record<string, unknown>
    if (Object.keys(ligne).sort().join(',') !== CLES.join(',')) return null
    const { annee, phase, valide_le: valideLe, declaration_2035: declaration2035 } = ligne
    if (typeof annee !== 'number' || !Number.isInteger(annee) || annee < 2000 || annee > 2100) return null
    if (typeof phase !== 'string' || !PHASES.has(phase)) return null
    if (typeof declaration2035 !== 'boolean') return null
    if (phase === 'validee' ? !estUnJourCivil(valideLe) : valideLe !== null || declaration2035) return null
    const precedent = exercices[exercices.length - 1]
    if (precedent && precedent.annee <= annee) return null
    exercices.push({ annee, phase: phase as PhaseDUnExercice, valideLe: valideLe as string | null, declaration2035 })
  }
  return exercices
}

/** La réponse de la base à `phase_des_exercices` : un refus ou une valeur illisible se SIGNALENT, sans exercice. */
export function lectureDeLEtat(reponse: ReponseDeLaBase): LectureDeLEtat {
  if (reponse.error) return { complete: false, motif: `lecture refusée : ${messageErreur(reponse.error, 'raison inconnue')}` }
  const exercices = exercicesDeLaBase(reponse.data)
  if (!exercices) return { complete: false, motif: 'réponse illisible' }
  return { complete: true, exercices }
}

/**
 * La lecture telle que l'écran la fait : `lireLEtatDuDossier(supabase.rpc('phase_des_exercices', { p_dossier_id }))`. La
 * requête est ATTENDUE ici et son erreur lue ; une requête qui lève tombe du côté signalé — la promesse ne rejette jamais.
 */
export async function lireLEtatDuDossier(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureDeLEtat> {
  try {
    return lectureDeLEtat(await requete)
  } catch (erreur) {
    return { complete: false, motif: `lecture impossible : ${messageErreur(erreur, 'raison inconnue')}` }
  }
}

// ── Les mots du client ─────────────────────────────────────────────────────────
// Tutoiement, aucun onglet, rien du travail du cabinet au-delà de la phase (espaceVentes.ts, `MOTS_DU_CABINET`).

export const TITRE_DE_LA_CARTE = 'Ton dossier chez ton cabinet'
export const SI_LA_LECTURE_MANQUE = 'L’état de ton dossier n’a pas pu être lu. Recharge la page dans un moment.'

/** La phrase d'un exercice : ce que la base prouve de sa phase, et rien de plus. */
export function phraseDeLExercice(e: EtatDUnExercice): string {
  switch (e.phase) {
    case 'pieces_attendues':
      return 'Ton cabinet attend encore tes pièces de cette année.'
    case 'en_revision':
      return 'Ton cabinet révise tes comptes.'
    case 'en_cours':
      return 'En cours chez ton cabinet.'
    case 'validee':
      return `Comptes validés le ${formatDate(e.valideLe)}${e.declaration2035 ? ', ta 2035 est enregistrée' : ''}.`
  }
}

/** La pastille d'un exercice : en attente de toi, en cours chez le cabinet, ou fait. */
export function statutDeLExercice(e: EtatDUnExercice): 'warning' | 'neutral' | 'ok' {
  return e.phase === 'pieces_attendues' ? 'warning' : e.phase === 'validee' ? 'ok' : 'neutral'
}
