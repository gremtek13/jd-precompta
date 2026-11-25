// L'ÉCRITURE LIBRE DE L'EXPERT-COMPTABLE, À L'ÉCRAN (EL5 ; conception docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md,
// § 3, § 4, § 5.1 et le lot EL5 du § 7). Pur, sans réseau et sans import de `supabase.ts` : ce que la section « Écritures de
// l'expert-comptable » de l'onglet Écritures et les écrans qui appellent la 2035 tirent d'une lecture de la table.
//
// LA LECTURE, TELLE QUE LES ÉCRANS LA REÇOIVENT (lib/ecrituresLibresLecture.ts la fait, lib/useEcrituresLibres.ts la tient) :
// `absentes` — le drapeau `ECRITURES_LIBRES_PREVUES` baissé, la table n'est pas en base, rien n'a été demandé et les moteurs
// rendent ce qu'ils rendaient hier ; `lues` — EN ENTIER, chaque ligne de la table relue dans sa forme ; `illisibles` — lue en
// partie, refusée, ou une ligne dont la forme n'est pas celle que la base écrit : AUCUNE 2035, aucun FEC, aucun geste, et
// l'écran le dit. Une lecture pas encore revenue est NULLE : rien ne se calcule, rien ne s'offre.
//
// LE CLIENT n'a aucune branche sur la table (la policy est `admin_du_dossier`) : ses écrans ne la lisent pas, et ce qu'ils
// calculent de la 2035 (« Ma simulation ») le dit — EL5-Q1, le côté fermé (`ECRITURES_LIBRES_DU_CLIENT`).
import {
  ECRITURES_LIBRES_PREVUES, classeDeResultat, ecartDeclare, type ContexteDEcritureLibre, type LigneDEcritureLibre, type ModeComptableDeLEcriture,
  type SaisieDEcritureLibre, type SensDUneLigne,
} from './ecritureLibre'
import {
  ECRITURES_LIBRES_ABSENTES, referenceDeLEcritureLibre, type EcritureLibreDeLEtat, type EcritureLibreDesExports,
  type EcrituresLibresDesExports, type LigneEnBaseDEcritureLibre,
} from './ecrituresLibresDesExports'
import { lireCompteSaisi } from './compteDeBilan'
import { formatDate, formatMoney } from './format'
import { piecesCitablesParUneRegularisation, type OptionDeCitation, type PieceACiter } from './justificatifsDeLInventaire'

// ── La lecture ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LectureDesEcrituresLibres =
  | { dossierId: string; etat: 'absentes' }
  | {
    dossierId: string; etat: 'lues'; ecritures: readonly EcritureLibreDeLEtat[]
    // L'adresse de chaque compte qui a écrit une version, lue de `cabinet_admins` SOUS LA SESSION de qui regarde (la policy
    // ne la rend qu'au chef, au super-administrateur et au membre lui-même) ; un compte absent se dit « le cabinet ».
    auteurs: ReadonlyMap<string, string>
    // Ce qui a manqué aux adresses, sans retenir les écritures : un auteur non lu se dit « le cabinet », jamais deviné.
    motifDesAuteurs: string | null
  }
  | { dossierId: string; etat: 'illisibles'; motif: string }

/** Les colonnes lues : toutes celles de la table (le motif compris, que l'état seul imprime). */
export const COLONNES_DES_ECRITURES_LIBRES =
  'id, dossier_id, exercice, numero, date, libelle, motif, lignes, avec_extourne, piece_citee_id, version, cree_par, cree_le, modifie_par, modifie_le'

/** Les colonnes lues, selon que la migration de la contre-passation (EL7) est en base : la sienne en plus, sinon celles d'hier
 *  — PostgREST refuserait une colonne qui n'existe pas. */
export function colonnesDesEcrituresLibres(contrePassation: boolean): string {
  return contrePassation ? `${COLONNES_DES_ECRITURES_LIBRES}, contre_passe_id` : COLONNES_DES_ECRITURES_LIBRES
}

const texte = (v: unknown): v is string => typeof v === 'string'
const texteNonVide = (v: unknown): v is string => typeof v === 'string' && v !== ''
const entier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const DATE = /^\d{4}-\d{2}-\d{2}$/

