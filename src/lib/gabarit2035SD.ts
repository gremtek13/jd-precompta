import { formatDate } from './format'
import { chiffresDuSiret, formaterMontant, texteCompatiblePdf } from './gabarit2035'
import type { FiletVertical, FragmentTexte, Inscription } from './gabarit2035'
import { totauxDesLignes } from './declaration2035SD'
import type { Declaration2035SD, LigneDesImmobilisations, Montant2035SD, TotauxDesImmobilisations } from './declaration2035SD'

// OÙ ÉCRIRE LA DÉCLARATION PRINCIPALE N° 2035-SD (docs/conceptions/55-formulaire-2035-sd.md), à partir de ce qu'on lit sur le
// formulaire vierge lui-même — le partage de gabarit2035.ts : ce module ne touche ni à pdf.js ni à pdf-lib, il reçoit les
// fragments de texte et les filets déjà extraits et rend un plan d'inscriptions, testé sur le vrai formulaire
// (gabarit2035SD.test.ts).
//
// LE FORMULAIRE N'A NI CHAMPS NI CODES DE CASE. Contrairement aux annexes (AA, BH, CP…), la 2035-SD ne porte aucun code : une
// case se repère par le LIBELLÉ imprimé qui la précède, et ses bords par les filets tracés à sa droite — le premier filet à
// droite du libellé ouvre la case, le second la ferme (`celluleADroite`). Le tableau des immobilisations se repère par les
// numéros de ses colonnes (« 1 » à « 7 ») et ses lignes horizontales : son corps n'a aucune ligne tracée, les biens s'y
// écrivent à pas constant. Rien n'est en coordonnées écrites ici : un millésime dont la mise en page bouge se relit, et ce
// qui ne se retrouve pas n'est pas dessiné au jugé — il est dit (`libellesSansAncrage`).

export interface FiletHorizontal {
  y: number
  x0: number
  x1: number
}

/** Une page lue avec ses filets dans les deux sens : le tableau des immobilisations a besoin des horizontaux. */
export interface PageQuadrillee {
  fragments: FragmentTexte[]
  filets: FiletVertical[]
  horizontaux: FiletHorizontal[]
}

/** Une inscription qui ne doit pas déborder de sa case : remplir2035SD.ts réduit la police, puis coupe, au-delà. */
export interface Inscription2035SD extends Inscription {
  largeurMax?: number
}

export const TAILLE_ENTETE_SD = 9
export const TAILLE_MONTANT_SD = 9
export const TAILLE_TABLEAU = 7
/** Le pas des lignes du tableau des immobilisations, dont le corps n'a pas de lignes tracées. */
export const PAS_DU_TABLEAU = 10
const RETRAIT = 4
export const PAGE_DU_TABLEAU = 3

export interface Cellule {
  gauche: number
  droite: number
  /** La ligne de base du libellé : le texte s'y pose. */
  y: number
}

// LA CASE À DROITE D'UN LIBELLÉ : les deux premiers filets verticaux à droite de son bord droit qui traversent le milieu de sa
// hauteur. `sous` restreint la recherche aux libellés plus bas qu'une ordonnée (« A » et « B » existent ailleurs en mots).
export function celluleADroite(
  page: Pick<PageQuadrillee, 'fragments' | 'filets'>,
  correspond: (texte: string) => boolean,
  sous = Infinity,
): Cellule | null {
  for (const f of page.fragments) {
    if (!correspond(f.texte.trim()) || f.y >= sous) continue
    const cellule = celluleDuFragment(page, f)
    if (cellule) return cellule
  }
  return null
}

/** La case à droite d'un fragment donné : les deux premiers filets à sa droite qui traversent sa ligne. */
export function celluleDuFragment(page: Pick<PageQuadrillee, 'filets'>, f: FragmentTexte): Cellule | null {
  const centre = f.y + f.hauteur / 2
  const xs = [...new Set(page.filets
    .filter((v) => v.x > f.x + f.largeur + 1 && v.y0 < centre && v.y1 > centre)
    .map((v) => Math.round(v.x * 10) / 10))].sort((a, b) => a - b)
  return xs.length >= 2 ? { gauche: xs[0], droite: xs[1], y: f.y } : null
}

const exactement = (libelle: string) => (texte: string) => texte === libelle

export const LONGUEUR_DU_SIRET = 14

