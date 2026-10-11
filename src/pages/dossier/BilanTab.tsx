import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { lireTout } from '../../lib/lectureComplete'
import {
  bilanDeLExercice, CASES_DES_TOTAUX, colonneDeLExercicePrecedent, detailDuBilan, lignesDuBilan, type BilanEtabli,
  type ColonneDeLExercicePrecedent, type CompteDuDetail, type LigneDeLActif, type LigneDuPassif, type PointDuBilan,
  type RubriqueActif, type RubriqueDuDetail, type RubriquePassif,
} from '../../lib/bilan'
import { LIBELLES_MODE, type ModeleComptable } from '../../lib/engagement'
import {
  confronterLOuverture, type CauseDeLEcart, type ConfrontationDeLOuverture, type EcartDeCompte,
} from '../../lib/ouvertureConfrontee'
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
//
// LA COLONNE DE L'EXERCICE PRÉCÉDENT (N−1, en net, comme le 2033-A-SD la porte) se calcule par le même module sur les
// mêmes lectures (`colonneDeLExercicePrecedent`) : quand son bilan ne s'établit pas, l'en-tête dit pourquoi et aucun
// chiffre de N−1 ne paraît, ni dans les tableaux ni dans le détail.
//
// L'OUVERTURE CONFRONTÉE À LA CLÔTURE DE N−1 (code de commerce, art. L123-19 ; PCG, art. 112-2) se juge de même sur
// les mêmes lectures (`confronterLOuverture`) : une ligne « Ouverture » dans l'en-tête — concordante, ou ses écarts,
// rubrique par rubrique puis compte par compte —, ou pourquoi il n'y a rien à confronter. Rien ne s'en corrige d'ici.

const euros = (centimes: number) => formatMoney(centimes / 100)
// Les montants à droite, comme dans tout tableau de chiffres ; replié en fiche, le tableau les remet à gauche de
// lui-même (`text-align: left !important`, index.css).
const MONTANT = { textAlign: 'right' } as const
// Les cases du 2033-A sous le libellé de la rubrique : un bloc (`cellule-suite`) qui, replié, passe sous le libellé au
// lieu d'être écarté au bout de la fiche.
const CASES = { fontSize: '0.75rem' } as const
const NUMERO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const

type Etabli = BilanEtabli

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

// Le montant d'un exercice où le compte (ou la rubrique) ne porte rien : la case reste vide, comme sur le formulaire.
const VIDE = '—'

