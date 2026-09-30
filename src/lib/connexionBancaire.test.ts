import { describe, expect, it } from 'vitest'
import {
  joursAvantExpiration, periodeParDefaut, phraseEcartes, planImport, sourceDeLaConnexion, type MouvementRecupere,
} from './connexionBancaire'
import { statutPourLibelle } from './reglesIgnorees'

const ligne = (date: string, montant = -10, id_externe: string | null = null) => ({ date, montant, id_externe })
const mouvement = (id: string, date: string, montant: number, libelle = 'PRLV FICTIF'): MouvementRecupere =>
  ({ id_externe: id, date, montant, libelle })

describe('la période proposée à la récupération', () => {
  it('reprend au dernier mouvement DÉJÀ récupéré de la banque, ce jour-là compris', () => {
    const lignes = [ligne('2026-09-10', -5, 'eb:r:a'), ligne('2026-09-20', -5, 'eb:r:b'), ligne('2026-09-25')]
    expect(periodeParDefaut(lignes, '2026-09-30')).toEqual({ du: '2026-09-20', au: '2026-09-30' })
  })

  it('sans récupération précédente, commence le LENDEMAIN du dernier mouvement du relevé', () => {
    // Un mouvement de fichier ne se reconnaît qu'à sa date et son montant : ne pas repasser sur ses jours.
    expect(periodeParDefaut([ligne('2026-08-31'), ligne('2026-07-15')], '2026-09-30')).toEqual({ du: '2026-09-01', au: '2026-09-30' })
  })

  it('sur un relevé vide, trois mois', () => {
    expect(periodeParDefaut([], '2026-09-30')).toEqual({ du: '2026-07-03', au: '2026-09-30' })
  })

  it('ne commence jamais après aujourd’hui', () => {
    expect(periodeParDefaut([ligne('2026-09-30')], '2026-09-30')).toEqual({ du: '2026-09-30', au: '2026-09-30' })
  })
})

describe('ce qui s’importe vraiment', () => {
  it('un identifiant déjà dans le relevé n’est pas réimporté', () => {
    const plan = planImport([mouvement('eb:r:a', '2026-09-02', -10), mouvement('eb:r:b', '2026-09-03', -20)],
      [ligne('2026-09-02', -10, 'eb:r:a')])
    expect(plan.dejaImportes.map((m) => m.id_externe)).toEqual(['eb:r:a'])
    expect(plan.aImporter.map((m) => m.id_externe)).toEqual(['eb:r:b'])
    expect(plan.dansUnReleve).toEqual([])
  })

  it('une opération déjà importée d’un FICHIER se reconnaît à sa date et son montant', () => {
    const plan = planImport([mouvement('eb:r:a', '2026-09-02', -12.3)], [ligne('2026-09-02', -12.30)])
    expect(plan.dansUnReleve.map((m) => m.id_externe)).toEqual(['eb:r:a'])
    expect(plan.aImporter).toEqual([])
  })

  it('un à un : deux cafés du même prix le même jour, dont un seul dans le fichier, en laissent un', () => {
    const plan = planImport(
      [mouvement('eb:e:1', '2026-09-02', -2.5), mouvement('eb:e:2', '2026-09-02', -2.5)],
      [ligne('2026-09-02', -2.5)])
    expect(plan.dansUnReleve).toHaveLength(1)
    expect(plan.aImporter).toHaveLength(1)
  })

  it('un mouvement récupéré d’abord ne se compte pas comme une ligne de fichier', () => {
    // La ligne déjà récupérée (identifiant) ne doit pas « absorber » un autre mouvement au même montant.
    const plan = planImport(
      [mouvement('eb:r:a', '2026-09-02', -2.5), mouvement('eb:r:b', '2026-09-02', -2.5)],
      [ligne('2026-09-02', -2.5, 'eb:r:a')])
    expect(plan.dejaImportes).toHaveLength(1)
    expect(plan.aImporter.map((m) => m.id_externe)).toEqual(['eb:r:b'])
  })

  it('ni une autre date ni un autre montant ni l’autre sens ne passent pour la même opération', () => {
    const plan = planImport(
      [mouvement('eb:r:a', '2026-09-03', -10), mouvement('eb:r:b', '2026-09-02', -10.01), mouvement('eb:r:c', '2026-09-02', 10)],
      [ligne('2026-09-02', -10)])
    expect(plan.aImporter).toHaveLength(3)
  })
})

describe('l’accord de la banque', () => {
  const maintenant = new Date('2026-09-30T12:00:00Z')
  it('les jours entiers qui restent, négatifs une fois passé', () => {
    expect(joursAvantExpiration('2026-10-14T12:00:00+00:00', maintenant)).toBe(14)
    expect(joursAvantExpiration('2026-10-14T11:00:00+00:00', maintenant)).toBe(13)
    expect(joursAvantExpiration('2026-09-29T12:00:00+00:00', maintenant)).toBe(-1)
  })
  it('rien quand l’échéance n’est pas connue', () => {
    expect(joursAvantExpiration(null, maintenant)).toBeNull()
    expect(joursAvantExpiration('pas une date', maintenant)).toBeNull()
  })
})

describe('ce qui se dit d’une récupération', () => {
  it('les écarts, un par motif, et rien quand rien n’est écarté', () => {
    expect(phraseEcartes({ non_comptabilises: 0, autre_devise: 0, hors_periode: 0, illisibles: 0, doublons: 0 })).toBeNull()
    expect(phraseEcartes({ non_comptabilises: 2, autre_devise: 1, hors_periode: 3, illisibles: 1, doublons: 1 })).toBe(
      'Écartés : 2 pas encore comptabilisés par la banque, 1 dans une autre devise que l’euro, 3 hors de la période, ' +
      '1 illisible (sans date, sans sens ou sans montant), 1 rendu deux fois par la banque.')
  })
  it('chaque mouvement importé porte la banque dont il vient', () => {
    expect(sourceDeLaConnexion('Mock ASPSP')).toBe('Connexion bancaire — Mock ASPSP')
  })
})

describe('le statut d’un mouvement à son import — commun aux trois chemins', () => {
  it('ignoré quand une règle du dossier reconnaît le libellé, sans égard à la casse du libellé', () => {
    expect(statutPourLibelle('PRLV SEPA Assurance Fictive', [{ motif: 'assurance fictive' }])).toBe('ignoree')
    expect(statutPourLibelle('PRLV SEPA Assurance Fictive', [{ motif: 'mutuelle' }])).toBe('non_rapprochee')
    expect(statutPourLibelle('PRLV', [])).toBe('non_rapprochee')
  })
})
