import {
  declarationDesAchats, declarationDesPaiements, declarationDesVentes, HYPOTHESES_DE_LA_CONCEPTION, RAISONS_ECARTEES,
  type ContenuAchats, type ContenuPaiements, type ContenuVentes, type ContexteDeclaration, type DeclarationEreporting,
  type DossierEreporting, type EncaissementLu, type FactureLue, type Lecture, type LigneLue, type PartLue, type PieceLue,
  type RefusEreporting, type SourceEreporting, type TexteDePiece,
} from './ereporting'
import {
  contenuADeclarer, declarationQuiRetientLaPiece, etatDeLaDeclaration, type CauseARectifier, type ContenuDuCalcul, type ContexteDeLaDeclaration,
  type DifferenceDOperation, type EtatDeLaDeclaration, type SaisieDeclaration,
} from './declarationsEreporting'
import { ajouterJours, formatDate, formatMoney } from './format'
import { champCsv } from './pisteAudit'
import {
  calendrierEreporting, DEBUT_EREPORTING_PME, libelleFrequence, obligationsEreporting, periodeDe,
  type EtatObligation, type FrequenceEreporting, type ObjetEreporting, type PeriodeEreporting,
} from './periodesEreporting'
import {
  libelleDuRegime, regimeEnVigueur, regimeEstLeStatutDuDossier, regimeProposeDuDossier, regimesActifs, rythme,
  type LigneDeRegime, type SaisieRegime,
} from './regimesEreporting'
import type {
  DeclarationEreportingHorsApplication, FactureEmise, Piece, PieceEcarteeEreporting, PieceHorsDeFrance,
  PieceHorsDeFranceTaux, RegimeEreporting, SourceDeclarationEreporting,
} from './types'

// CE QUE LA FENÊTRE DE L'E-REPORTING DIT, ET CE QU'ELLE CALCULE POUR LE DIRE (ligne 28.5, étape e5c, phase C). Un module PUR
// d'affichage : il ne lit ni la base ni l'horloge — l'appelant lui passe ce qu'il a lu EN ENTIER (lib/ereportingLecture.ts),
// le dossier et le jour à Paris — et ne change AUCUNE règle de ceux d'en dessous. Il assemble :
//   - les périodes d'un dossier, objet par objet (ventes, achats, paiements), avec pour chacune le contenu que l'application
//     calcule aujourd'hui (lib/ereporting.ts, e4), la chaîne de ses déclarations (lib/declarationsEreporting.ts, e5b1) et
//     son état — à jour, à rectifier, indéterminé — ou, non déclarée, ce qui reste à faire ;
//   - les phrases de ce que le cabinet va faire AVANT qu'il le fasse : ce que la déclaration garde et ne garde pas, ce
//     qu'un retrait de régime laisse derrière lui, ce que change l'écart d'une pièce ;
//   - les écarts d'une déclaration à rectifier, dits en français.
// Les refus des fonctions de la base ne sont pas redits ici : les modules d'en dessous les disent, dans leur ordre et sous
// leurs mots, et l'écran les montre tels quels.

// ── Ce que l'écran a lu ─────────────────────────────────────────────────────────────────────────────────────────────

export type PieceDeLEcran = PieceLue & Pick<Piece, 'nom_fichier'>
export type FactureDeLEcran = FactureLue & Pick<FactureEmise, 'numero' | 'tiers_nom'>

/** Toutes les sources de la fenêtre, chacune avec son drapeau `complete` : une lecture partielle ne dit rien. */
export interface SourcesEreporting {
  regimes: Lecture<RegimeEreporting>
  ecarts: Lecture<PieceEcarteeEreporting>
  declarations: Lecture<DeclarationEreportingHorsApplication>
  sources: Lecture<SourceDeclarationEreporting>
  pieces: Lecture<PieceDeLEcran>
  fiches: Lecture<PieceHorsDeFrance>
  taux: Lecture<PieceHorsDeFranceTaux>
  textes: Lecture<TexteDePiece>
  factures: Lecture<FactureDeLEcran>
  lignes: Lecture<LigneLue>
  encaissements: Lecture<EncaissementLu>
  parts: Lecture<PartLue>
}

/** Ce que chaque lecture manquante coûte à l'écran, nommée avec l'accord de son participe (`BandeauLecturePartielle`). */
export const LECTURES_DE_LA_FENETRE: readonly {
  cle: keyof SourcesEreporting
  quoi: string
  accord: 'lues' | 'lus' | 'lue' | 'lu'
}[] = [
  { cle: 'regimes', quoi: 'Les régimes d’e-reporting confirmés', accord: 'lus' },
  { cle: 'ecarts', quoi: 'Les pièces écartées de l’e-reporting', accord: 'lues' },
  { cle: 'declarations', quoi: 'Les déclarations d’e-reporting', accord: 'lues' },
  { cle: 'sources', quoi: 'Les sources des déclarations', accord: 'lues' },
  { cle: 'pieces', quoi: 'Les pièces du dossier', accord: 'lues' },
  { cle: 'fiches', quoi: 'Les fiches « fournisseur établi hors de France »', accord: 'lues' },
  { cle: 'taux', quoi: 'La ventilation des fiches « hors de France »', accord: 'lue' },
  { cle: 'textes', quoi: 'Les textes lus sur les documents', accord: 'lus' },
  { cle: 'factures', quoi: 'Les factures émises', accord: 'lues' },
  { cle: 'lignes', quoi: 'Les lignes des factures', accord: 'lues' },
  { cle: 'encaissements', quoi: 'Les encaissements', accord: 'lus' },
  { cle: 'parts', quoi: 'La répartition des encaissements par taux', accord: 'lue' },
]

/** Ce que la fenêtre dit quand une lecture manque : l'écran n'affirme rien et n'offre aucun geste. */
export const CONSEQUENCE_D_UNE_LECTURE_PARTIELLE = 'Rien n’est affirmé ni offert : un état, un contenu ou un régime bâtis sur une '
  + 'liste incomplète seraient faux, et une déclaration que l’on ne verrait pas se déclarerait deux fois. Rouvre cette fenêtre.'

