import { useEffect, useState } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconRevision } from '../../components/icons'
import { formatDate, formatMoney } from '../../lib/format'
import {
  LIBELLE_DE_LA_SOURCE, LONGUEUR_MAX_EXPLICATION, argumentsDExpliquerVariation, refusDExpliquerVariation,
  type ContexteDeLExplication, type LigneDeLaRevue,
} from '../../lib/revueAnalytique'
import {
  CAUSES_A_REVOIR_DE_LA_LIGNE, PASTILLE_DE_L_ETAT_DE_LA_LIGNE, parQui, titreDeLaLigne, variationEnMots,
} from '../../lib/revueAnalytiqueEcran'
import type { RevisionExplication } from '../../lib/types'

// LE PANNEAU D'UNE LIGNE DE LA REVUE ANALYTIQUE (ligne 41, étape R5, phase C ; conception, § 4.5), dans le volet de droite :
// la ligne, ses montants et la source du précédent, l'explication courante, l'historique de la chaîne — et le geste
// « Expliquer » / « Remplacer l'explication ». La fiche ne lit ni n'écrit rien : l'onglet Révision lui donne la ligne
// DÉDUITE par le module et ce qu'il a lu EN ENTIER, et écrit par `expliquer_variation` SEULE, sous son verrou.
//
// LE REFUS SE DIT AVANT LE CLIC : le bouton passe ce qu'il enverrait au module (`refusDExpliquerVariation`, confronté au
// texte de la fonction et rejoué sur son essai) ; refusé, il est grisé, et le refus se lit sous les mots de la base. La
// base reste juge : un refus qu'elle oppose quand même se dit à son tour.
//
// RIEN NE S'EFFACE : une explication se REMPLACE par une autre, la chaîne reste. L'explication commente les montants que
// l'écran a MONTRÉS ; si un montant change ensuite (une écriture, un repère, une 2035), la ligne passe « à revoir » et le
// dit. Le texte est celui du cabinet : l'application ne l'écrit pas, ne le préremplit pas, ne dit jamais « normal ».

export interface PropsFicheExplication {
  dossierId: string
  annee: number
  // La ligne, telle que le module la rend aujourd'hui : ses montants, sa source, son état, sa chaîne d'explications.
  ligne: LigneDeLaRevue
  contexte: ContexteDeLExplication
  // L'identifiant du compte connecté : ce qu'il a écrit se dit « par toi ».
  utilisateur: string | null
  occupe: boolean
  erreur: string | null
  // Rend vrai quand la base a écrit : la saisie repart alors de zéro ; refusée, elle reste pour se corriger.
  onExpliquer: (ligne: LigneDeLaRevue, explication: string, remplaceId: string | null) => Promise<boolean>
  // Rapporte si une saisie attend : la garde du volet le consulte. Doit être une fonction STABLE.
  onModifiee: (modifiee: boolean) => void
  onFermer: () => void
}

const montant = (centimes: number | null) => (centimes === null ? '—' : formatMoney(centimes / 100))