function ligneLue(v: unknown): LigneEnBaseDEcritureLibre | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const l = v as Record<string, unknown>
  if (!texte(l.compte) || !/^[1-7][0-9]{5,9}$/.test(l.compte)) return null
  if (l.sens !== 'debit' && l.sens !== 'credit') return null
  if (!entier(l.centimes) || l.centimes <= 0) return null
  const poste = l.poste_2035 ?? null
  const lib = l.compte_lib ?? null
  if (poste !== null && !texteNonVide(poste)) return null
  if (lib !== null && !texte(lib)) return null
  return { compte: l.compte, sens: l.sens, centimes: l.centimes, poste_2035: poste, compte_lib: lib }
}

/**
 * Une ligne de la table, relue dans la forme que la base écrit ; nulle sinon — et la lecture entière devient illisible, car une
 * écriture qu'on ne sait pas relire ne se compte pas à moitié (une 2035 sans elle serait plausible et fausse).
 */
export function ecritureLibreDeLaLigne(ligne: unknown, dossierId: string): EcritureLibreDeLEtat | null {
  if (ligne === null || typeof ligne !== 'object') return null
  const r = ligne as Record<string, unknown>
  if (!texteNonVide(r.id) || r.dossier_id !== dossierId || !entier(r.exercice) || !entier(r.numero) || r.numero < 1) return null
  if (!texte(r.date) || !DATE.test(r.date) || Number(r.date.slice(0, 4)) !== r.exercice) return null
  if (!texteNonVide(r.libelle) || !texteNonVide(r.motif) || typeof r.avec_extourne !== 'boolean') return null
  if (!entier(r.version) || r.version < 1 || !texteNonVide(r.cree_par) || !texteNonVide(r.cree_le)) return null
  const piece = r.piece_citee_id ?? null
  const modifiePar = r.modifie_par ?? null
  const modifieLe = r.modifie_le ?? null
  if ((piece !== null && !texteNonVide(piece)) || (modifiePar !== null && !texteNonVide(modifiePar))
    || (modifieLe !== null && !texteNonVide(modifieLe))) return null
  if (!Array.isArray(r.lignes) || r.lignes.length < 2) return null
  const lignes = r.lignes.map(ligneLue)
  if (lignes.some((l) => l === null)) return null
  // La contre-passation (EL7) : lue le drapeau levé seulement ; absente de la ligne, la clé n'entre pas dans l'écriture relue.
  const contrePasse = r.contre_passe_id === undefined ? undefined : r.contre_passe_id ?? null
  if (contrePasse !== undefined && contrePasse !== null && (!texteNonVide(contrePasse) || contrePasse === r.id)) return null
  return {
    id: r.id, dossier_id: r.dossier_id, exercice: r.exercice, numero: r.numero, date: r.date, libelle: r.libelle, motif: r.motif,
    lignes: lignes as LigneEnBaseDEcritureLibre[], avec_extourne: r.avec_extourne, piece_citee_id: piece, version: r.version,
    cree_par: r.cree_par, cree_le: r.cree_le, modifie_par: modifiePar, modifie_le: modifieLe,
    ...(contrePasse === undefined ? {} : { contre_passe_id: contrePasse }),
  }
}

/** Ce que les exports et les moteurs reçoivent d'une écriture : tout, SAUF le motif (EL3 : il n'entre ni au FEC ni à la piste). */
export function sansLeMotif(e: EcritureLibreDeLEtat): EcritureLibreDesExports {
  const { motif: _motif, ...reste } = e
  void _motif
  return reste
}

/**
 * Ce que la 2035, la situation, l'estimation, le FEC et la piste d'audit reçoivent d'une lecture : l'absence (le drapeau baissé),
 * les écritures lues sans leur motif, ou NUL — pas encore revenue, ou illisible, ou d'un autre dossier — : l'appelant ne calcule
 * pas, et le dit.
 */
export function ecrituresLibresPourLesMoteurs(
  lu: LectureDesEcrituresLibres | null, dossierId: string, prevues: boolean = ECRITURES_LIBRES_PREVUES,
): EcrituresLibresDesExports | null {
  // Le drapeau baissé, la table n'est pas en base : l'absence, AVANT même que la lecture revienne — rien ne change à l'écran.
  if (!prevues) return ECRITURES_LIBRES_ABSENTES
  if (lu === null || lu.dossierId !== dossierId) return null
  if (lu.etat === 'absentes') return ECRITURES_LIBRES_ABSENTES
  if (lu.etat === 'illisibles') return null
  return { etat: 'lues', ecritures: lu.ecritures.map(sansLeMotif), auteurs: lu.auteurs }
}

