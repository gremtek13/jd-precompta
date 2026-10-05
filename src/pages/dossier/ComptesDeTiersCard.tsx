import { formatDate, formatMoney } from '../../lib/format'
import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_FOURNISSEURS,
  COMPTE_FOURNISSEURS_IMMOBILISATIONS, libelleCompteTenu,
} from '../../lib/comptes'
import type { EtatPieceDuTiers, PieceDuTiers, SoldeDeTiers } from '../../lib/lettrage'

// LES COMPTES DE TIERS À UNE DATE — ligne 32 de la feuille de route (lib/lettrage.ts, `comptesDeTiers`).
//
// Ce que le lettrage laisse ouvert, fournisseur par fournisseur et client par client, et depuis quand : la balance
// âgée. Une facture et les règlements qui la soldent sont lettrés — ils reçoivent le même code dans le FEC — et ne
// figurent plus ici. Rien ne s'y saisit : le lettrage se déduit du rapprochement bancaire.
//
// La carte ne vaut qu'en engagement : en trésorerie la charge est face à la banque, et il n'y a pas de compte de
// tiers à suivre. C'est l'onglet qui décide de la montrer.

// Ce que dit un montant positif, compte par compte : les montants se lisent dans le sens normal du compte
// (`sensNormal`), créditeur pour ce qu'on doit, débiteur pour ce qu'on attend.
const SENS_POSITIF: Readonly<Record<string, string>> = {
  [COMPTE_FOURNISSEURS]: 'reste à payer',
  [COMPTE_FOURNISSEURS_IMMOBILISATIONS]: 'reste à payer',
  [COMPTE_CLIENTS]: 'reste à encaisser',
  [COMPTE_COURANT_ASSOCIE]: 'dû au dirigeant',
  [COMPTE_AUTRES_DEBITEURS_CREDITEURS]: 'dû au dirigeant',
}

const LIBELLES_ETATS: Readonly<Record<EtatPieceDuTiers, string>> = {
  ouverte: 'Sans règlement',
  payee_en_partie: 'Réglée en partie',
  payee_en_trop: 'Réglée en trop',
  // Un acompte versé avant la facture, ou une facture datée après l'arrêté.
  reglement_sans_facture: 'Règlement sans facture à cette date',
}

const TRANCHES = ['30 jours au plus', '31 à 60 jours', '61 à 90 jours', 'Plus de 90 jours'] as const

const nombre = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const

