import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASCULE_OFFERTE, BASCULE_PAS_ENCORE_OFFERTE, CONFIRMATION_DU_RETOUR, ETAT_PAR_SES_PIECES, IRREVERSIBLE_A_LA_PREMIERE_FACTURE,
  LIBELLE_BASCULER, LIBELLE_REVENIR, MOMENT_CONSEILLE, SE_DEFAIT_ENCORE, carteDeLaBascule, ceQueLaBasculeChange,
  confirmationDeLaBascule, etatIllisible, etatParSesFactures, facturesValideesDeLExercice, jourDeLaBascule, listesPartielles,
  type ContexteDeLaCarte, type FactureDeLaBascule, type LectureDeLaBascule, type ListesDeLaBascule,
} from './basculeDesVentes'
import { REFUS_SOURCE_DE_LA_VENTE } from './sourceDeLaVente'

// LA CARTE « SOURCE DES VENTES » (chantier EC-Q3, étape VF8b) : ce qu'elle dit, ce qu'elle offre, ce qui la retient — dans
// l'ordre du module (le réglage illisible, le drapeau, une lecture partielle, le refus de la garde), les refus étant ceux de
// `refusDuReglage` (lib/sourceDeLaVente.ts), confrontés à la base par sourceDeLaVente.test.ts. Données FICTIVES.

const message = (cle: string) => REFUS_SOURCE_DE_LA_VENTE.find((r) => r.cle === cle)!.modele

const facture = (o: Partial<FactureDeLaBascule> & Pick<FactureDeLaBascule, 'id'>): FactureDeLaBascule => ({
  numero: `F-${o.id}`, type: 'facture', statut: 'validee', validated_at: '2026-03-01T10:00:00+00:00',
  source_de_la_vente: false, date_emission: '2026-03-01', ...o,
})

// L'exercice en cours, 2026 : deux factures et un avoir validés en 2026, une facture validée en 2025, un brouillon de 2026.
const FACTURES: FactureDeLaBascule[] = [
  facture({ id: 'f1', date_emission: '2026-01-15' }),
  facture({ id: 'f2', date_emission: '2026-09-30' }),
  facture({ id: 'a1', type: 'avoir', numero: 'A-a1', date_emission: '2026-10-02' }),
  facture({ id: 'f0', date_emission: '2025-12-31' }),
  facture({ id: 'b1', statut: 'brouillon', numero: null, validated_at: null, date_emission: '2026-10-20' }),
]

const lues = (o: Partial<Extract<ListesDeLaBascule, { etat: 'lues' }>> = {}): ListesDeLaBascule => ({
  etat: 'lues', factures: FACTURES, acces: [{ droit_ventes: false }], piecesDeVenteAValider: 4, ...o,
})

const lecture = (o: Partial<LectureDeLaBascule> = {}): LectureDeLaBascule => ({
  dossierId: 'd1', reglage: { etat: 'non_bascule' }, depuis: null, listes: lues(), ...o,
})

const BASCULE = { reglage: { etat: 'bascule' as const }, depuis: '2026-10-26T09:15:00+00:00' }
const CHEF: ContexteDeLaCarte = { chefDuCabinet: true, offerte: true, aujourdhui: '2026-10-26' }
const MEMBRE: ContexteDeLaCarte = { ...CHEF, chefDuCabinet: false }

