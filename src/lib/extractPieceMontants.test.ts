import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMontantBancaire } from './csv'

// `supabase/functions/extract-piece/index.ts` est auto-porté (déployé à part, il ne peut rien
// importer de src/lib) et redéclare donc sa propre lecture de montant, reprise de
// `parseMontantBancaire`. Toute duplication finit par diverger en silence — c'est le défaut corrigé
// trois fois dans ce dépôt. Ce test lit la *vraie* source de la fonction déployée et exécute sa copie :
// c'est le seul garde-fou possible tant que le fichier doit rester auto-porté.
//
// Il est volontairement fragile : renommer ou reformater `parseAmount` le casse bruyamment. C'est
// préférable à une copie qui dérive sans que rien ne le dise.
function parseAmountDeLEdgeFunction(): (raw?: string) => number | null {
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')
  const debut = source.indexOf('function parseAmount(')
  expect(debut, "`function parseAmount(` introuvable dans l'Edge Function — le garde-fou doit être remis à jour").toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `parseAmount` introuvable').toBeGreaterThan(debut)

  const corps = source
    .slice(debut, fin + 2)
    .replace('function parseAmount(raw?: string): number | null {', 'function parseAmount(raw) {')
  return new Function(`${corps}; return parseAmount`)() as (raw?: string) => number | null
}

const parseAmount = parseAmountDeLEdgeFunction()

describe('extract-piece / parseAmount (copie déployée)', () => {
  it('lit les trois séparateurs de milliers rencontrés selon l’émetteur', () => {
    // L'ancienne version ne remplaçait que la première virgule : « 1.234,56 » devenait 1,23 €, soit
    // une facture de 1 234,56 € enregistrée à 1,23 €. Huit pièces en base dépassent 1 000 €.
    expect(parseAmount('1 234,56 €')).toBe(1234.56)
    expect(parseAmount('1.234,56 €')).toBe(1234.56)
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('1234,56')).toBe(1234.56)
    expect(parseAmount('1 234 567,89')).toBe(1234567.89)
  })

  it('reconnaît le signe, y compris rejeté en fin ou entre parenthèses', () => {
    // Un avoir enregistré en positif devient une charge. Une pièce négative existe déjà en base.
    expect(parseAmount('-214,21')).toBe(-214.21)
    expect(parseAmount('45,20-')).toBe(-45.2)
    expect(parseAmount('(45,20)')).toBe(-45.2)
    expect(parseAmount('+120,00')).toBe(120)
  })

  it('tolère les lettres que Textract laisse, contrairement à la version CSV', () => {
    // Différence assumée entre les deux copies : Textract rend le texte imprimé sur la facture, où
    // la devise est souvent écrite en toutes lettres. Côté CSV, refuser « 12abc » est au contraire
    // voulu — une cellule qui n'est pas un montant ne doit pas compter comme telle.
    expect(parseAmount('120,00 EUR')).toBe(120)
    expect(parseAmount('12,34 TTC')).toBe(12.34)
    expect(parseMontantBancaire('120,00 EUR')).toBeNull()
  })

  it('refuse ce qui n’est pas un montant', () => {
    for (const rien of ['', 'abc', 'TOTAL', '-', '€', undefined]) {
      expect(parseAmount(rien)).toBeNull()
    }
  })

  it('rend le même résultat que `parseMontantBancaire` sur tout ce que les deux acceptent', () => {
    // Le contrat que la duplication doit tenir : sur un montant écrit sans lettre, les deux copies
    // ne peuvent pas diverger.
    for (const montant of ['1 234,56', '1.234,56', '1,234.56', '1234,56', '0,00', '45,20-', '(45,20)', '-1 500,00', '20846,47']) {
      expect(parseAmount(montant), `divergence sur « ${montant} »`).toBe(parseMontantBancaire(montant))
    }
  })
})
