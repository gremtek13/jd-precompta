import { describe, expect, it } from 'vitest'
import {
  CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE, composerLaContrePassation, contrePassationDe, contrePassationPourLaBase,
  dateProposeeDeLaContrePassation, estFigee, libelleProposeDeLaContrePassation, lignesDeLaContrePassation, MOTS_DE_LA_CONTRE_PASSATION,
  origineDe, porteUnPoste, refusDeLaContrePassation, refusDeLEcritureAContrePasser, saisieProposeeDeLaContrePassation,
  type EcritureContrePassable, type SaisieDeContrePassation,
} from './contrePassationDesEcrituresLibres'
import {
  confirmationDeLaContrePassation, confirmationDuRetraitDUneContrePassation, mentionDeLaContrePassation, saisieDeLaContrePassation,
} from './contrePassationDesEcrituresLibresVue'
import type { ContexteDEcritureLibre } from './ecritureLibre'
import type { EcritureLibreDesExports } from './ecrituresLibresDesExports'
import { migrationRangee } from '../test/schema'

// EL7 : LA CONTRE-PASSATION D'UNE ÉCRITURE LIBRE VALIDÉE, LE MODULE. Ce que l'écran juge avant le clic (l'état de l'écriture, puis
// la saisie, dans l'ordre de la base), ce qu'il propose (le premier jour de l'exercice ouvert, le libellé qui nomme l'écriture
// d'origine, hors de la 2035), ce qu'il compose (les lignes au sens inverse) et ce que ses confirmations nomment. Données
// FICTIVES.

const ecriture = (o: Partial<EcritureContrePassable> = {}): EcritureContrePassable => ({
  id: 'e1', exercice: 2025, numero: 3, date: '2025-06-30', libelle: 'Part privée des fournitures', avec_extourne: false, version: 2,
  lignes: [
    { compte: '108000', sens: 'debit', centimes: 5000, poste_2035: null, compte_lib: null },
    { compte: '606400', sens: 'credit', centimes: 5000, poste_2035: 'Fournitures de bureau', compte_lib: null },
  ],
  ...o,
})
const E = ecriture()
const CONTEXTE: ContexteDEcritureLibre = { mode: 'tresorerie', frontiere: '2025-12-31', ouverture: '2023-01-01', aujourdhui: '2026-11-24' }
const SAISIE: SaisieDeContrePassation = { date: '2026-01-01', libelle: 'Contre-passation de EL2025-0003 — Part privée des fournitures', motif: 'Elle était fausse.', horsDeLa2035: true }
const cles = (r: { cle: string }[]) => r.map((x) => x.cle)

describe('le drapeau', () => {
  it('suit la migration : levé si et seulement si elle est rangée dans l’export', () => {
    expect(CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE).toBe(migrationRangee('contre_passation_des_ecritures_libres'))
  })
})

describe('l’état de l’écriture : figée, sans extourne, pas encore contre-passée', () => {
  it('figée : sa date au plus tard à la frontière de la validation ; sans frontière, rien ne l’est', () => {
    expect(estFigee(E, '2025-12-31')).toBe(true)
    expect(estFigee(E, '2025-06-30')).toBe(true)
    expect(estFigee(E, '2025-06-29')).toBe(false)
    expect(estFigee(E, null)).toBe(false)
  })

  it('chaque refus, dans l’ordre de la base, sous le code 23514', () => {
    expect(refusDeLEcritureAContrePasser(E, [E], '2025-12-31')).toEqual([])
    expect(refusDeLEcritureAContrePasser(E, [E], null)).toEqual([{ cle: 'nonFigee', code: '23514', message: MOTS_DE_LA_CONTRE_PASSATION.nonFigee }])
    const c = ecriture({ id: 'c1', exercice: 2026, numero: 1, date: '2026-01-01', contre_passe_id: 'e1' })
    const extournee = ecriture({ date: '2025-12-31', avec_extourne: true })
    expect(cles(refusDeLEcritureAContrePasser(extournee, [extournee, c], null))).toEqual(['nonFigee', 'extournee', 'dejaContrePassee'])
    expect(cles(refusDeLEcritureAContrePasser(E, [E, c], '2025-12-31'))).toEqual(['dejaContrePassee'])
  })

  it('la contre-passation d’une écriture et l’origine d’une contre-passation, parmi les lues', () => {
    const c = ecriture({ id: 'c1', contre_passe_id: 'e1' })
    expect(contrePassationDe(E, [E, c])).toBe(c)
    expect(contrePassationDe(c, [E, c])).toBeNull()
    expect(origineDe(c, [E, c])).toBe(E)
    expect(origineDe(E, [E, c])).toBeNull()
    // La colonne absente (le drapeau baissé) : ni contre-passation, ni origine.
    const { contre_passe_id: _x, ...sansLaColonne } = c
    void _x
    expect(contrePassationDe(E, [E, sansLaColonne])).toBeNull()
  })
})

