import { useState } from 'react'
import BandeauLecturePartielle, { type AccordLecture } from '../../components/BandeauLecturePartielle'
import { formatDate, formatMoney } from '../../lib/format'
import { libelleCompteTenu, libelleDuPlanComptable } from '../../lib/comptes'
import {
  ETATS_DE_LA_LIGNE, LIBELLE_DE_L_ETAT_DE_LA_LIGNE, LIBELLE_DE_LA_SOURCE, LONGUEUR_MAX_MOTIF_DU_SEUIL, argumentsDeFixerSeuil,
  refusDeFixerSeuil, type CleDeLigne, type ContexteDuSeuil, type DepenseSansPiece, type LigneDeLaRevue, type RevueAnalytique,
} from '../../lib/revueAnalytique'
import {
  PASTILLE_DE_L_ETAT_DE_LA_LIGNE, centimesDeLaSaisie, identifiantDeLaLigne, memeCleDeLigne, moisEnMots, parQui, titreDeLaLigne,
  variationEnMots,
} from '../../lib/revueAnalytiqueEcran'

// LA SECTION « REVUE ANALYTIQUE » DE L'ONGLET RÉVISION (ligne 41, étape R5, phase C ; conception, § 1.4, 3.7 et 4.5). Le
// module (`lib/revueAnalytique.ts`) calcule et refuse ; la section MONTRE ce qu'il rend et ne réécrit aucune de ses règles :
// le seuil de signification FIXÉ par le cabinet (jamais proposé), le tableau de l'exercice face au précédent — chaque poste
// de la 2035, ses trois totaux, chaque compte des classes 1 à 7 —, la source du précédent, l'état de chaque ligne, les
// recettes mois par mois et les dépenses que seul le relevé justifie.
//
// L'application CALCULE la variation, le cabinet l'EXPLIQUE : aucun mot ici ne dit d'une variation qu'elle est normale. Une
// explication attendue est dite, pas imposée (la validation d'un exercice ne la réclame pas encore : étape R6, question Q1).
//
// SUR UNE LECTURE PARTIELLE OU REFUSÉE, la section dit pourquoi et ne montre ni tableau, ni état, ni geste : un état déduit
// d'une liste tronquée mentirait, et un seuil ou une explication est une écriture que la base ne défait pas. Le seuil
// s'écrit par `fixer_seuil_de_signification` SEULE (RevisionTab, sous son verrou) ; la section ne lit ni n'écrit rien.

export interface MotifDeLectureDeLaRevue { quoi: string; accord: AccordLecture; motif: string }

export interface PropsRevueAnalytique {
  dossierId: string
  annee: number
  revue: RevueAnalytique
  // Les lectures propres à la section qui n'ont pas pu être faites en entier : le module en tient un message, la section
  // les nomme.
  motifs: readonly MotifDeLectureDeLaRevue[]
  // Un dossier en engagement ne produit pas de 2035 : la section le dit, au lieu d'un tableau vide sans raison.
  enEngagement: boolean
  contexteDuSeuil: ContexteDuSeuil
  // L'identifiant du compte connecté : ce qu'il a écrit se dit « par toi ».
  utilisateur: string | null
  occupe: boolean
  erreur: string | null
  // La ligne dont le panneau est ouvert, pour la repérer dans le tableau.
  ligneOuverte: CleDeLigne | null
  // Le libellé d'un mouvement du relevé, pour dire de quelle dépense il s'agit.
  libelleDuMouvement: (ligneId: string) => string | null
  // Rend vrai quand la base a écrit : la saisie repart alors de zéro ; refusée, elle reste pour se corriger.
  onFixerSeuil: (centimes: number, motif: string, remplaceId: string | null) => Promise<boolean>
  onOuvrirLaLigne: (cle: CleDeLigne) => void
}

// Au-delà de cette longueur, la liste des dépenses sans pièce se replie : un état tronqué se DIT.
const DEPENSES_MONTREES = 30

