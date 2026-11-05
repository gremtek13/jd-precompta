import {
  REFUS_ACOMPTE, enTaux, groupesDuDevis, lignesDeLaFinale, refusDeLaFinale, refusDeTvaNegative, totauxParTaux,
  type LigneDuDevisPourAcompte,
} from './acompteDevis'
import { etatDesAcomptes, type AcomptesLus, type EtatAcomptesDuDevis, type FactureDuDevis } from './acomptesDuDevis'
import { calculerLigne, calculerTotaux } from './montantsFacture'
import { formatDate, formatMoney } from './format'
import type { LigneAEnregistrer } from './factures'
import type { FactureEmise, NatureArticle } from './types'

// LA FACTURE D'ACOMPTE ET LA FACTURE FINALE D'UN DEVIS DANS L'ONGLET DES FACTURES (espace client, étape P5b5b ; conception :
// HISTORIQUE.md, « L'ACOMPTE D'UN DEVIS : LA CONCEPTION (P5B) »), derrière `ACOMPTES_PREVUS` (lib/devis.ts) : la migration
// `acomptes_des_devis` est PRÉPARÉE, pas appliquée. Un module PUR — il ne lit rien, n'appelle personne, ne lit pas l'horloge —
// que l'onglet des factures des deux espaces lit (FacturesTab, FactureFormModal, FactureAvoirModal) : ce qu'est chaque facture
// (une facture d'acompte, la finale d'un devis, ni l'une ni l'autre), sa marque dans la liste, et ce que `enregistrer_facture`
// REMPLACÉE refuserait — sur le brouillon d'un acompte (ses lignes ne se retouchent pas), à la validation d'un acompte et d'une
// finale, sur l'avoir d'un acompte ou d'une finale —, dans l'ordre et sous les mots de la migration, que
// acomptesDesFactures.test.ts confronte à son texte. Les calculs sont ceux de lib/acompteDevis.ts, jamais recopiés.
//
// LES RÉPONSES SUIVIES, sur la recommandation, en attendant le cabinet : P5B2-Q2 (l'avoir d'un acompte se refuse tant qu'une
// facture finale validée et non créditée en entier le reprend ; la finale annulée en entier, l'acompte peut l'être à son tour),
// P5B2-Q3 (les refus de la base dits avant le clic, aux mêmes mots), P5B-Q4 (une finale créditée en entier n'est plus active).

// ── Ce que la lecture rend (lib/acomptesDesFacturesLecture.ts) ────────────────────────────────────────────────────────
/** Un devis lié à une facture : son numéro et ses lignes, ce que la validation d'un acompte juge. */
export interface DevisDesFactures {
  id: string
  numero: string | null
  lignes: LigneDuDevisPourAcompte[]
}

/** Une ligne d'une facture finale ou d'un avoir de celle-ci, sa reprise comprise. */
export interface LigneDeFinale {
  facture_id: string
  ordre: number
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  nature: NatureArticle | null
  reprise_facture_id: string | null
}

export interface AcomptesDesFacturesLus extends AcomptesLus {
  devis: DevisDesFactures[]
  // La date du versement de chaque facture d'acompte (BT-9 ; nulle : celle de la facture).
  versements: { facture_id: string; date_versement_acompte: string | null }[]
  // Les lignes des factures finales et de leurs avoirs : les reprises qu'elles portent ou défont.
  lignesDesFinales: LigneDeFinale[]
}

export type LectureDesAcomptesDesFactures =
  | { dossierId: string; etat: 'sans' }
  | ({ dossierId: string; etat: 'lue' } & AcomptesDesFacturesLus)
  | { dossierId: string; etat: 'illisible'; motif: string }

// ── Ce qu'est une facture ──────────────────────────────────────────────────────────────────────────────────────────
interface Commun {
  facture: FactureDuDevis
  devis: DevisDesFactures
  acomptes: EtatAcomptesDuDevis
  lus: AcomptesDesFacturesLus
}

