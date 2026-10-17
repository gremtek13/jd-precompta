import { StorageClient } from '@supabase/storage-js'

// LE SEAU `ventes` JOUÉ PAR LE SDK INSTALLÉ, contre un « service » factice (espace client, étape A5c2a). Le vrai
// `StorageClient` de storage-js construit les requêtes et lit les réponses — le multipart d'un dépôt, l'en-tête `x-upsert`,
// les erreurs qu'il rapporte —, et seule la couche `fetch` est fausse : un seau en mémoire, qui note ce qu'il reçoit et répond
// comme le service (un doublon en 409, un objet absent en 400 dont le corps dit 404, un refus de policy en 403). Les tests
// de lecture et d'écriture du logo l'utilisent à la place de `lib/supabase`, pour que leurs verdicts soient ceux du SDK.

export interface EnvoiAuSeau {
  methode: string
  // Le chemin de l'objet dans le seau, décodé.
  chemin: string
  // Un dépôt : le type de la partie du fichier, et l'en-tête `x-upsert`.
  type: string | null
  upsert: string | null
}

export interface MondeDuSeau {
  stockage: StorageClient
  seau: Map<string, Blob>
  envois: EnvoiAuSeau[]
  // Ce que le « service » répond à la place de son comportement ordinaire ; null pour l'ordinaire.
  reponseDepot: (() => Response) | null
  reponseLecture: (() => Response) | null
  // Le dépôt ordinaire range le fichier ; mis à faux, il répond succès sans rien ranger.
  rangerLesDepots: boolean
  reinitialiser: () => void
}

const PREFIXE = '/storage/v1/object/ventes/'

export function creerMondeDuSeau(): MondeDuSeau {
  const monde: MondeDuSeau = {
    stockage: undefined as unknown as StorageClient,
    seau: new Map(),
    envois: [],
    reponseDepot: null,
    reponseLecture: null,
    rangerLesDepots: true,
    reinitialiser() {
      monde.seau.clear()
      monde.envois.length = 0
      monde.reponseDepot = null
      monde.reponseLecture = null
      monde.rangerLesDepots = true
    },
  }
  const fetchFactice = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const adresse = new URL(String(url))
    const chemin = decodeURIComponent(adresse.pathname.slice(PREFIXE.length))
    const methode = (init?.method ?? 'GET').toUpperCase()
    if (methode === 'POST') {
      const corps = init?.body
      const fichier = corps instanceof FormData ? (corps.get('') as File) : null
      monde.envois.push({ methode, chemin, type: fichier?.type ?? null, upsert: new Headers(init?.headers).get('x-upsert') })
      if (monde.reponseDepot) return monde.reponseDepot()
      if (monde.seau.has(chemin)) {
        return Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 409 })
      }
      if (monde.rangerLesDepots && fichier) monde.seau.set(chemin, fichier)
      return Response.json({ Id: 'id', Key: `ventes/${chemin}` })
    }
    monde.envois.push({ methode, chemin, type: null, upsert: null })
    if (monde.reponseLecture) return monde.reponseLecture()
    const fichier = monde.seau.get(chemin)
    if (!fichier) return Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 })
    return new Response(fichier, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  }
  monde.stockage = new StorageClient('https://projet.supabase.invalid/storage/v1', {}, fetchFactice as typeof fetch)
  return monde
}

/** Le monde partagé d'un fichier de test : `vi.mock('./supabase')` y puise le client, le test y lit ce qui s'est passé. */
export const mondeDuSeau = creerMondeDuSeau()
