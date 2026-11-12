// LES LETTRES DE MISSION, À L'ÉCRAN DU CABINET (ligne 47, lot LM5). Ce module est la règle et les mots de l'écran, pur :
// la saisie d'un modèle et d'une lettre traduite en paramètres des fonctions de la base, les refus de chaque geste jugés
// AVANT le clic sur ce que l'écran a lu — dans l'ordre de la fonction, à ses mots (`motsDuRefus` de lib/lettresDeMission.ts,
// jamais une phrase recopiée) —, les confirmations qui NOMMENT ce qui part ou se fige, le contenu du PDF d'une lettre
// proposée tiré de ses seules valeurs figées, le refus de supprimer un papier signé, et les missions en vigueur d'un client
// SANS montant. Ce que l'écran ne peut pas savoir (la version lue a changé, l'accès) reste au jugement de la base, qui le dit.
// Récit : HISTORIQUE.md, « 11/11/2026 — LM5 ». Sources : décret n° 2012-432, art. 151 (le renvoi aux règles de l'Ordre) ;
// RGPD, art. 28 (LM4-Q1 (A) : la sous-traitance de toute lettre) ; LM4-Q2 (A) : le numéro d'inscription au tableau de
// l'Ordre se dit dans les conditions générales du modèle, que le cabinet saisit.

import {
  CLAUSES, MISSIONS, REFUS_DE_LA_PROPOSITION, REFUS_DE_LA_REPONSE, REFUS_DU_BROUILLON, REFUS_DU_MODELE, REFUS_DU_RETRAIT,
  REFUS_DU_RETRAIT_DU_MODELE, clausesRequises, etatDeLaLettre, lettresEnVigueur, motsDuRefus,
  type Clause, type EtatDeLaLettre, type LettreLue, type Mission,
} from './lettresDeMission'
import { dateAParis } from './format'

export const LIBELLE_MISSION: Record<Mission, string> = {
  tenue_comptable: 'Tenue de la comptabilité',
  presentation_des_comptes: 'Présentation des comptes annuels',
  declaration_2035: 'Déclaration de résultats 2035',
  declarations_tva: 'Déclarations de TVA',
  volet_social: 'Volet social et cotisations',
  facturation_au_nom_du_client: 'Facturation au nom et pour le compte du client',
  relances_des_clients: 'Relance des clients du client',
}
export const LIBELLE_CLAUSE: Record<Clause, string> = {
  mandat_de_facturation: 'Mandat de facturation',
  sous_traitance: 'Sous-traitance des données personnelles',
}
export const LIBELLE_PERIODICITE = { mois: 'par mois', trimestre: 'par trimestre', annee: 'par an' } as const
export const LIBELLE_LIVRABLE = {
  declaration_2035: 'la déclaration 2035', declaration_tva: 'chaque déclaration de TVA', bilan: 'le bilan', autre: 'autre tâche',
} as const
export const LIBELLE_ETAT: Record<EtatDeLaLettre, string> = {
  brouillon: 'Brouillon', proposee: 'Proposée', acceptee: 'Acceptée', echue: 'Échue', refusee: 'Refusée', retiree: 'Retirée',
  resiliee: 'Résiliée',
}

export type Periodicite = keyof typeof LIBELLE_PERIODICITE
export type Livrable = keyof typeof LIBELLE_LIVRABLE

/** Une ligne d'honoraires telle que la base la range (`honoraires_valides`). Le temps passé n'est jamais saisi ici (LM9). */
export type LigneDHonoraires =
  | { forme: 'forfait'; libelle: string; montant_ht: number; periodicite: Periodicite }
  | { forme: 'tache'; libelle: string; montant_ht: number; livrable: Livrable }
  | { forme: 'temps'; libelle: string; montant_ht: number }

export interface Tache { tache: string; par: 'cabinet' | 'client' }

/** Un modèle lu (`modeles_lettre_de_mission`). */
export interface ModeleLu {
  id: string
  titre: string
  conditions_generales: string
  missions: Partial<Record<Mission, string>>
  clauses: Partial<Record<Clause, string>>
  remplace_id: string | null
  cree_le: string
  retire_le: string | null
}

/** Une lettre lue entière (`lettres_de_mission`), au cabinet seul : les montants en font partie. */
export interface LettreComplete extends LettreLue {
  modele_id: string | null
  missions: Mission[]
  repartition: Tache[]
  honoraires: LigneDHonoraires[]
  premier_exercice: number | null
  preavis_mois: number
  signataire_nom: string | null
  signataire_qualite: string | null
  signataire_compte: string | null
  modifiee_le: string
  identite_client: IdentiteFigee | null
  identite_cabinet: (IdentiteFigee & { cabinet?: string | null }) | null
  clauses: Clause[] | null
  empreinte: string | null
  mode_acceptation: 'en_ligne' | 'papier' | null
  document_signe_id: string | null
  empreinte_papier: string | null
  signee_le: string | null
  cree_le: string
}

