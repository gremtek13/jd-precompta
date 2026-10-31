import {
  especesDUneFactureSource, refusDeLaCaisse, type EncaissementDeLaCaisse, type EtatDeLaCaisse, type FactureDeLaCaisse,
  type MouvementDeLaCaisse,
} from './caisse'
import type { CaisseLue } from './recettesDeCaisse'
import type { ANouveau } from './types'

// LA CAISSE DANS LA FENÊTRE DES ENCAISSEMENTS (ligne 26.6 ; la relecture de la caisse du 31/10/2026). Retirer, ou
// contre-passer sans mouvement, l'encaissement en espèces d'une facture SOURCE fait sortir ses espèces de la caisse : la
// garde de la caisse (`garder_la_caisse`, supabase/schema/20261030073812_caisse.sql) le refuse en 23514 quand elles ont déjà
// servi — un versement en banque classé sur la caisse, un prélèvement —, sous les mots `retrait_encaissement` ou
// `contre_passation` de `texte_caisse_negative`. Ce déclencheur est DIFFÉRÉ à la fin de la transaction : sans ce module, le
// refus n'arrivait qu'APRÈS le clic. La fenêtre le dit désormais AVANT, comme la fiche d'un mouvement le fait pour un
// versement (`caisseDeLaFiche`, lib/caisseEcran.ts) : la caisse rejouée SANS cet encaissement, ou AVEC sa contre-passation,
// jugée par le module de la caisse (`refusDeLaCaisse`, lib/caisse.ts), qui redit `premier_jour_negatif_de_la_caisse`. Ce module
// ne recopie aucune règle : « ses espèces entrent-elles dans la caisse » est `especesDUneFactureSource`, celle de la base.
//
// QUI REGARDE. Le cabinet lit la caisse — ses opérations, la reprise —, et la fenêtre a déjà lu en entier le relevé, les
// encaissements et les factures du dossier : la caisse se rejoue, ou, une entrée pas lue en entier, le geste est RETENU et
// l'écran le dit (« une lecture partielle ne commande aucune écriture »). Le client « Ventes » ne lit pas la caisse
// (`operations_caisse` et `a_nouveaux` n'ont de policy que pour le cabinet ; CAISSE-Q1, (B)) : une lecture que la RLS refuse
// rend zéro ligne sans erreur, et une caisse rejouée sur du vide mentirait. Comme la frontière d'un exercice validé, qu'il ne
// lit pas non plus (`FRONTIERE_JUGEE_PAR_LA_BASE`), la caisse se dit alors JUGÉE PAR LA BASE : le geste reste offert, et son
// refus éventuel se dira après l'envoi. Le drapeau baissé (`CAISSE_EXPORTEE`), la caisse est ABSENTE : rien de plus qu'hier.
//
// PUR : aucun appel au réseau (la lecture est celle de lib/caisseLecture.ts et lib/caisseDuDossierLecture.ts, faite par la
// fenêtre).

/** Ce que la fenêtre sait de la caisse du dossier. */
export type CaisseDeLaFenetre =
  /** Le drapeau baissé : la table n'est pas en base, rien ne se juge — la fenêtre d'hier. */
  | { etat: 'absente' }
  /** Le client, qui ne lit pas la caisse : la base jugera, et la fenêtre le dit. */
  | { etat: 'jugee_par_la_base' }
  /** Le cabinet, une entrée pas lue en entier (ou pas encore revenue, ou d'un autre dossier) : le geste est retenu. */
  | { etat: 'pas_lue'; motif: string }
  /** Le cabinet, tout lu : la caisse rejouée comme la base la rejoue. */
  | { etat: 'lue'; caisse: EtatDeLaCaisse }

/** La reprise telle que la lecture de la caisse la rend (`lireLaRepriseDeLaCaisse`), nulle quand rien n'a été lu. */
export interface RepriseLue {
  dossierId: string
  lignes: readonly Pick<ANouveau, 'dossier_id' | 'date' | 'compte' | 'sens' | 'montant'>[]
  complete: boolean
  motif: string | null
}

