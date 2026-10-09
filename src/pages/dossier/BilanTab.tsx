import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { lireTout } from '../../lib/lectureComplete'
import {
  bilanDeLExercice, CASES_DES_TOTAUX, type BilanDeLExercice, type Contribution, type PointDuBilan, type RubriqueActif,
  type RubriquePassif,
} from '../../lib/bilan'
import { LIBELLES_MODE, type ModeleComptable } from '../../lib/engagement'
import type { EtatDeLOuverture } from '../../lib/reportDesSoldes'
import type { ANouveau, Categorie, EcritureBrouillon, Piece, SoldeReporte } from '../../lib/types'
import type { DossierTab } from '../../lib/ongletsDossier'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// LE BILAN DE L'EXERCICE CHOISI (ligne 33 de la feuille de route) : ses rubriques sont celles du 2033-A-SD, et il se
// calcule dans `lib/bilan.ts` depuis les soldes de l'exercice — son ouverture et ses écritures, celles de la Balance
// des comptes. L'écran lit, calcule et montre ; il n'écrit rien.
//
// UN BILAN NE SE MONTRE QUE SUR CE QUI A ÉTÉ LU EN ENTIER. Ses totaux sont des sommes : une lecture tronquée les
// rendrait faux sans que rien ne le trahisse — et un bilan déséquilibré par la lecture se lirait comme une
// comptabilité fausse. Avant la première réponse, « Chargement… » ; sur une lecture partielle, le bandeau de ce qui
// manque, et aucun chiffre.

const euros = (centimes: number) => formatMoney(centimes / 100)
// Les montants à droite, comme dans tout tableau de chiffres ; replié en fiche, le tableau les remet à gauche de
// lui-même (`text-align: left !important`, index.css).
const MONTANT = { textAlign: 'right' } as const
// Les cases du 2033-A sous le libellé de la rubrique : un bloc (`cellule-suite`) qui, replié, passe sous le libellé au
// lieu d'être écarté au bout de la fiche.
const CASES = { fontSize: '0.75rem' } as const
const NUMERO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const

type Etabli = Extract<BilanDeLExercice, { etat: 'etabli' }>

// Ce que l'écran dit de l'ouverture de l'exercice, d'où partent ses comptes de bilan.
function phraseDeLOuverture(etat: EtatDeLOuverture): string | null {
  switch (etat.type) {
    case 'reprise':
      return `Ouvert par les à-nouveaux du ${formatDate(etat.date)}, repris de ${etat.source}.`
    case 'report':
      return etat.lignes === 0
        ? `Ouvert par l’exercice ${etat.depuis} validé, dont tous les comptes de bilan étaient soldés.`
        : `Ouvert par les soldes reportés de l’exercice ${etat.depuis} validé.`
    case 'en-attente':
    case 'sans-objet':
      return null
  }
}

const BADGE_DU_POINT: Record<PointDuBilan['gravite'], { classe: string; mot: string }> = {
  erreur: { classe: 'badge badge-danger', mot: 'à corriger' },
  attention: { classe: 'badge badge-warning', mot: 'à revoir' },
  information: { classe: 'badge badge-neutral', mot: 'à savoir' },
}

