import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE DATE CIVILE NE SE TIRE JAMAIS D'UN INSTANT EN UTC.
//
// La règle est ancienne dans ce dépôt, et elle a été payée TROIS FOIS : `capitalRestantDu` et
// `empruntActif` prenaient « aujourd'hui » en `toISOString()` depuis toujours ; la période par
// défaut d'un pack rendait la veille du bon jour à Paris ; et `toIsoDate` (extract-piece) relisait
// minuit LOCAL en UTC, donc reculait d'un jour à l'est de Greenwich. Elle vit depuis dans CLAUDE.md
// (« tout calcul de date reste sur le calendrier civil … jamais un `new Date(...)` converti par
// `toISOString()` ») et dans les fonctions de `lib/format.ts` faites pour ça — `aujourdHuiSql`,
// `premierJourDuMoisCourant`, `ajouterMois`, `ajouterJours`.
//
// ELLE N'ÉTAIT GARDÉE PAR RIEN. Le balayage du 21/09/2026 a rendu six sites, dont DEUX en faute :
// le taux de change du jour d'une pièce sans date lue (`tauxChange.ts`), et la date du jour donnée
// à l'assistant comptable pour interpréter « cette année » — où un jour d'écart déplace la période
// d'une réponse, et le 1er janvier au petit matin l'exercice entier.
//
// CE QUE LE SCANNER REGARDE, ET POURQUOI C'EST MÉCANIQUE. `new Date().toISOString()` gardé ENTIER
// est un INSTANT, donc légitime — c'est ce qu'on écrit dans un `created_at`, un `updated_at`, un
// `validated_at`, et ce dépôt le fait neuf fois à bon droit. C'est la TRONCATURE à dix caractères
// qui transforme cet instant en date civile, et elle le fait dans le fuseau du serveur et non dans
// celui de qui regarde. Le signal n'est donc pas `toISOString()` : c'est `toISOString()` suivi d'un
// `.slice(0, 10)`, `.substring(0, 10)`, `.substr(0, 10)` ou `.split('T')[0]`.
//
// IL BALAIE `src/` ET LES EDGE FUNCTIONS, parce que deux des six sites vivent côté Deno et que le
// pire des trois défauts d'origine (`toIsoDate`) y vivait aussi. Comme `rls.sql` part de `pg_class`,
// il part de TOUTES les sources : un fichier ajouté demain est examiné sans que personne y pense.

