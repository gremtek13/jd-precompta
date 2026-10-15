import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ceQueLeChoixDeContactRemplace, choixDeContact, clientEnSaisie, confirmationDuChoixDeContact, contactDeLaProvenance, contactsAChoisir,
  contactsEnCours, detailDUnContact, echeanceARecalculer, infoDesSoinsDansLaFacture, introDuChoixDeClient, ligneDesClientsEcartes,
  mentionsAvecLeClient, peutEnregistrerCommeContact, phraseDeLEcheanceARecalculer, phraseDuFichierVide, refusDesSoinsDuClient,
  saisieDuClient, suiviDeLEcheance, type ClientEnSaisie,
} from './contactsFacture'
import { ARTICLE_DES_SOINS, REFUS_ENREGISTREMENT_CONTACT, refusEnregistrementContact, saisieQuiPart } from './contacts'
import { LIBELLES_TYPE_CONTACT, refusDeLaSaisieContact } from './contactsVue'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import { saisieDesMentions } from './mentionsFacture'
import { contact } from '../test/contacts'

// UN CLIENT DANS LA FACTURE (étape A4b2), côté pur. Ce que ces cas gardent : les contacts du choix (jamais un retiré ni un effacé,
// la recherche commune, ceux que la règle des soins refuse écartés et comptés) ; ce que le choix met dans la facture — le client
// ENTIER, un champ absent VIDÉ, l'échéance du délai au calendrier civil ; ce que le choix remplace, nommé ; l'échéance qui ne se
// recalcule jamais en silence ; la règle des soins, CELLE du module des contacts (aucune règle recopiée : chaque cas la lui
// confronte) ; les mots de chaque espace.

const RETIRE = '2027-10-05T08:00:00Z'
const EFFACE = '2027-10-06T08:00:00Z'
const SOINS = ARTICLE_DES_SOINS

const retire = (o: Parameters<typeof contact>[0] = {}) => contact({ retire_le: RETIRE, retire_par: 'u-x', ...o })
const efface = (o: Parameters<typeof contact>[0] = {}) => contact({
  efface_le: EFFACE, efface_par: 'u-x', nom: 'Contact effacé le 06/10/2027', type_client: null, adresse: null, siren: null, siret: null,
  adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: null, observations: null, ...o,
})
const particulier = (o: Parameters<typeof contact>[0] = {}) => contact({ type_client: 'non_assujetti', siren: null, siret: null, ...o })
const etranger = (o: Parameters<typeof contact>[0] = {}) => contact({ type_client: 'etranger', siren: null, siret: null, ...o })

const VIDE: ClientEnSaisie = { tiersNom: '', tiersAdresse: '', tiersSiret: '', typeClient: '', siren: '', adresseElectronique: '', codeService: '' }
const ENTREPRISE: ClientEnSaisie = {
  tiersNom: 'Société Essai', tiersAdresse: 'Adresse fictive', tiersSiret: '12345678200010', typeClient: 'assujetti', siren: '123456782',
  adresseElectronique: '', codeService: '',
}

