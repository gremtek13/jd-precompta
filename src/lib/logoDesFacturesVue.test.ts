import { describe, expect, it } from 'vitest'
import { TAILLE_MAX } from './bornesStockage'
import { motsDuCabinet } from './espaceVentes'
import { cheminDuLogo, type LogoLu } from './logoDesFactures'
import {
  PHRASE_AUCUN_LOGO, PHRASE_LOGO_EN_LECTURE, PHRASE_LOGO_IDENTIQUE, PHRASE_LOGO_NON_LU, TITRE_DU_LOGO, confirmationDuRetraitDuLogo,
  ditLeLogoNonMontre, estLeLogoCourant, gesteDuLogo, legendeDuChoix, legendeDuLogo, libelleDuTypeDuLogo, messageDuLogoPose,
  messageDuLogoRetire, messageFichierDeposeSansVersion, parametresAvecLogo, parametresSansLogo, phraseDuLogo, phraseSansVersion,
  refusDuFichierChoisi, refusDuNouveauLogo, refusDuRetraitDuLogo,
} from './logoDesFacturesVue'
import { rienNeChange, champsChanges, saisieDeLaVersion } from './parametresFacturationVue'
import type { ParametresFacturation } from './types'
import { versionParametres } from '../test/parametresFacturation'

// LE LOGO DES FACTURES, À L'ÉCRAN — le module pur (étape A5c2a) : chaque phrase, ce qui part, et le refus que la base opposerait,
// dit avant le clic. IBAN FICTIF (le code banque 99999, à clé juste) ; aucune donnée réelle.

const D = 'a5c00000-0000-4000-8000-0000000000d1'
const H1 = '1'.repeat(64)
const H2 = '2'.repeat(64)
const IBAN = 'FR9399999000010000000000100'
// Un poids se dit avec une espace insécable avant l'unité (`poids`) : on compare ce qui se lit.
const lisible = (t: string | null) => (t ?? '').replace(/[\u00a0\u202f]/g, ' ')

// Une version qui renseigne TOUS les champs, un RIB proposé compris : ce que le logo ne doit jamais toucher.
const PLEINE = versionParametres({
  id: 'v2', dossier_id: D, remplace_id: 'v1', delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Pas d’escompte.',
  penalites: 'Trois fois le taux d’intérêt légal.', mentions_complementaires: 'Mention un.\nMention deux.', pied_de_page: 'Pied de page.',
  iban: IBAN, bic: 'ESSAFR10', titulaire_compte: 'Atelier fictif', rib_etat: 'propose', logo_chemin: null, logo_sha256: null,
  cree_le: '2027-10-02T09:00:00Z',
})
const V1 = versionParametres({ id: 'v1', dossier_id: D, logo_chemin: null, logo_sha256: null, cree_le: '2027-10-01T09:00:00Z' })
const AVEC_LOGO = { ...PLEINE, id: 'v3', remplace_id: 'v2', logo_chemin: cheminDuLogo(D, H1, 'image/png'), logo_sha256: H1 }

function pret(empreinte: string, o: Partial<{ type: 'image/png' | 'image/jpeg'; taille: number }> = {}) {
  const type = o.type ?? 'image/png'
  return { chemin: cheminDuLogo(D, empreinte, type), empreinte, type, taille: o.taille ?? 1234 }
}

// Ce que la base écrit d'une version neuve à partir de ce qui part : les champs envoyés, le RIB gardé (état compris) s'il ne change pas.
function ecrite(remplacee: ParametresFacturation, parametres: object, id: string): ParametresFacturation {
  const envoye = parametres as Record<string, unknown>
  return {
    ...remplacee, id, remplace_id: remplacee.id,
    delai_paiement_jours: (envoye.delai_paiement_jours ?? null) as number | null, moyen_prefere: (envoye.moyen_prefere ?? null) as ParametresFacturation['moyen_prefere'],
    escompte: (envoye.escompte ?? null) as string | null, penalites: (envoye.penalites ?? null) as string | null,
    mentions_complementaires: (envoye.mentions_complementaires ?? null) as string | null, pied_de_page: (envoye.pied_de_page ?? null) as string | null,
    iban: (envoye.iban ?? null) as string | null, bic: (envoye.bic ?? null) as string | null, titulaire_compte: (envoye.titulaire_compte ?? null) as string | null,
    logo_chemin: (envoye.logo_chemin ?? null) as string | null, logo_sha256: (envoye.logo_sha256 ?? null) as string | null,
  }
}

