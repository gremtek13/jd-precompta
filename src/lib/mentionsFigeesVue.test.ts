import { describe, expect, it } from 'vitest'
import {
  AUCUN_RIB_CONFIRME, AVIS_SANS_FORME, FACTURE_D_AVANT, INDEMNITE_DE_RECOUVREMENT, PROVENANCE_VIDE, RETENUE_CHAINE_ROMPUE,
  RETENUE_EN_LECTURE, avisSansDenomination, ceQueLaFactureImprime, ceQueLaValidationFigera, confirmationDesMentions, formeEtCapital,
  jugementDesMentions, logoNonImprime, parametresEnVigueur, provenanceDeLArticle, provenanceDeLaLigneLue, provenanceQuiPart, retenueIllisible,
  uniteImprimee, type LectureDeLaValidation, type SaisieAJuger,
} from './mentionsFigeesVue'
import { REFUS_DE_LA_PROVENANCE, REFUS_DE_LA_VALIDATION_FIGEE, mentionsAFiger } from './mentionsFigees'
import { MODELE_IBAN_DANS_UN_TEXTE } from './parametresFacturation'
import { motsDuCabinet } from './espaceVentes'
import { formatMoney } from './format'
import { article } from '../test/articles'
import { versionParametres } from '../test/parametresFacturation'
import { AUTRE_IBAN_ESSAI, BIC_ESSAI, IBAN_ESSAI, factureFigee, identiteDuDossier } from '../test/mentionsFigees'
import { SIRET_VENDEUR, TVA_VENDEUR } from '../test/facturesCii'

// LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN (étape A7b) : le module pur que le formulaire, la fenêtre d'un avoir et l'aperçu
// lisent. Ce qu'il garde : la provenance d'une ligne telle qu'elle part ; les refus neufs dans l'ordre de la base, sous ses
// mots (ceux de lib/mentionsFigees.ts, jamais recopiés) ; ce qui retient la validation tant qu'une lecture n'est pas revenue
// entière ; ce que la confirmation NOMME ; ce que l'aperçu d'une facture figée imprime, de SES colonnes seules.

const modele = (liste: readonly { cle: string; modele: string }[], cle: string) => liste.find((r) => r.cle === cle)!.modele

const LU: LectureDeLaValidation = {
  etat: 'lu',
  identite: identiteDuDossier(),
  versions: [versionParametres({ iban: IBAN_ESSAI, bic: BIC_ESSAI, titulaire_compte: 'CAMILLE ESSAI', rib_etat: 'confirme' })],
}

function saisie(o: Partial<SaisieAJuger> = {}): SaisieAJuger {
  return {
    espace: 'client', dossierId: 'd1',
    facture: { type: 'facture', emetteur_nom: 'Nom interne', emetteur_siret: SIRET_VENDEUR, emetteur_adresse: '1 rue des Essais\n69000 Lyon', contact_id: null },
    lignes: [{ designation: 'Séance', quantite: 1, prix_unitaire_ht: 60, taux_tva: 20, unite: 'HUR', reference: null, nature: 'services', article_id: null }],
    brouillon: null, origine: null, listes: { contacts: [], articles: [] }, lecture: LU,
    ...o,
  }
}

describe('la provenance d’une ligne', () => {
  it('un article apporte son unité, sa référence et sa nature ; une ligne lue les rend ; une ligne d’avant, rien', () => {
    expect(provenanceDeLArticle(article({ unite: 'DAY', reference: 'REF-1', nature: 'biens' }))).toEqual({ unite: 'DAY', reference: 'REF-1', nature: 'biens' })
    expect(provenanceDeLArticle(article({ reference: null }))).toEqual({ unite: 'HUR', reference: '', nature: 'services' })
    expect(provenanceDeLaLigneLue({ unite: 'LS', reference: 'R', nature: 'services' })).toEqual({ unite: 'LS', reference: 'R', nature: 'services' })
    expect(provenanceDeLaLigneLue({})).toEqual(PROVENANCE_VIDE)
  })

  it('part telle que la base la reçoit : un champ vide nul, la référence sans les blancs de ses bords, l’article tel quel', () => {
    expect(provenanceQuiPart({ unite: '', reference: '  ', nature: '' }, null)).toEqual({ unite: null, reference: null, nature: null, article_id: null })
    expect(provenanceQuiPart({ unite: 'HUR', reference: ' REF-1\n', nature: 'services' }, 'a1'))
      .toEqual({ unite: 'HUR', reference: 'REF-1', nature: 'services', article_id: 'a1' })
    // Une espace insécable n'est pas un blanc que la base retire : elle part, et la base la refuse sous ses mots.
    expect(provenanceQuiPart({ unite: '', reference: '\u00a0R', nature: '' }, null).reference).toBe('\u00a0R')
  })
})

