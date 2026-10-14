import { describe, expect, it } from 'vitest'
import {
  formaterPrixArticle, gestesDeLArticle, lirePrix, mentionParLeClient, PRIX_ILLISIBLE, refusDeLaSaisie, saisieEnvoyee,
  saisieInitiale, saisieTouchee, articlesAffiches, champsDeRechercheArticle, TITRES_ARTICLE_PAR_LE_CLIENT, type SaisieArticle,
} from './articlesVue'
import { refusEnregistrementArticle, refusRepriseArticle, refusRetraitArticle } from './articles'
import type { AccesDuDossier } from './auteursVentes'
import { article } from '../test/articles'

// LA LISTE DES ARTICLES, SA SAISIE ET SES GESTES (étape A2a), côté pur. Ce que ces cas gardent : un prix tapé se lit sans
// jamais être changé en silence ; la saisie part telle que le module la juge ; les refus sont CEUX du module (aucune règle
// recopiée : chaque cas les confronte à lui) ; la liste ne montre pas les retirés sans le filtre et garde un ordre total ;
// « par le client » ne se dit que du dernier geste, sur des accès lus en entier ; un prix ne s'arrondit jamais à l'affichage.

const SAISIE_VALIDE: SaisieArticle = {
  reference: 'NEUF-01', designation: 'Article neuf', description: '', unite: 'C62', prix: '12,50', taux: '20', nature: 'services',
}
const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
// Les espaces du texte rendu : l'insécable et la fine insécable se lisent comme des espaces.
const lisible = (t: string) => t.replace(/[  ]/g, ' ')

describe('lirePrix — un prix tapé se lit sans être changé', () => {
  it.each([
    ['12,50', 12.5], ['12.5', 12.5], ['  12,5  ', 12.5], ['1 200,5', 1200.5], ['1 200,50', 1200.5], ['1 200', 1200],
    ['007', 7], ['0,123456', 0.123456], ['12,', 12], ['-5', -5], ['0', 0],
  ])('« %s » est %s', (texte, attendu) => {
    expect(lirePrix(texte)).toBe(attendu)
  })

  it.each(['', '   '])('un champ vide (« %s ») est nul', (texte) => {
    expect(lirePrix(texte)).toBeNull()
  })

  it.each(['abc', '12,5,3', '1e3', '12 €', '--5', ',5', '0x10'])('« %s » n’est pas un nombre lisible', (texte) => {
    expect(lirePrix(texte)).toBe('illisible')
  })

  it('un prix que le nombre ne tient pas fidèlement est illisible : jamais arrondi en silence', () => {
    // Vingt décimales : le nombre en garderait dix-sept et le dernier 1 disparaîtrait sans un mot.
    expect(lirePrix('0,10000000000000000001')).toBe('illisible')
    // Sept décimales : fidèle — c'est le module qui le refuse, sous les mots de la base.
    expect(lirePrix('0,1234567')).toBe(0.1234567)
  })
})

describe('saisieEnvoyee — la saisie telle que la base la reçoit', () => {
  it('une saisie complète : tous les champs, le prix et le taux en nombres', () => {
    expect(saisieEnvoyee({ ...SAISIE_VALIDE, description: 'Un texte', taux: '5.5' })).toEqual({
      designation: 'Article neuf', description: 'Un texte', reference: 'NEUF-01', unite: 'C62',
      prix_unitaire_ht: 12.5, taux_tva: 5.5, nature: 'services',
    })
  })

  it('une référence ou une description vide n’est pas envoyée (la base refuse une référence de zéro caractère)', () => {
    const envoyee = saisieEnvoyee({ ...SAISIE_VALIDE, reference: '   ', description: '\n ' })
    expect(envoyee.reference).toBeNull()
    expect(envoyee.description).toBeNull()
  })

  it('une référence avec des blancs aux bords part TELLE QUELLE : le module dit son refus, rien n’est rogné en silence', () => {
    expect(saisieEnvoyee({ ...SAISIE_VALIDE, reference: ' R1' }).reference).toBe(' R1')
  })

  it('un prix illisible, un taux ou une nature non choisis partent absents', () => {
    const envoyee = saisieEnvoyee({ ...SAISIE_VALIDE, prix: 'abc', taux: '', nature: '' })
    expect(envoyee.prix_unitaire_ht).toBeNull()
    expect(envoyee.taux_tva).toBeNull()
    expect(envoyee.nature).toBeNull()
  })
})

