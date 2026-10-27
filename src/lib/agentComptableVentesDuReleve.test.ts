import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { muter } from '../test/fonctionsEdge'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { ACCES_SANS_OBJET } from './auteursVentes'
import {
  encaissementsDuMouvement, justifieSonMouvement, ordreDesEncaissements, REFUS_GARDE_MOUVEMENTS, refusDuClassementDuReleve,
  remplirModele, type ExemplaireLu, type FactureDuDossier, type MouvementClasse,
} from './encaissementsFactures'
import {
  encaissementsEnregistresSansMouvement, mouvementDeVente, ventesDuReleve,
  type EncaissementDuMouvementLu, type LectureDesVentesDuReleve,
} from './mouvementsDesVentes'
import type { LigneBancaire, MoyenEncaissement } from './types'
import { MOYENS_DU_RELEVE, ventesDeLaChecklist } from './ventesDeLaChecklist'

// L'ASSISTANT DIT LES MOUVEMENTS RÉSERVÉS ET LES ENCAISSEMENTS SANS MOUVEMENT COMME LA CHECKLIST (chantier EC-Q3, étape
// VF9c, ligne 28.65).
//
// `agent-comptable` est auto-portée : elle recopie, entre les bornes `── DÉBUT/FIN VENTES DU RELEVÉ`, ce qui décide des deux
// points de la Checklist d'un dossier qui a basculé — src/lib/ventesDeLaChecklist.ts, et ce qu'il appelle de
// src/lib/mouvementsDesVentes.ts et de src/lib/encaissementsFactures.ts —, sans ce qui ne décide d'aucun compte (l'auteur
// d'un encaissement, ce que la fiche d'un mouvement en montre). Ce test garde la copie de la forme des autres blocs de
// l'assistant : extraire le bloc avec les trois qu'il lit (VALIDATION, FACTURES SOURCES, VIREMENT MIXTE), le transpiler,
// l'exécuter SEUL — un nom qu'il emprunterait au reste du fichier lèverait —, le confronter à src/lib sur les jeux de
// ventesDeLaChecklist.test.ts et sur une batterie tirée d'une graine fixe, et planter dans la vraie source une dérive par
// fonction pour prouver qu'il sait encore échouer. Puis ce que l'assistant demande à la base pour sa troisième clé :
// `ventes_facturees_de_l_exercice`, que le rôle du service seul exécute — aucun retrait de ce droit n'entre dans l'export.
//
// CE QU'UNE DÉRIVE COÛTERAIT : sur un dossier basculé, l'assistant dirait à classer un mouvement que la Vue d'ensemble ne
// compte pas — ou tairait celui qu'elle compte —, et compterait comme attendant son mouvement un encaissement retiré, une
// contre-passation, un règlement en espèces.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Bornes = readonly [debut: string, fin: string]
const VALIDATION: Bornes = ['// ── DÉBUT VALIDATION', '// ── FIN VALIDATION']
const FACTURES_SOURCES: Bornes = ['// ── DÉBUT FACTURES SOURCES', '// ── FIN FACTURES SOURCES']
const VIREMENT_MIXTE: Bornes = ['// ── DÉBUT VIREMENT MIXTE', '// ── FIN VIREMENT MIXTE']
const VENTES_DU_RELEVE: Bornes = ['// ── DÉBUT VENTES DU RELEVÉ', '// ── FIN VENTES DU RELEVÉ']

/** Le texte d'un bloc, ses bornes exigées uniques : une borne en double ferait garder le mauvais morceau. */
function bloc(source: string, [debut, fin]: Bornes): string {
  expect(source.split(debut).length - 1, `« ${debut} » introuvable ou en double — garde-fou à remettre à jour`).toBe(1)
  expect(source.split(fin).length - 1, `« ${fin} » introuvable ou en double — garde-fou à remettre à jour`).toBe(1)
  const i = source.indexOf(debut)
  const j = source.indexOf(fin)
  expect(j, `« ${fin} » avant « ${debut} »`).toBeGreaterThan(i)
  return source.slice(i, j)
}

/** Des blocs transpilés puis exécutés SEULS, en mode strict : ils ne voient rien du reste du fichier. */
function executer<T>(code: string, noms: readonly string[]): T {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`"use strict";\n${js}\nreturn { ${noms.join(', ')} }`)() as T
}

type Facture = FactureDuDossier
type Encaissement = EncaissementDuMouvementLu
type Mouvement = MouvementClasse
interface VenteDeMouvement { id: string; etat: string }
type ReleveDe =
  | { etat: 'sans_objet' | 'en_cours' }
  | { etat: 'incomplete'; motif: string }
  | { etat: 'lue'; mouvements: ReadonlyMap<string, VenteDeMouvement> }
type ChecklistDe =
  | { etat: 'sans_objet' }
  | { etat: 'incomplete'; motif: string }
  | { etat: 'lue'; reserves: readonly VenteDeMouvement[]; sansMouvement: readonly Encaissement[] }

// Ce que la copie rend, sous les types de src/lib : les lignes qu'elle reçoit en portent davantage, comme celles que
// l'assistant lit en base.
interface Copie {
  remplirModele: (modele: string, valeurs: readonly string[]) => string
  REFUS_GARDE_MOUVEMENTS: readonly { cle: string; modele: string }[]
  ordreDesEncaissements: (a: Encaissement, b: Encaissement) => number
  encaissementsDuMouvement: (mouvementId: string, encaissements: readonly Encaissement[], vente: { factures: readonly Facture[] }) => Encaissement[]
  refusDuClassementDuReleve: (m: Mouvement, encaissements: readonly Encaissement[], vente: { factures: readonly Facture[] }) => { cle: string; message: string } | null
  mouvementDeVente: (m: Mouvement, sources: { factures: readonly Facture[]; encaissements: readonly Encaissement[]; exemplaires: readonly ExemplaireLu[] }) => VenteDeMouvement | null
  ventesDuReleve: (dossierId: string, lecture: LectureDesVentesDuReleve | null) => ReleveDe
  encaissementsEnregistresSansMouvement: (s: { dossierId: string; factures: readonly Facture[]; encaissements: readonly Encaissement[] }) => Encaissement[]
  MOYENS_DU_RELEVE: readonly string[]
  ventesDeLaChecklist: (lecture: LectureDesVentesDuReleve | null, frontiere: string | null) => ChecklistDe
}

