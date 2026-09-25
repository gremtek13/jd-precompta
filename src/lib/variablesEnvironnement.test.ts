import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Les variables d'environnement que le code lit, et l'inventaire qui les nomme.
//
// Pourquoi ce test existe. Le plan de reprise disait, des secrets à reposer après un sinistre :
// « `RESEND_API_KEY`, les identifiants Bedrock ». Le code en lisait davantage à poser à la main, et
// la liste en oubliait quatre — dont `AWS_TEXTRACT_BUCKET`, sans lequel aucun PDF ne se lit, et
// `RESEND_WEBHOOK_SECRET`, sans lequel aucun e-mail entrant n'est accepté. Une reprise menée d'après
// ce plan rendait une application qui démarre, se connecte, et ne lit plus les documents : la panne
// qui ressemble à un dossier calme. Trouvé le 25/09/2026 en évaluant ce qu'une installation sur site
// demanderait — la liste des secrets est la première chose qu'une autre installation doit connaître,
// et elle n'existait nulle part en entier.
//
// Le test part du CODE, pas de la liste, comme `rls.sql` part de `pg_class` : toute lecture de
// `Deno.env` dans une Edge Function et toute lecture d'`import.meta.env` dans l'application doivent
// figurer dans l'inventaire de PLAN_DE_REPRISE.md, avec les fonctions qui la lisent. Une ligne que
// plus rien ne lit le fait échouer aussi — une liste qui se remplit de noms morts cesse d'être crue.
// Et une lecture écrite sous une forme qu'il ne sait pas lire (`Deno.env.get(nom)`,
// `Deno.env.toObject()`) le fait ÉCHOUER plutôt que de passer inaperçue : le nom n'y est pas lisible,
// et ce dépôt a payé plusieurs fois des scanners devenus aveugles en silence.
//
// Ce qu'il ne peut PAS garder, annoncé comme partout où ce dépôt touche à la production : les
// VALEURS réellement posées dans le projet. Elles vivent dans le tableau de bord Supabase, qu'aucun
// outil de ce dépôt ne lit. Les noms sont gardés ; les valeurs se vérifient à la main.

/**
 * Ce que Supabase pose lui-même dans l'environnement de chaque fonction, dans le cloud comme en
 * auto-hébergé. C'est un fait de la PLATEFORME et non du dépôt, ce qui lui donne le droit d'être
 * écrit ici : une variable rangée à tort parmi celles-ci passerait pour « rien à poser » et
 * manquerait le jour de la reprise — le sens dangereux de l'erreur, que le test refuse.
 */
