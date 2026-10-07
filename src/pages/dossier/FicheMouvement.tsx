import { Fragment, useState, type ReactNode } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconAttention, IconChevron, IconCoche, IconPrecedent } from '../../components/icons'
import {
  candidatsCotisations, candidatsPieces, ecartEnJours, libelleExploitable, sensCoherent, tiersConfirmeParBanque,
} from '../../lib/appariementBanque'
import { natureDuCompte, refusAffectation, sensInhabituel } from '../../lib/affectationBanque'
import {
  justificatifPossible, motifPropose, mouvementsCouverts, normaliserPourRegle, refusMotif, regleApplicable, sensDuMouvement,
} from '../../lib/reglesAffectation'
import { mouvementRapprocheSansObjet, pastillesDePaiement, piecesPayeesPar } from '../../lib/controles'
import { COMPTE_ASSURANCE_EMPRUNT, COMPTE_BANQUE, COMPTE_EMPRUNT, COMPTE_EXPLOITANT, COMPTE_INTERETS_EMPRUNT, LIBELLES_COMPTES } from '../../lib/comptes'
import { ouvrirJustificatif } from '../../lib/depot'
import { fichierAMontrer } from '../../lib/fichiersPiece'
import {
  capitalDeLEcheance, decoupageDuMouvement, decoupagePourEcheance, echeanceProposee, echeancesOccupees, empruntPlausible,
  estDeblocage, MARGE_PRELEVEMENT_JOURS, montantAttendu, refusDecoupage, refusEcheanceEmprunt,
  type DecoupageEcheance, type EmpruntPlausible,
} from '../../lib/echeanceEmprunt'
import { genererEcheancier, type Emprunt } from '../../lib/emprunts'
import { formatDate, formatMoney } from '../../lib/format'
import type { PaiementsDesPieces } from '../../lib/rattachement'
import { horsTaxeEtTva, libelleTaux, TAUX_TVA_RELEVE, tauxApplicable, tauxRequis } from '../../lib/tvaDuReleve'
import { nomDeLaPiece, refusSecondPaiement, reglementsGroupesIncoherents, type PartReglement } from '../../lib/reglementGroupe'
import type {
  Categorie, CotisationDeclaree, DeclarationTva, LigneBancaire, ModeComptable, Piece, RegleAffectationBancaire, ReglementGroupe,
  VentilationBancaire,
} from '../../lib/types'
import { ecritureDeLaCotisation, refusRapprochementCotisation } from '../../lib/cotisationRapprochee'
import {
  COMPTES_DE_BILAN_PROPOSES, libelleDuCompteDeBilan, lireCompteSaisi, refusCompteDeBilan, refusMouvementCompteDeBilan,
} from '../../lib/compteDeBilan'
import { montantSaisi, ventilationsIncoherentes, type PartSaisie } from '../../lib/ventilationBanque'
import { dePeriode, libellePeriode } from '../../lib/declarationTva'
import {
  aPayerDe, declarationsDuMontant, declarationsPourLeMouvement, phraseDuPaiement, phraseDuRemboursement, refusPaiementTva,
  type SuiviDeDeclaration,
} from '../../lib/liquidationTva'
import FormulaireReglementGroupe from './FormulaireReglementGroupe'
import FormulaireVentilation from './FormulaireVentilation'

// Le rapprochement d'un mouvement bancaire, dans le panneau de droite — étape 2 de l'interface
// d'ordinateur, comme la fiche d'une pièce (voir FichePiece). Il remplace la fenêtre qui assombrissait
// tout l'écran : le relevé reste visible et cliquable à côté, et on arbitre un mouvement en gardant
// ses voisins sous les yeux.
//
// Trois choix, tirés de la maquette validée par le cabinet :
// - la pièce proposée se JUSTIFIE. Les signaux que le rapprochement mesure — montant, écart de date,
//   fournisseur retrouvé dans le libellé — sont dits, et ce qui ne concorde pas l'est aussi : trois
//   coches alignées sous une pièce que le rapprochement certain refuserait feraient d'une
//   ressemblance une preuve (voir lib/appariementBanque.ts, « trois signaux, tous obligatoires ») ;
// - quand plusieurs pièces conviennent AUSSI BIEN, aucune n'est « proposée » : elles sont toutes
//   montrées, chacune avec son justificatif. C'est le cas que « Tout rapprocher automatiquement »
//   refuse de trancher, et mettre la première en avant le trancherait à sa place, par l'ordre de tri ;
// - après une action, le mouvement RESTE affiché, dans son nouvel état (« Rapproché avec… ») : on voit
//   ce qu'on vient de faire, l'annulation est à portée de main, et « Suivant » mène au mouvement qui a
//   pris sa place dans la liste (voir BanqueTab).
//
// ET UN MOUVEMENT QUI N'AURA JAMAIS DE FACTURE S'AFFECTE À UNE CATÉGORIE (ligne 26.6,
// lib/affectationBanque.ts) : les frais bancaires, les encaissements de l'Assurance maladie. Il est
// alors écrit au brouillon, compté dans la 2035 à sa date, et porté au FEC avec le relevé pour pièce.
// Comme le choix d'une pièce, l'affectation ne part qu'au clic sur « Affecter », jamais au changement
// de la liste — et ce que la base refuserait est dit avant le clic.
//
// ET L'AFFECTATION PEUT SE RETENIR EN RÈGLE (lib/reglesAffectation.ts) : « proposer aussi les autres
// paiements dont le libellé contient… ». La règle ne s'applique jamais seule ; les mouvements qu'elle
// désigne sont PROPOSÉS dans la carte « Affectations proposées » de Banque, et c'est un second clic,
// liste sous les yeux, qui les écrit. Une règle qui reconnaît ce mouvement présélectionne sa catégorie,
// et le dit.
//
// ET UN VIREMENT PERSONNEL S'ÉCRIT (lib/virementPersonnel.ts) : sur le compte du dirigeant, face à la
// banque. La fiche le dit avant le clic et sur le mouvement classé ; elle ne dit pas si l'écriture d'un
// virement classé AVANT qu'il s'écrive manque — elle ne lit pas le brouillon —, et renvoie à l'onglet
// Virements, qui le lit, le montre et l'écrit.
//
// ET UNE ÉCHÉANCE D'EMPRUNT SE DÉCOUPE (lib/echeanceEmprunt.ts) : le capital au 164, les intérêts au
// 661, l'assurance au 616 — un déblocage, lui, au crédit du 164. Le découpage est PROPOSÉ depuis
// l'échéancier et VALIDÉ par le cabinet, qui a le tableau de la banque sous les yeux : les champs sont
// modifiables, le capital se recalcule, et rien ne s'écrit avant le clic. Un mouvement qui ressemble à
// une échéance (`empruntPlausible`) la voit proposée en tête, formulaire déplié ; les autres gardent le
// geste à portée, replié, sous « Sans justificatif ».
//
// ET UN MOUVEMENT SE VENTILE SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts) : deux dépenses dans un même
// paiement, une part personnelle — l'abonnement pris en charge en partie —, une remise de carte créditée
// nette de sa commission. Une part par compte, leur somme est le mouvement, et rien ne s'écrit avant le
// clic. Un mouvement ventilé montre ses parts, se modifie ou s'annule — par la base, qui retire les parts
// et l'écriture avec la ventilation.
//
// ET UN VIREMENT RÈGLE PLUSIEURS PIÈCES (ligne 26, lib/reglementGroupe.ts) : trois factures soldées par un
// seul virement, deux factures payées par un client, un avoir déduit d'un paiement. Une part par pièce,
// saisie positive, et leur somme est le mouvement ; chaque part est un paiement de sa pièce, que la 2035,
// la TVA et les écritures lisent comme un rapprochement simple. Rien ne s'écrit avant le clic, et un
// règlement se modifie ou s'annule par la base, qui retire les parts et les écritures du mouvement.
//
// ET UNE ÉCHÉANCE DE COTISATION RAPPROCHÉE S'ÉCRIT (ligne 26.6, lib/cotisationRapprochee.ts) : la cotisation
// au 646000 et, en trésorerie, sa CSG-CRDS au 108000, face à la banque. Ce que la base refuserait est dit
// avant le clic, et un rapprochement posé qui ne peut pas s'écrire le dit sur le mouvement. La fiche dit
// comment l'échéance s'écrit ; elle ne dit pas si l'écriture d'un rapprochement posé AVANT qu'il s'écrive
// manque — elle ne lit pas le brouillon —, et renvoie à l'onglet Cotisations, qui le lit, le montre et
// l'écrit.
//
// ET UN MOUVEMENT QUI N'EST NI UNE CHARGE NI UNE RECETTE S'ÉCRIT SUR UN COMPTE DE BILAN (ligne 26.7,
// lib/compteDeBilan.ts) : un virement vers un autre compte du professionnel au 580000, un dépôt de garantie versé
// ou rendu au 275000, ou un compte de bilan au choix. Ce que la base refuserait — le compte du relevé, celui du
// dirigeant, un compte qui a son propre chemin dans l'application — est dit avant le clic, avec le chemin qui
// convient. Rien ne s'écrit avant le clic, et un mouvement écrit se change de compte ou se remet à traiter par la
// base, qui retire le compte AVEC son écriture.
//
// ET LE PRÉLÈVEMENT DE LA TVA SE RAPPROCHE DE SA DÉCLARATION (ligne 26.8, lib/liquidationTva.ts) : il solde la TVA à
// décaisser (445510) face à la banque, et le virement du Trésor qui rembourse un crédit solde le 445830. La déclaration
// dont il règle EXACTEMENT le reste est proposée — plusieurs, aucune n'est mise en avant —, les autres se choisissent ;
// ce que la base refuserait est dit avant le clic. Un mouvement rapproché d'une déclaration montre ce qu'elle a reçu,
// se rapproche d'une autre ou s'annule par la base, qui retire l'écriture AVEC le lien.

export interface NavigationMouvement {
  position: string
  precedent: (() => void) | null
  suivant: (() => void) | null
}

export interface RecurrenceMouvement {
  action: 'ignorer' | 'virement_personnel'
  occurrences: number
}