/** Ce que la fenêtre a lu, selon qui regarde. Les trois collections du cabinet sont celles de la fenêtre, lues EN ENTIER. */
export type EntreesDeLaCaisseDeLaFenetre =
  | { espace: 'client'; caisseEnBase: boolean }
  | {
    espace: 'cabinet'
    dossierId: string
    /** Le compte de la caisse DU PLAN du dossier (`modele.plan.caisse`), jamais un 53 deviné. */
    compteCaisse: string
    caisse: CaisseLue
    reprise: RepriseLue | null
    mouvements: readonly MouvementDeLaCaisse[]
    encaissements: readonly EncaissementDeLaCaisse[]
    factures: readonly FactureDeLaCaisse[]
  }

/** La caisse que la fenêtre juge, ou ce qui l'en empêche — chaque entrée de CE dossier, lue en entier. */
export function caisseDeLaFenetre(e: EntreesDeLaCaisseDeLaFenetre): CaisseDeLaFenetre {
  if (e.espace === 'client') return e.caisseEnBase ? { etat: 'jugee_par_la_base' } : { etat: 'absente' }
  if (e.caisse.dossierId !== e.dossierId) return { etat: 'pas_lue', motif: 'la caisse du dossier n’est pas encore lue' }
  if (!e.caisse.enBase) return { etat: 'absente' }
  if (!e.caisse.complete) return { etat: 'pas_lue', motif: `les opérations de la caisse : ${e.caisse.motif ?? 'lecture incomplète'}` }
  if (e.caisse.lignes.some((o) => o.dossier_id !== e.dossierId)) {
    return { etat: 'pas_lue', motif: 'les opérations de la caisse : une ligne rendue n’est pas de ce dossier' }
  }
  if (e.reprise === null || e.reprise.dossierId !== e.dossierId) return { etat: 'pas_lue', motif: 'la reprise du dossier n’est pas encore lue' }
  if (!e.reprise.complete) return { etat: 'pas_lue', motif: `la reprise du dossier : ${e.reprise.motif ?? 'lecture incomplète'}` }
  if (e.reprise.lignes.some((a) => a.dossier_id !== e.dossierId)) {
    return { etat: 'pas_lue', motif: 'la reprise du dossier : une ligne rendue n’est pas de ce dossier' }
  }
  return {
    etat: 'lue',
    caisse: {
      compteCaisse: e.compteCaisse, ouvertures: e.reprise.lignes, operations: e.caisse.lignes, mouvements: e.mouvements,
      encaissements: e.encaissements, factures: e.factures,
    },
  }
}

/** Ce que la caisse dit d'un geste, avant le clic. */
export type JugementDeLaCaisse =
  /** Rien : le geste ne touche pas la caisse, ou elle le permet — la fenêtre d'hier. */
  | { etat: 'permis' }
  /** La base le refuserait : ses mots, le bouton grisé. */
  | { etat: 'refuse'; message: string }
  /** La caisse n'est pas lue en entier : le geste ne part pas, et la fenêtre dit pourquoi. */
  | { etat: 'retenu'; message: string }
  /** Le client : le geste reste offert, et la fenêtre dit que la base le jugera. */
  | { etat: 'juge_par_la_base'; message: string }

export const PERMIS_PAR_LA_CAISSE: JugementDeLaCaisse = { etat: 'permis' }

/** Ce que la fenêtre du CLIENT dit d'un geste qui fait sortir de la caisse des espèces d'une facture : il ne la lit pas. */
export const CAISSE_JUGEE_PAR_LA_BASE = 'Ces espèces sont dans la caisse que tient ton cabinet, qui ne se lit pas d’ici : si '
  + 'elles ont déjà servi, ce geste rendrait la caisse négative, et la base le refusera à l’envoi — son refus se dira ici.'

/** Ce que la fenêtre du cabinet dit d'un tel geste quand la caisse n'est pas lue en entier. */
export function caisseRetenue(motif: string): string {
  return `La caisse du dossier n’est pas lue en entier (${motif}) : ce geste fait sortir des espèces de la caisse, et ne se `
    + 'juge pas sans elle — il ne part pas. Rouvre cette fenêtre.'
}

/** Le geste retient-il le clic ? Refusé par la base, ou retenu faute d'avoir lu la caisse. */
export function retenuParLaCaisse(j: JugementDeLaCaisse): boolean {
  return j.etat === 'refuse' || j.etat === 'retenu'
}

const centimes = (montant: number) => Math.round(montant * 100)

