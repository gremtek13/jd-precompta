import type { ComptesDeLAffectation, DestinationDAffectation, OrganeDeLaDecision, OrigineDAffectation } from './affectationDuResultat'
import { COUPLES_ADMIS } from './affectationDuResultat'
import type { DecisionLue, LectureDeLAffectation, LigneDOuvertureLue, LigneDuBrouillonLue } from './affectationEcran'
import { dateAParis } from './format'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireLesSoldesReportes } from './soldesReportesLecture'
import { supabase } from './supabase'

// LA LECTURE DE L'AFFECTATION DU RÉSULTAT (ligne 45, lot AFF4), pour la carte de l'onglet Clôture : tout ce que `lib/
// affectationEcran.ts` juge, lu EN ENTIER, ou rien. Ne rejette jamais : une lecture refusée, partielle, ou qui ne se croit pas
// (une valeur d'un autre type, une version en double, un rôle du plan absent) revient « incomplète », avec son motif — et la
// carte n'offre alors AUCUN geste. Elle ne se lit que drapeau `AFFECTATION_EXPORTEE` levé : les deux tables et la colonne
// `ecritures_brouillon.affectation_id` ne sont en base qu'avec la migration `affectation_du_resultat`.

const ROLES_LUS: readonly (keyof ComptesDeLAffectation)[] = [
  'resultat_benefice', 'resultat_perte', 'reserve_legale', 'reserves_statutaires', 'autres_reserves',
  'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer',
]

/**
 * Les huit comptes que l'affectation écrit, depuis la réponse de `plan_du_dossier` (le plan effectif du dossier, le même que
 * `compte_du_role` rend à la fonction de la base) : un rôle absent, un compte qui n'est pas un texte, un rôle deux fois
 * rendent un MOTIF, jamais un compte par défaut supposé. Les six rôles de l'affectation n'entrent pas dans le catalogue de
 * l'application (`ROLES_COMPTABLES`) : ils se lisent ici, par leur nom, et la forme du compte est jugée par le module.
 * Reçoit la requête, ATTENDUE ici, son erreur lue : une requête qui lève rend un motif.
 */
export async function lireLesComptesDeLAffectation(
  requete: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ comptes: ComptesDeLAffectation; motif: null } | { comptes: null; motif: string }> {
  let reponse: { data: unknown; error: unknown }
  try {
    reponse = await requete
  } catch (e) {
    return { comptes: null, motif: `plan comptable : ${messageErreur(e, 'la lecture a échoué')}` }
  }
  if (reponse.error) return { comptes: null, motif: `plan comptable refusé : ${messageErreur(reponse.error, 'raison inconnue')}` }
  if (!Array.isArray(reponse.data)) return { comptes: null, motif: 'plan comptable illisible' }
  const lus = new Map<string, string>()
  for (const ligne of reponse.data as unknown[]) {
    const champs = ligne !== null && typeof ligne === 'object' ? (ligne as Record<string, unknown>) : null
    if (champs === null || typeof champs.role !== 'string' || typeof champs.compte !== 'string') return { comptes: null, motif: 'plan comptable illisible' }
    if (lus.has(champs.role)) return { comptes: null, motif: `plan comptable illisible : le rôle « ${champs.role} » y paraît deux fois` }
    lus.set(champs.role, champs.compte)
  }
  const absents = ROLES_LUS.filter((r) => !lus.has(r))
  if (absents.length > 0) {
    return { comptes: null, motif: `plan comptable incomplet : ${absents.length} rôle(s) de l’affectation absent(s) (${absents.join(', ')})` }
  }
  return { comptes: Object.fromEntries(ROLES_LUS.map((r) => [r, lus.get(r)!])) as unknown as ComptesDeLAffectation, motif: null }
}

type Ligne = Record<string, unknown>

const estTexte = (v: unknown): v is string => typeof v === 'string'
const estDate = (v: unknown): v is string => estTexte(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)
const estEntier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const ORGANES: readonly OrganeDeLaDecision[] = ['assemblee', 'consultation_ecrite', 'acte_unanime', 'associe_unique']
const ETATS = ['en_vigueur', 'remplacee', 'retiree'] as const

function ouverture(l: Ligne): LigneDOuvertureLue | null {
  if (!estDate(l.date) || !estTexte(l.compte) || (l.sens !== 'debit' && l.sens !== 'credit') || typeof l.montant !== 'number' || !Number.isFinite(l.montant)) return null
  return { date: l.date, compte: l.compte, sens: l.sens, montant: l.montant }
}

