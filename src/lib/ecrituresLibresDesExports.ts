// L'ÉCRITURE LIBRE DANS LES EXPORTS (EL3 ; conception docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md, § 3.6,
// § 5.6, § 5.7). Pur, sans réseau et sans import de `supabase.ts` : ce que le FEC (lib/fec.ts, la sorte `libre`), la piste
// d'audit (lib/pisteAudit.ts) et l'état des écritures libres (lib/etatDesEcrituresLibres.ts) lisent d'une écriture libre.
//
// Rien ne se lit ici : l'appelant passe les écritures libres du dossier LUES EN ENTIER, ou leur absence. Le drapeau
// `ECRITURES_LIBRES_PREVUES` (lib/ecritureLibre.ts) baissé, la migration EL2 n'est pas en base, aucune ligne du brouillon ne
// porte `ecriture_libre_id`, et les exports reçoivent `ECRITURES_LIBRES_ABSENTES` : ils sont ceux d'hier à l'octet.
//
// Ce que ces types ne portent JAMAIS : le MOTIF (la justification de l'expert, imprimée sur l'état seul, jamais au FEC ni à la
// piste d'audit ; EL-Q7 (A), EL-Q8 (A)). Une donnée qu'on ne lit pas ne peut pas fuir (RGPD.md, la minimisation) : le FEC et la
// piste reçoivent `EcritureLibreDesExports`, sans lui ; l'état seul reçoit `EcritureLibreDeLEtat`.

/** Une ligne telle que la base la garde dans `ecritures_libres.lignes` (migration EL2, le commentaire de la colonne). */
export interface LigneEnBaseDEcritureLibre {
  compte: string
  sens: 'debit' | 'credit'
  centimes: number
  // En trésorerie, sur une ligne de classe 6 ou 7 : le poste de la 2035 sous lequel elle compte, ou nul (hors de la 2035).
  poste_2035: string | null
  // Le libellé d'un compte que l'application ne nomme pas, saisi par l'expert ; nul sinon.
  compte_lib: string | null
}

/** Une écriture libre telle que les exports la lisent : les colonnes de la table, SANS le motif. */
export interface EcritureLibreDesExports {
  id: string
  dossier_id: string
  exercice: number
  numero: number
  date: string
  libelle: string
  lignes: readonly LigneEnBaseDEcritureLibre[]
  avec_extourne: boolean
  piece_citee_id: string | null
  version: number
  cree_par: string
  cree_le: string
  modifie_par: string | null
  modifie_le: string | null
  // L'écriture libre qu'elle contre-passe (EL7, migration `contre_passation_des_ecritures_libres`, préparée) : FACULTATIVE, et
  // c'est la vérité des deux côtés de la migration — la colonne n'est lue que son drapeau levé
  // (`CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE`, lib/contrePassationDesEcrituresLibres.ts) ; nulle sur toute autre écriture.
  // Aucun export ni moteur ne la lit : une contre-passation est une écriture libre ordinaire (contrePassationDansLesMoteurs.test.ts).
  contre_passe_id?: string | null
}

/** Une écriture libre telle que l'état la lit : le motif en plus, pour lui seul. */
export interface EcritureLibreDeLEtat extends EcritureLibreDesExports {
  motif: string
}

/**
 * Ce que les exports reçoivent, SANS VALEUR PAR DÉFAUT chez l'appelant qui les lit : `absentes` — la table n'est pas en base
 * (le drapeau baissé), rien n'est lu ni dit — ou `lues`, en entier, avec, pour la piste d'audit, l'adresse de chaque compte du
 * cabinet qui a écrit une version (lue de `cabinet_admins` sous la session de qui exporte, le patron de P1TQ2Q1-Q1) ; un
 * compte que la carte ne rend pas se dit « le cabinet », jamais deviné. Une lecture partielle ne se passe pas : elle refuse
 * l'export, comme la caisse.
 */
export type EcrituresLibresDesExports =
  | { etat: 'absentes' }
  | { etat: 'lues'; ecritures: readonly EcritureLibreDesExports[]; auteurs: ReadonlyMap<string, string> }

