import { useEffect, useMemo, useState } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import BarreRecherche from '../../components/BarreRecherche'
import { IconRevision } from '../../components/icons'
import { correspondALaRecherche } from '../../lib/recherche'
import { formatDate, formatMoney } from '../../lib/format'
import {
  apresLaValidation, argumentsDeJustifierSolde, decisionDeLaReprise, refusDeJustifierSolde, verifierCitation,
  type CompteEnRevision, type ContexteDeJustification, type DecisionComposee, type EtatDeLaCitation, type SourceCitee,
} from '../../lib/revision'
import { instantaneDeLaPreuve, lireInstantaneDePreuve, soldeEnMots, type DocumentPourRevision, type TypeDeReference } from '../../lib/revisionPreuves'
import { LONGUEUR_MAX_MOTIF, LONGUEUR_MAX_PRECISION } from '../../lib/revisionSoldes'
import type { EtatDecisionRevision, Piece, PorteeDecisionRevision, RevisionJustification, RevisionPreuve } from '../../lib/types'
import {
  CAUSES_A_REVOIR, ETAT_DU_SOLDE, LIBELLES_DES_DECISIONS, PASTILLE_DU_VERDICT, PASTILLE_DE_LA_DECISION,
} from '../../lib/revisionLibelles'

// LE PANNEAU « JUSTIFIER » D'UN SOLDE DE BILAN (ligne 41, étape R3 ; conception, § 4.3), dans le volet de droite : ce que
// l'application propose (la preuve, ce qu'elle établit et n'établit pas), la mémoire (la reprise de l'exercice
// précédent, l'historique des décisions du compte), et la décision. La fiche ne lit ni n'écrit rien : l'onglet Révision
// (RevisionTab) lui donne ce qu'il a lu EN ENTIER, et écrit par `justifier_solde` seule, sous son verrou.
//
// LES REFUS SE DISENT AVANT LE CLIC : chaque bouton passe la décision qu'il écrirait au module (`refusDeJustifierSolde`,
// confronté au texte de la fonction et à l'essai de la base) ; refusé, il est grisé et le refus se lit, sous les mots de
// la base. La base reste juge : un refus qu'elle oppose quand même se dit à son tour (`messageErreur`).
//
// RIEN N'EST CITÉ NI RETENU SANS LE CABINET : les sources proposées se citent d'un clic chacune, la preuve de
// l'application ne part que cochée, la reprise de l'exercice précédent remplit le formulaire sans rien écrire.

export interface PropsFicheSolde {
  dossierId: string
  annee: number
  compte: CompteEnRevision
  // Une décision peut-elle se prendre (lecture entière d'un exercice qui se révise) ; sinon, pourquoi.
  peutDecider: boolean
  raisonSansDecision: string | null
  contexte: ContexteDeJustification
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier' | 'tiers' | 'date_piece' | 'montant_ttc' | 'storage_hash'>[]
  documents: readonly DocumentPourRevision[]
  // Toutes les preuves du dossier : l'historique relit celles de chaque décision.
  preuves: readonly RevisionPreuve[]
  // L'instant de la validation de l'exercice, ou rien.
  valideLe: string | null
  // L'identifiant du compte connecté : une décision qu'il a prise se dit « par toi ».
  utilisateur: string | null
  // Le nom de ce qu'une ligne de détail désigne (un relevé, un mouvement, un bien…), ou rien.
  nommer: (reference: { type: TypeDeReference; id: string }) => string | null
  occupe: boolean
  erreur: string | null
  onDecider: (decision: DecisionComposee) => void
  // Rapporte si une saisie attend : la garde du volet le consulte. Doit être une fonction STABLE.
  onModifiee: (modifiee: boolean) => void
  onFermer: () => void
}

const LIBELLE_CITATION: Record<EtatDeLaCitation, string> = {
  intacte: 'empreinte intacte',
  'sans-empreinte': 'sans empreinte : rien ne se vérifie',
  changee: 'empreinte changée depuis la citation',
  disparue: 'n’a plus d’empreinte',
  introuvable: 'introuvable dans ce qui a été lu',
}

const BOUTONS: { etat: EtatDecisionRevision; libelle: string; classe: string }[] = [
  { etat: 'justifie', libelle: 'Justifier', classe: 'btn btn-primary btn-sm' },
  { etat: 'accepte', libelle: 'Accepter sur motif', classe: 'btn btn-outline btn-sm' },
  { etat: 'anomalie', libelle: 'Signaler une anomalie', classe: 'btn btn-outline btn-sm' },
]

