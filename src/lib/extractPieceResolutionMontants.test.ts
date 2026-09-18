import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Même garde-fou que extractPieceMontants.test.ts, sur la règle qui décide des trois montants.
// `supabase/functions/extract-piece/index.ts` est auto-porté et ne peut rien importer de src/ : le
// seul moyen de tester la règle réellement déployée est de lire sa source et d'exécuter sa copie.
//
// Volontairement fragile : renommer `resoudreMontants` ou ses aides casse bruyamment. C'est
// préférable à une règle qui dérive sans que rien ne le dise.
function resoudreMontantsDeLEdgeFunction() {
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  const morceaux = ['function arrondi(', 'function tauxLegal(', 'function resoudreMontants(']
    .map((signature) => {
      const debut = source.indexOf(signature)
      expect(debut, `\`${signature}\` introuvable dans l'Edge Function — le garde-fou doit être remis à jour`).toBeGreaterThan(-1)
      const fin = source.indexOf('\n}\n', debut)
      expect(fin, `fin de \`${signature}\` introuvable`).toBeGreaterThan(debut)
      return source.slice(debut, fin + 2)
    })

  const constantes = ['TAUX_TVA_MAXIMAL', 'TOLERANCE_CENTIME'].map((nom) => {
    const ligne = source.match(new RegExp(`^const ${nom} = .+$`, 'm'))
    expect(ligne, `\`const ${nom}\` introuvable dans l'Edge Function`).not.toBeNull()
    return ligne![0]
  })

  // Les annotations de type TypeScript sont retirées : `new Function` évalue du JavaScript.
  const corps = [...constantes, ...morceaux]
    .join('\n')
    .replace(/function arrondi\(n: number\): number/, 'function arrondi(n)')
    .replace(/function tauxLegal\(ht: number \| null, tva: number \| null\): boolean/, 'function tauxLegal(ht, tva)')
    .replace(/function resoudreMontants\([^)]*\): MontantsResolus/s, 'function resoudreMontants(totalLu, sousTotalLu, taxesDetectees)')
    .replace(/let redressement: Redressement \| null = null/, 'let redressement = null')

  return new Function(`${corps}; return resoudreMontants`)() as (
    total: number | null,
    sousTotal: number | null,
    taxes: number[],
  ) => {
    montant_ht: number | null
    montant_tva: number | null
    montant_ttc: number | null
    redressement: string | null
    coherent: boolean
  }
}

const resoudreMontants = resoudreMontantsDeLEdgeFunction()

