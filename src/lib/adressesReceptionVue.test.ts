import { afterEach, describe, expect, it } from 'vitest'
import {
  CE_QUE_ETABLIT, LIEN_PORTAIL_ANNUAIRE, SAISIE_VIDE, TITRE_PAR_LE_CLIENT, DATE_ILLISIBLE, direLaPriseEffet, direLaVerification,
  estAVenir, formeDeLaSaisie, formeProposee, historiqueDesVersions, jourDeLaDeclaration, libelleMaille, maillesDeLaSaisie,
  mentionParLeClient, peutDeclarer, refusDeLaSaisie, resumeDesAdresses, saisieEnvoyee, saisieTouchee, type SaisieFormulaire,
} from './adressesReceptionVue'
import type { LectureAdressesDuDossier } from './adressesReceptionLecture'
import type { AccesDuDossier } from './auteursVentes'
import { adresse, SIREN_FICTIF, SIRET_FICTIF } from '../test/adressesReception'

// L'ADRESSE DE RÉCEPTION, À L'ÉCRAN : le module pur (espace client, étape A6b1). Ce que ces cas gardent : « à venir » jugé
// contre le jour de Paris donné (A6-Q2) ; la vérification dite avec sa source et son jour, ou « non vérifiée » (A6-Q3) ; ce
// que chaque source établit (A6-Q4) ; « par le client » jamais deviné ; la chaîne des versions, la plus récente d'abord ;
// aucun geste sans lecture entière ; la saisie qui part (blancs retirés, une déclaration sans jour de vérification) ; la
// maille jamais choisie à la place de la personne quand l'identifiant en admet deux ; les refus de la base dits avant le clic,
// et jamais une exception sur une date que le champ rend de travers.

const lectureEntiere = (lignes = [adresse()], siret: LectureAdressesDuDossier['siret'] = { lu: true, siret: SIRET_FICTIF }): LectureAdressesDuDossier =>
  ({ adresses: { lignes, complete: true, motif: null }, siret })

const saisie = (o: Partial<SaisieFormulaire> = {}): SaisieFormulaire => ({
  forme: 'siren', identifiant: SIREN_FICTIF, plateforme: 'Plateforme fictive', prise_effet: '2026-09-01',
  verification: 'portail_annuaire', verifiee_le: '2026-10-01', ...o,
})

describe('« à venir » (A6-Q2)', () => {
  it('la prise d’effet est après aujourd’hui à Paris : à venir ; le jour même, elle est en vigueur', () => {
    expect(estAVenir('2026-10-15', '2026-10-14')).toBe(true)
    expect(estAVenir('2026-10-14', '2026-10-14')).toBe(false)
    expect(estAVenir('2026-10-13', '2026-10-14')).toBe(false)
  })

  it('se dit avec son jour, dans les deux cas', () => {
    expect(direLaPriseEffet('2026-10-15', '2026-10-14')).toBe('À venir : à partir du 15/10/2026')
    expect(direLaPriseEffet('2026-10-14', '2026-10-14')).toBe('Reçoit depuis le 14/10/2026')
    expect(direLaPriseEffet('2026-09-01', '2026-10-14')).toBe('Reçoit depuis le 01/09/2026')
  })
})

describe('la vérification et ce qu’elle établit (A6-Q3, A6-Q4)', () => {
  it('une adresse non vérifiée compte, et se dit telle', () => {
    expect(direLaVerification({ verification: 'declaration', verifiee_le: null })).toBe('Non vérifiée : simple déclaration')
  })

  it('une vérifiée dit sa source et son jour', () => {
    expect(direLaVerification({ verification: 'portail_annuaire', verifiee_le: '2026-10-01' })).toBe('Vérifiée sur le portail de l’annuaire le 01/10/2026')
    expect(direLaVerification({ verification: 'plateforme', verifiee_le: '2026-10-02' })).toBe('Vérifiée sur la plateforme le 02/10/2026')
  })

  it('le portail n’établit que l’identifiant et sa maille, et sa ligne par défaut est une plateforme fictive', () => {
    const portail = CE_QUE_ETABLIT.portail_annuaire
    expect(portail).toContain('n’établit que l’identifiant et sa maille')
    expect(portail).toContain('jamais la plateforme qui reçoit')
    expect(portail).toContain('matricule 9998')
    expect(portail).toContain('plateforme fictive')
    expect(portail).toContain('ne prouve donc pas qu’une vraie plateforme reçoit dessus')
  })

  it('la plateforme confirme, une simple déclaration n’établit rien : trois phrases différentes', () => {
    expect(CE_QUE_ETABLIT.plateforme).toContain('a confirmé cette adresse')
    expect(CE_QUE_ETABLIT.declaration).toContain('n’établit rien')
    expect(new Set(Object.values(CE_QUE_ETABLIT)).size).toBe(3)
  })

  it('le portail public de l’annuaire : l’adresse du dossier général de la DGFiP, v3.2, § 3.5.4', () => {
    expect(LIEN_PORTAIL_ANNUAIRE).toBe('https://facturation.chorus-pro.gouv.fr/annuaire/#/')
  })

  it('une maille se dit par son libellé de l’annuaire', () => {
    expect(libelleMaille('siren_siret_routage')).toBe('SIREN_SIRET_routage')
  })
})

