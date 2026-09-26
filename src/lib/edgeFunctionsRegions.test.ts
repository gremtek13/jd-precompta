import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Où partent les données quand elles quittent Supabase.
//
// Pourquoi ce test existe, et pourquoi il vit ici plutôt que dans une note : le contenu INTÉGRAL de
// chaque document déposé part chez AWS pour être lu (Textract), bordereaux de télétransmission
// compris — donc, sur un dossier de santé, des noms de patients. Son texte part ensuite au modèle
// (Bedrock) pour la citation des champs et la proposition de catégorie, et le contenu d'un dossier
// part à l'assistant. La région où cela a lieu décide si c'est un traitement en Europe ou un transfert
// hors UE. Voir RGPD.md §3 et §8.1.
//
// Ce que ce test peut garder, et ce qu'il ne peut pas. Il lit la VRAIE source déployée et vérifie que
// la région écrite dans le code est européenne. Il ne peut rien dire du secret `AWS_REGION` : s'il est
// défini à une autre valeur côté Supabase, il l'emporte, et aucun fichier de ce dépôt ne le sait. La
// moitié gouvernée par le code est gardée ; l'autre se remesure par `evaluer-extraction` appelée avec
// `limite: 0`, qui rend la région résolue sans rien facturer (RGPD.md §8.1).
//
// IL PART DE TOUTES LES FONCTIONS, PAS D'UNE LISTE (26/09/2026). Sa première version nommait les
// trois fonctions qu'elle gardait ; la quatrième qui parle à AWS, `proposer-categorie`, est arrivée
// sans qu'il la voie — il est resté vert. C'est la panne que ce dépôt connaît sous plusieurs noms :
// une liste d'inclusion ne contient que ce à quoi quelqu'un a pensé. Une fonction PARLE À AWS si elle
// importe l'un de ses SDK — lu sur l'import, jamais deviné du nom —, et chacune est alors tenue aux
// mêmes règles.

/** Les régions AWS situées dans l'Union européenne. Une région hors de cette liste est un transfert. */
const REGIONS_UE = ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2']

const DOSSIER = new URL('../../supabase/functions/', import.meta.url)

function sourceDe(fonction: string): string {
  return readFileSync(new URL(`${fonction}/index.ts`, DOSSIER), 'utf8')
}

/** Les lignes entièrement en commentaire sont retirées : un commentaire peut CITER une région. */
function sansCommentaires(source: string): string {
  return source.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
}

/**
 * Les classes de client AWS qu'une source importe : l'import par défaut du SDK Bedrock, et tout nom
 * en `…Client` importé d'un paquet `@aws-sdk/`. Vide : la fonction ne parle pas à AWS.
 */
function clientsAws(source: string): string[] {
  const noms: string[] = []
  for (const m of source.matchAll(/import\s+(\w+)\s+from\s+"npm:@anthropic-ai\/bedrock-sdk[^"]*"/g)) noms.push(m[1])
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s+"npm:@aws-sdk\/[^"]*"/g)) {
    for (const nom of m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!)) {
      if (/Client$/.test(nom)) noms.push(nom)
    }
  }
  return noms
}

/** L'argument de chaque `new <Client>(…)`, par parenthèses appariées : un objet s'écrit sur plusieurs lignes. */
function constructions(source: string, clients: string[]): string[] {
  const args: string[] = []
  for (const client of clients) {
    const motif = new RegExp(String.raw`new\s+${client}\s*\(`, 'g')
    for (const m of source.matchAll(motif)) {
      let profondeur = 1
      let i = m.index! + m[0].length
      const debut = i
      for (; i < source.length && profondeur > 0; i++) {
        if (source[i] === '(') profondeur++
        else if (source[i] === ')') profondeur--
      }
      args.push(source.slice(debut, i - 1))
    }
  }
  return args
}

const REPLI_SECRET = /^Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"$/

/**
 * La région qu'une expression désigne DANS LE CODE : un littéral, le repli du secret `AWS_REGION`, ou
 * un identifiant qui se résout à l'un des deux par SA déclaration `const` dans le fichier. Toute autre
 * forme rend null — une région qu'on ne sait pas lire est une région qu'on ne garde pas, et le test
 * échoue plutôt que de la laisser passer.
 */
