// CE QUE LA RÉCEPTION PAR E-MAIL FERAIT D'UN PDF (BOR6R-Q1 ; le lanceur : outils/bordereau/reception.mjs). Le même
// enchaînement que `formeDUnBordereauDansLePdf` de supabase/functions/receive-email/index.ts, sur les modules de src/lib dont
// receive-email porte la copie gardée (texteDUnPdf.ts, le bloc formeDUnBordereau de bordereauDeTeletransmission.ts) : au-delà
// de 20 Mio la pièce jointe s'écarte pour son poids avant toute lecture ; sinon le texte se lit sous 48 Mio d'octets
// décompressés et une seconde (la durée de la lecture de TOUS les PDF d'un e-mail : ici un seul), chaque page jugée seule, la
// lecture arrêtée à la première qui a la forme.
//
// RIEN DU CONTENU NE SORT D'ICI : le jugement ne retient que des comptes (pages lues, fragments par page), une raison qui est
// un code fixe du lecteur, le poids et la durée. Ni un fragment, ni une ligne, ni un nombre lu dans le fichier.

import { porteLaFormeDUnBordereau } from '../../src/lib/bordereauDeTeletransmission'
import { lireLeTexteDUnPdf, type RaisonIllisible } from '../../src/lib/texteDUnPdf'

/** Les bornes de receive-email, au caractère près de leurs valeurs (TAILLE_MAX_PIECE, OCTETS_DECOMPRESSES_MAX, LECTURE_DES_PDF_MS). */
export const TAILLE_MAX_PIECE = 20 * 1024 * 1024
export const OCTETS_DECOMPRESSES_MAX = 48 * 1024 * 1024
export const LECTURE_DES_PDF_MS = 1000

export type Jugement =
  | { conclusion: 'trop-lourd'; octets: number }
  | { conclusion: 'reconnu'; octets: number; pages: number; dureeMs: number }
  | { conclusion: 'non-reconnu'; octets: number; pages: number; fragmentsParPage: number[]; dureeMs: number }
  | { conclusion: 'illisible'; octets: number; raison: RaisonIllisible; pages: number; dureeMs: number }

/** Juge des octets comme receive-email les jugerait. `maintenant` : l'horloge, en millisecondes. Ne rejette jamais. */
export async function jugerCommeLaReception(octets: Uint8Array, maintenant: () => number): Promise<Jugement> {
  if (octets.byteLength > TAILLE_MAX_PIECE) return { conclusion: 'trop-lourd', octets: octets.byteLength }
  const debut = maintenant()
  const fragmentsParPage: number[] = []
  const lu = await lireLeTexteDUnPdf(
    octets,
    { octetsDecompressesMax: OCTETS_DECOMPRESSES_MAX, dureeMaxMs: LECTURE_DES_PDF_MS, maintenant },
    (page) => {
      fragmentsParPage.push(page.fragments.length)
      return porteLaFormeDUnBordereau([page])
    },
  )
  const dureeMs = Math.max(0, Math.round(maintenant() - debut))
  if (lu.etat === 'illisible') return { conclusion: 'illisible', octets: octets.byteLength, raison: lu.raison, pages: fragmentsParPage.length, dureeMs }
  if (lu.arrete) return { conclusion: 'reconnu', octets: octets.byteLength, pages: lu.pages, dureeMs }
  return { conclusion: 'non-reconnu', octets: octets.byteLength, pages: lu.pages, fragmentsParPage, dureeMs }
}

const RAISONS: Record<RaisonIllisible, string> = {
  'pas-un-pdf': 'le fichier ne commence pas comme un PDF',
  chiffre: 'le PDF est chiffré',
  'sans-page': 'aucune page trouvée',
  borne: 'la lecture a atteint une borne (48 Mio décompressés ou une seconde)',
  erreur: 'une structure que ce lecteur ne sait pas lire',
}

function poids(octets: number): string {
  if (octets < 1024) return `${octets} octets`
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1).replace('.', ',')} Kio`
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mio`
}

/** Le diagnostic d'un PDF non reconnu : des comptes seuls. Au-delà de vingt pages, le compte des pages sans texte. */
function diagnostic(fragmentsParPage: number[]): string[] {
  const sansTexte = fragmentsParPage.filter((n) => n === 0).length
  const detail = fragmentsParPage.length <= 20
    ? fragmentsParPage.map((n, i) => `page ${i + 1} : ${n}`).join(', ')
    : `${fragmentsParPage.length} pages, dont ${sansTexte} sans aucun fragment`
  return [
    `  Fragments de texte lus par page : ${detail}`,
    sansTexte === fragmentsParPage.length
      ? '  Aucune page n’a de couche de texte lisible par ce lecteur (un scan, ou une police qu’il ne sait pas lire).'
      : sansTexte > 0 ? `  ${sansTexte} page(s) sans couche de texte lisible par ce lecteur.` : '  Chaque page a du texte lisible.',
    // Un seul des deux signes suffit (le titre en ligne entière, OU l'en-tête des colonnes) : non reconnu, les deux manquent.
    '  Signes de la forme : ni le titre « Bordereau de Teletransmission » en ligne entière, ni l’en-tête des colonnes',
    '  (« Facture Date prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré ») n’ont été trouvés.',
  ]
}

/** Le texte affiché pour un jugement : une conclusion, puis des comptes. Rien du contenu du fichier. */
export function texteDuJugement(j: Jugement): string {
  const fin = 'Aucun mot, aucune ligne ni aucun nombre du fichier n’est affiché, et rien n’a quitté cet ordinateur.'
  if (j.conclusion === 'trop-lourd') {
    return [
      'AU-DELÀ DE 20 Mio : la réception par e-mail l’écarterait pour son poids, sans le lire.',
      `  Poids du fichier ........ ${poids(j.octets)}`, '', fin,
    ].join('\n')
  }
  const tete = j.conclusion === 'reconnu'
    ? 'RECONNU COMME UN BORDEREAU : la réception par e-mail l’écarterait.'
    : j.conclusion === 'non-reconnu'
      ? 'NON RECONNU : il serait déposé comme une pièce.'
      : `ILLISIBLE PAR CE LECTEUR (${RAISONS[j.raison]}) : il serait déposé comme une pièce.`
  const lignes = [
    tete,
    `  Pages lues .............. ${j.pages}${j.conclusion === 'reconnu' ? ' (la lecture s’arrête à la première page qui a la forme)' : ''}`,
    `  Arrêt à une borne ....... ${j.conclusion === 'illisible' && j.raison === 'borne' ? 'oui' : 'non'}`,
    `  Poids du fichier ........ ${poids(j.octets)}`,
    `  Durée de la lecture ..... ${j.dureeMs} ms (sur cet ordinateur ; la réception a une seconde pour tous les PDF d’un e-mail)`,
  ]
  if (j.conclusion === 'non-reconnu') lignes.push('', ...diagnostic(j.fragmentsParPage))
  return [...lignes, '', fin].join('\n')
}
