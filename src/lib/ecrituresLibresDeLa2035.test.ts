import { describe, expect, it } from 'vitest'
import { concordance2035, effetDesEcartsDeclares, ouAgir, phraseDeLEcart } from './concordance2035'
import { calculerDeclaration2035, type Declaration2035 } from './declaration2035'
import {
  ECRITURES_LIBRES_ABSENTES, type EcritureLibreDesExports, type EcrituresLibresDesExports, type LigneEnBaseDEcritureLibre,
} from './ecrituresLibresDesExports'
import {
  dateDeLExtourne, ecrituresLibresParDefaut, lignesDeResultatLibres, recettesComptees,
} from './ecrituresLibresDeLa2035'
import { chiffreDAffairesDeLaPeriode, projectionAnnuelle, totauxPourAnnee } from './estimation'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { EcritureBrouillon } from './types'
import { NON_VALIDEE } from '../test/ecritures'
import { recettesFactureesVides, ventesFactureesVides } from '../test/ventesFacturees'
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
  it('le défaut est l’absence drapeau baissé, et lève drapeau levé', () => {
    expect(ecrituresLibresParDefaut()).toBe(ECRITURES_LIBRES_ABSENTES)
    expect(ecrituresLibresParDefaut(false)).toBe(ECRITURES_LIBRES_ABSENTES)
    expect(() => ecrituresLibresParDefaut(true)).toThrow(/écritures libres/)
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

  it('le défaut et l’absence passée à la main rendent la même 2035, au caractère près', () => {
    const parDefaut = calculerDeclaration2035(
      2025, [], [], [], [], [], false, paiementsDesPieces([], [], [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
      { etat: 'sans_bascule' }, CAISSE_ABSENTE,
    )
    expect(declarer(2025, ECRITURES_LIBRES_ABSENTES)).toStrictEqual(parDefaut)
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
  const situation = (libres?: EcrituresLibresDesExports, mode: 'tresorerie' | 'engagement' = 'tresorerie') => calculerSituationIntermediaire(
    [], [], [], [], '2025-01-01', '2025-09-30', false, new Map(), mode, [], ventesFactureesVides('d1'), PLAN_PAR_DEFAUT,
    { etat: 'sans_bascule' }, CAISSE_ABSENTE, ...(libres ? [libres] : []),
  )

  it('la situation à fin septembre compte la dépense et la recette diminuée, pas l’écriture de décembre', () => {
    const s = situation(lues(TOUTES))
    expect(Object.fromEntries(s.totauxParPoste)).toEqual({ Achats: -50, Recettes: -20 })
    expect(s.resultat).toBe(-70)
    expect(s.ecrituresLibresHorsDeLa2035).toEqual([])
  })

  it('absentes, ou par défaut : la situation d’hier, sans un champ de plus', () => {
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
    expect(totauxPourAnnee([], [], 2025, false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE))
      .toStrictEqual(totauxPourAnnee([], [], 2025, false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, ECRITURES_LIBRES_ABSENTES))
    expect(projectionAnnuelle([], [], '2025-10-15', false, new Map(), 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE, lues(TOUTES)).ca).toBe(-20)
  })
})
