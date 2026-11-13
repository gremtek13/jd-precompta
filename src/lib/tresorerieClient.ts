import { facturesAEncaisser, motsDuSolde } from './analyseClient'
import { soldeAuReleve, type SoldeLu } from './banqueClient'
import { banqueParCompte, type ComptesDuClient } from './banqueClientParCompte'
import {
  composerEcheancier, dateEnLettres, type CotisationDeLEcheancier, type DossierDeLEcheancier, type EcheanceDuClient, type NatureEcheance,
} from './echeancierClient'
import type { ImpotDuDossier } from './echeancesFiscales'
import { ajouterJours } from './format'
import type { LectureComplete } from './lectureComplete'
import type { ListesDesVentes } from './tuilesVentes'
import type { ControleReleveBancaire, LigneBancaire } from './types'

// « MA TRÉSORERIE À 90 JOURS » (ligne 51.5, partie C, étape C8 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE
// GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », partie C, la proposition C8 et son étape). Voir venir un
// découvert : le solde LU, plus ce que les clients doivent, à l'échéance de chaque facture, moins ce qui est dû à l'État et
// à l'Urssaf (l'échéancier de C1), jour après jour, sur les 90 jours de Paris qui viennent. SANS migration : la page ne lit
// que ce que les cases « Banque » et « Ventes » ouvrent déjà, par les lectures de « Mon analyse » et de « Mon échéancier ».
//
// RIEN N'EST JUGÉ À NOUVEAU : le solde est celui de `soldeAuReleve` (le dernier relevé au solde contrôlé, jamais une somme
// de mouvements), compte par compte avec `banqueParCompte` quand le dossier en tient plusieurs ; le reste dû d'une facture,
// `facturesAEncaisser` (lib/analyseClient.ts) ; les échéances et leurs montants, `composerEcheancier` (lib/echeancierClient.ts).
//
// LES CHOIX (récit : HISTORIQUE.md, « 13/11/2026 — « MA TRÉSORERIE À 90 JOURS » (C8) ») :
// - La page s'ouvre avec la case « Banque » : sans solde, rien ne se projette. « Ventes » ajoute les créances ; sans elle,
//   elles sont « non comptées », et la page le dit.
// - L'horizon : d'aujourd'hui (inclus, au jour de Paris) à aujourd'hui plus 90 jours (exclu) — la convention de l'échéancier.
// - Seule une créance À VENIR dans l'horizon entre dans la projection, à son échéance ; une facture en retard, sans échéance
//   ou échue après l'horizon se dit à part, non comptée : la projection ne promet jamais un encaissement dont la date n'est
//   pas sûre. Le même jour, les sorties passent avant les entrées : le point le plus bas n'est jamais flatté.
// - Une échéance sans montant connu (impôts, TVA) se nomme, non comptée : jamais 0.
// - « Prévision » : un montant que personne n'a encore appelé — l'échéance prévisionnelle d'une caisse, l'impôt calculé sur
//   un barème à confirmer (`MontantDEcheance.estimation`). Le prévisionnel du CABINET (le plan de trésorerie de l'onglet
//   Financement) ne se lit pas : il se calcule des écritures, que le client ne lit jamais ; le montrer demanderait une
//   publication (comme les situations de C4), donc une migration — la question C8-Q2.
// - Les achats (ce que tu dois à tes fournisseurs) attendent la table de B4 (`ACHATS_DU_CLIENT_PREVUS`, baissé) : non
//   comptés, dits ; tresorerieClient.test.ts refuse ce drapeau levé tant qu'ils ne sont pas comptés ici.
// - Une source lue en partie rend la projection MUETTE, avec son motif : un solde à 90 jours sans une partie de ses sorties
//   serait trop beau, sans une partie de ses entrées trop sombre, et l'un comme l'autre se lirait comme un chiffre.
//
// Tout montant en centimes entiers. Module PUR : la lecture est dans lib/tresorerieClientLecture.ts. Les mots tutoient et ne
// nomment aucun onglet (`MOTS_DU_CABINET`, confronté par le test). Rien ne s'écrit depuis cette page.

