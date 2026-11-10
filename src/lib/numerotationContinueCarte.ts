// LA CARTE « NUMÉROTATION DES FACTURES » DU CABINET (ligne 51.5, étape A9b), sa règle à part de l'écran : ce que la carte lit
// (`etat_de_la_numerotation`, `continuite_des_series`, `modeles_numerotation`, jugé forme par forme), ce qu'elle dit de chaque
// série, et les refus qu'elle redit AVANT le clic, aux mots de la base, sur la saisie TELLE QU'ELLE PART — jamais une règle
// recopiée d'ailleurs que de `src/lib/numerotationContinue.ts` et du texte de `fixer_modele_numerotation`,
// `confirmer_fin_de_serie` et `lever_trous_de_numerotation` (migration préparée 20261110100000_numerotation_continue.sql, A9a ;
// numerotationContinueCarte.test.ts les confronte à ce texte). La base reste seule juge : ce module ne fait que dire plus tôt
// ce qu'elle dirait. Pur : il n'importe jamais `supabase.ts`. Le drapeau qui garde la carte : `NUMEROTATION_CONTINUE_PREVUE`.

import {
  MODELES_PAR_DEFAUT, libelleDeSerie, modelesSeRecouvrent, numeroDuModele, refusDuModele,
  type Emetteur, type Intervalle, type NatureDeSerie,
} from './numerotationContinue'
import { formatDate } from './format'

// ══ Les quatre emplacements ══════════

export interface Emplacement { nature: NatureDeSerie; emetteur: Emetteur }

/** Les quatre emplacements, dans l'ordre où la base les rend (`etat_de_la_numerotation`). */
export const EMPLACEMENTS: readonly Emplacement[] = [
  { nature: 'facture', emetteur: 'client' },
  { nature: 'avoir', emetteur: 'client' },
  { nature: 'facture', emetteur: 'mandataire' },
  { nature: 'avoir', emetteur: 'mandataire' },
]

const NATURES: readonly NatureDeSerie[] = ['facture', 'avoir']
const EMETTEURS: readonly Emetteur[] = ['client', 'mandataire']

/** Ce que les messages de la base disent d'un emplacement (`libelle_d_emplacement`). */
export function libelleDEmplacement(e: Emplacement): string {
  return `${e.nature === 'facture' ? 'des factures' : 'des avoirs'}${e.emetteur === 'client' ? ' du client' : ' du cabinet mandataire'}`
}

/** Le titre d'un emplacement sur la carte. */
export function titreDEmplacement(e: Emplacement): string {
  return `${e.nature === 'facture' ? 'Factures' : 'Avoirs'}${e.emetteur === 'client' ? ' du client' : ' du cabinet mandataire'}`
}

export const memeEmplacement = (a: Emplacement, b: Emplacement) => a.nature === b.nature && a.emetteur === b.emetteur

// ══ Ce que la carte lit, jugé forme par forme (une ligne d'une autre forme rend la lecture illisible) ══════════

const estEntier = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min
const estTexte = (v: unknown): v is string => typeof v === 'string' && v !== ''
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Une série telle que `etat_de_la_numerotation` la rend, pour une année. */
export interface SerieLue extends Emplacement {
  modele: string
  annuel: boolean
  /** L'année d'effet du modèle posé ; null pour celui d'un emplacement qui n'en a pas. */
  depuis: number | null
  parDefaut: boolean
  premier: number
  /** Le plus haut compteur lu dans la série (validées et reprises), ou null. */
  emis: number | null
  importes: number
  valides: number
  fin: number | null
  /** Les trous que rien ne couvre encore. */
  trous: Intervalle[]
  refus: string | null
  prochainNumero: string | null
}