export default function RevueAnalytiqueSection(p: PropsRevueAnalytique) {
  const { revue } = p
  const [montant, setMontant] = useState('')
  const [motif, setMotif] = useState('')
  // Le seuil que la saisie remplacera, RETENU au premier mot : si un autre a été fixé depuis, le module le dit avant le clic
  // (refus 7), au lieu que la saisie remplace sans le voir un seuil jamais lu.
  const [depart, setDepart] = useState<{ id: string | null } | null>(null)
  const [toutesLesDepenses, setToutesLesDepenses] = useState(false)

  const courant = revue.seuil.courant
  const remplaceId = depart === null ? courant?.id ?? null : depart.id
  const centimes = centimesDeLaSaisie(montant)
  const refusDuSeuil = refusDeFixerSeuil(argumentsDeFixerSeuil(p.dossierId, p.annee, centimes, motif, remplaceId), p.contexteDuSeuil)
  const retenir = () => { if (depart === null) setDepart({ id: courant?.id ?? null }) }
  // L'exercice ne se révise pas (en cours) : la phrase de la base, telle que le module la rend — les refus 2 et 3 précèdent
  // tout ce que la saisie pourrait changer.
  const raisonSansGeste = revue.exercice === 'ouvert' ? null : refusDuSeuil?.message ?? null

  async function fixer() {
    if (await p.onFixerSeuil(centimes, motif, remplaceId)) {
      setMontant('')
      setMotif('')
      setDepart(null)
    }
  }

  return (
    <section className="card" style={{ marginTop: 20 }} aria-label="Revue analytique">
      <h3 style={{ marginTop: 0 }}>{`Revue analytique de ${p.annee}`}</h3>
      <p className="muted">
        L’application calcule la variation de chaque ligne face à l’exercice précédent ; c’est à toi de l’expliquer. Elle ne dit
        d’aucune variation qu’elle est normale. Le seuil de signification est ton jugement : elle n’en propose aucun.
      </p>

      {p.motifs.map((m) => (
        <BandeauLecturePartielle
          key={m.quoi}
          quoi={m.quoi}
          accord={m.accord}
          motif={m.motif}
          consequence="La revue analytique ne dit rien d’une lecture incomplète — ni tableau, ni état, ni seuil —, et n’offre ni seuil ni explication. Recharge la page."
        />
      ))}
      {p.motifs.length === 0 && revue.lectureIncomplete !== null && (
        <p className="error-text">{`${revue.lectureIncomplete} La revue analytique n’affirme rien et n’offre aucun geste tant qu’elle ne se relit pas.`}</p>
      )}

      {revue.lectureIncomplete === null && revue.exercice !== null && (
        <>
          <Seuil
            revue={revue}
            utilisateur={p.utilisateur}
            raisonSansGeste={raisonSansGeste}
            montant={montant}
            motif={motif}
            occupe={p.occupe}
            refus={refusDuSeuil?.message ?? null}
            erreur={p.erreur}
            onMontant={(t) => { retenir(); setMontant(t) }}
            onMotif={(t) => { retenir(); setMotif(t) }}
            onFixer={() => { void fixer() }}
          />

          <h4 style={{ marginBottom: 4 }}>Avancement</h4>
          <p className="muted">{resumeDeLAvancement(revue)}</p>

          <h4 style={{ marginBottom: 4 }}>Les postes et les totaux de la 2035</h4>
          <TableDeLa2035 {...p} />

          <h4 style={{ marginBottom: 4 }}>Les comptes</h4>
          <TableDesComptes {...p} />

          <h4 style={{ marginBottom: 4 }}>Les recettes, mois par mois</h4>
          <RecettesParMois revue={revue} annee={p.annee} />

          <h4 style={{ marginBottom: 4 }}>Les dépenses sans pièce</h4>
          <DepensesSansPiece
            revue={revue}
            libelleDuMouvement={p.libelleDuMouvement}
            toutes={toutesLesDepenses}
            onToutes={() => setToutesLesDepenses(true)}
          />
        </>
      )}
    </section>
  )
}

// L'avancement en mots : « 14 lignes — à expliquer : 3 ; expliquée : 2 ; … ». L'état avant son nombre : il ne s'accorde pas.
function resumeDeLAvancement(revue: RevueAnalytique): string {
  const total = ETATS_DE_LA_LIGNE.reduce((s, e) => s + revue.avancement[e], 0)
  if (total === 0) return 'Aucune ligne à comparer pour cet exercice.'
  const parts = ETATS_DE_LA_LIGNE.filter((e) => revue.avancement[e] > 0)
    .map((e) => `${LIBELLE_DE_L_ETAT_DE_LA_LIGNE[e].toLowerCase()} : ${revue.avancement[e]}`)
  return `${total} ligne${total > 1 ? 's' : ''} — ${parts.join(' ; ')}.`
}

