import { ajouterJours } from './format'
import type { LigneBancaire } from './types'

// LA CONNEXION BANCAIRE, CÔTÉ APPLICATION (ligne 24 de la feuille de route, preuve de concept sur le bac
// à sable d'Enable Banking). La fonction serveur `banque-connexion` parle au prestataire et RENVOIE les
// mouvements ; c'est l'écran qui les importe, sur le clic, par le même chemin qu'un relevé. Ce module
// porte ce que l'écran décide sans rien appeler : la période proposée, ce qui s'importe vraiment, et ce
// qu'il faut dire de l'accord de la banque.

export type EnvironnementBancaire = 'SANDBOX' | 'PRODUCTION'
export type TypeAcces = 'business' | 'personal'

export const LIBELLES_TYPE_ACCES: Record<TypeAcces, string> = {
  business: 'espace professionnel',
  personal: 'espace particulier',
}

/** Un compte qu'ouvre l'accord, tel que la fonction le montre : jamais son identifiant, jamais l'IBAN entier. */
export interface CompteVu {
  empreinte: string
  nom: string | null
  devise: string | null
  iban_fin: string | null
  mouvements_lisibles: boolean
}

export interface ConnexionVue {
  banque_nom: string
  banque_pays: string
  type_acces: TypeAcces
  environnement: EnvironnementBancaire
  etat: 'en_attente' | 'active'
  valide_jusqu_au: string | null
  derniere_recuperation: string | null
  created_at: string
  compte_empreinte: string | null
  comptes: CompteVu[]
}

export interface StatutConnexion {
  configuree: boolean
  connexion: ConnexionVue | null
}

export interface BanqueProposee {
  nom: string
  pays: string
  types_acces: TypeAcces[]
  accord_jours: number | null
}

export interface MouvementRecupere {
  id_externe: string
  date: string
  libelle: string
  montant: number
}

export interface EcartsRecuperation {
  non_comptabilises: number
  autre_devise: number
  hors_periode: number
  illisibles: number
  doublons: number
}

export interface Recuperation {
  du: string
  au: string
  complete: boolean
  motif: string | null
  mouvements: MouvementRecupere[]
  ecartes: EcartsRecuperation
  banque_nom: string
  environnement: EnvironnementBancaire
  compte: { nom: string | null; iban_fin: string | null } | null
  avertissement: string | null
}

/** Ce que porte chaque mouvement importé de la banque, pour le retrouver comme on retrouve un relevé. */
export function sourceDeLaConnexion(banque: string): string {
  return `Connexion bancaire — ${banque}`
}

// Ce qu'une banque rend sans redemander l'accord du titulaire : les 90 derniers jours, BORNES COMPRISES,
// donc à partir de 89 jours avant aujourd'hui (DSP2). Seule la lecture qui suit l'accord peut remonter
// plus loin. Mesuré sur le bac à sable de BBVA le 30/09/2026 : une première lecture de 272 jours rendue,
// la même refusée vingt-cinq secondes plus tard (422, « Wrong transactions period requested »). Et un jour
// de trop suffit à se faire refuser : 90 jours avant aujourd'hui en font 91 avec les deux bornes.
const JOURS_SANS_NOUVEL_ACCORD = 89

/**
 * La période proposée. Elle REPREND au dernier mouvement déjà récupéré de la banque — ce jour-là compris :
 * l'identifiant externe empêche d'importer deux fois le même mouvement, et un jour à moitié récupéré
 * se complète. Sans récupération précédente, elle commence le LENDEMAIN du dernier mouvement du relevé :
 * un mouvement importé d'un fichier n'a pas d'identifiant, et la même opération relue à la banque ne se
 * reconnaîtrait qu'à sa date et son montant (voir `planImport`). Sur un relevé vide : 90 jours.
 *
 * Une fois une lecture complète faite sous l'accord en cours (`dejaLueSousCetAccord`), la banque ne rend
 * plus que 90 jours : la période s'y BORNE, et `debutVoulu` dit où elle aurait commencé — l'écran le dit,
 * avec le renouvellement de l'accord pour remonter jusque-là. Proposer quand même la période voulue
 * ferait refuser chaque récupération, sans que rien dise pourquoi.
 */