const NOMS = [
  'remplirModele', 'REFUS_GARDE_MOUVEMENTS', 'ordreDesEncaissements', 'encaissementsDuMouvement', 'refusDuClassementDuReleve',
  'mouvementDeVente', 'ventesDuReleve', 'encaissementsEnregistresSansMouvement', 'MOYENS_DU_RELEVE', 'ventesDeLaChecklist',
] as const

const copieDe = (source: string) => executer<Copie>(
  [VALIDATION, FACTURES_SOURCES, VIREMENT_MIXTE, VENTES_DU_RELEVE].map((b) => bloc(source, b)).join('\n'), NOMS,
)
const deployee = copieDe(sourceDeployee())

// src/lib sous la même forme. La copie ne dit pas l'auteur : src/lib le juge sur des accès « sans objet », qui ne nomment
// personne, et l'état d'un mouvement n'en dépend pas.
const ICI: Copie = {
  remplirModele,
  REFUS_GARDE_MOUVEMENTS: REFUS_GARDE_MOUVEMENTS.filter((r) => r.cle === 'classe_par_ses_encaissements' || r.cle === 'reserve'),
  ordreDesEncaissements,
  encaissementsDuMouvement,
  refusDuClassementDuReleve,
  mouvementDeVente: (m, sources) => mouvementDeVente(m, sources, ACCES_SANS_OBJET),
  ventesDuReleve: (dossierId, lecture) => ventesDuReleve(true, dossierId, lecture, ACCES_SANS_OBJET),
  encaissementsEnregistresSansMouvement,
  MOYENS_DU_RELEVE,
  ventesDeLaChecklist,
}

// ── LES JEUX D'ESSAI : CEUX DE ventesDeLaChecklist.test.ts ──────────────────────────────────────────────────────────────

const D = 'd-bascule'
const AUTRE = 'autre'

const facture = (o: Partial<Facture> & Pick<Facture, 'id' | 'numero'>): Facture => ({
  dossier_id: D, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, ...o,
})
const encaissement = (o: Partial<Encaissement> & Pick<Encaissement, 'id' | 'facture_id' | 'montant'>): Encaissement => ({
  dossier_id: D, date_encaissement: '2026-03-10', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-03-10T10:00:00Z', retire_le: null, cree_par: 'u-cabinet', ...o,
})
function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-03-12', libelle: 'VIR SEPA RECU FICTIF', montant: 600,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve-2026.csv', libelle_brut: null,
    created_at: '2026-04-01T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

// Deux factures sources, et une facture d'avant la bascule.
const FACTURES = [
  facture({ id: 'f1', numero: 'F2026-0014' }),
  facture({ id: 'f2', numero: 'F2026-0015' }),
  facture({ id: 'f0', numero: 'F2025-0099', source_de_la_vente: false }),
]

function lue(
  mouvements: readonly LigneBancaire[], encaissements: readonly Encaissement[] = [], o: { factures?: readonly Facture[]; exemplaires?: readonly ExemplaireLu[] } = {},
): LectureDesVentesDuReleve {
  return {
    dossierId: D, etat: 'lue',
    sources: { dossierId: D, factures: o.factures ?? FACTURES, encaissements, mouvements, exemplaires: o.exemplaires ?? [] },
  }
}

interface Cas { lecture: LectureDesVentesDuReleve | null; frontieres: readonly (string | null)[] }
const cas = (lecture: LectureDesVentesDuReleve | null, frontieres: readonly (string | null)[] = [null]): Cas => ({ lecture, frontieres })

const E1_SUR_M1 = encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })
const MOYENS: readonly MoyenEncaissement[] = ['virement', 'prelevement', 'cheque', 'carte', 'effet', 'especes', 'compensation', 'autre']
const MELEE: LectureDesVentesDuReleve = (() => {
  const l = lue([mouvement({ id: 'm1' })], [E1_SUR_M1])
  if (l.etat !== 'lue') throw new Error('lue')
  return { ...l, sources: { ...l.sources, dossierId: 'autre' } }
})()