function Seuil({ revue, utilisateur, raisonSansGeste, montant, motif, occupe, refus, erreur, onMontant, onMotif, onFixer }: {
  revue: RevueAnalytique
  utilisateur: string | null
  raisonSansGeste: string | null
  montant: string
  motif: string
  occupe: boolean
  refus: string | null
  erreur: string | null
  onMontant: (texte: string) => void
  onMotif: (texte: string) => void
  onFixer: () => void
}) {
  const courant = revue.seuil.courant
  const historique = [...revue.seuil.elements].reverse()
  const libelle = courant ? 'Remplacer le seuil' : 'Fixer le seuil'
  return (
    <div style={{ marginBottom: 12 }}>
      <h4 style={{ marginBottom: 4 }}>Le seuil de signification</h4>
      {courant ? (
        <div className="check-ligne">
          <div className="check-ligne-corps">
            <div className="check-ligne-libelle">{formatMoney(Number(courant.seuil))}</div>
            <div className="check-ligne-detail" style={{ whiteSpace: 'pre-wrap' }}>{courant.motif}</div>
            <div className="check-ligne-detail">{`Fixé le ${formatDate(courant.cree_le)}, ${parQui(courant.auteur, utilisateur)}.`}</div>
          </div>
        </div>
      ) : (
        <p className="muted">
          {`Aucun seuil n’est fixé pour ${revue.annee} : aucune explication n’est attendue, et les lignes se disent « ${LIBELLE_DE_L_ETAT_DE_LA_LIGNE['sans-seuil'].toLowerCase()} ».`}
        </p>
      )}
      {historique.length > 1 && (
        <details>
          <summary>{`Historique du seuil (${historique.length})`}</summary>
          <ol style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
            {historique.map((s) => (
              <li key={s.id} className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                {`${formatMoney(Number(s.seuil))} — le ${formatDate(s.cree_le)}, ${parQui(s.auteur, utilisateur)}. ${s.motif}`}
              </li>
            ))}
          </ol>
        </details>
      )}
      {raisonSansGeste !== null ? (
        <p className="muted">{raisonSansGeste}</p>
      ) : (
        <>
          <p className="muted">
            {'Un seuil se motive, ne s’efface pas et se remplace par un autre : l’historique reste. Une variation est « au-delà » quand elle le dépasse strictement.'}
          </p>
          <div className="field">
            <label htmlFor="seuil-montant">Seuil de signification (€)</label>
            <input
              id="seuil-montant" type="text" inputMode="decimal" autoComplete="off" value={montant} disabled={occupe}
              onChange={(e) => onMontant(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="seuil-motif">Motif du seuil</label>
            <textarea
              id="seuil-motif" rows={3} maxLength={LONGUEUR_MAX_MOTIF_DU_SEUIL} value={motif} disabled={occupe}
              onChange={(e) => onMotif(e.target.value)}
            />
            <p className="muted" style={{ margin: 0 }}>Aucune donnée de patient : un motif se lit dans le dossier de travail du cabinet.</p>
          </div>
          {refus && <p className="muted"><strong>{`« ${libelle} » : `}</strong>{refus}</p>}
          {erreur && <p className="error-text">{erreur}</p>}
          <div className="fiche-mouvement-boutons">
            <button type="button" className="btn btn-primary btn-sm" disabled={occupe || refus !== null} title={refus ?? undefined} onClick={onFixer}>
              {libelle}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function TableDeLa2035(p: PropsRevueAnalytique) {
  const { la2035 } = p.revue
  return (
    <>
      <p className="muted">
        {la2035.sourceDeLExercice === 'validee'
          ? `Les montants de ${p.annee} sont ceux de la 2035 validée.`
          : la2035.sourceDeLExercice === 'calculee'
            ? `Les montants de ${p.annee} sont ceux de la 2035 calculée aujourd’hui, telle que Clôture la montre : elle n’est pas validée, et une explication la suit — elle passe « à revoir » si un montant change.`
            : ''}
        {' '}Le précédent est la 2035 validée de {p.annee - 1}, à défaut un repère annuel de l’onglet Estimation (les postes de dépenses, le total
        des recettes et le résultat seulement), à défaut rien : l’application ne recalcule jamais un exercice précédent.
      </p>
      {la2035.illisible !== null ? (
        <p className="error-text">{`La 2035 validée de ${la2035.illisible} ne se relit pas : rien de la 2035 ne se compare.`}</p>
      ) : la2035.sourceDeLExercice === 'aucune' ? (
        <p className="muted">
          {p.enEngagement
            ? 'Ce dossier est tenu en comptabilité d’engagement : la 2035 n’est pas produite, et aucun de ses postes ne se compare.'
            : 'Aucune 2035 ne se compare pour cet exercice.'}
        </p>
      ) : (
        <TableDesLignes lignes={la2035.lignes} exercice={p.annee} precedent={p.annee - 1} ligneOuverte={p.ligneOuverte} onOuvrirLaLigne={p.onOuvrirLaLigne} />
      )}
    </>
  )
}

function TableDesComptes(p: PropsRevueAnalytique) {
  const { comptes } = p.revue
  return (
    <>
      <p className="muted">
        {comptes.source === 'validee'
          ? `Le solde de chaque compte des classes 1 à 7 au 31/12/${p.annee}, face à celui de l’exercice ${p.annee - 1} validé ; débit positif.`
          : `L’exercice ${p.annee - 1} n’est pas validé : les comptes n’ont aucune comparaison, et leurs soldes ne se recalculent pas d’un exercice ouvert.`}
      </p>
      {comptes.lignes.length === 0 ? (
        <p className="muted">Aucun compte des classes 1 à 7 ne porte de solde.</p>
      ) : (
        <TableDesLignes lignes={comptes.lignes} exercice={p.annee} precedent={p.annee - 1} ligneOuverte={p.ligneOuverte} onOuvrirLaLigne={p.onOuvrirLaLigne} />
      )}
      {comptes.horsDeLaRevue.length > 0 && (
        <p className="muted">{`Hors de la revue (ni classe 1 à 7, ni au moins trois chiffres) : ${comptes.horsDeLaRevue.join(', ')}.`}</p>
      )}
    </>
  )
}

function TableDesLignes({ lignes, exercice, precedent, ligneOuverte, onOuvrirLaLigne }: {
  lignes: readonly LigneDeLaRevue[]
  exercice: number
  precedent: number
  ligneOuverte: CleDeLigne | null
  onOuvrirLaLigne: (cle: CleDeLigne) => void
}) {
  return (
    <div className="table-scroll tableau-adaptable">
      <table className="table-empilable">
        <thead>
          <tr>
            <th>Ligne</th><th>{`Exercice ${exercice}`}</th><th>{`Exercice ${precedent}`}</th><th>Variation</th><th>Source du précédent</th><th>État</th><th></th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => {
            const variation = variationEnMots(l)
            const pastille = PASTILLE_DE_L_ETAT_DE_LA_LIGNE[l.etat]
            const verbe = l.etat === 'a-expliquer' ? 'Expliquer' : l.etat === 'a-revoir' ? 'Revoir' : 'Ouvrir'
            const ouverte = ligneOuverte !== null && memeCleDeLigne(ligneOuverte, l.cle)
            const nom = l.cle.objet_type === 'compte' ? libelleCompteTenu(l.cle.objet) ?? libelleDuPlanComptable(l.cle.objet) : null
            return (
              <tr key={identifiantDeLaLigne(l.cle)} aria-current={ouverte ? 'true' : undefined}>
                <td data-libelle="Ligne">
                  <div>
                    <strong>{l.cle.objet_type === 'compte' ? l.libelle : titreDeLaLigne(l.cle)}</strong>
                    {nom !== null && <div className="muted">{nom}</div>}
                  </div>
                </td>
                <td data-libelle={`Exercice ${exercice}`}>{formatMoney(l.montantCentimes / 100)}</td>
                <td data-libelle={`Exercice ${precedent}`}>{l.precedentCentimes === null ? '—' : formatMoney(l.precedentCentimes / 100)}</td>
                <td data-libelle="Variation">
                  <div>
                    <div>{variation.euros}</div>
                    <div className="muted">{variation.pourcentage}</div>
                  </div>
                </td>
                <td data-libelle="Source du précédent">{LIBELLE_DE_LA_SOURCE[l.source]}</td>
                <td data-libelle="État">
                  <div>
                    <span className={`badge ${pastille.classe}`}>{pastille.mot}</span>
                    {l.explications.elements.length > 0 && (
                      <div className="muted">{`${l.explications.elements.length} explication${l.explications.elements.length > 1 ? 's' : ''}`}</div>
                    )}
                  </div>
                </td>
                <td className="td-actions">
                  <button
                    type="button" className="btn btn-outline btn-sm" aria-label={`${verbe} la ligne ${titreDeLaLigne(l.cle)}`}
                    onClick={() => onOuvrirLaLigne(l.cle)}
                  >
                    {verbe}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RecettesParMois({ revue, annee }: { revue: RevueAnalytique; annee: number }) {
  const { mois, source } = revue.recettesParMois
  return (
    <>
      <p className="muted">
        {source === 'validee'
          ? `Les écritures des comptes de recettes (crédit moins débit), mois par mois, face au même mois de l’exercice ${annee - 1} validé.`
          : `Les écritures des comptes de recettes (crédit moins débit), mois par mois. L’exercice ${annee - 1} n’est pas validé : aucun mois n’a de comparaison.`}
      </p>
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable">
          <thead>
            <tr><th>Mois</th><th>Recettes</th><th>{`Même mois de ${annee - 1}`}</th><th>Variation</th><th>Écritures</th></tr>
          </thead>
          <tbody>
            {mois.map((m) => (
              <tr key={m.mois}>
                <td data-libelle="Mois"><span style={{ whiteSpace: 'nowrap' }}>{moisEnMots(m.mois)}</span></td>
                <td data-libelle="Recettes">{formatMoney(m.centimes / 100)}</td>
                <td data-libelle={`Même mois de ${annee - 1}`}>{m.precedentCentimes === null ? '—' : formatMoney(m.precedentCentimes / 100)}</td>
                <td data-libelle="Variation">{variationEnMots({ variationCentimes: m.variationCentimes, variationDixiemesDePourcent: null }).euros}</td>
                <td data-libelle="Écritures">{m.ecritures === 0 ? 'aucune écriture' : m.ecritures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function DepensesSansPiece({ revue, libelleDuMouvement, toutes, onToutes }: {
  revue: RevueAnalytique
  libelleDuMouvement: (ligneId: string) => string | null
  toutes: boolean
  onToutes: () => void
}) {
  const sansSeuil = revue.seuil.centimes === null
  // Avec un seuil, seules celles qui le dépassent se montrent (strictement) ; sans seuil, toutes — la revue ne choisit pas.
  const concernees: DepenseSansPiece[] = revue.depensesSansPiece.filter((d) => sansSeuil || d.auDelaDuSeuil === true)
  const sousLeSeuil = revue.depensesSansPiece.length - concernees.length
  const montrees = toutes ? concernees : concernees.slice(0, DEPENSES_MONTREES)
  return (
    <>
      <p className="muted">
        {'Les mouvements du relevé affectés ou ventilés sur une charge, sans pièce : le relevé en est la seule preuve. '}
        {sansSeuil ? 'Aucun seuil n’est fixé : elles sont toutes montrées.' : 'Seules celles qui dépassent le seuil sont montrées.'}
      </p>
      {concernees.length === 0 ? (
        <p className="muted">{sansSeuil ? 'Aucune dépense sans pièce sur cet exercice.' : 'Aucune dépense sans pièce ne dépasse le seuil.'}</p>
      ) : (
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable">
            <thead>
              <tr><th>Date</th><th>Mouvement</th><th>Part des dépenses</th><th>Postes</th></tr>
            </thead>
            <tbody>
              {montrees.map((d) => (
                <tr key={d.ligneId}>
                  <td data-libelle="Date"><span style={{ whiteSpace: 'nowrap' }}>{formatDate(d.date)}</span></td>
                  <td data-libelle="Mouvement">
                    <div>
                      <div>{libelleDuMouvement(d.ligneId) ?? 'Mouvement du relevé'}</div>
                      <div className="muted">{`${formatMoney(d.montantReleveCentimes / 100)} au relevé`}</div>
                    </div>
                  </td>
                  <td data-libelle="Part des dépenses">{formatMoney(d.totalCentimes / 100)}</td>
                  <td data-libelle="Postes">
                    {d.parts.map((x) => x.poste ?? 'sans poste').join(' ; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!toutes && concernees.length > montrees.length && (
        <div className="fiche-mouvement-boutons">
          <button type="button" className="btn btn-outline btn-sm" onClick={onToutes}>
            {`Montrer les ${concernees.length - montrees.length} autres`}
          </button>
        </div>
      )}
      {!sansSeuil && sousLeSeuil > 0 && (
        <p className="muted">{`${sousLeSeuil} autre${sousLeSeuil > 1 ? 's' : ''} sous le seuil, non montrée${sousLeSeuil > 1 ? 's' : ''}.`}</p>
      )}
    </>
  )
}
