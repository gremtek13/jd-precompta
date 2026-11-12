import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DecisionLue, LueDeLAffectation } from './affectationEcran'
import {
  PIED_DU_PROCES_VERBAL, chiffresDuDocument, cheminDuProcesVerbal, confirmationDuDepot, contenuDuProcesVerbal, montantDuDocument,
  nomDuFichierDuDocument, pdfDuProcesVerbal, refusDeJoindre, titreDuDocument,
} from './procesVerbalDAffectation'
import { FIGEE_DE_TEST, IDENTITE_DE_TEST } from '../test/affectation'

// LE PROCÈS-VERBAL D'AFFECTATION (ligne 45, AFF5) : le contenu des quatre organes tiré des seules valeurs figées, les blancs
// de ce que l'application ne sait pas, le PDF relu par pdf.js, et les refus du dépôt aux mots de `joindre_document_affectation`.
// Données FICTIVES : une SARL au capital de 10 000 €, réserve légale 800 €, bénéfice 2026 de 30 000 €.

const decision = (d: Partial<DecisionLue> = {}): DecisionLue => ({
  id: 'a1', version: 2, etat: 'en_vigueur', organe: 'assemblee', nombreDAssocies: 'plusieurs', dateDecision: '2027-05-15',
  comptesApprouves: true, dateMiseEnPaiement: '2027-06-15', reservesStatutairesDistribuables: true, finLe: null,
  figee: FIGEE_DE_TEST, document: null,
  lignes: [
    { origine: 'benefice', destination: 'reserve_legale', centimes: 20_000 },
    { origine: 'benefice', destination: 'dividendes', centimes: 2_000_000 },
    { origine: 'benefice', destination: 'report_crediteur', centimes: 980_000 },
  ],
  ...d,
})
const texteDe = (d: DecisionLue) => contenuDuProcesVerbal({ annee: 2026, identite: IDENTITE_DE_TEST, decision: d }).map((b) => b.texte).join('\n')

describe('le contenu du document', () => {
  it('l’assemblée : titre, identité, comptes figés, trois résolutions, votes en blanc, art. 243 bis, pied', () => {
    const t = texteDe(decision())
    expect(t).toContain('Procès-verbal de l’assemblée générale ordinaire')
    expect(t).toContain('Société Fictive')
    expect(t).toContain('au capital de 10 000,00 €')
    expect(t).toContain('RCS Paris 123456789')
    expect(t).toContain('Le 15/05/2027, à ______ heures')
    expect(t).toContain('Associés présents ou représentés (identité, nombre de parts) : ______')
    // Les chiffres sont ceux que la base a figés : capitaux propres avant = 10 000 + 800 + 30 000 ; après, moins 20 000 de dividendes.
    expect(t).toContain('Résultat de l’exercice clos le 31/12/2026 : un bénéfice de 30 000,00 €.')
    expect(t).toContain('Capitaux propres avant affectation : 40 800,00 €.')
    expect(t).toContain('Capitaux propres après affectation : 20 800,00 €.')
    expect(t).toContain('L’assemblée approuve les comptes annuels')
    expect(t).toContain('– prélevé sur le bénéfice : 200,00 € à la réserve légale')
    expect(t).toContain('– prélevé sur le bénéfice : 20 000,00 € aux dividendes')
    expect(t).toContain('– prélevé sur le bénéfice : 9 800,00 € au report à nouveau créditeur')
    expect(t).toContain('Le dividende total s’élève à 20 000,00 €. Sa mise en paiement interviendra le 15/06/2027.')
    expect(t).toContain('article 243 bis du code général des impôts')
    expect(t).toContain('Troisième résolution — pouvoirs')
    expect(t.match(/Résultat du vote/g)).toHaveLength(3)
    expect(t).toContain(PIED_DU_PROCES_VERBAL)
  })

  it('la consultation écrite : les réponses annexées, les votes ; l’acte unanime : aucun vote, chaque associé signe', () => {
    const consultation = texteDe(decision({ organe: 'consultation_ecrite' }))
    expect(consultation).toContain('Procès-verbal de la consultation écrite des associés')
    expect(consultation).toContain('La réponse de chaque associé est annexée au présent procès-verbal.')
    expect(consultation).toContain('Les associés approuvent les comptes')
    expect(consultation.match(/Résultat du vote/g)).toHaveLength(3)
    const acte = texteDe(decision({ organe: 'acte_unanime' }))
    expect(acte).toContain('Acte constatant les décisions unanimes des associés')
    expect(acte).not.toContain('Résultat du vote')
    expect(acte).toContain('Chacun des associés : ______')
  })

  it('l’associé unique : des décisions, le registre, la mention de L223-31 pour une SARL (AFF-Q12), aucun vote', () => {
    const t = texteDe(decision({ organe: 'associe_unique', nombreDAssocies: 'un' }))
    expect(t).toContain('Décision de l’associé unique')
    expect(t).toContain('Première décision — approbation des comptes')
    expect(t).toContain('L’associé unique approuve les comptes')
    expect(t).toContain('de la présente décision')
    expect(t).toContain('registre des décisions de l’associé unique')
    expect(t).toContain('L223-31')
    expect(t).not.toContain('Résultat du vote')
    // Une SAS unipersonnelle (5720) : le registre, pas L223-31.
    const sasu = texteDe(decision({ organe: 'associe_unique', nombreDAssocies: 'un', figee: { ...FIGEE_DE_TEST, formeJuridique: '5720' } }))
    expect(sasu).toContain('registre des décisions')
    expect(sasu).not.toContain('L223-31')
  })

  it('des comptes non approuvés : aucune affectation, le résultat en attente, deux résolutions', () => {
    const t = texteDe(decision({ comptesApprouves: false, dateMiseEnPaiement: null, lignes: [] }))
    expect(t).toContain('ne sont pas approuvés. Aucune affectation n’est décidée')
    expect(t).not.toContain('résolution — affectation du résultat')
    expect(t).not.toContain('243 bis')
    expect(t).toContain('Deuxième résolution — pouvoirs')
    expect(chiffresDuDocument(decision({ comptesApprouves: false })).dividendes).toBe(0)
  })

  it('une perte, sans dividende ni date de mise en paiement : dite, et l’identité absente reste en blanc', () => {
    const perte = decision({
      figee: { ...FIGEE_DE_TEST, resultatCentimes: -123_456 }, dateMiseEnPaiement: null,
      lignes: [{ origine: 'perte', destination: 'report_debiteur', centimes: 123_456 }],
    })
    const t = contenuDuProcesVerbal({ annee: 2026, identite: { denomination: 'X', siret: null, adresse: null, rcsVille: null }, decision: perte })
      .map((b) => b.texte).join('\n')
    expect(t).toContain('une perte de 1 234,56 €')
    expect(t).toContain('prélevé sur la perte : 1 234,56 € au report à nouveau débiteur')
    expect(t).toContain('Siège : ______')
    expect(t).toContain('RCS : ______')
    expect(t).not.toContain('dividende total')
  })

  it('les montants en entiers, espaces ordinaires (jamais Intl) ; les noms et le chemin', () => {
    expect(montantDuDocument(0)).toBe('0,00 €')
    expect(montantDuDocument(5)).toBe('0,05 €')
    expect(montantDuDocument(123_456_789)).toBe('1 234 567,89 €')
    expect(montantDuDocument(-100)).toBe('-1,00 €')
    expect(nomDuFichierDuDocument(2026, decision())).toBe('proces-verbal-affectation-2026-version-2.pdf')
    expect(nomDuFichierDuDocument(2026, decision({ organe: 'associe_unique' }))).toBe('decision-associe-unique-affectation-2026-version-2.pdf')
    expect(cheminDuProcesVerbal('d1', 'a1')).toBe('d1/affectations/a1.pdf')
    expect(titreDuDocument('consultation_ecrite')).toContain('consultation écrite')
  })
})