export function serieLue(ligne: unknown): SerieLue | null {
  if (!estObjet(ligne)) return null
  const { nature, emetteur, modele, annuel, depuis, modele_par_defaut: parDefaut, premier, emis, importes, valides, fin, trous, refus, prochain_numero: prochain } = ligne
  if (!NATURES.includes(nature as NatureDeSerie) || !EMETTEURS.includes(emetteur as Emetteur)) return null
  if (!estTexte(modele) || typeof annuel !== 'boolean' || typeof parDefaut !== 'boolean') return null
  // Un modèle que le module refuse n'est pas un modèle : son numéro ne se formaterait pas.
  if (refusDuModele(modele, annuel) !== null) return null
  if (depuis !== null && !estEntier(depuis, 2000)) return null
  if (!estEntier(premier, 1) || (emis !== null && !estEntier(emis, 0)) || !estEntier(importes, 0) || !estEntier(valides, 0)) return null
  if (fin !== null && !estEntier(fin, 1)) return null
  if (!Array.isArray(trous)) return null
  const intervalles: Intervalle[] = []
  for (const t of trous) {
    if (!Array.isArray(t) || t.length !== 2 || !estEntier(t[0], 1) || !estEntier(t[1], 1) || t[1] < t[0]) return null
    intervalles.push([t[0], t[1]])
  }
  if (refus !== null && !estTexte(refus)) return null
  if (prochain !== null && !estTexte(prochain)) return null
  return {
    nature: nature as NatureDeSerie, emetteur: emetteur as Emetteur, modele, annuel, depuis, parDefaut, premier, emis,
    importes, valides, fin, trous: intervalles, refus, prochainNumero: prochain,
  }
}

/** Les quatre séries de la base, dans l'ordre des emplacements, ni plus ni moins ; sinon null (illisible). */
export function seriesLues(donnees: unknown): SerieLue[] | null {
  if (!Array.isArray(donnees) || donnees.length !== EMPLACEMENTS.length) return null
  const lues = donnees.map(serieLue)
  if (lues.some((s) => s === null)) return null
  const series = lues as SerieLue[]
  return series.every((s, i) => memeEmplacement(s, EMPLACEMENTS[i])) ? series : null
}

/** Une parole du cabinet sur une série (`continuite_des_series`) : la fin confirmée, ou des trous levés. */
export interface ParoleLue {
  id: string
  modele: string
  annuel: boolean
  /** 0 pour un compteur continu. */
  annee: number
  geste: 'fin' | 'trous'
  premier: number
  dernier: number
  motif: string
  poseLe: string
}

export function paroleLue(ligne: unknown): ParoleLue | null {
  if (!estObjet(ligne)) return null
  const { id, modele, annuel, annee, geste, premier, dernier, motif, pose_le: poseLe } = ligne
  if (!estTexte(id) || !estTexte(modele) || typeof annuel !== 'boolean' || !estEntier(annee, 0)) return null
  if (geste !== 'fin' && geste !== 'trous') return null
  if (!estEntier(premier, 1) || !estEntier(dernier, premier) || !estTexte(motif) || !estTexte(poseLe)) return null
  if (geste === 'fin' && premier !== dernier) return null
  return { id, modele, annuel, annee, geste, premier, dernier, motif, poseLe }
}

/** Un modèle posé (`modeles_numerotation`), lu dans l'ordre de la base : `pose_le`, puis `id`. */
export interface ModelePose extends Emplacement {
  id: string
  modele: string
  annuel: boolean
  depuis: number
  premierNumero: number
}

export function modelePose(ligne: unknown): ModelePose | null {
  if (!estObjet(ligne)) return null
  const { id, nature, emetteur, modele, annuel, depuis, premier_numero: premierNumero } = ligne
  if (!estTexte(id) || !NATURES.includes(nature as NatureDeSerie) || !EMETTEURS.includes(emetteur as Emetteur)) return null
  if (!estTexte(modele) || typeof annuel !== 'boolean' || !estEntier(depuis, 2000) || !estEntier(premierNumero, 1)) return null
  return { id, nature: nature as NatureDeSerie, emetteur: emetteur as Emetteur, modele, annuel, depuis, premierNumero }
}

// ══ Ce que la carte dit de chaque série ══════════

/** Un trou ou une fin, en numéros : « F2026-0003 », « F2026-0003 à F2026-0005 ». */
export function nomDIntervalle(modele: string, annee: number, [a, b]: Intervalle): string {
  return a === b ? numeroDuModele(modele, annee, a) : `${numeroDuModele(modele, annee, a)} à ${numeroDuModele(modele, annee, b)}`
}

