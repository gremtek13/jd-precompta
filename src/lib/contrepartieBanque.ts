import { supabase } from './supabase'
import { estContrepartieCaisse, ligneContrepartieBanque } from './ecritures'
import { lignesReglementEngagement, type ModeleComptable } from './engagement'
import { dateLocaleDe } from './format'
import { PAIEMENT_PAR_LA_CAISSE_EXPORTE } from './paiementParLaCaisse'
import type { PlanComptable } from './planComptable'
import { partsDesPaiements, type PaiementParLeReleve } from './rattachement'
import type { Piece } from './types'

// Les comptes qu'une note de frais porte sans que ce soit sa CHARGE : la banque d'un paiement, sa TVA, et la
// contrepartie au compte de l'exploitant — ceux du PLAN du dossier.
function comptesHorsCharge(plan: PlanComptable): ReadonlySet<string> {
  return new Set([plan.banque, plan.exploitant, plan.tva_deductible, plan.tva_immobilisations])
}

// Les deux seules opérations d'écritures qui parlent à Supabase, tenues à l'écart de `ecritures.ts`
// pour que celui-ci reste purement calculatoire. Ce n'est pas qu'une question de rangement : un
// module qui importe le client Supabase lève au chargement quand les variables d'environnement
// manquent, ce qui rendait tout le cœur comptable — soldes, contrôle débit = crédit, balance —
// impossible à exécuter en test. Même raison que pour `comptes.ts` (voir son en-tête).

