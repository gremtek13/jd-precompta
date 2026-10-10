// LA COUVERTURE DU RELEVÉ, ET LA SIMULATION DU CLIENT SOUS LA CASE « BANQUE » (espace client, étape P7 ; conception :
// HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §6.1 et §7 ; EC-Q1 sans
// réponse, sa recommandation prise comme hypothèse : « Ma simulation » suit la case « Banque »).
//
// POURQUOI CE MODULE EXISTE. L'Accueil et « Mes pièces » du client lisaient TOUS les mouvements de son relevé — dates,
// libellés, montants — pour une seule chose : savoir quels MOIS manquent (`moisManquantsDe`). L'étape P7 resserre la
// lecture des mouvements au seul accès qui porte la case « Banque » (migration `lectures_bancaires_au_droit_banque`). Or
// une lecture que la RLS refuse rend ZÉRO ligne, sans erreur : un écran qui lirait encore les mouvements sans la case
// croirait le relevé vide, et réclamerait au client tous les mois de l'année. Les deux écrans passent donc, AVANT le
// resserrement, à `couverture_du_releve` (migration `banque_du_client`) : les mois où le relevé porte un mouvement, ni
// montant, ni libellé, pour tout accès au dossier. Et « Ma simulation », qui se calcule SUR la banque, se tait sans la
// case — en le disant —, au lieu de calculer sur un relevé que la base ne lui rend plus.
//
// LA FONCTION EST-ELLE EN BASE ? `COUVERTURE_EXPORTEE` le dit, comme `RETRAIT_EXPORTE` dans cotisationPersonnelle.ts.
// Tant qu'il est faux, rien ne change pour le client : les deux écrans lisent les mouvements comme avant, et la
// simulation s'affiche pour tout accès. Le jour où l'export porte `couverture_du_releve` (supabase/schema),
// couvertureReleve.test.ts vire au rouge tant que ceci reste faux : le passer à vrai bascule d'un même geste les deux
// écrans sur la couverture, la simulation sous la case « Banque », et les phrases de l'onglet Accès (lib/droitsAcces.ts).
// La migration du resserrement ne s'applique qu'APRÈS la mise en ligne de cette bascule.
//
// Le jour de la bascule, l'export reçoit aussi les deux registres de la migration `banque_du_client` : le plan de
// sauvegarde doit les porter dans le même geste (sauvegardeTables.test.ts et sauvegardeRelations.test.ts l'exigent).
//
// Module PUR : il n'importe pas `supabase.ts` (lib/droitsAcces.ts, que lit l'onglet Accès, en lit le drapeau). Les
// écrans appellent la base et passent la REQUÊTE telle quelle à `lireLaCouverture` ou `lireLeDroitBanque`, qui l'attendent
// par `await` : un constructeur de requête n'est pas une promesse — `.then(f)` rendrait ce que SON `then` rend (rien, pour
// la doublure qui retient les réponses), quand `await` attend la réponse qu'il passe à son rappel.
import type { LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'

// Ce que rend une fonction SQL appelée par le client, une fois attendue : seuls `data` et `error` comptent ici.
export interface ReponseDeLaBase {
  data: unknown
  error: unknown
}

export const COUVERTURE_EXPORTEE: boolean = false

/** Un mois couvert par le relevé, sous la forme qu'attend `moisManquantsDe` : son premier jour, `AAAA-MM-01`. */
export interface MoisCouvert {
  date: string
}

const PREMIER_DU_MOIS = /^(\d{4})-(0[1-9]|1[0-2])-01$/

/**
 * Les mois rendus par `couverture_du_releve` — un tableau de dates, chacune au premier du mois. Toute autre forme rend
 * `null` : une réponse qu'on ne sait pas lire ne doit pas passer pour un relevé vide, ni pour un relevé complet.
 */
export function moisDeLaCouverture(rendu: unknown): MoisCouvert[] | null {
  if (!Array.isArray(rendu)) return null
  const mois: MoisCouvert[] = []
  for (const valeur of rendu) {
    if (typeof valeur !== 'string' || !PREMIER_DU_MOIS.test(valeur)) return null
    mois.push({ date: valeur })
  }
  return mois
}

/**
 * La lecture de la couverture telle qu'un écran la reçoit de `supabase.rpc('couverture_du_releve', …)`, sous la forme
 * de `lireTout` : une seule valeur, donc pas de tranches ni de plafond silencieux — mais un refus ou une réponse
 * illisible se SIGNALENT (`complete` faux, avec le motif), et ne rendent aucun mois.
 */
export function lectureDeLaCouverture(reponse: ReponseDeLaBase): LectureComplete<MoisCouvert> {
  if (reponse.error) {
    return { lignes: [], complete: false, motif: `couverture du relevé refusée : ${messageErreur(reponse.error, 'raison inconnue')}` }
  }
  const mois = moisDeLaCouverture(reponse.data)
  if (!mois) return { lignes: [], complete: false, motif: 'couverture du relevé illisible' }
  return { lignes: mois, complete: true, motif: null }
}

/**
 * La couverture telle que l'écran la lit : `lireLaCouverture(supabase.rpc('couverture_du_releve', { p_dossier_id }))`.
 * La requête est ATTENDUE ici, et son erreur lue (ecrituresVerifiees.test.ts compte tout `.rpc(` comme une écriture
 * possible, et nomme ce consommateur) ; une requête qui lève tombe du côté signalé, comme un refus — jamais un relevé vide.
 */
export async function lireLaCouverture(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureComplete<MoisCouvert>> {
  try {
    return lectureDeLaCouverture(await requete)
  } catch (erreur) {
    return lectureDeLaCouverture({ data: null, error: erreur })
  }
}

// ── « Ma simulation » sous la case « Banque » ─────────────────────────────────────────────────────────────────────────

/**
 * La simulation s'ouvre-t-elle à cet accès ? Tant que la couverture n'est pas en base (`drapeau` faux), oui, pour tout
 * accès, comme avant P7. Ensuite, seulement avec la case « Banque » : elle se calcule sur les mouvements, que la base ne
 * rend qu'à cette case.
 */
export function simulationOuverte(drapeau: boolean, droitBanque: boolean): boolean {
  return !drapeau || droitBanque
}

/**
 * La case « Banque » telle que la BASE la voit au moment de la lecture (`droits_sur_le_dossier`, étape P1) : seul `true`
 * l'accorde. Les droits d'AuthContext sont lus à la connexion, et l'application installée reste ouverte des jours : une
 * case retirée entre-temps ferait calculer la simulation sur un relevé que la RLS rend vide, sans erreur — un chiffre
 * plausible et faux. Un refus ou une réponse d'une autre forme tombent du côté FERMÉ, avec leur motif.
 */
export function droitBanqueDeLaBase(reponse: ReponseDeLaBase): { banque: boolean; motif: string | null } {
  if (reponse.error) return { banque: false, motif: messageErreur(reponse.error, 'droits illisibles') }
  const droits = reponse.data
  if (droits === null || typeof droits !== 'object' || Array.isArray(droits)) return { banque: false, motif: 'droits illisibles' }
  return { banque: (droits as Record<string, unknown>).banque === true, motif: null }
}

/**
 * La case lue à la base par l'écran : `lireLeDroitBanque(supabase.rpc('droits_sur_le_dossier', { p_dossier_id }))`. Même
 * attente que `lireLaCouverture` ; une requête qui lève FERME, avec son motif.
 */
export async function lireLeDroitBanque(
  requete: PromiseLike<ReponseDeLaBase>,
): Promise<{ banque: boolean; motif: string | null }> {
  try {
    return droitBanqueDeLaBase(await requete)
  } catch (erreur) {
    return droitBanqueDeLaBase({ data: null, error: erreur })
  }
}

// Ce que l'écran dit quand il se tait. On tutoie le client (lib/resteAEnvoyer.ts) ; la phrase dit POURQUOI, et quoi faire.
export const SIMULATION_SANS_BANQUE =
  'Ta simulation se calcule à partir des mouvements de ta banque, et ton cabinet ne t’a pas ouvert ta banque dans ton '
  + 'espace. Pour la voir, demande-lui d’ajouter « Banque » à ton accès.'

export const SIMULATION_BANQUE_INVERIFIABLE =
  'Ton accès à ta banque n’a pas pu être vérifié : ta simulation ne s’affiche pas sans lui. Recharge la page.'