describe('le jour de la déclaration : `cree_le` est un INSTANT', () => {
  const avant = process.env.TZ
  afterEach(() => { process.env.TZ = avant })

  it('le jour de qui regarde, jamais le jour UTC tronqué', () => {
    const a = adresse({ cree_le: '2026-10-14T22:30:00Z' })
    process.env.TZ = 'Europe/Paris'
    expect(jourDeLaDeclaration(a)).toBe('15/10/2026')
    process.env.TZ = 'America/New_York'
    expect(jourDeLaDeclaration(a)).toBe('14/10/2026')
  })
})

describe('« par le client » (jamais deviné)', () => {
  const lus: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }

  it('l’auteur est un compte qui porte un accès du dossier, lu en entier : « par le client »', () => {
    expect(mentionParLeClient(lus, adresse({ auteur: 'u-client' }))).toEqual({ libelle: 'par le client', titre: TITRE_PAR_LE_CLIENT })
  })

  it('un autre compte n’est pas dit « par le cabinet » : aucune mention', () => {
    expect(mentionParLeClient(lus, adresse({ auteur: 'u-cabinet' }))).toBeNull()
  })

  it.each<AccesDuDossier>([
    { etat: 'en_cours' },
    { etat: 'incomplets', motif: 'lecture interrompue' },
    { etat: 'sans_objet' },
  ])('des accès pas lus en entier (%o) ne disent rien de personne', (acces) => {
    expect(mentionParLeClient(acces, adresse({ auteur: 'u-client' }))).toBeNull()
  })
})

