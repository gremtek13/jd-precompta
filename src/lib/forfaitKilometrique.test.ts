import { describe, expect, it } from 'vitest'
import { COMPTE_EXPLOITANT, COMPTE_INDEMNITES_KILOMETRIQUES, libelleCompteTenu } from './comptes'
import type { ModeleComptable } from './engagement'
import {
  amortissementsSousLeBareme, dateDuForfait, ecritureDuForfait, forfaitAEcrireCentimes, forfaitConforme, forfaitsDuCadre7,
  forfaitsEnDefaut, nomDuVehicule, refusForfait,
} from './forfaitKilometrique'
import type { EcritureBrouillon, Immobilisation, NatureImmobilisation, VehiculeDossier } from './types'

// TYPÉS sans `as` : le compilateur confronte chaque champ à la table.
const vehicule = (o: Partial<VehiculeDossier> = {}): VehiculeDossier => ({
  id: 'v1', dossier_id: 'd1', annee: 2025, modele: 'Clio', type: 'voiture', puissance_fiscale: 3, bareme: 'bnc',
  motorisation: 'thermique', carburant: 'diesel', km_professionnel: 45, inscrit_immobilisations: false,
  amortissements_a_reintegrer: null, created_at: '2025-01-05T10:00:00Z', updated_at: '2025-01-05T10:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: 'v1',
  date: '2025-12-31', compte: COMPTE_INDEMNITES_KILOMETRIQUES, libelle: 'Indemnités kilométriques 2025 — Clio',
  montant: 23.81, sens: 'debit', statut: 'proposee', created_at: '2026-01-05T10:00:00Z', ...o,
})

// Le forfait écrit, tel que la base le garde : le 625110 au débit, le compte du dirigeant au crédit.
const forfaitEcrit = (montant: number, o: Partial<EcritureBrouillon> = {}, compte = COMPTE_EXPLOITANT): EcritureBrouillon[] => [
  ecriture({ id: 'e-d', montant, sens: 'debit', ...o }),
  ecriture({ id: 'e-c', montant, sens: 'credit', compte, ...o }),
]

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '467000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

describe('dateDuForfait et nomDuVehicule', () => {
  it('tombe au 31 décembre de l’exercice', () => {
    expect(dateDuForfait(2025)).toBe('2025-12-31')
  })

  it('nomme le véhicule par son modèle, sinon par ce que le barème en sait', () => {
    expect(nomDuVehicule(vehicule({ modele: '  Peugeot 308  ' }))).toBe('Peugeot 308')
    expect(nomDuVehicule(vehicule({ modele: null, puissance_fiscale: 5 }))).toBe('Voiture 5 CV')
    expect(nomDuVehicule(vehicule({ modele: '   ', puissance_fiscale: 5, motorisation: 'electrique' }))).toBe('Voiture 5 CV électrique')
    expect(nomDuVehicule(vehicule({ modele: null, type: 'moto', puissance_fiscale: 3, motorisation: 'hybride' }))).toBe('Moto 3 CV')
    // Le cyclomoteur n'a pas de puissance fiscale : la dire « 0 CV » ne nommerait rien.
    expect(nomDuVehicule(vehicule({ modele: null, type: 'cyclomoteur', puissance_fiscale: 0 }))).toBe('Cyclomoteur')
  })
})