function regionDe(expression: string, source: string, profondeur = 0): string | null {
  const e = expression.trim()
  const litteral = /^"([^"]+)"$/.exec(e)
  if (litteral) return litteral[1]
  const repli = REPLI_SECRET.exec(e)
  if (repli) return repli[1]
  if (profondeur < 2 && /^[A-Za-z_]\w*$/.test(e)) {
    const declarations = [...source.matchAll(new RegExp(String.raw`\bconst\s+${e}\s*=\s*([^\n]+)`, 'g'))]
    // Deux déclarations du même nom : laquelle alimente le client ne se lit pas sur le texte.
    if (declarations.length === 1) return regionDe(declarations[0][1], source, profondeur + 1)
  }
  return null
}

/** La région de chaque client construit : `awsRegion: …`, `region: …`, ou le raccourci `region`. */
function regionsDesClients(source: string): { argument: string; region: string | null }[] {
  const code = sansCommentaires(source)
  return constructions(code, clientsAws(code)).map((argument) => {
    const propriete = /\b(?:awsRegion|region)\s*:\s*([^,\n}]+)/.exec(argument)
    if (propriete) return { argument, region: regionDe(propriete[1], code) }
    // Le raccourci `{ region, credentials }` : une propriété qui porte le nom de la variable.
    if (/(^|[{,\s])region\s*(,|\n|})/.test(argument)) return { argument, region: regionDe('region', code) }
    return { argument, region: null }
  })
}