// Palier 5+ — vraie partie double. Une écriture générée depuis une pièce (voir EcrituresTab) n'a
// jusqu'ici qu'une moitié : la charge/le produit (+ la TVA le cas échéant), jamais la contrepartie
// banque — donc jamais un débit=crédit exploitable tel quel par un logiciel de comptabilité. Cette
// fonction ajoute cette contrepartie dès qu'on connaît le mouvement bancaire réel (le rapprochement),
// avec le montant réel du mouvement (celui de la pièce peut différer d'un centime — frais bancaires,
// arrondi...) et son sens déduit du signe de ce même mouvement — jamais du type de la pièce (achat/
// vente) : un compte banque est un compte d'actif, une entrée d'argent (montant positif) l'augmente
// donc au débit, une sortie (négatif) le diminue au crédit, quel que soit le type de la pièce en face.
// Déduire le sens du type de pièce fonctionne pour le cas normal (une vente encaissée, un achat payé)
// mais se trompe dès que le mouvement réel va dans l'autre sens que prévu (un remboursement, un avoir
// réglé) — dépendre du signe réel évite ce piège. Best-effort et idempotente : appelée aussi bien
// depuis un rapprochement (Banque) que depuis une génération d'écritures sur une pièce déjà
// rapprochée (Écritures) — sans jamais dupliquer la ligne si elle existe déjà.
//
// Les deux fonctions lèvent si la base refuse l'écriture, plutôt que de rendre la main comme si de
// rien n'était. Ce sont des écritures comptables : leur absence ne se voit qu'indirectement, une
// pièce comptée « en attente de rapprochement bancaire » dans la Checklist sans qu'on sache que
// l'écriture a en réalité été refusée. BanqueTab vérifiait déjà l'erreur du rapprochement lui-même
// avant d'enchaîner ici (voir son commentaire) ; le contrôle s'arrêtait à cette frontière.
//
// EN ENGAGEMENT (lib/engagement.ts), le rapprochement écrit le RÈGLEMENT de la pièce : le compte de
// tiers contre la banque, à la date du mouvement. Rien n'y est redaté — la facture reste à sa date,
// c'est tout l'objet de ce modèle. Sans valeur par défaut pour le modèle : appelée en trésorerie sur un
// dossier en engagement, elle redaterait sa facture au paiement.
//
// `paiement` : le mouvement entier d'un rapprochement simple, ou la PART d'un virement qui règle
// plusieurs pièces (lib/reglementGroupe.ts) — la contrepartie porte ce qu'il paie de CETTE pièce.
//
// LES COMPTES SONT CEUX DU PLAN DU DOSSIER, que le modèle porte (lib/planComptable.ts) : la banque qu'elle écrit, et
// celles qu'elle RETROUVE — la banque d'un autre paiement, le compte de l'exploitant d'une note de frais, la dette d'un
// bien. Retrouvées sur un numéro par défaut, dans un dossier qui en tient un autre, elles se tairaient : la
// contrepartie de l'exploitant ne serait jamais retirée, et la pièce resterait redatée à tort.
//
// UN PAIEMENT PAR LE RELEVÉ SEULEMENT (le type le dit) : celui de la caisse (étape C9a) n'a pas de mouvement, et sa
// contrepartie s'écrit avec les écritures de sa pièce, par la génération et « Régénérer » (`lignesPourPiece`). Ici, une
// pièce déjà payée par la caisse est une pièce qu'un AUTRE paiement règle : ses lignes ne se redatent pas, et le contrôle
// des écritures demande « Régénérer », qui les répartit entre les deux moyens. Et la ligne d'une opération de caisse ne se
// redate jamais : la garde du brouillon refuse de la modifier (`garder_ecriture_de_caisse`), et la refuser emporterait la
// redate de toute la pièce. Tant que la migration n'est pas en base (`PAIEMENT_PAR_LA_CAISSE_EXPORTE` baissé), aucune ligne
// ne cite à la fois une pièce et une opération de caisse — la garde d'aujourd'hui le refuse : rien à écarter, et les
// requêtes sont celles d'hier, filtre pour filtre (contrepartieBanque.test.ts joue les deux états).
export async function synchroniserContrepartieBanque(
  dossierId: string, piece: Piece, paiement: Pick<PaiementParLeReleve, 'id' | 'date' | 'montant'>, modele: ModeleComptable,
) {
  const { plan } = modele
  const { data: existantes, error: lectureError } = await supabase
    .from('ecritures_brouillon')
    .select('id, compte, ligne_bancaire_id, piece_id, operation_caisse_id')
    .eq('piece_id', piece.id)
  if (lectureError) throw lectureError
  if (modele.mode === 'engagement') {
    // Même garde qu'en trésorerie : rien tant que la facture n'est pas générée — la génération écrira
    // la facture ET ses règlements. Et idempotente PAR MOUVEMENT, non par pièce : une pièce payée en
    // plusieurs fois reçoit un règlement par paiement, et un second passage n'en double aucun.
    if (!existantes || !existantes.some((e) => !e.ligne_bancaire_id)) return
    if (existantes.some((e) => e.ligne_bancaire_id === paiement.id)) return
    // Le règlement solde le compte de tiers que la FACTURE a crédité : 404000 pour la facture d'un bien
    // immobilisé, que l'écriture générée porte déjà — le lire là évite de relire le registre ici, et un
    // règlement au 401 laisserait au 404 une dette payée.
    const immobilisation = existantes.some((e) => !e.ligne_bancaire_id && e.compte === plan.fournisseurs_immobilisations)
    const reglement = lignesReglementEngagement(dossierId, piece, paiement, modele.compteNotesDeFrais, immobilisation, plan)
    if (reglement.length === 0) return
    const { error } = await supabase.from('ecritures_brouillon').insert(reglement)
    if (error) throw error
    return
  }
  // Rien à faire tant que la pièce n'a pas encore sa ligne de charge/produit (catégorie sans compte
  // comptable, ou "Générer les écritures" pas encore lancé) — la contrepartie viendra d'elle-même au
  // prochain passage. À distinguer d'une lecture en échec, ci-dessus : sans ce contrôle, une lecture
  // refusée rendait `existantes` nul et ressemblait à « pas encore d'écriture », donc à un abandon
  // silencieux et légitime.
  if (!existantes || existantes.length === 0) return
  // IDEMPOTENTE PAR MOUVEMENT, et non plus par pièce : elle sortait dès que la pièce portait UNE
  // contrepartie, donc une pièce payée en deux fois — un acompte puis un virement groupé — ne recevait
  // jamais la seconde, et son écriture restait déséquilibrée.
  if (existantes.some((e) => e.compte === plan.banque && e.ligne_bancaire_id === paiement.id)) return
  const contrepartie = ligneContrepartieBanque(dossierId, piece, paiement, plan)
  if (!contrepartie) return

  // L'ÉCRITURE PASSE À LA DATE DU PAIEMENT, comme la 2035 compte la pièce (lib/rattachement.ts) :
  // générée avant le rapprochement, elle portait la date de facture, et une facture de décembre
  // réglée en janvier aurait gardé sa charge dans l'exercice d'avant. Seulement quand CE paiement
  // RÈGLE la pièce à lui seul, et qu'aucun autre ne la paie déjà : un paiement partiel, ou le second
  // d'une pièce payée en plusieurs fois, laisse les lignes où elles sont, et le contrôle des écritures
  // demande alors « Régénérer », qui les répartit entre les paiements et la facture.
  //
  // AVANT la contrepartie, et c'est l'ordre qui garde les messages vrais : si la date échoue, rien
  // n'est écrit ; si la contrepartie échoue ensuite, l'écriture est à la bonne date et l'appelant dit
  // bien que la contrepartie n'a pas été créée.
  const autrePaiement = existantes.some((e) => e.compte === plan.banque || estContrepartieCaisse(e))
  if (!autrePaiement && partsDesPaiements(piece, [paiement]).reste === 0) {
    // Une NOTE DE FRAIS que ce virement rembourse en entier n'est plus due au dirigeant : sa contrepartie au compte
    // de l'exploitant (`ligneContrepartieDirigeant`) part AVANT la redate — redatée, elle resterait à côté de la
    // banque, et l'écriture compterait deux fois ce que la banque paie déjà. Un remboursement partiel la laisse en
    // place, comme la charge : le contrôle des écritures demande alors « Régénérer », qui la recalcule. Seulement
    // quand la charge est AILLEURS : rangée dans une catégorie au 108000, la note y porte sa charge et n'a pas de
    // contrepartie à part (`estContrepartieDirigeant`) — la retirer effacerait la dépense.
    const horsCharge = comptesHorsCharge(plan)
    const chargeAilleurs = existantes.some((e) => !horsCharge.has(e.compte))
    if (piece.type_piece === 'note_frais' && chargeAilleurs && existantes.some((e) => e.compte === plan.exploitant)) {
      const { error: dirigeantError } = await supabase.from('ecritures_brouillon')
        .delete().eq('piece_id', piece.id).eq('compte', plan.exploitant)
      if (dirigeantError) throw dirigeantError
    }
    const redate = supabase.from('ecritures_brouillon')
      .update({ date: paiement.date }).eq('piece_id', piece.id).neq('compte', plan.banque)
    const { error: dateError } = await (PAIEMENT_PAR_LA_CAISSE_EXPORTE ? redate.is('operation_caisse_id', null) : redate)
    if (dateError) throw dateError
  }

  const { error } = await supabase.from('ecritures_brouillon').insert(contrepartie)
  if (error) throw error
}