/** Le motif d'une lecture qui retient les calculs, en clair ; nul quand ils peuvent se faire, ou quand elle n'est pas revenue. */
export function motifDesEcrituresLibres(lu: LectureDesEcrituresLibres | null): string | null {
  return lu?.etat === 'illisibles' ? `les écritures de l’expert-comptable : ${lu.motif}` : null
}

/**
 * « MA SIMULATION » DU CLIENT (EL5-Q1, le côté fermé, posée au cabinet). La conception (§ 5.3) veut que la contribution d'une
 * écriture libre entre dans le total de la simulation sans que la ligne, ni son libellé, ni son motif n'y paraissent ; mais la
 * policy de la table est au cabinet seul (`admin_du_dossier`), et aucune fonction ne rend au client les seuls totaux. Tant
 * qu'elle n'est pas tranchée : la simulation ne les compte pas, et le DIT — jamais un chiffre silencieusement faux.
 */
export const ECRITURES_LIBRES_DU_CLIENT: EcrituresLibresDesExports = ECRITURES_LIBRES_ABSENTES

/** La simulation dit-elle qu'elle ne compte pas les écritures du cabinet ? Le drapeau levé, en trésorerie seulement : en
 *  engagement, une écriture libre ne porte aucun poste, et l'estimation n'en compte rien. */
export function simulationTaitLesEcrituresLibres(mode: ModeComptableDeLEcriture, prevues: boolean = ECRITURES_LIBRES_PREVUES): boolean {
  return prevues && mode === 'tresorerie'
}
export const PHRASE_DE_LA_SIMULATION =
  'Cette simulation ne compte pas les écritures que ton cabinet passe lui-même (ses opérations diverses) : elles peuvent changer '
  + 'le résultat qu’il déclarera.'

// ── La saisie ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne telle que le formulaire la tient : les textes tapés. `poste` vide : « hors de la 2035 ». */
export interface LigneDuFormulaire {
  compte: string
  sens: SensDUneLigne
  montant: string
  poste: string
  compteLib: string
}

export interface FormulaireDEcritureLibre {
  // Nuls pour une écriture nouvelle ; l'identifiant et la version LUE pour un remplacement.
  id: string | null
  versionLue: number | null
  date: string
  libelle: string
  motif: string
  lignes: LigneDuFormulaire[]
  avecExtourne: boolean
  pieceCiteeId: string | null
}

export const LIGNE_VIDE: LigneDuFormulaire = { compte: '', sens: 'debit', montant: '', poste: '', compteLib: '' }

export function formulaireVide(date: string): FormulaireDEcritureLibre {
  return {
    id: null, versionLue: null, date, libelle: '', motif: '', avecExtourne: false, pieceCiteeId: null,
    lignes: [{ ...LIGNE_VIDE, sens: 'debit' }, { ...LIGNE_VIDE, sens: 'credit' }],
  }
}