describe('forfaitAEcrireCentimes — le forfait que la base écrirait', () => {
  it('rend l’indemnité du barème, en centimes et au demi-centime supérieur', () => {
    // 45 km à 0,529 € font 23,805 € : la base écrit 23,81 €.
    expect(forfaitAEcrireCentimes(vehicule(), null)).toBe(2381n)
    expect(forfaitAEcrireCentimes(vehicule({ annee: 2026, puissance_fiscale: 5, motorisation: 'electrique', km_professionnel: 20_000 }), null))
      .toBe(1_023_400n)
  })

  it('ne rend rien avant l’ouverture d’un dossier repris : ses à-nouveaux portent l’exercice', () => {
    expect(forfaitAEcrireCentimes(vehicule({ annee: 2025 }), '2026-01-01')).toBe(0n)
    // L'exercice de l'ouverture s'écrit : son 31 décembre la suit.
    expect(forfaitAEcrireCentimes(vehicule({ annee: 2026 }), '2026-01-01')).toBe(2381n)
    // Même sans barème : un exercice repris n'a rien à calculer.
    expect(forfaitAEcrireCentimes(vehicule({ annee: 2024 }), '2025-01-01')).toBe(0n)
  })

  it('rend null quand le barème ne le calcule pas', () => {
    expect(forfaitAEcrireCentimes(vehicule({ annee: 2024 }), null)).toBeNull()
    expect(forfaitAEcrireCentimes(vehicule({ type: 'moto', puissance_fiscale: 0 }), null)).toBeNull()
  })

  it('lit une motorisation absente ou hybride comme thermique — seuls les 100 % électriques ont leur table', () => {
    // La base fait `motorisation is not distinct from 'electrique'` : une motorisation nulle n'y est pas
    // électrique, et l'indemnité n'y devient pas nulle pour autant.
    const thermique = forfaitAEcrireCentimes(vehicule({ motorisation: 'thermique', km_professionnel: 12_000, puissance_fiscale: 5 }), null)
    expect(thermique).toBe(567_900n)
    expect(forfaitAEcrireCentimes(vehicule({ motorisation: null, km_professionnel: 12_000, puissance_fiscale: 5 }), null)).toBe(thermique)
    expect(forfaitAEcrireCentimes(vehicule({ motorisation: 'hybride', km_professionnel: 12_000, puissance_fiscale: 5 }), null)).toBe(thermique)
    expect(forfaitAEcrireCentimes(vehicule({ motorisation: 'electrique', km_professionnel: 12_000, puissance_fiscale: 5 }), null))
      .not.toBe(thermique)
  })
})

describe('ecritureDuForfait — le 625110 face au compte du dirigeant', () => {
  it('débite le 625110 et crédite le 108000 de l’exploitant en trésorerie', () => {
    expect(ecritureDuForfait(vehicule(), TRESORERIE, null)).toEqual([
      { compte: '625110', sens: 'debit', montant: 23.81, libelle: 'Indemnités kilométriques 2025 — Clio' },
      { compte: '108000', sens: 'credit', montant: 23.81, libelle: 'Indemnités kilométriques 2025 — Clio' },
    ])
  })

  it('crédite le compte choisi pour le dirigeant en engagement', () => {
    const lignes = ecritureDuForfait(vehicule(), ENGAGEMENT, null)!
    expect(lignes.map((l) => [l.compte, l.sens])).toEqual([['625110', 'debit'], ['455000', 'credit']])
  })

  it('ne compose rien sur un forfait nul, et rien du tout sur un forfait incalculable', () => {
    expect(ecritureDuForfait(vehicule({ km_professionnel: 0 }), TRESORERIE, null)).toEqual([])
    expect(ecritureDuForfait(vehicule({ annee: 2025 }), TRESORERIE, '2026-01-01')).toEqual([])
    expect(ecritureDuForfait(vehicule({ annee: 2024 }), TRESORERIE, null)).toBeNull()
  })

  it('nomme son compte dans la balance et le FEC', () => {
    expect(libelleCompteTenu('625110')).toBe('Indemnités kilométriques (barème)')
  })
})

