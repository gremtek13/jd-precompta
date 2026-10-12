import { useMemo } from 'react'
import BandeauLecturePartielle, { type AccordLecture } from '../../components/BandeauLecturePartielle'
import { formatDate } from '../../lib/format'
import {
  LIBELLES_DES_NATURES, argumentsDeRetirer, entreesDuDossierPermanent, etatDeLaCitation, refusDeRetirer,
  type ContexteDuDossierPermanent, type EntreeDuDossierPermanent,
} from '../../lib/dossierPermanent'
import {
  EXPLICATION_DE_LA_CITATION, PASTILLE_DE_LA_CITATION, elementsSansEntreeAuRegard, entreesParNature, entreesRetirees, horsDuRegard,
  informationSurUnElementSansEntree, libelleDeLaNature, motNeCouvrePas, validiteEnMots, versionsDuPlusRecentAuPlusAncien,
} from '../../lib/dossierPermanentEcran'
import { parQui } from '../../lib/revueAnalytiqueEcran'
import type { DocumentPourRevision } from '../../lib/revisionPreuves'
import type { EntreeDossierPermanent, Piece } from '../../lib/types'

// LA SECTION « DOSSIER PERMANENT » DE L'ONGLET RÉVISION (ligne 41, étape R7, phase C ; conception, § 1.2, 3.3 et 3.7). Le
// module (lib/dossierPermanent.ts) lit les chaînes de versions et dit les refus ; la section MONTRE ce qu'il rend et ne
// réécrit aucune de ses règles : les entrées COURANTES rangées dans l'ordre de A9, leur validité, ce que leur citation prouve
// encore, l'historique de leurs versions et les entrées retirées (repliés), et — comme une INFORMATION, jamais comme une
// faute — ce que la norme propose et qu'aucune entrée ne porte pour l'exercice regardé.
//
// Le dossier permanent vaut pour PLUSIEURS exercices : la section ne le range par aucun. L'exercice regardé ne sert qu'à dire
// ce qui manque, et à repérer l'entrée dont la validité ne le touche pas. SANS EXERCICE CHOISI (`annee` nul : « toutes », « sans
// date », ou un dossier neuf qui n'offre aucun exercice), elle le dit pour AUJOURD'HUI : `jour`, le jour à Paris, que l'onglet lit
// au rendu — la section ne lit pas l'horloge — ; la lettre de mission précède les travaux, elle ne doit pas attendre une pièce.
//
// SUR UNE LECTURE ABSENTE, PARTIELLE OU ILLISIBLE — la sienne, ou celle des pièces et des documents qu'elle nomme —, la section
// dit pourquoi et ne montre rien, ne déduit rien et n'offre aucun geste ; la lecture d'autre chose (relevés, revue, cycles…) ne la
// regarde pas : un état déduit d'une liste tronquée mentirait, et une consignation ou un retrait est une écriture que la base ne
// défait pas. La section ne lit ni n'écrit rien : l'onglet Révision lui donne ce qu'il a lu et écrit par
// `consigner_au_dossier_permanent` et `retirer_du_dossier_permanent` SEULES, sous son verrou.

export interface LectureDuDossierPermanent {
  lignes: EntreeDossierPermanent[]
  complete: boolean
  motif: string | null
}

// Une des lectures dont la section dépend (les pièces, les documents), quand elle n'est pas entière.
export interface MotifDeSource {
  quoi: string
  accord: AccordLecture
  motif: string
}

export interface PropsDossierPermanent {
  // L'exercice choisi, ou nul : la section regarde alors `jour`.
  annee: number | null
  // Aujourd'hui à Paris (AAAA-MM-JJ), lu au RENDU par l'onglet.
  jour: string
  lecture: LectureDuDossierPermanent
  // Les lectures des pièces et des documents qui ne sont pas entières : vide, la section a tout lu.
  motifsDesSources: readonly MotifDeSource[]
  // Les pièces et les documents du dossier, lus en entier : de quoi nommer ce qu'une entrée cite et dire si son empreinte tient.
  // Reçus entiers : `motifsDesSources` dit le contraire, et la section se tait alors.
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier' | 'storage_hash'>[]
  documents: readonly Pick<DocumentPourRevision, 'id' | 'nom_fichier' | 'storage_hash'>[]
  contexte: ContexteDuDossierPermanent
  dossierId: string
  // L'identifiant du compte connecté : ce qu'il a consigné se dit « par toi ».
  utilisateur: string | null
  occupe: boolean
  // Le refus de la base à un retrait, dit sous l'entrée visée.
  erreur: { entreeId: string; message: string } | null
  // La version courante dont le panneau est ouvert (ou « nouvelle »), pour la repérer.
  ouverte: string | null
  onConsigner: () => void
  onNouvelleVersion: (entree: EntreeDuDossierPermanent) => void
  // Rend vrai quand la base a retiré l'entrée.
  onRetirer: (entree: EntreeDuDossierPermanent) => Promise<boolean>
}