describe('contactsAChoisir — les contacts qu’on peut choisir', () => {
  const liste = [
    contact({ id: 'c-b', nom: 'Bernard SARL', siren: '987654324', siret: '98765432400010' }),
    contact({ id: 'c-a', nom: 'Aubert SAS', siren: '123456782', siret: '12345678200010' }),
    retire({ id: 'c-r', nom: 'Ancien retiré' }),
    efface({ id: 'c-e' }),
  ]

  it('jamais un retiré ni un effacé, dans l’ordre de la liste (par nom)', () => {
    expect(contactsAChoisir(liste, null, '').offerts.map((c) => c.id)).toEqual(['c-a', 'c-b'])
  })

  it('la recherche commune lit le nom, le SIREN et le SIRET ; un retiré ne se trouve pas, même par son nom', () => {
    expect(contactsAChoisir(liste, null, 'bern').offerts.map((c) => c.id)).toEqual(['c-b'])
    expect(contactsAChoisir(liste, null, '987654324').offerts.map((c) => c.id)).toEqual(['c-b'])
    expect(contactsAChoisir(liste, null, '12345678200010').offerts.map((c) => c.id)).toEqual(['c-a'])
    expect(contactsAChoisir(liste, null, 'Ancien').offerts).toEqual([])
    expect(contactsAChoisir(liste, null, 'effacé').offerts).toEqual([])
  })

  it('la recherche ignore accents et casse (celle de l’application)', () => {
    expect(contactsAChoisir([contact({ id: 'c1', nom: 'Éts Léger' })], null, 'ETS leger').offerts).toHaveLength(1)
  })

  it('un dossier de soins n’offre pas ceux que la règle refuse (un particulier, un client établi hors de France), et les COMPTE', () => {
    const rangees = [
      contact({ id: 'c-ok', nom: 'Association Essai', type_client: 'non_assujetti' }),
      particulier({ id: 'c-p', nom: 'Particulier' }),
      etranger({ id: 'c-x', nom: 'Étranger' }),
      particulier({ id: 'c-pr', nom: 'Particulier retiré', retire_le: RETIRE }),
    ]
    const r = contactsAChoisir(rangees, SOINS, '')
    expect(r.offerts.map((c) => c.id)).toEqual(['c-ok'])
    // Ceux qu'elle écarte sont les contacts EN COURS que la règle refuse ; un retiré n'est pas un choix de toute façon.
    expect(r.ecartesParLesSoins.map((c) => c.id).sort()).toEqual(['c-p', 'c-x'])
  })

  it('le compte des écartés ne dépend pas de la recherche (la ligne qui le dit ne change pas à chaque lettre)', () => {
    const rangees = [contact({ id: 'c-ok', nom: 'Association' }), particulier({ id: 'c-p', nom: 'Particulier' })]
    expect(contactsAChoisir(rangees, SOINS, 'zzz').ecartesParLesSoins).toHaveLength(1)
    expect(contactsAChoisir(rangees, SOINS, 'zzz').offerts).toEqual([])
  })

  it('hors d’un dossier de soins, un particulier se propose : la règle est celle des soins, pas celle de tous les dossiers', () => {
    const r = contactsAChoisir([particulier({ id: 'c-p' }), etranger({ id: 'c-x' })], null, '')
    expect(r.offerts).toHaveLength(2)
    expect(r.ecartesParLesSoins).toEqual([])
    // Un article d'exonération autre que celui des soins n'écarte rien non plus.
    expect(contactsAChoisir([particulier({ id: 'c-p' })], 'cgi_261_4_4_a', '').offerts).toHaveLength(1)
  })

  it('contactsEnCours : tous les contacts en cours, soins compris — « Choisir un client » ne s’offre que s’il y en a', () => {
    expect(contactsEnCours(liste).map((c) => c.id)).toEqual(['c-a', 'c-b'])
    expect(contactsEnCours([retire(), efface()])).toEqual([])
    expect(contactsEnCours([])).toEqual([])
  })
})

