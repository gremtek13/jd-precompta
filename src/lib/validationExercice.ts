import type { Declaration2035 } from './declaration2035'
import type { EnteteDeclaration } from './gabarit2035'
import type { NumerotationFec } from './fec'
import type { EcritureBrouillon, Immobilisation, JournalCode } from './types'
import { anneeDe } from './format'

// VALIDER UN EXERCICE (ligne 26.6 de la feuille de route, étape d). « Le caractère définitif des
// enregistrements du livre-journal est assuré, pour les comptabilités tenues au moyen de systèmes
// informatisés, par une procédure de validation, qui interdit toute modification ou suppression de
// l'enregistrement » (PCG, art. 1031-3). La base porte la procédure — `valider_exercice`, ses refus,
// l'intangibilité et les sources figées (supabase/essais/validationExercice.sql) — ; ce module porte ce que
// l'application lui apporte et ce qu'elle doit en dire :
//   - la FRONTIÈRE, et l'exercice qui fige une date, dits avec les mots de la base (`exercice_fige`) ;
//   - les pièces et les biens que la base refusera de modifier, pour que les écrans le disent avant ;
//   - le contrôle de la numérotation, qui nomme une écriture déséquilibrée au lieu du refus général de la
//     base ;
//   - la DEMANDE envoyée à `valider_exercice`, tirée de la numérotation même du FEC ;
//   - l'INSTANTANÉ de la 2035, gardé avec l'exercice pour qu'une évolution du calcul ne la change plus.

// ── La frontière ─────────────────────────────────────────────────────────────────────────────────────

// Le 31 décembre du dernier exercice validé, ou rien. Tout ce qui le précède est figé — y compris ce qui
// précède le PREMIER exercice validé, que la balance reprise ou le premier exercice portent.
export function frontiereDeValidation(anneesValidees: readonly number[]): string | null {
  return anneesValidees.length === 0 ? null : `${Math.max(...anneesValidees)}-12-31`
}

// Ce qu'un refus dit de l'exercice d'une date figée, mot pour mot comme la base (`exercice_fige`) : « validé »
// quand il l'est, sinon l'exercice validé qui le fige — un relevé de 2024 sur un dossier repris en 2025 et validé
// pour 2025 n'est pas « validé », il est figé par 2025. Nul quand l'exercice n'est pas figé.
export function exerciceQuiFige(annee: number, anneesValidees: readonly number[]): string | null {
  if (anneesValidees.includes(annee)) return `L'exercice ${annee} est validé`
  const posterieures = anneesValidees.filter((a) => a > annee)
  if (posterieures.length === 0) return null
  return `L'exercice ${annee} est figé par la validation de l'exercice ${Math.min(...posterieures)}`
}

// Une date civile (AAAA-MM-JJ) figée par la validation : la phrase de la base, sinon rien.
export function dateFigee(date: string, anneesValidees: readonly number[]): string | null {
  return exerciceQuiFige(anneeDe(date), anneesValidees)
}

// ── Ce que la base refusera de modifier ───────────────────────────────────────────────────────────────

// LES PIÈCES FIGÉES, et l'exercice de leur première écriture validée — le critère de `garder_piece_validee` :
// une pièce qui porte une écriture validée, ou qui justifie un bien dont une écriture l'est (sa dotation, son
// acquisition). Ses notes, son sous-dossier et la confiance de sa lecture restent libres, le reste non.
export function piecesFigees(
  ecritures: readonly Pick<EcritureBrouillon, 'statut' | 'date' | 'piece_id' | 'immobilisation_id'>[],
  immobilisations: readonly Pick<Immobilisation, 'id' | 'piece_id'>[],
): Map<string, number> {
  const pieceDuBien = new Map(immobilisations.map((i) => [i.id, i.piece_id]))
  const figees = new Map<string, number>()
  const retenir = (pieceId: string | null | undefined, annee: number) => {
    if (!pieceId) return
    const actuelle = figees.get(pieceId)
    if (actuelle === undefined || annee < actuelle) figees.set(pieceId, annee)
  }
  for (const e of ecritures) {
    if (e.statut !== 'validee') continue
    retenir(e.piece_id, anneeDe(e.date))
    if (e.immobilisation_id) retenir(pieceDuBien.get(e.immobilisation_id), anneeDe(e.date))
  }
  return figees
}

