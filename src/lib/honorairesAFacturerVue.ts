import {
  factureCrediteeEnEntier, designationDeLElement, lettreEnVigueurLe, motsDuRefusDeLaFacturation, periodesAFacturer, racine,
  refusDeLaDemande, refusDeLElement, totauxDuBrouillon, type AvoirRepris, type FactureDuCabinet, type LettreAFacturer,
  type LienDHonoraires, type Prorata,
} from './honorairesAFacturer'
import { formatDate, formatMoney } from './format'

// « À FACTURER », CE QUE LA CARTE MONTRE (ligne 47, LM7 à l'écran). Pur : à partir des lettres, des liens, des factures du
// dossier du cabinet et des avoirs repris, TOUS lus en entier (l'appelant ne l'appelle pas autrement), il range par client
// puis par lettre acceptée ce qui se facture — les périodes de forfait échues (LM7-Q2, à terme échu) telles que
// `periodesAFacturer` les calcule, et les tâches par exercice, que le clic qui les facture dit faites (LM7-Q1) —, ce qui est
// déjà facturé, avec sa facture, et la période qu'un avoir total a rendue à facturer (LM7-Q3, l'avoir partiel la laisse
// facturée). Un forfait se facture pour les jours de chaque lettre EN VIGUEUR dans sa période civile, au prorata quand
// elle commence ou finit en cours de période — l'avenant facturant les siens (LM7-Q4 (C), « 17 jours sur 31 ») : la règle
// du module.
// Les refus avant le clic sont ceux du module, à ses mots. Récit : HISTORIQUE.md, « 11/11/2026 — LM7 : « À FACTURER », À
// L'ÉCRAN ».

/** Un dossier client du cabinet, son nom. */
export interface DossierNomme { id: string; nom: string }

/** Un élément que la carte offre de facturer. `cle` l'identifie dans la sélection. */
export interface ElementPropose {
  cle: string
  forme: 'forfait' | 'tache'
  lettre_id: string
  ligne: number
  periode_debut: string
  periode_fin: string
  designation: string
  montant_ht: number
  /** La part d'une période d'un forfait, au prorata de ses jours (LM7-Q4 (C)) ; nulle pour une période entière ou une tâche. */
  prorata: Prorata | null
  /** Le numéro de la facture qu'un avoir total a créditée en entier, quand cette période l'avait déjà été. */
  rendueParLAvoirDe: string | null
}

/** Une période déjà facturée, avec sa facture. */
export interface PeriodeFacturee {
  cle: string
  designation: string
  facture_id: string
  numero: string | null
  statut: FactureDuCabinet['statut'] | null
  /** Créditée en entier par ses avoirs : la période se facture de nouveau. */
  crediteeEnEntier: boolean
}

export interface LettreDuClient {
  lettre: LettreAFacturer
  elements: ElementPropose[]
  facturees: PeriodeFacturee[]
}

export interface ClientAFacturer {
  clientId: string
  /** `null` : le dossier n'est pas dans la liste lue des dossiers du cabinet. */
  nomDuClient: string | null
  lettres: LettreDuClient[]
}

const cleDe = (e: { lettre_id: string; ligne: number; periode_debut: string; periode_fin: string }) =>
  `${e.lettre_id}|${e.ligne}|${e.periode_debut}|${e.periode_fin}`

/** Le plus d'exercices qu'une tâche se propose en arrière : au-delà, la facture se fait à la main. */
const EXERCICES_PROPOSES = 6

/**
 * Les tâches d'une lettre acceptée, proposées par exercice civil, de son premier exercice (à défaut, l'année de son effet)
 * jusqu'à celui d'aujourd'hui : celles que la base accepterait, sous la version de la lettre en vigueur au dernier jour de
 * l'exercice quand la chaîne en a une (une seule version les propose).
 */
