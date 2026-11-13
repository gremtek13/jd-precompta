import { useState, type CSSProperties, type ReactNode } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { optionsAffichees, OPTIONS_AFFICHEES_AU_PLUS, type Citation, type OptionDeCitation } from '../../lib/justificatifsDeLInventaire'
import BarreRecherche from '../../components/BarreRecherche'

// LE CHOIX DE CE QU'UNE ÉCRITURE D'INVENTAIRE CITE (ligne 35, INV5-Q1), dans les deux formulaires de l'onglet Inventaire : la pièce
// d'une régularisation, la pièce ou la facture d'une provision. Il n'écrit RIEN : le choix part avec l'écriture du formulaire, sous
// son verrou. Rien ne se propose avant le retour de la lecture ; lue en partie ou refusée, il le dit et n'offre aucun choix — une
// régularisation remplacée garde alors la pièce qu'elle cite. Ce qui se propose, le titre et le détail de chaque option sont ceux
// du module (lib/justificatifsDeLInventaire.ts) ; la liste passe par la recherche commune et dit son plafond.

interface Props {
  /** Le préfixe des identifiants du formulaire (deux choix dans l'onglet). */
  id: string
  /** L'état de la lecture des pièces et des factures (lib/justificatifsDeLInventaireLecture.ts), gardée avec son dossier par
   *  l'appelant (nulle : pas revenue). Sa seule FORME : ce composant ne lit rien, il n'importe pas le module qui lit. */
  lecture: { etat: 'absente' } | { etat: 'incomplete'; motif: string } | { etat: 'lue' } | null
  /** Ce qui se propose, déjà filtré selon ce que la base acceptera. */
  options: readonly OptionDeCitation[]
  /** Ce que le formulaire cite, et son option retrouvée (nulle : introuvable dans ce qui est lu). */
  citee: Citation | null
  optionCitee: OptionDeCitation | null
  /** « une pièce », « une pièce ou une facture » : ce que la liste propose, pour ses phrases. */
  quoi: string
  desactive: boolean
  onChoisir: (c: Citation | null) => void
}

export default function ChoixDuJustificatif({ id, lecture, options, citee, optionCitee, quoi, desactive, onChoisir }: Props) {
  const [ouvert, setOuvert] = useState(false)
  const [recherche, setRecherche] = useState('')

  const actuel = citee === null ? (
    <span className="muted">Aucune.</span>
  ) : optionCitee === null ? (
    <span className="muted">Celle qui est déjà citée (elle ne se retrouve pas dans ce qui est lu).</span>
  ) : (
    <span>
      {optionCitee.fichier ? <span className="nom-fichier">{optionCitee.titre}</span> : <strong>{optionCitee.titre}</strong>}
      <span className="muted"> — {optionCitee.detail}</span>
    </span>
  )

  let choix: ReactNode
  if (lecture === null || lecture.etat === 'absente') {
    choix = <p className="muted" style={{ margin: '4px 0 0' }}>Chargement des pièces du dossier…</p>
  } else if (lecture.etat === 'incomplete') {
    choix = (
      <BandeauLecturePartielle
        quoi="Les pièces du dossier" accord="lues" motif={lecture.motif}
        consequence={`Aucune ne se choisit d’ici : la saisie part avec ce qu’elle cite déjà (${citee === null ? 'rien' : 'inchangé'}).`}
      />
    )
  } else {
    const { affichees, trouvees } = optionsAffichees(options, recherche)
    choix = (
      <>
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={desactive} aria-expanded={ouvert} aria-controls={`${id}-liste`} onClick={() => setOuvert((o) => !o)}>
            {ouvert ? 'Fermer la liste' : citee === null ? `Choisir ${quoi}` : 'Changer'}
          </button>
          {citee !== null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={desactive} onClick={() => { onChoisir(null); setOuvert(false) }}>
              Ne rien citer
            </button>
          )}
        </div>
        {ouvert && (
          <div id={`${id}-liste`} style={{ marginTop: 8 }}>
            {options.length === 0 ? (
              <p className="muted">Le dossier ne porte rien qui se cite ici.</p>
            ) : (
              <>
                <BarreRecherche
                  valeur={recherche} onChange={setRecherche} placeholder="Rechercher un fichier, un tiers, une date, un montant…"
                  affiches={affichees.length} total={options.length}
                />
                {affichees.length === 0 ? (
                  <p className="muted">Rien ne correspond à « {recherche.trim()} ».</p>
                ) : (
                  <ul aria-label={`Choisir ${quoi}`} style={listeStyle}>
                    {affichees.map((o) => (
                      <li key={`${o.citation.genre}-${o.citation.id}`}>
                        <button
                          type="button" className="btn btn-outline btn-sm" style={choixStyle} disabled={desactive}
                          aria-pressed={citee !== null && citee.genre === o.citation.genre && citee.id === o.citation.id}
                          onClick={() => { onChoisir(o.citation); setOuvert(false); setRecherche('') }}
                        >
                          {o.fichier ? <span className="nom-fichier" style={{ display: 'block' }}>{o.titre}</span> : <strong style={{ display: 'block' }}>{o.titre}</strong>}
                          <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>{o.detail}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {trouvees > affichees.length && (
                  <p className="muted" role="note">
                    {OPTIONS_AFFICHEES_AU_PLUS} affichées sur {trouvees} : affine la recherche pour trouver les autres.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="field" style={{ marginBottom: 8 }}>
      <span id={`${id}-titre`}><strong>Pièce justificative</strong> <span className="muted">(facultative)</span> : {actuel}</span>
      {choix}
    </div>
  )
}

const listeStyle: CSSProperties = {
  listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '40vh', overflowY: 'auto',
}

// `.btn` est une rangée centrée : le titre et son détail s'y rangeraient côte à côte. Un bloc, aligné à gauche, les empile.
const choixStyle: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto' }