// LES BIENS FIGÉS, et l'exercice de leur première écriture validée — le critère de `garder_bien_valide` : une
// écriture validée qui désigne le bien (une dotation) ou sa pièce (l'acquisition). Un tel bien ne se modifie ni
// ne se retire plus du registre.
export function biensFiges(
  ecritures: readonly Pick<EcritureBrouillon, 'statut' | 'date' | 'piece_id' | 'immobilisation_id'>[],
  immobilisations: readonly Pick<Immobilisation, 'id' | 'piece_id'>[],
): Map<string, number> {
  const anneeParPiece = new Map<string, number>()
  const anneeParBien = new Map<string, number>()
  const plusAncienne = (carte: Map<string, number>, cle: string, annee: number) => {
    const actuelle = carte.get(cle)
    if (actuelle === undefined || annee < actuelle) carte.set(cle, annee)
  }
  for (const e of ecritures) {
    if (e.statut !== 'validee') continue
    if (e.piece_id) plusAncienne(anneeParPiece, e.piece_id, anneeDe(e.date))
    if (e.immobilisation_id) plusAncienne(anneeParBien, e.immobilisation_id, anneeDe(e.date))
  }
  const figes = new Map<string, number>()
  for (const i of immobilisations) {
    const annees = [anneeParBien.get(i.id), i.piece_id ? anneeParPiece.get(i.piece_id) : undefined]
      .filter((a): a is number => a !== undefined)
    if (annees.length > 0) figes.set(i.id, Math.min(...annees))
  }
  return figes
}

// ── La numérotation, contrôlée comme la base la contrôlera ────────────────────────────────────────────

// Ce que `valider_exercice` refusera d'une numérotation, NOMMÉ. La base dit « Une écriture n'est pas équilibrée
// au centime » sans dire laquelle ; l'écran doit pouvoir nommer la pièce. `numeroterFec` produit par construction
// une numérotation qui passe les autres contrôles — ils sont refaits ici quand même, parce qu'une numérotation
// qui les manquerait ferait échouer la validation au clic, sur un message que personne ne saurait relier à rien.
export type DefautDeNumerotation =
  | { type: 'incomplete'; journal: JournalCode; numero: number }
  | { type: 'numeros'; journal: JournalCode }
  | { type: 'ordre'; journal: JournalCode; numero: number }
  | { type: 'desequilibre'; journal: JournalCode; numero: number; pieceRef: string; ecartCentimes: number }
  | { type: 'pieces'; journal: JournalCode; numero: number }
  | { type: 'compte'; compte: string }
  | { type: 'auxiliaire'; compAuxNum: string }