function tachesAFacturer(
  lettre: LettreAFacturer, lettres: readonly LettreAFacturer[], liens: readonly LienDHonoraires[],
  factures: readonly FactureDuCabinet[], avoirsRepris: readonly AvoirRepris[], aujourdhui: string,
): Omit<ElementPropose, 'rendueParLAvoirDe'>[] {
  if (lettre.acceptee_le === null || lettre.date_effet === null || lettre.dossier_client_id === null) return []
  const annee = Number(aujourdhui.slice(0, 4))
  const depuis = Math.max(2000, lettre.premier_exercice ?? Number(lettre.date_effet.slice(0, 4)), annee - EXERCICES_PROPOSES + 1)
  const sienne = racine(lettre.id, lettres)
  const resultat: Omit<ElementPropose, 'rendueParLAvoirDe'>[] = []
  lettre.honoraires.forEach((ligne, i) => {
    if (ligne.forme !== 'tache') return
    for (let a = depuis; a <= annee; a += 1) {
      const element = { lettre_id: lettre.id, ligne: i + 1, periode_debut: `${a}-01-01`, periode_fin: `${a}-12-31` }
      if (refusDeLElement(element, lettres, liens, factures, avoirsRepris, aujourdhui) !== null) continue
      // Une autre version de la même lettre, en vigueur au dernier jour de l'exercice, le propose à sa place.
      const autreAuDernierJour = !lettreEnVigueurLe(lettre, lettres, element.periode_fin) && lettres.some((l) => l.id !== lettre.id
        && racine(l.id, lettres) === sienne && lettreEnVigueurLe(l, lettres, element.periode_fin))
      if (autreAuDernierJour) continue
      resultat.push({ cle: cleDe(element), forme: 'tache', ...element, designation: designationDeLElement(ligne, element.periode_debut, element.periode_fin), montant_ht: ligne.montant_ht, prorata: null })
    }
  })
  return resultat
}

/** Ce que la carte montre, par client (dans l'ordre des noms) puis par lettre acceptée (dans l'ordre de leur effet). */
export function aFacturerParClient(p: {
  lettres: readonly LettreAFacturer[]
  liens: readonly LienDHonoraires[]
  factures: readonly FactureDuCabinet[]
  avoirsRepris: readonly AvoirRepris[]
  dossiers: readonly DossierNomme[]
  aujourdhui: string
}): ClientAFacturer[] {
  const { lettres, liens, factures, avoirsRepris, aujourdhui } = p
  const forfaits = periodesAFacturer(lettres, liens, factures, avoirsRepris, aujourdhui, 'echu')
  const parFacture = new Map(factures.map((f) => [f.id, f]))
  const clients = new Map<string, ClientAFacturer>()
  const acceptees = lettres.filter((l) => l.acceptee_le !== null && l.dossier_client_id !== null)
    .slice().sort((x, y) => ((x.date_effet ?? '') < (y.date_effet ?? '') ? -1 : (x.date_effet ?? '') > (y.date_effet ?? '') ? 1 : x.id < y.id ? -1 : 1))
  for (const lettre of acceptees) {
    const clientId = lettre.dossier_client_id!
    const rendue = (e: { lettre_id: string; ligne: number; periode_debut: string; periode_fin: string }) => {
      const credite = liens.find((h) => cleDe(h) === cleDe(e) && factureCrediteeEnEntier(h.facture_id, factures, avoirsRepris))
      return credite ? (parFacture.get(credite.facture_id)?.numero ?? '—') : null
    }
    const elements: ElementPropose[] = [
      ...forfaits.filter((f) => f.lettre_id === lettre.id)
        .map((f) => ({ ...f, cle: cleDe(f), forme: 'forfait' as const, rendueParLAvoirDe: rendue(f) })),
      ...tachesAFacturer(lettre, lettres, liens, factures, avoirsRepris, aujourdhui).map((t) => ({ ...t, rendueParLAvoirDe: rendue(t) })),
    ]
    const facturees: PeriodeFacturee[] = liens.filter((h) => h.lettre_id === lettre.id)
      .slice().sort((x, y) => (x.periode_debut < y.periode_debut ? -1 : x.periode_debut > y.periode_debut ? 1 : x.ligne - y.ligne || x.facturation - y.facturation))
      .map((h) => {
        const ligne = lettre.honoraires[h.ligne - 1]
        const facture = parFacture.get(h.facture_id) ?? null
        return {
          cle: `${cleDe(h)}|${h.facturation}`,
          designation: ligne ? designationDeLElement(ligne, h.periode_debut, h.periode_fin) : `Ligne ${h.ligne} — du ${formatDate(h.periode_debut)} au ${formatDate(h.periode_fin)}`,
          facture_id: h.facture_id, numero: facture?.numero ?? null, statut: facture?.statut ?? null,
          crediteeEnEntier: factureCrediteeEnEntier(h.facture_id, factures, avoirsRepris),
        }
      })
    if (elements.length === 0 && facturees.length === 0) continue
    const client = clients.get(clientId) ?? { clientId, nomDuClient: p.dossiers.find((d) => d.id === clientId)?.nom ?? null, lettres: [] }
    client.lettres.push({ lettre, elements, facturees })
    clients.set(clientId, client)
  }
  return [...clients.values()].sort((x, y) => (x.nomDuClient ?? '').localeCompare(y.nomDuClient ?? '', 'fr') || (x.clientId < y.clientId ? -1 : 1))
}