export default function FicheExplication(p: PropsFicheExplication) {
  const { ligne: l } = p
  const courante = l.explications.courant
  // L'explication en cours de saisie, et la courante qu'elle remplacera, RETENUE au premier mot : si une autre a été donnée
  // depuis, le module le dit avant le clic (refus 10), au lieu que la saisie remplace sans le voir une explication jamais lue.
  const [texte, setTexte] = useState('')
  const [depart, setDepart] = useState<{ id: string | null } | null>(null)
  const modifiee = texte !== ''
  const { onModifiee } = p
  useEffect(() => { onModifiee(modifiee) }, [modifiee, onModifiee])

  const remplaceId = depart === null ? courante?.id ?? null : depart.id
  const refus = refusDExpliquerVariation(argumentsDExpliquerVariation(p.dossierId, p.annee, l, texte, remplaceId), p.contexte)
  const libelle = courante ? 'Remplacer l’explication' : 'Expliquer'
  // L'exercice ne se révise pas (en cours, hors des bornes) : la phrase de la base — les refus 2 et 3 précèdent tout ce que la
  // saisie pourrait changer.
  const raisonSansGeste = l.etat === 'en-attente' ? refus?.message ?? null : null
  const pastille = PASTILLE_DE_L_ETAT_DE_LA_LIGNE[l.etat]
  const variation = variationEnMots(l)
  const historique = [...l.explications.elements].reverse()

  async function expliquer() {
    if (await p.onExpliquer(l, texte, remplaceId)) {
      setTexte('')
      setDepart(null)
    }
  }

  return (
    <div className="fiche-mouvement">
      <EntetePanneau
        icone={<IconRevision width={18} height={18} />}
        titre={titreDeLaLigne(l.cle)}
        sousTitre={`Revue analytique ${p.annee}`}
        onFermer={p.onFermer}
      />
      <div className="fiche-mouvement-corps">
        <div className="fiche-mouvement-tuiles">
          <div className="fiche-mouvement-tuile">
            <span>{`Exercice ${p.annee}`}</span>
            <strong>{montant(l.montantCentimes)}</strong>
          </div>
          <div className="fiche-mouvement-tuile">
            <span>{`Exercice ${p.annee - 1}`}</span>
            <strong>{montant(l.precedentCentimes)}</strong>
          </div>
          <div className="fiche-mouvement-tuile">
            <span>Variation</span>
            <strong>{variation.euros}</strong>
            <span>{variation.pourcentage}</span>
          </div>
          <div className="fiche-mouvement-tuile">
            <span>Source du précédent</span>
            <strong>{LIBELLE_DE_LA_SOURCE[l.source]}</strong>
          </div>
          <div className="fiche-mouvement-tuile">
            <span>État de la ligne</span>
            <strong><span className={`badge ${pastille.classe}`}>{pastille.mot}</span></strong>
          </div>
        </div>
        {l.causes.length > 0 && (
          <p className="fiche-mouvement-alerte">
            {`À revoir : l’explication courante est restée à d’autres chiffres — ${l.causes.map((x) => CAUSES_A_REVOIR_DE_LA_LIGNE[x]).join(' ; ')}.`}
          </p>
        )}
        {l.etat === 'a-expliquer' && (
          <p className="fiche-mouvement-note">
            La variation dépasse le seuil de signification : une explication est attendue. L’application ne la juge pas, et la
            validation de l’exercice ne la réclame pas encore.
          </p>
        )}
        {l.etat === 'sans-comparaison' && (
          <p className="fiche-mouvement-note">Rien de l’exercice précédent ne se compare à cette ligne : elle n’a pas de variation.</p>
        )}
        {raisonSansGeste && <p className="fiche-mouvement-note">{raisonSansGeste}</p>}

        <section className="fiche-mouvement-section">
          <h3>Historique des explications</h3>
          {historique.length === 0 ? (
            <p className="fiche-mouvement-note">{`Cette ligne n’a pas encore d’explication pour ${p.annee}.`}</p>
          ) : (
            <>
              {!l.explications.lisible && (
                <p className="fiche-mouvement-alerte">
                  La chaîne des explications ne se lit pas : elles sont rangées dans l’ordre de leur création, et aucune n’est
                  tenue pour l’explication courante.
                </p>
              )}
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
                {historique.map((e) => (
                  <ExplicationDeLHistorique key={e.id} explication={e} courante={courante?.id === e.id} utilisateur={p.utilisateur} />
                ))}
              </ol>
            </>
          )}
        </section>

        {raisonSansGeste === null && (
          <section className="fiche-mouvement-section">
            <h3>{courante ? 'Une nouvelle explication' : 'Expliquer la variation'}</h3>
            <p className="fiche-mouvement-note">
              {'Une explication ne s’efface pas : elle se remplacera par une autre, et l’historique reste. Elle commente les montants ci-dessus, tels qu’ils sont aujourd’hui.'}
              {courante && ` Celle-ci remplacera l’explication courante du ${formatDate(courante.cree_le)}.`}
            </p>
            <div className="field">
              <label htmlFor="explication-texte">Explication</label>
              <textarea
                id="explication-texte" rows={5} maxLength={LONGUEUR_MAX_EXPLICATION} value={texte} disabled={p.occupe}
                onChange={(e) => {
                  if (depart === null) setDepart({ id: courante?.id ?? null })
                  setTexte(e.target.value)
                }}
              />
              <p className="fiche-mouvement-note">Aucune donnée de patient : une explication se lit dans le dossier de travail du cabinet.</p>
            </div>
            {refus && <p className="fiche-mouvement-note"><strong>{`« ${libelle} » : `}</strong>{refus.message}</p>}
            {p.erreur && <p className="error-text" style={{ margin: 0 }}>{p.erreur}</p>}
          </section>
        )}
      </div>
      {raisonSansGeste === null && (
        <div className="fiche-mouvement-pied">
          <div className="fiche-mouvement-boutons">
            <button
              type="button" className="btn btn-primary btn-sm" disabled={p.occupe || refus !== null} title={refus?.message}
              onClick={() => { void expliquer() }}
            >
              {libelle}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Une explication de l'historique : quand, par qui, ce qu'elle commentait, et son texte.
function ExplicationDeLHistorique({ explication: e, courante, utilisateur }: {
  explication: RevisionExplication
  courante: boolean
  utilisateur: string | null
}) {
  const precedent = e.montant_precedent === null ? 'sans précédent' : `précédent ${formatMoney(Number(e.montant_precedent))}`
  return (
    <li className="fiche-mouvement-note">
      <div className="fiche-mouvement-etat">{courante && <span className="badge badge-neutral">courante</span>}</div>
      <div>{`Le ${formatDate(e.cree_le)}, ${parQui(e.auteur, utilisateur)}.`}</div>
      <div>{`Elle commentait ${formatMoney(Number(e.montant))} (${precedent}, source : ${LIBELLE_DE_LA_SOURCE[e.source_precedent].toLowerCase()}).`}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{e.explication}</div>
    </li>
  )
}
