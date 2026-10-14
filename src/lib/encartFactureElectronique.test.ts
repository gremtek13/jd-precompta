import { describe, expect, it } from 'vitest'
import { CE_QUE_ETABLIT, LIBELLE_VERIFICATION } from './adressesReceptionVue'
import {
  attenteDeLEncart, ligneDEtat, phraseDeLAdresse, phraseDeLaLectureRatee, phraseSansAdresse, phrasesDeCeQuiManque,
  phrasesDeLAttente, phrasesDesPlateformes, refuseesSurLeurPlateforme, type AttenteDeLEncart,
} from './encartFactureElectronique'
import { etatDeLaFactureElectronique } from './etatFactureElectronique'
import type { LectureDeLEtat } from './etatFactureElectroniqueLecture'
import { compterLesPastilles } from './tuilesVentes'
import type { EncaissementFacture, EncaissementFactureTaux, FactureEmise, TransmissionFacture } from './types'
import {
  ADRESSE_FICTIVE, ETAT_FICTIF, ETAT_NEUF, adresseFictive, etatFictif, listesVides, statutLuFictif,
} from '../test/etatFactureElectronique'
import { facture as factureCii } from '../test/facturesCii'

// CE QUE DIT L'ENCART « FACTURE ÉLECTRONIQUE » (espace client, étape A6b2) : le module pur, sans lecture ni horloge. Ce que ces
// cas gardent :
//  1. la ligne d'état : « Active » ou « À compléter » ne se dit que d'une valeur LUE — jamais d'une lecture en cours,
//     illisible ou refusée ;
//  2. ce qui manque est celui du module de l'état, mis en phrase, jamais réécrit ; l'adresse dit sa prise d'effet (« À venir »)
//     et sa vérification (« Non vérifiée ») sous les phrases de la fenêtre de l'adresse, et ce que sa source établit (A6-Q4) ;
//  3. ce qui attend vient des MÊMES listes que les pastilles de l'onglet Factures, et ne se compte que de listes lues en entier ;
//  4. les phrases d'une lecture ratée ne disent ni « active » ni « à compléter ».
// Données FICTIVES. Le jour est donné : aucune horloge.

const AUJOURDHUI = '2027-11-20'

// ── 1. La ligne d'état ───────────────────────────────────────────────────────────────────────────────────────────────
describe('la ligne d’état, sous le titre', () => {
  it('pas revenue : « Chargement… » ; illisible ou refusée : « Lecture impossible » — jamais un état', () => {
    expect(ligneDEtat({ etat: 'en_cours' }, AUJOURDHUI)).toBe('Chargement…')
    const ratees: LectureDeLEtat[] = [{ etat: 'illisible' }, { etat: 'refusee', motif: 'permission denied' }]
    for (const lecture of ratees) {
      const ligne = ligneDEtat(lecture, AUJOURDHUI)
      expect(ligne).toBe('Lecture impossible')
      expect(ligne).not.toMatch(/active|compléter/i)
    }
  })

  it('une plateforme reliée et une adresse en vigueur : « Active »', () => {
    expect(ligneDEtat({ etat: 'lue', lu: ETAT_FICTIF }, AUJOURDHUI)).toBe('Active')
    // Super PDP seul compte aussi, et une adresse non vérifiée compte (A6-Q3).
    const superpdp = etatFictif({
      plateforme: ETAT_NEUF.plateforme, superpdp: { relie: true, depuis: '2026-09-05T14:00:00+02:00' },
      adresse: adresseFictive({ verification: 'declaration', verifiee_le: null }),
    })
    expect(ligneDEtat({ etat: 'lue', lu: superpdp }, AUJOURDHUI)).toBe('Active')
  })

  it('à compléter dit COMBIEN de points, au singulier et au pluriel', () => {
    expect(ligneDEtat({ etat: 'lue', lu: ETAT_NEUF }, AUJOURDHUI)).toBe('À compléter : 2 points')
    expect(ligneDEtat({ etat: 'lue', lu: etatFictif({ adresse: null }) }, AUJOURDHUI)).toBe('À compléter : 1 point')
  })

  it('une adresse à venir ne fait pas « active » : le jour de sa prise d’effet, si', () => {
    const avenir = etatFictif({ adresse: adresseFictive({ prise_effet: '2027-11-21' }) })
    expect(ligneDEtat({ etat: 'lue', lu: avenir }, AUJOURDHUI)).toBe('À compléter : 1 point')
    expect(ligneDEtat({ etat: 'lue', lu: avenir }, '2027-11-21')).toBe('Active')
  })
})

