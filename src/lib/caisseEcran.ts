import {
  ecritureDeLOperation, ensembleDuJour, fluxDeLaCaisse, jourDit, refusDeLaCaisse, refusDeLaSaisie,
  refusDeLaSaisieDUnMois, refusDuRemplacement, refusDuRetrait, remplacanteDe, sansLOperation, soldesDeLaCaisse,
  TAUX_DE_LA_CAISSE, type CategorieDeLaCaisse, type DossierDeLaCaisse, type EncaissementDeLaCaisse, type EtatDeLaCaisse,
  type FactureDeLaCaisse, type FluxDeLaCaisse, type OperationAEcrire, type SaisieDeCaisse,
} from './caisse'
import {
  dossierTientUneCaisse, operationsDeCaisseDuDossier, type EspecesDesFactures, type EtatDesOperationsDeCaisse,
} from './controlesDeLaCaisse'
import type { ModeleComptable } from './engagement'
import { formatMoney } from './format'
import type { CaisseLue } from './recettesDeCaisse'
import type { ANouveau, Categorie, LigneBancaire, OperationCaisse } from './types'

// CE QUE L'ÉCRAN DE LA CAISSE DIT ET ENVOIE (ligne 26.6, étape C4 ; MVP-D2). La conception : HISTORIQUE.md, « LA CAISSE D'UN
// DOSSIER BNC : LA CONCEPTION », § 4 (le double compte) et § 9 (le lot C4), et « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE
// RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE », § 7 (les écrans). Ce module ne recopie AUCUNE règle : les refus des quatre
// fonctions de la base, la composition d'une écriture, les soldes jour par jour, l'ensemble du jour d'une recette sont ceux de
// lib/caisse.ts (C2), que la base rejoue ; il assemble ce que l'écran a lu, compose ce qui part, et dit ce que le module a
// refusé — AVANT le clic, sur la saisie TELLE QU'ELLE PART.
//
// PUR : aucun appel au réseau, et pas même un import de la lecture (lib/caisseDuDossierLecture.ts importe le client ; le scanner
// des écrans qui lisent la base suit les imports — voir lib/recettesDeCaisse.ts).

// ── Ce que l'écran a lu, et la caisse qu'il en rejoue ─────────────────────────────────────────────────────────────────

/** Un mouvement du relevé classé sur un compte de bilan, tel que la caisse le lit (son libellé pour le journal). */
export type MouvementClasse = Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'libelle' | 'compte_bilan'>

/** Les espèces des factures telles que l'écran les a lues EN ENTIER : aucune pour un dossier qui n'a pas basculé. */
export type EspecesLues = Exclude<EspecesDesFactures, { etat: 'incomplete' }>

/** Tout ce que l'onglet Caisse lit d'un dossier, chaque collection EN ENTIER. */
export interface DonneesDeLaCaisse {
  /** Les opérations de la caisse, retirées et remplacées comprises. */
  operations: readonly OperationCaisse[]
  /** La reprise ENTIÈRE : l'ouverture du dossier est la plus ancienne date de ses à-nouveaux, tout compte confondu. */
  ouvertures: readonly ANouveau[]
  /** Les mouvements du relevé classés sur un compte de bilan, ceux de la caisse parmi eux. */
  mouvements: readonly MouvementClasse[]
  especes: EspecesLues
  /** Les catégories lues, du dossier et communes. */
  categories: readonly Categorie[]
}

/**
 * La caisse d'un dossier telle que `premier_jour_negatif_de_la_caisse` la rejoue : l'ouverture (le compte de la caisse DU
 * PLAN, jamais en dur), les opérations, les mouvements classés sur ce compte, les espèces des factures sources.
 */
export function etatDeLaCaisseLu(
  modele: ModeleComptable,
  d: Pick<DonneesDeLaCaisse, 'operations' | 'ouvertures' | 'mouvements' | 'especes'>,
): EtatDeLaCaisse {
  return {
    compteCaisse: modele.plan.caisse,
    ouvertures: d.ouvertures,
    operations: d.operations,
    mouvements: d.mouvements,
    encaissements: d.especes.etat === 'lues' ? d.especes.encaissements : [],
    factures: d.especes.etat === 'lues' ? d.especes.factures : [],
  }
}