const CAS_NOMMES: [string, Cas][] = [
  ['sans objet pour un dossier qui n’a pas basculé', cas(null)],
  ['incomplète, avec son motif', cas({ dossierId: D, etat: 'incomplete', motif: 'les encaissements : 1000 lignes lues sur 1200' })],
  ['une lecture qui se dit d’un dossier et porte les sources d’un autre', cas(MELEE)],
  ['un crédit qu’un encaissement de facture source cite, pas encore classé : réservé', cas(lue([mouvement({ id: 'm1' })], [E1_SUR_M1]))],
  ['le même, classé par ses encaissements', cas(lue([mouvement({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true })], [E1_SUR_M1]))],
  ['un débit qu’une contre-passation cite : réservé ; un mouvement que rien ne cite, jamais', cas(lue(
    [mouvement({ id: 'm2', montant: -600, date: '2026-03-20' }), mouvement({ id: 'm3' })],
    [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, moyen: 'cheque' }),
      encaissement({ id: 'c1', facture_id: 'f1', montant: -600, moyen: 'cheque', annule_id: 'e1', ligne_bancaire_id: 'm2', date_encaissement: '2026-03-20' }),
    ],
  ))],
  ['l’encaissement d’une facture d’avant la bascule ne réserve rien',
    cas(lue([mouvement({ id: 'm1' })], [encaissement({ id: 'e0', facture_id: 'f0', montant: 600, ligne_bancaire_id: 'm1' })]))],
  ['un encaissement retiré ne réserve rien', cas(lue([mouvement({ id: 'm1' })], [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', retire_le: '2026-03-15T10:00:00Z' }),
  ]))],
  ['un encaissement qu’une contre-passation sans mouvement défait ne réserve rien', cas(lue([mouvement({ id: 'm1' })], [
    E1_SUR_M1, encaissement({ id: 'c1', facture_id: 'f1', montant: -600, annule_id: 'e1' }),
  ]))],
  ['un mouvement que la validation fige ne se compte plus ; le lendemain de la frontière, si', cas(lue(
    [mouvement({ id: 'm1', date: '2025-12-31' }), mouvement({ id: 'm2', date: '2026-01-01' })],
    [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', date_encaissement: '2025-12-31' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 600, ligne_bancaire_id: 'm2', date_encaissement: '2026-01-01' }),
    ],
  ), [null, '2025-12-31'])],
  ['un mouvement d’un autre dossier que la lecture porterait', cas(lue([mouvement({ id: 'm1', dossier_id: AUTRE })], [E1_SUR_M1]))],
  // L'ordre de la garde : la facture du premier encaissement, par sa création puis son identifiant octet par octet — « E2 »
  // avant « e1 », ce que `localeCompare` range autrement.
  ['réservé : la facture nommée est celle du premier encaissement par sa création', cas(lue([mouvement({ id: 'm1' })], [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 300, ligne_bancaire_id: 'm1', cree_le: '2026-03-10T10:00:00Z' }),
    encaissement({ id: 'e2', facture_id: 'f2', montant: 300, ligne_bancaire_id: 'm1', cree_le: '2026-03-10T09:00:00Z' }),
  ]))],
  ['réservé : à création égale, par l’identifiant, octet par octet', cas(lue([mouvement({ id: 'm1' })], [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 300, ligne_bancaire_id: 'm1' }),
    encaissement({ id: 'E2', facture_id: 'f2', montant: 300, ligne_bancaire_id: 'm1' }),
  ]))],
  ['réservé par une facture sans numéro : `raise` l’écrirait <NULL>', cas(lue([mouvement({ id: 'm1' })], [
    encaissement({ id: 'e9', facture_id: 'f9', montant: 300, ligne_bancaire_id: 'm1' }),
  ], { factures: [...FACTURES, facture({ id: 'f9', numero: null })] }))],
  // Le virement mixte (étape VF5h) : un crédit classé par ses encaissements, qui porte celui d'une facture d'avant.
  ['le virement mixte, classé par ses encaissements', cas(lue(
    [mouvement({ id: 'm-mx', montant: 660, statut: 'rapprochee', encaissements_de_factures: true })],
    [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-mx', date_encaissement: '2026-03-12' }),
      encaissement({ id: 'ea', facture_id: 'f0', montant: 60, ligne_bancaire_id: 'm-mx', date_encaissement: '2026-03-12' }),
    ],
    { exemplaires: [{ id: 'p-avant', dossier_id: D, facture_id: 'f0', statut: 'validee', type_piece: 'vente' }] },
  ))],
  ['sans mouvement : par virement, prélèvement, chèque, carte ou effet ; jamais en espèces, par compensation ni « autre »',
    cas(lue([], MOYENS.map((moyen, i) => encaissement({ id: `e-${moyen}`, facture_id: 'f1', montant: 10 + i, moyen }))))],
  ['sans mouvement : ni rattaché, ni retiré, ni d’une facture d’avant, ni d’un autre dossier', cas(lue([mouvement({ id: 'm1' })], [
    E1_SUR_M1,
    encaissement({ id: 'e2', facture_id: 'f2', montant: 100, retire_le: '2026-03-11T10:00:00Z' }),
    encaissement({ id: 'e3', facture_id: 'f0', montant: 100 }),
    encaissement({ id: 'e4', facture_id: 'f2', montant: 100, dossier_id: AUTRE }),
    encaissement({ id: 'e5', facture_id: 'f2', montant: 100 }),
  ]))],
  ['sans mouvement : la facture source d’un autre dossier ne compte pas', cas(lue([], [
    encaissement({ id: 'e1', facture_id: 'fx', montant: 100 }),
  ], { factures: [...FACTURES, facture({ id: 'fx', numero: 'F2026-0099', dossier_id: AUTRE })] }))],
  ['une contre-passation ne se compte pas ; son encaissement, s’il n’a pas eu lieu, non plus', cas(lue([], [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 120, moyen: 'cheque' }),
    encaissement({ id: 'c1', facture_id: 'f1', montant: -120, moyen: 'cheque', annule_id: 'e1' }),
  ]))],
  ['le chèque revenu impayé attend toujours le crédit de sa remise', cas(lue([mouvement({ id: 'm2', montant: -120 })], [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 120, moyen: 'cheque' }),
    encaissement({ id: 'c1', facture_id: 'f1', montant: -120, moyen: 'cheque', annule_id: 'e1', ligne_bancaire_id: 'm2' }),
  ]))],
  ['un encaissement daté d’un exercice figé se compte encore (VF7a)', cas(lue([], [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 100, moyen: 'cheque', date_encaissement: '2025-12-30' }),
    encaissement({ id: 'e2', facture_id: 'f1', montant: 100, date_encaissement: '2026-01-01' }),
    encaissement({ id: 'e3', facture_id: 'f1', montant: 10, moyen: 'autre', date_encaissement: '2025-12-30' }),
  ]), [null, '2025-12-31'])],
]

// ── CE QUE LA COPIE ET src/lib DISENT D'UN CAS ─────────────────────────────────────────────────────────────────────────

const formeVente = (v: VenteDeMouvement | null | undefined) => (v ? `${v.id}|${v.etat}` : 'rien')

function formeReleve(v: ReleveDe): string {
  if (v.etat !== 'lue') return JSON.stringify(v)
  return `lue ${[...v.mouvements.entries()].map(([id, m]) => `${id}=${formeVente(m)}`).join(',')}`
}

function formeChecklist(v: ChecklistDe, encaissements: readonly Encaissement[]): string {
  if (v.etat !== 'lue') return JSON.stringify(v)
  // Un filtre rend les MÊMES objets : l'appelant y relit ce que chaque encaissement porte.
  const memes = v.sansMouvement.every((e) => encaissements.includes(e))
  return `lue réservés ${v.reserves.map(formeVente).join(',')} ; sans mouvement ${v.sansMouvement.map((e) => e.id).join(',')} ; mêmes objets ${memes}`
}

/** Ce que les fonctions du bloc disent d'un cas, sous une forme comparable — l'ordre compris. Une copie qui lève le dit. */
function dit(copie: Copie, c: Cas): string[] {
  try {
    return ditSansLever(copie, c)
  } catch (e) {
    return [`lève : ${e instanceof Error ? e.message : String(e)}`]
  }
}

