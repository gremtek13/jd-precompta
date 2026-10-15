import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LIBELLES_TYPE_CONTACT, TITRES_CONTACT_PAR_LE_CLIENT, cePartAvecLEffacement, champsDeRechercheContact, confirmationDeLEffacement,
  contactsAffichables, contactsAffiches, delaiAffiche, gestesDuContact, identifiantAffiche, infoDesSoins, mentionContactParLeClient,
  refusDeLaSaisieContact, saisieContactTouchee, saisieInitialeContact, signalementDesSoins, soinsDuContact,
} from './contactsVue'
import {
  ARTICLE_DES_SOINS, TYPES_CLIENT_CONTACT, refusEffacementContact, refusEnregistrementContact, refusRepriseContact, refusRetraitContact,
  saisieQuiPart, type SaisieContact,
} from './contacts'
import type { AccesDuDossier } from './auteursVentes'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import { contact } from '../test/contacts'

// LA LISTE DES CONTACTS, SA SAISIE ET SES GESTES (étape A4b1), côté pur. Ce que ces cas gardent : la saisie part du contact LU et
// repart telle qu'il est ; les refus sont CEUX du module (aucune règle recopiée : chaque cas les confronte à lui) ; la liste ne
// montre JAMAIS un effacé, ne montre les retirés que derrière leur filtre, et garde un ordre total ; « par le client » ne se dit
// que du dernier geste, sur des accès lus en entier ; la règle des soins se dit de chaque contact qu'elle refuse (A4-Q4), sans
// griser « Modifier » — elle refuse la saisie TELLE QUELLE ; les quatre types ont les mots du formulaire de la facture.

const RETIRE = '2027-10-05T08:00:00Z'
const EFFACE = '2027-10-06T08:00:00Z'
const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
const SOINS = ARTICLE_DES_SOINS

const retire = (o: Parameters<typeof contact>[0] = {}) => contact({ retire_le: RETIRE, retire_par: 'u-x', ...o })
const efface = (o: Parameters<typeof contact>[0] = {}) => contact({
  efface_le: EFFACE, efface_par: 'u-x', nom: 'Contact effacé le 06/10/2027', type_client: null, adresse: null, siren: null, siret: null,
  adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: null, observations: null, ...o,
})
// Un « particulier » : un non-assujetti SANS SIREN (A4-Q2), et un client établi hors de France (A4-Q3).
const particulier = (o: Parameters<typeof contact>[0] = {}) => contact({ type_client: 'non_assujetti', siren: null, siret: null, ...o })
const etranger = (o: Parameters<typeof contact>[0] = {}) => contact({ type_client: 'etranger', siren: null, siret: null, ...o })

const SAISIE_VALIDE: SaisieContact = {
  nom: 'Société Essai', typeClient: 'assujetti', adresse: 'Adresse fictive', siren: '123456782', siret: '', adresseElectronique: '',
  codeService: '', email: '', delai: '30', observations: '',
}

describe('les libellés des quatre types sont ceux du formulaire de la facture', () => {
  it('chacun des quatre types du module a son libellé, dans l’ordre du formulaire', () => {
    expect(Object.keys(LIBELLES_TYPE_CONTACT)).toEqual([...TYPES_CLIENT_CONTACT])
  })

  it('chaque libellé est, au mot près, celui de l’option du même type dans FactureFormModal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/dossier/FactureFormModal.tsx'), 'utf8')
    for (const type of TYPES_CLIENT_CONTACT) {
      const option = new RegExp(`<option value="${type}">([^<]*)</option>`).exec(source)
      expect(option, `l’option « ${type} » du formulaire de la facture`).not.toBeNull()
      expect(LIBELLES_TYPE_CONTACT[type]).toBe(option?.[1])
    }
  })
})

