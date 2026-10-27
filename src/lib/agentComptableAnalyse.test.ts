import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SANS_VIREMENT_MIXTE } from '../test/ventesFacturees'
import type { AcquisitionDuBien } from './amortissements'
import { analyserEcritures, lignesPourPiece, piecesAComptabiliser, type CibleComptable, type LigneAGenerer } from './ecritures'
import { partsEncaissees, type EncaissementLu, type ExemplaireLu, type FactureDuDossier } from './encaissementsFactures'
import { lignesEngagementPourPiece, type ModeleComptable } from './engagement'
import { exemplairesDesSources, facturesSourcesDe, type FacturesSources } from './facturesSources'
import { montantRetenu } from './montantRetenu'
import {
  rattachementsTresorerie, paiementsDesPieces, type PaiementDePiece, type PaiementsDesPieces, type PartEncaissee, type PartReglee,
} from './rattachement'
import type { Categorie, CompteNotesDeFrais, EcritureBrouillon, LigneBancaire, Piece } from './types'
import { dateAParis } from './format'
import { estFigee, frontiereDeValidation } from './validationExercice'
import { PLAN_PAR_DEFAUT } from './planComptable'

// `agent-comptable` EST AUTO-PORTÉE, ET C'ÉTAIT LA DERNIÈRE DUPLICATION SANS GARDE.
//
// Elle redéclarait six fonctions de `src/lib` (soldeCompte, tvaNettePourPeriode, analyserEcritures,
// categoriesSansCompte, categoriesSansPoste, piecesSansTva) plus les deux tarifs de `coutsApi`, et
// aucun des neuf tests-garde du dépôt ne la couvrait : ils gardent `extract-piece`, `receive-email`
// et `superpdp-emit`. Les deux premières sont parties le 28/09/2026 avec la comparaison des
// déclarations de TVA au brouillon, que l'onglet TVA remplace (lib/declarationTva.ts).
//
// ELLE AVAIT DÉRIVÉ, sur celle des six qui pouvait le plus coûter. `analyserEcritures` a gagné
// TROIS comparaisons dans `src/lib` — le compte, la ventilation de TVA, la date — et la copie
// déployée n'en portait toujours qu'une, le TOTAL. Or les trois ajoutées ont précisément été
// écrites parce que le total NE BOUGE PAS dans ces cas-là : recatégoriser une pièce, corriger sa
// TVA à TTC constant, ou lui rendre sa date laissent la somme du groupe rigoureusement inchangée.
//
// CE QUE ÇA COÛTAIT : l'assistant répondait « aucune écriture à régénérer » sur un dossier dont la
// Checklist en comptait, à la question « quelles sont les anomalies ? » — la seule que cet outil
// existe pour traiter. Deux livrables, deux réponses, aucun signal : l'incohérence que ce dépôt a
// déjà payée trois fois.
//
// ET LE MODÈLE DU DOSSIER DÉCIDE DE CE QU'UNE ÉCRITURE DOIT CONTENIR (28/09/2026). En comptabilité
// d'engagement (src/lib/engagement.ts), une pièce porte l'écriture de sa FACTURE — avec son compte de
// tiers, 401, 411 ou celui des notes de frais — et un RÈGLEMENT par mouvement rapproché, chacun
// équilibré seul. Une copie restée à la trésorerie annoncerait « à régénérer » chacune de ces
// écritures justes, et se tairait sur un mouvement rapproché sans règlement : les deux copies sont
// donc comparées dans les deux modèles.
//
// ET UN EXERCICE VALIDÉ NE SE COMPARE PLUS (04/10/2026, ligne 26.6, étape d). Une pièce que la frontière de
// validation coupe ne se juge que sur sa part OUVERTE, ligne pour ligne contre ce que le GÉNÉRATEUR produirait
// aujourd'hui (`partieOuverteDesynchronisee`). La copie porte donc aussi le générateur — trésorerie et engagement —,
// comparé ici à `lignesPourPiece` de src/lib, et les deux copies sont comparées sous plusieurs frontières.
//
// ET UNE PIÈCE SE PAIE AUSSI PAR LA PART D'UN VIREMENT GROUPÉ (30/09/2026, ligne 26). Les paiements d'une
// pièce sont ses rapprochements ET ses parts (`paiementsDesPieces`), et ses lignes de banque doivent les
// suivre un par un, au montant de chacun. Une copie restée aux seuls rapprochements dirait « en attente de
// rapprochement » une pièce réglée par un virement groupé, et « à régénérer » son écriture juste.
//
// ET LA SOURCE DES VENTES (27/10/2026, chantier EC-Q3, étape VF9b, ligne 28.65). Le générateur reprend ses trois signatures
// d'aujourd'hui : les factures sources (`piecesAComptabiliser`), les exemplaires (`analyserEcritures`) et les parts des
// virements mixtes (`paiementsDesPieces`, origine `encaissements`). Chaque cas se compare donc aussi sous quatre RÉGIMES de
// ventes — aucune facture source ; chaque pièce exemplaire d'une facture source ; exemplaire d'une facture qui ne l'est pas ;
// exemplaire d'une facture d'avant qu'un virement mixte paie —, chaque côté tirant les sources, les exemplaires et les parts
// de SES copies des blocs FACTURES SOURCES et VIREMENT MIXTE. Une copie qui compterait l'exemplaire, ou oublierait le
// virement mixte, dirait « à régénérer » ce que la Checklist tait.
//
// Le garde est volontairement FRAGILE, comme ses huit aînés : renommer une fonction ou changer une
// signature le casse bruyamment, ce qui vaut mieux qu'une copie qui dérive en silence.
function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