interface FicheMouvementProps {
  ligne: LigneBancaire
  // L'exercice validé qui fige ce mouvement, dit avec les mots de la base (lib/validationExercice.ts, `dateFigee`) —
  // nul quand rien ne le fige. Figé, il ne se rapproche, ne se classe et ne se modifie plus (`garder_mouvement_valide`) :
  // la fiche le dit, ne propose plus aucun geste, et tait ce qui réclamerait un geste impossible.
  figeePar: string | null
  // Toutes les pièces chargées, à valider comprises : le choix à la main les offre toutes.
  pieces: Piece[]
  // Les seules qu'on PROPOSE : une proposition ne porte que sur une pièce relue par le cabinet —
  // rapprocher sur de l'OCR non validé écrirait une écriture sur un montant que personne n'a confirmé.
  piecesValidees: Piece[]
  cotisations: CotisationDeclaree[]
  // Les catégories du dossier, pour affecter un mouvement sans justificatif. Seules celles d'un compte
  // de charge ou de produit sont proposées : l'affectation écrit ce compte face à la banque.
  categories: Categorie[]
  // Les règles d'affectation du dossier, et le relevé entier : de quoi présélectionner la catégorie
  // qu'une règle propose, proposer un motif (la famille d'une référence se cherche dans tout le relevé)
  // et compter les mouvements qu'une règle nouvelle désignerait. `reglesIncompletes` : la liste n'a pas
  // pu être lue en entier — on ne retient alors aucune règle, faute de savoir laquelle on remplacerait.
  regles: RegleAffectationBancaire[]
  reglesIncompletes: string | null
  lignes: LigneBancaire[]
  // Sur un dossier assujetti, une recette sans facture porte son taux de TVA, que le relevé ne dit pas :
  // la fiche le demande (voir lib/tvaDuReleve.ts).
  assujettiTva: boolean
  // Le compte sur lequel un virement personnel s'écrit — celui de l'exploitant en trésorerie, celui du
  // dirigeant en engagement (`compteDuDirigeant`).
  compteDirigeant: string
  // Le mode comptable du dossier : une échéance rapprochée s'écrit, et sa CSG-CRDS passe au 108000 en
  // trésorerie — elle peut alors empêcher l'écriture (lib/cotisationRapprochee.ts).
  modeComptable: ModeComptable
  piecesRapprochees: ReadonlySet<string>
  // En trésorerie, les pièces qui portent elles-mêmes une écriture d'un exercice validé — vide en engagement (voir
  // BanqueTab, `piecesHorsRapprochement`). Elles ne se proposent, ne se choisissent ni ne se règlent plus : leur écriture
  // s'équilibre sans paiement, et un rapprochement la redaterait. Une telle pièce du même montant est NOMMÉE, avec le
  // geste qui convient au remboursement d'une note de frais.
  piecesFigees: ReadonlySet<string>
  cotisationsRapprochees: ReadonlySet<string>
  recurrence: RecurrenceMouvement | null
  navigation: NavigationMouvement
  // Une écriture est en cours sur ce relevé — sur ce mouvement ou par un rapprochement en lot. Les
  // actions attendent qu'elle finisse : deux écritures qui se croisent sur le même mouvement
  // laisseraient une contrepartie banque sans rapprochement en face (voir BanqueTab).
  occupe: boolean
  onFermer: () => void
  onRapprocher: (pieceId: string) => void
  onRapprocherCotisation: (cotisationId: string) => void
  onVirementPersonnel: () => void
  onIgnorer: () => void
  onToujoursIgnorer: () => void
  onRemettreATraiter: () => void
  // `motifRegle` : le motif à retenir en règle d'affectation, ou null pour n'affecter que ce mouvement.
  // `taux` : celui d'une recette d'un dossier assujetti, nul ailleurs — la règle retenue le garde aussi.
  onAffecter: (categorieId: string, motifRegle: string | null, taux: number | null) => void
  onRetirerAffectation: () => void
  // Les emprunts du dossier, pour rapprocher une échéance ou un déblocage. `empruntsIncomplets` : la
  // liste n'a pas pu être lue en entier — un emprunt peut manquer au choix, et la fiche le dit.
  emprunts: Emprunt[]
  empruntsIncomplets: string | null
  onRapprocherEmprunt: (empruntId: string, decoupage: DecoupageEcheance) => void
  onRetirerEmprunt: () => void
  // Les parts de CE mouvement s'il est ventilé, et le drapeau de leur lecture : lues en partie, les parts
  // montrées peuvent être incomplètes, et la modification est suspendue — elle repartirait des seules
  // parts lues.
  ventilations: VentilationBancaire[]
  ventilationsIncompletes: string | null
  onVentiler: (parts: PartSaisie[]) => void
  onRetirerVentilation: () => void
  // Les parts de CE mouvement s'il règle plusieurs pièces, et les paiements de toutes les pièces — de quoi
  // dire ce qu'il reste à régler de chacune. `reglementsIncomplets` : les parts des règlements groupés n'ont
  // pas pu être lues en entier — une pièce déjà payée paraîtrait à régler, et les pièces d'un règlement
  // annulé ne retourneraient pas toutes à leur date de facture : régler, modifier et annuler sont suspendus.
  reglements: ReglementGroupe[]
  reglementsIncomplets: string | null
  paiements: PaiementsDesPieces
  onReglerEnGroupe: (parts: PartReglement[]) => void
  onRetirerReglementGroupe: () => void
  // Pièce → ce qu'il reste à payer sur elle, et pièce → ce qu'elle a été payée de trop : jugés sur le TOTAL de
  // ses paiements, calculés une fois par l'onglet pour que la liste et la fiche disent la même chose.
  restesAPayer: ReadonlyMap<string, number>
  payeesEnTrop: ReadonlyMap<string, number>
  // Pièce → ce qu'il reste à régler d'une pièce payée en partie, DANS LES DEUX MODÈLES (`restesAReglerDesPieces`) :
  // ce qu'un second paiement peut encore régler. Vide sur une lecture partielle du relevé ou des parts.
  restesARegler: ReadonlyMap<string, number>
  // Écrire ce mouvement sur un compte de bilan, ou le remettre à traiter — par la base, qui écrit et retire le compte
  // AVEC son écriture (`ecrire_mouvement_compte_bilan`, `retirer_mouvement_compte_bilan`).
  onEcrireCompteBilan: (compte: string) => void
  onRetirerCompteBilan: () => void
  // Les déclarations de TVA du dossier, chacune avec ce que le relevé lui a déjà payé ou remboursé (`suiviDesDeclarations`,
  // calculé une fois par l'onglet) : de quoi rapprocher un prélèvement de la déclaration qu'il paie, ou le virement du
  // Trésor du crédit qu'il rembourse. `declarationsTvaIncompletes` : la liste n'a pas pu être lue en entier — une
  // déclaration peut manquer au choix. `releveIncomplet` : le relevé non plus — ce qu'une déclaration a déjà reçu n'est
  // pas connu, donc aucune n'est PROPOSÉE (un paiement non lu ferait passer une déclaration payée pour une déclaration
  // qui attend exactement ce montant), et ce qui reste à payer ne se dit pas.
  suivisTva: SuiviDeDeclaration<DeclarationTva, LigneBancaire>[]
  declarationsTvaIncompletes: string | null
  releveIncomplet: string | null
  // Rapprocher ce mouvement d'une déclaration — ou d'une autre : la base remplace le lien et l'écriture
  // (`rapprocher_declaration_tva`) —, ou l'en retirer, par la base qui retire l'écriture AVEC le lien.
  onRapprocherDeclarationTva: (declarationId: string) => void
  onRetirerDeclarationTva: () => void
}

interface Signal { ok: boolean; texte: string }

function joursDEcart(jours: number, avec: string): string {
  if (jours === 0) return `Même date que ${avec}`
  return `${jours} jour${jours > 1 ? 's' : ''} d’écart avec ${avec}`
}

// Les signaux d'une pièce candidate. Le montant concorde par construction — `candidatsPieces` ne rend
// que celles-là, au centime près — ; le fournisseur et le sens, non, et ce sont eux qui séparent une
// concordance d'une coïncidence. Le sens n'est dit que lorsqu'il est CONTRAIRE : `candidatsPieces`
// compare les montants en valeur absolue, donc un remboursement du même montant se voit proposer
// l'achat qu'il annule.
function signauxPiece(piece: Piece, ligne: LigneBancaire): Signal[] {
  const signaux: Signal[] = [{ ok: true, texte: 'Même montant, au centime près' }]
  if (piece.date_piece) {
    signaux.push({ ok: true, texte: joursDEcart(ecartEnJours(piece.date_piece, ligne.date), 'la pièce') })
  }
  if (!piece.tiers?.trim()) {
    signaux.push({ ok: false, texte: 'Aucun fournisseur lu sur la pièce' })
  } else if (tiersConfirmeParBanque(piece.tiers, libelleExploitable(ligne))) {
    signaux.push({ ok: true, texte: 'Fournisseur retrouvé dans le libellé bancaire' })
  } else {
    signaux.push({ ok: false, texte: 'Fournisseur non retrouvé dans le libellé bancaire' })
  }
  if (!sensCoherent(piece, ligne)) {
    signaux.push({
      ok: false,
      texte: ligne.montant > 0
        ? 'Sens contraire : la pièce attend un paiement, le relevé montre un crédit'
        : 'Sens contraire : la pièce attend un encaissement, le relevé montre un débit',
    })
  }
  return signaux
}

function signauxCotisation(cotisation: CotisationDeclaree, ligne: LigneBancaire): Signal[] {
  return [
    {
      ok: true,
      texte: cotisation.montant_verse != null ? 'Même montant que le versement déclaré' : 'Même montant que l’appel de cotisation',
    },
    { ok: true, texte: joursDEcart(ecartEnJours(cotisation.echeance, ligne.date), 'l’échéance') },
  ]
}

// Trie les pièces et échéances du choix à la main par plausibilité pour ce mouvement — montant
// identique d'abord, puis proximité de date — plutôt que dans l'ordre de la requête, qui mélangeait
// une pièce de l'année avec une pièce de deux ans plus tôt (voir audit ergonomie). Un score, pas un
// filtre : aucune n'est retirée, on peut toujours associer une pièce d'une autre année.
function scoreCorrespondance(montantRef: number | null, dateRef: string | null, ligne: LigneBancaire): number {
  const montantOk = montantRef != null && Math.abs(Math.abs(montantRef) - Math.abs(ligne.montant)) <= 0.01
  const jours = dateRef ? ecartEnJours(dateRef, ligne.date) : Number.MAX_SAFE_INTEGER
  return (montantOk ? 0 : 1_000_000) + jours
}

function ListeSignaux({ signaux }: { signaux: Signal[] }) {
  return (
    <ul className="signaux-rapprochement">
      {signaux.map((s) => (
        <li key={s.texte} className={s.ok ? 'signal-concordant' : 'signal-reserve'}>
          {s.ok
            ? <IconCoche width={15} height={15} aria-hidden="true" />
            : <IconAttention width={15} height={15} aria-hidden="true" />}
          <span>{s.texte}</span>
        </li>
      ))}
    </ul>
  )
}

function CartePiece({ piece, signaux, action }: { piece: Piece; signaux?: Signal[]; action?: ReactNode }) {
  return (
    <div className="carte-rapprochement">
      <div className="carte-rapprochement-entete">
        <div className="carte-rapprochement-titres">
          <strong>{piece.tiers?.trim() || piece.nom_fichier}</strong>
          <span>{piece.date_piece ? `Pièce du ${formatDate(piece.date_piece)}` : 'Pièce sans date'}</span>
        </div>
        <strong className="carte-rapprochement-montant">{formatMoney(piece.montant_ttc)}</strong>
      </div>
      {signaux && <ListeSignaux signaux={signaux} />}
      <div className="carte-rapprochement-actions">
        {/* Le justificatif s'ouvre à côté, sans quitter le mouvement : c'est ce qu'on regarde avant de
            confirmer (voir audit ergonomie comparatif). */}
        <button type="button" className="carte-rapprochement-lien" onClick={() => ouvrirJustificatif(fichierAMontrer(piece).chemin)}>
          Voir le justificatif
        </button>
        {action}
      </div>
    </div>
  )
}

function CarteCotisation({ cotisation, signaux, action }: { cotisation: CotisationDeclaree; signaux?: Signal[]; action?: ReactNode }) {
  return (
    <div className="carte-rapprochement">
      <div className="carte-rapprochement-entete">
        <div className="carte-rapprochement-titres">
          <strong>Cotisation sociale</strong>
          <span>
            Échéance du {formatDate(cotisation.echeance)}
            {cotisation.previsionnel ? ' (prévisionnelle)' : ''}
          </span>
        </div>
        <strong className="carte-rapprochement-montant">{formatMoney(cotisation.montant_verse ?? cotisation.montant_appele)}</strong>
      </div>
      {signaux && <ListeSignaux signaux={signaux} />}
      {action && <div className="carte-rapprochement-actions">{action}</div>}
    </div>
  )
}

// Une déclaration que ce mouvement règle exactement : le montant concorde par construction (`declarationsDuMontant`), et
// la date dit que le prélèvement suit la période — un paiement de TVA vient après elle, jamais avant.
function signauxDeclarationTva(d: DeclarationTva, ligne: LigneBancaire): Signal[] {
  return [
    {
      ok: true,
      texte: ligne.montant > 0 ? 'Même montant que le remboursement encore attendu' : 'Même montant que la TVA qui reste à payer',
    },
    { ok: true, texte: joursDEcart(ecartEnJours(d.periode_fin, ligne.date), 'la fin de la période') },
  ]
}

// Une déclaration de TVA, du point de vue du mouvement : ce qu'elle fait payer pour un prélèvement, le remboursement
// qu'elle a demandé pour un encaissement — et ce que le relevé lui a déjà porté, quand il a été lu en entier (`suivi`).
function CarteDeclarationTva({ declaration, suivi, encaissement, signaux, action }: {
  declaration: DeclarationTva
  suivi: SuiviDeDeclaration<DeclarationTva, LigneBancaire> | null
  encaissement: boolean
  signaux?: Signal[]
  action?: ReactNode
}) {
  const etat = suivi ? (encaissement ? phraseDuRemboursement(suivi) : phraseDuPaiement(suivi)) : null
  return (
    <div className="carte-rapprochement">
      <div className="carte-rapprochement-entete">
        <div className="carte-rapprochement-titres">
          <strong>Déclaration de TVA {dePeriode(libellePeriode(declaration.periode_debut, declaration.periode_fin))}</strong>
          <span>
            {declaration.date_declaration ? `Déposée le ${formatDate(declaration.date_declaration)}` : 'Date de dépôt non renseignée'}
            {etat ? ` · ${etat}` : ''}
          </span>
        </div>
        <strong className="carte-rapprochement-montant">
          {formatMoney(encaissement ? declaration.remboursement_demande : aPayerDe(declaration))}
        </strong>
      </div>
      {signaux && <ListeSignaux signaux={signaux} />}
      {action && <div className="carte-rapprochement-actions">{action}</div>}
    </div>
  )
}

const auCentimeSaisi = (n: number) => n.toFixed(2)