const FOURNIES_PAR_SUPABASE = ['SUPABASE_ANON_KEY', 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']

/** Ce que Vite définit lui-même : jamais dans un fichier `.env`, toujours défini. */
const INTEGREES_VITE = ['BASE_URL', 'DEV', 'MODE', 'PROD', 'SSR']

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

/**
 * Retire les lignes ENTIÈREMENT en commentaire, jamais un commentaire de fin de ligne — la règle des
 * autres scanners de ce dépôt. Sans elle, un commentaire qui parle d'`import.meta.env` (il y en a un
 * dans `comptes.ts`) passerait pour une lecture de forme inconnue.
 */
function sansLignesDeCommentaire(source: string): string {
  return source
    .split('\n')
    .filter((ligne) => !/^\s*(\/\/|\/\*|\*)/.test(ligne))
    .join('\n')
}

interface Lectures {
  noms: Set<string>
  /** Accès à l'environnement dont le nom n'est pas lisible. Tout autre chose que zéro est une faute. */
  inconnues: number
}

/**
 * Les variables qu'une source d'Edge Function lit par `Deno.env.get("NOM")`.
 *
 * Le motif porte sur le TEXTE ENTIER et non ligne à ligne : un appel coupé après sa parenthèse — le
 * formatage normal de ce dépôt dès qu'une ligne s'allonge — reste lu. Des balayages de ce dépôt se
 * sont fait prendre neuf fois par un retour à la ligne ; un cas synthétique garde celui-ci.
 * `process.env` compte comme un accès : Deno le fournit pour les modules npm, et il lirait
 * l'environnement sans passer par la seule forme reconnue.
 */
function lecturesDeno(source: string): Lectures {
  const texte = sansLignesDeCommentaire(source)
  const noms = new Set<string>()
  let reconnues = 0
  for (const m of texte.matchAll(/\bDeno\.env\.get\(\s*(["'`])([A-Z][A-Z0-9_]*)\1\s*,?\s*\)/g)) {
    noms.add(m[2])
    reconnues++
  }
  const acces = texte.match(/\bDeno\.env\b|\bprocess\.env\b/g)?.length ?? 0
  return { noms, inconnues: acces - reconnues }
}

/** Les variables que l'application web lit par `import.meta.env.NOM`. */
function lecturesVite(source: string): Lectures {
  const texte = sansLignesDeCommentaire(source)
  const noms = new Set<string>()
  let reconnues = 0
  for (const m of texte.matchAll(/\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    noms.add(m[1])
    reconnues++
  }
  const acces = texte.match(/\bimport\.meta\.env\b/g)?.length ?? 0
  return { noms, inconnues: acces - reconnues }
}

const EXTENSIONS_SOURCE = /\.(ts|tsx|js|mjs)$/

/** Une Edge Function est un dossier : toutes ses sources comptent, pas seulement `index.ts`. */
function sourcesDesFonctions(): Map<string, string> {
  const dossiers = readdirSync(racine('supabase/functions/'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const sources = new Map<string, string>()
  for (const fonction of dossiers) {
    const fichiers = (readdirSync(racine(`supabase/functions/${fonction}/`), { recursive: true }) as string[])
      .filter((f) => EXTENSIONS_SOURCE.test(f))
      .sort()
    sources.set(fonction, fichiers.map((f) => readFileSync(racine(`supabase/functions/${fonction}/${f}`), 'utf8')).join('\n'))
  }
  return sources
}

/** Les sources de l'application livrée : tout `src/`, hors tests et hors outillage de test. */
function sourcesDeLApplication(): Map<string, string> {
  const fichiers = (readdirSync(racine('src/'), { recursive: true }) as string[])
    .filter((f) => EXTENSIONS_SOURCE.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('test/') && !f.startsWith('test\\'))
    .sort()
  return new Map(fichiers.map((f) => [f, readFileSync(racine(`src/${f}`), 'utf8')]))
}

interface Inventaire {
  /** Variable → fonctions déclarées dans la colonne « Lue par ». */
  aPoser: Map<string, string[]>
  /** Variables inscrites deux fois dans le tableau. */
  doublons: string[]
  fournies: string[]
  web: string[]
}

const MARQUEUR_DEBUT = "<!-- DÉBUT DE L'INVENTAIRE"
const MARQUEUR_FIN = "<!-- FIN DE L'INVENTAIRE"

/** Les noms en `code` d'un paragraphe du bloc qui commence par `etiquette`, retours à la ligne compris. */
function nomsDuParagraphe(bloc: string, etiquette: string): string[] {
  const paragraphes = bloc.split(/\n\s*\n/).filter((p) => p.trimStart().startsWith(etiquette))
  if (paragraphes.length !== 1) throw new Error(`paragraphe « ${etiquette} » trouvé ${paragraphes.length} fois dans l'inventaire`)
  return [...paragraphes[0].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]).sort()
}

function inventaireDe(plan: string): Inventaire {
  const debuts = plan.split(MARQUEUR_DEBUT).length - 1
  const fins = plan.split(MARQUEUR_FIN).length - 1
  if (debuts !== 1 || fins !== 1) throw new Error(`marqueurs de l'inventaire : ${debuts} début(s), ${fins} fin(s) — il en faut un de chaque`)
  const bloc = plan.slice(plan.indexOf(MARQUEUR_DEBUT), plan.indexOf(MARQUEUR_FIN))
  if (bloc.length === 0) throw new Error("la fin de l'inventaire précède son début")

  const aPoser = new Map<string, string[]>()
  const doublons: string[] = []
  for (const ligne of bloc.split('\n')) {
    const rang = ligne.match(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|([^|]*)\|/)
    if (!rang) continue
    if (aPoser.has(rang[1])) doublons.push(rang[1])
    aPoser.set(rang[1], [...rang[2].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).sort())
  }
  return {
    aPoser,
    doublons,
    fournies: nomsDuParagraphe(bloc, '**Fournies par Supabase**'),
    web: nomsDuParagraphe(bloc, '**Côté application web**'),
  }
}

function clesDuFichierEnv(chemin: string): string[] {
  return readFileSync(racine(chemin), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim())
    .sort()
}

/** Variable → fonctions qui la lisent, sur tout le dépôt. */
function lecteursParVariable(sources: Map<string, string>): Map<string, string[]> {
  const lecteurs = new Map<string, string[]>()
  for (const [fonction, source] of sources) {
    for (const nom of lecturesDeno(source).noms) lecteurs.set(nom, [...(lecteurs.get(nom) ?? []), fonction].sort())
  }
  return lecteurs
}

const fonctions = sourcesDesFonctions()
const inventaire = inventaireDe(readFileSync(racine('PLAN_DE_REPRISE.md'), 'utf8'))

describe('variables d’environnement des Edge Functions', () => {
  it('voit bien les fonctions et leurs lectures — sinon « rien à signaler » voudrait dire « aveugle »', () => {
    expect(fonctions.size).toBeGreaterThanOrEqual(13)
    const lues = new Set([...fonctions.values()].flatMap((s) => [...lecturesDeno(s).noms]))
    // Les trois variables de la plateforme sont lues par presque toutes les fonctions : un scanner
    // qui ne les voit plus ne voit plus rien.
    for (const nom of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) expect(lues).toContain(nom)
    expect(inventaire.aPoser.size).toBeGreaterThan(0)
  })

  it('lit l’environnement sous une seule forme, dont le nom se lit', () => {
    const fautes = [...fonctions]
      .map(([fonction, source]) => ({ fonction, inconnues: lecturesDeno(source).inconnues }))
      .filter((f) => f.inconnues !== 0)
    expect(fautes, 'écrire `Deno.env.get("NOM")` avec le nom en toutes lettres, pour que l’inventaire puisse le suivre').toEqual([])
  })

  it('ne lit aucune variable que l’inventaire du plan de reprise ne nomme pas, et l’inventaire aucune que le code ne lit pas', () => {
    const lues = [...lecteursParVariable(fonctions).keys()].sort()
    const inventoriees = [...inventaire.aPoser.keys(), ...inventaire.fournies].sort()
    expect(inventaire.doublons).toEqual([])
    expect(inventoriees).toEqual(lues)
  })

  it('dit vrai dans la colonne « Lue par »', () => {
    const lecteurs = lecteursParVariable(fonctions)
    for (const [nom, declares] of inventaire.aPoser) {
      expect(declares, `« Lue par » de ${nom}`).toEqual(lecteurs.get(nom) ?? [])
    }
  })

  it('ne fait passer aucun secret à poser à la main pour une variable fournie par Supabase', () => {
    for (const nom of inventaire.fournies) expect(FOURNIES_PAR_SUPABASE, `${nom} n’est pas fournie par la plateforme`).toContain(nom)
    for (const nom of inventaire.aPoser.keys()) expect(FOURNIES_PAR_SUPABASE).not.toContain(nom)
  })
})

describe('variables d’environnement de l’application web', () => {
  const application = sourcesDeLApplication()

  it('les lit sous une seule forme, et ne lit que des variables VITE_ ou intégrées à Vite', () => {
    const fautes = [...application]
      .map(([fichier, source]) => ({ fichier, ...lecturesVite(source) }))
      .flatMap(({ fichier, noms, inconnues }) => [
        ...(inconnues !== 0 ? [`${fichier} : ${inconnues} accès illisible(s)`] : []),
        // Vite n'expose au navigateur que le préfixe VITE_ : toute autre variable y vaudrait
        // `undefined`, sans erreur de build.
        ...[...noms].filter((n) => !n.startsWith('VITE_') && !INTEGREES_VITE.includes(n)).map((n) => `${fichier} : ${n}`),
      ])
    expect(fautes).toEqual([])
  })

  it('trouve chacune dans .env.production, dans .env.example et dans l’inventaire, et rien de plus', () => {
    // `.env.production` est celui que lit le build de production (suivi par Git, la CI n'a pas de
    // secret) : une variable qui y manque ne casse PAS le build, elle vaut `undefined` dans
    // l'application livrée.
    const lues = [...new Set([...application.values()].flatMap((s) => [...lecturesVite(s).noms]))]
      .filter((n) => n.startsWith('VITE_'))
      .sort()
    expect(lues.length).toBeGreaterThan(0)
    expect(clesDuFichierEnv('.env.production')).toEqual(lues)
    expect(clesDuFichierEnv('.env.example')).toEqual(lues)
    expect(inventaire.web).toEqual(lues)
  })
})

describe('le scanner lui-même', () => {
  it('lit un appel coupé sur plusieurs lignes, virgule finale comprise', () => {
    expect(lecturesDeno('const cle = Deno.env.get(\n  "CLE_COUPEE"\n)')).toEqual({ noms: new Set(['CLE_COUPEE']), inconnues: 0 })
    expect(lecturesDeno('const cle = Deno.env.get(\n  "CLE_COUPEE",\n)')).toEqual({ noms: new Set(['CLE_COUPEE']), inconnues: 0 })
  })

  it('compte comme illisible un nom qui n’est pas écrit en toutes lettres', () => {
    expect(lecturesDeno('const v = Deno.env.get(nom)').inconnues).toBe(1)
    expect(lecturesDeno('const { A } = Deno.env.toObject()').inconnues).toBe(1)
    expect(lecturesDeno('const b = process.env.BUCKET').inconnues).toBe(1)
    expect(lecturesVite("const u = import.meta.env['VITE_URL']").inconnues).toBe(1)
  })

  it('ne prend pas un commentaire pour une lecture, ni une lecture pour un commentaire', () => {
    expect(lecturesDeno('// on lisait Deno.env.get(nom) ici\nconst a = Deno.env.get("A")')).toEqual({ noms: new Set(['A']), inconnues: 0 })
    // Un commentaire de FIN de ligne n'est pas retiré : la lecture qui le précède compte.
    expect(lecturesVite('const u = import.meta.env.VITE_U // vient de .env')).toEqual({ noms: new Set(['VITE_U']), inconnues: 0 })
  })

  it('lit le tableau, les deux paragraphes et les doublons de l’inventaire', () => {
    const plan = [
      "<!-- DÉBUT DE L'INVENTAIRE -->",
      '| Variable | Lue par | À savoir |',
      '|---|---|---|',
      '| `CLE_A` | `fonction-b`, `fonction-a` | note |',
      '| `CLE_A` | `fonction-a` | note |',
      '',
      '**Fournies par Supabase** : `SUPABASE_URL`.',
      '',
      '**Côté application web** : `VITE_X`,',
      'et `VITE_Y` sur la ligne suivante.',
      '',
      "<!-- FIN DE L'INVENTAIRE -->",
    ].join('\n')
    const lu = inventaireDe(plan)
    expect(lu.aPoser.get('CLE_A')).toEqual(['fonction-a'])
    expect(lu.doublons).toEqual(['CLE_A'])
    expect(lu.fournies).toEqual(['SUPABASE_URL'])
    expect(lu.web).toEqual(['VITE_X', 'VITE_Y'])
    expect(() => inventaireDe(plan.replace("<!-- FIN DE L'INVENTAIRE -->", ''))).toThrow(/marqueurs/)
  })
})