describe('saisieInitiale — la saisie part de l’article LU', () => {
  it('un article neuf : l’unité générique, rien d’autre — ni taux ni nature choisis à la place de qui saisit', () => {
    expect(saisieInitiale(null)).toEqual({ reference: '', designation: '', description: '', unite: 'C62', prix: '', taux: '', nature: '' })
  })

  it('un article lu : chaque champ, le prix en décimal à la française', () => {
    const lu = article({ reference: 'R-9', description: 'Texte', unite: 'MON', prix_unitaire_ht: 1234.5, taux_tva: 5.5, nature: 'biens' })
    expect(saisieInitiale(lu)).toEqual({
      reference: 'R-9', designation: 'Consultation de conseil', description: 'Texte', unite: 'MON', prix: '1234,5', taux: '5.5', nature: 'biens',
    })
  })

  it('une référence et une description absentes se montrent vides', () => {
    const s = saisieInitiale(article({ reference: null, description: null }))
    expect(s.reference).toBe('')
    expect(s.description).toBe('')
  })

  it('l’article lu, ressaisi tel quel, part comme il est : aucun champ ne bouge', () => {
    const lu = article({ reference: 'R-9', description: 'Texte', prix_unitaire_ht: 0.123456, taux_tva: 5.5, nature: 'biens' })
    expect(saisieEnvoyee(saisieInitiale(lu))).toEqual({
      designation: lu.designation, description: 'Texte', reference: 'R-9', unite: 'HUR', prix_unitaire_ht: 0.123456, taux_tva: 5.5, nature: 'biens',
    })
  })

  it('saisieTouchee : un champ changé, et lui seul', () => {
    const depart = saisieInitiale(null)
    expect(saisieTouchee(depart, { ...depart })).toBe(false)
    expect(saisieTouchee(depart, { ...depart, designation: 'x' })).toBe(true)
    expect(saisieTouchee(depart, { ...depart, nature: 'biens' })).toBe(true)
  })
})

