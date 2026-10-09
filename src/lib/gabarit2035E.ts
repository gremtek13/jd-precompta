import { LIGNES_2035E } from './declaration2035E'
import {
  LONGUEUR_SIRET, TAILLE_ENTETE, TAILLE_MONTANT, ancragesDesCodes, chiffresDuSiret, formaterMontant, grilleDeSaisie,
  texteCompatiblePdf,
} from './gabarit2035'
import type { FragmentTexte, Inscription, PageFormulaire } from './gabarit2035'

// Géométrie du remplissage de l'annexe 2035-E : la page 3 de la liasse BNC officielle (public/formulaires/2035-sd-2026.pdf,
// 2035-E-SD 2026). Même méthode que la 2035 (gabarit2035.ts) : rien n'est codé en dur, tout se déduit du formulaire —
// le code imprimé de chaque ligne donne sa hauteur, le deuxième filet vertical à sa droite ferme la case du montant.
// Relevé sur ce millésime : les dix-huit codes de montant ont leur case entre x ≈ 421,5 et x ≈ 566,3.
//
// CE QUI N'EST PAS ÉCRIT : le cadre réservé aux mono-établissements (AH, AJ, BO, BK, KA, LA, MA). Il ne se remplit que si le
// dossier n'a qu'un établissement au sens de la CFE — coché, il dispense de la 1330-CVAE —, et l'application ne le sait
// pas. Le cocher à sa place affirmerait ce que personne n'a vérifié ; l'écran donne ce qu'il porterait.

// Les codes que cette page sait recevoir : ceux des lignes de montant, et eux seuls. « BK » n'y est pas, et c'est voulu :
// sur cette page, c'est la case des effectifs.
const CODES_DE_MONTANT = new Set(LIGNES_2035E.map((l) => l.code))

const RETRAIT_DROITE = 4
// Écart entre le filet qui ouvre une zone de saisie et le texte qu'on y pose.
const RETRAIT_GAUCHE = 3

// Libellés imprimés de l'en-tête, recopiés de la page.
export const LIBELLE_SIRET = 'SIRET'
export const LIBELLE_NOM = 'Nom et prénom du déclarant ou dénomination'
export const LIBELLE_ADRESSE = 'Adresse professionnelle'
export const LIBELLE_CODE_POSTAL = 'Code postal'
export const LIBELLE_VILLE = 'Ville'
export const LIBELLE_ANNEE = 'RENSEIGNEMENTS RELATIFS À L\'ANNÉE'

export interface EnteteAnnexe2035E {
  nom: string | null
  siret: string | null
  // L'adresse du dossier, telle qu'Informations la garde (`dossiers.adresse`, celle que portent ses factures).
  adresse: string | null
  annee: number
}