describe('refusForfait — les refus de la base, dans son ordre', () => {
  it('refuse un exercice à venir avant tout le reste', () => {
    expect(refusForfait(vehicule({ annee: 2027 }), 2026, [{ statut: 'validee' }], null))
      .toBe('Le forfait d’un exercice à venir ne s’écrit pas encore.')
  })

  it('refuse de remplacer un forfait validé, même avant l’ouverture', () => {
    expect(refusForfait(vehicule(), 2026, [{ statut: 'proposee' }, { statut: 'validee' }], null))
      .toBe('Le forfait 2025 de ce véhicule est validé : il ne se remplace plus.')
    expect(refusForfait(vehicule(), 2026, [{ statut: 'validee' }], '2026-01-01'))
      .toBe('Le forfait 2025 de ce véhicule est validé : il ne se remplace plus.')
  })

  it('dit pourquoi le barème ne calcule pas', () => {
    expect(refusForfait(vehicule({ annee: 2024 }), 2026, [], null))
      .toBe('Le barème kilométrique 2024 n’est pas renseigné dans l’application.')
    expect(refusForfait(vehicule({ type: 'moto', puissance_fiscale: 0 }), 2026, [], null))
      .toBe('La puissance fiscale de ce véhicule est hors du barème kilométrique 2025.')
    expect(refusForfait(vehicule({ km_professionnel: 12.5 }), 2026, [], null))
      .toBe('Le kilométrage de ce véhicule n’est pas un nombre entier de kilomètres.')
  })

  it('ne refuse rien avant l’ouverture, même sans barème : l’écriture vide retire ce qui aurait été écrit', () => {
    expect(refusForfait(vehicule({ annee: 2024 }), 2026, [{ statut: 'proposee' }], '2025-01-01')).toBeNull()
  })

  it('ne refuse rien quand le forfait se calcule — l’exercice en cours compris', () => {
    expect(refusForfait(vehicule({ annee: 2026 }), 2026, [], null)).toBeNull()
    expect(refusForfait(vehicule({ km_professionnel: 0 }), 2026, [], null)).toBeNull()
  })
})

describe('forfaitConforme — exactement l’écriture attendue, au centime', () => {
  const attendues = ecritureDuForfait(vehicule(), TRESORERIE, null)!

  it('accepte les mêmes lignes dans n’importe quel ordre', () => {
    expect(forfaitConforme(forfaitEcrit(23.81), attendues, 2025)).toBe(true)
    expect(forfaitConforme([...forfaitEcrit(23.81)].reverse(), attendues, 2025)).toBe(true)
  })

  it('refuse un centime d’écart, une autre date, un autre compte, une ligne de trop ou de moins', () => {
    expect(forfaitConforme(forfaitEcrit(23.80), attendues, 2025)).toBe(false)
    expect(forfaitConforme(forfaitEcrit(23.81, { date: '2025-12-30' }), attendues, 2025)).toBe(false)
    expect(forfaitConforme(forfaitEcrit(23.81), attendues, 2026)).toBe(false)
    expect(forfaitConforme(forfaitEcrit(23.81, {}, '455000'), attendues, 2025)).toBe(false)
    expect(forfaitConforme([...forfaitEcrit(23.81), ecriture({ id: 'e-x', montant: 0.01 })], attendues, 2025)).toBe(false)
    expect(forfaitConforme(forfaitEcrit(23.81).slice(0, 1), attendues, 2025)).toBe(false)
  })

  it('compare au centime, pas à l’écriture flottante', () => {
    // 0,1 + 0,2 n'est pas 0,3 en flottants : le montant relu de la base ne se compare pas à l'égalité stricte.
    const lignes = [{ compte: '625110', sens: 'debit' as const, montant: 0.3, libelle: '' }]
    expect(forfaitConforme([ecriture({ montant: 0.1 + 0.2 })], lignes, 2025)).toBe(true)
  })
})