/** Les lectures qui ne sont pas revenues entières, dans l'ordre de la fenêtre. */
export function lecturesManquantes(s: SourcesEreporting): { quoi: string; accord: 'lues' | 'lus' | 'lue' | 'lu'; motif: string }[] {
  return LECTURES_DE_LA_FENETRE
    .filter((l) => !s[l.cle].complete)
    .map((l) => ({ quoi: l.quoi, accord: l.accord, motif: s[l.cle].motif ?? 'lecture incomplète' }))
}

// ── Les objets, en mots ─────────────────────────────────────────────────────────────────────────────────────────────

export const OBJETS_DE_LA_FENETRE: readonly ObjetEreporting[] = ['achats', 'ventes', 'paiements']

export const NOMS_DES_OBJETS: Readonly<Record<ObjetEreporting, string>> = {
  achats: 'Achats à un fournisseur établi hors de France',
  ventes: 'Ventes à des particuliers',
  paiements: 'Paiements de ces ventes',
}

const NOMS_COURTS: Readonly<Record<ObjetEreporting, string>> = {
  achats: 'des achats à l’étranger',
  ventes: 'des ventes à des particuliers',
  paiements: 'des paiements des ventes à des particuliers',
}

// ── Le contenu d'une période, tel qu'e4 le calcule aujourd'hui ──────────────────────────────────────────────────────

/** Le contenu que l'application calcule aujourd'hui pour un objet et une période. Les hypothèses de la conception sont
 * passées par leur nom : une réponse du cabinet ne change que leur valeur. */
export function declarationCalculee(
  objet: ObjetEreporting, periode: { debut: string; fin: string }, s: SourcesEreporting, dossier: DossierEreporting, aujourdHui: string,
): DeclarationEreporting<ContenuDuCalcul> {
  const c: ContexteDeclaration = { periode, dossier, regimes: s.regimes, aujourdHui }
  switch (objet) {
    case 'achats':
      return declarationDesAchats(c, { pieces: s.pieces, fiches: s.fiches, taux: s.taux, textes: s.textes, ecarts: s.ecarts },
        { rangement: HYPOTHESES_DE_LA_CONCEPTION.rangement })
    case 'ventes':
      return declarationDesVentes(c, { factures: s.factures, lignes: s.lignes }, { rangement: HYPOTHESES_DE_LA_CONCEPTION.rangement })
    case 'paiements':
      return declarationDesPaiements(c, { factures: s.factures, encaissements: s.encaissements, parts: s.parts },
        { contrePassation: HYPOTHESES_DE_LA_CONCEPTION.contrePassation })
  }
}

// ── Les périodes d'un objet ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * La période d'un objet que bornent ces dates, quelle que soit sa fréquence : celle dont les bornes sont exactement les
 * siennes. Une déclaration garde ses bornes, pas la fréquence du régime qui les a données.
 */
export function periodeDesBornes(debut: string, fin: string): PeriodeEreporting | null {
  for (const frequence of ['decade', 'mois', 'bimestre'] as const) {
    const p = periodeDe(debut, frequence)
    if (p != null && p.debut === debut && p.fin === fin) return p
  }
  return null
}

/**
 * LES PÉRIODES D'UN OBJET, de la plus récente à la plus ancienne : le calendrier de chaque régime, sur les jours où il
 * vaut — un régime confirmé change de fréquence à son jour de départ, et une période n'est comptée que dans le régime de
 * son premier jour —, avant le premier régime confirmé celui que le statut d'aujourd'hui propose ; plus les périodes déjà
 * déclarées, quelle que soit leur fréquence. Aucune avant le 1er septembre 2027.
 */
export function periodesDeLObjet(
  objet: ObjetEreporting, s: Pick<SourcesEreporting, 'regimes' | 'declarations'>, dossier: DossierEreporting, aujourdHui: string,
): PeriodeEreporting[] {
  const actifs = regimesActifs(s.regimes.lignes, dossier.id)
  const frequenceDe = (r: Pick<LigneDeRegime, 'frequence_transactions' | 'frequence_paiements'> | null): FrequenceEreporting | null => {
    if (r != null) return objet === 'paiements' ? r.frequence_paiements : r.frequence_transactions
    const proposee = regimeProposeDuDossier(dossier, null)
    if (proposee == null) return null
    return (objet === 'paiements' ? proposee.frequence_paiements : proposee.frequence_transactions) as FrequenceEreporting | null
  }
  const segments: { debut: string; fin: string | null; frequence: FrequenceEreporting | null }[] = []
  if (actifs.length === 0 || actifs[0].depuis > DEBUT_EREPORTING_PME) {
    segments.push({ debut: DEBUT_EREPORTING_PME, fin: actifs[0] ? ajouterJours(actifs[0].depuis, -1) : null, frequence: frequenceDe(null) })
  }
  actifs.forEach((r, i) => segments.push({
    debut: r.depuis, fin: actifs[i + 1] ? ajouterJours(actifs[i + 1].depuis, -1) : null, frequence: frequenceDe(r),
  }))
  const parDebut = new Map<string, PeriodeEreporting>()
  for (const segment of segments) {
    if (segment.frequence == null) continue
    for (const p of calendrierEreporting(segment.frequence, aujourdHui) ?? []) {
      if (p.debut >= segment.debut && (segment.fin == null || p.debut <= segment.fin)) parDebut.set(`${p.debut}|${p.fin}`, p)
    }
  }
  for (const d of s.declarations.lignes) {
    if (d.dossier_id !== dossier.id || d.objet !== objet) continue
    const p = periodeDesBornes(d.periode_debut, d.periode_fin)
    if (p != null) parDebut.set(`${p.debut}|${p.fin}`, p)
  }
  return [...parDebut.values()].sort((a, b) => (a.debut < b.debut ? 1 : a.debut > b.debut ? -1 : a.fin < b.fin ? 1 : -1))
}

