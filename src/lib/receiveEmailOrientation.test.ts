import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { orientationDe, type ClassificationDocument } from './extraction'

// `supabase/functions/receive-email/index.ts` est auto-portée : elle ne peut rien importer de
// `src/lib` et redéclare donc sa propre copie de `orientationDe`. Ce test lit la *vraie* source
// déployée, en extrait cette copie, et vérifie qu'elle rend exactement la même chose que l'originale
// sur TOUTES les classifications.
//
// Il existe parce que la copie a divergé en production. Les bordereaux de télétransmission sont
// devenus des recettes ; `depot.ts` et `importFichiers.ts` ont été unifiés derrière `orientationDe`,
// mais ce troisième chemin est resté sur son test binaire `classification === "facture"`. Un
// bordereau reçu par e-mail partait donc vers `documents_divers` avec `categorie: "facture_vente"`,
// que le CHECK de la table refuse : insertion en échec, pièce jointe perdue, fichier orphelin dans le
// stockage. Une règle dupliquée se corrige dans toutes ses copies le même jour — ce test est ce qui
// le rend vrai la prochaine fois.
//
// Volontairement fragile : renommer la fonction ou ses types casse le test bruyamment, ce qui vaut
// mieux qu'une copie qui redérive en silence.
function extraireOrientationDeLEdgeFunction() {
  const source = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')

  const entete = 'function orientationDe(classification: ClassificationDocument): Orientation {'
  const debut = source.indexOf(entete)
  expect(debut, "`orientationDe` introuvable dans receive-email — le garde-fou doit être remis à jour").toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `orientationDe` introuvable').toBeGreaterThan(debut)

  const corps = source.slice(debut, fin + 2).replace(entete, 'function orientationDe(classification) {')
  return new Function(`${corps}; return orientationDe`)() as (c: string) => unknown
}

// La liste vient du type de l'Edge Function, pas d'une constante recopiée à la main : si une
// classification est ajoutée à `extract-piece` sans être déclarée ici, le test la réclame.
function classificationsDeclarees(): string[] {
  const source = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')
  const ligne = source.split('\n').find((l) => l.trim().startsWith('classification: "'))
  expect(ligne, "la ligne `classification:` d'ExtractionPiece est introuvable").toBeDefined()
  return [...ligne!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
}

const orientationEmail = extraireOrientationDeLEdgeFunction()
const CLASSIFICATIONS = classificationsDeclarees()

describe('receive-email — la copie de orientationDe ne diverge pas', () => {
  it('déclare exactement les mêmes classifications que l’application', () => {
    // Le défaut d'origine commence ici : l'union de l'Edge Function était restée à quatre valeurs
    // alors que la classification en rendait six. Un type qui ment ne protège de rien.
    const attendues: ClassificationDocument[] =
      ['releve_bancaire', 'cotisation', 'attestation', 'autre', 'facture', 'facture_vente']
    expect([...CLASSIFICATIONS].sort()).toEqual([...attendues].sort())
  })

  it('rend la même orientation que `orientationDe` sur chaque classification', () => {
    for (const c of CLASSIFICATIONS) {
      expect(orientationEmail(c), `divergence sur « ${c} »`).toEqual(orientationDe(c as ClassificationDocument))
    }
  })

  it('range un bordereau de télétransmission en Pièces, en vente', () => {
    // Le cas réel : ni dans Documents (la recette serait perdue), ni en achat (le montant partirait
    // en charge). C'est le chemin par lequel un praticien transfère son bordereau depuis sa boîte.
    expect(orientationEmail('facture_vente')).toEqual({ destination: 'pieces', type_piece: 'vente' })
  })

  it('n’envoie jamais vers documents_divers une catégorie que le CHECK refuse', () => {
    // La contrainte réelle de la table : categorie ∈ (releve_bancaire, cotisation, attestation, autre).
    // C'est elle qui faisait échouer l'insertion, donc perdre la pièce jointe.
    const AUTORISEES = new Set(['releve_bancaire', 'cotisation', 'attestation', 'autre'])
    for (const c of CLASSIFICATIONS) {
      const o = orientationEmail(c) as { destination: string; categorie?: string }
      if (o.destination === 'documents') {
        expect(AUTORISEES.has(o.categorie!), `« ${o.categorie} » violerait le CHECK de documents_divers`).toBe(true)
      }
    }
  })
})