export interface IdentiteFigee {
  nom?: string | null
  denomination?: string | null
  forme_juridique?: string | null
  siret?: string | null
  adresse?: string | null
}

/** Un dossier client du cabinet, tel que la proposition le juge. */
export interface ClientDuCabinet { id: string; nom: string; adresse: string | null }

/** Un document du dossier du cabinet, candidat au papier signé. */
export interface DocumentDuCabinet { id: string; nom_fichier: string; storage_hash: string | null; created_at: string }

const blanc = (s: string | null | undefined) => s === null || s === undefined || s.trim() === ''
const EMPREINTE = /^[0-9a-f]{64}$/

// ══ Les modèles ══════════

export interface SaisieDuModele {
  titre: string
  conditionsGenerales: string
  /** Le texte de chaque mission décrite ; une mission au texte blanc n'est pas décrite. */
  missions: Partial<Record<Mission, string>>
  clauses: Partial<Record<Clause, string>>
}

/** Les paramètres de `enregistrer_modele_de_lettre`, sans les textes blancs (une mission ou une clause non décrite). */
export function parametresDuModele(s: SaisieDuModele): { titre: string; conditions: string; missions: Record<string, string>; clauses: Record<string, string> } {
  const garder = (o: Partial<Record<string, string>>) =>
    Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => !blanc(e[1] ?? null)))
  return { titre: s.titre, conditions: s.conditionsGenerales, missions: garder(s.missions), clauses: garder(s.clauses) }
}

/** La version courante d'un modèle : aucun ne le remplace. */
export function modeleCourant(m: Pick<ModeleLu, 'id'>, modeles: readonly Pick<ModeleLu, 'remplace_id'>[]): boolean {
  return !modeles.some((s) => s.remplace_id === m.id)
}

/** Le refus d'`enregistrer_modele_de_lettre`, avant le clic, dans l'ordre de la fonction ; `remplace` : le modèle remplacé. */
export function refusDuModele(
  s: SaisieDuModele, ctx: { dossierDuCabinet: boolean; remplace: ModeleLu | null; modeles: readonly ModeleLu[] },
): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DU_MODELE, cle)
  if (!ctx.dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  if (blanc(s.titre) || s.titre.length > 200) return mots('titre')
  if (blanc(s.conditionsGenerales) || s.conditionsGenerales.length > 100000) return mots('conditions')
  const p = parametresDuModele(s)
  if (Object.keys(p.missions).length === 0 || Object.values(p.missions).some((t) => t.length > 4000)) return mots('missions')
  if (Object.values(p.clauses).some((t) => t.length > 8000)) return mots('clauses')
  if (ctx.remplace !== null) {
    if (!ctx.modeles.some((m) => m.id === ctx.remplace?.id)) return mots('remplaceHorsDuDossier')
    if (!modeleCourant(ctx.remplace, ctx.modeles)) return mots('remplaceDepuis')
    if (ctx.remplace.retire_le !== null) return mots('remplaceRetire')
  }
  return null
}

/**
 * Ce que l'écran conseille, sans rien refuser : l'art. 151 veut que la lettre renvoie aux règles de l'Ordre, et le numéro
 * d'inscription au tableau se dit dans ces conditions générales (LM4-Q2 (A)) ; une clause que les missions décrites
 * exigeront, sans texte, retiendra la proposition.
 */
export function avisDuModele(s: SaisieDuModele): string[] {
  const avis: string[] = []
  if (!blanc(s.conditionsGenerales) && !/\bordre\b/i.test(s.conditionsGenerales)) {
    avis.push('Les conditions générales ne nomment pas l’Ordre : la lettre renvoie à ses règles professionnelles (décret n° 2012-432, '
      + 'art. 151), et le numéro d’inscription du cabinet au tableau se dit ici.')
  }
  const p = parametresDuModele(s)
  const manquantes = clausesRequises(Object.keys(p.missions)).filter((c) => !(c in p.clauses))
  if (manquantes.length > 0) {
    avis.push(`Sans le texte ${manquantes.map((c) => `de la clause « ${LIBELLE_CLAUSE[c]} »`).join(' ni ')}, une lettre sur ce modèle `
      + 'ne pourra pas être proposée.')
  }
  return avis
}

export function confirmationDuModele(s: SaisieDuModele, remplace: ModeleLu | null): string {
  const p = parametresDuModele(s)
  const missions = Object.keys(p.missions).map((m) => LIBELLE_MISSION[m as Mission]).join(', ')
  const tete = remplace === null
    ? `Enregistrer le modèle « ${s.titre.trim()} » ?`
    : `Enregistrer « ${s.titre.trim()} » comme nouvelle version du modèle « ${remplace.titre} » ?`
  const suite = remplace === null ? ''
    : ' Les lettres déjà proposées gardent le texte de l’ancienne version ; un brouillon qui la suit devra passer à la nouvelle avant d’être proposé.'
  return `${tete}\n\nIl décrit : ${missions}.\nUn modèle ne se modifie plus : une nouvelle version le remplacera, ou il se retirera.${suite}`
}