// ── Le drapeau, et qui voit la page ───────────────────────────────────────────────────────────────────────────────────
/**
 * La page « Ma trésorerie » (sa route, App.tsx ; son entrée, Layout.tsx) : BAISSÉ tant que le cabinet ne l'a pas vue (la
 * question C8-Q1). Aucune migration ne l'attend : le lever ne demande que le commit. Son état d'avant reste éprouvé
 * (espaceClientTresorerie.test.tsx joue les deux).
 */
export const TRESORERIE_A_90_JOURS_OFFERTE = false

/** La page s'offre-t-elle ? Avec son drapeau, et quand « Ma banque » s'offre sur la société affichée (`maBanqueOuverte`). */
export function maTresorerieOuverte(offerte: boolean, maBanque: boolean): boolean {
  return offerte && maBanque
}

// ── L'horizon ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const HORIZON_EN_JOURS = 90

/** Le premier jour HORS de l'horizon : aujourd'hui plus 90 jours (exclu). */
export function finDeLHorizon(aujourdHui: string): string {
  return ajouterJours(aujourdHui, HORIZON_EN_JOURS)
}

/** Le dernier jour de l'horizon, tel que la page le dit (« jusqu'au … »). */
export function dernierJourDeLHorizon(aujourdHui: string): string {
  return ajouterJours(aujourdHui, HORIZON_EN_JOURS - 1)
}

// ── Le départ : le solde lu ────────────────────────────────────────────────────────────────────────────────────────────
export type ControleDeLaTresorerie = Pick<ControleReleveBancaire, 'id' | 'solde_final' | 'coherent' | 'periode_fin' | 'created_at'>
  & { compte_bancaire_id?: string | null }

/**
 * Les soldes lus, un par compte : un seul tant que le dossier ne tient qu'un compte (ou que `COMPTES_BANCAIRES_PREVUS` est
 * baissé, `comptes` à `sans_objet`) ; un par compte sinon. Les comptes retenus par `banqueParCompte` (un relevé d'un compte
 * que la lecture n'a pas rendu) : muet, avec sa raison.
 */
export function soldesDeLaBanque(
  comptes: ComptesDuClient, controles: LectureComplete<ControleDeLaTresorerie>,
): { etat: 'retenus'; raison: string } | { etat: 'lus'; soldes: SoldeLu[] } {
  // Les mouvements ne servent qu'aux mois manquants, que la trésorerie ne dit pas : une liste vide et entière.
  const banque = banqueParCompte(comptes, { lignes: [], complete: true, motif: null }, controles)
  if (banque.etat === 'retenue') return { etat: 'retenus', raison: banque.raison }
  if (banque.etat === 'un') return { etat: 'lus', soldes: [soldeAuReleve(controles)] }
  return { etat: 'lus', soldes: banque.comptes.map((c) => c.solde) }
}

export type Depart =
  | { etat: 'muet'; motif: string }
  | { etat: 'sans_solde'; phrase: string }
  | {
    etat: 'lu'
    centimes: number
    /** La date du solde le plus ANCIEN : ce qui a bougé depuis n'est pas compté. */
    au: string
    comptes: number
    /** Vrai quand les comptes n'ont pas leur dernier relevé à la même date. */
    datesDifferentes: boolean
  }

/** Le départ de la projection : la somme des soldes lus, en centimes, ou ce qui l'empêche. */
export function departDesSoldes(soldes: readonly SoldeLu[]): Depart {
  if (soldes.length === 0) return { etat: 'muet', motif: 'aucun compte bancaire n’a été rendu' }
  const muet = soldes.find((s): s is Extract<SoldeLu, { etat: 'muet' }> => s.etat === 'muet')
  if (muet) return { etat: 'muet', motif: muet.motif }
  const manquant = soldes.find((s) => s.etat !== 'lu')
  if (manquant) {
    return {
      etat: 'sans_solde',
      phrase: soldes.length === 1 ? motsDuSolde(manquant) : `Un de tes comptes bancaires n’a pas de solde contrôlé : ${motsDuSolde(manquant).replace(/^Pas de solde à afficher : /, '')}`,
    }
  }
  const lus = soldes as readonly Extract<SoldeLu, { etat: 'lu' }>[]
  const dates = lus.map((s) => s.au).sort()
  return {
    etat: 'lu',
    centimes: lus.reduce((t, s) => t + Math.round(s.solde * 100), 0),
    au: dates[0],
    comptes: lus.length,
    datesDifferentes: dates[0] !== dates[dates.length - 1],
  }
}