describe('les refus de la saisie, dans l’ordre de la base', () => {
  it('une saisie juste : aucun refus', () => {
    expect(refusDeLaContrePassation(E, SAISIE, CONTEXTE, [E])).toEqual([])
  })

  it('la date : illisible, dans l’exercice validé (23514), avant l’ouverture, à venir', () => {
    const juger = (date: string, contexte: Partial<ContexteDEcritureLibre> = {}) =>
      refusDeLaContrePassation(E, { ...SAISIE, date }, { ...CONTEXTE, ...contexte }, [E])
    expect(juger('2026-02-30')).toEqual([{ cle: 'dateIllisible', code: '22023', message: MOTS_DE_LA_CONTRE_PASSATION.dateIllisible }])
    expect(juger('2025-12-31')).toEqual([{ cle: 'dateFigee', code: '23514', message: MOTS_DE_LA_CONTRE_PASSATION.dateFigee }])
    expect(cles(juger('2026-01-15', { ouverture: '2026-03-01' }))).toEqual(['avantLOuverture'])
    expect(cles(juger('2027-01-15'))).toEqual(['dateAVenir'])
  })

  it('l’effet sur la 2035, le libellé, le motif — obligatoire —, puis l’état avant tout', () => {
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, horsDeLa2035: 'oui' as unknown as boolean }, CONTEXTE, [E]))).toEqual(['effet'])
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, libelle: '   ' }, CONTEXTE, [E]))).toEqual(['libelle'])
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, libelle: 'Deux\nlignes' }, CONTEXTE, [E]))).toEqual(['libelle'])
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, libelle: 'é'.repeat(201) }, CONTEXTE, [E]))).toEqual(['libelle'])
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, motif: ' ' }, CONTEXTE, [E]))).toEqual(['motif'])
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, motif: 'x'.repeat(2001) }, CONTEXTE, [E]))).toEqual(['motif'])
    expect(cles(refusDeLaContrePassation(E, { ...SAISIE, date: 'x', motif: '' }, { ...CONTEXTE, frontiere: null }, [E])))
      .toEqual(['nonFigee', 'dateIllisible', 'motif'])
  })
})

describe('la composition et ce qui part', () => {
  it('les lignes au sens inverse : le même compte, le même montant, le même libellé de compte ; le poste ou rien', () => {
    const avecLib = ecriture({ lignes: [
      { compte: '471900', sens: 'debit', centimes: 700, poste_2035: null, compte_lib: 'Attente de l’expert' },
      { compte: '606400', sens: 'credit', centimes: 700, poste_2035: 'Fournitures de bureau', compte_lib: null },
    ] })
    expect(lignesDeLaContrePassation(avecLib, false)).toEqual([
      { compte: '471900', sens: 'credit', centimes: 700, poste_2035: null, compte_lib: 'Attente de l’expert' },
      { compte: '606400', sens: 'debit', centimes: 700, poste_2035: 'Fournitures de bureau', compte_lib: null },
    ])
    expect(lignesDeLaContrePassation(avecLib, true).map((l) => l.poste_2035)).toEqual([null, null])
    expect(porteUnPoste(avecLib)).toBe(true)
    expect(porteUnPoste(ecriture({ lignes: avecLib.lignes.map((l) => ({ ...l, poste_2035: null })) }))).toBe(false)
  })

  it('une seule écriture, à sa date, au journal OD, sous le libellé rogné ; refusée, rien ne se compose', () => {
    expect(composerLaContrePassation(E, { ...SAISIE, libelle: `  ${SAISIE.libelle}  ` }, CONTEXTE, [E])).toEqual([{
      date: '2026-01-01', journal: 'OD', libelle: SAISIE.libelle,
      lignes: [{ compte: '108000', sens: 'credit', centimes: 5000 }, { compte: '606400', sens: 'debit', centimes: 5000 }],
    }])
    expect(composerLaContrePassation(E, SAISIE, { ...CONTEXTE, frontiere: null }, [E])).toBeNull()
  })

  it('ce que la base reçoit : les noms de ses champs, le libellé et le motif rognés, l’effet sans défaut', () => {
    expect(contrePassationPourLaBase({ ...SAISIE, motif: '  Elle était fausse.  ', horsDeLa2035: false }))
      .toEqual({ date: '2026-01-01', libelle: SAISIE.libelle, motif: 'Elle était fausse.', hors_de_la_2035: false })
  })

  it('ce qui se propose : le lendemain de la frontière, le libellé qui nomme l’écriture d’origine, hors de la 2035, le motif vide', () => {
    expect(dateProposeeDeLaContrePassation('2025-12-31')).toBe('2026-01-01')
    expect(dateProposeeDeLaContrePassation('2024-02-28')).toBe('2024-02-29')
    expect(saisieProposeeDeLaContrePassation(E, '2025-12-31')).toEqual({
      date: '2026-01-01', libelle: 'Contre-passation de EL2025-0003 — Part privée des fournitures', motif: '', horsDeLa2035: true,
    })
    // Coupé à 200 points de code, le blanc final rogné : la base l'accepte tel quel.
    const long = libelleProposeDeLaContrePassation(ecriture({ libelle: `${'a'.repeat(169)} 🙂 suite` }))
    expect([...long].length).toBeLessThanOrEqual(200)
    expect(long).toBe(long.trim())
    expect(refusDeLaContrePassation(E, { ...SAISIE, libelle: long }, CONTEXTE, [E])).toEqual([])
  })
})