describe('saisieInitialeContact — la saisie part du contact LU', () => {
  it('un contact neuf : tout vide, aucun type choisi (« à préciser »)', () => {
    expect(saisieInitialeContact(null)).toEqual({
      nom: '', typeClient: '', adresse: '', siren: '', siret: '', adresseElectronique: '', codeService: '', email: '', delai: '', observations: '',
    })
  })

  it('un contact lu : chaque champ, le délai en chiffres', () => {
    const lu = contact({
      type_client: 'organisme_public', adresse: 'Place de la Mairie', adresse_electronique: '100000207', code_service: 'SERVICE-ACHATS',
      email: 'achats@exemple.fr', delai_paiement_jours: 0, observations: 'Texte',
    })
    expect(saisieInitialeContact(lu)).toEqual({
      nom: 'Société Essai', typeClient: 'organisme_public', adresse: 'Place de la Mairie', siren: '123456782', siret: '12345678200010',
      adresseElectronique: '100000207', codeService: 'SERVICE-ACHATS', email: 'achats@exemple.fr', delai: '0', observations: 'Texte',
    })
  })

  it('les champs absents se montrent vides', () => {
    const s = saisieInitialeContact(contact({ siren: null, siret: null, delai_paiement_jours: null, observations: null }))
    expect([s.siren, s.siret, s.delai, s.observations, s.email, s.codeService, s.adresseElectronique]).toEqual(['', '', '', '', '', '', ''])
  })

  it('le contact lu, ressaisi tel quel, repart comme il est : aucun champ ne bouge', () => {
    const lu = contact({ email: 'a@exemple.fr', delai_paiement_jours: 45, observations: 'Obs' })
    expect(saisieQuiPart(saisieInitialeContact(lu))).toEqual({
      nom: lu.nom, type_client: lu.type_client, adresse: lu.adresse, siren: lu.siren, siret: lu.siret, adresse_electronique: null,
      code_service: null, email: 'a@exemple.fr', delai_paiement_jours: 45, observations: 'Obs',
    })
  })

  it('saisieContactTouchee : un champ changé, et lui seul', () => {
    const depart = saisieInitialeContact(null)
    expect(saisieContactTouchee(depart, { ...depart })).toBe(false)
    expect(saisieContactTouchee(depart, { ...depart, nom: 'x' })).toBe(true)
    expect(saisieContactTouchee(depart, { ...depart, delai: '30' })).toBe(true)
    expect(saisieContactTouchee(depart, { ...depart, typeClient: 'etranger' })).toBe(true)
  })
})

