import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHAMPS_CITES, verifierCitations, type CitationsChamps } from './extractionChamps'

// `evaluer-extraction` est auto-portée (aucun import de `src/`) et redéclare donc `verifierCitations`.
// Ce garde-fou EXÉCUTE la copie déployée contre l'originale, plutôt que de comparer deux textes :
// une dérive de comportement est ce qui coûte, un reformatage ne coûte rien.
//
// CE QU'UNE DÉRIVE COÛTERAIT ICI : la copie décide de ce qui est MESURÉ, l'originale de ce qui sera
// RETENU en production. Deux règles de vérification différentes, et l'essai qui autorise la bascule
// n'aurait pas mesuré ce que la bascule va faire — un feu vert donné sur autre chose que la chose.

function copieDeployee() {
  const source = readFileSync(
    new URL('../../supabase/functions/evaluer-extraction/index.ts', import.meta.url), 'utf8')

  const debut = source.indexOf('// ── DÉBUT COPIE extractionChamps')
  const fin = source.indexOf('// ── FIN COPIE extractionChamps')
  expect(debut, 'bornes de la copie introuvables dans evaluer-extraction — garde-fou à remettre à jour')
    .toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)

  const bloc = source.slice(debut, fin)
  // Un renommage doit casser bruyamment : le bloc peut se reformater, il ne peut pas perdre son nom.
  expect(bloc, '`verifierCitations` absente de la copie déployée').toContain('function verifierCitations(')

  return new Function(`${bloc}; return verifierCitations`)() as typeof verifierCitations
}

const deployee = copieDeployee()

const TEXTE = [
  'CABINET VERDIER & ASSOCIÉS',
  'Facture du 3 mars 2025',
  'Échéance : 2 avril 2025',
  'Total HT 3 400,00 €',
  'TVA 20 % 680,00 €',
  'Net à payer 4 080,00 €',
].join('\n')

describe('evaluer-extraction / verifierCitations (copie déployée)', () => {
  // La batterie porte sur les FRONTIÈRES du module — là où deux implémentations « qui font la même
  // chose » divergent : les blancs insécables, l'asymétrie montant/tiers, les accents, et la
  // distinction entre « null » et « chaîne vide ».
  const CAS: CitationsChamps[] = [
    { tiers: 'CABINET VERDIER & ASSOCIÉS', date: '3 mars 2025', totalTtc: '4 080,00 €' },
    { tiers: 'Cabinet Verdier & Associés' },                       // casse
    { tiers: 'CABINET VERDIER & ASSOCIES' },                       // accent retiré → rejet
    { tiers: 'CABINETVERDIER' },                                   // soudure → rejet
    { totalTtc: '4080,00 €' },                                     // milliers retirés → retenu
    { totalHt: '3 400,00 €' },                                     // espace ordinaire vs insécable
    { totalTva: '700,00 €' },                                      // composé → rejet
    { date: '2 avril 2025' },                                      // échéance : présente, donc retenue
    { tiers: null, date: null },                                   // réponse, pas rejet
    { tiers: '' },                                                 // chaîne vide
    { tiers: '   ' },
    {},
    { totalTtc: '4 080,00 €', totalHt: '3 400,00 €', totalTva: '680,00 €' },
  ]

  it('porte la MÊME liste de champs — une batterie tenue à la main ne l’aurait pas vu', () => {
    // CE CONTRÔLE EST NÉ D'UN ÉCHEC DU GARDE LUI-MÊME. `devise` a été ajoutée à `src/lib` sans
    // l'être à la copie déployée, et la batterie ci-dessous est restée VERTE : aucun de ses cas ne
    // portait cette clé, donc les deux implémentations « étaient d'accord » sur des questions qu'on
    // ne leur posait pas. C'est la panne que ce dépôt connaît déjà sous un autre nom — une liste
    // d'inclusion tenue à la main ne contient que ce à quoi quelqu'un a pensé.
    const source = readFileSync(
      new URL('../../supabase/functions/evaluer-extraction/index.ts', import.meta.url), 'utf8')
    const declaree = source.match(/const CHAMPS_CITES = \[([^\]]+)\]/)?.[1]
    expect(declaree, '`CHAMPS_CITES` introuvable dans la copie déployée').toBeTruthy()
    const champs = [...declaree!.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1])
    expect(champs).toEqual([...CHAMPS_CITES])
  })

  it('exerce CHAQUE champ déclaré, y compris ceux ajoutés après ce test', () => {
    // La batterie ci-dessous est écrite à la main pour viser les frontières ; celle-ci est DÉRIVÉE
    // de `CHAMPS_CITES`, donc un champ ajouté demain est exercé sans que personne y pense.
    for (const champ of CHAMPS_CITES) {
      for (const citation of ['CABINET VERDIER & ASSOCIÉS', '4\u00a0080,00 €', 'introuvable ici', '', null]) {
        const cas = { [champ]: citation } as CitationsChamps
        expect(deployee(cas, TEXTE), `divergence sur ${champ} = ${JSON.stringify(citation)}`)
          .toEqual(verifierCitations(cas, TEXTE))
      }
    }
  })

  it('rend exactement le même résultat que src/lib sur toute la batterie', () => {
    for (const cas of CAS) {
      expect(deployee(cas, TEXTE), `divergence sur ${JSON.stringify(cas)}`)
        .toEqual(verifierCitations(cas, TEXTE))
    }
  })

  it('et la batterie DISTINGUE bien les deux issues — sinon elle ne prouverait rien', () => {
    // Un jeu de cas qui ne produirait que des retenues (ou que des rejets) passerait au vert avec
    // une copie qui retient tout. Même exigence que pour les tests de montants de superpdp-emit.
    const resultats = CAS.map((cas) => verifierCitations(cas, TEXTE))
    expect(resultats.some((r) => Object.keys(r.retenues).length > 0)).toBe(true)
    expect(resultats.some((r) => r.rejetees.length > 0)).toBe(true)
  })
})
