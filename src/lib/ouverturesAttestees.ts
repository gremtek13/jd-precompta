import type { AuteurDUneOuverture } from './types'

// QUI A OUVERT UN ACCÈS CLIENT (espace client, ligne 51.5 ; P1TQ2-Q1, tranchée par le cabinet le 16/11/2026, contre la
// recommandation : « (A) Nommer le compte du cabinet »). La migration PRÉPARÉE `auteur_des_ouvertures_d_acces`
// (supabase/preparees/20261116120000_auteur_des_ouvertures_d_acces.sql) pose la table `auteurs_des_ouvertures` : le compte du
// cabinet du dossier qui, SOUS SA SESSION, a attesté l'arrivée d'un accès que la trace des droits a écrite sans session
// (`create-client-access` l'écrit sous la clé secrète, puis appelle `attester_ouverture_d_acces` sous la session de
// l'appelant). Le récit : HISTORIQUE.md, « 16/11/2026 — P1TQ2-Q1 : QUI A OUVERT UN ACCÈS CLIENT » ; l'essai :
// supabase/essais/auteurDesOuvertures.sql.
//
// CE QUE LA RECOMMANDATION VOULAIT ÉVITER, ET COMMENT IL EST BORNÉ (P1T-E1 : « nommer la personne précise demanderait de
// montrer des adresses de l'équipe dans l'historique »). La table ne garde qu'un IDENTIFIANT de compte, lu par le cabinet du
// dossier seul ; l'onglet Accès, côté cabinet seul, nomme ce compte par l'adresse de sa ligne d'équipe
// (`cabinet_admins.email`), lue SOUS LA SESSION de qui regarde : la policy `cabinet_admins_select` ne la rend qu'au chef du
// cabinet, au super-administrateur et au membre lui-même. Un autre membre de l'équipe lit « Le cabinet » (P1T-E1), un membre
// parti aussi. Le client ne lit ni la table, ni la trace, ni l'équipe. Aucun identifiant ne s'affiche jamais.
//
// LE DRAPEAU, baissé tant que la migration n'est pas en base : levé, l'onglet LIT la table (une table absente rendrait la
// lecture en échec) et le plan de sauvegarde la porte (la lire avant sa migration ferait échouer toute sauvegarde). Il se
// lève le jour où la migration entre dans l'export, avec `create-client-access` redéployée sa constante
// `OUVERTURES_ATTESTEES_EN_BASE` levée ; il se baisse AVANT tout retour.
export const OUVERTURES_ATTESTEES_PREVUES: boolean = false

/** La table de la migration, que le plan de sauvegarde ne porte que le drapeau levé. */
export const TABLES_DES_OUVERTURES_ATTESTEES: readonly string[] = ['auteurs_des_ouvertures']

/** Une attestation telle que la base la rend : la ligne de la trace qu'elle nomme, et le compte qui l'a faite. */
export type OuvertureAttesteeBrute = AuteurDUneOuverture

/** Les attestations lues, par ligne de la trace ; `motif` NON NUL dès qu'il en manque (lecture partielle, ligne illisible). */
export interface OuverturesAttestees {
  parTrace: ReadonlyMap<string, string>
  motif: string | null
}

const texte = (v: unknown): v is string => typeof v === 'string' && v !== ''

/**
 * La lecture jugée : chaque attestation lisible rangée sous la ligne de la trace qu'elle nomme. Une ligne illisible est
 * écartée et comptée ; la lecture entière et toutes lignes lisibles, `motif` nul.
 */
export function ouverturesDeLaLecture(lecture: {
  lignes: readonly OuvertureAttesteeBrute[]; complete: boolean; motif: string | null
}): OuverturesAttestees {
  const parTrace = new Map<string, string>()
  let ecartees = 0
  for (const l of lecture.lignes) {
    if (!texte(l.trace_id) || !texte(l.auteur_id) || parTrace.has(l.trace_id)) ecartees += 1
    else parTrace.set(l.trace_id, l.auteur_id)
  }
  const motifs: string[] = []
  if (!lecture.complete) motifs.push(lecture.motif ?? 'lecture incomplète')
  if (ecartees > 0) motifs.push(`${ecartees} attestation(s) d’ouverture illisible(s)`)
  return { parTrace, motif: motifs.length === 0 ? null : motifs.join(' ; ') }
}

/** Une ligne de l'équipe telle que la session de qui regarde la lit : son compte et son adresse. */
export interface MembreLu {
  user_id: string
  email: string | null
}

/**
 * L'équipe NOMMABLE : les adresses que la session lit, par compte. La policy décide de ce qui revient — tout le cabinet pour
 * le chef et le super-administrateur, sa propre ligne pour un membre — : ce n'est pas une lecture partielle, c'est ce que
 * cette personne peut lire. Une adresse vide ne nomme personne.
 */
export function equipeNommable(lignes: readonly MembreLu[]): ReadonlyMap<string, string> {
  const equipe = new Map<string, string>()
  for (const l of lignes) {
    if (texte(l.user_id) && typeof l.email === 'string' && l.email.trim() !== '') equipe.set(l.user_id, l.email.trim())
  }
  return equipe
}

/**
 * L'auteur attesté d'une arrivée de l'accès dans la trace, nommé pour qui regarde : son adresse quand la session la lit dans
 * l'équipe du cabinet, sinon nul — l'écran dit alors « Le cabinet », ce que P1T-E1 dit de tout compte du cabinet. Nul aussi
 * sans attestation de cette ligne (les ouvertures d'avant la migration, une attestation qui a échoué) : la ligne reste
 * « Sans session », ce que la base sait.
 */
export function adresseDeLAuteurAtteste(
  traceId: string, ouvertures: OuverturesAttestees | null, equipe: ReadonlyMap<string, string> | null,
): { atteste: boolean; adresse: string | null } {
  const auteur = ouvertures?.parTrace.get(traceId)
  if (auteur === undefined) return { atteste: false, adresse: null }
  return { atteste: true, adresse: equipe?.get(auteur) ?? null }
}