// Un geste qui fait SORTIR ces espèces de la caisse, jugé selon ce que la fenêtre en sait ; `rejouee` donne la caisse après le
// geste.
function juger(
  caisse: CaisseDeLaFenetre, rejouee: (etat: EtatDeLaCaisse) => EtatDeLaCaisse | null,
  geste: 'retrait_encaissement' | 'contre_passation', montantCentimes: number,
): JugementDeLaCaisse {
  if (caisse.etat === 'absente') return PERMIS_PAR_LA_CAISSE
  if (caisse.etat === 'jugee_par_la_base') return { etat: 'juge_par_la_base', message: CAISSE_JUGEE_PAR_LA_BASE }
  if (caisse.etat === 'pas_lue') return { etat: 'retenu', message: caisseRetenue(caisse.motif) }
  const apres = rejouee(caisse.caisse)
  if (apres === null) return PERMIS_PAR_LA_CAISSE
  const refus = refusDeLaCaisse(apres, geste, montantCentimes)
  return refus ? { etat: 'refuse', message: refus.message } : PERMIS_PAR_LA_CAISSE
}

/**
 * LE RETRAIT D'UN ENCAISSEMENT (`retirer_encaissement`) : s'il fait sortir de la caisse des espèces d'une facture source — un
 * encaissement en espèces sans mouvement, positif —, la caisse rejouée SANS lui, sous les mots `retrait_encaissement`. Un
 * encaissement que la caisse ne compte pas (un autre moyen, rattaché à un mouvement, d'une facture qui n'est pas source, déjà
 * retiré), ou dont le retrait lui RENDRAIT des espèces (une contre-passation), ne la touche pas. `lus` : les encaissements et
 * les factures du dossier, tels que la fenêtre les a lus en entier.
 */
export function retraitPourLaCaisse(
  caisse: CaisseDeLaFenetre,
  encaissement: EncaissementDeLaCaisse,
  lus: Pick<EtatDeLaCaisse, 'encaissements' | 'factures'>,
): JugementDeLaCaisse {
  const montant = centimes(encaissement.montant)
  if (caisse.etat === 'absente' || montant <= 0 || !especesDUneFactureSource(encaissement, lus)) return PERMIS_PAR_LA_CAISSE
  return juger(caisse, (etat) => ({
    ...etat,
    // L'instant du retrait n'a pas de valeur ici : la caisse ne lit que « retiré ou non ».
    encaissements: etat.encaissements.map((x) => (x.id === encaissement.id ? { ...x, retire_le: 'maintenant' } : x)),
  }), 'retrait_encaissement', montant)
}

/**
 * LA CONTRE-PASSATION D'UN ENCAISSEMENT (`annuler_encaissement`) : SANS mouvement cité, celle d'un encaissement en espèces
 * sans mouvement d'une facture source entre dans la caisse au jour du décaissement, de montant opposé — elle en fait sortir
 * ces espèces —, sous les mots `contre_passation`. Elle s'écrit du même moyen que l'encaissement, sans mouvement, en
 * l'annulant (`contrePassationDe`) : la règle de la caisse (`especesDUneFactureSource`) dit si elle y entre. Citant un débit,
 * elle n'y entre pas. Sans date encore, rien ne se rejoue : la date se refuse d'abord (`refusContrePassationVente`). Une
 * caisse pas lue en entier retient le geste quelle que soit la date.
 */
export function contrePassationPourLaCaisse(
  caisse: CaisseDeLaFenetre,
  encaissement: EncaissementDeLaCaisse,
  date: string | null,
  ligneBancaireId: string | null,
  lus: Pick<EtatDeLaCaisse, 'encaissements' | 'factures'>,
): JugementDeLaCaisse {
  const montant = centimes(encaissement.montant)
  if (caisse.etat === 'absente' || ligneBancaireId !== null || montant <= 0) return PERMIS_PAR_LA_CAISSE
  const contrePassation = (jour: string): EncaissementDeLaCaisse => ({
    id: `contre-passation-de-${encaissement.id}`, facture_id: encaissement.facture_id, date_encaissement: jour,
    montant: -encaissement.montant, moyen: encaissement.moyen, ligne_bancaire_id: null, annule_id: encaissement.id, retire_le: null,
  })
  const ecrite = contrePassation(date ?? encaissement.date_encaissement)
  if (!especesDUneFactureSource(ecrite, { encaissements: [...lus.encaissements, ecrite], factures: lus.factures })) {
    return PERMIS_PAR_LA_CAISSE
  }
  return juger(caisse, (etat) => (date === null ? null : { ...etat, encaissements: [...etat.encaissements, contrePassation(date)] }),
    'contre_passation', montant)
}
