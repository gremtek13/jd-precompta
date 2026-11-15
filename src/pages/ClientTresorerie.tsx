import { useAuth } from '../context/AuthContext'
import { droitsSur } from '../lib/droitsAcces'
import { SANS_IMPOT_SUR_LES_SOCIETES } from '../lib/echeancesFiscales'
import { VENTES_DU_CLIENT_EXPORTEES } from '../lib/encaissementsFactures'
import { mesVentesOuvertes } from '../lib/espaceVentes'
import { aujourdHuiAParis, formatMoney } from '../lib/format'
import {
  TRESORERIE_BANQUE_FERMEE, TRESORERIE_DROITS_ILLISIBLES, TRESORERIE_INTRODUCTION, TRESORERIE_MUETTE, TRESORERIE_PLUSIEURS_DATES,
  TRESORERIE_PREVISION, TRESORERIE_SANS_MOUVEMENT, TRESORERIE_SOURCE_DU_SOLDE, composerTresorerie, departDesSoldes,
  dernierJourDeLHorizon, echeancesDeLEcheancier, enLettres, phraseDuDecouvert, soldesDeLaBanque, type Depart, type NonCompte, type Tresorerie,
} from '../lib/tresorerieClient'
import { useTresorerieDuClient, type LectureDeLaTresorerie } from '../lib/tresorerieClientLecture'
import { moisEnLettres } from '../lib/echeancierClient'
import {
  moisLePlusBas, nonComptesSelonLaPrevision, periodeNonComptee, phraseDeLaPublication, phraseDesMoisPasses, phraseDuDepart,
  phraseDuMoisLePlusBas, phraseDUnePrevisionPassee, phraseDuNonCompte, phraseDuRythme, PREVISION_AUCUNE, PREVISION_CONTENU_ILLISIBLE,
  PREVISION_ESPECES, PREVISION_ILLISIBLE, PREVISION_MOT, PREVISION_PAS_UN_ENGAGEMENT, PREVISION_SANS_BANQUE, PREVISION_TITRE,
  previsionAMontrer, PREVISIONS_PUBLIEES_PREVUES,
} from '../lib/previsionsPubliees'
import { usePrevisionDuClient, type LectureDuClient } from '../lib/previsionsPublieesLecture'

// « MA TRÉSORERIE À 90 JOURS » (ligne 51.5, partie C, étape C8) : le solde lu, plus ce que tes clients te doivent à
// l'échéance de leurs factures, moins tes impôts et tes cotisations au montant connu, jour après jour, jusqu'au 89e jour qui
// suit aujourd'hui (jour de Paris). La route et l'entrée s'offrent avec la case « Banque » (`maTresorerieOuverte`, derrière
// `TRESORERIE_A_90_JOURS_OFFERTE`) ; la case « Ventes » de la société affichée ajoute les créances, et la lecture relit les
// deux à la base. La règle et les mots dans lib/tresorerieClient.ts, la lecture dans lib/tresorerieClientLecture.ts.
// Rien ne s'écrit d'ici.
//
// Le vide est une affirmation : rien ne se dit avant le retour des lectures (« Chargement… ») ; une source lue en partie rend
// la projection muette, avec son motif en infobulle, jamais « 0 ». Ce qui n'est pas compté se dit, ligne par ligne.
//
// LA PRÉVISION DE TON CABINET (C8-Q2, derrière `PREVISIONS_PUBLIEES_PREVUES`) : ce que le cabinet a publié de son plan de
// trésorerie, lu à part (lib/previsionsPublieesLecture.ts, la case « Banque » relue à la base), montré dans sa propre carte,
// sous le mot « prévision », après ce qui n'est pas compté — jamais ajouté au solde attendu ni au point le plus bas des
// montants connus, qui ne lisent rien d'elle. Lue en partie ou illisible, elle se tait sur son motif ; la projection, elle,
// n'en dépend pas.
export default function ClientTresorerie() {
  const { dossierActifId, droitsParDossier } = useAuth()
  // `?? {}` : une doublure de contexte sans droits n'en accorde aucun (seul `true` accorde, lib/droitsAcces.ts).
  const ventes = mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierActifId).ventes)
  const lecture = useTresorerieDuClient(dossierActifId, ventes)
  const prevision = usePrevisionDuClient(dossierActifId, PREVISIONS_PUBLIEES_PREVUES)

  if (!dossierActifId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte ton cabinet comptable.</p>
  }

  // Le jour de Paris, lu au rendu.
  const aujourdHui = aujourdHuiAParis()

  return (
    <>
      <div className="topbar"><h1>Ma trésorerie à 90 jours</h1></div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>{TRESORERIE_INTRODUCTION}</p>
      {lecture === null ? (
        <div className="card"><p className="muted" aria-busy="true">Chargement…</p></div>
      ) : lecture.etat === 'droits_illisibles' ? (
        <div className="card"><p className="error-text" title={lecture.motif}>{TRESORERIE_DROITS_ILLISIBLES}</p></div>
      ) : lecture.etat === 'banque_fermee' ? (
        <div className="card"><p className="muted">{TRESORERIE_BANQUE_FERMEE}</p></div>
      ) : (
        <>
          <Projection tresorerie={composer(lecture, aujourdHui)} aujourdHui={aujourdHui} />
          {PREVISIONS_PUBLIEES_PREVUES && <PrevisionDuCabinet lecture={prevision} aujourdHui={aujourdHui} />}
        </>
      )}
    </>
  )
}