export function refusDuRetraitDuModele(m: ModeleLu, modeles: readonly ModeleLu[], dossierDuCabinet: boolean): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DU_RETRAIT_DU_MODELE, cle)
  if (!dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  if (!modeles.some((x) => x.id === m.id)) return mots('introuvable')
  if (!modeleCourant(m, modeles)) return mots('remplaceDepuis')
  if (m.retire_le !== null) return mots('dejaRetire')
  return null
}

export function confirmationDuRetraitDuModele(m: ModeleLu): string {
  return `Retirer le modèle « ${m.titre} » ?\n\nAucune lettre ne pourra plus être proposée sur lui, et il ne se remplacera plus. `
    + 'Les lettres déjà proposées le gardent. Le retrait ne se défait pas.'
}

// ══ Le brouillon ══════════

export interface LigneSaisie {
  forme: 'forfait' | 'tache'
  libelle: string
  /** Le montant hors taxes, tel que saisi (« 1 200,50 »). */
  montant: string
  periodicite: Periodicite
  livrable: Livrable
}

export interface SaisieDeLaLettre {
  dossierClientId: string
  modeleId: string
  missions: Mission[]
  repartition: Tache[]
  honoraires: LigneSaisie[]
  dateEffet: string
  premierExercice: string
  finInitiale: string
  reconductionTacite: boolean
  preavisMois: string
  signataireNom: string
  signataireQualite: string
}

/**
 * Un montant saisi en euros, lu EXACTEMENT au centime (jamais par un flottant multiplié) : des chiffres, une virgule ou un
 * point, deux décimales au plus, les espaces ignorés. `null` : illisible, nul, négatif ou au-delà du milliard.
 */
