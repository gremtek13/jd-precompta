import {
  BLANCS, DERNIER_JOUR, MAILLES_ADRESSE, PLATEFORME_MAX, PREMIER_JOUR, VERIFICATIONS, aLaFormeDeSaMaille, estUnJourCivil,
} from './adressesReception'
import { formatDate } from './format'
import type { EtatFactureElectroniqueLu, FormeAdresseReception, VerificationAdresseReception } from './types'

// L'ÉTAT DE LA FACTURE ÉLECTRONIQUE D'UN DOSSIER (espace client, étape A6a ; conception : HISTORIQUE.md, « L'ESPACE
// CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6, recommandation (b)). Un module
// PUR, que l'encart de l'étape A6b lira : la valeur que rend `etat_facture_electronique` — la plateforme agréée du client et
// Super PDP, reliés ou non, leur nom et leurs dates, l'adresse de réception COURANTE —, LUE SANS RIEN DEVINER ; puis l'état
// que l'encart dit : « active », ou « à compléter » et ce qui manque, NOMMÉ.
//
// CE QUE LA FONCTION NE REND JAMAIS, et que ce module n'attend donc pas : une adresse de connexion, un identifiant, un
// secret, une organisation, une portée — ni leur longueur, ni leur empreinte —, le point de reprise de la réception, qui a
// relié la plateforme. `connexions_plateformes` et `superpdp_credentials` n'ont aucune policy : la fonction les lit pour
// le cabinet et le client « Ventes » et n'en rend que des booléens, un nom et des dates. Une clé de plus, de moins, ou
// d'une autre forme rend la valeur ILLISIBLE : jamais un état — l'encart ne dirait « active » ni « à compléter » d'une
// réponse qu'il ne sait pas lire. etatFactureElectronique.test.ts confronte ces clés à l'essai
// supabase/essais/etatFactureElectronique.sql et, la migration exportée, au texte même de la fonction.
//
// « EN VIGUEUR » se juge au jour de PARIS, que l'appelant DONNE (`aujourdHuiAParis`, lib/format.ts) : aucune horloge ici.
// Seule l'adresse COURANTE compte — la dernière déclarée ; une adresse qui prend effet plus tard se dit « à venir », même
// si une version d'avant reçoit encore jusque-là (A6-Q2, tranchée par le cabinet le 14/10/2026).

/** Les clés que la fonction rend, à chaque niveau, dans l'ordre de son texte. */
export const CLES_DE_L_ETAT = {
  racine: ['plateforme', 'superpdp', 'adresse'],
  plateforme: ['reliee', 'nom', 'creee_le', 'derniere_recuperation', 'statuts_lus_le'],
  superpdp: ['relie', 'depuis'],
  adresse: ['id', 'forme', 'identifiant', 'plateforme', 'prise_effet', 'verification', 'verifiee_le', 'auteur', 'cree_le'],
} as const

// Un instant tel que Postgres l'écrit en JSON (`to_jsonb` d'un timestamptz) : la date, l'heure, des fractions de seconde
// éventuelles, le décalage du fuseau de la session.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:\d{2}(:\d{2})?|Z)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const estUnInstant = (v: unknown): v is string => typeof v === 'string' && INSTANT.test(v) && !Number.isNaN(Date.parse(v))
const instantOuNul = (v: unknown): v is string | null => v === null || estUnInstant(v)
// Un jour que la table admet (G1.36) : une date civile entre 2000 et 2099.
const jourDeLaTable = (v: unknown): v is string => typeof v === 'string' && estUnJourCivil(v) && v >= PREMIER_JOUR && v <= DERNIER_JOUR
// Un nom de plateforme que la table admet : pas fait des seuls blancs qu'elle retire, 99 caractères au plus.
const BLANCS_SEULS = new RegExp(`^[${BLANCS}]*$`)
const nomDeLaTable = (v: unknown): v is string =>
  typeof v === 'string' && !BLANCS_SEULS.test(v) && Array.from(v).length <= PLATEFORME_MAX
// Exactement ces clés, ni plus ni moins.
const exactement = (o: Record<string, unknown>, cles: readonly string[]) =>
  Object.keys(o).length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c))

/**
 * La valeur rendue par `etat_facture_electronique`, lue sans rien deviner : chaque clé là, aucune de plus, chacune de sa
 * forme, et cohérente — une connexion non reliée n'a ni nom ni date, une reliée a sa date de création ; une adresse a la
 * forme de sa maille, et un jour de vérification si et seulement si elle a été vérifiée. Toute autre valeur : `null`
 * (illisible).
 */