describe('le jugement de la saisie, dans l’ordre de la base', () => {
  it('une saisie juste : aucun refus, rien ne retient, ce que la validation figera — celui de `mentionsAFiger`', () => {
    const j = jugementDesMentions(saisie())
    expect(j).toMatchObject({ refusDeLEnregistrement: null, retenue: null, refusDeLaValidation: null, avis: [] })
    expect(j.mentions).toEqual(mentionsAFiger({
      dossierId: 'd1', emetteurSiret: SIRET_VENDEUR, origine: null, dossier: LU.etat === 'lu' ? LU.identite : identiteDuDossier(),
      versions: LU.etat === 'lu' ? LU.versions : [], mandataire: null,
    }))
    expect(j.mentions?.iban_imprime).toBe(IBAN_ESSAI)
    expect(j.mentions?.numero_tva_imprime).toBe(TVA_VENDEUR)
  })

  it('la provenance d’abord, sous les mots de la base : l’unité, la référence, la nature, ligne par ligne', () => {
    const lignes = [
      { designation: 'A', quantite: 1, prix_unitaire_ht: 1, taux_tva: 20, unite: 'XYZ', reference: null, nature: null, article_id: null },
    ]
    expect(jugementDesMentions(saisie({ lignes })).refusDeLEnregistrement).toBe(modele(REFUS_DE_LA_PROVENANCE, 'unite').replace('%', '1'))
    // Le refus de l'enregistrement passe AVANT ce que la validation lit : il se dit même sans lecture.
    expect(jugementDesMentions(saisie({ lignes, lecture: null }))).toMatchObject({ retenue: null, mentions: null })
  })

  it('la provenance AVANT un IBAN dans un texte : une ligne qui porte les deux dit la provenance', () => {
    const lignes = [{ ...saisie().lignes[0], unite: 'XYZ', designation: `Virer au ${IBAN_ESSAI}` }]
    expect(jugementDesMentions(saisie({ lignes })).refusDeLEnregistrement).toBe(modele(REFUS_DE_LA_PROVENANCE, 'unite').replace('%', '1'))
  })

  it('un contact ou un article qui n’est pas du dossier : refusé ; une liste qui n’est pas lue entière : rien ne s’enregistre', () => {
    expect(jugementDesMentions(saisie({ facture: { ...saisie().facture, contact_id: 'inconnu' } })).refusDeLEnregistrement)
      .toBe(modele(REFUS_DE_LA_PROVENANCE, 'contact'))
    const avecArticle = [{ ...saisie().lignes[0], article_id: 'a9' }]
    expect(jugementDesMentions(saisie({ lignes: avecArticle })).refusDeLEnregistrement)
      .toBe(modele(REFUS_DE_LA_PROVENANCE, 'article').replace('%', '1'))
    expect(jugementDesMentions(saisie({ lignes: avecArticle, listes: { contacts: [], articles: [{ id: 'a9' }] } })).refusDeLEnregistrement).toBeNull()
    const nonLue = jugementDesMentions(saisie({ lignes: avecArticle, listes: { contacts: [], articles: null } }))
    expect(nonLue.refusDeLEnregistrement).toMatch(/ne se juge que sur la liste entière/)
    expect(nonLue.retenue).toBe(nonLue.refusDeLEnregistrement)
    // Une saisie qui ne nomme ni contact ni article ne demande aucune liste.
    expect(jugementDesMentions(saisie({ listes: { contacts: null, articles: null } })).refusDeLEnregistrement).toBeNull()
  })

  it('puis un IBAN dans un texte que la facture imprime — la désignation d’une ligne —, brouillon compris', () => {
    const lignes = [{ ...saisie().lignes[0], designation: `Virer au ${IBAN_ESSAI}` }]
    expect(jugementDesMentions(saisie({ lignes })).refusDeLEnregistrement).toBe(MODELE_IBAN_DANS_UN_TEXTE.replace('%', 'la désignation de la ligne 1'))
    expect(jugementDesMentions(saisie({ facture: { ...saisie().facture, mentions_legales: `IBAN ${IBAN_ESSAI}` } })).refusDeLEnregistrement)
      .toBe(MODELE_IBAN_DANS_UN_TEXTE.replace('%', 'la mention légale'))
  })

  it('la validation ATTEND sa lecture ; illisible ou rompue, elle n’est pas offerte, et le dit', () => {
    expect(jugementDesMentions(saisie({ lecture: null }))).toMatchObject({ retenue: RETENUE_EN_LECTURE, mentions: null, refusDeLaValidation: null })
    expect(jugementDesMentions(saisie({ lecture: { etat: 'illisible', motif: 'réseau coupé' } })).retenue).toBe(retenueIllisible('réseau coupé'))
    const rompue: LectureDeLaValidation = { etat: 'lu', identite: identiteDuDossier(), versions: [versionParametres({ id: 'v2', remplace_id: 'v1' })] }
    expect(jugementDesMentions(saisie({ lecture: rompue })).retenue).toBe(RETENUE_CHAINE_ROMPUE)
  })

  it('les refus de la validation, dans leur ordre : la forme, l’entrepreneur individuel, la dénomination, le SIRET et l’adresse du dossier, un IBAN', () => {
    const avec = (identite: Partial<ReturnType<typeof identiteDuDossier>>, o: Partial<SaisieAJuger> = {}) =>
      jugementDesMentions(saisie({ lecture: { etat: 'lu', identite: identiteDuDossier(identite), versions: [] }, ...o })).refusDeLaValidation
    const m = (cle: string) => modele(REFUS_DE_LA_VALIDATION_FIGEE, cle)
    expect(avec({ forme_juridique: null, denomination_imprimee: null })).toBe(m('forme_a_regler'))
    expect(avec({ denomination_imprimee: 'Camille Essai' })).toBe(m('entrepreneur_individuel'))
    expect(avec({ forme_juridique: '5710', denomination_imprimee: '  ' })).toBe(m('denomination_a_poser'))
    expect(avec({ siret: null })).toBe(m('siret_a_poser'))
    expect(avec({ siret: '99999999999999' })).toBe(m('siret_du_dossier'))
    expect(avec({ adresse: '' })).toBe(m('adresse_a_poser'))
    expect(avec({ adresse: '2 rue ailleurs' })).toBe(m('adresse_du_dossier'))
    expect(avec({ rcs_ville: `Lyon ${IBAN_ESSAI}` })).toBe(MODELE_IBAN_DANS_UN_TEXTE.replace('%', 'la ville du greffe du dossier'))
    // Le cabinet n'est jugé ni sur la forme, ni sur la dénomination, ni sur l'émetteur : on le lui DIT.
    const cabinet = jugementDesMentions(saisie({ espace: 'cabinet', lecture: { etat: 'lu', identite: identiteDuDossier({ forme_juridique: null, denomination_imprimee: null, adresse: 'ailleurs' }), versions: [] } }))
    expect(cabinet.refusDeLaValidation).toBeNull()
    expect(cabinet.avis).toEqual([AVIS_SANS_FORME, avisSansDenomination('Nom interne')])
    // Mais l'entrepreneur individuel sans « EI », si : la loi.
    expect(jugementDesMentions(saisie({ espace: 'cabinet', lecture: { etat: 'lu', identite: identiteDuDossier({ denomination_imprimee: 'Camille' }), versions: [] } })).refusDeLaValidation)
      .toBe(m('entrepreneur_individuel'))
  })

  it('un IBAN dans les paramètres EN VIGUEUR retient la validation de tout auteur', () => {
    const lecture: LectureDeLaValidation = { etat: 'lu', identite: identiteDuDossier(), versions: [versionParametres({ pied_de_page: `RIB ${AUTRE_IBAN_ESSAI}` })] }
    for (const espace of ['cabinet', 'client'] as const) {
      expect(jugementDesMentions(saisie({ espace, lecture })).refusDeLaValidation)
        .toBe(MODELE_IBAN_DANS_UN_TEXTE.replace('%', 'le pied de page des paramètres de facturation'))
    }
  })

  it('le contact que la facture garde : une liste qui n’est pas lue entière retient la validation', () => {
    const contact = { ...saisie().facture, contact_id: 'c1' }
    expect(jugementDesMentions(saisie({ facture: contact, listes: { contacts: [{ id: 'c1' }], articles: [] } })).refusDeLaValidation).toBeNull()
  })

  it('un avoir : il reprend l’identité de sa facture figée, et n’est jugé ni sur l’émetteur ni sur sa forme ; son contact, celui de sa facture', () => {
    const origine = factureFigee({ contact_id: 'c1', forme_juridique: null, denomination_imprimee: 'Ancienne Dénomination EI' })
    const avoir = saisie({ origine, facture: { type: 'avoir', mentions_legales: null }, lecture: { etat: 'lu', identite: identiteDuDossier({ siret: null, adresse: null }), versions: [] } })
    // Le contact de sa facture, que la liste lue retrouve.
    expect(jugementDesMentions({ ...avoir, listes: { contacts: [{ id: 'c1' }], articles: [] } })).toMatchObject({ refusDeLaValidation: null })
    expect(jugementDesMentions({ ...avoir, listes: { contacts: [{ id: 'c1' }], articles: [] } }).mentions?.denomination_imprimee).toBe('Ancienne Dénomination EI')
    expect(jugementDesMentions({ ...avoir, listes: { contacts: [], articles: [] } }).refusDeLaValidation).toBe(modele(REFUS_DE_LA_VALIDATION_FIGEE, 'contact_garde'))
    expect(jugementDesMentions({ ...avoir, listes: { contacts: null, articles: [] } }).retenue).toMatch(/ne se juge que sur la liste entière/)
  })

  it('chez le client, aucun mot du cabinet dans ce qui retient', () => {
    for (const t of [RETENUE_EN_LECTURE, retenueIllisible('motif'), RETENUE_CHAINE_ROMPUE]) expect(motsDuCabinet(t), t).toEqual([])
  })
})