function composer(lecture: Extract<LectureDeLaTresorerie, { etat: 'lue' }>, aujourdHui: string): Tresorerie {
  const soldes = soldesDeLaBanque(lecture.comptes, lecture.controles)
  const depart: Depart = soldes.etat === 'retenus' ? { etat: 'muet', motif: soldes.raison } : departDesSoldes(soldes.soldes)
  return composerTresorerie({
    aujourdHui, depart, creances: lecture.creances, achats: lecture.achats, releve: lecture.releve,
    // Le régime d'imposition ne se lit pas encore en base (LIA4) : aucun dossier n'a d'IS au calendrier (LIA8), comme
    // « Mon échéancier ».
    echeances: echeancesDeLEcheancier(lecture.echeancier, aujourdHui, SANS_IMPOT_SUR_LES_SOCIETES),
  })
}

const euros = (centimes: number) => <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(centimes / 100)}</span>

function Projection({ tresorerie: t, aujourdHui }: { tresorerie: Tresorerie; aujourdHui: string }) {
  if (t.etat === 'sans_depart') {
    return (
      <div className="card">
        <p className={t.depart.etat === 'muet' ? 'error-text' : 'muted'} title={t.depart.etat === 'muet' ? t.depart.motif : undefined}>
          {t.depart.etat === 'muet' ? TRESORERIE_MUETTE : t.depart.phrase}
        </p>
      </div>
    )
  }
  const depart = (
    <section aria-label="Ton point de départ">
      <p style={{ margin: '0 0 4px' }}>
        {t.depart.comptes > 1 ? `Solde de tes ${t.depart.comptes} comptes` : 'Solde'} au relevé du {enLettres(t.depart.au)} : <strong>{euros(t.depart.centimes)}</strong>
      </p>
      <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>{TRESORERIE_SOURCE_DU_SOLDE}</p>
      {t.depart.datesDifferentes && <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>{TRESORERIE_PLUSIEURS_DATES}</p>}
    </section>
  )
  if (t.etat === 'muette') {
    return (
      <div className="card">
        {depart}
        <p className="error-text" title={t.motif} style={{ marginTop: 12 }}>{TRESORERIE_MUETTE}</p>
      </div>
    )
  }
  return (
    <>
      <div className="card">
        {depart}
        <section aria-label="Dans 90 jours" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Jusqu’au {enLettres(dernierJourDeLHorizon(aujourdHui))}</h2>
          <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, lineHeight: 1.7 }}>
            <li>Ce qui devrait entrer : {euros(t.entreesCentimes)}</li>
            <li>Ce qui devrait sortir : {euros(t.sortiesCentimes)}</li>
            <li>Solde attendu le {enLettres(dernierJourDeLHorizon(aujourdHui))} : <strong>{euros(t.finCentimes)}</strong></li>
            <li>
              Point le plus bas : <strong>{euros(t.pointBas.centimes)}</strong>, le {enLettres(t.pointBas.date)}
            </li>
          </ul>
          {t.premierDecouvert !== null && (
            <p className="error-text" role="alert">
              {phraseDuDecouvert(t.premierDecouvert)}
            </p>
          )}
          {t.avecPrevision && <p className="muted" style={{ fontSize: '0.85rem' }}>{TRESORERIE_PREVISION}</p>}
        </section>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Jour après jour</h2>
        {t.mouvements.length === 0 ? (
          <p className="muted">{TRESORERIE_SANS_MOUVEMENT}</p>
        ) : (
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite" aria-label="Ta trésorerie jour après jour">
              <thead><tr><th>Date</th><th>Quoi</th><th>Montant</th><th>Solde après</th></tr></thead>
              <tbody>
                {t.mouvements.map((m) => (
                  <tr key={m.id}>
                    <td data-libelle="Date">{enLettres(m.date)}</td>
                    <td data-libelle="Quoi">{m.libelle}{m.prevision && <span className="badge badge-warning" style={{ marginLeft: 6 }}>prévision</span>}</td>
                    <td data-libelle="Montant">{m.centimes > 0 ? '+ ' : ''}{euros(m.centimes)}</td>
                    <td data-libelle="Solde après" className={m.soldeApresCentimes < 0 ? 'error-text' : undefined}>{euros(m.soldeApresCentimes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NonComptes lignes={nonComptesSelonLaPrevision(t.nonComptes, PREVISIONS_PUBLIEES_PREVUES)} />
    </>
  )
}

function NonComptes({ lignes }: { lignes: readonly NonCompte[] }) {
  return (
    <section className="card" aria-label="Ce qui n’est pas compté">
      <h2 style={{ marginTop: 0 }}>Ce qui n’est pas compté</h2>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        {lignes.map((l) => (
          <li key={l.cle}>{l.phrase}{l.centimes !== null && <> ({euros(l.centimes)})</>}</li>
        ))}
      </ul>
    </section>
  )
}

function PrevisionDuCabinet({ lecture, aujourdHui }: { lecture: LectureDuClient | null; aujourdHui: string }) {
  const titre = (
    <h2 style={{ marginTop: 0 }}>
      {PREVISION_TITRE} <span className="badge badge-warning" style={{ marginLeft: 6, verticalAlign: 'middle' }}>{PREVISION_MOT}</span>
    </h2>
  )
  if (lecture === null) {
    return <section className="card" aria-label={PREVISION_TITRE}>{titre}<p className="muted" aria-busy="true">Chargement…</p></section>
  }
  if (lecture.etat === 'echec' || (lecture.etat === 'lue' && !lecture.previsions.complete)) {
    const motif = lecture.etat === 'echec' ? lecture.motif : lecture.previsions.motif ?? undefined
    return <section className="card" aria-label={PREVISION_TITRE}>{titre}<p className="error-text" title={motif}>{PREVISION_ILLISIBLE}</p></section>
  }
  if (lecture.etat === 'sans_banque') {
    return <section className="card" aria-label={PREVISION_TITRE}>{titre}<p className="muted">{PREVISION_SANS_BANQUE}</p></section>
  }
  const a = previsionAMontrer(lecture.previsions.lignes, aujourdHui)
  if (a.etat !== 'montree') {
    return (
      <section className="card" aria-label={PREVISION_TITRE}>
        {titre}
        <p className={a.etat === 'illisible' ? 'error-text' : 'muted'}>
          {a.etat === 'aucune' ? PREVISION_AUCUNE : a.etat === 'illisible' ? PREVISION_CONTENU_ILLISIBLE : phraseDUnePrevisionPassee(a.etablieLe)}
        </p>
      </section>
    )
  }
  const c = a.contenu
  const trou = periodeNonComptee(c)
  return (
    <section className="card" aria-label={PREVISION_TITRE}>
      {titre}
      <p className="muted" style={{ marginTop: 0 }}>{PREVISION_PAS_UN_ENGAGEMENT}</p>
      <p style={{ margin: '0 0 4px' }}>{phraseDeLaPublication(c.etablie_le)}</p>
      {a.moisPasses > 0 && <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 4px' }}>{phraseDesMoisPasses(c.etablie_le)}</p>}
      <p style={{ margin: '0 0 4px' }}>{phraseDuDepart(c.depart)}</p>
      <p style={{ margin: '0 0 4px' }}>{phraseDuRythme(c.rythme)}{c.avec_especes && <> {PREVISION_ESPECES}</>}</p>
      {trou && <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 8px' }}>{phraseDuNonCompte(trou)}</p>}
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable-etroite" aria-label="La prévision de ton cabinet, mois par mois">
          <thead><tr><th>Mois</th><th>Solde au début</th><th>Entrées</th><th>Sorties</th><th>Solde à la fin</th></tr></thead>
          <tbody>
            {c.mois.map((m) => (
              <tr key={m.mois}>
                <td data-libelle="Mois">{moisEnLettres(m.mois)}</td>
                <td data-libelle="Solde au début">{euros(m.solde_debut)}</td>
                <td data-libelle="Entrées">{euros(m.encaissements)}</td>
                <td data-libelle="Sorties">{euros(m.decaissements)}</td>
                <td data-libelle="Solde à la fin" className={m.solde_fin < 0 ? 'error-text' : undefined}>{euros(m.solde_fin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={moisLePlusBas(c).solde_fin < 0 ? 'error-text' : 'muted'} style={{ marginBottom: 0 }}>{phraseDuMoisLePlusBas(moisLePlusBas(c))}</p>
    </section>
  )
}