function fonctionsAws(): string[] {
  return readdirSync(DOSSIER, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/index.ts`, DOSSIER)))
    .map((d) => d.name)
    .filter((nom) => clientsAws(sansCommentaires(sourceDe(nom))).length > 0)
    .sort()
}

describe('régions des Edge Functions qui sortent de Supabase', () => {
  const FONCTIONS = fonctionsAws()

  it('voit toutes les fonctions qui parlent à AWS — sinon « aucune faute » et « aveugle » se confondent', () => {
    // Le PLANCHER, et seulement lui : une fonction de plus est vue par le balayage sans qu'on l'ajoute
    // ici. Celles-ci doivent y être tant qu'elles existent — un balayage qui cesserait de lire les
    // imports rendrait zéro fonction, et toutes les règles ci-dessous passeraient à vide.
    expect(FONCTIONS).toEqual(expect.arrayContaining(['agent-comptable', 'evaluer-extraction', 'extract-piece', 'proposer-categorie']))
  })

  for (const fonction of FONCTIONS) describe(fonction, () => {
    const source = sourceDe(fonction)
    const code = sansCommentaires(source)

    it('nomme la région de CHAQUE client AWS qu’elle construit, et cette région se lit dans le code', () => {
      // Un client construit sans région prend celle de son SDK : pour Bedrock, le secret `AWS_REGION`,
      // et à défaut `us-east-1` (vérifié dans le paquet 0.33.4). Sur un projet recréé dont le secret
      // n'est pas encore posé, les textes partiraient aux États-Unis sans qu'aucun fichier ne change.
      const regions = regionsDesClients(source)
      expect(regions.length, `aucun client AWS construit dans ${fonction} — garde-fou à remettre à jour`).toBeGreaterThan(0)
      for (const { argument, region } of regions) {
        expect(region, `région illisible dans « new …(${argument.trim().slice(0, 80)}…) »`).not.toBeNull()
      }
    })

    it('ne fait sortir les données que vers une région européenne', () => {
      for (const { region } of regionsDesClients(source)) expect(REGIONS_UE).toContain(region)
      // Filet large : aucune chaîne en forme de région hors UE, où que ce soit dans le code — un
      // paramètre alimenté ailleurs échappe à la résolution par nom, pas à celui-ci.
      const litteraux = [...code.matchAll(/["'`]((?:us|eu|ap|sa|ca|me|af|il|mx)(?:-gov)?-[a-z]+-\d)["'`]/g)].map((m) => m[1])
      for (const region of litteraux) expect(REGIONS_UE, `région « ${region} » écrite dans ${fonction}`).toContain(region)
    })

    it('ne lit jamais le secret AWS_REGION sans un repli européen écrit à côté', () => {
      // Sans repli, la région serait tout entière celle du secret : la moitié gardée par le code
      // serait vide, et ce test resterait vert sur une fonction qui n'en garde plus rien.
      const lectures = code.match(/Deno\.env\.get\("AWS_REGION"\)/g)?.length ?? 0
      const replis = [...code.matchAll(/Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"/g)].map((m) => m[1])
      expect(replis.length, `${fonction} lit AWS_REGION sans repli`).toBe(lectures)
      for (const region of replis) expect(REGIONS_UE).toContain(region)
    })
  })

  it('fait retomber sur la MÊME région toutes les fonctions qui lisent AWS_REGION', () => {
    // Le cœur du garde-fou, et ce qu'aucune règle par fonction ne dit à elle seule. La lecture
    // (`extract-piece`), sa mesure (`evaluer-extraction`) et la proposition de catégorie
    // (`proposer-categorie`) lisent le même secret : un repli différent enverrait une partie des
    // documents ailleurs, et le registre RGPD annoncerait une région pour deux. Et une mesure faite
    // ailleurs que la production ne mesure pas la production — la disponibilité d'un modèle Bedrock
    // est PAR RÉGION (`agent-comptable` câble eu-west-1 en dur parce que son modèle n'y était proposé
    // que là, et c'est pourquoi il ne lit pas le secret).
    const lecteurs = FONCTIONS.filter((f) => /Deno\.env\.get\("AWS_REGION"\)/.test(sansCommentaires(sourceDe(f))))
    expect(lecteurs).toEqual(expect.arrayContaining(['evaluer-extraction', 'extract-piece', 'proposer-categorie']))
    const replis = lecteurs.flatMap((f) =>
      [...sansCommentaires(sourceDe(f)).matchAll(/Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"/g)].map((m) => m[1]))
    expect(new Set(replis).size).toBe(1)
  })
})

describe('le balayage lui-même', () => {
  // Des sources SYNTHÉTIQUES : sur le dépôt, tout est correct, donc rien n'y prouve que le balayage
  // sait encore trouver une faute.
  const avecBedrock = (corps: string) => `import AnthropicBedrock from "npm:@anthropic-ai/bedrock-sdk@0.33.4"\n${corps}`

  it('reconnaît les clients AWS à leur import, et rien d’autre', () => {
    expect(clientsAws(avecBedrock(''))).toEqual(['AnthropicBedrock'])
    expect(clientsAws('import { TextractClient, AnalyzeDocumentCommand } from "npm:@aws-sdk/client-textract@3"')).toEqual(['TextractClient'])
    expect(clientsAws('import { createClient } from "npm:@supabase/supabase-js@2"')).toEqual([])
  })

  it('refuse un client construit sans région', () => {
    const source = avecBedrock('const c = new AnthropicBedrock({\n  awsAccessKey: Deno.env.get("AWS_ACCESS_KEY_ID"),\n})')
    expect(regionsDesClients(source)).toEqual([expect.objectContaining({ region: null })])
  })

  it('refuse une région qui ne se lit pas dans le code', () => {
    const source = avecBedrock('const c = new AnthropicBedrock({ awsRegion: payload.region })')
    expect(regionsDesClients(source)[0].region).toBeNull()
  })

  it('suit un identifiant jusqu’à sa déclaration, et le raccourci `region`', () => {
    expect(regionsDesClients(avecBedrock('const REGION = Deno.env.get("AWS_REGION") ?? "eu-central-1"\nnew AnthropicBedrock({ awsRegion: REGION })'))[0].region)
      .toBe('eu-central-1')
    const textract = 'import { TextractClient } from "npm:@aws-sdk/client-textract@3"\nconst region = "eu-west-3"\nnew TextractClient({\n  region,\n  credentials: {},\n})'
    expect(regionsDesClients(textract)[0].region).toBe('eu-west-3')
  })

  it('ne lit pas une région dans un commentaire', () => {
    const source = avecBedrock('new AnthropicBedrock({\n  // awsRegion: "eu-west-1",\n  awsAccessKey: "x",\n})')
    expect(regionsDesClients(source)[0].region).toBeNull()
  })
})