describe('le dossier a-t-il des paramètres de facturation en vigueur ? (A7B-Q2 : la mention proposée n’en garde alors que la TVA)', () => {
  it('oui d’une lecture revenue entière qui porte une version du dossier ; non tant qu’on ne le sait pas', () => {
    expect(parametresEnVigueur(LU, 'd1')).toBe(true)
    expect(parametresEnVigueur({ etat: 'lu', identite: identiteDuDossier(), versions: [] }, 'd1')).toBe(false)
    // Les versions d'un autre dossier ne disent rien de celui-ci.
    expect(parametresEnVigueur(LU, 'd2')).toBe(false)
    // Pas revenue, illisible : on ne sait pas — la phrase d'hier se propose.
    expect(parametresEnVigueur(null, 'd1')).toBe(false)
    expect(parametresEnVigueur({ etat: 'illisible', motif: 'refusée' }, 'd1')).toBe(false)
    // Deux premières versions : la suite est rompue, on ne sait pas laquelle vaut.
    const rompue: LectureDeLaValidation = { etat: 'lu', identite: identiteDuDossier(), versions: [versionParametres({ id: 'v1' }), versionParametres({ id: 'v2' })] }
    expect(parametresEnVigueur(rompue, 'd1')).toBe(false)
    const suite: LectureDeLaValidation = { etat: 'lu', identite: identiteDuDossier(), versions: [versionParametres({ id: 'v1' }), versionParametres({ id: 'v2', remplace_id: 'v1' })] }
    expect(parametresEnVigueur(suite, 'd1')).toBe(true)
  })
})

