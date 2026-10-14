import { describe, expect, it } from 'vitest'
import {
  articlesAChoisir, avecProvenance, ceQueLeChoixRemplace, choixDArticle, enumeration, garderProvenance, gestePrixDeLArticle,
  peutEnregistrerCommeArticle, saisieDeLaLigne, type LigneEnSaisie,
} from './articlesFacture'
import { ligneDepuisArticle } from './articles'
import { MENTION_FRANCHISE } from './statutTva'
import { formaterPrixUnitaire } from './format'
import { saisieEnvoyee } from './articlesVue'
import { article } from '../test/articles'

// UN ARTICLE DANS LE FORMULAIRE D'UNE FACTURE (étape A2b), côté pur. Ce que ces cas gardent : la ligne que le choix met sur
// le formulaire est CELLE de `ligneDepuisArticle` (aucune règle recopiée), en texte et sans arrondi ; ce que le choix remplace
// se nomme, et une ligne vide se remplit sans confirmation ; la provenance tombe avec la ligne ; « Mettre l'article à ce prix »
// envoie tous les champs de l'article tel que lu, le prix de la ligne seul changé ; « Enregistrer comme article » ne propose
// le taux que d'un dossier redevable. Données FICTIVES.

const DOSSIER = 'd1'
const ligne = (o: Partial<LigneEnSaisie> = {}): LigneEnSaisie => ({ designation: '', quantite: '1', prix_unitaire_ht: '', taux_tva: '20', ...o })

