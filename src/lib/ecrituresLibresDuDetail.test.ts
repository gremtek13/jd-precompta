import { describe, expect, it } from 'vitest'
import { calculerBalance } from './ecritures'
import type { EcritureLibreDesExports, EcrituresLibresDesExports } from './ecrituresLibresDesExports'
import { marqueDeLaPartLibre, marquesDesEcrituresLibres, partsLibresDesComptes } from './ecrituresLibresDuDetail'
import type { EcritureBrouillon } from './types'

// LE DÉTAIL D'UN COMPTE MARQUE LA PART DES ÉCRITURES LIBRES (EL6 ; conception 54, § 5.5). La balance et le bilan les comptent
// déjà ; ce module dit sous quels numéros, et rien de ce que l'expert a saisi. Données FICTIVES ; un nom planté dans le libellé
// de l'écriture et dans celui de ses lignes au brouillon, qu'aucune marque ne doit porter.

const PATIENT = 'GRANDVILLIERS Odilon'
// `formatMoney` sépare par des espaces insécables : le test lit le texte aux espaces ordinaires.
const ecrit = (s: string | undefined) => s?.replace(/[\u00a0\u202f]/g, ' ')
const ligne = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-12-31', libelle: `Rétrocession — ${PATIENT}`,
  sens: 'debit', statut: 'proposee', compte: '622600', montant: 300, created_at: '2026-12-31T09:00:00Z', ...o,
} as EcritureBrouillon)
const libre = (o: Partial<EcritureLibreDesExports>): EcritureLibreDesExports => ({
  id: 'el-3', dossier_id: 'd1', exercice: 2026, numero: 3, date: '2026-12-31', libelle: `Rétrocession — ${PATIENT}`, lignes: [],
  avec_extourne: false, piece_citee_id: null, version: 1, cree_par: 'u', cree_le: '2026-12-31T10:00:00Z', modifie_par: null,
  modifie_le: null, ...o,
})
const LUES: EcrituresLibresDesExports = {
  etat: 'lues', auteurs: new Map(),
  ecritures: [libre({}), libre({ id: 'el-12', numero: 12, avec_extourne: true }), libre({ id: 'el-1', exercice: 2025, numero: 1, date: '2025-12-31' })],
}
const BROUILLON = [
  ligne({ id: 'b1', ecriture_libre_id: 'el-3' }),
  ligne({ id: 'b2', compte: '108000', sens: 'credit', ecriture_libre_id: 'el-3' }),
  ligne({ id: 'b3', compte: '471000', sens: 'credit', montant: 50, ecriture_libre_id: 'el-12' }),
  ligne({ id: 'b4', compte: '622600', montant: 50, ecriture_libre_id: 'el-12' }),
  // L'extourne de 2025 au 1er janvier 2026 : la même écriture, à une autre date.
  ligne({ id: 'b5', compte: '471000', date: '2026-01-01', sens: 'debit', montant: 20, ecriture_libre_id: 'el-1' }),
  // Une ligne d'une pièce, sur le même compte : hors de la part.
  ligne({ id: 'b6', compte: '622600', montant: 1000, piece_id: 'p1' }),
]

describe('la part des écritures libres dans chaque compte', () => {
  it('compte les lignes, leur solde signé et leurs numéros, dans l’ordre des écritures ; l’extourne nommée', () => {
    const parts = partsLibresDesComptes(BROUILLON, LUES)
    expect([...parts.keys()].sort()).toEqual(['108000', '471000', '622600'])
    expect(parts.get('622600')).toEqual({ compte: '622600', lignes: 2, soldeCentimes: 35000, references: ['EL2026-0003', 'EL2026-0012'], nonLues: 0 })
    expect(parts.get('471000')).toEqual({ compte: '471000', lignes: 2, soldeCentimes: -3000, references: ['EL2025-0001 (extourne)', 'EL2026-0012'], nonLues: 0 })
    expect(parts.get('108000')?.soldeCentimes).toBe(-30000)
  })

  it('une ligne dont l’écriture n’est pas lue se compte, sans numéro ; nulle lecture : toutes sans numéro', () => {
    const avecUneInconnue = [...BROUILLON, ligne({ id: 'b7', compte: '108000', sens: 'debit', montant: 1, ecriture_libre_id: 'el-404' })]
    expect(partsLibresDesComptes(avecUneInconnue, LUES).get('108000')).toMatchObject({ lignes: 2, nonLues: 1, references: ['EL2026-0003'] })
    const sansLecture = partsLibresDesComptes(BROUILLON, null)
    expect(sansLecture.get('622600')).toMatchObject({ lignes: 2, nonLues: 2, references: [], soldeCentimes: 35000 })
    expect(partsLibresDesComptes(BROUILLON, { etat: 'absentes' }).get('622600')?.nonLues).toBe(2)
  })

  it('rien pour un brouillon sans écriture libre', () => {
    expect(partsLibresDesComptes(BROUILLON.map((l) => ({ ...l, ecriture_libre_id: null })), LUES).size).toBe(0)
  })

  it('la balance compte déjà ces lignes : la part est comprise dans le solde du compte, sans rien changer à la balance', () => {
    const balance = calculerBalance(BROUILLON, [], [])
    const compte = balance.find((l) => l.compte === '622600')!
    expect(Math.round(compte.solde * 100)).toBe(135000)
    expect(partsLibresDesComptes(BROUILLON, LUES).get('622600')!.soldeCentimes).toBeLessThanOrEqual(Math.round(compte.solde * 100))
  })
})

describe('la marque du détail', () => {
  it('« écriture libre n° EL… », au singulier et au pluriel, le sens du solde dit', () => {
    const marques = marquesDesEcrituresLibres(BROUILLON, LUES)
    expect(ecrit(marques.get('108000'))).toBe('dont écriture libre n° EL2026-0003 : 300,00 € au crédit')
    expect(ecrit(marques.get('622600'))).toBe('dont écritures libres n° EL2026-0003, EL2026-0012 : 350,00 € au débit')
    expect(ecrit(marques.get('471000'))).toBe('dont écritures libres n° EL2025-0001 (extourne), EL2026-0012 : 30,00 € au crédit')
  })

  it('sans numéro lu : « numéro non lu », jamais « rattachée à rien » ; une part soldée le dit', () => {
    expect(ecrit(marqueDeLaPartLibre({ compte: '622600', lignes: 1, soldeCentimes: 5000, references: [], nonLues: 1 })))
      .toBe('dont écriture libre (numéro non lu) : 50,00 € au débit')
    expect(ecrit(marqueDeLaPartLibre({ compte: '622600', lignes: 3, soldeCentimes: 0, references: ['EL2026-0003'], nonLues: 2 })))
      .toBe('dont écriture libre n° EL2026-0003 et 2 lignes au numéro non lu : soldée')
  })

  it('aucune marque ne porte ce que l’expert a saisi : ni le libellé de l’écriture, ni celui de ses lignes', () => {
    const toutes = [...marquesDesEcrituresLibres(BROUILLON, LUES).values(), ...marquesDesEcrituresLibres(BROUILLON, null).values()]
    expect(toutes.length).toBeGreaterThan(0)
    for (const m of toutes) {
      expect(m).not.toContain(PATIENT)
      expect(m).not.toMatch(/rattach/i)
    }
  })
})