export default function ComptesDeTiersCard({
  soldes, dateArrete, finExercice, lectureIncomplete, lignesDeTiers, anterieuresALOuverture, ouverture, loading,
}: {
  soldes: readonly SoldeDeTiers[]
  // AAAA-MM-JJ : le jour au soir duquel la vue se lit.
  dateArrete: string
  // Vrai quand l'arrêté est le 31 décembre de l'exercice choisi dans l'en-tête, faux quand c'est aujourd'hui.
  finExercice: boolean
  // Non nul quand le brouillon ou les à-nouveaux n'ont pas été lus en entier : la carte ne conclut pas. Une
  // écriture non lue ferait paraître ouverte une facture réglée, ou soldé un tiers qui doit encore — et « tout est
  // soldé » sur une lecture partielle serait une bonne nouvelle fabriquée.
  lectureIncomplete: string | null
  // Le nombre de lignes, écritures et à-nouveaux, portées sur un compte de tiers jusqu'à l'arrêté : distingue
  // « tout est soldé » de « rien n'est encore écrit », que la même liste vide dirait sans lui.
  lignesDeTiers: number
  // Les lignes d'un compte de tiers antérieures à l'ouverture d'un dossier repris, quand l'arrêté la suit : leur
  // effet est déjà dans les soldes repris, et la vue les compte une seconde fois.
  anterieuresALOuverture: number
  ouverture: string | null
  loading: boolean
}) {
  const parCompte = new Map<string, SoldeDeTiers[]>()
  for (const s of soldes) parCompte.set(s.compte, [...(parCompte.get(s.compte) ?? []), s])

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Comptes de tiers au {formatDate(dateArrete)}</h3>
      <p className="muted" style={{ marginTop: -8, fontSize: '0.82rem' }}>
        Ce qui reste ouvert, fournisseur par fournisseur et client par client, et depuis quand
        {finExercice ? ' — arrêté au 31 décembre de l’exercice choisi en tête du dossier' : ' — arrêté à aujourd’hui'}.
        Une facture et les règlements qui la soldent sont lettrés, et n’y figurent plus.
      </p>
      <details className="muted" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
        <summary>Comment lire cette vue</summary>
        <p style={{ marginBottom: 0 }}>
          Le lettrage se déduit du rapprochement bancaire, rien n’est à saisir : la facture et ses règlements portent
          le même code dans le FEC (EcritureLet). La vue lit tout le brouillon d’écritures, exercices précédents et
          à-nouveaux compris : une pièce dont l’écriture n’est pas encore générée n’y est pas. La balance d’un
          exercice, au-dessus, ne compte que ses propres écritures — aucun solde n’est encore reporté d’un exercice
          sur l’autre —, si bien qu’un compte de tiers peut y porter un autre solde. Un montant se lit du côté du
          compte : ce qui reste à payer à un fournisseur, à encaisser d’un client, ce qui est dû au dirigeant ; un
          montant négatif dit l’inverse, un avoir à recevoir ou un trop-payé à rendre.
        </p>
      </details>
      {loading ? (
        <div className="skeleton skeleton-widget" style={{ height: 120 }} />
      ) : lectureIncomplete ? (
        <p className="error-text" style={{ margin: 0 }}>
          Les écritures du brouillon, ou les à-nouveaux, n’ont pas pu être lus en entier ({lectureIncomplete}). Les
          comptes de tiers ne peuvent pas être dits : une facture réglée paraîtrait ouverte, ou un tiers soldé alors
          qu’il doit encore. Recharge la page.
        </p>
      ) : (
        <>
          {anterieuresALOuverture > 0 && ouverture && (
            <p className="error-text" style={{ fontSize: '0.85rem', marginTop: 0 }}>
              {`${anterieuresALOuverture} écriture${anterieuresALOuverture > 1 ? 's' : ''} sur un compte de tiers `
                + `précède${anterieuresALOuverture > 1 ? 'nt' : ''} l’ouverture du ${formatDate(ouverture)} : leur effet `
                + 'est déjà dans les soldes repris, et cette vue le compte une seconde fois. Retire-les ou redate-les '
                + 'depuis l’onglet Écritures.'}
            </p>
          )}
          {soldes.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {lignesDeTiers === 0
                ? `Aucune facture ni aucun règlement n’est écrit sur un compte de tiers au ${formatDate(dateArrete)} — les écritures se génèrent depuis l’onglet Écritures.`
                : `Tous les comptes de tiers sont soldés au ${formatDate(dateArrete)} : chaque facture écrite l’est par ses règlements.`}
            </p>
          ) : (
            [...parCompte.entries()].map(([compte, lignes]) => (
              <SectionDuCompte key={compte} compte={compte} lignes={lignes} />
            ))
          )}
        </>
      )}
    </div>
  )
}

