import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Ce que les Edge Functions ont le DROIT de faire chez AWS.
//
// Pourquoi ce test existe. Le 21/09/2026, `extract-piece` déployée en version 43 est passée de
// `AnalyzeExpense` à `DetectDocumentText` : le code était juste, les tests verts, et l'aller-retour
// de déploiement prouvait que les 1 174 lignes étaient arrivées au caractère près. Le premier dépôt
// réel a rendu 500 — l'utilisateur IAM `jd-precompta-textract` n'était autorisé que sur les trois
// actions `*ExpenseAnalysis` / `AnalyzeExpense`, pas sur les trois nouvelles. Changer d'API AWS
// change la SURFACE D'AUTORISATION, et rien dans ce dépôt ne le disait.
//
// C'est un troisième membre d'une famille déjà connue ici : les tests lisent le fichier du dépôt et
// pas la copie déployée (donc verts sur du code que la production n'exécute pas) ; un commit n'est
// pas un déploiement ; et maintenant — un déploiement n'est pas une autorisation.
//
// Ce que ce test PEUT garder : la liste des actions AWS que le code appelle. Toute commande ajoutée,
// retirée ou changée de service fait virer ce fichier au rouge, donc oblige à se poser la question
// « la policy IAM autorise-t-elle celle-là ? » AVANT le déploiement plutôt qu'après le premier 500.
//
// Ce qu'il ne PEUT PAS garder, et c'est annoncé comme pour le contrôle de suppression de
// `rls.sql` : la policy elle-même. Elle vit chez AWS, aucun fichier de ce dépôt ne la connaît, et la
// vérifier depuis ici est impossible (cet environnement n'appelle jamais AWS). La moitié gouvernée
// par le code est gardée ; l'autre est une vérification humaine.
//
// ET IL Y A UN TROU PLUS FIN QUE « LA POLICY », QU'IL FAUT NOMMER PLUTÔT QUE LAISSER DEVINER : une
// policy IAM cadre une action par RESSOURCE, et ce test ne compte que des ACTIONS. Changer de modèle
// Bedrock laisse l'action rigoureusement identique — `bedrock:InvokeModel` des deux côtés — tout en
// changeant l'ARN visé. Une policy restreinte à un modèle refuserait donc le nouveau avec un test
// VERT, ce qui est exactement la forme du défaut que ce fichier a été écrit pour empêcher, revenu
// par une porte que la liste d'actions ne regarde pas.
//
// Le 21/09/2026, la bascule Sonnet 4.6 → Haiku 4.5 est passée dans cet angle mort, et elle n'a été
// couverte que PAR CHANCE : le harnais de mesure (`evaluer-extraction`) avait appelé Haiku avec les
// MÊMES identifiants AWS et dans la MÊME région que la production, donc un refus IAM s'y serait
// montré d'abord. C'est une raison de plus de garder ce harnais aligné sur la production plutôt
// qu'une commodité — voir `edgeFunctionsRegions.test.ts`.
//
// Règle qui en découle : **changer de modèle demande un APPEL RÉEL avec les identifiants de la
// production, jamais un test vert.** Aucun contrôle de ce dépôt ne peut s'y substituer.
//
// La liste attendue vit DANS CE TEST et non dans les fonctions, délibérément : une constante posée
// à côté de l'appel serait mise à jour dans la même édition que l'appel, le test resterait vert et
// la policy resterait fausse — le contrôle tautologique que ce dépôt connaît déjà. Ici, ajouter une
// commande passe forcément par un test ROUGE, et c'est ce rouge qui est le rappel.

/**
 * Les actions IAM que la policy de l'utilisateur `jd-precompta-textract` doit autoriser.
 *
 * Toute modification de cette liste s'accompagne d'une modification de la policy côté AWS — c'est
 * la seule chose que ce fichier demande, et la seule qu'il ne peut pas vérifier.
 */
const ACTIONS_ATTENDUES = [
  // L'assistant comptable, la mesure d'extraction et l'étage 2 de `extract-piece` appellent tous
  // trois le même modèle par Bedrock. Sur un profil d'inférence (`eu.anthropic.…`), l'autorisation
  // porte à la fois sur le profil et sur les modèles sous-jacents.
  'bedrock:InvokeModel',
  // Le chemin PDF met le document dans un seau S3 le temps de la lecture asynchrone, puis l'efface.
  's3:DeleteObject',
  's3:PutObject',
  // Étage 1 : l'OCR seul. Le chemin synchrone (images) et le chemin asynchrone (PDF multi-pages)
  // ne demandent PAS les mêmes actions — autoriser l'un sans l'autre casse la moitié des dépôts.
  'textract:DetectDocumentText',
  'textract:GetDocumentTextDetection',
  'textract:StartDocumentTextDetection',
]