export function montantEnCentimes(saisi: string): number | null {
  const t = saisi.replace(/[\s  ]/g, '').replace(',', '.')
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return null
  const centimes = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return centimes > 0 && centimes <= 99_999_999_999 ? centimes : null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dansLeSiecle = (d: string) => DATE.test(d) && d >= '2000-01-01' && d <= '2100-12-31'

/**
 * Le contenu que `enregistrer_brouillon_de_lettre` reçoit, ou la clé du refus de la saisie (un montant illisible ne se
 * range jamais à zéro). Un champ blanc vaut nul : un brouillon peut être incomplet, la proposition le dira.
 */
export function contenuDuBrouillon(s: SaisieDeLaLettre, remplaceId: string | null):
  { ok: true; contenu: Record<string, unknown> } | { ok: false; cle: 'repartition' | 'honoraires' | 'dates' | 'preavis' | 'signataire' } {
  if (s.repartition.length > 60 || s.repartition.some((t) => blanc(t.tache) || t.tache.length > 500)) return { ok: false, cle: 'repartition' }
  const honoraires: LigneDHonoraires[] = []
  if (s.honoraires.length > 50) return { ok: false, cle: 'honoraires' }
  for (const l of s.honoraires) {
    const centimes = montantEnCentimes(l.montant)
    if (centimes === null || blanc(l.libelle) || l.libelle.length > 300) return { ok: false, cle: 'honoraires' }
    const montant_ht = centimes / 100
    honoraires.push(l.forme === 'forfait'
      ? { forme: 'forfait', libelle: l.libelle.trim(), montant_ht, periodicite: l.periodicite }
      : { forme: 'tache', libelle: l.libelle.trim(), montant_ht, livrable: l.livrable })
  }
  const dateEffet = blanc(s.dateEffet) ? null : s.dateEffet
  const finInitiale = blanc(s.finInitiale) ? null : s.finInitiale
  const premierExercice = blanc(s.premierExercice) ? null : Number(s.premierExercice)
  if ((dateEffet !== null && !dansLeSiecle(dateEffet)) || (finInitiale !== null && !dansLeSiecle(finInitiale))
    || (premierExercice !== null && !(Number.isInteger(premierExercice) && premierExercice >= 2000 && premierExercice <= 2100))
    || (dateEffet !== null && finInitiale !== null && finInitiale < dateEffet)) return { ok: false, cle: 'dates' }
  const preavis = blanc(s.preavisMois) ? 3 : Number(s.preavisMois)
  if (!Number.isInteger(preavis) || preavis < 0 || preavis > 12) return { ok: false, cle: 'preavis' }
  if (s.signataireNom.length > 200 || s.signataireQualite.length > 200) return { ok: false, cle: 'signataire' }
  const contenu: Record<string, unknown> = {
    dossier_client_id: blanc(s.dossierClientId) ? null : s.dossierClientId,
    modele_id: blanc(s.modeleId) ? null : s.modeleId,
    missions: MISSIONS.filter((m) => s.missions.includes(m)),
    repartition: s.repartition.map((t) => ({ tache: t.tache.trim(), par: t.par })),
    honoraires,
    date_effet: dateEffet,
    premier_exercice: premierExercice,
    fin_initiale: finInitiale,
    reconduction_tacite: s.reconductionTacite,
    preavis_mois: preavis,
    signataire_nom: blanc(s.signataireNom) ? null : s.signataireNom.trim(),
    signataire_qualite: blanc(s.signataireQualite) ? null : s.signataireQualite.trim(),
    // Le compte du signataire ne sert qu'à l'acceptation en ligne, fermée (LM-Q10) : l'écran n'en désigne aucun.
    signataire_compte: null,
  }
  if (remplaceId !== null) contenu.remplace_id = remplaceId
  return { ok: true, contenu }
}

/** La nouvelle version VIVANTE d'une lettre (ni refusée ni retirée), s'il y en a une. */
export function suiteVivante<L extends LettreLue>(l: Pick<LettreLue, 'id'>, lettres: readonly L[]): L | null {
  return lettres.find((s) => s.remplace_id === l.id && s.refusee_le === null && s.retiree_le === null) ?? null
}

/**
 * Le refus d'`enregistrer_brouillon_de_lettre`, avant le clic, dans l'ordre de la fonction. `existante` : la lettre
 * réécrite (nulle pour une lettre nouvelle) ; `remplace` : la lettre qu'une lettre NOUVELLE remplace.
 */
export function refusDuBrouillon(s: SaisieDeLaLettre, ctx: {
  dossierDuCabinet: boolean
  /** Le dossier du cabinet lui-même, qui n'est jamais le client d'une lettre. */
  dossierDuCabinetId: string
  clients: readonly ClientDuCabinet[]
  modeles: readonly ModeleLu[]
  lettres: readonly LettreComplete[]
  existante: LettreComplete | null
  remplace: LettreComplete | null
}): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DU_BROUILLON, cle)
  if (!ctx.dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  const c = contenuDuBrouillon(s, ctx.remplace?.id ?? null)
  if (new Set(s.missions).size !== s.missions.length) return mots('missions')
  if (!c.ok) return mots(c.cle)
  const client = c.contenu.dossier_client_id as string | null
  // Le client se choisit dans la liste des dossiers lus ; un dossier que ce compte ne lit pas (une lettre rédigée par le
  // chef) n'est pas pour autant « hors du cabinet » : la base en juge. Le dossier du cabinet lui-même ne l'est jamais.
  if (client !== null && client === ctx.dossierDuCabinetId) return mots('clientHorsDuCabinet')
  const modele = c.contenu.modele_id as string | null
  if (modele !== null && !ctx.modeles.some((m) => m.id === modele)) return mots('modeleHorsDuDossier')
  if (ctx.existante === null) {
    if (ctx.remplace !== null) {
      if (ctx.remplace.proposee_le === null || !ctx.lettres.some((l) => l.id === ctx.remplace?.id)) return mots('remplaceeNonProposee')
      if (ctx.remplace.dossier_client_id === null || client !== ctx.remplace.dossier_client_id) return mots('memeClient')
      if (suiteVivante(ctx.remplace, ctx.lettres) !== null) return mots('suiteVivante')
    }
    return null
  }
  const e = ctx.existante
  if (!ctx.lettres.some((l) => l.id === e.id)) return mots('introuvable')
  if (e.proposee_le !== null) return mots('proposee')
  if (e.retiree_le !== null) return mots('retiree')
  if (e.remplace_id !== null && client !== (ctx.lettres.find((l) => l.id === e.remplace_id)?.dossier_client_id ?? null)) {
    return mots('memeClientReecrit')
  }
  return null
}

/** La saisie qui reprend une lettre : son brouillon à réécrire, ou la copie d'une lettre proposée pour sa nouvelle version. */
export function saisieDeLaLettre(l: LettreComplete | null): SaisieDeLaLettre {
  if (l === null) {
    return {
      dossierClientId: '', modeleId: '', missions: [], repartition: [], honoraires: [], dateEffet: '', premierExercice: '',
      finInitiale: '', reconductionTacite: true, preavisMois: '3', signataireNom: '', signataireQualite: '',
    }
  }
  return {
    dossierClientId: l.dossier_client_id ?? '',
    modeleId: l.modele_id ?? '',
    missions: [...l.missions],
    repartition: l.repartition.map((t) => ({ ...t })),
    // Le temps passé ne se saisit pas ici : une telle ligne (restaurée d'ailleurs) ne se recopie pas en silence, elle se
    // dit — la proposition la refuserait de toute façon.
    honoraires: l.honoraires.flatMap((h): LigneSaisie[] => h.forme === 'temps' ? [] : [{
      forme: h.forme, libelle: h.libelle, montant: formaterMontantSaisi(h.montant_ht),
      periodicite: h.forme === 'forfait' ? h.periodicite : 'mois', livrable: h.forme === 'tache' ? h.livrable : 'declaration_2035',
    }]),
    dateEffet: l.date_effet ?? '',
    premierExercice: l.premier_exercice === null ? '' : String(l.premier_exercice),
    finInitiale: l.fin_initiale ?? '',
    reconductionTacite: l.reconduction_tacite,
    preavisMois: String(l.preavis_mois),
    signataireNom: l.signataire_nom ?? '',
    signataireQualite: l.signataire_qualite ?? '',
  }
}