describe('refusDeLaSaisie — les refus sont ceux du module, dans son ordre', () => {
  const dossier = 'd1'
  const nouveau = { nouveau: true } as const
  const autres = [article({ id: 'x1', reference: 'PRISE', designation: 'Article qui la porte' }), article({ id: 'x2', reference: 'ANCIENNE', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x' })]

  it('une saisie complète n’a aucun refus', () => {
    expect(refusDeLaSaisie(dossier, nouveau, SAISIE_VALIDE, autres)).toBeNull()
  })

  it('la saisie vide : le premier refus du module (la désignation)', () => {
    const refus = refusDeLaSaisie(dossier, nouveau, saisieInitiale(null), [])
    expect(refus?.cle).toBe('designation_absente')
    expect(refus?.message).toBe("La désignation de l'article est à renseigner.")
  })

  it.each<[string, Partial<SaisieArticle>]>([
    ['la désignation', { designation: '  ' }],
    ['la référence (blancs aux bords)', { reference: ' R1' }],
    ['la référence prise', { reference: 'PRISE' }],
    ['la référence prise par un retiré', { reference: 'ANCIENNE' }],
    ['le prix négatif', { prix: '-1' }],
    ['le prix à sept décimales', { prix: '0,1234567' }],
    ['le prix absent', { prix: '' }],
    ['le taux absent', { taux: '' }],
    ['la nature absente', { nature: '' }],
  ])('%s : le même refus que le module, mot pour mot', (_nom, champ) => {
    const saisie = { ...SAISIE_VALIDE, ...champ }
    const attendu = refusEnregistrementArticle(dossier, nouveau, saisieEnvoyee(saisie), autres)
    expect(attendu).not.toBeNull()
    expect(refusDeLaSaisie(dossier, nouveau, saisie, autres)).toEqual(attendu)
  })

  it('la référence prise nomme l’article qui la porte, et dit « retiré » du retiré', () => {
    expect(refusDeLaSaisie(dossier, nouveau, { ...SAISIE_VALIDE, reference: 'PRISE' }, autres)?.message)
      .toBe("La référence « PRISE » est déjà celle de l'article « Article qui la porte » : une référence ne sert qu'une fois par dossier.")
    expect(refusDeLaSaisie(dossier, nouveau, { ...SAISIE_VALIDE, reference: 'ANCIENNE' }, autres)?.message)
      .toContain('(retiré)')
  })

  it('un prix qui n’est pas un nombre : son refus, pas « à renseigner » ; mais un refus d’AVANT passe d’abord', () => {
    expect(refusDeLaSaisie(dossier, nouveau, { ...SAISIE_VALIDE, prix: 'abc' }, [])).toEqual({ cle: 'prix_illisible', message: PRIX_ILLISIBLE })
    // Même ordre que la base : la désignation, rang 4, précède le prix, rang 7.
    expect(refusDeLaSaisie(dossier, nouveau, { ...SAISIE_VALIDE, prix: 'abc', designation: '' }, [])?.cle).toBe('designation_absente')
    // Un champ vide reste « à renseigner » : ce n'est pas un nombre mal écrit.
    expect(refusDeLaSaisie(dossier, nouveau, { ...SAISIE_VALIDE, prix: '' }, [])?.cle).toBe('prix_absent')
  })

  it('un prix illisible et un taux absent : le prix d’abord (rang 7 avant 8)', () => {
    expect(refusDeLaSaisie(dossier, nouveau, { ...SAISIE_VALIDE, prix: 'abc', taux: '' }, [])?.cle).toBe('prix_illisible')
  })

  it('modifier un article : sa propre référence n’est pas « prise » ; un retiré se reprend d’abord', () => {
    const lu = article({ id: 'x1', reference: 'PRISE' })
    expect(refusDeLaSaisie(dossier, { nouveau: false, article: lu }, saisieInitiale(lu), autres)).toBeNull()
    const retire = article({ id: 'x2', reference: 'ANCIENNE', retire_le: '2027-10-05T08:00:00Z' })
    expect(refusDeLaSaisie(dossier, { nouveau: false, article: retire }, saisieInitiale(retire), autres)?.message)
      .toBe('Cet article est retiré : le reprendre avant de le modifier.')
  })
})

describe('formaterPrixArticle — un prix ne s’arrondit jamais à l’affichage', () => {
  it.each([
    [12.5, '12,50 €'], [60, '60,00 €'], [0, '0,00 €'], [0.1, '0,10 €'], [1.2345, '1,2345 €'], [0.123456, '0,123456 €'],
    [1234.5, '1 234,50 €'], [999999.999999, '999 999,999999 €'],
  ])('%s s’affiche « %s »', (prix, attendu) => {
    expect(lisible(formaterPrixArticle(prix))).toBe(attendu)
  })

  it('l’espace avant « € » est insécable : un montant ne se coupe pas en fin de ligne', () => {
    expect(formaterPrixArticle(12.5)).toMatch(/ €$/)
  })
})

describe('articlesAffiches — les retirés sans le filtre, un ordre total', () => {
  const liste = [
    article({ id: 'b', designation: 'Beta', reference: 'B' }),
    article({ id: 'r', designation: 'Alpha retiré', reference: 'R', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u' }),
    article({ id: 'a', designation: 'alpha', reference: 'A' }),
    article({ id: 'e', designation: 'Élan', reference: null }),
    article({ id: 'n10', designation: 'Article 10' }),
    article({ id: 'n2', designation: 'Article 2' }),
  ]

  it('sans le filtre, les retirés ne se montrent pas ; avec lui, ils suivent les autres', () => {
    expect(articlesAffiches(liste, false).map((a) => a.id)).toEqual(['a', 'n2', 'n10', 'b', 'e'])
    expect(articlesAffiches(liste, true).map((a) => a.id)).toEqual(['a', 'n2', 'n10', 'b', 'e', 'r'])
  })

  it('une désignation identique se départage par la référence, puis par l’identifiant', () => {
    // Les identifiants vont à l'inverse des références : seule la référence peut mettre « r1 » avant « r2 ».
    const memes = [
      article({ id: 'a', designation: 'Même', reference: 'B' }), article({ id: 'b', designation: 'Même', reference: 'A' }),
      article({ id: 'd', designation: 'Même', reference: null }), article({ id: 'c', designation: 'Même', reference: null }),
    ]
    expect(articlesAffiches(memes, false).map((a) => a.id)).toEqual(['c', 'd', 'b', 'a'])
  })

  it('la liste lue n’est pas réordonnée sur place', () => {
    const avant = liste.map((a) => a.id)
    articlesAffiches(liste, true)
    expect(liste.map((a) => a.id)).toEqual(avant)
  })

  it('la recherche lit la référence et la désignation, et rien d’autre', () => {
    expect(champsDeRechercheArticle(article({ reference: 'R-1', designation: 'Nom', description: 'Texte caché' }))).toEqual(['R-1', 'Nom'])
  })
})

describe('mentionParLeClient — le dernier geste, d’un accès client lu en entier', () => {
  const vide = { cree_par: null, cree_le: '2027-10-01T09:00:00Z', modifie_par: null, modifie_le: null, retire_par: null, retire_le: null }

  it('créé par le client, jamais modifié', () => {
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client' })).toEqual({ libelle: 'par le client', titre: TITRES_ARTICLE_PAR_LE_CLIENT.cree })
  })

  it('créé par le client puis modifié par le cabinet : le dernier geste est celui du cabinet — rien', () => {
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T09:00:00Z' })).toBeNull()
  })

  it('créé par le cabinet puis modifié par le client', () => {
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-cabinet', modifie_par: 'u-client', modifie_le: '2027-10-02T09:00:00Z' })?.titre)
      .toBe(TITRES_ARTICLE_PAR_LE_CLIENT.modifie)
  })

  it('retiré par le client après sa dernière modification', () => {
    expect(mentionParLeClient(ACCES_LUS, {
      ...vide, cree_par: 'u-cabinet', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T09:00:00Z', retire_par: 'u-client', retire_le: '2027-10-03T09:00:00Z',
    })?.titre).toBe(TITRES_ARTICLE_PAR_LE_CLIENT.retire)
  })

  it('retiré par le cabinet : le client l’avait créé, il n’est plus le dernier', () => {
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', retire_par: 'u-cabinet', retire_le: '2027-10-03T09:00:00Z' })).toBeNull()
  })

  it('repris par le client (une modification) après un retrait du cabinet', () => {
    expect(mentionParLeClient(ACCES_LUS, {
      ...vide, cree_par: 'u-cabinet', retire_par: null, retire_le: null, modifie_par: 'u-client', modifie_le: '2027-10-04T09:00:00Z',
    })?.titre).toBe(TITRES_ARTICLE_PAR_LE_CLIENT.modifie)
  })

  it('les instants se comparent comme des instants, pas comme des textes (un fuseau explicite)', () => {
    // 10:30 à +02:00 est AVANT 09:00 UTC du même jour : le texte « 2027-10-02T10:30… » est plus grand, l'instant est plus petit.
    expect(mentionParLeClient(ACCES_LUS, {
      ...vide, cree_par: 'u-client', cree_le: '2027-10-02T09:00:00Z', modifie_par: 'u-cabinet', modifie_le: '2027-10-02T10:30:00+02:00',
    })?.titre).toBe(TITRES_ARTICLE_PAR_LE_CLIENT.cree)
  })

  it('à égalité d’instant, le geste qui vient plus loin dans la vie de l’article l’emporte', () => {
    const t = '2027-10-02T09:00:00Z'
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', cree_le: t, modifie_par: 'u-cabinet', modifie_le: t })).toBeNull()
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-cabinet', cree_le: t, modifie_par: 'u-client', modifie_le: t })?.titre)
      .toBe(TITRES_ARTICLE_PAR_LE_CLIENT.modifie)
  })

  it('jamais deviné : un auteur nul, un accès retiré, des accès pas lus en entier ou sans objet', () => {
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: null })).toBeNull()
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-ancien' })).toBeNull()
    for (const acces of [{ etat: 'en_cours' }, { etat: 'incomplets', motif: 'lecture interrompue' }, { etat: 'sans_objet' }] as const) {
      expect(mentionParLeClient(acces, { ...vide, cree_par: 'u-client' }), acces.etat).toBeNull()
    }
  })

  it('un instant illisible ne dit rien du geste', () => {
    expect(mentionParLeClient(ACCES_LUS, { ...vide, cree_par: 'u-client', cree_le: 'pas une date' })).toBeNull()
  })
})

describe('gestesDeLArticle — ce que chaque geste refuserait, du module', () => {
  it('un article en cours : « Modifier » libre, « Retirer » offert et libre', () => {
    const gestes = gestesDeLArticle('d1', article(), [])
    expect(gestes.modifier).toBeNull()
    expect(gestes.basculer).toEqual({ geste: 'retirer', refus: null })
  })

  it('un article retiré : « Modifier » refusé sous les mots du module, « Reprendre » offert et libre', () => {
    const retire = article({ retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x' })
    const gestes = gestesDeLArticle('d1', retire, [])
    expect(gestes.modifier?.message).toBe('Cet article est retiré : le reprendre avant de le modifier.')
    expect(gestes.basculer).toEqual({ geste: 'reprendre', refus: null })
  })

  it('un article d’un autre dossier : introuvable pour les trois, sous les mots du module', () => {
    const autre = article({ dossier_id: 'd2' })
    const gestes = gestesDeLArticle('d1', autre, [])
    expect(gestes.modifier).toEqual(refusEnregistrementArticle('d1', { nouveau: false, article: autre }, saisieEnvoyee(saisieInitiale(autre)), []))
    expect(gestes.basculer.refus).toEqual(refusRetraitArticle('d1', autre))
    expect(gestesDeLArticle('d1', { ...autre, retire_le: '2027-10-05T08:00:00Z' }, []).basculer.refus).toEqual(refusRepriseArticle('d1', { ...autre, retire_le: '2027-10-05T08:00:00Z' }))
    expect(gestes.basculer.refus?.message).toBe('Article introuvable dans ce dossier.')
  })
})