describe('refusDeLaSaisieContact — les refus sont ceux du module, sur la saisie telle qu’elle part', () => {
  const nouveau = { nouveau: true } as const
  const autres = [contact({ id: 'x1', siret: '98765432400019', siren: '987654324', nom: 'Celui qui le porte' })]

  it('une saisie complète n’a aucun refus', () => {
    expect(refusDeLaSaisieContact('d1', null, nouveau, SAISIE_VALIDE, autres)).toBeNull()
  })

  it('c’est le module qui juge, sur `saisieQuiPart` : même refus, même message, mot pour mot', () => {
    const saisies: SaisieContact[] = [
      { ...SAISIE_VALIDE, nom: '  ' }, { ...SAISIE_VALIDE, typeClient: '' }, { ...SAISIE_VALIDE, siren: '123456783' },
      { ...SAISIE_VALIDE, siren: '987654324', siret: '98765432400019' }, { ...SAISIE_VALIDE, delai: 'abc' }, { ...SAISIE_VALIDE, delai: '61' },
      { ...SAISIE_VALIDE, email: 'pas une adresse' }, { ...SAISIE_VALIDE, typeClient: 'etranger', siren: '123456782' },
    ]
    for (const s of saisies) {
      expect(refusDeLaSaisieContact('d1', null, nouveau, s, autres)).toEqual(refusEnregistrementContact('d1', null, nouveau, saisieQuiPart(s), autres))
    }
  })

  it('la saisie vide : le premier refus du module, le nom', () => {
    expect(refusDeLaSaisieContact('d1', null, nouveau, saisieInitialeContact(null), [])?.cle).toBe('nom_absent')
  })

  it('un délai qui n’est pas un nombre de jours est refusé sous les mots de la base', () => {
    expect(refusDeLaSaisieContact('d1', null, nouveau, { ...SAISIE_VALIDE, delai: 'abc' }, [])?.message)
      .toBe('Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.')
    expect(refusDeLaSaisieContact('d1', null, nouveau, { ...SAISIE_VALIDE, delai: '  45  ' }, [])).toBeNull()
  })

  it('un identifiant se tape avec ses espaces : ils partent, la saisie n’est pas refusée pour cela', () => {
    expect(refusDeLaSaisieContact('d1', null, nouveau, { ...SAISIE_VALIDE, siren: '123 456 782', siret: '123 456 782 00010' }, [])).toBeNull()
  })

  it('le SIRET pris nomme le contact qui le porte, retiré ou non ; modifier le sien n’est pas « pris »', () => {
    const pris = { ...SAISIE_VALIDE, siren: '987654324', siret: '98765432400019' }
    expect(refusDeLaSaisieContact('d1', null, nouveau, pris, autres)?.message).toBe(
      "Le SIRET « 98765432400019 » est déjà celui du contact « Celui qui le porte » : un établissement ne se range qu'une fois par dossier.")
    expect(refusDeLaSaisieContact('d1', null, nouveau, pris, [{ ...autres[0], retire_le: RETIRE }])?.message).toContain('(retiré)')
    expect(refusDeLaSaisieContact('d1', null, { nouveau: false, contact: autres[0] }, pris, autres)).toBeNull()
  })

  it('un champ que le type ne lui ouvre pas ne se juge pas : hors de France, un SIREN resté dans la saisie part à nul', () => {
    expect(refusDeLaSaisieContact('d1', null, nouveau, { ...SAISIE_VALIDE, typeClient: 'etranger', siren: '123456782' }, [])).toBeNull()
    expect(refusDeLaSaisieContact('d1', null, nouveau, { ...SAISIE_VALIDE, typeClient: 'assujetti', codeService: 'SERVICE' }, [])).toBeNull()
  })

  it('la règle des soins : un particulier et un client établi hors de France sont refusés, une association avec son SIREN ne l’est pas', () => {
    const part = { ...SAISIE_VALIDE, typeClient: 'non_assujetti' as const, siren: '' }
    expect(refusDeLaSaisieContact('d1', SOINS, nouveau, part, [])?.cle).toBe('soins_particulier')
    expect(refusDeLaSaisieContact('d1', SOINS, nouveau, { ...SAISIE_VALIDE, typeClient: 'etranger' }, [])?.cle).toBe('soins_etranger')
    expect(refusDeLaSaisieContact('d1', SOINS, nouveau, { ...part, siren: '123456782' }, [])).toBeNull()
    // Hors des soins, le même particulier s'enregistre.
    expect(refusDeLaSaisieContact('d1', null, nouveau, part, [])).toBeNull()
    expect(refusDeLaSaisieContact('d1', 'cgi_261_4_4_a', nouveau, part, [])).toBeNull()
  })
})

describe('champsDeRechercheContact — le nom, le SIREN et le SIRET, rien d’autre', () => {
  it('rien de l’e-mail, de l’adresse ni des observations', () => {
    expect(champsDeRechercheContact(contact({ email: 'a@exemple.fr', adresse: 'Rue cachée', observations: 'Texte caché' })))
      .toEqual(['Société Essai', '123456782', '12345678200010'])
  })
})