/** La table n'est pas en base (le drapeau baissé) : aucune écriture libre, et les exports d'hier. */
export const ECRITURES_LIBRES_ABSENTES: EcrituresLibresDesExports = { etat: 'absentes' }

/** Les écritures libres lues, par identifiant ; vide quand elles sont absentes. */
export function indexDesEcrituresLibres(e: EcrituresLibresDesExports): ReadonlyMap<string, EcritureLibreDesExports> {
  return e.etat === 'lues' ? new Map(e.ecritures.map((x) => [x.id, x])) : new Map()
}

/** La longueur du numéro dans la référence : « EL2026-0001 » (conception, § 3.6, EL-Q8 (A)). */
export const CHIFFRES_DU_NUMERO = 4

/**
 * La pièce d'une écriture libre au FEC (PieceRef) et dans la piste d'audit : l'ÉTAT DES ÉCRITURES LIBRES de son exercice, sous
 * « EL<année>-<numéro sur quatre chiffres> » — pour son extourne du 1er janvier suivant aussi, qui appartient à la même
 * écriture (le patron de « Inventaire AAAA »). Un numéro au-delà de 9999 garde tous ses chiffres.
 */
export function referenceDeLEcritureLibre(e: Pick<EcritureLibreDesExports, 'exercice' | 'numero'>): string {
  return `EL${e.exercice}-${String(e.numero).padStart(CHIFFRES_DU_NUMERO, '0')}`
}

/**
 * Le poste de la 2035 d'une ligne du brouillon d'une écriture libre : celui de la ligne saisie de même compte et de même sens
 * à la date de l'écriture, de sens inverse à la date de son extourne. Deux lignes saisies qui répondent sous deux postes
 * différents n'en disent aucun (la ligne du brouillon n'en porte qu'un, et on ne choisit pas — la règle d'une part ventilée).
 * Nul : hors de la 2035, ou une ligne de bilan ; le FEC n'écrit le poste que sur une ligne de charge ou de produit, et
 * seulement de son cadre (`natOpDeLaLigne`).
 */
export function posteDeLaLigneLibre(
  ecriture: Pick<EcritureLibreDesExports, 'date' | 'lignes'>, ligne: { date: string; compte: string; sens: 'debit' | 'credit' },
): string | null {
  const sens = ligne.date === ecriture.date ? ligne.sens : ligne.sens === 'debit' ? 'credit' : 'debit'
  const postes = new Set(ecriture.lignes.filter((l) => l.compte === ligne.compte && l.sens === sens).map((l) => l.poste_2035))
  if (postes.size !== 1) return null
  return [...postes][0]
}

/**
 * Le libellé saisi de chaque compte que l'application ne nomme que par son numéro (conception, § 3.4) : le premier dans
 * l'ordre des écritures (exercice, numéro) et de leurs lignes. La base refuse deux libellés pour un même compte dans une
 * écriture ; deux écritures qui en diraient deux, le FEC n'en garde qu'un — un même CompteNum ne porte qu'un CompteLib.
 */
export function libellesSaisisDesComptes(e: EcrituresLibresDesExports): ReadonlyMap<string, string> {
  const libelles = new Map<string, string>()
  if (e.etat !== 'lues') return libelles
  const ordonnees = [...e.ecritures].sort((a, b) => a.exercice - b.exercice || a.numero - b.numero || a.id.localeCompare(b.id))
  for (const x of ordonnees) {
    for (const l of x.lignes) {
      const lib = l.compte_lib?.trim() ?? ''
      if (lib !== '' && !libelles.has(l.compte)) libelles.set(l.compte, lib)
    }
  }
  return libelles
}

/** Qui a écrit la dernière version : son adresse lue, sinon « le cabinet » — jamais un identifiant. */
export function auteurDeLaVersion(
  e: Pick<EcritureLibreDesExports, 'cree_par' | 'modifie_par'>, auteurs: ReadonlyMap<string, string>,
): string {
  return auteurs.get(e.modifie_par ?? e.cree_par) ?? 'le cabinet'
}

/** L'instant de la dernière version : sa modification, sinon sa création. */
export function instantDeLaVersion(e: Pick<EcritureLibreDesExports, 'cree_le' | 'modifie_le'>): string {
  return e.modifie_le ?? e.cree_le
}
