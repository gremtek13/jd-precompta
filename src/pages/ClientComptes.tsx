import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../lib/format'
import {
  contenuLu, montantDit, postesFaceAFace, situationsEnCoursTriees, STATUT_DIT, type ChiffresDeLaSituation,
} from '../lib/situationsPubliees'
import { lireLesSituationsDuClient, type LectureDuClient } from '../lib/situationsPublieesLecture'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'

// « MES COMPTES » (espace client, ligne 51.5, étape C4b ; MEG3-Q2, « la publication »). L'écran du client qui porte la case
// « Comptes » sur la société AFFICHÉE : la situation que son cabinet lui a publiée — sa date d'arrêté, « provisoire » ou
// « validée », ses recettes, ses dépenses par poste de la 2035, son résultat, sa TVA due, face à la même période de
// l'exercice précédent quand le cabinet l'a publiée avec. AUCUN GESTE : publier, remplacer et retirer sont au cabinet seul.
//
// LA CASE SE LIT DEUX FOIS (lib/situationsPublieesLecture.ts) : à la connexion pour la route, puis à la BASE avec les
// situations. RIEN N'EST AFFIRMÉ SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE : « Chargement… » avant le retour ; une liste
// lue en partie ne montre aucune situation (une plus récente pourrait manquer) ; « aucune situation » ne se dit que d'une
// liste lue en entier. Un contenu qui ne se lit pas à sa forme se dit illisible, jamais un chiffre deviné.

function Totaux({ titre, c }: { titre: string; c: ChiffresDeLaSituation }) {
  return (
    <div className="card" style={{ flex: '1 1 220px' }}>
      <strong style={{ display: 'block', marginBottom: 6 }}>{titre}</strong>
      <dl style={{ margin: 0 }}>
        <dt className="muted">Recettes</dt><dd style={{ margin: '0 0 4px' }}>{montantDit(c.recettes)}</dd>
        <dt className="muted">Dépenses</dt><dd style={{ margin: '0 0 4px' }}>{montantDit(c.depenses)}</dd>
        <dt className="muted">Résultat</dt><dd style={{ margin: '0 0 4px' }}><strong>{montantDit(c.resultat)}</strong></dd>
        {c.tva.assujetti && (c.tva.nette >= 0
          ? <><dt className="muted">TVA due</dt><dd style={{ margin: 0 }}>{montantDit(c.tva.nette)}</dd></>
          : <><dt className="muted">Crédit de TVA</dt><dd style={{ margin: 0 }}>{montantDit(-c.tva.nette)}</dd></>)}
      </dl>
    </div>
  )
}

export default function ClientComptes() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [lecture, setLecture] = useState<LectureDuClient | null>(null)
  // La situation choisie parmi celles en cours (une lecture, pas un geste) ; nulle, la plus récente.
  const [choisie, setChoisie] = useState<string | null>(null)

  useEffect(() => {
    if (!dossierId) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après coup ne s'écrit pas.
    let annule = false
    lireLesSituationsDuClient(dossierId).then((l) => { if (!annule) setLecture(l) })
    return () => { annule = true }
  }, [dossierId])

  // La lecture n'est montrée que pour la société qu'elle a lue.
  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const enCours = lue?.etat === 'lue' && lue.situations.complete ? situationsEnCoursTriees(lue.situations.lignes) : null
  const situation = enCours === null ? null : enCours.find((s) => s.id === choisie) ?? enCours[0] ?? null
  const contenu = situation === null ? null : contenuLu(situation.contenu)
  const annee = situation === null ? null : Number(situation.arretee_au.slice(0, 4))

  return (
    <>
      <div className="topbar"><h1>Mes comptes</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>
        Les chiffres de ton activité tels que ton cabinet les a arrêtés à une date et te les a publiés : ils ne bougent pas
        d’un jour à l’autre. « Provisoire » : l’exercice n’est pas encore validé, les chiffres peuvent encore changer ;
        « validée » : ton cabinet a validé l’exercice.
      </p>

      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : lue.etat === 'echec' ? (
        <p className="error-text">Tes comptes ne s’affichent pas : {lue.motif}. Recharge la page.</p>
      ) : lue.etat === 'sans_comptes' ? (
        <p className="muted">
          Ton accès ne porte plus « Comptes » sur cette société : tes comptes ne s’affichent pas ici. Pour les retrouver, demande
          à ton cabinet d’ajouter « Comptes » à ton accès.
        </p>
      ) : !lue.situations.complete ? (
        <BandeauLecturePartielle
          quoi="Les situations que ton cabinet t’a publiées" accord="lues" motif={lue.situations.motif} technique={false}
          consequence="Aucune ne s’affiche : la plus récente pourrait manquer. Recharge la page."
        />
      ) : situation === null || enCours === null ? (
        <p className="muted">Ton cabinet ne t’a publié aucune situation pour l’instant.</p>
      ) : (
        <>
          {enCours.length > 1 && (
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="comptes-situation">Situation</label>
              <select id="comptes-situation" value={situation.id} onChange={(e) => setChoisie(e.target.value)}>
                {enCours.map((s) => (
                  <option key={s.id} value={s.id}>
                    Arrêtée au {formatDate(s.arretee_au)}{s.statut ? ` (${STATUT_DIT[s.statut]})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <h2 style={{ marginBottom: 4 }}>
            Situation arrêtée au {formatDate(situation.arretee_au)}
            {contenu && <> — {STATUT_DIT[contenu.statut]}</>}
          </h2>
          {contenu === null ? (
            <p className="error-text">
              Cette situation ne se lit pas : aucun de ses chiffres ne t’est montré. Dis-le à ton cabinet.
            </p>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Du {formatDate(contenu.periode.debut)} au {formatDate(contenu.periode.fin)}
                {contenu.n_moins_1
                  ? <>, face à la même période de {annee !== null ? annee - 1 : ''}.</>
                  : <> ; ton cabinet ne l’a pas publiée avec l’exercice précédent.</>}
              </p>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                <Totaux titre={String(annee)} c={contenu} />
                {contenu.n_moins_1 && annee !== null && <Totaux titre={String(annee - 1)} c={contenu.n_moins_1} />}
              </div>
              {contenu.postes.length === 0 && (contenu.n_moins_1?.postes.length ?? 0) === 0 ? (
                <p className="muted">Aucun poste : rien n’était compté à cette date.</p>
              ) : (
                <div className="card table-scroll tableau-adaptable" style={{ padding: 0 }}>
                  <table className="table-empilable table-empilable-en-carte">
                    <thead>
                      <tr>
                        <th>Poste</th>
                        <th>{annee}</th>
                        {contenu.n_moins_1 && annee !== null && <th>{annee - 1}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {postesFaceAFace(contenu, contenu.n_moins_1).map((l) => (
                        <tr key={l.poste}>
                          <td data-libelle="Poste">{l.poste}</td>
                          <td data-libelle={String(annee)}>{l.n === null ? '—' : montantDit(l.n)}</td>
                          {contenu.n_moins_1 && annee !== null && (
                            <td data-libelle={String(annee - 1)}>{l.nMoins1 === null ? '—' : montantDit(l.nMoins1)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted">Une recette s’écrit en positif, une dépense en négatif.</p>
            </>
          )}
        </>
      )}
    </>
  )
}