// Une ligne du détail : le compte, son libellé, son montant dans le sens de la rubrique, et ce qui le distingue ; puis,
// quand la colonne de l'exercice précédent s'établit, son montant de N−1 — un compte présent d'un seul côté a sa ligne,
// vide de l'autre. Le sens inhabituel et les tiers sont ceux de N : la ligne parle de l'exercice affiché.
function LigneDuDetail({ c, precedent }: { c: CompteDuDetail; precedent: number | null }) {
  const colonne = c.colonne === 'amortissements' ? ' (amortissements et dépréciations)' : ''
  const raison = c.n?.raison ?? c.precedent?.raison ?? null
  return (
    <li>
      <span style={NUMERO}>{c.compte}</span>
      {` ${c.libelle}${colonne} : ${c.n ? euros(c.n.centimes) : VIDE}`}
      {precedent !== null && <span className="muted">{` (${precedent} : ${c.precedent ? euros(c.precedent.centimes) : VIDE})`}</span>}
      {c.n?.inhabituel && <span className="muted">{' — solde de l’autre sens que le sien'}</span>}
      {raison && <span className="muted">{` — ${raison}`}</span>}
      {c.n?.tiers && (
        <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
          {c.n.tiers.map((t) => (
            <li key={t.auxiliaire ?? '(sans détail)'}>
              {t.auxiliaire ? `${t.libelle} (${t.auxiliaire})` : t.libelle}{` : ${euros(t.centimes)}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function DetailParCompte({ rubriques, precedent }: { rubriques: RubriqueDuDetail[]; precedent: number | null }) {
  return (
    <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
      {rubriques.map((r) => (
        <li key={r.id}>
          <strong>{r.libelle}</strong>
          <ul style={{ margin: '4px 0 10px', paddingLeft: 20 }}>
            {r.comptes.map((c) => <LigneDuDetail key={`${c.compte}-${c.colonne}`} c={c} precedent={precedent} />)}
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

// Les deux tableaux reçoivent le bilan de N et, quand elle s'établit, celui de N−1 : sans lui, ni colonne ni chiffre de
// l'exercice précédent. Les lignes viennent du module (`lignesDuBilan`) : une rubrique que porte l'un des deux exercices,
// vide de l'autre.
function TableauActif({ bilan, precedent }: { bilan: Etabli; precedent: Etabli | null }) {
  const { actif } = lignesDuBilan(bilan, precedent)
  const lignes = (masse: RubriqueActif['masse']) => actif.filter((l) => l.rubrique.masse === masse)
  const t = bilan.totauxActif
  const tp = precedent?.totauxActif ?? null
  const montants = (s: { brut: number; amortissements: number; net: number } | null, amortissementsVides: boolean) => (
    <>
      <td data-libelle="Brut" style={MONTANT}>{s ? euros(s.brut) : ''}</td>
      <td data-libelle="Amort. et dépréc." style={MONTANT}>
        {!s || (amortissementsVides && s.amortissements === 0) ? '' : euros(s.amortissements)}
      </td>
      <td data-libelle="Net" style={MONTANT}>{s ? euros(s.net) : ''}</td>
    </>
  )
  const netPrecedent = (net: number | null) => precedent && (
    <td data-libelle={`Net ${precedent.exercice}`} style={MONTANT}>{net === null ? '' : euros(net)}</td>
  )
  const ligne = (l: LigneDeLActif) => (
    <tr key={l.rubrique.id}>
      <CelluleRubrique
        libelle={l.rubrique.libelle}
        cases={l.rubrique.cases ? `cases ${l.rubrique.cases.brut} et ${l.rubrique.cases.amortissements}` : null}
      />
      {montants(l.n, true)}
      {netPrecedent(l.precedent)}
    </tr>
  )
  const sousTotal = (
    libelle: string,
    cases: { brut: string; amortissements: string },
    s: { brut: number; amortissements: number; net: number },
    sp: { net: number } | null,
  ) => (
    <tr style={{ fontWeight: 700 }}>
      <CelluleRubrique libelle={libelle} cases={`cases ${cases.brut} et ${cases.amortissements}`} />
      {montants(s, false)}
      {netPrecedent(sp ? sp.net : null)}
    </tr>
  )
  return (
    <div className="table-scroll tableau-adaptable">
      <table className="table-empilable-etroite">
        <thead>
          <tr>
            <th>Actif</th><th>Brut</th><th>Amort. et dépréc.</th>
            <th>{precedent ? `Net ${bilan.exercice}` : 'Net'}</th>
            {precedent && <th>{`Net ${precedent.exercice}`}</th>}
          </tr>
        </thead>
        <tbody>
          {lignes('immobilise').map(ligne)}
          {sousTotal('Actif immobilisé (total I)', CASES_DES_TOTAUX.actifImmobilise, t.immobilise, tp?.immobilise ?? null)}
          {lignes('circulant').map(ligne)}
          {sousTotal('Actif circulant (total II)', CASES_DES_TOTAUX.actifCirculant, t.circulant, tp?.circulant ?? null)}
          {lignes('a-classer').map(ligne)}
        </tbody>
        <tfoot>
          <tr>
            <CelluleRubrique
              libelle="Total général"
              cases={`cases ${CASES_DES_TOTAUX.totalActif.brut} et ${CASES_DES_TOTAUX.totalActif.amortissements}`}
            />
            {montants(t, false)}
            {netPrecedent(tp ? tp.net : null)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function TableauPassif({ bilan, precedent }: { bilan: Etabli; precedent: Etabli | null }) {
  const { passif } = lignesDuBilan(bilan, precedent)
  const lignes = (masse: RubriquePassif['masse']) => passif.filter((l) => l.rubrique.masse === masse)
  const t = bilan.totauxPassif
  const tp = precedent?.totauxPassif ?? null
  const cellules = (montant: number | null, montantPrecedent: number | null) => (
    <>
      <td data-libelle="Montant" style={MONTANT}>{montant === null ? '' : euros(montant)}</td>
      {precedent && (
        <td data-libelle={`Montant ${precedent.exercice}`} style={MONTANT}>
          {montantPrecedent === null ? '' : euros(montantPrecedent)}
        </td>
      )}
    </>
  )
  const ligne = (l: LigneDuPassif) => (
    <tr key={l.rubrique.id}>
      <CelluleRubrique libelle={l.rubrique.libelle} cases={l.rubrique.case ? `case ${l.rubrique.case}` : null} />
      {cellules(l.n, l.precedent)}
    </tr>
  )
  const sousTotal = (libelle: string, laCase: string, montant: number, montantPrecedent: number | null) => (
    <tr style={{ fontWeight: 700 }}>
      <CelluleRubrique libelle={libelle} cases={`case ${laCase}`} />
      {cellules(montant, montantPrecedent)}
    </tr>
  )
  return (
    <div className="table-scroll tableau-adaptable">
      <table className="table-empilable-etroite">
        <thead>
          <tr>
            <th>Passif</th>
            <th>{precedent ? `Montant ${bilan.exercice}` : 'Montant'}</th>
            {precedent && <th>{`Montant ${precedent.exercice}`}</th>}
          </tr>
        </thead>
        <tbody>
          {lignes('capitaux-propres').map(ligne)}
          {sousTotal('Capitaux propres (total I)', CASES_DES_TOTAUX.capitauxPropres, t.capitauxPropres, tp?.capitauxPropres ?? null)}
          {lignes('provisions').map(ligne)}
          {lignes('dettes').map(ligne)}
          {sousTotal('Dettes (total III)', CASES_DES_TOTAUX.dettes, t.dettes, tp?.dettes ?? null)}
          {lignes('a-classer').map(ligne)}
        </tbody>
        <tfoot>
          <tr>
            <CelluleRubrique libelle="Total général" cases={`case ${CASES_DES_TOTAUX.totalPassif}`} />
            {cellules(t.total, tp ? tp.total : null)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// Ce que l'écran dit de la colonne de l'exercice précédent : son équilibre et ce qui l'explique quand elle s'établit,
// sinon pourquoi elle n'a aucun chiffre. Rien n'y agit : le bouton vers Clôture de l'en-tête ne vaut que pour
// l'exercice affiché.
function ExercicePrecedent({ colonne }: { colonne: ColonneDeLExercicePrecedent }) {
  if (colonne.etat === 'non-etablie') {
    return (
      <p className="muted" style={{ margin: '12px 0 0' }}>
        {`Exercice précédent (${colonne.exercice}) : pas de colonne. ${colonne.motif.texte}`}
      </p>
    )
  }
  const b = colonne.bilan
  // L'écart de N−1 se dit avec ce qui le cause (`desequilibre`, `hors-classes`) ; le reste de ce qu'il dit de lui-même
  // se replie, pour que l'en-tête parle d'abord de l'exercice affiché.
  const erreurs = b.points.filter((p) => p.gravite === 'erreur')
  const aRevoir = b.points.filter((p) => p.gravite === 'attention')
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ margin: 0 }}>
        {`Exercice précédent (${colonne.exercice}) : `}
        {b.ecart === 0
          ? <span className="badge badge-ok">équilibré</span>
          : <span className="badge badge-danger">{`écart de ${euros(Math.abs(b.ecart))}`}</span>}
        {b.provisoire && <>{' '}<span className="badge badge-warning">provisoire</span></>}
        {` Actif net ${euros(b.totauxActif.net)}, passif ${euros(b.totauxPassif.total)}.`}
      </p>
      {erreurs.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 8 }}>
          {erreurs.map((p) => (
            <li key={p.code}>
              <span className={BADGE_DU_POINT.erreur.classe}>{BADGE_DU_POINT.erreur.mot}</span>{` ${p.texte}`}
            </li>
          ))}
        </ul>
      )}
      {aRevoir.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>{`Ce que le bilan de ${colonne.exercice} a encore à revoir (${aRevoir.length})`}</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 8 }}>
            {aRevoir.map((p) => (
              <li key={p.code}>
                <span className={BADGE_DU_POINT.attention.classe}>{BADGE_DU_POINT.attention.mot}</span>{` ${p.texte}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// Un solde lu, débit − crédit en centimes : son montant et son sens, ou son absence.
const soldeLu = (centimes: number) =>
  (centimes === 0 ? 'aucun solde' : `${euros(Math.abs(centimes))} ${centimes > 0 ? 'au débit' : 'au crédit'}`)

const CAUSE_DE_L_ECART: Record<CauseDeLEcart, string> = {
  'absent-de-l-ouverture': 'à la clôture seulement',
  'absent-de-la-cloture': 'à l’ouverture seulement',
  'montants-differents': 'des deux côtés, d’un montant différent',
}

// « a, b et c ». Pas de remplacement de la dernière virgule : celle d'un montant (« 2 000,00 € ») passerait pour elle.
const enumeration = (elements: string[]) =>
  (elements.length > 1 ? `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}` : elements.join(''))

// Un compte en écart : ses deux soldes, la différence, et ce que le report y réunit quand ce n'est pas lui seul.
function LigneEcartDeCompte({ e, precedent }: { e: EcartDeCompte; precedent: number }) {
  const reunis = e.report
    ? [
      ...e.report.comptes,
      ...(e.report.resultat !== null
        ? [`${e.report.resultat > 0 ? 'le bénéfice' : 'la perte'} de ${precedent} (${euros(Math.abs(e.report.resultat))})`]
        : []),
    ]
    : []
  return (
    <li>
      <span style={NUMERO}>{e.compte}</span>
      {` ${e.libelle} : ouverture ${soldeLu(e.ouverture)}, clôture de ${precedent} ${soldeLu(e.cloture)} — `}
      {`${euros(Math.abs(e.difference))} de plus ${e.difference > 0 ? 'au débit' : 'au crédit'} à l’ouverture ; `}
      {CAUSE_DE_L_ECART[e.cause]}.
      {reunis.length > 0 && (
        <span className="muted">{` À la clôture, le report y réunit ${enumeration(reunis)}.`}</span>
      )}
    </li>
  )
}

// La ligne « Ouverture » de l'en-tête. Rien sur une lecture partielle : l'écran ne va pas jusque-là (le bandeau).
function OuvertureConfrontee({ c }: { c: ConfrontationDeLOuverture }) {
  if (c.etat === 'illisible') return null
  if (c.etat === 'sans-objet') {
    return <p className="muted" style={{ margin: '12px 0 0' }}>{`Ouverture : rien à confronter. ${c.texte}`}</p>
  }
  if (c.etat === 'concordante') {
    return (
      <p style={{ margin: '12px 0 0' }}>
        {'Ouverture : '}<span className="badge badge-ok">concordante</span>{` ${c.texte} `}
        <span className="muted">{c.regle}</span>
      </p>
    )
  }
  // Les comptes en écart d'une rubrique se disent sous elle ; ceux dont la rubrique concorde — deux écarts qui s'y
  // compensent — se disent à part.
  const sousUneRubrique = new Set(c.rubriques.flatMap((r) => r.comptes))
  const aPart = c.comptes.filter((e) => !sousUneRubrique.has(e.compte))
  const ecartDe = (compte: string) => c.comptes.find((e) => e.compte === compte)!
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ margin: 0 }}>
        {'Ouverture : '}<span className="badge badge-danger">en écart</span>{` ${c.texte} `}
        <span className="muted">{c.regle}</span>
      </p>
      <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 8 }}>
        {c.rubriques.map((r) => (
          <li key={`${r.cote}-${r.id}`}>
            <strong>{r.libelle}</strong>
            {` (${r.cote}) : ouverture ${euros(r.ouverture)}, clôture de ${c.precedent} ${euros(r.cloture)} — `}
            {`${euros(Math.abs(r.difference))} de ${r.difference > 0 ? 'plus' : 'moins'} à l’ouverture.`}
            {r.comptes.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {r.comptes.map((compte) => <LigneEcartDeCompte key={compte} e={ecartDe(compte)} precedent={c.precedent} />)}
              </ul>
            )}
          </li>
        ))}
        {aPart.length > 0 && (
          <li>
            {c.rubriques.length > 0
              ? 'Dans des rubriques qui concordent, les écarts s’y compensant :'
              : 'Les rubriques concordent, les écarts s’y compensant :'}
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {aPart.map((e) => <LigneEcartDeCompte key={e.compte} e={e} precedent={c.precedent} />)}
            </ul>
          </li>
        )}
      </ul>
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
  // L'exercice précédent se calcule sur les MÊMES lectures : tout le brouillon, les à-nouveaux et les soldes reportés
  // sont déjà lus en entier, et changer d'exercice ne relit rien. Il n'existe que si l'exercice affiché a son bilan.
  const { bilan, precedent, ouvertureConfrontee } = useMemo(() => {
    if (!lectures || lectures.motifs.length > 0 || typeof annee !== 'number') {
      return { bilan: null, precedent: null, ouvertureConfrontee: null }
    }
    const entrees = {
      exercice: annee, ecritures: lectures.ecritures, categories: lectures.categories, reprise: lectures.aNouveaux,
      reportes: lectures.reportes, anneesValidees, pieces: lectures.pieces, modele, aujourdHui,
    }
    const deN = bilanDeLExercice(entrees)
    if (deN.etat !== 'etabli') return { bilan: deN, precedent: null, ouvertureConfrontee: null }
    // Les lectures sont toutes revenues entières : on n'arrive ici qu'après le contrôle des motifs.
    return {
      bilan: deN, precedent: colonneDeLExercicePrecedent(entrees), ouvertureConfrontee: confronterLOuverture(entrees, 'complete'),
    }
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
  // Le bilan de l'exercice précédent, quand sa colonne s'établit ; sinon aucun chiffre de N−1, nulle part.
  const bilanPrecedent = precedent?.etat === 'etablie' ? precedent.bilan : null
  const anneePrecedente = bilanPrecedent ? bilanPrecedent.exercice : null
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
        {ouvertureConfrontee && <OuvertureConfrontee c={ouvertureConfrontee} />}
        {precedent && <ExercicePrecedent colonne={precedent} />}
      </div>

      <div className="card" style={{ padding: 0, marginTop: 20 }}>
        <TableauActif bilan={bilan} precedent={bilanPrecedent} />
      </div>

      <div className="card" style={{ padding: 0, marginTop: 20 }}>
        <TableauPassif bilan={bilan} precedent={bilanPrecedent} />
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
        <DetailParCompte rubriques={detailDuBilan(bilan.actif, bilanPrecedent?.actif ?? null)} precedent={anneePrecedente} />
        <h4>Passif</h4>
        <DetailParCompte rubriques={detailDuBilan(bilan.passif, bilanPrecedent?.passif ?? null)} precedent={anneePrecedente} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {`Résultat de l’exercice : ${euros(bilan.resultat)}`}
          {bilanPrecedent ? ` (${bilanPrecedent.exercice} : ${euros(bilanPrecedent.resultat)})` : ''}
          {', la différence des comptes de produits (classe 7) et de charges (classe 6) de l’exercice.'}
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
          <li>Les renvois sur les échéances, à moins ou à plus d’un an, viendront avec la liasse.</li>
        </ul>
      </div>
    </>
  )
}
