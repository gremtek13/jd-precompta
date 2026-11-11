import { nomDansUnRefus } from './articles'
import {
  DELAI_CONTACT_MAX_JOURS, EMAIL_CONTACT_MAX, FORME_EMAIL, OBSERVATIONS_CONTACT_MAX, REFUS_ENREGISTREMENT_CONTACT,
} from './contacts'
import { delaiAffiche } from './contactsVue'
import {
  choixDeFicheLiee, estFicheLiee, motsDuRefusDeLaFicheLiee, refusDeLaFicheLiee, saisieDeLaFicheLiee, type ChoixDeFicheLiee,
  type DossierDuClient, type EtatDeLaFicheLiee, type FicheLiee, type IdentiteLue,
} from './fichesLiees'
import { FORME_ADRESSE_ELECTRONIQUE } from './mentionsFacture'
import type { Contact } from './types'

// LA FICHE LIÉE, À L'ÉCRAN (ligne 47, lot LM3 ; le module de la règle : lib/fichesLiees.ts ; la lecture :
// lib/fichesLieesLecture.ts). Ce module est PUR — rien lu, rien écrit, pas d'horloge — et dit ce que la vue « Clients » du
// dossier du cabinet et le choix d'un client dans une facture montrent d'une fiche liée : sa ligne, l'identité que son dossier
// donne AUJOURD'HUI (jamais une copie gardée), les dossiers qu'on peut encore relier, le refus d'une saisie avant le clic et la
// confirmation qui NOMME ce qui part. Rien ne s'en sert tant que `FICHES_LIEES_PREVUES` est baissé. Récit : HISTORIQUE.md,
// « 11/11/2026 — LM3 : LA FICHE LIÉE, À L'ÉCRAN ».

/** Un dossier du cabinet, tel que la liste des dossiers le lit (la RLS : ceux que le compte lit), avec ce dont son identité se
 *  compose (`identiteDuDossier`) : le choix d'un dossier à relier dit, avant le clic, ce que la fiche en lira. */
export interface DossierDuCabinetLu extends DossierDuClient {
  id: string
}

/** Les fiches liées d'une liste de contacts lue en entier, effacées exclues (l'effacement délie : elles n'ont plus de lien). */
export function fichesLieesDuDossier(contacts: readonly Contact[]): FicheLiee[] {
  return contacts
    .filter((c) => estFicheLiee(c) && c.efface_le == null)
    .map((c) => ({
      id: c.id, dossier_client_id: c.dossier_client_id as string, adresse_electronique: c.adresse_electronique, email: c.email,
      delai_paiement_jours: c.delai_paiement_jours, observations: c.observations, retire_le: c.retire_le, efface_le: c.efface_le,
      modifie_le: c.modifie_le,
    }))
}

const ordre = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/**
 * Les dossiers qu'on peut relier : ceux du cabinet que le compte lit, hors du dossier du cabinet, qui n'ont pas encore de fiche
 * — retirées comprises (la base refuserait la seconde, 23505) —, par nom. `fiches` : les lignes du dossier, retirées comprises.
 */