function formaterMontantSaisi(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',')
}

/** Un montant en euros, à l'écran comme sur le PDF : « 1 200,50 € », des espaces simples (Helvetica n'a pas l'espace fine). */
export function montantEnEuros(n: number): string {
  const [entier, decimales] = (Math.round(n * 100) / 100).toFixed(2).split('.')
  return `${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decimales} €`
}

export function libelleDesHonoraires(h: LigneDHonoraires): string {
  const quand = h.forme === 'forfait' ? LIBELLE_PERIODICITE[h.periodicite]
    : h.forme === 'tache' ? `pour ${LIBELLE_LIVRABLE[h.livrable]}` : 'de l’heure'
  return `${h.libelle} : ${montantEnEuros(h.montant_ht)} HT ${quand}`
}

// ══ La proposition ══════════

/** Le refus de `proposer_lettre_de_mission`, avant le clic, dans l'ordre de la fonction. */
export function refusDeLaProposition(l: LettreComplete, ctx: {
  dossierDuCabinet: boolean
  clients: readonly ClientDuCabinet[]
  modeles: readonly ModeleLu[]
  identiteDuCabinet: { siret: string | null; adresse: string | null }
}): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DE_LA_PROPOSITION, cle)
  if (!ctx.dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  if (l.proposee_le !== null) return mots('dejaProposee')
  if (l.retiree_le !== null) return mots('retiree')
  if (l.dossier_client_id === null) return mots('sansClient')
  // Un dossier client que ce compte ne lit pas n'est pas « hors du cabinet » : la base en juge, et le dira.
  const client = ctx.clients.find((c) => c.id === l.dossier_client_id)
  if (client && blanc(client.adresse)) return mots('adresseDuClient')
  if (l.modele_id === null) return mots('sansModele')
  const modele = ctx.modeles.find((m) => m.id === l.modele_id)
  if (!modele || modele.retire_le !== null || !modeleCourant(modele, ctx.modeles)) return mots('modeleNonCourant')
  if (l.missions.length === 0) return mots('sansMission')
  if (l.missions.some((m) => blanc(modele.missions[m] ?? null))) return mots('missionNonDecrite')
  if (clausesRequises(l.missions).some((c) => blanc(modele.clauses[c] ?? null))) return mots('clauseSansTexte')
  if (l.repartition.length === 0) return mots('sansRepartition')
  if (l.honoraires.length === 0) return mots('sansHonoraires')
  if (l.honoraires.some((h) => h.forme === 'temps')) return mots('tempsPasse')
  if (l.date_effet === null || l.premier_exercice === null || l.fin_initiale === null) return mots('duree')
  if (l.signataire_nom === null) return mots('sansSignataire')
  if (blanc(ctx.identiteDuCabinet.siret) || blanc(ctx.identiteDuCabinet.adresse)) return mots('identiteDuCabinet')
  return null
}

/** La confirmation de la proposition : elle NOMME tout ce qui se fige. */
export function confirmationDeLaProposition(l: LettreComplete, ctx: { nomDuClient: string; modele: ModeleLu }): string {
  const missions = l.missions.map((m) => LIBELLE_MISSION[m]).join(', ')
  const honoraires = l.honoraires.map((h) => `• ${libelleDesHonoraires(h)}`).join('\n')
  const clauses = clausesRequises(l.missions).map((c) => LIBELLE_CLAUSE[c]).join(', ')
  const parCabinet = l.repartition.filter((t) => t.par === 'cabinet').length
  return `Proposer la lettre de mission de « ${ctx.nomDuClient} » ?\n\n`
    + `Elle se FIGE, et ne se modifiera plus — une nouvelle version la remplacera :\n`
    + `• les missions : ${missions} ;\n`
    + `• la répartition de ${l.repartition.length} tâche(s), dont ${parCabinet} au cabinet ;\n`
    + `• les honoraires :\n${honoraires}\n`
    + `• la durée : effet au ${dateCivile(l.date_effet)}, premier exercice ${l.premier_exercice}, première période jusqu’au `
    + `${dateCivile(l.fin_initiale)}, ${l.reconduction_tacite ? 'reconduite tacitement' : 'sans reconduction tacite'}, préavis de `
    + `${l.preavis_mois} mois ;\n`
    + `• le signataire : ${l.signataire_nom}${blanc(l.signataire_qualite) ? '' : `, ${l.signataire_qualite}`} ;\n`
    + `• le modèle « ${ctx.modele.titre} » et les clauses : ${clauses} ;\n`
    + `• l’identité du client et celle du cabinet, lues de leurs dossiers à cet instant ;\n`
    + `• son empreinte, que la base calcule de tout ce contenu.`
}