const CONSULTATION = article({ id: 'a1', reference: 'CONS-01', designation: 'Consultation de conseil', description: 'Séance d’une heure', prix_unitaire_ht: 60 })
const PIECE = article({ id: 'a2', reference: 'PIECE-1', designation: 'Pièce détachée', unite: 'H87', prix_unitaire_ht: 0.123456, taux_tva: 5.5, nature: 'biens' })
const FORFAIT = article({ id: 'a3', reference: null, designation: 'Forfait mensuel', unite: 'MON', prix_unitaire_ht: 1234.5 })
const ANCIEN = article({ id: 'a4', reference: 'ANCIEN', designation: 'Ancienne prestation', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-cabinet' })
const AUTRE_DOSSIER = article({ id: 'x9', dossier_id: 'd2', reference: 'CONS-01', designation: 'Article d’un autre dossier' })

describe('choixDArticle — la ligne que le choix met sur le formulaire', () => {
  it('redevable : la désignation et sa description, la quantité 1, le prix et le taux de l’article, en texte', () => {
    expect(choixDArticle(CONSULTATION, 'redevable', null)).toEqual({
      ligne: { designation: 'Consultation de conseil — Séance d’une heure', quantite: '1', prix_unitaire_ht: '60', taux_tva: '20' },
      mention: null, avertissement: null,
    })
  })

  it('un prix à six décimales reste à six décimales, un taux décimal aussi : rien n’est arrondi', () => {
    expect(choixDArticle(PIECE, 'redevable', null).ligne).toEqual({
      designation: 'Pièce détachée', quantite: '1', prix_unitaire_ht: '0.123456', taux_tva: '5.5',
    })
    expect(choixDArticle(article({ prix_unitaire_ht: 0.000001 }), 'redevable', null).ligne.prix_unitaire_ht).toBe('0.000001')
  })

  it('franchise : 0 % et la mention de la franchise — le taux de l’article n’est pas facturé', () => {
    const c = choixDArticle(CONSULTATION, 'franchise', null)
    expect(c.ligne.taux_tva).toBe('0')
    expect(c.mention).toBe(MENTION_FRANCHISE)
    expect(c.avertissement).toBeNull()
  })

  it('exonéré : 0 % et la mention de son article d’exonération ; sans article, l’avertissement et pas de mention', () => {
    const avec = choixDArticle(CONSULTATION, 'exonere', 'cgi_261_4_1')
    expect(avec.ligne.taux_tva).toBe('0')
    expect(avec.mention).toMatch(/261/)
    expect(avec.avertissement).toBeNull()
    const sans = choixDArticle(CONSULTATION, 'exonere', null)
    expect(sans.mention).toBeNull()
    expect(sans.avertissement).toMatch(/exonér/)
  })

  it('statut à préciser : 0 % et l’avertissement (A1-Q3), jamais une ligne taxée', () => {
    const c = choixDArticle(CONSULTATION, null, null)
    expect(c.ligne.taux_tva).toBe('0')
    expect(c.mention).toBeNull()
    expect(c.avertissement).toMatch(/à préciser/)
  })

  it('redevable, article à 0 % : la mention de l’article d’exonération du dossier, ou l’avertissement sans article', () => {
    const exonere = article({ taux_tva: 0 })
    expect(choixDArticle(exonere, 'redevable', 'cgi_261_4_1').mention).toMatch(/261/)
    expect(choixDArticle(exonere, 'redevable', null).avertissement).toMatch(/0 %/)
  })

  it.each([
    [CONSULTATION, 'redevable', null], [PIECE, 'franchise', null], [FORFAIT, 'exonere', 'cgi_261_4_1'], [CONSULTATION, null, null],
  ] as const)('aucune règle recopiée : la mention, l’avertissement et le taux sont ceux de ligneDepuisArticle (%#)', (a, statut, exo) => {
    const attendu = ligneDepuisArticle(a, statut, exo)
    const c = choixDArticle(a, statut, exo)
    expect(c.mention).toBe(attendu.mention)
    expect(c.avertissement).toBe(attendu.avertissement)
    expect(Number(c.ligne.taux_tva)).toBe(attendu.ligne.taux_tva)
    expect(Number(c.ligne.prix_unitaire_ht)).toBe(attendu.ligne.prix_unitaire_ht)
    expect(c.ligne.designation).toBe(attendu.ligne.designation)
  })
})

describe('ceQueLeChoixRemplace — ce qui se confirme, et ce qui se remplit directement', () => {
  const apporte = choixDArticle(CONSULTATION, 'redevable', null).ligne

  it('une ligne VIDE se remplit sans rien confirmer : le taux d’une ligne neuve n’est pas une saisie', () => {
    expect(ceQueLeChoixRemplace(ligne(), apporte)).toEqual([])
    expect(ceQueLeChoixRemplace(ligne({ taux_tva: '0' }), apporte)).toEqual([])
    expect(ceQueLeChoixRemplace(ligne({ designation: '   ' }), apporte)).toEqual([])
  })

  it('une désignation saisie : elle est nommée', () => {
    expect(ceQueLeChoixRemplace(ligne({ designation: 'Prestation' }), apporte)).toEqual(['la désignation « Prestation »'])
  })

  it('un prix saisi : il est nommé, au format du prix unitaire, sans arrondi', () => {
    expect(ceQueLeChoixRemplace(ligne({ prix_unitaire_ht: '12.5' }), apporte)).toEqual([`le prix ${formaterPrixUnitaire(12.5)}`])
    expect(ceQueLeChoixRemplace(ligne({ prix_unitaire_ht: '0.123456' }), apporte)).toEqual([`le prix ${formaterPrixUnitaire(0.123456)}`])
  })

  it('un prix que le champ ne dit pas comme un nombre est nommé tel quel', () => {
    expect(ceQueLeChoixRemplace(ligne({ prix_unitaire_ht: '1e3' }), apporte)).toEqual(['le prix « 1e3 »'])
  })

  it('désignation, quantité, prix et taux : chacun nommé, dans l’ordre de la ligne', () => {
    expect(ceQueLeChoixRemplace(
      ligne({ designation: 'Prestation', quantite: '3', prix_unitaire_ht: '12.5', taux_tva: '10' }), apporte,
    )).toEqual(['la désignation « Prestation »', 'la quantité 3', `le prix ${formaterPrixUnitaire(12.5)}`, 'le taux 10 %'])
  })

  it('une quantité tapée sur une ligne sans désignation ni prix compte : elle ne se remplace pas en silence par 1', () => {
    expect(ceQueLeChoixRemplace(ligne({ quantite: '4' }), apporte)).toEqual(['la quantité 4'])
  })

  it('une ligne qui dit déjà ce que l’article apporte : rien à confirmer', () => {
    expect(ceQueLeChoixRemplace(
      ligne({ designation: apporte.designation, quantite: '1.0', prix_unitaire_ht: '60.00', taux_tva: '20' }), apporte,
    )).toEqual([])
  })

  it('ne nomme que ce qui change : le taux identique n’est pas dit', () => {
    expect(ceQueLeChoixRemplace(ligne({ designation: 'Prestation', taux_tva: '20' }), apporte)).toEqual(['la désignation « Prestation »'])
  })

  it('une désignation très longue est coupée comme dans les refus (quatre-vingts caractères)', () => {
    const [dit] = ceQueLeChoixRemplace(ligne({ designation: 'x'.repeat(200) }), apporte)
    expect(dit).toBe(`la désignation « ${'x'.repeat(79)}… »`)
  })
})

describe('enumeration — une phrase', () => {
  it.each([[[], ''], [['a'], 'a'], [['a', 'b'], 'a et b'], [['a', 'b', 'c'], 'a, b et c']])('%j', (elements, attendu) => {
    expect(enumeration(elements)).toBe(attendu)
  })
})

describe('articlesAChoisir — jamais un retiré, l’ordre de la liste, la recherche commune', () => {
  const liste = [FORFAIT, ANCIEN, PIECE, CONSULTATION]

  it('les articles en cours seuls, dans l’ordre de la liste (par désignation)', () => {
    expect(articlesAChoisir(liste, '').map((a) => a.id)).toEqual(['a1', 'a3', 'a2'])
  })

  it('la recherche lit la référence et la désignation, accents et casse ignorés, termes en ET', () => {
    expect(articlesAChoisir(liste, 'cons').map((a) => a.id)).toEqual(['a1'])
    expect(articlesAChoisir(liste, 'piece-1').map((a) => a.id)).toEqual(['a2'])
    expect(articlesAChoisir(liste, 'PIÈCE détachée').map((a) => a.id)).toEqual(['a2'])
    expect(articlesAChoisir(liste, 'forfait mensuel').map((a) => a.id)).toEqual(['a3'])
    expect(articlesAChoisir(liste, 'consultation inconnue')).toEqual([])
  })

  it('un article retiré ne se trouve pas, même par sa référence', () => {
    expect(articlesAChoisir(liste, 'ANCIEN')).toEqual([])
  })

  it('ni la description, ni le prix ne sont cherchés', () => {
    expect(articlesAChoisir(liste, 'Séance')).toEqual([])
    expect(articlesAChoisir(liste, '60')).toEqual([])
  })
})

describe('la provenance — l’article qui a rempli la ligne, en mémoire', () => {
  it('une ligne prend l’article qui la remplit, et un autre article remplace le premier', () => {
    const a = avecProvenance({}, 'l0', 'a1')
    expect(a).toEqual({ l0: 'a1' })
    expect(avecProvenance(a, 'l0', 'a2')).toEqual({ l0: 'a2' })
    expect(avecProvenance(a, 'l1', 'a2')).toEqual({ l0: 'a1', l1: 'a2' })
  })

  it('n’altère pas la provenance reçue', () => {
    const a = Object.freeze({ l0: 'a1' })
    expect(() => avecProvenance(a, 'l1', 'a2')).not.toThrow()
    expect(a).toEqual({ l0: 'a1' })
  })

  it('une ligne retirée perd la sienne ; les autres gardent la leur', () => {
    expect(garderProvenance({ l0: 'a1', l1: 'a2' }, ['l1'])).toEqual({ l1: 'a2' })
    expect(garderProvenance({ l0: 'a1' }, [])).toEqual({})
  })

  it('rend la MÊME valeur quand rien n’est à retirer : un état inchangé ne fait pas rendre', () => {
    const p = { l0: 'a1' }
    expect(garderProvenance(p, ['l0', 'l1'])).toBe(p)
  })
})

describe('gestePrixDeLArticle — « Mettre l’article à ce prix »', () => {
  const liste = [CONSULTATION, PIECE, ANCIEN, AUTRE_DOSSIER]

  it('le prix de la ligne est celui de l’article : rien à offrir (tel quel, ou écrit autrement)', () => {
    expect(gestePrixDeLArticle(DOSSIER, CONSULTATION, '60', liste)).toEqual({ etat: 'sans_objet' })
    expect(gestePrixDeLArticle(DOSSIER, CONSULTATION, '60.00', liste)).toEqual({ etat: 'sans_objet' })
    expect(gestePrixDeLArticle(DOSSIER, PIECE, '0.123456', liste)).toEqual({ etat: 'sans_objet' })
  })

  it('un autre prix : le geste s’offre, avec TOUS les champs de l’article tel que lu, le prix de la ligne seul changé', () => {
    const geste = gestePrixDeLArticle(DOSSIER, CONSULTATION, '65,5', liste)
    expect(geste.etat).toBe('offert')
    if (geste.etat !== 'offert') return
    expect(geste.refus).toBeNull()
    expect(geste.ancien).toBe(60)
    expect(geste.nouveau).toBe(65.5)
    expect(saisieEnvoyee(geste.saisie)).toEqual({
      designation: 'Consultation de conseil', description: 'Séance d’une heure', reference: 'CONS-01', unite: 'HUR', prix_unitaire_ht: 65.5,
      taux_tva: 20, nature: 'services',
    })
  })

  it('la description, l’unité, la nature et le taux de l’article partent tels que lus, jamais ceux de la ligne', () => {
    const complet = article({
      id: 'a9', reference: 'R-9', designation: 'Article complet', description: 'Texte', unite: 'KGM', prix_unitaire_ht: 10, taux_tva: 5.5, nature: 'biens',
    })
    const geste = gestePrixDeLArticle(DOSSIER, complet, '10.000001', [complet])
    if (geste.etat !== 'offert') throw new Error('le geste aurait dû s’offrir')
    expect(saisieEnvoyee(geste.saisie)).toEqual({
      designation: 'Article complet', description: 'Texte', reference: 'R-9', unite: 'KGM', prix_unitaire_ht: 10.000001, taux_tva: 5.5, nature: 'biens',
    })
  })

  it('un prix à six décimales part sans arrondi', () => {
    const geste = gestePrixDeLArticle(DOSSIER, CONSULTATION, '0.123456', liste)
    if (geste.etat !== 'offert') throw new Error('le geste aurait dû s’offrir')
    expect(saisieEnvoyee(geste.saisie).prix_unitaire_ht).toBe(0.123456)
    expect(geste.nouveau).toBe(0.123456)
  })

  it('un article retiré : le geste s’offre, grisé sous le refus de la base — le reprendre avant de le modifier', () => {
    const geste = gestePrixDeLArticle(DOSSIER, ANCIEN, '99', liste)
    expect(geste).toMatchObject({ etat: 'offert', refus: 'Cet article est retiré : le reprendre avant de le modifier.' })
  })

  it('un article que la liste ne porte pas : « introuvable »', () => {
    expect(gestePrixDeLArticle(DOSSIER, null, '99', liste)).toMatchObject({ etat: 'offert', refus: 'Article introuvable dans ce dossier.' })
  })

  it('un article d’un autre dossier : « introuvable » aussi', () => {
    expect(gestePrixDeLArticle(DOSSIER, AUTRE_DOSSIER, '99', liste)).toMatchObject({ etat: 'offert', refus: 'Article introuvable dans ce dossier.' })
  })

  const HORS_BORNES = 'Le prix unitaire hors taxes de l\'article est positif ou nul, à six décimales au plus, sous dix milliards d\'euros.'
  it.each([
    ['', 'Le prix unitaire hors taxes de l\'article est à renseigner.'],
    ['abc', 'Le prix n’est pas un nombre que l’écran sait lire sans le changer (par exemple 12,50).'],
    ['-5', HORS_BORNES],
    ['0.1234567', HORS_BORNES],
  ])('un prix de ligne « %s » : offert et grisé sous le refus du module, dit avant le clic', (prix, refus) => {
    expect(gestePrixDeLArticle(DOSSIER, CONSULTATION, prix, liste)).toMatchObject({ etat: 'offert', refus })
  })

  it('une référence prise par un AUTRE article de la liste ne bloque pas l’article lui-même (sa propre référence)', () => {
    expect(gestePrixDeLArticle(DOSSIER, CONSULTATION, '61', liste)).toMatchObject({ etat: 'offert', refus: null })
  })
})

describe('« Enregistrer comme article » — la saisie tirée d’une ligne', () => {
  it('une désignation suffit pour l’offrir ; des blancs seuls non', () => {
    expect(peutEnregistrerCommeArticle(ligne({ designation: 'Prestation' }))).toBe(true)
    expect(peutEnregistrerCommeArticle(ligne({ designation: '' }))).toBe(false)
    expect(peutEnregistrerCommeArticle(ligne({ designation: ' \t ' }))).toBe(false)
  })

  it('redevable : la désignation, le prix lu sans arrondi, le taux de la ligne, l’unité générique, la nature à choisir, aucune référence', () => {
    expect(saisieDeLaLigne(ligne({ designation: 'Prestation', prix_unitaire_ht: '12.5', taux_tva: '10' }), 'redevable')).toEqual({
      reference: '', designation: 'Prestation', description: '', unite: 'C62', prix: '12,5', taux: '10', nature: '',
    })
  })

  it('un prix à six décimales n’est jamais arrondi', () => {
    expect(saisieDeLaLigne(ligne({ designation: 'P', prix_unitaire_ht: '0.123456' }), 'redevable').prix).toBe('0,123456')
  })

  it.each(['franchise', 'exonere', null] as const)('statut %s : le taux reste VIDE (celui d’un dossier redevable), même sur une ligne à 20 %%', (statut) => {
    expect(saisieDeLaLigne(ligne({ designation: 'P', taux_tva: '20' }), statut).taux).toBe('')
  })

  it('redevable : un taux que la DGFiP n’admet pas reste vide ; un prix vide reste vide ; un prix illisible reste tel quel', () => {
    expect(saisieDeLaLigne(ligne({ designation: 'P', taux_tva: '7.3' }), 'redevable').taux).toBe('')
    expect(saisieDeLaLigne(ligne({ designation: 'P', taux_tva: '' }), 'redevable').taux).toBe('')
    expect(saisieDeLaLigne(ligne({ designation: 'P', prix_unitaire_ht: '' }), 'redevable').prix).toBe('')
    expect(saisieDeLaLigne(ligne({ designation: 'P', prix_unitaire_ht: '1e3' }), 'redevable').prix).toBe('1e3')
  })

  it('une ligne à 0 % d’un dossier redevable garde son 0 %', () => {
    expect(saisieDeLaLigne(ligne({ designation: 'P', taux_tva: '0' }), 'redevable').taux).toBe('0')
  })
})