export type AcompteDeLaFacture =
  // Ni acompte ni finale — ou le drapeau baissé : l'onglet d'hier.
  | { etat: 'sans' }
  // Pas encore lu, ou illisible : aucun geste qui en dépend ne s'offre, et l'écran dit pourquoi.
  | { etat: 'retenu'; avis: string }
  | ({ etat: 'acompte'; dateVersement: string | null } & Commun)
  | ({ etat: 'finale' } & Commun)

export const SANS_ACOMPTE: AcompteDeLaFacture = Object.freeze({ etat: 'sans' })

export const ACOMPTES_EN_LECTURE =
  'Lecture des acomptes des devis… Rien n’est proposé sur cette facture avant : on ne sait pas encore si c’est une facture '
  + 'd’acompte ou une facture finale.'

export function acomptesIllisibles(motif: string): string {
  return `Les acomptes des devis n’ont pas pu être lus (${motif}) : on ne sait pas si cette facture est une facture d’acompte `
    + 'ou une facture finale, et rien n’est proposé qui en dépende. Recharge la page.'
}

/**
 * Ce qu'est la facture, sur les acomptes du dossier lus en entier. `lecture` nulle : pas encore revenue pour ce dossier. Un
 * avoir n'est ni l'un ni l'autre (la fenêtre de l'avoir juge la facture qu'il corrige).
 */
export function acompteDeLaFacture(lecture: LectureDesAcomptesDesFactures | null, factureId: string): AcompteDeLaFacture {
  if (lecture === null) return { etat: 'retenu', avis: ACOMPTES_EN_LECTURE }
  if (lecture.etat === 'sans') return SANS_ACOMPTE
  if (lecture.etat === 'illisible') return { etat: 'retenu', avis: acomptesIllisibles(lecture.motif) }
  const facture = lecture.factures.find((f) => f.id === factureId)
  if (!facture) return { etat: 'retenu', avis: acomptesIllisibles('la facture n’a pas été relue avec les acomptes') }
  if (facture.type === 'avoir') return SANS_ACOMPTE
  const lien = lecture.liens.find((l) => l.facture_id === factureId)
  if (!lien) return facture.acompte ? { etat: 'retenu', avis: acomptesIllisibles('une facture d’acompte sans son devis') } : SANS_ACOMPTE
  if ((lien.role === 'acompte') !== facture.acompte) {
    return { etat: 'retenu', avis: acomptesIllisibles('le rôle du lien ne suit pas la marque de la facture') }
  }
  const devis = lecture.devis.find((d) => d.id === lien.devis_id)
  if (!devis) return { etat: 'retenu', avis: acomptesIllisibles('le devis dont la facture est tirée n’a pas été lu') }
  const e = etatDesAcomptes(devis.id, lecture)
  if (!e.ok) return { etat: 'retenu', avis: acomptesIllisibles(e.motif) }
  const commun: Commun = { facture, devis, acomptes: e.etat, lus: lecture }
  if (lien.role === 'acompte') {
    const versement = lecture.versements.find((v) => v.facture_id === factureId)
    if (!versement) return { etat: 'retenu', avis: acomptesIllisibles('la date du versement n’a pas été lue') }
    return { etat: 'acompte', dateVersement: versement.date_versement_acompte, ...commun }
  }
  return { etat: 'finale', ...commun }
}

/**
 * La marque de la ligne dans la liste : « Acompte » pour une facture d'acompte, « Finale » pour la facture finale d'un devis
 * qui a des acomptes — la facture tirée d'un devis sans acompte reste une facture. Null sinon.
 */
export function marqueDeLaFacture(a: AcompteDeLaFacture): 'Acompte' | 'Finale' | null {
  if (a.etat === 'acompte') return 'Acompte'
  if (a.etat === 'finale' && a.lus.liens.some((l) => l.devis_id === a.devis.id && l.role === 'acompte')) return 'Finale'
  return null
}

/** Ce que la recherche lit de la marque : « Acompte » et « facture d'acompte », « Finale » et « facture finale ». */
export function motsDeLaMarque(marque: 'Acompte' | 'Finale' | null): string | null {
  return marque === 'Acompte' ? 'Acompte facture d’acompte' : marque === 'Finale' ? 'Finale facture finale' : null
}

