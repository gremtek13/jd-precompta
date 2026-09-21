import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDate } from './format'

// UNE DATE CIVILE N'A PAS DE FUSEAU, ET ON LUI EN DONNAIT UN — DEUX FOIS.
//
// `new Date('2026-01-01')` est minuit UTC. Formatée ensuite pour l'affichage, elle est replacée dans
// le fuseau de qui regarde et RECULE D'UN JOUR dès que le décalage est négatif. Or la Guadeloupe, la
// Martinique, la Guyane, Saint-Pierre-et-Miquelon et la Polynésie sont la France, et une profession
// de santé y est exactement la clientèle de cette application : une pièce du 1er janvier s'y
// affichait au 31 décembre — l'EXERCICE PRÉCÉDENT — pendant que tous les totaux la comptaient dans
// le bon.
//
// LA RÈGLE ÉTAIT DÉJÀ ÉCRITE, ET N'A PAS SUFFI. `format.ts` explique la distinction civile/instant
// sur une dizaine de lignes, pour `anneeDe` / `anneeLocaleDe` — et `formatDate`, trois lignes
// AU-DESSUS de ce commentaire, portait le défaut depuis toujours. Une règle qui vit dans un
// commentaire ne se voit pas rechuter ; celle-ci devient donc un contrôle, comme `verrousExecution`,
// `lecturesPaginees` et `retraitsStockage` avant elle.
//
// CE QU'IL INTERDIT, ET CE QU'IL LAISSE PASSER. `new Date()` SANS argument est un instant, toujours
// légitime (« aujourd'hui »). C'est `new Date(<valeur>)` suivi d'un formatage d'affichage qui est en
// cause : la valeur peut être une date civile, et rien dans la source ne le dit. Les exceptions sont
// donc les sites dont la valeur est DÉMONTRABLEMENT un horodatage, et chacune porte sa raison.
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'src/lib/format.ts': {
    nombre: 1,
    raison:
      "`dateRelative` ne reçoit que des `created_at` (vérifié sur ses trois appelants : FilCommentaires, "
      + "ClientHome, DossiersList) et rend « il y a 3 h » — un instant, dont le jour dépend "
      + 'légitimement du fuseau de qui le regarde.',
  },
  'src/pages/RestaurationCard.tsx': {
    nombre: 1,
    raison:
      "`faiteLe` est l'horodatage de la sauvegarde qu'on est en train de restaurer, affiché avec son "
      + "HEURE (`toLocaleString`) : c'est bien l'instant vécu par l'utilisateur qu'il faut rendre.",
  },
  'supabase/functions/send-email/index.ts': {
    nombre: 1,
    raison:
      'Repli de `formaterDate` pour une valeur qui ne serait PAS de la forme AAAA-MM-JJ. Les deux '
      + 'colonnes qu\'elle reçoit (`date_emission`, `date_echeance`) sont des `date` et passent donc '
      + "par la lecture de libellé ; le repli existe pour ne pas rendre du vide sur l'inattendu.",
  },
}

// `new Date(` avec au moins un caractère avant la parenthèse fermante, puis un formatage
// d'affichage. La recherche tolère les retours à la ligne — QUATRE balayages de ce dépôt se sont
// déjà fait prendre à lire « la ligne » plutôt que l'expression.
//
// ET LA BORNE EST INDISPENSABLE, elle a mordu à la première exécution : avec un simple `[\s\S]*?`,
// un `new Date(valeur)` employé pour du calcul en haut d'un fichier se raccorde au
// `.toLocaleDateString(` d'un `new Date()` parfaitement légitime cent lignes plus bas.
// `DossiersList.tsx`, qui ne porte QUE des `new Date()` sans argument à l'affichage, ressortait
// ainsi en faute. Le corps ne peut donc pas enjamber un `new Date(` — c'est la même réparation que
// « un corps s'arrête au `.from(` SUIVANT » de `lecturesPaginees`, et elle ne fait que RACCOURCIR
// la portée, qui est le sens sûr.
const FORMATAGE_SUR_VALEUR =
  /new\s+Date\s*\(\s*[^)\s](?:(?!new\s+Date\s*\()[\s\S])*?\)\s*\.\s*toLocale(?:Date)?String\s*\(/g

function sources(racine: string): string[] {
  const trouvees: string[] = []
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree)
    if (statSync(chemin).isDirectory()) {
      if (entree !== 'node_modules') trouvees.push(...sources(chemin))
    } else if (/\.tsx?$/.test(entree) && !/\.test\.tsx?$/.test(entree)) {
      trouvees.push(chemin)
    }
  }
  return trouvees
}