describe('forfaitsDuCadre7 — l’état de chaque ligne du cadre 7', () => {
  const etats = (vehicules: VehiculeDossier[], ecritures: EcritureBrouillon[], modele = TRESORERIE, ouverture: string | null = null) =>
    forfaitsDuCadre7(vehicules, ecritures, modele, ouverture, 2026).map((f) => f.etat)

  it('dit « à écrire » un forfait que rien n’a écrit, et « écrit » celui du barème', () => {
    expect(etats([vehicule()], [])).toEqual(['a_ecrire'])
    expect(etats([vehicule()], forfaitEcrit(23.81))).toEqual(['ecrit'])
  })

  it('dit « à réécrire » un forfait qui ne suit plus le cadre 7 ou le compte du dirigeant', () => {
    expect(etats([vehicule({ km_professionnel: 46 })], forfaitEcrit(23.81))).toEqual(['a_reecrire'])
    // Le dossier passé en engagement : le forfait écrit au 108000 ne suit plus le compte du dirigeant.
    expect(etats([vehicule()], forfaitEcrit(23.81), ENGAGEMENT)).toEqual(['a_reecrire'])
    expect(etats([vehicule()], forfaitEcrit(23.81, {}, '455000'), ENGAGEMENT)).toEqual(['ecrit'])
  })

  it('dit « à retirer » un forfait écrit qui n’a plus lieu d’être', () => {
    expect(etats([vehicule({ km_professionnel: 0 })], forfaitEcrit(23.81))).toEqual(['a_retirer'])
    expect(etats([vehicule()], forfaitEcrit(23.81), TRESORERIE, '2026-01-01')).toEqual(['a_retirer'])
  })

  it('dit « validé » un forfait validé qui diverge, et « écrit » un forfait validé conforme', () => {
    expect(etats([vehicule({ km_professionnel: 46 })], forfaitEcrit(23.81, { statut: 'validee' }))).toEqual(['valide'])
    expect(etats([vehicule()], forfaitEcrit(23.81, { statut: 'validee' }))).toEqual(['ecrit'])
  })

  it('dit « rien » quand il n’y a rien à écrire et rien d’écrit', () => {
    expect(etats([vehicule({ km_professionnel: 0 })], [])).toEqual(['rien'])
    expect(etats([vehicule({ annee: 2025 })], [], TRESORERIE, '2026-01-01')).toEqual(['rien'])
  })

  it('rend le refus d’un forfait incalculable, à écrire ou à réécrire', () => {
    const [aEcrire] = forfaitsDuCadre7([vehicule({ annee: 2024 })], [], TRESORERIE, null, 2026)
    expect(aEcrire.etat).toBe('a_ecrire')
    expect(aEcrire.attendues).toBeNull()
    expect(aEcrire.refus).toBe('Le barème kilométrique 2024 n’est pas renseigné dans l’application.')
    const [aReecrire] = forfaitsDuCadre7([vehicule({ type: 'moto', puissance_fiscale: 0 })], forfaitEcrit(23.81), TRESORERIE, null, 2026)
    expect(aReecrire.etat).toBe('a_reecrire')
    expect(aReecrire.refus).toBe('La puissance fiscale de ce véhicule est hors du barème kilométrique 2025.')
  })

  it('ne prend que les écritures de CE véhicule', () => {
    const autres = [
      ...forfaitEcrit(23.81, { vehicule_id: 'v2' }),
      // Une dotation et l'écriture d'une pièce n'ont pas de véhicule.
      ecriture({ id: 'dot', vehicule_id: null, immobilisation_id: 'i1', compte: '681100' }),
      ecriture({ id: 'piece', vehicule_id: null, piece_id: 'p1', compte: '606100' }),
    ]
    const [v1, v2] = forfaitsDuCadre7([vehicule(), vehicule({ id: 'v2' })], autres, TRESORERIE, null, 2026)
    expect(v1.presentes).toEqual([])
    expect(v1.etat).toBe('a_ecrire')
    expect(v2.presentes.map((e) => e.id)).toEqual(['e-d', 'e-c'])
    expect(v2.etat).toBe('ecrit')
  })

  it('rend le montant et l’écriture attendue', () => {
    const [f] = forfaitsDuCadre7([vehicule()], [], TRESORERIE, null, 2026)
    expect(f.centimes).toBe(2381n)
    expect(f.attendues).toEqual(ecritureDuForfait(vehicule(), TRESORERIE, null))
    expect(f.refus).toBeNull()
  })
})

