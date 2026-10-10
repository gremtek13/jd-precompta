import { useEffect, useState } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconRevision } from '../../components/icons'
import { formatDate } from '../../lib/format'
import { DESCRIPTION_DES_CYCLES } from '../../lib/revisionCycles'
import {
  LIBELLE_DE_LA_NATURE, LONGUEUR_MAX_A_SUIVRE, LONGUEUR_MAX_CONCLUSION, LONGUEUR_MAX_NOTE_DE_TRAVAIL, LONGUEUR_MAX_OBSERVATION,
  LONGUEUR_MAX_TEXTE_DE_NOTE, LONGUEUR_MAX_TRAVAIL, NATURES_DE_NOTE, argumentsDeConclureCycle, argumentsDeNoterRevision,
  argumentsDeRevoirCycle, lireProgramme, programmeDeDepart, refusDeConclureCycle, refusDeNoterRevision, refusDeRevoirCycle,
  type ConclusionComposee, type ContexteDesCycles, type CycleRevu, type ExercicePourLesCycles, type TravailDuProgramme,
} from '../../lib/revisionRevue'
import { CAUSES_DU_CYCLE, ETAT_DU_CYCLE, PASTILLE_DE_LA_CONCLUSION, PASTILLE_DE_LA_REVUE } from '../../lib/revisionLibelles'
import type { AvisRevueRevision, EtatConclusionRevision, NatureNoteRevision, RevisionConclusion, RevisionRevue } from '../../lib/types'

// LE PANNEAU D'UN CYCLE DE LA RÉVISION (ligne 41, étape R4, phase C ; conception, § 4.4), dans le volet de droite : ce
// que l'application propose (le programme de travail du cycle), ce que le cabinet a fait (ses conclusions, son journal)
// et ce que le chef en a dit (la revue). La fiche ne lit ni n'écrit rien : l'onglet Révision lui donne ce qu'il a lu EN
// ENTIER et l'état DÉDUIT du cycle (`cyclesDeLExercice`), et écrit par `conclure_cycle`, `noter_revision` et
// `revoir_cycle` seules, sous son verrou.
//
// LES REFUS SE DISENT AVANT LE CLIC : chaque bouton passe ce qu'il enverrait au module (`refusDeConclureCycle`,
// `refusDeNoterRevision`, `refusDeRevoirCycle`, confrontés au texte des fonctions et rejoués sur l'essai de la base) ;
// refusé, il est grisé, et le refus se lit sous les mots de la base. La base reste juge : un refus qu'elle oppose quand
// même se dit à son tour.
//
// RIEN NE S'EFFACE : une conclusion se REMPLACE par une autre (la chaîne reste), le journal ne fait que s'allonger, une
// revue porte sur une conclusion et n'en revoit jamais une autre. Le formulaire d'une conclusion part de la conclusion
// courante — son programme tel qu'il a été exécuté, suivi des travaux proposés depuis —, ou du programme proposé.

export type GesteDuCycle = 'conclure' | 'noter' | 'revoir'

export interface PropsFicheCycle {
  dossierId: string
  annee: number
  cycle: CycleRevu
  // L'exercice, pour les cycles : seul un exercice terminé se conclut, se note et se revoit (hypothèse Q11).
  exercice: ExercicePourLesCycles
  contexte: ContexteDesCycles
  // L'identifiant du compte connecté : ce qu'il a écrit se dit « par toi ».
  utilisateur: string | null
  occupe: boolean
  erreur: { geste: GesteDuCycle; message: string } | null
  // Chacun rend vrai quand la base a écrit : la saisie repart alors de zéro ; refusée, elle reste pour se corriger.
  onConclure: (conclusion: ConclusionComposee) => Promise<boolean>
  onNoter: (nature: NatureNoteRevision, texte: string) => Promise<boolean>
  onRevoir: (conclusionId: string, avis: AvisRevueRevision, observation: string | null) => Promise<boolean>
  // Rapporte si une saisie attend : la garde du volet le consulte. Doit être une fonction STABLE.
  onModifiee: (modifiee: boolean) => void
  onFermer: () => void
}