describe('contactsAffiches — jamais un effacé, les retirés derrière leur filtre, un ordre total', () => {
  const liste = [
    contact({ id: 'b', nom: 'Beta' }),
    retire({ id: 'r', nom: 'Alpha retiré' }),
    contact({ id: 'a', nom: 'alpha' }),
    efface({ id: 'e' }),
    contact({ id: 'el', nom: 'Élan' }),
    contact({ id: 'n10', nom: 'Client 10' }),
    contact({ id: 'n2', nom: 'Client 2' }),
    retire({ id: 'rb', nom: 'Aaa retiré' }),
  ]

  it('sans le filtre, les retirés ne se montrent pas ; avec lui, ils suivent les autres ; un effacé, jamais', () => {
    expect(contactsAffiches(liste, false).map((c) => c.id)).toEqual(['a', 'b', 'n2', 'n10', 'el'])
    expect(contactsAffiches(liste, true).map((c) => c.id)).toEqual(['a', 'b', 'n2', 'n10', 'el', 'rb', 'r'])
    expect(contactsAffiches(liste, true).some((c) => c.efface_le != null)).toBe(false)
  })

  it('un effacé retiré avant son effacement n’est pas plus montré : il n’a plus de retrait, et reste effacé', () => {
    expect(contactsAffiches([efface({ id: 'e1', retire_le: RETIRE })], true)).toEqual([])
  })

  it('un nom identique se départage par l’identifiant — un ordre total', () => {
    const memes = [contact({ id: 'b', nom: 'Même' }), contact({ id: 'a', nom: 'Même' }), contact({ id: 'c', nom: 'même' })]
    expect(contactsAffiches(memes, false).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('la liste lue n’est pas réordonnée sur place', () => {
    const avant = liste.map((c) => c.id)
    contactsAffiches(liste, true)
    expect(liste.map((c) => c.id)).toEqual(avant)
  })

  it('contactsAffichables : tout sauf les effacés, retirés compris', () => {
    expect(contactsAffichables(liste).map((c) => c.id)).toEqual(['b', 'r', 'a', 'el', 'n10', 'n2', 'rb'])
    expect(contactsAffichables([efface()])).toEqual([])
  })
})

describe('l’identifiant et le délai tels que la liste les dit', () => {
  it('le SIRET (il commence par le SIREN), sinon le SIREN, sinon rien', () => {
    expect(identifiantAffiche({ siren: '123456782', siret: '12345678200010' })).toEqual({ nom: 'SIRET', valeur: '12345678200010' })
    expect(identifiantAffiche({ siren: '123456782', siret: null })).toEqual({ nom: 'SIREN', valeur: '123456782' })
    expect(identifiantAffiche({ siren: null, siret: null })).toBeNull()
  })

  it.each([[30, '30 jours'], [2, '2 jours'], [1, '1 jour'], [0, '0 jour'], [60, '60 jours']])('%i → « %s »', (n, texte) => {
    expect(delaiAffiche({ delai_paiement_jours: n })).toBe(texte)
  })

  it('un délai absent ne dit rien', () => {
    expect(delaiAffiche({ delai_paiement_jours: null })).toBeNull()
  })
})

describe('mentionContactParLeClient — le dernier geste, d’un accès client lu en entier', () => {
  const vide = { cree_par: null, cree_le: '2027-10-01T09:00:00Z', modifie_par: null, modifie_le: null, retire_par: null, retire_le: null }

  it('créé par le client, jamais modifié', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client' })).toEqual({ libelle: 'par le client', titre: TITRES_CONTACT_PAR_LE_CLIENT.cree })
    expect(TITRES_CONTACT_PAR_LE_CLIENT.cree).toBe('Contact créé par le client')
  })

  it('créé par le client puis modifié par le cabinet : le dernier geste est celui du cabinet — rien', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T09:00:00Z' })).toBeNull()
  })

  it('créé par le cabinet puis modifié par le client', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-cabinet', modifie_par: 'u-client', modifie_le: '2027-10-02T09:00:00Z' })?.titre)
      .toBe('Contact modifié par le client')
  })

  it('retiré par le client après sa dernière modification', () => {
    expect(mentionContactParLeClient(ACCES_LUS, {
      ...vide, cree_par: 'u-cabinet', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T09:00:00Z', retire_par: 'u-client', retire_le: '2027-10-03T09:00:00Z',
    })?.titre).toBe('Contact retiré par le client')
  })

  it('retiré par le cabinet : le client l’avait créé, il n’est plus le dernier', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', retire_par: 'u-cabinet', retire_le: '2027-10-03T09:00:00Z' })).toBeNull()
  })

  it('repris par le client (une modification) après un retrait du cabinet', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-cabinet', modifie_par: 'u-client', modifie_le: '2027-10-04T09:00:00Z' })?.titre)
      .toBe('Contact modifié par le client')
  })

  it('les instants se comparent comme des instants, pas comme des textes (un fuseau explicite)', () => {
    expect(mentionContactParLeClient(ACCES_LUS, {
      ...vide, cree_par: 'u-client', cree_le: '2027-10-02T09:00:00Z', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T10:30:00+02:00',
    })?.titre).toBe('Contact créé par le client')
  })

  it('à égalité d’instant, le geste qui vient plus loin dans la vie du contact l’emporte', () => {
    const t = '2027-10-02T09:00:00Z'
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', cree_le: t, modifie_par: 'u-cabinet', modifie_le: t })).toBeNull()
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-cabinet', cree_le: t, modifie_par: 'u-client', modifie_le: t })?.titre)
      .toBe('Contact modifié par le client')
  })

  it('jamais deviné : un auteur nul, un accès retiré, des accès pas lus en entier ou sans objet', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: null })).toBeNull()
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-ancien' })).toBeNull()
    for (const acces of [{ etat: 'en_cours' }, { etat: 'incomplets', motif: 'lecture interrompue' }, { etat: 'sans_objet' }] as const) {
      expect(mentionContactParLeClient(acces, { ...vide, cree_par: 'u-client' }), acces.etat).toBeNull()
    }
  })

  it('un instant illisible ne dit rien du geste, et ni « le cabinet » ni l’effacement ne se disent', () => {
    expect(mentionContactParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', cree_le: 'pas une date' })).toBeNull()
    for (const titre of Object.values(TITRES_CONTACT_PAR_LE_CLIENT)) expect(titre).not.toMatch(/cabinet|effac/i)
  })
})

