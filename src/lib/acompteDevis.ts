// L'ACOMPTE D'UN DEVIS ACCEPTÉ ET LA FACTURE FINALE QUI LE REPREND (EC-D3, étape P5b1) : un calcul pur, en centimes,
// sans le client Supabase. Rien ne le lit encore : la base (P5b2, `facturer_acompte_devis`) refera ces calculs et
// vérifiera les lignes reçues, l'écran (P5b5) dira avant le clic ce que ce module calcule et refuse.
//
// SOURCES : CGI, art. 289, I-1-c (l'acompte versé avant l'opération se facture) ; BOI-TVA-DECLA-30-20-20-10, § 60
// (« la facture définitive doit faire référence aux différentes factures d'acomptes ») ; art. 283, 3 (la TVA facturée
// est due : la reprise doit en être l'opposé EXACT, sinon une part serait facturée deux fois) ; annexe 1 v1.2 des
// spécifications externes de la DGFiP, EXT-FR-FE-BG-06 (la reprise d'un acompte en ligne de la facture finale).
// La conception et les options écartées : HISTORIQUE.md, « L'ACOMPTE D'UN DEVIS : LA CONCEPTION (P5B) ».
//
// LES GROUPES : (taux, nature) dans l'ordre de première apparition. Les lignes d'un devis ne portent pas de nature
// aujourd'hui (`LigneDevis`, et la migration `devis_du_client` ne garde que désignation, quantité, prix et taux ; la nature
// est celle du devis entier, `nature_operation`) : la nature d'une ligne est donc facultative, nulle tant que le devis ne
// la dit pas, et le groupe se réduit alors au taux. Le jour où une ligne de devis dira sa nature, rien ne change ici.

import { formatDate } from './format'
import { calculerLigne, calculerTotaux, type LigneCalculee } from './montantsFacture'
import type { ModeComptable, NatureArticle } from './types'

/** Une ligne du devis, telle que `devis.lignes` la porte, sa nature en plus quand elle la dit. */
export interface LigneDuDevisPourAcompte {
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  nature?: NatureArticle | null
}

/** Une ligne d'une facture d'acompte ou d'une facture finale, prête à partir vers `enregistrer_facture`. */
export interface LigneTiree {
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  nature: NatureArticle | null
  // La facture d'acompte que cette ligne reprend (`facture_lignes.reprise_facture_id`) ; nulle hors d'une reprise.
  reprise_facture_id: string | null
}

/** Une facture d'acompte VALIDÉE du devis : ses lignes telles que la base les a figées. */
export interface AcompteValide {
  id: string
  numero: string
  // La date de la facture d'acompte, civile (AAAA-MM-JJ).
  date: string
  lignes: readonly { quantite: number; prix_unitaire_ht: number; taux_tva: number; nature?: NatureArticle | null }[]
}

/** Un groupe du devis : son taux, sa nature, et son HT en centimes. */
export interface GroupeDuDevis {
  taux_tva: number
  nature: NatureArticle | null
  ht: number
}

/** Un groupe et ce que les acomptes validés en couvrent déjà, en centimes : `reste` = `ht` − `deja`. */
export interface ResteDuGroupe extends GroupeDuDevis {
  deja: number
  reste: number
}

/** Ce que le cabinet demande : un pourcentage du devis entier, ou un montant TTC en centimes (P5B-Q1, les deux). */
export type DemandeAcompte = { mode: 'pourcentage'; pourcentage: number } | { mode: 'ttc'; ttcCentimes: number }

// Les refus, dans l'ordre où ils se jugent : d'abord l'état du devis et du dossier (rien à calculer), puis la saisie,
// puis ce que la saisie demande au reste du devis. La base (P5b2) les reprendra dans le même ordre, sous les mêmes mots.
export const REFUS_ACOMPTE = {
  nonAccepte: 'Le devis n’est pas accepté : un acompte ne se facture que sur un devis accepté.',
  finaleActive: 'Le devis a déjà sa facture finale : il ne s’en tire plus d’acompte.',
  acompteEnBrouillon:
    'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer un autre.',
  engagement:
    'Le dossier tient sa comptabilité en engagement : l’acompte d’un devis ne s’y facture pas encore (son compte, le 4191, viendra avec l’engagement).',
  pourcentageHorsBornes: 'Le pourcentage de l’acompte se situe au-delà de 0 % et jusqu’à 100 %.',
  pourcentageTropPrecis: 'Le pourcentage de l’acompte s’écrit au centième près.',
  montantNonPositif: 'Le montant de l’acompte doit être positif.',
  montantTropPrecis: 'Le montant de l’acompte s’écrit au centime près.',
  sansReste: 'Les acomptes validés couvrent déjà tout le devis : il ne reste qu’à en tirer la facture finale.',
  moinsDUnCentime: 'Ce pourcentage du devis fait moins d’un centime.',
} as const

