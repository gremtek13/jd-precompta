// UN FAUX CLIENT SUPABASE QUI RÉPOND À TOUT, ET QUI SAIT NE RIEN RENDRE.
//
// Le garde transversal des écrans (`src/pages/ecransAvantLecture.test.tsx`) monte chaque écran qui lit la base sous ce
// client : toute chaîne s'y construit (`from`, `rpc`, `functions.invoke`, `storage`, `auth`…), et toute réponse attend que
// le test la libère. C'est ainsi qu'on regarde un écran AVANT la fin de ses lectures, sans connaître ses requêtes une à une
// — un faux client écrit table par table ne verrait que celles auxquelles on a pensé.
//
// Trois façons de répondre : retenir (rien ne revient tant que `libererTout` n'est pas appelé), vide (une liste lue en
// entier et vide, ou la ligne unique que le test a posée), refus (une erreur, comme un refus de la RLS). La réponse se
// compose quand elle PART : une lecture retenue puis libérée répond selon le mode du moment de sa libération.

export type ModeReponse = 'retenir' | 'vide' | 'refus'

export const etat = {
  mode: 'retenir' as ModeReponse,
  // Les réponses retenues, dans l'ordre des demandes.
  enAttente: [] as (() => void)[],
  // Ce qui a été demandé — une table, `rpc:nom`, `fonction:nom`, `stockage:seau`, `auth:méthode` : le plancher du garde
  // (un écran qui ne demande rien n'a rien prouvé).
  demandes: new Set<string>(),
  // Ce que rend, en mode « vide », la lecture d'UNE ligne d'une table (`single`, `maybeSingle`) : nulle sinon.
  lignesUniques: {} as Record<string, unknown>,
  // Les écritures PARTIES, dans l'ordre : `table insert|upsert|update|delete`, `rpc:nom`, `fonction:nom (action)`,
  // `stockage:seau upload|remove|move|copy`. Une écriture part quand la chaîne est attendue (`then`), comme une vraie
  // requête PostgREST — une chaîne construite et jamais attendue n'envoie rien. Un `rpc` ou une fonction n'écrivent pas
  // toujours : celui qui compte les juge par leur nom et leur action.
  ecritures: [] as string[],
}

export function reinitialiser(mode: ModeReponse) {
  etat.mode = mode
  etat.enAttente = []
  etat.demandes = new Set()
  etat.ecritures = []
}

// Libère les réponses retenues, en mode « vide » ou « refus » : celles qu'elles déclenchent répondent aussitôt.
export function libererTout(mode: Exclude<ModeReponse, 'retenir'> = 'vide'): number {
  etat.mode = mode
  const liberees = etat.enAttente.splice(0)
  for (const rendre of liberees) rendre()
  return liberees.length
}

interface Chaine {
  // Le chemin des propriétés et des appels, pour reconnaître une fonction, le stockage ou l'authentification.
  chemin: string
  // La table, la fonction ou le seau que la chaîne vise, une fois connu.
  cible: string
  uneLigne: boolean
  // L'action demandée à une Edge Function (`body.action`), quand elle en porte une : `statut` lit, `retirer` écrit.
  action?: string
}

// L'écriture que porte une chaîne, ou null pour une lecture.
function ecritureDe(c: Chaine): string | null {
  const operation = /\.(insert|upsert|update|delete|upload|remove|move|copy)\(\)/.exec(c.chemin)?.[1]
  if (operation) return `${c.cible} ${operation}`
  if (c.cible.startsWith('fonction:')) return c.action ? `${c.cible} (${c.action})` : c.cible
  if (c.cible.startsWith('rpc:')) return c.cible
  return null
}

function reponse(c: Chaine): unknown {
  if (etat.mode === 'refus') {
    return { data: null, error: { message: 'lecture refusée par le faux client', code: '42501' }, count: null, status: 403 }
  }
  if (c.cible.startsWith('fonction:')) return { data: null, error: null }
  if (c.cible === 'auth:getSession') return { data: { session: null }, error: null }
  if (c.cible === 'auth:getUser') return { data: { user: null }, error: null }
  if (c.chemin.includes('.createSignedUrl')) return { data: null, error: { message: 'aucun fichier dans le faux client' } }
  if (c.uneLigne) return { data: etat.lignesUniques[c.cible] ?? null, error: null, count: null, status: 200 }
  return { data: [], error: null, count: 0, status: 200 }
}

function chaine(c: Chaine): unknown {
  // Une fonction pour cible : la chaîne doit pouvoir être APPELÉE (`supabase.from(…)`) autant que lue (`.select`).
  return new Proxy(function () {}, {
    get(_cible, propriete) {
      if (typeof propriete === 'symbol') return undefined
      if (propriete === 'then') {
        return (suite: (valeur: unknown) => unknown) => {
          etat.demandes.add(c.cible || c.chemin)
          const ecriture = ecritureDe(c)
          if (ecriture) etat.ecritures.push(ecriture)
          const rendre = () => { suite(reponse(c)) }
          if (etat.mode === 'retenir') etat.enAttente.push(rendre)
          else void Promise.resolve().then(rendre)
        }
      }
      return chaine({ ...c, chemin: `${c.chemin}.${propriete}`, uneLigne: c.uneLigne || propriete === 'single' || propriete === 'maybeSingle' })
    },
    apply(_cible, _this, args: unknown[]) {
      let cible = c.cible
      const nom = typeof args[0] === 'string' ? args[0] : ''
      if (!cible && nom) {
        if (c.chemin.endsWith('.storage.from')) cible = `stockage:${nom}`
        else if (c.chemin.endsWith('.from')) cible = nom
        else if (c.chemin.endsWith('.rpc')) cible = `rpc:${nom}`
        else if (c.chemin.endsWith('.functions.invoke')) cible = `fonction:${nom}`
      }
      if (!cible && /\.auth\.(getSession|getUser)$/.test(c.chemin)) cible = `auth:${c.chemin.split('.').pop()}`
      const corps = c.chemin.endsWith('.functions.invoke') ? (args[1] as { body?: { action?: unknown } } | undefined)?.body : undefined
      const action = typeof corps?.action === 'string' ? corps.action : c.action
      return chaine({ ...c, cible, action, chemin: `${c.chemin}()` })
    },
  })
}

export const supabase = chaine({ chemin: 'supabase', cible: '', uneLigne: false })