describe('gestesDuContact — ce que chaque geste refuserait, du module', () => {
  it('un contact en cours : « Modifier » libre, « Retirer » offert et libre, « Effacer » libre', () => {
    const gestes = gestesDuContact('d1', null, contact(), [])
    expect(gestes).toEqual({ modifier: null, basculer: { geste: 'retirer', refus: null }, effacer: null, soins: null })
  })

  it('un contact retiré : « Modifier » refusé sous les mots du module, « Reprendre » libre, « Effacer » libre aussi', () => {
    const gestes = gestesDuContact('d1', null, retire(), [])
    expect(gestes.modifier?.message).toBe('Ce contact est retiré : le reprendre avant de le modifier.')
    expect(gestes.basculer).toEqual({ geste: 'reprendre', refus: null })
    expect(gestes.effacer).toBeNull()
  })

  it('un contact d’un autre dossier : introuvable pour les quatre, sous les mots du module', () => {
    const autre = contact({ dossier_id: 'd2' })
    const gestes = gestesDuContact('d1', null, autre, [])
    expect(gestes.modifier).toEqual(refusEnregistrementContact('d1', null, { nouveau: false, contact: autre }, saisieQuiPart(saisieInitialeContact(autre)), []))
    expect(gestes.basculer.refus).toEqual(refusRetraitContact('d1', autre))
    expect(gestes.effacer).toEqual(refusEffacementContact('d1', autre))
    expect(gestes.effacer?.message).toBe('Contact introuvable dans ce dossier.')
    const retiree = { ...autre, retire_le: RETIRE }
    expect(gestesDuContact('d1', null, retiree, []).basculer.refus).toEqual(refusRepriseContact('d1', null, retiree))
  })

  it('un contact effacé (il ne se montre jamais, mais le module le juge) : rien ne se refait, et rien ne se dit des soins', () => {
    const gestes = gestesDuContact('d1', SOINS, efface(), [])
    expect(gestes.modifier?.message).toBe('Ce contact est effacé : il ne se modifie plus.')
    expect(gestes.basculer.refus?.message).toBe('Ce contact est effacé : il ne se retire plus.')
    expect(gestes.effacer?.message).toBe('Ce contact est déjà effacé.')
    expect(gestes.soins).toBeNull()
  })
})