/** Ce que l'onglet sait du dossier, en plus de sa caisse : de quoi juger comme la base juge. */
export interface ContexteDeLaCaisse {
  modele: ModeleComptable
  assujettiTva: boolean
  /** Le jour à Paris (`aujourdHuiAParis`) : la base date « dans l'avenir » d'après le sien. */
  aujourdhui: string
  /** Les exercices validés : la frontière, au-delà de laquelle rien ne s'écrit ni ne se retire. */
  anneesValidees: readonly number[]
}

/**
 * Le dossier tel que les fonctions de la caisse le lisent, sous le profil du CABINET (le seul qui saisit, CAISSE-Q1 : le
 * droit « Caisse » du client viendra avec C10 à C12). `utilisateur` n'y sert qu'à l'accès d'un client : nul ici.
 */
export function dossierDeLEcran(ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse): DossierDeLaCaisse {
  const dates = d.ouvertures.map((a) => a.date).sort()
  return {
    quiEcrit: 'cabinet',
    utilisateur: null,
    modele: ctx.modele,
    assujetti: ctx.assujettiTva,
    aujourdhui: ctx.aujourdhui,
    ouverture: dates[0] ?? null,
    anneesValidees: ctx.anneesValidees,
    categories: d.categories as readonly CategorieDeLaCaisse[],
    caisse: etatDeLaCaisseLu(ctx.modele, d),
  }
}

// ── Les soldes ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Le solde de la caisse à la fin de ce jour, en centimes : celui du dernier jour qui porte un flux, au plus tard ce jour-là. */
export function soldeAuJour(etat: EtatDeLaCaisse, jour: string): number {
  let solde = 0
  for (const s of soldesDeLaCaisse(etat)) {
    if (s.jour > jour) break
    solde = s.centimes
  }
  return solde
}

/** Les centimes en euros pour l'écran, le signe moins typographique d'un solde négatif comme la base l'écrit (« −160,00 € »). */
export const euros = (centimes: number): string => formatMoney(centimes / 100).replace(/^-/, '−')

// ── Le journal : la caisse jour par jour ──────────────────────────────────────────────────────────────────────────────

export type LigneDuJournal =
  /** L'ouverture : les espèces en main au premier jour tenu, reprises d'une balance. */
  | { nature: 'ouverture'; centimes: number }
  /** Une opération non retirée : une recette, un apport, un prélèvement (ou, plus tard, le paiement d'une pièce). */
  | { nature: 'operation'; centimes: number; operation: OperationCaisse }
  /** Un mouvement du relevé classé sur la caisse : un crédit la vide (le versement), un débit la remplit (le retrait). */
  | { nature: 'mouvement'; centimes: number; mouvement: MouvementClasse }
  /** Les espèces d'une facture source, comptées par son encaissement (ou rendues, par sa contre-passation) : lues, sans geste. */
  | { nature: 'encaissement'; centimes: number; encaissement: EncaissementDeLaCaisse; numero: string | null }

export interface JourDeLaCaisse {
  jour: string
  lignes: LigneDuJournal[]
  /** Ce qui entre et ce qui sort ce jour-là, en centimes positifs. */
  entrees: number
  sorties: number
  /** Le solde à la fin du jour, l'ouverture et tous les jours d'avant compris. */
  solde: number
}

function ligneDuFlux(
  f: FluxDeLaCaisse, etat: EtatDeLaCaisse, operations: readonly OperationCaisse[], mouvements: readonly MouvementClasse[],
): LigneDuJournal | null {
  switch (f.source) {
    case 'ouverture':
      return { nature: 'ouverture', centimes: f.centimes }
    case 'operation': {
      const operation = operations.find((o) => o.id === f.id)
      return operation ? { nature: 'operation', centimes: f.centimes, operation } : null
    }
    case 'mouvement': {
      const mouvement = mouvements.find((m) => m.id === f.id)
      return mouvement ? { nature: 'mouvement', centimes: f.centimes, mouvement } : null
    }
    case 'encaissement': {
      const encaissement = etat.encaissements.find((e) => e.id === f.id)
      if (!encaissement) return null
      const numero = etat.factures.find((x: FactureDeLaCaisse) => x.id === encaissement.facture_id)?.numero ?? null
      return { nature: 'encaissement', centimes: f.centimes, encaissement, numero }
    }
  }
}