export function defautsDeNumerotation(n: NumerotationFec): DefautDeNumerotation[] {
  const defauts: DefautDeNumerotation[] = []
  const vide = (v: string | null) => (v ?? '').trim() === ''
  interface Groupe { journal: JournalCode; numero: number; premiere: string; centimes: number; refs: Set<string>; dates: Set<string> }
  const groupes = new Map<string, Groupe>()
  for (const l of n.lignes) {
    if (vide(l.pieceRef) || vide(l.pieceDate) || vide(l.compteLib) || (l.compAuxNum === null) !== (l.compAuxLib === null)
      || (l.compAuxNum !== null && (vide(l.compAuxNum) || vide(l.compAuxLib)))) {
      defauts.push({ type: 'incomplete', journal: l.journal, numero: l.numero })
    }
    const cle = `${l.journal}|${l.numero}`
    const g = groupes.get(cle) ?? { journal: l.journal, numero: l.numero, premiere: l.ecriture.date, centimes: 0, refs: new Set(), dates: new Set() }
    if (l.ecriture.date < g.premiere) g.premiere = l.ecriture.date
    // EN CENTIMES ENTIERS, comme la base compare des numeric : une somme de flottants laisserait un écart de
    // 1e-13 que la base ne voit pas, ou en masquerait un.
    g.centimes += (l.ecriture.sens === 'debit' ? 1 : -1) * Math.round(l.ecriture.montant * 100)
    g.refs.add(l.pieceRef)
    g.dates.add(l.pieceDate)
    groupes.set(cle, g)
  }
  const parJournal = new Map<JournalCode, Groupe[]>()
  for (const g of groupes.values()) parJournal.set(g.journal, [...(parJournal.get(g.journal) ?? []), g])
  for (const [journal, liste] of parJournal) {
    const tries = [...liste].sort((a, b) => a.numero - b.numero)
    if (tries.some((g, i) => g.numero !== i + 1)) defauts.push({ type: 'numeros', journal })
    for (let i = 1; i < tries.length; i++) {
      if (tries[i - 1].premiere > tries[i].premiere) defauts.push({ type: 'ordre', journal, numero: tries[i].numero })
    }
  }
  for (const g of groupes.values()) {
    if (g.centimes !== 0) {
      defauts.push({ type: 'desequilibre', journal: g.journal, numero: g.numero, pieceRef: [...g.refs][0], ecartCentimes: g.centimes })
    }
    if (g.refs.size !== 1 || g.dates.size !== 1) defauts.push({ type: 'pieces', journal: g.journal, numero: g.numero })
  }
  const libellesParCompte = new Map<string, Set<string>>()
  const noter = (compte: string, libelle: string) =>
    libellesParCompte.set(compte, (libellesParCompte.get(compte) ?? new Set()).add(libelle))
  for (const l of n.lignes) noter(l.ecriture.compte, l.compteLib)
  for (const a of n.aNouveaux) noter(a.aNouveau.compte, a.compteLib)
  for (const [compte, libelles] of libellesParCompte) if (libelles.size > 1) defauts.push({ type: 'compte', compte })
  const libellesParAuxiliaire = new Map<string, Set<string>>()
  for (const l of n.lignes) {
    if (l.compAuxNum === null) continue
    libellesParAuxiliaire.set(l.compAuxNum, (libellesParAuxiliaire.get(l.compAuxNum) ?? new Set()).add(l.compAuxLib ?? ''))
  }
  for (const [compAuxNum, libelles] of libellesParAuxiliaire) if (libelles.size > 1) defauts.push({ type: 'auxiliaire', compAuxNum })
  return defauts
}

// ── La demande envoyée à `valider_exercice` ───────────────────────────────────────────────────────────

// Une ligne de la numérotation, sous la forme que `valider_exercice` lit (`jsonb_to_recordset`).
export interface LigneDemandee {
  id: string
  journal: JournalCode
  numero: number
  piece_ref: string
  piece_date: string
  compte_lib: string
  comp_aux_num: string | null
  comp_aux_lib: string | null
}

export interface ANouveauDemande {
  id: string
  compte_lib: string
  ecriture_lib: string
}

export interface DemandeDeValidation {
  p_lignes: LigneDemandee[]
  p_a_nouveaux: ANouveauDemande[]
  // La 2035 telle qu'elle est validée (trésorerie), rien en engagement — la base exige l'un ou l'autre selon
  // le modèle du dossier.
  p_declaration: Instantane2035 | null
}

// TIRÉE DE LA NUMÉROTATION MÊME DU FEC : ce que la base fige est exactement ce que le fichier imprime, et le FEC
// relu depuis l'exercice validé est celui qu'on aurait exporté la veille.
export function demandeDeValidation(n: NumerotationFec, declaration: Instantane2035 | null): DemandeDeValidation {
  return {
    p_lignes: n.lignes.map((l) => ({
      id: l.ecriture.id, journal: l.journal, numero: l.numero, piece_ref: l.pieceRef, piece_date: l.pieceDate,
      compte_lib: l.compteLib, comp_aux_num: l.compAuxNum, comp_aux_lib: l.compAuxLib,
    })),
    p_a_nouveaux: n.aNouveaux.map((a) => ({ id: a.aNouveau.id, compte_lib: a.compteLib, ecriture_lib: a.ecritureLib })),
    p_declaration: declaration,
  }
}

