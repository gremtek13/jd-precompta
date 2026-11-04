import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { executerModule } from '../test/compilationSeparee'

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

  const morceaux: string[] = ['type ClassificationDocument = string']
  // Les listes de marqueurs se recopient telles quelles : ce sont elles qui décident, la fonction ne
  // fait que les essayer dans l'ordre.
  for (const nom of ['const MARQUEURS_RELEVE_BANCAIRE', 'const MARQUEURS_SOLDE', 'const MARQUEURS_RELEVE_ACTIVITE',
                     'const MARQUEURS_SITUATION_EPARGNE', 'const MARQUEURS_RECETTE']) {
    const debut = source.indexOf(nom)
    expect(debut, `\`${nom}\` introuvable dans l'Edge Function — le garde-fou doit être remis à jour`).toBeGreaterThan(-1)
    const fin = source.indexOf('\n]\n', debut)
    expect(fin, `fin de \`${nom}\` introuvable`).toBeGreaterThan(debut)
    morceaux.push(source.slice(debut, fin + 2))
  }
  // Les marqueurs d'une ligne (l'appel de cotisation sociale, relecture du 04/11/2026), jusqu'à leur fin de ligne.
  for (const nom of ['const ORGANISMES_SOCIAUX', 'const APPEL_OU_ECHEANCIER', 'const COTISATIONS_SOCIALES']) {
    const debut = source.indexOf(nom)
    expect(debut, `\`${nom}\` introuvable dans l'Edge Function — le garde-fou doit être remis à jour`).toBeGreaterThan(-1)
    morceaux.push(source.slice(debut, source.indexOf('\n', debut) + 1))
  }
  // Le titre d'une facture : le bloc copié de src/lib/titreDeFacture.ts, entre ses bornes (titreDeFactureCopie.test.ts
  // garde qu'il est au caractère près celui de src/lib).
  const debutTitre = source.indexOf('// ── DÉBUT COPIE titreDeFacture ')
  const finTitre = source.indexOf('// ── FIN COPIE titreDeFacture ')
  expect(debutTitre, 'le bloc `titreDeFacture` est introuvable dans l\'Edge Function').toBeGreaterThan(-1)
  expect(finTitre).toBeGreaterThan(debutTitre)
  morceaux.push(source.slice(debutTitre, finTitre))

  const entete = 'function classifieDocument(lignes: string[]): ClassificationDocument {'
  const debut = source.indexOf(entete)
  expect(debut, '`classifieDocument` introuvable dans l\'Edge Function').toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `classifieDocument` introuvable').toBeGreaterThan(debut)
  morceaux.push(`export ${source.slice(debut, fin + 2)}`)

  // Transpilée, et non plus évaluée telle quelle : le bloc copié porte ses annotations de type.
  return executerModule<{ classifieDocument: (lignes: string[]) => string }>(morceaux.join('\n')).classifieDocument
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