/**
 * La caisse jour par jour, du plus ancien au plus récent : chaque flux que `fluxDeLaCaisse` compte (l'ouverture, les
 * opérations non retirées, les mouvements classés sur la caisse, les espèces des factures sources) sous son jour, avec le
 * solde de la fin du jour — le solde que la base garde jamais négatif. Les flux ne sont pas redevinés ici : la liste est celle
 * du calcul des soldes, flux pour flux.
 */
export function journalDeLaCaisse(
  etat: EtatDeLaCaisse, operations: readonly OperationCaisse[], mouvements: readonly MouvementClasse[],
): JourDeLaCaisse[] {
  const parJour = new Map<string, LigneDuJournal[]>()
  for (const f of fluxDeLaCaisse(etat)) {
    const ligne = ligneDuFlux(f, etat, operations, mouvements)
    // Un flux dont l'objet n'est pas retrouvé compte tout de même dans le solde : on le garde, sous une ligne d'ouverture
    // neutre plutôt que de l'omettre — un solde qui ne se retrouve pas dans ses lignes serait un défaut silencieux.
    const lue: LigneDuJournal = ligne ?? { nature: 'ouverture', centimes: f.centimes }
    parJour.set(f.jour, [...(parJour.get(f.jour) ?? []), lue])
  }
  const soldes = new Map(soldesDeLaCaisse(etat).map((s) => [s.jour, s.centimes]))
  return [...parJour.keys()].sort().map((jour) => {
    const lignes = parJour.get(jour)!
    return {
      jour,
      lignes,
      entrees: lignes.filter((l) => l.centimes > 0).reduce((s, l) => s + l.centimes, 0),
      sorties: lignes.filter((l) => l.centimes < 0).reduce((s, l) => s - l.centimes, 0),
      solde: soldes.get(jour) ?? 0,
    }
  })
}

export interface TotauxDuJournal {
  /** Les recettes saisies (des espèces rendues en déduction), les apports, les prélèvements, les versements en banque, les
   *  retraits d'espèces pour la caisse, les espèces des factures : en centimes positifs, sauf les recettes (signées). */
  recettes: number
  apports: number
  prelevements: number
  versements: number
  retraits: number
  especesDesFactures: number
}

/** Les totaux des jours qu'on lui donne — l'exercice affiché, jamais ce que la recherche laisse voir. */
export function totauxDuJournal(jours: readonly JourDeLaCaisse[]): TotauxDuJournal {
  const t: TotauxDuJournal = { recettes: 0, apports: 0, prelevements: 0, versements: 0, retraits: 0, especesDesFactures: 0 }
  for (const jour of jours) {
    for (const l of jour.lignes) {
      if (l.nature === 'operation') {
        if (l.operation.genre === 'recette') t.recettes += l.centimes
        else if (l.operation.genre === 'apport') t.apports += l.centimes
        else if (l.operation.genre === 'prelevement') t.prelevements -= l.centimes
      } else if (l.nature === 'mouvement') {
        if (l.centimes < 0) t.versements -= l.centimes
        else t.retraits += l.centimes
      } else if (l.nature === 'encaissement') {
        t.especesDesFactures += l.centimes
      }
    }
  }
  return t
}

/** Le texte d'une ligne du journal, sans nom (une caisse ne nomme personne), pour l'écran et pour la recherche. */
export function libelleDeLaLigne(l: LigneDuJournal, categories: readonly Categorie[]): string {
  switch (l.nature) {
    case 'ouverture':
      return 'Ouverture : les espèces en caisse dans les comptes repris'
    case 'operation': {
      const o = l.operation
      if (o.genre === 'apport') return 'Apport en caisse de l’exploitant'
      if (o.genre === 'prelevement') return 'Prélèvement en espèces de l’exploitant'
      if (o.genre === 'paiement') return 'Paiement d’une pièce par la caisse'
      const categorie = categories.find((c) => c.id === o.categorie_id)?.libelle ?? 'catégorie non lue'
      const taux = o.taux_tva != null ? ` · TVA ${String(o.taux_tva).replace('.', ',')} %` : ''
      return `${o.montant < 0 ? 'Espèces rendues' : 'Recettes en espèces'} — ${categorie}${taux}`
    }
    case 'mouvement':
      return `${l.centimes < 0 ? 'Versement en banque' : 'Retrait d’espèces pour la caisse'} — ${l.mouvement.libelle}`
    case 'encaissement':
      return `${l.encaissement.annule_id != null ? 'Espèces rendues sur' : 'Espèces reçues pour'} la facture ${l.numero ?? '(sans numéro)'}`
  }
}