// ── Les refus, aux mots de la migration ────────────────────────────────────────────────────────────────────────────
/** Le refus d'`enregistrer_facture` sur des lignes ou des montants d'acompte retouchés : la note du formulaire. */
export const LIGNES_D_ACOMPTE_FIGEES =
  'Les lignes et les montants d’une facture d’acompte se calculent du devis : ils ne se retouchent pas. Supprimez le brouillon pour en tirer un autre.'

export const REFUS_FINALE_ACOMPTE_EN_BROUILLON =
  'Un acompte du devis est encore en brouillon : la facture finale ne se valide qu’une fois ses acomptes validés ou supprimés.'

export function refusLigneHorsDuDevis(taux: number, numeroDevis: string | null): string {
  return `L’acompte porte une ligne à ${enTaux(taux)} que le devis ${numeroDevis ?? ''} n’a pas : il ne se valide pas.`
}
export function refusCumulDesAcomptes(numeroDevis: string | null, taux: number): string {
  return `Le cumul des acomptes du devis ${numeroDevis ?? ''} dépasse le devis à ${enTaux(taux)} : cet acompte ne se valide pas.`
}
export function refusRepriseInexacte(numeroAcompte: string): string {
  return `La facture finale ne reprend pas exactement l’acompte ${numeroAcompte} : chacune de ses lignes s’y reprend une fois, au signe opposé.`
}
export function refusRepriseHorsVigueur(acompte: string): string {
  return `La facture finale reprend l’acompte ${acompte}, qui n’est plus un acompte en vigueur de son devis (validé et non crédité).`
}
export function refusAcompteRepris(numeroAcompte: string | null, numeroFinale: string | null): string {
  return `L’acompte ${numeroAcompte ?? ''} est repris par la facture finale ${numeroFinale ?? ''} : il ne se crédite pas tant qu’elle le reprend — un avoir de la facture finale d’abord.`
}
// Le montant comme `to_char(…, 'FM999999999990.00')` puis la virgule : sans séparateur de milliers.
const enTexteDeLaBase = (euros: number) => euros.toFixed(2).replace('.', ',')
export function refusAvoirPartielDAcompte(numeroAcompte: string | null, ttc: number): string {
  return `L’avoir d’un acompte le crédite en entier, à chaque taux et en une fois : l’acompte ${numeroAcompte ?? ''}, de ${enTexteDeLaBase(ttc)} € TTC, ne se crédite pas en partie.`
}
export function refusRepriseDefaite(numeroFinale: string | null): string {
  return `L’avoir défait une reprise que la facture finale ${numeroFinale ?? ''} ne porte pas, ou que d’autres avoirs ont déjà défaite.`
}

const centimesHt = (l: { quantite: number; prix_unitaire_ht: number; taux_tva: number }) =>
  Math.round(calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva).montant_ht * 100)
const cle = (taux: number, nature: NatureArticle | null | undefined) => `${taux}|${nature ?? ''}`

/** Une ligne telle qu'elle part à `enregistrer_facture`, ce que les refus de l'acompte et de la finale lisent. */
export interface LigneJugee {
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  nature?: NatureArticle | null
  reprise_facture_id?: string | null
}

/**
 * Ce que la VALIDATION d'un brouillon d'acompte refuserait, dans l'ordre de la base : une ligne hors des groupes (taux,
 * nature) du devis, puis un groupe que le cumul des acomptes en vigueur et de celui-ci dépasse, puis la finale qu'il
 * laisserait (P5B-Q5 : tout le devis couvert, ou une TVA négative). Null quand il se validerait.
 */