describe('les phrases du bloc, et ce que chaque espace lit', () => {
  it('le cabinet : qui voit et change le logo, et que rien ne l’imprime encore', () => {
    expect(phraseDuLogo('cabinet')).toBe(
      'Le client qui porte la case « Ventes » voit ce logo et peut le changer, comme vous. Les factures ne l’impriment pas encore : '
      + 'elles le feront avec une étape à venir.',
    )
  })

  it('le client : son cabinet le voit et peut le changer, en tutoiement', () => {
    expect(phraseDuLogo('client')).toBe(
      'Ton cabinet voit ce logo et peut le changer, comme toi. Tes factures ne l’impriment pas encore : elles le feront avec une '
      + 'étape à venir.',
    )
  })

  it('sans version : le logo est un champ d’une version, renseigner d’abord les paramètres', () => {
    expect(phraseSansVersion('cabinet')).toBe('Le logo est un champ d’une version des paramètres de facturation : renseignez d’abord les paramètres, puis posez le logo.')
    expect(phraseSansVersion('client')).toBe('Le logo est un champ de tes paramètres de facturation : renseigne d’abord les paramètres, puis pose ton logo.')
  })

  it('aucune phrase montrée au client ne porte un mot du cabinet', () => {
    const phrases = [
      TITRE_DU_LOGO, phraseDuLogo('client'), phraseSansVersion('client'), PHRASE_LOGO_NON_LU, PHRASE_AUCUN_LOGO, PHRASE_LOGO_EN_LECTURE,
      PHRASE_LOGO_IDENTIQUE, legendeDuChoix({ type: 'image/png', taille: 1234 }, 'Poser ce logo'), refusDuFichierChoisi({ raison: 'format', taille: 1, message: 'format non pris en charge' }),
      messageDuLogoPose('pose', '2027-11-20T10:00:00Z', false), messageDuLogoPose('change', '2027-11-20T10:00:00Z', true),
      messageDuLogoRetire('2027-11-20T10:00:00Z'), messageFichierDeposeSansVersion('client', 'Le délai doit être un nombre.'),
      ...confirmationDuRetraitDuLogo().paragraphes, confirmationDuRetraitDuLogo().titre,
      ...(['absent', 'refuse', 'illisible', 'autre_empreinte'] as const).map((etat) => ditLeLogoNonMontre(etat === 'refuse' ? { etat, motif: 'permission refusée' } : { etat })),
    ]
    for (const p of phrases) expect(motsDuCabinet(p ?? ''), p ?? '').toEqual([])
  })

  it('le garde des mots mord sur la phrase du cabinet (le garde n’est pas aveugle)', () => {
    expect(motsDuCabinet(phraseDuLogo('cabinet')).length).toBeGreaterThan(0)
    expect(motsDuCabinet(phraseSansVersion('cabinet')).length).toBeGreaterThan(0)
    expect(motsDuCabinet(messageFichierDeposeSansVersion('cabinet', 'Refus.')).length).toBeGreaterThan(0)
  })
})

describe('pourquoi un fichier n’est pas montré', () => {
  const etats: [LogoLu, RegExp][] = [
    [{ etat: 'absent' }, /n’est pas \(ou plus\) rendu par le stockage du dossier : il n’est pas montré\./],
    [{ etat: 'refuse', motif: 'permission refusée' }, /^Le stockage n’a pas rendu le fichier du logo \(permission refusée\) : il n’est pas montré\.$/],
    [{ etat: 'illisible' }, /n’a pas pu être lu comme une image PNG ou JPEG : il n’est pas montré\./],
    [{ etat: 'autre_empreinte' }, /^Le fichier rendu n’est pas celui que la version désigne \(son empreinte diffère\) : il n’est pas montré\.$/],
  ]
  it.each(etats)('%j : une ligne', (lu, motif) => {
    expect(ditLeLogoNonMontre(lu)).toMatch(motif)
  })

  it('un fichier vérifié est montré : rien à en dire', () => {
    expect(ditLeLogoNonMontre({ etat: 'verifie', corps: new Blob(), type: 'image/png', taille: 10 })).toBeNull()
  })

  it('la légende dit le type, le poids et que l’empreinte est vérifiée', () => {
    expect(lisible(legendeDuLogo({ etat: 'verifie', corps: new Blob(), type: 'image/png', taille: 12_595 }))).toBe('PNG · 12,3 Ko · empreinte vérifiée')
    expect(lisible(legendeDuLogo({ etat: 'verifie', corps: new Blob(), type: 'image/jpeg', taille: 600 }))).toBe('JPEG · 600 octets · empreinte vérifiée')
    expect(libelleDuTypeDuLogo('image/jpeg')).toBe('JPEG')
  })
})