/**
 * Une opération nommée pour une confirmation ou une liste : son genre, son jour, son montant et sa nature — jamais un nom. Avec
 * l'article défini (« la recette du 12/03/2026 de 85,00 € (Honoraires) », « l’apport … »), indéfini (« une recette … »), ou aucun.
 */
export function nomDeLOperation(
  o: Pick<OperationCaisse, 'genre' | 'date' | 'montant' | 'categorie_id'>, categories: readonly Categorie[], article: 'le' | 'un' | null = 'le',
): string {
  const [defini, indefini, nom] = o.genre === 'recette' ? (o.montant < 0 ? ['les', 'des', 'espèces rendues'] : ['la', 'une', 'recette'])
    : o.genre === 'apport' ? ['l’', 'un', 'apport'] : o.genre === 'prelevement' ? ['le', 'un', 'prélèvement'] : ['le', 'un', 'paiement']
  const categorie = o.genre === 'recette' ? categories.find((c) => c.id === o.categorie_id)?.libelle : null
  const groupe = `${nom} du ${jourDit(o.date)} de ${formatMoney(Math.abs(o.montant))}${categorie ? ` (${categorie})` : ''}`
  if (article === null) return groupe
  const mot = article === 'le' ? defini : indefini
  return mot.endsWith('’') ? `${mot}${groupe}` : `${mot} ${groupe}`
}

// ── Les espèces des factures d'un jour ────────────────────────────────────────────────────────────────────────────────

export interface EspeceDeFacture { encaissementId: string; numero: string | null; centimes: number }

/** Les espèces des factures sources que la caisse compte ce jour-là : celles que la saisie d'une recette reconnaît. */
export function especesDuJour(etat: EtatDeLaCaisse, jour: string): EspeceDeFacture[] {
  const ids = new Set(ensembleDuJour(etat, jour))
  return etat.encaissements.filter((e) => ids.has(e.id)).map((e) => ({
    encaissementId: e.id,
    numero: etat.factures.find((f) => f.id === e.facture_id)?.numero ?? null,
    centimes: Math.round(e.montant * 100),
  })).sort((a, b) => (a.encaissementId < b.encaissementId ? -1 : 1))
}

/**
 * La phrase qui NOMME les espèces des factures d'un jour qu'une recette ne compte pas (conception, § 4 b) — « Les 120,00 € de
 * la facture F-2026-0012, reçus ce jour-là, sont déjà dans la caisse : ce total ne les compte pas » —, ou rien quand le jour n'en
 * porte aucune.
 */
export function phraseDesEspecesDuJour(especes: readonly EspeceDeFacture[]): string | null {
  if (especes.length === 0) return null
  const noms = especes.map((e) => `${euros(e.centimes)} de la facture ${e.numero ?? '(sans numéro)'}`)
  const liste = noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
  return `Les ${liste}, reçus ce jour-là, sont déjà dans la caisse : ce total ne les compte pas.`
}

// ── Le formulaire, et ce qui en part ──────────────────────────────────────────────────────────────────────────────────

export type GenreSaisi = 'recette' | 'apport' | 'prelevement'

/** Ce que le cabinet a tapé, tel quel : des textes (un champ vide est ''). */
export interface FormulaireDeCaisse {
  genre: GenreSaisi
  date: string
  categorieId: string
  taux: string
  montant: string
}

export const FORMULAIRE_VIDE: FormulaireDeCaisse = { genre: 'recette', date: '', categorieId: '', taux: '', montant: '' }