function brouillon(l: Ligne): LigneDuBrouillonLue | null {
  const o = ouverture(l)
  if (o === null || !estTexte(l.statut) || !(l.affectation_id === null || estTexte(l.affectation_id))) return null
  return { ...o, statut: l.statut, affectationId: l.affectation_id as string | null }
}

/** Les lignes d'une lecture COMPLÈTE, chacune relue par `lire` : une ligne qui ne se croit pas rend le motif. */
function croire<T>(nom: string, lignes: Ligne[], lire: (l: Ligne) => T | null): { lignes: T[]; motif: null } | { lignes: null; motif: string } {
  const lues: T[] = []
  for (const brute of lignes) {
    const lue = lire(brute)
    if (lue === null) return { lignes: null, motif: `${nom} : une ligne lue ne se croit pas` }
    lues.push(lue)
  }
  return { lignes: lues, motif: null }
}

/**
 * L'affectation d'un exercice, lue en entier : le dossier (forme, capital), ses exercices validés, ses ouvertures et son brouillon
 * depuis le 1er janvier de l'exercice, les versions de la décision et leur répartition, les huit comptes du plan. Drapeau
 * baissé, la carte ne se monte pas et cette lecture ne part jamais.
 */
export async function lireLAffectation(dossierId: string, annee: number): Promise<LectureDeLAffectation> {
  const incomplete = (motif: string): LectureDeLAffectation => ({ dossierId, annee, etat: 'incomplete', motif })
  const debut = `${annee}-01-01`
  try {
    const [dossier, validations, aNouveaux, ecritures, decisions, repartition, reportes, plan] = await Promise.all([
      lireTout<Ligne>((a, b) =>
        supabase.from('dossiers').select('id, forme_juridique, capital', { count: 'exact' }).eq('id', dossierId).order('id').range(a, b)),
      lireTout<Ligne>((a, b) =>
        supabase.from('exercices_valides').select('dossier_id, annee', { count: 'exact' })
          .eq('dossier_id', dossierId).order('dossier_id').order('annee').range(a, b)),
      lireTout<Ligne>((a, b) =>
        supabase.from('a_nouveaux').select('date, compte, sens, montant', { count: 'exact' })
          .eq('dossier_id', dossierId).gte('date', debut).order('date').order('id').range(a, b)),
      lireTout<Ligne>((a, b) =>
        supabase.from('ecritures_brouillon').select('date, compte, sens, montant, statut, affectation_id', { count: 'exact' })
          .eq('dossier_id', dossierId).gte('date', debut).order('date').order('id').range(a, b)),
      lireTout<Ligne>((a, b) =>
        supabase.from('affectations_du_resultat')
          .select('id, version, etat, organe, nombre_d_associes_declare, date_decision, comptes_approuves, date_mise_en_paiement, reserves_statutaires_distribuables, fin_le', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('exercice_affecte', annee).order('version').order('id').range(a, b)),
      lireTout<Ligne>((a, b) =>
        supabase.from('lignes_d_affectation').select('affectation_id, rang, origine, destination, montant_centimes', { count: 'exact' })
          .eq('dossier_id', dossierId).order('affectation_id').order('rang').range(a, b)),
      lireLesSoldesReportes(dossierId),
      lireLesComptesDeLAffectation(supabase.rpc('plan_du_dossier', { p_dossier_id: dossierId })),
    ])
    if (!dossier.complete) return incomplete(`le dossier : ${dossier.motif}`)
    if (!validations.complete) return incomplete(`les exercices validés : ${validations.motif}`)
    if (!aNouveaux.complete) return incomplete(`les à-nouveaux : ${aNouveaux.motif}`)
    if (!ecritures.complete) return incomplete(`le brouillon des écritures : ${ecritures.motif}`)
    if (!decisions.complete) return incomplete(`les décisions : ${decisions.motif}`)
    if (!repartition.complete) return incomplete(`les lignes des décisions : ${repartition.motif}`)
    if (!reportes.complete) return incomplete(`les soldes reportés : ${reportes.motif}`)
    if (plan.comptes === null) return incomplete(plan.motif)
    const anneesLues = croire('les exercices validés', validations.lignes, (l) => (estEntier(l.annee) ? l.annee : null))
    const aNouveauxLus = croire('les à-nouveaux', aNouveaux.lignes, ouverture)
    const ecrituresLues = croire('le brouillon des écritures', ecritures.lignes, brouillon)
    const reportesLus = croire('les soldes reportés', reportes.lignes as unknown as Ligne[], ouverture)
    if (anneesLues.lignes === null) return incomplete(anneesLues.motif)
    if (aNouveauxLus.lignes === null) return incomplete(aNouveauxLus.motif)
    if (ecrituresLues.lignes === null) return incomplete(ecrituresLues.motif)
    if (reportesLus.lignes === null) return incomplete(reportesLus.motif)

    if (dossier.lignes.length !== 1) return incomplete('le dossier : une ligne attendue, la lecture n’en rend pas une')
    const d = dossier.lignes[0]
    const forme = d.forme_juridique
    if (!(forme === null || estTexte(forme))) return incomplete('le dossier : la forme juridique ne se croit pas')
    const capital = d.capital
    if (!(capital === null || (typeof capital === 'number' && Number.isFinite(capital)))) return incomplete('le dossier : le capital ne se croit pas')

    const lignesParDecision = new Map<string, { rang: number; ligne: { origine: OrigineDAffectation; destination: DestinationDAffectation; centimes: number } }[]>()
    for (const l of repartition.lignes) {
      const origine = l.origine as OrigineDAffectation
      const destination = l.destination as DestinationDAffectation
      if (!estTexte(l.affectation_id) || !estEntier(l.rang) || !estEntier(l.montant_centimes) || l.montant_centimes <= 0
        || !(origine in COUPLES_ADMIS) || !COUPLES_ADMIS[origine].includes(destination)) {
        return incomplete('les lignes des décisions : une ligne lue ne se croit pas')
      }
      const liste = lignesParDecision.get(l.affectation_id) ?? []
      liste.push({ rang: l.rang, ligne: { origine, destination, centimes: l.montant_centimes } })
      lignesParDecision.set(l.affectation_id, liste)
    }
    const versions: DecisionLue[] = []
    for (const a of decisions.lignes) {
      const fin = a.fin_le
      if (!estTexte(a.id) || !estEntier(a.version) || !(ETATS as readonly unknown[]).includes(a.etat)
        || !(ORGANES as readonly unknown[]).includes(a.organe) || (a.nombre_d_associes_declare !== 'un' && a.nombre_d_associes_declare !== 'plusieurs')
        || !estDate(a.date_decision) || typeof a.comptes_approuves !== 'boolean' || !(a.date_mise_en_paiement === null || estDate(a.date_mise_en_paiement))
        || typeof a.reserves_statutaires_distribuables !== 'boolean' || !(fin === null || (estTexte(fin) && !Number.isNaN(Date.parse(fin))))) {
        return incomplete('les décisions : une ligne lue ne se croit pas')
      }
      if (versions.some((v) => v.version === a.version)) return incomplete(`les décisions : deux fois la version ${a.version}`)
      versions.push({
        id: a.id, version: a.version, etat: a.etat as DecisionLue['etat'], organe: a.organe as OrganeDeLaDecision,
        nombreDAssocies: a.nombre_d_associes_declare, dateDecision: a.date_decision, comptesApprouves: a.comptes_approuves,
        dateMiseEnPaiement: a.date_mise_en_paiement as string | null, reservesStatutairesDistribuables: a.reserves_statutaires_distribuables,
        lignes: (lignesParDecision.get(a.id) ?? []).sort((x, y) => x.rang - y.rang).map((x) => x.ligne),
        finLe: fin === null ? null : dateAParis(fin as string),
      })
    }
    versions.sort((x, y) => x.version - y.version)
    if (versions.filter((v) => v.etat === 'en_vigueur').length > 1) return incomplete('les décisions : deux décisions en vigueur pour le même exercice')

    return {
      dossierId, annee, etat: 'lue',
      formeJuridique: forme as string | null,
      capitalCentimes: capital === null ? null : Math.round((capital as number) * 100),
      comptes: plan.comptes,
      anneesValidees: anneesLues.lignes,
      brouillon: ecrituresLues.lignes,
      reportes: reportesLus.lignes,
      aNouveaux: aNouveauxLus.lignes,
      decisions: versions,
    }
  } catch (e) {
    return incomplete(messageErreur(e, 'la lecture de l’affectation a échoué'))
  }
}