describe('le fichier choisi', () => {
  it('le refus du seau se dit comme celui du logo d’un cabinet', () => {
    expect(refusDuFichierChoisi({ raison: 'taille', taille: 600_000, message: 'il pèse 585,9 Ko, au-delà des 500 Ko qu’un logo de facture peut peser' }))
      .toBe('Ce logo n’est pas pris : il pèse 585,9 Ko, au-delà des 500 Ko qu’un logo de facture peut peser.')
  })

  it('la légende du choix dit que rien n’est enregistré avant le geste', () => {
    expect(lisible(legendeDuChoix({ type: 'image/jpeg', taille: 2048 }, 'Changer le logo'))).toBe('Logo choisi : JPEG · 2 Ko. Rien n’est enregistré avant « Changer le logo ».')
  })

  it('le logo en cours se reconnaît à son chemin ET à son empreinte', () => {
    expect(estLeLogoCourant(AVEC_LOGO, pret(H1))).toBe(true)
    expect(estLeLogoCourant(AVEC_LOGO, pret(H2))).toBe(false)
    // Même empreinte, autre type : un autre chemin, un autre fichier.
    expect(estLeLogoCourant(AVEC_LOGO, pret(H1, { type: 'image/jpeg' }))).toBe(false)
    expect(estLeLogoCourant(PLEINE, pret(H1))).toBe(false)
    // Une version dont le logo n'a pas été lu n'est jamais « le même ».
    expect(estLeLogoCourant({ logo_chemin: undefined, logo_sha256: undefined } as unknown as ParametresFacturation, pret(H1))).toBe(false)
  })

  it('le geste : poser sans logo, changer avec', () => {
    expect(gesteDuLogo(PLEINE)).toBe('Poser ce logo')
    expect(gesteDuLogo(AVEC_LOGO)).toBe('Changer le logo')
    expect(gesteDuLogo({ logo_chemin: undefined, logo_sha256: undefined } as unknown as ParametresFacturation)).toBe('Poser ce logo')
  })
})

describe('ce qui part : une version qui ne change QUE le logo', () => {
  it('poser un logo : tous les autres champs tels que la courante les porte, le RIB proposé reste proposé', () => {
    const envoye = parametresAvecLogo(PLEINE, { logo_chemin: pret(H1).chemin, logo_sha256: H1 })
    expect(envoye).toEqual({
      delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Pas d’escompte.', penalites: 'Trois fois le taux d’intérêt légal.',
      mentions_complementaires: 'Mention un.\nMention deux.', pied_de_page: 'Pied de page.', iban: IBAN, bic: 'ESSAFR10',
      titulaire_compte: 'Atelier fictif', logo_chemin: pret(H1).chemin, logo_sha256: H1,
    })
    const neuve = ecrite(PLEINE, envoye, 'v3')
    expect(champsChanges(neuve, PLEINE)).toEqual(['Logo posé'])
    // Le RIB (IBAN, BIC, titulaire) est le même, donc l'état proposé que la base reprend l'est aussi : aucun « RIB changé ».
    expect([neuve.iban, neuve.bic, neuve.titulaire_compte]).toEqual([PLEINE.iban, PLEINE.bic, PLEINE.titulaire_compte])
  })

  it('changer le logo : seul le logo diffère', () => {
    const neuve = ecrite(AVEC_LOGO, parametresAvecLogo(AVEC_LOGO, { logo_chemin: pret(H2).chemin, logo_sha256: H2 }), 'v4')
    expect(champsChanges(neuve, AVEC_LOGO)).toEqual(['Logo changé'])
  })

  it('retirer le logo : aucune clé de logo (« aucun logo »), les autres champs gardés', () => {
    const envoye = parametresSansLogo(AVEC_LOGO)
    expect(Object.keys(envoye)).not.toContain('logo_chemin')
    expect(Object.keys(envoye)).not.toContain('logo_sha256')
    expect(champsChanges(ecrite(AVEC_LOGO, envoye, 'v4'), AVEC_LOGO)).toEqual(['Logo retiré'])
  })

  it('la saisie d’une version se relit à l’identique : un enregistrement sans logo ne change rien d’autre', () => {
    expect(rienNeChange(PLEINE, saisieDeLaVersion(PLEINE))).toBe(true)
    expect(rienNeChange(AVEC_LOGO, saisieDeLaVersion(AVEC_LOGO))).toBe(true)
  })
})