// ══ La réponse ══════════

export type Reponse = 'acceptee_sur_papier' | 'refusee'

/** Le refus d'`enregistrer_reponse_a_la_lettre`, avant le clic, dans l'ordre de la fonction. `aujourdhui` : à Paris. */
export function refusDeLaReponse(l: LettreComplete, ctx: {
  dossierDuCabinet: boolean
  lettres: readonly LettreComplete[]
  reponse: Reponse
  document: DocumentDuCabinet | null
  documents: readonly DocumentDuCabinet[]
  signeeLe: string
  aujourdhui: string
}): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DE_LA_REPONSE, cle)
  if (!ctx.dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  if (l.proposee_le === null) return mots('nonProposee')
  if (l.retiree_le !== null) return mots('retiree')
  if (l.acceptee_le !== null || l.refusee_le !== null) return mots('dejaRepondue')
  if (suiteVivante(l, ctx.lettres) !== null) return mots('suiteVivante')
  if (ctx.reponse === 'refusee') return null
  if (ctx.document === null || !ctx.documents.some((d) => d.id === ctx.document?.id)) return mots('papierHorsDuDossier')
  if (ctx.document.storage_hash === null || !EMPREINTE.test(ctx.document.storage_hash)) return mots('papierSansEmpreinte')
  if (!DATE.test(ctx.signeeLe) || ctx.signeeLe < dateAParisDe(l.proposee_le) || ctx.signeeLe > ctx.aujourdhui) return mots('dateDeSignature')
  return null
}

export function confirmationDeLaReponse(l: LettreComplete, ctx: {
  nomDuClient: string; reponse: Reponse; document: DocumentDuCabinet | null; signeeLe: string
}): string {
  if (ctx.reponse === 'refusee') {
    return `Enregistrer le REFUS de la lettre de mission de « ${ctx.nomDuClient} » ?\n\n`
      + 'Elle prend fin, et la réponse ne se défait pas. Une nouvelle version pourra lui succéder.'
  }
  return `Enregistrer l’ACCEPTATION de la lettre de mission de « ${ctx.nomDuClient} » sur le papier signé `
    + `« ${ctx.document?.nom_fichier ?? ''} », signé le ${dateCivile(ctx.signeeLe)} ?\n\n`
    + `La réponse se fige avec l’empreinte de ce document ; il ne se supprimera plus, sauf avec le dossier du cabinet. `
    + `La lettre est en vigueur à compter du ${dateCivile(l.date_effet)}.`
}

// ══ Le retrait, la résiliation, la nouvelle version ══════════

export function refusDuRetrait(l: LettreComplete, ctx: {
  dossierDuCabinet: boolean; lettres: readonly LettreComplete[]; finAu: string
}): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DU_RETRAIT, cle)
  if (!ctx.dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  if (l.retiree_le !== null) return mots('dejaRetiree')
  if (l.refusee_le !== null) return mots('refusee')
  if (suiteVivante(l, ctx.lettres) !== null) return mots('suiteVivante')
  const fin = ctx.finAu.trim()
  if (l.acceptee_le !== null && (!DATE.test(fin) || l.date_effet === null || fin < l.date_effet || fin > '2100-12-31')) {
    return mots('resiliationSansDate')
  }
  if (l.acceptee_le === null && fin !== '') return mots('dateSansAcceptation')
  return null
}

export function confirmationDuRetrait(l: LettreComplete, ctx: { nomDuClient: string; finAu: string }): string {
  if (l.acceptee_le !== null) {
    return `RÉSILIER la lettre de mission de « ${ctx.nomDuClient} » au ${dateCivile(ctx.finAu)} ?\n\n`
      + 'Elle cesse d’être en vigueur après cette date. La résiliation se fige et ne se défait pas.'
  }
  return `Retirer la lettre de mission ${l.proposee_le === null ? '(brouillon)' : 'proposée'} de « ${ctx.nomDuClient} » ?\n\n`
    + 'Elle ne se reprendra plus ; le retrait ne se défait pas.'
}