// ── Une ligne de la fenêtre : un objet, une période ─────────────────────────────────────────────────────────────────

export type TonDeLigne = 'ok' | 'attention' | 'danger' | 'neutre'

export interface ResumeDeLaLigne {
  code:
    | 'declaree_a_jour' | 'declaree_a_rectifier' | 'declaree_indeterminee'
    | 'rien_a_declarer' | 'a_declarer' | 'en_retard' | 'en_cours' | 'regime_a_confirmer' | 'regime_a_reconfirmer'
    | 'a_verifier' | 'a_completer' | 'hors_du_champ'
  libelle: string
  ton: TonDeLigne
  /** Ce qui l'explique, en une phrase ; nul quand le libellé suffit. */
  detail: string | null
}

export interface LigneDePeriode {
  objet: ObjetEreporting
  periode: PeriodeEreporting
  /** Ce que l'application calcule aujourd'hui. */
  calcul: DeclarationEreporting<ContenuDuCalcul>
  /** Toutes les déclarations de cet objet et de cette période, la plus récente d'abord, remplacées comprises. */
  chaine: DeclarationEreportingHorsApplication[]
  /** L'active : une seule, la base le garantit. */
  active: DeclarationEreportingHorsApplication | null
  /** Son état face au calcul d'aujourd'hui ; nul sans déclaration active. */
  etat: EtatDeLaDeclaration | null
  resume: ResumeDeLaLigne
}

const REFUS_QUI_FONT_VERIFIER: readonly string[] = ['achat_a_verifier', 'achat_avec_tva', 'fiche_a_revoir']

/** Ce qu'une période dit d'elle-même dans la liste : déclarée (et à jour ou non), ou ce qui reste à faire. */
export function resumeDeLaLigne(
  periode: PeriodeEreporting, calcul: DeclarationEreporting<ContenuDuCalcul>, active: DeclarationEreportingHorsApplication | null,
  etat: EtatDeLaDeclaration | null, aujourdHui: string,
): ResumeDeLaLigne {
  if (active != null && etat != null) {
    const le = formatDate(active.cree_le)
    const sur = `sur ${active.plateforme}`
    if (etat.etat === 'a_jour') {
      return { code: 'declaree_a_jour', libelle: `Déclarée le ${le}`, ton: 'ok', detail: `${sur}, à jour : ce qui a été déclaré est ce que l’application calcule aujourd’hui.` }
    }
    if (etat.etat === 'a_rectifier') {
      return { code: 'declaree_a_rectifier', libelle: 'À rectifier', ton: 'attention', detail: `Déclarée le ${le} ${sur}.` }
    }
    return {
      code: 'declaree_indeterminee', libelle: `Déclarée le ${le}`, ton: 'neutre',
      detail: `${sur}. ${etat.motifs[0] ?? etat.refus[0]?.message ?? 'Ce qui a changé depuis ne se sait pas.'}`,
    }
  }
  const cles = calcul.refus.map((r) => r.cle as string)
  if (cles.includes('periode_en_cours')) {
    return { code: 'en_cours', libelle: 'Période en cours', ton: 'neutre', detail: calcul.refus.find((r) => r.cle === 'periode_en_cours')?.message ?? null }
  }
  if (calcul.etat === 'hors_du_champ') {
    return { code: 'hors_du_champ', libelle: 'Hors du champ', ton: 'neutre', detail: calcul.refus[0]?.message ?? null }
  }
  if (calcul.etat === 'incomplete') {
    const premier = calcul.refus.find((r) => !['regime_a_confirmer', 'regime_a_reconfirmer', 'rien_a_declarer'].includes(r.cle)) ?? calcul.refus[0]
    if (cles.some((c) => REFUS_QUI_FONT_VERIFIER.includes(c))) {
      return { code: 'a_verifier', libelle: 'À vérifier', ton: 'attention', detail: premier?.message ?? null }
    }
    return { code: 'a_completer', libelle: 'À compléter', ton: 'attention', detail: premier?.message ?? null }
  }
  if (calcul.etat === 'rien_a_declarer') {
    return { code: 'rien_a_declarer', libelle: 'Rien à déclarer', ton: 'neutre', detail: calcul.refus.find((r) => r.cle === 'rien_a_declarer')?.message ?? null }
  }
  // À déclarer : le régime d'abord (rien ne se déclare sous un régime à confirmer), puis l'échéance.
  const echeance = `Au plus tard le ${formatDate(periode.echeance)}${periode.prudence ? ` (${periode.prudence})` : ''}.`
  if (cles.includes('regime_a_confirmer')) {
    return { code: 'regime_a_confirmer', libelle: 'Régime à confirmer', ton: 'attention', detail: calcul.refus.find((r) => r.cle === 'regime_a_confirmer')?.message ?? null }
  }
  if (cles.includes('regime_a_reconfirmer')) {
    return { code: 'regime_a_reconfirmer', libelle: 'Régime à reconfirmer', ton: 'attention', detail: calcul.refus.find((r) => r.cle === 'regime_a_reconfirmer')?.message ?? null }
  }
  if (aujourdHui > periode.echeance) {
    return { code: 'en_retard', libelle: 'En retard', ton: 'danger', detail: `L’échéance est dépassée. ${echeance}` }
  }
  return { code: 'a_declarer', libelle: `À déclarer avant le ${formatDate(periode.echeance)}`, ton: 'attention', detail: periode.prudence ? echeance : null }
}

const parRecenteDabord = (a: DeclarationEreportingHorsApplication, b: DeclarationEreportingHorsApplication) =>
  a.cree_le < b.cree_le ? 1 : a.cree_le > b.cree_le ? -1 : a.id < b.id ? 1 : -1