/** Les mots d'une période déjà facturée : sa facture et son état. */
export function motsDeLaFacturee(f: PeriodeFacturee): string {
  const facture = f.statut === null ? 'une facture qui n’est pas dans la liste lue'
    : f.statut === 'brouillon' ? 'un brouillon de facture'
      : `la facture ${f.numero ?? '—'}${f.statut === 'importee' ? ' (reprise)' : ''}`
  return f.crediteeEnEntier ? `Facturée par ${facture}, créditée en entier par un avoir : à facturer de nouveau` : `Facturée par ${facture}`
}

/** La part au prorata, dite à l'écran : « 17 jours sur 31 du forfait de 150,00 € HT » ; vide pour une période entière. */
export function motsDuProrata(e: Pick<ElementPropose, 'prorata'>): string {
  return e.prorata === null ? ''
    : `${e.prorata.jours} ${e.prorata.jours === 1 ? 'jour' : 'jours'} sur ${e.prorata.sur} du forfait de ${formatMoney(e.prorata.prixDeLaPeriode)} HT`
}

/** Le refus, avant le clic, de la sélection d'un client au taux choisi (`null` : aucun taux choisi) : ses mots, ou `null`. */
export function refusDeLaSelection(
  elements: readonly ElementPropose[], lettres: readonly LettreAFacturer[], liens: readonly LienDHonoraires[],
  factures: readonly FactureDuCabinet[], avoirsRepris: readonly AvoirRepris[], taux: number | null, aujourdhui: string,
): string | null {
  if (elements.length === 0) return 'Coche au moins une période ou une tâche à facturer.'
  const demande = refusDeLaDemande(elements, lettres, taux ?? Number.NaN)
  if (demande !== null) return motsDuRefusDeLaFacturation(demande)
  for (const e of elements) {
    const refus = refusDeLElement(e, lettres, liens, factures, avoirsRepris, aujourdhui)
    if (refus !== null) return `${e.designation} : ${motsDuRefusDeLaFacturation(refus)}`
  }
  return null
}

const enTaux = (taux: number) => `${String(taux).replace('.', ',')} %`

/** La confirmation du clic « Facturer » : elle nomme le client, chaque période ou tâche et le montant hors taxes. */
export function confirmationDeLaFacturation(nomDuClient: string | null, elements: readonly ElementPropose[], taux: number): string {
  const totaux = totauxDuBrouillon(elements.map((e) => e.montant_ht), taux)
  const taches = elements.some((e) => e.forme === 'tache')
  return [
    `Créer le brouillon d’une facture d’honoraires pour « ${nomDuClient ?? 'dossier non lu'} » :`,
    ...elements.map((e) => `— ${e.designation} : ${formatMoney(e.montant_ht)} HT${e.prorata ? ` (au prorata du forfait de ${formatMoney(e.prorata.prixDeLaPeriode)} HT)` : ''}`),
    `Total : ${formatMoney(totaux.montant_ht)} HT, TVA à ${enTaux(taux)} : ${formatMoney(totaux.montant_tva)}, soit ${formatMoney(totaux.montant_ttc)} TTC.`,
    ...(elements.some((e) => e.prorata !== null)
      ? ['Un forfait que sa lettre commence ou finit en cours de période se facture au prorata de ses jours, arrondi au centime.'] : []),
    ...(taches ? ['Facturer une tâche la dit faite.'] : []),
    'La facture se crée en brouillon, puis se valide comme toute facture.',
  ].join('\n')
}

/** Le taux proposé à l'écran : 20 %, 8,5 % ou nul, à ses mots. */
export function libelleDuTaux(taux: number): string {
  return taux === 0 ? 'Sans TVA (franchise)' : taux === 8.5 ? '8,5 % (Guadeloupe, Martinique, La Réunion)' : enTaux(taux)
}