export function dossiersARelier(
  dossiers: readonly DossierDuCabinetLu[], dossierDuCabinetId: string, fiches: readonly Pick<FicheLiee, 'dossier_client_id'>[],
): DossierDuCabinetLu[] {
  const lies = new Set(fiches.map((f) => f.dossier_client_id.toLowerCase()))
  return dossiers
    .filter((d) => d.id.toLowerCase() !== dossierDuCabinetId.toLowerCase() && !lies.has(d.id.toLowerCase()))
    .sort((a, b) => ordre.compare(a.nom, b.nom) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Ce que la ligne d'une fiche dit de son client : l'identité lue, ou que son dossier est parti, ou qu'elle ne s'est pas lue. */
export type LigneDUneFicheLiee =
  | { etat: 'lue'; nom: string; detail: string }
  | { etat: 'dossierParti' }
  | { etat: 'illisible' }

/** La ligne d'une fiche : son identité LUE (`identites_des_fiches_liees`), son type, son SIRET et son délai. */
export function ligneDUneFicheLiee(fiche: FicheLiee, identites: readonly IdentiteLue[]): LigneDUneFicheLiee {
  const choix = choixDeFicheLiee(fiche, identites, '')
  if (choix.etat !== 'choisi') return { etat: choix.etat }
  const { client } = choix
  const delai = delaiAffiche(fiche)
  return {
    etat: 'lue',
    nom: client.tiersNom,
    detail: [
      client.typeClient === 'assujetti' ? 'Entreprise établie en France' : 'Particulier ou autre non-assujetti',
      client.tiersSiret !== '' ? `SIRET ${client.tiersSiret}` : null,
      delai ? `délai ${delai}` : null,
    ].filter((p): p is string => p != null).join(' · '),
  }
}

/** La phrase d'un dossier parti : la fiche reste, elle ne se modifie plus (la base le refuse) et ne remplit aucune facture. */
export const PHRASE_DU_DOSSIER_PARTI = 'Le dossier de ce client n’existe plus dans ce cabinet : sa fiche ne remplit plus de facture '
  + 'et ne se modifie plus. Elle se retire.'

/** La phrase d'une identité que la lecture n'a pas rendue. */
export const PHRASE_DE_L_IDENTITE_ILLISIBLE = 'L’identité de ce client ne s’est pas lue de son dossier : rien ne s’en remplit.'

// ── La saisie ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Les quatre champs que la fiche porte, en texte de champ, et le dossier qu'elle désigne. */
export interface SaisieDeFicheLiee {
  dossierClientId: string
  adresseElectronique: string
  email: string
  delai: string
  observations: string
}

export function saisieInitialeDeFicheLiee(fiche: FicheLiee | null): SaisieDeFicheLiee {
  return {
    dossierClientId: fiche?.dossier_client_id ?? '',
    adresseElectronique: fiche?.adresse_electronique ?? '',
    email: fiche?.email ?? '',
    delai: fiche?.delai_paiement_jours == null ? '' : String(fiche.delai_paiement_jours),
    observations: fiche?.observations ?? '',
  }
}

const motDuContact = (cle: (typeof REFUS_ENREGISTREMENT_CONTACT)[number]['cle']) =>
  (REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === cle) as { modele: string }).modele

const caracteres = (texte: string) => [...texte].length

/**
 * Le premier refus de la saisie d'une fiche liée, dans l'ordre d'`enregistrer_contact` et à ses mots, ou nul : le rang 4 bis
 * (lib/fichesLiees.ts), puis le rang 8 jugé sur le type et le SIREN que le DOSSIER donne (`identite`, lue ; nulle quand le
 * dossier n'est pas encore choisi ou ne s'est pas lu : une adresse électronique ne se juge alors pas, et l'appelant n'offre
 * pas le geste), puis l'e-mail, le délai — sur le TEXTE saisi : un délai illisible se refuse, il ne part jamais nul en silence —
 * et les observations. Une fiche réécrite d'abord : retirée, elle se reprend avant de se modifier.
 */
export function refusDeLaSaisieDeFicheLiee(
  etat: EtatDeLaFicheLiee, saisie: SaisieDeFicheLiee,
  identite: { typeClient: 'assujetti' | 'non_assujetti'; siren: string | null } | null,
  ficheReecrite: Pick<FicheLiee, 'retire_le'> | null,
): string | null {
  if (ficheReecrite != null && ficheReecrite.retire_le != null) return motDuContact('retire')
  if (saisie.dossierClientId === '') return 'Choisir le dossier du client à relier.'
  const lien = refusDeLaFicheLiee(etat, saisie.dossierClientId, false)
  if (lien != null) return motsDuRefusDeLaFicheLiee(lien)
  const part = saisieDeLaFicheLiee(saisie)
  const adresse = part.adresse_electronique
  if (typeof adresse === 'string') {
    if (identite == null) return 'L’identité du dossier ne s’est pas lue : l’adresse de facturation électronique ne se juge pas.'
    if (identite.typeClient !== 'assujetti') return motDuContact('adresse_electronique_type')
    if (!FORME_ADRESSE_ELECTRONIQUE.test(adresse)) return motDuContact('adresse_electronique_forme')
    if (identite.siren != null && adresse.slice(0, 9) !== identite.siren) return motDuContact('adresse_electronique_siren')
  }
  const email = part.email
  if (typeof email === 'string' && (caracteres(email) > EMAIL_CONTACT_MAX || !FORME_EMAIL.test(email))) return motDuContact('email_invalide')
  const delai = saisie.delai.trim()
  if (delai !== '' && (!/^[0-9]+$/.test(delai) || Number(delai) > DELAI_CONTACT_MAX_JOURS)) return motDuContact('delai_invalide')
  const observations = part.observations
  if (typeof observations === 'string' && caracteres(observations) > OBSERVATIONS_CONTACT_MAX) return motDuContact('observations_longues')
  return null
}

/** La confirmation d'une liaison : elle NOMME le dossier relié, ce que la fiche garde, et ce qui ne changera plus. */
export function confirmationDeLaLiaison(nomDuDossier: string, saisie: SaisieDeFicheLiee): { titre: string; garde: string[]; regle: string } {
  const part = saisieDeLaFicheLiee(saisie)
  const garde = [
    typeof part.adresse_electronique === 'string' ? `l’adresse de facturation électronique ${part.adresse_electronique}` : null,
    typeof part.email === 'string' ? `l’e-mail ${part.email}` : null,
    typeof part.delai_paiement_jours === 'number' ? `le délai de paiement de ${delaiAffiche(part as { delai_paiement_jours: number })}` : null,
    typeof part.observations === 'string' ? 'les observations saisies' : null,
  ].filter((p): p is string => p != null)
  return {
    titre: `Relier le dossier « ${nomDansUnRefus(nomDuDossier)} » ?`,
    garde: garde.length > 0 ? garde : ['aucun champ propre à la facturation (ils se complètent ensuite)'],
    regle: 'Son nom, son adresse, son SIRET et son type se liront de son dossier, à chaque facture, jamais recopiés ici. Le lien '
      + 'ne change plus : pour un autre dossier, une autre fiche se crée.',
  }
}

// ── Le choix d'une fiche dans une facture ────────────────────────────────────────────────────────────────────────────
/** Une fiche que le choix d'un client propose : son identité lue et ce qu'elle met dans la facture. */
export interface FicheLieeAChoisir {
  fiche: FicheLiee
  nom: string
  detail: string
  choix: Extract<ChoixDeFicheLiee, { etat: 'choisi' }>
}

/**
 * Les fiches liées qu'une facture peut choisir, et celles qu'elle tait : en cours (jamais une retirée), dont la lecture a rendu
 * l'identité. Un dossier parti ou une identité illisible ne remplit rien : ils se comptent, pour que le choix le dise.
 */
export function fichesLieesAChoisir(
  contacts: readonly Contact[], identites: readonly IdentiteLue[], dateEmission: string,
): { offertes: FicheLieeAChoisir[]; parties: number; illisibles: number } {
  const offertes: FicheLieeAChoisir[] = []
  let parties = 0
  let illisibles = 0
  for (const fiche of fichesLieesDuDossier(contacts)) {
    if (fiche.retire_le != null) continue
    const choix = choixDeFicheLiee(fiche, identites, dateEmission)
    if (choix.etat === 'dossierParti') parties += 1
    else if (choix.etat === 'illisible') illisibles += 1
    else {
      const ligne = ligneDUneFicheLiee(fiche, identites)
      offertes.push({ fiche, nom: choix.client.tiersNom, detail: ligne.etat === 'lue' ? ligne.detail : '', choix })
    }
  }
  offertes.sort((a, b) => ordre.compare(a.nom, b.nom) || (a.fiche.id < b.fiche.id ? -1 : a.fiche.id > b.fiche.id ? 1 : 0))
  return { offertes, parties, illisibles }
}

/** La ligne du choix qui dit les fiches qu'il tait. */
export function ligneDesFichesTues(parties: number, illisibles: number): string | null {
  const morceaux = [
    parties > 0 ? `${parties} ${parties > 1 ? 'fiches dont le dossier est parti' : 'fiche dont le dossier est parti'}` : null,
    illisibles > 0 ? `${illisibles} ${illisibles > 1 ? 'fiches dont l’identité ne s’est pas lue' : 'fiche dont l’identité ne s’est pas lue'}` : null,
  ].filter((p): p is string => p != null)
  return morceaux.length === 0 ? null : `Ne se proposent pas : ${morceaux.join(' et ')}.`
}