describe('choixDeContact — ce que le choix met dans la facture', () => {
  it('le client ENTIER : nom, adresse, SIRET, type, SIREN, adresse de facturation électronique, code service', () => {
    const c = contact({
      nom: 'Mairie Essai', type_client: 'organisme_public', adresse: '1 place fictive', siren: '123456782', siret: '12345678200010',
      adresse_electronique: '123456782_12345678200010', code_service: 'SERVICE-7', email: 'compta@exemple.fr', delai_paiement_jours: 30,
    })
    expect(choixDeContact(c, '2027-11-01').client).toEqual({
      tiersNom: 'Mairie Essai', tiersAdresse: '1 place fictive', tiersSiret: '12345678200010', typeClient: 'organisme_public',
      siren: '123456782', adresseElectronique: '123456782_12345678200010', codeService: 'SERVICE-7',
    })
  })

  it('un champ que le contact n’a pas est VIDÉ : jamais un reste du client précédent', () => {
    const c = particulier({ nom: 'Particulier', adresse: null, delai_paiement_jours: null })
    expect(choixDeContact(c, '2027-11-01').client).toEqual({
      tiersNom: 'Particulier', tiersAdresse: '', tiersSiret: '', typeClient: 'non_assujetti', siren: '', adresseElectronique: '', codeService: '',
    })
  })

  it('l’e-mail ne se recopie pas : la facture n’a pas de champ pour lui (A4B2-Q1)', () => {
    const choix = choixDeContact(contact({ email: 'compta@exemple.fr' }), '2027-11-01')
    expect(JSON.stringify(choix)).not.toContain('compta@exemple.fr')
  })

  it('l’échéance : la date d’émission plus le délai, au calendrier civil', () => {
    expect(choixDeContact(contact({ delai_paiement_jours: 30 }), '2027-11-01').echeance).toEqual({ delai: 30, date: '2027-12-01' })
    expect(choixDeContact(contact({ delai_paiement_jours: 60 }), '2027-12-15').echeance).toEqual({ delai: 60, date: '2028-02-13' })
    // 2028 est bissextile.
    expect(choixDeContact(contact({ delai_paiement_jours: 30 }), '2028-01-30').echeance).toEqual({ delai: 30, date: '2028-02-29' })
    expect(choixDeContact(contact({ delai_paiement_jours: 1 }), '2027-12-31').echeance).toEqual({ delai: 1, date: '2028-01-01' })
  })

  it('un délai de zéro jour est un délai : l’échéance est le jour de l’émission', () => {
    expect(choixDeContact(contact({ delai_paiement_jours: 0 }), '2027-11-01').echeance).toEqual({ delai: 0, date: '2027-11-01' })
  })

  it('sans délai : aucune échéance proposée, l’échéance saisie reste', () => {
    expect(choixDeContact(contact({ delai_paiement_jours: null }), '2027-11-01').echeance).toBeNull()
  })

  it('une date d’émission qui n’en est pas une (champ vidé) : le délai est dit, la date ne se calcule pas', () => {
    expect(choixDeContact(contact({ delai_paiement_jours: 30 }), '').echeance).toEqual({ delai: 30, date: null })
    expect(choixDeContact(contact({ delai_paiement_jours: 30 }), '01/11/2027').echeance).toEqual({ delai: 30, date: null })
  })

  it('un contact sans type (jamais le cas d’un contact en cours) part « à préciser », sans lever', () => {
    expect(choixDeContact(contact({ type_client: null }), '2027-11-01').client.typeClient).toBe('')
  })
})

describe('ceQueLeChoixDeContactRemplace — ce que le choix remplacerait, nommé', () => {
  const choix = choixDeContact(contact({ delai_paiement_jours: 30 }), '2027-11-01')

  it('un client vide : rien n’est remplacé, le choix remplit directement', () => {
    expect(ceQueLeChoixDeContactRemplace(VIDE, '', choix)).toEqual([])
  })

  it('un client vide mais une échéance saisie, et un contact sans délai : l’échéance reste, rien n’est remplacé', () => {
    const sansDelai = choixDeContact(contact({ delai_paiement_jours: null }), '2027-11-01')
    expect(ceQueLeChoixDeContactRemplace(VIDE, '2027-11-20', sansDelai)).toEqual([])
  })

  it('ce que le contact apporte déjà : rien n’est remplacé (même avec des blancs aux bords et dans les identifiants)', () => {
    const saisi: ClientEnSaisie = { ...ENTREPRISE, tiersNom: '  Société Essai ', tiersSiret: '123 456 782 00010', siren: '123 456 782', tiersAdresse: ' Adresse fictive  ' }
    expect(ceQueLeChoixDeContactRemplace(saisi, '2027-12-01', choix)).toEqual([])
  })

  it('une saisie qui diffère : chaque champ nommé, dans l’ordre du formulaire', () => {
    const saisi: ClientEnSaisie = {
      tiersNom: 'Autre client', tiersAdresse: 'Ailleurs', tiersSiret: '98765432400010', typeClient: 'organisme_public', siren: '987654324',
      adresseElectronique: '987654324', codeService: 'SERVICE-1',
    }
    expect(ceQueLeChoixDeContactRemplace(saisi, '2027-11-20', choix)).toEqual([
      'le nom « Autre client »',
      'le type « un organisme public (Chorus Pro) »',
      'le SIREN 987654324',
      'le SIRET 98765432400010',
      'l’adresse « Ailleurs »',
      'l’adresse de facturation électronique 987654324',
      'le code service « SERVICE-1 »',
      'l’échéance du 20/11/2027',
    ])
  })

  it('un champ saisi que le contact n’a pas est nommé aussi : il serait vidé', () => {
    const sansSiret = choixDeContact(contact({ siret: null }), '2027-11-01')
    expect(ceQueLeChoixDeContactRemplace({ ...VIDE, tiersSiret: '12345678200010' }, '', sansSiret)).toEqual(['le SIRET 12345678200010'])
  })

  it('un champ que le formulaire CACHE ne compte pas : il ne part jamais, et le choix ne demande rien pour lui', () => {
    // Un particulier : ni adresse électronique ni code service ; hors de France : pas de SIREN.
    const cache: ClientEnSaisie = { ...VIDE, typeClient: 'non_assujetti', adresseElectronique: 'x', codeService: 'y' }
    expect(ceQueLeChoixDeContactRemplace(cache, '', choixDeContact(contact({ type_client: 'non_assujetti' }), '2027-11-01')))
      .toEqual([])
    const etranger_: ClientEnSaisie = { ...VIDE, typeClient: 'etranger', siren: '123456782' }
    expect(ceQueLeChoixDeContactRemplace(etranger_, '', choixDeContact(contact({ siren: null, siret: null }), '2027-11-01'))
      .filter((r) => r.startsWith('le SIREN'))).toEqual([])
    // Le même client, type « entreprise » : l'adresse électronique est visible, donc nommée.
    const visible: ClientEnSaisie = { ...VIDE, typeClient: 'assujetti', adresseElectronique: '123456782' }
    expect(ceQueLeChoixDeContactRemplace(visible, '', choixDeContact(contact({ adresse_electronique: null }), '2027-11-01')))
      .toContain('l’adresse de facturation électronique 123456782')
  })

  it('l’échéance : nommée si elle diffère de celle du délai ; muette si elle est déjà celle-là, vide ou si le contact n’en propose pas', () => {
    expect(ceQueLeChoixDeContactRemplace(ENTREPRISE, '2027-12-01', choix)).toEqual([])
    expect(ceQueLeChoixDeContactRemplace(ENTREPRISE, '', choix)).toEqual([])
    expect(ceQueLeChoixDeContactRemplace(ENTREPRISE, '2027-12-15', choix)).toEqual(['l’échéance du 15/12/2027'])
    expect(ceQueLeChoixDeContactRemplace(ENTREPRISE, '2027-12-15', choixDeContact(contact({ delai_paiement_jours: null }), '2027-11-01'))).toEqual([])
    // Une émission illisible : la date n'est pas calculée, donc rien n'est remplacé.
    expect(ceQueLeChoixDeContactRemplace(ENTREPRISE, '2027-12-15', choixDeContact(contact({ delai_paiement_jours: 30 }), ''))).toEqual([])
  })

  it('le nom d’un client trop long se coupe comme partout (« … » au-delà de quatre-vingts caractères)', () => {
    const long = 'A'.repeat(120)
    const [nom] = ceQueLeChoixDeContactRemplace({ ...VIDE, tiersNom: long }, '', choix)
    expect(nom).toBe(`le nom « ${'A'.repeat(79)}… »`)
  })
})

