import { useRef, useState } from 'react'
import { LETTRES_DE_MISSION_PREVUES, etatDeLaLettre, motsDuRefus, REFUS_DU_BROUILLON, type Clause, type Mission } from '../../lib/lettresDeMission'
import {
  CLAUSES, LIBELLE_CLAUSE, LIBELLE_ETAT, LIBELLE_LIVRABLE, LIBELLE_MISSION, LIBELLE_PERIODICITE, MISSIONS,
  avisDuModele, confirmationDeLaNouvelleVersion, confirmationDeLaProposition, confirmationDeLaReponse, confirmationDuModele,
  confirmationDuRetrait, confirmationDuRetraitDuModele, contenuDuBrouillon, contenuDuPdf, libelleDesHonoraires, modeleCourant,
  nomDuPdf, parametresDuModele, refusDeLaNouvelleVersion, refusDeLaProposition, refusDeLaReponse, refusDuBrouillon, refusDuModele,
  refusDuRetrait, refusDuRetraitDuModele, saisieDeLaLettre,
  type LettreComplete, type Livrable, type ModeleLu, type Periodicite, type Reponse, type SaisieDeLaLettre, type SaisieDuModele,
} from '../../lib/lettresDeMissionVue'
import {
  enregistrerLaReponse, enregistrerLeBrouillon, enregistrerLeModele, proposerLaLettre, retirerLaLettre, retirerLeModele,
  useLettresDuCabinet, type IssueDUnGeste, type LectureDesLettres,
} from '../../lib/lettresDeMissionLecture'
import { pdfDeLaLettre } from '../../lib/pdfLettreDeMission'
import { aujourdHuiAParis, formatDate } from '../../lib/format'

// LES LETTRES DE MISSION, À L'ÉCRAN DU CABINET (ligne 47, lot LM5 ; HISTORIQUE.md, « LM4 » et « LM5 »), derrière
// `LETTRES_DE_MISSION_PREVUES` : baissé, la carte ne rend rien et ne lit rien. Elle vit dans l'onglet Informations du
// DOSSIER DU CABINET seul (LM-Q4 : les lettres y survivent au départ d'un client) : les modèles (enregistrer, remplacer,
// retirer) et les lettres (brouillon réécrit à la version lue, proposer, la réponse sur papier signé ou le refus, retirer,
// résilier, nouvelle version), et le PDF d'une lettre proposée tiré de ses seules valeurs figées. Chaque geste passe par sa
// fonction SQL seule, sous un verrou `useRef` relâché après la relecture ; ses refus se disent AVANT le clic aux mots du
// module (lib/lettresDeMissionVue.ts, dans l'ordre de la fonction) ; chaque confirmation nomme ce qui part ou se fige. Lue
// en partie ou refusée, la carte le dit et n'offre AUCUN geste. L'acceptation en ligne reste fermée (LM-Q10).

export default function LettresDeMissionCard({ dossierId, estLeDossierDuCabinet }: { dossierId: string; estLeDossierDuCabinet: boolean }) {
  if (!LETTRES_DE_MISSION_PREVUES || !estLeDossierDuCabinet) return null
  return <Carte dossierId={dossierId} />
}

type Edition =
  | { genre: 'modele'; remplace: ModeleLu | null; saisie: SaisieDuModele }
  | { genre: 'lettre'; existante: LettreComplete | null; remplace: LettreComplete | null; saisie: SaisieDeLaLettre }
  | { genre: 'reponse'; lettre: LettreComplete; reponse: Reponse; documentId: string; signeeLe: string }
  | { genre: 'retrait'; lettre: LettreComplete; finAu: string }