/** Une nouvelle version ne s'écrit que sur la version courante d'une lettre proposée, qui n'est ni refusée ni retirée. */
export function refusDeLaNouvelleVersion(l: LettreComplete, ctx: { dossierDuCabinet: boolean; lettres: readonly LettreComplete[] }): string | null {
  const mots = (cle: string) => motsDuRefus(REFUS_DU_BROUILLON, cle)
  if (!ctx.dossierDuCabinet) return mots('horsDuDossierDuCabinet')
  if (l.proposee_le === null) return mots('remplaceeNonProposee')
  if (l.dossier_client_id === null) return mots('memeClient')
  if (suiteVivante(l, ctx.lettres) !== null) return mots('suiteVivante')
  return null
}

export function confirmationDeLaNouvelleVersion(l: LettreComplete, nomDuClient: string): string {
  return `Rédiger une nouvelle version de la lettre de mission de « ${nomDuClient} » ?\n\n`
    + 'La lettre actuelle reste telle qu’elle a été proposée. La nouvelle version part en brouillon, son contenu recopié, '
    + `pour le même client${l.acceptee_le !== null ? ' ; acceptée à son tour, elle vaudra avenant' : ''}.`
}

// ══ Le papier signé ne se supprime plus ══════════

/** La phrase dite AVANT le clic sur un document qu'une lettre cite comme papier signé (la clé sans action : 23503). */
export const REFUS_DU_PAPIER_SIGNE =
  'Ce document est le papier signé d’une lettre de mission : il ne se supprime plus, sauf avec le dossier du cabinet.'

/** Les papiers cités, lus en entier ou non : `null` tant que rien n'est revenu (ou le drapeau baissé). */
export interface LectureDesPapiersSignes { ids: ReadonlySet<string>; motif: string | null }

export function refusDuPapierSigne(documentId: string, papiers: LectureDesPapiersSignes | null): string | null {
  return papiers !== null && papiers.ids.has(documentId) ? REFUS_DU_PAPIER_SIGNE : null
}

/** Le refus de la base pour une suppression qu'une clé retient (23503), dit en clair plutôt qu'en anglais. */
export function messageDUneSuppressionRetenue(erreur: unknown): string | null {
  const e = erreur as { code?: unknown; message?: unknown } | null
  return e !== null && typeof e === 'object' && e.code === '23503' && typeof e.message === 'string'
    && e.message.includes('lettres_de_mission') ? REFUS_DU_PAPIER_SIGNE : null
}

// ══ Le PDF d'une lettre proposée ══════════

export interface BlocDuPdf { genre: 'titre' | 'intertitre' | 'texte' | 'mention'; texte: string }

/**
 * Le contenu du PDF, tiré des SEULES valeurs figées : la lettre proposée (ses copies d'identité, ses missions, ses tâches,
 * ses honoraires, sa durée, son signataire, ses clauses, son instant et son empreinte) et son modèle, que la base ne laisse
 * plus modifier. Rien n'est lu du dossier du client aujourd'hui. `null` : la lettre n'est pas proposée, ou le modèle lu
 * n'est pas le sien.
 */
export function contenuDuPdf(l: LettreComplete, modele: ModeleLu | null): BlocDuPdf[] | null {
  if (l.proposee_le === null || l.empreinte === null || l.identite_client === null || l.identite_cabinet === null
    || l.clauses === null || modele === null || modele.id !== l.modele_id) return null
  const identite = (i: IdentiteFigee & { cabinet?: string | null }) => [
    i.denomination ?? i.cabinet ?? i.nom ?? '', i.forme_juridique ?? '', i.siret ? `SIRET ${i.siret}` : '', i.adresse ?? '',
  ].filter((x) => x.trim() !== '').join('\n')
  const blocs: BlocDuPdf[] = [
    { genre: 'titre', texte: `Lettre de mission — ${modele.titre}` },
    { genre: 'intertitre', texte: 'Entre' },
    { genre: 'texte', texte: identite(l.identite_cabinet) },
    { genre: 'intertitre', texte: 'Et' },
    { genre: 'texte', texte: identite(l.identite_client) },
    { genre: 'intertitre', texte: 'Les missions' },
    ...l.missions.flatMap((m): BlocDuPdf[] => [
      { genre: 'texte', texte: `${LIBELLE_MISSION[m]}\n${modele.missions[m] ?? ''}` },
    ]),
    { genre: 'intertitre', texte: 'La répartition des tâches' },
    { genre: 'texte', texte: l.repartition.map((t) => `${t.par === 'cabinet' ? 'Le cabinet' : 'Le client'} : ${t.tache}`).join('\n') },
    { genre: 'intertitre', texte: 'Les honoraires' },
    { genre: 'texte', texte: l.honoraires.map(libelleDesHonoraires).join('\n') },
    { genre: 'intertitre', texte: 'La durée' },
    {
      genre: 'texte',
      texte: `Effet au ${dateCivile(l.date_effet)}, à compter de l’exercice ${l.premier_exercice}. Première période jusqu’au `
        + `${dateCivile(l.fin_initiale)}, ${l.reconduction_tacite ? 'reconduite tacitement' : 'sans reconduction tacite'} ; `
        + `préavis de ${l.preavis_mois} mois.`,
    },
    ...l.clauses.flatMap((c): BlocDuPdf[] => [
      { genre: 'intertitre', texte: LIBELLE_CLAUSE[c] }, { genre: 'texte', texte: modele.clauses[c] ?? '' },
    ]),
    { genre: 'intertitre', texte: 'Conditions générales' },
    { genre: 'texte', texte: modele.conditions_generales },
    { genre: 'intertitre', texte: 'Signature du client' },
    { genre: 'texte', texte: `${l.signataire_nom ?? ''}${blanc(l.signataire_qualite) ? '' : `, ${l.signataire_qualite}`}\n\nDate :\n\nSignature :` },
    {
      genre: 'mention',
      texte: `Lettre proposée le ${dateAParisDe(l.proposee_le).split('-').reverse().join('/')}. Empreinte SHA-256 de son contenu, `
        + `calculée par la base à la proposition : ${l.empreinte}`,
    },
  ]
  return blocs
}