describe('ce que la lecture permet de dire', () => {
  it('lue en partie ou refusée : le motif, ni adresse ni vide', () => {
    expect(resumeDesAdresses({ lignes: [adresse()], complete: false, motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' }, 'd1', '2026-10-14'))
      .toEqual({ etat: 'incomplete', motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
    expect(resumeDesAdresses({ lignes: [], complete: false, motif: null }, 'd1', '2026-10-14'))
      .toEqual({ etat: 'incomplete', motif: 'lecture incomplète' })
  })

  it('« aucune » ne se dit que d’une liste lue en entier', () => {
    expect(resumeDesAdresses({ lignes: [], complete: true, motif: null }, 'd1', '2026-10-14')).toEqual({ etat: 'aucune' })
  })

  it('la courante, et si elle est à venir', () => {
    const a = adresse({ prise_effet: '2026-10-20' })
    expect(resumeDesAdresses({ lignes: [a], complete: true, motif: null }, 'd1', '2026-10-14')).toEqual({ etat: 'courante', adresse: a, aVenir: true })
    expect(resumeDesAdresses({ lignes: [a], complete: true, motif: null }, 'd1', '2026-10-20')).toEqual({ etat: 'courante', adresse: a, aVenir: false })
  })

  it('des lignes qui ne font pas une chaîne : rompue, aucune n’est dite courante', () => {
    const lignes = [adresse({ id: 'a1' }), adresse({ id: 'a2' })]
    expect(resumeDesAdresses({ lignes, complete: true, motif: null }, 'd1', '2026-10-14')).toEqual({ etat: 'rompue' })
  })
})

const ids = (h: ReturnType<typeof historiqueDesVersions>) => (h === 'rompue' ? h : h.map((a) => a.id))

describe('l’historique : les versions de la chaîne, la plus récente d’abord', () => {
  const v1 = adresse({ id: 'a1' })
  const v2 = adresse({ id: 'a2', remplace_id: 'a1', cree_le: '2026-10-15T08:00:00Z' })
  const v3 = adresse({ id: 'a3', remplace_id: 'a2', cree_le: '2026-10-16T08:00:00Z' })

  it('de la courante à la première, quel que soit l’ordre des lignes lues', () => {
    expect(ids(historiqueDesVersions([v1, v2, v3], 'd1'))).toEqual(['a3', 'a2', 'a1'])
    expect(ids(historiqueDesVersions([v3, v1, v2], 'd1'))).toEqual(['a3', 'a2', 'a1'])
  })

  it('sans déclaration : vide ; une chaîne rompue : rompue, jamais un choix', () => {
    expect(historiqueDesVersions([], 'd1')).toEqual([])
    expect(historiqueDesVersions([v1, adresse({ id: 'a9' })], 'd1')).toBe('rompue')
  })

  it('les adresses d’un autre dossier n’en font pas partie', () => {
    expect(ids(historiqueDesVersions([v1, adresse({ id: 'x', dossier_id: 'd2' })], 'd1'))).toEqual(['a1'])
  })
})

describe('aucun geste sans lecture entière', () => {
  it('les adresses lues en entier et le SIRET lu : le geste est offert, sur un dossier sans adresse comme avec', () => {
    expect(peutDeclarer(lectureEntiere([]), 'd1')).toBe(true)
    expect(peutDeclarer(lectureEntiere(), 'd1')).toBe(true)
    // Un dossier sans SIRET est LU : le refus se dit dans le formulaire, ce n'est pas une lecture ratée.
    expect(peutDeclarer(lectureEntiere([adresse()], { lu: true, siret: null }), 'd1')).toBe(true)
  })

  it('lues en partie : aucun geste', () => {
    const l = lectureEntiere()
    expect(peutDeclarer({ ...l, adresses: { ...l.adresses, complete: false, motif: 'm' } }, 'd1')).toBe(false)
  })

  it('le SIRET pas lu : aucun geste', () => {
    expect(peutDeclarer(lectureEntiere([adresse()], { lu: false, motif: 'm' }), 'd1')).toBe(false)
  })

  it('une chaîne rompue : aucun geste', () => {
    expect(peutDeclarer(lectureEntiere([adresse({ id: 'a1' }), adresse({ id: 'a2' })]), 'd1')).toBe(false)
  })
})

describe('la maille : jamais choisie à la place de la personne', () => {
  it('un identifiant qui n’en admet qu’une la propose', () => {
    const s = saisie({ forme: '', identifiant: SIREN_FICTIF })
    expect(maillesDeLaSaisie(s)).toEqual(['siren'])
    expect(formeDeLaSaisie(s)).toBe('siren')
    expect(formeProposee(s)).toBe(true)
  })

  it('un identifiant qui en admet deux n’en propose aucune : la personne choisit', () => {
    const s = saisie({ forme: '', identifiant: `${SIREN_FICTIF}_${SIRET_FICTIF}` })
    expect(maillesDeLaSaisie(s)).toEqual(['siren_siret', 'siren_suffixe'])
    expect(formeDeLaSaisie(s)).toBe('')
    expect(formeProposee(s)).toBe(false)
    expect(saisieEnvoyee(s, null).forme).toBeNull()
  })

  it('un identifiant qui n’en admet aucune : aucune ; un choix fait l’emporte, même contre la proposition', () => {
    expect(formeDeLaSaisie(saisie({ forme: '', identifiant: '12' }))).toBe('')
    const choisie = saisie({ forme: 'siren_suffixe', identifiant: `${SIREN_FICTIF}_${SIRET_FICTIF}` })
    expect(formeDeLaSaisie(choisie)).toBe('siren_suffixe')
    expect(formeProposee(choisie)).toBe(false)
    expect(formeDeLaSaisie(saisie({ forme: 'siren_siret', identifiant: SIREN_FICTIF }))).toBe('siren_siret')
  })

  it('les blancs des bords d’un identifiant collé ne changent pas ses mailles', () => {
    expect(maillesDeLaSaisie(saisie({ forme: '', identifiant: ` ${SIREN_FICTIF}\n` }))).toEqual(['siren'])
  })
})

describe('ce qui part', () => {
  it('la maille effective, les blancs des bords retirés, la version remplacée', () => {
    expect(saisieEnvoyee(saisie({ forme: '', identifiant: ` ${SIREN_FICTIF} `, plateforme: '  Plateforme fictive\n' }), 'a1')).toEqual({
      forme: 'siren', identifiant: SIREN_FICTIF, plateforme: 'Plateforme fictive', prise_effet: '2026-09-01',
      verification: 'portail_annuaire', verifiee_le: '2026-10-01', remplace_id: 'a1',
    })
  })

  it('un champ vide part nul — jamais une chaîne vide', () => {
    expect(saisieEnvoyee(SAISIE_VIDE, null)).toEqual({
      forme: null, identifiant: null, plateforme: null, prise_effet: null, verification: null, verifiee_le: null, remplace_id: null,
    })
  })

  it('une adresse déclarée sans vérification n’a pas de jour de vérification : celui d’un choix abandonné ne part pas', () => {
    expect(saisieEnvoyee(saisie({ verification: 'declaration', verifiee_le: '2026-10-01' }), null).verifiee_le).toBeNull()
    expect(saisieEnvoyee(saisie({ verification: 'plateforme', verifiee_le: '2026-10-01' }), null).verifiee_le).toBe('2026-10-01')
    expect(saisieEnvoyee(saisie({ verification: '', verifiee_le: '2026-10-01' }), null).verifiee_le).toBeNull()
  })

  it('une saisie touchée est une saisie qui a changé depuis son départ', () => {
    expect(saisieTouchee(SAISIE_VIDE, SAISIE_VIDE)).toBe(false)
    expect(saisieTouchee(SAISIE_VIDE, { ...SAISIE_VIDE, plateforme: 'P' })).toBe(true)
  })
})

describe('les refus de la base, dits avant le clic, sous ses mots', () => {
  const AUJOURDHUI = '2026-10-14'
  const message = (r: ReturnType<typeof refusDeLaSaisie>) => (r === null || r === 'rompue' ? r : r.message)
  const refus = (s: SaisieFormulaire, o: { siret?: string | null; remplace?: string | null; adresses?: ReturnType<typeof adresse>[] } = {}) =>
    refusDeLaSaisie('d1', o.siret === undefined ? SIRET_FICTIF : o.siret, s, o.remplace ?? null, o.adresses ?? [], AUJOURDHUI)

  it('une saisie complète : aucun refus', () => {
    expect(refus(saisie())).toBeNull()
  })

  it('le premier refus, dans l’ordre de la base : la maille, l’identifiant, le SIREN du dossier, la date, la plateforme, la vérification', () => {
    expect(refus(SAISIE_VIDE)).toMatchObject({ cle: 'maille_inconnue' })
    expect(refus(saisie({ forme: 'siren', identifiant: '12' }))).toMatchObject({ cle: 'forme_siren' })
    expect(refus(saisie(), { siret: null })).toMatchObject({ cle: 'dossier_sans_siren' })
    expect(refus(saisie({ identifiant: '999999999' }))).toMatchObject({ cle: 'siren_du_dossier' })
    expect(refus(saisie({ prise_effet: '' }))).toMatchObject({ cle: 'prise_effet_absente' })
    expect(refus(saisie({ prise_effet: '1999-12-31' }))).toMatchObject({ cle: 'prise_effet_hors_bornes' })
    expect(refus(saisie({ plateforme: '  ' }))).toMatchObject({ cle: 'plateforme_absente' })
    expect(refus(saisie({ plateforme: 'P'.repeat(100) }))).toMatchObject({ cle: 'plateforme_longue' })
    expect(refus(saisie({ verification: '' }))).toMatchObject({ cle: 'verification_inconnue' })
    expect(refus(saisie({ verification: 'plateforme', verifiee_le: '' }))).toMatchObject({ cle: 'verification_sans_jour' })
    expect(refus(saisie({ verifiee_le: '2026-10-15' }))).toMatchObject({ cle: 'verification_hors_bornes' })
  })

  it('une identifiant collé avec un blanc au bord est jugé tel qu’il PART, sans le blanc', () => {
    expect(refus(saisie({ identifiant: ` ${SIREN_FICTIF}\n` }))).toBeNull()
  })

  it('le message est celui de la base, avec son SIREN', () => {
    expect(message(refus(saisie({ identifiant: '999999999' })))).toBe(`L'adresse doit commencer par le SIREN du dossier, ${SIREN_FICTIF}.`)
  })

  it('une date que le champ rend de travers se dit sans lever : le module de la base lèverait', () => {
    expect(refus(saisie({ prise_effet: '275760-09-13' }))).toEqual({ cle: 'date_illisible', message: DATE_ILLISIBLE })
    expect(refus(saisie({ verifiee_le: '2026-02-30' }))).toEqual({ cle: 'date_illisible', message: DATE_ILLISIBLE })
  })

  it('la version remplacée est celle lue à l’ouverture : une autre déclarée depuis, le refus le dit avec son jour', () => {
    const v1 = adresse({ id: 'a1' })
    const v2 = adresse({ id: 'a2', remplace_id: 'a1', identifiant: SIREN_FICTIF, cree_le: '2026-10-13T08:00:00Z' })
    expect(refus(saisie(), { remplace: 'a1', adresses: [v1] })).toBeNull()
    expect(message(refus(saisie(), { remplace: 'a1', adresses: [v1, v2] })))
      .toBe(`Une autre adresse a été déclarée entre-temps (« ${SIREN_FICTIF} », le 13/10/2026) : relire avant de déclarer.`)
    // Une première déclaration, quand une autre est arrivée depuis.
    expect(refus(saisie(), { remplace: null, adresses: [v1] })).toMatchObject({ cle: 'remplacee_pas_courante' })
  })

  it('des adresses lues qui ne font pas une chaîne : rompue, aucun jugement', () => {
    expect(refus(saisie(), { remplace: 'a1', adresses: [adresse({ id: 'a1' }), adresse({ id: 'a2' })] })).toBe('rompue')
  })
})
