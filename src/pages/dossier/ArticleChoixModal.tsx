import { useState, type CSSProperties } from 'react'
import BarreRecherche from '../../components/BarreRecherche'
import { libelleUnite, nomDansUnRefus } from '../../lib/articles'
import { articlesAChoisir } from '../../lib/articlesFacture'
import { tauxCommeLaBase } from '../../lib/encaissementsFactures'
import { formaterPrixUnitaire } from '../../lib/format'
import type { Article } from '../../lib/types'
import type { EspaceVentes } from '../../lib/espaceVentes'

// « CHOISIR UN ARTICLE » (espace client, étape A2b) : la liste des articles EN COURS du dossier, avec la recherche de
// l'application (référence, désignation), dans l'ordre de la liste d'A2a. Elle ne lit rien : le formulaire de facture la lui
// donne, LUE EN ENTIER, et ne l'ouvre ni avant la lecture ni sur une lecture partielle. Un article retiré ne s'y propose jamais.
// Le choix n'écrit rien : la ligne qu'il remplit reste libre, et c'est le formulaire qui décide s'il faut d'abord confirmer.
interface Props {
  espace: EspaceVentes
  // La liste du dossier lue en entier, retirés compris : le module n'en garde que les articles en cours.
  articles: readonly Article[]
  onChoisir: (article: Article) => void
  onClose: () => void
}

export default function ArticleChoixModal({ espace, articles, onChoisir, onClose }: Props) {
  const [recherche, setRecherche] = useState('')
  const enCours = articlesAChoisir(articles, '')
  const affiches = articlesAChoisir(articles, recherche)

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="article-choix-titre" style={{ width: 'min(560px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="article-choix-titre" style={{ marginTop: 0 }}>Choisir un article</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {espace === 'client'
            ? 'L’article remplit la ligne : désignation, quantité 1, prix et taux. La ligne reste à toi, et la changer ne change pas l’article.'
            : 'L’article remplit la ligne : désignation, quantité 1, prix et taux. La ligne reste libre, et la changer ne change pas l’article.'}
        </p>
        <div style={{ marginBottom: 12 }}>
          <BarreRecherche
            valeur={recherche}
            onChange={setRecherche}
            placeholder="Rechercher une référence, une désignation…"
            affiches={affiches.length}
            total={enCours.length}
          />
        </div>
        {affiches.length === 0 ? (
          <p className="muted">{recherche.trim() ? `Aucun article ne correspond à « ${recherche.trim()} ».` : 'Aucun article en cours.'}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
            {affiches.map((a) => (
              <li key={a.id}>
                <button type="button" className="btn btn-outline" style={choixStyle} onClick={() => onChoisir(a)}>
                  <span style={{ display: 'block' }}><strong>{nomDansUnRefus(a.designation)}</strong></span>
                  <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                    {a.reference ? `${a.reference} · ` : ''}{formaterPrixUnitaire(a.prix_unitaire_ht)} · {libelleUnite(a.unite)}
                    {' · '}{tauxCommeLaBase(a.taux_tva)}{' '}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

// `.btn` est une rangée centrée : la désignation et ses détails s'y rangeraient côte à côte. Un bloc, aligné à gauche, les empile.
const choixStyle: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto' }

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, padding: 20,
}