describe('l’échéance ne se recalcule jamais en silence', () => {
  const c = contact({ nom: 'Société Essai', delai_paiement_jours: 30 })
  const suivi = suiviDeLEcheance(c, choixDeContact(c, '2027-11-01'), '2027-11-01')

  it('le choix retient le délai et la date d’émission d’alors ; sans délai, rien à suivre', () => {
    expect(suivi).toEqual({ nom: 'Société Essai', delai: 30, emission: '2027-11-01' })
    const sansDelai = contact({ delai_paiement_jours: null })
    expect(suiviDeLEcheance(sansDelai, choixDeContact(sansDelai, '2027-11-01'), '2027-11-01')).toBeNull()
  })

  it('la date d’émission n’a pas bougé : rien à dire', () => {
    expect(echeanceARecalculer(suivi, '2027-11-01', '2027-12-01')).toBeNull()
    // Même retouchée à la main depuis, l'échéance n'est pas redite tant que l'émission est celle du choix : c'est la saisie de qui rédige.
    expect(echeanceARecalculer(suivi, '2027-11-01', '2027-12-24')).toBeNull()
    expect(echeanceARecalculer(suivi, '2027-11-01', '')).toBeNull()
    expect(echeanceARecalculer(null, '2027-11-10', '2027-12-01')).toBeNull()
  })

  it('la date d’émission a changé : l’échéance que le délai donnerait, proposée — jamais appliquée', () => {
    expect(echeanceARecalculer(suivi, '2027-11-10', '2027-12-01')).toEqual({ nom: 'Société Essai', delai: 30, date: '2027-12-10' })
    // Avec une échéance vide ou retouchée à la main aussi : c'est un clic qui la remplace.
    expect(echeanceARecalculer(suivi, '2027-11-10', '')).toEqual({ nom: 'Société Essai', delai: 30, date: '2027-12-10' })
    expect(echeanceARecalculer(suivi, '2027-11-10', '2027-12-24')?.date).toBe('2027-12-10')
  })

  it('l’échéance du formulaire est déjà celle que le délai donnerait : rien à dire', () => {
    expect(echeanceARecalculer(suivi, '2027-11-10', '2027-12-10')).toBeNull()
  })

  it('une date d’émission qui n’en est pas une (champ vidé) : rien à proposer', () => {
    expect(echeanceARecalculer(suivi, '', '2027-12-01')).toBeNull()
  })

  it('un choix fait sans date d’émission lisible : dès qu’elle se lit, l’échéance se propose', () => {
    const sansDate = suiviDeLEcheance(c, choixDeContact(c, ''), '')
    expect(sansDate).toEqual({ nom: 'Société Essai', delai: 30, emission: '' })
    expect(echeanceARecalculer(sansDate, '2027-11-05', '')?.date).toBe('2027-12-05')
  })

  it('la phrase nomme le client, son délai (« 1 jour », « 0 jour », « 30 jours ») et la date', () => {
    expect(phraseDeLEcheanceARecalculer({ nom: 'Société Essai', delai: 30, date: '2027-12-10' })).toBe(
      'La date d’émission a changé depuis le choix du client « Société Essai » : son délai de paiement (30 jours) donnerait une échéance au 10/12/2027.')
    expect(phraseDeLEcheanceARecalculer({ nom: 'X', delai: 1, date: '2027-12-10' })).toContain('(1 jour)')
    expect(phraseDeLEcheanceARecalculer({ nom: 'X', delai: 0, date: '2027-12-10' })).toContain('(0 jour)')
  })

  it('le calendrier est civil : aucun fuseau ne décale le résultat', () => {
    const avant = process.env.TZ
    try {
      for (const tz of ['Europe/Paris', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
        process.env.TZ = tz
        expect(choixDeContact(contact({ delai_paiement_jours: 30 }), '2027-03-01').echeance?.date).toBe('2027-03-31')
        expect(choixDeContact(contact({ delai_paiement_jours: 30 }), '2027-10-01').echeance?.date).toBe('2027-10-31')
      }
    } finally {
      if (avant === undefined) delete process.env.TZ
      else process.env.TZ = avant
    }
  })
})

describe('contactDeLaProvenance — le contact d’où vient le client, retrouvé dans la liste lue en entier', () => {
  const liste = [contact({ id: 'c1', nom: 'Un' }), retire({ id: 'c2', nom: 'Deux' }), efface({ id: 'c3' })]

  it('un contact de la liste', () => {
    expect(contactDeLaProvenance('c1', liste)?.nom).toBe('Un')
    // Retiré depuis le choix : son nom se dit encore (il existe), mais jamais un effacé.
    expect(contactDeLaProvenance('c2', liste)?.nom).toBe('Deux')
    expect(contactDeLaProvenance('c3', liste)).toBeNull()
  })

  it('aucune provenance, une liste pas lue en entier ou un contact absent : rien', () => {
    expect(contactDeLaProvenance(null, liste)).toBeNull()
    expect(contactDeLaProvenance('c1', null)).toBeNull()
    expect(contactDeLaProvenance('inconnu', liste)).toBeNull()
  })
})

describe('le client du formulaire et ses mentions', () => {
  it('clientEnSaisie lit les trois champs d’en-tête et les quatre mentions du client', () => {
    const mentions = { ...saisieDesMentions(null), typeClient: 'assujetti' as const, siren: '123456782', adresseElectronique: 'AE', codeService: 'CS', numeroEngagement: 'ENG' }
    expect(clientEnSaisie({ tiersNom: 'N', tiersAdresse: 'A', tiersSiret: 'S' }, mentions)).toEqual({
      tiersNom: 'N', tiersAdresse: 'A', tiersSiret: 'S', typeClient: 'assujetti', siren: '123456782', adresseElectronique: 'AE', codeService: 'CS',
    })
  })

  it('mentionsAvecLeClient ne change que le client : la nature, les dates, la livraison et le numéro d’engagement restent', () => {
    const avant = { ...saisieDesMentions(null), nature: 'services' as const, numeroEngagement: 'ENG-1', prestation: 'periode' as const, periodeDebut: '2027-01-01' }
    const apres = mentionsAvecLeClient(avant, { ...ENTREPRISE, adresseElectronique: '123456782', codeService: '' })
    expect(apres).toEqual({ ...avant, typeClient: 'assujetti', siren: '123456782', adresseElectronique: '123456782', codeService: '' })
    expect(apres.nature).toBe('services')
    expect(apres.numeroEngagement).toBe('ENG-1')
  })
})

describe('« Enregistrer ce client » — la saisie qui part de la facture', () => {
  it('offert pour un client qui porte un nom (les blancs ne comptent pas)', () => {
    expect(peutEnregistrerCommeContact(VIDE)).toBe(false)
    expect(peutEnregistrerCommeContact({ ...VIDE, tiersNom: '   ' })).toBe(false)
    expect(peutEnregistrerCommeContact({ ...VIDE, tiersNom: 'Client' })).toBe(true)
  })

  it('la saisie de départ : les sept champs de la facture ; l’e-mail, le délai et les observations vides', () => {
    expect(saisieDuClient(ENTREPRISE)).toEqual({
      nom: 'Société Essai', typeClient: 'assujetti', adresse: 'Adresse fictive', siren: '123456782', siret: '12345678200010',
      adresseElectronique: '', codeService: '', email: '', delai: '', observations: '',
    })
  })

  it('une facture à la main, adresse laissée facultative : la saisie part, et le module dit « l’adresse est à renseigner » — jamais recopié', () => {
    const saisie = saisieDuClient({ ...ENTREPRISE, tiersAdresse: '' })
    expect(refusDeLaSaisieContact('d1', null, { nouveau: true }, saisie, [])?.cle).toBe('adresse_absente')
  })

  it('un SIRET déjà pris nomme le contact qui le porte, avant le clic', () => {
    const refus = refusDeLaSaisieContact('d1', null, { nouveau: true }, saisieDuClient(ENTREPRISE), [contact({ id: 'c9', nom: 'Déjà rangé' })])
    expect(refus?.cle).toBe('siret_pris')
    expect(refus?.message).toContain('« Déjà rangé »')
  })
})

describe('la règle des soins — celle du module des contacts, jamais recopiée', () => {
  const particulierSaisi: ClientEnSaisie = { ...VIDE, tiersNom: 'Patient', typeClient: 'non_assujetti' }
  const etrangerSaisi: ClientEnSaisie = { ...VIDE, tiersNom: 'Abroad', typeClient: 'etranger' }

  it('un particulier d’un dossier de soins : le refus de la base, sous ses mots, par sa clé', () => {
    const refus = refusDesSoinsDuClient(SOINS, particulierSaisi)
    expect(refus?.cle).toBe('soins_particulier')
    expect(refus?.message).toBe(REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === 'soins_particulier')?.modele)
  })

  it('un client établi hors de France : le second refus', () => {
    expect(refusDesSoinsDuClient(SOINS, etrangerSaisi)?.cle).toBe('soins_etranger')
    expect(refusDesSoinsDuClient(SOINS, etrangerSaisi)?.message).toBe(REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === 'soins_etranger')?.modele)
  })

  it('un autre non-assujetti qui a son SIREN (une association) n’est pas un particulier (A4-Q2) ; ses espaces ne comptent pas', () => {
    expect(refusDesSoinsDuClient(SOINS, { ...particulierSaisi, siren: '123456782' })).toBeNull()
    expect(refusDesSoinsDuClient(SOINS, { ...particulierSaisi, siren: '123 456 782' })).toBeNull()
    // Un SIREN fait de blancs n'en est pas un.
    expect(refusDesSoinsDuClient(SOINS, { ...particulierSaisi, siren: '   ' })?.cle).toBe('soins_particulier')
  })

  it('un type pas encore choisi, une entreprise, un organisme public : aucun refus', () => {
    expect(refusDesSoinsDuClient(SOINS, VIDE)).toBeNull()
    expect(refusDesSoinsDuClient(SOINS, ENTREPRISE)).toBeNull()
    expect(refusDesSoinsDuClient(SOINS, { ...ENTREPRISE, typeClient: 'organisme_public' })).toBeNull()
  })

  it('hors d’un dossier de soins : aucun refus, quel que soit le client', () => {
    expect(refusDesSoinsDuClient(null, particulierSaisi)).toBeNull()
    expect(refusDesSoinsDuClient('cgi_261_4_4_a', etrangerSaisi)).toBeNull()
  })

  it('le client de la facture est jugé comme le contact qu’il deviendrait : le refus des soins est le DERNIER refus du module (rang 12)', () => {
    // Une saisie qui passe tous les autres rangs : seul le refus des soins reste, et c'est le même que celui de la facture.
    for (const client of [particulierSaisi, etrangerSaisi]) {
      const complet = { ...client, tiersAdresse: 'Adresse fictive' }
      const dumodule = refusDeLaSaisieContact('d1', SOINS, { nouveau: true }, saisieDuClient(complet), [])
      expect(dumodule).toEqual(refusDesSoinsDuClient(SOINS, complet))
      expect(refusEnregistrementContact('d1', SOINS, { nouveau: true }, saisieQuiPart(saisieDuClient(complet)), [])).toEqual(dumodule)
    }
  })

  it('l’information : la facture reste possible, sans redire le refus dit sous le bouton', () => {
    for (const espace of ['cabinet', 'client'] as const) {
      for (const cle of ['soins_particulier', 'soins_etranger'] as const) {
        const phrase = infoDesSoinsDansLaFacture(espace, cle)
        expect(phrase).toContain('soins exonérés (art. 261, 4, 1° du CGI)')
        expect(phrase).toContain('La facture reste possible — elle s’enregistre et se valide —')
        expect(phrase).toMatch(espace === 'client'
          ? /mais ce client ne se range pas dans ton fichier de clients\.$/
          : /mais ce client ne se range pas dans le fichier des clients du dossier\.$/)
        // Le refus d'« Enregistrer ce client » se lit sous le bouton, aux mots de la base : l'information ne le redit ni ne le
        // contredit.
        expect(phrase).not.toMatch(/refus/)
      }
    }
    expect(infoDesSoinsDansLaFacture('cabinet', 'soins_particulier')).toContain('une facture à un particulier y nomme un patient')
    expect(infoDesSoinsDansLaFacture('cabinet', 'soins_etranger')).toContain('peut nommer un particulier, donc un patient')
  })
})