// LA GRILLE DU SIRET des pages 3 et 4 : quatorze cases à droite du libellé « N° SIRET », d'un pas IRRÉGULIER sur la page 4 (de
// 15 à 30 points, relevé sur le millésime 2026) — `grilleDeSaisie` de la 2035, qui exige un pas constant, ne la trouverait pas.
// Les quinze premiers filets qui traversent la ligne du libellé, chaque pas entre 8 et 40 points ; sinon null, et le numéro
// s'écrit en clair dans la case (page 1, qui n'a pas de grille).
export function grilleDuSiret(page: Pick<PageQuadrillee, 'fragments' | 'filets'>): { centres: number[]; y: number } | null {
  const libelle = page.fragments.find((f) => f.texte.trim() === 'N° SIRET')
  if (!libelle) return null
  const centre = libelle.y + libelle.hauteur / 2
  const xs = [...new Set(page.filets
    .filter((v) => v.x > libelle.x + libelle.largeur && v.y0 < centre && v.y1 > centre)
    .map((v) => Math.round(v.x * 10) / 10))].sort((a, b) => a - b)
  if (xs.length < LONGUEUR_DU_SIRET + 1) return null
  const grille = xs.slice(0, LONGUEUR_DU_SIRET + 1)
  for (let i = 1; i < grille.length; i++) {
    const pas = grille[i] - grille[i - 1]
    if (pas < 8 || pas > 40) return null
  }
  return { centres: grille.slice(0, -1).map((x, i) => (x + grille[i + 1]) / 2), y: libelle.y }
}

export interface Colonne {
  gauche: number
  droite: number
}

export interface GeometrieDuTableau {
  /** Nature, puis les colonnes numérotées 1 à 7 du formulaire. */
  colonnes: { nature: Colonne; date: Colonne; prixTtc: Colonne; tvaDeduite: Colonne; base: Colonne; mode: Colonne; anterieurs: Colonne; annee: Colonne }
  /** La ligne de base de la première ligne du corps, et combien de biens y tiennent. */
  premiereLigne: number
  capacite: number
  /** Les lignes de base de « Total du tableau » et de « Report du total de la dernière annexe ». */
  total: number
  report: number
  /** Les cases (A), (B) et la dotation nette. */
  a: Cellule
  b: Cellule
  nette: Cellule
}

// LE TABLEAU I, relevé sur la page : les colonnes par leurs numéros imprimés (« 1 » à « 7 », sur une même ligne) et les
// filets qui les bordent ; le corps entre la ligne tracée sous ces numéros et la suivante ; les lignes de total par leurs
// libellés. Null dès qu'une pièce manque : le tableau ne s'écrit pas au jugé.
export function geometrieDuTableau(page: PageQuadrillee): GeometrieDuTableau | null {
  const chiffres = page.fragments.filter((f) => /^[1-7]$/.test(f.texte.trim()))
  const parLigne = new Map<number, FragmentTexte[]>()
  for (const f of chiffres) parLigne.set(Math.round(f.y), [...(parLigne.get(Math.round(f.y)) ?? []), f])
  const numeros = [...parLigne.values()].find((l) => new Set(l.map((f) => f.texte.trim())).size === 7)
  if (!numeros) return null
  const colonneDe = (f: FragmentTexte): Colonne | null => {
    const centre = f.y + f.hauteur / 2
    const traversent = page.filets.filter((v) => v.y0 < centre && v.y1 > centre)
    const gauche = Math.max(...traversent.filter((v) => v.x < f.x).map((v) => v.x))
    const droite = Math.min(...traversent.filter((v) => v.x > f.x + f.largeur).map((v) => v.x))
    const auDixieme = (x: number) => Math.round(x * 10) / 10
    return Number.isFinite(gauche) && Number.isFinite(droite) ? { gauche: auDixieme(gauche), droite: auDixieme(droite) } : null
  }
  const numerotees = ['1', '2', '3', '4', '5', '6', '7'].map((n) => {
    const f = numeros.find((x) => x.texte.trim() === n)
    return f ? colonneDe(f) : null
  })
  if (numerotees.some((c) => c === null)) return null
  const [date, prixTtc, tvaDeduite, base, mode, anterieurs, annee] = numerotees as Colonne[]
  const y = numeros[0].y
  const avantLaDate = page.filets
    .filter((v) => v.y0 < y && v.y1 > y && v.x < date.gauche - 1)
    .map((v) => v.x)
  if (avantLaDate.length === 0) return null
  const nature = { gauche: Math.round(Math.max(...avantLaDate) * 10) / 10, droite: date.gauche }

  // Le corps : entre la ligne tracée sous les numéros et la suivante, toutes deux traversant la colonne 4.
  const milieu = (base.gauche + base.droite) / 2
  const lignes = [...new Set(page.horizontaux.filter((h) => h.x0 <= milieu && h.x1 >= milieu).map((h) => Math.round(h.y * 10) / 10))]
    .sort((a, b) => b - a)
  const haut = lignes.find((l) => l < y - 1)
  const bas = haut === undefined ? undefined : lignes.find((l) => l < haut - 1)
  if (haut === undefined || bas === undefined || haut - bas < 3 * PAS_DU_TABLEAU) return null
  const premiereLigne = haut - 8
  const capacite = Math.floor((premiereLigne - (bas + 2)) / PAS_DU_TABLEAU) + 1

  const ligneDe = (libelle: string) => page.fragments.find((f) => f.texte.trim() === libelle && f.y < bas)?.y
  const total = ligneDe('Total du tableau (B)')
  const report = ligneDe('dernière annexe (B)')
  const a = celluleADroite(page, exactement('A'), bas)
  const b = celluleADroite(page, exactement('B'), bas)
  const nette = celluleADroite(page, (t) => t.startsWith('Dotation nette de l'), bas)
  if (total === undefined || report === undefined || !a || !b || !nette) return null
  return {
    colonnes: { nature, date, prixTtc, tvaDeduite, base, mode, anterieurs, annee },
    premiereLigne, capacite, total, report, a, b, nette,
  }
}

