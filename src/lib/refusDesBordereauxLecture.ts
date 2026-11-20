import { porteLaFormeDUnBordereau } from './bordereauDeTeletransmission'
import { OUVRIR_AVEC_PDF_JS, pagesDuPdf, type OuvrirLeBordereau } from './bordereauDeTeletransmissionLecture'

// LA LECTURE D'UN PDF AU DÉPÔT, POUR Y RECONNAÎTRE UN BORDEREAU DE TÉLÉTRANSMISSION (conception 59, BOR6 ; la règle :
// lib/refusDesBordereaux.ts). Le fichier s'ouvre par pdf.js, dans le navigateur, sur des octets locaux (la lecture de BOR1,
// `pagesDuPdf`) ; seul un booléen en sort. Rien ne part : ni le fichier, ni son texte, ni son nom ; aucun journal
// (bordereauDeTeletransmissionSansSortie.test.ts le garde).
//
// TOUTES LES PAGES, sans borne : un bordereau ajouté au bout d'un autre document porte les mêmes noms. La lecture s'arrête à
// la première page qui a la forme d'un bordereau ; une page qui ne se lit pas est sautée, les autres lues. Un PDF qui ne
// s'ouvre pas rend « faux » : ce qui ne se lit pas ne se reconnaît pas, et le dépôt continue comme hier (BOR6-Q1).

/** Vrai si le PDF a la forme d'un bordereau de télétransmission. Ne rejette jamais. */
export async function bordereauDansLeFichier(fichier: Blob, ouvrir: OuvrirLeBordereau = OUVRIR_AVEC_PDF_JS): Promise<boolean> {
  try {
    const lu = await pagesDuPdf(fichier, ouvrir, {
      pagesMax: null, sauterLesPagesIllisibles: true, arreterApres: (page) => porteLaFormeDUnBordereau([page]),
    })
    return lu.etat === 'lu' && porteLaFormeDUnBordereau(lu.pages)
  } catch {
    return false
  }
}
