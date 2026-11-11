import { calculerLigne } from './montantsFacture'
import { formatDate, formatMoney, formaterPrixUnitaire } from './format'
import { ceQueLaFactureImprime, tauxImprime, uniteImprimee } from './mentionsFigeesVue'
import { ceQueLaFactureInternationaleImprime } from './factureInternationaleVue'
import type { BlocDuPdf } from './lettresDeMissionVue'
import type { FactureEmise, FactureLigne } from './types'

// LA COPIE D'UNE FACTURE FIGÉE, EN PDF (ligne 47, LM8 ; LM8-Q3 (A) : le PDF déposé chez le client est PRODUIT par
// l'application, des seules valeurs figées de la facture). Les mêmes valeurs, dans le même ordre, que l'aperçu d'une facture
// figée (pages/dossier/FactureApercu.tsx, qui les tient de `ceQueLaFactureImprime`) : l'émetteur et son identité figée, le
// numéro de TVA que la base a écrit, le mandat, le titre et les dates, le client, les mentions de la facture électronique,
// chaque ligne et ses montants, les totaux de la facture, les conditions, le RIB confirmé, les mentions et le pied de page.
// Rien n'est relu du dossier ni donné par l'appelant ; une facture d'avant (`mentions_figees` faux) ne se tire pas d'ici.
// Le logo n'est pas repris : il se lit dans le seau des ventes et se vérifie à son empreinte (l'aperçu), et la copie déposée
// ne dépend d'aucune autre lecture que la facture et ses lignes. Mis en page par `pdfDesBlocs` (lib/pdfLettreDeMission.ts).

/** Le titre de la copie, comme l'aperçu l'imprime (« FACTURE F2026-0001 », « AVOIR A2026-0001 »). */
export function titreDeLaCopie(f: Pick<FactureEmise, 'type' | 'numero'>): string {
  return `${f.type === 'avoir' ? 'AVOIR' : 'FACTURE'} ${f.numero ?? ''}`.trim()
}

/**
 * Les blocs de la copie, tirés de la facture et de ses lignes lues EN ENTIER. `null` : la facture n'a pas figé ses mentions,
 * n'est pas validée, ou un avoir dont la facture corrigée n'a pas de numéro lu.
 */
export function contenuDeLaFactureFigee(
  f: FactureEmise, lignes: readonly FactureLigne[], numeroDeLOrigine: string | null,
): BlocDuPdf[] | null {
  const figee = ceQueLaFactureImprime(f)
  if (figee === null || f.statut !== 'validee') return null
  if (f.type === 'avoir' && (numeroDeLOrigine === null || numeroDeLOrigine.trim() === '')) return null
  const international = ceQueLaFactureInternationaleImprime(f)
  const avecUnite = lignes.some((l) => l.unite != null)
  const texte = (...parties: (string | null | undefined | false)[]) =>
    parties.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join('\n')

  const blocs: BlocDuPdf[] = [
    { genre: 'titre', texte: titreDeLaCopie(f) },
    { genre: 'texte', texte: texte(
      f.type === 'avoir' ? `En référence à la facture ${numeroDeLOrigine}` : null,
      `Émise le ${formatDate(f.date_emission)}`,
      f.date_echeance ? `Échéance le ${formatDate(f.date_echeance)}` : null,
    ) },
    { genre: 'intertitre', texte: figee.nom ?? f.emetteur_nom ?? '' },
    { genre: 'texte', texte: texte(
      f.emetteur_adresse, f.emetteur_siret ? `SIRET ${f.emetteur_siret}` : null, ...figee.identite,
      figee.numeroTva ? `N° TVA intracommunautaire ${figee.numeroTva}` : null, figee.mandat,
    ) },
    { genre: 'intertitre', texte: 'Facturé à' },
    { genre: 'texte', texte: texte(
      f.tiers_nom, f.tiers_adresse, f.tiers_siret ? `SIRET ${f.tiers_siret}` : null,
      international?.pays ? `Pays : ${international.pays}` : null,
      international?.numeroTva ? `N° TVA ${international.numeroTva}` : null,
    ) },
  ]
  if (figee.mentions.length > 0) blocs.push({ genre: 'texte', texte: figee.mentions.map((m) => `${m.libelle} : ${m.texte}`).join('\n') })
  blocs.push({ genre: 'intertitre', texte: 'Désignation' })
  for (const l of lignes) {
    const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    const detail = [
      `Qté ${l.quantite}`, avecUnite ? uniteImprimee(l) : null, `PU HT ${formaterPrixUnitaire(l.prix_unitaire_ht)}`,
      `TVA ${tauxImprime(l.taux_tva)}`, `Total HT ${formatMoney(c.montant_ht)}`, `Total TTC ${formatMoney(c.montant_ttc)}`,
    ].filter((x): x is string => x !== null && x.trim() !== '').join(' — ')
    blocs.push({ genre: 'texte', texte: texte(l.designation, l.reference ? `Réf. ${l.reference}` : null, detail) })
  }
  blocs.push({ genre: 'intertitre', texte: 'Totaux' })
  blocs.push({ genre: 'texte', texte: texte(
    `Total HT : ${formatMoney(f.montant_ht)}`, `Total TVA : ${formatMoney(f.montant_tva)}`, `Total TTC : ${formatMoney(f.montant_ttc)}`,
  ) })
  if (figee.conditions.length > 0) blocs.push({ genre: 'texte', texte: figee.conditions.join('\n') })
  if (figee.rib) {
    blocs.push({ genre: 'intertitre', texte: 'Coordonnées bancaires' })
    blocs.push({ genre: 'texte', texte: texte(
      `IBAN ${figee.rib.iban}`, figee.rib.bic ? `BIC ${figee.rib.bic}` : null,
      figee.rib.titulaire ? `Titulaire du compte : ${figee.rib.titulaire}` : null,
    ) })
  }
  for (const m of [international?.mention, f.mentions_legales, figee.complementaires, figee.piedDePage]) {
    if (m && m.trim() !== '') blocs.push({ genre: 'mention', texte: m })
  }
  return blocs.filter((b) => b.texte.trim() !== '')
}

/** L'instant qui date la copie : le jour d'émission de la facture, à midi UTC — jamais l'heure du clic (mêmes octets à chaque tirage). */
export function instantDeLaCopie(f: Pick<FactureEmise, 'date_emission'>): string {
  return `${f.date_emission}T12:00:00Z`
}
