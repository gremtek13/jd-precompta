import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import BandeauLecturePartielle, { type AccordLecture } from '../../components/BandeauLecturePartielle'
import {
  MOYENS_ENCAISSEMENT, centimesExacts, echeanceDeDeclaration, obligationEncaissee, propositionsEncaissement, refusDeLaFacture,
  refusEnregistrement, refusRetrait, repartitionProposee, resteAEncaisser,
  type ContexteFacture, type EncaissementLu, type EvenementSuperpdpLu, type LigneDeFacture, type MouvementPropose, type PartLue,
  type PieceLue, type ResteDuTaux, type SaisieEncaissement, type TransmissionLue,
} from '../../lib/encaissementsFactures'
import { lireMontantSaisi, montantPourSaisie, tauxAffiche } from '../../lib/encaissementsAffichage'
import { paiementsDesPieces, type LignePayante, type PartReglee } from '../../lib/rattachement'
import type {
  EncaissementFacture, FactureEmise, FactureSuperpdpEvent, Piece, StatutTva, TransmissionFacture,
} from '../../lib/types'

interface Props {
  dossierId: string
  facture: FactureEmise
  // Le statut de TVA du dossier aujourd'hui : l'obligation et l'échéance en dépendent, et la facture ne le fige pas.
  statutTva: StatutTva | null
  onClose: () => void
  // L'onglet relit ses encaissements : sa pastille doit dire ce que la fenêtre vient d'écrire.
  onUpdated: () => void
}

// LES ENCAISSEMENTS D'UNE FACTURE ÉMISE (ligne 28.5, étape d3) : ce que la facture doit déclarer, ce qui en reste à
// encaisser, les encaissements enregistrés, et la saisie d'un nouveau — rien d'autre ne part d'ici que vers la base.
// Le registre est écrit par deux fonctions seulement (`enregistrer_encaissement`, `retirer_encaissement`, étape d1) ;
// ce qu'elles refuseraient se dit AVANT le clic, sous leurs mots, par le module d2 (encaissementsFactures.ts). La
// déclaration du statut « Encaissée » viendra à l'étape d4 : d'ici là, aucun encaissement n'est déclaré.
//
// TOUT SE LIT EN ENTIER, ET RIEN NE SE PROPOSE SUR UNE LECTURE PARTIELLE : un encaissement manquant ferait dire un
// reste faux, un mouvement manquant laisserait proposer un virement déjà pris — et le premier « Enregistrer » écrirait
// sur cette base fausse (règle « lecture → formulaire → écriture »).

// Les encaissements DÉCLARÉS : aucun tant que les déclarations n'existent pas (étape d4). Passé à `refusRetrait`, qui
// l'exige sans valeur par défaut — l'écran qui l'oublierait laisserait retirer un encaissement déclaré.
const AUCUN_DECLARE: ReadonlySet<string> = new Set()

type LigneLue = LigneDeFacture & { id: string }
type TransmissionEcran = TransmissionLue & Pick<TransmissionFacture, 'id' | 'cree_le'>
type EvenementEcran = EvenementSuperpdpLu & Pick<FactureSuperpdpEvent, 'id' | 'occurred_at'>
type EncaissementEcran = EncaissementLu & Pick<EncaissementFacture, 'date_encaissement' | 'moyen' | 'motif' | 'cree_le'>
type PartEcran = PartLue & { dossier_id: string }
type MouvementEcran = MouvementPropose & LignePayante
type ReglementEcran = PartReglee & { id: string }
type PieceEcran = PieceLue & Pick<Piece, 'tiers' | 'nom_fichier'>

interface Lu {
  // La facture et ses avoirs : un avoir réduit ce que le client doit encore, à l'écran seulement.
  factures: FactureEmise[]
  lignes: LigneLue[]
  transmissions: TransmissionEcran[]
  evenements: EvenementEcran[]
  encaissements: EncaissementEcran[]
  parts: PartEcran[]
  mouvements: MouvementEcran[]
  reglements: ReglementEcran[]
  pieces: PieceEcran[]
}