/**
 * Un montant tapé : « 125,50 », « 125.5 », « 1 250 », « -12 ». Vide : nul. Illisible : `'illisible'`. Le nombre est celui que
 * la base lira (`numeric` exact) : au plus deux décimales sont jugées par le module (`centimesDe`), pas ici.
 */
export function lireLeMontantSaisi(texte: string): number | null | 'illisible' {
  const t = texte.replace(/[\s  ]/g, '').replace(',', '.')
  if (t === '') return null
  if (!/^-?\d+(\.\d+)?$/.test(t)) return 'illisible'
  const n = Number(t)
  return Number.isFinite(n) ? n : 'illisible'
}

export const MONTANT_ILLISIBLE = 'Le montant n’est pas un nombre : écris par exemple 125,50 (négatif pour des espèces rendues).'

/** Les taux qu'une recette porte, pour la liste de choix : ceux du module, jamais une liste recopiée. */
export const TAUX_PROPOSES: readonly { valeur: number; libelle: string }[] = TAUX_DE_LA_CAISSE.map((valeur) => ({
  valeur,
  libelle: valeur === 0 ? '0 % (exonérée)' : `${String(valeur).replace('.', ',')} %`,
}))

function categorieDe(id: string, categories: readonly Categorie[]): OperationAEcrire['categorie'] {
  const c = id === '' ? undefined : categories.find((x) => x.id === id)
  return c ? { libelle: c.libelle, compte_comptable: c.compte_comptable } : null
}

/**
 * La saisie telle qu'elle PART à `enregistrer_operation_caisse` : le genre, la date, le montant, la catégorie et le taux d'une
 * recette, l'ensemble des espèces des factures de son jour que la lecture a montrées (`ensembleDuJour`, CAISSE-Q2), et
 * l'écriture que compose `ecritureDeLOperation` au plan du dossier. Un montant vide ou illisible n'a pas d'écriture.
 */
export function saisieDuFormulaire(f: FormulaireDeCaisse, ctx: ContexteDeLaCaisse, categories: readonly Categorie[], caisse: EtatDeLaCaisse): SaisieDeCaisse {
  const recette = f.genre === 'recette'
  const lu = lireLeMontantSaisi(f.montant)
  const montant = typeof lu === 'number' ? lu : null
  const categorie = recette ? categorieDe(f.categorieId, categories) : null
  const taux = recette && ctx.assujettiTva && f.taux !== '' ? Number(f.taux) : null
  const ecritures = montant == null || (recette && categorie == null)
    ? []
    : ecritureDeLOperation({ genre: f.genre, date: f.date, montant, taux_tva: taux, categorie }, ctx.modele)
  return {
    genre: f.genre,
    date: f.date === '' ? null : f.date,
    montant,
    categorie_id: recette && f.categorieId !== '' ? f.categorieId : null,
    taux_tva: taux,
    encaissements_du_jour: recette ? ensembleDuJour(caisse, f.date) : null,
    ecritures,
  }
}

/** Ce que le formulaire dit avant le clic. */
export type VerdictDeLaSaisie =
  /** Rien de tapé qui permette de juger (la date ou le montant manque) : le bouton attend, sans reproche. */
  | { etat: 'vide' }
  /** Le montant n'est pas un nombre. */
  | { etat: 'illisible'; message: string }
  /** Ce que la base refuserait, dans son ordre et sous ses mots. */
  | { etat: 'refuse'; message: string; saisie: SaisieDeCaisse }
  | { etat: 'permis'; saisie: SaisieDeCaisse }

/**
 * Le verdict du formulaire : le refus d'`enregistrer_operation_caisse` — ou, pour un remplacement (`remplace` : l'opération
 * qu'il remplace), celui de `remplacer_operation_caisse` — sur la saisie TELLE QU'ELLE PART. Rien de tapé n'est pas un refus.
 */
export function verdictDuFormulaire(
  f: FormulaireDeCaisse, ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse, remplace: string | null = null,
): VerdictDeLaSaisie {
  if (f.date === '' || f.montant.trim() === '') return { etat: 'vide' }
  if (lireLeMontantSaisi(f.montant) === 'illisible') return { etat: 'illisible', message: MONTANT_ILLISIBLE }
  const dossier = dossierDeLEcran(ctx, d)
  const saisie = saisieDuFormulaire(f, ctx, d.categories, dossier.caisse)
  const refus = remplace == null ? refusDeLaSaisie(saisie, dossier) : refusDuRemplacement(remplace, saisie, dossier)
  return refus ? { etat: 'refuse', message: refus.message, saisie } : { etat: 'permis', saisie }
}