function ditSansLever(copie: Copie, { lecture, frontieres }: Cas): string[] {
  const sources = lecture?.etat === 'lue' ? lecture.sources : null
  const encaissements = sources?.encaissements ?? []
  const lignes = frontieres.map((f) => `checklist ${f} : ${formeChecklist(copie.ventesDeLaChecklist(lecture, f), encaissements)}`)
  if (lecture === null) return lignes
  lignes.push(`relevé : ${formeReleve(copie.ventesDuReleve(lecture.dossierId, lecture))}`)
  // Demandé pour un autre dossier que celui de la lecture : rien ne s'en décide.
  lignes.push(`relevé d’un autre dossier : ${formeReleve(copie.ventesDuReleve('dossier-demande', lecture))}`)
  if (!sources) return lignes
  const vente = { factures: sources.factures }
  for (const m of sources.mouvements) {
    const refus = copie.refusDuClassementDuReleve(m, sources.encaissements, vente)
    lignes.push(`refus ${m.id} : ${refus ? `${refus.cle} — ${refus.message}` : 'aucun'}`)
    lignes.push(`vente ${m.id} : ${formeVente(copie.mouvementDeVente(m, sources))}`)
    const portes = copie.encaissementsDuMouvement(m.id, sources.encaissements, vente)
    lignes.push(`portés ${m.id} : ${portes.map((e) => e.id).join(',')} ; dans l’ordre de la garde ${[...portes].sort(copie.ordreDesEncaissements).map((e) => e.id).join(',')}`)
  }
  lignes.push(`sans mouvement : ${copie.encaissementsEnregistresSansMouvement(sources).map((e) => e.id).join(',')}`)
  return lignes
}

/** Les constantes et la mise en forme des refus, hors de tout cas. */
function constantes(copie: Copie): string[] {
  const modeles: [string, string[]][] = [['% et %%', ['a']], ['aucune valeur', []], ['%, puis %', ['x', 'y']], ['%', []], ['rien', ['de trop']]]
  return [
    `moyens ${copie.MOYENS_DU_RELEVE.join(',')}`,
    ...copie.REFUS_GARDE_MOUVEMENTS.map((r) => `refus ${r.cle} : ${r.modele}`),
    ...modeles.map(([modele, valeurs]) => {
      try {
        return `modèle « ${modele} » : ${copie.remplirModele(modele, valeurs)}`
      } catch (e) {
        return `modèle « ${modele} » lève : ${(e as Error).message}`
      }
    }),
  ]
}

// ── UNE BATTERIE TIRÉE D'UNE GRAINE FIXE ───────────────────────────────────────────────────────────────────────────────
// Des identifiants qui départagent l'ordre de la base de celui de `localeCompare` (casse, ponctuation, accent), des
// créations à égalité, deux dossiers, des factures que la lecture ne rend pas ou qui sont d'un autre dossier, des
// contre-passations avec et sans mouvement, des retraits, les huit moyens, deux frontières.

const POOL_FACTURES = ['f1', 'F2', 'f-3', 'f_4', 'é5'] as const
const POOL_MOUVEMENTS = ['m1', 'M1', 'm-2', 'm_3', 'é4'] as const
const POOL_ENCAISSEMENTS = ['e1', 'E2', 'e_3', 'e-4', 'É5', 'e6', 'E7', 'e8'] as const
const DATES = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-03-12'] as const
const CREATIONS = ['2026-03-10T10:00:00Z', '2026-03-10T10:00:00Z', '2026-03-11T09:00:00Z', '2026-03-09T08:00:00Z'] as const

function batterie(nombre: number, graine: number): Cas[] {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const parmi = <T,>(liste: readonly T[]): T => liste[entier(liste.length)]
  const souvent = (p: number) => suivant() < p
  return Array.from({ length: nombre }, () => {
    const factures = POOL_FACTURES.filter(() => souvent(0.85)).map((id, k) => facture({
      id, numero: souvent(0.95) ? `F2026-00${k}${id.length}` : null, dossier_id: souvent(0.92) ? D : AUTRE,
      source_de_la_vente: souvent(0.6), statut: souvent(0.9) ? 'validee' : 'brouillon', type: souvent(0.85) ? 'facture' : 'avoir',
    }))
    const mouvements = POOL_MOUVEMENTS.filter(() => souvent(0.8)).map((id) => mouvement({
      id, dossier_id: souvent(0.92) ? D : AUTRE, date: parmi(DATES), montant: souvent(0.7) ? 600 : -600,
      encaissements_de_factures: souvent(0.2),
    }))
    // Deux mouvements par registre, que ses encaissements citent : plusieurs se retrouvent souvent sur le même.
    const cibles = [parmi(POOL_MOUVEMENTS), parmi(POOL_MOUVEMENTS)]
    const encaissements: Encaissement[] = []
    const n = entier(POOL_ENCAISSEMENTS.length + 1)
    for (let i = 0; i < n; i++) {
      const annulation = i > 0 && souvent(0.3)
      const montant = (1 + entier(60000)) / 100
      encaissements.push(encaissement({
        id: POOL_ENCAISSEMENTS[i],
        dossier_id: souvent(0.9) ? D : AUTRE,
        facture_id: souvent(0.95) ? parmi(POOL_FACTURES) : 'inconnue',
        montant: annulation ? -montant : montant,
        ligne_bancaire_id: souvent(0.55) ? parmi(cibles) : null,
        annule_id: annulation ? encaissements[entier(encaissements.length)].id : null,
        retire_le: souvent(0.12) ? '2026-03-15T10:00:00Z' : null,
        moyen: parmi(MOYENS),
        date_encaissement: parmi(DATES),
        cree_le: parmi(CREATIONS),
      }))
    }
    const r = suivant()
    const lecture: LectureDesVentesDuReleve = r < 0.04
      ? { dossierId: D, etat: 'incomplete', motif: 'les encaissements : 1000 lignes lues sur 1200' }
      : { dossierId: D, etat: 'lue', sources: { dossierId: r < 0.07 ? AUTRE : D, factures, encaissements, mouvements, exemplaires: [] } }
    return cas(lecture, [souvent(0.5) ? null : '2025-12-31'])
  })
}

const BATTERIE = batterie(1500, 20261029)
const TOUS: readonly [string, Cas][] = [...CAS_NOMMES, ...BATTERIE.map((c, i): [string, Cas] => [`cas tiré ${i}`, c])]
const ATTENDU = TOUS.map(([, c]) => dit(ICI, c))
const ATTENDU_CONSTANTES = constantes(ICI)