/** Le nom du fichier du PDF : aucun nom de client (un fichier voyage), la date de proposition et le début de l'empreinte. */
export function nomDuPdf(l: Pick<LettreComplete, 'proposee_le' | 'empreinte'>): string {
  return `lettre-de-mission-${l.proposee_le ? dateAParisDe(l.proposee_le) : 'brouillon'}-${(l.empreinte ?? '').slice(0, 8)}.pdf`
}

// ══ Les missions en vigueur d'un client, sans montant ══════════

/** Ce qu'un membre assigné au dossier du client lit d'une lettre : jamais un montant, jamais un texte du cabinet. */
export interface LettreSansMontant extends LettreLue { missions: Mission[] }

/** Ce que la carte du dossier d'un client sait des missions de ce client. */
export type LectureDesMissions =
  | { etat: 'lue'; dossierClientId: string; lettres: LettreSansMontant[] }
  /** Aucun dossier du cabinet désigné : aucune lettre n'existe. */
  | { etat: 'sansDossierDuCabinet'; dossierClientId: string }
  /** Le dossier du cabinet ne s'ouvre pas à ce compte : la RLS rendrait ZÉRO ligne sans erreur, jamais prise pour « aucune ». */
  | { etat: 'fermee'; dossierClientId: string }
  /** La fonction `missions_du_client` a refusé ce compte (42501) : dit tel quel, rien n'est deviné. Drapeau levé seulement. */
  | { etat: 'refusee'; dossierClientId: string; motif: string }
  | { etat: 'illisible'; dossierClientId: string; motif: string }

/** Les colonnes qu'on lit d'une lettre depuis le dossier d'un client : ni honoraires, ni textes, ni identités. */
export const COLONNES_SANS_MONTANT =
  'id, remplace_id, dossier_client_id, missions, date_effet, fin_initiale, reconduction_tacite, proposee_le, acceptee_le, refusee_le, retiree_le, fin_au'

export interface MissionEnVigueur { lettreId: string; missions: Mission[]; dateEffet: string; finInitiale: string | null; reconduction: boolean }

/** Une lettre en préparation : un brouillon (LM5Q2-Q1 (B)), ou une proposition qui attend la réponse du client. */
export interface LettreEnPreparation { lettreId: string; etat: 'brouillon' | 'proposee'; missions: Mission[]; dateEffet: string | null }

/** Les lettres d'un client qui ne sont pas encore en vigueur et peuvent le devenir — ses brouillons et ses propositions sans
 *  réponse —, dans l'ordre où la base les rend ; chacune dite par son état, jamais un montant. */
export function lettresEnPreparation(lettres: readonly LettreSansMontant[], dossierClientId: string, aujourdhui: string): LettreEnPreparation[] {
  return lettres.flatMap((l) => {
    if (l.dossier_client_id !== dossierClientId) return []
    const etat = etatDeLaLettre(l, aujourdhui)
    return etat === 'brouillon' || etat === 'proposee' ? [{ lettreId: l.id, etat, missions: l.missions, dateEffet: l.date_effet }] : []
  })
}

export function missionsEnVigueur(lettres: readonly LettreSansMontant[], dossierClientId: string, date: string): MissionEnVigueur[] {
  return lettresEnVigueur(lettres, dossierClientId, date).map((l) => {
    const m = l as LettreSansMontant
    return { lettreId: m.id, missions: m.missions, dateEffet: m.date_effet ?? '', finInitiale: m.fin_initiale, reconduction: m.reconduction_tacite }
  })
}

// ══ Outils ══════════

function dateCivile(d: string | null): string {
  return d === null || !DATE.test(d) ? '—' : d.split('-').reverse().join('/')
}

/** Le jour de Paris d'un instant de la base (la date de proposition), comme la fonction le lit (`at time zone 'Europe/Paris'`). */
export const dateAParisDe = dateAParis

export { CLAUSES, MISSIONS }