const BOUTONS_DE_CONCLUSION: { etat: EtatConclusionRevision; libelle: string; classe: string }[] = [
  { etat: 'revise', libelle: 'Conclure : révisé', classe: 'btn btn-primary btn-sm' },
  { etat: 'anomalie', libelle: 'Conclure : anomalie', classe: 'btn btn-outline btn-sm' },
]
const BOUTONS_DE_REVUE: { avis: AvisRevueRevision; libelle: string; classe: string }[] = [
  { avis: 'approuve', libelle: 'Approuver', classe: 'btn btn-primary btn-sm' },
  { avis: 'a_reprendre', libelle: 'Renvoyer à reprendre', classe: 'btn btn-outline btn-sm' },
]

const minuscules = (id: string) => id.toLowerCase()
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`
// « 3 faits sur 5 travaux », « 1 fait sur 1 travail ».
function faitsSur(travaux: readonly Pick<TravailDuProgramme, 'fait'>[]): string {
  const faits = travaux.filter((t) => t.fait).length
  return `${faits} fait${faits > 1 ? 's' : ''} sur ${travaux.length} ${travaux.length > 1 ? 'travaux' : 'travail'}`
}

// Qui a écrit : « toi », ou l'identifiant court d'un autre compte du cabinet — aucune table ne donne son nom au
// navigateur (la même limite qu'en R3).
function parQui(auteur: string, utilisateur: string | null): string {
  return utilisateur !== null && minuscules(auteur) === minuscules(utilisateur) ? 'par toi' : `par un autre compte du cabinet (${auteur.slice(0, 8)})`
}

// Un refus dit une fois, avec les boutons qu'il retient.
function refusRegroupes<T extends { libelle: string; refus: { message: string } | null }>(boutons: T[]) {
  return [...new Set(boutons.flatMap((b) => (b.refus ? [b.refus.message] : [])))].map((message) => ({
    message, boutons: boutons.filter((b) => b.refus?.message === message).map((b) => `« ${b.libelle} »`),
  }))
}

export default function FicheCycle(p: PropsFicheCycle) {
  const { cycle: c } = p
  const courante = c.chaine.courante
  const description = DESCRIPTION_DES_CYCLES[c.cycle]

  // LA CONCLUSION EN COURS DE SAISIE. Un programme qu'on n'a pas touché (nul) reflète celui de la conclusion courante, tel
  // qu'il a été exécuté (`programmeDeDepart`) : une conclusion écrite, la saisie repart d'elle. Le texte et les points à
  // suivre, eux, partent VIDES : la courante se lit juste au-dessus, et un formulaire prérempli ferait d'un clic distrait
  // une conclusion de plus, identique, qui périmerait la revue. La conclusion que la saisie remplacera est RETENUE au premier changement (`depart`) : si une autre a été prise depuis,
  // le module le dit avant le clic (refus 10), au lieu que la saisie remplace sans le voir une conclusion jamais lue.
  const [travaux, setTravaux] = useState<TravailDuProgramme[] | null>(null)
  const [texte, setTexte] = useState<string | null>(null)
  const [aSuivre, setASuivre] = useState<string | null>(null)
  const [depart, setDepart] = useState<{ id: string | null } | null>(null)
  const [nouveauTravail, setNouveauTravail] = useState('')
  // La note du journal.
  const [nature, setNature] = useState<NatureNoteRevision | ''>('')
  const [noteDuJournal, setNoteDuJournal] = useState('')
  // La revue : l'observation, et la conclusion qu'elle vise, retenue de même au premier mot.
  const [observation, setObservation] = useState('')
  const [revueSur, setRevueSur] = useState<string | null>(null)

  const modifiee = travaux !== null || texte !== null || aSuivre !== null || nouveauTravail !== '' || nature !== ''
    || noteDuJournal !== '' || observation !== ''
  const { onModifiee } = p
  useEffect(() => { onModifiee(modifiee) }, [modifiee, onModifiee])

  const depuis = programmeDeDepart(c.cycle, courante)
  const programme = travaux ?? depuis.travaux
  const retenir = () => { if (depart === null) setDepart({ id: courante?.id ?? null }) }
  const changerTravaux = (suite: (avant: TravailDuProgramme[]) => TravailDuProgramme[]) => {
    retenir()
    setTravaux(suite(programme))
  }
  const texteDeLaConclusion = texte ?? ''
  const aSuivreDeLaConclusion = aSuivre ?? ''
  const composer = (etat: EtatConclusionRevision): ConclusionComposee => ({
    cycle: c.cycle, etat, travaux: programme, conclusion: texteDeLaConclusion,
    aSuivre: aSuivreDeLaConclusion === '' ? null : aSuivreDeLaConclusion,
    remplaceId: depart === null ? courante?.id ?? null : depart.id,
  })
  const conclusions = BOUTONS_DE_CONCLUSION.map((b) => ({
    ...b, refus: refusDeConclureCycle(argumentsDeConclureCycle(p.dossierId, p.annee, composer(b.etat)), p.contexte),
  }))
  const refusDeNote = refusDeNoterRevision(
    { ...argumentsDeNoterRevision(p.dossierId, p.annee, c.cycle, 'travail', noteDuJournal), p_nature: nature === '' ? null : nature },
    p.contexte,
  )
  const viseeParLaRevue = revueSur ?? courante?.id ?? null
  const revues = BOUTONS_DE_REVUE.map((b) => ({
    ...b,
    refus: refusDeRevoirCycle(
      { ...argumentsDeRevoirCycle(p.dossierId, p.annee, viseeParLaRevue ?? '', b.avis, observation === '' ? null : observation), p_conclusion_id: viseeParLaRevue },
      p.contexte,
    ),
  }))
  // L'exercice ne se révise pas (en cours, hors des bornes) : la phrase de la base, telle que le module la rend pour ce
  // que la fiche enverrait — les refus 2 et 3 précèdent tout ce que la saisie pourrait changer.
  const raisonSansGeste = p.exercice === 'ouvert' ? null : conclusions[0].refus?.message ?? null
  // Seul le chef du cabinet revoit (hypothèse Q2) : à un autre, la fiche dit pourquoi au lieu d'offrir des boutons.
  const revueReservee = revues[0].refus?.cle === 'chef' ? revues[0].refus.message : null
  // Les refus 7 à 9 (la conclusion visée n'est pas de l'exercice, n'est plus la courante, ou a déjà été revue) ne
  // dépendent pas de ce qu'on saisirait : la fiche les dit, sans offrir un champ qu'aucun mot ne rendrait recevable. Ils
  // suivent l'avis et l'observation dans l'ordre de la fonction : on les lit sur la revue la plus simple, une approbation
  // sans observation, que les refus 5 et 6 laissent toujours passer.
  const refusSansSaisie = refusDeRevoirCycle(
    { ...argumentsDeRevoirCycle(p.dossierId, p.annee, viseeParLaRevue ?? '', 'approuve', null), p_conclusion_id: viseeParLaRevue },
    p.contexte,
  )
  const revueSansObjet = refusSansSaisie !== null && refusSansSaisie.refus >= 7 ? refusSansSaisie.message : null

  function reinitialiserLaConclusion() {
    setTravaux(null)
    setTexte(null)
    setASuivre(null)
    setDepart(null)
    setNouveauTravail('')
  }

  async function conclure(etat: EtatConclusionRevision) {
    if (await p.onConclure(composer(etat))) reinitialiserLaConclusion()
  }

  async function noter() {
    if (nature === '') return
    if (await p.onNoter(nature, noteDuJournal)) {
      setNature('')
      setNoteDuJournal('')
    }
  }

  async function revoir(avis: AvisRevueRevision) {
    if (viseeParLaRevue === null) return
    if (await p.onRevoir(viseeParLaRevue, avis, observation === '' ? null : observation)) {
      setObservation('')
      setRevueSur(null)
    }
  }

  const historique = [...c.chaine.conclusions].reverse()
  const etat = ETAT_DU_CYCLE[c.etat]

  return (
    <div className="fiche-mouvement">
      <EntetePanneau
        icone={<IconRevision width={18} height={18} />}
        titre={`Cycle ${description.libelle}`}
        sousTitre={`Exercice ${p.annee}`}
        onFermer={p.onFermer}
      />
      <div className="fiche-mouvement-corps">
        <div className="fiche-mouvement-tuiles">
          <div className="fiche-mouvement-tuile">
            <span>État du cycle</span>
            <strong><span className={`badge ${etat.classe}`}>{etat.mot}</span></strong>
          </div>
          <div className="fiche-mouvement-tuile">
            <span>Journal</span>
            <strong>{pluriel(c.journal.length, 'note')}</strong>
          </div>
        </div>
        {c.causes.length > 0 && (
          <p className="fiche-mouvement-alerte">{`Ce qui le retient : ${c.causes.map((x) => CAUSES_DU_CYCLE[x]).join(' ; ')}.`}</p>
        )}
        {c.cycle === 'ensemble' && (
          <p className="fiche-mouvement-note">
            La synthèse de l’exercice : la note de synthèse et la conclusion d’ensemble. Le cycle ne se dit révisé que quand
            chacun des autres est révisé, en anomalie ou revu.
          </p>
        )}
        {c.pointsASuivre && (
          <section className="fiche-mouvement-section">
            <h3>{`Laissé à suivre par ${c.pointsASuivre.annee}`}</h3>
            <p className="fiche-mouvement-note" style={{ whiteSpace: 'pre-wrap' }}>{c.pointsASuivre.texte}</p>
          </section>
        )}
        {raisonSansGeste && <p className="fiche-mouvement-note">{raisonSansGeste}</p>}

        <section className="fiche-mouvement-section">
          <h3>Historique des conclusions</h3>
          {historique.length === 0 ? (
            <p className="fiche-mouvement-note">{`Le cycle n’a pas encore de conclusion pour ${p.annee}.`}</p>
          ) : (
            <>
              {!c.chaine.lisible && (
                <p className="fiche-mouvement-alerte">
                  La chaîne des conclusions ne se lit pas : elles sont rangées dans l’ordre de leur création, et aucune n’est
                  tenue pour la conclusion courante.
                </p>
              )}
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
                {historique.map((k) => (
                  <ConclusionDeLHistorique
                    key={k.id}
                    conclusion={k}
                    courante={courante?.id === k.id}
                    revues={c.revues.filter((r) => minuscules(r.conclusion_id) === minuscules(k.id))}
                    utilisateur={p.utilisateur}
                  />
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="fiche-mouvement-section">
          <h3>La revue du chef du cabinet</h3>
          {courante === null ? (
            <p className="fiche-mouvement-note">Une revue porte sur la conclusion courante : le cycle n’en a pas.</p>
          ) : c.revue ? (
            <div className="fiche-mouvement-note">
              <div className="fiche-mouvement-etat">
                <span className={`badge ${PASTILLE_DE_LA_REVUE[c.revue.revue.avis].classe}`}>{PASTILLE_DE_LA_REVUE[c.revue.revue.avis].mot}</span>
                {c.revue.perimee && <span className="badge badge-warning">périmée</span>}
              </div>
              <div>
                {`La conclusion courante a été revue le ${formatDate(c.revue.revue.revu_le)}, ${parQui(c.revue.revue.revu_par, p.utilisateur)}`}
                {c.revue.parLAuteur ? ', qui l’avait préparée — la supervision et la revue peuvent être le fait de la même personne.' : '.'}
              </div>
              {c.revue.revue.observation && <div style={{ whiteSpace: 'pre-wrap' }}>{`Observation : ${c.revue.revue.observation}`}</div>}
              {c.revue.perimee && <div>{`Depuis, ${CAUSES_DU_CYCLE['activite-posterieure']}${c.cycle === 'ensemble' ? ', dans l’un des cycles de l’exercice' : ''}.`}</div>}
            </div>
          ) : (
            <p className="fiche-mouvement-note">La conclusion courante n’a pas encore été revue.</p>
          )}
          {courante !== null && raisonSansGeste === null && (revueReservee || revueSansObjet ? (
            <p className="fiche-mouvement-note">{revueReservee ?? revueSansObjet}</p>
          ) : (
            <>
              <div className="field">
                <label htmlFor={`observation-${c.cycle}`}>Observation</label>
                <textarea
                  id={`observation-${c.cycle}`}
                  rows={2}
                  maxLength={LONGUEUR_MAX_OBSERVATION}
                  value={observation}
                  disabled={p.occupe}
                  onChange={(e) => {
                    if (revueSur === null) setRevueSur(courante.id)
                    setObservation(e.target.value)
                  }}
                />
                <p className="fiche-mouvement-note">Elle se dit pour un cycle renvoyé à reprendre, et peut accompagner une approbation.</p>
              </div>
              {refusRegroupes(revues).map((r) => (
                <p key={r.message} className="fiche-mouvement-note"><strong>{`${r.boutons.join(', ')} : `}</strong>{r.message}</p>
              ))}
              {p.erreur?.geste === 'revoir' && <p className="error-text" style={{ margin: 0 }}>{p.erreur.message}</p>}
              <div className="fiche-mouvement-boutons">
                {revues.map((b) => (
                  <button
                    key={b.avis} type="button" className={b.classe} disabled={p.occupe || b.refus !== null} title={b.refus?.message}
                    onClick={() => { void revoir(b.avis) }}
                  >
                    {b.libelle}
                  </button>
                ))}
              </div>
            </>
          ))}
        </section>

        <section className="fiche-mouvement-section">
          <h3>{`Journal du cycle (${c.journal.length})`}</h3>
          <p className="fiche-mouvement-note">
            Les échanges avec la direction, les consultations, le travail fait : une note ne se modifie ni ne s’efface, le
            journal ne fait que s’allonger.
          </p>
          {c.journal.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
              {c.journal.map((n) => (
                <li key={n.id} className="fiche-mouvement-note">
                  <div className="fiche-mouvement-etat"><span className="badge badge-neutral">{LIBELLE_DE_LA_NATURE[n.nature]}</span></div>
                  <div>{`Le ${formatDate(n.cree_le)}, ${parQui(n.auteur, p.utilisateur)}.`}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{n.texte}</div>
                </li>
              ))}
            </ol>
          )}
          {raisonSansGeste === null && (
            <>
              <div className="field">
                <label htmlFor={`nature-${c.cycle}`}>Nature de la note</label>
                <select
                  id={`nature-${c.cycle}`} value={nature} disabled={p.occupe}
                  onChange={(e) => setNature(e.target.value as NatureNoteRevision | '')}
                >
                  <option value="">Choisir…</option>
                  {NATURES_DE_NOTE.map((x) => <option key={x} value={x}>{LIBELLE_DE_LA_NATURE[x]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`journal-${c.cycle}`}>Note</label>
                <textarea
                  id={`journal-${c.cycle}`} rows={3} maxLength={LONGUEUR_MAX_TEXTE_DE_NOTE} value={noteDuJournal} disabled={p.occupe}
                  onChange={(e) => setNoteDuJournal(e.target.value)}
                />
                <p className="fiche-mouvement-note">Aucune donnée de patient : une note se lit dans le dossier de travail du cabinet.</p>
              </div>
              {refusDeNote && <p className="fiche-mouvement-note"><strong>« Ajouter au journal » : </strong>{refusDeNote.message}</p>}
              {p.erreur?.geste === 'noter' && <p className="error-text" style={{ margin: 0 }}>{p.erreur.message}</p>}
              <div className="fiche-mouvement-boutons">
                <button
                  type="button" className="btn btn-outline btn-sm" disabled={p.occupe || refusDeNote !== null} title={refusDeNote?.message}
                  onClick={() => { void noter() }}
                >
                  Ajouter au journal
                </button>
              </div>
            </>
          )}
        </section>

        {raisonSansGeste === null && (
          <section className="fiche-mouvement-section">
            <h3>{courante ? 'Une nouvelle conclusion' : 'Conclure le cycle'}</h3>
            <p className="fiche-mouvement-note">
              {'Une conclusion ne s’efface pas : elle se remplacera par une autre, et l’historique reste.'}
              {courante && ` Celle-ci remplacera la conclusion courante du ${formatDate(courante.cree_le)}.`}
            </p>
            <p className="fiche-mouvement-note">
              {depuis.repris
                ? 'Le programme reprend celui de la conclusion courante, tel qu’il a été exécuté, suivi des travaux proposés depuis.'
                : 'Le programme est celui que l’application propose : coche ce qui est fait, annote, retire, ajoute — rien ne se coche sans toi.'}
            </p>

            <div className="field">
              <label>Programme de travail</label>
              {programme.length === 0 && <p className="fiche-mouvement-note">Le programme ne compte plus de travail.</p>}
              {programme.map((t, n) => (
                <div key={`${t.code ?? 'ajout'}-${n}`} className="fiche-mouvement-regle">
                  <div className="fiche-mouvement-choix">
                    <label className="fiche-mouvement-case" style={{ flex: 1, minWidth: 0 }}>
                      <input
                        type="checkbox" checked={t.fait} disabled={p.occupe}
                        onChange={(e) => {
                          const fait = e.target.checked
                          changerTravaux((avant) => avant.map((x, i) => (i === n ? { ...x, fait } : x)))
                        }}
                      />
                      <span>{t.travail}</span>
                    </label>
                    <button
                      type="button" className="btn btn-outline btn-sm" disabled={p.occupe} aria-label={`Retirer du programme : ${t.travail}`}
                      onClick={() => changerTravaux((avant) => avant.filter((_, i) => i !== n))}
                    >
                      Retirer
                    </button>
                  </div>
                  <input
                    type="text"
                    aria-label={`Note du travail : ${t.travail}`}
                    placeholder="Note (ce qui a été vu, l’écart, la source)"
                    maxLength={LONGUEUR_MAX_NOTE_DE_TRAVAIL}
                    value={t.note ?? ''}
                    disabled={p.occupe}
                    onChange={(e) => {
                      const valeur = e.target.value
                      changerTravaux((avant) => avant.map((x, i) => (i === n ? { ...x, note: valeur === '' ? null : valeur } : x)))
                    }}
                  />
                </div>
              ))}
              <div className="fiche-mouvement-choix" style={{ marginTop: 6 }}>
                <input
                  type="text" aria-label="Travail à ajouter au programme" placeholder="Un travail de plus"
                  maxLength={LONGUEUR_MAX_TRAVAIL} value={nouveauTravail} disabled={p.occupe} style={{ flex: 1, minWidth: 0 }}
                  onChange={(e) => setNouveauTravail(e.target.value)}
                />
                <button
                  type="button" className="btn btn-outline btn-sm" disabled={p.occupe || nouveauTravail === ''}
                  onClick={() => {
                    changerTravaux((avant) => [...avant, { code: null, travail: nouveauTravail, fait: false, note: null }])
                    setNouveauTravail('')
                  }}
                >
                  Ajouter
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor={`conclusion-${c.cycle}`}>Conclusion</label>
              <textarea
                id={`conclusion-${c.cycle}`} rows={4} maxLength={LONGUEUR_MAX_CONCLUSION} value={texteDeLaConclusion} disabled={p.occupe}
                onChange={(e) => { retenir(); setTexte(e.target.value) }}
              />
              {c.cycle === 'ensemble' && (
                <p className="fiche-mouvement-note">
                  La note de synthèse, et, pour une présentation des comptes, la conclusion envisagée de l’attestation — la
                  mission n’est pas tranchée (question Q5 au cabinet).
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor={`a-suivre-${c.cycle}`}>{`Points à suivre en ${p.annee + 1}`}</label>
              <textarea
                id={`a-suivre-${c.cycle}`} rows={2} maxLength={LONGUEUR_MAX_A_SUIVRE} value={aSuivreDeLaConclusion} disabled={p.occupe}
                onChange={(e) => { retenir(); setASuivre(e.target.value) }}
              />
              <p className="fiche-mouvement-note">{`Ils s’afficheront en tête du même cycle en ${p.annee + 1}. Aucune donnée de patient.`}</p>
            </div>
            {(travaux !== null || texte !== null || aSuivre !== null) && (
              <div className="fiche-mouvement-boutons">
                <button type="button" className="btn btn-outline btn-sm" disabled={p.occupe} onClick={reinitialiserLaConclusion}>
                  {courante ? 'Repartir de la conclusion courante' : 'Repartir du programme proposé'}
                </button>
              </div>
            )}
            {refusRegroupes(conclusions).map((r) => (
              <p key={r.message} className="fiche-mouvement-note"><strong>{`${r.boutons.join(', ')} : `}</strong>{r.message}</p>
            ))}
            {p.erreur?.geste === 'conclure' && <p className="error-text" style={{ margin: 0 }}>{p.erreur.message}</p>}
          </section>
        )}
      </div>
      {raisonSansGeste === null && (
        <div className="fiche-mouvement-pied">
          <div className="fiche-mouvement-boutons">
            {conclusions.map((b) => (
              <button
                key={b.etat} type="button" className={b.classe} disabled={p.occupe || b.refus !== null} title={b.refus?.message}
                onClick={() => { void conclure(b.etat) }}
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

// Une conclusion de l'historique : quoi, quand, par qui, le programme tel qu'il a été exécuté, ce qu'elle laisse à
// suivre, et ses revues.
function ConclusionDeLHistorique({ conclusion: k, courante, revues, utilisateur }: {
  conclusion: RevisionConclusion
  courante: boolean
  revues: RevisionRevue[]
  utilisateur: string | null
}) {
  const programme = lireProgramme(k.travaux)
  const pastille = PASTILLE_DE_LA_CONCLUSION[k.etat]
  return (
    <li className="fiche-mouvement-note">
      <div className="fiche-mouvement-etat">
        <span className={`badge ${pastille.classe}`}>{pastille.mot}</span>
        {courante && <span className="badge badge-neutral">courante</span>}
      </div>
      <div>{`Le ${formatDate(k.cree_le)}, ${parQui(k.auteur, utilisateur)}.`}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{k.conclusion}</div>
      {k.a_suivre && <div style={{ whiteSpace: 'pre-wrap' }}>{`À suivre : ${k.a_suivre}`}</div>}
      {programme.lisible ? (
        <details>
          <summary>{`Le programme : ${faitsSur(programme.travaux)}`}</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {programme.travaux.map((t, n) => (
              <li key={`${t.code ?? 'ajout'}-${n}`}>
                {`${t.fait ? 'Fait' : 'Pas fait'} — ${t.travail}`}
                {t.note && ` — ${t.note}`}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <div>Le programme de cette conclusion ne se relit pas sous la forme que la base exige : il n’est pas montré.</div>
      )}
      {revues.map((r) => (
        <div key={r.id}>
          <span className={`badge ${PASTILLE_DE_LA_REVUE[r.avis].classe}`}>{PASTILLE_DE_LA_REVUE[r.avis].mot}</span>
          {` Revue le ${formatDate(r.revu_le)}, ${parQui(r.revu_par, utilisateur)}.`}
          {r.observation && ` Observation : ${r.observation}`}
        </div>
      ))}
    </li>
  )
}
