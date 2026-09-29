import { useState, type ReactNode } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconAttention, IconChevron, IconCoche, IconPrecedent } from '../../components/icons'
import {
  candidatsCotisations, candidatsPieces, ecartEnJours, libelleExploitable, sensCoherent, tiersConfirmeParBanque,
} from '../../lib/appariementBanque'
import { ecartAvecBanque } from '../../lib/alignementBanque'
import { natureDuCompte, refusAffectation, sensInhabituel } from '../../lib/affectationBanque'
import {
  justificatifPossible, motifPropose, mouvementsCouverts, normaliserPourRegle, refusMotif, regleApplicable, sensDuMouvement,
} from '../../lib/reglesAffectation'
import { mouvementRapprocheSansObjet } from '../../lib/controles'
import { COMPTE_ASSURANCE_EMPRUNT, COMPTE_EMPRUNT, COMPTE_INTERETS_EMPRUNT, LIBELLES_COMPTES } from '../../lib/comptes'
import { ouvrirJustificatif } from '../../lib/depot'
import {
  capitalDeLEcheance, decoupageDuMouvement, decoupagePourEcheance, echeanceProposee, echeancesOccupees, empruntPlausible,
  estDeblocage, MARGE_PRELEVEMENT_JOURS, montantAttendu, refusDecoupage, refusEcheanceEmprunt,
  type DecoupageEcheance, type EmpruntPlausible,
} from '../../lib/echeanceEmprunt'
import { genererEcheancier, type Emprunt } from '../../lib/emprunts'
import { formatDate, formatMoney } from '../../lib/format'
import type { Categorie, CotisationDeclaree, LigneBancaire, Piece, RegleAffectationBancaire } from '../../lib/types'

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
  // Une recette sans facture n'est pas encore prise en charge sur un dossier assujetti : sa TVA ne se
  // lit pas sur un relevé (voir `refusAffectation`).
  assujettiTva: boolean
  // Le compte sur lequel un virement personnel s'écrit — celui de l'exploitant en trésorerie, celui du
  // dirigeant en engagement (`compteDuDirigeant`).
  compteDirigeant: string
  piecesRapprochees: ReadonlySet<string>
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
  onAffecter: (categorieId: string, motifRegle: string | null) => void
  onRetirerAffectation: () => void
  // Les emprunts du dossier, pour rapprocher une échéance ou un déblocage. `empruntsIncomplets` : la
  // liste n'a pas pu être lue en entier — un emprunt peut manquer au choix, et la fiche le dit.
  emprunts: Emprunt[]
  empruntsIncomplets: string | null
  onRapprocherEmprunt: (empruntId: string, decoupage: DecoupageEcheance) => void
  onRetirerEmprunt: () => void
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
        <button type="button" className="carte-rapprochement-lien" onClick={() => ouvrirJustificatif(piece.storage_path)}>
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
  ligne, pieces, piecesValidees, cotisations, categories, regles, reglesIncompletes, lignes, assujettiTva, compteDirigeant,
  piecesRapprochees, cotisationsRapprochees, recurrence, navigation, occupe,
  onFermer, onRapprocher, onRapprocherCotisation, onVirementPersonnel, onIgnorer, onToujoursIgnorer, onRemettreATraiter,
  onAffecter, onRetirerAffectation, emprunts, empruntsIncomplets, onRapprocherEmprunt, onRetirerEmprunt,
}: FicheMouvementProps) {
  const libelleCompteDirigeant = LIBELLES_COMPTES[compteDirigeant] ?? compteDirigeant
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

  // Ce qui se propose à l'affectation : les catégories d'un compte de résultat, dans l'ordre du sens
  // du mouvement — les recettes d'abord pour un encaissement, les dépenses d'abord pour un paiement.
  const categorieAffectee = ligne.categorie_id ? categories.find((c) => c.id === ligne.categorie_id) ?? null : null
  const natureAffectee = categorieAffectee ? natureDuCompte(categorieAffectee.compte_comptable) : null
  const categoriesRecettes = categories.filter((c) => natureDuCompte(c.compte_comptable) === 'recette')
  const categoriesDepenses = categories.filter((c) => natureDuCompte(c.compte_comptable) === 'depense')
  const groupesDeCategories = ligne.montant >= 0
    ? [{ titre: 'Recettes', liste: categoriesRecettes }, { titre: 'Dépenses', liste: categoriesDepenses }]
    : [{ titre: 'Dépenses', liste: categoriesDepenses }, { titre: 'Recettes', liste: categoriesRecettes }]
  const categorieCible = categorieChoisie ? categories.find((c) => c.id === categorieChoisie) ?? null : null
  const refus = categorieCible ? refusAffectation(ligne, categorieCible, assujettiTva) : null
  const natureCible = categorieCible ? natureDuCompte(categorieCible.compte_comptable) : null
  const inhabituel = !refus && natureCible ? sensInhabituel(ligne, natureCible) : false

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
  // Un paiement dont la pièce est peut-être au dossier : l'affecter compterait la dépense deux fois
  // (voir `justificatifPossible`). Dit avant le clic, jamais refusé : c'est l'opérateur qui sait.
  const justificatifAttendu = aTraiter
    ? justificatifPossible(ligne, { pieces, piecesRapprochees, cotisations, cotisationsRapprochees })
    : null

  // Même précédence que le rapprochement automatique : une pièce avant une échéance, une échéance
  // avant une récurrence. Ce n'est pas un arbitrage entre égaux mais une règle de l'écran.
  const piecesCandidates = aTraiter ? candidatsPieces(ligne, piecesValidees, piecesRapprochees) : []
  const echeancesCandidates = aTraiter && piecesCandidates.length === 0
    ? candidatsCotisations(ligne, cotisations, cotisationsRapprochees)
    : []
  const recurrent = aTraiter && piecesCandidates.length === 0 && echeancesCandidates.length === 0 ? recurrence : null

  const piecePayee = ligne.piece_id ? pieces.find((p) => p.id === ligne.piece_id) ?? null : null
  const cotisationPayee = ligne.cotisation_id ? cotisations.find((c) => c.id === ligne.cotisation_id) ?? null : null
  // Seconde copie de la pastille de la liste, gardée par son propre test : le panneau est l'écran où
  // l'on ARBITRE, donc celui où l'écart doit se lire.
  const ecart = (() => {
    if (!piecePayee || ligne.statut !== 'rapprochee') return null
    const e = ecartAvecBanque(piecePayee, ligne)
    return e && e.ecart > 0 && !e.alignable ? e : null
  })()

  const piecesAuChoix = aTraiter
    ? pieces.filter((p) => !piecesRapprochees.has(p.id))
        .sort((a, b) => scoreCorrespondance(a.montant_ttc, a.date_piece, ligne) - scoreCorrespondance(b.montant_ttc, b.date_piece, ligne))
    : []
  const cotisationsAuChoix = aTraiter
    ? cotisations.filter((c) => !cotisationsRapprochees.has(c.id))
        .sort((a, b) =>
          scoreCorrespondance(a.montant_verse ?? a.montant_appele, a.echeance, ligne)
          - scoreCorrespondance(b.montant_verse ?? b.montant_appele, b.echeance, ligne))
    : []
  // Pourquoi rien n'est proposé, dit plutôt que deviné (voir audit ergonomie comparatif) : deux listes
  // vides ne disent pas si le dossier n'a rien à associer, ou si tout est déjà rapproché ailleurs.
  const aucuneReference = pieces.length === 0 && cotisations.length === 0
  const toutDejaRapproche = !aucuneReference && piecesAuChoix.length === 0 && cotisationsAuChoix.length === 0
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
            onClick={() => onAffecter(categorieChoisie, retenirRegle ? motifNormalise : null)}
          >
            {verbe}
          </button>
        </div>
        {regleProposee && categorieChoisie === regleProposee.categorie_id && (
          <p className="fiche-mouvement-note">
            Une règle range les {regleProposee.sens === 'encaissement' ? 'encaissements' : 'paiements'} contenant
            {' '}« {regleProposee.motif} » dans cette catégorie : elle est présélectionnée, rien n’est écrit sans ton clic.
          </p>
        )}
        {resultatRegle?.etat === 'conflit' && (
          <p className="fiche-mouvement-alerte">
            Plusieurs règles reconnaissent ce libellé sans s’accorder sur la catégorie
            ({resultatRegle.regles.map((r) => `« ${r.motif} »`).join(', ')}) : choisis-la ici, et retire dans Banque
            la règle qui n’a pas lieu d’être.
          </p>
        )}
        {refus && <p className="fiche-mouvement-alerte">{refus}</p>}
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

  let principal: ReactNode = null
  if (piecesCandidates.length === 1) {
    principal = (
      <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onRapprocher(piecesCandidates[0].id)}>
        Associer cette pièce
      </button>
    )
  } else if (echeancesCandidates.length === 1) {
    principal = (
      <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onRapprocherCotisation(echeancesCandidates[0].id)}>
        Associer cette échéance
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
  } else if (affecte) {
    // Par la base, jamais par une remise à « à traiter » : l'écriture du mouvement part avec son
    // affectation, dans la même transaction (`retirer_affectation_mouvement_bancaire`).
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRetirerAffectation}>
        Annuler l’affectation
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
          {!ligne.prelevement_personnel && ligne.statut === 'rapprochee' && !sansObjet && !affecte && !rapprocheEmprunt && <span className="badge badge-ok">Rapproché</span>}
          {ecart && <span className="badge badge-danger">Écart de {formatMoney(ecart.ecart)} avec la pièce</span>}
          {!ligne.prelevement_personnel && aTraiter && <span className="badge badge-warning">Non rapproché</span>}
          {!ligne.prelevement_personnel && ligne.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
        </div>

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
                  <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => onRapprocherCotisation(c.id)}>
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
        {aTraiter && !unePropositionExiste && !recurrent && !plausible && (
          <p className="fiche-mouvement-vide">Aucune pièce proposée pour ce mouvement.</p>
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
                    {piecesAuChoix.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.date_piece)} — {p.tiers ?? '—'} — {formatMoney(p.montant_ttc)}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-outline" disabled={!pieceChoisie || occupe} onClick={() => onRapprocher(pieceChoisie)}>
                    Associer
                  </button>
                </div>
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
                  <button type="button" className="btn btn-outline" disabled={!cotisationChoisie || occupe} onClick={() => onRapprocherCotisation(cotisationChoisie)}>
                    Associer
                  </button>
                </div>
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
                Toutes les pièces et échéances de ce dossier sont déjà rapprochées d’un autre mouvement — si
                aucune ne correspond en réalité, vérifie un éventuel rapprochement fait par erreur ailleurs.
              </p>
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
            {empruntLie && !deblocage && (correctionDepliee ? (
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

        {ligne.prelevement_personnel && (
          <section className="fiche-mouvement-section">
            <h3>Virement personnel</h3>
            <p className="fiche-mouvement-note">
              Ni charge ni recette : il s’écrit sur le compte {compteDirigeant} ({libelleCompteDirigeant}), face
              à la banque. « Remettre à traiter » retire aussi son écriture ; l’onglet Virements dit si elle
              manque, et l’écrit.
            </p>
          </section>
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
            {categorieAffectee && !natureAffectee && (
              <p className="fiche-mouvement-alerte">
                Le compte de cette catégorie n’est plus un compte de charge ou de produit : ce mouvement
                ne compte dans aucun total, et son écriture n’est plus juste. Réaffecte-le.
              </p>
            )}
            {categorieAffectee && natureAffectee && !categorieAffectee.poste_2035 && (
              <p className="fiche-mouvement-alerte">
                Cette catégorie n’a pas de poste 2035 : ce mouvement n’entre dans aucun total de la 2035
                tant qu’il n’est pas renseigné (Clôture).
              </p>
            )}
            {choixDeCategorie('Réaffecter')}
          </section>
        )}

        {ligne.statut === 'rapprochee' && !sansObjet && !affecte && !rapprocheEmprunt && (
          <section className="fiche-mouvement-section">
            <h3>Rapproché avec</h3>
            {piecePayee && <CartePiece piece={piecePayee} />}
            {cotisationPayee && <CarteCotisation cotisation={cotisationPayee} />}
            {/* Le lien existe mais la ligne n'a pas été lue — une lecture partielle, que le bandeau en
                tête de l'écran annonce déjà. Dit ici plutôt qu'une section vide sous « Rapproché avec ». */}
            {ligne.piece_id && !piecePayee && <p className="fiche-mouvement-note">La pièce rapprochée ne figure pas parmi les pièces lues.</p>}
            {ligne.cotisation_id && !cotisationPayee && <p className="fiche-mouvement-note">L’échéance rapprochée ne figure pas parmi les échéances lues.</p>}
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

function NoteEmpruntsIncomplets() {
  return (
    <p className="fiche-mouvement-note">
      La liste des emprunts n’a pas pu être lue en entier : un emprunt peut manquer à ce choix. Recharge la page.
    </p>
  )
}