export interface GesteLeve {
  id: string
  /** Les numéros levés, ou la fin confirmée, en numéros. */
  numeros: string
  motif: string
  le: string
}

export interface SerieAffichee extends Emplacement {
  titre: string
  modele: string
  annuel: boolean
  parDefaut: boolean
  depuis: number | null
  /** Le compteur, en mots. */
  compteur: string
  /** Un numéro de la série, à titre d'exemple (son premier numéro). */
  exemple: string
  /** La fin confirmée de la suite reprise, avec son motif et sa date. */
  fin: GesteLeve | null
  /** Ce qui est repris de l'ancien logiciel et validé dans l'application ; null quand il n'y en a pas. */
  reprise: string | null
  /** Les trous qui restent, nommés (les dix premiers), et ce qu'ils laissent de plus. */
  trous: string[]
  trousDePlus: number
  /** Les trous levés, avec leur motif. */
  leves: GesteLeve[]
  /** Le refus qui retiendrait la prochaine validation. */
  refus: string | null
  prochain: string | null
}

const PLURIEL = (n: number, un: string, plusieurs: string) => `${n} ${n <= 1 ? un : plusieurs}`

export function carteDesSeries(series: readonly SerieLue[], paroles: readonly ParoleLue[], annee: number): SerieAffichee[] {
  return series.map((s) => {
    // Les paroles d'une série : son modèle, son compteur, son année (0 pour un compteur continu).
    const siennes = paroles.filter((p) => p.modele === s.modele && p.annuel === s.annuel && p.annee === (s.annuel ? annee : 0))
    const nom = (p: ParoleLue) => nomDIntervalle(s.modele, annee, [p.premier, p.dernier])
    const geste = (p: ParoleLue): GesteLeve => ({ id: p.id, numeros: nom(p), motif: p.motif, le: formatDate(p.poseLe) })
    const fins = siennes.filter((p) => p.geste === 'fin').sort((x, y) => y.dernier - x.dernier)
    const reprise = s.importes > 0 || s.valides > 0
      ? `${PLURIEL(s.importes, 'numéro repris', 'numéros repris')} de l’ancien logiciel, ${PLURIEL(s.valides, 'validé', 'validés')} dans l’application.`
      : null
    return {
      nature: s.nature, emetteur: s.emetteur, titre: titreDEmplacement(s), modele: s.modele, annuel: s.annuel,
      parDefaut: s.parDefaut, depuis: s.depuis,
      compteur: s.annuel ? 'le compteur repart de 1 chaque année' : 'le compteur continue d’une année sur l’autre',
      exemple: numeroDuModele(s.modele, annee, s.premier),
      fin: fins.length > 0 ? geste(fins[0]) : null,
      reprise,
      trous: s.trous.slice(0, 10).map((t) => nomDIntervalle(s.modele, annee, t)),
      trousDePlus: Math.max(s.trous.length - 10, 0),
      leves: siennes.filter((p) => p.geste === 'trous').sort((x, y) => x.premier - y.premier || x.dernier - y.dernier).map(geste),
      refus: s.refus,
      prochain: s.prochainNumero,
    }
  })
}

// ══ Le jugement d'un geste, AVANT le clic : le refus de la base, ou les paramètres tels qu'ils partent ══════════

export type Jugement<P> = { refus: string; parametres: null } | { refus: null; parametres: P }

const refuse = <P>(refus: string): Jugement<P> => ({ refus, parametres: null })