/** Les cas où la copie dit autre chose que src/lib, et les constantes qui diffèrent. */
function ecarts(copie: Copie): string[] {
  const parCas = TOUS.flatMap(([nom, c], i) => (JSON.stringify(dit(copie, c)) === JSON.stringify(ATTENDU[i]) ? [] : [nom]))
  return JSON.stringify(constantes(copie)) === JSON.stringify(ATTENDU_CONSTANTES) ? parCas : [...parCas, 'les constantes']
}

const lesReserves = (l: LectureDesVentesDuReleve | null, f: string | null = null) => {
  const v = ventesDeLaChecklist(l, f)
  return v.etat === 'lue' ? v.reserves.map((m) => `${m.id}|${m.etat}`) : v.etat
}
const lesSansMouvement = (l: LectureDesVentesDuReleve | null, f: string | null = null) => {
  const v = ventesDeLaChecklist(l, f)
  return v.etat === 'lue' ? v.sansMouvement.map((e) => e.id) : v.etat
}

describe('agent-comptable / bloc VENTES DU RELEVÉ (copie déployée, étape VF9c)', () => {
  it('n’est pas src/lib elle-même, et s’exécute seul : il n’emprunte rien au reste du fichier', () => {
    expect(deployee.ventesDeLaChecklist).not.toBe(ventesDeLaChecklist)
    expect(deployee.MOYENS_DU_RELEVE).not.toBe(MOYENS_DU_RELEVE)
    // Exécuté seul, sur un cas qui le parcourt entier : un mouvement réservé et un encaissement sans mouvement.
    const v = deployee.ventesDeLaChecklist(lue([mouvement({ id: 'm1' })], [E1_SUR_M1, encaissement({ id: 'e5', facture_id: 'f2', montant: 100 })]), null)
    expect(v).toMatchObject({ etat: 'lue', reserves: [{ id: 'm1', etat: 'reserve' }] })
    expect(v.etat === 'lue' ? v.sansMouvement.map((e) => e.id) : null).toEqual(['e5'])
  })

  it('ne définit que ce que ce test confronte ou plante', () => {
    const texte = bloc(sourceDeployee(), VENTES_DU_RELEVE)
    const definis = [...texte.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]).sort()
    expect(definis).toEqual([...NOMS, 'refusDeLaGarde'].sort())
  })

  it('porte les mêmes moyens, les mêmes refus de la garde et la même mise en forme que src/lib', () => {
    expect(constantes(deployee)).toEqual(ATTENDU_CONSTANTES)
    // Les deux refus que la garde oppose à tout autre classement d'un mouvement, sous leurs mots, et eux seuls.
    expect(deployee.REFUS_GARDE_MOUVEMENTS.map((r) => r.cle)).toEqual(['classe_par_ses_encaissements', 'reserve'])
  })

  it('dit, sur chaque cas nommé, ce que src/lib dit', () => {
    for (const [nom, c] of CAS_NOMMES) expect(dit(deployee, c), nom).toEqual(dit(ICI, c))
  })

  it('la table exerce ce qui décide', () => {
    // Sans ces résultats attendus, deux copies muettes seraient « d'accord » sur des listes vides.
    const reserves = Object.fromEntries(CAS_NOMMES.map(([nom, c]) => [nom, c.frontieres.map((f) => lesReserves(c.lecture, f))]))
    expect(reserves).toEqual({
      'sans objet pour un dossier qui n’a pas basculé': ['sans_objet'],
      'incomplète, avec son motif': ['incomplete'],
      'une lecture qui se dit d’un dossier et porte les sources d’un autre': ['incomplete'],
      'un crédit qu’un encaissement de facture source cite, pas encore classé : réservé': [['m1|reserve']],
      'le même, classé par ses encaissements': [[]],
      'un débit qu’une contre-passation cite : réservé ; un mouvement que rien ne cite, jamais': [['m2|reserve']],
      'l’encaissement d’une facture d’avant la bascule ne réserve rien': [[]],
      'un encaissement retiré ne réserve rien': [[]],
      'un encaissement qu’une contre-passation sans mouvement défait ne réserve rien': [[]],
      'un mouvement que la validation fige ne se compte plus ; le lendemain de la frontière, si': [['m1|reserve', 'm2|reserve'], ['m2|reserve']],
      'un mouvement d’un autre dossier que la lecture porterait': [[]],
      'réservé : la facture nommée est celle du premier encaissement par sa création': [['m1|reserve']],
      'réservé : à création égale, par l’identifiant, octet par octet': [['m1|reserve']],
      'réservé par une facture sans numéro : `raise` l’écrirait <NULL>': [['m1|reserve']],
      'le virement mixte, classé par ses encaissements': [[]],
      'sans mouvement : par virement, prélèvement, chèque, carte ou effet ; jamais en espèces, par compensation ni « autre »': [[]],
      'sans mouvement : ni rattaché, ni retiré, ni d’une facture d’avant, ni d’un autre dossier': [['m1|reserve']],
      'sans mouvement : la facture source d’un autre dossier ne compte pas': [[]],
      'une contre-passation ne se compte pas ; son encaissement, s’il n’a pas eu lieu, non plus': [[]],
      'le chèque revenu impayé attend toujours le crédit de sa remise': [['m2|reserve']],
      'un encaissement daté d’un exercice figé se compte encore (VF7a)': [[], []],
    })
    const sansMouvement = (nom: string, f: string | null = null) => {
      const c = CAS_NOMMES.find(([n]) => n === nom)
      if (!c) throw new Error(nom)
      return lesSansMouvement(c[1].lecture, f)
    }
    expect(sansMouvement('sans mouvement : par virement, prélèvement, chèque, carte ou effet ; jamais en espèces, par compensation ni « autre »'))
      .toEqual(['e-virement', 'e-prelevement', 'e-cheque', 'e-carte', 'e-effet'])
    expect(sansMouvement('sans mouvement : ni rattaché, ni retiré, ni d’une facture d’avant, ni d’un autre dossier')).toEqual(['e5'])
    expect(sansMouvement('sans mouvement : la facture source d’un autre dossier ne compte pas')).toEqual([])
    expect(sansMouvement('une contre-passation ne se compte pas ; son encaissement, s’il n’a pas eu lieu, non plus')).toEqual([])
    expect(sansMouvement('le chèque revenu impayé attend toujours le crédit de sa remise')).toEqual(['e1'])
    expect(sansMouvement('un encaissement daté d’un exercice figé se compte encore (VF7a)', '2025-12-31')).toEqual(['e1', 'e2'])
    // Le mouvement classé, et la facture que la garde nomme.
    const refus = (nom: string) => {
      const c = CAS_NOMMES.find(([n]) => n === nom)?.[1].lecture
      if (c?.etat !== 'lue') throw new Error(nom)
      return refusDuClassementDuReleve(c.sources.mouvements[0], c.sources.encaissements, c.sources)?.message
    }
    expect(refus('le virement mixte, classé par ses encaissements')).toMatch(/^Ce mouvement est classé par ses encaissements/)
    expect(refus('réservé : la facture nommée est celle du premier encaissement par sa création')).toContain('de la facture F2026-0015,')
    expect(refus('réservé : à création égale, par l’identifiant, octet par octet')).toContain('de la facture F2026-0015,')
    expect(refus('réservé par une facture sans numéro : `raise` l’écrirait <NULL>')).toContain('de la facture <NULL>,')
  })

  it('dit la même chose que src/lib sur une batterie de 1 500 dossiers tirés d’une graine fixe', () => {
    expect(ecarts(deployee)).toEqual([])
  })

  it('la batterie exerce chaque filtre là où il décide seul, et l’ordre de la base', () => {
    // Pour chaque encaissement d'une lecture entière, ce qui le retient de « sans mouvement », jugé par src/lib : un filtre
    // « décide seul » quand il est le seul à le retenir. Un filtre qui ne décide jamais seul ne serait pas gardé.
    const seul: Record<string, number> = {
      'autre dossier': 0, 'avec mouvement': 0, retiré: 0, 'pas une facture source du dossier': 0, 'n’a pas eu lieu': 0,
      'contre-passation': 0, 'moyen hors du relevé': 0,
    }
    let reserves = 0, classes = 0, figes = 0, sansMouvement = 0, nommeParLaGarde = 0, ordreDeLaBase = 0
    for (const c of BATTERIE) {
      const l = c.lecture
      if (l?.etat !== 'lue' || l.sources.dossierId !== D) continue
      const s = l.sources
      const sourcesDuDossier = new Set(s.factures.filter((f) => f.dossier_id === D && f.source_de_la_vente).map((f) => f.id))
      for (const e of s.encaissements) {
        const raisons = Object.entries({
          'autre dossier': e.dossier_id !== D,
          'avec mouvement': e.ligne_bancaire_id != null,
          retiré: e.retire_le != null,
          'pas une facture source du dossier': !sourcesDuDossier.has(e.facture_id),
          'n’a pas eu lieu': !justifieSonMouvement(e, s.encaissements),
          'contre-passation': e.annule_id != null,
          'moyen hors du relevé': !(MOYENS_DU_RELEVE as readonly string[]).includes(e.moyen),
        }).filter(([, vrai]) => vrai).map(([raison]) => raison)
        if (raisons.length === 1) seul[raisons[0]]++
      }
      const v = ventesDeLaChecklist(l, c.frontieres[0])
      if (v.etat !== 'lue') continue
      reserves += v.reserves.length
      sansMouvement += v.sansMouvement.length
      const releve = ventesDuReleve(true, D, l, ACCES_SANS_OBJET)
      if (releve.etat !== 'lue') continue
      for (const m of releve.mouvements.values()) {
        if (m.etat === 'classe') classes++
        const date = s.mouvements.find((x) => x.id === m.id)?.date ?? ''
        if (m.etat === 'reserve' && c.frontieres[0] !== null && date <= c.frontieres[0]) figes++
        if (m.etat !== 'reserve') continue
        // La facture que la garde nomme n'est pas celle du premier encaissement reçu ; l'ordre octet par octet n'est pas
        // celui de la locale.
        const portes = encaissementsDuMouvement(m.id, s.encaissements, s)
        const numero = (e: Encaissement) => s.factures.find((f) => f.id === e.facture_id)?.numero
        if (portes.length > 1 && numero(portes[0]) !== numero([...portes].sort(ordreDesEncaissements)[0])) nommeParLaGarde++
        const selonLaLocale = [...portes].sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
        if (JSON.stringify(selonLaLocale.map((e) => e.id)) !== JSON.stringify([...portes].sort(ordreDesEncaissements).map((e) => e.id))) ordreDeLaBase++
      }
    }
    // Des planchers, à la moitié environ de ce que la graine donne (relevé le 27/10/2026) : une batterie qui s'appauvrirait
    // en silence tomberait ici avant de laisser passer une dérive.
    // Des planchers, à la moitié environ de ce que la graine donne (relevé le 27/10/2026) : une batterie qui s'appauvrirait
    // en silence tomberait ici avant de laisser passer une dérive.
    const planchers: Record<string, number> = {
      'autre dossier': 20, 'avec mouvement': 200, retiré: 25, 'pas une facture source du dossier': 250, 'n’a pas eu lieu': 15,
      'contre-passation': 50, 'moyen hors du relevé': 100,
    }
    for (const [raison, n] of Object.entries(seul)) expect(n, `le filtre « ${raison} » ne décide jamais seul`).toBeGreaterThan(planchers[raison])
    expect(reserves).toBeGreaterThan(200)
    expect(classes).toBeGreaterThan(450)
    expect(figes).toBeGreaterThan(50)
    expect(sansMouvement).toBeGreaterThan(180)
    expect(nommeParLaGarde).toBeGreaterThan(30)
    expect(ordreDeLaBase).toBeGreaterThan(25)
  })
})