describe('la confirmation nomme ce que la facture figera et imprimera', () => {
  const m = (j = jugementDesMentions(saisie())) => j.mentions!

  it('le nom avec « EI », le numéro de TVA, les conditions, le RIB confirmé, le logo', () => {
    const phrases = ceQueLaValidationFigera(m(), 'Nom interne')
    expect(phrases).toEqual([
      'le nom « Camille Essai EI »',
      `le numéro de TVA ${TVA_VENDEUR}`,
      'les conditions de paiement (moyen préféré : virement)',
      `le RIB FR76 9999 9000 0100 0000 0000 600, BIC ${BIC_ESSAI}, au nom de CAMILLE ESSAI`,
      'aucun logo',
    ])
    expect(confirmationDesMentions(m(), null, false)).toBe(`Validée, la facture figera et imprimera :\n${phrases.map((p) => `– ${p}`).join('\n')}`)
    expect(confirmationDesMentions(m(), null, true)).toMatch(/^Validé, l’avoir figera et imprimera :/)
  })

  it('un RIB seulement proposé ne se fige pas : « aucun RIB confirmé : la facture n’en imprimera pas »', () => {
    const lecture: LectureDeLaValidation = { etat: 'lu', identite: identiteDuDossier(), versions: [versionParametres({ iban: IBAN_ESSAI, rib_etat: 'propose' })] }
    expect(ceQueLaValidationFigera(m(jugementDesMentions(saisie({ lecture }))), null)).toContain(AUCUN_RIB_CONFIRME)
  })

  it('sans paramètres : ni conditions, ni RIB, ni logo ; sans dénomination, le nom que la facture porte', () => {
    const lecture: LectureDeLaValidation = { etat: 'lu', identite: identiteDuDossier({ forme_juridique: null, denomination_imprimee: null }), versions: [] }
    const phrases = ceQueLaValidationFigera(m(jugementDesMentions(saisie({ espace: 'cabinet', lecture }))), 'Nom interne')
    expect(phrases).toEqual([
      'aucune dénomination : le nom « Nom interne » que la facture porte', `le numéro de TVA ${TVA_VENDEUR}`,
      'aucun paramètre de facturation : ni conditions de paiement, ni RIB, ni logo',
    ])
  })

  it('l’escompte, les pénalités, les mentions complémentaires, le pied de page et le logo des paramètres, nommés', () => {
    const lecture: LectureDeLaValidation = {
      etat: 'lu', identite: identiteDuDossier({ forme_juridique: '5710', denomination_imprimee: 'Essai SAS', capital: 1000, rcs_ville: 'Lyon' }),
      versions: [versionParametres({ escompte: 'Pas d’escompte.', penalites: 'BCE + 10 points.', mentions_complementaires: 'X', pied_de_page: 'Y', logo_chemin: 'd1/logos/a.png', logo_sha256: 'a'.repeat(64) })],
    }
    const phrases = ceQueLaValidationFigera(m(jugementDesMentions(saisie({ lecture }))), null)
    expect(phrases).toContain(`l’identité : SAS, société par actions simplifiée au capital de ${formatMoney(1000)} ; RCS Lyon`)
    expect(phrases).toContain('les conditions de paiement (moyen préféré : virement ; escompte : « Pas d’escompte. » ; pénalités : « BCE + 10 points. »)')
    expect(phrases.slice(-3)).toEqual(['les mentions complémentaires des paramètres', 'le pied de page des paramètres', 'le logo des paramètres'])
  })
})

