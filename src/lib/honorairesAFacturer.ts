// « À FACTURER » : LES HONORAIRES DU CABINET (ligne 47, lot LM7 ; LM-Q1, LM-Q3 et LM-Q7 du 11/11/2026). Le cabinet facture
// ses honoraires depuis son propre dossier (LM1), par la facturation de tout dossier : une lettre de mission ACCEPTÉE (LM4)
// fige des lignes d'honoraires — un forfait par mois, trimestre ou année civils, un prix par tâche —, et chaque période d'un
// forfait, chaque tâche faite, se facture UNE fois. Le clic crée un brouillon par `facturer_honoraires`, qui lie la facture
// à ce qu'elle facture (`honoraires_factures`) ; la facture se valide une par une, comme toute facture. Une facture
// créditée EN ENTIER par ses avoirs rend sa période à facturer ; un avoir partiel la laisse facturée ; un brouillon
// supprimé la rend aussi.
// La base tient la règle (la migration `honoraires_factures`, PRÉPARÉE le 11/11/2026, supabase/preparees/) ; ce module la
// redit, pur, pour l'écran : les refus de la fonction et de sa garde, dans leur ordre et à leurs mots ; la forme d'une
// période ; la lettre en vigueur ; ce qu'un avoir rend ; le libellé de chaque ligne ; et ce qui se DÉDUIT — les périodes
// « à facturer », rien de cela ne se stocke. Rien ne s'en lit tant que le drapeau est baissé. Récit : HISTORIQUE.md,
// « 11/11/2026 — LM7 ». Sources : décret n° 2012-432, art. 158 (les honoraires libres, que la lettre fige) ; CGI, art. 289
// et ann. II, art. 242 nonies A (la facture et la période de la prestation).
//
// LE PRORATA AU JOUR PRÈS (LM7-Q4, réponse (C) du cabinet du 11/11/2026). Un forfait se facture pour les jours où sa lettre
// est en vigueur dans chaque mois, trimestre ou année civils de sa périodicité : la période entière, ou la part de la
// lettre qui commence ou finit en cours de période (sa date d'effet, sa résiliation, la fin de sa première période sans
// reconduction, l'avenant qui la remplace) — l'avenant facturant les siens, au prix de sa lettre. La part, en centimes
// entiers : arrondi(P × b / n) − arrondi(P × a / n) (`centimesAuProrata`, la règle de `honoraires_au_prorata`, confrontée
// par la batterie de src/test/batterieDesProrata.ts) ; deux parts d'un même mois au même prix font ce prix, jamais un
// centime de plus. Une tâche ne se proratise pas. Récit : HISTORIQUE.md, « LM5Q2-Q1 ET LM7-Q4 ».

import { lettresEnVigueur, type LettreLue } from './lettresDeMission'
import { calculerLigne } from './montantsFacture'
import { prorataArrondi } from './ventesFacturees'

/** Levé le jour où la migration `honoraires_factures` est en production (son fichier dans supabase/schema/). */
export const HONORAIRES_FACTURES_PREVUS: boolean = false

/** Les taux que `facturer_honoraires` accepte : 20 %, 8,5 % (Guadeloupe, Martinique, La Réunion), nul (franchise). */
export const TAUX_DES_HONORAIRES: readonly number[] = [20, 8.5, 0]

interface Refus { cle: string; code: string; modele: string }

