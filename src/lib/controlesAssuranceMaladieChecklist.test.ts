import { afterEach, describe, expect, it, vi } from 'vitest'
import { SANS_FACTURE_SOURCE } from '../test/ventesFacturees'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../test/modeles'
import { CAISSE_PAS_EN_BASE } from './controlesDeLaCaisse'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { pointsDeLaChecklist, pointsSousLesModules, type ContexteDeLaChecklist, type DonneesDeLaChecklist } from './pointsDeLaChecklist'
import { TOUS_LES_MODULES } from './modulesDuCabinet'
import type { LigneBancaire } from './types'

// LES CONTRÔLES DES PAIEMENTS DE L'ASSURANCE MALADIE DANS LA VUE D'ENSEMBLE (NOE6) : le drapeau joué par un accesseur, ses
// deux états (levé par défaut, l'état d'aujourd'hui depuis le 24/11/2026 ; baissé, tant que son code existe) ; le module du
// cabinet ; la sévérité ; et un dossier que la section n'offre pas, que le drapeau levé ne change en rien. Le calcul lui-même :
// controlesAssuranceMaladie.test.ts.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('./controlesAssuranceMaladie', async (original) => {
  const module = await original<typeof import('./controlesAssuranceMaladie')>()
  return { ...module, get CONTROLES_ASSURANCE_MALADIE_PREVUS() { return drapeau.leve } }
})
afterEach(() => { drapeau.leve = true })

const IDS = [
  'assurance-maladie-credits-sans-paiement', 'assurance-maladie-credits-hors-des-imports', 'assurance-maladie-paiements-sans-credit',
  'assurance-maladie-associations-a-revoir', 'assurance-maladie-exercices-en-ecart',
]