describe('les mots de chaque espace', () => {
  const c = contact({ nom: 'Société Essai' })
  const textes = (espace: 'cabinet' | 'client') => [
    introDuChoixDeClient(espace),
    phraseDuFichierVide(espace),
    ligneDesClientsEcartes(espace, 1),
    ligneDesClientsEcartes(espace, 3),
    infoDesSoinsDansLaFacture(espace, 'soins_particulier'),
    infoDesSoinsDansLaFacture(espace, 'soins_etranger'),
    ...Object.values(confirmationDuChoixDeContact(espace, c, ['le nom « X »', 'le SIRET 12345678200010'])),
  ]

  it('chez le client : ni onglet, ni « le client qui porte », ni vouvoiement, ni renvoi au cabinet', () => {
    for (const t of textes('client')) expect(motsDuCabinet(t), t).toEqual([])
  })

  it('le garde n’est pas aveugle : la phrase du cabinet sur les clients écartés parle d’un onglet', () => {
    expect(motsDuCabinet(ligneDesClientsEcartes('cabinet', 2)).length).toBeGreaterThan(0)
  })

  it('les refus du module que ces phrases citent se réécrivent pour le client (la règle des soins parle d’un « dossier »)', () => {
    const refus = refusDesSoinsDuClient(SOINS, { ...VIDE, tiersNom: 'P', typeClient: 'non_assujetti' })?.message ?? ''
    expect(refus).toContain('Un dossier')
    const reecrit = pourLEspace('client', refus)
    expect(reecrit).toContain('Ta société')
    expect(motsDuCabinet(reecrit)).toEqual([])
  })

  it('les écartés : le singulier et le pluriel, et où ils s’effacent', () => {
    expect(ligneDesClientsEcartes('cabinet', 1)).toBe(
      'Un client rangé avant que le dossier passe aux soins exonérés n’est pas proposé : la règle des soins le refuse. '
      + 'Il s’efface dans la vue « Clients » de l’onglet Factures.')
    expect(ligneDesClientsEcartes('cabinet', 2)).toBe(
      '2 clients rangés avant que le dossier passe aux soins exonérés ne sont pas proposés : la règle des soins les refuse. '
      + 'Ils s’effacent dans la vue « Clients » de l’onglet Factures.')
    expect(ligneDesClientsEcartes('client', 1)).toBe(
      'Un client rangé avant que ta société passe aux soins exonérés n’est pas proposé : la règle des soins le refuse. '
      + 'Tu peux l’effacer dans « Mes ventes › Clients ».')
    expect(ligneDesClientsEcartes('client', 4)).toBe(
      '4 clients rangés avant que ta société passe aux soins exonérés ne sont pas proposés : la règle des soins les refuse. '
      + 'Tu peux les effacer dans « Mes ventes › Clients ».')
  })

  it('la confirmation NOMME le contact choisi et ce qui part, et dit que la facture garde sa copie', () => {
    const conf = confirmationDuChoixDeContact('cabinet', c, ['le nom « Autre »', 'le SIRET 98765432400010', 'l’échéance du 15/12/2027'])
    expect(conf.titre).toBe('Remplacer le client de la facture ?')
    expect(conf.phrase).toBe('Choisir le client « Société Essai » remplace le nom « Autre », le SIRET 98765432400010 et l’échéance du 15/12/2027 de cette facture.')
    expect(conf.reste).toBe('La facture garde sa copie du client : la modifier ensuite ne change pas le fichier des clients du dossier.')
    expect(confirmationDuChoixDeContact('client', c, ['le nom « Autre »']).reste).toContain('ne change pas ton fichier de clients')
  })

  it('l’introduction du choix dit ce que le client choisi remplit, et que la facture en garde une copie', () => {
    for (const espace of ['cabinet', 'client'] as const) {
      expect(introDuChoixDeClient(espace)).toContain('Le client choisi remplit la facture : son nom, son type, ses identifiants, son adresse')
      expect(introDuChoixDeClient(espace)).toContain('La facture en garde une copie : la changer ensuite ne change pas')
    }
    expect(introDuChoixDeClient('cabinet')).toContain('le fichier des clients du dossier')
    expect(introDuChoixDeClient('client')).toContain('ton fichier de clients')
  })

  it('le fichier vide dit « Enregistrer ce client »', () => {
    expect(phraseDuFichierVide('cabinet')).toContain('Le fichier des clients du dossier n’a encore aucun client en cours')
    expect(phraseDuFichierVide('client')).toBe('Tu n’as encore aucun client en cours : « Enregistrer ce client », sous un client saisi, en crée un.')
  })
})