// ── La saisie d'un mois ───────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne du mois entièrement vide : rien de tapé, rien à envoyer. */
export function ligneVide(l: FormulaireDeCaisse): boolean {
  return l.date === '' && l.montant.trim() === '' && l.categorieId === '' && l.taux === ''
}

export type VerdictDuMois =
  | { etat: 'vide' }
  | { etat: 'illisible'; message: string }
  | { etat: 'refuse'; message: string; operations: SaisieDeCaisse[] }
  | { etat: 'permis'; operations: SaisieDeCaisse[] }

/**
 * Le verdict de la saisie d'un mois : le tableau JSON tel qu'il part à `enregistrer_operations_de_caisse` (les lignes vides EN FIN
 * de saisie écartées — une ligne vide au milieu est une ligne, que son rang nomme), jugé par le module, tout ou rien : le
 * premier refus repart sous son rang et son jour (« Opération n° 3, du 12/03/2026 : … »), la caisse jamais négative à la fin.
 */
export function verdictDuMois(lignes: readonly FormulaireDeCaisse[], ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse): VerdictDuMois {
  let n = lignes.length
  while (n > 0 && ligneVide(lignes[n - 1])) n--
  if (n === 0) return { etat: 'vide' }
  const dossier = dossierDeLEcran(ctx, d)
  const operations: SaisieDeCaisse[] = []
  for (let i = 0; i < n; i++) {
    if (lireLeMontantSaisi(lignes[i].montant) === 'illisible') {
      return { etat: 'illisible', message: `Opération n° ${i + 1} : ${MONTANT_ILLISIBLE}` }
    }
    operations.push(saisieDuFormulaire(lignes[i], ctx, d.categories, dossier.caisse))
  }
  const refus = refusDeLaSaisieDUnMois(operations, dossier)
  return refus ? { etat: 'refuse', message: refus.message, operations } : { etat: 'permis', operations }
}

// ── Le retrait ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Le refus de `retirer_operation_caisse` pour cette opération — la frontière, la caisse qui passerait sous zéro —, ou rien. */
export function refusDuRetraitDeLOperation(operationId: string, ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse): string | null {
  return refusDuRetrait(operationId, dossierDeLEcran(ctx, d))?.message ?? null
}

/**
 * La confirmation d'un retrait : elle NOMME ce qui part — l'opération et son écriture — et dit ce que devient la caisse de son
 * jour (« Retirer la recette du 12/03/2026 de 85,00 € (Honoraires) ? Son écriture est retirée avec elle ; la caisse de ce
 * jour-là passera à 40,00 €. »).
 */
export function confirmationDuRetrait(o: OperationCaisse, ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse): string {
  const etat = etatDeLaCaisseLu(ctx.modele, d)
  const apres = soldeAuJour(sansLOperation(etat, o.id, 'maintenant'), o.date)
  return `Retirer ${nomDeLOperation(o, d.categories)} ? Son écriture est retirée avec elle ; la caisse du ${jourDit(o.date)} `
    + `passera à ${euros(apres)}.`
}

/** La confirmation d'un remplacement : l'ancienne qui part avec son écriture, la nouvelle qui la remplace. */
export function confirmationDuRemplacement(
  ancienne: OperationCaisse, saisie: SaisieDeCaisse, d: Pick<DonneesDeLaCaisse, 'categories'>,
): string {
  const nouvelle = nomDeLOperation({
    genre: saisie.genre as OperationCaisse['genre'], date: saisie.date ?? '', montant: saisie.montant ?? 0, categorie_id: saisie.categorie_id,
  }, d.categories, 'un')
  return `Remplacer ${nomDeLOperation(ancienne, d.categories)} par ${nouvelle} ? L’ancienne est retirée avec son écriture ; `
    + 'la nouvelle est écrite à sa place, et la caisse se rejoue.'
}

// ── Les versions et l'origine ─────────────────────────────────────────────────────────────────────────────────────────

