import { describe, expect, it } from 'vitest'
import { PROMPT_EXTRACTION, verifierCitations } from './extractionChamps'

// Textes RECONSTRUITS, jamais copiés d'un document réel : une facture réelle de ce domaine porte des
// noms de patients, des dates de naissance et des numéros de sécurité sociale, qui n'ont rien à
// faire dans un dépôt Git. Seule la FORME est reproduite — c'est tout ce que la fonction regarde.
//
// L'espace des milliers est une espace INSÉCABLE (U+00A0), comme sur une vraie facture : c'est le
// cas qui a motivé la normalisation, et un test écrit avec une espace ordinaire ne prouverait rien.
const FACTURE = [
  'PAPETERIE DU LITTORAL',
  '12 rue des Ateliers — 13000 Marseille',
  'Facture n° F-2025-0412',
  'Date : 1er juin 2025',
  'Échéance : 30 juin 2025',
  'Total HT  1 029,63 €',
  'TVA 20 %  205,93 €',
  'Total TTC  1 235,56 €',
].join('\n')

describe('verifierCitations — le modèle cite, le code vérifie', () => {
  it('retient une citation qui figure réellement dans le texte', () => {
    const { retenues, rejetees } = verifierCitations(
      { tiers: 'PAPETERIE DU LITTORAL', date: '1er juin 2025', totalTtc: '1 235,56 €' },
      FACTURE,
    )
    expect(retenues.tiers).toBe('PAPETERIE DU LITTORAL')
    expect(retenues.date).toBe('1er juin 2025')
    expect(retenues.totalTtc).toBe('1 235,56 €')
    expect(rejetees).toEqual([])
  })

  it('REJETTE une valeur que le modèle a composée — c’est toute la raison d’être du module', () => {
    // 1 240,00 € n'est nulle part sur ce document. Un modèle qui « arrondit » ou qui recompose à
    // partir du HT et de la TVA produit exactement ça, et rien à l'écran ne le distinguerait d'une
    // lecture — sauf ce rejet.
    const { retenues, rejetees } = verifierCitations({ totalTtc: '1 240,00 €' }, FACTURE)
    expect(retenues.totalTtc).toBeUndefined()
    expect(rejetees).toEqual([{ champ: 'totalTtc', citation: '1 240,00 €', motif: 'absente du texte' }])
  })

  it('tolère les blancs : une espace ordinaire citée contre une insécable imprimée', () => {
    // Le cas RÉEL. Le modèle recopie avec une espace ordinaire ce que la facture imprime en
    // insécable ; sans normalisation, tout montant à quatre chiffres serait rejeté.
    expect(verifierCitations({ totalHt: '1 029,63 €' }, FACTURE).retenues.totalHt).toBe('1 029,63 €')
  })

  it('tolère la casse — recopier en changeant une capitale n’est pas inventer', () => {
    expect(verifierCitations({ tiers: 'Papeterie du Littoral' }, FACTURE).retenues.tiers)
      .toBe('Papeterie du Littoral')
  })

  it('n’ignore PAS les accents : les aplatir laisserait passer ce que le document ne porte pas', () => {
    // « Echeance » sans accent n'est pas imprimé sur ce document. La tolérance aux blancs et à la
    // casse s'arrête là — c'est la frontière entre « recopier » et « ressembler ».
    const { rejetees } = verifierCitations({ tiers: 'Echeance' }, FACTURE)
    expect(rejetees).toHaveLength(1)
    expect(rejetees[0].motif).toBe('absente du texte')
  })

  it('accepte un montant recopié sans son séparateur de milliers', () => {
    // Le séparateur de milliers est de la présentation. Les chiffres, eux, sont tous là et dans
    // l'ordre — le modèle n'a rien fabriqué.
    expect(verifierCitations({ totalTtc: '1235,56 €' }, FACTURE).retenues.totalTtc).toBe('1235,56 €')
  })

  it('mais REFUSE la même tolérance sur le tiers — deux mots soudés seraient une invention', () => {
    // L'asymétrie est le cœur du module : retirer les blancs d'une raison sociale laisserait
    // « PAPETERIEDU » ou n'importe quelle soudure passer pour une lecture.
    const { retenues, rejetees } = verifierCitations({ tiers: 'PAPETERIEDULITTORAL' }, FACTURE)
    expect(retenues.tiers).toBeUndefined()
    expect(rejetees[0].motif).toBe('absente du texte')
  })

  it('un champ nul est une RÉPONSE, pas un rejet', () => {
    // « Je ne l'ai pas trouvé » est exactement ce qu'on demande au modèle quand le champ n'y est
    // pas. Le compter comme un rejet noierait les vraies inventions dans le diagnostic.
    const { retenues, rejetees } = verifierCitations({ tiers: null, totalTva: null }, FACTURE)
    expect(retenues).toEqual({})
    expect(rejetees).toEqual([])
  })

  it('une chaîne VIDE est en revanche un rejet, et distingué', () => {
    const { rejetees } = verifierCitations({ tiers: '   ' }, FACTURE)
    expect(rejetees).toEqual([{ champ: 'tiers', citation: '   ', motif: 'citation vide' }])
  })

  it('le prompt exige de recopier et autorise explicitement null', () => {
    // Garde faible et assumée — on ne teste pas un texte, on empêche qu'une réécriture retire les
    // deux instructions dont dépend tout le reste du module.
    expect(PROMPT_EXTRACTION).toMatch(/RECOPIES/)
    expect(PROMPT_EXTRACTION).toMatch(/rends null/)
  })
})