// ── 2. Ce qui manque, l'adresse, les plateformes ─────────────────────────────────────────────────────────────────────
describe('ce que dit la carte de ce qui manque, de l’adresse et des plateformes', () => {
  it('ce qui manque est celui du module de l’état, mot pour mot, une majuscule en tête', () => {
    for (const lu of [ETAT_NEUF, etatFictif({ adresse: null }), etatFictif({ adresse: adresseFictive({ prise_effet: '2027-12-01' }) })]) {
      const etat = etatDeLaFactureElectronique(lu, AUJOURDHUI)
      expect(etat.etat).toBe('a_completer')
      const libelles = etat.etat === 'a_completer' ? etat.manque.map((m) => m.libelle) : []
      expect(phrasesDeCeQuiManque(lu, AUJOURDHUI)).toEqual(libelles.map((l) => `${l[0].toLocaleUpperCase('fr-FR')}${l.slice(1)}.`))
    }
    expect(phrasesDeCeQuiManque(ETAT_NEUF, AUJOURDHUI)).toEqual([
      'Aucune plateforme de réception reliée (plateforme agréée ou Super PDP).',
      'Aucune adresse de réception déclarée.',
    ])
    expect(phrasesDeCeQuiManque(etatFictif({ adresse: adresseFictive({ prise_effet: '2027-12-01' }) }), AUJOURDHUI))
      .toEqual(['L’adresse de réception déclarée ne prend effet que le 01/12/2027.'])
  })

  it('active : rien ne manque', () => {
    expect(phrasesDeCeQuiManque(ETAT_FICTIF, AUJOURDHUI)).toEqual([])
  })

  it('l’adresse : son identifiant, sa maille, sa plateforme, « Reçoit depuis le… » et « Non vérifiée », puis ce que sa source établit', () => {
    const p = phraseDeLAdresse(ADRESSE_FICTIVE, AUJOURDHUI)
    expect(p.texte).toBe(
      '123456782 (SIREN), chez Plateforme fictive Bêta. Reçoit depuis le 01/09/2026. Non vérifiée : simple déclaration.',
    )
    expect(p.etablit).toBe(CE_QUE_ETABLIT.declaration)
  })

  it('une adresse à venir se dit « À venir : à partir du… », et une adresse vérifiée dit sa source et son jour', () => {
    const a = adresseFictive({ prise_effet: '2027-12-01', verification: 'portail_annuaire', verifiee_le: '2027-11-10' })
    const p = phraseDeLAdresse(a, AUJOURDHUI)
    expect(p.texte).toContain('À venir : à partir du 01/12/2027.')
    expect(p.texte).not.toContain('Reçoit depuis')
    expect(p.texte).toContain(`${LIBELLE_VERIFICATION.portail_annuaire} le 10/11/2027.`)
    expect(p.etablit).toBe(CE_QUE_ETABLIT.portail_annuaire)
  })

  it('chaque source de vérification dit ce qu’elle établit (A6-Q4), et une simple déclaration n’établit rien', () => {
    for (const verification of ['portail_annuaire', 'plateforme', 'declaration'] as const) {
      const a = adresseFictive({ verification, verifiee_le: verification === 'declaration' ? null : '2027-11-10' })
      expect(phraseDeLAdresse(a, AUJOURDHUI).etablit).toBe(CE_QUE_ETABLIT[verification])
    }
    expect(CE_QUE_ETABLIT.declaration).toContain('n’établit rien')
  })

  it('sans adresse : une phrase aux mots de chaque espace', () => {
    expect(phraseSansAdresse('client')).toBe('Tu n’as pas encore déclaré d’adresse de réception.')
    expect(phraseSansAdresse('cabinet')).toBe('Aucune adresse de réception déclarée pour le client.')
  })

  it('les plateformes : le nom de celle qui est reliée, Super PDP relié ou non — ni identifiant ni adresse', () => {
    expect(phrasesDesPlateformes(ETAT_FICTIF)).toEqual(['Plateforme agréée : reliée (Plateforme fictive Alpha).', 'Super PDP : non relié.'])
    expect(phrasesDesPlateformes(ETAT_NEUF)).toEqual(['Plateforme agréée : non reliée.', 'Super PDP : non relié.'])
    expect(phrasesDesPlateformes(etatFictif({ superpdp: { relie: true, depuis: '2026-09-05T14:00:00+02:00' } }))[1]).toBe('Super PDP : relié.')
  })
})

// ── 3. Ce qui attend ─────────────────────────────────────────────────────────────────────────────────────────────────
const HOTE = 'flux.plateforme-fictive.fr'
const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }
const facture = (id: string, o: Partial<FactureEmise> = {}): FactureEmise => factureCii([LIGNE], {
  id, numero: `F2027-${id}`, date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})