/**
 * Les troncatures LÉGITIMES, avec leur NOMBRE et la raison pour laquelle le fuseau local n'y
 * intervient pas.
 *
 * Une entrée ici doit expliquer pourquoi cette troncature-là est juste — jamais « c'est sans
 * conséquence ». Deux formes seulement le sont : une `Date` ANCRÉE en UTC de bout en bout (rien de
 * local n'entre, rien de local ne sort), et une borne dont l'écart de fuseau est COUVERT par une
 * marge écrite pour lui.
 *
 * LE `nombre` N'EST PAS DE LA COMPTABILITÉ, C'EST CE QUI EMPÊCHE L'EXCEPTION D'ÊTRE UN BLANC-SEING.
 * Une exception posée par FICHIER dispenserait tout le fichier, et le premier fichier dispensé ici
 * est justement celui où le défaut du 21/09/2026 vivait — une rechute à deux lignes de la
 * troncature légitime serait passée sans un mot. Le compte doit tomber JUSTE : une de plus est une
 * rechute, une de moins est une raison morte.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'src/lib/tauxChange.ts': {
    nombre: 1,
    raison:
      "`dateMoinsJours` construit sa Date depuis `${date}T00:00:00Z` et n'avance qu'en `setUTCDate` : " +
      'UTC entre, UTC sort, aucun fuseau local ne touche jamais le résultat',
  },
  'supabase/functions/taux-change-bce/index.ts': {
    nombre: 1,
    raison:
      'le jumeau auto-porté de la précédente (une Edge Function ne peut rien importer de `src/`), ' +
      'avec le même ancrage explicite en `Z`',
  },
  'supabase/functions/extract-piece/index.ts': {
    nombre: 1,
    raison:
      '`dateFuture` compare une date de pièce à demain, et le JOUR DE MARGE est écrit exactement ' +
      "pour cet écart : la fonction tourne en UTC alors que les pièces sont datées à Paris. Réduire " +
      'la marge refuserait une facture du jour même en fin de soirée',
  },
}

interface Source {
  chemin: string
  texte: string
}

function sourcesDeSrc(): Source[] {
  const racine = new URL('../', import.meta.url)
  const trouves: Source[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'test') continue
      const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
      if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
      if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
      trouves.push({ chemin: `src/${prefixe}${entree.name}`, texte: readFileSync(suivant, 'utf8') })
    }
  }
  parcourir(racine, '')
  return trouves
}

function sourcesDesFonctions(): Source[] {
  const racine = new URL('../../supabase/functions/', import.meta.url)
  return readdirSync(racine, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((nom) => ({
      chemin: `supabase/functions/${nom}/index.ts`,
      texte: readFileSync(new URL(`../../supabase/functions/${nom}/index.ts`, import.meta.url), 'utf8'),
    }))
}

/**
 * Retire les lignes ENTIÈREMENT en commentaire avant d'analyser.
 *
 * Indispensable ici plus qu'ailleurs : ce dépôt EXPLIQUE ce défaut-là en citant la forme fautive en
 * toutes lettres — `format.ts`, `emprunts.ts`, `PacksTab.tsx` et l'en-tête ci-dessus le font tous.
 * On ne coupe JAMAIS un commentaire de fin de ligne : le code fautif serait alors AVANT le `//`,
 * donc toujours vu, et couper là risquerait d'avaler une chaîne contenant `//` — c'est-à-dire de
 * rendre le scanner aveugle, le seul sens dangereux.
 */
function sansCommentairesPleins(texte: string): string {
  return texte
    .split('\n')
    .map((l) => {
      const t = l.trimStart()
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : l
    })
    .join('\n')
}

/**
 * `toISOString()` suivi d'une troncature à la date civile.
 *
 * Les espaces sont tolérés PARTOUT, retours à la ligne compris (`[\s]` et non ` `) : le formatage
 * normal de ce dépôt coupe volontiers une chaîne d'appels, et **quatre balayages de ce projet se
 * sont déjà fait prendre par le retour à la ligne**. Un scanner qui lit « la ligne » plutôt que
 * l'expression est aveugle exactement là où le code est le plus long — donc le plus suspect.
 */
const TRONCATURE = /\.\s*toISOString\s*\(\s*\)\s*\.\s*(?:slice|substring|substr)\s*\(\s*0\s*,\s*10\s*\)|\.\s*toISOString\s*\(\s*\)\s*\.\s*split\s*\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\]/

export interface DateUtc {
  chemin: string
  ligne: number
  extrait: string
}

export function datesTireesDUtc(sources: Source[]): DateUtc[] {
  const trouves: DateUtc[] = []
  for (const { chemin, texte } of sources) {
    const propre = sansCommentairesPleins(texte)
    const global = new RegExp(TRONCATURE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = global.exec(propre)) !== null) {
      const ligne = propre.slice(0, m.index).split('\n').length
      trouves.push({ chemin, ligne, extrait: m[0].replace(/\s+/g, ' ').trim() })
    }
  }
  return trouves
}

// Sources SYNTHÉTIQUES : les deux bornes qui gardent le scanner lui-même. « Le scanner rend zéro »
// et « le scanner est aveugle » se ressemblent trop — c'est la panne qui a laissé passer trois
// versions du scanner de lectures paginées.
const SOURCE_FAUTIVE = `
export function aujourdHui(): string {
  return new Date().toISOString().slice(0, 10)
}
`

// La MÊME faute, coupée par le formatage normal du dépôt. C'est la forme qui aveugle un scanner
// lisant « la ligne », et elle doit être attrapée comme la précédente.
const SOURCE_FAUTIVE_MULTILIGNE = `
export function borne(d: Date): string {
  return d
    .toISOString()
    .split('T')[0]
}
`