/** Une ligne de la fenêtre : le calcul d'aujourd'hui, la chaîne des déclarations de la période, son état. */
export function ligneDePeriode(
  objet: ObjetEreporting, periode: PeriodeEreporting, s: SourcesEreporting, dossier: DossierEreporting, aujourdHui: string,
): LigneDePeriode {
  const calcul = declarationCalculee(objet, periode, s, dossier, aujourdHui)
  const chaine = s.declarations.lignes
    .filter((d) => d.dossier_id === dossier.id && d.objet === objet && d.periode_debut === periode.debut && d.periode_fin === periode.fin)
    .sort(parRecenteDabord)
  const active = chaine.find((d) => d.etat === 'declaree') ?? null
  const etat = active == null ? null : etatDeLaDeclaration(active, calcul, { regimes: s.regimes, ecarts: s.ecarts, fiches: s.fiches })
  return { objet, periode, calcul, chaine, active, etat, resume: resumeDeLaLigne(periode, calcul, active, etat, aujourdHui) }
}

/** Les lignes de chaque objet : ses périodes, de la plus récente à la plus ancienne. À n'appeler que sur des lectures
 * toutes revenues entières (`lecturesManquantes`). */
export function lignesDeLEreporting(s: SourcesEreporting, dossier: DossierEreporting, aujourdHui: string): Record<ObjetEreporting, LigneDePeriode[]> {
  const lignes = { ventes: [], achats: [], paiements: [] } as Record<ObjetEreporting, LigneDePeriode[]>
  for (const objet of OBJETS_DE_LA_FENETRE) {
    lignes[objet] = periodesDeLObjet(objet, s, dossier, aujourdHui).map((p) => ligneDePeriode(objet, p, s, dossier, aujourdHui))
  }
  return lignes
}

/** Ce qu'une ligne a encore à faire, pour la pastille de l'objet : une période à déclarer, en retard ou à rectifier. */
export function ligneAFaire(l: LigneDePeriode): boolean {
  return ['a_declarer', 'en_retard', 'declaree_a_rectifier', 'a_verifier', 'a_completer', 'regime_a_confirmer', 'regime_a_reconfirmer']
    .includes(l.resume.code)
}

// ── Ce que la déclaration garde, et le geste qui la déclare ─────────────────────────────────────────────────────────