function Carte({ dossierId }: { dossierId: string }) {
  const [relecture, setRelecture] = useState(0)
  const lu = useLettresDuCabinet(dossierId, true, relecture)
  const [edition, setEdition] = useState<{ dossierId: string; e: Edition } | null>(null)
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  // Un seul verrou pour tous les gestes de la carte : deux écritures ne se croisent pas sur les mêmes lettres.
  const gesteEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const lecture = lu?.dossierId === dossierId ? lu : null
  const ed = edition?.dossierId === dossierId ? edition.e : null
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  // L'enveloppe de tous les gestes : le verrou posé avant le premier `await`, relâché après la relecture demandée.
  async function agir(geste: () => Promise<IssueDUnGeste>, reussite: string) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setEnCours(true)
    try {
      const issue = await geste()
      setAvis({ dossierId, erreur: issue.ok ? null : issue.message, fait: issue.ok ? reussite : null })
      if (issue.ok) setEdition(null)
    } finally {
      setRelecture((n) => n + 1)
      gesteEnCours.current = false
      setEnCours(false)
    }
  }

  if (lecture === null) return <section className="card"><h3>Lettres de mission</h3><p className="muted">Chargement…</p></section>
  if (lecture.etat === 'illisible') {
    return (
      <section className="card">
        <h3>Lettres de mission</h3>
        <p className="error-text" role="alert">Les lettres de mission n’ont pas pu être lues en entier ({lecture.motif}). Aucun geste n’est offert avant une lecture complète.</p>
      </section>
    )
  }
  const l = lecture
  const aujourdhui = aujourdHuiAParis()
  const nomDuClient = (id: string | null) => l.clients.find((c) => c.id === id)?.nom
    ?? (id === null ? 'sans client' : 'un dossier que ce compte ne lit pas')
  const ouvrir = (e: Edition) => { setAvis(null); setEdition({ dossierId, e }) }

  return (
    <section className="card">
      <h3>Lettres de mission</h3>
      {fait && <p className="success-text">{fait} ✓</p>}
      {erreur && <p className="error-text" role="alert">{erreur}</p>}

      <h4>Modèles</h4>
      {l.modeles.length === 0 ? <p className="muted">Aucun modèle.</p> : (
        <ul className="liste-simple">
          {l.modeles.map((m) => {
            const courant = modeleCourant(m, l.modeles)
            const refusRetrait = refusDuRetraitDuModele(m, l.modeles, true)
            return (
              <li key={m.id}>
                <strong>{m.titre}</strong>{' '}
                <span className="muted">— {m.retire_le ? `retiré le ${formatDate(m.retire_le)}` : courant ? 'version courante' : 'remplacé'}, du {formatDate(m.cree_le)}</span>
                {courant && m.retire_le === null && (
                  <span className="field-row">
                    <button className="btn btn-outline btn-sm" disabled={enCours} onClick={() => ouvrir({
                      genre: 'modele', remplace: m,
                      saisie: { titre: m.titre, conditionsGenerales: m.conditions_generales, missions: { ...m.missions }, clauses: { ...m.clauses } },
                    })}>Nouvelle version</button>
                    <button className="btn btn-outline btn-sm" disabled={enCours || refusRetrait !== null} title={refusRetrait ?? undefined}
                      onClick={() => { if (window.confirm(confirmationDuRetraitDuModele(m))) void agir(() => retirerLeModele(dossierId, m.id), 'Modèle retiré') }}>
                      Retirer
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button className="btn btn-outline btn-sm" disabled={enCours} onClick={() => ouvrir({
        genre: 'modele', remplace: null, saisie: { titre: '', conditionsGenerales: '', missions: {}, clauses: {} },
      })}>Nouveau modèle</button>
      {ed?.genre === 'modele' && (
        <FormulaireDuModele edition={ed} lecture={l} enCours={enCours} onChange={(saisie) => ouvrir({ ...ed, saisie })}
          onAnnuler={() => setEdition(null)}
          onEnregistrer={() => {
            if (!window.confirm(confirmationDuModele(ed.saisie, ed.remplace))) return
            const p = parametresDuModele(ed.saisie)
            void agir(() => enregistrerLeModele(dossierId, { ...p, remplaceId: ed.remplace?.id ?? null }), 'Modèle enregistré')
          }} />
      )}

      <h4>Lettres</h4>
      {l.lettres.length === 0 ? <p className="muted">Aucune lettre.</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Client</th><th>État</th><th>Effet</th><th>Gestes</th></tr></thead>
            <tbody>
              {l.lettres.map((lettre) => (
                <LigneDeLettre key={lettre.id} lettre={lettre} lecture={l} aujourdhui={aujourdhui} enCours={enCours}
                  nomDuClient={nomDuClient(lettre.dossier_client_id)} ouvrir={ouvrir}
                  proposer={() => void agir(() => proposerLaLettre(dossierId, lettre.id, lettre.modifiee_le), 'Lettre proposée : elle est figée')} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button className="btn btn-outline btn-sm" disabled={enCours || l.modeles.length === 0}
        title={l.modeles.length === 0 ? 'Enregistrer d’abord un modèle.' : undefined}
        onClick={() => ouvrir({ genre: 'lettre', existante: null, remplace: null, saisie: saisieDeLaLettre(null) })}>
        Nouvelle lettre
      </button>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        L’acceptation en ligne par le client n’est pas ouverte : la lettre proposée s’imprime, se signe sur papier, et le papier signé se dépose dans les Documents administratifs de ce dossier.
      </p>

      {ed?.genre === 'lettre' && (
        <FormulaireDeLettre edition={ed} lecture={l} enCours={enCours} onChange={(saisie) => ouvrir({ ...ed, saisie })}
          onAnnuler={() => setEdition(null)}
          onEnregistrer={() => {
            const c = contenuDuBrouillon(ed.saisie, ed.existante === null ? ed.remplace?.id ?? null : null)
            if (!c.ok) return
            void agir(() => enregistrerLeBrouillon(dossierId, ed.existante?.id ?? null, c.contenu, ed.existante?.modifiee_le ?? null),
              'Brouillon enregistré')
          }} />
      )}
      {ed?.genre === 'reponse' && (
        <FormulaireDeReponse edition={ed} lecture={l} aujourdhui={aujourdhui} enCours={enCours} nomDuClient={nomDuClient(ed.lettre.dossier_client_id)}
          onChange={(e) => ouvrir(e)} onAnnuler={() => setEdition(null)}
          onEnregistrer={(document) => void agir(() => enregistrerLaReponse(dossierId, ed.lettre.id, ed.reponse,
            ed.reponse === 'refusee' ? null : document, ed.reponse === 'refusee' ? null : ed.signeeLe), 'Réponse enregistrée')} />
      )}
      {ed?.genre === 'retrait' && (
        <FormulaireDeRetrait edition={ed} lecture={l} enCours={enCours} nomDuClient={nomDuClient(ed.lettre.dossier_client_id)}
          onChange={(e) => ouvrir(e)} onAnnuler={() => setEdition(null)}
          onEnregistrer={() => void agir(() => retirerLaLettre(dossierId, ed.lettre.id, ed.lettre.acceptee_le === null ? null : ed.finAu),
            ed.lettre.acceptee_le === null ? 'Lettre retirée' : 'Lettre résiliée')} />
      )}
    </section>
  )
}

type Lue = Extract<LectureDesLettres, { etat: 'lue' }>

function LigneDeLettre({ lettre, lecture, aujourdhui, enCours, nomDuClient, ouvrir, proposer }: {
  lettre: LettreComplete; lecture: Lue; aujourdhui: string; enCours: boolean; nomDuClient: string
  ouvrir: (e: Edition) => void
  /** La proposition, passée par l'enveloppe à verrou de la carte. */
  proposer: () => void
}) {
  const etat = etatDeLaLettre(lettre, aujourdhui)
  const ctx = { dossierDuCabinet: true, lettres: lecture.lettres }
  const refusProposition = refusDeLaProposition(lettre, { ...ctx, clients: lecture.clients, modeles: lecture.modeles, identiteDuCabinet: lecture.identiteDuCabinet })
  const refusVersion = refusDeLaNouvelleVersion(lettre, ctx)
  const refusRetrait = refusDuRetrait(lettre, { ...ctx, finAu: lettre.acceptee_le === null ? '' : (lettre.date_effet ?? '') })
  const modele = lecture.modeles.find((m) => m.id === lettre.modele_id) ?? null
  const pdf = contenuDuPdf(lettre, modele)
  const repondable = lettre.proposee_le !== null && lettre.acceptee_le === null && lettre.refusee_le === null && lettre.retiree_le === null
  const [pdfEnCours, setPdfEnCours] = useState(false)
  const impression = useRef(false)

  // Le PDF ne s'écrit nulle part : il se tire des valeurs figées et se télécharge. Sous son propre verrou (rien ne s'écrit).
  async function imprimer() {
    if (impression.current || pdf === null || lettre.empreinte === null || lettre.proposee_le === null) return
    impression.current = true
    setPdfEnCours(true)
    try {
      const octets = await pdfDeLaLettre(pdf, { empreinte: lettre.empreinte, instant: lettre.proposee_le })
      const url = URL.createObjectURL(new Blob([octets as BlobPart], { type: 'application/pdf' }))
      const lien = document.createElement('a')
      lien.href = url
      lien.download = nomDuPdf(lettre)
      lien.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally {
      impression.current = false
      setPdfEnCours(false)
    }
  }

  return (
    <tr>
      <td>{nomDuClient}</td>
      <td>{LIBELLE_ETAT[etat]}{lettre.remplace_id !== null ? ' (nouvelle version)' : ''}</td>
      <td>{lettre.date_effet ? formatDate(lettre.date_effet) : '—'}</td>
      <td>
        <div className="field-row" style={{ flexWrap: 'wrap' }}>
          {etat === 'brouillon' && (
            <>
              <button className="btn btn-outline btn-sm" disabled={enCours} onClick={() => ouvrir({
                genre: 'lettre', existante: lettre, remplace: null, saisie: saisieDeLaLettre(lettre),
              })}>Reprendre</button>
              <button className="btn btn-primary btn-sm" disabled={enCours || refusProposition !== null} title={refusProposition ?? undefined}
                onClick={() => {
                  if (modele === null || !window.confirm(confirmationDeLaProposition(lettre, { nomDuClient, modele }))) return
                  proposer()
                }}>Proposer</button>
            </>
          )}
          {pdf !== null && <button className="btn btn-outline btn-sm" disabled={pdfEnCours} onClick={() => void imprimer()}>PDF</button>}
          {repondable && (
            <button className="btn btn-outline btn-sm" disabled={enCours}
              onClick={() => ouvrir({ genre: 'reponse', lettre, reponse: 'acceptee_sur_papier', documentId: '', signeeLe: '' })}>
              Enregistrer la réponse
            </button>
          )}
          {lettre.proposee_le !== null && lettre.retiree_le === null && lettre.refusee_le === null && (
            <button className="btn btn-outline btn-sm" disabled={enCours || refusVersion !== null} title={refusVersion ?? undefined}
              onClick={() => {
                if (!window.confirm(confirmationDeLaNouvelleVersion(lettre, nomDuClient))) return
                ouvrir({ genre: 'lettre', existante: null, remplace: lettre, saisie: saisieDeLaLettre(lettre) })
              }}>Nouvelle version</button>
          )}
          {lettre.retiree_le === null && lettre.refusee_le === null && (
            <button className="btn btn-outline btn-sm" disabled={enCours || refusRetrait !== null} title={refusRetrait ?? undefined}
              onClick={() => ouvrir({ genre: 'retrait', lettre, finAu: '' })}>
              {lettre.acceptee_le === null ? 'Retirer' : 'Résilier'}
            </button>
          )}
        </div>
        {etat === 'brouillon' && refusProposition !== null && <p className="muted" style={{ fontSize: '0.8rem' }}>{refusProposition}</p>}
      </td>
    </tr>
  )
}

function FormulaireDuModele({ edition, lecture, enCours, onChange, onAnnuler, onEnregistrer }: {
  edition: Extract<Edition, { genre: 'modele' }>; lecture: Lue; enCours: boolean
  onChange: (s: SaisieDuModele) => void; onAnnuler: () => void; onEnregistrer: () => void
}) {
  const s = edition.saisie
  const refus = refusDuModele(s, { dossierDuCabinet: true, remplace: edition.remplace, modeles: lecture.modeles })
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onEnregistrer() }}>
      <h4>{edition.remplace ? `Nouvelle version de « ${edition.remplace.titre} »` : 'Nouveau modèle'}</h4>
      <label className="field">Titre<input value={s.titre} maxLength={200} onChange={(e) => onChange({ ...s, titre: e.target.value })} /></label>
      <label className="field">Conditions générales (le renvoi aux règles de l’Ordre et le numéro d’inscription du cabinet au tableau)
        <textarea rows={8} value={s.conditionsGenerales} onChange={(e) => onChange({ ...s, conditionsGenerales: e.target.value })} />
      </label>
      {MISSIONS.map((m: Mission) => (
        <label className="field" key={m}>{LIBELLE_MISSION[m]} — sa description (vide : le modèle ne la décrit pas)
          <textarea rows={2} value={s.missions[m] ?? ''} onChange={(e) => onChange({ ...s, missions: { ...s.missions, [m]: e.target.value } })} />
        </label>
      ))}
      {CLAUSES.map((c: Clause) => (
        <label className="field" key={c}>Clause : {LIBELLE_CLAUSE[c]}
          <textarea rows={3} value={s.clauses[c] ?? ''} onChange={(e) => onChange({ ...s, clauses: { ...s.clauses, [c]: e.target.value } })} />
        </label>
      ))}
      {avisDuModele(s).map((a) => <p className="muted" key={a}>{a}</p>)}
      {refus && <p className="error-text">{refus}</p>}
      <div className="field-row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={enCours || refus !== null}>Enregistrer le modèle</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onAnnuler}>Annuler</button>
      </div>
    </form>
  )
}

function FormulaireDeLettre({ edition, lecture, enCours, onChange, onAnnuler, onEnregistrer }: {
  edition: Extract<Edition, { genre: 'lettre' }>; lecture: Lue; enCours: boolean
  onChange: (s: SaisieDeLaLettre) => void; onAnnuler: () => void; onEnregistrer: () => void
}) {
  const s = edition.saisie
  const refus = refusDuBrouillon(s, {
    dossierDuCabinet: true, dossierDuCabinetId: lecture.dossierId, clients: lecture.clients, modeles: lecture.modeles,
    lettres: lecture.lettres, existante: edition.existante, remplace: edition.remplace,
  })
  // Les modèles qu'on peut choisir : les versions courantes non retirées, et celui que la lettre suit déjà (la proposition
  // dira s'il a été remplacé).
  const modeles = lecture.modeles.filter((m) => (modeleCourant(m, lecture.modeles) && m.retire_le === null) || m.id === s.modeleId)
  const clientFige = edition.remplace !== null || edition.existante?.remplace_id != null
  const temps = edition.existante?.honoraires.some((h) => h.forme === 'temps') ?? false
  const majHonoraire = (i: number, champ: Partial<SaisieDeLaLettre['honoraires'][number]>) =>
    onChange({ ...s, honoraires: s.honoraires.map((h, j) => (j === i ? { ...h, ...champ } : h)) })
  const majTache = (i: number, champ: Partial<SaisieDeLaLettre['repartition'][number]>) =>
    onChange({ ...s, repartition: s.repartition.map((t, j) => (j === i ? { ...t, ...champ } : t)) })
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onEnregistrer() }}>
      <h4>{edition.existante ? 'Brouillon de lettre' : edition.remplace ? 'Nouvelle version de la lettre' : 'Nouvelle lettre'}</h4>
      <label className="field">Client
        <select value={s.dossierClientId} disabled={clientFige} onChange={(e) => onChange({ ...s, dossierClientId: e.target.value })}>
          <option value="">—</option>
          {lecture.clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </label>
      {clientFige && <p className="muted" style={{ fontSize: '0.8rem' }}>{motsDuRefus(REFUS_DU_BROUILLON, 'memeClient')}</p>}
      <label className="field">Modèle
        <select value={s.modeleId} onChange={(e) => onChange({ ...s, modeleId: e.target.value })}>
          <option value="">—</option>
          {modeles.map((m) => <option key={m.id} value={m.id}>{m.titre}</option>)}
        </select>
      </label>
      <fieldset><legend>Missions</legend>
        {MISSIONS.map((m) => (
          <label key={m} className="case">
            <input type="checkbox" checked={s.missions.includes(m)}
              onChange={(e) => onChange({ ...s, missions: e.target.checked ? [...s.missions, m] : s.missions.filter((x) => x !== m) })} />
            {LIBELLE_MISSION[m]}
          </label>
        ))}
      </fieldset>
      <fieldset><legend>Répartition des tâches</legend>
        {s.repartition.map((t, i) => (
          <div className="field-row" key={i}>
            <input aria-label={`Tâche ${i + 1}`} value={t.tache} maxLength={500} onChange={(e) => majTache(i, { tache: e.target.value })} />
            <select aria-label={`Qui fait la tâche ${i + 1}`} value={t.par} onChange={(e) => majTache(i, { par: e.target.value as 'cabinet' | 'client' })}>
              <option value="cabinet">Le cabinet</option><option value="client">Le client</option>
            </select>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange({ ...s, repartition: s.repartition.filter((_, j) => j !== i) })}>Ôter</button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange({ ...s, repartition: [...s.repartition, { tache: '', par: 'cabinet' }] })}>Ajouter une tâche</button>
      </fieldset>
      <fieldset><legend>Honoraires (hors taxes)</legend>
        {temps && <p className="muted">Une ligne au temps passé de cette lettre n’est pas reprise ici : le temps passé ne se facture pas encore.</p>}
        {s.honoraires.map((h, i) => (
          <div className="field-row" key={i}>
            <select aria-label={`Forme de la ligne ${i + 1}`} value={h.forme} onChange={(e) => majHonoraire(i, { forme: e.target.value as 'forfait' | 'tache' })}>
              <option value="forfait">Forfait</option><option value="tache">À la tâche</option>
            </select>
            <input aria-label={`Libellé de la ligne ${i + 1}`} value={h.libelle} maxLength={300} onChange={(e) => majHonoraire(i, { libelle: e.target.value })} />
            <input aria-label={`Montant HT de la ligne ${i + 1}`} inputMode="decimal" value={h.montant} onChange={(e) => majHonoraire(i, { montant: e.target.value })} />
            {h.forme === 'forfait' ? (
              <select aria-label={`Périodicité de la ligne ${i + 1}`} value={h.periodicite} onChange={(e) => majHonoraire(i, { periodicite: e.target.value as Periodicite })}>
                {(Object.keys(LIBELLE_PERIODICITE) as Periodicite[]).map((p) => <option key={p} value={p}>{LIBELLE_PERIODICITE[p]}</option>)}
              </select>
            ) : (
              <select aria-label={`Tâche facturée de la ligne ${i + 1}`} value={h.livrable} onChange={(e) => majHonoraire(i, { livrable: e.target.value as Livrable })}>
                {(Object.keys(LIBELLE_LIVRABLE) as Livrable[]).map((p) => <option key={p} value={p}>{LIBELLE_LIVRABLE[p]}</option>)}
              </select>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange({ ...s, honoraires: s.honoraires.filter((_, j) => j !== i) })}>Ôter</button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange({
          ...s, honoraires: [...s.honoraires, { forme: 'forfait', libelle: '', montant: '', periodicite: 'mois', livrable: 'declaration_2035' }],
        })}>Ajouter une ligne</button>
      </fieldset>
      <div className="field-row">
        <label className="field">Date d’effet<input type="date" value={s.dateEffet} onChange={(e) => onChange({ ...s, dateEffet: e.target.value })} /></label>
        <label className="field">Premier exercice<input inputMode="numeric" value={s.premierExercice} onChange={(e) => onChange({ ...s, premierExercice: e.target.value })} /></label>
        <label className="field">Fin de la première période<input type="date" value={s.finInitiale} onChange={(e) => onChange({ ...s, finInitiale: e.target.value })} /></label>
        <label className="field">Préavis (mois)<input inputMode="numeric" value={s.preavisMois} onChange={(e) => onChange({ ...s, preavisMois: e.target.value })} /></label>
      </div>
      <label className="case"><input type="checkbox" checked={s.reconductionTacite} onChange={(e) => onChange({ ...s, reconductionTacite: e.target.checked })} /> Reconduction tacite</label>
      <div className="field-row">
        <label className="field">Signataire (nom)<input value={s.signataireNom} maxLength={200} onChange={(e) => onChange({ ...s, signataireNom: e.target.value })} /></label>
        <label className="field">Sa qualité<input value={s.signataireQualite} maxLength={200} onChange={(e) => onChange({ ...s, signataireQualite: e.target.value })} /></label>
      </div>
      {refus && <p className="error-text">{refus}</p>}
      <p className="muted" style={{ fontSize: '0.8rem' }}>Un brouillon se réécrit tant qu’il n’est pas proposé ; il peut rester incomplet, la proposition dira ce qui manque.</p>
      <div className="field-row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={enCours || refus !== null}>Enregistrer le brouillon</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onAnnuler}>Annuler</button>
      </div>
    </form>
  )
}

function FormulaireDeReponse({ edition, lecture, aujourdhui, enCours, nomDuClient, onChange, onAnnuler, onEnregistrer }: {
  edition: Extract<Edition, { genre: 'reponse' }>; lecture: Lue; aujourdhui: string; enCours: boolean; nomDuClient: string
  onChange: (e: Edition) => void; onAnnuler: () => void; onEnregistrer: (documentId: string | null) => void
}) {
  const document = lecture.documents.find((d) => d.id === edition.documentId) ?? null
  const refus = refusDeLaReponse(edition.lettre, {
    dossierDuCabinet: true, lettres: lecture.lettres, reponse: edition.reponse, document, documents: lecture.documents,
    signeeLe: edition.signeeLe, aujourdhui,
  })
  return (
    <form className="card" onSubmit={(e) => {
      e.preventDefault()
      if (refus !== null) return
      if (!window.confirm(confirmationDeLaReponse(edition.lettre, { nomDuClient, reponse: edition.reponse, document, signeeLe: edition.signeeLe }))) return
      onEnregistrer(document?.id ?? null)
    }}>
      <h4>La réponse de « {nomDuClient} »</h4>
      <label className="case"><input type="radio" checked={edition.reponse === 'acceptee_sur_papier'} onChange={() => onChange({ ...edition, reponse: 'acceptee_sur_papier' })} /> Acceptée, sur papier signé</label>
      <label className="case"><input type="radio" checked={edition.reponse === 'refusee'} onChange={() => onChange({ ...edition, reponse: 'refusee', documentId: '', signeeLe: '' })} /> Refusée</label>
      {edition.reponse === 'acceptee_sur_papier' && (
        <div className="field-row">
          <label className="field">Le papier signé (un document de ce dossier)
            <select value={edition.documentId} onChange={(e) => onChange({ ...edition, documentId: e.target.value })}>
              <option value="">—</option>
              {lecture.documents.map((d) => <option key={d.id} value={d.id}>{d.nom_fichier} ({formatDate(d.created_at)})</option>)}
            </select>
          </label>
          <label className="field">Signé le<input type="date" value={edition.signeeLe} max={aujourdhui} onChange={(e) => onChange({ ...edition, signeeLe: e.target.value })} /></label>
        </div>
      )}
      {refus && <p className="error-text">{refus}</p>}
      <div className="field-row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={enCours || refus !== null}>Enregistrer la réponse</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onAnnuler}>Annuler</button>
      </div>
    </form>
  )
}

function FormulaireDeRetrait({ edition, lecture, enCours, nomDuClient, onChange, onAnnuler, onEnregistrer }: {
  edition: Extract<Edition, { genre: 'retrait' }>; lecture: Lue; enCours: boolean; nomDuClient: string
  onChange: (e: Edition) => void; onAnnuler: () => void; onEnregistrer: () => void
}) {
  const acceptee = edition.lettre.acceptee_le !== null
  const refus = refusDuRetrait(edition.lettre, { dossierDuCabinet: true, lettres: lecture.lettres, finAu: edition.finAu })
  return (
    <form className="card" onSubmit={(e) => {
      e.preventDefault()
      if (refus !== null || !window.confirm(confirmationDuRetrait(edition.lettre, { nomDuClient, finAu: edition.finAu }))) return
      onEnregistrer()
    }}>
      <h4>{acceptee ? 'Résilier' : 'Retirer'} la lettre de « {nomDuClient} »</h4>
      {acceptee && (
        <label className="field">Elle prend fin le<input type="date" value={edition.finAu} min={edition.lettre.date_effet ?? undefined} onChange={(e) => onChange({ ...edition, finAu: e.target.value })} /></label>
      )}
      {acceptee && edition.lettre.honoraires.length > 0 && (
        <p className="muted" style={{ fontSize: '0.8rem' }}>Ses honoraires : {edition.lettre.honoraires.map(libelleDesHonoraires).join(' ; ')}.</p>
      )}
      {refus && <p className="error-text">{refus}</p>}
      <div className="field-row">
        <button type="submit" className="btn btn-danger btn-sm" disabled={enCours || refus !== null}>{acceptee ? 'Résilier' : 'Retirer'}</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onAnnuler}>Annuler</button>
      </div>
    </form>
  )
}