describe('detailDUnContact — la ligne d’un contact dans le choix', () => {
  it('l’identifiant (le SIRET d’abord), le type aux mots du formulaire, le délai et l’échéance qu’il donnerait', () => {
    expect(detailDUnContact(contact({ delai_paiement_jours: 30 }), '2027-11-01')).toBe(
      `SIRET 12345678200010 · ${LIBELLES_TYPE_CONTACT.assujetti} · délai 30 jours (échéance le 01/12/2027)`)
  })

  it('sans SIRET, le SIREN ; sans identifiant ni délai, le type seul ; sans date d’émission, le délai sans échéance', () => {
    expect(detailDUnContact(contact({ siret: null, delai_paiement_jours: 1 }), '')).toBe(`SIREN 123456782 · ${LIBELLES_TYPE_CONTACT.assujetti} · délai 1 jour`)
    expect(detailDUnContact(particulier({ delai_paiement_jours: null }), '2027-11-01')).toBe(LIBELLES_TYPE_CONTACT.non_assujetti)
    expect(detailDUnContact(contact({ type_client: null, siren: null, siret: null, delai_paiement_jours: null }), '2027-11-01')).toBe('')
  })
})

describe('le module est pur', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/contactsFacture.ts'), 'utf8')

  it('il n’importe ni le client Supabase ni React, et ne lit pas l’horloge', () => {
    expect(source).not.toMatch(/from '\.\/supabase'|from 'react'/)
    expect(source).not.toMatch(/new Date\(\)|Date\.now\(|aujourdHuiSql/)
  })

  it('il ne recopie aucune règle des contacts : aucun message de refus, aucune borne, aucun article d’exonération en toutes lettres', () => {
    for (const r of REFUS_ENREGISTREMENT_CONTACT) {
      // Les modèles à trous (« % ») ne se recopient pas non plus ; on cherche le début de chaque message.
      expect(source, r.cle).not.toContain(r.modele.split('%')[0])
    }
    expect(source).not.toContain('cgi_261_4_1')
    expect(source).not.toMatch(/\b60\b|\b254\b|\b200\b/)
  })
})