/** Un montant dans la devise de sa facture, aux espaces insécables (il ne se coupe pas en fin de ligne). */
export function montantEnDevise(centimes: number, devise: string): string {
  const montant = centimes / 100
  try {
    return montant.toLocaleString('fr-FR', { style: 'currency', currency: devise })
  } catch {
    return `${montant.toFixed(2).replace('.', ',')} ${devise}`
  }
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n === 1 ? un : plusieurs}`

/** « 3 factures, 412,50 € hors taxe » : ce qu'un contenu déclare, en une phrase. */
export function phraseDuContenu(objet: ObjetEreporting, contenu: ContenuDuCalcul): string {
  if (objet === 'achats') {
    const c = contenu as ContenuAchats
    const totaux = c.totauxParDevise.map((t) => `${montantEnDevise(t.htCentimes, t.devise)} hors taxe`).join(' et ')
    return `${pluriel(c.nombreOperations, 'facture', 'factures')}${totaux ? `, ${totaux}` : ''}`
  }
  if (objet === 'ventes') {
    const c = contenu as ContenuVentes
    return `${pluriel(c.nombreOperations, 'facture', 'factures')}, ${formatMoney(c.htCentimes / 100)} hors taxe, ${formatMoney(c.tvaCentimes / 100)} de TVA`
  }
  const c = contenu as ContenuPaiements
  return `${pluriel(c.nombreOperations, 'encaissement', 'encaissements')}, ${formatMoney(c.montantCentimes / 100)} TTC`
}

/** Les mots du plafond de la plateforme, quand le cabinet la nomme. */
export interface DonneesDeLaConfirmation {
  objet: ObjetEreporting
  periode: Pick<PeriodeEreporting, 'libelleDe'>
  plateforme: string
  contenu: ContenuDuCalcul
  /** La déclaration qu'une rectificative remplace ; nulle pour une initiale. */
  remplace: Pick<DeclarationEreportingHorsApplication, 'cree_le' | 'plateforme' | 'nb_operations'> | null
}

/**
 * LA CONFIRMATION D'UNE DÉCLARATION : elle nomme ce qui est déclaré — l'objet, la période, la plateforme, le contenu — et
 * ce que le geste a d'irréversible. Rien ne s'efface ensuite : une erreur se corrige par une rectificative qui remplace la
 * période ENTIÈRE (spécifications externes de la DGFiP v3.2, § 3.7.7, note 127).
 */
export function confirmationDeLaDeclaration(d: DonneesDeLaConfirmation): string {
  const contenu = phraseDuContenu(d.objet, d.contenu)
  if (d.remplace == null) {
    return `Vous déclarez avoir transmis sur ${d.plateforme} l’e-reporting ${NOMS_COURTS[d.objet]} ${d.periode.libelleDe} : ${contenu}.\n\n`
      + 'L’application garde ce contenu tel qu’elle le calcule aujourd’hui, figé, avec son empreinte. Cette mention ne '
      + 's’efface pas ; une erreur se corrige par une déclaration rectificative de toute la période.\n\n'
      + 'Ne confirmez qu’une fois la période déposée sur la plateforme : rien ne part d’ici.'
  }
  return `Vous déclarez avoir transmis sur ${d.plateforme} la déclaration RECTIFICATIVE de l’e-reporting ${NOMS_COURTS[d.objet]} ${d.periode.libelleDe} : ${contenu}.\n\n`
    + `Elle remplace ENTIÈREMENT celle du ${formatDate(d.remplace.cree_le)} (${d.remplace.plateforme}, ${pluriel(d.remplace.nb_operations, 'opération', 'opérations')}), `
    + 'qui reste dans l’historique, marquée remplacée. L’application garde ce contenu tel qu’elle le calcule aujourd’hui, figé, '
    + 'avec son empreinte ; cette mention ne s’efface pas.\n\n'
    + 'Ne confirmez qu’une fois la rectificative déposée sur la plateforme : rien ne part d’ici.'
}

/** Ce que la déclaration GARDERA, dit avant le clic : le contenu que l'application calcule aujourd'hui, figé avec son empreinte
 * — et, d'une rectificative, qu'il remplace la période entière. */
export function phraseDeCeQueLaDeclarationGarde(
  genre: 'initiale' | 'rectificative', objet: ObjetEreporting, libelleDe: string, contenu: ContenuDuCalcul,
): string {
  return `${genre === 'rectificative' ? 'La rectificative' : 'La déclaration'} gardera, figé et empreinté par la base, le contenu que `
    + `l’application calcule aujourd’hui pour l’e-reporting ${NOMS_COURTS[objet]} ${libelleDe} : ${phraseDuContenu(objet, contenu)}.`
}

/** Ce que la base reçoit d'une déclaration, depuis la ligne relue et la saisie : le régime sous lequel elle a été jugée,
 * la déclaration qu'elle remplace, la plateforme et la note sans leurs blancs de bord. Nul quand la ligne ne se déclare pas. */
export function saisieDeLaDeclaration(l: LigneDePeriode, saisie: { plateforme: string; note: string }): SaisieDeclaration | null {
  const contenu = contenuADeclarer(l.calcul)
  const regime = l.calcul.regime
  if (contenu == null || regime == null || (regime.etat !== 'confirme' && regime.etat !== 'a_reconfirmer')) return null
  const plateforme = saisie.plateforme.trim()
  const note = saisie.note.trim()
  return {
    objet: l.objet, debut: l.periode.debut, fin: l.periode.fin, regimeId: regime.regime.id, remplaceId: l.active?.id ?? null,
    plateforme: plateforme === '' ? null : plateforme, contenu, note: note === '' ? null : note,
  }
}

export type OffreDeDeclaration =
  /** Une initiale se déclare. */
  | { genre: 'initiale' }
  /** Une rectificative remplace l'active. */
  | { genre: 'rectificative' }
  /** Rien ne se déclare, et pourquoi. */
  | { genre: 'aucune'; pourquoi: string | null }

/**
 * CE QUI SE DÉCLARE D'UNE LIGNE : une initiale quand le calcul d'aujourd'hui est « à déclarer » sans aucun refus, une
 * rectificative quand la période est déclarée, à rectifier, et que le calcul d'aujourd'hui se déclarerait — sinon rien,
 * avec la raison. Une période qui n'a plus aucune opération ne se rectifie pas d'ici : la base refuse une déclaration à
 * blanc, et ce qu'elle devient est une question au cabinet.
 */
export function offreDeDeclaration(l: LigneDePeriode): OffreDeDeclaration {
  const declarable = l.calcul.etat === 'a_declarer' && l.calcul.refus.length === 0
  if (l.active == null) {
    return declarable ? { genre: 'initiale' } : { genre: 'aucune', pourquoi: null }
  }
  if (l.etat?.etat !== 'a_rectifier') return { genre: 'aucune', pourquoi: null }
  if (declarable) return { genre: 'rectificative' }
  if (l.calcul.etat === 'rien_a_declarer') {
    return {
      genre: 'aucune',
      pourquoi: 'Ce que l’application calcule aujourd’hui ne contient plus aucune opération : la base refuse une déclaration à '
        + 'blanc, et la rectificative qui viderait toute la période est à trancher avec le cabinet.',
    }
  }
  const premier = l.calcul.refus.find((r) => r.cle !== 'rien_a_declarer')
  return { genre: 'aucune', pourquoi: premier ? `La rectificative ne se fait pas encore. ${premier.message}` : null }
}

/** Le contexte des refus de `declarer_ereporting_hors_application` : les lectures du dossier, EN ENTIER. */
export function contexteDeLaDeclaration(s: SourcesEreporting, dossierId: string, aujourdHui: string): ContexteDeLaDeclaration {
  return {
    dossierId,
    regimes: s.regimes.lignes,
    declarations: s.declarations.lignes,
    sources: s.sources.lignes,
    fiches: s.fiches.lignes,
    pieces: s.pieces.lignes,
    factures: s.factures.lignes,
    encaissements: s.encaissements.lignes,
    aujourdHui,
  }
}

// ── Le détail d'un contenu ──────────────────────────────────────────────────────────────────────────────────────────

/** Le nom d'une pièce : son tiers, sinon son fichier. */
export function nomDeLaPiece(pieces: readonly Pick<PieceDeLEcran, 'id' | 'tiers' | 'nom_fichier'>[], id: string): string {
  const p = pieces.find((x) => x.id === id)
  return p ? (p.tiers?.trim() || p.nom_fichier) : 'une pièce'
}

/** Ce qu'une source désigne, en mots : la pièce d'une fiche, la facture, la pièce, l'encaissement. */
export function nomDeLaSource(source: SourceEreporting, s: Pick<SourcesEreporting, 'pieces' | 'fiches' | 'factures' | 'encaissements'>): string {
  switch (source.genre) {
    case 'piece': return `la pièce « ${nomDeLaPiece(s.pieces.lignes, source.id)} »`
    case 'fiche': {
      const fiche = s.fiches.lignes.find((f) => f.id === source.id)
      return fiche ? `la fiche de la pièce « ${nomDeLaPiece(s.pieces.lignes, fiche.piece_id)} »` : 'une fiche'
    }
    case 'facture': {
      const f = s.factures.lignes.find((x) => x.id === source.id)
      return f ? `la facture ${f.numero ?? ''}`.trim() : 'une facture'
    }
    case 'encaissement': {
      const e = s.encaissements.lignes.find((x) => x.id === source.id)
      return e ? `l’encaissement du ${formatDate(e.date_encaissement)}` : 'un encaissement'
    }
    case 'lecture': return `la lecture ${source.id}`
  }
}

/** Les sources d'un refus, nommées (cinq au plus). */
export function sourcesDuRefus(r: RefusEreporting, s: Pick<SourcesEreporting, 'pieces' | 'fiches' | 'factures' | 'encaissements'>): string {
  const noms = [...new Set(r.sources.filter((x) => x.genre !== 'lecture').map((x) => nomDeLaSource(x, s)))]
  if (noms.length === 0) return ''
  return noms.slice(0, 5).join(', ') + (noms.length > 5 ? ` et ${noms.length - 5} autre(s)` : '')
}

/** Ce qui est vu dans la période et n'entre pas dans la déclaration, ou pas en entier. */
export function ecarteesEnMots(
  calcul: DeclarationEreporting<ContenuDuCalcul>, s: Pick<SourcesEreporting, 'pieces' | 'fiches' | 'factures' | 'encaissements'>,
): string[] {
  return calcul.ecartees.map((e) => `${nomDeLaSource(e.source, s)} — ${RAISONS_ECARTEES[e.raison]}`)
}

export interface TableauDuContenu {
  colonnes: string[]
  lignes: string[][]
}

/** Le contenu d'un objet en tableau : un achat par ligne, une vente par jour et catégorie, un paiement par jour. */
export function tableauDuContenu(
  objet: ObjetEreporting, contenu: ContenuDuCalcul, s: Pick<SourcesEreporting, 'pieces'>,
): TableauDuContenu {
  if (objet === 'achats') {
    return {
      colonnes: ['Date', 'Pièce', 'Facture', 'Pays', 'Hors taxe'],
      lignes: (contenu as ContenuAchats).achats.map((a) => [
        formatDate(a.date), nomDeLaPiece(s.pieces.lignes, a.pieceId),
        `${a.typeDocument === '381' ? 'Avoir' : 'Facture'} n° ${a.numero}`, a.pays,
        montantEnDevise(a.typeDocument === '381' ? -a.htCentimes : a.htCentimes, a.devise),
      ]),
    }
  }
  if (objet === 'ventes') {
    return {
      colonnes: ['Jour', 'Catégorie', 'Hors taxe', 'TVA', 'Factures'],
      lignes: (contenu as ContenuVentes).transactions.map((t) => [
        formatDate(t.date), `${t.categorie === 'TLB1' ? 'Biens' : 'Services'}${t.optionDebits ? ' (option pour les débits)' : ''}`,
        formatMoney(t.htCentimes / 100), formatMoney(t.tvaCentimes / 100), String(t.factures.length),
      ]),
    }
  }
  return {
    colonnes: ['Jour', 'Montant TTC', 'Encaissements'],
    lignes: (contenu as ContenuPaiements).paiements.map((p) => [
      formatDate(p.date), formatMoney(p.montantCentimes / 100), String(p.encaissements.length),
    ]),
  }
}

// ── Le détail d'une période, en CSV ─────────────────────────────────────────────────────────────────────────────────

const montantCsv = (centimes: number): string => (centimes / 100).toFixed(2).replace('.', ',')

/**
 * Le détail de ce que l'application CALCULE pour une période, en CSV (point-virgule, virgule décimale, BOM UTF-8, comme la
 * piste d'audit) : une ligne par opération, des montants sans symbole ni espace insécable qu'un tableur lit comme des
 * nombres. Ce n'est PAS le fichier de la plateforme (e6) : il sert à relire la période avant de la déclarer.
 */
export function csvDuDetail(objet: ObjetEreporting, contenu: ContenuDuCalcul, s: Pick<SourcesEreporting, 'pieces'>): string {
  let colonnes: string[]
  let lignes: string[][]
  if (objet === 'achats') {
    colonnes = ['Date', 'Pièce', 'Type', 'N° de facture', 'Date de la facture', 'Pays', 'Devise', 'Hors taxe']
    lignes = (contenu as ContenuAchats).achats.map((a) => [
      a.date, nomDeLaPiece(s.pieces.lignes, a.pieceId), a.typeDocument === '381' ? 'Avoir' : 'Facture', a.numero, a.dateFacture, a.pays,
      a.devise, montantCsv(a.typeDocument === '381' ? -a.htCentimes : a.htCentimes),
    ])
  } else if (objet === 'ventes') {
    colonnes = ['Jour', 'Catégorie', 'Option pour les débits', 'Hors taxe', 'TVA', 'Factures et avoirs']
    lignes = (contenu as ContenuVentes).transactions.map((t) => [
      t.date, t.categorie === 'TLB1' ? 'Biens' : 'Services', t.optionDebits ? 'oui' : 'non', montantCsv(t.htCentimes),
      montantCsv(t.tvaCentimes), String(t.factures.length),
    ])
  } else {
    colonnes = ['Jour', 'Montant TTC', 'Encaissements']
    lignes = (contenu as ContenuPaiements).paiements.map((p) => [p.date, montantCsv(p.montantCentimes), String(p.encaissements.length)])
  }
  return '\uFEFF' + [colonnes, ...lignes].map((l) => l.map(champCsv).join(';')).join('\r\n')
}

/** « e-reporting-achats-2027-10-01-2027-10-31.csv » : l'objet et la période, jamais le nom du dossier. */
export function nomFichierDuDetail(objet: ObjetEreporting, periode: Pick<PeriodeEreporting, 'debut' | 'fin'>): string {
  return `e-reporting-${objet}-${periode.debut}-${periode.fin}.csv`
}

// ── À rectifier, en mots ────────────────────────────────────────────────────────────────────────────────────────────

const CHAMPS_EN_MOTS: Readonly<Record<string, string>> = {
  numero: 'le numéro de la facture', dateFacture: 'la date de la facture', typeDocument: 'le type (facture ou avoir)',
  origine: 'la facture corrigée', devise: 'la devise', pays: 'le pays du fournisseur', schema: 'le schéma de l’identifiant',
  identifiant: 'l’identifiant du fournisseur', nature: 'la nature', cadre: 'le cadre de facturation',
  autoliquidation: 'l’autoliquidation', dateOperation: 'la date de l’opération', periodeDebut: 'le début de la période de l’opération',
  periodeFin: 'la fin de la période de l’opération', lignes: 'la ventilation par taux', htCentimes: 'le hors-taxe',
  tvaEurosCentimes: 'la TVA', tvaCentimes: 'la TVA', parTaux: 'la répartition par taux', montantCentimes: 'le montant',
  date: 'le jour', role: 'le rôle du déclarant', siren: 'le SIREN du déclarant', numeroTva: 'le numéro de TVA du déclarant',
}

function nomDeLOperation(objet: ObjetEreporting, cle: string, s: Pick<SourcesEreporting, 'pieces'>): string {
  if (cle === 'declarant') return 'Le déclarant'
  if (objet === 'achats') return `L’achat de la pièce « ${nomDeLaPiece(s.pieces.lignes, cle)} »`
  if (objet === 'ventes') {
    const [date, categorie, option] = cle.split('|')
    return `Les ventes du ${formatDate(date)} (${categorie === 'TLB1' ? 'biens' : 'services'}${option === 'true' ? ', option pour les débits' : ''})`
  }
  return `Les paiements du ${formatDate(cle)}`
}

/** Une opération qui n'est plus déclarée de la même façon, en une phrase. */
export function motsDeLaDifference(d: DifferenceDOperation, objet: ObjetEreporting, s: Pick<SourcesEreporting, 'pieces'>): string {
  const nom = nomDeLOperation(objet, d.cle, s)
  if (d.sorte === 'ajoutee') return `${nom} est ajoutée depuis : la déclaration ne la portait pas.`
  if (d.sorte === 'retiree') return `${nom} est retirée depuis : la déclaration la portait.`
  const champs = d.champs.map((c) => CHAMPS_EN_MOTS[c] ?? c)
  // Les sources d'un ACHAT sont les versions de sa fiche : une nouvelle version qui déclare la même chose n'est pas un écart
  // (`etatDeLaDeclaration`), et « une source de plus, une de moins » ne dirait que cela. Pour des ventes ou des paiements,
  // ce sont des factures ou des encaissements entrés ou sortis de l'agrégat.
  const sources = objet === 'achats' ? [] : [
    d.sourcesAjoutees.length > 0 ? `${d.sourcesAjoutees.length} source(s) de plus` : null,
    d.sourcesRetirees.length > 0 ? `${d.sourcesRetirees.length} source(s) de moins` : null,
  ].filter((x) => x !== null)
  return `${nom} a changé : ${[...champs, ...sources].join(', ')}.`
}

/** Une cause qui fait rectifier, en une phrase. */
export function motsDeLaCause(c: CauseARectifier, s: Pick<SourcesEreporting, 'pieces'>): string {
  switch (c.cause) {
    case 'regime_retire':
      return `Le régime sous lequel la période a été déclarée a été retiré le ${formatDate(c.le)} : ce qui a été déclaré a été jugé sous un régime qui ne vaut plus.`
    case 'ecart_retire':
      return `La pièce « ${nomDeLaPiece(s.pieces.lignes, c.pieceId)} » était écartée au moment de la déclaration, et reprise le ${formatDate(c.le)} : elle est de nouveau à vérifier.`
    case 'fiche_posee_apres':
      return `Une fiche « fournisseur établi hors de France » a été posée le ${formatDate(c.le)} sur la pièce « ${nomDeLaPiece(s.pieces.lignes, c.pieceId)} » : elle décrit un achat de la période que la déclaration ne portait pas.`
    case 'fiche_changee_apres':
      return `La fiche de la pièce « ${nomDeLaPiece(s.pieces.lignes, c.pieceId)} » a été remplacée ou retirée le ${formatDate(c.le)} : ce qui a été déclaré d’elle peut ne plus être juste.`
  }
}

// ── Le régime ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que le régime déclare, fréquence par fréquence : « ses ventes et ses achats se déclarent par décade ; ses paiements,
 * chaque mois ». */
export function phraseDesFrequences(r: Pick<LigneDeRegime, 'frequence_transactions' | 'frequence_paiements'>): string {
  const paiements = r.frequence_paiements == null
    ? 'ses paiements ne se déclarent pas (option pour la TVA sur les débits)'
    : `ses paiements se déclarent ${rythme(r.frequence_paiements)}`
  return `ses ventes et ses achats se déclarent ${rythme(r.frequence_transactions)} ; ${paiements}`
}

export type EtatDuRegimeAffiche =
  /** Aucun régime confirmé en vigueur aujourd'hui. */
  | { etat: 'aucun' }
  /** Le régime en vigueur aujourd'hui ; `aReconfirmer` quand le statut de l'onglet TVA n'est plus le sien. */
  | { etat: 'en_vigueur'; regime: RegimeEreporting; aReconfirmer: boolean; statutAPreciser: boolean }

/** Le régime en vigueur aujourd'hui, et s'il se reconfirme : le statut de l'onglet TVA n'est plus celui de ce régime. */
export function etatDuRegime(
  regimes: readonly RegimeEreporting[], dossier: DossierEreporting, aujourdHui: string,
): EtatDuRegimeAffiche {
  const regime = regimeEnVigueur(regimes, dossier.id, aujourdHui)
  if (regime == null) return { etat: 'aucun' }
  const statutAPreciser = dossier.statut_tva == null
  return { etat: 'en_vigueur', regime, statutAPreciser, aReconfirmer: !statutAPreciser && !regimeEstLeStatutDuDossier(regime, dossier) }
}

/** Ce que le dossier doit déclarer, objet par objet, sous le statut de TVA d'aujourd'hui — la ligne de la carte. */
export function obligationsDeLaCarte(dossier: DossierEreporting): {
  objet: ObjetEreporting
  nom: string
  etat: EtatObligation
  frequence: string | null
}[] {
  const o = obligationsEreporting(dossier.statut_tva, dossier.article_exoneration, dossier.tva_periodicite, dossier.tva_sur_debits)
  return OBJETS_DE_LA_FENETRE.map((objet) => ({
    objet, nom: NOMS_DES_OBJETS[objet], etat: o[objet].etat,
    frequence: o[objet].frequence ? libelleFrequence(o[objet].frequence, false) : null,
  }))
}

/** La confirmation d'un régime : elle nomme le jour, le régime et ses fréquences, et dit ce que le geste a d'irréversible. */
export function confirmationDuRegime(saisie: SaisieRegime, libelle: string, frequences: string): string {
  return `Vous confirmez que le dossier déclare, à partir du ${formatDate(saisie.depuis)}, sous le régime « ${libelle} » : ${frequences}.\n\n`
    + 'C’est le régime tel que le dossier l’a déclaré à sa plateforme agréée. Il ne se modifie pas : une erreur se retire (il reste '
    + 'dans l’historique, marqué retiré), puis un autre se confirme. Les périodes à partir de ce jour se jugent sous lui.'
}

/**
 * LE RETRAIT D'UN RÉGIME, ce qu'il laisse derrière lui : le régime reste dans l'historique, marqué retiré, et ne vaut plus ;
 * les périodes qu'il couvrait se jugeront sous le régime précédent ou seront à confirmer ; les déclarations faites sous lui
 * restent déclarées et se disent « à rectifier » (hypothèse E5-Q7). Le nombre ne se dit que de déclarations lues en entier.
 */
export function confirmationDuRetraitDuRegime(
  regime: Pick<RegimeEreporting, 'id' | 'depuis' | 'statut_tva' | 'article_exoneration' | 'frequence_transactions'>,
  declarations: Lecture<Pick<DeclarationEreportingHorsApplication, 'regime_id' | 'etat'>>,
): string {
  const faites = declarations.complete
    ? declarations.lignes.filter((d) => d.regime_id === regime.id && d.etat === 'declaree').length
    : null
  const consequence = faites === null
    ? 'Les déclarations d’e-reporting n’ont pas pu être lues en entier : celles qui ont été faites sous ce régime, s’il y en a, restent déclarées et se diront à rectifier.'
    : faites === 0
      ? 'Aucune déclaration n’a été faite sous ce régime.'
      : `${pluriel(faites, 'déclaration faite', 'déclarations faites')} sous ce régime ${faites === 1 ? 'reste déclarée et se dira' : 'restent déclarées et se diront'} à rectifier.`
  return `Retirer le régime « ${libelleDuRegime(regime)} » confirmé à partir du ${formatDate(regime.depuis)} ?\n\n`
    + 'Il reste dans l’historique, marqué retiré : il ne vaut plus, et les périodes qu’il couvrait se jugeront sous le régime '
    + `précédent, ou seront à confirmer. ${consequence}`
}

// ── La pièce écartée ────────────────────────────────────────────────────────────────────────────────────────────────

/** La confirmation d'un écart : elle nomme la pièce et le motif, et dit que la période ne l'attendra plus. */
export function confirmationDeLEcart(nomDeLaPiece: string, motif: string): string {
  return `Écarter la pièce « ${nomDeLaPiece} » de l’e-reporting ?\n\nMotif : ${motif.trim()}\n\n`
    + 'Vous avez vérifié qu’elle n’est pas un achat à un fournisseur établi hors de France à déclarer, ou vous avez tranché de '
    + 'ne pas la déclarer : la période ne l’attendra plus. L’écart reste dans l’historique et se reprend — la pièce redevient '
    + 'alors à vérifier.'
}

/** La confirmation d'une reprise : la pièce redevient à vérifier, et une période déclarée pendant l'écart se dira à rectifier. */
export function confirmationDeLaReprise(nomDeLaPiece: string): string {
  return `Reprendre la pièce « ${nomDeLaPiece} » ?\n\nL’écart reste dans l’historique, marqué retiré : la pièce est de nouveau à vérifier, et la `
    + 'période qui l’attend ne se déclare plus tant qu’elle n’est ni décrite ni écartée de nouveau. Une période d’achats déclarée '
    + 'pendant l’écart peut se dire à rectifier.'
}

// ── La pièce dont la fiche est déclarée ─────────────────────────────────────────────────────────────────────────────

export type PieceDeclaree =
  /** La fiche de la pièce est source d'une déclaration active : la base refuse sa suppression, sous ce message. */
  | { sait: true; message: string }
  /** Une lecture manque : on ne sait pas si la pièce est déclarée. La base reste juge. */
  | { sait: false; message: string }

/**
 * SI UNE PIÈCE EST RETENUE PAR UNE DÉCLARATION (hypothèse E5-Q6, `garder_piece_declaree`) : la fiche de la pièce — n'importe
 * quelle version — est source d'une déclaration active, et la pièce ne se supprime plus, sauf avec son dossier. Dit avant le
 * clic, sous les mots de la base. Nul : lue en entier, la pièce n'est retenue par aucune. Les fiches et les déclarations
 * qui n'ont pas pu être lues en entier — ou pas encore — ne disent rien de la pièce : le message le dit.
 */
export function pieceDeclaree(
  pieceId: string,
  fiches: { fiches: readonly Pick<PieceHorsDeFrance, 'id' | 'dossier_id' | 'piece_id'>[]; motif: string | null } | null,
  declarations: {
    declarations: Lecture<Pick<DeclarationEreportingHorsApplication, 'id' | 'dossier_id' | 'objet' | 'periode_debut' | 'periode_fin' | 'etat'>>
    sources: Lecture<Pick<SourceDeclarationEreporting, 'declaration_id' | 'dossier_id' | 'genre' | 'source_id'>>
    /** Non nul quand l'une des deux lectures est partielle (`LectureDesDeclarations`). */
    motif: string | null
  } | null,
): PieceDeclaree | null {
  if (fiches === null || fiches.motif !== null || declarations === null || declarations.motif !== null
    || !declarations.declarations.complete || !declarations.sources.complete) {
    return {
      sait: false,
      message: 'Les fiches « hors de France » ou les déclarations d’e-reporting du dossier n’ont pas pu être lues en entier : si la '
        + 'fiche de cette pièce est déclarée, la base refuse de la supprimer.',
    }
  }
  const retenue = declarationQuiRetientLaPiece(pieceId, {
    fiches: fiches.fiches, declarations: declarations.declarations.lignes, sources: declarations.sources.lignes,
  })
  return retenue === null ? null : { sait: true, message: retenue.message }
}