// Retire la contrepartie banque d'une pièce — appelée quand un rapprochement est annulé, sinon la
// ligne banque resterait affichée comme si le mouvement était toujours rapproché. Celle de CE mouvement
// seulement : elle retirait toutes celles de la pièce, donc annuler l'un de ses deux paiements effaçait
// aussi la contrepartie de l'autre.
//
// Et l'écriture RETOURNE À LA DATE DE SA FACTURE quand plus aucun paiement ne la date (voir
// `rendreAuxDatesDeFacture`). `piece` nul — une pièce que l'écran n'a pas sous la main — laisse la date
// telle quelle, et le contrôle des écritures la signalera.
//
// EN ENGAGEMENT, elle retire le RÈGLEMENT de CE mouvement, ses deux lignes, et rien d'autre : la
// facture reste à sa date, et les règlements des autres paiements de la pièce restent en place.
//
// Les lignes PROPRES au mouvement, jamais une ligne qui porte une facture ou un encaissement (le lot de R1, migration
// `lignes_propres_au_mouvement`, comme les dix-huit fonctions du relevé) : un mouvement libéré peut porter encore les
// lignes d'une vente facturée — la banque d'un encaissement contre-passé sans mouvement, et celle de sa contre-passation —,
// qui ne se retirent que par leur fonction ; les emporter, G5 le refuserait, APRÈS que l'écran a délié le mouvement, et
// le règlement de la pièce resterait au brouillon. En trésorerie, le filtre de la pièce suffit : aucune ligne d'une vente
// facturée ne porte de pièce (`ecrire_vente_facturee` les écrit sans pièce, et G5 refuse qu'une autre écriture les change).
export async function retirerContrepartieBanque(
  ligneId: string, pieceId: string, piece: Pick<Piece, 'date_piece' | 'created_at'> | null, modele: ModeleComptable,
) {
  if (modele.mode === 'engagement') {
    const { error } = await supabase.from('ecritures_brouillon').delete().eq('ligne_bancaire_id', ligneId)
      .is('facture_id', null).is('encaissement_id', null)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('ecritures_brouillon').delete().eq('piece_id', pieceId).eq('ligne_bancaire_id', ligneId)
  if (error) throw error
  if (!piece) return
  await rendreAuxDatesDeFacture([{ id: pieceId, ...piece }], modele)
}

// Les pièces qu'un mouvement a cessé de payer — un rapprochement annulé, un règlement groupé retiré ou
// réglé de nouveau sans elles — RETOURNENT À LA DATE DE LEUR FACTURE quand plus aucune contrepartie
// banque ni caisse ne les date : elles comptent de nouveau là où la 2035 les compte (lib/rattachement.ts). Une
// pièce qu'un autre paiement date encore garde ses lignes, et le contrôle des écritures demande
// « Régénérer », qui les répartit entre les paiements qui restent. La base a déjà retiré les lignes du
// mouvement quand c'est elle qui l'a défait (`retirer_reglement_groupe`, `regler_pieces_par_mouvement`).
//
// UNE PIÈCE PAYÉE AUSSI PAR LA CAISSE (étape C9a) est datée par ce paiement-là : elle ne retourne pas à sa facture, et
// garde ses lignes jusqu'à « Régénérer ». Et la ligne d'une opération de caisse ne se redate jamais (la garde du
// brouillon la refuse) : elle est écartée de la mise à jour. Le drapeau baissé, ni l'une ni l'autre ne se lit : les
// requêtes sont celles d'hier.
//
// EN ENGAGEMENT, rien : la facture n'a jamais quitté sa date.
export async function rendreAuxDatesDeFacture(
  pieces: readonly Pick<Piece, 'id' | 'date_piece' | 'created_at'>[], modele: ModeleComptable,
) {
  if (modele.mode === 'engagement') return
  for (const piece of pieces) {
    const { count, error: lectureError } = await supabase.from('ecritures_brouillon')
      .select('id', { count: 'exact', head: true }).eq('piece_id', piece.id).eq('compte', modele.plan.banque)
    if (lectureError) throw lectureError
    // Un compte que la base n'a pas rendu ne dit pas « plus aucun paiement » : on ne redate rien plutôt
    // que de ramener à sa facture une pièce qu'un paiement date peut-être encore.
    if (count == null || count > 0) continue
    if (PAIEMENT_PAR_LA_CAISSE_EXPORTE) {
      const { count: parLaCaisse, error: caisseError } = await supabase.from('ecritures_brouillon')
        .select('id', { count: 'exact', head: true }).eq('piece_id', piece.id).not('operation_caisse_id', 'is', null)
      if (caisseError) throw caisseError
      if (parLaCaisse == null || parLaCaisse > 0) continue
    }
    const redate = supabase.from('ecritures_brouillon')
      .update({ date: piece.date_piece ?? dateLocaleDe(piece.created_at) }).eq('piece_id', piece.id)
    const { error: dateError } = await (PAIEMENT_PAR_LA_CAISSE_EXPORTE ? redate.is('operation_caisse_id', null) : redate)
    if (dateError) throw dateError
  }
}
