import { formatDate, formatMoney } from '../../lib/format'
import { formaterMontant } from '../../lib/gabarit2035'
import { LIGNES_2035E, SEUIL_ANNEXE_2035E, SEUIL_CVAE_A_PAYER, cadreMonoEtablissement } from '../../lib/declaration2035E'
import type { Annexe2035E } from '../../lib/declaration2035E'

// L'ANNEXE 2035-E SOUS LA 2035 DE CHAQUE EXERCICE (ligne 48 de la feuille de route) : si elle est due, ce qu'elle porte,
// et ce que l'application ne sait pas et suppose — dit, avec son montant, plutôt que tu. Le calcul vit dans
// lib/declaration2035E.ts ; cette carte ne fait que le montrer, et le PDF porte les mêmes lignes à l'euro.
//
// AUCUN GESTE ICI : l'annexe se remplit avec la liasse, par « Remplir le formulaire officiel ». Ce que le cabinet aurait à
// saisir (la part des loyers qui se déduit, le cadre des mono-établissements) n'a pas encore de table où vivre.
export default function Annexe2035ECard({ annexe, lectureIncomplete }: {
  annexe: Annexe2035E
  // Non nul quand l'annexe se calcule depuis une lecture partielle d'une des entrées de la 2035 (jamais pour un exercice
  // validé, tiré de ce que la base garde) : le motif.
  lectureIncomplete: string | null
}) {
  // Un montant ne se coupe pas en fin de ligne — sur téléphone, « 168 300 » restait au bout d'une ligne et « € » passait
  // à la suivante : espaces fines insécables entre les milliers, insécable avant l'euro, comme `formatMoney`, mais à
  // l'euro, comme le formulaire.
  const euros = (n: number) => `${formaterMontant(n).replace(/ /g, '\u202f')}\u00a0€`
  const ligne = (code: string) => annexe.lignes.get(code) ?? 0
  // Comme le tableau de la 2035 : les lignes qui portent un montant, et les totaux, toujours.
  const visibles = LIGNES_2035E.filter((l) => l.calculee || ligne(l.code) !== 0)
  const cadre = cadreMonoEtablissement(annexe)
  // SUR UNE LECTURE PARTIELLE, L'OBLIGATION NE SE JUGE PAS, dans un sens comme dans l'autre : une recette non lue
  // ferait dire « non due » à une annexe due, une redevance de collaboration non lue « due » à une annexe qui ne l'est
  // pas. « Non due » est une affirmation comme une autre — elle ne se dit que d'une 2035 lue en entier.
  if (lectureIncomplete !== null) {
    return (
      <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
        <strong>Annexe 2035-E — valeur ajoutée (CVAE)</strong>
        <span className="muted" style={{ marginLeft: 8 }}>obligation non jugée</span>
        <p className="error-text" style={{ margin: '8px 0 0' }}>
          Une des entrées de la 2035 n’a pas pu être lue en entier ({lectureIncomplete}) : le chiffre d’affaires qui décide
          de l’annexe — plus de {euros(SEUIL_ANNEXE_2035E)} hors taxes — ne se calcule pas sur une partie du
          dossier. L’application ne la dit ni due ni non due tant que la lecture n’est pas complète.
        </p>
      </div>
    )
  }
  return (
    <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
      <strong>Annexe 2035-E — valeur ajoutée (CVAE)</strong>
      <span className="muted" style={{ marginLeft: 8 }}>{annexe.obligatoire ? 'à déposer avec la 2035' : 'non due'}</span>
      <p style={{ margin: '8px 0' }}>
        Chiffre d’affaires au sens de la CVAE : {formatMoney(annexe.chiffreDAffaires)} — recettes nettes des débours et des
        rétrocessions (AD), moins les redevances de collaboration versées (BW), plus les gains divers (AF).
      </p>
      {/* « Non due » se dit d'une année civile entière : c'est la période de référence d'un BNC (BOI-CVAE-CHAMP-10-20 § 60).
          Une période plus courte voit son chiffre d'affaires corrigé pour correspondre à une année pleine (§ 80 à 100, écrits
          pour des exercices) : une activité cessée en cours d'année, sous le seuil sur ses quelques mois, peut le dépasser
          une fois rapportée à douze. L'application ne connaît pas les dates d'activité ; elle le dit plutôt que de le taire. */}
      {!annexe.obligatoire ? (
        <p className="muted" style={{ margin: 0 }}>
          Il ne dépasse pas {euros(SEUIL_ANNEXE_2035E)} hors taxes : l’annexe 2035-E n’est pas à remplir, et
          aucune déclaration de valeur ajoutée n’est due pour cet exercice. À revoir pour une activité cessée en cours
          d’année : le chiffre d’affaires d’une période de moins de douze mois peut se rapporter à une année pleine, et
          l’application ne connaît pas les dates d’activité.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 8px' }}>
            Il dépasse {euros(SEUIL_ANNEXE_2035E)} hors taxes : l’annexe accompagne la 2035, et « Remplir le
            formulaire officiel » la porte en page 3. Montants à l’euro, tirés des cases de la 2035 telles que le formulaire
            les imprime.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Ligne</th>
                  <th>Libellé du formulaire</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((l) => (
                  <tr key={l.code} style={l.calculee ? { fontWeight: 600 } : undefined}>
                    <td style={{ fontFamily: 'monospace' }}>{l.code}</td>
                    <td>
                      {l.libelle}
                      <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>{l.origine}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(ligne(l.code))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li>
              Loyers et locations non déduits : {euros(annexe.loyersNonDeduits)} (BF + BG − BW). Le loyer d’un bien pris en
              location pour plus de six mois, en crédit-bail ou en location-gérance ne se déduit pas de la valeur ajoutée — le
              cas du cabinet sous bail. Une location de six mois au plus se déduit en EM : à porter à la main tant que
              l’application ne la saisit pas.
            </li>
            {annexe.redevancesDeCollaboration === 0 && (
              <li>
                Aucune redevance de collaboration versée en BW : l’application ne remplit pas cette case « dont » de la
                2035, que le cabinet porte à la main. Un praticien collaborateur les retranche de son chiffre d’affaires (EF)
                et des loyers non déduits — l’annexe n’est alors peut-être plus due.
              </li>
            )}
            {annexe.forfaitKilometrique > 0 && (
              <li>
                Forfait kilométrique retiré de EO : {euros(annexe.forfaitKilometrique)}. Ce sont des frais forfaitaires de
                déplacement, que la notice exclut de la valeur ajoutée.
              </li>
            )}
            {annexe.plafonnee && (
              <li>
                Valeur ajoutée plafonnée : {euros(ligne('EX'))} dépassent {euros(annexe.plafond)}, la part du chiffre
                d’affaires au-delà de laquelle elle ne s’impose pas — JU porte le plafond.
              </li>
            )}
            <li>
              Cadre réservé aux mono-établissements, non rempli : l’application ne sait pas si le dossier n’a qu’un
              établissement au sens de la CFE, ni combien de salariés il emploie. S’il n’en a qu’un, sans salarié travaillant
              plus de trois mois hors de l’entreprise, cocher AH et porter AJ = {euros(cadre.chiffreDeReference)}, BK =
              l’effectif salarié, la période du {formatDate(cadre.du)} au {formatDate(cadre.au)} : la déclaration 1330-CVAE
              n’est alors pas à déposer. Sinon, la déposer avec JU = {euros(ligne('JU'))}.
            </li>
            <li>
              {annexe.cvae === 'nulle'
                ? `Aucune CVAE à payer : sous ${euros(SEUIL_CVAE_A_PAYER)} de chiffre d’affaires, son taux est nul — la déclaration reste due.`
                : `Chiffre d’affaires supérieur à ${euros(SEUIL_CVAE_A_PAYER)} : une CVAE peut être due, à liquider sur la déclaration 1329-DEF.`}
            </li>
            <li>
              Lignes laissées à zéro, faute de saisie : plus-values et moins-values de cession d’une activité normale et
              courante (EN, EV), variation de stock (EK), taxes sur le chiffre d’affaires (ER), amortissements de biens
              donnés en location (EU). Une sage-femme ou un garde-malade (hors maternité, maison de repos ou de soins) est
              exonéré de CFE et de CVAE de plein droit.
            </li>
          </ul>
          {annexe.incoherences.map((i) => (
            <p key={i.code} className="error-text" style={{ margin: '4px 0 0' }}>{i.raison}</p>
          ))}
        </>
      )}
    </div>
  )
}