function fonctions(): string[] {
  const racine = new URL('../../supabase/functions/', import.meta.url)
  return readdirSync(racine, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function sourceDe(fonction: string): string {
  return readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')
}

/**
 * Les actions IAM qu'une source d'Edge Function appelle.
 *
 * Le service n'est pas deviné d'après le nom de la commande : il est lu sur l'import dont elle
 * vient (`@aws-sdk/client-textract` → `textract`). Une commande envoyée sans import identifié est
 * rendue telle quelle, préfixée de `?`, pour que l'appelant la fasse échouer bruyamment — une forme
 * non reconnue doit faire ÉCHOUER le scanner, jamais le rendre silencieusement aveugle.
 */
export function actionsAwsDe(source: string): string[] {
  const service = new Map<string, string>()
  for (const imp of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"npm:@aws-sdk\/client-([a-z0-9-]+)@/g)) {
    for (const nom of imp[1].split(',').map((n) => n.trim())) {
      if (nom.endsWith('Command')) service.set(nom, imp[2])
    }
  }

  const actions = new Set<string>()
  for (const appel of source.matchAll(/new\s+(\w+Command)\s*\(/g)) {
    const commande = appel[1]
    const nom = commande.replace(/Command$/, '')
    const s = service.get(commande)
    actions.add(s ? `${s}:${nom}` : `?:${nom}`)
  }

  // Bedrock ne passe pas par `@aws-sdk` mais par le SDK Anthropic, qui n'expose aucune « commande » :
  // c'est l'appel `messages.create` qui consomme `bedrock:InvokeModel`. Sans flux (`messages.stream`),
  // l'action de streaming n'est pas demandée — et ne doit pas être autorisée pour rien.
  if (/from "npm:@anthropic-ai\/bedrock-sdk@/.test(source)) {
    if (/messages\.create\s*\(/.test(source)) actions.add('bedrock:InvokeModel')
    if (/messages\.stream\s*\(/.test(source)) actions.add('bedrock:InvokeModelWithResponseStream')
  }

  return [...actions].sort()
}

describe('autorisations AWS des Edge Functions', () => {
  it('n’appelle que les actions IAM déclarées ici', () => {
    // Le balayage part du DOSSIER et non d'une liste tenue à la main : une Edge Function ajoutée
    // demain qui appelle AWS est attrapée sans que personne ait à y penser. Même principe que
    // `rls.sql`, qui part de `pg_class`, et que le scanner de lectures paginées.
    const trouvees = new Set<string>()
    for (const fonction of fonctions()) {
      for (const action of actionsAwsDe(sourceDe(fonction))) trouvees.add(action)
    }

    expect(
      [...trouvees].sort(),
      'la surface IAM du code a changé : mettre à jour la policy de l’utilisateur `jd-precompta-textract` chez AWS, PUIS cette liste',
    ).toEqual([...ACTIONS_ATTENDUES].sort())
  })

  it('sait dire de quel service vient chaque commande', () => {
    // Une commande dont l'import n'a pas été reconnu ressortirait en `?:…`. C'est le cas où le
    // scanner a cessé de comprendre la source : il doit se signaler, pas se taire.
    for (const fonction of fonctions()) {
      const inconnues = actionsAwsDe(sourceDe(fonction)).filter((a) => a.startsWith('?:'))
      expect(inconnues, `commandes AWS de provenance inconnue dans ${fonction}`).toEqual([])
    }
  })

  it('voit une action d’un service qu’il n’a jamais rencontré', () => {
    // Auto-contrôle : « le scanner rend zéro » et « le scanner est aveugle » se ressemblent trop.
    // On lui donne une source SYNTHÉTIQUE portant un service absent du dépôt, dans la forme exacte
    // qu'il doit reconnaître — et une commande sans import, qu'il doit refuser de nommer.
    const synthetique = `
import { ComprehendClient, DetectEntitiesCommand } from "npm:@aws-sdk/client-comprehend@3"
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3"
const r = await comprehend.send(new DetectEntitiesCommand({ Text: t }))
await s3.send(new PutObjectCommand({ Bucket: b, Key: k }))
await autre.send(new VenuDAilleursCommand({}))
`
    expect(actionsAwsDe(synthetique)).toEqual(['?:VenuDAilleurs', 'comprehend:DetectEntities', 's3:PutObject'])
  })

  it('ne demande le streaming Bedrock que si le code stream vraiment', () => {
    // Le cas symétrique du précédent : un scanner qui crierait au loup sur tout appel Bedrock
    // ferait autoriser une action de plus que nécessaire, ce qui est exactement ce qu'une policy
    // ne doit pas faire.
    const sansFlux = 'import x from "npm:@anthropic-ai/bedrock-sdk@0.33.4"\nawait client.messages.create({})'
    const avecFlux = 'import x from "npm:@anthropic-ai/bedrock-sdk@0.33.4"\nawait client.messages.stream({})'
    expect(actionsAwsDe(sansFlux)).toEqual(['bedrock:InvokeModel'])
    expect(actionsAwsDe(avecFlux)).toEqual(['bedrock:InvokeModelWithResponseStream'])
  })
})
