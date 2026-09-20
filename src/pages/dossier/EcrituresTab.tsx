import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE } from '../../lib/comptes'
import { SUGGESTIONS_COMPTE_PAR_CODE, analyserEcritures, ecrituresSansObjet, lignesChargeProduitPourPiece, piecesAComptabiliser, soldeCompte, tvaNettePourPeriode } from '../../lib/ecritures'
import type { MotifSansObjet } from '../../lib/ecritures'
import { synchroniserContrepartieBanque } from '../../lib/contrepartieBanque'
import { LIBELLE_MOTIF_TVA, categoriesSansCompte as calculerCategoriesSansCompte, piecesSansTva as calculerPiecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from '../../lib/controles'
import { genererFec, nomFichierFec, telechargerTexte } from '../../lib/fec'
import { lireTout } from '../../lib/lectureComplete'
import { absenceFec, genererPisteAuditCsv, nomFichierPisteAudit, pisteAudit, rupturesPisteAudit } from '../../lib/pisteAudit'
import type { Categorie, DeclarationTva, EcritureBrouillon, LigneBancaire, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { useAnnee } from '../../context/AnneeContext'

// Ce qui a changé sur la pièce, et ce que le cabinet doit faire — jamais corrigé d'office :
// retirer une écriture est un arbitrage comptable, et les trois derniers motifs se réparent en
// AMONT (sur la pièce), après quoi « Régénérer » reprend la bonne écriture.
const LIBELLE_MOTIF_SANS_OBJET: Record<MotifSansObjet, string> = {
  immobilisee: "Enregistrée en immobilisation : c'est un actif qui s'amortit",
  sans_categorie: 'La catégorie a été retirée',
  categorie_sans_compte: "La catégorie n'a plus de compte comptable",
  sans_montant: 'Le montant TTC a été effacé',
}

const ACTION_MOTIF_SANS_OBJET: Record<MotifSansObjet, string> = {
  immobilisee: "La charge est comptée deux fois (ici et à l'amortissement) : retirer l'écriture, ou retirer l'immobilisation si c'en est une par erreur.",
  sans_categorie: "Redonner une catégorie à la pièce depuis Justificatifs, puis régénérer l'écriture.",
  categorie_sans_compte: 'Renseigner le compte de la catégorie ci-dessous, puis régénérer.',
  sans_montant: 'Remettre le montant TTC de la pièce depuis Justificatifs, puis régénérer.',
}

// Palier 5 — brouillon comptable, brique 1 (journal). Génère une proposition d'écriture pour
// chaque pièce validée dont la catégorie a un compte associé — la ligne charge/produit, puis la
// ligne de TVA séparée le cas échéant (brique 3). La contrepartie banque (partie double complète,
// voir lib/ecritures.ts) s'ajoute automatiquement si la pièce est déjà rapprochée d'un mouvement au
// moment de la génération, ou plus tard depuis Banque sinon. L'export FEC (voir lib/fec.ts) permet au
// cabinet de récupérer un fichier directement importable dans son propre logiciel de comptabilité,
// une fois l'année sélectionnée et le brouillon jugé complet.
export default function EcrituresTab({ dossierId, dossierNom, dossierSiret, assujettiTva }: { dossierId: string; dossierNom: string; dossierSiret: string | null; assujettiTva: boolean }) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [lignesBancaires, setLignesBancaires] = useState<LigneBancaire[]>([])
  const [immobilisationPieceIds, setImmobilisationPieceIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comptesEdit, setComptesEdit] = useState<Record<string, string>>({})
  const [recherche, setRecherche] = useState('')
  // Exercice partagé avec Pièces/Banque/Statistiques/Clôture, sélectionné dans l'en-tête du dossier
  // (voir AnneeContext) — pas de sélecteur local ici.
  const { annee: anneeFilter } = useAnnee()
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [declarationsTva, setDeclarationsTva] = useState<DeclarationTva[]>([])
  const [periodeDebut, setPeriodeDebut] = useState('')
  const [periodeFin, setPeriodeFin] = useState('')
  const [tvaDeclaree, setTvaDeclaree] = useState('')
  const [dateDeclaration, setDateDeclaration] = useState('')
  const [savingDeclaration, setSavingDeclaration] = useState(false)
  const [exportPiste, setExportPiste] = useState(false)
  // Non nul quand le brouillon n'a PAS pu être lu en entier (voir lib/lectureComplete.ts). PostgREST
  // plafonne le nombre de lignes rendues par requête sans le signaler : au-delà, cet écran
  // afficherait un sous-ensemble, et le FEC comme la piste d'audit partiraient amputés sans qu'un
  // seul signal ne paraisse. Le format FEC étant rigide, il ne peut pas porter l'avertissement —
  // l'export se refuse donc, plutôt que de produire un fichier fiscal faux.
  const [brouillonIncomplet, setBrouillonIncomplet] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: categoriesData }, lecturePieces, brouillon, { data: immobilisationsData }, lectureLignes, { data: declarationsData }] = await Promise.all([
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre'),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      // Lue par tranches, et triée sur un ordre TOTAL (`date` n'est pas unique) : sans clé de
      // départage, deux tranches successives peuvent se recouvrir ou sauter des lignes, et rien ne
      // le signale.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date', { ascending: false }).order('id').range(debut, fin),
      ),
      supabase.from('immobilisations').select('piece_id').eq('dossier_id', dossierId),
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'rapprochee').not('piece_id', 'is', null)
          .order('id').range(debut, fin),
      ),
      supabase.from('declarations_tva').select('*').eq('dossier_id', dossierId).order('periode_debut', { ascending: false }),
    ])
    setLignesBancaires(lectureLignes.lignes)
    setCategories(categoriesData ?? [])
    setPiecesValidees(lecturePieces.lignes)
    setEcritures(brouillon.lignes)
    // Un seul drapeau pour les trois collections : ce sont les trois qui font le FEC et la piste
    // d'audit, et l'écran n'a rien de plus utile à dire selon laquelle a manqué.
    setBrouillonIncomplet(
      [brouillon, lecturePieces, lectureLignes].find((l) => !l.complete)?.motif ?? null,
    )
    setImmobilisationPieceIds(new Set((immobilisationsData ?? []).map((i) => i.piece_id).filter((id): id is string => !!id)))
    setDeclarationsTva(declarationsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null

  // Catégories utilisées par au moins une pièce validée mais sans compte associé — impossible de
  // générer l'écriture correspondante tant que ce n'est pas renseigné (voir lib/controles.ts).
  const categoriesSansCompte = calculerCategoriesSansCompte(categories, piecesValidees)

  // Valeur affichée dans le champ tant que le cabinet n'a rien tapé : la suggestion connue pour ce
  // code de catégorie, sinon vide — jamais enregistrée avant le clic explicite sur "Enregistrer".
  function compteAffiche(c: Categorie): string {
    return comptesEdit[c.id] ?? SUGGESTIONS_COMPTE_PAR_CODE[c.code]?.compte ?? ''
  }

  async function saveCompte(categorieId: string) {
    const categorie = categories.find((c) => c.id === categorieId)
    const valeur = (comptesEdit[categorieId] ?? (categorie ? SUGGESTIONS_COMPTE_PAR_CODE[categorie.code]?.compte : undefined) ?? '').trim()
    if (!valeur) return
    const { error: saveError } = await supabase.from('categories').update({ compte_comptable: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Ce que chaque pièce validée doit produire, et sur quel compte — règle unique, partagée avec la
  // Checklist (voir lib/ecritures.ts). Une pièce enregistrée comme immobilisation en est exclue :
  // c'est un actif qui s'amortit, pas une charge courante, et l'y laisser compterait la dépense
  // deux fois.
  const aComptabiliser = piecesAComptabiliser(piecesValidees, categories, immobilisationPieceIds)
  const enAttente = aComptabiliser
    .filter(({ piece }) => !ecritures.some((e) => e.piece_id === piece.id))
    .map(({ piece }) => piece)

  async function genererEcritures() {
    if (enAttente.length === 0) return
    setGenerating(true)
    setError(null)
    try {
      const comptes = new Map(aComptabiliser.map(({ piece, compte }) => [piece.id, compte]))
      const rows = enAttente.flatMap((p) => lignesChargeProduitPourPiece(dossierId, p, comptes.get(p.id)!))
      const { error: insertError } = await supabase.from('ecritures_brouillon').insert(rows)
      if (insertError) throw insertError

      // Une pièce déjà rapprochée d'un mouvement bancaire au moment où son écriture est générée (import
      // en masse d'anciens exercices, par exemple) doit recevoir sa contrepartie tout de suite — sinon
      // il faudrait re-toucher le rapprochement dans Banque pour que la partie double se complète.
      await Promise.all(
        enAttente.map((p) => {
          const ligne = lignesBancaires.find((l) => l.piece_id === p.id)
          return ligne ? synchroniserContrepartieBanque(dossierId, p, ligne) : Promise.resolve()
        }),
      )
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setGenerating(false)
    }
  }

  // Le filtre par année ne porte que sur l'affichage des écritures déjà générées — la génération
  // (bouton ci-dessous) reste globale, sur toutes les pièces en attente quelle que soit leur année.
  const ecrituresFiltrees = anneeFilter === 'toutes' ? ecritures : ecritures.filter((e) => anneeDe(e.date) === anneeFilter)

  // La recherche ne filtre QUE les lignes affichées, jamais les données de calcul ni l'export : les
  // totaux de TVA ci-dessous et le FEC exporté plus bas portent sur `ecrituresFiltrees`. Les brancher
  // sur la recherche ferait varier la TVA déductible au fil de la frappe, et surtout exporterait un
  // FEC amputé des lignes qui ne correspondent pas au texte tapé — un fichier fiscal incomplet sans
  // que rien ne le signale.
  const ecrituresAffichees = ecrituresFiltrees.filter((e) =>
    correspondALaRecherche([e.date, formatDate(e.date), e.compte, e.libelle, e.sens, e.montant], recherche),
  )

  const tvaDeductible = soldeCompte(ecrituresFiltrees, COMPTE_TVA_DEDUCTIBLE, 'debit')
  const tvaCollectee = soldeCompte(ecrituresFiltrees, COMPTE_TVA_COLLECTEE, 'credit')

  // Trois contrôles d'intégrité du brouillon (voir lib/ecritures.ts) — volontairement indépendants du
  // filtre Année ci-dessus : ce sont des défauts sur l'état actuel du brouillon, pas des totaux à
  // consulter par exercice. Une écriture sans contrepartie banque ou déséquilibrée d'un ancien exercice
  // ne doit pas disparaître de la vue juste parce que l'onglet Année est positionné ailleurs.
  const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } = analyserEcritures(ecritures, aComptabiliser)
  // Le quatrième contrôle, celui qui part de l'ÉCRITURE : ce que le brouillon continue de compter
  // alors que la pièce ne le justifie plus (voir lib/ecritures.ts).
  const sansObjet = ecrituresSansObjet(ecritures, piecesValidees, categories, immobilisationPieceIds)

  // Piste d'audit fiable — voir lib/pisteAudit.ts. Volontairement calculé sur TOUTES les écritures,
  // hors filtre Année comme les trois contrôles ci-dessus : une écriture qui a perdu son justificatif
  // ne doit pas disparaître de la vue parce que l'onglet Année est positionné ailleurs.
  const ruptures = rupturesPisteAudit(ecritures)
  // Celui-ci, en revanche, porte sur l'exercice EXPORTÉ : c'est ce fichier-là qui partira amputé.
  const horsFec = absenceFec(ecrituresFiltrees)
  const pieceById = (id: string) => piecesValidees.find((p) => p.id === id) ?? null

  // Export de la piste d'audit de l'exercice (voir lib/pisteAudit.ts) : depuis chaque écriture, le
  // justificatif et l'opération bancaire réelle, et dans l'autre sens les justificatifs validés que
  // rien ne comptabilise. C'est ce qu'un vérificateur demande à produire, et c'est un fichier — pas
  // un écran : il part par e-mail, il se relit hors de l'application.
  //
  // Il relit les mouvements bancaires en entier à ce moment-là, sur ce clic : `lignesBancaires`
  // ci-dessus est volontairement restreint aux lignes rapprochées portant une pièce (c'est ce dont la
  // génération a besoin), et une piste d'audit bâtie sur un jeu restreint annoncerait des mouvements
  // manquants qui existent.
  async function exporterPisteAudit() {
    if (typeof anneeFilter !== 'number') return
    setExportPiste(true)
    setError(null)
    try {
      // Une lecture dont l'échec ressemble à un résultat vide se vérifie comme une écriture : sans
      // ce contrôle, un refus RLS produirait un export où CHAQUE contrepartie annonce un mouvement
      // absent — un fichier faux, et qui a l'air complet.
      const mouvements = await lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      )
      if (!mouvements.complete) {
        throw new Error(
          `Les mouvements bancaires n'ont pas pu être lus en entier (${mouvements.motif}). ` +
          "L'export est annulé : une piste d'audit bâtie sur une lecture partielle annoncerait " +
          'manquants des mouvements qui existent.',
        )
      }
      // Les pièces sans date n'appartiennent à aucun exercice : elles sont jointes à chacun, et la
      // colonne « Ce qui manque » le dit (voir lib/pisteAudit.ts) plutôt que de les taire.
      const piecesExercice = piecesValidees.filter((p) => !p.date_piece || anneeDe(p.date_piece) === anneeFilter)
      const contenu = genererPisteAuditCsv(pisteAudit(ecrituresFiltrees, piecesExercice, mouvements.lignes))
      telechargerTexte(nomFichierPisteAudit(dossierNom, anneeFilter), contenu)
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'export de la piste d'audit a échoué.")
    } finally {
      setExportPiste(false)
    }
  }

  // Reprend les lignes charge/produit + TVA d'une pièce d'après ses montants actuels — jamais
  // automatique, seulement sur ce clic explicite. Ne touche pas à la contrepartie banque (montant du
  // mouvement réel, indépendant d'une correction sur la pièce).
  async function regenererEcriture(piece: Piece) {
    const compte = categorieById(piece.categorie_id)?.compte_comptable
    if (!compte) return
    setRegenerating(piece.id)
    setError(null)
    try {
      const { error: deleteError } = await supabase.from('ecritures_brouillon').delete().eq('piece_id', piece.id).neq('compte', COMPTE_BANQUE)
      if (deleteError) throw deleteError
      const { error: insertError } = await supabase.from('ecritures_brouillon').insert(lignesChargeProduitPourPiece(dossierId, piece, compte))
      if (insertError) throw insertError
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setRegenerating(null)
    }
  }

  const piecesSansTva = calculerPiecesSansTva(piecesValidees, assujettiTva)
  const piecesSansCategorie = piecesValideesSansCategorie(piecesValidees)
  // Cet onglet ne charge que les pièces VALIDÉES : ce sont donc les TVA fausses déjà figées dans une
  // écriture et parties en déduction. Les autres se voient en amont, dans Justificatifs, là où on
  // peut encore les corriger avant de valider.
  const tvaImpossible = piecesTvaImpossible(piecesValidees)

  async function enregistrerDeclaration(e: FormEvent) {
    e.preventDefault()
    if (!periodeDebut || !periodeFin || !tvaDeclaree) return
    setSavingDeclaration(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('declarations_tva').insert({
        dossier_id: dossierId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        tva_declaree: parseFloat(tvaDeclaree),
        date_declaration: dateDeclaration || null,
      })
      if (insertError) throw insertError
      setPeriodeDebut('')
      setPeriodeFin('')
      setTvaDeclaree('')
      setDateDeclaration('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSavingDeclaration(false)
    }
  }

  async function supprimerDeclaration(id: string) {
    if (!window.confirm('Retirer cette déclaration ?')) return
    await supabase.from('declarations_tva').delete().eq('id', id)
    load()
  }

  return (
    <>
      <BrouillonBanner />

      {/* EN PREMIER, avant même « sans catégorie » : celles-là ne produisent RIEN, celle-ci produit
          quelque chose de FAUX. Un total manquant finit par se remarquer ; un total juste en
          apparence et compté deux fois, non. */}
      {sansObjet.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Écritures que la pièce ne justifie plus <span className="badge badge-danger">bloquant</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces écritures ont été générées, puis la pièce a changé de nature — rien ne les a retirées.
            Elles comptent encore dans le FEC, dans la Balance des comptes et dans la 2035, et aucun
            autre contrôle ne peut les voir : les trois autres partent de la pièce, celui-ci part de
            l'écriture.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Compté au brouillon</th><th>Ce qui a changé</th><th>Ce qu'il faut faire</th></tr></thead>
            <tbody>
              {sansObjet.map((o) => (
                <tr key={o.piece.id}>
                  <td>{o.piece.tiers ?? o.piece.nom_fichier}</td>
                  <td>{formatMoney(o.montant)} <span className="muted">({o.nbLignes} ligne{o.nbLignes > 1 ? 's' : ''})</span></td>
                  <td>{LIBELLE_MOTIF_SANS_OBJET[o.motif]}</td>
                  <td className="muted">{ACTION_MOTIF_SANS_OBJET[o.motif]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Avant « Pièces sans TVA » : une pièce sans catégorie ne produit RIEN, là où une TVA manquante
          ne fausse qu'une ligne. Le contrôle le plus bloquant se lit en premier. */}
      {piecesSansCategorie.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces validées sans catégorie <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {piecesSansCategorie.length === 1 ? 'Cette pièce est validée' : `Ces ${piecesSansCategorie.length} pièces sont validées`} mais {piecesSansCategorie.length === 1 ? 'n\'a' : 'n\'ont'} aucune catégorie : {piecesSansCategorie.length === 1 ? 'elle ne génère' : 'elles ne génèrent'} aucune écriture et {piecesSansCategorie.length === 1 ? 'n\'entre' : 'n\'entrent'} dans aucun total de Clôture ni dans la 2035. Le travail de vérification est fait, il ne compte nulle part — la catégorie se donne depuis l'onglet Justificatifs.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansCategorie.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}{p.date_piece ? ` (${p.date_piece})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Avant « Pièces sans TVA » : une TVA absente se voit (la case est vide), une TVA fausse a
          l'air remplie — et c'est celle-là qui part en déduction. */}
      {tvaImpossible.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            TVA impossible <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Sur {tvaImpossible.length === 1 ? 'cette pièce validée' : `ces ${tvaImpossible.length} pièces validées`}, le calcul démontre que la TVA lue
            ne peut pas être celle du document — elle est pourtant déjà partie en TVA déductible et
            dans la charge. Les montants se corrigent depuis l'onglet Justificatifs, puis l'écriture
            est à régénérer.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>HT</th><th>TVA lue</th><th>TTC</th><th>Ce qui cloche</th></tr></thead>
            <tbody>
              {tvaImpossible.map(({ piece: p, motif }) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td>{formatMoney(p.montant_ht)}</td>
                  <td>{formatMoney(p.montant_tva)}</td>
                  <td>{formatMoney(p.montant_ttc)}</td>
                  <td className="muted">{LIBELLE_MOTIF_TVA[motif]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {piecesSansTva.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          {/* Sévérité signalée par un badge, pas par une bordure de couleur sur toute la carte (voir
              discipline visuelle — une couleur d'accent utilisée avec parcimonie, pas dispersée). */}
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces sans TVA renseignée <span className="badge badge-warning">à vérifier</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ce dossier est marqué assujetti à la TVA, mais {piecesSansTva.length} pièce{piecesSansTva.length > 1 ? 's' : ''} validée{piecesSansTva.length > 1 ? 's' : ''} n'a{piecesSansTva.length > 1 ? 'ont' : ''} pas de montant de TVA — vérifie si c'est normal (achat auprès d'un non-assujetti…) ou un oubli de saisie.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansTva.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}</li>
            ))}
          </ul>
        </div>
      )}

      {piecesDesynchronisees.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Écritures à régénérer <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces pièces ont été modifiées (montant, TVA...) depuis que leur écriture a été générée — la
            charge/produit enregistrée ne correspond plus au montant actuel de la pièce. Reprend les
            montants à jour sans toucher à une éventuelle contrepartie banque déjà rapprochée.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Montant actuel</th><th></th></tr></thead>
            <tbody>
              {piecesDesynchronisees.map((p) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td>{formatMoney(p.montant_ttc)}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" disabled={regenerating === p.id} onClick={() => regenererEcriture(p)}>
                      {regenerating === p.id ? 'Régénération…' : 'Régénérer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ruptures.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Piste d'audit rompue <span className="badge badge-danger">bloquant</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces écritures ne peuvent plus être reliées à ce qui les justifie. C'est la première chose
            qu'un contrôleur demande : montrez-moi la pièce de cette charge. Elles restent comptées
            dans la Balance des comptes mais <strong>sortent du FEC</strong> — le fichier fiscal et la
            balance ne disent donc pas le même résultat. Cause habituelle : la pièce ou le relevé
            bancaire a été supprimé après la génération de l'écriture.
          </p>
          <table>
            <thead><tr><th>Date</th><th>Compte</th><th>Libellé</th><th>Montant</th><th>Ce qui manque</th></tr></thead>
            <tbody>
              {ruptures.map((r, i) => (
                <tr key={`${r.ecriture.id}-${r.motif}-${i}`}>
                  <td>{formatDate(r.ecriture.date)}</td>
                  <td>{r.ecriture.compte}</td>
                  <td>{r.ecriture.libelle}</td>
                  <td>{formatMoney(r.ecriture.sens === 'debit' ? r.ecriture.montant : -r.ecriture.montant)}</td>
                  <td>
                    {r.motif === 'sans_justificatif'
                      ? 'aucun justificatif'
                      : 'aucun mouvement bancaire'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {groupesDesequilibres.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Écritures déséquilibrées <span className="badge badge-danger">à vérifier</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le total des débits ne correspond pas à celui des crédits sur ces pièces — un montant réel
            de mouvement bancaire différent de la pièce (frais, paiement partiel...) l'explique parfois,
            mais ça mérite toujours une vérification avant l'export FEC.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Écart</th></tr></thead>
            <tbody>
              {groupesDesequilibres.map((g) => {
                const piece = pieceById(g.pieceId)
                return (
                  <tr key={g.pieceId}>
                    <td>{piece?.tiers ?? piece?.nom_fichier ?? g.pieceId.slice(0, 8)}</td>
                    <td>{formatMoney(g.solde)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {categoriesSansCompte.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Comptes manquants</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces catégories sont utilisées par des pièces validées mais n'ont pas encore de compte comptable associé —
            les écritures correspondantes ne peuvent pas être générées tant que ce n'est pas fait. Un compte déjà
            renseigné est une suggestion à vérifier, pas une valeur figée — modifie-le avant d'enregistrer si besoin.
          </p>
          <table>
            <thead><tr><th>Catégorie</th><th>Compte</th><th></th></tr></thead>
            <tbody>
              {categoriesSansCompte.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 120 }}
                      placeholder="ex. 606100"
                      value={compteAffiche(c)}
                      onChange={(e) => setComptesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                    {!comptesEdit[c.id] && SUGGESTIONS_COMPTE_PAR_CODE[c.code] && (
                      <span className="badge badge-neutral">suggestion</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => saveCompte(c.id)}>Enregistrer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tvaDeductible > 0 || tvaCollectee > 0) && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>TVA déductible (achats)</span>
            <strong>{formatMoney(tvaDeductible)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>TVA collectée (ventes)</span>
            <strong>{formatMoney(tvaCollectee)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Solde</span>
            <strong>{formatMoney(tvaCollectee - tvaDeductible)}</strong>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Déclarations de TVA</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Une fois la CA3 réellement déposée, transcris ici le montant déclaré pour la période — jamais
          calculé par l'appli — pour comparer au total du brouillon sur la même période. Un écart peut
          venir d'une pièce pas encore traitée ici ou d'une erreur sur l'un des deux côtés, à toi de
          trancher.
        </p>
        <form onSubmit={enregistrerDeclaration} className="field-row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="periodeDebut">Début de période</label>
            <input id="periodeDebut" type="date" required value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="periodeFin">Fin de période</label>
            <input id="periodeFin" type="date" required value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tvaDeclaree">TVA nette déclarée</label>
            <input id="tvaDeclaree" type="number" step="0.01" required value={tvaDeclaree} onChange={(e) => setTvaDeclaree(e.target.value)} style={{ width: 140 }} />
          </div>
          <div className="field">
            <label htmlFor="dateDeclaration">Date de dépôt (optionnel)</label>
            <input id="dateDeclaration" type="date" value={dateDeclaration} onChange={(e) => setDateDeclaration(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={savingDeclaration}>
            {savingDeclaration ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>

        {declarationsTva.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr><th>Période</th><th>Déclarée</th><th>Brouillon</th><th>Écart</th><th></th></tr>
            </thead>
            <tbody>
              {declarationsTva.map((d) => {
                const brouillon = tvaNettePourPeriode(ecritures, d.periode_debut, d.periode_fin)
                const ecart = d.tva_declaree - brouillon
                // Tolérance plus large qu'ailleurs (1 €, pas 2 centimes) : une CA3 est déposée en euros
                // arrondis, un écart de quelques centimes ici est donc normal, pas un défaut à signaler.
                const enEcart = Math.abs(ecart) > 1
                return (
                  <tr key={d.id}>
                    <td>{formatDate(d.periode_debut)} → {formatDate(d.periode_fin)}</td>
                    <td>{formatMoney(d.tva_declaree)}</td>
                    <td>{formatMoney(brouillon)}</td>
                    <td>
                      {enEcart
                        ? <span className="badge badge-danger">{formatMoney(ecart)}</span>
                        : <span className="badge badge-ok">{formatMoney(ecart)}</span>}
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimerDeclaration(d.id)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          {ecritures.length} écriture{ecritures.length > 1 ? 's' : ''} proposée{ecritures.length > 1 ? 's' : ''}
          {enAttente.length > 0 && ` — ${enAttente.length} pièce${enAttente.length > 1 ? 's' : ''} en attente de génération`}
          {nbSansContrepartie > 0 && (
            <> — <span className="badge badge-warning">{nbSansContrepartie} en attente de rapprochement bancaire</span></>
          )}
          {piecesDesynchronisees.length > 0 && (
            <> — <span className="badge badge-danger">{piecesDesynchronisees.length} à régénérer</span></>
          )}
          {groupesDesequilibres.length > 0 && (
            <> — <span className="badge badge-danger">{groupesDesequilibres.length} déséquilibrée{groupesDesequilibres.length > 1 ? 's' : ''}</span></>
          )}
        </p>
        <button className="btn btn-primary btn-sm" disabled={generating || enAttente.length === 0} onClick={genererEcritures}>
          {generating ? 'Génération…' : `Générer les écritures manquantes${enAttente.length > 0 ? ` (${enAttente.length})` : ''}`}
        </button>
      </div>

      {brouillonIncomplet && (
        // Dit en clair ce que les deux boutons grisés ne peuvent qu'insinuer : les totaux affichés
        // eux-mêmes portent sur une lecture partielle.
        <p className="error-text">
          Le brouillon n'a pas pu être lu en entier ({brouillonIncomplet}). Les totaux ci-dessous
          portent donc sur une partie des écritures, et les exports FEC et piste d'audit sont
          bloqués — un fichier fiscal amputé ne peut pas dire qu'il l'est.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {horsFec.nb > 0 && (
          <span className="badge badge-danger" title="Le format FEC n'a pas de place pour le dire : c'est ici ou nulle part.">
            {horsFec.nb} écriture{horsFec.nb > 1 ? 's' : ''} ne sera{horsFec.nb > 1 ? 'ont' : ''} pas dans ce FEC
            {' '}({formatMoney(horsFec.debit - horsFec.credit)})
          </span>
        )}
        <button
          className="btn btn-outline btn-sm"
          disabled={typeof anneeFilter !== 'number' || ecrituresFiltrees.length === 0 || brouillonIncomplet !== null}
          title={
            brouillonIncomplet
              ? `Brouillon lu incomplètement (${brouillonIncomplet}) — un FEC amputé ne peut pas le dire, le format n'a pas de place pour ça.`
              : typeof anneeFilter !== 'number' ? "Sélectionne une année ci-dessus — le FEC est un fichier par exercice." : undefined
          }
          onClick={() => {
            if (typeof anneeFilter !== 'number') return
            const contenu = genererFec(ecrituresFiltrees, piecesValidees, categories)
            telechargerTexte(nomFichierFec(dossierSiret, anneeFilter), contenu)
          }}
        >
          Exporter FEC {typeof anneeFilter === 'number' ? anneeFilter : ''}
        </button>
        <button
          className="btn btn-outline btn-sm"
          disabled={typeof anneeFilter !== 'number' || exportPiste || brouillonIncomplet !== null}
          title={
            brouillonIncomplet
              ? `Brouillon lu incomplètement (${brouillonIncomplet}) — une piste d'audit partielle est pire qu'absente.`
              : typeof anneeFilter !== 'number'
              ? "Sélectionne une année ci-dessus — une piste d'audit se produit par exercice."
              : "Chaque écriture avec son justificatif (tiers, date, montant, fichier, empreinte SHA-256) et l'opération bancaire réelle, plus les justificatifs validés que rien ne comptabilise."
          }
          onClick={exporterPisteAudit}
        >
          {exportPiste ? 'Export…' : `Exporter la piste d'audit ${typeof anneeFilter === 'number' ? anneeFilter : ''}`}
        </button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un compte, un libellé, un montant…"
          affiches={ecrituresAffichees.length}
          total={ecrituresFiltrees.length}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : ecrituresAffichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim() ? `Aucune écriture ne correspond à « ${recherche.trim()} ».` : "Aucune écriture proposée pour l'instant."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Compte</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Sens</th>
              </tr>
            </thead>
            <tbody>
              {ecrituresAffichees.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{e.compte}</td>
                  <td>{e.libelle}</td>
                  <td>{formatMoney(e.montant)}</td>
                  <td>
                    {e.sens === 'debit'
                      ? <span className="badge badge-neutral">Débit</span>
                      : <span className="badge badge-ok">Crédit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