/** L'état du devis et du dossier, tel que l'écran l'a lu, que le calcul ne peut pas déduire des lignes. */
export interface EtatPourAcompte {
  accepte: boolean
  // Une facture finale tirée du devis et ni supprimée ni créditée en entier (P5B-Q4 : la base le jugera).
  finaleActive: boolean
  // P5B-Q2 (recommandé) : plusieurs acomptes cumulés, un seul en brouillon à la fois.
  acompteEnBrouillon: boolean
  // P5B-Q3 (recommandé) : un dossier en engagement est refusé jusqu'au lot du 4191 ; le modèle comptable LU du dossier.
  mode: ModeComptable
}

// Les centimes HT d'une ligne, comme la base les compte (`centimes_ligne_facture`) : ceux de `calculerLigne`.
function centimesHt(quantite: number, prix: number, taux: number): number {
  return Math.round(calculerLigne(quantite, prix, taux).montant_ht * 100)
}

function cle(taux: number, nature: NatureArticle | null | undefined): string {
  return `${taux}|${nature ?? ''}`
}

function enTaux(taux: number): string {
  return `${String(taux).replace('.', ',')} %`
}

// Un montant imprimé dans une désignation : un texte FIGÉ avec la facture, donc écrit ici à la main plutôt que par
// `toLocaleString`, dont les espaces dépendent de la version d'ICU du navigateur.
function enEuros(centimes: number): string {
  const signe = centimes < 0 ? '-' : ''
  const absolu = Math.abs(centimes)
  const euros = String(Math.floor(absolu / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${signe}${euros},${String(absolu % 100).padStart(2, '0')} €`
}

/** Les groupes (taux, nature) du devis, dans l'ordre de première apparition, chacun la somme des HT de ses lignes. */
export function groupesDuDevis(lignes: readonly LigneDuDevisPourAcompte[]): GroupeDuDevis[] {
  const groupes = new Map<string, GroupeDuDevis>()
  for (const l of lignes) {
    const k = cle(l.taux_tva, l.nature)
    const g = groupes.get(k) ?? { taux_tva: l.taux_tva, nature: l.nature ?? null, ht: 0 }
    g.ht += centimesHt(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    groupes.set(k, g)
  }
  return [...groupes.values()]
}

export type RestesDuDevis = { ok: true; groupes: ResteDuGroupe[] } | { ok: false; refus: string }

/**
 * Le reste de chaque groupe : son HT moins la part que les acomptes VALIDÉS en ont déjà facturée. Un acompte qui porte un
 * groupe que le devis n'a pas, ou des acomptes qui dépassent un groupe, disent une incohérence que seule une écriture
 * hors des fonctions aurait pu faire : le calcul s'arrête et le dit.
 */
export function restesDuDevis(lignes: readonly LigneDuDevisPourAcompte[], acomptes: readonly AcompteValide[]): RestesDuDevis {
  const groupes: ResteDuGroupe[] = groupesDuDevis(lignes).map((g) => ({ ...g, deja: 0, reste: g.ht }))
  const parCle = new Map(groupes.map((g) => [cle(g.taux_tva, g.nature), g]))
  for (const a of acomptes) {
    for (const l of a.lignes) {
      const g = parCle.get(cle(l.taux_tva, l.nature))
      if (!g) return { ok: false, refus: `L’acompte ${a.numero} porte une ligne à ${enTaux(l.taux_tva)} que le devis n’a pas.` }
      const part = centimesHt(l.quantite, l.prix_unitaire_ht, l.taux_tva)
      g.deja += part
      g.reste -= part
    }
  }
  const depasse = groupes.find((g) => g.reste < 0)
  if (depasse) return { ok: false, refus: `Les acomptes validés dépassent le devis à ${enTaux(depasse.taux_tva)}.` }
  return { ok: true, groupes }
}

/**
 * La cible HT d'un pourcentage du devis ENTIER, au centime : HT × pourcentage / 100, le demi éloigné de zéro, sur le
 * décimal exact du pourcentage. C'est le HT d'une ligne de quantité `pourcentage` au prix d'un centième du HT du devis :
 * `calculerLigne` (et `centimes_ligne_facture`, que la base appliquera à `round(ht × pct / 100)`) l'arrondit ainsi.
 */
export function cibleDuPourcentage(htDuDevis: number, pourcentage: number): number {
  return centimesHt(pourcentage, htDuDevis / 10_000, 0)
}

/**
 * La répartition d'une cible HT sur les groupes AU PRORATA DE LEUR RESTE, par les plus forts restes : chaque groupe
 * reçoit la partie entière de cible × reste / reste total, puis les centimes qui manquent vont aux plus forts restes
 * de la division, à égalité dans l'ordre du devis. La somme est exacte ; tant que la cible ne dépasse pas le reste
 * total, aucune part ne dépasse le reste de son groupe — le plafond est vérifié quand même, et lève : il ne peut
 * manquer que par une faute de l'appelant, qui n'a pas jugé la cible avant.
 * Écarté : le prorata du devis entier, qui laisserait deux acomptes dépasser un taux d'un centime (la conception).
 */
export function repartirSurLesRestes(groupes: readonly ResteDuGroupe[], cible: number): number[] {
  const total = groupes.reduce((s, g) => s + g.reste, 0)
  if (!Number.isInteger(cible) || cible < 0 || cible > total) {
    throw new RangeError(`La cible de ${cible} centimes ne se répartit pas sur un reste de ${total} centimes.`)
  }
  if (cible === 0) return groupes.map(() => 0)
  const c = BigInt(cible)
  const r = BigInt(total)
  const parts = groupes.map((g) => Number((c * BigInt(g.reste)) / r))
  const restes = groupes.map((g) => (c * BigInt(g.reste)) % r)
  let manque = cible - parts.reduce((s, p) => s + p, 0)
  // L'ordre des plus forts restes ; `sort` est stable : à égalité, l'ordre du devis.
  const ordre = groupes.map((_, i) => i).sort((i, j) => (restes[j] > restes[i] ? 1 : restes[j] < restes[i] ? -1 : 0))
  for (const i of ordre) {
    if (manque === 0) break
    parts[i] += 1
    manque -= 1
  }
  groupes.forEach((g, i) => {
    if (parts[i] > g.reste) throw new RangeError(`La part ${parts[i]} dépasse le reste ${g.reste} à ${enTaux(g.taux_tva)}.`)
  })
  return parts
}

// Les lignes nues d'un acompte (une par groupe non nul), dont le TTC se compte comme la base le comptera.
function lignesDesParts(groupes: readonly ResteDuGroupe[], parts: readonly number[]): { g: ResteDuGroupe; part: number }[] {
  return groupes.map((g, i) => ({ g, part: parts[i] })).filter((x) => x.part > 0)
}

function ttcDesParts(groupes: readonly ResteDuGroupe[], parts: readonly number[]): number {
  const t = calculerTotaux(
    lignesDesParts(groupes, parts).map(({ g, part }) => ({ quantite: 1, prix_unitaire_ht: part / 100, taux_tva: g.taux_tva })),
  )
  return Math.round(t.montant_ttc * 100)
}

/**
 * La cible HT d'un TTC demandé : le HT au centime dont l'acompte, réparti par groupe, a le TTC le PLUS PROCHE du TTC
 * demandé ; à égale distance, le plus petit HT (l'acompte ne réclame pas plus que ce qu'on a demandé). Le TTC obtenu
 * peut différer du TTC demandé d'un centime ou plus (à 20 %, 0,02 € HT font 0,02 € TTC et 0,03 € HT en font 0,04 € :
 * 0,03 € TTC est inaccessible) : il se rend EXACT, et l'écran le dit avant le clic.
 *
 * Le TTC n'est pas une fonction croissante du HT (la répartition par les plus forts restes peut retirer un centime à un
 * groupe quand la cible croît), d'où une recherche plutôt qu'une division : hors d'une fenêtre autour de TTC ÷ ρ (ρ, le
 * rapport TTC/HT idéal du reste), l'écart de chaque groupe à son prorata exact (moins d'un centime de part, moins d'un
 * centime et demi de TTC) ne peut pas rapprocher le TTC de la demande. La fenêtre fait quelques dizaines de centimes.
 */
export function cibleDuTtc(groupes: readonly ResteDuGroupe[], ttcDemande: number): { ht: number; ttc: number } {
  const total = groupes.reduce((s, g) => s + g.reste, 0)
  const rho = 1 + groupes.reduce((s, g) => s + (g.reste * g.taux_tva) / 100, 0) / total
  const marge = 3 * groupes.length + 3
  const bas = Math.max(1, Math.floor((ttcDemande - marge) / rho) - 2)
  const haut = Math.min(total, Math.ceil((ttcDemande + marge) / rho) + 2)
  let meilleur: { ht: number; ttc: number } | null = null
  for (let ht = bas; ht <= haut; ht++) {
    const ttc = ttcDesParts(groupes, repartirSurLesRestes(groupes, ht))
    if (meilleur === null || Math.abs(ttc - ttcDemande) < Math.abs(meilleur.ttc - ttcDemande)) meilleur = { ht, ttc }
  }
  if (meilleur === null) throw new RangeError(`Aucun HT entre ${bas} et ${haut} centimes.`)
  return meilleur
}

/** Ce que la saisie du cabinet dit d'elle-même, sans rien lire du devis : le premier refus, ou null. */
export function refusDeLaDemande(demande: DemandeAcompte): string | null {
  if (demande.mode === 'pourcentage') {
    const p = demande.pourcentage
    if (!Number.isFinite(p) || p <= 0 || p > 100) return REFUS_ACOMPTE.pourcentageHorsBornes
    if (Math.round(p * 100) / 100 !== p) return REFUS_ACOMPTE.pourcentageTropPrecis
    return null
  }
  const t = demande.ttcCentimes
  if (!Number.isFinite(t) || t <= 0) return REFUS_ACOMPTE.montantNonPositif
  if (!Number.isInteger(t)) return REFUS_ACOMPTE.montantTropPrecis
  return null
}

export interface EntreeAcompte {
  numeroDevis: string
  lignesDevis: readonly LigneDuDevisPourAcompte[]
  acomptesValides: readonly AcompteValide[]
  demande: DemandeAcompte
  etat: EtatPourAcompte
}

export type AcomptePrepare =
  | {
      ok: true
      // La cible HT, en centimes, et le TTC EXACT obtenu (celui d'un TTC demandé peut en différer).
      cibleHt: number
      ttc: number
      lignes: LigneTiree[]
      totaux: LigneCalculee
    }
  | { ok: false; refus: string }

/**
 * La facture d'acompte d'un devis, ou le premier refus que la base opposerait. Une ligne par groupe non nul, de
 * quantité 1 au prix de sa part HT, à son taux et sa nature, qui cite le devis et ce que le cabinet a demandé ; ses
 * totaux par le calcul des lignes de facture.
 */
export function preparerAcompte(e: EntreeAcompte): AcomptePrepare {
  if (!e.etat.accepte) return { ok: false, refus: REFUS_ACOMPTE.nonAccepte }
  if (e.etat.finaleActive) return { ok: false, refus: REFUS_ACOMPTE.finaleActive }
  if (e.etat.acompteEnBrouillon) return { ok: false, refus: REFUS_ACOMPTE.acompteEnBrouillon }
  if (e.etat.mode === 'engagement') return { ok: false, refus: REFUS_ACOMPTE.engagement }
  const refusSaisie = refusDeLaDemande(e.demande)
  if (refusSaisie) return { ok: false, refus: refusSaisie }
  const restes = restesDuDevis(e.lignesDevis, e.acomptesValides)
  if (!restes.ok) return restes
  const groupes = restes.groupes
  const resteTotal = groupes.reduce((s, g) => s + g.reste, 0)
  if (resteTotal === 0) return { ok: false, refus: REFUS_ACOMPTE.sansReste }

  let cibleHt: number
  let quoi: string
  if (e.demande.mode === 'pourcentage') {
    const htDuDevis = groupes.reduce((s, g) => s + g.ht, 0)
    cibleHt = cibleDuPourcentage(htDuDevis, e.demande.pourcentage)
    if (cibleHt === 0) return { ok: false, refus: REFUS_ACOMPTE.moinsDUnCentime }
    if (cibleHt > resteTotal) {
      return {
        ok: false,
        refus: `L’acompte (${enEuros(cibleHt)} HT) dépasse ce qui reste à facturer du devis (${enEuros(resteTotal)} HT).`,
      }
    }
    quoi = enTaux(e.demande.pourcentage)
  } else {
    const ttcDuReste = ttcDesParts(groupes, groupes.map((g) => g.reste))
    if (e.demande.ttcCentimes > ttcDuReste) {
      return {
        ok: false,
        refus: `L’acompte (${enEuros(e.demande.ttcCentimes)} TTC) dépasse ce qui reste à facturer du devis (${enEuros(ttcDuReste)} TTC).`,
      }
    }
    cibleHt = cibleDuTtc(groupes, e.demande.ttcCentimes).ht
    quoi = `${enEuros(e.demande.ttcCentimes)} TTC`
  }

  const parts = repartirSurLesRestes(groupes, cibleHt)
  const nonNulles = lignesDesParts(groupes, parts)
  const lignes: LigneTiree[] = nonNulles.map(({ g, part }) => ({
    designation:
      `Acompte de ${quoi} sur le devis ${e.numeroDevis}` +
      (nonNulles.length > 1 ? ` — ${g.nature ? `${g.nature}, ` : ''}TVA ${enTaux(g.taux_tva)}` : ''),
    quantite: 1,
    prix_unitaire_ht: part / 100,
    taux_tva: g.taux_tva,
    nature: g.nature,
    reprise_facture_id: null,
  }))
  const totaux = calculerTotaux(lignes)
  return { ok: true, cibleHt, ttc: Math.round(totaux.montant_ttc * 100), lignes, totaux }
}

/**
 * Les lignes de la facture finale : celles du devis, puis chaque ligne de chaque acompte validé au signe opposé
 * (quantité −1, même prix, même taux, même nature), qui cite la facture d'acompte et sa date et porte son identifiant à
 * part. `calculerLigne` arrondit le demi loin de zéro dans les deux sens : la TVA d'une reprise est l'opposé EXACT de
 * celle de la ligne reprise, et aucune TVA n'est facturée deux fois.
 */
export function lignesDeLaFinale(
  lignesDevis: readonly LigneDuDevisPourAcompte[],
  acomptes: readonly AcompteValide[],
): LigneTiree[] {
  const lignes: LigneTiree[] = lignesDevis.map((l) => ({
    designation: l.designation,
    quantite: l.quantite,
    prix_unitaire_ht: l.prix_unitaire_ht,
    taux_tva: l.taux_tva,
    nature: l.nature ?? null,
    reprise_facture_id: null,
  }))
  for (const a of acomptes) {
    for (const l of a.lignes) {
      lignes.push({
        designation: `Reprise de l’acompte ${a.numero} du ${formatDate(a.date)}`,
        quantite: -1,
        prix_unitaire_ht: l.prix_unitaire_ht,
        taux_tva: l.taux_tva,
        nature: l.nature ?? null,
        reprise_facture_id: a.id,
      })
    }
  }
  return lignes
}

/** Les totaux d'une facture par taux, en centimes, dans l'ordre de première apparition. */
export function totauxParTaux(
  lignes: readonly { quantite: number; prix_unitaire_ht: number; taux_tva: number }[],
): { taux_tva: number; ht: number; tva: number }[] {
  const parTaux = new Map<number, { taux_tva: number; ht: number; tva: number }>()
  for (const l of lignes) {
    const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    const t = parTaux.get(l.taux_tva) ?? { taux_tva: l.taux_tva, ht: 0, tva: 0 }
    t.ht += Math.round(c.montant_ht * 100)
    t.tva += Math.round(c.montant_tva * 100)
    parTaux.set(l.taux_tva, t)
  }
  return [...parTaux.values()]
}

/**
 * Ce que la facture finale refuserait : un taux dont le HT serait négatif (des reprises au-delà du devis). Sa TVA, elle,
 * peut être de quelques centimes sous zéro à un taux que les acomptes couvrent en entier : la TVA du devis est la somme
 * des arrondis de ses lignes, celle d'un acompte l'arrondi de sa part (deux lignes de 10,02 € à 20 % font 4,00 € de
 * TVA, l'acompte de 20,04 € en fait 4,01 €). La somme des deux factures reste celle du devis, au centime ; ce reste
 * négatif n'est pas refusé ici (question ouverte pour P5b2).
 */
export function refusDeLaFinale(lignes: readonly { quantite: number; prix_unitaire_ht: number; taux_tva: number }[]): string | null {
  const negatif = totauxParTaux(lignes).find((t) => t.ht < 0)
  return negatif ? `La facture finale serait négative à ${enTaux(negatif.taux_tva)} : les acomptes repris dépassent le devis.` : null
}