export function lireEtatFactureElectronique(rendu: unknown): EtatFactureElectroniqueLu | null {
  if (!estObjet(rendu) || !exactement(rendu, CLES_DE_L_ETAT.racine)) return null
  const { plateforme, superpdp, adresse } = rendu
  if (!estObjet(plateforme) || !exactement(plateforme, CLES_DE_L_ETAT.plateforme)) return null
  if (!estObjet(superpdp) || !exactement(superpdp, CLES_DE_L_ETAT.superpdp)) return null

  const { reliee, nom, creee_le: creeeLe, derniere_recuperation: derniere, statuts_lus_le: statuts } = plateforme
  if (typeof reliee !== 'boolean') return null
  if (reliee) {
    if (typeof nom !== 'string' || !estUnInstant(creeeLe) || !instantOuNul(derniere) || !instantOuNul(statuts)) return null
  } else if (nom !== null || creeeLe !== null || derniere !== null || statuts !== null) {
    return null
  }
  const { relie, depuis } = superpdp
  if (typeof relie !== 'boolean' || (relie ? !estUnInstant(depuis) : depuis !== null)) return null

  let adresseLue: EtatFactureElectroniqueLu['adresse'] = null
  if (adresse !== null) {
    if (!estObjet(adresse) || !exactement(adresse, CLES_DE_L_ETAT.adresse)) return null
    const a = adresse
    const forme = MAILLES_ADRESSE.find((m) => m.forme === a.forme)?.forme
    if (!forme || typeof a.identifiant !== 'string' || !aLaFormeDeSaMaille(forme, a.identifiant)) return null
    if (typeof a.id !== 'string' || !UUID.test(a.id) || typeof a.auteur !== 'string' || !UUID.test(a.auteur)) return null
    if (!nomDeLaTable(a.plateforme) || !jourDeLaTable(a.prise_effet)) return null
    if (!VERIFICATIONS.includes(a.verification as VerificationAdresseReception)) return null
    const verifiee = a.verifiee_le
    if (a.verification === 'declaration' ? verifiee !== null : !jourDeLaTable(verifiee)) return null
    if (!estUnInstant(a.cree_le)) return null
    adresseLue = {
      id: a.id, forme: forme as FormeAdresseReception, identifiant: a.identifiant, plateforme: a.plateforme,
      prise_effet: a.prise_effet, verification: a.verification as VerificationAdresseReception,
      verifiee_le: verifiee as string | null, auteur: a.auteur, cree_le: a.cree_le,
    }
  }
  return {
    plateforme: { reliee, nom: nom as string | null, creee_le: creeeLe as string | null, derniere_recuperation: derniere as string | null,
      statuts_lus_le: statuts as string | null },
    superpdp: { relie, depuis: depuis as string | null },
    adresse: adresseLue,
  }
}

// ── L'état que l'encart dit ─────────────────────────────────────────────────────────────────────────────────────────
// « Active » quand une plateforme agréée OU Super PDP est reliée ET qu'une adresse de réception est déclarée, en vigueur
// au jour de Paris ; sinon « à compléter », et ce qui manque, NOMMÉ (conception, §A.6). Une adresse déclarée sans
// vérification compte (A6-Q3, tranchée par le cabinet le 14/10/2026) : l'encart dira qu'elle n'est pas vérifiée. Les
// libellés ne parlent ni comme le cabinet ni comme le client : l'écran de chaque espace les reprend (étape A6b).

export type CleManque = 'aucune_plateforme' | 'aucune_adresse' | 'adresse_a_venir'

export interface Manque {
  cle: CleManque
  libelle: string
}

export type EtatDeLaFactureElectronique =
  | { etat: 'active'; reliees: ('plateforme_agreee' | 'superpdp')[]; adresse: NonNullable<EtatFactureElectroniqueLu['adresse']> }
  | { etat: 'a_completer'; manque: Manque[] }

/** L'état de la facture électronique au jour donné (AAAA-MM-JJ, à Paris), depuis la valeur LUE. */
export function etatDeLaFactureElectronique(lu: EtatFactureElectroniqueLu, aujourdhui: string): EtatDeLaFactureElectronique {
  if (!estUnJourCivil(aujourdhui)) throw new Error(`Aujourd’hui n'est pas une date civile AAAA-MM-JJ : ${aujourdhui}`)
  const reliees: ('plateforme_agreee' | 'superpdp')[] = []
  if (lu.plateforme.reliee) reliees.push('plateforme_agreee')
  if (lu.superpdp.relie) reliees.push('superpdp')
  const manque: Manque[] = []
  if (reliees.length === 0) {
    manque.push({ cle: 'aucune_plateforme', libelle: 'aucune plateforme de réception reliée (plateforme agréée ou Super PDP)' })
  }
  if (lu.adresse === null) {
    manque.push({ cle: 'aucune_adresse', libelle: 'aucune adresse de réception déclarée' })
  } else if (lu.adresse.prise_effet > aujourdhui) {
    manque.push({
      cle: 'adresse_a_venir',
      libelle: `l’adresse de réception déclarée ne prend effet que le ${formatDate(lu.adresse.prise_effet)}`,
    })
  }
  return manque.length === 0 && lu.adresse !== null ? { etat: 'active', reliees, adresse: lu.adresse } : { etat: 'a_completer', manque }
}
