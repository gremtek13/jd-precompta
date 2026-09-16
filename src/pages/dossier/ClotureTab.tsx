import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatMoney } from '../../lib/format'
import { SUGGESTIONS_COMPTE_PAR_CODE } from '../../lib/ecritures'
import { categoriesSansPoste as calculerCategoriesSansPoste } from '../../lib/controles'
import { calculerDeclaration2035 } from '../../lib/declaration2035'
import { CASES_2035, arrondirPourFormulaire, incoherencesDesCases, valeursDesCases } from '../../lib/cases2035'
import type { IncoherenceCase, PosteNonRattache } from '../../lib/cases2035'
import { remplir2035 } from '../../lib/remplir2035'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import { useAnnee } from '../../context/AnneeContext'

// Palier 5, briques 5 et 6 réunies — postes de la 2035 et clôture brouillon. Regroupe et totalise
// par poste (recettes, achats, charges sociales, amortissements...) sans jamais calculer de
// résultat ou d'impôt : cette combinaison relève de règles BNC réelles (encaissements/décaissements,
// exercice de rattachement) que ce brouillon ne prétend pas maîtriser — voir le bandeau.
export default function ClotureTab({ dossierId }: { dossierId: string }) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
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
    const [{ data: categoriesData }, { data: piecesData }, { data: immobilisationsData }, { data: cotisationsData }, { data: dossierData }] = await Promise.all([
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      supabase.from('dossiers').select('nom, libelle_naf, siret').eq('id', dossierId).maybeSingle(),
    ])
    setDossier(dossierData ?? null)
    setCategories(categoriesData ?? [])
    setPieces(piecesData ?? [])
    setImmobilisations(immobilisationsData ?? [])
    setCotisations(cotisationsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])


  // Catégories utilisées par une pièce validée mais sans poste 2035 associé — le regroupement par
  // poste ignorera ces pièces tant que ce n'est pas renseigné (voir lib/controles.ts).
  const categoriesSansPoste = calculerCategoriesSansPoste(categories, pieces)

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
    ...pieces.filter((p) => p.date_piece).map((p) => anneeDe(p.date_piece!)),
    ...cotisations.map((c) => anneeDe(c.echeance)),
    ...immobilisations.map((i) => anneeDe(i.date_acquisition)),
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
    calculerDeclaration2035(a, pieces, categories, immobilisations, cotisations),
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

  // Verrou posé avant tout `await` — c'est ce qui le rend effectif contre un double clic, là où un
  // `disabled` piloté par un état React laisse passer le second clic (voir ImportDossierModal).
  const generationEnCours = useRef(false)

  async function telechargerFormulaire(annee: number, valeurs: Map<string, number>) {
    if (generationEnCours.current) return
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
      setError(e instanceof Error ? e.message : 'Génération du formulaire impossible')
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
          />
        ))
      )}
    </>
  )
}

// Un exercice rendu dans la forme du formulaire : une ligne par case, dans l'ordre imprimé, avec son
// code et son libellé officiels. C'est ce qui permet à l'expert-comptable de relire case par case
// plutôt que de retraduire des « postes » maison — et c'est la même structure qui alimentera le PDF.
function FormulaireAnnuel({ annee, valeurs, genere, onTelecharger }: {
  annee: number
  valeurs: Map<string, number>
  genere: boolean
  onTelecharger: () => void
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
        <button className="btn btn-primary btn-sm" onClick={onTelecharger}>
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