/** Les opérations retirées ou remplacées, de la plus récente à la plus ancienne retirée : le journal ne les compte pas. */
export function operationsRetirees(operations: readonly OperationCaisse[]): OperationCaisse[] {
  return operations.filter((o) => o.retire_le != null)
    .sort((a, b) => ((a.retire_le ?? '') < (b.retire_le ?? '') ? 1 : (a.retire_le ?? '') > (b.retire_le ?? '') ? -1 : 0))
}

/** L'état d'une opération retirée, en clair : remplacée (par quoi) ou simplement retirée. */
export function etatDUneOperationRetiree(o: OperationCaisse, operations: readonly OperationCaisse[]): string {
  const remplacante = remplacanteDe(o.id, operations)
  return remplacante
    ? `remplacée par ${remplacante.retire_le == null ? 'l’opération du ' : 'une version retirée du '}${jourDit(remplacante.date)}`
    : 'retirée'
}

// ── La caisse dans la fiche d'un mouvement du relevé (Banque) ─────────────────────────────────────────────────────────

/**
 * Ce que la fiche d'un mouvement dit de la caisse, quand la caisse est en base :
 *   - `absente` : la table n'est pas en base — la fiche est celle d'hier, au caractère près ;
 *   - `pas_lue` : la caisse, le relevé ou l'une de leurs entrées n'est pas lu en entier (ou pas encore revenu) — la fiche ne
 *     classe rien sur la caisse, et le dit ;
 *   - `lue` : le solde de la caisse ce jour-là, avant et après ce mouvement, et les refus que la base opposerait.
 */
export type CaisseDeLaFiche =
  | { etat: 'absente'; tenue: 'non' }
  | { etat: 'pas_lue'; tenue: 'oui' | 'non' | 'peut_etre'; motif: string }
  | {
    etat: 'lue'
    tenue: 'oui' | 'non' | 'peut_etre'
    /** Le mouvement est déjà classé sur la caisse. */
    surLaCaisse: boolean
    /** Le solde de la caisse à la fin du jour du mouvement, sans lui, puis avec lui — en centimes. */
    soldeSans: number
    soldeAvec: number
    /** Ce que la base refuserait si on le classait sur la caisse (un versement qui la rendrait négative), ou rien. */
    refusDuClassement: string | null
    /** Ce qu'elle refuserait si on le retirait de la caisse (un retrait d'espèces déjà dépensées), ou rien. */
    refusDuRetrait: string | null
  }

export const CAISSE_ABSENTE_DE_LA_FICHE: CaisseDeLaFiche = { etat: 'absente', tenue: 'non' }

/** Le mouvement, tel que la caisse le lit une fois classé sur son compte. */
function classe(m: Pick<LigneBancaire, 'id' | 'date' | 'montant'>, compte: string) {
  return { id: m.id, date: m.date, montant: m.montant, compte_bilan: compte }
}

/**
 * La caisse pour la fiche d'un mouvement : le mouvement CLASSÉ sur la caisse (ou DÉCLASSÉ, s'il l'est déjà) comparé à la
 * caisse lue, jugé par le module sous les mots de la base (`texte_caisse_negative` : « versement » pour un crédit,
 * « retrait_d_especes_retire » pour un débit qu'on retire). Un débit qu'on classe sur la caisse l'alimente : la base ne le
 * refuse pas. `etat` nul : la caisse n'est pas lue en entier.
 */