// ── Les sources ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Les ventes : `fermees` sans la case « Ventes » (non comptées, dit) ; les listes telles que la lecture les rend sinon. */
export type CreancesDeLaTresorerie =
  | { etat: 'fermees' }
  | { etat: 'illisibles'; motif: string }
  | { etat: 'lues'; listes: Pick<ListesDesVentes, 'factures' | 'facturesIncompletes' | 'lignes' | 'encaissements' | 'parts' | 'encaissementsIncomplets'> }

/** Les échéances de l'échéancier (C1), composées AVEC leurs montants ; `partiel` dit une lecture incomplète. */
export type EcheancesDeLaTresorerie =
  | { etat: 'illisibles'; motif: string }
  | {
    etat: 'lues'
    echeances: readonly EcheanceDuClient[]
    /** Les échéances de cotisation lues, avec leur montant versé : ce qui dit si l'une est peut-être déjà payée. */
    cotisations: readonly CotisationDeLEcheancier[]
    partiel: string | null
  }

/** Ce que la trésorerie lit d'un mouvement du relevé : sa date, son montant, et l'échéance de cotisation qu'il paie. */
export type MouvementDuReleve = Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'cotisation_id'>
export const COLONNES_DU_RELEVE = 'id, date, montant, cotisation_id'

/** La lecture de l'échéancier (lib/echeancierClientLecture.ts, `LectureEcheancier`), redite ici : un module de calcul ne
 *  dépend d'aucun module qui lit. */
export type EcheancierLu =
  | { etat: 'lu' | 'partiel'; dossier: DossierDeLEcheancier | null; cotisations: readonly CotisationDeLEcheancier[]; motif: string | null }
  | { etat: 'illisible'; motif: string }

/**
 * Les échéances de C1, composées AVEC leurs montants (la page ne s'ouvre qu'avec « Banque ») ; lues en partie, `partiel`
 * porte le motif. `impot` : obligatoire, comme pour l'échéancier (`SANS_IMPOT_SUR_LES_SOCIETES` tant que LIA4 n'est pas là).
 */
export function echeancesDeLEcheancier(lecture: EcheancierLu, aujourdHui: string, impot: ImpotDuDossier): EcheancesDeLaTresorerie {
  if (lecture.etat === 'illisible') return { etat: 'illisibles', motif: lecture.motif }
  const echeancier = composerEcheancier({ aujourdHui, dossier: lecture.dossier, cotisations: lecture.cotisations, avecMontants: true, impot })
  return {
    etat: 'lues', echeances: echeancier.echeances, cotisations: lecture.cotisations,
    partiel: lecture.etat === 'partiel' ? (lecture.motif ?? 'ton échéancier n’a été lu qu’en partie') : null,
  }
}

// ── La projection ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type NatureDuMouvement = 'creance' | NatureEcheance

export interface MouvementPrevu {
  id: string
  date: string
  nature: NatureDuMouvement
  libelle: string
  /** Signé : positif, ce qui entre ; négatif, ce qui sort. */
  centimes: number
  /** Un montant que personne n'a encore appelé (une estimation). */
  prevision: boolean
  /** Le solde après ce mouvement. */
  soldeApresCentimes: number
}

/** Ce que la projection ne compte pas, et pourquoi : chaque ligne se dit. */
export interface NonCompte {
  cle: string
  phrase: string
  /** La somme en jeu quand elle est connue ; nulle sinon (jamais 0 pour « inconnue »). */
  centimes: number | null
}

