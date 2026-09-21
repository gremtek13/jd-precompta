import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Où partent les données quand elles quittent Supabase.
//
// Pourquoi ce test existe, et pourquoi il vit ici plutôt que dans une note : le contenu INTÉGRAL de
// chaque document déposé part chez AWS pour être lu (Textract), bordereaux de télétransmission
// compris — donc, sur un dossier de santé, des noms de patients. La région où cette lecture a lieu
// décide si c'est un traitement en Europe ou un transfert hors UE. Voir RGPD.md §3 et §8.1.
//
// Ce que ce test peut garder, et ce qu'il ne peut pas. Il lit la VRAIE source déployée et vérifie
// que la région de repli écrite dans le code est européenne. Il ne peut rien dire du secret
// `AWS_REGION` : s'il est défini à une autre valeur côté Supabase, il l'emporte, et aucun fichier de
// ce dépôt ne le sait. La moitié gouvernée par le code est gardée ; l'autre est une vérification
// humaine, nommée comme telle dans RGPD.md.
//
// Volontairement fragile, comme les autres garde-fous posés sur ces fonctions auto-portées :
// déplacer ou reformater l'appel le casse bruyamment, ce qui vaut mieux qu'une région qui glisse
// sans que personne ne le remarque.

/** Les régions AWS situées dans l'Union européenne. Une région hors de cette liste est un transfert. */
const REGIONS_UE = ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2']

function sourceDe(fonction: string): string {
  return readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')
}

describe('régions des Edge Functions qui sortent de Supabase', () => {
  it('fait lire les documents par Textract dans une région européenne', () => {
    const source = sourceDe('extract-piece')
    const replis = [...source.matchAll(/Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"/g)].map((m) => m[1])

    // Au moins un appel, sinon le motif a changé et ce test ne garde plus rien — c'est exactement le
    // cas qu'il faut voir échouer.
    expect(replis.length, "aucun repli `AWS_REGION` trouvé dans extract-piece — le garde-fou doit être remis à jour").toBeGreaterThan(0)
    for (const region of replis) expect(REGIONS_UE).toContain(region)
  })

  it('fait tourner toutes les lectures Textract dans la MÊME région', () => {
    // `extract-piece` construit plusieurs clients AWS (lecture synchrone et lecture asynchrone des
    // PDF multi-pages). Deux replis différents enverraient une partie des documents ailleurs, et le
    // registre RGPD annoncerait une région pour deux.
    const source = sourceDe('extract-piece')
    const replis = [...source.matchAll(/Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"/g)].map((m) => m[1])
    expect(new Set(replis).size).toBe(1)
  })

  it('fait tourner l’essai de mesure d’extraction en Europe', () => {
    // `evaluer-extraction` envoie le TEXTE OCR intégral de chaque pièce au modèle — donc, sur un
    // dossier de santé, des noms de patients. Un essai n'est pas une excuse : il fait sortir les
    // mêmes données que la production, et il doit les faire sortir au même endroit.
    const source = sourceDe('evaluer-extraction')
    const replis = [...source.matchAll(/Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"/g)].map((m) => m[1])
    expect(replis.length, "aucun repli `AWS_REGION` trouvé dans evaluer-extraction — le garde-fou doit être remis à jour").toBeGreaterThan(0)
    for (const region of replis) expect(REGIONS_UE).toContain(region)
  })

  it('fait tourner la mesure dans la MÊME région que la production', () => {
    // Le cœur du garde-fou, et ce qu'aucun des deux tests ci-dessus ne dit à lui seul : une mesure
    // faite ailleurs que la production ne mesure pas la production. La disponibilité d'un modèle
    // Bedrock est PAR RÉGION — `agent-comptable` câble eu-west-1 en dur parce que son modèle n'y
    // était proposé que là — donc un essai concluant dans une autre région ne décide rien. Les deux
    // fonctions doivent lire le même secret et retomber sur le même repli.
    const replisDe = (fonction: string) =>
      [...sourceDe(fonction).matchAll(/Deno\.env\.get\("AWS_REGION"\)\s*\?\?\s*"([^"]+)"/g)].map((m) => m[1])
    expect(new Set([...replisDe('extract-piece'), ...replisDe('evaluer-extraction')]).size).toBe(1)
  })

  it('fait tourner l’assistant comptable en Europe', () => {
    // Le contenu d'un dossier part au modèle : même enjeu, même exigence. La région est écrite en
    // clair dans agent-comptable (pas de secret), donc ce test-là garde tout.
    const source = sourceDe('agent-comptable')
    const regions = [...source.matchAll(/awsRegion:\s*"([^"]+)"|region:\s*"(eu-[^"]+)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter(Boolean)
    expect(regions.length, "aucune région trouvée dans agent-comptable — le garde-fou doit être remis à jour").toBeGreaterThan(0)
    for (const region of regions) expect(REGIONS_UE).toContain(region)
  })
})
