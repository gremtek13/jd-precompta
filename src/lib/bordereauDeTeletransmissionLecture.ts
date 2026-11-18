import { lireBordereauxDeTeletransmission, type FragmentDeTexte, type LectureDuBordereau, type PageDeTexte } from './bordereauDeTeletransmission'

// L'OUVERTURE DU BORDEREAU DE TÉLÉTRANSMISSION, DANS LE NAVIGATEUR (conception 59, lot BOR1). Le fichier du praticien porte
// des noms de patients : il s'ouvre ICI, par pdf.js, sur des OCTETS locaux (`getDocument({ data })`, jamais une adresse), et
// seul le résultat de `lireBordereauxDeTeletransmission` — l'en-tête du lot et ses totaux — en sort, par le retour.
// Rien ne part : ni le fichier, ni son texte, ni son nom, ni une image de ses pages ; aucun journal, aucun réseau, aucune base
// (bordereauDeTeletransmissionSansSortie.test.ts le garde). pdf.js ne reçoit ni `standardFontDataUrl`, ni `cMapUrl`, ni
// `wasmUrl` : sans eux il ne va rien chercher ; son ouvrier est servi par l'application (`?url`), comme pour Factur-X.
//
// NE REJETTE JAMAIS : un fichier qui ne s'ouvre pas, ou une page qui ne se lit pas, rend un refus sous une raison fixe — jamais
// le message de pdf.js, qui pourrait citer un morceau du fichier.

/** Le texte d'une page, tel que pdf.js le rend : chaque fragment et sa matrice de position. */
export interface ElementDeTextePdfJs {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

/** Ce qu'un document de pdf.js rend, quelle que soit la version qui l'a ouvert (celle du navigateur, ou celle des tests). */
export interface DocumentDeTextePdfJs {
  numPages: number
  getPage(numero: number): Promise<{ getTextContent(): Promise<{ items: readonly unknown[] }> }>
}

export interface TacheDeTextePdfJs {
  promise: Promise<DocumentDeTextePdfJs>
  destroy(): Promise<void>
}

/** Ouvre des octets PDF : la tâche de pdf.js. Injectée par les tests (la version hors navigateur de pdf.js). */
export type OuvrirLeBordereau = (octets: Uint8Array) => TacheDeTextePdfJs

/** Au-delà, ce n'est plus un bordereau d'un lot (Télévitale en tient quelques dizaines de factures par page). */
export const PAGES_MAX = 200

const ouvrirAvecPdfJs: OuvrirLeBordereau = (octets) => {
  const tache = (async () => {
    const pdfjsLib = await import('pdfjs-dist')
    const { default: travailleur } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjsLib.GlobalWorkerOptions.workerSrc = travailleur
    const vraie = pdfjsLib.getDocument({ data: octets })
    return { vraie, document: (await vraie.promise) as unknown as DocumentDeTextePdfJs }
  })()
  return {
    promise: tache.then((t) => t.document),
    destroy: async () => {
      try { await (await tache).vraie.destroy() } catch { /* rien à libérer */ }
    },
  }
}

/** Les fragments d'une page : le texte, l'abscisse et l'ordonnée de `transform`, la largeur et la hauteur. */
export function fragmentsDeLaPage(items: readonly unknown[]): FragmentDeTexte[] {
  const fragments: FragmentDeTexte[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const { str, transform, width, height } = item as ElementDeTextePdfJs
    if (typeof str !== 'string' || !Array.isArray(transform) || transform.length < 6) continue
    fragments.push({
      texte: str,
      x: transform[4],
      y: transform[5],
      largeur: typeof width === 'number' && Number.isFinite(width) ? width : undefined,
      hauteur: typeof height === 'number' && Number.isFinite(height) ? height : undefined,
    })
  }
  return fragments
}

/**
 * Lit un bordereau de télétransmission depuis le fichier choisi. Ne rejette jamais. Le fichier n'est lu qu'ici ; il n'est
 * gardé nulle part, et la tâche de pdf.js est détruite avant le retour.
 */
export async function lireLeBordereauDeTeletransmission(fichier: Blob, ouvrir: OuvrirLeBordereau = ouvrirAvecPdfJs): Promise<LectureDuBordereau> {
  let octets: Uint8Array
  try {
    // Des octets à elle : pdf.js vide (transfère à son ouvrier) le tampon qu'on lui passe.
    octets = new Uint8Array((await fichier.arrayBuffer()).slice(0))
  } catch {
    return { etat: 'refuse', raison: 'le fichier n’a pas pu être lu' }
  }
  let tache: TacheDeTextePdfJs
  try {
    tache = ouvrir(octets)
  } catch {
    return { etat: 'refuse', raison: 'le fichier ne s’ouvre pas comme un PDF' }
  }
  try {
    let document: DocumentDeTextePdfJs
    try {
      document = await tache.promise
    } catch {
      return { etat: 'refuse', raison: 'le fichier ne s’ouvre pas comme un PDF' }
    }
    if (!Number.isInteger(document.numPages) || document.numPages < 1) return { etat: 'refuse', raison: 'le PDF n’a aucune page' }
    if (document.numPages > PAGES_MAX) return { etat: 'refuse', raison: `le PDF a plus de ${PAGES_MAX} pages : ce n’est pas un bordereau de lot` }
    const pages: PageDeTexte[] = []
    for (let numero = 1; numero <= document.numPages; numero++) {
      try {
        const contenu = await (await document.getPage(numero)).getTextContent()
        pages.push({ fragments: fragmentsDeLaPage(contenu.items) })
      } catch {
        return { etat: 'refuse', raison: `la page ${numero} du PDF ne se lit pas` }
      }
    }
    if (pages.every((p) => 'fragments' in p && p.fragments.every((f) => f.texte.trim() === ''))) {
      return { etat: 'refuse', raison: 'le PDF n’a aucun texte (une image ou un document numérisé) : rien ne se lit sans OCR, et aucun OCR ne s’applique à ce fichier' }
    }
    return lireBordereauxDeTeletransmission(pages)
  } catch {
    return { etat: 'refuse', raison: 'le bordereau n’a pas pu être lu' }
  } finally {
    try { await tache.destroy() } catch { /* rien à libérer */ }
  }
}
