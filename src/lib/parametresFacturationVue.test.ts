import { describe, expect, it } from 'vitest'
import {
  CHAMPS_DES_CONDITIONS, CONSEIL_VERIFICATION_RIB, NON_RENSEIGNE, SAISIE_VIDE, TEXTE_ROMPUE, ceQueDeviendraLeRib, champsChanges, conditionsDeLaVersion,
  confirmationDuRib, delaiEnJours, etatDuRibDit, historiqueDesParametres, ibanParQuatre, libelleDuMoyen, mentionVersionParLeClient,
  pastilleDuRib, phraseDEnTete, phraseDesPropositions, refusDeLaConfirmation, refusDeLaSaisieParametres, resumeDesParametres,
  ribDeLaVersion, ribEnVigueurDit, rienNeChange, saisieDeLaVersion, saisieProposee, versionsDeLaChaine,
} from './parametresFacturationVue'
import { CHAMPS_DES_PARAMETRES, PROPOSITIONS_PAR_DEFAUT, saisieQuiPart } from './parametresFacturation'
import { motsDuCabinet } from './espaceVentes'
import { MENTIONS_FIGEES_EXPORTEES } from './mentionsFigees'
import type { AccesDuDossier } from './auteursVentes'
import { versionParametres } from '../test/parametresFacturation'
import type { ParametresFacturation } from './types'

// CE QUE LA VUE « PARAMÈTRES » DIT (espace client, étape A5b1), en module pur. Ce que ces cas gardent : rien ne se dit d'une
// lecture partielle ni d'une chaîne rompue ; chaque champ en mots (le délai en jours, le moyen sous son libellé, un champ
// vide dit tel) ; l'IBAN par quatre à l'affichage seulement ; chaque état du RIB, au jour et à l'heure de Paris ; le RIB en
// vigueur d'une courante proposée, dit pour quand les factures porteront un RIB ; les champs qu'une version a changés, le
// RIB nommément ; « par le client » au cabinet seul, sur des accès lus en entier ; ce que deviendra le RIB, dans chacun des
// cas de `etatDuRibEnregistre` ; la confirmation qui NOMME le RIB. IBAN FICTIFS (le code banque 99999, à clé juste).

const IBAN_A = 'FR9399999000010000000000100'
const IBAN_B = 'FR1299999000010000000000200'
const LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
const INCOMPLETS: AccesDuDossier = { etat: 'incomplets', motif: 'lecture incomplète' }
const SANS_OBJET: AccesDuDossier = { etat: 'sans_objet' }

// La chaîne d'essai : V1, du cabinet, pose le RIB A et le confirme d'un même geste ; V2, du client, le change en B — proposé ;
// V3, du cabinet, change le délai sans toucher au RIB — B reste proposé (A5-Q4), A reste en vigueur.
const V1 = versionParametres({
  id: 'v1', iban: IBAN_A, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif', rib_etat: 'confirme',
  rib_confirme_par: 'u-cabinet', rib_confirme_le: '2027-10-01T09:00:00Z', auteur: 'u-cabinet', cree_le: '2027-10-01T09:00:00Z',
})
const V2 = versionParametres({
  id: 'v2', remplace_id: 'v1', iban: IBAN_B, bic: null, titulaire_compte: 'Atelier fictif', rib_etat: 'propose',
  auteur: 'u-client', cree_le: '2027-10-02T09:00:00Z',
})
const V3 = versionParametres({
  id: 'v3', remplace_id: 'v2', delai_paiement_jours: 45, iban: IBAN_B, bic: null, titulaire_compte: 'Atelier fictif',
  rib_etat: 'propose', auteur: 'u-cabinet', cree_le: '2027-10-03T09:00:00Z',
})
const CHAINE = [V1, V2, V3]
const lu = (lignes: ParametresFacturation[], complete = true) => ({ lignes, complete, motif: complete ? null : '1 ligne(s) lue(s) sur 2 annoncée(s)' })

