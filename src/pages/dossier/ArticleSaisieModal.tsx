import { useState, type CSSProperties } from 'react'
import { NATURES_ARTICLE, UNITES_ARTICLE } from '../../lib/articles'
import type { ArticlePourReference } from '../../lib/articles'
import { TAUX_ADMIS } from '../../lib/factureCii'
import { tauxCommeLaBase } from '../../lib/encaissementsFactures'
import {
  LIBELLE_DESCRIPTION_ARTICLE, LIBELLE_DESCRIPTION_ARTICLE_CLIENT, LIBELLE_DESIGNATION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE_CLIENT,
} from '../../lib/droitsAcces'
import { refusDeLaSaisie, saisieInitiale, saisieTouchee, type SaisieArticle } from '../../lib/articlesVue'
import type { Article, NatureArticle, UniteArticle } from '../../lib/types'
import type { EspaceVentes } from '../../lib/espaceVentes'

// LA SAISIE D'UN ARTICLE (espace client, étape A2a) : « Nouvel article » et « Modifier ». TOUS les champs partent ensemble
// par `enregistrer_article` (la saisie d'une modification part de l'article LU, l'unité d'un article neuf est la générique).
// La fenêtre ne juge RIEN : le module (`lib/articles.ts`, par `refusDeLaSaisie`) dit le premier refus que la base
// opposerait, dans son ordre et sous ses mots, avant le clic ; le bouton se grise sous ce refus. L'écriture, son verrou et
// la relecture sont ceux de la vue qui l'ouvre (un seul verrou pour les trois gestes) : ici, ni appel ni état d'écriture.
//
// LES DEUX TEXTES LIBRES, désignation et description, disent au-dessus du champ qui les lit : au cabinet, le client qui porte
// « Ventes » ; au client, son cabinet aussi (CLAUDE.md, « Un texte libre que le cabinet saisit dans une table qu'un droit
// du client ouvre le dit dans son libellé »).
interface Props {
  dossierId: string
  espace: EspaceVentes
  // L'article modifié, tel que la liste l'a lu ; nul pour un article neuf.
  article: Article | null
  // Une saisie de départ pour un article NEUF (étape A2b : « Enregistrer comme article » la tire d'une ligne de facture) ; sans
  // elle, l'article neuf part de la saisie vide. Elle compte comme le point de départ : rien n'est « touché » tant qu'on n'y
  // change rien, et le refus qu'elle porte déjà (la nature à choisir) se dit sans alerte.
  saisieDeDepart?: SaisieArticle
  // La liste LUE EN ENTIER : l'unicité d'une référence s'y juge. La vue n'ouvre rien sur une lecture partielle.
  articles: readonly ArticlePourReference[]
  // Une écriture est en cours (la vue tient le verrou) ; l'erreur qu'elle a rendue, sous les mots de la base.
  occupe: boolean
  erreur: string | null
  onEnregistrer: (saisie: SaisieArticle) => void
  onClose: () => void
}

const NOM_NATURE: Record<NatureArticle, string> = { biens: 'Biens', services: 'Services' }

export default function ArticleSaisieModal({ dossierId, espace, article, saisieDeDepart, articles, occupe, erreur, onEnregistrer, onClose }: Props) {
  const [depart] = useState(() => saisieDeDepart ?? saisieInitiale(article))
  const [saisie, setSaisie] = useState<SaisieArticle>(depart)
  const changer = <K extends keyof SaisieArticle>(k: K, v: SaisieArticle[K]) => setSaisie({ ...saisie, [k]: v })

  const refus = refusDeLaSaisie(dossierId, article ? { nouveau: false, article } : { nouveau: true }, saisie, articles)
  // Un refus dit dès l'ouverture d'un article neuf, c'est « la désignation est à renseigner » avant d'avoir tapé un mot :
  // discret tant que rien n'a bougé, d'alerte ensuite.
  const touchee = saisieTouchee(depart, saisie)
  const client = espace === 'client'

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="article-titre" style={{ width: 'min(620px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="article-titre" style={{ marginTop: 0 }}>{article ? 'Modifier l’article' : 'Nouvel article'}</h2>

        <div className="field">
          <label htmlFor="article-reference">Référence (facultative)</label>
          <input id="article-reference" value={saisie.reference} onChange={(e) => changer('reference', e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="article-designation">{client ? LIBELLE_DESIGNATION_ARTICLE_CLIENT : LIBELLE_DESIGNATION_ARTICLE}</label>
          <input id="article-designation" value={saisie.designation} onChange={(e) => changer('designation', e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="article-description">{client ? LIBELLE_DESCRIPTION_ARTICLE_CLIENT : LIBELLE_DESCRIPTION_ARTICLE}</label>
          <textarea id="article-description" rows={3} value={saisie.description} onChange={(e) => changer('description', e.target.value)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="article-unite">Unité</label>
            <select id="article-unite" value={saisie.unite} onChange={(e) => changer('unite', e.target.value as UniteArticle)}>
              {UNITES_ARTICLE.map((u) => <option key={u.code} value={u.code}>{u.libelle}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="article-prix">Prix hors taxes (€)</label>
            <input
              id="article-prix" inputMode="decimal" placeholder="ex. 12,50" value={saisie.prix}
              onChange={(e) => changer('prix', e.target.value)}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="article-taux">Taux de TVA</label>
            <select id="article-taux" value={saisie.taux} onChange={(e) => changer('taux', e.target.value)}>
              <option value="">Choisir…</option>
              {TAUX_ADMIS.map((t) => <option key={t} value={String(t)}>{tauxCommeLaBase(t)} %</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="article-nature">Nature</label>
            <select id="article-nature" value={saisie.nature} onChange={(e) => changer('nature', e.target.value as NatureArticle | '')}>
              <option value="">Choisir…</option>
              {NATURES_ARTICLE.map((n) => <option key={n} value={n}>{NOM_NATURE[n]}</option>)}
            </select>
          </div>
        </div>

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : refus && <p className={touchee ? 'error-text' : 'muted'}>{refus.message}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || refus != null} title={refus?.message}
            onClick={() => onEnregistrer(saisie)}
          >
            {occupe ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