/** Les refus de `facturer_honoraires` puis de sa garde, dans leur ordre, à leurs mots et à leur code. */
export const REFUS_DE_LA_FACTURATION: readonly Refus[] = [
  { cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'horsDuDossierDuCabinet', code: '23514', modele: 'Les honoraires se facturent dans le dossier du cabinet.' },
  { cle: 'nombre', code: '22023', modele: 'Une facture d’honoraires porte de une à cinquante périodes ou tâches.' },
  { cle: 'forme', code: '22023', modele: 'Un élément à facturer se lit : la lettre, le rang de sa ligne d’honoraires, le début et la fin de sa période.' },
  { cle: 'taux', code: '22023', modele: 'Le taux de TVA des honoraires est de 20 %, de 8,5 % (Guadeloupe, Martinique, La Réunion) ou nul (franchise).' },
  { cle: 'cles', code: '22023', modele: 'La facture ne reçoit ici que son échéance, l’e-mail du client, ses mentions et ses notes : le reste vient de la lettre et des dossiers.' },
  { cle: 'double', code: '22023', modele: 'Un élément à facturer figure deux fois dans la demande.' },
  { cle: 'introuvable', code: 'P0002', modele: 'Lettre de mission introuvable dans ce dossier.' },
  { cle: 'nonAcceptee', code: '22023', modele: 'Une lettre de mission se facture une fois acceptée.' },
  { cle: 'unSeulClient', code: '22023', modele: 'Une facture d’honoraires s’adresse à un seul client.' },
  { cle: 'ligneIntrouvable', code: '22023', modele: 'Ligne d’honoraires introuvable dans la lettre.' },
  { cle: 'tempsPasse', code: '22023', modele: 'Le temps passé ne se facture pas encore (LM9).' },
  { cle: 'periodeDuForfait', code: '22023', modele: 'Une période de forfait tient dans un mois, un trimestre ou une année civils, selon sa périodicité.' },
  { cle: 'periodeDeLaTache', code: '22023', modele: 'La période d’une tâche tient en un an au plus, de son début à sa fin.' },
  { cle: 'pasCommencee', code: '22023', modele: 'Une période ne se facture pas avant d’avoir commencé.' },
  { cle: 'horsDeVigueur', code: '22023', modele: 'La lettre n’est pas en vigueur pour cette période.' },
  { cle: 'joursDeLaLettre', code: '22023', modele: 'La période d’un forfait suit la lettre au jour près : tous ses jours dans le mois, le trimestre ou l’année, et eux seuls.' },
  { cle: 'clientDisparu', code: '22023', modele: 'Le dossier du client n’existe plus : sa facture se fait à la main.' },
  // La garde, quand les liens se posent : tout se défait, le brouillon compris.
  { cle: 'dejaFacturee', code: '23514', modele: 'Cette période est déjà facturée : une facture qui n’est pas créditée en entier la couvre.' },
]

/** Les mots d'un refus, par sa clé. */
export function motsDuRefusDeLaFacturation(cle: string): string {
  const refus = REFUS_DE_LA_FACTURATION.find((r) => r.cle === cle)
  if (!refus) throw new Error(`Refus inconnu : ${cle}`)
  return refus.modele
}

/** Une ligne d'honoraires telle que la lettre la fige (`honoraires`, jsonb) ; son rang est sa place, 1 pour la première. */
export interface LigneDHonoraires {
  forme: 'forfait' | 'tache' | 'temps'
  libelle: string
  montant_ht: number
  periodicite?: 'mois' | 'trimestre' | 'annee'
  livrable?: 'declaration_2035' | 'declaration_tva' | 'bilan' | 'autre'
}

/** Ce que l'écran lit d'une lettre pour la facturer : son histoire (`LettreLue`), ses honoraires et son premier exercice. */
export interface LettreAFacturer extends LettreLue {
  honoraires: readonly LigneDHonoraires[]
  premier_exercice: number | null
}

/** Un lien de `honoraires_factures`. Dates civiles AAAA-MM-JJ. */
export interface LienDHonoraires {
  facture_id: string
  lettre_id: string
  ligne: number
  periode_debut: string
  periode_fin: string
  facturation: number
}

/** Ce que l'écran lit d'une facture du dossier du cabinet (montants en euros, ceux de la base). */
export interface FactureDuCabinet {
  id: string
  type: 'facture' | 'avoir'
  statut: 'brouillon' | 'validee' | 'importee'
  montant_ttc: number
  facture_origine_id: string | null
  numero: string | null
}

/** Un avoir repris de l'ancien logiciel, qui crédite une facture (`factures_importees.origine_id`). */
export interface AvoirRepris { facture_id: string; origine_id: string }

/** Une période, du premier au dernier jour, en dates civiles. */
export interface Periode { debut: string; fin: string }