export function refusDeLaValidationDeLAcompte(a: Extract<AcompteDeLaFacture, { etat: 'acompte' }>, lignes: readonly LigneJugee[]): string | null {
  const groupes = groupesDuDevis(a.devis.lignes)
  const parCle = new Map(groupes.map((g) => [cle(g.taux_tva, g.nature), { ...g, pris: 0 }]))
  // L'acompte jugé d'abord, puis ceux en vigueur dans leur ordre : la ligne que la base nomme est la première de cet ordre.
  const pris = [...lignes, ...a.acomptes.acomptesValides.filter((v) => v.id !== a.facture.id).flatMap((v) => v.lignes)]
  const absente = pris.find((l) => !parCle.has(cle(l.taux_tva, l.nature)))
  if (absente) return refusLigneHorsDuDevis(absente.taux_tva, a.devis.numero)
  for (const l of pris) parCle.get(cle(l.taux_tva, l.nature))!.pris += centimesHt(l)
  const depasse = [...parCle.values()].find((g) => g.ht < g.pris)
  if (depasse) return refusCumulDesAcomptes(a.devis.numero, depasse.taux_tva)
  const laissee = totauxParTaux([
    ...lignesDeLaFinale(a.devis.lignes, a.acomptes.acomptesValides.filter((v) => v.id !== a.facture.id)),
    ...lignes.map((l) => ({ quantite: -1, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva })),
  ])
  if (laissee.every((t) => t.ht === 0)) return REFUS_ACOMPTE.couvreToutLeDevis
  const tva = laissee.find((t) => t.tva < 0)
  return tva ? refusDeTvaNegative(tva.taux_tva, tva.tva) : null
}

const numeroDe = (lus: AcomptesDesFacturesLus, id: string) => lus.factures.find((f) => f.id === id)?.numero ?? null

/**
 * Ce que la VALIDATION d'une finale refuserait, dans l'ordre de la base : un acompte du devis en brouillon, puis un acompte en
 * vigueur pas repris exactement (chacune de ses lignes une fois, à la quantité −1, au même prix, taux et nature), puis une
 * reprise d'un acompte qui n'est plus en vigueur, puis `refusDeLaFinale` (aucun taux négatif, en HT puis en TVA).
 */
export function refusDeLaValidationDeLaFinale(f: Extract<AcompteDeLaFacture, { etat: 'finale' }>, lignes: readonly LigneJugee[]): string | null {
  const brouillon = f.lus.liens.some((l) => l.devis_id === f.devis.id && l.role === 'acompte'
    && f.lus.factures.find((x) => x.id === l.facture_id)?.statut !== 'validee')
  if (brouillon) return REFUS_FINALE_ACOMPTE_EN_BROUILLON
  const cleDeReprise = (l: { prix_unitaire_ht: number; taux_tva: number; nature?: NatureArticle | null }) =>
    `${l.prix_unitaire_ht}|${l.taux_tva}|${l.nature ?? ''}`
  const trie = (cles: string[]) => [...cles].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join(';')
  for (const a of f.acomptes.acomptesValides) {
    const siennes = lignes.filter((l) => l.reprise_facture_id === a.id)
    if (siennes.some((l) => l.quantite !== -1) || trie(a.lignes.map(cleDeReprise)) !== trie(siennes.map(cleDeReprise))) {
      return refusRepriseInexacte(a.numero)
    }
  }
  const enVigueur = new Set(f.acomptes.acomptesValides.map((a) => a.id))
  const horsVigueur = lignes.find((l) => l.reprise_facture_id != null && !enVigueur.has(l.reprise_facture_id))
  if (horsVigueur) return refusRepriseHorsVigueur(numeroDe(f.lus, horsVigueur.reprise_facture_id!) ?? horsVigueur.reprise_facture_id!)
  return refusDeLaFinale(lignes)
}

