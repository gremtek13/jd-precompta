import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Le budget mural d'`extract-piece`.
//
// Pourquoi ce test existe. Le 21/09/2026, un PDF de plusieurs pages a dépassé le budget de sondage
// FIXE de 50 s hérité de la version `AnalyzeExpense` : l'extraction a été perdue alors que Textract
// travaillait encore, et le fichier venait d'être payé. Rien ne pouvait le voir — un budget fixe est
// juste tant qu'aucun document n'est assez long, et le premier qui l'est ne prévient pas.
//
// Ce que ce test garde : l'ARITHMÉTIQUE du budget, et le fait que la borne de sondage se DÉDUISE de
// l'entrée dans le gestionnaire plutôt que d'être reposée en dur dans la boucle. Les deux sont des
// nombres et des formes, donc lisibles depuis le dépôt.
//
// Ce qu'il ne peut PAS garder, et c'est annoncé comme pour les autres garde-fous de cette
// fonction : la valeur réelle du mur chez Supabase — 150 s au plan free, 400 s au-delà. Elle vit
// dans la plateforme et aucun fichier du dépôt ne la connaît. Passer au plan payant permettrait de
// relever `MUR_PLATEFORME_MS`, et ce test devra alors être modifié sciemment, ce qui est le but.

const SOURCE = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

/** La valeur d'une constante `const NOM = 123_456` de la source déployée. */
function constante(nom: string): number {
  const trouve = SOURCE.match(new RegExp(`const ${nom} = ([0-9_]+)`))
  expect(trouve, `constante ${nom} introuvable — le garde-fou doit être remis à jour`).not.toBeNull()
  return Number(trouve![1].replaceAll('_', ''))
}

/** Le corps de `detecterTextePdfAsync`, de sa signature au `finally` qui la clôt. */
function corpsLectureAsync(): string {
  const debut = SOURCE.indexOf('async function detecterTextePdfAsync')
  expect(debut, 'detecterTextePdfAsync introuvable — le garde-fou doit être remis à jour').toBeGreaterThan(-1)
  return SOURCE.slice(debut, SOURCE.indexOf('Deno.serve', debut))
}

describe('budget mural d’extract-piece', () => {
  it('laisse de quoi lire AVANT le mur de la plateforme', () => {
    const mur = constante('MUR_PLATEFORME_MS')
    const marge = constante('MARGE_REPONSE_MS')
    const citation = constante('BUDGET_CITATION_MS')

    // 150 s est le mur du plan free, celui sur lequel tourne ce projet (voir « Problèmes connus » :
    // l'organisation est sur le plan free, et c'est ce qui décide aussi des sauvegardes). Au-delà,
    // la requête est coupée sans message et le texte OCR déjà facturé est perdu.
    expect(mur).toBeLessThanOrEqual(150_000)

    // Ce qui reste pour la lecture doit rester la part principale : c'est l'étage qui n'est pas
    // facultatif. Un budget de citation qui grossirait jusqu'à manger la lecture inverserait le
    // contrat des deux étages sans que rien ne le dise.
    const budgetLecture = mur - marge - citation
    expect(budgetLecture).toBeGreaterThan(0)
    expect(budgetLecture).toBeGreaterThan(citation)
  })

  it('déduit la borne de sondage de l’entrée dans le gestionnaire', () => {
    // La forme fautive est un délai posé DANS la boucle (`Date.now() + 50_000`) : il ignore le temps
    // déjà consommé et ne connaît pas le mur. La borne doit venir de l'appelant, qui seul sait
    // quand la requête a commencé.
    const corps = corpsLectureAsync()
    expect(corps).toMatch(/while \(Date\.now\(\) < finLecture\)/)
    expect(
      corps,
      'un délai fixe est reposé dans la lecture asynchrone — c’est exactement le défaut du 21/09/2026',
    ).not.toMatch(/Date\.now\(\) \+ \d/)
  })

  it('passe cette borne depuis le gestionnaire, et garde la citation pour la fin', () => {
    // La borne de lecture réserve la citation ; la citation ne part que s'il reste son budget. Les
    // deux calculs doivent exister : sans le second, une lecture qui consomme tout son budget
    // lancerait quand même une citation qui franchirait le mur, et ferait perdre le texte OCR.
    expect(SOURCE).toMatch(
      /const finLecture = debut \+ MUR_PLATEFORME_MS - MARGE_REPONSE_MS - BUDGET_CITATION_MS/,
    )
    expect(SOURCE).toMatch(/detecterTextePdfAsync\(fileBytes, textract, region, finLecture\)/)
    expect(SOURCE).toMatch(
      /const resteApresOcr = debut \+ MUR_PLATEFORME_MS - MARGE_REPONSE_MS - Date\.now\(\)/,
    )
    expect(SOURCE).toMatch(/resteApresOcr >= BUDGET_CITATION_MS/)
  })

  it('journalise le COMPTE des rejets de citation, jamais leurs valeurs', () => {
    // Une citation rejetée est une chaîne tirée du document, donc possiblement un nom de patient.
    // Le compte répond à la seule question utile — le contrat de citation tient-il ? — sans faire
    // entrer de donnée personnelle dans un journal que trois outils relisent.
    const journal = SOURCE.match(/console\.log\(\s*`\[extract-piece\] citation [\s\S]*?\)\n/)?.[0] ?? ''
    expect(journal, 'la ligne de journal de citation est introuvable').not.toBe('')
    expect(journal).toMatch(/citation\.rejetees\.length/)
    expect(
      journal,
      'le journal doit porter le COMPTE des rejets, jamais les citations elles-mêmes',
    ).not.toMatch(/citation\.rejetees(?!\.length)/)
  })
})
