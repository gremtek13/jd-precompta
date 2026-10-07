// LE XML D'UNE FACTURE FACTUR-X (ligne 28.5 de la feuille de route, étape b). Une facture Factur-X est un PDF lisible
// qui porte, en pièce jointe, sa facture structurée — le XML CII que lit lib/factureElectronique.ts. La norme Factur-X
// nomme cette pièce jointe « factur-x.xml » ; ZUGFeRD, son aînée allemande, l'a appelée « zugferd-invoice.xml », et
// XRechnung « xrechnung.xml ». Aucun autre fichier joint n'est lu : un PDF peut en porter d'autres, et seule la facture
// structurée fait foi.
//
// pdf.js est chargé À LA DEMANDE : il touche au navigateur dès l'import (voir pdfText.ts), et seul l'import d'une
// facture Factur-X en a besoin. L'ouverture du PDF est un paramètre pour la même raison — les tests passent celle de
// la version de pdf.js qui tourne hors navigateur, sans que ce module change.

/** Les noms que la facture structurée porte dans le PDF, du plus attendu au moins attendu. */
export const NOMS_XML_FACTURX = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml']

export interface PieceJointePdf {
  nom: string
  lire: () => Promise<Uint8Array | null>
}

export interface DocumentPdfOuvert {
  piecesJointes: () => Promise<PieceJointePdf[]>
  fermer: () => Promise<void>
}

export type OuvrirPdf = (octets: Uint8Array) => Promise<DocumentPdfOuvert>

/** La pièce jointe qui porte la facture structurée, par son nom (la casse ne compte pas) ; nulle quand aucune ne l'est. */
export function pieceJointeDeLaFacture(noms: string[]): string | null {
  for (const attendu of NOMS_XML_FACTURX) {
    const trouve = noms.find((n) => n.trim().toLowerCase() === attendu)
    if (trouve !== undefined) return trouve
  }
  return null
}

// Ce qu'un document de pdf.js rend, quelle que soit la version de pdf.js qui l'a ouvert : celle du navigateur ici, celle
// qui tourne hors navigateur dans les tests. Seuls les deux `import` de l'ouverture du navigateur restent hors des tests.
interface DocumentPdfJs {
  getAttachments(): Promise<Map<string, { filename: string }> | null>
  getAttachmentContent(id: string): Promise<Uint8Array | null>
}

export interface TachePdfJs {
  promise: Promise<DocumentPdfJs>
  destroy(): Promise<void>
}

export async function documentDeLaTache(tache: TachePdfJs): Promise<DocumentPdfOuvert> {
  const pdf = await tache.promise
  return {
    piecesJointes: async () => {
      const jointes = await pdf.getAttachments()
      return Array.from(jointes ?? [], ([cle, pj]) => ({
        nom: pj.filename || cle,
        lire: async () => (await pdf.getAttachmentContent(cle)) ?? null,
      }))
    },
    fermer: () => tache.destroy(),
  }
}

// L'ouverture du navigateur. On n'y lit que des pièces jointes : rien n'est rendu, et pdf.js 6 ne compile plus aucune
// police en code (`new Function` a disparu de sa version 6 — c'était la porte par laquelle un PDF avait fait exécuter
// du code à ses versions antérieures).
const ouvrirAvecPdfJs: OuvrirPdf = async (octets) => {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: travailleur } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = travailleur
  return documentDeLaTache(pdfjsLib.getDocument({ data: octets }))
}

/**
 * Le XML de la facture structurée qu'un PDF Factur-X porte, en UTF-8 — ou la raison pour laquelle on ne l'a pas : le
 * PDF ne s'ouvre pas, il ne porte aucune facture jointe, ou elle n'est pas un texte UTF-8.
 */
export async function xmlDuFacturX(octets: Uint8Array, ouvrir: OuvrirPdf = ouvrirAvecPdfJs): Promise<{ xml: string } | { refus: string }> {
  let document: DocumentPdfOuvert
  try {
    // Une COPIE : pdf.js vide le tampon qu'on lui passe, et l'appelant en a encore besoin pour déposer le fichier.
    document = await ouvrir(octets.slice(0))
  } catch {
    return { refus: 'Le PDF Factur-X ne s’ouvre pas.' }
  }
  try {
    const jointes = await document.piecesJointes()
    const nom = pieceJointeDeLaFacture(jointes.map((j) => j.nom))
    if (nom === null) return { refus: 'Ce PDF ne porte pas de facture structurée (aucune pièce jointe « factur-x.xml »).' }
    const contenu = await jointes.find((j) => j.nom === nom)!.lire()
    if (!contenu || contenu.length === 0) return { refus: 'La facture structurée jointe au PDF est vide.' }
    try {
      return { xml: new TextDecoder('utf-8', { fatal: true }).decode(contenu) }
    } catch {
      return { refus: 'La facture structurée jointe au PDF n’est pas un texte UTF-8.' }
    }
  } catch {
    return { refus: 'Les pièces jointes du PDF Factur-X ne se lisent pas.' }
  } finally {
    // Fermer libère le travailleur de pdf.js ; un échec à fermer ne change rien à ce qu'on a lu.
    await document.fermer().catch((e: unknown) => console.error('[factureX] fermeture du PDF', e))
  }
}