describe('le refus que la base opposerait, dit avant le clic', () => {
  const versions = [V1, PLEINE]

  it('un logo posé sur une version qui se réenregistre : aucun refus, le fichier compté comme il sera dans le seau', () => {
    expect(refusDuNouveauLogo(D, PLEINE, versions, pret(H1))).toBeNull()
  })

  it('le fichier déposé est bien compté : un poids au-delà de la borne, un type qui n’est pas celui du nom', () => {
    expect(refusDuNouveauLogo(D, PLEINE, versions, pret(H1, { taille: TAILLE_MAX.ventes + 1 }))).toMatchObject({ cle: 'logo_poids' })
    expect(refusDuNouveauLogo(D, PLEINE, versions, { ...pret(H1), type: 'image/jpeg' })).toMatchObject({ cle: 'logo_type' })
  })

  it('un chemin d’un autre dossier, et une empreinte qui n’est pas celle du nom', () => {
    const autre = { ...pret(H1), chemin: cheminDuLogo('a5c00000-0000-4000-8000-0000000000d2', H1, 'image/png') }
    expect(refusDuNouveauLogo(D, PLEINE, versions, autre)).toMatchObject({ cle: 'logo_autre_dossier' })
    expect(refusDuNouveauLogo(D, PLEINE, versions, { ...pret(H1), empreinte: H2 })).toMatchObject({ cle: 'logo_nom' })
  })

  it('une courante que la base ne réenregistrerait pas : son refus passe avant celui du logo', () => {
    const cassee = { ...PLEINE, iban: 'pas un iban' }
    expect(refusDuNouveauLogo(D, cassee, [V1, cassee], pret(H1))).toMatchObject({ cle: 'iban_forme' })
  })

  it('une version qui n’est plus la courante : la saisie passée entre-temps est nommée', () => {
    const suivante = { ...PLEINE, id: 'v9', remplace_id: 'v2', cree_le: '2027-10-05T09:00:00Z' }
    expect(refusDuNouveauLogo(D, PLEINE, [V1, PLEINE, suivante], pret(H1))).toMatchObject({ cle: 'remplacee_pas_courante' })
  })

  it('des versions qui ne font pas une chaîne : rompue', () => {
    expect(refusDuNouveauLogo(D, PLEINE, [PLEINE], pret(H1))).toBe('rompue')
  })

  it('le retrait : sans fichier à connaître ; refusé quand la version n’est plus la courante', () => {
    expect(refusDuRetraitDuLogo(D, AVEC_LOGO, [V1, PLEINE, AVEC_LOGO])).toBeNull()
    expect(refusDuRetraitDuLogo(D, PLEINE, [V1, PLEINE, AVEC_LOGO])).toMatchObject({ cle: 'remplacee_pas_courante' })
    expect(refusDuRetraitDuLogo(D, AVEC_LOGO, [AVEC_LOGO])).toBe('rompue')
  })
})

describe('ce que les gestes disent', () => {
  it('posé, changé : le jour et l’heure de Paris, et un fichier déjà là dit tel', () => {
    expect(messageDuLogoPose('pose', '2027-11-20T10:00:00Z', false)).toBe('Logo posé le 20/11/2027 à 11:00.')
    expect(messageDuLogoPose('change', '2027-07-20T10:00:00Z', false)).toBe('Logo changé le 20/07/2027 à 12:00.')
    expect(messageDuLogoPose('change', '2027-11-20T10:00:00Z', true)).toBe(
      'Logo changé le 20/11/2027 à 11:00. Le fichier était déjà dans l’espace du dossier : son empreinte a été vérifiée, aucun nouveau dépôt n’a eu lieu.',
    )
  })

  it('retiré', () => {
    expect(messageDuLogoRetire('2027-11-20T10:00:00Z')).toBe('Logo retiré le 20/11/2027 à 11:00.')
  })

  it('un fichier déposé dont la version est refusée : il reste là, les paramètres ne sont pas enregistrés, le refus sous ses mots', () => {
    expect(messageFichierDeposeSansVersion('cabinet', 'Le délai doit être un nombre.')).toBe(
      'Le fichier du logo est déposé dans l’espace du dossier, mais les paramètres n’ont pas été enregistrés : Le délai doit être un nombre. Le fichier y reste ; vous pouvez réessayer.',
    )
    expect(messageFichierDeposeSansVersion('client', 'Le délai doit être un nombre')).toBe(
      'Le fichier du logo est déposé dans l’espace du dossier, mais les paramètres n’ont pas été enregistrés : Le délai doit être un nombre. Le fichier y reste ; tu peux réessayer.',
    )
  })

  it('la confirmation du retrait dit ce qui change, ce qui reste et ce que les factures ne font pas encore', () => {
    const { titre, paragraphes } = confirmationDuRetraitDuLogo()
    expect(titre).toBe('Retirer le logo')
    expect(paragraphes).toEqual([
      'Une version nouvelle des paramètres est enregistrée, sans logo ; les autres champs ne changent pas.',
      'Le fichier reste dans l’espace du dossier : il n’est pas supprimé, et l’historique des paramètres garde la trace de ce retrait (« Logo retiré »).',
      'Aucune facture n’imprime encore ce logo : elles le feront avec une étape à venir.',
    ])
  })
})