// ── Les dates civiles, en entiers (jamais un `Date` : une date civile n'a pas de fuseau) ──
function enParties(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`Date civile illisible : ${iso}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
const deux = (n: number) => String(n).padStart(2, '0')
const enIso = (a: number, m: number, j: number) => `${a}-${deux(m)}-${deux(j)}`
const joursDuMois = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()
function moisPlus(a: number, m: number, n: number): [number, number] {
  const total = a * 12 + (m - 1) + n
  return [Math.floor(total / 12), (total % 12) + 1]
}
/** Le dernier jour de la période de `n` mois qui commence le premier du mois (a, m). */
function finApres(a: number, m: number, n: number): string {
  const [af, mf] = moisPlus(a, m, n - 1)
  return enIso(af, mf, joursDuMois(af, mf))
}
const MOIS_PAR_PERIODE = { mois: 1, trimestre: 3, annee: 12 } as const

/** La périodicité d'un forfait. */
export type Periodicite = keyof typeof MOIS_PAR_PERIODE

const estUnePeriodicite = (p: string | undefined): p is Periodicite => p === 'mois' || p === 'trimestre' || p === 'annee'

/** `periode_civile_debut` et `periode_civile_fin` : le mois, le trimestre ou l'année CIVILS qui contient ce jour. */
export function periodeCivile(periodicite: Periodicite, jour: string): Periode {
  const [a, m] = enParties(jour)
  const premier = periodicite === 'annee' ? 1 : periodicite === 'trimestre' ? m - ((m - 1) % 3) : m
  return { debut: enIso(a, premier, 1), fin: finApres(a, premier, MOIS_PAR_PERIODE[periodicite]) }
}

/** `periode_de_forfait_valide` (LM7-Q4 (C)) : des jours qui tiennent dans UN mois, trimestre ou année civils — la période
 *  entière, ou la part d'une lettre au prorata. */
export function periodeDeForfaitValide(periodicite: string | undefined, debut: string, fin: string): boolean {
  if (!estUnePeriodicite(periodicite) || fin < debut) return false
  return periodeCivile(periodicite, debut).debut === periodeCivile(periodicite, fin).debut
}

/** La période civile ENTIÈRE de cette périodicité, du premier au dernier jour. */
export function estLaPeriodeCivile(periodicite: Periodicite, debut: string, fin: string): boolean {
  const civile = periodeCivile(periodicite, debut)
  return civile.debut === debut && civile.fin === fin
}

// Le numéro d'un jour civil, pour compter les jours (une date civile n'a pas de fuseau : `Date.UTC` sur ses parties).
const numeroDuJour = (iso: string) => {
  const [a, m, j] = enParties(iso)
  return Date.UTC(a, m - 1, j) / 86400000
}
const jourDecale = (iso: string, n: number) => {
  const d = new Date((numeroDuJour(iso) + n) * 86400000)
  return enIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Les jours d'une part et ceux de sa période civile : « 17 jours sur 31 ». */
export function joursDuProrata(periodicite: Periodicite, debut: string, fin: string): { jours: number; sur: number } {
  const civile = periodeCivile(periodicite, debut)
  return { jours: numeroDuJour(fin) - numeroDuJour(debut) + 1, sur: numeroDuJour(civile.fin) - numeroDuJour(civile.debut) + 1 }
}

/**
 * `honoraires_au_prorata` : la part d'un forfait pour les jours [debut, fin] de sa période civile, en CENTIMES —
 * arrondi(P × b / n) − arrondi(P × a / n), P le prix de la période en centimes, n ses jours, a ceux d'avant la part, b ceux
 * jusqu'à sa fin comprise, chaque arrondi au centime, le demi loin de zéro. La période entière rend P ; des parts qui se
 * suivent s'additionnent sans écart. `null` pour des jours qui ne tiennent pas dans une période civile, ou un prix qui
 * n'est pas au centime.
 */
export function centimesAuProrata(montantHt: number, periodicite: string | undefined, debut: string, fin: string): number | null {
  if (!estUnePeriodicite(periodicite) || !periodeDeForfaitValide(periodicite, debut, fin)) return null
  const prix = Math.round(montantHt * 100)
  if (Math.abs(prix - montantHt * 100) > 1e-6 * Math.max(1, Math.abs(prix))) return null
  const civile = periodeCivile(periodicite, debut)
  const n = numeroDuJour(civile.fin) - numeroDuJour(civile.debut) + 1
  const a = numeroDuJour(debut) - numeroDuJour(civile.debut)
  const b = numeroDuJour(fin) - numeroDuJour(civile.debut) + 1
  return prorataArrondi(prix, b, n) - prorataArrondi(prix, a, n)
}

/** La période d'une tâche : de son début à sa fin, un an au plus, entre 2000 et 2100 (la fonction et la contrainte). */
export function periodeDeTacheValide(debut: string, fin: string): boolean {
  if (fin < debut || debut < '2000-01-01' || fin > '2100-12-31') return false
  // `debut + interval '1 year'` : le même jour un an plus tard, ramené au dernier jour du mois (le 29 février donne le 28).
  const [a, m, j] = enParties(debut)
  return fin < enIso(a + 1, m, Math.min(j, joursDuMois(a + 1, m)))
}

/** Les périodes CIVILES d'une périodicité qui touchent [du, au], dans l'ordre. */
export function periodesDuForfait(periodicite: 'mois' | 'trimestre' | 'annee', du: string, au: string): Periode[] {
  if (au < du) return []
  const [a0, m0] = enParties(du)
  const n = MOIS_PAR_PERIODE[periodicite]
  let [a, m] = [a0, periodicite === 'annee' ? 1 : periodicite === 'trimestre' ? m0 - ((m0 - 1) % 3) : m0]
  const periodes: Periode[] = []
  for (;;) {
    const debut = enIso(a, m, 1)
    if (debut > au) break
    periodes.push({ debut, fin: finApres(a, m, n) })
    ;[a, m] = moisPlus(a, m, n)
  }
  return periodes
}

/** `lettre_en_vigueur_le` : la lettre est en vigueur ce jour-là (sur des lettres lues EN ENTIER, avenants compris). */
export function lettreEnVigueurLe(lettre: LettreLue, lettres: readonly LettreLue[], jour: string): boolean {
  return lettre.dossier_client_id !== null && lettresEnVigueur(lettres, lettre.dossier_client_id, jour).some((l) => l.id === lettre.id)
}

/**
 * Les jours où la lettre est EN VIGUEUR, d'un seul tenant (chaque condition de `lettre_en_vigueur_le` ne fait que commencer
 * ou finir) : de sa date d'effet à la veille de sa fin — sa résiliation, la fin de sa première période sans reconduction,
 * la veille de l'effet d'un avenant accepté —, `fin` nulle sans fin connue ; `null` si elle ne l'est jamais.
 */
export function joursDeVigueur(lettre: LettreLue, lettres: readonly LettreLue[]): { debut: string; fin: string | null } | null {
  if (lettre.acceptee_le === null || lettre.date_effet === null || lettre.dossier_client_id === null) return null
  const fins = [
    lettre.fin_au,
    !lettre.reconduction_tacite ? lettre.fin_initiale : null,
    ...lettres.filter((s) => s.remplace_id === lettre.id && s.refusee_le === null && s.acceptee_le !== null && s.date_effet !== null)
      .map((s) => jourDecale(s.date_effet!, -1)),
  ].filter((d): d is string => d !== null)
  const fin = fins.length === 0 ? null : fins.reduce((x, y) => (y < x ? y : x))
  return fin !== null && fin < lettre.date_effet ? null : { debut: lettre.date_effet, fin }
}

/** `facture_creditee_en_entier` : validée ou reprise, d'un TTC positif, que ses avoirs — ceux qu'elle origine et ceux
 *  qu'une reprise cite — atteignent. Un brouillon ne l'est jamais. En centimes entiers. */
export function factureCrediteeEnEntier(factureId: string, factures: readonly FactureDuCabinet[], avoirsRepris: readonly AvoirRepris[]): boolean {
  const f = factures.find((x) => x.id === factureId)
  if (!f || f.montant_ttc <= 0 || (f.statut !== 'validee' && f.statut !== 'importee')) return false
  const repris = new Set(avoirsRepris.filter((a) => a.origine_id === factureId).map((a) => a.facture_id))
  let credite = 0
  for (const a of factures) {
    if (a.type === 'avoir' && (a.facture_origine_id === factureId || repris.has(a.id))) credite += Math.round(-a.montant_ttc * 100)
  }
  return credite >= Math.round(f.montant_ttc * 100)
}

/** La première version de la chaîne d'une lettre (`racine_de_la_lettre`). */
export function racine(lettreId: string, lettres: readonly LettreLue[]): string {
  let courante = lettres.find((l) => l.id === lettreId)
  const vues = new Set<string>()
  while (courante?.remplace_id && !vues.has(courante.id)) {
    vues.add(courante.id)
    const precedente = lettres.find((l) => l.id === courante!.remplace_id)
    if (!precedente) break
    courante = precedente
  }
  return courante?.id ?? lettreId
}

/** Le lien ACTIF qui couvre déjà cette période — pour un forfait, l'un de ses jours —, comme la garde le cherche : la même
 *  ligne de la même lettre, ou, d'une autre version de la même lettre, une ligne de même forme et de même périodicité
 *  (forfait) ou de même livrable (tâche, sauf « autre ») ; sa facture n'est pas créditée en entier. */
export function lienQuiCouvre(
  element: { lettre_id: string; ligne: number; periode_debut: string; periode_fin: string },
  lettres: readonly LettreAFacturer[], liens: readonly LienDHonoraires[], factures: readonly FactureDuCabinet[],
  avoirsRepris: readonly AvoirRepris[],
): LienDHonoraires | null {
  const lettre = lettres.find((l) => l.id === element.lettre_id)
  const ligne = lettre?.honoraires[element.ligne - 1]
  if (!lettre || !ligne) return null
  const sienne = racine(lettre.id, lettres)
  // Un forfait : un jour ne se facture qu'une fois (deux périodes qui se recouvrent, LM7-Q4 (C)) ; une tâche : sa période.
  const memesJours = (h: LienDHonoraires) => (ligne.forme === 'forfait'
    ? h.periode_debut <= element.periode_fin && element.periode_debut <= h.periode_fin
    : h.periode_debut === element.periode_debut && h.periode_fin === element.periode_fin)
  return liens.find((h) => {
    if (!memesJours(h)) return false
    if (factureCrediteeEnEntier(h.facture_id, factures, avoirsRepris)) return false
    if (h.lettre_id === lettre.id) return h.ligne === element.ligne
    const autre = lettres.find((l) => l.id === h.lettre_id)
    const sa = autre?.honoraires[h.ligne - 1]
    if (!autre || !sa || autre.dossier_client_id !== lettre.dossier_client_id || racine(autre.id, lettres) !== sienne) return false
    if (sa.forme !== ligne.forme) return false
    return ligne.forme === 'forfait' ? sa.periodicite === ligne.periodicite : sa.livrable === ligne.livrable && ligne.livrable !== 'autre'
  }) ?? null
}

/** Ce que la base refuserait d'un élément, avant le clic : la clé du premier refus, ou null. `aujourdhui` est le jour de
 *  Paris, que l'appelant lit (jamais au chargement). */
export function refusDeLElement(
  element: { lettre_id: string; ligne: number; periode_debut: string; periode_fin: string },
  lettres: readonly LettreAFacturer[], liens: readonly LienDHonoraires[], factures: readonly FactureDuCabinet[],
  avoirsRepris: readonly AvoirRepris[], aujourdhui: string,
): string | null {
  const lettre = lettres.find((l) => l.id === element.lettre_id)
  if (!lettre) return 'introuvable'
  if (lettre.acceptee_le === null) return 'nonAcceptee'
  const ligne = element.ligne >= 1 ? lettre.honoraires[element.ligne - 1] : undefined
  if (!ligne) return 'ligneIntrouvable'
  if (ligne.forme === 'temps') return 'tempsPasse'
  const { periode_debut: debut, periode_fin: fin } = element
  if (ligne.forme === 'forfait' && !periodeDeForfaitValide(ligne.periodicite, debut, fin)) return 'periodeDuForfait'
  if (ligne.forme === 'tache' && !periodeDeTacheValide(debut, fin)) return 'periodeDeLaTache'
  if (debut > aujourdhui) return 'pasCommencee'
  const enVigueur = ligne.forme === 'forfait'
    ? lettreEnVigueurLe(lettre, lettres, debut) && lettreEnVigueurLe(lettre, lettres, fin)
    : (lettreEnVigueurLe(lettre, lettres, fin) || lettreEnVigueurLe(lettre, lettres, aujourdhui))
      && Number(debut.slice(0, 4)) >= (lettre.premier_exercice ?? 0)
  if (!enVigueur) return 'horsDeVigueur'
  if (ligne.forme === 'forfait') {
    // Tous les jours de la lettre dans sa période civile, et eux seuls : ni la veille, ni le lendemain dans la période.
    const civile = periodeCivile(ligne.periodicite as Periodicite, debut)
    if ((debut > civile.debut && lettreEnVigueurLe(lettre, lettres, jourDecale(debut, -1)))
      || (fin < civile.fin && lettreEnVigueurLe(lettre, lettres, jourDecale(fin, 1)))) return 'joursDeLaLettre'
  }
  return lienQuiCouvre(element, lettres, liens, factures, avoirsRepris) ? 'dejaFacturee' : null
}

/** Ce que la base refuserait de la demande entière, avant les éléments : leur nombre, un double, deux clients, le taux. */
export function refusDeLaDemande(
  elements: readonly { lettre_id: string; ligne: number; periode_debut: string; periode_fin: string }[],
  lettres: readonly LettreAFacturer[], taux: number,
): string | null {
  if (elements.length < 1 || elements.length > 50) return 'nombre'
  if (!TAUX_DES_HONORAIRES.includes(taux)) return 'taux'
  const cles = elements.map((e) => `${e.lettre_id}|${e.ligne}|${e.periode_debut}|${e.periode_fin}`)
  if (new Set(cles).size !== cles.length) return 'double'
  const clients = new Set(elements.map((e) => lettres.find((l) => l.id === e.lettre_id)?.dossier_client_id).filter((c) => c !== undefined))
  return clients.size > 1 ? 'unSeulClient' : null
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const trimestre = (m: number, a: number) => `${m === 1 ? '1er' : `${(m + 2) / 3}e`} trimestre ${a}`

const enLettres = (iso: string) => {
  const [a, m, j] = enParties(iso)
  return `${deux(j)}/${deux(m)}/${a}`
}

/** Le libellé de la ligne de facture, celui que compose la fonction : « <libellé> — <période> » ; la part d'une période
 *  d'un forfait dit ses dates et ses jours : « janvier 2026, du 15/01/2026 au 31/01/2026 (17 jours sur 31) ». */
export function designationDeLElement(ligne: LigneDHonoraires, debut: string, fin: string): string {
  const [a, m, j] = enParties(debut)
  let periode: string
  if (ligne.forme === 'forfait' && estUnePeriodicite(ligne.periodicite)) {
    const [ac, mc] = enParties(periodeCivile(ligne.periodicite, debut).debut)
    periode = ligne.periodicite === 'mois' ? `${MOIS[mc - 1]} ${ac}` : ligne.periodicite === 'trimestre' ? trimestre(mc, ac) : `année ${ac}`
    if (!estLaPeriodeCivile(ligne.periodicite, debut, fin)) {
      const { jours, sur } = joursDuProrata(ligne.periodicite, debut, fin)
      periode += `, ${debut === fin ? `le ${enLettres(debut)}` : `du ${enLettres(debut)} au ${enLettres(fin)}`}`
        + ` (${jours} ${jours === 1 ? 'jour' : 'jours'} sur ${sur})`
    }
  } else if (m === 1 && j === 1 && fin === enIso(a, 12, 31)) periode = `exercice ${a}`
  else if (estLaPeriodeCivile('mois', debut, fin)) periode = `${MOIS[m - 1]} ${a}`
  else if (estLaPeriodeCivile('trimestre', debut, fin)) periode = trimestre(m, a)
  else if (debut === fin) periode = `le ${enLettres(debut)}`
  else periode = `du ${enLettres(debut)} au ${enLettres(fin)}`
  return `${ligne.libelle} — ${periode}`
}

/** Les totaux du brouillon, ceux que la fonction calcule : une ligne par élément, au montant figé, au taux donné. */
export function totauxDuBrouillon(montantsHt: readonly number[], taux: number): { montant_ht: number; montant_tva: number; montant_ttc: number } {
  let ht = 0
  let tva = 0
  for (const montant of montantsHt) {
    const l = calculerLigne(1, montant, taux)
    ht += Math.round(l.montant_ht * 100)
    tva += Math.round(l.montant_tva * 100)
  }
  return { montant_ht: ht / 100, montant_tva: tva / 100, montant_ttc: (ht + tva) / 100 }
}

/** Le moment où une période de forfait se propose : à son dernier jour (« à terme échu », la conception) ou dès son
 *  premier (« à échoir ») — LM7-Q2, un paramètre sans défaut. */
export type TermeDuForfait = 'echu' | 'a_echoir'

/** La part d'une période d'un forfait : ses jours, ceux de sa période civile, et le prix de la période entière. */
export interface Prorata { jours: number; sur: number; prixDeLaPeriode: number }

/** Une période d'un forfait à facturer : la période entière, ou la part de la lettre au prorata (`prorata` non nul). */
export interface PeriodeAFacturer {
  lettre_id: string
  ligne: number
  periode_debut: string
  periode_fin: string
  designation: string
  montant_ht: number
  prorata: Prorata | null
}

/**
 * Les périodes de forfait « À FACTURER » au jour donné, pour les lettres du dossier du cabinet lues EN ENTIER (une lecture
 * partielle ne dit rien d'ici) : de chaque ligne de forfait d'une lettre acceptée, chaque période civile où elle est en
 * vigueur — entière, ou sa part au prorata de ses jours (LM7-Q4 (C)) —, échue à son dernier jour (ou commencée, à échoir),
 * qu'aucun lien actif ne couvre. Les tâches ne se proposent pas d'elles-mêmes : le clic qui les facture les dit faites
 * (LM7-Q1).
 */
export function periodesAFacturer(
  lettres: readonly LettreAFacturer[], liens: readonly LienDHonoraires[], factures: readonly FactureDuCabinet[],
  avoirsRepris: readonly AvoirRepris[], aujourdhui: string, terme: TermeDuForfait,
): PeriodeAFacturer[] {
  const resultat: PeriodeAFacturer[] = []
  for (const lettre of lettres) {
    const vigueur = joursDeVigueur(lettre, lettres)
    if (vigueur === null) continue
    const jusquA = vigueur.fin !== null && vigueur.fin < aujourdhui ? vigueur.fin : aujourdhui
    lettre.honoraires.forEach((ligne, i) => {
      if (ligne.forme !== 'forfait' || !estUnePeriodicite(ligne.periodicite)) return
      const periodicite = ligne.periodicite
      for (const p of periodesDuForfait(periodicite, vigueur.debut, jusquA)) {
        // Les jours de la lettre dans la période civile : la période entière, ou sa part.
        const debut = vigueur.debut > p.debut ? vigueur.debut : p.debut
        const fin = vigueur.fin !== null && vigueur.fin < p.fin ? vigueur.fin : p.fin
        if (fin < debut || (terme === 'echu' ? fin : debut) > aujourdhui) continue
        const element = { lettre_id: lettre.id, ligne: i + 1, periode_debut: debut, periode_fin: fin }
        if (refusDeLElement(element, lettres, liens, factures, avoirsRepris, aujourdhui) !== null) continue
        const entiere = estLaPeriodeCivile(periodicite, debut, fin)
        const centimes = centimesAuProrata(ligne.montant_ht, periodicite, debut, fin)
        if (centimes === null) continue
        resultat.push({
          ...element, designation: designationDeLElement(ligne, debut, fin), montant_ht: entiere ? ligne.montant_ht : centimes / 100,
          prorata: entiere ? null : { ...joursDuProrata(periodicite, debut, fin), prixDeLaPeriode: ligne.montant_ht },
        })
      }
    })
  }
  return resultat.sort((x, y) => (x.periode_debut < y.periode_debut ? -1 : x.periode_debut > y.periode_debut ? 1
    : x.lettre_id < y.lettre_id ? -1 : x.lettre_id > y.lettre_id ? 1 : x.ligne - y.ligne))
}