// Prend la SOURCE en paramètre plutôt que de la lire elle-même : c'est ce qui permet de lui donner
// une source où une dérive a été PLANTÉE, et donc de prouver que ce garde-fou sait encore échouer.
function extraire(source: string) {
  // DE LA PREMIÈRE COPIE DE src/lib/ecritures.ts À LA FIN D'`analyserEcritures` : les constantes
  // comptables, les blocs FACTURES SOURCES et VIREMENT MIXTE, `piecesAComptabiliser`, le bloc copié de
  // src/lib/rattachement.ts (qui décide de la DATE qu'une écriture doit porter) et `analyserEcritures`. Tout vient de
  // la MÊME source : une dérive sur un numéro de compte, sur le seuil d'alignement ou sur la tolérance d'équilibre doit
  // mordre ici aussi, pas seulement une dérive d'algorithme.
  const debut = source.indexOf('// ---- Dupliqué depuis src/lib/ecritures.ts')
  expect(debut, 'le bloc copié de src/lib/ecritures.ts est introuvable — garde-fou à remettre à jour')
    .toBeGreaterThan(-1)
  const ancreFin = source.indexOf('function analyserEcritures(', debut)
  expect(ancreFin, '`analyserEcritures` introuvable après le bloc copié').toBeGreaterThan(debut)
  const fin = source.indexOf('\n}\n', ancreFin)
  expect(fin, "fin d'`analyserEcritures` introuvable").toBeGreaterThan(ancreFin)
  const bloc = source.slice(debut, fin + 2)
  for (const attendu of [
    'function piecesAComptabiliser(', 'function rattachementsTresorerie(', 'const COMPTE_BANQUE =',
    'const COMPTE_FOURNISSEURS =', 'const COMPTE_FOURNISSEURS_IMMOBILISATIONS =', 'const COMPTE_TVA_IMMOBILISATIONS =',
    'function compteTvaDe(', 'function compteDeTiers(', 'function engagementDesynchronise(',
    'function desequilibresEngagement(', 'function paiementsDesPieces(', 'function banqueSuitLesPaiements(',
    'function frontiereDeValidation(', 'function estFigee(', 'function lignesPourPiece(', 'function partieOuverteDesynchronisee(',
    'function dateDuDepot(', '// ── DÉBUT FACTURES SOURCES ', '// ── FIN FACTURES SOURCES ', '// ── DÉBUT VIREMENT MIXTE ',
    '// ── FIN VIREMENT MIXTE ', 'function exemplaireDUneSource(', 'function facturesSourcesDe(', 'function exemplairesDesSources(',
    'function partsEncaissees(', 'function exemplaireUnique(',
  ] as const) {
    expect(bloc, `« ${attendu} » absent du bloc gardé`).toContain(attendu)
  }

  // Le bloc est du TypeScript (interfaces, `Pick`, types de retour) : on le transpile avec le
  // compilateur du projet plutôt que d'en retirer les types à la main — une traduction écrite à la
  // main mentirait au premier cas tordu.
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { piecesAComptabiliser, analyserEcritures, rattachementsTresorerie, paiementsDesPieces, frontiereDeValidation, estFigee, lignesPourPiece, dateDuDepot, montantRetenu, facturesSourcesDe, exemplairesDesSources, partsEncaissees }`)() as {
    piecesAComptabiliser: (
      p: Piece[], c: Categorie[], biens: ReadonlyMap<string, AcquisitionDuBien>, sources: FacturesSources,
    ) => ({ piece: Piece } & CibleComptable)[]
    analyserEcritures: (
      e: EcritureBrouillon[], a: ({ piece: Piece } & CibleComptable)[], assujettiTva: boolean, paiements: PaiementsDesPieces,
      modele: ModeleComptable, frontiere: string | null, exemplaires: ReadonlySet<string>,
    ) => {
      nbSansContrepartie: number
      piecesSansContrepartie: string[]
      groupesDesequilibres: { pieceId: string; solde: number }[]
      piecesDesynchronisees: Piece[]
    }
    rattachementsTresorerie: typeof rattachementsTresorerie
    paiementsDesPieces: typeof paiementsDesPieces
    facturesSourcesDe: typeof facturesSourcesDe
    exemplairesDesSources: typeof exemplairesDesSources
    partsEncaissees: typeof partsEncaissees
    frontiereDeValidation: typeof frontiereDeValidation
    estFigee: typeof estFigee
    lignesPourPiece: (
      piece: Piece, cible: CibleComptable, assujettiTva: boolean, paiements: readonly PaiementDePiece[], modele: ModeleComptable,
    ) => Pick<LigneAGenerer, 'date' | 'compte' | 'sens' | 'montant' | 'ligne_bancaire_id'>[]
    dateDuDepot: (instant: string) => string
    montantRetenu: typeof montantRetenu
  }
}

const deployee = extraire(sourceDeployee())

const COMPTE_ACHATS = '606100'
// La cible d'une pièce ordinaire, et celle de la facture d'un bien immobilisé (lib/ecritures.ts).
const cible = (compte: string): CibleComptable => ({ compte, immobilisation: false })
const bien = (compte: string): CibleComptable => ({ compte, immobilisation: true })
// Ce que la facture d'un bien du registre écrit (`acquisitionsDesBiens`) : le compte de sa nature, ou rien.
const acq = (compte: string): AcquisitionDuBien => ({ compte, motif: null })
const SANS_NATURE: AcquisitionDuBien = { compte: null, motif: 'sans_nature' }
const REPRIS: AcquisitionDuBien = { compte: null, motif: 'repris' }
const COMPTE_TVA_DEDUCTIBLE = '445660'
const COMPTE_BANQUE = '512000'

const categories = [
  { id: 'cat-achats', compte_comptable: COMPTE_ACHATS, poste_2035: 'Achats' },
  { id: 'cat-autre', compte_comptable: '628000', poste_2035: 'Divers' },
  { id: 'cat-sans-compte', compte_comptable: null, poste_2035: 'Achats' },
  // Une catégorie dont le compte EST celui de l'exploitant — un achat classé en prélèvement personnel.
  { id: 'cat-108', compte_comptable: '108000', poste_2035: null },
] as Categorie[]

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p1', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10',
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, categorie_id: 'cat-achats',
    created_at: '2025-03-10T09:00:00Z', nom_fichier: 'f.pdf', ...o,
  }) as Piece

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon =>
  ({
    id: 'e1', piece_id: 'p1', date: '2025-03-10', compte: COMPTE_ACHATS,
    libelle: 'FOURNISSEUR', sens: 'debit', montant: 100, statut: 'proposee', ligne_bancaire_id: null, ...o,
  }) as EcritureBrouillon

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

// Les frontières de validation sous lesquelles `memeResultat` compare les deux copies : aucune ; la veille de la date
// de pièce de la batterie, et ce jour même ; celles qui coupent ses paiements (20 mars, 2 et 15 avril, 2 mai) ; la fin
// de l'exercice. La plupart des cas ont ainsi une ligne figée et une ouverte sous l'une d'elles.
const FRONTIERES: (string | null)[] = [null, '2025-03-09', '2025-03-10', '2025-03-31', '2025-04-10', '2025-12-31']

// Un mouvement rapproché de la pièce : il DATE l'écriture en trésorerie, et appelle un RÈGLEMENT en
// engagement.
const paiement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2025-04-02', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
  piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
  created_at: '2025-04-02T09:00:00Z', encaissements_de_factures: false, ...o,
})

/**
 * Le jeu d'écritures qu'une pièce conforme produit : charge + TVA + la contrepartie banque de son paiement,
 * le mouvement `payee(id)` du même jour. `banque: false` rend celui d'une pièce que rien ne paie encore :
 * une contrepartie sans paiement serait à régénérer, comme un paiement sans contrepartie.
 */
function groupeConforme(id: string, o: { compte?: string; tva?: number; date?: string; banque?: boolean } = {}) {
  const date = o.date ?? '2025-03-10'
  return [
    ecriture({ id: `${id}-a`, piece_id: id, compte: o.compte ?? COMPTE_ACHATS, montant: 100, date }),
    ecriture({ id: `${id}-t`, piece_id: id, compte: COMPTE_TVA_DEDUCTIBLE, montant: o.tva ?? 20, date }),
    ...(o.banque === false ? [] : [
      ecriture({ id: `${id}-b`, piece_id: id, compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date, ligne_bancaire_id: `l-${id}` }),
    ]),
  ]
}

/** Le mouvement qui paie la pièce `id` en entier, le jour de son écriture conforme. */
const payee = (id: string, date = '2025-03-10') => paiement({ id: `l-${id}`, piece_id: id, date })

// LES VENTES FACTURÉES D'UN CAS (étape VF9b) : les factures du dossier et le registre de leurs encaissements, tels que
// `points_a_traiter` les lit pour un dossier qui a basculé ; les pièces du cas portent leur désignation (`facture_id`).
interface VentesDuCas {
  factures: FactureDuDossier[]
  encaissements: EncaissementLu[]
}

/** Un cas tel qu'un régime le donne : ses pièces, son relevé, ses ventes. */
interface CasDesVentes {
  pieces: Piece[]
  paiements: LigneBancaire[]
  ventes: VentesDuCas
}

const factureDuCas = (o: Partial<FactureDuDossier>): FactureDuDossier => ({
  id: 'f1', dossier_id: 'd1', numero: 'F2025-0001', type: 'facture', statut: 'validee', facture_origine_id: null,
  source_de_la_vente: true, ...o,
})
const encaissementDuCas = (o: Partial<EncaissementLu>): EncaissementLu => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', montant: 100, ligne_bancaire_id: null, annule_id: null, retire_le: null, ...o,
})

/**
 * LES QUATRE RÉGIMES DES VENTES sous lesquels chaque cas compare aussi les deux copies (étape VF9b) — le premier rend
 * son résultat :
 *  - aucune facture source, ce que voit un dossier qui n'a pas basculé ;
 *  - chaque pièce, exemplaire désigné d'une facture SOURCE : elle ne s'écrit plus, et son écriture n'est plus jugée ;
 *  - chaque pièce, exemplaire d'une facture qui n'est PAS source : elle compte comme hier ;
 *  - chaque pièce, exemplaire d'une facture d'avant que paie un VIREMENT MIXTE — un crédit classé par ses encaissements,
 *    daté du 20 avril, qui porte aussi l'encaissement d'une facture source : une pièce de vente y gagne un paiement, à
 *    la date du mouvement et au montant de l'encaissement ; une autre n'en gagne aucun (l'exemplaire unique est une pièce
 *    de vente validée).
 */
const REGIMES: { nom: string; appliquer: (pieces: Piece[], paiements: LigneBancaire[]) => CasDesVentes }[] = [
  { nom: 'sans facture source', appliquer: (pieces, paiements) => ({ pieces, paiements, ventes: { factures: [], encaissements: [] } }) },
  {
    nom: 'chaque pièce exemplaire d’une facture source',
    appliquer: (pieces, paiements) => ({
      pieces: pieces.map((p) => ({ ...p, facture_id: `fs-${p.id}` })),
      paiements,
      ventes: { factures: pieces.map((p) => factureDuCas({ id: `fs-${p.id}`, numero: `FS-${p.id}` })), encaissements: [] },
    }),
  },
  {
    nom: 'chaque pièce exemplaire d’une facture qui n’est pas source',
    appliquer: (pieces, paiements) => ({
      pieces: pieces.map((p) => ({ ...p, facture_id: `fa-${p.id}` })),
      paiements,
      ventes: {
        factures: pieces.map((p) => factureDuCas({ id: `fa-${p.id}`, numero: `FA-${p.id}`, source_de_la_vente: false })),
        encaissements: [],
      },
    }),
  },
  {
    nom: 'chaque pièce exemplaire d’une facture d’avant qu’un virement mixte paie',
    appliquer: (pieces, paiements) => ({
      pieces: pieces.map((p) => ({ ...p, facture_id: `fa-${p.id}` })),
      paiements: [...paiements, ...pieces.map((p) => paiement({
        id: `vm-${p.id}`, piece_id: null, date: '2025-04-20', montant: Math.abs(p.montant_ttc ?? 0) + 50, encaissements_de_factures: true,
      }))],
      ventes: {
        factures: [
          factureDuCas({ id: 'fs-mixte', numero: 'FS-MIXTE' }),
          ...pieces.map((p) => factureDuCas({ id: `fa-${p.id}`, numero: `FA-${p.id}`, source_de_la_vente: false })),
        ],
        encaissements: pieces.flatMap((p) => [
          encaissementDuCas({ id: `es-${p.id}`, facture_id: 'fs-mixte', montant: 50, ligne_bancaire_id: `vm-${p.id}` }),
          encaissementDuCas({ id: `ea-${p.id}`, facture_id: `fa-${p.id}`, montant: Math.abs(p.montant_ttc ?? 0), ligne_bancaire_id: `vm-${p.id}` }),
        ]),
      },
    }),
  },
]

/** Les paiements de chaque pièce, sous une forme comparable : par pièce, dans l'ordre de leur identifiant. */
const enObjet = (m: PaiementsDesPieces) => Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)))

type CopiesDesVentes = Pick<typeof deployee, 'facturesSourcesDe' | 'exemplairesDesSources' | 'partsEncaissees'>
const VENTES_DE_SRC_LIB: CopiesDesVentes = { facturesSourcesDe, exemplairesDesSources, partsEncaissees }

/**
 * Ce que `points_a_traiter` tire des ventes d'un cas, par les copies d'UN côté : les factures sources, les pièces qui en
 * sont l'exemplaire, et ce que les virements mixtes paient — les pièces désignées lues avec leur statut et leur type.
 */
function entreesDesVentes(cas: CasDesVentes, copies: CopiesDesVentes) {
  const sources = copies.facturesSourcesDe(cas.ventes.factures)
  const designees: ExemplaireLu[] = cas.pieces.filter((p) => p.facture_id != null)
    .map((p) => ({ id: p.id, dossier_id: 'd1', facture_id: p.facture_id, statut: p.statut, type_piece: p.type_piece }))
  return {
    sources,
    exemplaires: copies.exemplairesDesSources(cas.pieces, sources),
    encaissees: copies.partsEncaissees('d1', cas.ventes.encaissements, { factures: cas.ventes.factures }, designees),
  }
}

/**
 * Les deux copies doivent rendre EXACTEMENT la même chose — on compare les ids, pas les objets.
 *
 * `copie` est paramétrable et vaut la copie déployée par défaut : les dix cas ci-dessous exercent
 * donc bien ce défaut, et la BORNE de fin de fichier lui passe une copie dérivée pour vérifier que
 * cette fonction sait encore échouer. Sans elle, neutraliser la comparaison ici laisserait les dix
 * cas verts — « le scanner est aveugle » et « zéro faute » redeviendraient indiscernables.
 *
 * Chaque côté tire les paiements des pièces de SA copie de `paiementsDesPieces` : une dérive de la copie
 * déployée — les parts oubliées, un mouvement non rapproché retenu — mord ici comme sur le calcul.
 *
 * ET LES DEUX COPIES SONT COMPARÉES SOUS CHAQUE FRONTIÈRE DE VALIDATION de `FRONTIERES` — aucune, puis des frontières
 * qui coupent les dates de la batterie —, pas seulement sous celle qu'on demande : chaque cas ci-dessous éprouve
 * ainsi la branche d'une pièce que la frontière coupe. Le résultat rendu est celui de `frontiere`.
 *
 * ET SOUS CHAQUE RÉGIME DES VENTES de `REGIMES` (étape VF9b), chaque côté tirant les factures sources, les exemplaires
 * et les parts des virements mixtes de SES copies — sauf quand le cas donne ses propres ventes (`ventes`), qui sont
 * alors les seules comparées et celles du résultat.
 */
function memeResultat(
  ecritures: EcritureBrouillon[], pieces: Piece[], biens: [string, AcquisitionDuBien][] = [], copie = deployee, assujettiTva = true,
  paiements: LigneBancaire[] = [], modele: ModeleComptable = TRESORERIE, parts: PartReglee[] = [], frontiere: string | null = null,
  ventes: VentesDuCas | null = null,
) {
  const resume = (a: ({ piece: Piece } & CibleComptable)[]) => a.map((x) => `${x.piece.id}:${x.compte}:${x.immobilisation}`)
  const forme = (r: Pick<ReturnType<typeof analyserEcritures>, 'nbSansContrepartie' | 'groupesDesequilibres' | 'piecesDesynchronisees'>) => ({
    nbSansContrepartie: r.nbSansContrepartie,
    groupesDesequilibres: r.groupesDesequilibres.map((g) => `${g.pieceId}:${g.solde.toFixed(2)}`),
    piecesDesynchronisees: r.piecesDesynchronisees.map((p) => p.id),
  })
  const regimes = ventes
    ? [{ nom: 'les ventes du cas', cas: { pieces, paiements, ventes } }]
    : REGIMES.map((r) => ({ nom: r.nom, cas: r.appliquer(pieces, paiements) }))
  let rendu: ReturnType<typeof forme> | null = null
  for (const { nom, cas } of regimes) {
    const ventesIci = entreesDesVentes(cas, VENTES_DE_SRC_LIB)
    const ventesLa = entreesDesVentes(cas, copie)
    expect([...ventesLa.sources], `facturesSourcesDe a dérivé (${nom})`).toEqual([...ventesIci.sources])
    expect([...ventesLa.exemplaires], `exemplairesDesSources a dérivé (${nom})`).toEqual([...ventesIci.exemplaires])
    expect(ventesLa.encaissees, `partsEncaissees a dérivé (${nom})`).toEqual(ventesIci.encaissees)
    // `biens` : la pièce de chaque bien du registre, et ce que sa facture écrit — le compte de sa nature, ou rien
    // (sans nature, ou acquis avant l'ouverture d'un dossier repris).
    const ici = piecesAComptabiliser(cas.pieces, categories, new Map(biens), ventesIci.sources)
    const la = copie.piecesAComptabiliser(cas.pieces, categories, new Map(biens), ventesLa.sources)
    expect(resume(la), `piecesAComptabiliser a dérivé (${nom})`).toEqual(resume(ici))
    const paiementsIci = paiementsDesPieces(cas.paiements, parts, ventesIci.encaissees)
    const paiementsLa = copie.paiementsDesPieces(cas.paiements, parts, ventesLa.encaissees)
    expect(enObjet(paiementsLa), `paiementsDesPieces a dérivé (${nom})`).toEqual(enObjet(paiementsIci))
    for (const f of new Set([...FRONTIERES, frontiere])) {
      const r1 = analyserEcritures(ecritures, ici, assujettiTva, paiementsIci, modele, f, ventesIci.exemplaires)
      const r2 = copie.analyserEcritures(ecritures, la, assujettiTva, paiementsLa, modele, f, ventesLa.exemplaires)
      expect(forme(r2), `analyserEcritures a dérivé (${nom}, frontière ${f})`).toEqual(forme(r1))
      // Les pièces elles-mêmes, et pas seulement leur nombre : en engagement, celles d'un lettrage fait à la main qui
      // tient en sont retirées (bloc LETTRAGE MANUEL), donc deux listes de même longueur peuvent dire deux choses.
      expect(r2.piecesSansContrepartie, `piecesSansContrepartie a dérivé (${nom}, frontière ${f})`).toEqual(r1.piecesSansContrepartie)
    }
    rendu ??= forme(analyserEcritures(ecritures, ici, assujettiTva, paiementsIci, modele, frontiere, ventesIci.exemplaires))
  }
  return rendu!
}

describe('agent-comptable / analyserEcritures (copie déployée)', () => {
  // Une pièce à 0 € n'a rien à comptabiliser : la base refuse une ligne nulle, et la compter la laissait « sans écriture »
  // pour toujours. `memeResultat` compare aussi ce que les deux copies mettent à comptabiliser.
  it('n’a rien à comptabiliser pour une pièce à 0 €, comme src/lib', () => {
    expect(memeResultat([], [piece({ id: 'p1', montant_ht: 0, montant_tva: 0, montant_ttc: 0 })])).toEqual({
      nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [],
    })
  })

  it('se tait sur une pièce parfaitement synchronisée', () => {
    expect(memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })], [], deployee, true, [payee('p1')])).toEqual({
      nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [],
    })
  })

  it('voit un TOTAL faux — la seule comparaison que la copie portait', () => {
    const ecritures = groupeConforme('p1')
    ecritures[0].montant = 150
    expect(memeResultat(ecritures, [piece({ id: 'p1' })], [], deployee, true, [payee('p1')]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit un COMPTE changé, à total rigoureusement identique', () => {
    // Recatégoriser une pièce validée ne réécrit pas son écriture. La somme ne bouge pas d'un
    // centime : c'est exactement le cas que la copie déployée déclarait « synchronisée ».
    const r = memeResultat(groupeConforme('p1', { compte: '628000' }), [piece({ id: 'p1' })], [], deployee, true, [payee('p1')])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une VENTILATION DE TVA fausse, à TTC constant', () => {
    // 100 + 20 devient 106,09 + 13,91 : même total, mêmes comptes, et la charge comme la TVA
    // déductible partent fausses en FEC et en balance.
    const ecritures = groupeConforme('p1', { tva: 13.91 })
    ecritures[0].montant = 106.09
    expect(memeResultat(ecritures, [piece({ id: 'p1' })], [], deployee, true, [payee('p1')]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une DATE qui ne suit plus celle de la pièce', () => {
    // Le cas de « Retrouver les dates manquantes » : la pièce reçoit sa date, l'écriture garde
    // celle du dépôt — et part donc dans le mauvais exercice.
    const r = memeResultat(groupeConforme('p1', { date: '2026-09-16', banque: false }), [piece({ id: 'p1' })])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('se tait quand la pièce n’a PAS de date', () => {
    // Sans date elle ne prétend à aucun exercice : il n'y a rien à contredire, et comparer au
    // repli ferait crier au loup sur toute écriture générée dans un autre fuseau.
    const r = memeResultat(groupeConforme('p1', { date: '2026-09-16', banque: false }), [piece({ id: 'p1', date_piece: null })])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('se tait sur un AVOIR correctement enregistré au sens inverse', () => {
    const ecritures = [
      ecriture({ id: 'a', piece_id: 'p1', sens: 'credit', montant: 100 }),
      ecriture({ id: 't', piece_id: 'p1', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
      ecriture({ id: 'b', piece_id: 'p1', compte: COMPTE_BANQUE, sens: 'debit', montant: 120, ligne_bancaire_id: 'l-p1' }),
    ]
    const avoir = piece({ id: 'p1', montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    const rembourse = paiement({ id: 'l-p1', date: '2025-03-10', montant: 120 })
    expect(memeResultat(ecritures, [avoir], [], deployee, true, [rembourse]).piecesDesynchronisees).toEqual([])
  })

  it('se tait sur une pièce pas encore générée', () => {
    expect(memeResultat([], [piece({ id: 'p1' })]).piecesDesynchronisees).toEqual([])
  })

  it('compte les groupes sans contrepartie et les groupes déséquilibrés', () => {
    const ecritures = [
      // Sans contrepartie banque.
      ecriture({ id: 'a', piece_id: 'p1' }),
      // Avec contrepartie, mais le solde ne tombe pas à zéro.
      ...groupeConforme('p2'),
      ecriture({ id: 'x', piece_id: 'p2', compte: COMPTE_ACHATS, montant: 5 }),
      // Une écriture orpheline, qu'aucun groupe ne doit compter.
      ecriture({ id: 'o', piece_id: null }),
    ]
    const r = memeResultat(ecritures, [piece({ id: 'p1' }), piece({ id: 'p2' })], [], deployee, true, [payee('p2')])
    expect(r.nbSansContrepartie).toBe(1)
    expect(r.groupesDesequilibres).toEqual(['p2:5.00'])
  })

  // UN DOSSIER EXONÉRÉ NE VENTILE PAS LA TVA : sa charge est le TTC, sur une seule ligne (voir
  // src/lib/montantRetenu.ts). Les deux copies doivent le savoir, sinon l'assistant annoncerait « à
  // régénérer » une écriture juste — ou tairait celle qui porte encore une TVA qu'il ne récupère pas.
  it('se tait sur la charge TTC d’un dossier exonéré, sur une seule ligne', () => {
    const ecritures = [
      ecriture({ id: 'a', piece_id: 'p1', montant: 120 }),
      ecriture({ id: 'b', piece_id: 'p1', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l-p1' }),
    ]
    expect(memeResultat(ecritures, [piece({ id: 'p1' })], [], deployee, false, [payee('p1')]).piecesDesynchronisees).toEqual([])
  })

  it('voit une TVA encore ventilée sur un dossier exonéré', () => {
    expect(memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })], [], deployee, false, [payee('p1')]).piecesDesynchronisees)
      .toEqual(['p1'])
  })

  // LA DATE DU PAIEMENT (src/lib/rattachement.ts) : une écriture est datée à son paiement quand le
  // rapprochement le connaît. Sans le bloc copié, l'assistant signalerait « à régénérer » toute
  // écriture justement datée — et se tairait sur celle restée à la date de facture.
  it('voit une écriture restée à la date de facture alors que le paiement est connu', () => {
    // La contrepartie suit le paiement ; la charge est restée à la date de facture.
    const ecritures = groupeConforme('p1')
    ecritures[2] = { ...ecritures[2], date: '2025-04-02', ligne_bancaire_id: 'l1' }
    const r = memeResultat(ecritures, [piece({ id: 'p1' })], [], deployee, true, [paiement()])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('se tait sur une écriture datée à son paiement', () => {
    const r = memeResultat(groupeConforme('p1', { date: '2025-04-02' }), [piece({ id: 'p1' })], [], deployee, true, [payee('p1', '2025-04-02')])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('accepte une pièce réglée en partie, répartie sur ses deux dates', () => {
    const partiel = [paiement({ montant: -48 })]
    const p = piece({ id: 'p1' })
    const reparties = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces(partiel, [], SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `r${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(memeResultat(reparties, [p], [], deployee, true, partiel).piecesDesynchronisees).toEqual([])
    // Et la même écriture tout entière au paiement ne l'est pas.
    const toutAuPaiement = groupeConforme('p1', { date: '2025-04-02' })
    expect(memeResultat(toutAuPaiement, [p], [], deployee, true, partiel).piecesDesynchronisees).toEqual(['p1'])
  })

  it('ne se laisse pas dater par un mouvement qui n’est plus rapproché', () => {
    const r = memeResultat(groupeConforme('p1', { banque: false }), [piece({ id: 'p1' })], [], deployee, true, [paiement({ statut: 'non_rapprochee' })])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  // UNE CONTREPARTIE PAR PAIEMENT, ET LES PARTS DES VIREMENTS GROUPÉS EN SONT (30/09/2026, ligne 26). La
  // génération de src/lib (`lignesPourPiece`) sert de référence : « conforme » veut dire ce qu'elle produit.
  it('se tait sur une pièce réglée par la part d’un virement groupé, et la dit payée', () => {
    const p = piece({ id: 'p1' })
    const groupe = paiement({ id: 'g', piece_id: null, montant: -300, reglement_groupe: true })
    const parts: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -120 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -180 }]
    const genere = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces([groupe], parts, SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `g${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(memeResultat(genere, [p], [], deployee, true, [groupe], TRESORERIE, parts)).toEqual({
      nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [],
    })
    // Sans ses parts, la même écriture serait « à régénérer » : datée au virement, sans paiement connu.
    expect(memeResultat(genere, [p], [], deployee, true, [groupe], TRESORERIE, []).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une pièce payée en deux fois qui ne porte que la contrepartie du premier paiement', () => {
    // Un acompte rapproché, puis le solde par un virement groupé : deux contreparties attendues.
    const p = piece({ id: 'p1' })
    const acompte = paiement({ id: 'a', date: '2025-03-20', montant: -48 })
    const groupe = paiement({ id: 'g', date: '2025-04-15', piece_id: null, montant: -272, reglement_groupe: true })
    const parts: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -72 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -200 }]
    const genere = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces([acompte, groupe], parts, SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `d${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(memeResultat(genere, [p], [], deployee, true, [acompte, groupe], TRESORERIE, parts).piecesDesynchronisees).toEqual([])
    const unSeul = genere.filter((e) => !(e.compte === COMPTE_BANQUE && e.ligne_bancaire_id === 'g'))
    const r = memeResultat(unSeul, [p], [], deployee, true, [acompte, groupe], TRESORERIE, parts)
    expect(r.piecesDesynchronisees).toEqual(['p1'])
    // Payée, elle n'est pas « en attente de rapprochement » : c'est son écriture qui est à régénérer.
    expect(r.nbSansContrepartie).toBe(0)
  })

  it('voit une contrepartie restée sur l’ancienne part d’un virement réglé de nouveau', () => {
    // Les deux parts règlent la pièce en entier, à l'écart d'alignement près : mêmes dates, même charge. Seul
    // le montant de la contrepartie dit que le virement a été réglé de nouveau.
    const p = piece({ id: 'p1' })
    const groupe = paiement({ id: 'g', piece_id: null, montant: -300, reglement_groupe: true })
    const avant: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -118 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -182 }]
    const apres: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -120 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -180 }]
    const ancienne = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces([groupe], avant, SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `o${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(memeResultat(ancienne, [p], [], deployee, true, [groupe], TRESORERIE, apres).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une contrepartie de trop à côté de la juste : un autre mouvement, ou plus aucun', () => {
    // Ni la date ni le total ne bougent : seule la comparaison des lignes de banque aux paiements la voit.
    const p = piece({ id: 'p1' })
    const juste = groupeConforme('p1')
    const contrepartie = juste.find((e) => e.compte === COMPTE_BANQUE)!
    for (const deTrop of [{ id: 'x', ligne_bancaire_id: 'x' }, { id: 'y', ligne_bancaire_id: null }]) {
      const lignes = [...juste, { ...contrepartie, ...deTrop, montant: 50 }]
      expect(memeResultat(lignes, [p], [], deployee, true, [payee('p1')]).piecesDesynchronisees).toEqual(['p1'])
    }
  })

  it('voit une contrepartie sans sa charge, et un paiement sans contrepartie', () => {
    const p = piece({ id: 'p1' })
    const seule = groupeConforme('p1').filter((e) => e.compte === COMPTE_BANQUE)
    expect(memeResultat(seule, [p], [], deployee, true, [payee('p1')]).piecesDesynchronisees).toEqual(['p1'])
    const sansBanque = groupeConforme('p1', { banque: false })
    const r = memeResultat(sansBanque, [p], [], deployee, true, [payee('p1')])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
    expect(r.nbSansContrepartie).toBe(0)
  })

  it('tire les mêmes paiements que src/lib du relevé, des parts et des virements mixtes', () => {
    // Rapprochements et parts mêlés, dans le désordre ; une part sans pièce, une part d'un mouvement qui ne
    // règle plus en groupe, une part d'un mouvement remis à traiter, une part dont le mouvement n'est pas lu,
    // et un rapprochement remis à traiter. Et les parts des VIREMENTS MIXTES (étape VF9b) : sur un crédit classé par ses
    // encaissements, deux pièces, dont une payée aussi par un rapprochement ; sur un crédit seulement réservé, sur un
    // drapeau resté sans le statut, sur un mouvement rapproché d'une pièce mais pas classé, et sur un mouvement non lu.
    const lignes: LigneBancaire[] = [
      paiement({ id: 'b', date: '2025-05-02', piece_id: 'p1', montant: -40 }),
      paiement({ id: 'g', date: '2025-04-01', piece_id: null, montant: -300, reglement_groupe: true }),
      paiement({ id: 'a', date: '2025-04-01', piece_id: 'p1', montant: -20 }),
      paiement({ id: 'n', date: '2025-04-03', piece_id: null, montant: -90 }),
      paiement({ id: 't', date: '2025-04-04', piece_id: null, montant: -70, statut: 'non_rapprochee', reglement_groupe: true }),
      paiement({ id: 'x', date: '2025-04-05', piece_id: 'p3', montant: -10, statut: 'non_rapprochee' }),
      paiement({ id: 'vm', date: '2025-04-08', piece_id: null, montant: 500, encaissements_de_factures: true }),
      paiement({ id: 'vr', date: '2025-04-09', piece_id: null, montant: 60, statut: 'non_rapprochee' }),
      paiement({ id: 'vd', date: '2025-04-10', piece_id: null, montant: 60, statut: 'non_rapprochee', encaissements_de_factures: true }),
      paiement({ id: 'vp', date: '2025-04-11', piece_id: 'p6', montant: 75 }),
      paiement({ id: 'ac', date: '2025-03-28', piece_id: 'p4', montant: 30 }),
    ]
    const parts: PartReglee[] = [
      { ligne_bancaire_id: 'g', piece_id: 'p1', montant: -60 },
      { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -200 },
      { ligne_bancaire_id: 'g', piece_id: null, montant: -40 },
      { ligne_bancaire_id: 'n', piece_id: 'p2', montant: -90 },
      { ligne_bancaire_id: 't', piece_id: 'p3', montant: -70 },
      { ligne_bancaire_id: 'inconnu', piece_id: 'p3', montant: -5 },
    ]
    const encaissees: PartEncaissee[] = [
      { ligne_bancaire_id: 'vm', piece_id: 'p5', montant: 120 },
      { ligne_bancaire_id: 'vm', piece_id: 'p4', montant: 90 },
      { ligne_bancaire_id: 'vr', piece_id: 'p7', montant: 60 },
      { ligne_bancaire_id: 'vd', piece_id: 'p7', montant: 60 },
      { ligne_bancaire_id: 'vp', piece_id: 'p8', montant: 75 },
      { ligne_bancaire_id: 'absent', piece_id: 'p8', montant: 5 },
    ]
    for (const [quoi, avec] of [['sans virement mixte', SANS_VIREMENT_MIXTE], ['avec ses virements mixtes', encaissees]] as const) {
      expect(enObjet(deployee.paiementsDesPieces(lignes, parts, avec)), quoi).toEqual(enObjet(paiementsDesPieces(lignes, parts, avec)))
    }
    // La batterie exerce bien ce qui décide : les pièces payées, dans l'ordre des dates puis des mouvements — et seul le
    // crédit classé par ses encaissements paie un exemplaire, celui d'une pièce que paie aussi un acompte compris.
    expect(enObjet(paiementsDesPieces(lignes, parts, encaissees))).toEqual({
      p1: [
        { id: 'a', date: '2025-04-01', montant: -20, origine: 'rapprochement' },
        { id: 'g', date: '2025-04-01', montant: -60, origine: 'groupe' },
        { id: 'b', date: '2025-05-02', montant: -40, origine: 'rapprochement' },
      ],
      p2: [{ id: 'g', date: '2025-04-01', montant: -200, origine: 'groupe' }],
      p4: [
        { id: 'ac', date: '2025-03-28', montant: 30, origine: 'rapprochement' },
        { id: 'vm', date: '2025-04-08', montant: 90, origine: 'encaissements' },
      ],
      p5: [{ id: 'vm', date: '2025-04-08', montant: 120, origine: 'encaissements' }],
      p6: [{ id: 'vp', date: '2025-04-11', montant: 75, origine: 'rapprochement' }],
    })
  })

  it('rattache une pièce comme src/lib, paiement partiel et note de frais compris', () => {
    // La copie de `rattachementsTresorerie` elle-même, sur les cas qui la distinguent d'une date de
    // facture : deux paiements, un reste, un écart sous le seuil d'alignement, une note de frais.
    const cas: [Piece, LigneBancaire[]][] = [
      [piece({ id: 'p1' }), []],
      [piece({ id: 'p1', type_piece: 'note_frais' }), []],
      [piece({ id: 'p1', date_piece: null }), []],
      [piece({ id: 'p1' }), [paiement()]],
      [piece({ id: 'p1' }), [paiement({ montant: -118 })]],
      [piece({ id: 'p1' }), [paiement({ montant: -48 })]],
      [piece({ id: 'p1', montant_ttc: 256.16 }), [paiement({ montant: -251.16 })]],
      [piece({ id: 'p1' }), [paiement({ id: 'a', date: '2025-05-01', montant: -60 }), paiement({ id: 'b', date: '2025-04-01', montant: -60 })]],
    ]
    for (const [p, paiements] of cas) {
      expect(deployee.rattachementsTresorerie(p, paiements)).toEqual(rattachementsTresorerie(p, paiements))
    }
  })

  it('écarte les mêmes pièces de la liste à comptabiliser', () => {
    // Les cinq portes : montant absent, bien sans nature, bien repris, catégorie sans compte, catégorie inconnue.
    memeResultat([], [
      piece({ id: 'ok' }),
      piece({ id: 'sans-montant', montant_ttc: null }),
      piece({ id: 'immo' }),
      piece({ id: 'repris' }),
      piece({ id: 'sans-compte', categorie_id: 'cat-sans-compte' }),
      piece({ id: 'sans-categorie', categorie_id: null }),
    ], [['immo', SANS_NATURE], ['repris', REPRIS]])
  })

  // L'ÉCRITURE D'ACQUISITION (01/10/2026, ligne 26.6, étape b) : la facture d'un bien s'écrit sur le compte de
  // sa nature, quelle que soit sa catégorie, et sa TVA en 445620.
  it('écrit les mêmes biens sur le compte de leur nature, catégorie ou pas', () => {
    const r = memeResultat([], [
      piece({ id: 'bien' }),
      piece({ id: 'bien-sans-categorie', categorie_id: null }),
      piece({ id: 'bien-sur-categorie-sans-compte', categorie_id: 'cat-sans-compte' }),
    ], [['bien', acq('218300')], ['bien-sans-categorie', acq('215400')], ['bien-sur-categorie-sans-compte', acq('218400')]])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('se tait sur l’acquisition telle que src/lib la génère, et voit la charge restée sur la catégorie', () => {
    const p = piece({ id: 'p1' })
    const acquisition = lignesPourPiece('d1', p, bien('218300'), true, paiementsDesPieces([paiement()], [], SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `a${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(acquisition.map((e) => e.compte)).toEqual(['218300', '445620', COMPTE_BANQUE])
    expect(memeResultat(acquisition, [p], [['p1', acq('218300')]], deployee, true, [paiement()]).piecesDesynchronisees).toEqual([])
    // La même pièce écrite en charge avant d'être immobilisée : « à régénérer » des deux côtés.
    const charge = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces([paiement()], [], SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `c${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(memeResultat(charge, [p], [['p1', acq('218300')]], deployee, true, [paiement()]).piecesDesynchronisees).toEqual(['p1'])
    // Et l'acquisition d'un bien qu'on retire du registre l'est aussi : elle repasse en charge.
    expect(memeResultat(acquisition, [p], [], deployee, true, [paiement()]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('se tait sur l’acquisition en engagement telle que src/lib la génère, dette au 404', () => {
    const p = piece({ id: 'p1' })
    const lignes = brouillonEngagement(p, [paiement()], { cible: bien('218300') })
    expect([...new Set(lignes.map((e) => e.compte))]).toEqual(['218300', '445620', '404000', COMPTE_BANQUE])
    expect(memeResultat(lignes, [p], [['p1', acq('218300')]], deployee, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([])
    // Une dette restée au 401 : « à régénérer » des deux côtés.
    const au401 = lignes.map((e) => (e.compte === '404000' ? { ...e, compte: '401000' } : e))
    expect(memeResultat(au401, [p], [['p1', acq('218300')]], deployee, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual(['p1'])
  })
})

// EN ENGAGEMENT, le brouillon d'une pièce est celui que src/lib génère (lignesEngagementPourPiece) : on
// part de lui plutôt que de l'écrire à la main, pour que « conforme » veuille dire ce que la génération
// produit réellement.
function brouillonEngagement(
  p: Piece, mouvements: readonly Pick<LigneBancaire, 'id' | 'date' | 'montant'>[],
  o: { assujettiTva?: boolean; compteNotesDeFrais?: CompteNotesDeFrais; cible?: CibleComptable } = {},
): EcritureBrouillon[] {
  return lignesEngagementPourPiece('d1', p, o.cible ?? cible(COMPTE_ACHATS), o.assujettiTva ?? true, o.compteNotesDeFrais ?? '455000', mouvements, PLAN_PAR_DEFAUT)
    .map((l, i) => ecriture({ ...l, id: `${p.id}-${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
}

describe('agent-comptable / analyserEcritures en engagement (copie déployée)', () => {
  it('se tait sur une facture et son règlement tels que src/lib les génère', () => {
    const p = piece({ id: 'p1' })
    expect(memeResultat(brouillonEngagement(p, [paiement()]), [p], [], deployee, true, [paiement()], ENGAGEMENT)).toEqual({
      nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [],
    })
  })

  it('compte une facture pas encore réglée, sans la dire à régénérer', () => {
    const p = piece({ id: 'p1' })
    const r = memeResultat(brouillonEngagement(p, []), [p], [], deployee, true, [], ENGAGEMENT)
    expect(r.nbSansContrepartie).toBe(1)
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('voit un mouvement rapproché dont le règlement manque au brouillon', () => {
    // La dette resterait au 401 alors qu'elle est payée.
    const p = piece({ id: 'p1' })
    const r = memeResultat(brouillonEngagement(p, []), [p], [], deployee, true, [paiement()], ENGAGEMENT)
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit un règlement que plus rien ne rapproche', () => {
    const p = piece({ id: 'p1' })
    const r = memeResultat(brouillonEngagement(p, [paiement()]), [p], [], deployee, true, [], ENGAGEMENT)
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit des règlements sans leur facture', () => {
    const p = piece({ id: 'p1' })
    const reglementsSeuls = brouillonEngagement(p, [paiement()]).filter((e) => e.ligne_bancaire_id)
    const r = memeResultat(reglementsSeuls, [p], [], deployee, true, [paiement()], ENGAGEMENT)
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une facture restée à son ancienne date', () => {
    const genere = brouillonEngagement(piece({ id: 'p1' }), [paiement()])
    const r = memeResultat(genere, [piece({ id: 'p1', date_piece: '2025-03-12' })], [], deployee, true, [paiement()], ENGAGEMENT)
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('suit le compte des notes de frais du dossier', () => {
    const ndf = piece({ id: 'p1', type_piece: 'note_frais' })
    const au455 = brouillonEngagement(ndf, [])
    expect(memeResultat(au455, [ndf], [], deployee, true, [], ENGAGEMENT).piecesDesynchronisees).toEqual([])
    const autreCompte: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
    expect(memeResultat(au455, [ndf], [], deployee, true, [], autreCompte).piecesDesynchronisees).toEqual(['p1'])
  })

  it('passe une vente au 411, et un avoir au sens inverse', () => {
    const vente = piece({ id: 'p1', type_piece: 'vente' })
    const encaisse = paiement({ montant: 120 })
    expect(memeResultat(brouillonEngagement(vente, [encaisse]), [vente], [], deployee, true, [encaisse], ENGAGEMENT))
      .toEqual({ nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [] })
    const avoir = piece({ id: 'p1', montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    const rembourse = paiement({ montant: 120 })
    expect(memeResultat(brouillonEngagement(avoir, [rembourse]), [avoir], [], deployee, true, [rembourse], ENGAGEMENT))
      .toEqual({ nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [] })
  })

  it('accepte une facture réglée en partie : le reste court au 401', () => {
    const p = piece({ id: 'p1' })
    const acompte = paiement({ montant: -48 })
    expect(memeResultat(brouillonEngagement(p, [acompte]), [p], [], deployee, true, [acompte], ENGAGEMENT).piecesDesynchronisees)
      .toEqual([])
  })

  it('ne ventile pas la TVA d’un dossier exonéré', () => {
    const p = piece({ id: 'p1' })
    const exonere = brouillonEngagement(p, [], { assujettiTva: false })
    expect(memeResultat(exonere, [p], [], deployee, false, [], ENGAGEMENT).piecesDesynchronisees).toEqual([])
    expect(memeResultat(brouillonEngagement(p, []), [p], [], deployee, false, [], ENGAGEMENT).piecesDesynchronisees)
      .toEqual(['p1'])
  })

  it('voit une ligne de la facture qui ne porte plus son montant — cas défensif', () => {
    const p = piece({ id: 'p1' })
    for (const compte of ['401000', COMPTE_ACHATS]) {
      const lignes = brouillonEngagement(p, [paiement()])
      lignes.find((e) => e.compte === compte && !e.ligne_bancaire_id)!.montant = 110
      expect(memeResultat(lignes, [p], [], deployee, true, [paiement()], ENGAGEMENT).piecesDesynchronisees, compte)
        .toEqual(['p1'])
    }
  })

  it('juge chaque écriture seule : deux écarts qui se compensent dans le groupe restent un déséquilibre', () => {
    const p = piece({ id: 'p1' })
    const lignes = brouillonEngagement(p, [paiement()])
    // La ligne 401 de la facture et celle du règlement, faussées de 10 € en sens contraires : la
    // somme du groupe reste nulle, et chacune des deux écritures partirait fausse dans le FEC.
    const tiersFacture = lignes.find((e) => e.compte === '401000' && !e.ligne_bancaire_id)!
    const tiersReglement = lignes.find((e) => e.compte === '401000' && e.ligne_bancaire_id)!
    tiersFacture.montant = 110
    tiersReglement.montant = 110
    expect(lignes.reduce((s, e) => s + (e.sens === 'debit' ? e.montant : -e.montant), 0)).toBeCloseTo(0)
    const r = memeResultat(lignes, [p], [], deployee, true, [paiement()], ENGAGEMENT)
    expect(r.groupesDesequilibres).toEqual(['p1:10.00'])
  })

  it('lit le brouillon d’une trésorerie comme à régénérer en engagement, et l’inverse', () => {
    // C'est le modèle qui décide : la même écriture est juste dans l'un et périmée dans l'autre.
    const p = piece({ id: 'p1' })
    expect(memeResultat(groupeConforme('p1'), [p], [], deployee, true, [], ENGAGEMENT).piecesDesynchronisees).toEqual(['p1'])
    expect(memeResultat(brouillonEngagement(p, []), [p], [], deployee, true, [], TRESORERIE).piecesDesynchronisees).toEqual(['p1'])
  })
})

// LA BORNE : ce garde-fou sait-il encore échouer ?
//
// Sans elle, remplacer la copie déployée par la copie locale dans `memeResultat` laisse les dix cas
// ci-dessus parfaitement verts — le test comparerait `src/lib` à lui-même. C'est la panne que ce
// dépôt connaît sous plusieurs noms, et celle qui a laissé passer trois versions du scanner de
// lectures paginées : un contrôle qui ne voit plus rien ressemble exactement à un dépôt sain.
//
// On lui donne donc la VRAIE source déployée, amputée d'une seule des quatre comparaisons, et on
// exige qu'il s'en aperçoive. Défaut PLANTÉ, pas simulé : si la forme de la source change au point
// que l'amputation ne mord plus, l'extraction elle-même échouera d'abord.
// LE CÂBLAGE, que l'extraction ne voit pas : la copie est juste, encore faut-il que `points_a_traiter`
// lui passe le statut TVA et le MODÈLE COMPTABLE DU DOSSIER. Un `true` ou une trésorerie écrits en dur
// feraient signaler « à régénérer » toute écriture juste d'un dossier exonéré, ou d'un dossier en
// engagement — sur l'outil qui répond « quelles sont les anomalies ? ».
// LA NOTE DE FRAIS EN TRÉSORERIE S'ÉCRIT FACE AU COMPTE DE L'EXPLOITANT (108000) — `ligneContrepartieDirigeant`,
// src/lib/ecritures.ts. Sans cette règle, la copie dirait « à régénérer » pour toujours l'écriture juste d'une note de
// frais, et « en attente de rapprochement » une pièce qu'aucun paiement ne rapprochera. Les écritures viennent de
// la génération de src/lib : « conforme » veut dire ce qu'elle produit réellement.
function brouillonTresorerie(
  p: Piece, mouvements: LigneBancaire[], o: { assujettiTva?: boolean; compte?: string } = {},
): EcritureBrouillon[] {
  const paiementsPiece = paiementsDesPieces(mouvements, [], SANS_VIREMENT_MIXTE).get(p.id) ?? []
  return lignesPourPiece('d1', p, cible(o.compte ?? COMPTE_ACHATS), o.assujettiTva ?? true, paiementsPiece, TRESORERIE)
    .map((l, i) => ecriture({ ...l, id: `${p.id}-${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
}

const noteDeFrais = (o: Partial<Piece> = {}) => piece({ id: 'p1', type_piece: 'note_frais', ...o })

// #183 : la TVA d'une date complète sa charge, et les soldes de chaque date se comparent à la génération. Une écriture
// générée avec l'ancien arrondi est juste au total et fausse à chaque date : les deux copies la disent à régénérer.
describe('agent-comptable / le solde de chaque compte à chaque date (copie déployée)', () => {
  const p = piece({ id: 'p1', date_piece: '2025-03-01', montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 })
  const deux = [paiement({ id: 'l1', date: '2025-03-10', montant: -20 }), paiement({ id: 'l2', date: '2025-04-02', montant: -20 })]

  it('se tait sur l’écriture que la génération écrit, et dit à régénérer celle de l’ancien arrondi', () => {
    const juste = brouillonTresorerie(p, deux)
    expect(memeResultat(juste, [p], [], deployee, true, deux).piecesDesynchronisees).toEqual([])
    const ancienArrondi = juste.map((e) => e.compte !== COMPTE_TVA_DEDUCTIBLE ? e : { ...e, montant: e.date === '2025-03-10' ? 3.34 : 3.33 })
    expect(memeResultat(ancienArrondi, [p], [], deployee, true, deux).piecesDesynchronisees).toEqual(['p1'])
  })

  it('compare le solde de chaque compte, pas son découpage en lignes', () => {
    const coupee = brouillonTresorerie(p, deux).flatMap((e) => e.compte === COMPTE_ACHATS && e.date === '2025-03-10'
      ? [{ ...e, id: `${e.id}a`, montant: 10 }, { ...e, id: `${e.id}b`, montant: 6.67 }] : [e])
    expect(memeResultat(coupee, [p], [], deployee, true, deux).piecesDesynchronisees).toEqual([])
    // Deux lignes qui s'annulent, à une date qui n'en porte pas d'autre : aucun solde ne bouge.
    const annulees = [...brouillonTresorerie(p, deux), ecriture({ id: 'x1', piece_id: 'p1', date: '2025-03-20', montant: 5 }),
      ecriture({ id: 'x2', piece_id: 'p1', date: '2025-03-20', sens: 'credit', montant: 5 })]
    expect(memeResultat(annulees, [p], [], deployee, true, deux).piecesDesynchronisees).toEqual([])
  })
})
const rembourse = (montant: number) => paiement({ id: 'l1', piece_id: 'p1', date: '2025-04-02', montant })
const COMPTE_EXPLOITANT = '108000'
const RIEN = { nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [] }

describe('agent-comptable / la note de frais en trésorerie (copie déployée)', () => {
  it('accepte ce que la génération écrit : exonérée ou assujettie, remboursée ou non, en tout ou en partie', () => {
    const notes: [string, Piece, boolean][] = [
      ['exonérée', noteDeFrais({ montant_ht: null, montant_tva: null, montant_ttc: 40 }), false],
      ['assujettie, hors taxe lu', noteDeFrais(), true],
      ['assujettie, sans hors taxe', noteDeFrais({ montant_ht: null }), true],
      // Le hors taxe lu PRIME sur le TTC moins la TVA : un centime d'écart, que le total tolère, que la
      // contrepartie suit.
      ['assujettie, hors taxe à un centime du TTC moins la TVA', noteDeFrais({ montant_ht: 100.01 }), true],
      ['négative — un trop-perçu rendu', noteDeFrais({ montant_ht: null, montant_tva: null, montant_ttc: -30 }), false],
    ]
    for (const [nom, p, assujettiTva] of notes) {
      // Le remboursement va dans l'autre sens que la note : un décaissement pour une note positive, un encaissement
      // pour un trop-perçu que le dirigeant rend.
      const ttc = p.montant_ttc!
      for (const [quoi, mouvements] of [['sans paiement', []], ['à moitié', [rembourse(-ttc / 2)]], ['en entier', [rembourse(-ttc)]]] as const) {
        expect(memeResultat(brouillonTresorerie(p, [...mouvements], { assujettiTva }), [p], [], deployee, assujettiTva, [...mouvements]), `${nom}, remboursée ${quoi}`)
          .toEqual(RIEN)
      }
    }
  })

  it('l’écriture d’avant, sans sa contrepartie, est à régénérer — pas « en attente de rapprochement »', () => {
    const p = noteDeFrais()
    const charge = brouillonTresorerie(p, []).filter((e) => e.compte !== COMPTE_EXPLOITANT)
    expect(memeResultat(charge, [p])).toEqual({ ...RIEN, piecesDesynchronisees: ['p1'] })
  })

  it('une contrepartie d’un autre montant est à régénérer, et l’écriture déséquilibrée', () => {
    const p = noteDeFrais()
    const ecritures = brouillonTresorerie(p, []).map((e) => e.compte === COMPTE_EXPLOITANT ? { ...e, montant: 115 } : e)
    expect(memeResultat(ecritures, [p])).toEqual({ nbSansContrepartie: 0, groupesDesequilibres: ['p1:5.00'], piecesDesynchronisees: ['p1'] })
  })

  it('une contrepartie restée après un remboursement rapproché est à régénérer', () => {
    const p = noteDeFrais()
    const avant = brouillonTresorerie(p, []).find((e) => e.compte === COMPTE_EXPLOITANT)!
    const ecritures = [...brouillonTresorerie(p, [rembourse(-120)]), { ...avant, id: 'reste' }]
    expect(memeResultat(ecritures, [p], [], deployee, true, [rembourse(-120)]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('une contrepartie à une autre date est à régénérer — sauf sur une pièce sans date', () => {
    const decalee = (p: Piece) => brouillonTresorerie(p, []).map((e) => e.compte === COMPTE_EXPLOITANT ? { ...e, date: '2025-03-11' } : e)
    expect(memeResultat(decalee(noteDeFrais()), [noteDeFrais()]).piecesDesynchronisees).toEqual(['p1'])
    const sansDate = noteDeFrais({ date_piece: null })
    expect(memeResultat(decalee(sansDate), [sansDate]).piecesDesynchronisees).toEqual([])
  })

  it('hors du jeu fourni, une ligne au 108000 ne passe pas pour une contrepartie', () => {
    const r = memeResultat(brouillonTresorerie(noteDeFrais(), []), [])
    expect(r).toEqual({ ...RIEN, nbSansContrepartie: 1 })
  })

  it('rangée dans une catégorie au compte de l’exploitant, elle suit la règle de toute pièce, comme un achat', () => {
    for (const type_piece of ['note_frais', 'achat'] as const) {
      const p = piece({ id: 'p1', type_piece, categorie_id: 'cat-108' })
      expect(memeResultat(brouillonTresorerie(p, [], { compte: COMPTE_EXPLOITANT }), [p]), type_piece)
        .toEqual({ ...RIEN, nbSansContrepartie: 1 })
      expect(memeResultat(brouillonTresorerie(p, [rembourse(-120)], { compte: COMPTE_EXPLOITANT }), [p], [], deployee, true, [rembourse(-120)]), `${type_piece} payée`)
        .toEqual(RIEN)
    }
  })

  // Le garde symétrique : en engagement, la dette au dirigeant passe déjà par le compte choisi pour le dossier, et
  // une note de frais sans règlement y reste une facture qui attend le sien.
  it('en engagement, rien ne change : une note de frais sans règlement attend le sien', () => {
    const p = noteDeFrais()
    expect(memeResultat(brouillonEngagement(p, []), [p], [], deployee, true, [], ENGAGEMENT)).toEqual({ ...RIEN, nbSansContrepartie: 1 })
  })
})

// LES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (étape VF9b, chantier EC-Q3, ligne 28.65) : l'exemplaire d'une facture
// source ne compte nulle part, et le virement mixte date l'exemplaire unique d'une facture d'avant — dans les deux
// modèles, comme src/lib. Les ventes sont celles du cas : `memeResultat` les compare seules.
describe('agent-comptable / les ventes facturées (copie déployée, étape VF9b)', () => {
  const sourcesDe = (...ids: string[]): VentesDuCas => ({ factures: ids.map((id) => factureDuCas({ id, numero: id.toUpperCase() })), encaissements: [] })

  // Sans ce témoin, des régimes qui ne déclencheraient rien laisseraient les deux copies « d'accord » sur du vide.
  it('la batterie des régimes exerce bien ce qui décide : un exemplaire écarté, un exemplaire qui compte, un virement mixte qui paie', () => {
    const v = piece({ id: 'pv', type_piece: 'vente' })
    const [sans, sources, pasSource, mixte] = REGIMES.map((r) => entreesDesVentes(r.appliquer([v], []), VENTES_DE_SRC_LIB))
    expect([...sans.sources, ...sans.exemplaires, ...sans.encaissees]).toEqual([])
    expect([...sources.sources]).toEqual(['fs-pv'])
    expect([...sources.exemplaires]).toEqual(['pv'])
    expect([...pasSource.sources, ...pasSource.exemplaires, ...pasSource.encaissees]).toEqual([])
    expect([...mixte.sources]).toEqual(['fs-mixte'])
    expect([...mixte.exemplaires]).toEqual([])
    expect(mixte.encaissees).toEqual([{ ligne_bancaire_id: 'vm-pv', piece_id: 'pv', montant: 120 }])
    // Une pièce qui n'est pas de vente n'est l'exemplaire unique de rien : le virement mixte ne la paie pas.
    expect(entreesDesVentes(REGIMES[3].appliquer([piece({ id: 'pa' })], []), VENTES_DE_SRC_LIB).encaissees).toEqual([])
  })

  it('écarte l’exemplaire d’une facture source : ni sans contrepartie, ni déséquilibré, ni à régénérer — celui d’une autre facture compte', () => {
    // p1 : une écriture sans banque (« en attente de rapprochement ») ; p2 : payée, sur un autre compte et déséquilibrée
    // (« à régénérer », « déséquilibrée ») ; p3 : une pièce ordinaire, qui garde son point.
    const ecritures = [
      ...groupeConforme('p1', { banque: false }),
      ...groupeConforme('p2', { compte: '628000' }), ecriture({ id: 'x', piece_id: 'p2', montant: 5 }),
      ...groupeConforme('p3', { banque: false }),
    ]
    const pieces = [piece({ id: 'p1', facture_id: 'fs1' }), piece({ id: 'p2', facture_id: 'fs2' }), piece({ id: 'p3' })]
    const payes = [payee('p2')]
    // Sans facture source, les trois comptent.
    expect(memeResultat(ecritures, pieces, [], deployee, true, payes, TRESORERIE, [], null, sourcesDe())).toEqual({
      nbSansContrepartie: 2, groupesDesequilibres: ['p2:5.00'], piecesDesynchronisees: ['p2'],
    })
    // Exemplaires de deux factures sources, p1 et p2 ne comptent plus.
    expect(memeResultat(ecritures, pieces, [], deployee, true, payes, TRESORERIE, [], null, sourcesDe('fs1', 'fs2'))).toEqual({
      nbSansContrepartie: 1, groupesDesequilibres: [], piecesDesynchronisees: [],
    })
    // L'exemplaire d'une facture qui n'est pas source, et celui d'un brouillon (jamais source), comptent comme hier.
    const pasSources: VentesDuCas = {
      factures: [factureDuCas({ id: 'fs1', statut: 'brouillon' }), factureDuCas({ id: 'fs2', source_de_la_vente: false })], encaissements: [],
    }
    expect(memeResultat(ecritures, pieces, [], deployee, true, payes, TRESORERIE, [], null, pasSources)).toEqual({
      nbSansContrepartie: 2, groupesDesequilibres: ['p2:5.00'], piecesDesynchronisees: ['p2'],
    })
  })

  it('date l’exemplaire d’une facture d’avant par le virement mixte qui le paie, en trésorerie comme en engagement', () => {
    const v = piece({ id: 'pv', type_piece: 'vente', facture_id: 'fa1' })
    const credit = paiement({ id: 'vm', piece_id: null, date: '2025-04-20', montant: 300, encaissements_de_factures: true })
    const ventes: VentesDuCas = {
      factures: [factureDuCas({ id: 'fs1' }), factureDuCas({ id: 'fa1', numero: 'F2024-0099', source_de_la_vente: false })],
      encaissements: [
        encaissementDuCas({ id: 'es', facture_id: 'fs1', montant: 180, ligne_bancaire_id: 'vm' }),
        encaissementDuCas({ id: 'ea', facture_id: 'fa1', montant: 120, ligne_bancaire_id: 'vm' }),
      ],
    }
    const parts = partsEncaissees('d1', ventes.encaissements, ventes, [{ id: 'pv', dossier_id: 'd1', facture_id: 'fa1', statut: 'validee', type_piece: 'vente' }])
    expect(parts).toEqual([{ ligne_bancaire_id: 'vm', piece_id: 'pv', montant: 120 }])
    for (const modele of [TRESORERIE, ENGAGEMENT]) {
      const juste = lignesPourPiece('d1', v, cible(COMPTE_ACHATS), true, paiementsDesPieces([credit], [], parts).get('pv') ?? [], modele)
        .map((l, i) => ecriture({ ...l, id: `v${i}`, piece_id: 'pv', ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
      expect(juste.some((e) => e.ligne_bancaire_id === 'vm' && e.date === '2025-04-20'), modele.mode).toBe(true)
      // Payée par le virement mixte, son écriture datée du crédit est juste…
      expect(memeResultat(juste, [v], [], deployee, true, [credit], modele, [], null, ventes), modele.mode).toEqual(RIEN)
      // … et sans le registre, la même écriture est à régénérer : la pièce retomberait sans paiement.
      expect(memeResultat(juste, [v], [], deployee, true, [credit], modele, [], null, { ...ventes, encaissements: [] }).piecesDesynchronisees, modele.mode)
        .toEqual(['pv'])
      // Seulement réservé à ses encaissements, le crédit ne date rien.
      const reserve = paiement({ ...credit, statut: 'non_rapprochee', encaissements_de_factures: false })
      expect(memeResultat(juste, [v], [], deployee, true, [reserve], modele, [], null, ventes).piecesDesynchronisees, modele.mode).toEqual(['pv'])
    }
  })
})

// LE GÉNÉRATEUR DE LA COPIE (04/10/2026, ligne 26.6, étape d). Une pièce que la frontière de validation coupe se juge
// sur sa part OUVERTE, ligne pour ligne contre ce que la génération produirait aujourd'hui : la copie porte donc tout
// le générateur de src/lib — trésorerie, note de frais face au 108000, engagement, biens —, et il doit rendre les
// MÊMES lignes, au centime, date, compte, sens et mouvement compris. Le libellé, le dossier et le statut ne sont pas
// comparés : aucun contrôle ne les lit.
type LigneComparee = Pick<LigneAGenerer, 'date' | 'compte' | 'sens' | 'montant' | 'ligne_bancaire_id'>
const projeter = (lignes: readonly LigneComparee[]) =>
  lignes.map((l) => `${l.date}|${l.compte}|${l.sens}|${l.montant}|${l.ligne_bancaire_id ?? ''}`).sort()

// La batterie : des pièces qui exercent chaque branche (hors taxe lu ou non, TVA nulle ou absente, avoirs, ventes,
// notes de frais, pièces sans date datées par leur dépôt), sur chaque cible, payées de chaque façon (rien, en entier
// le jour même ou plus tard, à moitié, en trois fois — l'arrondi du dernier morceau —, sous l'écart d'alignement, par
// la part d'un virement groupé, à zéro euro, au-delà du montant), dans chaque modèle et chaque statut de TVA.
function batterieDuGenerateur(copie: typeof deployee): string[][] {
  const pieces: Piece[] = [
    piece({}),
    piece({ montant_ht: null }),
    piece({ montant_ht: 100.01 }),
    piece({ montant_ht: null, montant_tva: null }),
    piece({ montant_ht: 120, montant_tva: 0 }),
    // 40 € TTC dont 6,67 de TVA : payée à moitié, la charge et la TVA arrondies chacune de son côté ajoutaient un centime
    // à une date. La TVA d'une date complète sa charge.
    piece({ montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 }),
    // Une TVA d'un centime : payée en trois fois, ses deux premières parts s'arrondissent à zéro et ne font pas de ligne.
    piece({ montant_ht: 0.09, montant_tva: 0.01, montant_ttc: 0.1 }),
    piece({ montant_ht: -50, montant_tva: -10, montant_ttc: -60 }),
    piece({ type_piece: 'vente', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 }),
    piece({ type_piece: 'vente', montant_ht: -100, montant_tva: -20, montant_ttc: -120 }),
    piece({ type_piece: 'note_frais' }),
    piece({ type_piece: 'note_frais', montant_ht: null, montant_tva: null, montant_ttc: -30 }),
    piece({ date_piece: null, created_at: '2025-03-15T09:00:00Z' }),
    piece({ type_piece: 'note_frais', date_piece: null, created_at: '2025-03-15T09:00:00Z' }),
    // Une note de frais à zéro euro — cas défensif : rien ne la solde, donc aucune contrepartie au 108000, et aucune
    // ligne nulle, que la base refuserait.
    piece({ type_piece: 'note_frais', montant_ht: null, montant_tva: null, montant_ttc: 0 }),
    // Un hors taxe lu à zéro : la charge nulle ne s'écrit pas, la TVA si.
    piece({ montant_ht: 0, montant_tva: 20, montant_ttc: 20 }),
  ]
  const cibles = [cible(COMPTE_ACHATS), bien('218300'), cible('108000'), cible('706000')]
  const modeles: ModeleComptable[] = [
    TRESORERIE, ENGAGEMENT, { mode: 'engagement', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }, { mode: 'engagement', compteNotesDeFrais: '467000', plan: PLAN_PAR_DEFAUT },
  ]
  const sorties: string[][] = []
  for (const p of pieces) {
    // Un paiement va dans l'autre sens que la pièce : une sortie pour un achat, une entrée pour une vente.
    const signe = p.type_piece === 'vente' ? 1 : -1
    const ttc = p.montant_ttc!
    const part = (f: number) => Math.round(signe * ttc * f * 100) / 100
    const reglements: [LigneBancaire[], PartReglee[], PartEncaissee[]][] = [
      [[], [], []],
      [[paiement({ id: 'l1', date: '2025-03-10', montant: part(1) })], [], []],
      [[paiement({ id: 'l1', date: '2025-04-02', montant: part(1) })], [], []],
      [[paiement({ id: 'l1', date: '2025-04-02', montant: part(0.5) })], [], []],
      [[paiement({ id: 'l1', date: '2025-04-02', montant: part(1 / 3) }), paiement({ id: 'l2', date: '2025-05-02', montant: part(1 / 3) })], [], []],
      [[paiement({ id: 'l1', date: '2025-04-02', montant: part(1) - signe * 1 })], [], []],
      [[paiement({ id: 'g', piece_id: null, date: '2025-04-15', montant: part(1) - signe * 50, reglement_groupe: true })],
        [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: part(1) }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -signe * 50 }], []],
      [[paiement({ id: 'l1', date: '2025-04-02', montant: 0 })], [], []],
      [[paiement({ id: 'l1', date: '2025-04-02', montant: part(1.1) })], [], []],
      // LE VIREMENT MIXTE (étape VF9b) : le crédit classé par ses encaissements paie la pièce au montant de l'encaissement
      // de sa facture d'avant, seul ou après un acompte rapproché ; seulement réservé, il ne paie rien.
      [[paiement({ id: 'vm', piece_id: null, date: '2025-04-20', montant: part(1) + signe * 80, encaissements_de_factures: true })], [],
        [{ ligne_bancaire_id: 'vm', piece_id: 'p1', montant: part(1) }]],
      [[paiement({ id: 'l1', date: '2025-03-10', montant: part(0.5) }),
        paiement({ id: 'vm', piece_id: null, date: '2025-04-20', montant: part(0.5) + signe * 80, encaissements_de_factures: true })], [],
      [{ ligne_bancaire_id: 'vm', piece_id: 'p1', montant: part(0.5) }]],
      [[paiement({ id: 'vm', piece_id: null, date: '2025-04-20', montant: part(1), statut: 'non_rapprochee' })], [],
        [{ ligne_bancaire_id: 'vm', piece_id: 'p1', montant: part(1) }]],
    ]
    for (const c of cibles) {
      for (const [mouvements, parts, encaissees] of reglements) {
        const paiementsPiece = paiementsDesPieces(mouvements, parts, encaissees).get(p.id) ?? []
        // Les paiements de la pièce, chaque copie les tirant du même relevé : ils datent tout ce qui suit.
        expect(copie.paiementsDesPieces(mouvements, parts, encaissees).get(p.id) ?? [], 'paiementsDesPieces a dérivé').toEqual(paiementsPiece)
        for (const modele of modeles) {
          for (const assujettiTva of [true, false]) {
            const ici = projeter(lignesPourPiece('d1', p, c, assujettiTva, paiementsPiece, modele))
            const la = projeter(copie.lignesPourPiece(p, c, assujettiTva, paiementsPiece, modele))
            expect(la, `lignesPourPiece a dérivé : ${JSON.stringify({ piece: p, cible: c, paiementsPiece, modele, assujettiTva })}`).toEqual(ici)
            sorties.push(ici)
          }
        }
      }
    }
  }
  return sorties
}

describe('agent-comptable / le générateur (copie déployée)', () => {
  it('produit les mêmes lignes que src/lib, au centime, sur toute la batterie', () => {
    const sorties = batterieDuGenerateur(deployee)
    // La batterie exerce bien ce qui décide : chaque compte de tiers et de contrepartie, la TVA d'un bien, une pièce
    // répartie sur trois dates, et le dépôt qui date une pièce sans date.
    const comptes = new Set(sorties.flat().map((l) => l.split('|')[1]))
    for (const compte of ['401000', '404000', '411000', '455000', '467000', '108000', '445620', '445660', '445710', COMPTE_BANQUE]) {
      expect(comptes, `aucune ligne au ${compte} : la batterie n'exerce plus cette branche`).toContain(compte)
    }
    expect(sorties.some((lignes) => new Set(lignes.map((l) => l.split('|')[0])).size >= 3), 'aucune pièce sur trois dates').toBe(true)
    expect(sorties.some((lignes) => lignes.some((l) => l.startsWith('2025-03-15|'))), 'aucune ligne datée du dépôt').toBe(true)
    // Et le virement mixte (étape VF9b) : une ligne datée du crédit classé par ses encaissements, qui le désigne.
    expect(sorties.some((lignes) => lignes.some((l) => l.startsWith('2025-04-20|') && l.endsWith('|vm'))), 'aucune ligne du virement mixte').toBe(true)
  })

  // `montantRetenu` n'est appelé, dans la copie, que sur une pièce dont la TVA se ventile — d'un dossier assujetti :
  // sa branche exonérée n'y sert pas aujourd'hui, et la batterie ne peut pas la voir. Elle est gardée à l'unité : la
  // copie doit rester celle de src/lib pour le jour où un appelant s'en servira.
  it('retient le même montant que src/lib, dossier assujetti ou exonéré', () => {
    const montants: Pick<Piece, 'montant_ht' | 'montant_tva' | 'montant_ttc'>[] = [
      { montant_ht: 100, montant_tva: 20, montant_ttc: 120 },
      { montant_ht: null, montant_tva: 20, montant_ttc: 120 },
      { montant_ht: 100.01, montant_tva: 20, montant_ttc: 120 },
      { montant_ht: 100, montant_tva: 20, montant_ttc: null },
      { montant_ht: 100, montant_tva: null, montant_ttc: null },
      { montant_ht: null, montant_tva: null, montant_ttc: 120 },
      { montant_ht: null, montant_tva: null, montant_ttc: null },
      { montant_ht: 0.07, montant_tva: 0.14, montant_ttc: null },
      { montant_ht: null, montant_tva: 0.14, montant_ttc: 0.35 },
    ]
    for (const m of montants) {
      for (const assujettiTva of [true, false]) {
        expect(deployee.montantRetenu(m, assujettiTva), JSON.stringify({ m, assujettiTva })).toBe(montantRetenu(m, assujettiTva))
      }
    }
    // La batterie exerce bien les deux branches : le hors taxe lu, et l'arrondi du hors taxe plus la TVA.
    expect(montantRetenu({ montant_ht: 0.07, montant_tva: 0.14, montant_ttc: null }, false)).toBe(0.21)
  })

  it('date les lignes d’une pièce sans date de son dépôt À PARIS, quel que soit le fuseau qui l’exécute', () => {
    // Déposée le 31 décembre 2025 à 23 h 30 UTC : le 1er janvier 2026 à Paris. Toutes ses lignes, la charge, la
    // TVA, la contrepartie d'une note de frais au 108000 et la facture en engagement, portent ce jour-là.
    const instant = '2025-12-31T23:30:00Z'
    const cas: [Piece, ModeleComptable][] = [
      [piece({ date_piece: null, created_at: instant }), TRESORERIE],
      [piece({ date_piece: null, created_at: instant }), ENGAGEMENT],
      [piece({ type_piece: 'note_frais', date_piece: null, created_at: instant }), TRESORERIE],
    ]
    for (const [p, modele] of cas) {
      const lignes = deployee.lignesPourPiece(p, cible(COMPTE_ACHATS), true, [], modele)
      expect(lignes.length, `${p.type_piece} en ${modele.mode}`).toBeGreaterThanOrEqual(2)
      expect([...new Set(lignes.map((l) => l.date))], `${p.type_piece} en ${modele.mode}`).toEqual(['2026-01-01'])
    }
  })

  // Le repli d'une pièce sans date : son dépôt, À PARIS. Une Edge Function tourne en UTC ; le navigateur, lui, lit
  // le dépôt dans son fuseau (`dateLocaleDe`) — l'écart, entre minuit et deux heures du matin ailleurs qu'à Paris,
  // est dit dans la copie.
  it('date un dépôt à Paris, heure d’hiver comme d’été', () => {
    const table: [string, string][] = [
      ['2025-12-31T23:30:00Z', '2026-01-01'],
      ['2025-12-31T22:59:59Z', '2025-12-31'],
      ['2025-06-30T22:30:00Z', '2025-07-01'],
      ['2025-06-30T21:59:00Z', '2025-06-30'],
      ['2025-03-10T09:00:00Z', '2025-03-10'],
    ]
    for (const [instant, date] of table) {
      expect(deployee.dateDuDepot(instant), instant).toBe(date)
      expect(dateAParis(instant), instant).toBe(date)
    }
  })
})

// LA FRONTIÈRE DE VALIDATION (bloc VALIDATION) : les deux fonctions que tous les contrôles de la copie partagent. Une
// table écrite ici, extérieure aux deux copies.
describe('agent-comptable / la frontière de validation (copie déployée)', () => {
  it('tire la frontière du dernier exercice validé, et fige ce qui la précède, ce jour compris', () => {
    const frontieres: [number[], string | null][] = [[[], null], [[2024], '2024-12-31'], [[2023, 2025, 2024], '2025-12-31']]
    for (const [annees, frontiere] of frontieres) {
      expect(deployee.frontiereDeValidation(annees), String(annees)).toBe(frontiere)
      expect(frontiereDeValidation(annees), String(annees)).toBe(frontiere)
    }
    const figees: [string, string | null, boolean][] = [
      ['2025-12-31', '2025-12-31', true], ['2026-01-01', '2025-12-31', false], ['2024-06-30', '2025-12-31', true], ['2025-01-01', null, false],
    ]
    for (const [date, frontiere, figee] of figees) {
      expect(deployee.estFigee(date, frontiere), `${date} sous ${frontiere}`).toBe(figee)
      expect(estFigee(date, frontiere), `${date} sous ${frontiere}`).toBe(figee)
    }
  })
})

// Ce que la génération de src/lib écrit pour une pièce, dans un modèle : « conforme » veut dire ce qu'elle produit.
function brouillon(
  p: Piece, c: CibleComptable, mouvements: LigneBancaire[], modele: ModeleComptable, prefixe: string = p.id,
): EcritureBrouillon[] {
  const paiementsPiece = paiementsDesPieces(mouvements, [], SANS_VIREMENT_MIXTE).get(p.id) ?? []
  return lignesPourPiece('d1', p, c, true, paiementsPiece, modele)
    .map((l, i) => ecriture({ ...l, id: `${prefixe}-${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
}

// UNE PIÈCE QUE LA FRONTIÈRE COUPE NE SE JUGE QUE SUR SA PART OUVERTE. La comparer entière ferait dire « à
// régénérer », à jamais, d'une pièce dont la catégorie a changé de compte depuis la validation — sur un geste que la
// base refuse —, pendant que la Checklist se tait.
describe('agent-comptable / analyserEcritures sous une frontière de validation (copie déployée)', () => {
  const recategorisee = () => piece({ categorie_id: 'cat-autre' })
  const enDeuxFois = [paiement({ id: 'l1', date: '2025-03-10', montant: -60 }), paiement({ id: 'l2', date: '2025-04-02', montant: -60 })]

  it('se tait sur une pièce figée dont la catégorie a changé de compte depuis la validation', () => {
    const avant = brouillon(piece({}), cible(COMPTE_ACHATS), [payee('p1')], TRESORERIE)
    expect(memeResultat(avant, [recategorisee()], [], deployee, true, [payee('p1')], TRESORERIE, [], '2025-12-31').piecesDesynchronisees)
      .toEqual([])
    // Sans validation, la même pièce est à régénérer.
    expect(memeResultat(avant, [recategorisee()], [], deployee, true, [payee('p1')]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('accepte une part ouverte régénérée sur le nouveau compte à côté d’une part figée restée sur l’ancien', () => {
    const avant = brouillon(piece({}), cible(COMPTE_ACHATS), enDeuxFois, TRESORERIE, 'v')
    const apres = brouillon(recategorisee(), cible('628000'), enDeuxFois, TRESORERIE, 'n')
    const regeneree = [...avant.filter((e) => e.date <= '2025-03-31'), ...apres.filter((e) => e.date > '2025-03-31')]
    expect(memeResultat(regeneree, [recategorisee()], [], deployee, true, enDeuxFois, TRESORERIE, [], '2025-03-31'))
      .toEqual({ nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [] })
    // La part ouverte restée sur l'ancien compte, elle, est à régénérer…
    expect(memeResultat(avant, [recategorisee()], [], deployee, true, enDeuxFois, TRESORERIE, [], '2025-03-31').piecesDesynchronisees)
      .toEqual(['p1'])
    // … et sans validation, c'est la pièce entière qui l'est.
    expect(memeResultat(regeneree, [recategorisee()], [], deployee, true, enDeuxFois).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit dans la part ouverte une contrepartie qui désigne un autre mouvement, aux mêmes date et montant', () => {
    const lignes = brouillon(piece({}), cible(COMPTE_ACHATS), enDeuxFois, TRESORERIE)
      .map((e) => (e.ligne_bancaire_id === 'l2' ? { ...e, ligne_bancaire_id: 'l-autre' } : e))
    expect(memeResultat(lignes, [piece({})], [], deployee, true, enDeuxFois, TRESORERIE, [], '2025-03-31').piecesDesynchronisees)
      .toEqual(['p1'])
  })

  it('coupe une pièce par ce qu’elle devrait porter, pas seulement par ce qu’elle porte', () => {
    // L'écriture générée quand la pièce était datée du 20 avril, ouverte ; sa date effacée depuis, elle se rattache à
    // son dépôt du 15 mars, figé. Coupée, elle se juge sur sa part ouverte — l'écriture d'avril, que plus rien ne
    // justifie. Sans validation, une pièce sans date ne compare pas ses dates.
    const sansDate = piece({ date_piece: null, created_at: '2025-03-15T09:00:00Z' })
    const avril = brouillon(piece({ date_piece: '2025-04-20' }), cible(COMPTE_ACHATS), [], TRESORERIE)
    expect(memeResultat(avril, [sansDate], [], deployee, true, [], TRESORERIE, [], '2025-03-31').piecesDesynchronisees).toEqual(['p1'])
    expect(memeResultat(avril, [sansDate]).piecesDesynchronisees).toEqual([])
  })

  it('ne dit pas « à régénérer » une pièce coupée qui n’a encore aucune écriture : elle est à générer', () => {
    expect(memeResultat([], [piece({})], [], deployee, true, [payee('p1')], TRESORERIE, [], '2025-03-10')).toEqual(RIEN)
    // Coupée en partie — payée de part et d'autre de la frontière —, elle attend une part ouverte qu'aucune ligne ne
    // porte encore : c'est la génération qui la prend, pas « Régénérer ».
    expect(memeResultat([], [piece({})], [], deployee, true, enDeuxFois, TRESORERIE, [], '2025-03-31')).toEqual(RIEN)
  })

  it('en engagement, une facture figée garde son compte, et le règlement ouvert se compare', () => {
    const regle = [paiement({ id: 'l2', date: '2025-04-02', montant: -120 })]
    const avant = brouillon(piece({}), cible(COMPTE_ACHATS), regle, ENGAGEMENT)
    expect(memeResultat(avant, [recategorisee()], [], deployee, true, regle, ENGAGEMENT, [], '2025-03-31').piecesDesynchronisees)
      .toEqual([])
    expect(memeResultat(avant, [recategorisee()], [], deployee, true, regle, ENGAGEMENT).piecesDesynchronisees).toEqual(['p1'])
    // Le règlement ouvert manque : à régénérer, même sous une facture figée.
    const sansReglement = avant.filter((e) => !e.ligne_bancaire_id)
    expect(memeResultat(sansReglement, [recategorisee()], [], deployee, true, regle, ENGAGEMENT, [], '2025-03-31').piecesDesynchronisees)
      .toEqual(['p1'])
  })
})

// LE STATUT DE TVA DU DOSSIER (ligne 28.5, étape a) : redevable, franchise, exonéré — ou à préciser. L'assistant le lit,
// le rend dans resume_dossier, le réclame dans points_a_traiter comme la Checklist, et la consigne lui dit ce qu'il
// emporte. Sans lui, il prendrait une franchise pour une exonération, ou devinerait un statut que personne n'a choisi.
describe('agent-comptable / le statut de TVA du dossier', () => {
  it('le lit, le rend dans resume_dossier, le réclame à préciser, et la consigne dit ce qu’il emporte', () => {
    const source = sourceDeployee()
    expect(source).toMatch(/statut_tva: dossierRow\.statut_tva,\s*article_exoneration: dossierRow\.article_exoneration,/)
    expect(source).toMatch(/nom: dossier\.nom,\s*statut_tva: dossier\.statut_tva,\s*article_exoneration: dossier\.article_exoneration,/)
    expect(source).toContain('statut_de_tva_a_preciser: dossier.statut_tva == null,')
    expect(source).toContain("Un statut null est À PRÉCISER : ne le devine pas, il se règle dans l'onglet TVA.")
  })
})

describe('agent-comptable / points_a_traiter passe le statut TVA et le modèle comptable du dossier', () => {
  it('appelle analyserEcritures avec dossier.assujetti_tva, les paiements des pièces — virements mixtes compris —, le modèle du dossier, la frontière de validation et les exemplaires des factures sources', () => {
    expect(sourceDeployee()).toMatch(
      /const modele = modeleDuDossier\(dossier\)\n\s*const paiements = paiementsDesPieces\(rReleve\.lignes, rReglements\.lignes, encaissees\)\n(?:\s*\/\/[^\n]*\n)*\s*const frontiere = frontiereDeValidation\(rValides\.lignes\.map\(\(v\) => v\.annee\)\)\n\s*const \{ piecesSansContrepartie, groupesDesequilibres, piecesDesynchronisees \} = analyserEcritures\(ecrituresTyped, aComptabiliser, dossier\.assujetti_tva, paiements, modele, frontiere, exemplaires\)/,
    )
  })

  // LES VENTES FACTURÉES (étape VF9b, chantier EC-Q3, ligne 28.65), comme la Checklist (lib/pointsDeLaChecklist.ts) : les
  // factures sources tirées des factures du dossier, les exemplaires tirés des pièces validées, les parts des virements
  // mixtes tirées du registre, et la liste à comptabiliser sans l'exemplaire d'une facture source.
  it('tire les factures sources, les exemplaires et les parts des virements mixtes, et les passe au générateur', () => {
    const source = sourceDeployee()
    const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))
    expect(corps).toContain('    const sources = facturesSourcesDe(rFactures.lignes)\n')
    expect(corps).toContain('    const exemplaires = exemplairesDesSources(piecesTyped, sources)\n')
    expect(corps).toContain('    const piecesQuiComptent = horsDesExemplairesDesSources(piecesTyped, sources)\n')
    // Les pièces désignées, des validées seules — l'exemplaire unique d'une facture d'avant est une pièce validée —, au
    // dossier et au statut de leur lecture.
    expect(corps).toContain('    const designees: ExemplaireRow[] = piecesTyped\n      .filter((p) => p.facture_id != null)\n      .map((p) => ({ id: p.id, dossier_id: dossierId, facture_id: p.facture_id, statut: "validee", type_piece: p.type_piece }))\n')
    expect(corps).toContain('    const encaissees = partsEncaissees(dossierId, rEncaissements.lignes, { factures: rFactures.lignes }, designees)\n')
    expect(corps).toContain('    const aComptabiliser = piecesAComptabiliser(piecesTyped, categoriesTyped, acquisitions, sources)\n')
  })

  // Un dossier qui n'a pas basculé ne lit rien de plus : ses factures et son registre ne se lisent que si la source de ses
  // ventes n'est pas LUE fausse (`lireLesVentes`), et derrière le refus de VF9a, qui reste le premier geste de l'outil.
  it('lit les factures et le registre des encaissements d’un dossier qui les lit seulement, sous le même refus de lecture partielle — jamais le client d’une facture', () => {
    const source = sourceDeployee()
    const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))
    expect(corps).toMatch(/\n    const lireLesVentes = ventes !== null\n(?:\s*\/\/[^\n]*\n)*\s*if \(ventes\) \{\n      return \{ erreur: `\$\{ventes\.constat\}\. L'assistant ne lit pas encore les ventes facturées/)
    expect(corps.indexOf('    if (ventes) {\n')).toBeLessThan(corps.indexOf('await Promise.all(['))
    expect(corps).toContain('      lireLesVentes\n        ? lireTout<FactureRow>((d, f) =>\n          admin.from("factures_emises").select("id, statut, numero, source_de_la_vente", { count: "exact" }).eq("dossier_id", dossierId).order("id").range(d, f))\n        : rienALire<FactureRow>(),\n')
    expect(corps).toContain('      lireLesVentes\n        ? lireTout<EncaissementRow>((d, f) =>\n          admin.from("encaissements_factures").select("id, dossier_id, facture_id, montant, ligne_bancaire_id, annule_id, retire_le", { count: "exact" }).eq("dossier_id", dossierId).order("id").range(d, f))\n        : rienALire<EncaissementRow>(),\n')
    // Le client d'une facture nommerait un patient (RGPD.md, § 8.7) : aucune lecture de l'outil ne le demande.
    expect(corps.match(/\.select\("[^"]*"/g)?.filter((s) => s.includes('tiers_nom')) ?? []).toEqual([])
    // Rien à lire, c'est une lecture complète et vide — jamais une lecture ratée prise pour un vide.
    expect(source).toContain('function rienALire<T>(): Promise<LectureComplete<T>> {\n  return Promise.resolve({ lignes: [], complete: true, motif: null })\n}\n')
  })

  it('lit le modèle comptable du dossier, le passe aux outils et le dit au modèle', () => {
    const source = sourceDeployee()
    expect(source).toMatch(/\.from\("dossiers"\)\s*\.select\("nom, assujetti_tva, cabinet_id, mode_comptable, compte_notes_de_frais, tva_periodicite, statut_tva, article_exoneration, ventes_par_les_factures, ventes_par_les_factures_depuis"\)/)
    expect(source).toMatch(/mode_comptable: dossierRow\.mode_comptable,\s*compte_notes_de_frais: dossierRow\.compte_notes_de_frais,/)
    expect(source).toMatch(/const repereModele = dossierRow\.mode_comptable === "engagement"/)
    expect(source).toContain('- Modèle comptable du dossier : ${repereModele}')
  })

  it('nomme les factures sans règlement en engagement, comme la Checklist', () => {
    expect(sourceDeployee()).toMatch(
      /modele\.mode === "engagement"\s*\? \{\s*factures_sans_reglement_rapproche: sansReglement,[\s\S]*?\}\s*: \{ ecritures_en_attente_de_rapprochement_bancaire: sansReglement \}/,
    )
  })

  it('lit la date des pièces, le mouvement des écritures, le relevé entier et les parts des virements groupés, sous le même refus de lecture partielle', () => {
    // Sans `date_piece` dans la lecture, la date attendue d'une pièce non payée serait `undefined`,
    // et toute écriture passerait pour « à régénérer ». Sans `ligne_bancaire_id` ni l'identifiant des
    // mouvements, un règlement d'engagement ne se distinguerait pas de sa facture, ni de son mouvement.
    // Et sans les PARTS — ni le drapeau `reglement_groupe` du relevé —, une pièce réglée par un virement
    // groupé passerait pour non payée.
    const source = sourceDeployee()
    // Et le GÉNÉRATEUR, qui dit ce qu'une pièce coupée par la frontière doit encore porter, lit le hors taxe (qui prime
    // sur le TTC moins la TVA) et le dépôt (qui date ce que rien d'autre ne date). Et, depuis l'étape VF9b, la facture dont
    // une pièce validée est l'exemplaire, et le drapeau d'un mouvement classé par ses encaissements (le virement mixte).
    expect(source).toMatch(/select\("id, date_piece, tiers, montant_ht, montant_ttc, montant_tva, categorie_id, type_piece, created_at, facture_id"/)
    expect(source).toMatch(/from\("ecritures_brouillon"\)\.select\("date, compte, libelle, sens, montant, piece_id, ligne_bancaire_id[,"]/)
    expect(source).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, piece_id, reglement_groupe, [^"]*\bencaissements_de_factures\b[^"]*"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(source).toMatch(/from\("reglements_groupes"\)\.select\("ligne_bancaire_id, piece_id, montant", \{ count: "exact" \}\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(source).toMatch(/\[rPieces, rPiecesAValider, rFactures, rEncaissements, rCategories, rEcritures, rImmobilisations, rAffectes, rVirements, rEmprunts, rReleve, rParts, rReglements, rCotisations, rNatures, rANouveaux, rVehicules, rValides, rLettrages, rDeclarations\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  // LES EXERCICES VALIDÉS, lus par les deux outils qui disent l'état du dossier : `resume_dossier` les nomme, et
  // `points_a_traiter` en tire la frontière au-delà de laquelle plus rien ne se réclame. Lus en partie, ils
  // feraient réclamer ce qu'un exercice validé a figé — d'où le même refus que les autres lectures. Et
  // `lister_comptes` les lit aussi depuis le report des soldes (ligne 34) : ils disent qu'un exercice s'ouvre par les
  // soldes reportés du précédent, ou qu'il attend sa validation (gardé par agentComptableBalance.test.ts).
  it('lit les exercices validés dans les trois outils, refuse sur une lecture partielle, et le dit au modèle', () => {
    const source = sourceDeployee()
    const lectures = source.match(
      /admin\.from\("exercices_valides"\)\.select\("annee", \{ count: "exact" \}\)\.eq\("dossier_id", dossierId\)\.order\("annee"\)\.order\("dossier_id"\)\.range\(/g,
    ) ?? []
    expect(lectures).toHaveLength(3)
    expect(source).toMatch(/const \[r1, r2, r3, r4, r5, r6\] = await Promise\.all\(/)
    expect(source).toMatch(/if \(!r6\.complete\) \{\s*return \{ erreur: `Lecture partielle : \$\{r6\.motif\}/)
    expect(source).toContain('      exercices_valides: r6.lignes.map((v) => v.annee),\n')
    expect(source).toContain('      exercices_valides: rValides.lignes.map((v) => v.annee),\n')
    expect(source).toContain('- Un EXERCICE VALIDÉ (resume_dossier et points_a_traiter : exercices_valides) est FIGÉ')
    expect(source).toContain('Ne propose jamais de régénérer, de réécrire, de rapprocher ou de retirer ce qu\'un exercice validé a figé.')
  })
})

describe('le garde-fou sait encore échouer', () => {
  // Une ancre qui figurerait deux fois ferait planter la dérive au mauvais endroit : on l'exige unique.
  function planter(source: string, avant: string, apres: string, quoi: string): string {
    expect(source.split(avant).length - 1, `${quoi} introuvable ou ambiguë — la dérive plantée ne mord plus`).toBe(1)
    return source.replace(avant, apres)
  }
  // Chaque dérive doit échouer sur une ASSERTION — la comparaison des deux copies —, jamais sur une erreur
  // d'exécution qui passerait pour une prise.
  function echoue(f: () => unknown) {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name, `la dérive n'a pas fait échouer une assertion : ${String(erreur)}`).toBe('AssertionError')
  }
  const deriver = (avant: string, apres: string, quoi: string) => extraire(planter(sourceDeployee(), avant, apres, quoi))

  // La copie telle qu'elle était avant le correctif : elle attend la TVA de la pièce quel que soit le
  // statut du dossier. Le cas exonéré à une seule ligne doit la séparer de src/lib.
  function sansStatutTva(): string {
    return planter(sourceDeployee(), '  return assujettiTva ? piece.montant_tva ?? 0 : 0\n', '  return piece.montant_tva ?? 0\n', 'la TVA ventilée')
  }

  it('attrape une copie déployée qui ignore le statut TVA du dossier', () => {
    const derivee = extraire(sansStatutTva())
    const ecritures = [
      ecriture({ id: 'a', piece_id: 'p1', montant: 120 }),
      ecriture({ id: 'b', piece_id: 'p1', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l-p1' }),
    ]
    expect(() => memeResultat(ecritures, [piece({ id: 'p1' })], [], derivee, false, [payee('p1')])).toThrow()
  })

  function sansComparaisonDeCompte(): string {
    const source = sourceDeployee()
    const debut = source.indexOf('  const surUnAutreCompte = lignes.some(')
    expect(debut, 'la comparaison de compte est introuvable — la dérive plantée ne mord plus')
      .toBeGreaterThan(-1)
    const fin = source.indexOf('  if (surUnAutreCompte) return true\n', debut)
    expect(fin, 'fin de la comparaison de compte introuvable').toBeGreaterThan(debut)
    // La comparaison de compte vit à DEUX endroits depuis que les soldes de chaque date se comparent à la génération
    // (#183) : `surUnAutreCompte`, et le compte dans la clé des soldes. La dérive retire les deux — le code d'avant ne
    // comparait que le montant ; retirer l'un seul ne change plus rien, l'autre le rattrapant.
    const sansSurUnAutreCompte = source.slice(0, debut) + source.slice(fin + '  if (surUnAutreCompte) return true\n'.length)
    return planter(sansSurUnAutreCompte, '      const cle = `${dateComparee ? l.date : ""}|${l.compte}`\n',
      '      const cle = `${dateComparee ? l.date : ""}`\n', 'la clé des soldes par date')
  }

  it('attrape une copie déployée à qui il manque la comparaison de compte', () => {
    const derivee = extraire(sansComparaisonDeCompte())
    // Le cas qui les sépare : un compte changé à total rigoureusement identique.
    expect(() => memeResultat(
      groupeConforme('p1', { compte: '628000' }), [piece({ id: 'p1' })], [], derivee, true, [payee('p1')],
    )).toThrow()
  })

  function sansFiltreImmobilisation(): string {
    const source = sourceDeployee()
    const avant = '    if (acquisition) return acquisition.compte'
    expect(source.split(avant).length - 1, 'le filtre des immobilisations est introuvable ou ambigu').toBe(1)
    return source.replace(avant, '    if (false) return acquisition.compte')
  }

  // Le code d'avant ce chantier attendait `date_piece` partout. La date attendue vient désormais de la génération à
  // laquelle les soldes de chaque date se comparent (#183) : c'est là que la dérive oublie les paiements.
  function sansPaiements(): string {
    const source = planter(sourceDeployee(), '  const dateComparee = datesAttendues(p, paiementsPiece) !== null\n',
      '  const dateComparee = datesAttendues(p, []) !== null\n', 'la date attendue')
    return planter(source, '  const generees = soldesParDate(lignesChargeProduitPourPiece(p, cible, assujettiTva, paiementsPiece))\n',
      '  const generees = soldesParDate(lignesChargeProduitPourPiece(p, cible, assujettiTva, []))\n', 'les soldes attendus')
  }

  it('attrape une copie déployée qui attend la date de facture malgré le paiement', () => {
    // Le code d'avant ce chantier : il attendait `date_piece` partout.
    const derivee = extraire(sansPaiements())
    const paye = [payee('p1', '2025-04-02')]
    expect(() => memeResultat(groupeConforme('p1', { date: '2025-04-02' }), [piece({ id: 'p1' })], [], derivee, true, paye)).toThrow()
  })

  function seuilSansArrondi(): string {
    const source = sourceDeployee()
    const avant = '  const reste = Math.round((montantPiece - paye) * 100) / 100\n'
    expect(source.includes(avant), "l'arrondi du reste est introuvable").toBe(true)
    return source.replace(avant, '  const reste = montantPiece - paye\n')
  }

  it('attrape une copie du rattachement qui ne juge pas l’écart au centime', () => {
    const derivee = extraire(seuilSansArrondi())
    const p = piece({ id: 'p1', montant_ttc: 256.16 })
    const paye: LigneBancaire[] = [{
      id: 'l1', dossier_id: 'd1', date: '2025-04-02', libelle: 'PRLV', montant: -251.16, statut: 'rapprochee',
      piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
      created_at: '2025-04-02T09:00:00Z',
      encaissements_de_factures: false,
    }]
    expect(derivee.rattachementsTresorerie(p, paye)).not.toEqual(rattachementsTresorerie(p, paye))
  })

  it('attrape une dérive de `piecesAComptabiliser` elle-même', () => {
    // Sans cette seconde dérive plantée, retirer la comparaison des deux listes à comptabiliser
    // laisserait tout vert : `analyserEcritures` reçoit alors la liste de la copie déployée, et les
    // deux implémentations tombent d'accord sur ce qu'elles en font. La porte d'entrée doit être
    // gardée autant que le calcul.
    const derivee = extraire(sansFiltreImmobilisation())
    expect(() => memeResultat([], [piece({ id: 'immo' })], [['immo', acq('218300')]], derivee)).toThrow()
    expect(() => memeResultat([], [piece({ id: 'immo' })], [['immo', SANS_NATURE]], derivee)).toThrow()
    expect(() => memeResultat([], [piece({ id: 'immo' })], [['immo', REPRIS]], derivee)).toThrow()
  })

  it('attrape une copie qui écrit la TVA d’un bien en 445660', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '  return immobilisation ? COMPTE_TVA_IMMOBILISATIONS : COMPTE_TVA_DEDUCTIBLE\n',
      '  return COMPTE_TVA_DEDUCTIBLE\n',
      'le compte de TVA d’un bien',
    ))
    const p = piece({ id: 'p1' })
    const acquisition = lignesPourPiece('d1', p, bien('218300'), true, paiementsDesPieces([paiement()], [], SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `a${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(() => memeResultat(acquisition, [p], [['p1', acq('218300')]], derivee, true, [paiement()])).toThrow()
  })

  it('attrape une copie qui doit la facture d’un bien au 401', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '  return immobilisation ? COMPTE_FOURNISSEURS_IMMOBILISATIONS : COMPTE_FOURNISSEURS\n',
      '  return COMPTE_FOURNISSEURS\n',
      'le compte de tiers d’un bien',
    ))
    const p = piece({ id: 'p1' })
    expect(() => memeResultat(brouillonEngagement(p, [paiement()], { cible: bien('218300') }), [p], [['p1', acq('218300')]], derivee, true, [paiement()], ENGAGEMENT))
      .toThrow()
  })

  // Le code d'avant ce chantier : tout jugé en trésorerie, quel que soit le modèle du dossier.
  it('attrape une copie déployée qui ignore le modèle comptable du dossier', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      ') {\n  const piecesParGroupe = new Map<string, EcritureRow[]>()\n',
      ') {\n  modele = { ...modele, mode: "tresorerie" }\n  const piecesParGroupe = new Map<string, EcritureRow[]>()\n',
      "le début d'analyserEcritures",
    ))
    const p = piece({ id: 'p1' })
    expect(() => memeResultat(brouillonEngagement(p, [paiement()]), [p], [], derivee, true, [paiement()], ENGAGEMENT)).toThrow()
  })

  it('attrape une copie qui ne suit plus les règlements des mouvements rapprochés', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '  if (attendus.size !== presents.size || [...attendus].some((id) => !presents.has(id))) return true\n',
      '',
      'la comparaison des règlements',
    ))
    // Un règlement dont la ligne de tiers reste alors que sa ligne de banque est partie, sur un mouvement
    // que plus rien ne rapproche : seule la comparaison des règlements le voit, la banque suivant les
    // paiements.
    const p = piece({ id: 'p1' })
    const second = paiement({ id: 'l2', date: '2025-05-02', montant: -10 })
    const lignes = brouillonEngagement(p, [paiement(), second])
      .filter((e) => !(e.ligne_bancaire_id === 'l2' && e.compte === COMPTE_BANQUE))
    expect(memeResultat(lignes, [p], [], deployee, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual(['p1'])
    expect(() => memeResultat(lignes, [p], [], derivee, true, [paiement()], ENGAGEMENT)).toThrow()
  })

  // LES DÉRIVES DU RÈGLEMENT GROUPÉ (30/09/2026) : chacune est ce qu'aurait laissé une copie restée aux seuls
  // rapprochements, ou qui n'aurait pris qu'une moitié de la règle « une contrepartie par paiement ».
  it('attrape une copie qui oublie les parts des virements groupés', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '    if (!mouvement || mouvement.statut !== "rapprochee" || !mouvement.reglement_groupe) continue\n',
      '    continue\n',
      'la lecture des parts',
    ))
    const p = piece({ id: 'p1' })
    const groupe = paiement({ id: 'g', piece_id: null, montant: -300, reglement_groupe: true })
    const parts: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -120 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -180 }]
    const genere = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces([groupe], parts, SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `g${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(() => memeResultat(genere, [p], [], derivee, true, [groupe], TRESORERIE, parts)).toThrow()
  })

  it('attrape une copie qui prend la part d’un mouvement qui ne règle plus en groupe', () => {
    const derivee = extraire(planter(
      sourceDeployee(), ' || !mouvement.reglement_groupe) continue\n', ') continue\n', 'le drapeau du règlement groupé',
    ))
    const simple = [paiement({ id: 'n', piece_id: null, montant: -90 })]
    const parts: PartReglee[] = [{ ligne_bancaire_id: 'n', piece_id: 'p2', montant: -90 }]
    expect(derivee.paiementsDesPieces(simple, parts, SANS_VIREMENT_MIXTE)).not.toEqual(paiementsDesPieces(simple, parts, SANS_VIREMENT_MIXTE))
  })

  // LES DÉRIVES DES VENTES FACTURÉES (étape VF9b) : la copie qui compterait l'exemplaire d'une facture source, jugerait son
  // écriture, oublierait le virement mixte ou le prendrait d'un crédit seulement réservé. Chaque fois, l'un des régimes de
  // `memeResultat` ou un cas des ventes facturées la sépare de src/lib.
  it('attrape une copie qui met l’exemplaire d’une facture source à comptabiliser', () => {
    const derivee = deriver('    if (exemplaireDUneSource(piece, sources)) return []\n', '', 'l’exemplaire écarté du brouillon')
    echoue(() => memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })], [], derivee, true, [payee('p1')]))
  })

  it('attrape une copie qui juge l’écriture d’un exemplaire', () => {
    const derivee = deriver('    if (!e.piece_id || exemplaires.has(e.piece_id)) continue\n', '    if (!e.piece_id) continue\n', 'les exemplaires écartés des groupes')
    echoue(() => memeResultat(groupeConforme('p1', { banque: false }), [piece({ id: 'p1' })], [], derivee))
  })

  it('attrape une copie qui oublie les parts des virements mixtes, ou les prend d’un crédit seulement réservé', () => {
    const oubliees = deriver(
      '    if (!mouvement || mouvement.statut !== "rapprochee" || !mouvement.encaissements_de_factures) continue\n', '    continue\n',
      'la lecture des parts des virements mixtes',
    )
    const vente = piece({ id: 'p1', type_piece: 'vente', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    echoue(() => memeResultat([], [vente], [], oubliees))
    const reservees = deriver(' || !mouvement.encaissements_de_factures) continue\n', ') continue\n', 'le drapeau du virement mixte')
    const reserve = [paiement({ id: 'vm', piece_id: null, montant: 120, encaissements_de_factures: false })]
    const encaissees: PartEncaissee[] = [{ ligne_bancaire_id: 'vm', piece_id: 'p1', montant: 120 }]
    echoue(() => expect(reservees.paiementsDesPieces(reserve, [], encaissees)).toEqual(paiementsDesPieces(reserve, [], encaissees)))
  })

  it('attrape une copie qui ne compare pas les contreparties aux paiements', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '  if (!banqueSuitLesPaiements(groupe.filter((e) => e.compte === COMPTE_BANQUE), paiementsPiece)) return true\n',
      '',
      'la comparaison de la banque en trésorerie',
    ))
    const p = piece({ id: 'p1' })
    const acompte = paiement({ id: 'a', date: '2025-03-20', montant: -48 })
    const solde = paiement({ id: 's', date: '2025-04-15', montant: -72 })
    const genere = lignesPourPiece('d1', p, cible(COMPTE_ACHATS), true, paiementsDesPieces([acompte, solde], [], SANS_VIREMENT_MIXTE).get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `d${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    const unSeul = genere.filter((e) => !(e.compte === COMPTE_BANQUE && e.ligne_bancaire_id === 's'))
    expect(() => memeResultat(unSeul, [p], [], derivee, true, [acompte, solde])).toThrow()
  })

  it('attrape une copie qui laisse passer une contrepartie de trop', () => {
    const juste = groupeConforme('p1')
    const contrepartie = juste.find((e) => e.compte === COMPTE_BANQUE)!
    const autre = extraire(planter(sourceDeployee(), '  if (attendus.size !== presents.size) return false\n', '', 'le compte des contreparties'))
    expect(() => memeResultat([...juste, { ...contrepartie, id: 'x', ligne_bancaire_id: 'x', montant: 50 }], [piece({ id: 'p1' })], [], autre, true, [payee('p1')]))
      .toThrow()
    const aucune = extraire(planter(
      sourceDeployee(), '    if (!e.ligne_bancaire_id) return false\n', '    if (!e.ligne_bancaire_id) continue\n', 'la contrepartie sans mouvement',
    ))
    expect(() => memeResultat([...juste, { ...contrepartie, id: 'y', ligne_bancaire_id: null, montant: 50 }], [piece({ id: 'p1' })], [], aucune, true, [payee('p1')]))
      .toThrow()
  })

  it('attrape une copie qui compte « en attente de rapprochement » une pièce payée', () => {
    const derivee = extraire(planter(
      sourceDeployee(), ' && !paiements.has(pieceId))\n    .map(([pieceId]) => pieceId)\n', ')\n    .map(([pieceId]) => pieceId)\n',
      'le compte des pièces sans contrepartie',
    ))
    const p = piece({ id: 'p1' })
    expect(() => memeResultat(groupeConforme('p1', { banque: false }), [p], [], derivee, true, [payee('p1')])).toThrow()
  })

  it('attrape une copie qui tait des contreparties sans leur charge', () => {
    const derivee = extraire(planter(
      sourceDeployee(), '  if (lignes.length === 0) return groupe.length > 0\n', '  if (lignes.length === 0) return false\n',
      'la garde des contreparties seules',
    ))
    const seule = groupeConforme('p1').filter((e) => e.compte === COMPTE_BANQUE)
    expect(() => memeResultat(seule, [piece({ id: 'p1' })], [], derivee, true, [payee('p1')])).toThrow()
  })

  it('attrape une copie qui attend un règlement pour un paiement de zéro euro', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '  const attendus = new Set(paiementsPiece.filter((m) => m.montant !== 0).map((m) => m.id))\n',
      '  const attendus = new Set(paiementsPiece.map((m) => m.id))\n',
      'les règlements attendus',
    ))
    const p = piece({ id: 'p1' })
    const nul = paiement({ montant: 0 })
    expect(() => memeResultat(brouillonEngagement(p, [nul]), [p], [], derivee, true, [nul], ENGAGEMENT)).toThrow()
  })

  it('attrape une copie qui ne compare pas la banque des règlements aux paiements', () => {
    const derivee = extraire(planter(
      sourceDeployee(),
      '  return !banqueSuitLesPaiements(reglements.filter((e) => e.compte === COMPTE_BANQUE), paiementsPiece)\n',
      '  return false\n',
      'la comparaison de la banque en engagement',
    ))
    // Réglée de nouveau avec une autre part : le règlement est resté à l'ancien montant.
    const p = piece({ id: 'p1' })
    const groupe = paiement({ id: 'g', piece_id: null, montant: -300, reglement_groupe: true })
    const avant: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -100 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -200 }]
    const apres: PartReglee[] = [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -120 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -180 }]
    const ancien = brouillonEngagement(p, [...(paiementsDesPieces([groupe], avant, SANS_VIREMENT_MIXTE).get('p1') ?? [])])
    expect(memeResultat(ancien, [p], [], deployee, true, [groupe], ENGAGEMENT, apres).piecesDesynchronisees).toEqual(['p1'])
    expect(() => memeResultat(ancien, [p], [], derivee, true, [groupe], ENGAGEMENT, apres)).toThrow()
  })

  it('attrape une copie qui juge l’équilibre sur le groupe de la pièce', () => {
    const derivee = extraire(planter(
      sourceDeployee(), '      const ecriture = e.ligne_bancaire_id ?? ""\n', '      const ecriture = ""\n', "la clé d'écriture",
    ))
    const p = piece({ id: 'p1' })
    const lignes = brouillonEngagement(p, [paiement()])
    lignes.find((e) => e.compte === '401000' && !e.ligne_bancaire_id)!.montant = 110
    lignes.find((e) => e.compte === '401000' && e.ligne_bancaire_id)!.montant = 110
    expect(() => memeResultat(lignes, [p], [], derivee, true, [paiement()], ENGAGEMENT)).toThrow()
  })

  it('attrape une copie qui passe les notes de frais au 401', () => {
    const derivee = extraire(planter(
      sourceDeployee(), '  if (piece.type_piece === "note_frais") return compteNotesDeFrais\n', '', 'le compte des notes de frais',
    ))
    const ndf = piece({ id: 'p1', type_piece: 'note_frais' })
    expect(() => memeResultat(brouillonEngagement(ndf, []), [ndf], [], derivee, true, [], ENGAGEMENT)).toThrow()
  })

  // LA NOTE DE FRAIS EN TRÉSORERIE, FACE AU 108000. Chaque dérive doit échouer sur une ASSERTION — la comparaison
  // des deux copies —, jamais sur une erreur d'exécution qui passerait pour une prise.
  describe('la contrepartie d’une note de frais au compte de l’exploitant', () => {
    const p = noteDeFrais()

    it('attrape une copie qui compte la contrepartie parmi les lignes de charge', () => {
      const derivee = deriver(
        '  const lignes = groupe.filter((e) => e.compte !== COMPTE_BANQUE && !estContrepartieDirigeant(p, cible, e))\n',
        '  const lignes = groupe.filter((e) => e.compte !== COMPTE_BANQUE)\n', 'les lignes de charge',
      )
      echoue(() => memeResultat(brouillonTresorerie(p, []), [p], [], derivee))
    })

    it('attrape une copie qui ne compare pas la contrepartie', () => {
      const derivee = deriver(
        '  return dirigeantPresent.length !== dirigeantAttendu.length || dirigeantPresent.some((c, i) => c !== dirigeantAttendu[i])\n',
        '  return false\n', 'la comparaison de la contrepartie',
      )
      echoue(() => memeResultat(brouillonTresorerie(p, []).filter((e) => e.compte !== COMPTE_EXPLOITANT), [p], [], derivee))
    })

    it('attrape une copie qui compte une note de frais « en attente de rapprochement »', () => {
      const derivee = deriver('!notesDeFrais.has(pieceId) && !rows.some(', '!rows.some(', 'l’exclusion des notes de frais')
      echoue(() => memeResultat(brouillonTresorerie(p, []).filter((e) => e.compte !== COMPTE_EXPLOITANT), [p], [], derivee))
    })

    it('attrape une copie qui ne prend pas le 108000 pour une contrepartie', () => {
      const derivee = deriver(
        '    r.compte === COMPTE_BANQUE || (notesDeFrais.has(pieceId) && r.compte === COMPTE_EXPLOITANT)\n',
        '    r.compte === COMPTE_BANQUE\n', 'la contrepartie au 108000',
      )
      const ecritures = brouillonTresorerie(p, []).map((e) => e.compte === COMPTE_EXPLOITANT ? { ...e, montant: 115 } : e)
      echoue(() => memeResultat(ecritures, [p], [], derivee))
    })

    it('attrape une copie qui juge l’équilibre sur la seule banque', () => {
      const derivee = deriver(
        '      .filter(([pieceId, rows]) => rows.some((r) => contrepartie(pieceId, r)))\n',
        '      .filter(([, rows]) => rows.some((r) => r.compte === COMPTE_BANQUE))\n', 'le filtre des groupes jugés',
      )
      const ecritures = brouillonTresorerie(p, []).map((e) => e.compte === COMPTE_EXPLOITANT ? { ...e, montant: 115 } : e)
      echoue(() => memeResultat(ecritures, [p], [], derivee))
    })

    it('attrape une copie qui tient pour note de frais toute pièce de ce type, quels que soient sa catégorie et le modèle', () => {
      const derivee = deriver(
        '    .filter(({ piece, ...cible }) => tresorerie && estContrepartieDirigeant(piece, cible, { compte: COMPTE_EXPLOITANT }))\n',
        '    .filter(({ piece }) => piece.type_piece === "note_frais")\n', 'les notes de frais tenues face au 108000',
      )
      const sur108 = piece({ id: 'p1', type_piece: 'note_frais', categorie_id: 'cat-108' })
      echoue(() => memeResultat(brouillonTresorerie(sur108, [], { compte: COMPTE_EXPLOITANT }), [sur108], [], derivee))
      echoue(() => memeResultat(brouillonEngagement(p, []), [p], [], derivee, true, [], ENGAGEMENT))
    })

    it('attrape une copie qui attend une contrepartie sur une catégorie au 108000', () => {
      const derivee = deriver(
        '    .filter((l) => estContrepartieDirigeant(p, cible, l)).map(cle).sort()\n',
        '    .filter((l) => l.compte === COMPTE_EXPLOITANT).map(cle).sort()\n', 'la contrepartie attendue',
      )
      const sur108 = piece({ id: 'p1', type_piece: 'note_frais', categorie_id: 'cat-108' })
      echoue(() => memeResultat(brouillonTresorerie(sur108, [], { compte: COMPTE_EXPLOITANT }), [sur108], [], derivee))
    })

    // Le GÉNÉRATEUR, lui, ne doit pas l'écrire : la part ouverte d'une pièce que la frontière coupe se compare ligne
    // pour ligne, sans le filtre de la comparaison ci-dessus. Un acompte versé avant la date de la note, figé ; le
    // reste, que le dirigeant a payé, ouvert.
    it('attrape un générateur qui écrit une contrepartie sur une catégorie au 108000', () => {
      const derivee = deriver(
        '  return dirigeant && estContrepartieDirigeant(piece, cible, dirigeant) ? [...autres, dirigeant] : autres\n',
        '  return dirigeant ? [...autres, dirigeant] : autres\n', 'la contrepartie générée',
      )
      const sur108 = piece({ id: 'p1', type_piece: 'note_frais', categorie_id: 'cat-108' })
      const acompte = paiement({ id: 'l1', piece_id: 'p1', date: '2025-03-01', montant: -60 })
      const ecritures = brouillonTresorerie(sur108, [acompte], { compte: COMPTE_EXPLOITANT })
      echoue(() => memeResultat(ecritures, [sur108], [], derivee, true, [acompte], TRESORERIE, [], '2025-03-05'))
    })

    it('attrape une copie qui compare la date d’une note sans date', () => {
      const derivee = deriver(
        '    [p.date_piece ? l.date : "", l.sens, Math.round(l.montant * 100)].join("|")\n',
        '    [l.date, l.sens, Math.round(l.montant * 100)].join("|")\n', 'la clé de la contrepartie',
      )
      // L'écriture générée quand la note portait sa date ; la date effacée depuis, la note se rattache à son dépôt,
      // cinq jours plus tard. Sans date, la date de la contrepartie ne se compare pas.
      const sansDate = noteDeFrais({ date_piece: null, created_at: '2025-03-15T09:00:00Z' })
      echoue(() => memeResultat(brouillonTresorerie(noteDeFrais(), []), [sansDate], [], derivee))
    })

    it('attrape une copie qui retourne le sens de la contrepartie', () => {
      const derivee = deriver('sens: solde > 0 ? "credit" : "debit", montant: Math.abs(solde) / 100 }',
        'sens: solde > 0 ? "debit" : "credit", montant: Math.abs(solde) / 100 }', 'le sens de la contrepartie')
      echoue(() => memeResultat(brouillonTresorerie(p, []), [p], [], derivee))
    })

    it('attrape une copie qui oublie la banque, ou la TVA, dans le solde', () => {
      const ancre = '  const solde = autres.reduce((s, l) => s + (l.sens === "debit" ? 1 : -1) * Math.round(l.montant * 100), 0)\n'
      const sansBanque = deriver(ancre,
        '  const solde = autres.filter((l) => l.compte !== COMPTE_BANQUE).reduce((s, l) => s + (l.sens === "debit" ? 1 : -1) * Math.round(l.montant * 100), 0)\n',
        'le solde')
      echoue(() => memeResultat(brouillonTresorerie(p, [rembourse(-60)]), [p], [], sansBanque, true, [rembourse(-60)]))
      const sansTva = deriver(ancre,
        '  const solde = autres.filter((l) => l.compte !== COMPTE_TVA_DEDUCTIBLE).reduce((s, l) => s + (l.sens === "debit" ? 1 : -1) * Math.round(l.montant * 100), 0)\n',
        'le solde')
      echoue(() => memeResultat(brouillonTresorerie(p, []), [p], [], sansTva))
    })

    it('attrape une copie qui ne retient pas la charge comme la génération', () => {
      // Le hors taxe lu prime sur le TTC moins la TVA…
      const sansHt = deriver('  if (ht != null) return ht\n', '', 'le hors taxe lu')
      const htLu = noteDeFrais({ montant_ht: 100.01 })
      echoue(() => memeResultat(brouillonTresorerie(htLu, []), [htLu], [], sansHt))
      // … et un dossier exonéré porte le TTC, même quand le hors taxe est lu.
      const toujoursHt = deriver('  const charge = tva ? montantRetenu(piece, assujettiTva)! : piece.montant_ttc!\n',
        '  const charge = piece.montant_ht ?? piece.montant_ttc!\n', 'la charge')
      echoue(() => memeResultat(brouillonTresorerie(p, [], { assujettiTva: false }), [p], [], toujoursHt, false))
    })

    it('attrape une copie qui date la contrepartie d’un autre paiement que la part du dirigeant', () => {
      const derivee = deriver('.find((r) => r.source === "note_de_frais")', '.find((r) => r.source !== "sans_paiement")', 'la part du dirigeant')
      // Un acompte versé AVANT la date de la note : la première part est le paiement.
      const acompte = paiement({ id: 'l1', piece_id: 'p1', date: '2025-03-01', montant: -60 })
      echoue(() => memeResultat(brouillonTresorerie(p, [acompte]), [p], [], derivee, true, [acompte]))
    })
  })

  // LE GÉNÉRATEUR et LA FRONTIÈRE : chaque dérive plantée dans la vraie source doit faire échouer une comparaison.
  describe('le générateur et la frontière de validation', () => {
    // La dérive se plante HORS de `echoue` : une ancre introuvable doit faire échouer le test, pas passer pour une prise.
    it('attrape un générateur qui retourne le sens de la banque, ou oublie l’arrondi du dernier morceau', () => {
      const sensBanque = deriver(
        '    date: paiement.date, compte: COMPTE_BANQUE, sens: paiement.montant > 0 ? "debit" : "credit",\n',
        '    date: paiement.date, compte: COMPTE_BANQUE, sens: paiement.montant > 0 ? "credit" : "debit",\n', 'le sens de la banque',
      )
      echoue(() => batterieDuGenerateur(sensBanque))
      const sansArrondi = deriver('  morceaux[morceaux.length - 1] = total - morceaux.slice(0, -1).reduce((s, m) => s + m, 0)\n', '', 'le dernier morceau')
      echoue(() => batterieDuGenerateur(sansArrondi))
    })

    it('attrape un générateur qui oublie la contrepartie banque, ou qui retourne le sens d’un règlement', () => {
      const sansBanque = deriver('    ...paiements.flatMap((p) => ligneContrepartieBanque(p) ?? []),\n', '', 'les contreparties banque')
      echoue(() => batterieDuGenerateur(sansBanque))
      const sensReglement = deriver(
        'sens: inverse(sensBanque), montant, ligne_bancaire_id: mouvement.id },',
        'sens: sensBanque, montant, ligne_bancaire_id: mouvement.id },', 'le sens d’un règlement',
      )
      echoue(() => batterieDuGenerateur(sensReglement))
    })

    it('attrape une copie qui date le dépôt ailleurs qu’à Paris', () => {
      const derivee = deriver(
        '    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",\n',
        '    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",\n', 'le fuseau du dépôt',
      )
      echoue(() => expect(derivee.dateDuDepot('2025-12-31T23:30:00Z')).toBe('2026-01-01'))
    })

    it('attrape une frontière tirée du premier exercice validé, ou qui ne fige pas son dernier jour', () => {
      const premier = deriver('  return anneesValidees.length === 0 ? null : `${Math.max(...anneesValidees)}-12-31`\n',
        '  return anneesValidees.length === 0 ? null : `${Math.min(...anneesValidees)}-12-31`\n', 'la frontière')
      echoue(() => expect(premier.frontiereDeValidation([2023, 2025])).toBe('2025-12-31'))
      const strict = deriver('  return frontiere !== null && date <= frontiere\n', '  return frontiere !== null && date < frontiere\n', 'estFigee')
      echoue(() => memeResultat(brouillon(piece({}), cible(COMPTE_ACHATS), [payee('p1')], TRESORERIE), [piece({ categorie_id: 'cat-autre' })],
        [], strict, true, [payee('p1')]))
    })

    it('attrape une copie qui juge entière une pièce que la frontière coupe', () => {
      const derivee = deriver(
        '      if ([...groupe, ...attendues].some((l) => estFigee(l.date, frontiere))) {\n', '      if (false) {\n', 'la coupure',
      )
      const avant = brouillon(piece({}), cible(COMPTE_ACHATS), [payee('p1')], TRESORERIE)
      echoue(() => memeResultat(avant, [piece({ categorie_id: 'cat-autre' })], [], derivee, true, [payee('p1')], TRESORERIE, [], '2025-12-31'))
    })

    it('attrape une copie qui compare aussi la part figée, ou qui ne regarde pas le mouvement d’une ligne', () => {
      const enDeuxFois = [paiement({ id: 'l1', date: '2025-03-10', montant: -60 }), paiement({ id: 'l2', date: '2025-04-02', montant: -60 })]
      const avant = brouillon(piece({}), cible(COMPTE_ACHATS), enDeuxFois, TRESORERIE, 'v')
      const apres = brouillon(piece({ categorie_id: 'cat-autre' }), cible('628000'), enDeuxFois, TRESORERIE, 'n')
      const regeneree = [...avant.filter((e) => e.date <= '2025-03-31'), ...apres.filter((e) => e.date > '2025-03-31')]
      const toutCompare = extraire(planter(planter(sourceDeployee(),
        '  const presentes = groupe.filter((e) => !estFigee(e.date, frontiere)).map(cle).sort()\n', '  const presentes = groupe.map(cle).sort()\n',
        'les lignes présentes'),
      '  const ouvertes = attendues.filter((l) => !estFigee(l.date, frontiere)).map(cle).sort()\n', '  const ouvertes = attendues.map(cle).sort()\n',
      'les lignes ouvertes'))
      echoue(() => memeResultat(regeneree, [piece({ categorie_id: 'cat-autre' })], [], toutCompare, true, enDeuxFois, TRESORERIE, [], '2025-03-31'))
      const sansMouvement = deriver(
        '    [l.date, l.compte, l.sens, Math.round(l.montant * 100), l.ligne_bancaire_id ?? ""].join("|")\n',
        '    [l.date, l.compte, l.sens, Math.round(l.montant * 100)].join("|")\n', 'la clé d’une ligne ouverte',
      )
      const autreMouvement = brouillon(piece({}), cible(COMPTE_ACHATS), enDeuxFois, TRESORERIE)
        .map((e) => (e.ligne_bancaire_id === 'l2' ? { ...e, ligne_bancaire_id: 'l-autre' } : e))
      echoue(() => memeResultat(autreMouvement, [piece({})], [], sansMouvement, true, enDeuxFois, TRESORERIE, [], '2025-03-31'))
    })
  })

  it('a bien extrait la copie DÉPLOYÉE, et pas la copie locale', () => {
    // La borne la plus bête et la plus nécessaire : si `deployee` cessait d'être ce que la source
    // Deno contient, les douze cas compareraient `src/lib` à lui-même et resteraient verts.
    expect(deployee.analyserEcritures).not.toBe(analyserEcritures)
    expect(deployee.piecesAComptabiliser).not.toBe(piecesAComptabiliser)
    expect(deployee.lignesPourPiece).not.toBe(lignesPourPiece)
    expect(deployee.frontiereDeValidation).not.toBe(frontiereDeValidation)
    expect(deployee.estFigee).not.toBe(estFigee)
  })

  it('et il ne crie PAS au loup sur la copie réellement déployée', () => {
    // Garde symétrique : sans lui, « la dérive est attrapée » serait satisfait par un garde-fou qui
    // échoue sur tout, y compris sur deux copies rigoureusement identiques.
    expect(() => memeResultat(
      groupeConforme('p1', { compte: '628000' }), [piece({ id: 'p1' })],
    )).not.toThrow()
    const p = piece({ id: 'p1' })
    const lignes = brouillonEngagement(p, [paiement()])
    lignes.find((e) => e.compte === '401000' && !e.ligne_bancaire_id)!.montant = 110
    lignes.find((e) => e.compte === '401000' && e.ligne_bancaire_id)!.montant = 110
    expect(() => memeResultat(lignes, [p], [], deployee, true, [paiement()], ENGAGEMENT)).not.toThrow()
  })
})
