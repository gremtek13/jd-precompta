import { describe, expect, it } from 'vitest'
import { concordance2035, effetDesEcartsDeclares, ouAgir, phraseDeLEcart } from './concordance2035'
import { calculerDeclaration2035, type Declaration2035 } from './declaration2035'
import {
  ECRITURES_LIBRES_ABSENTES, type EcritureLibreDesExports, type EcrituresLibresDesExports, type LigneEnBaseDEcritureLibre,
} from './ecrituresLibresDesExports'
import { dateDeLExtourne, depensesCompteesSous, lignesDeResultatLibres, recettesComptees } from './ecrituresLibresDeLa2035'
import { chiffreDAffairesDeLaPeriode, projectionAnnuelle, totauxPourAnnee } from './estimation'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { CotisationDeclaree, EcritureBrouillon } from './types'
import { cotisationsComptees } from './cotisationRapprochee'
import { estLePosteDesCotisations } from './cases2035'
import { NON_VALIDEE } from '../test/ecritures'
import { recettesFactureesVides, ventesFactureesVides } from '../test/ventesFacturees'
import { pieceDeVente } from '../test/dossierBascule'
import { CATEGORIES_CITEES, composerLeDossier, contenuDeLaSauvegarde, controlesDuDossier } from '../test/dossierDeDemonstration'

const CABINET = 'ca000000-0000-4000-8000-000000000001'

// EL4 (conception 54, § 5.1 à § 5.4) : l'écriture libre dans la 2035, la concordance, la situation et l'estimation. Drapeau
// baissé, écritures absentes : les chiffres d'hier. Lues : le poste de la 2035 bouge du montant de la ligne, signé, « hors de la
// 2035 » ne bouge rien et se range en écart déclaré.

const ligneLibre = (compte: string, sens: 'debit' | 'credit', centimes: number, poste: string | null = null): LigneEnBaseDEcritureLibre =>
  ({ compte, sens, centimes, poste_2035: poste, compte_lib: null })

const ecriture = (o: Partial<EcritureLibreDesExports> & Pick<EcritureLibreDesExports, 'id' | 'date' | 'lignes'>): EcritureLibreDesExports => ({
  dossier_id: 'd1', exercice: Number(o.date.slice(0, 4)), numero: 1, libelle: 'Correction', avec_extourne: false, piece_citee_id: null,
  version: 1, cree_par: 'u1', cree_le: '2026-01-15T09:00:00Z', modifie_par: null, modifie_le: null, ...o,
})

// Quatre écritures : une dépense comptée, une recette diminuée, une charge rattachée hors de la 2035 avec son extourne, une
// dépense comptée du 31 décembre avec son extourne.
const DEPENSE = ecriture({
  id: 'el-depense', numero: 1, date: '2025-06-30', libelle: 'Part professionnelle du téléphone',
  lignes: [ligneLibre('606100', 'debit', 5000, 'Achats'), ligneLibre('108000', 'credit', 5000)],
})
const RECETTE = ecriture({
  id: 'el-recette', numero: 2, date: '2025-09-30', libelle: 'Recette comptée deux fois',
  lignes: [ligneLibre('706000', 'debit', 2000, 'Recettes'), ligneLibre('108000', 'credit', 2000)],
})
const RATTACHEE = ecriture({
  id: 'el-rattachee', numero: 3, date: '2025-12-31', libelle: 'Facture d’entretien de décembre', avec_extourne: true,
  lignes: [ligneLibre('615000', 'debit', 3000), ligneLibre('408000', 'credit', 3000)],
})
const EXTOURNEE = ecriture({
  id: 'el-extournee', numero: 4, date: '2025-12-31', libelle: 'Frais de route', avec_extourne: true,
  lignes: [ligneLibre('625100', 'debit', 1000, 'Frais de déplacement'), ligneLibre('108000', 'credit', 1000)],
})
const TOUTES = [DEPENSE, RECETTE, RATTACHEE, EXTOURNEE]

const lues = (ecritures: readonly EcritureLibreDesExports[]): EcrituresLibresDesExports => ({ etat: 'lues', ecritures, auteurs: new Map() })