describe('extract-piece / resoudreMontants (copie déployée)', () => {
  it('ne compte qu’une fois un total de TVA imprimé plusieurs fois', () => {
    // Le défaut qui a produit la pièce la plus fausse du corpus. Facture Apple réelle : 79,84 € est
    // imprimé trois fois sur le document (vérifié dans le texte OCR conservé en base), Textract émet
    // donc trois champs "TAX", et l'addition en aveugle donnait 239,52 € — trois fois trop, en
    // confiance « haute ».
    const resolu = resoudreMontants(479, 399.16, [79.84, 79.84, 79.84])
    expect(resolu.montant_tva).toBe(79.84)
    expect(resolu.montant_ht).toBe(399.16)
    expect(resolu.montant_ttc).toBe(479)
    expect(resolu.coherent).toBe(true)
  })

  it('ne compte qu’une fois même sans sous-total pour rattraper', () => {
    // Le cas précédent passe aussi sans déduplication, parce que la soustraction TTC − HT retombe de
    // toute façon sur le bon chiffre : deux mécanismes indépendants y donnent la même réponse. C'est
    // une bonne chose, mais ça rend la déduplication invisible au test. Ici Textract n'a pas étiqueté
    // de sous-total, il ne reste plus qu'elle : sans elle, la pièce part à 239,52 € de TVA pour
    // 239,48 € de HT, soit un taux de 100 %.
    const resolu = resoudreMontants(479, null, [79.84, 79.84, 79.84])
    expect(resolu.montant_tva).toBe(79.84)
    expect(resolu.montant_ht).toBe(399.16)
    expect(resolu.coherent).toBe(true)
  })

  it('additionne en revanche deux taux de TVA réellement différents', () => {
    // La contrepartie qu'il ne faut pas casser : une note de restaurant porte 10 % sur la nourriture
    // et 20 % sur l'alcool, en deux lignes distinctes. Les confondre avec un doublon amputerait la
    // TVA déductible. 100 € de nourriture (10 €) et 60 € d'alcool (12 €) : 160 € HT, 22 € de TVA.
    // Le taux moyen d'un ticket mixte reste toujours sous 20 % par construction, donc le contrôle de
    // légalité ne peut pas le rejeter à tort.
    const resolu = resoudreMontants(182, 160, [10, 12])
    expect(resolu.montant_tva).toBe(22)
    expect(resolu.coherent).toBe(true)
  })

  it('écarte la TVA détectée quand le total et le sous-total la contredisent', () => {
    // Deux lectures contre une. Sans sous-total lu, la déduplication seule ne suffirait pas ici :
    // les trois détections sont différentes.
    const resolu = resoudreMontants(479, 399.16, [79.84, 60, 99.68])
    expect(resolu.montant_tva).toBe(79.84)
    expect(resolu.redressement).toBe('arbitrage_soustraction')
  })

  it('traite un sous-total nul comme une lecture ratée, pas comme un HT', () => {
    // Facture INPI réelle : enregistrée 0 € de HT et 188,81 € de TVA, soit un taux infini. Croire ce
    // zéro donnait la totalité du montant en TVA. L'écarter fait retomber sur la soustraction, qui
    // rend les vrais chiffres.
    const resolu = resoudreMontants(188.81, 0, [10.17])
    expect(resolu.montant_ht).toBe(178.64)
    expect(resolu.montant_tva).toBe(10.17)
    expect(resolu.coherent).toBe(true)
    // Et pas seulement les bons chiffres : le zéro doit avoir été ÉCARTÉ, pas arbitré. Croire ce
    // zéro puis le corriger par arbitrage donne ici le même résultat final, ce qui masquerait la
    // différence — mais les deux chemins ne se ressemblent que sur ce cas-ci. Un sous-total nul
    // n'est pas une lecture qui perd un arbitrage, c'est une lecture qui n'a pas eu lieu.
    expect(resolu.redressement).toBeNull()
  })

  it('garde un sous-total nul quand le total l’est aussi', () => {
    // Une pièce réellement à zéro (facture soldée, avoir total) n'est pas une lecture ratée.
    const resolu = resoudreMontants(0, 0, [])
    expect(resolu.montant_ht).toBe(0)
    expect(resolu.montant_ttc).toBe(0)
  })

  it('redresse HT et TVA permutés, que l’arithmétique seule ne peut pas voir', () => {
    // Ticket Baoli réel : 69,60 + 480,40 = 550,00 boucle parfaitement, donc le contrôle de cohérence
    // ne voit rien. Seule la légalité trahit la permutation — 690 % de TVA n'existe pas, la lecture
    // inverse donne 14,5 %, normal pour un restaurant mêlant 10 % et 20 %.
    const resolu = resoudreMontants(550, 69.6, [480.4])
    expect(resolu.montant_ht).toBe(480.4)
    expect(resolu.montant_tva).toBe(69.6)
    expect(resolu.redressement).toBe('permutation_ht_tva')
    expect(resolu.coherent).toBe(true)
  })

  it('ne permute pas quand les deux sens sont également impossibles', () => {
    // 300 et 250 : aucun des deux sens ne donne un taux légal. Permuter ne ferait que déplacer
    // l'erreur en la rendant invisible — mieux vaut la laisser sortir incohérente.
    const resolu = resoudreMontants(550, 300, [250])
    expect(resolu.redressement).not.toBe('permutation_ht_tva')
    expect(resolu.coherent).toBe(false)
  })

  it('ne permute pas une pièce déjà correcte dont la TVA dépasse le HT sans le dépasser', () => {
    // Garde-fou de non-régression sur la frontière : 20,00 de HT et 4,00 de TVA est exactement au
    // taux plafond. Une borne mal posée (stricte au lieu d'inclusive) permuterait cette pièce-là.
    const resolu = resoudreMontants(24, 20, [4])
    expect(resolu.montant_ht).toBe(20)
    expect(resolu.montant_tva).toBe(4)
    expect(resolu.redressement).toBeNull()
    expect(resolu.coherent).toBe(true)
  })

  it('déduit la TVA par soustraction quand Textract n’isole aucune ligne de TVA', () => {
    // Comportement d'origine à préserver : une facture qui affiche un HT et un TTC sans ligne "TVA"
    // reconnue ne doit pas rester sans TVA déductible.
    const resolu = resoudreMontants(120, 100, [])
    expect(resolu.montant_tva).toBe(20)
    expect(resolu.redressement).toBeNull()
  })

  it('déduit le HT quand seuls le TTC et la TVA sont lus', () => {
    const resolu = resoudreMontants(120, null, [20])
    expect(resolu.montant_ht).toBe(100)
    expect(resolu.coherent).toBe(true)
  })

  it('rend une pièce incohérente plutôt que de l’arranger quand rien ne permet de trancher', () => {
    // Sans total lu, il n'y a aucun ancrage : on ne fabrique pas un TTC.
    const resolu = resoudreMontants(null, 100, [20])
    expect(resolu.montant_ttc).toBeNull()
    expect(resolu.coherent).toBe(false)
  })

  it('traite un avoir comme une pièce normale, signes compris', () => {
    // Un avoir est négatif de bout en bout. Le signe ne doit pas déclencher une permutation ni faire
    // échouer le contrôle de taux (20 % de -100 vaut -20, pas +20).
    const resolu = resoudreMontants(-120, -100, [-20])
    expect(resolu.montant_ht).toBe(-100)
    expect(resolu.montant_tva).toBe(-20)
    expect(resolu.coherent).toBe(true)
  })

  it('refuse une TVA de sens contraire au HT', () => {
    const resolu = resoudreMontants(80, 100, [-20])
    expect(resolu.coherent).toBe(false)
  })
})
