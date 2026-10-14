import { useEffect, useRef, useState } from 'react'
import BarreRecherche from '../../components/BarreRecherche'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { correspondALaRecherche } from '../../lib/recherche'
import { formatDate, formaterPrixUnitaire } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace } from '../../lib/espaceVentes'
import { ACCES_SANS_OBJET, type AccesDuDossier } from '../../lib/auteursVentes'
import { libelleUnite, nomDansUnRefus } from '../../lib/articles'
import { tauxCommeLaBase } from '../../lib/encaissementsFactures'
import { lireLesArticles, type LectureDesArticles } from '../../lib/articlesLecture'
import { enregistrerArticle, reprendreArticle, retirerArticle } from '../../lib/articlesEcriture'
import {
  articlesAffiches, champsDeRechercheArticle, gestesDeLArticle, mentionParLeClient, refusDeLaSaisie,
  saisieEnvoyee, type SaisieArticle,
} from '../../lib/articlesVue'
import type { Article } from '../../lib/types'
import ArticleSaisieModal from './ArticleSaisieModal'

// « ARTICLES » (espace client, étape A2a ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE
// PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.1) : le catalogue du dossier — la liste et ses gestes (nouvel article, modifier,
// retirer, reprendre). La vue « Articles » de l'onglet Factures, à côté de « Factures » et « Règlements » : au cabinet dans
// l'onglet, au client « Ventes » dans « Mes ventes ». Le choix d'un article dans le formulaire d'une facture, lui, est celui de `FactureFormModal` (étape A2b).
//
// QUI ÉCRIT : le cabinet ET le client « Ventes », par les mêmes fonctions de la base (MEG1-Q1) ; ce que chacune refuserait
// est dit avant le clic par le module `lib/articles.ts`, et la base juge encore — son refus se dit sous ses mots.
//
// RIEN AVANT LA LECTURE, RIEN SUR UNE LECTURE PARTIELLE : « Chargement… » tant que les articles ne sont pas revenus ; un vide
// ne se dit que d'une liste lue en entier ; lue en partie, la liste porte son bandeau et AUCUN geste (l'unicité d'une
// référence ne se juge pas sur des articles qu'on n'a pas lus).
//
// UN SEUL VERROU POUR LES TROIS GESTES (`gesteEnCours`, un `useRef` posé AVANT le `try`) : relâché dans le `finally`, APRÈS la
// relecture de la liste — un second clic pendant qu'elle court écrirait sur ce que la liste montrait avant —, relue aussi sur
// un refus, pour que la liste dise ce que la base a gardé.
type QuiRegarde = { espace: 'cabinet'; acces: AccesDuDossier } | { espace: 'client' }

type Props = QuiRegarde & { dossierId: string }

// La lecture, gardée AVEC le dossier pour lequel elle a été faite : un autre dossier repart en chargement, et la réponse
// tardive d'un dossier quitté ne s'affiche pas.
type Lecture = { cle: string; lu: LectureDesArticles } | { cle: string; echec: string }

// Une description longue ne se déroule pas dans une cellule : sa suite est dans « Modifier ».
const DESCRIPTION_AFFICHEE_MAX = 140

const NOM_NATURE = { biens: 'Biens', services: 'Services' } as const

const CONSEQUENCE_PARTIELLE = 'Aucun geste n’est donc offert : une liste tronquée dirait « libre » une référence déjà prise, '
  + 'et « aucun article » d’un catalogue qui en a.'