/** La confirmation de la validation : elle nomme ce qui part — la facture d'acompte et son devis, ou la finale, ses reprises, le net. */
export function confirmationDeLaValidation(a: AcompteDeLaFacture, lignes: readonly LigneJugee[]): string | null {
  const ttc = calculerTotaux(lignes.map((l) => ({ quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva }))).montant_ttc
  if (a.etat === 'acompte') {
    const versement = a.dateVersement ? `, l’acompte versé le ${formatDate(a.dateVersement)}` : ''
    return `C’est une FACTURE D’ACOMPTE sur le devis ${a.devis.numero ?? ''}, de ${formatMoney(ttc)} TTC${versement}. Validée, elle `
      + 'ne se corrige plus que par un avoir qui la crédite en entier ; la facture finale du devis la reprendra en déduction.'
  }
  if (a.etat !== 'finale') return null
  const repris = [...new Set(lignes.map((l) => l.reprise_facture_id).filter((x): x is string => x != null))]
    .map((id) => a.lus.factures.find((x) => x.id === id))
    .filter((x): x is FactureDuDevis => x != null)
  const reprises = repris.length === 0
    ? 'Aucun acompte n’y est repris : elle porte le devis entier.'
    : `Elle reprend en déduction ${repris.length === 1 ? 'l’acompte' : 'les acomptes'} `
      + repris.map((x) => `${x.numero ?? ''} du ${formatDate(x.date_emission)} (${formatMoney(x.montant_ttc)} TTC)`).join(', ')
      + ` : net à payer ${formatMoney(ttc)} TTC.`
  return `C’est la FACTURE FINALE du devis ${a.devis.numero ?? ''}. ${reprises}`
}

// ── L'avoir ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une ligne d'avoir telle que l'écran la tient : la quantité CRÉDITÉE (une reprise de la finale se crédite à −1). */
export type LigneCreditee = LigneAEnregistrer & { nature?: NatureArticle | null; reprise_facture_id?: string | null }

/**
 * Ce que la base refuserait d'un avoir, dans son ordre : `refusAvoir` d'hier (lib/factures.ts), la quantité créditée positive
 * EXCEPTÉE pour une ligne qui défait une reprise de la finale, puis — sur l'avoir d'un acompte — la finale qui le reprend
 * encore (P5B2-Q2) et le crédit qui n'est pas entier, puis — sur l'avoir d'une finale — une reprise que la finale ne porte pas
 * ou que d'autres avoirs ont déjà défaite. `credite` nul : la liste des factures lue en partie, le plafond jugé par la base.
 */
export function refusDeLAvoir(
  origine: Pick<FactureEmise, 'id' | 'type' | 'statut' | 'numero' | 'date_emission' | 'montant_ttc'>,
  a: AcompteDeLaFacture,
  dateEmission: string,
  lignes: readonly LigneCreditee[],
  credite: number | null,
): string | null {
  if (lignes.length === 0) return 'Au moins une ligne avec une quantité doit rester à créditer.'
  if (origine.type !== 'facture' || origine.statut !== 'validee') return 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.'
  if (!dateEmission) return "Indique la date d'émission de l'avoir."
  if (dateEmission < origine.date_emission) return `Un avoir ne précède pas la facture qu'il corrige (émise le ${formatDate(origine.date_emission)}).`
  const defaitUneReprise = (l: LigneCreditee) => a.etat === 'finale' && l.reprise_facture_id != null
  if (lignes.some((l) => !defaitUneReprise(l) && !(l.quantite > 0))) return 'Chaque ligne créditée porte une quantité positive.'
  const montant = Math.round(calculerTotaux(lignes.map((l) => ({ ...l }))).montant_ttc * 100)
  if (montant <= 0) return 'Un avoir crédite un montant : son total TTC doit être positif.'
  if (credite !== null) {
    const reste = Math.round(origine.montant_ttc * 100) - Math.round(credite * 100)
    if (montant > reste) {
      return `Cet avoir créditerait ${formatMoney(montant / 100)} : la facture ${origine.numero ?? ''} n'a plus que `
        + `${formatMoney(Math.max(reste, 0) / 100)} à créditer.`
    }
  }
  if (a.etat === 'acompte') {
    const reprend = finalesQuiReprennent(a)
    if (reprend.length > 0) return refusAcompteRepris(origine.numero, reprend[0].numero)
    const parTaux = new Map<number, { ht: number; tva: number }>()
    const ajouter = (l: { quantite: number; prix_unitaire_ht: number; taux_tva: number }, signe: number) => {
      const c = calculerLigne(signe * l.quantite, l.prix_unitaire_ht, l.taux_tva)
      const t = parTaux.get(l.taux_tva) ?? { ht: 0, tva: 0 }
      t.ht += Math.round(c.montant_ht * 100)
      t.tva += Math.round(c.montant_tva * 100)
      parTaux.set(l.taux_tva, t)
    }
    for (const l of lignes) ajouter(l, -1)
    for (const l of a.acomptes.acomptesValides.find((v) => v.id === origine.id)?.lignes ?? []) ajouter(l, 1)
    const dejaCredite = credite === null ? 0 : Math.round(credite * 100)
    const enVigueur = a.acomptes.acomptesValides.some((v) => v.id === origine.id)
    if (dejaCredite !== 0 || !enVigueur || montant !== Math.round(origine.montant_ttc * 100)
      || [...parTaux.values()].some((t) => t.ht !== 0 || t.tva !== 0)) {
      return refusAvoirPartielDAcompte(origine.numero, origine.montant_ttc)
    }
  }
  if (a.etat === 'finale') {
    const compte = (cles: string[]) => cles.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())
    const cleR = (l: { reprise_facture_id?: string | null; prix_unitaire_ht: number; taux_tva: number; nature?: NatureArticle | null }) =>
      `${l.reprise_facture_id}|${l.prix_unitaire_ht}|${l.taux_tva}|${l.nature ?? ''}`
    const avoirs = new Set(a.lus.factures.filter((x) => x.type === 'avoir' && x.facture_origine_id === origine.id).map((x) => x.id))
    const portees = compte(a.lus.lignesDesFinales.filter((l) => l.facture_id === origine.id && l.reprise_facture_id != null).map(cleR))
    const defaites = compte([
      ...lignes.filter((l) => l.reprise_facture_id != null).map(cleR),
      ...a.lus.lignesDesFinales.filter((l) => avoirs.has(l.facture_id) && l.reprise_facture_id != null).map(cleR),
    ])
    const exces = [...defaites].some(([k, n]) => n > (portees.get(k) ?? 0))
    if (lignes.some((l) => l.reprise_facture_id != null && l.quantite !== -1) || exces) return refusRepriseDefaite(origine.numero)
  }
  return null
}