const transmission = (factureId: string): TransmissionFacture => ({
  id: `t-${factureId}`, dossier_id: 'd1', facture_id: factureId, canal: 'plateforme', hote: HOTE, flux_id: `flux-${factureId}`,
  sha256: 'e'.repeat(64), etat: 'accepte', detail: null, cree_le: '2027-10-02T09:00:00Z', maj_le: '2027-10-02T09:05:00Z',
})
const encaissement = (id: string, factureId: string, montant: number, date: string): EncaissementFacture => ({
  id, dossier_id: 'd1', facture_id: factureId, date_encaissement: date, montant, moyen: 'virement', ligne_bancaire_id: null,
  annule_id: null, motif: null, cree_par: null, cree_le: `${date}T09:00:00Z`, retire_le: null, retire_par: null,
})
const part = (encaissementId: string, montant: number): EncaissementFactureTaux => ({
  encaissement_id: encaissementId, dossier_id: 'd1', taux: 20, montant,
})

// Deux factures encaissées et à déclarer (l'une en retard au 20/11/2027), une refusée, un brouillon, un avoir.
function jeu() {
  const factures = [
    facture('f2'), facture('f3'), facture('f4'),
    facture('b1', { numero: null, statut: 'brouillon', validated_at: null }),
    facture('a1', { type: 'avoir', facture_origine_id: 'f4' }),
  ]
  return listesVides({
    factures,
    lignes: factures.map((f) => ({ ...LIGNE, id: `l-${f.id}`, facture_id: f.id })),
    transmissions: [transmission('f2'), transmission('f3'), transmission('f4')],
    encaissements: [encaissement('e2', 'f2', 1200, '2027-10-05'), encaissement('e3', 'f3', 1200, '2027-11-15')],
    parts: [part('e2', 1200), part('e3', 1200)],
  })
}

describe('les factures refusées ou rejetées sur leur plateforme', () => {
  it('une facture validée dont le dernier mot est 210 ou 213 se compte ; 205 et celle d’une autre facture, non', () => {
    const factures = [facture('f1'), facture('f2'), facture('f3')]
    expect(refuseesSurLeurPlateforme(factures, [])).toBe(0)
    expect(refuseesSurLeurPlateforme(factures, [statutLuFictif({ facture_id: 'f1', code: '210' })])).toBe(1)
    expect(refuseesSurLeurPlateforme(factures, [
      statutLuFictif({ id: 's1', facture_id: 'f1', code: '210' }), statutLuFictif({ id: 's2', facture_id: 'f2', code: '213' }),
      statutLuFictif({ id: 's3', facture_id: 'f3', code: '205' }),
    ])).toBe(2)
    // Deux statuts d'une même facture : une seule facture.
    expect(refuseesSurLeurPlateforme(factures, [
      statutLuFictif({ id: 's1', facture_id: 'f1', code: '210' }), statutLuFictif({ id: 's2', facture_id: 'f1', code: '213' }),
    ])).toBe(1)
  })

  it('ni un brouillon, ni un avoir, ni un statut dont la facture n’est pas au dossier', () => {
    const factures = [
      facture('b1', { statut: 'brouillon' }), facture('a1', { type: 'avoir', facture_origine_id: 'f1' }),
    ]
    const statuts = [
      statutLuFictif({ id: 's1', facture_id: 'b1', code: '210' }), statutLuFictif({ id: 's2', facture_id: 'a1', code: '210' }),
      statutLuFictif({ id: 's3', facture_id: 'ailleurs', code: '210' }),
    ]
    expect(refuseesSurLeurPlateforme(factures, statuts)).toBe(0)
  })
})