// Les lignes ENTIÈREMENT en commentaire sont retirées : ce fichier-ci, comme `format.ts`, CITE la
// forme fautive en toutes lettres pour expliquer pourquoi elle est interdite. On ne coupe jamais un
// commentaire de fin de ligne — le code fautif serait de toute façon avant le `//`, et couper là
// risquerait d'avaler une chaîne contenant `//`, c'est-à-dire de rendre le scanner aveugle.
function sansCommentaires(source: string): string {
  return source
    .split('\n')
    .map((ligne) => (/^\s*(\/\/|\*|\/\*)/.test(ligne) ? '' : ligne))
    .join('\n')
}

export function sitesFautifs(fichiers: { chemin: string; source: string }[]): { chemin: string; nombre: number }[] {
  return fichiers
    .map(({ chemin, source }) => ({
      chemin,
      nombre: (sansCommentaires(source).match(FORMATAGE_SUR_VALEUR) ?? []).length,
    }))
    .filter((f) => f.nombre > 0)
}

const FICHIERS = [...sources('src'), ...sources('supabase/functions')]
  .map((chemin) => ({ chemin, source: readFileSync(chemin, 'utf8') }))

describe('une date civile ne passe jamais par `new Date` pour être affichée', () => {
  it('ne trouve que les sites déclarés, et chacun au compte annoncé', () => {
    for (const { chemin, nombre } of sitesFautifs(FICHIERS)) {
      const exception = EXCEPTIONS[chemin]
      expect(exception, `${chemin} formate une valeur passée par \`new Date(...)\`. Si cette valeur `
        + "est un HORODATAGE, ajoute-la aux exceptions avec sa raison ; si c'est une date civile "
        + '(colonne `date` de Postgres), lis son libellé — voir `formatDate` dans src/lib/format.ts.')
        .toBeDefined()
      // Le compte, pas seulement le fichier : dispenser un FICHIER dispenserait aussi la rechute
      // qui s'y ajouterait demain — et `format.ts` est justement celui où le défaut vivait à
      // quelques lignes du site légitime.
      expect(nombre, `${chemin} — ${exception.raison}`).toBe(exception.nombre)
    }
  })

  it('ne garde aucune exception morte', () => {
    const vus = new Set(sitesFautifs(FICHIERS).map((f) => f.chemin))
    for (const chemin of Object.keys(EXCEPTIONS)) {
      expect(vus.has(chemin), `${chemin} n'a plus de site à dispenser — retire son exception, sinon `
        + 'la liste se remplit de raisons mortes').toBe(true)
    }
  })

  // LES DEUX BORNES, sans lesquelles « zéro faute » et « le scanner est aveugle » seraient
  // indiscernables — la panne que ce dépôt connaît sous plusieurs noms.
  it('voit le défaut d’origine, y compris coupé sur plusieurs lignes', () => {
    const replante = [
      { chemin: 'faux/a.ts', source: "const f = (v: string) => new Date(v).toLocaleDateString('fr-FR')" },
      {
        chemin: 'faux/b.tsx',
        source: 'const g = (v: string) =>\n  new Date(\n    v,\n  ).toLocaleDateString(\n    "fr-FR",\n  )',
      },
      { chemin: 'faux/c.ts', source: "const h = (v: string) => new Date(v).toLocaleString('fr-FR')" },
    ]
    expect(sitesFautifs(replante).map((f) => f.chemin)).toEqual(['faux/a.ts', 'faux/b.tsx', 'faux/c.ts'])
  })

  it('ne crie pas au loup sur ce qui est légitime', () => {
    // `new Date()` sans argument est « maintenant » — un instant, jamais une date civile. Et la
    // lecture de libellé, celle du correctif, ne doit évidemment pas être signalée.
    const sains = [
      { chemin: 'faux/d.ts', source: "const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long' })" },
      { chemin: 'faux/e.ts', source: 'const f = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`' },
      { chemin: 'faux/f.ts', source: "// new Date(v).toLocaleDateString('fr-FR') — cité en commentaire, pas exécuté" },
      // LE CAS QUI A MORDU À LA PREMIÈRE EXÉCUTION, et la raison de la borne ci-dessus : un
      // `new Date(valeur)` de calcul, puis, plus loin, un `new Date()` d'affichage. C'est la forme
      // exacte de `DossiersList.tsx`, que le scanner déclarait en faute sans qu'il y ait faute.
      {
        chemin: 'faux/g.tsx',
        source: 'const d = new Date(x.created_at).getTime()\n'
          + 'const plus = new Date(debut.getTime() + 7).toISOString()\n'
          + "const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long' })",
      },
    ]
    expect(sitesFautifs(sains)).toEqual([])
  })
})