export type Tresorerie =
  | { etat: 'sans_depart'; depart: Exclude<Depart, { etat: 'lu' }> }
  | { etat: 'muette'; depart: Extract<Depart, { etat: 'lu' }>; motif: string }
  | {
    etat: 'projetee'
    depart: Extract<Depart, { etat: 'lu' }>
    mouvements: MouvementPrevu[]
    entreesCentimes: number
    sortiesCentimes: number
    /** Le solde au dernier jour de l'horizon. */
    finCentimes: number
    /** Le point le plus bas, départ compris, et sa date (la date du solde lu quand c'est le départ). */
    pointBas: { centimes: number; date: string }
    /** Le premier jour où le solde passe sous zéro, ou nul. */
    premierDecouvert: string | null
    avecPrevision: boolean
    nonComptes: NonCompte[]
  }

const RANG_DE_LA_NATURE: Record<NatureEcheance, number> = { impots: 0, tva: 1, cotisations: 2 }

function libelleDeLaFacture(numero: string | null): string {
  return numero ? `Facture ${numero} : ce que ton client te doit encore` : 'Une facture : ce que ton client te doit encore'
}

/** Ce que la trésorerie sait du paiement d'une échéance de cotisation. */
export type ReglementDeLaCotisation =
  | { etat: 'a_payer' }
  /** Payée par un mouvement du relevé daté du jour du solde ou avant : elle est DANS le solde lu. */
  | { etat: 'dans_le_solde'; le: string }
  /** Payée par un mouvement daté après le solde : ni dans le solde, ni à payer encore. */
  | { etat: 'apres_le_solde'; le: string; centimes: number }
  /** Un montant versé est saisi, sans mouvement du relevé qui la paie : peut-être déjà payée, on ne sait pas quand. */
  | { etat: 'peut_etre_payee'; centimes: number | null }

/**
 * Une échéance de cotisation est-elle déjà payée ? Par un mouvement du relevé qui la cite (`lignes_bancaires.cotisation_id`,
 * posé par `rapprocher_cotisation`, que le client « Banque » lit), daté au jour du solde ou avant (dans le solde) ou après ;
 * sinon, un montant versé saisi sans mouvement la dit « peut-être déjà payée », jamais comptée en silence. Une échéance
 * payée depuis le compte personnel ne vient jamais jusqu'ici : l'échéancier l'écarte déjà.
 */
export function reglementDeLaCotisation(
  cotisation: CotisationDeLEcheancier, releve: readonly MouvementDuReleve[], au: string,
): ReglementDeLaCotisation {
  const mouvement = releve.find((m) => m.cotisation_id === cotisation.id)
  if (mouvement) {
    return mouvement.date <= au
      ? { etat: 'dans_le_solde', le: mouvement.date }
      : { etat: 'apres_le_solde', le: mouvement.date, centimes: Math.abs(Math.round(mouvement.montant * 100)) }
  }
  if (cotisation.montant_verse != null) {
    const montant = cotisation.montant_verse
    return { etat: 'peut_etre_payee', centimes: Number.isFinite(montant) ? Math.round(montant * 100) : null }
  }
  return { etat: 'a_payer' }
}

/**
 * La trésorerie des 90 jours qui suivent `aujourdHui` (jour de Paris, AAAA-MM-JJ). Sans solde lu, rien ne se projette ; une
 * source lue en partie rend la projection muette ; ce qui n'est pas compté se dit, ligne par ligne.
 */