export const REFUS_DU_GESTE = {
  /** `fixer_modele_numerotation` (22023). */
  depuis: "Un modèle de numéro s'applique à partir d'une année, de 2000 à 2099 (DGFiP, annexe 7, G1.36).",
  premierNumero: "Le premier numéro d'une série est un compteur de 1 à 999 999 999.",
  racinePropre: (modele: string, libelle: string) =>
    `Le modèle ${modele} est celui de la série ${libelle} : la série du cabinet mandataire porte une racine propre, distincte de celle du client (DGFiP, annexe 7, G1.45).`,
  recouvreLeSien: (modele: string, remplace: string) =>
    `Le modèle ${modele} recouvre celui qu'il remplace (${remplace}) : un même numéro se lirait dans les deux séries. Une nouvelle série porte un préfixe distinct (BOI-TVA-DECLA-30-20-20-10, § 90).`,
  recouvreUneAutre: (modele: string, libelle: string, autre: string) =>
    `Le modèle ${modele} produirait des numéros de la série ${libelle} (${autre}) : deux séries d'un dossier ne partagent jamais un numéro.`,
  /** `confirmer_fin_de_serie` et `lever_trous_de_numerotation`. */
  motif: "Le cabinet écrit ce qui fonde son geste : un motif de 1 000 caractères au plus.",
  dejaContinuee: (libelle: string) =>
    `L'application a déjà continué la série ${libelle} : la fin de sa suite reprise ne se confirme plus.`,
  finHorsBornes: (libelle: string, minimum: number) =>
    `La fin de la suite reprise de la série ${libelle} est le compteur de son dernier numéro, au moins ${minimum} : le plus haut repris, ou le premier de la série.`,
  finQuiRecule: (libelle: string, numero: string) =>
    `La fin de la suite reprise de la série ${libelle} est déjà confirmée au numéro ${numero} : une fin confirmée ne recule pas.`,
  pasUnTrou: (premier: string, dernier: string, libelle: string) =>
    `Les compteurs ${premier} à ${dernier} ne sont pas un trou de la série ${libelle} que rien ne couvre encore : seul un numéro qui manque se lève.`,
} as const

/** Un entier saisi : des chiffres seuls (les espaces autour s'ignorent), douze au plus ; sinon null. */
export function entierSaisi(texte: string): number | null {
  const t = texte.trim()
  return /^[0-9]{1,12}$/.test(t) ? Number(t) : null
}

/** Le motif de `confirmer_fin_de_serie` et de `lever_trous_de_numerotation` : non vide une fois dépouillé, 1 000 caractères
 *  au plus (la longueur se compte sur le texte saisi, en caractères et non en unités UTF-16). */
function motifRefuse(motif: string): boolean {
  return motif.trim() === '' || [...motif].length > 1000
}

// — Poser un modèle ————————————

/** Le modèle d'un emplacement pour une année : le dernier posé qui la couvre (la liste est dans l'ordre de la base, `pose_le`
 *  puis `id`), ou celui d'hier (`modele_en_vigueur`). */
export function modeleEnVigueur(modeles: readonly ModelePose[], e: Emplacement, annee: number): { modele: string; annuel: boolean } {
  const couvrants = modeles.filter((m) => memeEmplacement(m, e) && m.depuis <= annee)
  const dernier = couvrants[couvrants.length - 1]
  return dernier ? { modele: dernier.modele, annuel: dernier.annuel } : { modele: MODELES_PAR_DEFAUT[e.emetteur][e.nature], annuel: true }
}

export interface SaisieDeLaPose { modele: string; annuel: boolean; depuis: string; premier: string }

export interface ParametresDeLaPose {
  p_dossier_id: string
  p_nature: NatureDeSerie
  p_emetteur: Emetteur
  p_modele: string
  p_annuel: boolean
  p_depuis: number
  p_premier_numero: number
}

/** Ce que `fixer_modele_numerotation` jugerait : ses arguments, le refus du modèle, puis ce que le modèle côtoiera — pour
 *  chaque année qu'il couvre (la sienne, et celles où un modèle déjà posé change), le modèle en vigueur de chaque emplacement.
 *  Une même série se repose ; un même numéro dans deux séries se refuse. */