const minuscules = (id: string) => id.toLowerCase()

export default function DossierPermanentSection(p: PropsDossierPermanent) {
  const sourcesLues = p.motifsDesSources.length === 0
  const lues = useMemo(() => (p.lecture.complete ? entreesDuDossierPermanent(p.lecture.lignes) : null), [p.lecture])
  const piecesParId = useMemo(() => new Map(p.pieces.map((x) => [minuscules(x.id), x])), [p.pieces])
  const documentsParId = useMemo(() => new Map(p.documents.map((x) => [minuscules(x.id), x])), [p.documents])
  const affichable = sourcesLues && lues !== null && lues.lisible
  const sansEntree = !affichable || lues === null ? null : elementsSansEntreeAuRegard(lues, p.lecture.complete, p.annee, p.jour)
  const courantes = affichable ? entreesParNature(lues.entrees) : []
  const retirees = affichable ? entreesRetirees(lues.entrees) : []

  async function retirer(e: EntreeDuDossierPermanent) {
    const cite = e.courante.piece_id !== null || e.courante.document_id !== null
    if (!window.confirm(
      `Retirer « ${e.courante.titre} » du dossier permanent ?\n\n`
      + 'Une entrée retirée ne se remplace plus : si elle doit revivre, une nouvelle entrée se consigne. '
      + 'Elle reste dans l’historique, avec ses versions.'
      + (cite ? '\n\nCe qu’elle cite reste gardé : la pièce ou le document ne se supprimera toujours pas, sauf avec son dossier.' : ''),
    )) return
    await p.onRetirer(e)
  }

  return (
    <section className="card" style={{ marginTop: 20 }} aria-label="Dossier permanent">
      <h3 style={{ marginTop: 0 }}>Dossier permanent</h3>
      <p className="muted">
        Ce que le cabinet sait durablement du dossier et de sa mission, valable pour plusieurs exercices (NP 2300, § 16 et A9) :
        il ne dépend pas de l’exercice choisi, ni de ce que la révision des soldes a lu d’autre. Une entrée ne se modifie pas : une nouvelle version la remplace, et l’historique
        reste. Une entrée retirée ne se remplace plus.
      </p>

      {p.motifsDesSources.map((m) => (
        <BandeauLecturePartielle
          key={m.quoi}
          quoi={m.quoi}
          accord={m.accord}
          motif={m.motif}
          // Le motif technique est déjà dit, en clair, au-dessus (la partie annuelle se tait pour la même lecture) : ici, en infobulle.
          technique={false}
          consequence="Le dossier permanent ne dit rien tant que cette lecture est incomplète — ni entrée, ni état de citation, ni élément absent — et n’offre ni consignation, ni nouvelle version, ni retrait : il ne saurait pas nommer ce qu’une entrée cite. Recharge la page."
        />
      ))}
      <BandeauLecturePartielle
        quoi="Les entrées du dossier permanent"
        accord="lues"
        motif={p.lecture.complete ? null : p.lecture.motif ?? 'lecture incomplète'}
        consequence="Le dossier permanent ne dit rien d’une lecture incomplète — ni entrée, ni état de citation, ni élément absent — et n’offre ni consignation, ni nouvelle version, ni retrait. Recharge la page."
      />
      {sourcesLues && lues !== null && !lues.lisible && (
        <p className="error-text">
          Les versions du dossier permanent ne forment pas des chaînes lisibles (une version absente de la lecture, deux suites à une
          même version, une suite à une entrée retirée). Le dossier permanent n’affirme rien et n’offre aucun geste tant qu’elle ne se
          relit pas.
        </p>
      )}

      {affichable && (
        <>
          <div className="fiche-mouvement-boutons" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={p.occupe} onClick={p.onConsigner}>
              Consigner une entrée
            </button>
          </div>

          {courantes.length === 0 && <p className="muted">Aucune entrée n’est consignée au dossier permanent.</p>}
          {courantes.map((g) => (
            <div key={g.nature}>
              <h4 style={{ marginBottom: 4 }}>{g.libelle}</h4>
              {g.entrees.map((e) => (
                <EntreeCourante
                  key={e.versions[0].id}
                  entree={e}
                  annee={p.annee}
                  jour={p.jour}
                  utilisateur={p.utilisateur}
                  contexte={p.contexte}
                  dossierId={p.dossierId}
                  piecesParId={piecesParId}
                  documentsParId={documentsParId}
                  occupe={p.occupe}
                  ouverte={p.ouverte === e.versions[0].id}
                  erreur={p.erreur !== null && p.erreur.entreeId === e.courante.id ? p.erreur.message : null}
                  onNouvelleVersion={p.onNouvelleVersion}
                  onRetirer={retirer}
                />
              ))}
            </div>
          ))}

          {sansEntree !== null && sansEntree.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ marginBottom: 4 }}>À titre d’information</h4>
              <ul className="muted" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
                {sansEntree.map((n) => <li key={n}>{informationSurUnElementSansEntree(n, p.annee)}</li>)}
              </ul>
              <p className="muted" style={{ marginBottom: 0 }}>
                La norme propose ces éléments au dossier permanent (il « peut contenir » …) ; elle ne les impose pas, et rien n’est
                refusé faute de les consigner.
              </p>
            </div>
          )}

          {retirees.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>{`Entrées retirées (${retirees.length})`}</summary>
              {retirees.map((e) => (
                <EntreeRetiree
                  key={e.versions[0].id}
                  entree={e}
                  utilisateur={p.utilisateur}
                  piecesParId={piecesParId}
                  documentsParId={documentsParId}
                />
              ))}
            </details>
          )}
        </>
      )}
    </section>
  )
}