const declarer = (annee: number, libres: EcrituresLibresDesExports): Declaration2035 => calculerDeclaration2035(
  annee, [], [], [], [], [], false, paiementsDesPieces([], [], [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
  { etat: 'sans_bascule' }, CAISSE_ABSENTE, libres,
)

// Les lignes au brouillon qu'enregistrer_ecriture_libre écrit (migration EL2) : chaque ligne à sa date, et, avec l'extourne,
// chaque ligne au sens inverse au 1er janvier suivant, toutes sous `ecriture_libre_id`.
let rang = 0
function auBrouillon(e: EcritureLibreDesExports, o: { centimes?: (l: LigneEnBaseDEcritureLibre) => number } = {}): EcritureBrouillon[] {
  const ligne = (l: LigneEnBaseDEcritureLibre, date: string, sens: 'debit' | 'credit'): EcritureBrouillon => ({
    id: `b${++rang}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date, compte: l.compte, libelle: e.libelle,
    montant: (o.centimes?.(l) ?? l.centimes) / 100, sens, statut: 'proposee', created_at: '2026-01-15T09:00:00Z',
    immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, encaissement_id: null,
    facture_id: null, ecriture_libre_id: e.id,
  })
  const inverse = (s: 'debit' | 'credit') => (s === 'debit' ? 'credit' : 'debit')
  return [
    ...e.lignes.map((l) => ligne(l, e.date, l.sens)),
    ...(e.avec_extourne ? e.lignes.map((l) => ligne(l, dateDeLExtourne(e.date), inverse(l.sens))) : []),
  ]
}

const SANS_CONTEXTE = { piecesValidees: new Set<string>(), piecesImmobilisees: new Set<string>(), mouvementsDesVentesFacturees: new Set<string>() }
const poste = (d: Declaration2035, nom: string) => [...d.recettes, ...d.depenses].find((l) => l.poste === nom)

describe('EL4 — drapeau baissé, écritures absentes : les chiffres d’hier', () => {
  it('les écritures libres sont un paramètre OBLIGATOIRE de chaque moteur (EL8) : un appel qui les omet ne compile pas', () => {
    // Chaque `@ts-expect-error` est une garde : le jour où un moteur rendrait le paramètre facultatif (un défaut, l'absence ou
    // un refus), l'appel compilerait, la directive serait sans emploi, et `tsc -b` le refuserait. Les appels ne s'exécutent pas.
    const omis = [
      // @ts-expect-error — la 2035 sans ses écritures libres
      () => calculerDeclaration2035(2025, [], [], [], [], [], false, new Map(), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE),
      // @ts-expect-error — la situation intermédiaire sans elles
      () => calculerSituationIntermediaire([], [], [], [], '2025-01-01', '2025-09-30', false, new Map(), 'tresorerie', [], ventesFactureesVides('d1'), PLAN_PAR_DEFAUT, { etat: 'sans_bascule' }, CAISSE_ABSENTE),
      // @ts-expect-error — l'estimation de l'année sans elles
      () => totauxPourAnnee([], [], 2025, false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE),
      // @ts-expect-error — la projection annuelle sans elles
      () => projectionAnnuelle([], [], '2025-06-30', false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE),
      // @ts-expect-error — le chiffre d'affaires d'une période sans elles
      () => chiffreDAffairesDeLaPeriode([], new Map(), '2025-01-01', '2025-12-31', false, 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE),
    ]
    expect(omis).toHaveLength(5)
    // L'absence se DIT : celle du drapeau baissé, que chaque appel passe à la main quand il n'a rien lu.
    expect(ECRITURES_LIBRES_ABSENTES).toEqual({ etat: 'absentes' })
  })

  it('la 2035 du dossier de démonstration ne bouge pas : épinglée, sans un champ de plus', () => {
    const c = controlesDuDossier(contenuDeLaSauvegarde(composerLeDossier(), CABINET), CATEGORIES_CITEES)
    const d = c.declaration2025
    expect({ recettes: d.totalRecettes, depenses: d.totalDepenses, resultat: d.resultat, contributions: d.contributions.length })
      .toMatchInlineSnapshot(`
        {
          "contributions": 119,
          "depenses": 26970.75,
          "recettes": 77835,
          "resultat": 50864.25,
        }
      `)
    expect('ecrituresLibresHorsDeLa2035' in d.exclusions).toBe(false)
    expect([...d.recettes, ...d.depenses].some((l) => 'nbEcrituresLibres' in l)).toBe(false)
    expect('ecartsDeclares' in c.concordance2025).toBe(false)
  })

  it('des écritures lues mais vides ne changent aucun montant', () => {
    const absentes = declarer(2025, ECRITURES_LIBRES_ABSENTES)
    const vides = declarer(2025, lues([]))
    expect({ r: vides.totalRecettes, d: vides.totalDepenses, res: vides.resultat })
      .toEqual({ r: absentes.totalRecettes, d: absentes.totalDepenses, res: absentes.resultat })
    expect(vides.exclusions.ecrituresLibresHorsDeLa2035).toEqual([])
  })
})

describe('EL4 — la 2035 lit les écritures libres', () => {
  it('chaque poste bouge du montant de sa ligne, signé ; hors de la 2035 ne bouge rien', () => {
    const d = declarer(2025, lues(TOUTES))
    expect(poste(d, 'Achats')).toMatchObject({ montant: 50, nature: 'depense', nbPieces: 0, nbMouvements: 0, nbEcrituresLibres: 1 })
    // Un 706 au débit diminue les recettes : le poste reste négatif, il ne se retourne pas.
    expect(poste(d, 'Recettes')).toMatchObject({ montant: -20, nature: 'recette', nbEcrituresLibres: 1 })
    expect(poste(d, 'Frais de déplacement')).toMatchObject({ montant: 10, nature: 'depense' })
    // La charge rattachée, hors de la 2035 : aucune ligne pour son 615000.
    expect(d.contributions.some((c) => c.compte === '615000')).toBe(false)
    expect(d.totalRecettes).toBe(-20)
    expect(d.totalDepenses).toBe(60)
    expect(d.resultat).toBe(-80)
    expect(d.exclusions.ecrituresLibresHorsDeLa2035?.map((l) => [l.ecriture.id, l.compte, l.centimes, l.extourne]))
      .toEqual([['el-rattachee', '615000', 3000, false]])
  })

  it('l’extourne compte dans l’exercice suivant, au sens inverse, comme sa ligne', () => {
    const d = declarer(2026, lues(TOUTES))
    expect(poste(d, 'Frais de déplacement')).toMatchObject({ montant: -10, nature: 'depense' })
    expect(d.contributions.map((c) => [c.source.type, c.compte, c.centimes])).toEqual([['ecriture_libre', '625100', -1000]])
    expect(d.exclusions.ecrituresLibresHorsDeLa2035?.map((l) => [l.ecriture.id, l.date, l.centimes, l.extourne]))
      .toEqual([['el-rattachee', '2026-01-01', -3000, true]])
    // Sur les deux années, la dépense extournée ne compte qu'une fois : zéro.
    expect(poste(declarer(2025, lues([EXTOURNEE])), 'Frais de déplacement')!.montant + poste(d, 'Frais de déplacement')!.montant).toBe(0)
  })

  it('une ligne de bilan n’entre nulle part', () => {
    expect(lignesDeResultatLibres(lues(TOUTES)).some((l) => /^[1-5]/.test(l.compte))).toBe(false)
  })
})

describe('EL4 — la concordance : comptée par construction, hors de la 2035 un écart déclaré', () => {
  const brouillon = TOUTES.flatMap((e) => auBrouillon(e))

  it('2025 : concorde hors des écarts déclarés, la charge rattachée à part, chiffrée et nommée', () => {
    const c = concordance2035(declarer(2025, lues(TOUTES)), brouillon, SANS_CONTEXTE, null)
    expect(c.ecarts).toEqual([])
    expect(c.concorde).toBe(true)
    expect(c.ecartsDeclares?.map((e) => [e.cle, e.motif, e.declaration, e.ecritures, e.libelle, e.date])).toEqual([
      ['libre:el-rattachee', 'ecriture_libre_hors_2035', 0, -30, 'Écriture libre EL2025-0003 — Facture d’entretien de décembre', '2025-12-31'],
    ])
    expect(phraseDeLEcart(c.ecartsDeclares![0])).toContain('30,00')
    expect(ouAgir(c.ecartsDeclares![0])).toBe('Écritures — Écritures de l’expert-comptable')
    // Le résultat du FEC est sous celui de la 2035 de la charge rattachée.
    expect(effetDesEcartsDeclares(c)).toEqual({ ecritures: 1, resultat: -30 })
    expect(c.ecritures.resultat - c.declaration.resultat).toBe(-30)
  })

  it('2026 : l’extourne de la charge rattachée est déclarée, celle de la dépense comptée concorde', () => {
    const c = concordance2035(declarer(2026, lues(TOUTES)), brouillon, SANS_CONTEXTE, null)
    expect(c.concorde).toBe(true)
    expect(c.ecartsDeclares?.map((e) => [e.cle, e.ecritures, e.libelle])).toEqual([
      ['libre:el-rattachee', 30, 'Écriture libre EL2025-0003 (extourne) — Facture d’entretien de décembre'],
    ])
  })

  it('une ligne comptée qui manque au brouillon reste un écart, et retient', () => {
    const sansDepense = brouillon.filter((b) => !(b.ecriture_libre_id === 'el-depense' && b.compte === '606100'))
    const c = concordance2035(declarer(2025, lues(TOUTES)), sansDepense, SANS_CONTEXTE, null)
    expect(c.concorde).toBe(false)
    expect(c.ecarts.map((e) => [e.cle, e.motif])).toEqual([['libre:el-depense', 'sans_ecriture']])
  })

  it('une ligne hors de la 2035 écrite pour un autre montant n’est pas un écart déclaré', () => {
    const faux = [
      ...TOUTES.filter((e) => e !== RATTACHEE).flatMap((e) => auBrouillon(e)),
      ...auBrouillon(RATTACHEE, { centimes: (l) => (l.compte === '615000' ? 4000 : l.centimes) }),
    ]
    const c = concordance2035(declarer(2025, lues(TOUTES)), faux, SANS_CONTEXTE, null)
    expect(c.concorde).toBe(false)
    expect(c.ecarts.map((e) => e.cle)).toEqual(['libre:el-rattachee'])
    expect(c.ecartsDeclares).toEqual([])
    expect(effetDesEcartsDeclares(c)).toBeNull()
  })

  it('écritures absentes : aucune liste d’écarts déclarés, la concordance d’hier', () => {
    const c = concordance2035(declarer(2025, ECRITURES_LIBRES_ABSENTES), [], SANS_CONTEXTE, null)
    expect('ecartsDeclares' in c).toBe(false)
    expect(effetDesEcartsDeclares(c)).toBeNull()
  })
})

describe('EL4 — la situation intermédiaire et l’estimation lisent les mêmes lignes', () => {
  const situation = (libres: EcrituresLibresDesExports = ECRITURES_LIBRES_ABSENTES, mode: 'tresorerie' | 'engagement' = 'tresorerie') =>
    calculerSituationIntermediaire(
      [], [], [], [], '2025-01-01', '2025-09-30', false, new Map(), mode, [], ventesFactureesVides('d1'), PLAN_PAR_DEFAUT,
      { etat: 'sans_bascule' }, CAISSE_ABSENTE, libres,
    )

  it('la situation à fin septembre compte la dépense et la recette diminuée, pas l’écriture de décembre', () => {
    const s = situation(lues(TOUTES))
    expect(Object.fromEntries(s.totauxParPoste)).toEqual({ Achats: -50, Recettes: -20 })
    expect(s.resultat).toBe(-70)
    expect(s.ecrituresLibresHorsDeLa2035).toEqual([])
  })

  // RELECTURE ADVERSE DU 28/11/2026 : la situation POSAIT les amortissements et les cotisations de la période sur leur poste
  // (`set`), après les écritures libres — une ligne que l'expert comptait sous « Cotisations sociales personnelles » ou
  // « Amortissements » disparaissait dès qu'une échéance ou une dotation tombait dans la période, quand la 2035 l'additionne.
  it('une ligne sous le poste des cotisations ou des amortissements s’ajoute aux échéances et aux dotations de la période', () => {
    const libres = lues([
      ecriture({ id: 'el-cotis', numero: 5, date: '2025-03-31', lignes: [ligneLibre('646000', 'debit', 4000, 'Cotisations sociales personnelles'), ligneLibre('108000', 'credit', 4000)] }),
      ecriture({ id: 'el-amort', numero: 6, date: '2025-04-30', lignes: [ligneLibre('681100', 'debit', 2500, 'Amortissements'), ligneLibre('108000', 'credit', 2500)] }),
    ])
    const echeances = cotisationsComptees([{
      id: 'cot', dossier_id: 'd1', echeance: '2025-02-05', montant_appele: 300, montant_verse: null, montant_csg_crds: null,
      previsionnel: false, created_at: '2025-01-05T09:00:00Z', paiement_personnel_le: null,
    }], [], 'tresorerie')
    const bien = { id: 'i', dossier_id: 'd1', piece_id: null, nature_id: null, libelle: 'Matériel', valeur: 3600, duree_annees: 3,
      date_acquisition: '2025-01-01', date_mise_en_service: '2025-01-01' } as unknown as Parameters<typeof calculerSituationIntermediaire>[2][number]
    const situer = (l: EcrituresLibresDesExports) => calculerSituationIntermediaire(
      [], [], [bien], echeances, '2025-01-01', '2025-09-30', false, new Map(), 'tresorerie', [], ventesFactureesVides('d1'), PLAN_PAR_DEFAUT,
      { etat: 'sans_bascule' }, CAISSE_ABSENTE, l,
    )
    const sans = Object.fromEntries(situer(lues([])).totauxParPoste)
    const avec = Object.fromEntries(situer(libres).totauxParPoste)
    expect(sans['Cotisations sociales personnelles']).toBe(-300)
    expect(avec['Cotisations sociales personnelles']).toBeCloseTo(-340, 9)
    expect(avec.Amortissements).toBeCloseTo(sans.Amortissements - 25, 9)
    expect(situer(libres).resultat).toBeCloseTo(situer(lues([])).resultat - 65, 9)
  })

  it('absentes : la situation d’hier, sans un champ de plus', () => {
    expect(situation()).toStrictEqual(situation(ECRITURES_LIBRES_ABSENTES))
    expect('ecrituresLibresHorsDeLa2035' in situation()).toBe(false)
  })

  it('l’estimation ajoute au chiffre d’affaires les recettes comptées, signées, et rien d’autre', () => {
    expect(recettesComptees(lues(TOUTES), '2025-01-01', '2025-12-31')).toBe(-2000)
    const sansLibre = chiffreDAffairesDeLaPeriode([], new Map(), '2025-01-01', '2025-12-31', false, 'tresorerie', [], recettesFactureesVides(),
      CAISSE_ABSENTE, ECRITURES_LIBRES_ABSENTES)
    const avec = chiffreDAffairesDeLaPeriode([], new Map(), '2025-01-01', '2025-12-31', false, 'tresorerie', [], recettesFactureesVides(),
      CAISSE_ABSENTE, lues(TOUTES))
    expect(avec - sansLibre).toBe(-20)
    expect(totauxPourAnnee([], [], 2025, false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, lues(TOUTES)).ca).toBe(-20)
    expect(totauxPourAnnee([], [], 2025, false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, ECRITURES_LIBRES_ABSENTES))
      .toStrictEqual(totauxPourAnnee([], [], 2025, false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, ECRITURES_LIBRES_ABSENTES))
    expect(projectionAnnuelle([], [], '2025-10-15', false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, lues(TOUTES)).ca).toBe(-20)
  })
})

// EL4-Q1 (réponse du cabinet du 22/11/2026, contre la recommandation) : une ligne d'écriture libre comptée sous le poste des
// cotisations s'ajoute aux cotisations de l'estimation, signée, à sa date ; l'extourne les baisse l'année suivante. Rien d'autre
// n'y entre, et le chiffre d'affaires d'EL4 ne bouge pas.
describe('EL4-Q1 — les cotisations de l’estimation lisent les écritures libres sous le poste des cotisations', () => {
  const echeance = (o: Partial<CotisationDeclaree>): CotisationDeclaree => ({
    id: 'cot', dossier_id: 'd1', echeance: '2025-02-05', montant_appele: 300, montant_verse: null, montant_csg_crds: null,
    previsionnel: false, created_at: '2025-01-05T09:00:00Z', paiement_personnel_le: null, ...o,
  })
  // Le jeu de totauxPourAnnee d'estimation.test.ts : une vente de 100 € et une échéance de 300 € dans l'année, et une de l'année
  // d'avant.
  const VENTE = pieceDeVente({ id: 'v', date_piece: '2025-01-01', montant_ht: null, montant_tva: null, montant_ttc: 100 })
  const ECHEANCIER = cotisationsComptees([echeance({ id: 'a' }), echeance({ id: 'b', echeance: '2024-02-05', montant_appele: 999 })], [], 'tresorerie')
  const totaux = (annee: number, libres: EcrituresLibresDesExports) =>
    totauxPourAnnee([VENTE], ECHEANCIER, annee, true, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, libres)
  const projection = (jour: string, libres: EcrituresLibresDesExports) =>
    projectionAnnuelle([VENTE], ECHEANCIER, jour, true, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, libres)

  // Une régularisation de 250 € au 31 décembre, sous le poste des cotisations, avec son extourne ; une autre ligne sous BK
  // (« Charges sociales personnelles », un autre poste), une hors de la 2035, toutes deux sans effet.
  const REGUL = ecriture({
    id: 'el-cotis', numero: 5, date: '2025-12-31', libelle: 'Régularisation Urssaf', avec_extourne: true,
    lignes: [ligneLibre('646000', 'debit', 25000, 'Cotisations sociales personnelles'), ligneLibre('108000', 'credit', 25000)],
  })
  const AUTRES = ecriture({
    id: 'el-autres', numero: 6, date: '2025-06-30', libelle: 'Madelin et cotisation hors de la 2035',
    lignes: [ligneLibre('646100', 'debit', 4000, 'Charges sociales personnelles'), ligneLibre('646200', 'debit', 7000),
      ligneLibre('108000', 'credit', 11000)],
  })
  const CORRECTION = ecriture({
    id: 'el-correction', numero: 7, date: '2025-03-31', libelle: 'Cotisation comptée deux fois',
    lignes: [ligneLibre('646000', 'credit', 5000, 'cotisations SOCIALES personnelles'), ligneLibre('108000', 'debit', 5000)],
  })

  it('absentes : les totaux d’aujourd’hui, sans un champ de plus', () => {
    expect(totaux(2025, ECRITURES_LIBRES_ABSENTES)).toStrictEqual({ ca: 100, cotis: 300 })
    expect(totaux(2025, lues([]))).toStrictEqual({ ca: 100, cotis: 300 })
    const p = projection('2025-10-15', ECRITURES_LIBRES_ABSENTES)
    expect(p.cotis).toBe(300)
    expect('cotisDontEcrituresLibres' in p).toBe(false)
  })

  it('une ligne de +X sous le poste monte les cotisations de X, et le dit ; son extourne les baisse de X l’année suivante', () => {
    expect(totaux(2025, lues([REGUL]))).toStrictEqual({ ca: 100, cotis: 550, cotisDontEcrituresLibres: 250 })
    expect(totaux(2026, lues([REGUL]))).toStrictEqual({ ca: 0, cotis: -250, cotisDontEcrituresLibres: -250 })
    // À date : la ligne du 31 décembre n'est pas encore échue en octobre ; elle l'est le 31 décembre, projection comprise.
    expect('cotisDontEcrituresLibres' in projection('2025-10-15', lues([REGUL]))).toBe(false)
    const fin = projection('2025-12-31', lues([REGUL]))
    expect(fin.cotis).toBe(550)
    expect(fin.cotisDontEcrituresLibres).toBe(250)
    expect(fin.cotisationsProjetees).toBeCloseTo((550 * 12) / fin.moisEcoules, 6)
  })

  it('la correction au crédit les diminue, le poste jugé à la casse et aux accents près, comme le rattachement', () => {
    expect(estLePosteDesCotisations('cotisations SOCIALES personnelles')).toBe(true)
    expect(totaux(2025, lues([CORRECTION]))).toStrictEqual({ ca: 100, cotis: 250, cotisDontEcrituresLibres: -50 })
  })

  it('une ligne sous un autre poste, hors de la 2035, ou de recette, ne les bouge pas', () => {
    expect(totaux(2025, lues([AUTRES]))).toStrictEqual({ ca: 100, cotis: 300 })
    expect(totaux(2025, lues(TOUTES)).cotis).toBe(300)
    expect(depensesCompteesSous(lues([AUTRES, ...TOUTES]), '2025-01-01', '2025-12-31', estLePosteDesCotisations)).toBe(0)
  })

  it('le chiffre d’affaires d’EL4 ne bouge pas', () => {
    const avec = lues([...TOUTES, REGUL, AUTRES, CORRECTION])
    expect(totaux(2025, avec).ca).toBe(totaux(2025, lues(TOUTES)).ca)
    expect(totaux(2025, avec).ca).toBe(80)
    expect(projection('2025-12-31', avec).ca).toBe(projection('2025-12-31', lues(TOUTES)).ca)
  })
})