function SectionDuCompte({ compte, lignes }: { compte: string; lignes: readonly SoldeDeTiers[] }) {
  // Les totaux en centimes, comme la vue : sommer des euros en virgule flottante ferait afficher un total qui
  // diffère d'un centime de la somme des lignes.
  const total = lignes.reduce((t, s) => t + Math.round(s.solde * 100), 0) / 100
  const tranches = [0, 1, 2, 3].map((i) => lignes.reduce((t, s) => t + Math.round(s.tranches[i] * 100), 0) / 100)
  const pieces = lignes.flatMap((s) => s.pieces.map((p) => ({ tiers: s, piece: p })))
  return (
    <section style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 8px' }}>
        {compte} — {libelleCompteTenu(compte) ?? compte}
        <span className="muted" style={{ fontWeight: 400 }}> · {SENS_POSITIF[compte] ?? 'solde'} {formatMoney(total)}</span>
      </h4>
      {/* Largeurs fixes : les tableaux des comptes se suivent, et leurs colonnes s'alignent d'une section à l'autre au lieu
          de suivre chacune la longueur de ses noms. */}
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '14%' }} />
            {TRANCHES.map((t) => <col key={t} style={{ width: '14%' }} />)}
          </colgroup>
          <thead>
            <tr>
              <th>Tiers</th>
              <th style={{ textAlign: 'right' }}>Solde</th>
              {TRANCHES.map((t) => <th key={t} style={{ textAlign: 'right' }}>{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {lignes.map((s) => (
              <tr key={`${s.origine}|${s.auxiliaire ?? ''}|${s.libelle}`}>
                <td>
                  <span>
                    {s.libelle}
                    {s.auxiliaire && <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>{s.auxiliaire}</span>}
                  </span>
                </td>
                <td data-libelle="Solde" style={nombre}>{formatMoney(s.solde)}</td>
                {s.origine === 'tiers'
                  ? s.tranches.map((t, i) => (
                    <td key={TRANCHES[i]} data-libelle={TRANCHES[i]} style={nombre}>{t === 0 ? '—' : formatMoney(t)}</td>
                  ))
                  : (
                    <td colSpan={4} className="muted" style={{ fontSize: '0.82rem' }}>
                      {s.origine === 'ouverture'
                        ? 'Ancienneté inconnue : la balance reprise ne détaille pas ce solde par tiers.'
                        : 'Ancienneté non suivie : ces écritures n’ont pas de pièce.'}
                    </td>
                  )}
              </tr>
            ))}
          </tbody>
          {/* Un total sous une seule ligne la répéterait. `colSpan` sur l'intitulé : replié en fiche, la cellule disparaît
              (index.css) et le montant, qui porte « Total » en libellé, l'annonce seul. */}
          {lignes.length > 1 && (
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={1}>Total</td>
                <td data-libelle="Total" style={nombre}>{formatMoney(total)}</td>
                {tranches.map((t, i) => (
                  <td key={TRANCHES[i]} data-libelle={TRANCHES[i]} style={nombre}>{t === 0 ? '—' : formatMoney(t)}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pieces.length > 0 && <PiecesOuvertes pieces={pieces} />}
    </section>
  )
}

function PiecesOuvertes({ pieces }: { pieces: readonly { tiers: SoldeDeTiers; piece: PieceDuTiers }[] }) {
  return (
    <details open={pieces.length <= 10} style={{ marginTop: 8 }}>
      <summary>Pièces ouvertes ({pieces.length})</summary>
      <div className="table-scroll tableau-adaptable" style={{ marginTop: 8 }}>
        <table className="table-empilable" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '18%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Tiers</th>
              <th>Pièce</th>
              <th>Facture du</th>
              <th style={{ textAlign: 'right' }}>Facture</th>
              <th style={{ textAlign: 'right' }}>Réglé</th>
              <th style={{ textAlign: 'right' }}>Reste</th>
              <th style={{ textAlign: 'right' }}>Âge</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map(({ tiers, piece: p }) => (
              <tr key={`${tiers.auxiliaire ?? tiers.libelle}|${p.pieceId}`}>
                <td>{tiers.libelle}</td>
                <td data-libelle="Pièce">{p.libelle}</td>
                <td data-libelle="Facture du">{formatDate(p.dateFacture)}</td>
                <td data-libelle="Facture" style={nombre}>{formatMoney(p.facture)}</td>
                <td data-libelle="Réglé" style={nombre}>{formatMoney(p.regle)}</td>
                <td data-libelle="Reste" style={nombre}>{formatMoney(p.reste)}</td>
                <td data-libelle="Âge" style={nombre}>{p.age} j</td>
                <td data-libelle="État">{LIBELLES_ETATS[p.etat]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