type SourceLue = { nom_fichier: string; storage_hash: string | null }
type Sources = { piecesParId: Map<string, SourceLue>; documentsParId: Map<string, SourceLue> }

// Le nom de ce que la version cite et ce que sa citation prouve encore : rien quand elle ne cite rien.
function Citation({ version, piecesParId, documentsParId }: { version: EntreeDossierPermanent } & Sources) {
  const etat = etatDeLaCitation(version, piecesParId, documentsParId)
  if (etat === null) return null
  const source = version.piece_id !== null ? piecesParId.get(minuscules(version.piece_id))
    : version.document_id !== null ? documentsParId.get(minuscules(version.document_id)) : undefined
  const genre = version.piece_id !== null ? 'Pièce citée' : version.document_id !== null ? 'Document cité' : 'Fichier cité'
  const pastille = PASTILLE_DE_LA_CITATION[etat]
  return (
    <div className="check-ligne-detail" title={EXPLICATION_DE_LA_CITATION[etat]}>
      {`${genre} : `}
      <span className="nom-fichier">{source?.nom_fichier ?? 'introuvable'}</span>
      {' '}
      <span className={`badge ${pastille.classe}`}>{pastille.mot}</span>
    </div>
  )
}

function EntreeCourante({ entree: e, annee, jour, utilisateur, contexte, dossierId, piecesParId, documentsParId, occupe, ouverte, erreur, onNouvelleVersion, onRetirer }: {
  entree: EntreeDuDossierPermanent
  annee: number | null
  jour: string
  utilisateur: string | null
  contexte: ContexteDuDossierPermanent
  dossierId: string
  occupe: boolean
  ouverte: boolean
  erreur: string | null
  onNouvelleVersion: (entree: EntreeDuDossierPermanent) => void
  onRetirer: (entree: EntreeDuDossierPermanent) => Promise<void>
} & Sources) {
  const v = e.courante
  // Le retrait passe ce qu'il enverrait au module : refusé, le bouton est grisé et le refus se lit sous les mots de la base.
  const refusDuRetrait = refusDeRetirer(argumentsDeRetirer(dossierId, v.id), contexte)
  const hors = horsDuRegard(v, annee, jour)
  return (
    <div className="entree-permanente" aria-current={ouverte ? 'true' : undefined}>
      <div className="check-ligne-corps">
        <div className="check-ligne-libelle">{v.titre}</div>
        <div className="check-ligne-detail">
          {`${validiteEnMots(v)}${hors ? ` — ${motNeCouvrePas(annee)}` : ''} · ${e.versions.length > 1 ? `version ${e.versions.length}, ` : ''}consignée le ${formatDate(v.cree_le)}, ${parQui(v.auteur, utilisateur)}`}
        </div>
        <Citation version={v} piecesParId={piecesParId} documentsParId={documentsParId} />
        {v.texte !== null && (
          <details>
            <summary className="check-ligne-detail">Texte</summary>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{v.texte}</div>
          </details>
        )}
        {e.versions.length > 1 && (
          <details>
            <summary className="check-ligne-detail">{`Historique (${e.versions.length} versions)`}</summary>
            <Historique entree={e} utilisateur={utilisateur} piecesParId={piecesParId} documentsParId={documentsParId} />
          </details>
        )}
        {refusDuRetrait !== null && <div className="check-ligne-detail">{`« Retirer » : ${refusDuRetrait.message}`}</div>}
        {erreur && <p className="error-text" style={{ margin: '4px 0 0' }}>{erreur}</p>}
      </div>
      <div className="fiche-mouvement-boutons">
        <button
          type="button" className="btn btn-outline btn-sm" disabled={occupe} aria-label={`Nouvelle version de ${v.titre}`}
          onClick={() => onNouvelleVersion(e)}
        >
          Nouvelle version
        </button>
        <button
          type="button" className="btn btn-outline btn-sm" disabled={occupe || refusDuRetrait !== null}
          title={refusDuRetrait?.message} aria-label={`Retirer ${v.titre}`}
          onClick={() => { void onRetirer(e) }}
        >
          Retirer
        </button>
      </div>
    </div>
  )
}