describe('le jour de la bascule, au calendrier de Paris', () => {
  it('un instant se dit au jour de Paris, quel que soit le fuseau de qui regarde', () => {
    expect(jourDeLaBascule('2026-10-26T09:15:00+00:00')).toBe('26/10/2026')
    // 23 h 30 UTC le 25/10/2026 : déjà le 26 à Paris (UTC+1 depuis la nuit du 24 au 25).
    expect(jourDeLaBascule('2026-10-25T23:30:00Z')).toBe('26/10/2026')
    expect(jourDeLaBascule('2026-06-30T22:30:00Z')).toBe('01/07/2026')
  })

  it('nulle, absente, d’un autre type ou illisible : aucun jour', () => {
    for (const depuis of [null, undefined, 42, true, '', 'demain']) expect(jourDeLaBascule(depuis), String(depuis)).toBeNull()
  })

  it('l’état d’un dossier basculé : avec son jour, sans date gardée, ou une date illisible — jamais confondues', () => {
    expect(etatParSesFactures('2026-10-26T09:15:00+00:00'))
      .toBe('Les factures de ce dossier sont la source de leurs ventes depuis le 26/10/2026.')
    expect(etatParSesFactures(null))
      .toBe('Les factures de ce dossier sont la source de leurs ventes (la base n’a pas gardé la date de la bascule).')
    for (const depuis of [undefined, 'demain', 7]) {
      expect(etatParSesFactures(depuis), String(depuis))
        .toBe('Les factures de ce dossier sont la source de leurs ventes (la date de la bascule ne se lit pas).')
    }
  })
})

describe('ce que la bascule change, dit avant le clic', () => {
  it('compte les factures et avoirs VALIDÉS de l’exercice en cours, ni un brouillon, ni un autre exercice', () => {
    expect(facturesValideesDeLExercice(FACTURES, 2026)).toBe(3)
    expect(facturesValideesDeLExercice(FACTURES, 2025)).toBe(1)
    expect(facturesValideesDeLExercice(FACTURES, 2027)).toBe(0)
  })

  it('les cinq points de la conception, avec les chiffres lus', () => {
    expect(ceQueLaBasculeChange(3, 2026, 4)).toEqual([
      'Chaque facture validée ensuite devient la source de sa vente : elle compte dans la 2035, la CA3 et les états du '
        + 'dossier dès son encaissement (à sa date, dans un dossier tenu en engagement), et son exemplaire déposé ne la compte '
        + 'pas une seconde fois.',
      'Les factures déjà validées restent comptées par leurs pièces : en 2026, 3 factures validées (avoirs compris) le '
        + 'resteront, et cet exercice comptera ses ventes des deux façons.',
      'Aucune pièce n’est reprise : une pièce de vente se désigne comme l’exemplaire de sa facture, ou se déclare hors des '
        + 'factures, à sa validation — 4 attendent la leur aujourd’hui.',
      'Un crédit du relevé qui paie une facture source est réservé à ses encaissements : il ne se classe que par eux, depuis '
        + 'sa fiche.',
      'La case « Ventes » des accès clients s’ouvre (onglet Accès).',
    ])
  })

  it('zéro et un se disent sans pluriel faux', () => {
    const zero = ceQueLaBasculeChange(0, 2026, 0)
    expect(zero[1]).toBe('Les factures déjà validées restent comptées par leurs pièces : aucune facture n’est validée en '
      + '2026 : cet exercice ne mêlera pas les deux façons de compter.')
    expect(zero[2]).toMatch(/— aucune n’attend la sienne aujourd’hui\.$/)
    const un = ceQueLaBasculeChange(1, 2026, 1)
    expect(un[1]).toContain('en 2026, 1 facture validée (avoirs compris) le restera, et cet exercice')
    expect(un[2]).toMatch(/— 1 attend la sienne aujourd’hui\.$/)
  })

  it('la confirmation NOMME les chiffres lus : les factures de l’exercice, les pièces de vente à valider', () => {
    expect(confirmationDeLaBascule(3, 2026, 4)).toBe('Les factures de ce dossier deviendront la source de leurs ventes. '
      + '3 factures validées en 2026 (avoirs compris) resteront comptées par leurs pièces, et 4 pièces de vente à valider se '
      + 'désigneront ou se déclareront à leur validation. La première facture validée ensuite rendra ce réglage irréversible. '
      + 'Continuer ?')
    expect(confirmationDeLaBascule(1, 2027, 1)).toContain('1 facture validée en 2027 (avoirs compris) restera comptée par sa '
      + 'pièce, et 1 pièce de vente à valider se désignera ou se déclarera à sa validation.')
    expect(confirmationDeLaBascule(0, 2026, 0)).toContain('Aucune facture n’est validée en 2026, et aucune pièce de vente '
      + 'n’attend sa validation.')
  })
})