// LA RELECTURE DU 04/11/2026 (D4 ; PIECES-Q3, sur la recommandation) : un mot croisé dans le texte envoyait une vraie
// facture dans Documents, hors de la 2035 et sans justificatif pour le débit qui la paie. Les cinq scénarios de la relecture
// (`outils/relecture-pieces/lecture.scenarios.test.ts`), changés en gardes du comportement corrigé. Textes reconstruits,
// fictifs.
describe('classifieDocument — le nom que se donne une facture l’emporte (D4)', () => {
  const cas: [string, string[]][] = [
    ['la prime d’une RC professionnelle, « attestation » jointe', [
      'ASSURANCES FICTIVES SA', 'FACTURE N° 2025-0412', 'Date : 12/01/2025', 'Responsabilité civile professionnelle',
      'Prime annuelle TTC 412,50 €', 'Votre attestation d’assurance est jointe à ce courrier',
    ]],
    ['une formation continue, avec son attestation de présence', [
      'ORGANISME DE FORMATION FICTIF', 'Facture n° F-778', 'Date de facture : 03/04/2025', 'Formation plaies et cicatrisation',
      'Total TTC 380,00 €', 'Une attestation de formation vous sera remise',
    ]],
    ['les honoraires d’un expert-comptable qui citent l’URSSAF', [
      'CABINET COMPTABLE FICTIF', 'Facture n° 25-118', 'Date : 28/02/2025', 'Tenue et déclarations sociales (URSSAF, CARPIMKO)',
      'Total TTC 540,00 €',
    ]],
    ['la cotisation annuelle à l’Ordre, un « appel de cotisation » sans organisme social', [
      'ORDRE NATIONAL FICTIF', 'Appel de cotisation 2025', 'Date : 15/01/2025', 'Montant à régler 75,00 €',
    ]],
    ['une facture de téléphone qui rappelle le « solde précédent »', [
      'OPERATEUR FICTIF', 'Facture du 05/03/2025', 'Solde précédent 0,00 €', 'Abonnement mobile 19,99 €', 'Total TTC 19,99 €',
    ]],
    ['« Votre facture », sous un en-tête de six lignes', [
      'OPERATEUR FICTIF', '12 rue Fictive', '13000 MARSEILLE', 'SIRET 000 000 000 00000', 'Mme PRATICIENNE FICTIVE',
      '1 avenue Fictive', 'Votre facture du mois de mars', 'Montant total 32,90 €', 'Attestation de conformité jointe',
    ]],
    ['une note d’honoraires, apostrophe typographique', [
      'CABINET FICTIF', 'Note d’honoraires n° 7', 'Total 1 200,00 €', 'Échéancier de paiement en trois fois',
    ]],
  ]
  for (const [nom, lignes] of cas) {
    it(`${nom} → « facture », donc Justificatifs`, () => {
      expect(classifieDocument(lignes)).toBe('facture')
    })
  }

  it('un bordereau reste une recette, même titré « Facture » en colonne', () => {
    expect(classifieDocument(['Bordereau de Télétransmission', 'Facture', 'Total 364,75'])).toBe('facture_vente')
  })

  it('un vrai relevé reste un relevé : le nom du compte, ses « FACTURE CARTE », ou le solde sans titre de facture', () => {
    expect(classifieDocument(['BANQUE FICTIVE', 'RELEVE DE COMPTE', 'FACTURE N° 12 PAYEE', 'Solde 1 234,56'])).toBe('releve_bancaire')
    expect(classifieDocument(['BANQUE FICTIVE', 'FACTURE CARTE DU 12/03 PHARMACIE', 'SOLDE PRECEDENT 1 234,56'])).toBe('releve_bancaire')
    expect(classifieDocument(['BANQUE FICTIVE', 'FACTURE CB 14/03 CARREFOUR 12,30', 'SOLDE CREDITEUR 1 000,00'])).toBe('releve_bancaire')
    expect(classifieDocument(['BANQUE FICTIVE', 'Solde précédent 1 234,56', 'Nouveau solde 1 000,00'])).toBe('releve_bancaire')
  })

  it('un vrai appel de cotisation reste une cotisation : l’organisme et l’appel, ou l’échéancier', () => {
    expect(classifieDocument(['CARPIMKO', 'Échéancier 2025', 'Mensualité 312,00'])).toBe('cotisation')
    expect(classifieDocument(['CAISSE FICTIVE', 'Vos cotisations provisionnelles 2025', '1 200,00'])).toBe('cotisation')
  })

  it('une vraie attestation reste une attestation, même au-delà des premières lignes', () => {
    const entete = ['CAISSE PRIMAIRE', '1 rue Fictive', '13000 MARSEILLE', 'Mme PRATICIENNE FICTIVE', '2 rue Fictive',
      '13000 MARSEILLE', 'Dossier suivi par', 'Référence 0000', 'Le 02/01/2025', 'Objet : votre demande', 'Madame,']
    expect(classifieDocument([...entete, 'ATTESTATION DE DROITS', 'valable jusqu’au 31/12/2025'])).toBe('attestation')
    // URSSAF sans appel ni échéancier : l'attestation de vigilance n'est plus prise pour un appel de cotisation.
    expect(classifieDocument(['URSSAF PROVENCE', 'ATTESTATION DE VIGILANCE', 'à jour au 31/12/2024'])).toBe('attestation')
  })

  it('le titre ne vaut qu’en tête de ligne, dans les dix premières, et avec un montant imprimé', () => {
    // « Facture » au milieu d'une phrase ne fait pas une facture : l'attestation reste.
    expect(classifieDocument(['ASSUREUR FICTIF', 'ATTESTATION D’ASSURANCE', 'Le paiement de la facture 2025 vaut 412,50 €'])).toBe('attestation')
    // Un titre sans aucun montant : le mot seul ne suffit pas, le reste du texte décide comme hier.
    expect(classifieDocument(['FACTURE PROFORMA', 'Attestation de présence'])).toBe('attestation')
    // Au-delà des dix premières lignes, ce n'est plus le titre.
    const longue = Array.from({ length: 10 }, (_, i) => `ligne ${i}`)
    expect(classifieDocument([...longue, 'Facture n° 1', 'Total 10,00 €', 'attestation jointe'])).toBe('attestation')
  })
})