// Deux formes VOISINES qu'il ne doit PAS attraper : un instant gardé entier (un \`created_at\`), et
// une date civile construite depuis les composantes locales, qui est précisément le remède.
const SOURCE_SAINE = `
export function maintenant(): string {
  return new Date().toISOString()
}
export function aujourdHuiSql(): string {
  const d = new Date()
  return \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`
}
`

// Le même défaut, mais ÉCRIT DANS UN COMMENTAIRE pour l'expliquer — ce que ce dépôt fait partout.
const SOURCE_COMMENTEE = `
// Jamais \`new Date().toISOString().slice(0, 10)\` : ce serait la date UTC.
export function ok(): string {
  return aujourdHuiSql()
}
`

describe('une date civile ne se tire jamais d’un instant en UTC', () => {
  const toutes = [...sourcesDeSrc(), ...sourcesDesFonctions()]

  it('balaie les sources de src/ ET les Edge Functions', () => {
    expect(toutes.some((s) => s.chemin.startsWith('src/pages/'))).toBe(true)
    expect(toutes.some((s) => s.chemin.startsWith('supabase/functions/'))).toBe(true)
    // Assez de fichiers pour qu'un scanner qui ne lirait rien se distingue d'un dépôt sain.
    expect(toutes.length).toBeGreaterThan(80)
  })

  it('ne laisse aucune troncature non déclarée', () => {
    const fautifs = datesTireesDUtc(toutes).filter((d) => !(d.chemin in EXCEPTIONS))
    expect(fautifs.map((d) => `${d.chemin}:${d.ligne} — ${d.extrait}`)).toEqual([])
  })

  it('compte les troncatures des fichiers dispensés, au lieu de les dispenser en bloc', () => {
    // Le point qui distingue ce test du précédent : une rechute DANS un fichier dispensé. Sans lui,
    // l'exception de `tauxChange.ts` couvrirait un second `toISOString().slice(0, 10)` posé juste à
    // côté du premier — c'est-à-dire exactement le défaut qui a fait naître ce scanner.
    const trouves = datesTireesDUtc(toutes)
    for (const [chemin, { nombre }] of Object.entries(EXCEPTIONS)) {
      const dans = trouves.filter((d) => d.chemin === chemin)
      expect(dans.map((d) => `${d.chemin}:${d.ligne} — ${d.extrait}`)).toHaveLength(nombre)
    }
  })

  it('n’admet que des exceptions RÉELLES, chacune portant sa raison', () => {
    // Une liste d'exceptions qui se remplit de raisons mortes ne protège plus rien : chaque entrée
    // doit correspondre à une troncature qui existe encore dans la source qu'elle nomme.
    const parChemin = new Set(datesTireesDUtc(toutes).map((d) => d.chemin))
    for (const [chemin, { raison }] of Object.entries(EXCEPTIONS)) {
      expect(parChemin.has(chemin), `exception inventée : ${chemin}`).toBe(true)
      expect(raison.length).toBeGreaterThan(40)
    }
  })

  it('attrape la forme fautive, y compris coupée sur plusieurs lignes', () => {
    expect(datesTireesDUtc([{ chemin: 'faux.ts', texte: SOURCE_FAUTIVE }])).toHaveLength(1)
    expect(datesTireesDUtc([{ chemin: 'faux.ts', texte: SOURCE_FAUTIVE_MULTILIGNE }])).toHaveLength(1)
  })

  it('laisse passer l’instant gardé entier et la date construite en local', () => {
    expect(datesTireesDUtc([{ chemin: 'sain.ts', texte: SOURCE_SAINE }])).toEqual([])
  })

  it('ne se fait pas prendre par le défaut CITÉ dans un commentaire', () => {
    expect(datesTireesDUtc([{ chemin: 'commente.ts', texte: SOURCE_COMMENTEE }])).toEqual([])
  })
})