describe('ce que l’aperçu d’une facture figée imprime, de ses seules colonnes', () => {
  it('une facture d’avant : rien — elle s’imprime comme hier', () => {
    expect(ceQueLaFactureImprime(factureFigee({ mentions_figees: false }))).toBeNull()
    expect(ceQueLaFactureImprime(factureFigee({ mentions_figees: undefined }))).toBeNull()
    expect(FACTURE_D_AVANT).toMatch(/validée avant que les factures figent leurs mentions/)
  })

  it('le nom figé, l’identité, le numéro de TVA écrit par la base, les conditions d’un professionnel, le RIB, le reste', () => {
    const f = factureFigee({ forme_juridique: '5710', capital: 1000, rcs_ville: 'Lyon', mentions_identite: 'En liquidation', denomination_imprimee: 'Essai SAS' })
    const i = ceQueLaFactureImprime(f)!
    expect(i.nom).toBe('Essai SAS')
    expect(i.identite).toEqual([`SAS, société par actions simplifiée au capital de ${formatMoney(1000)}`, 'RCS Lyon 123 456 782', 'En liquidation'])
    expect(i.numeroTva).toBe(TVA_VENDEUR)
    expect(i.conditions).toEqual([
      'Moyen de paiement préféré : virement.', 'Pas d’escompte pour paiement anticipé.',
      'Pénalités de retard : trois fois le taux d’intérêt légal.', INDEMNITE_DE_RECOUVREMENT,
    ])
    expect(i.rib).toEqual({ iban: 'FR76 9999 9000 0100 0000 0000 600', bic: BIC_ESSAI, titulaire: 'CAMILLE ESSAI' })
    expect(i.complementaires).toBe('Membre d’une association agréée.')
    expect(i.piedDePage).toBe('Camille Essai EI — merci de votre confiance')
    expect(i.logo).toBeNull()
  })

  it('le numéro de TVA est celui que la facture porte, jamais recalculé ; sans dénomination, le nom qu’elle porte', () => {
    expect(ceQueLaFactureImprime(factureFigee({ numero_tva_imprime: null }))!.numeroTva).toBeNull()
    expect(ceQueLaFactureImprime(factureFigee({ denomination_imprimee: null }))!.nom).toBe('Nom interne du dossier')
  })

  it('à un particulier, ni escompte, ni pénalités, ni indemnité ; le moyen préféré, si', () => {
    expect(ceQueLaFactureImprime(factureFigee({ type_client: 'non_assujetti' }))!.conditions).toEqual(['Moyen de paiement préféré : virement.'])
    expect(ceQueLaFactureImprime(factureFigee({ type_client: null, moyen_prefere: null }))!.conditions).toEqual([])
  })

  it('le numéro d’engagement pour tout acheteur ; le code service, à l’organisme public seul', () => {
    const mentions = ceQueLaFactureImprime(factureFigee({ type_client: 'assujetti', numero_engagement: 'BC-42' }))!.mentions
    expect(mentions).toContainEqual({ libelle: 'Numéro d’engagement', texte: 'BC-42' })
    const publique = ceQueLaFactureImprime(factureFigee({ type_client: 'organisme_public', numero_engagement: 'EJ-1', code_service: 'S' }))!.mentions
    expect(publique.filter((x) => x.libelle === 'Numéro d’engagement')).toHaveLength(1)
  })

  it('un entrepreneur individuel : rien sous son nom, qui porte déjà « EI » (A7B-Q1) ; le RCS et les autres mentions figés, si la facture en a', () => {
    expect(ceQueLaFactureImprime(factureFigee({ forme_juridique: '1000', capital: null, rcs_ville: null, mentions_identite: null }))!.identite).toEqual([])
    expect(ceQueLaFactureImprime(factureFigee({ forme_juridique: '1000', capital: null, rcs_ville: 'Lyon', mentions_identite: 'Membre d’une AGA' }))!.identite)
      .toEqual(['RCS Lyon 123 456 782', 'Membre d’une AGA'])
  })

  it('le logo : son chemin et son empreinte figés, ou rien', () => {
    expect(ceQueLaFactureImprime(factureFigee({ logo_chemin: 'd1/logos/x.png', logo_sha256: 'b'.repeat(64) }))!.logo).toEqual({ chemin: 'd1/logos/x.png', empreinte: 'b'.repeat(64) })
  })

  it('la forme et le capital ; l’unité d’une ligne sous son libellé', () => {
    expect(formeEtCapital(null, null)).toBeNull()
    // A7B-Q1 : le libellé de l'INSEE pour une société ; rien sous le nom d'un entrepreneur individuel, qui porte déjà « EI ».
    expect(formeEtCapital('5710', 1000)).toBe(`SAS, société par actions simplifiée au capital de ${formatMoney(1000)}`)
    expect(formeEtCapital('5499', null)).toBe('Société à responsabilité limitée (sans autre indication)')
    expect(formeEtCapital('1000', null)).toBeNull()
    expect(formeEtCapital('1000', 500)).toBeNull()
    expect(formeEtCapital(null, 500)).toMatch(/^Société au capital de 500,00/)
    expect(uniteImprimee({ unite: 'HUR' })).toBe('heure')
    expect(uniteImprimee({ unite: null })).toBe('')
  })

  it('un logo qui ne rend pas son empreinte ne s’imprime pas, et l’écran dit pourquoi', () => {
    expect(logoNonImprime({ etat: 'verifie', corps: new Blob(), type: 'image/png', taille: 1 })).toBeNull()
    expect(logoNonImprime({ etat: 'autre_empreinte' })).toMatch(/son empreinte diffère/)
    expect(logoNonImprime({ etat: 'absent' })).toMatch(/n’est pas \(ou plus\) rendu/)
    expect(logoNonImprime({ etat: 'refuse', motif: 'm' })).toMatch(/\(m\)/)
    expect(logoNonImprime({ etat: 'illisible' })).toMatch(/PNG ou JPEG/)
  })
})