describe('la carte d’un dossier qui n’a pas basculé', () => {
  it('au chef, listes lues : l’état, ce qui change, l’irréversibilité, le moment conseillé et le geste qui nomme', () => {
    expect(carteDeLaBascule(lecture(), CHEF)).toEqual({
      etat: ETAT_PAR_SES_PIECES,
      ceQuiChange: ceQueLaBasculeChange(3, 2026, 4),
      irreversibilite: IRREVERSIBLE_A_LA_PREMIERE_FACTURE,
      momentConseille: MOMENT_CONSEILLE,
      geste: { apres: true, libelle: LIBELLE_BASCULER, confirmation: confirmationDeLaBascule(3, 2026, 4) },
      raison: null,
      refus: null,
    })
  })

  it('l’exercice en cours est celui d’aujourd’hui : au 1er janvier 2027, aucune facture de 2026 ne compte plus', () => {
    const carte = carteDeLaBascule(lecture(), { ...CHEF, aujourdhui: '2027-01-01' })
    expect(carte.geste?.confirmation).toBe(confirmationDeLaBascule(0, 2027, 4))
    expect(carte.ceQuiChange[1]).toContain('aucune facture n’est validée en 2027')
  })

  it('au membre de l’équipe : l’état et ce qui change, jamais le geste, et la raison de la garde (VF8-Q1)', () => {
    const carte = carteDeLaBascule(lecture(), MEMBRE)
    expect(carte.geste).toBeNull()
    expect(carte.raison).toBe(message('reglage_reserve_au_chef'))
    expect(carte.refus).toBe('reglage_reserve_au_chef')
    expect(carte.ceQuiChange).toEqual(ceQueLaBasculeChange(3, 2026, 4))
    expect(carte.irreversibilite).toBe(IRREVERSIBLE_A_LA_PREMIERE_FACTURE)
  })

  it('un accès « Ventes » ne retient pas la bascule : il ne retient que le retour', () => {
    const carte = carteDeLaBascule(lecture({ listes: lues({ acces: [{ droit_ventes: true }] }) }), CHEF)
    expect(carte.geste?.apres).toBe(true)
  })
})

describe('la carte d’un dossier basculé', () => {
  it('sans facture source ni accès « Ventes », au chef : l’état daté, le réglage qui se défait encore, le retour', () => {
    expect(carteDeLaBascule(lecture(BASCULE), CHEF)).toEqual({
      etat: 'Les factures de ce dossier sont la source de leurs ventes depuis le 26/10/2026.',
      ceQuiChange: [],
      irreversibilite: SE_DEFAIT_ENCORE,
      momentConseille: null,
      geste: { apres: false, libelle: LIBELLE_REVENIR, confirmation: CONFIRMATION_DU_RETOUR },
      raison: null,
      refus: null,
    })
  })

  it('une facture source : irréversible, pour le chef aussi, et la première validée est nommée', () => {
    const sources = [
      facture({ id: 's2', numero: 'F2026-0009', source_de_la_vente: true, validated_at: '2026-10-28T08:00:00+00:00' }),
      facture({ id: 's1', numero: 'F2026-0010', source_de_la_vente: true, validated_at: '2026-10-27T08:00:00+00:00' }),
    ]
    for (const contexte of [CHEF, MEMBRE]) {
      const carte = carteDeLaBascule(lecture({ ...BASCULE, listes: lues({ factures: [...FACTURES, ...sources] }) }), contexte)
      expect(carte.geste).toBeNull()
      expect(carte.refus).toBe('reglage_irreversible')
      expect(carte.raison).toBe(message('reglage_irreversible').replace('%', 'F2026-0010'))
      expect(carte.irreversibilite).toBeNull()
    }
  })

  it('sous un accès « Ventes », au chef : le retour se refuse avant le clic', () => {
    const carte = carteDeLaBascule(lecture({ ...BASCULE, listes: lues({ acces: [{ droit_ventes: false }, { droit_ventes: true }] }) }), CHEF)
    expect(carte.geste).toBeNull()
    expect(carte.refus).toBe('reglage_retenu_par_ventes')
    expect(carte.raison).toBe(message('reglage_retenu_par_ventes'))
    expect(carte.irreversibilite).toBe(SE_DEFAIT_ENCORE)
  })

  it('l’ordre de la garde : le membre sous un accès « Ventes » s’entend dire qu’il n’est pas le chef', () => {
    const carte = carteDeLaBascule(lecture({ ...BASCULE, listes: lues({ acces: [{ droit_ventes: true }] }) }), MEMBRE)
    expect(carte.refus).toBe('reglage_reserve_au_chef')
  })
})