describe('le PDF', () => {
  it('se relit : titre, montants et pied ; deux tirages de la même version rendent les mêmes octets', async () => {
    const e = { annee: 2026, identite: IDENTITE_DE_TEST, decision: decision() }
    const [a, b] = await Promise.all([pdfDuProcesVerbal(e), pdfDuProcesVerbal(e)])
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    const doc = await pdfjs.getDocument({ data: a.slice(0) }).promise
    let texte = ''
    for (let n = 1; n <= doc.numPages; n++) {
      texte += (await (await doc.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ') + ' '
    }
    expect(texte).toContain('Procès-verbal de l’assemblée générale ordinaire')
    expect(texte).toContain('30 000,00 €')
    expect(texte).toContain('20 800,00 €')
    expect(texte).toContain('Projet préparé par le cabinet')
  })
})

describe('joindre le document signé', () => {
  const lue = (anneesValidees: number[]) => ({ anneesValidees } as Pick<LueDeLAffectation, 'anneesValidees'> as LueDeLAffectation)
  it('refusé avant le clic aux mots de la base : version qui n’est plus en vigueur, document déjà joint, exercice validé', () => {
    expect(refusDeJoindre(lue([2026]), decision())).toBeNull()
    expect(refusDeJoindre(lue([2026]), decision({ etat: 'remplacee' }))).toBe('Seule la décision en vigueur reçoit son document signé.')
    expect(refusDeJoindre(lue([2026]), decision({ document: { chemin: 'd1/affectations/a1.pdf', empreinte: 'a'.repeat(64) } })))
      .toBe('Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.')
    expect(refusDeJoindre(lue([2026, 2027]), decision()))
      .toBe('L’exercice qui contient le 15/05/2027 est validé : une écriture n’y entre plus.')
  })

  it('la confirmation nomme le fichier, son poids, son empreinte, la version et ce qui ne se défait pas', () => {
    const c = confirmationDuDepot(2026, decision(), { nom: 'pv.pdf', poids: '12,3 Ko', empreinte: 'f'.repeat(64) })
    expect(c).toContain('« pv.pdf » (12,3 Ko')
    expect(c).toContain('f'.repeat(64))
    expect(c).toContain('version 2 du 15/05/2027 sur l’exercice 2026')
    expect(c).toContain('Il ne se remplace pas')
  })
})