describe('ce que l’écran dit', () => {
  const C = ecriture({ id: 'c1', exercice: 2026, numero: 1, date: '2026-01-01', libelle: SAISIE.libelle, contre_passe_id: 'e1', version: 1,
    lignes: lignesDeLaContrePassation(E, true) })

  it('la mention : qui contre-passe qui, dans les deux sens ; rien sur une écriture ordinaire', () => {
    expect(mentionDeLaContrePassation(E, [E, C])).toBe('Contre-passée par EL2026-0001 du 01/01/2026.')
    expect(mentionDeLaContrePassation(C, [E, C])).toBe('Contre-passe EL2025-0003 du 30/06/2025.')
    expect(mentionDeLaContrePassation(E, [E])).toBeNull()
  })

  it('la confirmation nomme les lignes au sens inverse, les totaux, l’effet sur la 2035, la 2035 validée et le motif', () => {
    const texte = confirmationDeLaContrePassation(E, SAISIE, 'tresorerie')
    expect(texte).toContain('Contre-passer l’écriture libre EL2025-0003 du 30/06/2025 : « Part privée des fournitures » ?')
    expect(texte).toContain('du 01/01/2026, au journal OD : « Contre-passation de EL2025-0003 — Part privée des fournitures »')
    expect(texte).toContain('• 108000 : crédit 50,00')
    expect(texte).toContain('• 606400 : débit 50,00')
    expect(texte).toContain('— 2035 : hors de la 2035')
    expect(texte).toMatch(/Total : débit 50,00\s€, crédit 50,00\s€\./)
    expect(texte).toContain('Effet sur la 2035 de 2026 : dépenses 0,00')
    expect(texte).toContain('hors de la 2035, un écart déclaré de 50,00')
    expect(texte).toContain('La 2035 de 2025, validée, ne change pas')
    expect(texte).toContain('Motif : Elle était fausse.')
    // Les postes gardés : l'effet compté, sans écart déclaré.
    const comptee = confirmationDeLaContrePassation(E, { ...SAISIE, horsDeLa2035: false }, 'tresorerie')
    expect(comptee).toContain('— 2035 : Fournitures de bureau')
    expect(comptee).toMatch(/Effet sur la 2035 de 2026 : dépenses 50,00\s€, recettes 0,00\s€\.$/m)
    // En engagement : aucune 2035.
    expect(confirmationDeLaContrePassation(E, SAISIE, 'engagement')).toContain('aucune 2035')
    expect(confirmationDeLaContrePassation(E, SAISIE, 'engagement')).not.toContain('La 2035 de 2025')
  })

  it('la saisie de la contre-passation, telle qu’une écriture libre la dirait', () => {
    expect(saisieDeLaContrePassation(E, SAISIE)).toEqual({
      date: '2026-01-01', libelle: SAISIE.libelle, motif: SAISIE.motif, avecExtourne: false,
      lignes: [
        { compte: '108000', sens: 'credit', centimes: 5000, poste2035: null, compteLib: null },
        { compte: '606400', sens: 'debit', centimes: 5000, poste2035: null, compteLib: null },
      ],
    })
  })

  it('le retrait d’une contre-passation dit l’écriture qui redevient à contre-passer', () => {
    const c: EcritureLibreDesExports = { ...C, dossier_id: 'd1', piece_citee_id: null, cree_par: 'u1', cree_le: '2026-01-02T09:00:00Z',
      modifie_par: null, modifie_le: null }
    const texte = confirmationDuRetraitDUneContrePassation(c, [E, C])
    expect(texte).toContain('Retirer l’écriture libre EL2026-0001 du 01/01/2026')
    expect(texte).toContain('L’écriture EL2025-0003 qu’elle contre-passe redevient à contre-passer.')
  })
})