// ET LE SCANNER CI-DESSUS NE PEUT PAS GARDER `send-email`, parce qu'il COMPTE.
//
// Vérifié par mutation : remettre `formaterDate` à `new Date(d).toLocaleDateString("fr-FR")` laisse
// le compte du fichier à UN — c'est la même occurrence, simplement devenue le seul chemin au lieu
// d'un repli. Un scanner de forme est aveugle à cette différence-là, et le dire vaut mieux que de
// laisser croire qu'il couvre tout.
//
// Ce qui la garde est donc ce que le projet fait déjà pour toute fonction auto-portée : on lit la
// VRAIE source déployable, on en extrait la fonction, et on l'EXÉCUTE — sous un fuseau choisi ici,
// pas sous celui du runner. Une Edge Function tourne en UTC aujourd'hui, ce qui rend l'ancienne
// version juste par accident de runtime ; ce test refuse de dépendre de cet accident.
function formaterDateDeployee(): (d: string) => string {
  const source = readFileSync(
    new URL('../../supabase/functions/send-email/index.ts', import.meta.url), 'utf8')
  const entete = 'function formaterDate(d: string): string {'
  const debut = source.indexOf(entete)
  expect(debut, '`formaterDate` introuvable dans send-email — le garde-fou doit être remis à jour')
    .toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `formaterDate` introuvable').toBeGreaterThan(debut)
  const corps = source.slice(debut, fin + 2).replace(entete, 'function formaterDate(d) {')
  return new Function(`${corps}; return formaterDate`)() as (d: string) => string
}

describe('send-email — la date d’une facture envoyée au client', () => {
  const deployee = formaterDateDeployee()
  const TZ_ORIGINE = process.env.TZ
  const sousFuseau = (tz: string, f: () => void) => {
    process.env.TZ = tz
    try { f() } finally { process.env.TZ = TZ_ORIGINE }
  }

  it('rend le jour écrit sur la facture, quel que soit le fuseau du runtime', () => {
    // `date_emission` et `date_echeance` sont des colonnes `date` : leur libellé EST la date. Si le
    // runtime des Edge Functions cessait d'être en UTC, l'ancienne version datait chaque e-mail de
    // la veille — sur un document légal, et sans que rien ne puisse le dire une fois parti.
    for (const tz of ['UTC', 'Europe/Paris', 'America/Martinique', 'Pacific/Tahiti']) {
      sousFuseau(tz, () => {
        expect(deployee('2026-01-01'), tz).toBe('01/01/2026')
        expect(deployee('2025-12-31'), tz).toBe('31/12/2025')
        expect(deployee('2026-09-21'), tz).toBe('21/09/2026')
      })
    }
  })

  it('dit le même jour que l’application, contre une référence extérieure aux deux', () => {
    // Les deux copies décident du même affichage — l'une dans l'application, l'autre dans l'e-mail
    // que le client reçoit —, donc elles doivent dire le même jour : sinon le cabinet et son client
    // lisent deux dates pour la même facture.
    //
    // ON NE LES COMPARE PAS L'UNE À L'AUTRE, on les évalue toutes deux contre une TABLE écrite ici.
    // Vérifié par mutation : `expect(deployee(iso)).toBe(formatDate(iso))` reste vert si l'on
    // remplace le second appel par le premier — la comparaison devient alors une tautologie, et
    // c'est exactement l'aveuglement trouvé le même jour sur `agentComptableAnalyse`. Une référence
    // extérieure aux deux copies ne peut pas s'effondrer de cette façon.
    const ATTENDU: Record<string, string> = {
      '2026-01-01': '01/01/2026',
      '2026-02-28': '28/02/2026',
      '2026-09-21': '21/09/2026',
      '2025-12-31': '31/12/2025',
    }
    sousFuseau('America/Martinique', () => {
      for (const [iso, attendu] of Object.entries(ATTENDU)) {
        expect(deployee(iso), `send-email, ${iso}`).toBe(attendu)
        expect(formatDate(iso), `src/lib, ${iso}`).toBe(attendu)
      }
    })
  })

  it('ne rend pas du vide sur une valeur inattendue', () => {
    // Le repli existe pour ça, et c'est la raison inscrite dans l'exception du scanner ci-dessus.
    sousFuseau('UTC', () => {
      expect(deployee('2026-01-01T12:00:00Z')).toBe('01/01/2026')
    })
  })
})
