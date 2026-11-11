import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as src from './banqueDuMouvement'
import { COMPTES_BANCAIRES_PREVUS, compteDeBanqueDuMouvement } from './comptesBancaires'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { ecritureDuCompteDeBilan, mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { ecritureDuPaiementTva, paiementsTvaDesynchronises } from './liquidationTva'
import { analyserEcritures, lignesPourPiece, type CibleComptable } from './ecritures'
import { paiementsDesPieces } from './rattachement'
import { PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import type { ModeleComptable } from './engagement'
import type { EcritureBrouillon, LigneBancaire, Piece } from './types'
import { NON_VALIDEE } from '../test/ecritures'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../test/modeles'
import { SANS_VIREMENT_MIXTE } from '../test/ventesFacturees'
import { blocDesBanques } from '../test/copieAuPlan'

// LA JAMBE DE BANQUE PAR COMPTE BANCAIRE, DANS L'ASSISTANT (MCB5, cinquième partie ; ligne 26.6).
//
// `agent-comptable` est auto-portée : elle recopie src/lib/banqueDuMouvement.ts entre les bornes `── DÉBUT/FIN BANQUES DU
// DOSSIER`, et ses détecteurs et la contrepartie d'une pièce la lisent. Les gardes de chaque bloc comparent la copie à
// src/lib sous la banque du rôle (le drapeau baissé : l'assistant d'hier) ; celui-ci la compare sous DEUX comptes — un
// mouvement du livret s'écrit au 512 du livret, une banque inconnue ne se juge pas —, et plante des dérives pour prouver
// qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant dirait « à réécrire » l'écriture juste d'un mouvement du livret, ou « rien à
// signaler » sur une écriture restée au compte courant, à un comptable qui n'ira pas vérifier.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

function bornes(source: string, nom: string): string {
  const debut = source.indexOf(`// ── DÉBUT ${nom}`)
  const fin = source.indexOf(`// ── FIN ${nom}`)
  expect(debut, `bornes du bloc ${nom} introuvables`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return source.slice(debut, fin)
}

function executer<T>(bloc: string, noms: string): T {
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ${noms} }`)() as T
}

type Bloc = typeof src & { compteDeBanqueDuMouvement: typeof compteDeBanqueDuMouvement; COMPTES_BANCAIRES_PREVUS: boolean }
const blocDe = (source: string) => executer<Bloc>(blocDesBanques(source),
  'COMPTES_BANCAIRES_PREVUS, compteDeBanqueDuMouvement, banquesDuDossier, banqueDuMouvement, planDuMouvement, modeleDuMouvement, '
  + 'planPourJuger, modelePourJuger, comptesDeBanqueDuDossier, refusDesBanquesDesPaiements')

interface Detecteurs {
  mouvementsSurUnCompteDeBilanDesynchronises: (e: EcritureBrouillon[], l: LigneBancaire[], f: string | null, p: PlanComptable, b: src.BanquesDuDossier) => { id: string }[]
  paiementsTvaDesynchronises: (e: EcritureBrouillon[], l: LigneBancaire[], f: string | null, p: PlanComptable, b: src.BanquesDuDossier) => { id: string }[]
}
const detecteursDe = (source: string) => executer<Detecteurs>(
  `${bornes(source, 'VALIDATION')}\n${blocDesBanques(source)}\n${bornes(source, 'AFFECTATION')}\n${bornes(source, 'COMPTE DE BILAN')}\n${bornes(source, 'LIQUIDATION TVA')}`,
  'mouvementsSurUnCompteDeBilanDesynchronises, paiementsTvaDesynchronises')

interface Analyse {
  lignesPourPiece: (p: Piece, c: CibleComptable, a: boolean, paiements: readonly unknown[], m: ModeleComptable, b: src.BanquesDuDossier) => { date: string; compte: string; sens: string; montant: number; ligne_bancaire_id?: string | null }[]
  analyserEcritures: (e: EcritureBrouillon[], a: ({ piece: Piece } & CibleComptable)[], assujetti: boolean, paiements: ReturnType<typeof paiementsDesPieces>,
    m: ModeleComptable, f: string | null, exemplaires: ReadonlySet<string>, b: src.BanquesDuDossier) => { piecesDesynchronisees: Piece[]; piecesSansContrepartie: string[] }
  paiementsDesPieces: typeof paiementsDesPieces
}
function analyseDe(source: string): Analyse {
  const debut = source.indexOf('// ---- Dupliqué depuis src/lib/ecritures.ts')
  const ancre = source.indexOf('function analyserEcritures(', debut)
  const fin = source.indexOf('\n}\n', ancre)
  expect(debut).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(ancre)
  return executer<Analyse>(source.slice(debut, fin + 2), 'lignesPourPiece, analyserEcritures, paiementsDesPieces')
}

/** Une dérive plantée dans la vraie source : l'ancre doit y être une seule fois. */
function planter(source: string, avant: string, apres: string): string {
  expect(source.split(avant).length - 1, `ancre à planter introuvable ou ambiguë : ${avant}`).toBe(1)
  return source.replace(avant, apres)
}

const PLAN = PLAN_PAR_DEFAUT
const LIVRET = '512100'
const compte = (o: Partial<CompteDuReleve>): CompteDuReleve => ({
  id: 'cp', libelle: 'Compte courant', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null,
  ouvert_le: null, clos_le: null, ...o,
})
const DEUX_COMPTES: LectureDesComptes = { etat: 'lus', comptes: [compte({}), compte({ id: 'cl', libelle: 'Livret', principal: false, compte: LIVRET, compte_propre_depuis: '2026-01-01' })] }
const LECTURES: readonly LectureDesComptes[] = [
  { etat: 'sans_objet' }, { etat: 'en_cours' }, { etat: 'illisible', motif: 'lecture incomplète' }, { etat: 'lus', comptes: [] },
  { etat: 'lus', comptes: [compte({})] }, DEUX_COMPTES,
  { etat: 'lus', comptes: [compte({}), compte({ id: 'cl', principal: false, compte: LIVRET, compte_propre_depuis: null })] },
]
const PAR_COMPTE = src.banquesDuDossier(DEUX_COMPTES, PLAN)
const ROLE = src.banquesDuDossier({ etat: 'sans_objet' }, PLAN)
const RETENU = src.banquesDuDossier({ etat: 'illisible', motif: 'x' }, PLAN)
const MOUVEMENTS = [
  { date: '2026-03-05', compte_bancaire_id: 'cl' }, { date: '2025-12-31', compte_bancaire_id: 'cl' }, { date: '2026-01-01', compte_bancaire_id: 'cl' },
  { date: '2026-03-05', compte_bancaire_id: 'cp' }, { date: '2026-03-05', compte_bancaire_id: 'inconnu' }, { date: '2026-03-05', compte_bancaire_id: null },
  { date: '2026-03-05' },
]
const BANQUES = [ROLE, PAR_COMPTE, RETENU, src.banquesDuDossier({ etat: 'en_cours' }, PLAN)]
const MODELE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { ...MODELE, mode: 'engagement' }

function memeBloc(copie: Bloc) {
  expect(copie.COMPTES_BANCAIRES_PREVUS).toBe(COMPTES_BANCAIRES_PREVUS)
  for (const lecture of LECTURES) expect(copie.banquesDuDossier(lecture, PLAN)).toEqual(src.banquesDuDossier(lecture, PLAN))
  for (const banques of BANQUES) {
    expect([...copie.comptesDeBanqueDuDossier(PLAN, banques)].sort()).toEqual([...src.comptesDeBanqueDuDossier(PLAN, banques)].sort())
    for (const m of MOUVEMENTS) {
      expect(copie.banqueDuMouvement(m, banques)).toEqual(src.banqueDuMouvement(m, banques))
      expect(copie.planPourJuger(PLAN, m, banques)).toEqual(src.planPourJuger(PLAN, m, banques))
      expect(copie.modelePourJuger(MODELE, m, banques)).toEqual(src.modelePourJuger(MODELE, m, banques))
      expect(copie.refusDesBanquesDesPaiements([{ ...m, id: 'l', origine: 'rapprochement' }, { origine: 'caisse' }], banques))
        .toEqual(src.refusDesBanquesDesPaiements([{ ...m, id: 'l', origine: 'rapprochement' }, { origine: 'caisse' }], banques))
    }
  }
  for (const c of [compte({ id: 'cl', principal: false, compte: LIVRET, compte_propre_depuis: '2026-01-01' }), compte({})]) {
    for (const date of ['2025-12-31', '2026-01-01', '2026-01-01T10:00:00Z']) {
      expect(copie.compteDeBanqueDuMouvement(c, date, PLAN.banque)).toBe(compteDeBanqueDuMouvement(c, date, PLAN.banque))
    }
  }
}

describe('agent-comptable / bloc BANQUES DU DOSSIER (copie déployée)', () => {
  it('redit le drapeau et les fonctions de src/lib/banqueDuMouvement.ts, sous chaque lecture et chaque mouvement', () => {
    memeBloc(blocDe(sourceDeployee()))
  })
  it('ne lit des comptes que l’identifiant opaque, le principal, le 512 et sa date, au jeton de l’appelant, le drapeau levé seulement', () => {
    const source = sourceDeployee()
    const corps = source.slice(source.indexOf('async function lireLesComptesDuDossier('), source.indexOf('async function piecesCiteesDuDossier('))
    expect(corps).toContain('if (!COMPTES_BANCAIRES_PREVUS) return { etat: "sans_objet" }')
    expect(corps).toContain('appelant.from("comptes_bancaires").select("id, dossier_id, principal, compte, compte_propre_depuis", { count: "exact" })')
    expect(corps).not.toMatch(/libelle|fin_d_identifiant|admin\./)
  })
})

// Les fabriques : un mouvement du livret, et les écritures que src/lib compose pour lui sous le plan d'un 512 donné.
const ligne = (o: Omit<Partial<LigneBancaire>, 'compte_bancaire_id'> & { compte_bancaire_id?: string | null }): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2026-03-05', libelle: 'VIR', montant: -1000, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: null, libelle_brut: null, created_at: '2026-03-06T09:00:00Z',
  encaissements_de_factures: false, compte_bancaire_id: 'cl', ...o,
}) as LigneBancaire
const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: 'l', date: '2026-03-05', compte: PLAN.banque,
  libelle: 'VIR', sens: 'credit', montant: 1000, statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
  ...NON_VALIDEE, created_at: '2026-03-06T09:00:00Z', encaissement_id: null, facture_id: null, ...o,
})
const auPlan = (banque: string): PlanComptable => ({ ...PLAN, banque })
const ecrites = (l: LigneBancaire, lignes: readonly { compte: string; sens: string; montant: number }[]) =>
  lignes.map((e, i) => ecriture({ id: `${l.id}-${i}`, ligne_bancaire_id: l.id, date: l.date, compte: e.compte, sens: e.sens as 'debit' | 'credit', montant: e.montant }))

const SCENARIOS = (composer: (l: LigneBancaire, plan: PlanComptable) => readonly { compte: string; sens: string; montant: number }[], o: Partial<LigneBancaire>) => {
  const livret = ligne({ id: 'livret', ...o })
  const courant = ligne({ id: 'courant', compte_bancaire_id: 'cp', ...o })
  const inconnu = ligne({ id: 'inconnu', compte_bancaire_id: 'autre', ...o })
  return {
    lignes: [livret, courant, inconnu],
    // Le livret au 512 du livret, le compte courant au 512 du rôle : justes. Puis les mêmes, la banque permutée : fausses.
    justes: [...ecrites(livret, composer(livret, auPlan(LIVRET))), ...ecrites(courant, composer(courant, PLAN)), ...ecrites(inconnu, composer(inconnu, PLAN))],
    fausses: [...ecrites(livret, composer(livret, PLAN)), ...ecrites(courant, composer(courant, auPlan(LIVRET))), ...ecrites(inconnu, composer(inconnu, auPlan(LIVRET)))],
  }
}
const ids = (r: readonly { id: string }[]) => r.map((x) => x.id).sort()

describe('agent-comptable / les détecteurs sous deux comptes bancaires (copie déployée)', () => {
  const cas = [
    ['COMPTE DE BILAN', 'mouvementsSurUnCompteDeBilanDesynchronises', mouvementsSurUnCompteDeBilanDesynchronises,
      SCENARIOS((l, plan) => ecritureDuCompteDeBilan(l, l.compte_bilan!, plan), { compte_bilan: PLAN.virements_internes })],
    ['LIQUIDATION TVA', 'paiementsTvaDesynchronises', paiementsTvaDesynchronises,
      SCENARIOS((l, plan) => ecritureDuPaiementTva(l, plan), { declaration_tva_id: 'decl' })],
  ] as const
  for (const [bloc, nom, deSrc, s] of cas) {
    it(`${bloc} : le mouvement du livret au 512 du livret, la banque inconnue non jugée, comme src/lib`, () => {
      const copie = detecteursDe(sourceDeployee())[nom]
      for (const banques of BANQUES) {
        for (const e of [s.justes, s.fausses]) expect(ids(copie(e, [...s.lignes], null, PLAN, banques))).toEqual(ids(deSrc(e, [...s.lignes], null, PLAN, banques)))
      }
      expect(ids(copie(s.justes, [...s.lignes], null, PLAN, PAR_COMPTE))).toEqual([])
      expect(ids(copie(s.fausses, [...s.lignes], null, PLAN, PAR_COMPTE))).toEqual(['courant', 'livret'])
      expect(ids(copie(s.fausses, [...s.lignes], null, PLAN, RETENU))).toEqual([])
    })
  }
})

// La pièce payée par un mouvement du livret : la contrepartie au 512 du livret, en trésorerie et en engagement.
const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p1', dossier_id: 'd', statut: 'validee', type_piece: 'achat', date_piece: '2026-03-01',
  montant_ht: 100, montant_tva: 20, montant_ttc: 120, categorie_id: 'cat', created_at: '2026-03-01T09:00:00Z', nom_fichier: 'f.pdf', ...o,
}) as Piece
const CIBLE: CibleComptable = { compte: '606100', immobilisation: false }
const paye = (compteBancaire: string | null | undefined) => ligne({ id: 'lp', piece_id: 'p1', montant: -120, compte_bancaire_id: compteBancaire })

function memePiece(copie: Analyse) {
  for (const modele of [MODELE, ENGAGEMENT]) {
    for (const compteBancaire of ['cl', 'cp', 'autre', undefined]) {
      const releve = [paye(compteBancaire)]
      const paiements = paiementsDesPieces(releve, [], SANS_VIREMENT_MIXTE, [])
      expect(copie.paiementsDesPieces(releve, [], SANS_VIREMENT_MIXTE, [])).toEqual(paiements)
      for (const banques of BANQUES) {
        const p = piece()
        const attendues = lignesPourPiece('d', p, CIBLE, true, paiements.get('p1') ?? [], modele, banques)
        expect(copie.lignesPourPiece(p, CIBLE, true, paiements.get('p1') ?? [], modele, banques))
          .toEqual(attendues.map(({ date, compte, sens, montant, ligne_bancaire_id }) => ({ date, compte, sens, montant, ...(ligne_bancaire_id ? { ligne_bancaire_id } : {}) })))
        // Le brouillon écrit sous la banque du rôle, puis sous celle du livret : la copie le juge comme src/lib.
        for (const banque of [PLAN.banque, LIVRET]) {
          const brouillon = lignesPourPiece('d', p, CIBLE, true, paiements.get('p1') ?? [], modele, ROLE)
            .map((l, i) => ecriture({ id: `e${i}`, piece_id: 'p1', ligne_bancaire_id: l.ligne_bancaire_id ?? null, date: l.date,
              compte: l.compte === PLAN.banque ? banque : l.compte, sens: l.sens, montant: l.montant }))
          const a = [{ piece: p, ...CIBLE }]
          const deSrc = analyserEcritures(brouillon, a, true, paiements, modele, null, new Set(), banques)
          const ici = copie.analyserEcritures(brouillon, a, true, paiements, modele, null, new Set(), banques)
          expect(ids(ici.piecesDesynchronisees)).toEqual(ids(deSrc.piecesDesynchronisees))
          expect(ici.piecesSansContrepartie).toEqual(deSrc.piecesSansContrepartie)
        }
      }
    }
  }
  // Le cas qui compte : payée par le livret, écrite au 512 du livret, rien à régénérer ; restée au rôle, à régénérer.
  const releve = [paye('cl')]
  const paiements = paiementsDesPieces(releve, [], SANS_VIREMENT_MIXTE, [])
  const juste = lignesPourPiece('d', piece(), CIBLE, true, paiements.get('p1') ?? [], MODELE, PAR_COMPTE)
  expect(juste.some((l) => l.compte === LIVRET)).toBe(true)
  const brouillon = (banque: string) => juste.map((l, i) => ecriture({ id: `e${i}`, piece_id: 'p1', ligne_bancaire_id: l.ligne_bancaire_id ?? null,
    date: l.date, compte: l.compte === LIVRET ? banque : l.compte, sens: l.sens, montant: l.montant }))
  const a = [{ piece: piece(), ...CIBLE }]
  expect(ids(copie.analyserEcritures(brouillon(LIVRET), a, true, paiements, MODELE, null, new Set(), PAR_COMPTE).piecesDesynchronisees)).toEqual([])
  expect(ids(copie.analyserEcritures(brouillon(PLAN.banque), a, true, paiements, MODELE, null, new Set(), PAR_COMPTE).piecesDesynchronisees)).toEqual(['p1'])
  expect(copie.analyserEcritures(brouillon(LIVRET), a, true, paiements, MODELE, null, new Set(), PAR_COMPTE).piecesSansContrepartie).toEqual([])
  // Une pièce que rien ne paie, dont une ligne est au 512 du livret : une contrepartie de banque, jamais « sans contrepartie ».
  const sansPaiement = new Map()
  for (const modele of [MODELE, ENGAGEMENT]) {
    const deSrc = analyserEcritures(brouillon(LIVRET), a, true, sansPaiement, modele, null, new Set(), PAR_COMPTE)
    const ici = copie.analyserEcritures(brouillon(LIVRET), a, true, sansPaiement, modele, null, new Set(), PAR_COMPTE)
    expect(ici.piecesSansContrepartie).toEqual(deSrc.piecesSansContrepartie)
    expect(ids(ici.piecesDesynchronisees)).toEqual(ids(deSrc.piecesDesynchronisees))
  }
  expect(copie.analyserEcritures(brouillon(LIVRET), a, true, sansPaiement, MODELE, null, new Set(), PAR_COMPTE).piecesSansContrepartie).toEqual([])
}

describe('agent-comptable / la contrepartie d’une pièce sous deux comptes bancaires (copie déployée)', () => {
  it('écrit et juge la contrepartie au 512 du compte du mouvement, retient la pièce d’une banque inconnue, comme src/lib', () => {
    memePiece(analyseDe(sourceDeployee()))
  })
})

describe('le garde-fou du bloc BANQUES DU DOSSIER sait encore échouer', () => {
  const echoue = (f: () => void) => expect(f).toThrow()
  it('attrape un drapeau qui diverge de src/lib', () => {
    echoue(() => memeBloc(blocDe(planter(sourceDeployee(), 'const COMPTES_BANCAIRES_PREVUS = false', 'const COMPTES_BANCAIRES_PREVUS = true'))))
  })
  it('attrape un 512 propre qui vaudrait dès la veille de sa date', () => {
    echoue(() => memeBloc(blocDe(planter(sourceDeployee(), '|| date.slice(0, 10) < compte.compte_propre_depuis) return compteDuRoleBanque',
      '|| date.slice(0, 10) <= compte.compte_propre_depuis) return compteDuRoleBanque'))))
  })
  it('attrape une banque inconnue jugée sous la banque du rôle', () => {
    echoue(() => memeBloc(blocDe(planter(sourceDeployee(), '  if (!compte) {\n    return { refus:', '  if (!compte) {\n    return { compte: banques.role }\n    return { refus:'))))
  })
  it('attrape un détecteur qui recompose au plan du dossier, plus au plan du mouvement', () => {
    const s = planter(sourceDeployee(), 'ecritureDuCompteDeBilan(l, compte, duMouvement), l.date)', 'ecritureDuCompteDeBilan(l, compte, plan), l.date)')
    const copie = detecteursDe(s).mouvementsSurUnCompteDeBilanDesynchronises
    const sc = SCENARIOS((l, plan) => ecritureDuCompteDeBilan(l, l.compte_bilan!, plan), { compte_bilan: PLAN.virements_internes })
    echoue(() => expect(ids(copie(sc.justes, [...sc.lignes], null, PLAN, PAR_COMPTE))).toEqual([]))
  })
  it('attrape un paiement de TVA jugé sans sa banque', () => {
    const s = planter(sourceDeployee(), '    const duMouvement = planPourJuger(plan, l, banques)\n    return !!duMouvement && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuPaiementTva(',
      '    const duMouvement = plan\n    return !!duMouvement && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuPaiementTva(')
    const copie = detecteursDe(s).paiementsTvaDesynchronises
    const sc = SCENARIOS((l, plan) => ecritureDuPaiementTva(l, plan), { declaration_tva_id: 'decl' })
    echoue(() => expect(ids(copie(sc.fausses, [...sc.lignes], null, PLAN, RETENU))).toEqual([]))
  })
  it('attrape une contrepartie reconnue sur le seul 512 du rôle', () => {
    echoue(() => memePiece(analyseDe(planter(sourceDeployee(), '  const comptesDeBanque = comptesDeBanqueDuDossier(modele.plan, banques)\n  const piecesParGroupe',
      '  const comptesDeBanque = new Set([modele.plan.banque])\n  const piecesParGroupe'))))
  })
  it('attrape une contrepartie écrite au 512 du rôle pour un mouvement du livret', () => {
    echoue(() => memePiece(analyseDe(planter(sourceDeployee(), 'ligneContrepartieDuPaiement(p, planDuPaiement(plan, p, banques))', 'ligneContrepartieDuPaiement(p, plan)'))))
  })
  it('attrape une pièce d’une banque inconnue qui n’est plus retenue', () => {
    echoue(() => memePiece(analyseDe(planter(sourceDeployee(),
      '  if (refusDesBanquesDesPaiements(paiements, banques) !== null) return []\n  // EN ENGAGEMENT', '  // EN ENGAGEMENT'))))
  })
})
