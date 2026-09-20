import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatMoney } from '../../lib/format'
import { SUGGESTIONS_COMPTE_PAR_CODE } from '../../lib/ecritures'
import { categoriesSansPoste as calculerCategoriesSansPoste, piecesValideesSansCategorie } from '../../lib/controles'
import { calculerDeclaration2035 } from '../../lib/declaration2035'
import { CASES_2035, arrondirPourFormulaire, doublonFraisVehicules, incoherencesDesCases, valeursDesCases } from '../../lib/cases2035'
import type { DoublonFraisVehicule, IncoherenceCase, PosteNonRattache } from '../../lib/cases2035'
import { remplir2035 } from '../../lib/remplir2035'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece, VehiculeDossier } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import { useAnnee } from '../../context/AnneeContext'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'

// Palier 5, briques 5 et 6 réunies — postes de la 2035 et clôture brouillon. Regroupe et totalise
// par poste (recettes, achats, charges sociales, amortissements...) sans jamais calculer de
// résultat ou d'impôt : cette combinaison relève de règles BNC réelles (encaissements/décaissements,
// exercice de rattachement) que ce brouillon ne prétend pas maîtriser — voir le bandeau.
export default function ClotureTab({ dossierId }: { dossierId: string }) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  // Non nul quand l'une des QUATRE collections dont dépend la déclaration n'a pas pu être lue en
  // entier — pièces, catégories, immobilisations, cotisations, véhicules. Cet écran produit une
  // déclaration : une 2035 calculée sur une partie de ses entrées est plausible, fausse, et signée,
  // et le formulaire n'a nulle part où dire qu'il est amputé. Le remplissage se refuse donc.
  // Le nom dit « lecture » et non « pièces » : il a porté le second pendant que le garde-fou ne
  // vérifiait qu'une entrée sur quatre, ce qu'aucune relecture de l'écran ne pouvait montrer.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Cadre 7 du 2035-B : le total des indemnités kilométriques alimente la case BJ, ligne 23.
  const [vehicules, setVehicules] = useState<VehiculeDossier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [postesEdit, setPostesEdit] = useState<Record<string, string>>({})
  // Identité portée en en-tête du formulaire. Le SIRET s'écrit chiffre par chiffre dans sa grille,
  // et seulement si le formulaire la livre entière (voir grilleDeSaisie) : une grille mal alignée
  // décalerait tout le numéro d'un cran, ce qui est pire qu'une grille vide.
  const [dossier, setDossier] = useState<{ nom: string | null; libelle_naf: string | null; siret: string | null } | null>(null)
  const [genere, setGenere] = useState<number | null>(null)
  // Exercice partagé avec Pièces/Banque/Écritures/Statistiques, sélectionné dans l'en-tête du dossier
  // (voir AnneeContext) — pas de sélecteur local ici. Sa valeur par défaut (voir DossierDetail,
  // calculerAnneeParDefaut) est déjà un exercice précis plutôt que "toutes", justement pour éviter
  // que Clôture s'ouvre sur un mélange de plusieurs exercices sans que l'utilisateur l'ait choisi.
  const { annee: anneeFilter } = useAnnee()

  async function load() {
    setLoading(true)
    // LES QUATRE ENTRÉES DE LA DÉCLARATION SONT LUES PAR TRANCHES, PAS SEULEMENT LES PIÈCES.
    // PostgREST plafonne le nombre de lignes rendues sans le signaler (voir lib/lectureComplete.ts),
    // et cet écran produit une DÉCLARATION. Le garde-fou ne couvrait que `pieces` : il promettait
    // donc « ce formulaire est bâti sur tout » en n'ayant vérifié qu'une entrée sur quatre, et une
    // cotisation ou une immobilisation manquante est tout aussi plausible, fausse et signée.
    // Le tri est TOTAL partout (`id` en départage) : sans clé unique, deux tranches se recouvrent
    // ou sautent des lignes, et rien ne le signale.
    const [lectureCategories, lecturePieces, lectureImmobilisations, lectureCotisations, lectureVehicules, { data: dossierData }] = await Promise.all([
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Tous exercices : c'est le moteur qui filtre sur l'année, comme pour les cotisations.
      lireTout<VehiculeDossier>((debut, fin) =>
        supabase.from('vehicules').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      supabase.from('dossiers').select('nom, libelle_naf, siret').eq('id', dossierId).maybeSingle(),
    ])
    setDossier(dossierData ?? null)
    setVehicules(lectureVehicules.lignes)
    setCategories(lectureCategories.lignes)
    setPiecesValidees(lecturePieces.lignes)
    // Un seul drapeau pour les quatre : l'écran n'a rien de plus utile à dire selon laquelle a
    // manqué, et le formulaire se refuse dans tous les cas.
    setLectureIncomplete(
      [lecturePieces, lectureCategories, lectureImmobilisations, lectureCotisations, lectureVehicules]
        .find((l) => !l.complete)?.motif ?? null,
    )
    setImmobilisations(lectureImmobilisations.lignes)
    setCotisations(lectureCotisations.lignes)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])


  // Catégories utilisées par une pièce validée mais sans poste 2035 associé — le regroupement par
  // poste ignorera ces pièces tant que ce n'est pas renseigné (voir lib/controles.ts).
  const categoriesSansPoste = calculerCategoriesSansPoste(categories, piecesValidees)
  // Même famille que « Postes manquants », un cran plus tôt dans la chaîne : sans catégorie du tout,
  // le montant n'atteint même pas la question du poste (voir lib/controles.ts).
  const piecesSansCategorie = piecesValideesSansCategorie(piecesValidees)

  // Valeur affichée tant que le cabinet n'a rien tapé : la suggestion connue pour ce code de
  // catégorie, sinon vide — jamais enregistrée avant le clic explicite sur "Enregistrer".
  function posteAffiche(c: Categorie): string {
    return postesEdit[c.id] ?? SUGGESTIONS_COMPTE_PAR_CODE[c.code]?.poste2035 ?? ''
  }

  async function savePoste(categorieId: string) {
    const categorie = categories.find((c) => c.id === categorieId)
    const valeur = (postesEdit[categorieId] ?? (categorie ? SUGGESTIONS_COMPTE_PAR_CODE[categorie.code]?.poste2035 : undefined) ?? '').trim()
    if (!valeur) return
    const { error: saveError } = await supabase.from('categories').update({ poste_2035: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Un dossier est par client, pas par année : sans filtre, ce récapitulatif mélangerait tous les
  // exercices dans un seul total par poste — pas ce qu'on attend d'une clôture. "Toutes années" reste
  // disponible (utile pour un premier tour d'horizon) mais affiche un avertissement explicite.
  const anneesDisponibles = [...new Set([
    ...piecesValidees.filter((p) => p.date_piece).map((p) => anneeDe(p.date_piece!)),
    ...cotisations.map((c) => anneeDe(c.echeance)),
    ...immobilisations.map((i) => anneeDe(i.date_acquisition)),
    ...vehicules.map((v) => v.annee),
  ])].sort((a, b) => b - a)

  // Une pièce déjà enregistrée comme immobilisation est représentée par sa dotation annuelle (poste
  // Amortissements) plutôt que par son montant complet — même logique d'exclusion que l'onglet
  // Écritures, pour ne pas compter la dépense deux fois.
  // Le calcul vit dans lib/declaration2035.ts : c'est le même moteur qui alimentera le formulaire
  // fiscal, donc il doit être testé et partagé plutôt que refait ici. Une 2035 est par nature
  // annuelle — le moteur exige un exercice précis, et « toutes » n'est qu'un cumul d'exercices pour
  // consultation (l'avertissement ci-dessous le dit).
  const exercices = typeof anneeFilter === 'number' ? [anneeFilter] : anneesDisponibles
  const declarations = exercices.map((a) =>
    calculerDeclaration2035(a, piecesValidees, categories, immobilisations, cotisations, vehicules),
  )

  // Chaque exercice est rendu dans la forme du formulaire officiel — une case par encadré, dans
  // l'ordre imprimé. Une 2035 est annuelle : plutôt que de cumuler des cases de plusieurs exercices
  // (ce qui remplirait par exemple à la fois « excédent » et « insuffisance », impossible sur un vrai
  // formulaire), on affiche un tableau par exercice.
  const formulaires = declarations.map((d) => ({ declaration: d, ...valeursDesCases(d) }))

  // Postes que le rattachement ne sait pas placer, tous exercices affichés confondus. Même principe
  // que les pièces exclues : un poste qui n'atterrit dans aucune case est un montant absent de la
  // déclaration, et il doit se voir.
  const sansCase = new Map<string, PosteNonRattache>()
  for (const f of formulaires) {
    for (const p of f.postesSansCase) sansCase.set(p.ligne.poste, p)
  }
  const postesSansCase = [...sansCase.values()]

  // Garde armé à l'avance : une case « dont » qui dépasse sa porteuse est une saisie contradictoire.
  // Le moteur ne remplit jamais ces cases (toutes marquées `saisieCabinet`), donc rien ne peut le
  // déclencher tant que l'écran de saisie manuelle n'existe pas — il sera en place le jour où elle
  // arrivera, plutôt qu'à écrire après coup en ayant oublié la règle.
  const incoherences: IncoherenceCase[] = formulaires.flatMap((f) => incoherencesDesCases(f.valeurs))

  // Forfait kilométrique ET frais de véhicule au réel dans la même déclaration : la dépense est
  // comptée deux fois en case BJ, et la case ne montre qu'un total qui ne dit pas de quoi il est fait.
  const doublonsVehicules: { annee: number; doublon: DoublonFraisVehicule }[] = declarations
    .map((d) => ({ annee: d.annee, doublon: doublonFraisVehicules(d) }))
    .filter((x): x is { annee: number; doublon: DoublonFraisVehicule } => x.doublon !== null)

  // Véhicules dont l'indemnité n'a pas pu être calculée : leur déduction manque sur le formulaire,
  // et rien sur le PDF ne le dirait.
  const vehiculesNonCalcules = declarations.flatMap((d) =>
    (d.indemnitesKilometriques?.nonCalcules ?? []).map((n) => ({ annee: d.annee, ...n })),
  )

  // Verrou posé avant tout `await` — c'est ce qui le rend effectif contre un double clic, là où un
  // `disabled` piloté par un état React laisse passer le second clic (voir ImportDossierModal).
  const generationEnCours = useRef(false)

  async function telechargerFormulaire(annee: number, valeurs: Map<string, number>) {
    if (generationEnCours.current || lectureIncomplete) return
    generationEnCours.current = true
    setError(null)
    try {
      // Arrondi à l'euro AVANT le dessin : le formulaire dit « ne pas porter les centimes », et les
      // totaux sont recalculés depuis les cases arrondies pour que la colonne s'additionne.
      const { pdf, codesSansAncrage } = await remplir2035(arrondirPourFormulaire(valeurs), {
        nom: dossier?.nom ?? null,
        activite: dossier?.libelle_naf ?? null,
        siret: dossier?.siret ?? null,
      })
      if (codesSansAncrage.length > 0) {
        setError(`Cases non placées sur le formulaire : ${codesSansAncrage.join(', ')} — leur montant manque sur le PDF.`)
      }
      const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }))
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `2035-${annee}-${(dossier?.nom ?? 'dossier').replace(/[^\w-]+/g, '-')}.pdf`
      lien.click()
      URL.revokeObjectURL(url)
      setGenere(annee)
    } catch (e) {
      setError(messageErreur(e, 'Génération du formulaire impossible'))
    } finally {
      generationEnCours.current = false
    }
  }

  // Ce que le calcul a écarté, tous exercices affichés confondus. Une pièce validée qui n'entre dans
  // aucun total était jusqu'ici retirée par un `continue` muet : sur une base fiscale, c'est un
  // manquant que personne ne voit. Dédoublonné par id, une même pièce pouvant sortir d'un exercice
  // à l'autre pour la même raison.
  const exclues = new Map<string, { piece: Piece; raison: string }>()
  for (const d of declarations) {
    for (const p of d.exclusions.sansPoste) exclues.set(p.id, { piece: p, raison: 'catégorie sans poste 2035' })
    for (const p of d.exclusions.sansDate) exclues.set(p.id, { piece: p, raison: 'aucune date' })
    for (const p of d.exclusions.sansMontant) exclues.set(p.id, { piece: p, raison: 'aucun montant lisible' })
  }
  const piecesExclues = [...exclues.values()]

  return (
    <>
      <BrouillonBanner />
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Regroupement des pièces validées par poste de la 2035, complété par les amortissements et les
        cotisations sociales versées. Un simple total par poste — pas un résultat ni un calcul d'impôt,
        ce travail reste celui de l'expert-comptable.
      </p>

      {anneeFilter === 'toutes' && anneesDisponibles.length > 1 && (
        <p className="muted" style={{ marginTop: -4, marginBottom: 20, color: 'var(--color-warning)' }}>
          ⚠ Plusieurs exercices ({anneesDisponibles.join(', ')}) sont mélangés dans ce total — choisis
          un exercice dans le sélecteur en en-tête du dossier pour un vrai total de clôture.
        </p>
      )}

      {piecesSansCategorie.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces validées sans catégorie <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {piecesSansCategorie.length === 1 ? 'Cette pièce validée n\'a' : `Ces ${piecesSansCategorie.length} pièces validées n'ont`} aucune catégorie : {piecesSansCategorie.length === 1 ? 'son montant n\'entre' : 'leurs montants n\'entrent'} dans aucun total ci-dessous, ni dans la 2035. Le récapitulatif est donc incomplet de {formatMoney(piecesSansCategorie.reduce((s, p) => s + (p.montant_ttc ?? 0), 0))} tant que la catégorie n'est pas donnée depuis l'onglet Justificatifs.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansCategorie.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}{p.date_piece ? ` (${p.date_piece})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {categoriesSansPoste.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Postes manquants</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces catégories sont utilisées par des pièces validées mais n'ont pas encore de poste 2035
            associé — leurs montants ne sont pas comptés dans le récapitulatif tant que ce n'est pas fait.
            Un poste déjà renseigné est une suggestion à vérifier, pas une valeur figée.
          </p>
          <table>
            <thead><tr><th>Catégorie</th><th>Poste 2035</th><th></th></tr></thead>
            <tbody>
              {categoriesSansPoste.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 220 }}
                      placeholder="ex. Achats, Loyers, Recettes..."
                      value={posteAffiche(c)}
                      onChange={(e) => setPostesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                    {!postesEdit[c.id] && SUGGESTIONS_COMPTE_PAR_CODE[c.code] && (
                      <span className="badge badge-neutral">suggestion</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => savePoste(c.id)}>Enregistrer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {piecesExclues.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Pièces validées absentes du récapitulatif ({piecesExclues.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces pièces sont validées mais n'entrent dans aucun total : leur montant manquera dans la
            déclaration tant que la cause n'est pas levée.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>
              {piecesExclues.map(({ piece: p, raison }) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td className="muted">{raison}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(p.montant_ht ?? p.montant_ttc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {postesSansCase.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Postes sans case du formulaire ({postesSansCase.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces postes ont bien un total, mais le rattachement ne sait pas dans quelle case du
            formulaire les porter — leur montant n'apparaîtra nulle part sur la 2035. Renomme le poste
            de la catégorie avec un libellé du formulaire (onglet Clôture, « Postes manquants »).
          </p>
          <table>
            <thead><tr><th>Poste</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>
              {postesSansCase.map((p) => (
                <tr key={p.ligne.poste}>
                  <td>{p.ligne.poste}</td>
                  <td className="muted">
                    {p.raison === 'case du mauvais sens'
                      ? `case ${p.codeRefuse} incompatible avec une ${p.ligne.nature}`
                      : p.raison}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(p.ligne.montant)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doublonsVehicules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Frais de véhicule comptés deux fois ({doublonsVehicules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le barème kilométrique et des frais de véhicule au réel arrivent tous les deux dans la
            case BJ. La notice (renvoi 12) est explicite : l'option pour le forfait vaut pour l'année
            entière et pour tous les véhicules, et les dépenses qu'il couvre ne doivent alors figurer
            à aucun poste de charges. Il faut retirer l'un des deux — le choix vous revient, il engage
            l'exercice entier.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercice</th>
                <th>Poste au réel</th>
                <th style={{ textAlign: 'right' }}>Montant au réel</th>
                <th style={{ textAlign: 'right' }}>Barème kilométrique</th>
              </tr>
            </thead>
            <tbody>
              {doublonsVehicules.map(({ annee, doublon }) => (
                <tr key={annee}>
                  <td>{annee}</td>
                  <td>{doublon.postes.map((p) => p.poste).join(', ')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                    {formatMoney(doublon.totalPostes)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(doublon.montantIndemnites)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vehiculesNonCalcules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Véhicules absents de la case BJ ({vehiculesNonCalcules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces véhicules sont déclarés et leurs kilomètres saisis, mais l'indemnité n'a pas pu être
            calculée : leur déduction manque ligne 23 du formulaire, et rien sur le PDF ne le dirait.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercice</th><th>Véhicule</th><th style={{ textAlign: 'right' }}>Km pro</th><th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {vehiculesNonCalcules.map((n, i) => (
                <tr key={`${n.annee}-${i}`}>
                  <td>{n.annee}</td>
                  <td>
                    {n.vehicule.type}
                    {n.vehicule.type !== 'cyclomoteur' && ` ${n.vehicule.puissanceFiscale} CV`}
                    {n.vehicule.electrique && ' électrique'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {n.vehicule.kmProfessionnel.toLocaleString('fr-FR')}
                  </td>
                  <td className="muted">{n.motif}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {incoherences.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Cases « dont » incohérentes ({incoherences.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Une case « dont » est une part de sa case porteuse : son montant y est déjà compté, il ne
            peut donc pas la dépasser. Les deux cases sont éloignées sur le formulaire, c'est le genre
            d'écart qu'une relecture ne rapproche pas toute seule.
          </p>
          <table>
            <thead>
              <tr>
                <th>Case porteuse</th>
                <th>Cases « dont »</th>
                <th style={{ textAlign: 'right' }}>Total « dont »</th>
                <th style={{ textAlign: 'right' }}>Porteuse</th>
              </tr>
            </thead>
            <tbody>
              {incoherences.map((i) => (
                <tr key={i.porteuse.code}>
                  <td>
                    <span style={{ fontFamily: 'monospace' }}>{i.porteuse.code}</span>
                    <span className="muted" style={{ marginLeft: 8 }}>{i.porteuse.libelle}</span>
                  </td>
                  <td style={{ fontFamily: 'monospace' }}>{i.sousCases.map((c) => c.code).join(' + ')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                    {formatMoney(i.totalSousCases)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(i.montantPorteuse)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lectureIncomplete && (
        <p className="error-text">
          Une des collections dont dépend la déclaration n'a pas pu être lue en entier
          ({lectureIncomplete}) — pièces, catégories, immobilisations, cotisations ou véhicules. Les
          montants ci-dessous portent donc sur une partie du dossier, et le remplissage du
          formulaire est bloqué : une 2035 calculée sur une lecture partielle est plausible, fausse,
          et signée.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
      ) : formulaires.length === 0 ? (
        <div className="card"><div className="empty-state">Rien à regrouper pour l'instant.</div></div>
      ) : (
        formulaires.map((f) => (
          <FormulaireAnnuel
            key={f.declaration.annee}
            annee={f.declaration.annee}
            valeurs={f.valeurs}
            genere={genere === f.declaration.annee}
            onTelecharger={() => telechargerFormulaire(f.declaration.annee, f.valeurs)}
            blocage={lectureIncomplete}
          />
        ))
      )}
    </>
  )
}

// Un exercice rendu dans la forme du formulaire : une ligne par case, dans l'ordre imprimé, avec son
// code et son libellé officiels. C'est ce qui permet à l'expert-comptable de relire case par case
// plutôt que de retraduire des « postes » maison — et c'est la même structure qui alimentera le PDF.
function FormulaireAnnuel({ annee, valeurs, genere, onTelecharger, blocage }: {
  annee: number
  valeurs: Map<string, number>
  genere: boolean
  onTelecharger: () => void
  // Non nul quand la lecture des pièces n'a pas pu se dire complète : le bouton est alors grisé et
  // dit pourquoi, plutôt que de produire un formulaire qu'on croirait complet.
  blocage: string | null
}) {
  // Une case à zéro que personne n'a alimentée n'apprend rien et noie le reste : on ne montre que
  // les cases qui portent un montant, plus les totaux, toujours affichés parce que c'est sur eux que
  // se fait la relecture.
  const visibles = CASES_2035.filter((c) => (valeurs.get(c.code) ?? 0) !== 0 || c.calculee)

  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px' }}>
        <div>
          <strong>Exercice {annee}</strong>
          <span className="muted" style={{ marginLeft: 10, fontSize: '0.9em' }}>
            2035-A-SD et 2035-B-SD — à relire case par case avant dépôt
          </span>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={onTelecharger}
          disabled={blocage !== null}
          title={blocage ? `Lecture partielle d'une des collections de la déclaration (${blocage}) — le formulaire ne peut pas dire qu'il est amputé.` : undefined}
        >
          {genere ? '↻ Regénérer le formulaire' : '⬇ Remplir le formulaire officiel'}
        </button>
      </div>
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>Case</th>
            <th style={{ width: 80 }}>Ligne</th>
            <th>Libellé du formulaire</th>
            <th style={{ textAlign: 'right' }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((c) => (
            <tr key={c.code} style={c.calculee ? { fontWeight: 600 } : undefined}>
              <td style={{ fontFamily: 'monospace' }}>{c.code}</td>
              <td className="muted">{c.ligne}</td>
              <td>
                {c.libelle}
                <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
                  {c.formulaire}{c.calculee ? ` — ${c.calculee}` : ''}
                </span>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(valeurs.get(c.code) ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