export function caisseDeLaFiche(
  ligne: Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'compte_bilan'>,
  lecture: EtatDeLaCaisseDeBanque,
  operations: EtatDesOperationsDeCaisse,
  especes: EspecesDesFactures,
): CaisseDeLaFiche {
  if (lecture.etat === 'absente') return CAISSE_ABSENTE_DE_LA_FICHE
  const tenue = dossierTientUneCaisse(operations, especes)
  if (lecture.etat === 'pas_lue') return { etat: 'pas_lue', tenue, motif: lecture.motif }
  const etat = lecture.caisse
  const compte = etat.compteCaisse
  const surLaCaisse = ligne.compte_bilan === compte
  // La caisse SANS ce mouvement, puis AVEC lui classé sur la caisse.
  const sans: EtatDeLaCaisse = { ...etat, mouvements: etat.mouvements.filter((m) => m.id !== ligne.id) }
  const avec: EtatDeLaCaisse = { ...sans, mouvements: [...sans.mouvements, classe(ligne, compte)] }
  const centimes = Math.round(Math.abs(ligne.montant) * 100)
  return {
    etat: 'lue',
    tenue,
    surLaCaisse,
    soldeSans: soldeAuJour(sans, ligne.date),
    soldeAvec: soldeAuJour(avec, ligne.date),
    // Un crédit classé sur la caisse en sort des espèces : `versement`. Un débit y en met : aucun refus.
    refusDuClassement: ligne.montant > 0 ? refusDeLaCaisse(avec, 'versement', centimes)?.message ?? null : null,
    // Retirer de la caisse un débit déjà classé lui enlève ces espèces : `retrait_d_especes_retire`. Un crédit retiré lui en rend.
    refusDuRetrait: surLaCaisse && ligne.montant < 0 ? refusDeLaCaisse(sans, 'retrait_d_especes_retire', centimes)?.message ?? null : null,
  }
}

/** Ce que l'onglet Banque tient de la caisse pour juger un mouvement : absente, pas lue en entier, ou la caisse rejouée. */
export type EtatDeLaCaisseDeBanque =
  | { etat: 'absente' }
  | { etat: 'pas_lue'; motif: string }
  | { etat: 'lue'; caisse: EtatDeLaCaisse }

/** Les entrées que l'onglet Banque a lues, chacune avec son état de lecture. */
export interface EntreesDeLaCaisseDeBanque {
  dossierId: string
  /** La caisse (ses opérations), telle que `lireLaCaisse` l'a rendue, ou nulle tant qu'elle n'est pas revenue. */
  caisse: CaisseLue | null
  /** La reprise : lue en entier ou non, avec son dossier. */
  ouvertures: { dossierId: string; lignes: readonly ANouveau[]; complete: boolean; motif: string | null } | null
  /** Le relevé ENTIER de l'onglet : son motif quand il n'a pas pu être lu jusqu'au bout. */
  releve: readonly MouvementClasse[]
  releveIncomplet: string | null
  /** Les espèces des factures : `null` pour un dossier qui n'a pas basculé ; sinon ce que les ventes lues en rendent. */
  especes: EspecesDesFactures
  modele: ModeleComptable
}

/**
 * La caisse que l'onglet Banque juge, ou ce qui l'en empêche. Drapeau baissé (la table n'est pas en base) : `absente`, et rien
 * de plus ne se calcule. Sinon, tout doit être lu en entier ET venir de CE dossier — la caisse, la reprise, le relevé, les espèces
 * des factures — : une seule entrée manquante, et la fiche ne classe rien sur la caisse (« une lecture partielle ne commande
 * aucune écriture »).
 */
export function caisseDeBanque(e: EntreesDeLaCaisseDeBanque): EtatDeLaCaisseDeBanque {
  const operations = operationsDeCaisseDuDossier(e.caisse, e.dossierId)
  if (operations.etat === 'absente') return { etat: 'absente' }
  if (operations.etat === 'en_attente') return { etat: 'pas_lue', motif: 'la caisse du dossier n’est pas encore lue' }
  if (operations.etat === 'incomplete') return { etat: 'pas_lue', motif: operations.motif }
  if (e.ouvertures === null || e.ouvertures.dossierId !== e.dossierId) return { etat: 'pas_lue', motif: 'la reprise du dossier n’est pas encore lue' }
  if (!e.ouvertures.complete) return { etat: 'pas_lue', motif: `la reprise du dossier : ${e.ouvertures.motif ?? 'lecture incomplète'}` }
  if (e.releveIncomplet) return { etat: 'pas_lue', motif: `le relevé : ${e.releveIncomplet}` }
  if (e.especes.etat === 'incomplete') return { etat: 'pas_lue', motif: `les espèces des factures : ${e.especes.motif}` }
  return {
    etat: 'lue',
    caisse: etatDeLaCaisseLu(e.modele, {
      operations: operations.operations, ouvertures: e.ouvertures.lignes, mouvements: e.releve, especes: e.especes,
    }),
  }
}