describe('forfaitsEnDefaut — ce que la Checklist réclame', () => {
  const enDefaut = (vehicules: VehiculeDossier[], ecritures: EcritureBrouillon[] = []) =>
    forfaitsEnDefaut(forfaitsDuCadre7(vehicules, ecritures, TRESORERIE, null, 2026), 2026).map((f) => f.vehicule.id)

  it('réclame le forfait d’un exercice révolu, pas celui de l’exercice en cours', () => {
    expect(enDefaut([vehicule({ id: 'a', annee: 2025 }), vehicule({ id: 'b', annee: 2026 })])).toEqual(['a'])
  })

  it('réclame tout forfait écrit qui ne suit plus le cadre 7, l’exercice en cours compris', () => {
    expect(enDefaut([vehicule({ annee: 2026, km_professionnel: 46 })], forfaitEcrit(23.81, { date: '2026-12-31' }))).toEqual(['v1'])
    expect(enDefaut([vehicule({ annee: 2026, km_professionnel: 0 })], forfaitEcrit(23.81, { date: '2026-12-31' }))).toEqual(['v1'])
    expect(enDefaut([vehicule({ km_professionnel: 46 })], forfaitEcrit(23.81, { statut: 'validee' }))).toEqual(['v1'])
  })

  it('réclame le forfait incalculable d’un exercice révolu : la 2035 n’en compte rien non plus', () => {
    expect(enDefaut([vehicule({ annee: 2024 })])).toEqual(['v1'])
  })

  it('se tait sur un forfait écrit et sur une ligne sans rien à écrire', () => {
    expect(enDefaut([vehicule()], forfaitEcrit(23.81))).toEqual([])
    expect(enDefaut([vehicule({ km_professionnel: 0 })])).toEqual([])
  })
})

describe('amortissementsSousLeBareme — le véhicule du registre déduit deux fois', () => {
  const TRANSPORT: NatureImmobilisation = {
    id: 'n-transport', dossier_id: null, libelle: 'Matériel de transport', duree_annees_defaut: 5, ordre: 4,
    compte_immobilisation: '218200',
  }
  const INFORMATIQUE: NatureImmobilisation = {
    id: 'n-info', dossier_id: null, libelle: 'Informatique', duree_annees_defaut: 3, ordre: 2, compte_immobilisation: '218300',
  }
  const bien = (o: Partial<Immobilisation> = {}): Immobilisation => ({
    id: 'i1', dossier_id: 'd1', piece_id: 'p1', nature_id: 'n-transport', libelle: 'Voiture de tournée',
    valeur: 15_000, date_acquisition: '2024-01-01', date_mise_en_service: null, duree_annees: 5,
    created_at: '2024-01-02T10:00:00Z', ...o,
  })
  const natures = [TRANSPORT, INFORMATIQUE]

  it('signale le matériel de transport amorti l’année où le barème est retenu', () => {
    expect(amortissementsSousLeBareme([bien()], natures, [vehicule()], 2025))
      .toEqual([{ annee: 2025, immobilisation: bien(), dotation: 3000 }])
  })

  it('se tait quand le barème n’est pas retenu cette année-là', () => {
    expect(amortissementsSousLeBareme([bien()], natures, [], 2025)).toEqual([])
    expect(amortissementsSousLeBareme([bien()], natures, [vehicule({ km_professionnel: 0 })], 2025)).toEqual([])
    expect(amortissementsSousLeBareme([bien()], natures, [vehicule({ annee: 2026 })], 2025)).toEqual([])
  })

  it('ne regarde que le matériel de transport, et seulement l’année où il est amorti', () => {
    expect(amortissementsSousLeBareme([bien({ nature_id: 'n-info' })], natures, [vehicule()], 2025)).toEqual([])
    expect(amortissementsSousLeBareme([bien({ nature_id: null })], natures, [vehicule()], 2025)).toEqual([])
    // Amorti de 2019 à 2023 : rien en 2025.
    expect(amortissementsSousLeBareme([bien({ date_acquisition: '2019-01-01' })], natures, [vehicule()], 2025)).toEqual([])
    // Mis en service en 2026 : rien en 2025.
    expect(amortissementsSousLeBareme([bien({ date_mise_en_service: '2026-01-01' })], natures, [vehicule()], 2025)).toEqual([])
  })
})