function ligne(o: Partial<LigneBancaire>): LigneBancaire {
  return {
    id: 'l', dossier_id: 'd1', compte_bancaire_id: 'cb-essai', date: '2026-03-04', libelle: 'VIR CPAM 75 FICTIF', montant: 123.45, statut: 'non_rapprochee', piece_id: null,
    cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
    emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    prelevement_personnel: false, source_fichier: 'releve.csv', libelle_brut: null, id_externe: null,
    created_at: '2026-03-05T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function donnees(o: Partial<DonneesDeLaChecklist>): DonneesDeLaChecklist {
  return {
      notesDeFrais: { etat: 'sans_objet' as const },
    piecesValidees: [], piecesAValider: [], cotisations: [], lignes: [], relevesIncoherents: [], controlesReleves: [], comptesBancaires: { etat: 'sans_objet' }, doublonsTexte: [], immobilisations: [],
    natures: [], categories: [], ecritures: [], emprunts: [], ventilations: [], ventilationsPartielles: false, reglements: [],
    reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [], declarationsTva: [],
    declarationsPartielles: false, facturesEmises: [], transmissions: [], jumellesPartielles: false, info: null, infoInconnue: null,
    anneesCloturees: [], ouverture: null, ouvertureIncomplete: null, aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null,
    ventesFacturees: null, facturesSources: SANS_FACTURE_SOURCE, caisse: CAISSE_PAS_EN_BASE, entreesDeLaCaisseIncompletes: null,
    entreesDeLaRepriseDesBiensIncompletes: null, inventaire: { etat: 'sans_objet' }, assuranceMaladie: null, ...o,
  }
}

const CONTEXTE: ContexteDeLaChecklist = {
  assujettiTva: false, periodiciteTva: 'trimestrielle', statutTva: 'exonere', modele: { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT },
  frontiere: null, anneesValidees: [], aujourdHui: '2026-11-20', anneeCourante: 2026, moisEcoules: 10, premierJourDuMois: '2026-11-01',
  offreAssuranceMaladie: { codeNaf: '86.90E', moduleOuvert: true },
}

// Un crédit de la CPAM dans la période d'un import, sans paiement qui fasse son montant.
const AVEC_UN_CREDIT = donnees({
  lignes: [ligne({})],
  assuranceMaladie: {
    releveComplet: true,
    lu: {
      etat: 'lus', imports: { lignes: [{ periode_du: '2026-03-01', periode_au: '2026-03-31' }], complete: true, motif: null },
      paiements: { lignes: [], complete: true, motif: null }, associations: { lignes: [], complete: true, motif: null },
    },
  },
})

const LU_SANS_IMPORT = {
  etat: 'lus' as const, imports: { lignes: [], complete: true, motif: null },
  paiements: { lignes: [], complete: true, motif: null }, associations: { lignes: [], complete: true, motif: null },
}

const pointsAM = (d: DonneesDeLaChecklist, c: ContexteDeLaChecklist = CONTEXTE) =>
  pointsDeLaChecklist(d, c).tousLesPointsATraiter.filter((p) => IDS.includes(p.id))

describe('les contrôles de l’assurance maladie dans la Vue d’ensemble', () => {
  it('le drapeau baissé : les cinq points, à zéro, et rien de calculé', () => {
    drapeau.leve = false
    const points = pointsAM(AVEC_UN_CREDIT)
    expect(points.map((p) => p.id)).toEqual(IDS)
    expect(points.every((p) => p.nb === 0)).toBe(true)
    expect(pointsDeLaChecklist(AVEC_UN_CREDIT, CONTEXTE).assuranceMaladie.etat).toBe('sans_objet')
  })

  it('le drapeau levé : le crédit sans paiement se dit, en attention, vers Banque', () => {
    drapeau.leve = true
    const point = pointsAM(AVEC_UN_CREDIT).find((p) => p.nb > 0)
    expect(point).toMatchObject({ id: 'assurance-maladie-credits-sans-paiement', nb: 1, cible: 'banque', severite: 'attention' })
    expect(point?.detail).toContain('04/03/2026')
    expect(point?.detail).not.toContain('FICTIF')
  })

  it('le drapeau levé, mais un code NAF hors de la santé sans import, ou le relevé lu en partie : rien', () => {
    drapeau.leve = true
    const horsSante = { ...CONTEXTE, offreAssuranceMaladie: { codeNaf: '62.01Z', moduleOuvert: true } }
    const sansImport = donnees({ ...AVEC_UN_CREDIT, assuranceMaladie: { releveComplet: true, lu: { etat: 'lus', imports: { lignes: [], complete: true, motif: null }, paiements: { lignes: [], complete: true, motif: null }, associations: { lignes: [], complete: true, motif: null } } } })
    expect(pointsAM(sansImport, horsSante).every((p) => p.nb === 0)).toBe(true)
    const partiel = donnees({ ...AVEC_UN_CREDIT, assuranceMaladie: { ...AVEC_UN_CREDIT.assuranceMaladie!, releveComplet: false } })
    expect(pointsAM(partiel).every((p) => p.nb === 0)).toBe(true)
    expect(pointsDeLaChecklist(partiel, CONTEXTE).assuranceMaladie.etat).toBe('muet')
  })

  it('le module fermé au cabinet : la Vue d’ensemble ne les montre pas, et le calcul ne se fait pas', () => {
    drapeau.leve = true
    const ouverts = pointsSousLesModules(pointsDeLaChecklist(AVEC_UN_CREDIT, CONTEXTE).pointsATraiter, TOUS_LES_MODULES)
    expect(ouverts.map((p) => p.id)).toContain('assurance-maladie-credits-sans-paiement')
    const sansLeModule = pointsSousLesModules(pointsDeLaChecklist(AVEC_UN_CREDIT, CONTEXTE).pointsATraiter, TOUS_LES_MODULES.filter((m) => m !== 'assurance_maladie'))
    expect(sansLeModule.map((p) => p.id)).not.toContain('assurance-maladie-credits-sans-paiement')
    const ferme = { ...CONTEXTE, offreAssuranceMaladie: { codeNaf: '86.90E', moduleOuvert: false } }
    expect(pointsAM(AVEC_UN_CREDIT, ferme).every((p) => p.nb === 0)).toBe(true)
  })

  // LA RÈGLE DE LA SECTION (lib/sectionAssuranceMaladie.ts) : un code NAF hors de la santé, et aucun import lu, ou une lecture
  // qui n'a rien pu dire des imports. Tout ce que la Vue d'ensemble calcule est identique, à l'égalité stricte, drapeau baissé
  // (rien de lu : `assuranceMaladie` nul) ou levé — même un crédit dont le libellé nomme la CPAM.
  it.each([
    ['lus en entier, sans import', LU_SANS_IMPORT],
    ['refusés', { etat: 'echec' as const, motif: 'refus de la base' }],
    ['lus en partie, sans ligne', { ...LU_SANS_IMPORT, imports: { lignes: [], complete: false, motif: 'lecture interrompue' } }],
  ])('un dossier hors de la santé, ses paiements %s : le drapeau levé ne change rien', (_cas, lu) => {
    const horsSante = { ...CONTEXTE, offreAssuranceMaladie: { codeNaf: '62.01Z', moduleOuvert: true } }
    drapeau.leve = false
    const hier = pointsDeLaChecklist(donnees({ lignes: [ligne({})], assuranceMaladie: null }), horsSante)
    drapeau.leve = true
    const aujourdHui = pointsDeLaChecklist(donnees({ lignes: [ligne({})], assuranceMaladie: { releveComplet: true, lu } }), horsSante)
    expect(aujourdHui).toStrictEqual(hier)
    expect(aujourdHui.assuranceMaladie).toStrictEqual({ etat: 'sans_objet' })
  })
})
