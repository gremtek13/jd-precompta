import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// `calculerLigne` est PURE, mais elle vit dans `factures.ts`, qui importe `supabase.ts` pour
// `attribuerNumeroFacture` — et `supabase.ts` LÈVE au chargement quand les variables
// d'environnement manquent. L'import suffit donc à faire échouer le fichier entier, avant qu'une
// seule assertion ne tourne (voir CLAUDE.md, « le faux client est requis même pour une fonction
// pure »). Le piège est qu'un `.env` peut exister en local et pas en CI : sans ce faux client, le
// test passerait ici et casserait là-bas.
vi.mock('./supabase', () => ({ supabase: {} }))

const { calculerLigne } = await import('./factures')

// `superpdp-emit` est auto-portée (déployée à part, elle ne peut rien importer de `src/lib`) et
// redéclare donc le calcul des montants d'une ligne de facture. CLAUDE.md nomme cette duplication
// depuis le début — « ex. calcul de montants de ligne de facture » — mais aucun des huit tests-garde
// du dépôt ne la couvrait : ils gardent `extract-piece` (montants, dates, classification) et
// `receive-email` (orientation), pas celle-ci.
//
// CE QU'UNE DÉRIVE COÛTERAIT. La copie de `src/lib` décide de ce qui est ENREGISTRÉ en base ; celle
// de l'Edge Function décide de ce qui est TRANSMIS à une plateforme de dématérialisation agréée
// DGFiP. Deux arrondis différents, et la facture que le cabinet a sous les yeux n'est plus celle que
// l'administration reçoit — sur un document légal, sans qu'aucun écran ne puisse le voir.
//
// **La paire ne se trouve pas par son nom** : `calculerLigne` d'un côté, `calculerLigneMontants` de
// l'autre, et des formes de retour différentes. C'est la règle du projet appliquée à la lettre —
// chercher la VALEUR, pas le nom de la fonction.

function calculerLigneMontantsDeployee() {
  const source = readFileSync(
    new URL('../../supabase/functions/superpdp-emit/index.ts', import.meta.url), 'utf8')

  const entete = 'function calculerLigneMontants(quantite: number, prixUnitaireHt: number, tauxTva: number) {'
  const debut = source.indexOf(entete)
  expect(debut, "`calculerLigneMontants` introuvable dans superpdp-emit — le garde-fou doit être remis à jour")
    .toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `calculerLigneMontants` introuvable').toBeGreaterThan(debut)

  const corps = source.slice(debut, fin + 2)
    .replace(entete, 'function calculerLigneMontants(quantite, prixUnitaireHt, tauxTva) {')
  return new Function(`${corps}; return calculerLigneMontants`)() as
    (q: number, p: number, t: number) => { ht: number; tva: number }
}

const deployee = calculerLigneMontantsDeployee()

describe('superpdp-emit / montants de ligne (copie déployée)', () => {
  // La batterie porte sur les BORNES d'arrondi, là où deux implémentations qui « font la même
  // chose » divergent : le demi-centime, les taux français réels, et les quantités fractionnaires.
  const CAS: [number, number, number][] = [
    [1, 100, 20], [1, 100, 10], [1, 100, 5.5], [1, 100, 2.1], [1, 100, 0],
    [3, 33.33, 20], [7, 14.29, 5.5], [1, 0.005, 20], [1, 0.015, 20], [2, 0.005, 20],
    [1.5, 19.99, 20], [0.25, 80, 10], [12, 8.33, 2.1], [1, 1234.56, 20],
    // Un AVOIR porte des quantités négatives (voir FactureAvoirModal) : `Math.round` arrondit le
    // demi vers +∞, donc -0,005 et +0,005 ne se comportent pas en miroir. Les deux copies doivent
    // partager cette asymétrie, pas seulement le cas facile.
    [-1, 100, 20], [-3, 33.33, 20], [-1, 0.005, 20], [-1.5, 19.99, 5.5],
    [0, 100, 20],
  ]

  it('rend exactement les mêmes HT et TVA que `calculerLigne` de src/lib', () => {
    for (const [q, p, t] of CAS) {
      const ici = calculerLigne(q, p, t)
      const laBas = deployee(q, p, t)
      const cas = `quantité ${q} × ${p} € à ${t} %`
      expect(laBas.ht, `${cas} — HT`).toBe(ici.montant_ht)
      expect(laBas.tva, `${cas} — TVA`).toBe(ici.montant_tva)
    }
  })

  // L'Edge Function ne rend PAS de TTC : elle laisse Super PDP le recomposer depuis HT + TVA.
  // Ce test fige que cette recomposition redonne bien le TTC enregistré en base — sinon le total
  // du document transmis différerait de celui de la facture, au centime.
  it('donne, recomposé, le même TTC que celui enregistré', () => {
    for (const [q, p, t] of CAS) {
      const ici = calculerLigne(q, p, t)
      const laBas = deployee(q, p, t)
      expect(Math.round((laBas.ht + laBas.tva) * 100) / 100, `quantité ${q} × ${p} € à ${t} %`)
        .toBe(ici.montant_ttc)
    }
  })

  // LA TVA S'ARRONDIT SUR LE HT DÉJÀ ARRONDI, et ces cas-là seuls le prouvent.
  //
  // La première version de ce test posait « 3 × 33,335 € à 20 % » en croyant distinguer les deux
  // formules. Elle ne distinguait rien : l'arrondi du HT ne déplace la TVA que de 0,001 au plus,
  // qui disparaît au centime — sauf quand il fait franchir un demi-centime. La mutation « TVA
  // calculée sur le produit NON arrondi » a donc SURVÉCU à ce test, qui prétendait pourtant garder
  // exactement cela.
  //
  // Les cas ci-dessous sont trouvés par recherche exhaustive sur les quatre taux français et les
  // prix au millième (ce qu'un cabinet saisit sur un tarif dégressif), pas devinés. Ils écartent
  // les deux formules d'un centime entier.
  const DEMI_CENTIME: [number, number, number][] = [
    [1, 0.175, 20], [3, 0.075, 20], [5, 0.045, 20], [9, 0.075, 20], [13, 1.325, 20],
  ]

  it('arrondit la TVA sur le HT DÉJÀ arrondi, des deux côtés', () => {
    for (const [q, p, t] of DEMI_CENTIME) {
      const ici = calculerLigne(q, p, t)
      const surBrut = Math.round(q * p * (t / 100) * 100) / 100
      const cas = `quantité ${q} × ${p} € à ${t} %`
      // Le cas distingue bien les deux formules — sans quoi il ne prouverait rien.
      expect(surBrut, `${cas} — cas non distinctif, à remplacer`).not.toBe(ici.montant_tva)
      // Et la copie déployée suit la bonne.
      expect(deployee(q, p, t).tva, cas).toBe(ici.montant_tva)
    }
  })
})