// ── L'instantané de la 2035 ───────────────────────────────────────────────────────────────────────────

// LA 2035 TELLE QU'ELLE A ÉTÉ VALIDÉE, gardée avec l'exercice (`exercices_valides.declaration`). La 2035 se
// calcule depuis les sources ; validée, elle ne doit plus suivre une évolution du calcul ni une catégorie
// renommée. L'instantané porte donc ce qui a été déclaré — les montants au centime case par case, ceux que le
// formulaire imprime à l'euro, les postes et l'identité du déclarant — et l'écran d'un exercice validé le relit
// au lieu de recalculer.
export interface Instantane2035 {
  version: 1
  annee: number
  // Au centime, toutes les cases du formulaire, calculées comprises (`valeursDesCases`).
  cases: Record<string, number>
  // À l'euro, telles que le formulaire les porte (`arrondirPourFormulaire`) : celles du PDF.
  formulaire: Record<string, number>
  totalRecettes: number
  totalDepenses: number
  resultat: number
  postes: { poste: string; nature: 'recette' | 'depense'; montant: number; nbPieces: number; nbMouvements: number }[]
  entete: EnteteDeclaration
}

export function instantane2035(
  declaration: Declaration2035,
  // `valeursDesCases(declaration).valeurs` et `arrondirPourFormulaire(valeurs, annee)` : passés plutôt que
  // recalculés ici, pour que l'instantané soit ce que l'écran montre et ce que le PDF imprime.
  valeurs: ReadonlyMap<string, number>,
  formulaire: ReadonlyMap<string, number>,
  entete: EnteteDeclaration,
): Instantane2035 {
  return {
    version: 1,
    annee: declaration.annee,
    cases: Object.fromEntries([...valeurs].sort(([a], [b]) => a.localeCompare(b))),
    formulaire: Object.fromEntries([...formulaire].sort(([a], [b]) => a.localeCompare(b))),
    totalRecettes: declaration.totalRecettes,
    totalDepenses: declaration.totalDepenses,
    resultat: declaration.resultat,
    postes: [...declaration.recettes, ...declaration.depenses].map((l) => ({
      poste: l.poste, nature: l.nature, montant: l.montant, nbPieces: l.nbPieces, nbMouvements: l.nbMouvements,
    })),
    entete: { nom: entete.nom, activite: entete.activite, siret: entete.siret },
  }
}

// Relit un instantané gardé en base, et le REFUSE plutôt que de deviner : un instantané illisible ne doit pas
// s'afficher comme une 2035 vide, et l'écran le dit. La base ne garantit que « un objet ».
export function lireInstantane2035(valeur: unknown): Instantane2035 | null {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return null
  const v = valeur as Record<string, unknown>
  const nombres = (o: unknown): o is Record<string, number> =>
    !!o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every((x) => typeof x === 'number' && Number.isFinite(x))
  const texteOuNul = (x: unknown) => x === null || typeof x === 'string'
  const entete = v.entete as Record<string, unknown> | null | undefined
  if (v.version !== 1 || typeof v.annee !== 'number' || !nombres(v.cases) || !nombres(v.formulaire)) return null
  if (![v.totalRecettes, v.totalDepenses, v.resultat].every((x) => typeof x === 'number' && Number.isFinite(x))) return null
  if (!Array.isArray(v.postes) || !v.postes.every((p) => !!p && typeof p === 'object'
    && typeof (p as Record<string, unknown>).poste === 'string'
    && ((p as Record<string, unknown>).nature === 'recette' || (p as Record<string, unknown>).nature === 'depense')
    && typeof (p as Record<string, unknown>).montant === 'number')) return null
  if (!entete || typeof entete !== 'object' || !texteOuNul(entete.nom) || !texteOuNul(entete.activite) || !texteOuNul(entete.siret)) {
    return null
  }
  return valeur as Instantane2035
}

// Une Map de cases, pour les fonctions du formulaire (`remplir2035`, `FormulaireAnnuel`).
export function casesDeLInstantane(cases: Readonly<Record<string, number>>): Map<string, number> {
  return new Map(Object.entries(cases))
}