// Le formulaire d'un rapprochement d'emprunt : l'emprunt, puis — pour une échéance — son numéro, ses
// intérêts et son assurance, le capital recalculé à chaque frappe. Rendu à deux endroits de la fiche
// (proposé en tête, ou replié sous « Sans justificatif ») et sur un mouvement déjà rapproché, pour
// corriger le découpage : un seul composant, pour que les trois disent la même chose.
function FormulaireEmprunt({ ligne, emprunts, lignes, plausible, occupe, verbe, onRapprocherEmprunt }: {
  ligne: LigneBancaire
  emprunts: Emprunt[]
  lignes: LigneBancaire[]
  plausible: EmpruntPlausible | null
  occupe: boolean
  verbe: string
  onRapprocherEmprunt: (empruntId: string, decoupage: DecoupageEcheance) => void
}) {
  const deblocage = estDeblocage(ligne)
  const occupeesDe = (e: Emprunt) => echeancesOccupees(lignes, e.id, ligne.id)
  // Le découpage de départ : celui que la base garde sur un mouvement déjà rapproché, celui de
  // l'échéance à laquelle le mouvement ressemble, sinon la proposition pour le seul emprunt du dossier.
  const [etatInitial] = useState(() => {
    const garde = decoupageDuMouvement(ligne)
    if (garde && ligne.emprunt_id) return { empruntId: ligne.emprunt_id, decoupage: garde }
    if (plausible) {
      return {
        empruntId: plausible.emprunt.id,
        decoupage: plausible.echeance ? decoupagePourEcheance(plausible.echeance, ligne) : { echeance: null, interets: 0, assurance: 0 },
      }
    }
    if (emprunts.length === 1) {
      return { empruntId: emprunts[0].id, decoupage: echeanceProposee(emprunts[0], ligne, occupeesDe(emprunts[0]))?.decoupage ?? null }
    }
    return { empruntId: '', decoupage: null }
  })
  const [empruntChoisi, setEmpruntChoisi] = useState(etatInitial.empruntId)
  const [echeanceSaisie, setEcheanceSaisie] = useState(etatInitial.decoupage?.echeance != null ? String(etatInitial.decoupage.echeance) : '')
  const [interetsSaisis, setInteretsSaisis] = useState(etatInitial.decoupage ? auCentimeSaisi(etatInitial.decoupage.interets) : '')
  const [assuranceSaisie, setAssuranceSaisie] = useState(etatInitial.decoupage ? auCentimeSaisi(etatInitial.decoupage.assurance) : '')

  const emprunt = empruntChoisi ? emprunts.find((e) => e.id === empruntChoisi) ?? null : null
  const occupees = emprunt ? occupeesDe(emprunt) : new Map<number, string>()
  const echeancier = emprunt ? genererEcheancier(emprunt) : []

  function poserDecoupage(d: DecoupageEcheance | null) {
    setEcheanceSaisie(d?.echeance != null ? String(d.echeance) : '')
    setInteretsSaisis(d ? auCentimeSaisi(d.interets) : '')
    setAssuranceSaisie(d ? auCentimeSaisi(d.assurance) : '')
  }

  // Changer d'emprunt repropose SON échéance ; changer de numéro repropose les intérêts de CE mois-là.
  // Les deux ne font que remplir des champs : rien ne s'écrit avant le clic.
  function choisirEmprunt(id: string) {
    setEmpruntChoisi(id)
    const e = emprunts.find((x) => x.id === id)
    poserDecoupage(e ? echeanceProposee(e, ligne, occupeesDe(e))?.decoupage ?? null : null)
  }

  function choisirEcheance(saisie: string) {
    setEcheanceSaisie(saisie)
    const l = echeancier.find((x) => String(x.numero) === saisie.trim())
    if (l) {
      const d = decoupagePourEcheance(l, ligne)
      setInteretsSaisis(auCentimeSaisi(d.interets))
      setAssuranceSaisie(auCentimeSaisi(d.assurance))
    }
  }

  const lire = (saisie: string) => (saisie.trim() === '' ? Number.NaN : Number(saisie))
  const decoupage: DecoupageEcheance = deblocage
    ? { echeance: null, interets: 0, assurance: 0 }
    : { echeance: echeanceSaisie.trim() === '' ? null : Number(echeanceSaisie), interets: lire(interetsSaisis), assurance: lire(assuranceSaisie) }
  const champVide = !deblocage && (interetsSaisis.trim() === '' || assuranceSaisie.trim() === '')
  const refus = !emprunt
    ? null
    : refusEcheanceEmprunt(ligne)
      ?? (champVide ? 'Saisis les intérêts et l’assurance — 0 s’il n’y en a pas.' : null)
      ?? refusDecoupage(ligne, emprunt, decoupage, occupees)
  const reference = !deblocage && decoupage.echeance != null ? echeancier.find((l) => l.numero === decoupage.echeance) ?? null : null
  const total = Math.round(Math.abs(ligne.montant) * 100)
  const ecartReference = reference ? total - Math.round(montantAttendu(reference) * 100) : 0
  const joursReference = reference ? ecartEnJours(reference.date, ligne.date) : 0
  const toutesPayees = !!emprunt && !deblocage && echeancier.every((l) => occupees.has(l.numero))

  return (
    <>
      <div className="field">
        <label htmlFor={`emprunt-${ligne.id}`}>Emprunt</label>
        <select id={`emprunt-${ligne.id}`} value={empruntChoisi} onChange={(e) => choisirEmprunt(e.target.value)}>
          <option value="">— Choisir —</option>
          {emprunts.map((e) => (
            <option key={e.id} value={e.id}>{e.nom}{e.organisme_preteur ? ` (${e.organisme_preteur})` : ''}</option>
          ))}
        </select>
      </div>
      {emprunt && deblocage && (
        <p className="fiche-mouvement-note">
          Les fonds d’un emprunt ne sont pas une recette : ils s’écrivent au crédit du compte {COMPTE_EMPRUNT}
          {' '}({LIBELLES_COMPTES[COMPTE_EMPRUNT]}), face à la banque. Capital de l’emprunt : {formatMoney(emprunt.capital_initial)}.
        </p>
      )}
      {emprunt && !deblocage && (
        <>
          {toutesPayees && (
            <p className="fiche-mouvement-note">Toutes les échéances de cet emprunt sont déjà rapprochées d’un mouvement.</p>
          )}
          <div className="fiche-mouvement-decoupage">
            <div className="field">
              <label htmlFor={`emprunt-echeance-${ligne.id}`}>Échéance n°</label>
              <input
                id={`emprunt-echeance-${ligne.id}`}
                type="number" min={1} max={emprunt.duree_mois} step={1}
                value={echeanceSaisie}
                onChange={(e) => choisirEcheance(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`emprunt-interets-${ligne.id}`}>Intérêts ({COMPTE_INTERETS_EMPRUNT})</label>
              <input
                id={`emprunt-interets-${ligne.id}`}
                type="number" min={0} step={0.01}
                value={interetsSaisis}
                onChange={(e) => setInteretsSaisis(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`emprunt-assurance-${ligne.id}`}>Assurance ({COMPTE_ASSURANCE_EMPRUNT})</label>
              <input
                id={`emprunt-assurance-${ligne.id}`}
                type="number" min={0} step={0.01}
                value={assuranceSaisie}
                onChange={(e) => setAssuranceSaisie(e.target.value)}
              />
            </div>
          </div>
          {reference && (
            <p className="fiche-mouvement-note">
              L’échéancier prévoit {formatMoney(montantAttendu(reference))} le {formatDate(reference.date)}, dont
              {' '}{formatMoney(reference.interets)} d’intérêts.
              {ecartReference > 0 && ` Le prélèvement porte ${formatMoney(ecartReference / 100)} de plus — le plus souvent l’assurance de l’emprunteur.`}
              {ecartReference < 0 && ` Le prélèvement est inférieur de ${formatMoney(-ecartReference / 100)} : vérifie le numéro de l’échéance, ou le tableau de la banque.`}
              {joursReference > MARGE_PRELEVEMENT_JOURS && ` Cette échéance tombe à ${joursReference} jours du mouvement.`}
              {' '}Le tableau d’amortissement de la banque fait foi : corrige les montants s’ils diffèrent.
            </p>
          )}
          {!refus && (
            <p className="fiche-mouvement-note">
              Capital remboursé : <strong>{formatMoney(capitalDeLEcheance(ligne, decoupage))}</strong> au compte {COMPTE_EMPRUNT},
              ni charge ni recette. Seuls les intérêts et l’assurance comptent dans la 2035.
            </p>
          )}
        </>
      )}
      {refus && <p className="fiche-mouvement-alerte">{refus}</p>}
      <div className="fiche-mouvement-boutons">
        <button
          type="button"
          className="btn btn-outline"
          disabled={!emprunt || !!refus || occupe}
          onClick={() => emprunt && onRapprocherEmprunt(emprunt.id, decoupage)}
        >
          {verbe}
        </button>
      </div>
    </>
  )
}

export default function FicheMouvement({
  ligne, figeePar, pieces, piecesValidees, cotisations, categories, regles, reglesIncompletes, lignes, assujettiTva, compteDirigeant, modeComptable,
  piecesRapprochees, piecesFigees, cotisationsRapprochees, recurrence, navigation, occupe,
  onFermer, onRapprocher, onRapprocherCotisation, onVirementPersonnel, onIgnorer, onToujoursIgnorer, onRemettreATraiter,
  onAffecter, onRetirerAffectation, emprunts, empruntsIncomplets, onRapprocherEmprunt, onRetirerEmprunt,
  ventilations, ventilationsIncompletes, onVentiler, onRetirerVentilation,
  reglements, reglementsIncomplets, paiements, onReglerEnGroupe, onRetirerReglementGroupe, restesAPayer, payeesEnTrop,
  restesARegler, onEcrireCompteBilan, onRetirerCompteBilan,
  suivisTva, declarationsTvaIncompletes, releveIncomplet, onRapprocherDeclarationTva, onRetirerDeclarationTva,
}: FicheMouvementProps) {
  const libelleCompteDirigeant = LIBELLES_COMPTES[compteDirigeant] ?? compteDirigeant
  const fige = figeePar !== null
  // Le choix à la main ne s'applique qu'au clic sur « Associer », jamais au changement de la liste :
  // sur une liste déroulante qui a le focus, les flèches du clavier changent la valeur — et
  // rapprochaient donc, dans la fenêtre d'avant, la première pièce venue sans qu'on l'ait choisie.
  const [pieceChoisie, setPieceChoisie] = useState('')
  const [cotisationChoisie, setCotisationChoisie] = useState('')
  const aTraiter = ligne.statut === 'non_rapprochee'
  // La règle qui reconnaît ce mouvement, s'il est à traiter. Sa catégorie est PRÉSÉLECTIONNÉE, jamais
  // appliquée : l'affectation reste le clic de l'opérateur.
  const resultatRegle = aTraiter ? regleApplicable(ligne, regles) : null
  const regleProposee = resultatRegle?.etat === 'proposee' ? resultatRegle.regle : null
  // Affecté, la liste part de la catégorie en place : « Réaffecter » sans rien changer réécrit alors
  // l'écriture sur le compte ACTUEL de la catégorie — le geste qui répare une écriture périmée. À
  // traiter, elle part de la catégorie qu'une règle propose, quand elle en propose une.
  const [categorieChoisie, setCategorieChoisie] = useState(ligne.categorie_id ?? regleProposee?.categorie_id ?? '')
  // Le taux de TVA d'une recette : celui en place, sinon celui de la règle qui la propose — présélectionné
  // comme sa catégorie, jamais écrit sans le clic. '' tant qu'il n'est pas choisi.
  const [tauxChoisi, setTauxChoisi] = useState(() => {
    const garde = ligne.categorie_id ? ligne.taux_tva : regleProposee?.taux_tva
    return garde == null ? '' : String(garde)
  })
  // Retenir une règle : cochée à la main, jamais d'office — le motif décide de ce qu'elle désignera.
  const sens = sensDuMouvement(ligne)
  const [retenirRegle, setRetenirRegle] = useState(false)
  const [motifRegle, setMotifRegle] = useState(() => motifPropose(ligne, lignes) ?? '')
  const affecte = ligne.statut === 'rapprochee' && !!ligne.categorie_id
  const libelle = libelleExploitable(ligne) || ligne.libelle
  const sansObjet = mouvementRapprocheSansObjet(ligne)

  // L'emprunt de ce mouvement, et celui auquel il ressemble s'il est à traiter.
  const rapprocheEmprunt = ligne.statut === 'rapprochee' && !!ligne.emprunt_id
  const empruntLie = ligne.emprunt_id ? emprunts.find((e) => e.id === ligne.emprunt_id) ?? null : null
  const deblocage = estDeblocage(ligne)
  const plausible = aTraiter ? empruntPlausible(ligne, emprunts, lignes) : null
  const empruntOffert = aTraiter && ligne.montant !== 0 && (emprunts.length > 0 || !!empruntsIncomplets)
  const [empruntDeplie, setEmpruntDeplie] = useState(false)
  const [correctionDepliee, setCorrectionDepliee] = useState(false)

  // La ventilation : repliée tant qu'on ne la demande pas — la plupart des mouvements vont à UN compte.
  const ventile = ligne.statut === 'rapprochee' && ligne.ventilee
  const [ventilationDepliee, setVentilationDepliee] = useState(false)
  const [modificationDepliee, setModificationDepliee] = useState(false)
  // Défensif : la base écrit le drapeau et les parts ensemble, et vérifie leur somme. Jugé sur des parts
  // lues EN ENTIER seulement — sinon une part non lue passerait pour une part manquante.
  const ventilationIncoherente = ventile && !ventilationsIncompletes && ventilationsIncoherentes([ligne], ventilations).length > 0
  // Le taux d'une part de recette se dit à côté d'elle, tel qu'il s'applique AUJOURD'HUI — comme celui d'une
  // recette affectée : un dossier qui a cessé d'être assujetti garde le taux en base, mais ne l'écrit plus.
  const libellePart = (v: VentilationBancaire) => {
    if (v.part_personnelle) return `Part personnelle (${compteDirigeant})`
    const c = categories.find((x) => x.id === v.categorie_id)
    if (!c) return 'Catégorie non lue'
    const taux = tauxApplicable(assujettiTva, natureDuCompte(c.compte_comptable), v.taux_tva)
    return `${c.libelle} (${c.compte_comptable ?? 'sans compte'})${taux != null ? ` · TVA ${libelleTaux(taux)}` : ''}`
  }
  const categoriesDesParts = ventilations
    .map((v) => (v.categorie_id ? categories.find((c) => c.id === v.categorie_id) ?? null : null))
    .filter((c): c is Categorie => c !== null)
  const partsHorsResultat = categoriesDesParts.filter((c) => !natureDuCompte(c.compte_comptable))
  const partsSansPoste = categoriesDesParts.filter((c) => natureDuCompte(c.compte_comptable) && !c.poste_2035)
  // Les parts de recette SANS TAUX d'un dossier assujetti — ventilées avant qu'il le devienne : la pastille
  // « TVA à choisir » de la liste et le point de la Checklist envoient ici, la fiche dit laquelle et quoi faire.
  const partsRecetteSansTaux = ventilations.filter((v) => {
    const c = !v.part_personnelle && v.categorie_id ? categories.find((x) => x.id === v.categorie_id) : undefined
    return !!c && tauxRequis(assujettiTva, natureDuCompte(c.compte_comptable)) && v.taux_tva == null
  })

  // Le règlement de plusieurs pièces : replié tant qu'on ne le demande pas, comme la ventilation.
  const regleEnGroupe = ligne.statut === 'rapprochee' && ligne.reglement_groupe
  const [reglementDeplie, setReglementDeplie] = useState(false)
  const [modificationReglementDepliee, setModificationReglementDepliee] = useState(false)
  // Jugé sur des parts lues EN ENTIER seulement — une part non lue passerait pour une part manquante.
  const incoherencesGroupe = regleEnGroupe && !reglementsIncomplets ? reglementsGroupesIncoherents([ligne], reglements) : []
  const libellePieceReglee = (r: ReglementGroupe) => {
    if (!r.piece_id) return 'Pièce supprimée'
    const piece = pieces.find((p) => p.id === r.piece_id)
    if (!piece) return 'Pièce non lue'
    const montant = piece.montant_ttc == null
      ? 'montant non lu'
      : piece.montant_ttc < 0 ? `avoir de ${formatMoney(-piece.montant_ttc)}` : `facture de ${formatMoney(piece.montant_ttc)}`
    return `${nomDeLaPiece(piece)}${piece.date_piece ? ` — ${formatDate(piece.date_piece)}` : ''} (${montant})`
  }
  // Chaque part dans le SENS DU MOUVEMENT, comme le reste à répartir du formulaire : les parts font alors le
  // montant du virement, et l'avoir qu'il déduit y figure en négatif. Montrées toutes positives, deux
  // factures et un avoir paraîtraient faire plus que le virement.
  const partReglee = (r: ReglementGroupe) => r.montant * (Math.sign(ligne.montant) || 1)

  // UN COMPTE DE BILAN (lib/compteDeBilan.ts) : les deux comptes proposés sous la main, un autre au choix replié tant
  // qu'on ne le demande pas. Écrit, le mouvement se change de compte — la base remplace le compte et l'écriture — ou se
  // remet à traiter. Ce que la base refuserait est dit AVANT le clic : le refus du mouvement une fois, celui d'un compte
  // tapé sous la saisie — et chaque refus dit où va le mouvement.
  const surCompteDeBilan = ligne.statut === 'rapprochee' && !!ligne.compte_bilan
  const [autreCompteDeplie, setAutreCompteDeplie] = useState(false)
  const [compteSaisi, setCompteSaisi] = useState('')
  const [changementCompteDeplie, setChangementCompteDeplie] = useState(false)
  const refusDuMouvementSurBilan = refusMouvementCompteDeBilan(ligne)
  const refusDuCompteDeBilan = (compte: string | null) =>
    refusDuMouvementSurBilan ?? refusCompteDeBilan(compte, modeComptable, compteDirigeant)
  const saisieCompte = lireCompteSaisi(compteSaisi)
  // Rien de tapé n'est pas un refus : le bouton attend, sans message en rouge.
  const refusSaisie = saisieCompte.refus ?? (saisieCompte.compte ? refusCompteDeBilan(saisieCompte.compte, modeComptable, compteDirigeant) : null)
  const libelleSaisi = saisieCompte.compte ? libelleDuCompteDeBilan(saisieCompte.compte) : null
  const compteDeBilanPropose = surCompteDeBilan ? COMPTES_DE_BILAN_PROPOSES.find((c) => c.compte === ligne.compte_bilan) ?? null : null
  const libelleCompteDeBilan = ligne.compte_bilan ? libelleDuCompteDeBilan(ligne.compte_bilan) : null

  // LE PAIEMENT D'UNE DÉCLARATION DE TVA (lib/liquidationTva.ts). Proposée : celle dont ce mouvement règle EXACTEMENT le
  // reste — et une seule ; plusieurs, elles sont toutes montrées, aucune mise en avant. Au choix : celles qui ont une TVA
  // à payer (un prélèvement) ou un remboursement demandé (un encaissement), la plus probable d'abord. Rapproché, le
  // mouvement se rapproche d'une autre déclaration — replié tant qu'on ne le demande pas — ou s'annule.
  const paieUneDeclaration = ligne.statut === 'rapprochee' && !!ligne.declaration_tva_id
  const suiviPaye = paieUneDeclaration ? suivisTva.find((s) => s.declaration.id === ligne.declaration_tva_id) ?? null : null
  const declarationsExactes = aTraiter && !fige && !releveIncomplet ? declarationsDuMontant(ligne, suivisTva) : []
  const declarationTvaProposee = declarationsExactes.length === 1 ? declarationsExactes[0] : null
  const declarationsAuChoix = (aTraiter || paieUneDeclaration) && !fige ? declarationsPourLeMouvement(ligne, suivisTva) : []
  const tvaOfferte = aTraiter && ligne.montant !== 0 && (suivisTva.length > 0 || !!declarationsTvaIncompletes)
  const [declarationChoisie, setDeclarationChoisie] = useState('')
  const [changementDeclarationDeplie, setChangementDeclarationDeplie] = useState(false)
  const declarationCible = declarationsAuChoix.find((d) => d.id === declarationChoisie) ?? null
  const refusDeclarationChoisie = declarationCible ? refusPaiementTva(ligne, declarationCible) : null
  const encaissement = ligne.montant > 0
  // Ce qu'une déclaration attend et ce qu'elle a reçu, dit de son point de vue : la TVA à payer pour un prélèvement, le
  // remboursement demandé pour un encaissement. Rien de ce qu'elle a reçu sur un relevé lu en partie.
  const libelleDeclarationTva = (d: DeclarationTva): string => {
    const periode = libellePeriode(d.periode_debut, d.periode_fin)
    const suivi = suivisTva.find((x) => x.declaration.id === d.id)
    if (!suivi) return periode
    if (encaissement) {
      const demande = `remboursement demandé ${formatMoney(suivi.remboursementDemande)}`
      return releveIncomplet || suivi.rembourse === 0 ? `${periode} — ${demande}` : `${periode} — ${demande}, reçu ${formatMoney(suivi.rembourse)}`
    }
    const aPayer = `TVA à payer ${formatMoney(suivi.aPayer)}`
    return releveIncomplet || suivi.paye === 0 ? `${periode} — ${aPayer}` : `${periode} — ${aPayer}, payé ${formatMoney(suivi.paye)}`
  }
  const noteEcritureTva = encaissement
    ? 'Ni charge ni recette : le remboursement solde le crédit de TVA dont il a été demandé le remboursement (445830), face à la banque.'
    : 'Ni charge ni recette : le prélèvement solde la TVA à décaisser (445510), face à la banque.'

  // Ce qui se propose à l'affectation : les catégories d'un compte de résultat, dans l'ordre du sens
  // du mouvement — les recettes d'abord pour un encaissement, les dépenses d'abord pour un paiement.
  const categorieAffectee = ligne.categorie_id ? categories.find((c) => c.id === ligne.categorie_id) ?? null : null
  const natureAffectee = categorieAffectee ? natureDuCompte(categorieAffectee.compte_comptable) : null
  // Le taux de la recette affectée, tel qu'il s'applique AUJOURD'HUI : un dossier qui a cessé d'être assujetti
  // garde le taux en base, mais ne l'écrit plus — le montrer ferait croire à une TVA que rien ne déclare.
  const tauxAffecte = affecte ? tauxApplicable(assujettiTva, natureAffectee, ligne.taux_tva) : null
  const categoriesRecettes = categories.filter((c) => natureDuCompte(c.compte_comptable) === 'recette')
  const categoriesDepenses = categories.filter((c) => natureDuCompte(c.compte_comptable) === 'depense')
  const groupesDeCategories = ligne.montant >= 0
    ? [{ titre: 'Recettes', liste: categoriesRecettes }, { titre: 'Dépenses', liste: categoriesDepenses }]
    : [{ titre: 'Dépenses', liste: categoriesDepenses }, { titre: 'Recettes', liste: categoriesRecettes }]
  const categorieCible = categorieChoisie ? categories.find((c) => c.id === categorieChoisie) ?? null : null
  const natureCible = categorieCible ? natureDuCompte(categorieCible.compte_comptable) : null
  // Le taux n'est demandé — et n'est envoyé — que pour une recette d'un dossier assujetti.
  const tauxDemande = tauxRequis(assujettiTva, natureCible)
  const taux = tauxDemande && tauxChoisi !== '' ? Number(tauxChoisi) : null
  const refus = categorieCible ? refusAffectation(ligne, categorieCible, assujettiTva, taux) : null
  // Le taux qui manque n'est pas une faute : c'est la question que la liste des taux pose. Le bouton
  // attend, sans message en rouge.
  const tauxManquant = tauxDemande && taux == null
  const inhabituel = !refus && natureCible ? sensInhabituel(ligne, natureCible) : false
  const ventilationTva = taux ? horsTaxeEtTva(ligne.montant, taux) : null

  // Ce que la règle retenue désignerait, et pourquoi elle ne peut pas l'être.
  const refusRegle = retenirRegle ? refusMotif(motifRegle) : null
  const motifNormalise = normaliserPourRegle(motifRegle)
  const autresCouverts = retenirRegle && sens && !refusRegle
    ? mouvementsCouverts(motifNormalise, sens, lignes).filter((l) => l.id !== ligne.id).length
    : 0
  const regleRemplacee = retenirRegle && sens
    ? regles.find((r) => r.motif === motifNormalise && r.sens === sens) ?? null
    : null
  const regleBloquee = retenirRegle && (!!refusRegle || !!reglesIncompletes || !sens)
  // Ce qu'un rapprochement ne peut plus toucher : les pièces payées, et celles qu'un exercice validé a figées (voir
  // `piecesFigees`).
  const horsRapprochement: ReadonlySet<string> = piecesFigees.size === 0
    ? piecesRapprochees
    : new Set([...piecesRapprochees, ...piecesFigees])
  // Un paiement dont la pièce est peut-être au dossier : l'affecter compterait la dépense deux fois
  // (voir `justificatifPossible`). Dit avant le clic, jamais refusé : c'est l'opérateur qui sait.
  const justificatifAttendu = aTraiter
    ? justificatifPossible(ligne, { pieces, piecesRapprochees: horsRapprochement, restesARegler, cotisations, cotisationsRapprochees })
    : null

  // Même précédence que le rapprochement automatique : une pièce avant une échéance, une échéance
  // avant une récurrence. Ce n'est pas un arbitrage entre égaux mais une règle de l'écran.
  const piecesCandidates = aTraiter ? candidatsPieces(ligne, piecesValidees, horsRapprochement) : []
  // La pièce figée qu'on aurait proposée : elle ne se rapproche plus, et la fiche le dit au lieu de la taire — un mouvement
  // du même montant qu'une note de frais d'un exercice validé en est souvent le remboursement.
  const figeeDeMemeMontant = aTraiter && piecesFigees.size > 0
    ? candidatsPieces(ligne, piecesValidees.filter((p) => piecesFigees.has(p.id)), piecesRapprochees)[0] ?? null
    : null
  const echeancesCandidates = aTraiter && piecesCandidates.length === 0
    ? candidatsCotisations(ligne, cotisations, cotisationsRapprochees)
    : []
  // Un prélèvement qui règle exactement une déclaration de TVA n'est pas « comme les précédents ignorés » : la TVA
  // payée s'écrit, et l'ignorer la laisserait au 445510.
  const recurrent = aTraiter && piecesCandidates.length === 0 && echeancesCandidates.length === 0 && declarationsExactes.length === 0
    ? recurrence
    : null

  const piecePayee = ligne.piece_id ? pieces.find((p) => p.id === ligne.piece_id) ?? null : null
  const cotisationPayee = ligne.cotisation_id ? cotisations.find((c) => c.id === ligne.cotisation_id) ?? null : null
  // Un rapprochement d'échéance S'ÉCRIT (lib/cotisationRapprochee.ts) : ce que la base refuserait — une
  // CSG-CRDS plus grande que le mouvement, une échéance de zéro euro, un sens contraire — est dit AVANT
  // le clic, et le bouton se grise. Le même refus dit, sur un rapprochement déjà posé, pourquoi il ne
  // s'écrit pas.
  const refusEcheance = (c: CotisationDeclaree) => refusRapprochementCotisation(ligne, c, modeComptable)
  const refusEcheancePayee = cotisationPayee ? refusEcheance(cotisationPayee) : null
  // Comment elle s'écrit, hors banque : la cotisation au 646000, sa CSG-CRDS au 108000 en trésorerie.
  const ecritureEcheancePayee = cotisationPayee && !refusEcheancePayee
    ? ecritureDeLaCotisation(ligne, cotisationPayee, modeComptable).filter((l) => l.compte !== COMPTE_BANQUE)
    : []
  // Seconde copie de la pastille de la liste, gardée par son propre test : le panneau est l'écran où
  // l'on ARBITRE, donc celui où l'écart doit se lire. Jugé sur le total payé de chaque pièce.
  const pastillesPaiement = pastillesDePaiement(piecesPayeesPar(ligne, reglements), restesAPayer, payeesEnTrop, ligne.reglement_groupe)

  // UNE PIÈCE PAYÉE EN PARTIE S'OFFRE ENCORE AU CHOIX, POUR SON RESTE : un acompte, puis le solde par un autre virement
  // qui ne paie qu'elle. Tenue pour rapprochée dès son premier paiement, elle ne s'offrait plus au second — et le
  // règlement groupé exige deux pièces —, si bien que son reste ne se rapprochait de rien et qu'elle restait « payée en
  // partie », ce que la validation de son exercice refuse. Elle n'est jamais PROPOSÉE : le rapprochement certain compare
  // le montant de la pièce, et un solde peut arriver des semaines après la facture. C'est l'opérateur qui la choisit, et
  // ce qui dépasserait son reste est refusé avant le clic (`refusSecondPaiement`).
  const horsChoix: ReadonlySet<string> = restesARegler.size === 0
    ? horsRapprochement
    : new Set([...horsRapprochement].filter((id) => !restesARegler.has(id) || piecesFigees.has(id)))
  const montantAttendu = (p: Piece) => restesARegler.get(p.id) ?? p.montant_ttc
  const piecesAuChoix = aTraiter
    ? pieces.filter((p) => !horsChoix.has(p.id))
        .sort((a, b) => scoreCorrespondance(montantAttendu(a), a.date_piece, ligne) - scoreCorrespondance(montantAttendu(b), b.date_piece, ligne))
    : []
  const pieceChoisieDejaPayee = pieceChoisie && restesARegler.has(pieceChoisie)
    ? piecesAuChoix.find((p) => p.id === pieceChoisie) ?? null
    : null
  const refusPieceChoisie = pieceChoisieDejaPayee
    ? refusSecondPaiement(ligne, pieceChoisieDejaPayee, paiements.get(pieceChoisieDejaPayee.id) ?? [])
    : null
  const cotisationsAuChoix = aTraiter
    ? cotisations.filter((c) => !cotisationsRapprochees.has(c.id))
        .sort((a, b) =>
          scoreCorrespondance(a.montant_verse ?? a.montant_appele, a.echeance, ligne)
          - scoreCorrespondance(b.montant_verse ?? b.montant_appele, b.echeance, ligne))
    : []
  const echeanceChoisie = cotisationChoisie ? cotisationsAuChoix.find((c) => c.id === cotisationChoisie) ?? null : null
  const refusChoix = echeanceChoisie ? refusEcheance(echeanceChoisie) : null
  // Pourquoi rien n'est proposé, dit plutôt que deviné (voir audit ergonomie comparatif) : deux listes
  // vides ne disent pas si le dossier n'a rien à associer, ou si tout est déjà rapproché ailleurs.
  const aucuneReference = pieces.length === 0 && cotisations.length === 0
  const toutDejaRapproche = !aucuneReference && piecesAuChoix.length === 0 && cotisationsAuChoix.length === 0
  // Une pièce figée n'est pas « déjà rapprochée » : quand il en reste, la phrase le dit.
  const figeesSansPaiement = pieces.some((p) => piecesFigees.has(p.id) && !piecesRapprochees.has(p.id))
  // Les pièces qu'un règlement groupé peut offrir : pas une pièce figée, sauf si ce règlement la porte déjà — ses parts
  // doivent rester lisibles.
  const dansCeReglement = new Set(reglements.map((r) => r.piece_id))
  const piecesReglables = piecesFigees.size === 0
    ? pieces
    : pieces.filter((p) => !piecesFigees.has(p.id) || dansCeReglement.has(p.id))
  const unePropositionExiste = piecesCandidates.length > 0 || echeancesCandidates.length > 0

  // La liste des catégories et son bouton. Le refus que la base opposerait est dit AVANT le clic, et
  // le bouton se grise ; un encaissement rangé sur une dépense (ou l'inverse) n'est pas refusé — c'est
  // un remboursement, légitime — mais il est nommé, parce que c'est aussi l'erreur la plus facile.
  function choixDeCategorie(verbe: string): ReactNode {
    if (categoriesRecettes.length + categoriesDepenses.length === 0) {
      return (
        <p className="fiche-mouvement-note">
          Aucune catégorie de ce dossier n’a de compte de charge ou de produit (classe 6 ou 7) : il en
          faut un pour affecter ce mouvement.
        </p>
      )
    }
    return (
      <div className="field">
        <label htmlFor="affecter-categorie">Catégorie</label>
        <div className="fiche-mouvement-choix">
          <select id="affecter-categorie" value={categorieChoisie} onChange={(e) => setCategorieChoisie(e.target.value)}>
            <option value="">— Choisir —</option>
            {groupesDeCategories.filter((g) => g.liste.length > 0).map((g) => (
              <optgroup key={g.titre} label={g.titre}>
                {g.liste.map((c) => (
                  <option key={c.id} value={c.id}>{c.libelle} ({c.compte_comptable})</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline"
            disabled={!categorieCible || !!refus || occupe || regleBloquee}
            onClick={() => onAffecter(categorieChoisie, retenirRegle ? motifNormalise : null, taux)}
          >
            {verbe}
          </button>
        </div>
        {tauxDemande && (
          <div className="fiche-mouvement-taux">
            <label htmlFor="affecter-taux">Taux de TVA de cette recette</label>
            <select id="affecter-taux" value={tauxChoisi} onChange={(e) => setTauxChoisi(e.target.value)}>
              <option value="">— Choisir le taux —</option>
              {TAUX_TVA_RELEVE.map((t) => (
                <option key={t} value={String(t)}>{t === 0 ? 'Exonérée ou non imposable' : libelleTaux(t)}</option>
              ))}
            </select>
            <p className="fiche-mouvement-note">
              {tauxManquant
                ? 'Le dossier est assujetti à la TVA, et le relevé ne dit pas celle d’une recette : choisis son taux. Rien n’est deviné.'
                : ventilationTva
                  ? `Recette au hors taxe : ${formatMoney(ventilationTva.ht)} · TVA collectée (445710) : ${formatMoney(ventilationTva.tva)}. Elle entre dans la CA3 à la date du mouvement.`
                  : 'Sans TVA : la recette entière, en E2 de la CA3 (opérations non imposables).'}
            </p>
          </div>
        )}
        {regleProposee && categorieChoisie === regleProposee.categorie_id && (
          <p className="fiche-mouvement-note">
            Une règle range les {regleProposee.sens === 'encaissement' ? 'encaissements' : 'paiements'} contenant
            {' '}« {regleProposee.motif} » dans cette catégorie
            {tauxDemande && regleProposee.taux_tva != null ? `, ${regleProposee.taux_tva === 0 ? 'sans TVA' : `à ${libelleTaux(regleProposee.taux_tva)}`}` : ''}
            {' '}: elle est présélectionnée, rien n’est écrit sans ton clic.
          </p>
        )}
        {resultatRegle?.etat === 'conflit' && (
          <p className="fiche-mouvement-alerte">
            Plusieurs règles reconnaissent ce libellé sans s’accorder sur la catégorie
            ({resultatRegle.regles.map((r) => `« ${r.motif} »`).join(', ')}) : choisis-la ici, et retire dans Banque
            la règle qui n’a pas lieu d’être.
          </p>
        )}
        {refus && !tauxManquant && <p className="fiche-mouvement-alerte">{refus}</p>}
        {inhabituel && (
          <p className="fiche-mouvement-alerte">
            {ligne.montant > 0
              ? 'C’est un encaissement, et cette catégorie est une dépense : il la diminuera, comme un remboursement. Si c’est une recette — des honoraires encaissés —, choisis une catégorie de recettes.'
              : 'C’est un paiement, et cette catégorie est une recette : il la diminuera, comme un remboursement consenti. Si c’est une dépense, choisis une catégorie de dépenses.'}
          </p>
        )}
        {sens && (
          <div className="fiche-mouvement-regle">
            <label className="fiche-mouvement-case">
              <input
                type="checkbox"
                checked={retenirRegle}
                disabled={!!reglesIncompletes}
                onChange={(e) => setRetenirRegle(e.target.checked)}
              />
              Retenir : proposer aussi les autres {sens === 'encaissement' ? 'encaissements' : 'paiements'} dont le libellé contient…
            </label>
            {reglesIncompletes && (
              <p className="fiche-mouvement-note">
                Les règles d’affectation n’ont pas pu être lues en entier : on ne peut pas savoir laquelle une
                nouvelle remplacerait. Recharge la page pour en retenir une.
              </p>
            )}
            {retenirRegle && (
              <>
                <input
                  type="text"
                  aria-label="Motif de la règle"
                  value={motifRegle}
                  onChange={(e) => setMotifRegle(e.target.value)}
                  placeholder="un mot du libellé qui nomme ce tiers"
                />
                {refusRegle ? (
                  <p className="fiche-mouvement-alerte">{refusRegle}</p>
                ) : (
                  <p className="fiche-mouvement-note">
                    {autresCouverts === 0
                      ? 'Aucun autre mouvement à traiter ne le contient pour l’instant : la règle servira aux prochains relevés.'
                      : `${autresCouverts} autre${autresCouverts > 1 ? 's' : ''} mouvement${autresCouverts > 1 ? 's' : ''} à traiter le contien${autresCouverts > 1 ? 'nent' : 't'} : ${autresCouverts > 1 ? 'ils seront proposés' : 'il sera proposé'} dans « Affectations proposées », et rien ne sera écrit sans ton clic.`}
                    {regleRemplacee && regleRemplacee.categorie_id !== categorieChoisie && (
                      ` Elle remplacera la règle qui les range en « ${categories.find((c) => c.id === regleRemplacee.categorie_id)?.libelle ?? 'catégorie non lue'} ».`
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // Les comptes de bilan proposés, d'un clic, et un compte au choix. Rendu sur un mouvement à traiter et, replié, sur un
  // mouvement déjà écrit sur un compte de bilan — pour en changer : la base remplace alors le compte et l'écriture, et
  // rejouer le même compte réécrit une écriture qui ne le suivrait plus.
  function choixDeCompteDeBilan(): ReactNode {
    return (
      <>
        {refusDuMouvementSurBilan && <p className="fiche-mouvement-alerte">{refusDuMouvementSurBilan}</p>}
        <div className="fiche-mouvement-boutons">
          {COMPTES_DE_BILAN_PROPOSES.map((c) => (
            <button
              key={c.compte}
              type="button"
              className="btn btn-outline btn-sm"
              title={c.aide}
              disabled={occupe || !!refusDuCompteDeBilan(c.compte)}
              onClick={() => onEcrireCompteBilan(c.compte)}
            >
              {c.libelle} ({c.compte})
            </button>
          ))}
          {!autreCompteDeplie && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAutreCompteDeplie(true)}>
              Autre compte de bilan…
            </button>
          )}
        </div>
        {autreCompteDeplie && (
          <div className="field">
            <label htmlFor={`compte-bilan-${ligne.id}`}>Autre compte de bilan (classe 1 à 5)</label>
            <div className="fiche-mouvement-choix">
              <input
                id={`compte-bilan-${ligne.id}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="ex. 274100"
                value={compteSaisi}
                onChange={(e) => setCompteSaisi(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline"
                disabled={!saisieCompte.compte || !!refusSaisie || !!refusDuMouvementSurBilan || occupe}
                onClick={() => saisieCompte.compte && onEcrireCompteBilan(saisieCompte.compte)}
              >
                Écrire sur ce compte
              </button>
            </div>
            {refusSaisie && <p className="fiche-mouvement-alerte">{refusSaisie}</p>}
            {saisieCompte.compte && !refusSaisie && (
              <p className="fiche-mouvement-note">
                Compte {saisieCompte.compte}{libelleSaisi ? ` — ${libelleSaisi}` : ''}, face à la banque.
              </p>
            )}
          </div>
        )}
      </>
    )
  }

  // Les déclarations de TVA au choix et leur bouton. Rendu sur un mouvement à traiter et, replié, sur un mouvement déjà
  // rapproché d'une déclaration — pour le rapprocher d'une autre : la base remplace alors le lien et l'écriture.
  function choixDeDeclarationTva(verbe: string): ReactNode {
    return (
      <>
        {declarationsAuChoix.length === 0 ? (
          <p className="fiche-mouvement-note">
            {encaissement
              ? 'Aucune déclaration enregistrée avant ce mouvement n’a demandé le remboursement d’un crédit de TVA (ligne 26).'
              : 'Aucune déclaration enregistrée avant ce mouvement n’a de TVA à payer.'}
          </p>
        ) : (
          <div className="field">
            <label htmlFor={`rapprocher-declaration-${ligne.id}`}>Déclaration de TVA</label>
            <div className="fiche-mouvement-choix">
              <select
                id={`rapprocher-declaration-${ligne.id}`}
                value={declarationChoisie}
                onChange={(e) => setDeclarationChoisie(e.target.value)}
              >
                <option value="">— Choisir —</option>
                {declarationsAuChoix.map((d) => (
                  <option key={d.id} value={d.id}>{libelleDeclarationTva(d)}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!declarationCible || !!refusDeclarationChoisie || occupe}
                onClick={() => onRapprocherDeclarationTva(declarationChoisie)}
              >
                {verbe}
              </button>
            </div>
            {refusDeclarationChoisie && <p className="fiche-mouvement-alerte">{refusDeclarationChoisie}</p>}
          </div>
        )}
        {releveIncomplet && (
          <p className="fiche-mouvement-note">
            Le relevé n’a pas pu être lu en entier : ce que chaque déclaration a déjà reçu n’est pas connu, et aucune n’est
            proposée. Recharge la page.
          </p>
        )}
        {declarationsTvaIncompletes && <NoteDeclarationsIncompletes />}
      </>
    )
  }

  let principal: ReactNode = null
  if (fige) {
    // Rien à proposer : annuler, reclasser ou rapprocher, la base refuse tout (voir `figeePar`).
  } else if (piecesCandidates.length === 1) {
    principal = (
      <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onRapprocher(piecesCandidates[0].id)}>
        Associer cette pièce
      </button>
    )
  } else if (echeancesCandidates.length === 1) {
    principal = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={occupe || !!refusEcheance(echeancesCandidates[0])}
        onClick={() => onRapprocherCotisation(echeancesCandidates[0].id)}
      >
        Associer cette échéance
      </button>
    )
  } else if (declarationTvaProposee) {
    principal = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={occupe || !!refusPaiementTva(ligne, declarationTvaProposee)}
        onClick={() => onRapprocherDeclarationTva(declarationTvaProposee.id)}
      >
        Rapprocher de cette déclaration
      </button>
    )
  } else if (recurrent) {
    principal = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={occupe}
        onClick={recurrent.action === 'virement_personnel' ? onVirementPersonnel : onIgnorer}
      >
        {recurrent.action === 'virement_personnel' ? 'Virement personnel' : 'Ignorer'}, comme les {recurrent.occurrences} précédents
      </button>
    )
  } else if (rapprocheEmprunt) {
    // Par la base : l'écriture de l'échéance part avec son rapprochement (`retirer_echeance_emprunt`).
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRetirerEmprunt}>
        Annuler le rapprochement
      </button>
    )
  } else if (regleEnGroupe) {
    // Par la base : les parts et les écritures du mouvement partent avec le règlement (`retirer_reglement_groupe`).
    // Suspendu sur une lecture partielle des parts : les pièces qu'il réglait retournent à la date de leur
    // facture, et celles qu'on n'a pas lues n'y retourneraient pas.
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe || !!reglementsIncomplets} onClick={onRetirerReglementGroupe}>
        Annuler le règlement groupé
      </button>
    )
  } else if (ventile) {
    // Par la base : les parts et l'écriture partent avec la ventilation (`retirer_ventilation_mouvement_bancaire`).
    // Une remise à « à traiter » par une simple mise à jour, la contrainte `lignes_bancaires_ventilation_rapprochee`
    // la refuserait de toute façon.
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRetirerVentilation}>
        Annuler la ventilation
      </button>
    )
  } else if (affecte) {
    // Par la base, jamais par une remise à « à traiter » : l'écriture du mouvement part avec son
    // affectation, dans la même transaction (`retirer_affectation_mouvement_bancaire`).
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRetirerAffectation}>
        Annuler l’affectation
      </button>
    )
  } else if (surCompteDeBilan) {
    // Par la base : l'écriture part avec le compte (`retirer_mouvement_compte_bilan`). Une simple remise à « à traiter »,
    // la contrainte `lignes_bancaires_compte_bilan_rapproche` la refuserait de toute façon.
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRetirerCompteBilan}>
        Remettre à traiter
      </button>
    )
  } else if (paieUneDeclaration) {
    // Par la base : l'écriture part avec le lien (`retirer_rapprochement_declaration_tva`). Une simple remise à « à
    // traiter », la contrainte `lignes_bancaires_declaration_tva_rapprochee` la refuserait de toute façon.
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRetirerDeclarationTva}>
        Annuler le rapprochement
      </button>
    )
  } else if (ligne.statut === 'rapprochee') {
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRemettreATraiter}>
        Annuler le rapprochement
      </button>
    )
  } else if (ligne.statut === 'ignoree') {
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRemettreATraiter}>
        Remettre à traiter
      </button>
    )
  }

  return (
    <div className="fiche-mouvement">
      {/* Pas de sous-titre : le libellé ouvre le corps, en entier — un libellé bancaire est souvent
          long, et l'en-tête le couperait. Répété juste au-dessus, il se lisait deux fois. */}
      <EntetePanneau
        titre={navigation.position}
        actions={(
          <>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.precedent ?? undefined}
              disabled={!navigation.precedent}
              aria-label="Mouvement précédent"
              title="Mouvement précédent"
            >
              <IconPrecedent width={18} height={18} />
            </button>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.suivant ?? undefined}
              disabled={!navigation.suivant}
              aria-label="Mouvement suivant"
              title="Mouvement suivant"
            >
              <IconChevron width={18} height={18} />
            </button>
          </>
        )}
        onFermer={onFermer}
      />

      <div className="fiche-mouvement-corps">
        <p className="fiche-mouvement-libelle">{libelle}</p>
        <div className="fiche-mouvement-tuiles">
          <div className="fiche-mouvement-tuile"><span>Date</span><strong>{formatDate(ligne.date)}</strong></div>
          <div className="fiche-mouvement-tuile"><span>Montant</span><strong>{formatMoney(ligne.montant)}</strong></div>
        </div>

        <div className="fiche-mouvement-etat">
          {ligne.prelevement_personnel && <span className="badge badge-neutral">Virement personnel</span>}
          {/* Une pastille verte sur un mouvement qui ne désigne plus rien serait une affirmation fausse,
              indiscernable d'un vrai rapprochement — voir `mouvementRapprocheSansObjet`. */}
          {!ligne.prelevement_personnel && sansObjet && <span className="badge badge-danger">Rapproché sans justificatif</span>}
          {!ligne.prelevement_personnel && affecte && (
            <span className="badge badge-ok">Affecté{categorieAffectee ? ` à « ${categorieAffectee.libelle} »` : ''}</span>
          )}
          {rapprocheEmprunt && (
            <span className="badge badge-ok">
              {deblocage ? 'Déblocage d’emprunt' : `Échéance n° ${ligne.emprunt_echeance}`}{empruntLie ? ` — ${empruntLie.nom}` : ''}
            </span>
          )}
          {ventile && (
            <span className="badge badge-ok">
              {ventilations.length >= 2 ? `Ventilé sur ${ventilations.length} comptes` : 'Ventilé'}
            </span>
          )}
          {regleEnGroupe && (
            <span className="badge badge-ok">
              {!reglementsIncomplets && reglements.length >= 2 ? `Règle ${reglements.length} pièces` : 'Règle plusieurs pièces'}
            </span>
          )}
          {surCompteDeBilan && <span className="badge badge-ok">Écrit au {ligne.compte_bilan}</span>}
          {paieUneDeclaration && (
            <span className="badge badge-ok">
              {encaissement ? 'Remboursement de TVA' : 'Paiement de TVA'}
              {suiviPaye ? ` — ${libellePeriode(suiviPaye.declaration.periode_debut, suiviPaye.declaration.periode_fin)}` : ''}
            </span>
          )}
          {!ligne.prelevement_personnel && ligne.statut === 'rapprochee' && !sansObjet && !affecte && !rapprocheEmprunt && !ventile && !regleEnGroupe && !surCompteDeBilan && !paieUneDeclaration && <span className="badge badge-ok">Rapproché</span>}
          {pastillesPaiement.map((texte) => <span key={texte} className="badge badge-danger">{texte}</span>)}
          {!ligne.prelevement_personnel && aTraiter && <span className="badge badge-warning">Non rapproché</span>}
          {!ligne.prelevement_personnel && ligne.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
        </div>

        {figeePar && (
          <p className="fiche-mouvement-note">
            {figeePar} : ce mouvement ne se rapproche, ne se classe et ne se modifie plus. Une erreur trouvée après la
            validation se corrige sur l’exercice suivant.
          </p>
        )}

        {piecesCandidates.length === 1 && (
          <section className="fiche-mouvement-section">
            <h3>Pièce proposée</h3>
            <CartePiece piece={piecesCandidates[0]} signaux={signauxPiece(piecesCandidates[0], ligne)} />
          </section>
        )}
        {piecesCandidates.length > 1 && (
          <section className="fiche-mouvement-section">
            <h3>{piecesCandidates.length} pièces conviennent aussi bien</h3>
            <p className="fiche-mouvement-note">
              Même montant, dates proches : ouvre les justificatifs avant de choisir. C’est pour cette
              raison que le rapprochement automatique laisse ce mouvement de côté.
            </p>
            {piecesCandidates.map((p) => (
              <CartePiece
                key={p.id}
                piece={p}
                signaux={signauxPiece(p, ligne)}
                action={(
                  <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => onRapprocher(p.id)}>
                    Associer celle-ci
                  </button>
                )}
              />
            ))}
          </section>
        )}
        {echeancesCandidates.length === 1 && (
          <section className="fiche-mouvement-section">
            <h3>Échéance proposée</h3>
            <CarteCotisation cotisation={echeancesCandidates[0]} signaux={signauxCotisation(echeancesCandidates[0], ligne)} />
            {refusEcheance(echeancesCandidates[0]) && <p className="fiche-mouvement-alerte">{refusEcheance(echeancesCandidates[0])}</p>}
          </section>
        )}
        {echeancesCandidates.length > 1 && (
          <section className="fiche-mouvement-section">
            <h3>{echeancesCandidates.length} échéances conviennent aussi bien</h3>
            {echeancesCandidates.map((c) => (
              <CarteCotisation
                key={c.id}
                cotisation={c}
                signaux={signauxCotisation(c, ligne)}
                action={(
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={occupe || !!refusEcheance(c)}
                    title={refusEcheance(c) ?? undefined}
                    onClick={() => onRapprocherCotisation(c.id)}
                  >
                    Associer celle-ci
                  </button>
                )}
              />
            ))}
          </section>
        )}
        {recurrent && (
          <section className="fiche-mouvement-section">
            <h3>Mouvement récurrent</h3>
            {/* Au pluriel sans détour : une récurrence n'est proposée qu'à partir de deux occurrences
                passées (voir `suggestionRecurrente`, BanqueTab). */}
            <p className="fiche-mouvement-note">
              Même montant, à trois jours près dans le mois, que {recurrent.occurrences} mouvements déjà
              {recurrent.action === 'virement_personnel' ? ' classés en virement personnel.' : ' ignorés.'}
            </p>
          </section>
        )}
        {plausible && (
          <section className="fiche-mouvement-section">
            <h3>{plausible.echeance ? 'Échéance d’emprunt proposée' : 'Déblocage d’emprunt proposé'}</h3>
            <p className="fiche-mouvement-note">
              {plausible.echeance
                ? `Ce paiement ressemble à l’échéance n° ${plausible.echeance.numero} de « ${plausible.emprunt.nom} » : le capital va au compte ${COMPTE_EMPRUNT}, les intérêts au ${COMPTE_INTERETS_EMPRUNT}, l’assurance au ${COMPTE_ASSURANCE_EMPRUNT}. Vérifie le découpage avant de rapprocher.`
                : `Cet encaissement ressemble au déblocage de « ${plausible.emprunt.nom} ».`}
            </p>
            <FormulaireEmprunt
              ligne={ligne} emprunts={emprunts} lignes={lignes} plausible={plausible} occupe={occupe}
              verbe={plausible.echeance ? 'Rapprocher de cette échéance' : 'Rapprocher du déblocage'}
              onRapprocherEmprunt={onRapprocherEmprunt}
            />
            {empruntsIncomplets && <NoteEmpruntsIncomplets />}
          </section>
        )}
        {declarationTvaProposee && (
          <section className="fiche-mouvement-section">
            <h3>{encaissement ? 'Remboursement de TVA proposé' : 'Paiement de TVA proposé'}</h3>
            <CarteDeclarationTva
              declaration={declarationTvaProposee}
              suivi={suivisTva.find((x) => x.declaration.id === declarationTvaProposee.id) ?? null}
              encaissement={encaissement}
              signaux={signauxDeclarationTva(declarationTvaProposee, ligne)}
            />
            {refusPaiementTva(ligne, declarationTvaProposee) && (
              <p className="fiche-mouvement-alerte">{refusPaiementTva(ligne, declarationTvaProposee)}</p>
            )}
            <p className="fiche-mouvement-note">{noteEcritureTva}</p>
          </section>
        )}
        {declarationsExactes.length > 1 && (
          <section className="fiche-mouvement-section">
            <h3>{declarationsExactes.length} déclarations de TVA conviennent aussi bien</h3>
            <p className="fiche-mouvement-note">
              Ce mouvement règle exactement le reste de chacune : choisis celle qu’il paie, d’après son libellé ou l’avis
              de prélèvement.
            </p>
            {declarationsExactes.map((d) => (
              <CarteDeclarationTva
                key={d.id}
                declaration={d}
                suivi={suivisTva.find((x) => x.declaration.id === d.id) ?? null}
                encaissement={encaissement}
                signaux={signauxDeclarationTva(d, ligne)}
                action={(
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={occupe || !!refusPaiementTva(ligne, d)}
                    title={refusPaiementTva(ligne, d) ?? undefined}
                    onClick={() => onRapprocherDeclarationTva(d.id)}
                  >
                    Rapprocher de celle-ci
                  </button>
                )}
              />
            ))}
          </section>
        )}
        {aTraiter && !unePropositionExiste && !recurrent && !plausible && declarationsExactes.length === 0 && (
          <p className="fiche-mouvement-vide">Aucune pièce proposée pour ce mouvement.</p>
        )}
        {figeeDeMemeMontant && (
          <p className="fiche-mouvement-note">
            {`${nomDeLaPiece(figeeDeMemeMontant)} (${formatDate(figeeDeMemeMontant.date_piece)}, ${formatMoney(figeeDeMemeMontant.montant_ttc)}), du même montant, porte une écriture d’un exercice validé : elle ne se rapproche plus d’aucun mouvement.`}
            {figeeDeMemeMontant.type_piece === 'note_frais' && ' Si ce mouvement rembourse cette note de frais, classe-le en virement personnel.'}
          </p>
        )}

        {aTraiter && (
          <section className="fiche-mouvement-section">
            <h3>{unePropositionExiste ? 'Choisir une autre pièce' : 'Choisir une pièce'}</h3>
            {piecesAuChoix.length > 0 && (
              <div className="field">
                <label htmlFor="associer-piece">Pièce</label>
                <div className="fiche-mouvement-choix">
                  <select id="associer-piece" value={pieceChoisie} onChange={(e) => setPieceChoisie(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {piecesAuChoix.map((p) => {
                      const reste = restesARegler.get(p.id)
                      return (
                        <option key={p.id} value={p.id}>
                          {formatDate(p.date_piece)} — {p.tiers ?? '—'} — {reste != null
                            ? `reste ${formatMoney(reste)} sur ${formatMoney(p.montant_ttc)}`
                            : formatMoney(p.montant_ttc)}
                        </option>
                      )
                    })}
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={!pieceChoisie || occupe || !!refusPieceChoisie}
                    onClick={() => onRapprocher(pieceChoisie)}
                  >
                    Associer
                  </button>
                </div>
                {refusPieceChoisie && <p className="fiche-mouvement-alerte">{refusPieceChoisie}</p>}
                {pieceChoisieDejaPayee && !refusPieceChoisie && (
                  <p className="fiche-mouvement-note">
                    Cette pièce est déjà payée en partie : ce mouvement en règle le reste.
                  </p>
                )}
              </div>
            )}
            {cotisationsAuChoix.length > 0 && (
              <div className="field">
                <label htmlFor="associer-cotisation">Échéance de cotisation</label>
                <div className="fiche-mouvement-choix">
                  <select id="associer-cotisation" value={cotisationChoisie} onChange={(e) => setCotisationChoisie(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {cotisationsAuChoix.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatDate(c.echeance)} — {formatMoney(c.montant_verse ?? c.montant_appele)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={!cotisationChoisie || occupe || !!refusChoix}
                    onClick={() => onRapprocherCotisation(cotisationChoisie)}
                  >
                    Associer
                  </button>
                </div>
                {refusChoix && <p className="fiche-mouvement-alerte">{refusChoix}</p>}
              </div>
            )}
            {aucuneReference && (
              <p className="fiche-mouvement-note">
                Aucune pièce ni échéance de cotisation enregistrée dans ce dossier pour l’instant — dépose
                et valide d’abord le justificatif correspondant (Justificatifs), ou déclare l’échéance
                (Cotisations).
              </p>
            )}
            {toutDejaRapproche && (
              <p className="fiche-mouvement-note">
                {figeesSansPaiement
                  ? 'Les pièces et échéances de ce dossier sont déjà rapprochées d’un autre mouvement, ou figées par un ' +
                    'exercice validé — si aucune ne correspond en réalité, vérifie un éventuel rapprochement fait par erreur ailleurs.'
                  : 'Toutes les pièces et échéances de ce dossier sont déjà rapprochées d’un autre mouvement — si aucune ne ' +
                    'correspond en réalité, vérifie un éventuel rapprochement fait par erreur ailleurs.'}
              </p>
            )}
          </section>
        )}

        {tvaOfferte && (
          <section className="fiche-mouvement-section">
            <h3>{encaissement ? 'Remboursement de TVA' : 'Paiement de TVA'}</h3>
            {declarationsExactes.length === 0 && <p className="fiche-mouvement-note">{noteEcritureTva}</p>}
            {choixDeDeclarationTva('Rapprocher')}
          </section>
        )}

        {aTraiter && ligne.montant !== 0 && (
          <section className="fiche-mouvement-section">
            <h3>Plusieurs pièces</h3>
            {reglementDeplie ? (
              <FormulaireReglementGroupe
                ligne={ligne} pieces={piecesReglables} paiements={paiements} partsExistantes={[]} suspension={reglementsIncomplets}
                occupe={occupe} verbe="Régler ces pièces" onRegler={onReglerEnGroupe}
              />
            ) : (
              <>
                <p className="fiche-mouvement-note">
                  Un virement qui solde plusieurs factures — ou un règlement client qui en paie plusieurs, un avoir
                  déduit d’un paiement — se répartit entre elles : une part par pièce, et leur somme est le mouvement.
                </p>
                <div className="fiche-mouvement-boutons">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setReglementDeplie(true)}>
                    Régler plusieurs pièces…
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {aTraiter && (
          <section className="fiche-mouvement-section">
            <h3>Sans justificatif</h3>
            <p className="fiche-mouvement-note">
              Un mouvement qui n’aura pas de facture — des frais bancaires, un encaissement de
              l’Assurance maladie — s’affecte à une catégorie : il est écrit au brouillon sur son compte,
              et compté dans la 2035 à la date du mouvement.
            </p>
            {justificatifAttendu && (
              <p className="fiche-mouvement-alerte">
                {justificatifAttendu} Avant d’affecter, vérifie que ce n’est pas ce paiement : affecté, il
                compterait dans la 2035 à côté de sa pièce.
              </p>
            )}
            {plausible && (
              <p className="fiche-mouvement-alerte">
                {plausible.echeance
                  ? 'Ce paiement ressemble à une échéance d’emprunt (ci-dessus) : affecté à une catégorie, son capital compterait en charge.'
                  : 'Cet encaissement ressemble au déblocage d’un emprunt (ci-dessus) : affecté à une catégorie, il compterait en recette.'}
              </p>
            )}
            {declarationsExactes.length > 0 && (
              <p className="fiche-mouvement-alerte">
                {encaissement
                  ? 'Cet encaissement ressemble au remboursement d’un crédit de TVA (ci-dessus) : affecté à une catégorie, il compterait en recette.'
                  : 'Ce paiement ressemble au paiement d’une déclaration de TVA (ci-dessus) : affecté à une catégorie, la TVA compterait en charge.'}
              </p>
            )}
            {choixDeCategorie('Affecter')}
            <div className="fiche-mouvement-boutons">
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={onVirementPersonnel}>Virement personnel</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={onIgnorer}>Ignorer</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={onToujoursIgnorer}>Toujours ignorer ce type…</button>
            </div>
            <p className="fiche-mouvement-note">
              « Virement personnel » : entre le compte pro et le compte personnel, il s’écrit sur le compte{' '}
              {compteDirigeant} ({libelleCompteDirigeant}), face à la banque — ni charge ni recette.
            </p>
            <p className="fiche-mouvement-note">
              « Ignorer » n’écrit rien, ni au brouillon ni au FEC : il convient à un doublon, ou à un mouvement antérieur aux
              à-nouveaux d’un dossier repris. Un vrai mouvement ignoré manque au FEC, et la Vue d’ensemble le compte.
            </p>
          </section>
        )}

        {aTraiter && ligne.montant !== 0 && (
          <section className="fiche-mouvement-section">
            <h3>Sur un compte de bilan</h3>
            <p className="fiche-mouvement-note">
              Ni charge ni recette : un virement vers un autre compte du professionnel, un dépôt de garantie versé ou rendu
              s’écrit sur un compte de bilan, face à la banque. La 2035 ne le compte pas ; le FEC le porte avec le relevé
              pour pièce.
            </p>
            {choixDeCompteDeBilan()}
          </section>
        )}

        {aTraiter && ligne.montant !== 0 && (
          <section className="fiche-mouvement-section">
            <h3>Sur plusieurs comptes</h3>
            {ventilationDepliee ? (
              <FormulaireVentilation
                ligne={ligne} categories={categories} partsExistantes={[]} assujettiTva={assujettiTva}
                compteDirigeant={compteDirigeant} occupe={occupe} verbe="Ventiler" onVentiler={onVentiler}
              />
            ) : (
              <>
                <p className="fiche-mouvement-note">
                  Un paiement qui relève de plusieurs comptes — deux dépenses, une part personnelle comme un
                  abonnement pris en charge en partie, une remise de carte créditée nette de sa commission — se
                  ventile : une part par compte, et leur somme est le mouvement.
                </p>
                <div className="fiche-mouvement-boutons">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setVentilationDepliee(true)}>
                    Ventiler sur plusieurs comptes…
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {empruntOffert && !plausible && (
          <section className="fiche-mouvement-section">
            <h3>{deblocage ? 'Déblocage d’emprunt' : 'Échéance d’emprunt'}</h3>
            {empruntDeplie ? (
              <FormulaireEmprunt
                ligne={ligne} emprunts={emprunts} lignes={lignes} plausible={null} occupe={occupe}
                verbe={deblocage ? 'Rapprocher du déblocage' : 'Rapprocher de cette échéance'}
                onRapprocherEmprunt={onRapprocherEmprunt}
              />
            ) : (
              <>
                <p className="fiche-mouvement-note">
                  {deblocage
                    ? 'Les fonds reçus d’un emprunt ne sont pas une recette : ils se rapprochent de l’emprunt.'
                    : 'Un prélèvement d’emprunt se découpe : capital, intérêts et assurance ne vont pas sur le même compte.'}
                </p>
                <div className="fiche-mouvement-boutons">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEmpruntDeplie(true)}>
                    Rapprocher d’un emprunt…
                  </button>
                </div>
              </>
            )}
            {empruntsIncomplets && <NoteEmpruntsIncomplets />}
          </section>
        )}

        {rapprocheEmprunt && (
          <section className="fiche-mouvement-section">
            <h3>{deblocage ? 'Déblocage d’emprunt' : 'Échéance d’emprunt'}</h3>
            {empruntLie ? (
              <div className="carte-rapprochement">
                <div className="carte-rapprochement-entete">
                  <div className="carte-rapprochement-titres">
                    <strong>{empruntLie.nom}</strong>
                    <span>
                      {deblocage ? 'Fonds reçus' : `Échéance n° ${ligne.emprunt_echeance} sur ${empruntLie.duree_mois}`}
                      {empruntLie.organisme_preteur ? ` · ${empruntLie.organisme_preteur}` : ''}
                    </span>
                  </div>
                  <strong className="carte-rapprochement-montant">{formatMoney(Math.abs(ligne.montant))}</strong>
                </div>
                <dl className="decoupage-emprunt">
                  {deblocage ? (
                    <>
                      <dt>Emprunt ({COMPTE_EMPRUNT})</dt><dd>{formatMoney(ligne.montant)}</dd>
                    </>
                  ) : (
                    <>
                      <dt>Capital remboursé ({COMPTE_EMPRUNT})</dt>
                      <dd>{formatMoney(capitalDeLEcheance(ligne, decoupageDuMouvement(ligne) ?? { echeance: null, interets: 0, assurance: 0 }))}</dd>
                      <dt>Intérêts ({COMPTE_INTERETS_EMPRUNT})</dt><dd>{formatMoney(ligne.emprunt_interets ?? 0)}</dd>
                      <dt>Assurance ({COMPTE_ASSURANCE_EMPRUNT})</dt><dd>{formatMoney(ligne.emprunt_assurance ?? 0)}</dd>
                    </>
                  )}
                </dl>
              </div>
            ) : (
              // Le lien existe, l'emprunt n'a pas été lu — une lecture partielle, que le bandeau en tête
              // de l'écran annonce déjà.
              <p className="fiche-mouvement-note">L’emprunt rapproché ne figure pas parmi les emprunts lus.</p>
            )}
            <p className="fiche-mouvement-note">
              {deblocage
                ? 'Écrit au brouillon : la banque au débit, l’emprunt au crédit — ni recette, ni charge.'
                : 'Écrit au brouillon face à la banque. Les intérêts comptent en frais financiers dans la 2035, l’assurance en primes d’assurance ; le capital n’y compte pas.'}
            </p>
            {empruntLie && !deblocage && !fige && (correctionDepliee ? (
              <FormulaireEmprunt
                ligne={ligne} emprunts={emprunts} lignes={lignes} plausible={null} occupe={occupe}
                verbe="Enregistrer le découpage"
                onRapprocherEmprunt={onRapprocherEmprunt}
              />
            ) : (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setCorrectionDepliee(true)}>
                  Corriger le découpage…
                </button>
              </div>
            ))}
          </section>
        )}

        {regleEnGroupe && (
          <section className="fiche-mouvement-section">
            <h3>Règle plusieurs pièces</h3>
            {reglementsIncomplets && (
              <p className="fiche-mouvement-note">
                Les parts des règlements groupés n’ont pas pu être lues en entier : celles de ce mouvement peuvent
                manquer ci-dessous, et le modifier comme l’annuler est suspendu. Recharge la page.
              </p>
            )}
            {reglements.length > 0 ? (
              <div className="carte-rapprochement">
                <dl className="decoupage-emprunt">
                  {reglements.map((r) => (
                    <Fragment key={r.id}>
                      <dt>{libellePieceReglee(r)}</dt>
                      <dd>{formatMoney(partReglee(r))}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            ) : !reglementsIncomplets && (
              <p className="fiche-mouvement-note">Aucune part lue pour ce mouvement.</p>
            )}
            {/* La pastille dit combien de ses pièces restent payées en partie ou l'ont été de trop ; ici, lesquelles. */}
            {reglements.flatMap((r) => {
              if (!r.piece_id) return []
              const reste = restesAPayer.get(r.piece_id)
              const enTrop = payeesEnTrop.get(r.piece_id)
              return [
                ...(reste != null ? [(
                  <p key={`${r.id}-reste`} className="fiche-mouvement-alerte">
                    {libellePieceReglee(r)} : reste {formatMoney(reste)} à payer — rapproche le paiement qui manque, ou vérifie le montant de la pièce.
                  </p>
                )] : []),
                ...(enTrop != null ? [(
                  <p key={`${r.id}-trop`} className="fiche-mouvement-alerte">
                    {libellePieceReglee(r)} : payée {formatMoney(enTrop)} de trop — un paiement en double ?
                  </p>
                )] : []),
              ]
            })}
            {/* Ce qui ne justifie plus rien, dit ici — c'est l'écran où l'on arbitre ce mouvement. */}
            {incoherencesGroupe.map((i) => (
              <p key={i.raison} className="fiche-mouvement-alerte">
                {i.raison === 'part_sans_piece'
                  ? `Une pièce que ce mouvement réglait a été supprimée : sa part (${formatMoney(Math.abs(i.montant))}) ne justifie plus rien. Modifie le règlement, ou annule-le.`
                  : `Les parts ne font plus le montant du mouvement (écart de ${formatMoney(Math.abs(i.montant))}) : la 2035 compte ce qu’elles disent, l’écriture autre chose. Modifie le règlement, ou annule-le.`}
              </p>
            ))}
            <p className="fiche-mouvement-note">
              Montants dans le sens du mouvement : un avoir déduit du virement y figure en négatif. Chaque pièce compte
              pour sa part à la date du mouvement, dans la 2035 comme dans la déclaration de TVA, et son écriture reçoit
              une contrepartie banque de ce montant.
            </p>
            {!reglementsIncomplets && !fige && (modificationReglementDepliee ? (
              <FormulaireReglementGroupe
                ligne={ligne} pieces={piecesReglables} paiements={paiements} partsExistantes={reglements} suspension={reglementsIncomplets}
                occupe={occupe} verbe="Enregistrer le règlement" onRegler={onReglerEnGroupe}
              />
            ) : (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setModificationReglementDepliee(true)}>
                  Modifier le règlement…
                </button>
              </div>
            ))}
          </section>
        )}

        {ventile && (
          <section className="fiche-mouvement-section">
            <h3>Ventilé sur plusieurs comptes</h3>
            {ventilationsIncompletes && (
              <p className="fiche-mouvement-note">
                Les parts des mouvements ventilés n’ont pas pu être lues en entier : celles de ce mouvement peuvent
                manquer ci-dessous, et la modifier est suspendu. Recharge la page.
              </p>
            )}
            {ventilations.length > 0 ? (
              <div className="carte-rapprochement">
                <dl className="decoupage-emprunt">
                  {ventilations.map((v) => (
                    <Fragment key={v.id}>
                      <dt>{libellePart(v)}</dt>
                      <dd>{formatMoney(montantSaisi(ligne, v))}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            ) : !ventilationsIncompletes && (
              <p className="fiche-mouvement-note">Aucune part lue pour ce mouvement.</p>
            )}
            {/* Ce que la 2035 ne comptera pas, dit ici — c'est l'écran où l'on arbitre ce mouvement. */}
            {ventilationIncoherente && (
              <p className="fiche-mouvement-alerte">
                Les parts enregistrées ne font plus le montant du mouvement : la 2035 compte ce qu’elles disent,
                l’écriture autre chose. Modifie la ventilation, ou annule-la.
              </p>
            )}
            {!fige && partsHorsResultat.length > 0 && (
              <p className="fiche-mouvement-alerte">
                {partsHorsResultat.length > 1
                  ? `Les comptes de ${partsHorsResultat.map((c) => `« ${c.libelle} »`).join(', ')} ne sont plus des comptes de charge ou de produit : leurs parts ne comptent dans aucun total, et l’écriture n’est plus juste. Modifie la ventilation.`
                  : `Le compte de « ${partsHorsResultat[0].libelle} » n’est plus un compte de charge ou de produit : sa part ne compte dans aucun total, et l’écriture n’est plus juste. Modifie la ventilation.`}
              </p>
            )}
            {!fige && partsRecetteSansTaux.length > 0 && (
              <p className="fiche-mouvement-alerte">
                {partsRecetteSansTaux.length > 1
                  ? `Le dossier est assujetti à la TVA et ${partsRecetteSansTaux.length} parts de recette n’ont pas de taux : leur TVA n’est dans aucune déclaration, et la 2035 la compte en recette. Modifie la ventilation pour choisir leur taux.`
                  : `Le dossier est assujetti à la TVA et la part « ${libellePart(partsRecetteSansTaux[0])} » n’a pas de taux : sa TVA n’est dans aucune déclaration, et la 2035 la compte en recette. Modifie la ventilation pour choisir son taux.`}
              </p>
            )}
            {!fige && partsSansPoste.length > 0 && (
              <p className="fiche-mouvement-alerte">
                {partsSansPoste.length > 1
                  ? `${partsSansPoste.map((c) => `« ${c.libelle} »`).join(', ')} n’ont pas de poste 2035 : leurs parts n’entrent dans aucun total de la 2035 tant qu’il n’est pas renseigné (Clôture).`
                  : `« ${partsSansPoste[0].libelle} » n’a pas de poste 2035 : sa part n’entre dans aucun total de la 2035 tant qu’il n’est pas renseigné (Clôture).`}
              </p>
            )}
            <p className="fiche-mouvement-note">
              Écrit au brouillon face à la banque, une ligne par part. Chaque part compte dans la 2035 dans le poste
              de sa catégorie, à la date du mouvement ; la part personnelle n’y compte pas.
            </p>
            {!ventilationsIncompletes && !fige && (modificationDepliee ? (
              <FormulaireVentilation
                ligne={ligne} categories={categories} partsExistantes={ventilations} assujettiTva={assujettiTva}
                compteDirigeant={compteDirigeant} occupe={occupe} verbe="Enregistrer la ventilation" onVentiler={onVentiler}
              />
            ) : (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setModificationDepliee(true)}>
                  Modifier la ventilation…
                </button>
              </div>
            ))}
          </section>
        )}

        {ligne.prelevement_personnel && (
          <section className="fiche-mouvement-section">
            <h3>Virement personnel</h3>
            <p className="fiche-mouvement-note">
              Ni charge ni recette : il s’écrit sur le compte {compteDirigeant} ({libelleCompteDirigeant}), face
              à la banque.{!fige && ' « Remettre à traiter » retire aussi son écriture ; l’onglet Virements dit si elle manque, et l’écrit.'}
            </p>
          </section>
        )}

        {surCompteDeBilan && (
          <section className="fiche-mouvement-section">
            <h3>Écrit sur un compte de bilan</h3>
            <div className="carte-rapprochement">
              <div className="carte-rapprochement-entete">
                <div className="carte-rapprochement-titres">
                  <strong>{compteDeBilanPropose?.libelle ?? libelleCompteDeBilan ?? 'Compte de bilan'}</strong>
                  <span>
                    Compte {ligne.compte_bilan}
                    {compteDeBilanPropose && libelleCompteDeBilan ? ` — ${libelleCompteDeBilan}` : ''}
                    {ligne.montant < 0 ? ' · au débit' : ' · au crédit'}
                  </span>
                </div>
              </div>
            </div>
            <p className="fiche-mouvement-note">
              Ni charge ni recette : écrit au brouillon face à la banque, à la date du mouvement. La 2035 ne le compte pas ;
              le FEC le porte au journal de banque, avec le relevé pour pièce.
              {compteDeBilanPropose ? ` ${compteDeBilanPropose.aide}` : ''}
            </p>
            {!fige && (changementCompteDeplie ? choixDeCompteDeBilan() : (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setChangementCompteDeplie(true)}>
                  Changer de compte…
                </button>
              </div>
            ))}
          </section>
        )}

        {paieUneDeclaration && (
          <section className="fiche-mouvement-section">
            <h3>{encaissement ? 'Remboursement de TVA' : 'Paiement de TVA'}</h3>
            {suiviPaye ? (
              <CarteDeclarationTva
                declaration={suiviPaye.declaration}
                suivi={releveIncomplet ? null : suiviPaye}
                encaissement={encaissement}
              />
            ) : (
              // Le lien existe, la déclaration n'a pas été lue — une lecture partielle, que le bandeau en tête de l'écran
              // annonce déjà.
              <p className="fiche-mouvement-note">La déclaration rapprochée ne figure pas parmi les déclarations de TVA lues.</p>
            )}
            <p className="fiche-mouvement-note">
              {noteEcritureTva}{!fige && ' « Annuler le rapprochement » retire aussi son écriture.'}
            </p>
            {!fige && (changementDeclarationDeplie ? choixDeDeclarationTva('Rapprocher de celle-ci') : (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setChangementDeclarationDeplie(true)}>
                  Changer de déclaration…
                </button>
              </div>
            ))}
          </section>
        )}

        {ligne.statut === 'ignoree' && !ligne.prelevement_personnel && !fige && (
          <p className="fiche-mouvement-note">
            Ignoré : ce mouvement n’est écrit nulle part, ni au brouillon ni au FEC. Cela convient à un doublon, ou à un
            mouvement antérieur aux à-nouveaux d’un dossier repris ; sinon, remets-le à traiter pour le classer.
          </p>
        )}

        {affecte && (
          <section className="fiche-mouvement-section">
            <h3>Affecté à</h3>
            {categorieAffectee ? (
              <div className="carte-rapprochement">
                <div className="carte-rapprochement-entete">
                  <div className="carte-rapprochement-titres">
                    <strong>{categorieAffectee.libelle}</strong>
                    <span>
                      Compte {categorieAffectee.compte_comptable ?? '—'}
                      {categorieAffectee.poste_2035 ? ` · ${categorieAffectee.poste_2035}` : ''}
                      {tauxAffecte != null ? ` · TVA ${libelleTaux(tauxAffecte)}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              // Le lien existe, la catégorie n'a pas été lue — une lecture partielle, que le bandeau en
              // tête de l'écran annonce déjà.
              <p className="fiche-mouvement-note">La catégorie affectée ne figure pas parmi les catégories lues.</p>
            )}
            {/* Ce que la 2035 ne comptera pas, dit ici — c'est l'écran où l'on arbitre ce mouvement. */}
            {!fige && categorieAffectee && !natureAffectee && (
              <p className="fiche-mouvement-alerte">
                Le compte de cette catégorie n’est plus un compte de charge ou de produit : ce mouvement
                ne compte dans aucun total, et son écriture n’est plus juste. Réaffecte-le.
              </p>
            )}
            {/* Une recette affectée avant que le dossier devienne assujetti : sa TVA n'est dans aucune CA3 tant
                qu'on ne choisit pas son taux — le point que la Checklist compte. */}
            {!fige && tauxRequis(assujettiTva, natureAffectee) && ligne.taux_tva == null && (
              <p className="fiche-mouvement-alerte">
                Le dossier est assujetti à la TVA et cette recette n’a pas de taux : sa TVA n’est dans aucune
                déclaration, et la 2035 la compte en recette. Choisis son taux ci-dessous et réaffecte-la.
              </p>
            )}
            {!fige && categorieAffectee && natureAffectee && !categorieAffectee.poste_2035 && (
              <p className="fiche-mouvement-alerte">
                Cette catégorie n’a pas de poste 2035 : ce mouvement n’entre dans aucun total de la 2035
                tant qu’il n’est pas renseigné (Clôture).
              </p>
            )}
            {!fige && choixDeCategorie('Réaffecter')}
          </section>
        )}

        {ligne.statut === 'rapprochee' && !sansObjet && !affecte && !rapprocheEmprunt && !ventile && !regleEnGroupe && !surCompteDeBilan && !paieUneDeclaration && (
          <section className="fiche-mouvement-section">
            <h3>Rapproché avec</h3>
            {piecePayee && <CartePiece piece={piecePayee} />}
            {cotisationPayee && <CarteCotisation cotisation={cotisationPayee} />}
            {ecritureEcheancePayee.length > 0 && (
              <p className="fiche-mouvement-note">
                S’écrit face à la banque :{' '}
                {ecritureEcheancePayee.map((l) => `${formatMoney(l.montant)} au ${l.compte} — ${LIBELLES_COMPTES[l.compte] ?? l.compte}${l.compte === COMPTE_EXPLOITANT ? ' (sa CSG-CRDS)' : ''}`).join(' ; ')}.
                {!fige && ' « Annuler le rapprochement » retire aussi son écriture ; l’onglet Cotisations dit si elle manque, et l’écrit.'}
              </p>
            )}
            {/* Le lien existe mais la ligne n'a pas été lue — une lecture partielle, que le bandeau en
                tête de l'écran annonce déjà. Dit ici plutôt qu'une section vide sous « Rapproché avec ». */}
            {ligne.piece_id && !piecePayee && <p className="fiche-mouvement-note">La pièce rapprochée ne figure pas parmi les pièces lues.</p>}
            {ligne.cotisation_id && !cotisationPayee && <p className="fiche-mouvement-note">L’échéance rapprochée ne figure pas parmi les échéances lues.</p>}
            {refusEcheancePayee && (
              <p className="fiche-mouvement-alerte">
                Ce rapprochement ne peut pas s’écrire : {refusEcheancePayee} L’échéance reste comptée à sa date, et
                le mouvement manque au FEC.{!fige && ' Annule-le pour le refaire.'}
              </p>
            )}
          </section>
        )}
        {sansObjet && (
          <p className="fiche-mouvement-alerte">
            La pièce ou l’échéance que désignait ce rapprochement a été supprimée : ce mouvement n’est plus
            rattaché à rien. Annule le rapprochement pour le refaire.
          </p>
        )}

        {/* Traçabilité de l'import (voir audit ergonomie) — surtout utile quand le libellé est retombé
            sur le générique « Mouvement bancaire » : de quoi retrouver le fichier et la ligne d'origine
            sans rouvrir le relevé. Absente sur tout import antérieur à cet ajout. */}
        {(ligne.source_fichier || (ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle)) && (
          <p className="fiche-mouvement-origine">
            {ligne.source_fichier && <>Importé depuis « {ligne.source_fichier} »</>}
            {ligne.source_fichier && ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle && ' — '}
            {ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle && <>ligne brute : {ligne.libelle_brut}</>}
          </p>
        )}
      </div>

      {principal && <div className="fiche-mouvement-pied">{principal}</div>}
    </div>
  )
}

function NoteDeclarationsIncompletes() {
  return (
    <p className="fiche-mouvement-note">
      Les déclarations de TVA n’ont pas pu être lues en entier : une déclaration peut manquer à ce choix. Recharge la page.
    </p>
  )
}

function NoteEmpruntsIncomplets() {
  return (
    <p className="fiche-mouvement-note">
      La liste des emprunts n’a pas pu être lue en entier : un emprunt peut manquer à ce choix. Recharge la page.
    </p>
  )
}