export function jugerLaPose(
  dossierId: string, e: Emplacement, saisie: SaisieDeLaPose, modeles: readonly ModelePose[],
): Jugement<ParametresDeLaPose> {
  const depuis = entierSaisi(saisie.depuis)
  if (depuis === null || depuis < 2000 || depuis > 2099) return refuse(REFUS_DU_GESTE.depuis)
  const premier = entierSaisi(saisie.premier)
  if (premier === null || premier < 1 || premier > 999999999) return refuse(REFUS_DU_GESTE.premierNumero)
  const refusDuTexte = refusDuModele(saisie.modele, saisie.annuel)
  if (refusDuTexte !== null) return refuse(refusDuTexte)
  const annees = [depuis, ...modeles.map((m) => m.depuis).filter((d) => d > depuis)]
  const vus = new Map<string, Emplacement & { modele: string; annuel: boolean }>()
  for (const annee of new Set(annees)) {
    for (const autre of EMPLACEMENTS) {
      const v = modeleEnVigueur(modeles, autre, annee)
      vus.set(`${autre.nature}|${autre.emetteur}|${v.modele}|${v.annuel}`, { ...autre, ...v })
    }
  }
  // L'ordre de la base : nature, émetteur, modèle.
  const ordre = [...vus.values()].sort((x, y) =>
    x.nature.localeCompare(y.nature) || x.emetteur.localeCompare(y.emetteur) || (x.modele < y.modele ? -1 : x.modele > y.modele ? 1 : 0))
  for (const v of ordre) {
    // La même série : le modèle se repose (son premier numéro change), ou les factures et les avoirs d'un même émetteur
    // partagent leur compteur.
    if (v.modele === saisie.modele && v.annuel === saisie.annuel && v.emetteur === e.emetteur) continue
    if (v.modele === saisie.modele && v.emetteur !== e.emetteur) return refuse(REFUS_DU_GESTE.racinePropre(saisie.modele, libelleDEmplacement(v)))
    if (v.modele === saisie.modele || modelesSeRecouvrent(v.modele, saisie.modele)) {
      if (memeEmplacement(v, e)) return refuse(REFUS_DU_GESTE.recouvreLeSien(saisie.modele, v.modele))
      return refuse(REFUS_DU_GESTE.recouvreUneAutre(saisie.modele, libelleDEmplacement(v), v.modele))
    }
  }
  return {
    refus: null,
    parametres: {
      p_dossier_id: dossierId, p_nature: e.nature, p_emetteur: e.emetteur, p_modele: saisie.modele, p_annuel: saisie.annuel,
      p_depuis: depuis, p_premier_numero: premier,
    },
  }
}

// — Confirmer la fin d'une série reprise ————————————

export interface SaisieDeLaFin { dernier: string; motif: string }

export interface ParametresDeLaFin {
  p_dossier_id: string
  p_nature: NatureDeSerie
  p_emetteur: Emetteur
  p_annee: number
  p_dernier: number
  p_motif: string
}

/** Ce que `confirmer_fin_de_serie` jugerait, de ce que `etat_de_la_numerotation` a rendu de la série : le motif, que
 *  l'application n'ait rien validé dans la série, le compteur (au moins le plus haut repris — tant que rien n'est validé, le
 *  plus haut compteur lu —, ou le premier de la série), et une fin déjà confirmée qui ne recule pas. */
export function jugerLaFin(dossierId: string, annee: number, serie: SerieLue, saisie: SaisieDeLaFin): Jugement<ParametresDeLaFin> {
  const libelle = libelleDeSerie(serie.modele, serie.annuel, annee)
  if (motifRefuse(saisie.motif)) return refuse(REFUS_DU_GESTE.motif)
  if (serie.valides > 0) return refuse(REFUS_DU_GESTE.dejaContinuee(libelle))
  const minimum = Math.max(serie.premier, serie.emis ?? 1)
  const dernier = entierSaisi(saisie.dernier)
  if (dernier === null || dernier < minimum || dernier > 999999999) return refuse(REFUS_DU_GESTE.finHorsBornes(libelle, minimum))
  if (serie.fin !== null && dernier <= serie.fin) {
    return refuse(REFUS_DU_GESTE.finQuiRecule(libelle, numeroDuModele(serie.modele, annee, serie.fin)))
  }
  return {
    refus: null,
    parametres: {
      p_dossier_id: dossierId, p_nature: serie.nature, p_emetteur: serie.emetteur, p_annee: annee, p_dernier: dernier,
      p_motif: saisie.motif,
    },
  }
}