describe('ce qui retient tout geste, dans l’ordre', () => {
  it('le réglage illisible : l’état le dit, rien d’autre — même drapeau levé, au chef', () => {
    for (const offerte of [false, true]) {
      expect(carteDeLaBascule(lecture({ reglage: { etat: 'illisible', motif: 'lecture refusée' } }), { ...CHEF, offerte }))
        .toEqual({
          etat: etatIllisible('lecture refusée'), ceQuiChange: [], irreversibilite: null, momentConseille: null, geste: null,
          raison: null, refus: null,
        })
    }
    expect(etatIllisible('lecture refusée')).toBe('La source des ventes de ce dossier ne se lit pas (lecture refusée) : elle '
      + 'ne se change pas d’ici. Recharge la page pour la relire.')
  })

  it('le drapeau baissé : l’état et pourquoi, sans geste, dans les deux sens — avant même une lecture partielle', () => {
    for (const lue of [lecture(), lecture(BASCULE), lecture({ listes: { etat: 'partielles', motif: 'refus' } })]) {
      const carte = carteDeLaBascule(lue, { ...CHEF, offerte: false })
      expect(carte.geste).toBeNull()
      expect(carte.raison).toBe(BASCULE_PAS_ENCORE_OFFERTE)
      expect(carte.ceQuiChange).toEqual([])
      expect(carte.irreversibilite).toBeNull()
      expect(carte.momentConseille).toBeNull()
    }
    expect(carteDeLaBascule(lecture(BASCULE), { ...CHEF, offerte: false }).etat)
      .toBe('Les factures de ce dossier sont la source de leurs ventes depuis le 26/10/2026.')
  })

  it('une liste lue en partie : l’état, et pourquoi rien ne se change d’ici, sans aucun chiffre', () => {
    for (const reglage of [lecture(), lecture(BASCULE)]) {
      const carte = carteDeLaBascule({ ...reglage, listes: { etat: 'partielles', motif: 'les accès : refus' } }, CHEF)
      expect(carte).toEqual({
        etat: carteDeLaBascule(reglage, CHEF).etat, ceQuiChange: [], irreversibilite: null, momentConseille: null, geste: null,
        raison: listesPartielles('les accès : refus'), refus: null,
      })
    }
    expect(listesPartielles('x')).toBe('Les factures, les accès clients ou les pièces de vente du dossier n’ont pas été lus '
      + 'en entier (x) : la source des ventes ne se change pas d’ici, ses refus ne se diraient pas avant le clic. Recharge la '
      + 'page pour les relire.')
  })
})

describe('le drapeau de la bascule', () => {
  it('est levé, et son commentaire nomme les deux conditions remplies', () => {
    // La session l'a levé elle-même, ces deux conditions remplies le 27/10/2026 : ce test a changé avec lui.
    expect(BASCULE_OFFERTE).toBe(true)
    const texte = readFileSync(resolve(process.cwd(), 'src/lib/basculeDesVentes.ts'), 'utf8')
    const commentaire = texte.slice(texte.indexOf('// LA BASCULE EST OFFERTE'), texte.indexOf('export const BASCULE_OFFERTE'))
    expect(commentaire).toContain('VF5H2-Q1')
    expect(commentaire).toContain('VF8e en ligne')
  })
})