/** Un montant AU CENTIME, positif ; NaN pour tout le reste — le module refuse alors sous les mots de la base. */
export function centimesDuMontant(saisi: string): number {
  const net = saisi.replace(/[\s  €]/g, '')
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(net)
  if (m === null) return Number.NaN
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Un compte tapé, lu comme l'application le lit (`lireCompteSaisi`) ; illisible, le texte tel quel — le module le refusera. */
export function compteDuFormulaire(saisi: string): string {
  return lireCompteSaisi(saisi).compte ?? saisi.trim()
}

/** La saisie TELLE QU'ELLE PART : ce que le module juge, ce que la base reçoit. */
export function saisieDuFormulaire(f: FormulaireDEcritureLibre): SaisieDEcritureLibre {
  return {
    date: f.date, libelle: f.libelle, motif: f.motif, avecExtourne: f.avecExtourne,
    lignes: f.lignes.map((l): LigneDEcritureLibre => ({
      compte: compteDuFormulaire(l.compte), sens: l.sens, centimes: centimesDuMontant(l.montant),
      poste2035: l.poste === '' ? null : l.poste, compteLib: l.compteLib.trim() === '' ? null : l.compteLib,
    })),
  }
}

/** Le formulaire d'une écriture lue, pour la remplacer : la version lue retenue. */
export function formulaireDeLEcriture(e: EcritureLibreDeLEtat): FormulaireDEcritureLibre {
  return {
    id: e.id, versionLue: e.version, date: e.date, libelle: e.libelle, motif: e.motif, avecExtourne: e.avec_extourne,
    pieceCiteeId: e.piece_citee_id,
    lignes: e.lignes.map((l) => ({
      compte: l.compte, sens: l.sens, montant: montantEnTexte(l.centimes), poste: l.poste_2035 ?? '', compteLib: l.compte_lib ?? '',
    })),
  }
}

/** Des centimes en texte de saisie : « 1234,56 ». */
export function montantEnTexte(centimes: number): string {
  return `${Math.floor(centimes / 100)},${String(centimes % 100).padStart(2, '0')}`
}

/** Les totaux de la saisie, en centimes, sur les seuls montants lisibles ; l'écart, débits moins crédits. */
export function equilibreDeLaSaisie(s: SaisieDEcritureLibre): { debit: number; credit: number; ecart: number; lisible: boolean } {
  const lisible = s.lignes.every((l) => Number.isSafeInteger(l.centimes) && l.centimes > 0)
  const somme = (sens: SensDUneLigne) => s.lignes.filter((l) => l.sens === sens && Number.isSafeInteger(l.centimes))
    .reduce((t, l) => t + l.centimes, 0)
  const debit = somme('debit')
  const credit = somme('credit')
  return { debit, credit, ecart: debit - credit, lisible }
}

/** L'effet de la saisie sur la 2035 : ce qu'elle compte (dépenses, recettes) et ce qu'elle déclare hors de la 2035. */
export function effetSurLa2035(s: SaisieDEcritureLibre, mode: ModeComptableDeLEcriture): {
  depensesComptees: number; recettesComptees: number; depensesHors: number; recettesHors: number
} {
  let depensesComptees = 0
  let recettesComptees = 0
  if (mode === 'tresorerie') {
    for (const l of s.lignes) {
      if (l.poste2035 === null || !Number.isSafeInteger(l.centimes)) continue
      const classe = classeDeResultat(l.compte)
      if (classe === 6) depensesComptees += l.sens === 'debit' ? l.centimes : -l.centimes
      if (classe === 7) recettesComptees += l.sens === 'credit' ? l.centimes : -l.centimes
    }
  }
  const hors = ecartDeclare(s, mode)
  return { depensesComptees, recettesComptees, depensesHors: hors.depenses, recettesHors: hors.recettes }
}

/** Des centimes en euros, à l'écran (`formatMoney` : l'espace insécable de `fr-FR`, jamais coupée) ; NaN : « — ». */
export function euros(centimes: number): string {
  return formatMoney(Number.isSafeInteger(centimes) ? centimes / 100 : Number.NaN)
}

// ── La pièce citée (EL-Q8 (A) : facultative ; ELQ8-Q1 (B) : toute pièce du dossier) ───────────────────────────────────────
//
// La base accepte toute pièce DE CE DOSSIER, quel que soit son statut (`enregistrer_ecriture_libre`, étape 8 : la pièce existe
// et son dossier est celui de l'écriture). L'écran propose la même chose, et rien de plus large (ELQ8-Q1, tranchée (B) par le
// cabinet le 25/11/2026 : « toutes les pièces du dossier, « à valider » comprises, comme l'inventaire » — la facture qui fonde
// une écriture de l'expert est souvent encore « à valider » quand il la passe) : toutes les pièces du dossier que l'onglet
// Écritures lit en entier (`lireTout`), une pièce « à valider » dite telle dans son option. L'état des écritures libres et la
// piste d'audit la désignent comme une autre (sa date de dépôt et son empreinte), l'onglet leur donnant les pièces citées quel
// que soit leur statut. Ce que le choix emporte, dit ici plutôt que découvert : une pièce citée ne se supprime plus — la clé
// étrangère de la table la retient, « à valider » comprise (un doublon cité se retire de l'écriture d'abord, tant que son
// exercice n'est pas validé). Lue en partie ou refusée, la liste ne s'offre pas, l'écran le dit, et la saisie part avec ce
// qu'elle cite déjà (rien, pour une nouvelle) : rien n'empêche d'enregistrer sans pièce. Aucun refus avant le clic : ce que
// l'écran propose est du dossier, et la pièce déjà citée d'une écriture relue l'est aussi — la base l'a vérifié en l'écrivant.
//
// Une pièce se désigne par sa date, son tiers et son montant TTC, son sens en plus — jamais par le nom de son fichier.

/** Les pièces qu'une écriture libre peut citer : toutes celles de CE dossier, « à valider » comprises (ELQ8-Q1 (B)), la plus
 *  récente d'abord (sans date à la fin). */
export function piecesCitablesParUneEcritureLibre<P extends PieceACiter>(pieces: readonly P[], dossierId: string): P[] {
  const gardees = pieces.filter((p) => p.dossier_id === dossierId)
  return piecesCitablesParUneRegularisation({ pieces: gardees, factures: [] }) as P[]
}

/** Les pièces que les écritures libres données citent, parmi celles lues, quel que soit leur statut : ce que l'état des
 *  écritures libres et la piste d'audit désignent (ELQ8-Q1 (B)). */
export function piecesCiteesParDesEcrituresLibres<P extends { id: string }>(
  pieces: readonly P[], libres: readonly { piece_citee_id: string | null }[],
): P[] {
  const citees = new Set(libres.flatMap((e) => (e.piece_citee_id === null ? [] : [e.piece_citee_id])))
  return pieces.filter((p) => citees.has(p.id))
}

const SENS_DES_PIECES: Readonly<Record<PieceACiter['type_piece'], string>> = {
  achat: 'Dépense', vente: 'Recette', note_frais: 'Note de frais', autre: 'Autre pièce',
}

/** L'option d'une pièce dans le choix : sa date et son tiers en titre, son montant TTC et son sens en détail. Une colonne que la
 *  ligne ne porte pas se lit comme une colonne nulle (« non lu ») : depuis ELQ8-Q1 (B), le choix reçoit aussi les pièces « à
 *  valider », dont l'exemplaire d'une facture, que rien n'a encore lu — une ligne incomplète ne fait jamais tomber l'onglet. */
export function optionDeLaPieceDUneEcritureLibre(p: PieceACiter): OptionDeCitation {
  const datePiece = p.date_piece ?? null
  const tiersLu = typeof p.tiers === 'string' ? p.tiers.trim() : ''
  const montantTtc = p.montant_ttc ?? null
  const sens = SENS_DES_PIECES[p.type_piece] ?? 'Pièce'
  const date = datePiece === null ? 'Sans date' : formatDate(datePiece)
  const tiers = tiersLu === '' ? 'tiers non lu' : tiersLu
  const montant = montantTtc === null ? 'montant non lu' : `${formatMoney(montantTtc)} TTC`
  return {
    citation: { genre: 'piece', id: p.id }, titre: `${date} — ${tiers}`, fichier: false,
    detail: `${montant} · ${sens}${p.statut === 'validee' ? '' : ' · à valider'}`,
    champs: [p.tiers ?? null, datePiece === null ? null : formatDate(datePiece), montantTtc, sens],
  }
}

/** Les options du choix : les pièces citables, dans leur ordre. */
export function optionsDesPiecesDUneEcritureLibre(pieces: readonly PieceACiter[], dossierId: string): OptionDeCitation[] {
  return piecesCitablesParUneEcritureLibre(pieces, dossierId).map(optionDeLaPieceDUneEcritureLibre)
}

/** L'option de la pièce citée, cherchée parmi les citables ; nulle si rien n'est cité, si les pièces ne sont pas lues en entier
 *  (`pieces` nul), ou si elle ne s'y retrouve pas (une pièce que la lecture ne rend pas). */
export function optionDeLaPieceCitee(
  pieceId: string | null, pieces: readonly PieceACiter[] | null, dossierId: string,
): OptionDeCitation | null {
  if (pieceId === null || pieces === null) return null
  const p = piecesCitablesParUneEcritureLibre(pieces, dossierId).find((x) => x.id === pieceId)
  return p === undefined ? null : optionDeLaPieceDUneEcritureLibre(p)
}

/** Ce que la liste et la confirmation disent de la pièce citée — jamais devinée : une pièce qui ne se retrouve pas se dit telle. */
export function ligneDeLaPieceCitee(pieceId: string | null, pieces: readonly PieceACiter[] | null, dossierId: string): string {
  if (pieceId === null) return 'Aucune pièce citée : l’état des écritures libres en tient lieu.'
  if (pieces === null) return 'Pièce citée : celle qui est déjà citée (les pièces du dossier ne sont pas lues en entier).'
  const o = optionDeLaPieceCitee(pieceId, pieces, dossierId)
  return o === null ? 'Pièce citée : une pièce du dossier qui n’est pas parmi ses pièces lues.' : `Pièce citée : ${o.titre} (${o.detail}).`
}

/**
 * La confirmation, qui NOMME ce qui part : chaque ligne (compte, sens, montant, effet sur la 2035), les totaux, l'effet sur la
 * 2035, l'extourne, la pièce citée (`ligneDeLaPieceCitee`) et les avertissements répétés. Un remplacement dit qu'il efface la
 * version lue (EL-Q9 (A)).
 */
export function confirmationDeLEcriture(
  f: FormulaireDEcritureLibre, mode: ModeComptableDeLEcriture, avertissements: readonly string[], pieceCitee: string,
): string {
  const s = saisieDuFormulaire(f)
  const { debit, credit } = equilibreDeLaSaisie(s)
  const lignes = s.lignes.map((l) => {
    const effet = mode !== 'tresorerie' || classeDeResultat(l.compte) === null ? '' : ` — 2035 : ${l.poste2035 ?? 'hors de la 2035'}`
    return `• ${l.compte}${l.compteLib ? ` ${l.compteLib.trim()}` : ''} : ${l.sens === 'debit' ? 'débit' : 'crédit'} ${euros(l.centimes)}${effet}`
  })
  const e = effetSurLa2035(s, mode)
  const effet = mode !== 'tresorerie' ? 'En comptabilité d’engagement, aucune 2035 : l’écriture change les comptes seuls.'
    : `Effet sur la 2035 : dépenses ${euros(e.depensesComptees)}, recettes ${euros(e.recettesComptees)}`
      + (e.depensesHors !== 0 || e.recettesHors !== 0
        ? ` ; hors de la 2035, un écart déclaré de ${euros(e.depensesHors)} de dépenses et ${euros(e.recettesHors)} de recettes.`
        : '.')
  return [
    f.id === null ? `Passer l’écriture libre du ${dateCourte(s.date)} : « ${s.libelle.trim()} » ?`
      : `Remplacer l’écriture libre (version ${f.versionLue}) par celle-ci, du ${dateCourte(s.date)} : « ${s.libelle.trim()} » ? La version remplacée ne se garde pas.`,
    ...lignes,
    `Total : débit ${euros(debit)}, crédit ${euros(credit)}.`,
    effet,
    ...(s.avecExtourne ? ['Extournée au 1er janvier suivant, ligne par ligne au sens inverse.'] : []),
    pieceCitee,
    ...avertissements.map((a) => `Attention : ${a}`),
  ].join('\n')
}

/** La confirmation d'un retrait : la référence, la date, le libellé et ses totaux. */
export function confirmationDuRetrait(e: EcritureLibreDesExports): string {
  const debit = e.lignes.filter((l) => l.sens === 'debit').reduce((t, l) => t + l.centimes, 0)
  return `Retirer l’écriture libre ${referenceDeLEcritureLibre(e)} du ${dateCourte(e.date)} : « ${e.libelle} » (${e.lignes.length} lignes, `
    + `${euros(debit)} au débit et au crédit)${e.avec_extourne ? ', et son extourne au 1er janvier suivant' : ''} ? `
    // Le numéro suit `enregistrer_ecriture_libre` (le plus haut de l'année, plus un) : un retrait laisse un trou, sauf celui de la
    // dernière écriture de l'année, que la suivante reprend (relevé le 24/11/2026, EL7 ; EL7-Q2) — la phrase d'avant le niait.
    + 'Ses lignes quittent le brouillon ; son numéro reste un trou, sauf si elle est la dernière de son année : la suivante le reprend.'
}

function dateCourte(date: string): string {
  return DATE.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : date
}

/** Les écritures d'un exercice, dans l'ordre de leurs numéros. */
export function ecrituresDeLExercice<T extends Pick<EcritureLibreDesExports, 'exercice' | 'numero' | 'id'>>(
  ecritures: readonly T[], annee: number,
): T[] {
  return ecritures.filter((e) => e.exercice === annee).sort((a, b) => a.numero - b.numero || a.id.localeCompare(b.id))
}

/** Le contexte du jugement, tiré de ce que l'onglet a lu : nul tant que la frontière et l'ouverture ne sont pas lues. */
export function contexteDuJugement(
  mode: ModeComptableDeLEcriture, frontiere: string | null | undefined, ouverture: string | null | undefined, aujourdhui: string,
): ContexteDEcritureLibre | null {
  if (frontiere === undefined || ouverture === undefined) return null
  return { mode, frontiere, ouverture, aujourdhui }
}