describe('ce que la lecture permet de dire', () => {
  it('lue en partie : ni version ni vide, le motif ; rompue : rien ; vide lu en entier : « aucune » ; sinon la courante', () => {
    expect(resumeDesParametres(lu([V1], false), 'd1')).toEqual({ etat: 'incomplete', motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
    expect(resumeDesParametres({ lignes: [], complete: false, motif: null }, 'd1')).toEqual({ etat: 'incomplete', motif: 'lecture incomplète' })
    expect(resumeDesParametres(lu([V1, versionParametres({ id: 'v9' })]), 'd1')).toEqual({ etat: 'rompue' })
    expect(resumeDesParametres(lu([]), 'd1')).toEqual({ etat: 'aucune' })
    expect(resumeDesParametres(lu([versionParametres({ id: 'x', dossier_id: 'd2' })]), 'd1')).toEqual({ etat: 'aucune' })
    expect(resumeDesParametres(lu(CHAINE), 'd1')).toEqual({ etat: 'courante', version: V3 })
  })
})

describe('chaque champ en mots', () => {
  it('le délai en jours, au singulier sous deux', () => {
    expect([0, 1, 2, 30].map(delaiEnJours)).toEqual(['0 jour', '1 jour', '2 jours', '30 jours'])
  })

  it('le moyen sous le libellé du registre des encaissements', () => {
    expect(libelleDuMoyen('virement')).toBe('Virement')
    expect(libelleDuMoyen('carte')).toBe('Carte bancaire')
    expect(libelleDuMoyen('effet')).toBe('Effet de commerce')
  })

  it('les six conditions, dans l’ordre de la fonction, un champ vide dit tel', () => {
    const champs = conditionsDeLaVersion(versionParametres({ delai_paiement_jours: 0, moyen_prefere: 'cheque', escompte: 'Néant.' }))
    expect(champs.map((c) => c.champ)).toEqual(CHAMPS_DES_CONDITIONS)
    expect(CHAMPS_DES_CONDITIONS).toEqual(CHAMPS_DES_PARAMETRES.slice(0, 6))
    expect(champs.map((c) => [c.libelle, c.valeur, c.vide])).toEqual([
      ['Délai de paiement', '0 jour', false],
      ['Moyen de paiement proposé', 'Chèque', false],
      ['Conditions d’escompte', 'Néant.', false],
      ['Pénalités de retard', NON_RENSEIGNE, true],
      ['Mentions complémentaires', NON_RENSEIGNE, true],
      ['Pied de page', NON_RENSEIGNE, true],
    ])
    expect(conditionsDeLaVersion(versionParametres({ delai_paiement_jours: null, moyen_prefere: null }))[0]).toMatchObject({ valeur: NON_RENSEIGNE, vide: true })
  })

  it('l’IBAN par groupes de quatre à l’affichage, la forme rangée intacte ; le RIB nul sans IBAN', () => {
    expect(ibanParQuatre(IBAN_A)).toBe('FR93 9999 9000 0100 0000 0000 100')
    expect(ibanParQuatre('FR76AAAA')).toBe('FR76 AAAA')
    expect(ribDeLaVersion(versionParametres())).toBeNull()
    expect(ribDeLaVersion(V2)?.map((c) => [c.libelle, c.valeur, c.vide])).toEqual([
      ['IBAN', 'FR12 9999 9000 0100 0000 0000 200', false], ['BIC', NON_RENSEIGNE, true], ['Titulaire du compte', 'Atelier fictif', false],
    ])
    expect(V2.iban).toBe(IBAN_B)
  })
})

describe('l’état du RIB, dit', () => {
  it('la pastille : aucune sans RIB, « Proposé », « Confirmé »', () => {
    expect([versionParametres(), V3, V1].map(pastilleDuRib)).toEqual([null, 'Proposé', 'Confirmé'])
  })

  it('aucun RIB', () => {
    expect(etatDuRibDit([versionParametres()], 'd1', 'v1', 'cabinet', LUS)).toBe('Aucun RIB.')
  })

  it('proposé : au cabinet, par le client sur des accès lus en entier, à l’heure de Paris ; jamais deviné', () => {
    // Posé par V2 (le client) : V3 l'a repris tel quel, son auteur n'est pas celui qui l'a posé.
    expect(etatDuRibDit(CHAINE, 'd1', 'v3', 'cabinet', LUS)).toBe('Proposé par le client le 02/10/2027 à 11:00 : en attente de votre confirmation.')
    expect(etatDuRibDit(CHAINE, 'd1', 'v3', 'cabinet', INCOMPLETS)).toBe('Proposé le 02/10/2027 à 11:00 : en attente de votre confirmation.')
    expect(etatDuRibDit(CHAINE, 'd1', 'v3', 'cabinet', { etat: 'lus', comptes: [] })).not.toContain('par le')
  })

  it('proposé, chez le client : en attente de la confirmation de son cabinet, sans « par le client »', () => {
    expect(etatDuRibDit(CHAINE, 'd1', 'v3', 'client', LUS)).toBe('Proposé le 02/10/2027 à 11:00 : en attente de la confirmation de ton cabinet.')
  })

  it('confirmé d’un même geste, ou ensuite — qui l’a posé, qui l’a confirmé', () => {
    expect(etatDuRibDit(CHAINE, 'd1', 'v1', 'cabinet', LUS)).toBe('Posé et confirmé d’un même geste le 01/10/2027 à 11:00.')
    const confirmee = { ...V3, rib_etat: 'confirme' as const, rib_confirme_par: 'u-cabinet', rib_confirme_le: '2027-10-04T09:30:00Z' }
    const chaine = [V1, V2, confirmee]
    expect(etatDuRibDit(chaine, 'd1', 'v3', 'cabinet', LUS)).toBe('Posé par le client le 02/10/2027 à 11:00, confirmé le 04/10/2027 à 11:30.')
    expect(etatDuRibDit(chaine, 'd1', 'v3', 'client', LUS)).toBe('Posé le 02/10/2027 à 11:00, confirmé le 04/10/2027 à 11:30.')
    // Un compte que les accès lus reconnaissent est dit « par le client », même pour une confirmation ; un autre, jamais nommé.
    expect(etatDuRibDit([{ ...V1, auteur: 'u-client', rib_confirme_par: 'u-client' }], 'd1', 'v1', 'cabinet', LUS))
      .toBe('Posé et confirmé par le client d’un même geste le 01/10/2027 à 11:00.')
  })

  it('une chaîne rompue ou une version absente : rien à dire', () => {
    expect(etatDuRibDit([V1, versionParametres({ id: 'v9' })], 'd1', 'v1', 'cabinet', LUS)).toBe('rompue')
    expect(etatDuRibDit(CHAINE, 'd1', 'absente', 'cabinet', LUS)).toBeNull()
  })
})

describe('le RIB en vigueur d’une courante proposée', () => {
  it('le confirmé d’avant, nommé, pour quand les factures porteront un RIB — jamais imprimé aujourd’hui', () => {
    const dit = ribEnVigueurDit(CHAINE, 'd1', 'cabinet')
    expect(dit?.phrase).toContain('Le RIB confirmé d’avant reste en vigueur')
    expect(dit?.phrase).toContain('quand elles porteront un RIB')
    expect(dit?.phrase).not.toMatch(/imprim/)
    expect(dit?.rib?.[0].valeur).toBe('FR93 9999 9000 0100 0000 0000 100')
    const client = ribEnVigueurDit(CHAINE, 'd1', 'client')
    expect(client?.phrase).toContain('tes factures porteront, quand elles porteront un RIB, jusqu’à la confirmation de ton cabinet')
  })

  it('aucun confirmé avant lui : aucun RIB, dit tel', () => {
    const seule = [versionParametres({ iban: IBAN_B, rib_etat: 'propose', auteur: 'u-client' })]
    expect(ribEnVigueurDit(seule, 'd1', 'cabinet')).toEqual({
      phrase: 'Aucun RIB confirmé ne le précède : tant que vous ne l’avez pas confirmé, les factures n’en porteront aucun, quand elles porteront un RIB.',
      rib: null,
    })
    // Un RIB d'avant retiré n'est pas en vigueur : la remontée s'arrête à la version qui n'en a pas.
    const apresRetrait = [V1, versionParametres({ id: 'v2', remplace_id: 'v1', cree_le: '2027-10-02T09:00:00Z' }),
      versionParametres({ id: 'v3', remplace_id: 'v2', iban: IBAN_B, rib_etat: 'propose', cree_le: '2027-10-03T09:00:00Z' })]
    expect(ribEnVigueurDit(apresRetrait, 'd1', 'cabinet')?.rib).toBeNull()
  })

  it('rien à dire d’une courante confirmée, sans RIB, absente, ou d’une chaîne rompue', () => {
    expect(ribEnVigueurDit([V1], 'd1', 'cabinet')).toBeNull()
    expect(ribEnVigueurDit([versionParametres()], 'd1', 'cabinet')).toBeNull()
    expect(ribEnVigueurDit([], 'd1', 'cabinet')).toBeNull()
    expect(ribEnVigueurDit([V2, V3], 'd1', 'cabinet')).toBeNull()
  })
})

describe('l’historique', () => {
  it('ce qu’une version a changé, le RIB nommément ; rien pour la première', () => {
    expect(champsChanges(V1, null)).toBeNull()
    expect(champsChanges(V2, V1)).toEqual(['RIB changé (IBAN, BIC)'])
    expect(champsChanges(V3, V2)).toEqual(['Délai de paiement'])
    expect(champsChanges({ ...V3, titulaire_compte: 'Autre titulaire fictif', moyen_prefere: 'cheque' }, V2))
      .toEqual(['Délai de paiement', 'Moyen de paiement proposé', 'RIB changé (titulaire du compte)'])
    expect(champsChanges(versionParametres({ iban: IBAN_A }), versionParametres())).toEqual(['RIB posé'])
    expect(champsChanges(versionParametres(), versionParametres({ iban: IBAN_A }))).toEqual(['RIB retiré'])
    expect(champsChanges(V3, V3)).toEqual([])
  })

  it('dès deux versions, la courante d’abord : quand, par le client au cabinet seul, l’état du RIB, les changements', () => {
    expect(historiqueDesParametres([V1], 'd1', 'cabinet', LUS)).toEqual([])
    expect(historiqueDesParametres([], 'd1', 'cabinet', LUS)).toEqual([])
    const h = historiqueDesParametres(CHAINE, 'd1', 'cabinet', LUS)
    if (h === 'rompue') throw new Error('chaîne rompue')
    expect(h.map((e) => [e.version.id, e.courante, e.quand, e.parLeClient?.libelle ?? null, e.changes])).toEqual([
      ['v3', true, '03/10/2027 à 11:00', null, ['Délai de paiement']],
      ['v2', false, '02/10/2027 à 11:00', 'par le client', ['RIB changé (IBAN, BIC)']],
      ['v1', false, '01/10/2027 à 11:00', null, null],
    ])
    expect(h[1].rib).toBe('Proposé par le client le 02/10/2027 à 11:00 : en attente de votre confirmation.')
    expect(h[2].rib).toBe('Posé et confirmé d’un même geste le 01/10/2027 à 11:00.')
  })

  it('« par le client » ni sur des accès lus en partie, ni chez le client ; une chaîne rompue ne se raconte pas', () => {
    const incomplets = historiqueDesParametres(CHAINE, 'd1', 'cabinet', INCOMPLETS)
    expect(Array.isArray(incomplets) && incomplets.every((e) => e.parLeClient === null)).toBe(true)
    const client = historiqueDesParametres(CHAINE, 'd1', 'client', LUS)
    expect(Array.isArray(client) && client.every((e) => e.parLeClient === null)).toBe(true)
    expect(historiqueDesParametres([V2, V3], 'd1', 'cabinet', LUS)).toBe('rompue')
    expect(versionsDeLaChaine([V2, V3], 'd1')).toBe('rompue')
  })

  it('la mention de l’auteur d’une version : un accès lu en entier seulement, jamais un auteur inconnu', () => {
    expect(mentionVersionParLeClient(LUS, V2)).toEqual({ libelle: 'par le client', titre: 'Paramètres enregistrés par le client' })
    expect(mentionVersionParLeClient(LUS, V1)).toBeNull()
    expect(mentionVersionParLeClient(INCOMPLETS, V2)).toBeNull()
    expect(mentionVersionParLeClient(SANS_OBJET, V2)).toBeNull()
  })
})

describe('le formulaire', () => {
  it('sans aucune version : les propositions (MEG1-Q13), le reste vide', () => {
    expect(saisieProposee()).toEqual({
      ...SAISIE_VIDE, delai: '30', escompte: PROPOSITIONS_PAR_DEFAUT.escompte, penalites: PROPOSITIONS_PAR_DEFAUT.penalites,
    })
  })

  it('une modification part de la courante, tous ses champs ; l’IBAN par quatre repart sous sa forme électronique', () => {
    const v = { ...V1, escompte: 'Néant.', mentions_complementaires: 'Mention fictive', pied_de_page: 'Pied fictif', penalites: 'Pénalités fictives' }
    const saisie = saisieDeLaVersion(v)
    expect(saisie.iban).toBe('FR93 9999 9000 0100 0000 0000 100')
    expect(saisieQuiPart(saisie)).toEqual({
      delai_paiement_jours: 30, moyen_prefere: 'virement', escompte: 'Néant.', penalites: 'Pénalités fictives',
      mentions_complementaires: 'Mention fictive', pied_de_page: 'Pied fictif', iban: IBAN_A, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif',
    })
    expect(saisieDeLaVersion(versionParametres({ delai_paiement_jours: null, moyen_prefere: null }))).toEqual(SAISIE_VIDE)
  })

  it('rien ne diffère : jugé sur la saisie telle qu’elle part (des blancs ne changent rien) ; une première vide n’a rien à enregistrer', () => {
    expect(rienNeChange(V1, saisieDeLaVersion(V1))).toBe(true)
    expect(rienNeChange(V1, { ...saisieDeLaVersion(V1), titulaire: '  Atelier fictif ', iban: 'fr93 9999 9000 0100 0000 0000 100' })).toBe(true)
    expect(rienNeChange(V1, { ...saisieDeLaVersion(V1), delai: '31' })).toBe(false)
    expect(rienNeChange(V1, { ...saisieDeLaVersion(V1), bic: '' })).toBe(false)
    expect(rienNeChange(null, SAISIE_VIDE)).toBe(true)
    expect(rienNeChange(null, saisieProposee())).toBe(false)
  })

  it('le refus de la base sur la saisie telle qu’elle part, et une autre saisie passée entre-temps, nommée', () => {
    expect(refusDeLaSaisieParametres('d1', 'v3', saisieDeLaVersion(V3), CHAINE)).toBeNull()
    expect(refusDeLaSaisieParametres('d1', 'v3', { ...saisieDeLaVersion(V3), delai: '61' }, CHAINE))
      .toEqual({ cle: 'delai', message: 'Le délai de paiement est un nombre entier de jours, de 0 à 60.' })
    expect(refusDeLaSaisieParametres('d1', 'v2', saisieDeLaVersion(V2), CHAINE)).toEqual({
      cle: 'remplacee_pas_courante',
      message: 'D’autres paramètres de facturation ont été enregistrés entre-temps (le 03/10/2027 à 11:00) : relire avant d’enregistrer.'.replace(/’/g, "'"),
    })
    expect(refusDeLaSaisieParametres('d1', 'v3', saisieDeLaVersion(V3), [V2, V3])).toBe('rompue')
  })
})

describe('ce que deviendra le RIB, dit avant le clic', () => {
  const avec = (v: ParametresFacturation, o: Partial<typeof SAISIE_VIDE>) => ({ ...saisieDeLaVersion(v), ...o })

  it('changé par le cabinet : confirmé d’emblée, en son nom ; posé sur une version sans RIB, de même', () => {
    expect(ceQueDeviendraLeRib(V1, avec(V1, { iban: IBAN_B }), 'cabinet')).toBe('Le RIB change : il sera confirmé d’emblée, en votre nom.')
    expect(ceQueDeviendraLeRib(null, { ...SAISIE_VIDE, iban: IBAN_A }, 'cabinet')).toBe('Le RIB est posé : il sera confirmé d’emblée, en votre nom.')
  })

  it('le cabinet qui retouche un RIB PROPOSÉ sans en changer l’IBAN le confirme d’emblée : dit avant le clic, avec le conseil', () => {
    const attendu = 'Le RIB change, mais garde l’IBAN proposé, que vous n’avez pas confirmé : l’enregistrer le confirmera '
      + `d’emblée, en votre nom. ${CONSEIL_VERIFICATION_RIB}`
    expect(ceQueDeviendraLeRib(V3, avec(V3, { bic: 'ESSAFR10' }), 'cabinet')).toBe(attendu)
    expect(ceQueDeviendraLeRib(V3, avec(V3, { titulaire: 'Autre titulaire fictif' }), 'cabinet')).toBe(attendu)
    // Tapé avec ses espaces et en minuscules, c'est le même IBAN.
    expect(ceQueDeviendraLeRib(V3, avec(V3, { iban: 'fr12 9999 9000 0100 0000 0000 200', bic: 'ESSAFR10' }), 'cabinet')).toBe(attendu)
    // Un autre IBAN, que le cabinet tape lui-même, il le pose en son nom ; un RIB d'avant confirmé n'a rien à confirmer en passant.
    expect(ceQueDeviendraLeRib(V3, avec(V3, { iban: IBAN_A }), 'cabinet')).toBe('Le RIB change : il sera confirmé d’emblée, en votre nom.')
    expect(ceQueDeviendraLeRib(V1, avec(V1, { bic: 'ESSAFR20' }), 'cabinet')).toBe('Le RIB change : il sera confirmé d’emblée, en votre nom.')
    // Le client qui fait de même ne confirme rien.
    expect(ceQueDeviendraLeRib(V3, avec(V3, { bic: 'ESSAFR10' }), 'client'))
      .toBe('Le RIB change : il ne sera que proposé, jusqu’à la confirmation de ton cabinet.')
  })

  it('changé par le client : seulement proposé, jusqu’à la confirmation de son cabinet (MEG1-Q12)', () => {
    expect(ceQueDeviendraLeRib(V1, avec(V1, { titulaire: 'Autre titulaire fictif' }), 'client'))
      .toBe('Le RIB change : il ne sera que proposé, jusqu’à la confirmation de ton cabinet.')
    expect(ceQueDeviendraLeRib(versionParametres(), avec(versionParametres(), { iban: IBAN_A }), 'client'))
      .toBe('Le RIB est posé : il ne sera que proposé, jusqu’à la confirmation de ton cabinet.')
  })

  it('vidé : retiré tout de suite (A5-Q5), des deux côtés ; sans RIB avant ni après, dit tel', () => {
    const vide = avec(V1, { iban: '', bic: '', titulaire: '' })
    expect(ceQueDeviendraLeRib(V1, vide, 'client')).toBe('Tu vides le RIB : il est retiré dès l’enregistrement, sans attendre ton cabinet.')
    expect(ceQueDeviendraLeRib(V1, vide, 'cabinet')).toBe('Le RIB est vidé : il est retiré dès l’enregistrement.')
    expect(ceQueDeviendraLeRib(null, SAISIE_VIDE, 'cabinet')).toBe('Aucun RIB n’est saisi.')
  })

  it('inchangé : son état gardé — un RIB proposé ne se confirme pas en réenregistrant (A5-Q4)', () => {
    expect(ceQueDeviendraLeRib(V3, avec(V3, { delai: '10' }), 'cabinet'))
      .toBe('Le RIB ne change pas : il reste seulement proposé — enregistrer ne le confirme pas, « Confirmer le RIB » le fait.')
    expect(ceQueDeviendraLeRib(V3, avec(V3, { delai: '10' }), 'client')).toBe('Le RIB ne change pas : il reste en attente de la confirmation de ton cabinet.')
    expect(ceQueDeviendraLeRib(V1, avec(V1, { delai: '10' }), 'client')).toBe('Le RIB ne change pas : il reste confirmé.')
    // Tapé avec ses espaces et en minuscules, l'IBAN part sous sa forme électronique : c'est le même RIB.
    expect(ceQueDeviendraLeRib(V1, avec(V1, { iban: 'fr93 9999 9000 0100 0000 0000 100' }), 'cabinet')).toBe('Le RIB ne change pas : il reste confirmé.')
  })
})

describe('la confirmation d’un RIB', () => {
  it('nomme le RIB (l’IBAN par quatre), qui l’a proposé et quand, ce qu’elle fait, et de le vérifier par un autre moyen', () => {
    const c = confirmationDuRib(CHAINE, 'd1', V3, LUS)
    expect(c?.rib.map((x) => x.valeur)).toEqual(['FR12 9999 9000 0100 0000 0000 200', NON_RENSEIGNE, 'Atelier fictif'])
    expect(c?.propose).toBe('Proposé par le client le 02/10/2027 à 11:00.')
    expect(c?.fait).toContain('le RIB que les factures du dossier porteront, quand elles porteront un RIB')
    expect(c?.conseil).toContain('par un autre moyen que l’application')
    expect(c?.conseil).toBe(CONSEIL_VERIFICATION_RIB)
    expect(confirmationDuRib(CHAINE, 'd1', V3, INCOMPLETS)?.propose).toBe('Proposé le 02/10/2027 à 11:00.')
  })

  it('rien à confirmer : un RIB confirmé, aucun RIB, une chaîne rompue', () => {
    expect(confirmationDuRib([V1], 'd1', V1, LUS)).toBeNull()
    expect(confirmationDuRib([versionParametres()], 'd1', versionParametres(), LUS)).toBeNull()
    expect(confirmationDuRib([V2, V3], 'd1', V3, LUS)).toBeNull()
  })

  it('le refus de `confirmer_rib` dit avant le clic, sous les mots de la base', () => {
    expect(refusDeLaConfirmation('d1', 'v3', CHAINE)).toBeNull()
    expect(refusDeLaConfirmation('d1', 'v2', CHAINE)).toMatchObject({ cle: 'pas_courante' })
    expect(refusDeLaConfirmation('d1', 'absente', CHAINE)).toEqual({ cle: 'introuvable', message: 'Version des paramètres de facturation introuvable dans ce dossier.' })
    expect(refusDeLaConfirmation('d1', 'v3', [V2, V3])).toBe('rompue')
    expect(refusDeLaConfirmation('d1', 'v1', [V1])).toEqual({ cle: 'deja_confirme', message: 'Le RIB de cette version est déjà confirmé.' })
  })
})

describe('les mots', () => {
  // Drapeau baissé (`MENTIONS_FIGEES_EXPORTEES`) : l'état d'avant l'étape A7b, éprouvé tant que son code existe.
  it('drapeau baissé, la phrase d’en-tête : aucune facture ne les lit ni ne les imprime encore — jamais l’inverse', () => {
    for (const espace of ['cabinet', 'client'] as const) {
      expect(phraseDEnTete(espace, false)).toMatch(/ne lit ni n’imprime encore ces paramètres : elles le feront avec une étape à venir/)
    }
  })

  it('drapeau levé, la phrase d’en-tête : la facture les fige à sa validation, le RIB confirmé seulement, et les imprime', () => {
    for (const espace of ['cabinet', 'client'] as const) {
      expect(phraseDEnTete(espace, true)).toMatch(/fige(nt)? ces paramètres à (sa|leur) validation — ceux en vigueur ce jour-là, le RIB confirmé seulement — et les imprim/)
      expect(phraseDEnTete(espace, true)).toMatch(/une facture déjà validée ne change plus/)
      expect(phraseDEnTete(espace)).toBe(phraseDEnTete(espace, MENTIONS_FIGEES_EXPORTEES))
    }
    expect(motsDuCabinet(phraseDEnTete('client', true))).toEqual([])
  })

  it('chez le client, aucun mot du cabinet ; le texte rompu non plus', () => {
    const textes = [
      phraseDEnTete('client'), phraseDesPropositions('client'), TEXTE_ROMPUE,
      etatDuRibDit(CHAINE, 'd1', 'v3', 'client', SANS_OBJET) as string, etatDuRibDit(CHAINE, 'd1', 'v1', 'client', SANS_OBJET) as string,
      ribEnVigueurDit(CHAINE, 'd1', 'client')?.phrase as string,
      ribEnVigueurDit([versionParametres({ iban: IBAN_B, rib_etat: 'propose' })], 'd1', 'client')?.phrase as string,
      ceQueDeviendraLeRib(V1, saisieDeLaVersion(versionParametres({ iban: IBAN_B })), 'client'),
      ceQueDeviendraLeRib(V1, SAISIE_VIDE, 'client'),
      ceQueDeviendraLeRib(V3, saisieDeLaVersion(V3), 'client'),
      ceQueDeviendraLeRib(V1, saisieDeLaVersion(V1), 'client'),
      ceQueDeviendraLeRib(null, SAISIE_VIDE, 'client'),
    ]
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })
})