describe('la règle des soins (A4-Q4) — un contact rangé avant le passage aux soins se dit tel', () => {
  it('un particulier d’un dossier de soins : signalé, « Modifier » reste offert (la saisie telle quelle est refusée, pas la modification)', () => {
    const lu = particulier()
    const gestes = gestesDuContact('d1', SOINS, lu, [])
    expect(gestes.soins).toBe('soins_particulier')
    expect(gestes.modifier).toBeNull()
    expect(gestes.basculer).toEqual({ geste: 'retirer', refus: null })
    expect(gestes.effacer).toBeNull()
    // Et la saisie telle quelle est bien refusée : c'est la fenêtre qui le dit avant le clic, bouton grisé.
    expect(refusDeLaSaisieContact('d1', SOINS, { nouveau: false, contact: lu }, saisieInitialeContact(lu), [])?.cle).toBe('soins_particulier')
    // Un SIREN donné le rend admissible : la même fenêtre, une saisie changée, plus aucun refus.
    expect(refusDeLaSaisieContact('d1', SOINS, { nouveau: false, contact: lu }, { ...saisieInitialeContact(lu), siren: '123456782' }, [])).toBeNull()
  })

  it('un client établi hors de France : signalé', () => {
    expect(gestesDuContact('d1', SOINS, etranger(), []).soins).toBe('soins_etranger')
  })

  it('un retiré de ce genre : « Reprendre » refusé sous les mots du module, « Modifier » refusé comme tout retiré, « Effacer » libre', () => {
    const gestes = gestesDuContact('d1', SOINS, particulier({ retire_le: RETIRE, retire_par: 'u-x' }), [])
    expect(gestes.soins).toBe('soins_particulier')
    expect(gestes.basculer.geste).toBe('reprendre')
    expect(gestes.basculer.refus?.cle).toBe('soins_particulier')
    expect(gestes.basculer.refus?.message).toBe(refusRepriseContact('d1', SOINS, particulier({ retire_le: RETIRE }))?.message)
    expect(gestes.modifier?.cle).toBe('retire')
    expect(gestes.effacer).toBeNull()
  })

  it('une association (non-assujetti AVEC son SIREN), une entreprise, un organisme public : jamais signalés (A4-Q2)', () => {
    for (const lu of [contact({ type_client: 'non_assujetti' }), contact(), contact({ type_client: 'organisme_public' })]) {
      expect(gestesDuContact('d1', SOINS, lu, []).soins, lu.type_client ?? '').toBeNull()
    }
  })

  it('hors des soins, ni un particulier ni un client établi hors de France ne sont signalés', () => {
    for (const article of [null, 'cgi_261_4_4_a' as const]) {
      expect(gestesDuContact('d1', article, particulier(), []).soins).toBeNull()
      expect(gestesDuContact('d1', article, etranger(), []).soins).toBeNull()
    }
  })

  it('la règle suit l’ARTICLE, que le dossier soit exonéré ou redevable (A4-Q1) : elle ne lit pas le statut', () => {
    // Le module ne reçoit que l'article : un dossier redevable d'une activité en partie exonérée porte le même.
    expect(soinsDuContact(SOINS, particulier())).toBe('soins_particulier')
    expect(soinsDuContact(null, particulier())).toBeNull()
  })

  it('un contact effacé n’est jamais signalé (il n’a plus ni type ni SIREN, et ne se montre pas)', () => {
    expect(soinsDuContact(SOINS, efface())).toBeNull()
    // Même si une ligne incohérente gardait un type : un effacé n'est jamais signalé.
    expect(soinsDuContact(SOINS, efface({ type_client: 'etranger' }))).toBeNull()
  })
})