/** Les finales validées et actives (P5B-Q4) du devis d'un acompte qui le reprennent, par date puis numéro. */
function finalesQuiReprennent(a: Extract<AcompteDeLaFacture, { etat: 'acompte' }>): FactureDuDevis[] {
  const active = a.acomptes.finaleActive?.factureId ?? null
  return a.lus.liens
    .filter((l) => l.devis_id === a.devis.id && l.role === 'finale')
    .map((l) => a.lus.factures.find((f) => f.id === l.facture_id))
    .filter((f): f is FactureDuDevis => f != null && f.statut === 'validee' && f.id === active
      && a.lus.lignesDesFinales.some((x) => x.facture_id === f.id && x.reprise_facture_id === a.facture.id))
    .sort((x, y) => (x.date_emission < y.date_emission ? -1 : x.date_emission > y.date_emission ? 1 : (x.numero ?? '') < (y.numero ?? '') ? -1 : 1))
}

/** Ce que la fenêtre de l'avoir dit avant le clic : l'avoir d'un acompte le crédite en entier ; celui d'une finale défait ses reprises. */
export function avisDeLAvoir(a: AcompteDeLaFacture, lignes: readonly LigneCreditee[]): string | null {
  if (a.etat === 'acompte') {
    return 'L’avoir d’une facture d’acompte la crédite en entier, à chaque taux et en une fois : ses lignes ne se retouchent pas. '
      + 'Crédité, l’acompte n’est plus repris par la facture finale du devis.'
  }
  if (a.etat !== 'finale') return null
  const defaites = [...new Set(lignes.map((l) => l.reprise_facture_id).filter((x): x is string => x != null))]
    .map((id) => numeroDe(a.lus, id) ?? id)
  if (defaites.length === 0) return null
  return `Cet avoir défait la reprise ${defaites.length === 1 ? 'de l’acompte' : 'des acomptes'} ${defaites.join(', ')} : `
    + 'ses lignes de reprise ne se retouchent pas. Crédité en entier, l’avoir laisse tirer du devis une nouvelle facture finale, '
    + 'qui reprendra les acomptes en vigueur.'
}
