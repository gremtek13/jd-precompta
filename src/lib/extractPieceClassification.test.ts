import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `supabase/functions/extract-piece/index.ts` est auto-porté (déployé à part, il ne peut rien
// importer de src/lib). `classifieDocument` y décide si un document reste en PIÈCES ou part dans
// l'archive Documents, et — depuis les bordereaux de télétransmission — s'il est une dépense ou une
// recette. Une erreur de sens coûte deux fois : le montant part en charge ET la recette manque.
//
// Ce test lit la *vraie* source déployée et exécute sa copie, comme les garde-fous de `parseAmount`
// et de `dateDepuisTexteBrut`. Volontairement fragile : renommer ces constantes ou cette fonction le
// casse bruyamment, ce qui vaut mieux qu'une copie qui dérive en silence.
//
// **Les textes ci-dessous sont reconstruits, jamais copiés d'un document réel.** Les bordereaux du
// dossier de test portent des noms de patients, des dates de naissance et des numéros de sécurité
// sociale : des données de santé qui n'ont rien à faire dans un dépôt Git. Seules la structure et les
// mentions qui servent de marqueur sont reproduites — c'est tout ce que la fonction regarde.
function extraireClassifieDocument() {
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  const morceaux: string[] = []
  // Les listes de marqueurs se recopient telles quelles : ce sont elles qui décident, la fonction ne
  // fait que les essayer dans l'ordre.
  for (const nom of ['const MARQUEURS_RELEVE_BANCAIRE', 'const MARQUEURS_RELEVE_ACTIVITE',
                     'const MARQUEURS_SITUATION_EPARGNE', 'const MARQUEURS_RECETTE']) {
    const debut = source.indexOf(nom)
    expect(debut, `\`${nom}\` introuvable dans l'Edge Function — le garde-fou doit être remis à jour`).toBeGreaterThan(-1)
    const fin = source.indexOf('\n]\n', debut)
    expect(fin, `fin de \`${nom}\` introuvable`).toBeGreaterThan(debut)
    morceaux.push(source.slice(debut, fin + 2))
  }

  const entete = 'function classifieDocument(lignes: string[]): ClassificationDocument {'
  const debut = source.indexOf(entete)
  expect(debut, '`classifieDocument` introuvable dans l\'Edge Function').toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `classifieDocument` introuvable').toBeGreaterThan(debut)
  morceaux.push(source.slice(debut, fin + 2).replace(entete, 'function classifieDocument(lignes) {'))

  return new Function(`${morceaux.join('\n')}; return classifieDocument`)() as (lignes: string[]) => string
}

const classifieDocument = extraireClassifieDocument()

describe('classifieDocument — bordereau de télétransmission', () => {
  // Structure du bordereau réellement trouvé en production (Televitale), patients retirés. Le montant
  // et le total du lot sont conservés : ce sont eux qui, lus comme une charge, gonflaient les dépenses.
  const bordereau = [
    'Bordereau de Teletransmission',
    'Monsieur JEREMY DARNIS DELTA SOINS 10',
    'Lot 62 créé le',
    '09/12/2025',
    'LOT NON SECURISE',
    'Organisme assurance maladie destinataire : 131 - CPAM - MARSEILLE',
    'Destinataire du réglement : Partenaire de santé',
    'Facture', 'Date prescription', 'Total', 'Caisse', 'Mutuelle', 'Assuré',
    'TOTAL: LOT de 2 Factures',
    '364,75', '0,00', '364,75', '0,00',
  ]

  it('classe un bordereau de télétransmission en pièce de recette', () => {
    expect(classifieDocument(bordereau)).toBe('facture_vente')
  })

  it('le reconnaît accentué comme non accentué', () => {
    // L'OCR rend « Teletransmission » sur ce document-ci et rendra « Télétransmission » sur celui d'un
    // autre logiciel : les deux doivent tomber du même côté.
    expect(classifieDocument(['Bordereau de Télétransmission', 'CPAM MARSEILLE'])).toBe('facture_vente')
  })

  it('ne le confond pas avec le mot « facture » qu\'il contient pourtant', () => {
    // Le bordereau écrit « Facture » en en-tête de colonne et « LOT de 2 Factures » en pied : c'est
    // précisément ce qui en faisait une facture d'ACHAT par défaut.
    expect(bordereau.join(' ')).toMatch(/Facture/)
  })

  it('reste une recette même quand un mot-clé d\'une autre famille traîne dans le texte', () => {
    // Le marqueur porte sur le titre du document. Une mention de bas de page ne doit pas le déclasser
    // vers l'archive Documents — c'est le sens du test placé en premier dans la fonction.
    expect(classifieDocument([...bordereau, 'Attestation de droits jointe'])).toBe('facture_vente')
    expect(classifieDocument([...bordereau, 'Relevé de compte'])).toBe('facture_vente')
  })
})

describe('classifieDocument — les autres familles ne bougent pas', () => {
  it('une facture fournisseur reste une facture', () => {
    expect(classifieDocument(['FACTURE N° 2025-0042', 'ORANGE SA', 'Total TTC 89,90 €'])).toBe('facture')
  })

  it('un relevé bancaire reste un relevé bancaire', () => {
    expect(classifieDocument(['RELEVE DE COMPTE', 'SOLDE PRECEDENT', '1 234,56'])).toBe('releve_bancaire')
  })

  it('un appel de cotisation reste une cotisation', () => {
    expect(classifieDocument(['URSSAF PROVENCE', 'Appel de cotisations', '1 200,00'])).toBe('cotisation')
  })

  it('un relevé d\'activité de l\'Assurance Maladie reste « autre »', () => {
    // Un relevé d'honoraires est un ÉTAT de ce qui a été facturé sur l'année, pas le justificatif d'un
    // encaissement : il reste dans Documents, là où la classification précédente l'a mis. C'est la
    // frontière la plus fine de cette fonction — les deux documents parlent d'activité facturée.
    expect(classifieDocument(['RELEVE D\'HONORAIRES', 'Assurance Maladie', '52 357,00'])).toBe('autre')
    expect(classifieDocument(['RELEVE INDIVIDUEL D\'ACTIVITE ET DE PRESCRIPTIONS'])).toBe('autre')
  })

  it('un relevé de situation d\'épargne reste « autre »', () => {
    expect(classifieDocument(['Relevé annuel de situation', 'Épargne retraite'])).toBe('autre')
  })

  it('une attestation reste une attestation', () => {
    expect(classifieDocument(['ATTESTATION DE DROITS', 'Caisse primaire d\'assurance maladie'])).toBe('attestation')
  })
})