describe('les mots de chaque espace : les soins', () => {
  it('la ligne d’information : seulement dans un dossier de soins, ses mots à chaque espace', () => {
    expect(infoDesSoins('cabinet', null)).toBeNull()
    expect(infoDesSoins('client', null)).toBeNull()
    expect(infoDesSoins('client', 'cgi_261_4_4_a')).toBeNull()
    const cabinet = infoDesSoins('cabinet', SOINS) ?? ''
    const client = infoDesSoins('client', SOINS) ?? ''
    expect(cabinet).toMatch(/^Ce dossier dispense des soins exonérés \(art\. 261, 4, 1° du CGI\) : il ne range ni particulier/)
    expect(client).toMatch(/^Ta société dispense des soins exonérés \(art\. 261, 4, 1° du CGI\) : tu ne ranges ici ni particulier/)
    for (const texte of [cabinet, client]) {
      expect(texte).toContain('un non-assujetti sans SIREN')
      expect(texte).toContain('ni client établi hors de France')
      expect(texte).toContain('une association par exemple, s’y range avec son SIREN')
    }
  })

  it('le signalement dit ce que le contact ne peut plus, et ce qu’il peut : s’effacer', () => {
    expect(signalementDesSoins('cabinet')).toBe('Rangé avant que le dossier passe aux soins exonérés : il ne se modifie plus tel quel ni ne se reprend, il peut s’effacer.')
    expect(signalementDesSoins('client')).toBe('Rangé avant que ta société passe aux soins exonérés : il ne se modifie plus tel quel ni ne se reprend, tu peux l’effacer.')
  })

  it('les mots du client : tutoiement, aucune forme du cabinet ; ceux du cabinet gardent leur dossier', () => {
    for (const texte of [infoDesSoins('client', SOINS) ?? '', signalementDesSoins('client')]) expect(motsDuCabinet(texte), texte).toEqual([])
    expect(signalementDesSoins('cabinet')).toContain('le dossier')
  })

  it('les deux refus de la base que le client lit sur les soins se réécrivent à sa façon, sans « un dossier » ni « ses patients »', () => {
    const messages = [
      refusEnregistrementContact('d1', SOINS, { nouveau: true }, saisieQuiPart({ ...SAISIE_VALIDE, typeClient: 'non_assujetti', siren: '' }), []),
      refusEnregistrementContact('d1', SOINS, { nouveau: true }, saisieQuiPart({ ...SAISIE_VALIDE, typeClient: 'etranger' }), []),
    ].map((r) => r?.message ?? '')
    for (const message of messages) {
      const client = pourLEspace('client', message)
      expect(client).not.toBe(message)
      expect(client).toMatch(/^Ta société dispense des soins exonérés/)
      expect(client).not.toMatch(/Un dossier|ses patients|ses contacts/)
      expect(motsDuCabinet(client)).toEqual([])
    }
  })
})

describe('l’effacement : ce qui part, et ce qui reste', () => {
  it('un contact entièrement renseigné : tout ce qui part est nommé, dans l’ordre de la fenêtre de saisie', () => {
    const lu = contact({
      type_client: 'organisme_public', adresse_electronique: '100000207', code_service: 'SERVICE-ACHATS', email: 'a@exemple.fr',
      delai_paiement_jours: 30, observations: 'Texte',
    })
    expect(cePartAvecLEffacement(lu)).toEqual([
      'son nom', 'son adresse', 'son SIREN', 'son SIRET', 'son adresse de facturation électronique', 'son code service', 'son e-mail',
      'son délai de paiement', 'ses observations',
    ])
  })

  it('un contact sans SIREN, e-mail ni observations : seul ce qu’il a est nommé (rien d’inventé)', () => {
    expect(cePartAvecLEffacement(particulier({ delai_paiement_jours: null }))).toEqual(['son nom', 'son adresse'])
  })

  it('un délai de zéro jour est un délai : il part aussi', () => {
    expect(cePartAvecLEffacement(contact({ delai_paiement_jours: 0, siren: null, siret: null }))).toContain('son délai de paiement')
  })

  it('la confirmation nomme le contact, dit que les factures gardent leur copie dix ans et que le geste ne se défait pas', () => {
    const c = confirmationDeLEffacement('cabinet', contact({ nom: 'Société Essai' }))
    expect(c.titre).toBe('Effacer le client « Société Essai » ?')
    expect(c.chapeau).toContain('vide ses données')
    expect(c.chapeau).toContain('ne s’affichera plus nulle part')
    expect(c.reste).toBe('Les factures qui le nomment gardent leur copie, dix ans (C. com., art. L123-22) : l’effacement ne les touche pas. Le geste ne se défait pas.')
  })

  it('un nom très long est coupé comme dans un refus, jamais déroulé en titre', () => {
    const c = confirmationDeLEffacement('cabinet', contact({ nom: 'N'.repeat(200) }))
    expect(Array.from(c.titre).length).toBeLessThan(120)
    expect(c.titre).toContain('…')
  })

  it('au client : « tes factures », tutoiement, aucune forme du cabinet', () => {
    const c = confirmationDeLEffacement('client', contact())
    expect(c.reste.startsWith('Tes factures qui le nomment')).toBe(true)
    expect(motsDuCabinet([c.titre, c.chapeau, ...c.partent, c.reste].join(' '))).toEqual([])
  })
})