export function periodeParDefaut(
  lignes: readonly Pick<LigneBancaire, 'date' | 'id_externe'>[], aujourdHui: string, dejaLueSousCetAccord: boolean,
): { du: string; au: string; debutVoulu: string | null } {
  const plusRecente = (dates: string[]) => dates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null)
  const recuperee = plusRecente(lignes.filter((l) => l.id_externe !== null).map((l) => l.date))
  const duReleve = plusRecente(lignes.map((l) => l.date))
  const borne = ajouterJours(aujourdHui, -JOURS_SANS_NOUVEL_ACCORD)
  const voulu = recuperee ?? (duReleve !== null ? ajouterJours(duReleve, 1) : borne)
  const du = voulu > aujourdHui ? aujourdHui : voulu
  if (dejaLueSousCetAccord && du < borne) return { du: borne, au: aujourdHui, debutVoulu: du }
  return { du, au: aujourdHui, debutVoulu: null }
}

const cleDateMontant = (date: string, montant: number) => `${date}|${montant.toFixed(2)}`

/**
 * Ce qui s'importe vraiment. Deux filtres, et ils ne se valent pas :
 *   - DÉJÀ IMPORTÉ : l'identifiant externe est dans le relevé — la base le refuserait de toute façon
 *     (`lignes_bancaires_id_externe_unique`), l'écran le dit avant ;
 *   - DÉJÀ DANS UN RELEVÉ IMPORTÉ EN FICHIER : un mouvement de CSV ou de PDF n'a pas d'identifiant, et
 *     son libellé n'est jamais celui de la banque. Il ne se reconnaît qu'à sa date et son montant — et
 *     un à un : deux cafés du même prix le même jour, dont un seul est dans le fichier, en laissent un à
 *     importer. Importer quand même compterait l'opération deux fois dans tout ce qui suit.
 * Une date décalée d'un jour entre le fichier et la banque échappe au second filtre : c'est pourquoi la
 * période proposée commence après le dernier mouvement du relevé.
 */
export function planImport(
  mouvements: readonly MouvementRecupere[],
  lignes: readonly Pick<LigneBancaire, 'date' | 'montant' | 'id_externe'>[],
): { aImporter: MouvementRecupere[]; dejaImportes: MouvementRecupere[]; dansUnReleve: MouvementRecupere[] } {
  const identifiants = new Set(lignes.flatMap((l) => (l.id_externe === null ? [] : [l.id_externe])))
  const duFichier = new Map<string, number>()
  for (const l of lignes) {
    if (l.id_externe !== null) continue
    const cle = cleDateMontant(l.date, Number(l.montant))
    duFichier.set(cle, (duFichier.get(cle) ?? 0) + 1)
  }
  const aImporter: MouvementRecupere[] = []
  const dejaImportes: MouvementRecupere[] = []
  const dansUnReleve: MouvementRecupere[] = []
  for (const m of mouvements) {
    if (identifiants.has(m.id_externe)) { dejaImportes.push(m); continue }
    const cle = cleDateMontant(m.date, m.montant)
    const restant = duFichier.get(cle) ?? 0
    if (restant > 0) {
      duFichier.set(cle, restant - 1)
      dansUnReleve.push(m)
      continue
    }
    aImporter.push(m)
  }
  return { aImporter, dejaImportes, dansUnReleve }
}

/** Les jours entiers avant la fin de l'accord — négatif quand elle est passée, null quand on ne la connaît pas. */
export function joursAvantExpiration(valideJusquAu: string | null, maintenant: Date): number | null {
  if (!valideJusquAu) return null
  const fin = Date.parse(valideJusquAu)
  if (Number.isNaN(fin)) return null
  return Math.floor((fin - maintenant.getTime()) / 86_400_000)
}

// Un accord qui expire sous ce délai invite à le renouveler : la DSP2 le borne à 180 jours, et un accord
// expiré ne rend plus rien — la récupération suivante se heurterait à un refus.
export const JOURS_ALERTE_ACCORD = 14

/** Ce qui a été écarté d'une récupération, en une phrase — ou null quand rien ne l'a été. */
export function phraseEcartes(e: EcartsRecuperation): string | null {
  const morceaux = [
    e.non_comptabilises > 0 && `${e.non_comptabilises} pas encore comptabilisé${e.non_comptabilises > 1 ? 's' : ''} par la banque`,
    e.autre_devise > 0 && `${e.autre_devise} dans une autre devise que l’euro`,
    e.hors_periode > 0 && `${e.hors_periode} hors de la période`,
    e.illisibles > 0 && `${e.illisibles} illisible${e.illisibles > 1 ? 's' : ''} (sans date, sans sens ou sans montant)`,
    e.doublons > 0 && `${e.doublons} rendu${e.doublons > 1 ? 's' : ''} deux fois par la banque`,
  ].filter((m): m is string => typeof m === 'string')
  return morceaux.length === 0 ? null : `Écartés : ${morceaux.join(', ')}.`
}