describe('la garde du bloc VENTES DU RELEVÉ sait encore échouer', () => {
  // Une ancre qui figurerait deux fois ferait planter la dérive au mauvais endroit : `muter` l'exige unique.
  const planter = (avant: string, apres: string) => muter(sourceDeployee(), [[avant, apres]])

  const DERIVES: [string, string, string][] = [
    ['REFUS_GARDE_MOUVEMENTS : les mots du refus d’un mouvement réservé',
      '"Ce mouvement justifie un encaissement de la facture %, source de sa vente', '"Ce mouvement justifie un encaissement de la facture %, source de ses ventes'],
    ['REFUS_GARDE_MOUVEMENTS : les mots du refus d’un mouvement classé',
      ' il ne reçoit aucun autre classement — le cabinet retire d\'abord celui-ci."', ' il ne reçoit aucun autre classement."'],
    ['remplirModele : le modèle rendu sans ses valeurs', '  return texte\n}\n\nfunction refusDeLaGarde(', '  return modele\n}\n\nfunction refusDeLaGarde('],
    ['remplirModele : « %% » laissé tel quel', '(m === "%%" ? "%" : valeurs[i++] ?? "")', '(m === "%%" ? "%%" : valeurs[i++] ?? "")'],
    ['refusDeLaGarde : le numéro de la facture altéré',
      '  return { cle, message: remplirModele(modele, valeurs) }\n', '  return { cle, message: remplirModele(modele, valeurs.map((v) => v.toLowerCase())) }\n'],
    ['ordreDesEncaissements : l’identifiant dans l’ordre de la locale',
      '  return ordreC(a.cree_le, b.cree_le) || ordreC(a.id, b.id)\n', '  return ordreC(a.cree_le, b.cree_le) || a.id.localeCompare(b.id)\n'],
    ['ordreDesEncaissements : la création ignorée', '  return ordreC(a.cree_le, b.cree_le) || ordreC(a.id, b.id)\n', '  return ordreC(a.id, b.id)\n'],
    ['encaissementsDuMouvement : un encaissement retiré réserve', 'x.ligne_bancaire_id === mouvementId && compte(x)\n', 'x.ligne_bancaire_id === mouvementId\n'],
    ['encaissementsDuMouvement : l’encaissement d’une facture d’avant réserve',
      '    && factureSource(x.facture_id, vente) && justifieSonMouvement(x, encaissements))\n', '    && justifieSonMouvement(x, encaissements))\n'],
    ['encaissementsDuMouvement : un encaissement qui n’a pas eu lieu réserve',
      '    && factureSource(x.facture_id, vente) && justifieSonMouvement(x, encaissements))\n', '    && factureSource(x.facture_id, vente))\n'],
    ['refusDuClassementDuReleve : un mouvement classé se dit réservé',
      '  if (mouvement.encaissements_de_factures) return refusDeLaGarde("classe_par_ses_encaissements")\n', ''],
    ['refusDuClassementDuReleve : la facture du premier encaissement reçu, pas du premier de la garde',
      'encaissementsDuMouvement(mouvement.id, encaissements, vente).sort(ordreDesEncaissements)[0]', 'encaissementsDuMouvement(mouvement.id, encaissements, vente)[0]'],
    ['refusDuClassementDuReleve : une facture sans numéro', '?.numero ?? "<NULL>"', '?.numero ?? ""'],
    ['mouvementDeVente : classé et réservé échangés',
      'etat: refus.cle === "classe_par_ses_encaissements" ? "classe" : "reserve"', 'etat: refus.cle === "reserve" ? "classe" : "reserve"'],
    ['ventesDuReleve : le mouvement d’un autre dossier', '    if (m.dossier_id !== dossierId) continue\n', ''],
    ['ventesDuReleve : les sources d’un autre dossier', '  if (lecture.sources.dossierId !== dossierId) return { etat: "en_cours" }\n', ''],
    ['ventesDuReleve : la lecture d’un autre dossier que celui demandé',
      '  if (lecture === null || lecture.dossierId !== dossierId) return { etat: "en_cours" }\n', '  if (lecture === null) return { etat: "en_cours" }\n'],
    ['ventesDuReleve : le motif d’une lecture incomplète perdu',
      '  if (lecture.etat === "incomplete") return { etat: "incomplete", motif: lecture.motif }\n  if (lecture.sources.dossierId',
      '  if (lecture.etat === "incomplete") return { etat: "incomplete", motif: "incomplète" }\n  if (lecture.sources.dossierId'],
    ['encaissementsEnregistresSansMouvement : la facture source d’un autre dossier',
      's.factures.filter((f) => f.dossier_id === s.dossierId && f.source_de_la_vente)', 's.factures.filter((f) => f.source_de_la_vente)'],
    ['encaissementsEnregistresSansMouvement : l’encaissement d’un autre dossier',
      'e.dossier_id === s.dossierId && e.ligne_bancaire_id == null', 'e.ligne_bancaire_id == null'],
    ['encaissementsEnregistresSansMouvement : un encaissement retiré',
      '    && e.retire_le == null && sources.has(e.facture_id) && justifieSonMouvement(e, s.encaissements))',
      '    && sources.has(e.facture_id) && justifieSonMouvement(e, s.encaissements))'],
    ['encaissementsEnregistresSansMouvement : un encaissement qui n’a pas eu lieu',
      '    && e.retire_le == null && sources.has(e.facture_id) && justifieSonMouvement(e, s.encaissements))',
      '    && e.retire_le == null && sources.has(e.facture_id))'],
    ['MOYENS_DU_RELEVE : l’effet oublié', '["virement", "prelevement", "cheque", "carte", "effet"]', '["virement", "prelevement", "cheque", "carte"]'],
    ['ventesDeLaChecklist : un mouvement figé compté',
      'return vente?.etat === "reserve" && !estFigee(m.date, frontiere) ? [vente] : []', 'return vente?.etat === "reserve" ? [vente] : []'],
    ['ventesDeLaChecklist : un mouvement classé compté parmi les réservés',
      'return vente?.etat === "reserve" && !estFigee(m.date, frontiere) ? [vente] : []', 'return vente !== undefined && !estFigee(m.date, frontiere) ? [vente] : []'],
    ['ventesDeLaChecklist : une contre-passation comptée sans mouvement',
      '.filter((e) => e.annule_id == null && MOYENS_DU_RELEVE.includes(e.moyen))', '.filter((e) => MOYENS_DU_RELEVE.includes(e.moyen))'],
    ['ventesDeLaChecklist : le motif d’une lecture incomplète perdu',
      '  if (lecture === null) return { etat: "sans_objet" }\n  if (lecture.etat === "incomplete") return { etat: "incomplete", motif: lecture.motif }\n',
      '  if (lecture === null) return { etat: "sans_objet" }\n  if (lecture.etat === "incomplete") return { etat: "incomplete", motif: "incomplète" }\n'],
    ['ventesDeLaChecklist : une lecture mêlée prise pour lue',
      '  if (ventes.etat !== "lue") return { etat: "incomplete", motif: "la lecture rendue n’est pas celle de ce dossier" }\n', ''],
    // Le bloc VALIDATION qu'il lit : la frontière elle-même figée.
    ['estFigee : le jour de la frontière pris pour libre', '  return frontiere !== null && date <= frontiere\n', '  return frontiere !== null && date < frontiere\n'],
  ]
  for (const [quoi, avant, apres] of DERIVES) {
    it(`attrape ${quoi}`, () => {
      expect(ecarts(copieDe(planter(avant, apres))).length).toBeGreaterThan(0)
    })
  }

  it('chaque fonction et chaque constante du bloc porte au moins une dérive plantée', () => {
    const visees = DERIVES.map(([quoi]) => quoi.split(' : ')[0])
    for (const nom of [...NOMS, 'refusDeLaGarde']) expect(visees, nom).toContain(nom)
  })
})