export function composerTresorerie(entree: {
  aujourdHui: string
  depart: Depart
  creances: CreancesDeLaTresorerie
  echeances: EcheancesDeLaTresorerie
  /** Le relevé du dossier, EN ENTIER : il dit quelle échéance un mouvement a déjà payée, et quand. */
  releve: LectureComplete<MouvementDuReleve>
}): Tresorerie {
  const { aujourdHui, depart, creances, echeances, releve } = entree
  if (depart.etat !== 'lu') return { etat: 'sans_depart', depart }
  const motifs = [
    creances.etat === 'illisibles' ? `tes ventes : ${creances.motif}` : null,
    creances.etat === 'lues' && (creances.listes.facturesIncompletes ?? creances.listes.encaissementsIncomplets) != null
      ? `tes ventes : ${creances.listes.facturesIncompletes ?? creances.listes.encaissementsIncomplets}` : null,
    echeances.etat === 'illisibles' ? `tes échéances : ${echeances.motif}` : null,
    echeances.etat === 'lues' && echeances.partiel != null ? `tes échéances : ${echeances.partiel}` : null,
    releve.complete ? null : `ton relevé : ${releve.motif ?? 'lu en partie'}`,
  ].filter((m): m is string => m !== null)
  if (motifs.length > 0) {
    return { etat: 'muette', depart, motif: motifs.join(' ; ') }
  }

  const fin = finDeLHorizon(aujourdHui)
  const dansLHorizon = (date: string) => date >= aujourdHui && date < fin
  const prevus: Omit<MouvementPrevu, 'soldeApresCentimes'>[] = []
  const nonComptes: NonCompte[] = []

  // Les créances.
  if (creances.etat === 'fermees') {
    nonComptes.push({ cle: 'ventes-fermees', phrase: NON_COMPTE_VENTES_FERMEES, centimes: null })
  } else if (creances.etat === 'lues') {
    const enRetard = { nombre: 0, centimes: 0 }
    const sansEcheance = { nombre: 0, centimes: 0 }
    const apres = { nombre: 0, centimes: 0 }
    for (const { facture: f, resteCentimes } of facturesAEncaisser(creances.listes)) {
      if (f.date_echeance == null) { sansEcheance.nombre += 1; sansEcheance.centimes += resteCentimes; continue }
      if (f.date_echeance < aujourdHui) { enRetard.nombre += 1; enRetard.centimes += resteCentimes; continue }
      if (f.date_echeance >= fin) { apres.nombre += 1; apres.centimes += resteCentimes; continue }
      prevus.push({
        id: `facture-${f.id}`, date: f.date_echeance, nature: 'creance', libelle: libelleDeLaFacture(f.numero),
        centimes: resteCentimes, prevision: false,
      })
    }
    if (enRetard.nombre > 0) nonComptes.push({ cle: 'creances-en-retard', phrase: nonCompteEnRetard(enRetard.nombre), centimes: enRetard.centimes })
    if (sansEcheance.nombre > 0) nonComptes.push({ cle: 'creances-sans-echeance', phrase: nonCompteSansEcheance(sansEcheance.nombre), centimes: sansEcheance.centimes })
    if (apres.nombre > 0) nonComptes.push({ cle: 'creances-apres', phrase: nonCompteApres(apres.nombre), centimes: apres.centimes })
    // Encaissé APRÈS la date du solde (le jour du mouvement qui le porte, sinon celui de l'encaissement) : ce n'est plus un
    // reste dû, et ce n'est pas encore dans le solde lu — ni compté deux fois, ni perdu en silence : dit, avec sa somme.
    // Les espèces vont à la caisse, jamais au solde bancaire : hors de ce compte.
    const dateDuMouvement = new Map(releve.lignes.map((m) => [m.id, m.date]))
    const facturesDuDossier = new Set(creances.listes.factures.filter((f) => f.type === 'facture').map((f) => f.id))
    let depuisLeReleve = 0
    for (const e of creances.listes.encaissements) {
      if (e.retire_le != null || e.moyen === 'especes' || !facturesDuDossier.has(e.facture_id)) continue
      const jour = (e.ligne_bancaire_id != null ? dateDuMouvement.get(e.ligne_bancaire_id) : undefined) ?? e.date_encaissement
      if (jour > depart.au && jour <= aujourdHui) depuisLeReleve += Math.round(e.montant * 100)
    }
    if (depuisLeReleve !== 0) {
      nonComptes.push({ cle: 'encaisse-depuis-le-releve', phrase: nonCompteEncaisseDepuisLeReleve(depart.au), centimes: depuisLeReleve })
    }
  }

  // Les échéances de l'échéancier : comptées avec un montant, nommées sans. Une échéance de cotisation déjà payée ne se
  // compte pas deux fois (voir `reglementDeLaCotisation`).
  if (echeances.etat === 'lues') {
    const cotisations = new Map(echeances.cotisations.map((c) => [`cotisation-${c.id}`, c]))
    for (const e of echeances.echeances) {
      if (!dansLHorizon(e.date) && !(e.auMois && e.date < aujourdHui)) continue
      const cotisation = e.nature === 'cotisations' ? cotisations.get(e.id) : undefined
      const reglement = cotisation ? reglementDeLaCotisation(cotisation, releve.lignes, depart.au) : { etat: 'a_payer' as const }
      if (reglement.etat === 'dans_le_solde') continue
      if (reglement.etat !== 'a_payer') {
        nonComptes.push({
          cle: `echeance-${e.id}`,
          phrase: reglement.etat === 'apres_le_solde'
            ? `${e.libelle} (${dateEnLettres(e)}) : ${nonComptePrelevee(reglement.le)}`
            : `${e.libelle} (${dateEnLettres(e)}) : ${NON_COMPTE_PEUT_ETRE_PAYEE}`,
          centimes: reglement.centimes,
        })
        continue
      }
      if (e.montant && Number.isFinite(e.montant.valeur) && dansLHorizon(e.date)) {
        prevus.push({
          id: e.id, date: e.date, nature: e.nature, libelle: e.libelle,
          centimes: -Math.round(e.montant.valeur * 100), prevision: e.montant.estimation,
        })
      } else {
        nonComptes.push({ cle: `echeance-${e.id}`, phrase: `${e.libelle} (${dateEnLettres(e)}) : ${NON_COMPTE_SANS_MONTANT}`, centimes: null })
      }
    }
  }

  // Les achats et le prévisionnel du cabinet : jamais lus ici (voir l'en-tête).
  nonComptes.push({ cle: 'achats', phrase: NON_COMPTE_ACHATS, centimes: null })
  nonComptes.push({ cle: 'previsionnel-du-cabinet', phrase: NON_COMPTE_PREVISIONNEL_DU_CABINET, centimes: null })
  // Ce que rien ne permet de voir : un paiement que l'application ignore encore. Le deviner par montant et date est interdit ;
  // le dire, toujours, est la seule garde.
  nonComptes.push({ cle: 'pas-encore-enregistre', phrase: NON_COMPTE_PAS_ENCORE_ENREGISTRE, centimes: null })
  // Ce qui a bougé entre le dernier relevé et aujourd'hui.
  if (depart.au < ajouterJours(aujourdHui, -1)) {
    nonComptes.push({ cle: 'depuis-le-releve', phrase: nonCompteDepuisLeReleve(depart.au), centimes: null })
  }

  // Le même jour : les sorties d'abord (le point bas jamais flatté), puis la nature, puis l'identifiant — un ordre TOTAL.
  const rang = (m: Omit<MouvementPrevu, 'soldeApresCentimes'>) => (m.nature === 'creance' ? 3 : RANG_DE_LA_NATURE[m.nature])
  prevus.sort((a, b) => a.date.localeCompare(b.date) || Number(a.centimes >= 0) - Number(b.centimes >= 0) || rang(a) - rang(b)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  let solde = depart.centimes
  let pointBas = { centimes: solde, date: depart.au }
  let premierDecouvert: string | null = solde < 0 ? aujourdHui : null
  const mouvements = prevus.map((m) => {
    solde += m.centimes
    if (solde < pointBas.centimes) pointBas = { centimes: solde, date: m.date }
    if (solde < 0 && premierDecouvert === null) premierDecouvert = m.date
    return { ...m, soldeApresCentimes: solde }
  })
  return {
    etat: 'projetee', depart, mouvements,
    entreesCentimes: mouvements.filter((m) => m.centimes > 0).reduce((t, m) => t + m.centimes, 0),
    sortiesCentimes: mouvements.filter((m) => m.centimes < 0).reduce((t, m) => t - m.centimes, 0),
    finCentimes: solde, pointBas, premierDecouvert,
    avecPrevision: mouvements.some((m) => m.prevision),
    nonComptes,
  }
}

// ── Les mots ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Écrits ici pour que le test les passe tous à `motsDuCabinet`. L'introduction s'affiche avant la lecture : elle n'affirme
// donc rien de ce qu'on n'a pas lu.
export const TRESORERIE_INTRODUCTION = 'Ce que ton compte devrait devenir sur les 90 jours qui viennent : ton dernier solde '
  + 'contrôlé, plus ce que tes clients te doivent à l’échéance de leurs factures, moins tes impôts et tes cotisations à payer. '
  + 'Une estimation, pas une promesse : ce qui n’est pas compté est dit en dessous.'
export const TRESORERIE_DROITS_ILLISIBLES = 'Ta trésorerie ne s’affiche pas : ton accès n’a pas pu être vérifié. Recharge la page.'
export const TRESORERIE_BANQUE_FERMEE = 'Ton accès n’ouvre pas ta banque : sans ton solde, ta trésorerie ne peut pas se calculer.'
export const TRESORERIE_MUETTE = 'Ta trésorerie ne se calcule pas : une partie de ce qu’elle compte n’a pas pu être lue en '
  + 'entier, et un chiffre incomplet se lirait comme un vrai. Recharge la page.'
export const TRESORERIE_SOURCE_DU_SOLDE = 'Le solde final du dernier relevé dont ton cabinet a contrôlé le solde.'
export const TRESORERIE_PLUSIEURS_DATES = 'Tes comptes n’ont pas leur dernier relevé à la même date : la projection part de la plus ancienne.'
export const TRESORERIE_PREVISION = 'Prévision : un montant que personne n’a encore appelé — l’estimation de ta caisse de '
  + 'cotisations, ou un impôt calculé sur un barème qui peut encore changer.'
export const TRESORERIE_SANS_MOUVEMENT = 'Ni encaissement attendu ni paiement au montant connu sur ces 90 jours.'
export const NON_COMPTE_VENTES_FERMEES = 'Ce que tes clients te doivent : ton accès n’ouvre pas tes ventes.'
export const NON_COMPTE_SANS_MONTANT = 'son montant n’est pas connu ici.'
export const NON_COMPTE_ACHATS = 'Ce que tu dois à tes fournisseurs : tes factures d’achat ne sont pas encore suivies ici.'
export const NON_COMPTE_PREVISIONNEL_DU_CABINET = 'Le prévisionnel de ton cabinet : il ne te le montre pas encore ici.'
export const NON_COMPTE_PAS_ENCORE_ENREGISTRE = 'Un paiement déjà reçu de ton client, ou déjà prélevé sur ton compte, mais pas '
  + 'encore enregistré ni rapproché : il peut figurer à la fois dans ton solde et dans ce calcul, et compter deux fois. Si tu en '
  + 'vois un, dis-le à ton cabinet.'

export function phraseDuDecouvert(date: string): string {
  return `Ton compte passerait à découvert le ${enLettres(date)} : parles-en à ton cabinet.`
}
export const NON_COMPTE_PEUT_ETRE_PAYEE = 'peut-être déjà payée : un versement est noté, sans le prélèvement qui la paie sur '
  + 'ton relevé. Ton cabinet te le confirmera.'
export function nonComptePrelevee(le: string): string {
  return `déjà prélevée le ${enLettres(le)}, après ton dernier relevé contrôlé : ni dans ton solde, ni comptée ici.`
}
export function nonCompteEncaisseDepuisLeReleve(au: string): string {
  return `Encaissé sur tes factures depuis le ${enLettres(au)}, date de ton dernier relevé contrôlé : ni dans ton solde, ni compté ici.`
}
export function nonCompteEnRetard(nombre: number): string {
  return `${nombre === 1 ? 'Une facture en retard' : `${nombre} factures en retard`} : leur encaissement n’a plus de date sûre.`
}
export function nonCompteSansEcheance(nombre: number): string {
  return `${nombre === 1 ? 'Une facture' : `${nombre} factures`} sans date d’échéance.`
}
export function nonCompteApres(nombre: number): string {
  return `${nombre === 1 ? 'Une facture échue' : `${nombre} factures échues`} après ces 90 jours.`
}
export function nonCompteDepuisLeReleve(au: string): string {
  return `Ce qui est entré ou sorti de ton compte depuis le ${enLettres(au)}, date de ton dernier relevé contrôlé.`
}

/** « 13 novembre 2026 », « 1er décembre 2026 » : la date telle que l'échéancier la dit. */
export function enLettres(date: string): string {
  return dateEnLettres({ date, auMois: false })
}