// — Lever des trous ————————————

export interface SaisieDesTrous { premier: string; dernier: string; motif: string }

export interface ParametresDesTrous {
  p_dossier_id: string
  p_nature: NatureDeSerie
  p_emetteur: Emetteur
  p_annee: number
  p_premier: number
  p_dernier: number
  p_motif: string
}

/** Ce que `lever_trous_de_numerotation` jugerait : le motif, puis un intervalle tout entier dans un trou que rien ne couvre
 *  encore (ceux que la base vient de rendre). */
export function jugerLesTrous(dossierId: string, annee: number, serie: SerieLue, saisie: SaisieDesTrous): Jugement<ParametresDesTrous> {
  if (motifRefuse(saisie.motif)) return refuse(REFUS_DU_GESTE.motif)
  const premier = entierSaisi(saisie.premier)
  const dernier = entierSaisi(saisie.dernier)
  if (premier === null || dernier === null || dernier < premier || !serie.trous.some(([a, b]) => a <= premier && dernier <= b)) {
    return refuse(REFUS_DU_GESTE.pasUnTrou(
      premier === null ? '?' : String(premier), dernier === null ? '?' : String(dernier), libelleDeSerie(serie.modele, serie.annuel, annee),
    ))
  }
  return {
    refus: null,
    parametres: {
      p_dossier_id: dossierId, p_nature: serie.nature, p_emetteur: serie.emetteur, p_annee: annee, p_premier: premier,
      p_dernier: dernier, p_motif: saisie.motif,
    },
  }
}

// ══ Ce que chaque confirmation nomme : ce qui se fige ══════════

const JAMAIS_RETIRE = 'Ce geste est une parole datée du cabinet : il ne se retire jamais.'

export function confirmationDeLaPose(e: Emplacement, p: ParametresDeLaPose): string {
  return [
    `Poser le modèle « ${p.p_modele} » pour les séries ${libelleDEmplacement(e)}, à partir de ${p.p_depuis} ?`,
    `Les numéros seront de la forme ${numeroDuModele(p.p_modele, p.p_depuis, p.p_premier_numero)} ; ${p.p_annuel ? 'le compteur repart de 1 chaque année' : 'le compteur continue d’une année sur l’autre'}, et ${p.p_annuel ? `l’année ${p.p_depuis} commence` : 'la série commence'} au compteur ${p.p_premier_numero}.`,
    'Il l’emporte, pour chaque année qu’il couvre, sur le modèle posé avant ; les factures déjà numérotées gardent leur numéro.',
    'Un modèle posé ne se modifie ni ne se retire : un nouveau modèle le remplace. ' + JAMAIS_RETIRE,
  ].join('\n')
}

export function confirmationDeLaFin(serie: SerieLue, p: ParametresDeLaFin): string {
  return [
    `Confirmer ${numeroDuModele(serie.modele, p.p_annee, p.p_dernier)} comme le dernier numéro que l’ancien logiciel a émis dans la série ${libelleDeSerie(serie.modele, serie.annuel, p.p_annee)}, pour les séries ${libelleDEmplacement(serie)} ?`,
    `Motif : ${p.p_motif.trim()}`,
    'L’application continuera cette série après ce numéro, une fois ses trous importés ou levés. Une fin confirmée ne recule pas, et ne se confirme plus dès que l’application a validé une facture dans la série.',
    JAMAIS_RETIRE,
  ].join('\n')
}

export function confirmationDesTrous(serie: SerieLue, p: ParametresDesTrous): string {
  return [
    `Lever ${p.p_premier === p.p_dernier ? 'le numéro' : 'les numéros'} ${nomDIntervalle(serie.modele, p.p_annee, [p.p_premier, p.p_dernier])} de la série ${libelleDeSerie(serie.modele, serie.annuel, p.p_annee)}, pour les séries ${libelleDEmplacement(serie)} ?`,
    `Motif : ${p.p_motif.trim()}`,
    'Ce numéro manque : la série continue sans lui.',
    JAMAIS_RETIRE,
  ].join('\n')
}
