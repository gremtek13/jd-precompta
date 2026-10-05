import { formatDate, formatMoney } from '../../lib/format'
import {
  LIBELLES_MOTIFS, ouAgir, phraseDeLEcart, type ComptePartage, type Concordance2035, type MotifEcart,
} from '../../lib/concordance2035'

// LA 2035 SE RETROUVE-T-ELLE DANS LES ÉCRITURES ? (ligne 26.6, étape c — lib/concordance2035.ts)
//
// Une carte par exercice, sous son formulaire : c'est là qu'on signe. Elle ne bloque rien — la 2035 se
// calcule depuis les sources, et un brouillon en retard n'en change pas un chiffre — mais elle dit, source par
// source, ce qui manque au FEC pour la porter, et où le corriger.
//
// Les montants sont l'EFFET SUR LE RÉSULTAT : une recette positive, une dépense négative. C'est ce qui permet
// de comparer une pièce, un mouvement et une dotation dans une même colonne sans convention par ligne.
export default function ConcordanceCard({ concordance: c, comptesPartages, lectureIncomplete, ouverture, figePar }: {
  concordance: Concordance2035
  comptesPartages: readonly ComptePartage[]
  // Non nul quand les écritures ou les entrées de la 2035 n'ont pas été lues en entier : la carte ne conclut
  // pas. « Concorde » sur une lecture partielle serait une bonne nouvelle fabriquée, et « écart » un faux
  // reproche — une source bien écrite dont l'écriture n'a pas été lue.
  lectureIncomplete: string | null
  ouverture: string | null
  // L'exercice validé qui fige celui-ci, dit avec les mots de la base (lib/validationExercice.ts, `exerciceQuiFige`) —
  // nul quand il est ouvert. Figé, ni ses sources ni ses écritures ne changent plus : un écart recalculé aujourd'hui vient
  // d'une catégorie qui a changé de compte ou de poste depuis la validation, ou du calcul, et rien ne s'y corrige plus. La
  // carte le dit, sans la liste des écarts ni leur « Où agir », qui appelleraient un geste que la base refuse.
  figePar: string | null
}) {
  const couleur = lectureIncomplete || !c.concorde ? 'var(--color-warning)' : 'var(--color-primary)'
  return (
    <div className="card" style={{ marginBottom: 20, borderLeft: `3px solid ${couleur}` }}>
      <h3 style={{ marginTop: 0 }}>Concordance avec les écritures — {c.annee}</h3>
      {lectureIncomplete ? (
        <p className="error-text" style={{ margin: 0 }}>
          Les écritures du brouillon, ou une entrée de la déclaration, n'ont pas pu être lues en entier
          ({lectureIncomplete}). La concordance ne peut pas conclure : une source dont l'écriture n'a pas été
          lue paraîtrait sans écriture. Recharge la page.
        </p>
      ) : c.anterieurALOuverture ? (
        <p className="muted" style={{ margin: 0 }}>
          Exercice antérieur à l'ouverture du dossier{ouverture ? ` (${formatDate(ouverture)})` : ''} : sa
          comptabilité est celle de l'ancien logiciel, que la balance reprise résume. Rien n'est comparé.
        </p>
      ) : (
        <>
          <p style={{ marginTop: -4 }}>
            {c.concorde
              ? 'La 2035 se retrouve dans les écritures de l’exercice, source par source et compte par compte, au centime.'
              : figePar
                ? `${figePar} : ni ses sources ni ses écritures ne changent plus. Recalculée aujourd’hui, la comparaison trouve ${c.ecarts.length} écart${c.ecarts.length > 1 ? 's' : ''} — une catégorie a changé de compte ou de poste depuis la validation, ou le calcul a évolué. Rien ne s’y corrige plus : la 2035 qui fait foi est celle qui a été validée.`
                : `${c.ecarts.length} source${c.ecarts.length > 1 ? 's' : ''} de la 2035 ne se ${c.ecarts.length > 1 ? 'retrouvent' : 'retrouve'} pas dans les écritures de l’exercice : le FEC ne porterait pas la déclaration telle qu’elle est calculée.`}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th style={{ textAlign: 'right' }}>Recettes</th>
                  <th style={{ textAlign: 'right' }}>Dépenses</th>
                  <th style={{ textAlign: 'right' }}>Résultat</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>2035</td>
                  <td style={nombre}>{formatMoney(c.declaration.recettes)}</td>
                  <td style={nombre}>{formatMoney(c.declaration.depenses)}</td>
                  <td style={nombre}>{formatMoney(c.declaration.resultat)}</td>
                </tr>
                <tr>
                  <td>Écritures de l’exercice</td>
                  <td style={nombre}>{formatMoney(c.ecritures.recettes)}</td>
                  <td style={nombre}>{formatMoney(c.ecritures.depenses)}</td>
                  <td style={nombre}>{formatMoney(c.ecritures.resultat)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {c.csgDeductible !== 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              La CSG déductible ({formatMoney(c.csgDeductible)}, case BV) n’a pas d’écriture, et ce n’est pas un
              écart : la CSG-CRDS passe entière au compte de l’exploitant (108000), hors résultat, et seule sa part
              déductible entre dans la 2035. Elle sépare les deux résultats par construction.
            </p>
          )}
          {c.ecarts.length > 0 && !figePar && <Ecarts concordance={c} />}
        </>
      )}
      {!lectureIncomplete && !c.anterieurALOuverture && !figePar && comptesPartages.length > 0 && (
        <p className="muted" style={{ marginBottom: 0 }}>
          {comptesPartages.map((p) => (
            <span key={p.compte} style={{ display: 'block' }}>
              Le compte {p.compte} porte des postes de {p.cases.length} cases différentes
              ({p.cases.map((x) => `${x.code} : ${x.postes.join(', ')}`).join(' ; ')}) : le FEC en justifie la somme,
              pas la répartition entre les cases. Donner à ces catégories des comptes distincts.
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

const nombre = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const

function Ecarts({ concordance: c }: { concordance: Concordance2035 }) {
  // Le décompte par motif d'abord : sur un brouillon en retard, la liste peut être longue, et c'est le
  // décompte qui dit par où commencer.
  const parMotif = new Map<MotifEcart, number>()
  for (const e of c.ecarts) parMotif.set(e.motif, (parMotif.get(e.motif) ?? 0) + 1)
  return (
    <>
      <p style={{ marginBottom: 8 }}>
        {[...parMotif.entries()].map(([motif, n]) => `${n} ${LIBELLES_MOTIFS[motif]}`).join(' · ')}
      </p>
      <details open={c.ecarts.length <= 10}>
        <summary>Voir les écarts ({c.ecarts.length})</summary>
        <p className="muted" style={{ marginTop: 8 }}>
          Montants en effet sur le résultat : une recette positive, une dépense négative.
        </p>
        {/* `table-empilable` : la colonne « Pourquoi » porte une phrase, et cinq colonnes comprimées dans une
            carte étroite — téléphone, 1 024 pixels, volet ouvert — coupaient les mots en leur milieu. La ligne
            s'y replie en fiche, chaque cellule précédée de son libellé (index.css). */}
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable">
            <thead>
              <tr>
                <th>Source</th>
                <th style={{ textAlign: 'right' }}>Dans la 2035</th>
                <th style={{ textAlign: 'right' }}>Dans les écritures</th>
                <th>Pourquoi</th>
                <th>Où agir</th>
              </tr>
            </thead>
            <tbody>
              {c.ecarts.map((e) => (
                <tr key={e.cle}>
                  <td>
                    <span>
                      {e.libelle || '—'}
                      {e.date && <span className="muted" style={{ display: 'block' }}>{formatDate(e.date)}</span>}
                    </span>
                  </td>
                  <td data-libelle="Dans la 2035" style={nombre}>{e.declaration === 0 ? '—' : formatMoney(e.declaration)}</td>
                  <td data-libelle="Dans les écritures" style={nombre}>{e.ecritures === 0 ? '—' : formatMoney(e.ecritures)}</td>
                  <td data-libelle="Pourquoi" className="muted">{phraseDeLEcart(e)}</td>
                  <td data-libelle="Où agir">{ouAgir(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