/** Les biens, page par page : la page 3 d'abord, puis autant d'états annexes que le reste en demande. */
export function decouperLesLignes<T>(lignes: readonly T[], capacite: number): T[][] {
  if (lignes.length === 0) return [[]]
  const morceaux: T[][] = []
  for (let i = 0; i < lignes.length; i += capacite) morceaux.push(lignes.slice(i, i + capacite))
  return morceaux
}

export interface EnteteDeclaration2035SD {
  nom: string | null
  activite: string | null
  siret: string | null
  /** L'adresse professionnelle du dossier (celle des factures et de la 2035-E) — 2035SD-Q2 (A), 17/11/2026. */
  adresse: string | null
  /**
   * « Date de début de l'exercice de la profession », AAAA-MM-JJ : le début d'activité de l'onglet Cotisations
   * (`debutDeLaProfession`, 2035SD-Q1 (A), 17/11/2026), ou null — la case reste vide. Sans valeur par défaut.
   */
  debutDeLaProfession: string | null
}

export interface PlanDeRemplissage2035SD {
  inscriptions: Inscription2035SD[]
  /** « à saisir », en rouge, dans la case qui l'attend. */
  aSaisir: Inscription2035SD[]
  /** Les mentions de l'application, en rouge au bas de chaque page (numéro → lignes). */
  mentionsDeBasDePage: Map<number, string[]>
  /** Combien de copies de la page 3 ajouter en fin de document comme états annexes (pages 5 et suivantes). */
  etatsAnnexes: number
  /** Un cadre dont une valeur existait mais dont la case n'a pas été retrouvée sur le formulaire. Jamais tu. */
  libellesSansAncrage: string[]
}

export const A_SAISIR = 'à saisir'

export function notesDeLaPremierePage(): string[] {
  return [
    'Rempli par l’application : l’identité, la date de début de la profession (onglet Cotisations), la ligne 1 (report de la case CP ou CR de la 2035-B) et, page 3, le tableau I',
    'des immobilisations et des amortissements. Les autres cadres restent à compléter par le cabinet ; à relire avant le dépôt.',
  ]
}