// Une ligne du détail : le compte, son libellé, son montant dans le sens de la rubrique, et ce qui le distingue.
function LigneDuDetail({ c }: { c: Contribution }) {
  const colonne = c.colonne === 'amortissements' ? ' (amortissements et dépréciations)' : ''
  return (
    <li>
      <span style={NUMERO}>{c.compte}</span>
      {` ${c.libelle}${colonne} : ${euros(c.centimes)}`}
      {c.inhabituel && <span className="muted">{' — solde de l’autre sens que le sien'}</span>}
      {c.raison && <span className="muted">{` — ${c.raison}`}</span>}
      {c.tiers && (
        <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
          {c.tiers.map((t) => (
            <li key={t.auxiliaire ?? '(sans détail)'}>
              {t.auxiliaire ? `${t.libelle} (${t.auxiliaire})` : t.libelle}{` : ${euros(t.centimes)}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function DetailParCompte({ rubriques }: { rubriques: (RubriqueActif | RubriquePassif)[] }) {
  return (
    <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
      {rubriques.filter((r) => r.contributions.length > 0).map((r) => (
        <li key={r.id}>
          <strong>{r.libelle}</strong>
          <ul style={{ margin: '4px 0 10px', paddingLeft: 20 }}>
            {r.contributions.map((c, n) => <LigneDuDetail key={`${c.compte}-${c.colonne}-${n}`} c={c} />)}
          </ul>
        </li>
      ))}
    </ul>
  )
}

// La cellule d'une rubrique : son libellé, et ses cases du 2033-A dessous.
function CelluleRubrique({ libelle, cases }: { libelle: string; cases: string | null }) {
  return (
    <td data-libelle="Rubrique">
      {libelle}
      {cases && <div className="cellule-suite muted" style={CASES}>{cases}</div>}
    </td>
  )
}

function TableauActif({ bilan }: { bilan: Etabli }) {
  const lignes = (masse: RubriqueActif['masse']) => bilan.actif.filter((r) => r.masse === masse && (r.brut !== 0 || r.amortissements !== 0))
  const t = bilan.totauxActif
  const montants = (s: { brut: number; amortissements: number; net: number }, amortissementsVides: boolean) => (
    <>
      <td data-libelle="Brut" style={MONTANT}>{euros(s.brut)}</td>
      <td data-libelle="Amort. et dépréc." style={MONTANT}>{amortissementsVides && s.amortissements === 0 ? '' : euros(s.amortissements)}</td>
      <td data-libelle="Net" style={MONTANT}>{euros(s.net)}</td>
    </>
  )
  const ligne = (r: RubriqueActif) => (
    <tr key={r.id}>
      <CelluleRubrique libelle={r.libelle} cases={r.cases ? `cases ${r.cases.brut} et ${r.cases.amortissements}` : null} />
      {montants(r, true)}
    </tr>
  )
  const sousTotal = (libelle: string, cases: { brut: string; amortissements: string }, s: { brut: number; amortissements: number; net: number }) => (
    <tr style={{ fontWeight: 700 }}>
      <CelluleRubrique libelle={libelle} cases={`cases ${cases.brut} et ${cases.amortissements}`} />
      {montants(s, false)}
    </tr>
  )
  return (
    <div className="table-scroll tableau-adaptable">
      <table className="table-empilable-etroite">
        <thead><tr><th>Actif</th><th>Brut</th><th>Amort. et dépréc.</th><th>Net</th></tr></thead>
        <tbody>
          {lignes('immobilise').map(ligne)}
          {sousTotal('Actif immobilisé (total I)', CASES_DES_TOTAUX.actifImmobilise, t.immobilise)}
          {lignes('circulant').map(ligne)}
          {sousTotal('Actif circulant (total II)', CASES_DES_TOTAUX.actifCirculant, t.circulant)}
          {lignes('a-classer').map(ligne)}
        </tbody>
        <tfoot>
          <tr>
            <CelluleRubrique
              libelle="Total général"
              cases={`cases ${CASES_DES_TOTAUX.totalActif.brut} et ${CASES_DES_TOTAUX.totalActif.amortissements}`}
            />
            {montants(t, false)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function TableauPassif({ bilan }: { bilan: Etabli }) {
  // Le résultat se montre toujours, nul compris : c'est la ligne qu'on cherche d'abord dans un bilan.
  const lignes = (masse: RubriquePassif['masse']) =>
    bilan.passif.filter((r) => r.masse === masse && (r.montant !== 0 || r.contributions.length > 0 || r.id === 'resultat'))
  const t = bilan.totauxPassif
  const ligne = (r: RubriquePassif) => (
    <tr key={r.id}>
      <CelluleRubrique libelle={r.libelle} cases={r.case ? `case ${r.case}` : null} />
      <td data-libelle="Montant" style={MONTANT}>{euros(r.montant)}</td>
    </tr>
  )
  const sousTotal = (libelle: string, laCase: string, montant: number) => (
    <tr style={{ fontWeight: 700 }}>
      <CelluleRubrique libelle={libelle} cases={`case ${laCase}`} />
      <td data-libelle="Montant" style={MONTANT}>{euros(montant)}</td>
    </tr>
  )
  return (
    <div className="table-scroll tableau-adaptable">
      <table className="table-empilable-etroite">
        <thead><tr><th>Passif</th><th>Montant</th></tr></thead>
        <tbody>
          {lignes('capitaux-propres').map(ligne)}
          {sousTotal('Capitaux propres (total I)', CASES_DES_TOTAUX.capitauxPropres, t.capitauxPropres)}
          {lignes('provisions').map(ligne)}
          {lignes('dettes').map(ligne)}
          {sousTotal('Dettes (total III)', CASES_DES_TOTAUX.dettes, t.dettes)}
          {lignes('a-classer').map(ligne)}
        </tbody>
        <tfoot>
          <tr>
            <CelluleRubrique libelle="Total général" cases={`case ${CASES_DES_TOTAUX.totalPassif}`} />
            <td data-libelle="Montant" style={MONTANT}>{euros(t.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

interface Lectures {
  ecritures: EcritureBrouillon[]
  categories: Categorie[]
  pieces: Pick<Piece, 'id' | 'tiers'>[]
  aNouveaux: ANouveau[]
  reportes: SoldeReporte[]
  motifs: { quoi: string; accord: 'lues' | 'lus'; motif: string }[]
}

export default function BilanTab({ dossierId, modele, onNavigate }: {
  dossierId: string
  // Le modèle ENTIER, sans valeur par défaut : il décide de la forme de l'entreprise (`exploitantIndividuel`), donc de
  // ses capitaux propres, et de ce que l'écran dit d'un dossier tenu en trésorerie.
  modele: ModeleComptable
  onNavigate: (tab: DossierTab) => void
}) {
  const { annee } = useAnnee()
  const { anneesValidees } = useExercicesValides()
  const [lectures, setLectures] = useState<Lectures | null>(null)

  useEffect(() => {
    let annule = false
    void (async () => {
      const [brouillon, lectureCategories, lecturePieces, lectureANouveaux, lectureReportes] = await Promise.all([
        // Tout le brouillon, tous exercices : l'exercice s'y lit, et le détail d'un client ou d'un fournisseur se lit
        // depuis la reprise. Par tranches, sur un ordre total (lib/lectureComplete.ts).
        lireTout<EcritureBrouillon>((debut, fin) =>
          supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
            .eq('dossier_id', dossierId).order('id').range(debut, fin),
        ),
        lireTout<Categorie>((debut, fin) =>
          supabase.from('categories').select('*', { count: 'exact' })
            .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
        ),
        // Le tiers de chaque pièce, et rien d'autre : c'est tout ce que le bilan en lit (son compte auxiliaire).
        lireTout<Pick<Piece, 'id' | 'tiers'>>((debut, fin) =>
          supabase.from('pieces').select('id, tiers', { count: 'exact' })
            .eq('dossier_id', dossierId).order('id').range(debut, fin),
        ),
        lireTout<ANouveau>((debut, fin) =>
          supabase.from('a_nouveaux').select('*', { count: 'exact' })
            .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
        ),
        lireTout<SoldeReporte>((debut, fin) =>
          supabase.from('soldes_reportes').select('*', { count: 'exact' })
            .eq('dossier_id', dossierId).order('date').order('compte').order('id').range(debut, fin),
        ),
      ])
      if (annule) return
      // Chaque lecture a son bandeau : dire laquelle manque, c'est dire où chercher.
      const motifs: Lectures['motifs'] = []
      if (brouillon.motif) motifs.push({ quoi: 'Les écritures du brouillon', accord: 'lues', motif: brouillon.motif })
      if (lectureCategories.motif) motifs.push({ quoi: 'Les catégories du cabinet', accord: 'lues', motif: lectureCategories.motif })
      if (lecturePieces.motif) motifs.push({ quoi: 'Les pièces du dossier', accord: 'lues', motif: lecturePieces.motif })
      if (lectureANouveaux.motif) motifs.push({ quoi: 'Les à-nouveaux du dossier', accord: 'lus', motif: lectureANouveaux.motif })
      if (lectureReportes.motif) {
        motifs.push({ quoi: 'Les soldes reportés des exercices validés', accord: 'lus', motif: lectureReportes.motif })
      }
      setLectures({
        ecritures: brouillon.lignes, categories: lectureCategories.lignes, pieces: lecturePieces.lignes,
        aNouveaux: lectureANouveaux.lignes, reportes: lectureReportes.lignes, motifs,
      })
    })()
    return () => { annule = true }
  }, [dossierId])

  // « Aujourd'hui » se lit au rendu, jamais au chargement du module : la page ne se recharge pas d'un jour à l'autre.
  const aujourdHui = aujourdHuiAParis()
  const bilan = useMemo(() => {
    if (!lectures || lectures.motifs.length > 0 || typeof annee !== 'number') return null
    return bilanDeLExercice({
      exercice: annee, ecritures: lectures.ecritures, categories: lectures.categories, reprise: lectures.aNouveaux,
      reportes: lectures.reportes, anneesValidees, pieces: lectures.pieces, modele, aujourdHui,
    })
  }, [lectures, annee, anneesValidees, modele, aujourdHui])

  if (!lectures) {
    return <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
  }
  if (lectures.motifs.length > 0) {
    return (
      <div className="card">
        {lectures.motifs.map((m) => (
          <BandeauLecturePartielle
            key={m.quoi}
            quoi={m.quoi}
            accord={m.accord}
            motif={m.motif}
            consequence="Le bilan ne s’établit pas sur une lecture incomplète : ses totaux seraient faux. Recharge la page."
          />
        ))}
      </div>
    )
  }
  if (bilan === null) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>Un bilan s’arrête à la clôture d’un exercice : choisis-en un en tête du dossier.</p>
      </div>
    )
  }
  if (bilan.etat === 'non-etabli') {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{`Bilan au ${formatDate(bilan.dateCloture)}`}</h3>
        <p className="error-text" style={{ marginBottom: 0 }}>{bilan.motif.texte}</p>
        {bilan.motif.code === 'ouverture-en-attente' && (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('cloture')}>
              {`Valider l’exercice ${bilan.exercice - 1} dans Clôture`}
            </button>
          </div>
        )}
      </div>
    )
  }

  const ouverture = phraseDeLOuverture(bilan.ouverture)
  // « Trésorerie (BNC, 2035) » au milieu d'une phrase : la première lettre seule s'abaisse, les sigles restent.
  const libelleDuMode = LIBELLES_MODE[modele.mode]
  const mode = libelleDuMode.charAt(0).toLowerCase() + libelleDuMode.slice(1)
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          {`Bilan au ${formatDate(bilan.dateCloture)}`}
          {/* L'espace avant le badge : sans lui, un lecteur d'écran lirait « 31/12/2026provisoire ». */}
          {bilan.provisoire && <>{' '}<span className="badge badge-warning">provisoire</span></>}
        </h3>
        {modele.mode === 'tresorerie' && (
          <p className="muted">
            Un BNC à la déclaration contrôlée n’établit pas de bilan : il tient un livre-journal de ses recettes et de ses
            dépenses et un registre de ses immobilisations (CGI, art. 99). Ce tableau range les comptes de bilan de son
            brouillon — immobilisations, trésorerie, emprunts, TVA, compte de l’exploitant — dans les rubriques d’un bilan
            simplifié : un contrôle de clôture, pas un document à déposer.
          </p>
        )}
        <p className="muted">
          {`Comptabilité : ${mode}. `}
          {bilan.individuel
            ? 'Entreprise individuelle : le compte de l’exploitant et les résultats des exercices précédents forment le capital individuel (case 120).'
            : `Société, déduite du compte du dirigeant (${modele.compteNotesDeFrais}) choisi dans Écritures : le résultat d’un exercice précédent reste au 120 ou au 129 tant que son affectation n’est pas écrite.`}
          {ouverture ? ` ${ouverture}` : ''}
        </p>
        <p style={{ marginBottom: bilan.points.length > 0 ? 12 : 0 }}>
          {bilan.ecart === 0
            ? <span className="badge badge-ok">équilibré</span>
            : <span className="badge badge-danger">{`écart de ${euros(Math.abs(bilan.ecart))}`}</span>}
          {` Actif net ${euros(bilan.totauxActif.net)}, passif ${euros(bilan.totauxPassif.total)}.`}
        </p>
        {bilan.points.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
            {bilan.points.map((p) => (
              <li key={p.code}>
                <span className={BADGE_DU_POINT[p.gravite].classe}>{BADGE_DU_POINT[p.gravite].mot}</span>{` ${p.texte}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ padding: 0, marginTop: 20 }}>
        <TableauActif bilan={bilan} />
      </div>

      <div className="card" style={{ padding: 0, marginTop: 20 }}>
        <TableauPassif bilan={bilan} />
      </div>

      {(bilan.renvois.dontTva !== 0 || bilan.renvois.dontComptesCourantsDebiteurs !== 0) && (
        <p className="muted" style={{ marginTop: 10 }}>
          {[
            bilan.renvois.dontTva !== 0
              ? `Dont TVA dans les dettes fiscales et sociales (case ${CASES_DES_TOTAUX.dontTva}) : ${euros(bilan.renvois.dontTva)}.` : null,
            bilan.renvois.dontComptesCourantsDebiteurs !== 0
              ? `Dont comptes courants d’associés débiteurs dans les autres créances (case ${CASES_DES_TOTAUX.dontComptesCourantsDebiteurs}) : `
                + `${euros(bilan.renvois.dontComptesCourantsDebiteurs)}.` : null,
          ].filter(Boolean).join(' ')}
        </p>
      )}

      <details className="card" style={{ marginTop: 20 }}>
        <summary>Détail par compte</summary>
        <h4>Actif</h4>
        <DetailParCompte rubriques={bilan.actif} />
        <h4>Passif</h4>
        <DetailParCompte rubriques={bilan.passif} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {`Résultat de l’exercice : ${euros(bilan.resultat)}, la différence des comptes de produits (classe 7) et de charges (classe 6) de l’exercice.`}
        </p>
      </details>

      <div className="card" style={{ marginTop: 20 }}>
        <h4 style={{ marginTop: 0 }}>Ce que ce bilan ne contient pas encore</h4>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          {modele.mode === 'tresorerie'
            ? <li>Tenu en trésorerie, le brouillon ne porte ni créance client ni dette fournisseur : une facture y compte à son paiement.</li>
            : (
              <li>
                Les écritures d’inventaire ne se passent pas encore dans l’application : stocks, charges et produits constatés
                d’avance, factures non parvenues et à établir, provisions et dépréciations. Leurs rubriques ne portent que ce que
                le brouillon contient.
              </li>
            )}
          {!bilan.individuel && (
            <li>L’impôt sur les sociétés de l’exercice et l’affectation du résultat de l’exercice précédent ne s’écrivent pas encore.</li>
          )}
          <li>
            C’est le bilan du brouillon tel qu’il est : la Vue d’ensemble et l’onglet Écritures disent ce qui reste à faire avant
            de le lire comme définitif — une écriture à régénérer, une dotation à écrire, un mouvement à rapprocher.
          </li>
          <li>La colonne de l’exercice précédent et les renvois sur les échéances, à moins ou à plus d’un an, viendront avec la liasse.</li>
        </ul>
      </div>
    </>
  )
}