// L'ADRESSE SE LIT À SA FORME, ELLE NE SE DEVINE PAS. Une adresse française finit par « code postal, commune » sur sa
// dernière ligne : quand c'est le cas — cinq chiffres, une espace, la commune —, ils vont dans leurs deux cases et le
// reste sur la ligne de l'adresse. Sinon, toute l'adresse va sur sa ligne, et les deux cases restent vides plutôt que de
// recevoir un morceau pris au hasard.
export function decouperAdresse(adresse: string | null): { voie: string; codePostal: string | null; ville: string | null } | null {
  const lignes = (adresse ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
  if (lignes.length === 0) return null
  const derniere = /^(\d{5}) (\S.*)$/.exec(lignes[lignes.length - 1])
  if (derniere && lignes.length > 1) {
    return { voie: lignes.slice(0, -1).join(', '), codePostal: derniere[1], ville: derniere[2] }
  }
  return { voie: lignes.join(', '), codePostal: null, ville: null }
}

// Le premier filet vertical à droite d'un fragment, sur sa ligne : il ouvre la zone où se porte la valeur.
function debutDeZone(page: PageFormulaire, fragment: FragmentTexte): number {
  const centre = fragment.y + fragment.hauteur / 2
  const filets = page.filets
    .filter((f) => f.x > fragment.x + fragment.largeur && f.y0 < centre && f.y1 > centre)
    .map((f) => f.x)
    .sort((a, b) => a - b)
  return (filets[0] ?? fragment.x + fragment.largeur + 5) + RETRAIT_GAUCHE
}

function libelle(page: PageFormulaire, texte: string): FragmentTexte | undefined {
  return page.fragments.find((f) => f.texte.trim() === texte)
}

export function planDeRemplissage2035E(
  page: PageFormulaire,
  // La page du PDF où elle se trouve, 1-indexée : la troisième de la liasse.
  numeroDePage: number,
  // Les lignes à l'euro (`calculer2035E(...).lignes`).
  valeurs: ReadonlyMap<string, number>,
  entete: EnteteAnnexe2035E,
): { inscriptions: Inscription[]; codesSansAncrage: string[] } {
  const inscriptions: Inscription[] = []
  const codesSansAncrage: string[] = []
  const ancrages = ancragesDesCodes([page], CODES_DE_MONTANT)

  // Une ligne à zéro ne s'inscrit pas, comme sur la 2035 : une case vide vaut zéro. Une ligne sans ancre est remontée,
  // jamais dessinée au jugé.
  for (const ligne of LIGNES_2035E) {
    const montant = valeurs.get(ligne.code) ?? 0
    if (montant === 0) continue
    const ancrage = ancrages.get(ligne.code)
    if (!ancrage) {
      codesSansAncrage.push(ligne.code)
      continue
    }
    inscriptions.push({
      page: numeroDePage, texte: formaterMontant(montant), x: ancrage.xDroite - RETRAIT_DROITE, y: ancrage.y,
      alignement: 'droite', taille: TAILLE_MONTANT,
    })
  }

  // Le SIRET chiffre par chiffre, seulement si la grille est trouvée entière (voir `grilleDeSaisie`).
  const chiffres = chiffresDuSiret(entete.siret)
  const libelleSiret = libelle(page, LIBELLE_SIRET)
  const cellules = grilleDeSaisie(page, LIBELLE_SIRET, LONGUEUR_SIRET)
  if (chiffres && libelleSiret && cellules) {
    cellules.forEach((x, i) => inscriptions.push({
      page: numeroDePage, texte: chiffres[i], x, y: libelleSiret.y, alignement: 'centre', taille: TAILLE_ENTETE,
    }))
  }

  const poser = (texteLibelle: string, valeur: string | null) => {
    const texte = texteCompatiblePdf(valeur?.trim() ?? '')
    const fragment = libelle(page, texteLibelle)
    if (!texte || !fragment) return
    inscriptions.push({
      page: numeroDePage, texte, x: debutDeZone(page, fragment), y: fragment.y, alignement: 'gauche', taille: TAILLE_ENTETE,
    })
  }
  poser(LIBELLE_NOM, entete.nom)
  const adresse = decouperAdresse(entete.adresse)
  if (adresse) {
    poser(LIBELLE_ADRESSE, adresse.voie)
    poser(LIBELLE_CODE_POSTAL, adresse.codePostal)
    poser(LIBELLE_VILLE, adresse.ville)
  }

  // « RENSEIGNEMENTS RELATIFS À L'ANNÉE 20.. » : les deux derniers chiffres, juste après le « 20 » imprimé sur la même
  // ligne. Toute l'année civile — la période de référence d'un BNC ; une activité commencée ou cessée en cours d'année se
  // déclare par la période « DU … AU … », que l'application ne connaît pas.
  const titre = libelle(page, LIBELLE_ANNEE)
  const siecle = titre && page.fragments.find((f) => f.texte.trim() === '20' && Math.abs(f.y - titre.y) < 1 && f.x > titre.x)
  if (siecle && entete.annee >= 2000 && entete.annee <= 2099) {
    inscriptions.push({
      page: numeroDePage, texte: String(entete.annee).slice(2), x: siecle.x + siecle.largeur + 1, y: siecle.y,
      alignement: 'gauche', taille: TAILLE_ENTETE,
    })
  }

  return { inscriptions, codesSansAncrage }
}