interface Manque {
  quoi: string
  accord: AccordLecture
  motif: string
}

// Ce qu'une lecture partielle coûte, une phrase pour toutes : la fenêtre ne montre alors ni reste, ni formulaire.
const CONSEQUENCE = 'Rien n’est proposé : un reste ou une proposition bâtis sur une liste incomplète seraient faux. Rouvre cette fenêtre.'

async function lireDonnees(dossierId: string, factureId: string): Promise<{ lu: Lu; manques: Manque[] }> {
  const [
    factures, lignes, transmissions, evenements, encaissements, parts, mouvements, reglements, pieces,
  ] = await Promise.all([
    lireTout<FactureEmise>((debut, fin) =>
      supabase.from('factures_emises').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).or(`id.eq.${factureId},facture_origine_id.eq.${factureId}`)
        .order('date_emission').order('id').range(debut, fin),
    ),
    lireTout<LigneLue>((debut, fin) =>
      supabase.from('facture_lignes').select('id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva', { count: 'exact' })
        .eq('facture_id', factureId).order('ordre').order('id').range(debut, fin),
    ),
    lireTout<TransmissionEcran>((debut, fin) =>
      supabase.from('transmissions_factures').select('id, facture_id, etat, hote, flux_id, cree_le', { count: 'exact' })
        .eq('facture_id', factureId).order('cree_le').order('id').range(debut, fin),
    ),
    lireTout<EvenementEcran>((debut, fin) =>
      supabase.from('facture_superpdp_events').select('id, facture_id, status_code, occurred_at', { count: 'exact' })
        .eq('facture_id', factureId).order('occurred_at').order('id').range(debut, fin),
    ),
    // Les encaissements et les parts du DOSSIER, retirés et annulations compris : un mouvement se juge sur tous les
    // encaissements qu'il justifie, de toutes les factures — le module filtre lui-même ceux de la facture.
    lireTout<EncaissementEcran>((debut, fin) =>
      supabase.from('encaissements_factures')
        .select('id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif, cree_le, retire_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date_encaissement').order('cree_le').order('id').range(debut, fin),
    ),
    lireTout<PartEcran>((debut, fin) =>
      supabase.from('encaissements_factures_taux').select('encaissement_id, dossier_id, taux, montant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
    ),
    lireTout<MouvementEcran>((debut, fin) =>
      supabase.from('lignes_bancaires')
        .select('id, dossier_id, date, montant, libelle, libelle_brut, statut, piece_id, reglement_groupe, prelevement_personnel, compte_bilan, emprunt_id, declaration_tva_id, cotisation_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
    ),
    lireTout<ReglementEcran>((debut, fin) =>
      supabase.from('reglements_groupes').select('id, ligne_bancaire_id, piece_id, montant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<PieceEcran>((debut, fin) =>
      supabase.from('pieces').select('id, dossier_id, flux_hote, flux_id, superpdp_invoice_id, tiers, nom_fichier', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
  ])
  const manques: Manque[] = []
  // Chaque drapeau lu nommément : un drapeau jeté laisserait le bandeau éteint sur une lecture tronquée.
  const noter = (quoi: string, accord: AccordLecture, complete: boolean, motif: string | null) => {
    if (!complete) manques.push({ quoi, accord, motif: motif ?? 'lecture incomplète' })
  }
  noter('La facture et ses avoirs', 'lus', factures.complete, factures.motif)
  noter('Les lignes de la facture', 'lues', lignes.complete, lignes.motif)
  noter('Les transmissions de la facture', 'lues', transmissions.complete, transmissions.motif)
  noter('L’historique de Super PDP', 'lu', evenements.complete, evenements.motif)
  noter('Les encaissements du dossier', 'lus', encaissements.complete, encaissements.motif)
  noter('La répartition des encaissements', 'lue', parts.complete, parts.motif)
  noter('Les mouvements du relevé', 'lus', mouvements.complete, mouvements.motif)
  noter('Les règlements groupés', 'lus', reglements.complete, reglements.motif)
  noter('Les pièces du dossier', 'lues', pieces.complete, pieces.motif)
  return {
    lu: {
      factures: factures.lignes, lignes: lignes.lignes, transmissions: transmissions.lignes, evenements: evenements.lignes,
      encaissements: encaissements.lignes, parts: parts.lignes, mouvements: mouvements.lignes, reglements: reglements.lignes,
      pieces: pieces.lignes,
    },
    manques,
  }
}

interface Formulaire {
  date: string
  montant: string
  moyen: string
  ligneBancaireId: string | null
  // Une part par taux de la facture, dans l'ordre du reste (le taux le plus fort d'abord) : c'est l'ordre de la saisie,
  // que la base suit pour dire la première part en excès.
  parts: { taux: number; montant: string }[]
}

// Les centimes d'un montant tapé, s'il en est un, positif et au centime ; null sinon.
function centimesDuTexte(texte: string): number | null {
  const n = lireMontantSaisi(texte)
  if (n == null || Number.isNaN(n)) return null
  const c = centimesExacts(n)
  return c != null && c > 0 ? c : null
}

function partsProposees(montantCentimes: number | null, parTaux: readonly ResteDuTaux[]): Formulaire['parts'] {
  const proposees = montantCentimes == null ? null : repartitionProposee(montantCentimes, parTaux)
  return parTaux.map((t) => {
    const p = proposees?.find((x) => x.taux === t.taux)
    return { taux: t.taux, montant: p ? montantPourSaisie(p.centimes) : '' }
  })
}

// Le moyen n'est JAMAIS proposé : c'est le cabinet qui sait comment le client a payé, et la date à retenir en dépend.
function formulaireVierge(parTaux: readonly ResteDuTaux[], resteCentimes: number): Formulaire {
  const montant = resteCentimes > 0 ? resteCentimes : null
  return {
    date: '', montant: montant == null ? '' : montantPourSaisie(montant), moyen: '', ligneBancaireId: null,
    parts: partsProposees(montant, parTaux),
  }
}

function contexteDe(dossierId: string, factureId: string, lu: Lu): ContexteFacture | null {
  const facture = lu.factures.find((f) => f.id === factureId)
  if (!facture) return null
  return {
    dossierId, facture, lignes: lu.lignes, transmissions: lu.transmissions, evenementsSuperpdp: lu.evenements,
    encaissements: lu.encaissements, parts: lu.parts,
  }
}

// Ce que le formulaire envoie, tel que le module et la base le jugent. Une part laissée vide ne part pas : la base veut
// des parts positives, et un taux sans part n'en reçoit rien.
function saisieDe(f: Formulaire): SaisieEncaissement {
  return {
    date: f.date === '' ? null : f.date,
    montant: lireMontantSaisi(f.montant),
    moyen: f.moyen === '' ? null : f.moyen,
    ligneBancaireId: f.ligneBancaireId,
    repartition: f.parts.filter((p) => p.montant.trim() !== '')
      .map((p) => ({ taux: p.taux, montant: lireMontantSaisi(p.montant) ?? Number.NaN })),
  }
}

// Ce qu'une lecture donne à la fenêtre : rien sur une lecture partielle, et le formulaire neuf qu'elle permet — `undefined`
// quand elle n'en permet aucun (lecture partielle), `null` quand la facture n'a pas été retrouvée.
function etatLu(r: { lu: Lu; manques: Manque[] }, dossierId: string, factureId: string): {
  manques: Manque[]; lu: Lu | null; formulaire: Formulaire | null | undefined
} {
  if (r.manques.length > 0) return { manques: r.manques, lu: null, formulaire: undefined }
  const c = contexteDe(dossierId, factureId, r.lu)
  const reste = c ? resteAEncaisser(c) : null
  return { manques: [], lu: r.lu, formulaire: reste ? formulaireVierge(reste.parTaux, reste.resteCentimes) : null }
}

const libelleMoyen = (moyen: string) => MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen
const libelleMouvement = (m: Pick<MouvementEcran, 'date' | 'libelle'> | undefined) =>
  (m ? `${formatDate(m.date)} · ${m.libelle}` : '—')

export default function EncaissementsFactureModal({ dossierId, facture: factureOuverte, statutTva, onClose, onUpdated }: Props) {
  const [lu, setLu] = useState<Lu | null>(null)
  const [manques, setManques] = useState<Manque[]>([])
  const [formulaire, setFormulaire] = useState<Formulaire | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // `vider` : le formulaire repart de ce qui vient d'être lu — à l'ouverture, et après un geste réussi, quand le reste
  // et les propositions ont changé. Après un refus de la base, la saisie reste, pour qu'on la corrige.
  async function lire(vider: boolean) {
    const etat = etatLu(await lireDonnees(dossierId, factureOuverte.id), dossierId, factureOuverte.id)
    setManques(etat.manques)
    setLu(etat.lu)
    if (vider && etat.formulaire !== undefined) setFormulaire(etat.formulaire)
  }

  // La première lecture. Rien ne la devance : la fenêtre est clée par facture dans l'onglet, et ses gestes attendent
  // qu'un formulaire existe. Une fenêtre fermée avant la réponse ne l'écrit pas.
  useEffect(() => {
    let fermee = false
    lireDonnees(dossierId, factureOuverte.id).then((r) => {
      if (fermee) return
      const etat = etatLu(r, dossierId, factureOuverte.id)
      setManques(etat.manques)
      setLu(etat.lu)
      if (etat.formulaire !== undefined) setFormulaire(etat.formulaire)
    })
    return () => { fermee = true }
  }, [dossierId, factureOuverte.id])

  // UN SEUL VERROU pour les deux gestes de la fenêtre, posé avant le `try` et relâché dans le `finally`, APRÈS la
  // relecture : un clic pendant qu'elle court repartirait d'un reste qu'on n'a pas encore vu. Deux clics sur
  // « Enregistrer » enregistreraient deux fois le même argent — la base le plafonne, pas un paiement partiel répété.
  const verrou = useRef(false)

  const aujourdHui = aujourdHuiAParis()
  const contexte = lu ? contexteDe(dossierId, factureOuverte.id, lu) : null
  const facture = lu?.factures.find((f) => f.id === factureOuverte.id) ?? factureOuverte
  const nature = `la facture ${facture.numero ?? ''} (${facture.tiers_nom})`

  async function enregistrer() {
    // Ce que la base refuserait a déjà grisé le bouton : un clic n'arrive ici que sur une saisie qu'elle accepterait.
    if (verrou.current || !contexte || !lu || !formulaire) return
    const saisie = saisieDe(formulaire)
    verrou.current = true
    setEnCours('enregistrer')
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('enregistrer_encaissement', {
        p_dossier_id: dossierId,
        p_facture_id: facture.id,
        p_date: saisie.date,
        p_montant: saisie.montant,
        p_moyen: saisie.moyen,
        p_ligne_bancaire_id: saisie.ligneBancaireId,
        // Dans l'ordre de la saisie : la base dit la première part qui dépasse son taux.
        p_repartition: saisie.repartition.map((p) => ({ taux: p.taux, montant: p.montant })),
      })
      if (error) setErreur(messageErreur(error, 'L’encaissement n’a pas pu être enregistré.'))
      else setMessage(`Encaissement enregistré : ${formatMoney(saisie.montant)} le ${formatDate(saisie.date as string)}.`)
      // Dans tous les cas : un refus arrivé après le clic est une écriture concurrente, que la relecture montre.
      await lire(!error)
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'L’encaissement n’a pas pu être enregistré.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  // LE RETRAIT D'UN ENCAISSEMENT JAMAIS DÉCLARÉ : il reste au registre, marqué retiré, et ne compte plus. La
  // confirmation nomme ce qui est retiré — la date, le montant, la facture.
  async function retirer(e: EncaissementEcran) {
    if (verrou.current || !lu) return
    if (refusRetrait(dossierId, e.id, lu.encaissements, AUCUN_DECLARE)) return
    if (!window.confirm(
      `Retirer l’encaissement du ${formatDate(e.date_encaissement)} de ${formatMoney(e.montant)} sur ${nature} ?\n\n`
      + 'Il reste au registre, marqué retiré : il ne compte plus dans ce qui est encaissé, et ne se rétablit pas — '
      + 'un encaissement retiré par erreur se saisit de nouveau.',
    )) return
    verrou.current = true
    setEnCours(`retirer-${e.id}`)
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_encaissement', { p_dossier_id: dossierId, p_encaissement_id: e.id })
      if (error) setErreur(messageErreur(error, 'L’encaissement n’a pas pu être retiré.'))
      else setMessage(`Encaissement du ${formatDate(e.date_encaissement)} retiré : il reste au registre, marqué retiré.`)
      await lire(!error)
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'L’encaissement n’a pas pu être retiré.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(820px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Encaissements de la facture {facture.numero}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {facture.tiers_nom}, du {formatDate(facture.date_emission)}, {formatMoney(facture.montant_ttc)} TTC. Un encaissement
          s’enregistre ici, au registre du dossier ; rien ne part vers une plateforme ni vers l’administration.
        </p>

        {manques.length > 0 ? (
          <>
            {manques.map((m) => (
              <BandeauLecturePartielle key={m.quoi} quoi={m.quoi} motif={m.motif} accord={m.accord} consequence={CONSEQUENCE} />
            ))}
          </>
        ) : !lu ? (
          <p className="muted">Chargement…</p>
        ) : !contexte ? (
          <p className="error-text">Cette facture n’a pas été retrouvée dans le dossier : rien n’est proposé. Rouvre l’onglet Factures.</p>
        ) : (
          <Contenu
            dossierId={dossierId} contexte={contexte} lu={lu} statutTva={statutTva} aujourdHui={aujourdHui}
            formulaire={formulaire} setFormulaire={setFormulaire} enCours={enCours}
            onEnregistrer={enregistrer} onRetirer={retirer}
          />
        )}

        {message && <p className="muted" role="status">{message}</p>}
        {erreur && <p className="error-text">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={enCours != null}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

function Contenu({ dossierId, contexte, lu, statutTva, aujourdHui, formulaire, setFormulaire, enCours, onEnregistrer, onRetirer }: {
  dossierId: string
  contexte: ContexteFacture
  lu: Lu
  statutTva: StatutTva | null
  aujourdHui: string
  formulaire: Formulaire | null
  setFormulaire: (f: Formulaire) => void
  enCours: string | null
  onEnregistrer: () => void
  onRetirer: (e: EncaissementEcran) => void
}) {
  const facture = lu.factures.find((f) => f.id === contexte.facture.id) as FactureEmise
  const obligation = obligationEncaissee(facture, lu.lignes, statutTva)
  const reste = resteAEncaisser(contexte)
  const surLaFacture = refusDeLaFacture(contexte)
  const siens = lu.encaissements.filter((e) => e.facture_id === facture.id)
  const partsDe = (id: string) => lu.parts.filter((p) => p.encaissement_id === id)
  const mouvement = (id: string | null) => (id == null ? undefined : lu.mouvements.find((m) => m.id === id))

  // L'effet des avoirs, À L'ÉCRAN SEULEMENT : la base ne les déduit pas, et le plafond d'un encaissement reste le total
  // de la facture (entrée d2). Le client, lui, ne doit plus ce qu'un avoir a crédité.
  const avoirs = lu.factures.filter((f) => f.type === 'avoir' && f.statut === 'validee' && f.facture_origine_id === facture.id)
  const crediteCentimes = avoirs.reduce((s, a) => s + Math.round(-a.montant_ttc * 100), 0)
  const attenduCentimes = Math.max(reste.resteCentimes - crediteCentimes, 0)

  const propositions = propositionsEncaissement(
    contexte, lu.pieces, paiementsDesPieces(lu.mouvements, lu.reglements), lu.mouvements, aujourdHui,
  )
  const saisie = formulaire ? saisieDe(formulaire) : null
  const refus = saisie ? refusEnregistrement(contexte, saisie, lu.mouvements, aujourdHui) : null
  const choisie = formulaire?.ligneBancaireId ? propositions.find((p) => p.ligneBancaireId === formulaire.ligneBancaireId) ?? null : null
  const moyen = formulaire ? MOYENS_ENCAISSEMENT.find((m) => m.moyen === formulaire.moyen) ?? null : null
  const echeanceSaisie = formulaire && formulaire.date !== '' ? echeanceDeDeclaration(formulaire.date, statutTva) : null
  const nomPiece = (id: string) => {
    const p = lu.pieces.find((x) => x.id === id)
    return p ? (p.tiers ?? p.nom_fichier) : 'une pièce'
  }

  function changerMontant(texte: string) {
    if (!formulaire) return
    setFormulaire({ ...formulaire, montant: texte, parts: partsProposees(centimesDuTexte(texte), reste.parTaux) })
  }

  function choisirMouvement(id: string) {
    if (!formulaire) return
    const p = propositions.find((x) => x.ligneBancaireId === id)
    if (!p) {
      setFormulaire({ ...formulaire, ligneBancaireId: null })
      return
    }
    // La proposition remplit la date, le montant et la répartition ; le moyen reste à choisir.
    setFormulaire({
      ...formulaire,
      ligneBancaireId: p.ligneBancaireId,
      date: p.date,
      montant: montantPourSaisie(p.montantCentimes),
      parts: reste.parTaux.map((t) => {
        const part = p.repartition.find((x) => x.taux === t.taux)
        return { taux: t.taux, montant: part ? montantPourSaisie(part.centimes) : '' }
      }),
    })
  }

  return (
    <>
      <div className="field">
        <label>Le statut « Encaissée »</label>
        <p style={{ margin: 0 }}>{obligation.raison}</p>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Sa déclaration à l’administration viendra dans une prochaine étape de l’application : rien ne se déclare d’ici
          pour l’instant, et aucun encaissement enregistré n’est encore déclaré.
        </p>
      </div>

      <div className="field">
        <label>Reste à encaisser : {formatMoney(reste.resteCentimes / 100)}</label>
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite">
            <thead><tr><th>Taux de TVA</th><th>TTC de la facture</th><th>Encaissé</th><th>Reste</th></tr></thead>
            <tbody>
              {reste.parTaux.map((t) => (
                <tr key={t.taux}>
                  <td data-libelle="Taux de TVA">{tauxAffiche(t.taux)}</td>
                  <td data-libelle="TTC de la facture">{formatMoney(t.ttcCentimes / 100)}</td>
                  <td data-libelle="Encaissé">{formatMoney(t.encaisseCentimes / 100)}</td>
                  <td data-libelle="Reste">{formatMoney(t.resteCentimes / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td data-libelle="TTC de la facture">{formatMoney(reste.ttcCentimes / 100)}</td>
                <td data-libelle="Encaissé">{formatMoney(reste.encaisseCentimes / 100)}</td>
                <td data-libelle="Reste">{formatMoney(reste.resteCentimes / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {avoirs.length > 0 && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {avoirs.length === 1 ? 'L’avoir' : 'Les avoirs'} {avoirs.map((a) => a.numero ?? '—').join(', ')} de cette facture
            {avoirs.length === 1 ? ' en crédite ' : ' en créditent '}{formatMoney(crediteCentimes / 100)} : le client ne doit plus
            que {formatMoney(attenduCentimes / 100)} sur ce reste. C’est un affichage seulement — la base ne déduit pas les
            avoirs, et un encaissement reste plafonné au total de la facture.
          </p>
        )}
      </div>

      <div className="field">
        <label>Encaissements enregistrés</label>
        {siens.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Aucun encaissement enregistré pour cette facture.</p>
        ) : (
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable">
              <thead>
                <tr><th>Date</th><th>Moyen</th><th>Montant</th><th>Mouvement</th><th>Répartition</th><th>État</th><th>Déclaration</th><th></th></tr>
              </thead>
              <tbody>
                {siens.map((e) => {
                  const refusDuRetrait = refusRetrait(dossierId, e.id, lu.encaissements, AUCUN_DECLARE)
                  const echeance = e.retire_le == null ? echeanceDeDeclaration(e.date_encaissement, statutTva) : null
                  // Un retard ne se dit que d'une obligation DUE : facultative, rien n'est en retard.
                  const enRetard = echeance != null && obligation.etat === 'due' && echeance.date < aujourdHui
                  return (
                    <tr key={e.id}>
                      <td data-libelle="Date">{formatDate(e.date_encaissement)}</td>
                      <td data-libelle="Moyen">{libelleMoyen(e.moyen)}</td>
                      <td data-libelle="Montant">{formatMoney(e.montant)}</td>
                      <td data-libelle="Mouvement" style={{ overflowWrap: 'anywhere' }}>{libelleMouvement(mouvement(e.ligne_bancaire_id))}</td>
                      <td data-libelle="Répartition">
                        <span>{partsDe(e.id).map((p) => `${tauxAffiche(p.taux)} : ${formatMoney(p.montant)}`).join(' · ') || '—'}</span>
                      </td>
                      <td data-libelle="État">
                        {e.retire_le != null
                          ? <span className="badge badge-neutral">Retiré le {formatDate(e.retire_le)}</span>
                          : e.annule_id != null
                            ? <span className="badge badge-warning">Annulation</span>
                            : <span className="badge badge-ok">Enregistré</span>}
                      </td>
                      <td data-libelle="Déclaration" className="muted" style={{ fontSize: '0.82rem' }}>
                        <span>
                          {echeance ? echeance.libelle : '—'}
                          {enRetard && <> <span className="badge badge-danger">Échéance dépassée</span></>}
                        </span>
                      </td>
                      <td className="td-actions">
                        {refusDuRetrait == null ? (
                          <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={() => onRetirer(e)}>
                            {enCours === `retirer-${e.id}` ? 'Retrait…' : 'Retirer'}
                          </button>
                        ) : refusDuRetrait.cle !== 'deja_retire' ? (
                          <span className="muted" style={{ fontSize: '0.82rem' }}>{refusDuRetrait.message}</span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {surLaFacture ? (
        <p className="alerte-tva">{surLaFacture.message}</p>
      ) : reste.resteCentimes <= 0 ? (
        <p className="muted">La facture est entièrement encaissée : il n’y a plus rien à enregistrer.</p>
      ) : formulaire && saisie && (
        <div className="field">
          <label>Enregistrer un encaissement</label>

          <div className="field">
            <label htmlFor="encaissement-mouvement">Mouvement du relevé (facultatif)</label>
            <select
              id="encaissement-mouvement" value={formulaire.ligneBancaireId ?? ''}
              onChange={(ev) => choisirMouvement(ev.target.value)}
            >
              <option value="">Aucun mouvement</option>
              {propositions.map((p) => (
                <option key={p.ligneBancaireId} value={p.ligneBancaireId}>
                  {libelleMouvement(mouvement(p.ligneBancaireId))} · {formatMoney(p.creditCentimes / 100)}
                  {p.ecartCentimes !== 0 ? ` (écart ${formatMoney(p.ecartCentimes / 100)})` : ''}
                </option>
              ))}
            </select>
            {propositions.length === 0 ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Aucun mouvement ne se propose : ni paiement de la pièce jumelle, ni crédit du relevé qui fasse le reste à
                l’écart des frais près. Un encaissement sans mouvement s’enregistre aussi (espèces, chèque pas encore crédité).
              </p>
            ) : choisie ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {choisie.source === 'jumelle' ? 'Paiement de la pièce jumelle — la même vente, reçue comme pièce. ' : 'Crédit du relevé. '}
                {choisie.explication}
                {choisie.clientCite ? ' Le libellé du mouvement cite le client.' : ''}
                {choisie.piecesPayees.length > 0
                  ? ` Ce mouvement paie déjà : ${choisie.piecesPayees.map(nomPiece).join(', ')}.`
                  : ''}
              </p>
            ) : (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {propositions.length === 1 ? 'Un mouvement se propose' : `${propositions.length} mouvements se proposent`} :
                le choisir remplit la date, le montant et la répartition.
              </p>
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="encaissement-date">Date de l’encaissement</label>
              <input
                id="encaissement-date" type="date" value={formulaire.date}
                onChange={(ev) => setFormulaire({ ...formulaire, date: ev.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="encaissement-montant">Montant encaissé (€)</label>
              <input
                id="encaissement-montant" type="text" inputMode="decimal" value={formulaire.montant}
                onChange={(ev) => changerMontant(ev.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="encaissement-moyen">Moyen de paiement</label>
              <select
                id="encaissement-moyen" value={formulaire.moyen}
                onChange={(ev) => setFormulaire({ ...formulaire, moyen: ev.target.value })}
              >
                <option value="">Choisir…</option>
                {MOYENS_ENCAISSEMENT.map((m) => <option key={m.moyen} value={m.moyen}>{m.libelle}</option>)}
              </select>
            </div>
          </div>
          {moyen?.dateARetenir && <p className="muted" style={{ margin: '-6px 0 8px' }}>Date à retenir : {moyen.dateARetenir}</p>}
          {formulaire.date !== '' && formulaire.date < facture.date_emission && (
            <p className="muted" style={{ margin: '-6px 0 8px' }}>
              Payé avant la date de la facture : un acompte, dont l’échéance de déclaration court depuis le paiement.
            </p>
          )}
          {echeanceSaisie && <p className="muted" style={{ margin: '-6px 0 8px' }}>{echeanceSaisie.libelle}</p>}

          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable table-formulaire">
              <thead><tr><th>Taux de TVA</th><th>Reste à ce taux</th><th>Part encaissée (€)</th></tr></thead>
              <tbody>
                {formulaire.parts.map((p, i) => {
                  const t = reste.parTaux.find((x) => x.taux === p.taux)
                  return (
                    <tr key={p.taux}>
                      <td data-libelle="Taux de TVA">{tauxAffiche(p.taux)}</td>
                      <td data-libelle="Reste à ce taux">{t ? formatMoney(t.resteCentimes / 100) : '—'}</td>
                      <td data-libelle="Part encaissée (€)">
                        <input
                          aria-label={`Part à ${tauxAffiche(p.taux)}`} type="text" inputMode="decimal" value={p.montant}
                          onChange={(ev) => setFormulaire({
                            ...formulaire,
                            parts: formulaire.parts.map((q, j) => (j === i ? { ...q, montant: ev.target.value } : q)),
                          })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '4px 0 8px' }}>
            Proposée au prorata de ce qui reste à chaque taux ; corrigible. Une part laissée vide n’est pas envoyée.
          </p>

          {refus && <p className="alerte-tva" style={{ marginTop: 0 }}>{refus.message}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={refus != null || enCours != null} onClick={onEnregistrer}>
              {enCours === 'enregistrer' ? 'Enregistrement…' : 'Enregistrer l’encaissement'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