function EntreeRetiree({ entree: e, utilisateur, piecesParId, documentsParId }: { entree: EntreeDuDossierPermanent; utilisateur: string | null } & Sources) {
  const v = e.courante
  return (
    <div className="entree-permanente">
      <div className="check-ligne-corps">
        <div className="check-ligne-libelle">{`${v.titre} — ${LIBELLES_DES_NATURES[v.nature]}`}</div>
        <div className="check-ligne-detail">
          {`Retirée le ${formatDate(v.retire_le as string)}${v.retire_par !== null ? `, ${parQui(v.retire_par, utilisateur)}` : ''} — ${validiteEnMots(v)}`}
        </div>
        <Citation version={v} piecesParId={piecesParId} documentsParId={documentsParId} />
        <details>
          <summary className="check-ligne-detail">{`Historique (${e.versions.length} version${e.versions.length > 1 ? 's' : ''})`}</summary>
          <Historique entree={e} utilisateur={utilisateur} piecesParId={piecesParId} documentsParId={documentsParId} />
        </details>
      </div>
    </div>
  )
}

// Les versions d'une entrée, la plus récente d'abord : quand, par qui, ce qu'elle disait et ce qu'elle citait.
function Historique({ entree, utilisateur, piecesParId, documentsParId }: { entree: EntreeDuDossierPermanent; utilisateur: string | null } & Sources) {
  return (
    <ol style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>
      {versionsDuPlusRecentAuPlusAncien(entree).map((version, rang) => (
        <li key={version.id} className="check-ligne-detail">
          <div>
            {`${libelleDeLaNature(version.nature)} — ${version.titre}`}
            {rang === 0 && !entree.retiree && ' (courante)'}
          </div>
          <div>{`Consignée le ${formatDate(version.cree_le)}, ${parQui(version.auteur, utilisateur)} — ${validiteEnMots(version)}`}</div>
          <Citation version={version} piecesParId={piecesParId} documentsParId={documentsParId} />
          {version.texte !== null && <div style={{ whiteSpace: 'pre-wrap' }}>{version.texte}</div>}
        </li>
      ))}
    </ol>
  )
}