export default function ArticlesVue(props: Props) {
  const { dossierId, espace } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const acces = props.espace === 'cabinet' ? props.acces : ACCES_SANS_OBJET
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [recherche, setRecherche] = useState('')
  const [avecLesRetires, setAvecLesRetires] = useState(false)
  // La saisie ouverte : un article neuf (`article` nul) ou celui qu'on modifie, tel que la liste l'a lu.
  const [fenetre, setFenetre] = useState<{ article: Article | null } | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const gesteEnCours = useRef(false)
  // Le dossier que la vue affiche, pour qu'une relecture lancée sous un dossier quitté depuis ne s'inscrive pas.
  const dossierAffiche = useRef(dossierId)

  // La première lecture, et celle d'un autre dossier : une réponse arrivée après un changement de dossier ne s'inscrit pas
  // (`annule`), si bien que la plus lente n'écrit jamais en dernier.
  useEffect(() => {
    let annule = false
    dossierAffiche.current = dossierId
    lireLesArticles(dossierId).then(
      (lu) => { if (!annule) setLecture({ cle: dossierId, lu }) },
      (e: unknown) => { if (!annule) setLecture({ cle: dossierId, echec: messageErreur(e, 'les articles n’ont pas pu être lus') }) },
    )
    return () => { annule = true }
  }, [dossierId])

  // La relecture d'après une écriture : les gestes sont sous verrou, deux relectures ne se croisent donc pas.
  async function relire() {
    try {
      const lu = await lireLesArticles(dossierId)
      if (dossierAffiche.current === dossierId) setLecture({ cle: dossierId, lu })
    } catch (e) {
      if (dossierAffiche.current === dossierId) {
        setLecture({ cle: dossierId, echec: messageErreur(e, 'les articles n’ont pas pu être lus') })
      }
    }
  }

  // Le verrou des trois gestes. Posé avant le `try` : dans le `try`, le `return` du deuxième clic sortirait par le `finally`
  // et relâcherait le verrou du PREMIER, encore en cours.
  async function sousVerrou(repli: string, ecrire: () => Promise<string>): Promise<boolean> {
    if (gesteEnCours.current) return false
    gesteEnCours.current = true
    setOccupe(true)
    setErreur(null)
    setMessage(null)
    let reussi = false
    try {
      setMessage(await ecrire())
      reussi = true
    } catch (e) {
      setErreur(messageErreur(e, repli))
    } finally {
      await relire()
      gesteEnCours.current = false
      setOccupe(false)
    }
    return reussi
  }

  const courante = lecture?.cle === dossierId ? lecture : null
  if (courante == null) return <p className="muted">Chargement…</p>
  if ('echec' in courante) {
    return (
      <p className="error-text">
        {espace === 'client' ? 'Tes articles ne s’affichent pas' : 'Les articles ne s’affichent pas'} : {courante.echec}. Rouvre cette vue
        pour les relire.
      </p>
    )
  }

  const { lignes: articles, complete, motif } = courante.lu
  // Aucun geste ne part d'une liste lue en partie.
  const peutEcrire = complete
  const avantRecherche = articlesAffiches(articles, avecLesRetires)
  const affiches = avantRecherche.filter((a) => correspondALaRecherche(champsDeRechercheArticle(a), recherche))

  async function enregistrer(saisie: SaisieArticle, article: Article | null) {
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaSaisie(dossierId, article ? { nouveau: false, article } : { nouveau: true }, saisie, articles)
    if (refus) {
      setErreur(refus.message)
      return
    }
    const ouvert = await sousVerrou('L’article n’a pas pu être enregistré.', async () => {
      const ecrit = await enregistrerArticle(dossierId, article?.id ?? null, saisieEnvoyee(saisie))
      return `Article « ${nomDansUnRefus(ecrit.designation)} » enregistré.`
    })
    if (ouvert) setFenetre(null)
  }

  async function basculer(article: Article) {
    const { basculer: geste } = gestesDeLArticle(dossierId, article, articles)
    if (geste.refus) {
      setErreur(geste.refus.message)
      return
    }
    if (geste.geste === 'retirer') {
      await sousVerrou('L’article n’a pas pu être retiré.', async () => {
        const ecrit = await retirerArticle(dossierId, article.id)
        return `Article « ${nomDansUnRefus(ecrit.designation)} » retiré.`
      })
    } else {
      await sousVerrou('L’article n’a pas pu être repris.', async () => {
        const ecrit = await reprendreArticle(dossierId, article.id)
        return `Article « ${nomDansUnRefus(ecrit.designation)} » repris.`
      })
    }
  }

  function ouvrir(article: Article | null) {
    setErreur(null)
    setMessage(null)
    setFenetre({ article })
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {espace === 'client'
          ? 'Ton catalogue d’articles : référence, désignation, description, unité, prix hors taxes, taux de TVA et nature. '
            + 'Ton cabinet le lit aussi, et le tient avec toi. Un article se modifie, se retire et se reprend ; il ne se supprime pas.'
          : 'Le catalogue d’articles du dossier : référence, désignation, description, unité, prix hors taxes, taux de TVA et '
            + 'nature. Le client qui porte la case « Ventes » le lit en entier et le tient avec vous ; « par le client » marque '
            + 'l’article qu’il a créé, modifié ou retiré en dernier. Un article se modifie, se retire et se reprend ; il ne se '
            + 'supprime pas.'}
      </p>

      <BandeauLecturePartielle
        quoi={espace === 'client' ? 'Tes articles' : dire('Les articles du dossier')} accord="lus" motif={complete ? null : (motif ?? 'lecture incomplète')}
        consequence={CONSEQUENCE_PARTIELLE} technique={espace === 'cabinet'}
      />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher une référence, une désignation…"
          affiches={affiches.length}
          total={avantRecherche.length}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={avecLesRetires} onChange={(e) => setAvecLesRetires(e.target.checked)} />
          Retirés
        </label>
        {peutEcrire && (
          <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => ouvrir(null)}>
            + Nouvel article
          </button>
        )}
      </div>
      <p className="muted" style={{ margin: '-8px 0 14px', fontSize: '0.82rem' }}>
        Sans « Retirés », les articles retirés ne se montrent pas ; ils gardent leur référence.
      </p>

      {!fenetre && erreur && <p className="error-text" role="alert">{erreur}</p>}
      {message && <p role="status">{message}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {affiches.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun article ne correspond à « ${recherche.trim()} ».`
              : !complete ? 'La liste des articles n’a pas pu être lue en entier.'
                : articles.length === 0
                  ? (espace === 'client' ? 'Tu n’as encore aucun article.' : 'Aucun article n’est enregistré pour ce dossier.')
                  : 'Aucun article n’est en cours : les articles retirés se montrent avec « Retirés ».'}
          </div>
        ) : (
          // Huit colonnes, dont une commande : repliées en fiches sous 860 pixels d'enveloppe, comme les listes voisines.
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte" aria-label="Articles">
              <thead>
                <tr>
                  <th>Référence</th><th>Désignation</th><th>Unité</th><th>Prix HT</th><th>TVA</th><th>Nature</th><th>État</th>
                  {peutEcrire && <th></th>}
                </tr>
              </thead>
              <tbody>
                {affiches.map((a) => {
                  const gestes = gestesDeLArticle(dossierId, a, articles)
                  const parLeClient = mentionParLeClient(acces, a)
                  return (
                    <tr key={a.id}>
                      <td data-libelle="Référence">{a.reference ?? '—'}</td>
                      {/* Un SEUL enfant : en fiche (téléphone), les enfants d'une cellule se rangent côte à côte de son libellé, et une
                          description à part y tombait dans une colonne de 40 pixels (banc, 390 px : « Séanc|e »). */}
                      <td data-libelle="Désignation">
                        <div>
                          <div>{a.designation}</div>
                          {a.description && (
                            <div className="muted" style={{ fontSize: '0.78rem' }} title={a.description}>
                              {Array.from(a.description).length > DESCRIPTION_AFFICHEE_MAX
                                ? `${Array.from(a.description).slice(0, DESCRIPTION_AFFICHEE_MAX).join('')}…`
                                : a.description}
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-libelle="Unité">{libelleUnite(a.unite)}</td>
                      <td data-libelle="Prix HT">{formaterPrixUnitaire(a.prix_unitaire_ht)}</td>
                      {/* L'espace avant « % » est insécable : « 20 / % » sur deux lignes dans une colonne étroite (banc, 1 440 px). */}
                      <td data-libelle="TVA">{tauxCommeLaBase(a.taux_tva)}{' '}%</td>
                      <td data-libelle="Nature">{NOM_NATURE[a.nature]}</td>
                      <td data-libelle="État">
                        <div className="pastilles-empilees">
                          {a.retire_le != null
                            ? <span className="badge badge-neutral">Retiré le {formatDate(a.retire_le)}</span>
                            : <span className="badge badge-ok">En cours</span>}
                          {parLeClient && (
                            <span className="badge badge-neutral badge-une-ligne" title={parLeClient.titre}>{parLeClient.libelle}</span>
                          )}
                        </div>
                      </td>
                      {peutEcrire && (
                        <td className="td-actions">
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={occupe || gestes.modifier != null}
                            title={gestes.modifier?.message} onClick={() => ouvrir(a)}
                          >
                            Modifier
                          </button>
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={occupe || gestes.basculer.refus != null}
                            title={gestes.basculer.refus?.message} onClick={() => basculer(a)}
                          >
                            {gestes.basculer.geste === 'retirer' ? 'Retirer' : 'Reprendre'}
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {fenetre && peutEcrire && (
        <ArticleSaisieModal
          dossierId={dossierId}
          espace={espace}
          article={fenetre.article}
          articles={articles}
          occupe={occupe}
          erreur={erreur}
          onEnregistrer={(saisie) => enregistrer(saisie, fenetre.article)}
          onClose={() => setFenetre(null)}
        />
      )}
    </>
  )
}