describe('ce qui attend vient des listes des pastilles, lues en entier', () => {
  it('les encaissements à déclarer sont ceux de `compterLesPastilles`, les mêmes que les tuiles de l’accueil', () => {
    const listes = jeu()
    const comptes = compterLesPastilles('d1', listes, 'redevable', AUJOURDHUI)
    expect(comptes.etat).toBe('comptees')
    // Le jeu porte de chaque sorte : sans quoi l'égalité pourrait tenir à zéro.
    expect(comptes.etat === 'comptees' && comptes.aDeclarer).toBe(2)
    expect(comptes.etat === 'comptees' && comptes.enRetard).toBe(1)
    const attente = attenteDeLEncart('d1', listes, 'redevable', AUJOURDHUI)
    expect(attente).toEqual({ etat: 'comptee', aDeclarer: 2, enRetard: 1, refusees: 0 })
  })

  it('les factures refusées s’ajoutent, d’après les statuts lus', () => {
    const listes = { ...jeu(), statutsLus: [statutLuFictif({ facture_id: 'f4', code: '213' })] }
    const attente = attenteDeLEncart('d1', listes, 'redevable', AUJOURDHUI)
    expect(attente.etat === 'comptee' && attente.refusees).toBe(1)
  })

  it.each([
    ['les factures', { facturesIncompletes: 'les factures lues en partie' }],
    ['les transmissions', { transmissionsIncompletes: 'les transmissions lues en partie' }],
    ['les encaissements', { encaissementsIncomplets: 'les encaissements lus en partie' }],
    ['les déclarations', { declarationsIncompletes: 'les déclarations lues en partie' }],
    ['les statuts lus', { statutsIncomplets: 'les statuts lus en partie' }],
  ])('%s lus en partie : aucun compte, le motif — ni « 0 » ni refusée', (_nom, partiel) => {
    // Une facture refusée est PRÉSENTE, mais les statuts sont partiels ou non : rien ne se compte.
    const listes = { ...jeu(), statutsLus: [statutLuFictif({ facture_id: 'f4', code: '210' })], ...partiel }
    const attente = attenteDeLEncart('d1', listes, 'redevable', AUJOURDHUI)
    expect(attente).toEqual({ etat: 'muette', motif: Object.values(partiel)[0] })
  })

  it('les phrases : au singulier et au pluriel, en retard, et le zéro ne se dit que d’une liste lue en entier', () => {
    const lue = { etat: 'lue', lu: ETAT_FICTIF } as const
    const comptee = (aDeclarer: number, enRetard: number, refusees: number): AttenteDeLEncart => ({ etat: 'comptee', aDeclarer, enRetard, refusees })
    expect(phrasesDeLAttente(comptee(2, 1, 1), lue)).toEqual([
      '2 factures dont l’encaissement est à déclarer, dont 1 en retard.',
      '1 facture refusée ou rejetée sur ta plateforme.',
    ])
    expect(phrasesDeLAttente(comptee(1, 0, 2), lue)).toEqual([
      '1 facture dont l’encaissement est à déclarer.',
      '2 factures refusées ou rejetées sur ta plateforme.',
    ])
    expect(phrasesDeLAttente(comptee(0, 0, 0), lue)).toEqual([
      'Aucun encaissement à déclarer.',
      'Aucune facture refusée ou rejetée parmi les statuts relevés sur ta plateforme.',
    ])
  })

  it('aucun statut n’a jamais été relevé : l’absence de refus ne se dit pas « aucune »', () => {
    const jamais = { etat: 'lue', lu: etatFictif({ plateforme: { ...ETAT_FICTIF.plateforme, statuts_lus_le: null } }) } as const
    const phrases = phrasesDeLAttente({ etat: 'comptee', aDeclarer: 0, enRetard: 0, refusees: 0 }, jamais)
    expect(phrases[1]).toBe('Les statuts de ta plateforme n’ont pas encore été relevés : un refus de l’acheteur ne se verrait pas ici.')
    expect(phrases.join(' ')).not.toMatch(/Aucune facture refusée/)
    // Un refus lu se dit, relevé ou non : il est dans la liste.
    expect(phrasesDeLAttente({ etat: 'comptee', aDeclarer: 0, enRetard: 0, refusees: 1 }, jamais)[1])
      .toBe('1 facture refusée ou rejetée sur ta plateforme.')
  })

  it('en cours : « Chargement… » ; muette : la phrase qui dit qu’il ne se compte pas, sans le moindre chiffre', () => {
    const lue = { etat: 'lue', lu: ETAT_FICTIF } as const
    expect(phrasesDeLAttente({ etat: 'en_cours' }, lue)).toEqual(['Chargement…'])
    const muette = phrasesDeLAttente({ etat: 'muette', motif: 'les factures lues en partie' }, lue)
    expect(muette).toEqual(['Ce qui t’attend ne se compte pas ici : tes ventes n’ont pas pu être toutes lues.'])
    expect(muette.join(' ')).not.toMatch(/\d|aucun/i)
  })
})

// ── 4. Une lecture ratée ─────────────────────────────────────────────────────────────────────────────────────────────
describe('une lecture qui n’est pas une valeur lue', () => {
  it('illisible : la phrase le dit, et ne dit ni « active » ni « à compléter »', () => {
    for (const espace of ['client', 'cabinet'] as const) {
      const phrase = phraseDeLaLectureRatee(espace, { etat: 'illisible' })
      expect(phrase).toContain('n’a pas pu être lu')
      expect(phrase).toContain('forme que l’écran ne sait pas lire')
      expect(phrase).not.toMatch(/active|à compléter/i)
    }
  })

  it('refusée : le motif, aux mots de chaque espace', () => {
    expect(phraseDeLaLectureRatee('client', { etat: 'refusee', motif: 'permission denied' }))
      .toBe('L’état de ta facture électronique n’a pas pu être lu (permission denied). Recharger la page permet de réessayer.')
    expect(phraseDeLaLectureRatee('cabinet', { etat: 'refusee', motif: 'permission denied' }))
      .toBe('L’état de la facture électronique du client n’a pas pu être lu (permission denied). Recharger la page permet de réessayer.')
  })
})