export function planDeRemplissage2035SD(
  // Les quatre pages du formulaire vierge, dans l'ordre (index 0 : la page 1).
  pages: readonly PageQuadrillee[],
  declaration: Declaration2035SD,
  entete: EnteteDeclaration2035SD,
  // Les avis du tableau (`avisDuTableauDesImmobilisations`), écrits au bas de la page 3. Sans valeur par défaut.
  avisDuTableau: readonly string[],
): PlanDeRemplissage2035SD {
  const inscriptions: Inscription2035SD[] = []
  const aSaisir: Inscription2035SD[] = []
  const mentionsDeBasDePage = new Map<number, string[]>()
  const libellesSansAncrage: string[] = []
  const noter = (page: number, lignes: readonly string[]) => mentionsDeBasDePage.set(page, [...(mentionsDeBasDePage.get(page) ?? []), ...lignes])

  const montantA = (page: number, x: number, y: number, valeur: Montant2035SD, taille: number) => {
    if (valeur === 0) return
    if (valeur === 'a_saisir') {
      aSaisir.push({ page, texte: A_SAISIR, x, y, alignement: 'droite', taille: Math.min(taille, 7) })
      return
    }
    inscriptions.push({ page, texte: formaterMontant(valeur), x, y, alignement: 'droite', taille })
  }

  // ─── L'identité ───
  const page1 = pages[0]
  const droiteDeLaPage = (p: PageQuadrillee) => Math.max(...p.filets.map((v) => v.x), 0) - RETRAIT
  const texteApres = (numero: number, p: PageQuadrillee | undefined, libelle: (t: string) => boolean, valeur: string | null) => {
    const texte = texteCompatiblePdf((valeur ?? '').replace(/\s*\n\s*/g, ', ').trim())
    if (!texte || !p) return
    // Le PREMIER libellé dans l'ordre de lecture (du haut de la page) : la page 1 imprime deux « Adresse du déclarant ».
    const f = [...p.fragments].filter((x) => libelle(x.texte.trim())).sort((u, v) => v.y - u.y)[0]
    if (!f) {
      libellesSansAncrage.push(`page ${numero} : ${texte.slice(0, 20)}`)
      return
    }
    // Dans la case tracée à droite du libellé quand il y en a une (« Nature de l'activité ») ; sinon juste après lui, jusqu'au
    // bord droit du cadre (« Nom et Prénom », que rien ne borde).
    const cellule = celluleDuFragment(p, f)
    const x = cellule ? cellule.gauche + RETRAIT : f.x + f.largeur + 8
    inscriptions.push({
      page: numero, texte, x, y: f.y, alignement: 'gauche', taille: TAILLE_ENTETE_SD,
      largeurMax: (cellule ? cellule.droite - RETRAIT : droiteDeLaPage(p)) - x,
    })
  }
  if (page1) {
    texteApres(1, page1, exactement('Nom et Prénom'), entete.nom)
    texteApres(1, page1, exactement('Adresse du déclarant'), entete.adresse)
    texteApres(1, page1, exactement('Nature de l\'activité'), entete.activite)
    // La date de début de la profession : le libellé court sur deux lignes (« Date de début de l'exercice de » puis « la
    // profession : ») ; la case tracée à droite de la première, la date posée entre leurs deux lignes de base.
    if (entete.debutDeLaProfession) {
      const date = formatDate(entete.debutDeLaProfession)
      const f = page1.fragments.find((x) => x.texte.trim() === 'Date de début de l\'exercice de')
      const cellule = f ? celluleDuFragment(page1, f) : null
      if (!f || !cellule) {
        libellesSansAncrage.push(`page 1 : date de début de la profession (${date})`)
      } else {
        const suite = page1.fragments.find((x) => x.texte.trim().startsWith('la profession') && x.y < f.y && x.y > f.y - 15)
        inscriptions.push({
          page: 1, texte: date, x: cellule.gauche + RETRAIT, y: suite ? (f.y + suite.y) / 2 : f.y, alignement: 'gauche',
          taille: TAILLE_ENTETE_SD, largeurMax: cellule.droite - cellule.gauche - 2 * RETRAIT,
        })
      }
    }
  }

  const siret = chiffresDuSiret(entete.siret)
  const pagesDuDeclarant = (numero: number, p: PageQuadrillee | undefined) => {
    if (!p) return
    if (numero !== 1) {
      texteApres(numero, p, exactement('NOM ET PRÉNOMS ou DÉNOMINATION'), entete.nom)
    }
    if (!siret) return
    const grille = grilleDuSiret(p)
    if (grille) {
      grille.centres.forEach((x, i) => inscriptions.push({ page: numero, texte: siret[i], x, y: grille.y, alignement: 'centre', taille: TAILLE_ENTETE_SD }))
      return
    }
    const cellule = celluleADroite(p, exactement('N° SIRET'))
    if (!cellule) {
      libellesSansAncrage.push(`page ${numero} : N° SIRET`)
      return
    }
    inscriptions.push({ page: numero, texte: siret.join(''), x: cellule.gauche + RETRAIT, y: cellule.y, alignement: 'gauche', taille: TAILLE_ENTETE_SD })
  }
  pages.forEach((p, i) => { if (i !== 1) pagesDuDeclarant(i + 1, p) })

  // ─── La récapitulation, ligne 1 ───
  const ligne1 = (libelle: string, valeur: number) => {
    if (valeur === 0) return
    const cellule = page1 ? celluleADroite(page1, exactement(libelle)) : null
    if (!cellule) {
      libellesSansAncrage.push(`ligne 1 : ${libelle}`)
      return
    }
    montantA(1, cellule.droite - RETRAIT, cellule.y, valeur, TAILLE_MONTANT_SD)
  }
  ligne1('Bénéfice', declaration.benefice)
  ligne1('Déficit', declaration.deficit)

  // ─── Le tableau I ───
  const tableau = declaration.immobilisations
  const page3 = pages[PAGE_DU_TABLEAU - 1]
  const geometrie = page3 ? geometrieDuTableau(page3) : null
  let etatsAnnexes = 0
  if (!geometrie) {
    if (tableau.lignes.length > 0 || tableau.totalGeneral !== 0) libellesSansAncrage.push('tableau I des immobilisations')
  } else {
    const morceaux = decouperLesLignes(tableau.lignes, geometrie.capacite)
    etatsAnnexes = morceaux.length - 1
    const { colonnes: c } = geometrie
    const ecrireTotaux = (page: number, y: number, t: TotauxDesImmobilisations) => {
      montantA(page, c.prixTtc.droite - 3, y, t.prixTtc, TAILLE_TABLEAU)
      montantA(page, c.tvaDeduite.droite - 3, y, t.tvaDeduite, TAILLE_TABLEAU)
      montantA(page, c.base.droite - 3, y, t.base, TAILLE_TABLEAU)
      montantA(page, c.anterieurs.droite - 3, y, t.anterieurs, TAILLE_TABLEAU)
      montantA(page, c.annee.droite - 3, y, t.annee, TAILLE_TABLEAU)
    }
    const ecrireLigne = (page: number, y: number, l: LigneDesImmobilisations) => {
      const nature = texteCompatiblePdf(l.nature.replace(/\s+/g, ' ').trim())
      if (nature) {
        inscriptions.push({
          page, texte: nature, x: c.nature.gauche + 2, y, alignement: 'gauche', taille: TAILLE_TABLEAU,
          largeurMax: c.nature.droite - c.nature.gauche - 4,
        })
      }
      inscriptions.push({ page, texte: formatDate(l.miseEnService), x: (c.date.gauche + c.date.droite) / 2, y, alignement: 'centre', taille: TAILLE_TABLEAU })
      montantA(page, c.prixTtc.droite - 3, y, l.prixTtc, TAILLE_TABLEAU)
      montantA(page, c.tvaDeduite.droite - 3, y, l.tvaDeduite, TAILLE_TABLEAU)
      montantA(page, c.base.droite - 3, y, l.base, TAILLE_TABLEAU)
      inscriptions.push({ page, texte: l.mode, x: (c.mode.gauche + c.mode.droite) / 2, y, alignement: 'centre', taille: TAILLE_TABLEAU })
      montantA(page, c.anterieurs.droite - 3, y, l.anterieurs, TAILLE_TABLEAU)
      montantA(page, c.annee.droite - 3, y, l.annee, TAILLE_TABLEAU)
    }
    morceaux.forEach((morceau, j) => {
      // La page 3, puis les états annexes ajoutés après la page 4.
      const page = j === 0 ? PAGE_DU_TABLEAU : pages.length + j
      morceau.forEach((l, k) => ecrireLigne(page, geometrie.premiereLigne - k * PAS_DU_TABLEAU, l))
      if (morceau.length > 0) ecrireTotaux(page, geometrie.total, totauxDesLignes(morceau))
      // « Report du total de la dernière annexe » : ce que portent les états annexes qui suivent celui-ci.
      const suivants = morceaux.slice(j + 1).flat()
      if (suivants.length > 0) ecrireTotaux(page, geometrie.report, totauxDesLignes(suivants))
      if (j > 0) {
        noter(page, [`État annexe n° ${j} au tableau I (immobilisations et amortissements) de la déclaration 2035-SD : `
          + `${morceau.length} bien(s), reportés page 3.`])
        // L'en-tête de l'état annexe : le déclarant, comme sur la page qu'il prolonge.
        pagesDuDeclarant(page, page3)
      }
    })
    montantA(PAGE_DU_TABLEAU, geometrie.a.droite - RETRAIT, geometrie.a.y, tableau.totalGeneral, TAILLE_TABLEAU + 1)
    montantA(PAGE_DU_TABLEAU, geometrie.b.droite - RETRAIT, geometrie.b.y, tableau.vehiculesSousLeBareme, TAILLE_TABLEAU + 1)
    montantA(PAGE_DU_TABLEAU, geometrie.nette.droite - RETRAIT, geometrie.nette.y, tableau.dotationNette, TAILLE_TABLEAU + 1)
  }

  noter(1, notesDeLaPremierePage())
  if (avisDuTableau.length > 0) noter(PAGE_DU_TABLEAU, avisDuTableau)
  return { inscriptions, aSaisir, mentionsDeBasDePage, etatsAnnexes, libellesSansAncrage }
}