// ── CE QUE L'ASSISTANT DEMANDE À LA BASE : `ventes_facturees_de_l_exercice` ───────────────────────────────────────────
// Sa troisième clé, les ventes facturées que la validation refuserait, l'assistant ne la recompose pas : il la lit dans la
// base (conception de VF9, § 3). La fonction s'exécute AUX DROITS DE L'APPELANT — elle n'est pas `security definer` —, et
// la migration la retire à `public`, `anon` et `authenticated` : seul le rôle du service, sous lequel l'assistant la lit,
// l'exécute, avec chacune des fonctions qu'elle appelle (relevé au catalogue de la production le 27/10/2026). Un retrait de
// ce droit au rôle du service ferait taire la clé en panne — « indisponible » — sans qu'aucun autre test ne le voie : ce
// qui suit le refuse dans l'export, sur la fonction et sur toute sa chaîne.

const FONCTION = 'ventes_facturees_de_l_exercice'

/** Les fonctions de l'export que la dernière définition de `nom` appelle, elle comprise, de proche en proche. */
function chaineDe(nom: string): string[] {
  const exportees = new Set(fichiersDuSchema().flatMap((f) => [...f.texte.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((m) => m[1])))
  const vues = new Set<string>()
  const a = [nom]
  while (a.length > 0) {
    const courante = a.pop() as string
    if (vues.has(courante)) continue
    vues.add(courante)
    const corps = derniereDefinitionSql(courante)
    const apresLaSignature = corps.slice(corps.indexOf('$$'))
    for (const m of apresLaSignature.matchAll(/(?<![\w.])(?:public\.)?(\w+)\s*\(/g)) if (exportees.has(m[1]) && !vues.has(m[1])) a.push(m[1])
  }
  return [...vues].sort()
}

describe('ventes_facturees_de_l_exercice : ce que l’assistant demande à la base (étape VF9c)', () => {
  const definition = derniereDefinitionSql(FONCTION)
  const entete = definition.slice(0, definition.indexOf('$$'))
  const instructions = fichiersDuSchema().flatMap((f) => f.texte.match(/\b(?:revoke|grant|alter default privileges)\b[^;]*;/gi) ?? [])

  it('s’exécute aux droits de l’appelant, que la migration retire à toute session', () => {
    expect(entete).toMatch(/^create function public\.ventes_facturees_de_l_exercice\(p_dossier_id uuid, p_annee integer\)\nreturns table \(/)
    expect(entete).not.toMatch(/security definer/i)
    expect(instructions).toContain(`revoke execute on function public.${FONCTION}(uuid, integer) from public, anon, authenticated;`)
  })

  it('appelle une chaîne de fonctions que le relevé du catalogue a jugée, la sienne comprise', () => {
    expect(chaineDe(FONCTION)).toEqual([
      'centimes_ligne_facture', 'compte_du_role', 'ecritures_attendues_de_la_periode', 'frontiere_validation',
      'montants_par_taux_facture', 'mouvement_libre', 'refus_compte_de_contrepartie', FONCTION,
    ])
  })

  it('aucune instruction de l’export ne retire au rôle du service l’exécution de cette chaîne', () => {
    const chaine = chaineDe(FONCTION)
    const fautives = instructions.filter((i) => /\bservice_role\b/i.test(i) && /\brevoke\b/i.test(i)
      && (/\ball functions\b/i.test(i) || /default privileges/i.test(i) || chaine.some((nom) => new RegExp(`\\bpublic\\.${nom}\\(`).test(i))))
    expect(fautives).toEqual([])
    // Le garde symétrique : le filtre reconnaît un tel retrait, sur la fonction comme en bloc.
    const plante = [`revoke execute on function public.${FONCTION}(uuid, integer) from service_role;`, 'revoke all on all functions in schema public from service_role;']
    expect(plante.filter((i) => /\bservice_role\b/i.test(i) && /\brevoke\b/i.test(i)
      && (/\ball functions\b/i.test(i) || chaine.some((nom) => new RegExp(`\\bpublic\\.${nom}\\(`).test(i))))).toEqual(plante)
  })

  it('l’assistant l’appelle par ses paramètres, trie sur ses colonnes, et lit ce qu’elle rend', () => {
    const source = sourceDeployee()
    const parametres = [...entete.slice(entete.indexOf('(') + 1, entete.indexOf(')')).matchAll(/(\w+) \w+/g)].map((m) => m[1])
    const rendues = [...(/returns table \(([^)]*)\)/.exec(entete)?.[1] ?? '').matchAll(/(\w+) \w+/g)].map((m) => m[1])
    expect(parametres).toEqual(['p_dossier_id', 'p_annee'])
    const appel = /admin\.rpc\("ventes_facturees_de_l_exercice", \{ ([^}]*) \}, \{ count: "exact" \}\)\n\s*((?:\.order\("\w+"\))+)\.range\(debut, fin\)\)/.exec(source)
    expect(appel, 'l’appel de l’assistant introuvable ou réécrit — garde à remettre à jour').not.toBeNull()
    expect([...(appel?.[1] ?? '').matchAll(/(\w+):/g)].map((m) => m[1])).toEqual(parametres)
    expect([...(appel?.[2] ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual(['jour', 'source', 'source_id'])
    const ligne = /\ninterface SourceEnDefautRow \{\n([^}]*)\}/.exec(source)?.[1] ?? ''
    expect([...ligne.matchAll(/(\w+):/g)].map((m) => m[1])).toEqual(rendues)
    expect(source.split(`"${FONCTION}"`).length - 1).toBe(1)
  })
})