const euros = (centimes: number) => formatMoney(centimes / 100)
// « un solde de 1 500,00 € au débit », « un solde nul » : le solde au milieu d'une phrase.
const unSolde = (centimes: number) => (centimes === 0 ? 'un solde nul' : `un solde de ${soldeEnMots(centimes)}`)
const minuscules = (id: string) => id.toLowerCase()

export default function FicheSolde(p: PropsFicheSolde) {
  const { compte: c } = p
  const [sources, setSources] = useState<SourceCitee[]>([])
  const [motif, setMotif] = useState('')
  const [portee, setPortee] = useState<PorteeDecisionRevision>('exercice')
  const [citerPreuve, setCiterPreuve] = useState(false)
  const [repriseDe, setRepriseDe] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')

  const modifiee = sources.length > 0 || motif !== '' || portee !== 'exercice' || citerPreuve || repriseDe !== null
  const { onModifiee } = p
  useEffect(() => { onModifiee(modifiee) }, [modifiee, onModifiee])

  const piecesParId = useMemo(() => new Map(p.pieces.map((x) => [minuscules(x.id), x])), [p.pieces])
  const documentsParId = useMemo(() => new Map(p.documents.map((x) => [minuscules(x.id), x])), [p.documents])
  const nomDeLaSource = (s: { pieceId: string | null; documentId: string | null }) => (s.pieceId !== null
    ? piecesParId.get(minuscules(s.pieceId))?.nom_fichier ?? 'pièce introuvable'
    : documentsParId.get(minuscules(s.documentId ?? ''))?.nom_fichier ?? 'document introuvable')
  const dejaCitee = (s: { pieceId: string | null; documentId: string | null }) => sources.some((x) =>
    (s.pieceId !== null && x.pieceId === s.pieceId) || (s.documentId !== null && x.documentId === s.documentId))
  const citer = (s: { pieceId: string | null; documentId: string | null }) => {
    if (!dejaCitee(s)) setSources((avant) => [...avant, { pieceId: s.pieceId, documentId: s.documentId, precision: null }])
  }

  // L'instantané de la preuve, tel qu'il partirait : ce que l'écran montre au moment du clic.
  const instantane = useMemo(() => instantaneDeLaPreuve(c.preuve), [c.preuve])
  const composer = (etat: EtatDecisionRevision): DecisionComposee => ({
    compte: c.compte, soldeCentimes: c.soldeCentimes, etat, motif: motif === '' ? null : motif, portee, sources,
    preuveApplication: citerPreuve ? instantane : null, remplaceId: c.chaine.courante?.id ?? null, repriseDe,
  })
  const refus = BOUTONS.map((b) => ({
    ...b, refus: refusDeJustifierSolde(argumentsDeJustifierSolde(p.dossierId, p.annee, composer(b.etat)), p.contexte),
  }))
  // Un même refus pour plusieurs boutons se dit une fois, avec les boutons qu'il retient.
  const refusDits = [...new Set(refus.flatMap((r) => (r.refus ? [r.refus.message] : [])))].map((message) => ({
    message, boutons: refus.filter((r) => r.refus?.message === message).map((r) => `« ${r.libelle} »`),
  }))

  function reprendre() {
    if (!c.reprise) return
    const d = decisionDeLaReprise(c.reprise, c.soldeCentimes, null)
    setSources(d.sources.map((s) => ({ ...s })))
    setMotif(d.motif ?? '')
    setPortee(d.portee)
    setRepriseDe(d.repriseDe)
  }

  // Les pièces et documents du dossier qu'on peut encore citer, et ceux que la recherche trouve — montrés seulement quand
  // on cherche, les huit premiers : la recherche dit combien elle en trouve sur combien.
  const citables = [
    ...p.pieces.map((x) => ({
      cle: `p-${x.id}`, source: { pieceId: x.id, documentId: null }, nom: x.nom_fichier,
      texte: [x.nom_fichier, x.tiers ?? '', formatDate(x.date_piece), x.montant_ttc === null ? '' : formatMoney(x.montant_ttc)],
    })),
    ...p.documents.map((x) => ({ cle: `d-${x.id}`, source: { pieceId: null, documentId: x.id }, nom: x.nom_fichier, texte: [x.nom_fichier] })),
  ].filter((x) => !dejaCitee(x.source))
  const trouvees = recherche.trim() === '' ? [] : citables.filter((x) => correspondALaRecherche(x.texte, recherche))

  const historique = [...c.chaine.decisions].reverse()
  const etat = ETAT_DU_SOLDE[c.etat]

  return (
    <div className="fiche-mouvement">
      <EntetePanneau
        icone={<IconRevision width={18} height={18} />}
        titre={`Compte ${c.compte}`}
        sousTitre={`${c.libelle} — exercice ${p.annee}`}
        onFermer={p.onFermer}
      />
      <div className="fiche-mouvement-corps">
        <div className="fiche-mouvement-tuiles">
          <div className="fiche-mouvement-tuile">
            <span>{`Solde au 31/12/${p.annee}`}</span>
            <strong>{soldeEnMots(c.soldeCentimes)}</strong>
          </div>
          <div className="fiche-mouvement-tuile">
            <span>État</span>
            <strong><span className={`badge ${etat.classe}`}>{etat.mot}</span></strong>
          </div>
        </div>
        {c.causes.length > 0 && (
          <p className="fiche-mouvement-alerte">
            {`À revoir : ${c.causes.map((cause) => CAUSES_A_REVOIR[cause]).join(' ; ')}.`}
          </p>
        )}

        <section className="fiche-mouvement-section">
          <h3>Preuve proposée</h3>
          <div className="fiche-mouvement-etat">
            <strong>{c.preuve.titre}</strong>
            <span className={`badge ${PASTILLE_DU_VERDICT[c.preuve.verdict].classe}`}>{PASTILLE_DU_VERDICT[c.preuve.verdict].mot}</span>
          </div>
          <p className="fiche-mouvement-note">{c.preuve.resume}</p>
          <p className="fiche-mouvement-note"><strong>Elle établit : </strong>{c.preuve.etablit}</p>
          <p className="fiche-mouvement-note"><strong>Elle n’établit pas : </strong>{c.preuve.netablitPas}</p>
          {c.preuve.faits.length > 0 && (
            <ul className="fiche-mouvement-note" style={{ margin: 0, paddingLeft: 18 }}>
              {c.preuve.faits.map((f, n) => <li key={`${f.cle}-${n}`}>{f.texte}</li>)}
            </ul>
          )}
          {c.preuve.detail.length > 0 && (
            <details className="fiche-mouvement-note">
              <summary>{`Le détail (${c.preuve.detail.length} ligne${c.preuve.detail.length > 1 ? 's' : ''})`}</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {c.preuve.detail.map((l, n) => {
                  const nom = l.reference ? p.nommer(l.reference) : null
                  return (
                    <li key={`${l.reference?.id ?? 'ligne'}-${n}`}>
                      {l.libelle}
                      {l.montantCentimes !== null && ` — ${euros(l.montantCentimes)}`}
                      {nom && <span className="nom-fichier">{` — ${nom}`}</span>}
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
          {c.preuve.sourcesProposees.length > 0 && p.peutDecider && (
            <div className="fiche-mouvement-section">
              <p className="fiche-mouvement-note">À citer, si elles prouvent le solde — rien n’est cité sans toi :</p>
              {c.preuve.sourcesProposees.map((s) => (
                <div key={`${s.pieceId ?? ''}-${s.documentId ?? ''}`} className="fiche-mouvement-choix">
                  <span className="fiche-mouvement-note" style={{ flex: 1, minWidth: 0 }}>
                    <span className="nom-fichier">{nomDeLaSource(s)}</span>{` — ${s.raison}`}
                  </span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={dejaCitee(s) || p.occupe} onClick={() => citer(s)}>
                    {dejaCitee(s) ? 'Citée' : 'Citer'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {c.reprise && (
          <section className="fiche-mouvement-section">
            <h3>{`La justification de ${p.annee - 1}`}</h3>
            <p className="fiche-mouvement-note">
              {`Décidée de façon permanente en ${p.annee - 1} : ${LIBELLES_DES_DECISIONS[c.reprise.decision.etat]}, `
                + `pour ${unSolde(c.reprise.soldePrecedentCentimes)}, `
                + `${c.reprise.citations.length} source${c.reprise.citations.length > 1 ? 's' : ''} citée${c.reprise.citations.length > 1 ? 's' : ''}.`}
              {c.reprise.decision.motif && ` Motif : ${c.reprise.decision.motif}`}
            </p>
            {c.reprise.soldeChange && (
              <p className="fiche-mouvement-alerte">
                {`Le solde a changé : ${soldeEnMots(c.reprise.soldePrecedentCentimes)} au 31/12/${p.annee - 1}, `
                  + `${soldeEnMots(c.soldeCentimes)} au 31/12/${p.annee}. Dis dans le motif, ou dans la précision d’une source, `
                  + 'ce qui justifie le nouveau solde — la ligne du tableau, par exemple.'}
              </p>
            )}
            {c.reprise.empreintesQuiNeTiennentPlus > 0 && (
              <p className="fiche-mouvement-alerte">
                {`${c.reprise.empreintesQuiNeTiennentPlus} des sources citées ne porte${c.reprise.empreintesQuiNeTiennentPlus > 1 ? 'nt' : ''} `
                  + 'plus l’empreinte de leur citation : relis-les avant de les citer de nouveau.'}
              </p>
            )}
            {p.peutDecider && (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" disabled={p.occupe} onClick={reprendre}>
                  {`Reprendre la justification de ${p.annee - 1}`}
                </button>
              </div>
            )}
            {p.peutDecider && (
              <p className="fiche-mouvement-note">Elle remplit la décision ci-dessous, sans rien écrire : tu la relis, puis tu décides.</p>
            )}
          </section>
        )}

        <section className="fiche-mouvement-section">
          <h3>Historique du compte</h3>
          {historique.length === 0 ? (
            <p className="fiche-mouvement-note">{`Aucune décision sur ce compte pour ${p.annee}.`}</p>
          ) : (
            <>
              {!c.chaine.lisible && (
                <p className="fiche-mouvement-alerte">
                  La chaîne des décisions ne se lit pas : elles sont rangées dans l’ordre de leur création, et aucune n’est tenue
                  pour la décision courante.
                </p>
              )}
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
                {historique.map((d) => (
                  <DecisionDeLHistorique
                    key={d.id}
                    decision={d}
                    courante={c.chaine.courante?.id === d.id}
                    preuves={p.preuves}
                    pieces={piecesParId}
                    documents={documentsParId}
                    nomDeLaSource={nomDeLaSource}
                    valideLe={p.valideLe}
                    utilisateur={p.utilisateur}
                  />
                ))}
              </ol>
            </>
          )}
        </section>

        {p.peutDecider ? (
          <section className="fiche-mouvement-section">
            <h3>{c.chaine.courante ? 'Une nouvelle décision' : 'Décider'}</h3>
            <p className="fiche-mouvement-note">
              {'Une décision ne s’efface pas : elle se remplacera par une autre, et l’historique reste.'}
              {c.chaine.courante && ' Celle-ci remplacera la décision courante.'}
            </p>
            {repriseDe && (
              <p className="fiche-mouvement-note">
                {`Reprise de la justification de ${p.annee - 1} : ses sources et son motif sont repris ci-dessous ; elle reste permanente.`}
              </p>
            )}

            <div className="field">
              <label>Sources citées</label>
              {sources.length === 0 ? (
                <p className="fiche-mouvement-note">Aucune source citée pour l’instant.</p>
              ) : sources.map((s, n) => (
                <div key={`${s.pieceId ?? ''}-${s.documentId ?? ''}`} className="fiche-mouvement-regle">
                  <div className="fiche-mouvement-choix">
                    <span className="nom-fichier" style={{ flex: 1, minWidth: 0 }}>{nomDeLaSource(s)}</span>
                    <button
                      type="button" className="btn btn-outline btn-sm" disabled={p.occupe}
                      onClick={() => setSources((avant) => avant.filter((_, i) => i !== n))}
                    >
                      Retirer
                    </button>
                  </div>
                  <input
                    type="text"
                    aria-label={`Précision pour ${nomDeLaSource(s)}`}
                    placeholder="Précision (page, ligne du tableau…)"
                    maxLength={LONGUEUR_MAX_PRECISION}
                    value={s.precision ?? ''}
                    disabled={p.occupe}
                    onChange={(e) => {
                      const valeur = e.target.value
                      setSources((avant) => avant.map((x, i) => (i === n ? { ...x, precision: valeur === '' ? null : valeur } : x)))
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="field">
              <label>Citer une pièce ou un document du dossier</label>
              <BarreRecherche
                valeur={recherche}
                onChange={setRecherche}
                placeholder="Chercher un justificatif, un document…"
                affiches={trouvees.length}
                total={citables.length}
              />
              {trouvees.slice(0, 8).map((x) => (
                <div key={x.cle} className="fiche-mouvement-choix">
                  <span className="nom-fichier" style={{ flex: 1, minWidth: 0 }}>{x.nom}</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={p.occupe} onClick={() => citer(x.source)}>Citer</button>
                </div>
              ))}
            </div>

            {instantane && (
              <label className="fiche-mouvement-case">
                <input type="checkbox" checked={citerPreuve} disabled={p.occupe} onChange={(e) => setCiterPreuve(e.target.checked)} />
                <span>Citer la preuve de l’application : ce qu’elle montre aujourd’hui part avec la décision.</span>
              </label>
            )}

            <div className="field">
              <label>Portée</label>
              <label className="fiche-mouvement-case">
                <input type="radio" name="portee" checked={portee === 'exercice'} disabled={p.occupe} onChange={() => setPortee('exercice')} />
                <span>{`Pour l’exercice ${p.annee}`}</span>
              </label>
              <label className="fiche-mouvement-case">
                <input type="radio" name="portee" checked={portee === 'permanente'} disabled={p.occupe} onChange={() => setPortee('permanente')} />
                <span>{`Permanente — un bail, un contrat, un tableau d’emprunt : proposée en ${p.annee + 1}`}</span>
              </label>
            </div>

            <div className="field">
              <label htmlFor={`motif-${c.compte}`}>Motif</label>
              <textarea
                id={`motif-${c.compte}`}
                rows={3}
                maxLength={LONGUEUR_MAX_MOTIF}
                value={motif}
                disabled={p.occupe}
                onChange={(e) => setMotif(e.target.value)}
              />
              <p className="fiche-mouvement-note">
                Il se dit pour un solde accepté sans pièce et pour une anomalie. Aucune donnée de patient : un motif se lit
                dans le dossier de travail du cabinet.
              </p>
            </div>

            {refusDits.map((r) => (
              <p key={r.message} className="fiche-mouvement-note">
                <strong>{`${r.boutons.join(', ')} : `}</strong>{r.message}
              </p>
            ))}
            {p.erreur && <p className="error-text" style={{ margin: 0 }}>{p.erreur}</p>}
          </section>
        ) : (
          p.raisonSansDecision && <p className="fiche-mouvement-note">{p.raisonSansDecision}</p>
        )}
      </div>
      {p.peutDecider && (
        <div className="fiche-mouvement-pied">
          <div className="fiche-mouvement-boutons">
            {refus.map((b) => (
              <button
                key={b.etat}
                type="button"
                className={b.classe}
                disabled={p.occupe || b.refus !== null}
                title={b.refus?.message}
                onClick={() => p.onDecider(composer(b.etat))}
              >
                {b.libelle}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Une décision de l'historique : quoi, quand, par qui, pour quel solde, et ce qu'elle cite — chaque empreinte relue.
function DecisionDeLHistorique({ decision: d, courante, preuves, pieces, documents, nomDeLaSource, valideLe, utilisateur }: {
  decision: RevisionJustification
  courante: boolean
  preuves: readonly RevisionPreuve[]
  pieces: ReadonlyMap<string, Pick<Piece, 'storage_hash'>>
  documents: ReadonlyMap<string, Pick<DocumentPourRevision, 'storage_hash'>>
  nomDeLaSource: (s: { pieceId: string | null; documentId: string | null }) => string
  valideLe: string | null
  utilisateur: string | null
}) {
  const citations = preuves.filter((x) => minuscules(x.justification_id) === minuscules(d.id))
    .map((x) => verifierCitation(x, pieces, documents))
  const instantane = d.preuve_application === null ? null : lireInstantaneDePreuve(d.preuve_application)
  const pastille = PASTILLE_DE_LA_DECISION[d.etat]
  return (
    <li className="fiche-mouvement-note">
      <div className="fiche-mouvement-etat">
        <span className={`badge ${pastille.classe}`}>{pastille.mot}</span>
        {courante && <span className="badge badge-neutral">courante</span>}
        {d.portee === 'permanente' && <span className="badge badge-neutral">permanente</span>}
        {d.reprise_de !== null && <span className="badge badge-neutral">{`reprise de ${d.annee - 1}`}</span>}
        {apresLaValidation(d, valideLe) && <span className="badge badge-neutral">après la validation</span>}
      </div>
      <div>
        {`Le ${formatDate(d.cree_le)}, ${utilisateur !== null && d.auteur === utilisateur ? 'par toi' : `par un autre compte du cabinet (${d.auteur.slice(0, 8)})`}, `
          + `pour ${unSolde(Math.round(d.solde * 100))}.`}
      </div>
      {d.motif && <div>{`Motif : ${d.motif}`}</div>}
      {d.preuve_application !== null && (
        <div>
          {instantane
            ? `Preuve de l’application citée : ${instantane.titre} — ${instantane.resume}`
            : 'Preuve de l’application citée, sous une forme que cet écran ne sait pas relire.'}
        </div>
      )}
      {citations.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {citations.map((x) => (
            <li key={x.preuve.id}>
              <span className="nom-fichier">{nomDeLaSource({ pieceId: x.preuve.piece_id, documentId: x.preuve.document_id })}</span>
              {` — ${LIBELLE_CITATION[x.etat]}`}
              {x.preuve.precision && ` — ${x.preuve.precision}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
