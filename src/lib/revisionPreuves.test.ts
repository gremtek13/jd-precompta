import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLES_DE_FAITS, instantaneDeLaPreuve, lireInstantaneDePreuve, octetsJsonb, preuveDuCompte, preuveSuffisanteSeule,
  soldeEnMots, texteJsonb, TEXTES_DES_PREUVES, TYPES_DE_PREUVE, typeDePreuveDuCompte, type DonneesDesPreuves,
  type InstantaneDePreuve, type PreuveProposee,
} from './revisionPreuves'
import { TAILLE_MAX_PREUVE_APPLICATION } from './revisionSoldes'
import {
  aNouveau, bien, controleReleve, declaration, documentDivers, donnees, ecriture, ecritureEquilibree, emprunt, ligne,
  MARQUE_SAISIE, nature, piece, soldeReporte,
} from '../test/revision'

const preuve = (compte: string, solde: number, d: Partial<DonneesDesPreuves>): PreuveProposee => preuveDuCompte(compte, solde, donnees(d))
const cles = (p: PreuveProposee) => p.faits.map((f) => f.cle)
const faitDe = (p: PreuveProposee, cle: string) => p.faits.find((f) => f.cle === cle)

describe('la preuve de chaque compte (conception, § 3.6)', () => {
  it('range chaque compte sous sa preuve, et laisse les autres sans preuve', () => {
    const attendus: [string, string][] = [
      ['512000', 'releve'], ['580000', 'virements-internes'], ['218300', 'registre-valeurs'], ['205000', 'registre-valeurs'],
      ['281830', 'registre-amortissements'], ['280500', 'registre-amortissements'], ['2818311', 'registre-amortissements'],
      ['164000', 'echeancier'], ['445510', 'declarations-tva'], ['445670', 'declarations-tva'], ['445830', 'declarations-tva'],
      ['445710', 'declarations-tva'], ['445660', 'declarations-tva'], ['445620', 'declarations-tva'], ['101000', 'ouverture'],
      ['108000', 'decomposition-exploitant'],
      ['275000', 'aucune'], ['455000', 'aucune'], ['467000', 'aucune'], ['165000', 'aucune'], ['401000', 'aucune'],
      ['444000', 'aucune'], ['512100', 'aucune'], ['221000', 'aucune'], ['231000', 'aucune'], ['120000', 'aucune'], ['290000', 'aucune'],
    ]
    for (const [compte, type] of attendus) expect(typeDePreuveDuCompte(compte), compte).toBe(type)
  })

  it('dit ce que chaque preuve établit et n’établit pas', () => {
    for (const type of TYPES_DE_PREUVE) {
      expect(TEXTES_DES_PREUVES[type].etablit.length, type).toBeGreaterThan(20)
      expect(TEXTES_DES_PREUVES[type].netablitPas.length, type).toBeGreaterThan(20)
    }
    // Ce que la conception range dans « n'établit pas » se dit (§ 3.6) — et ce que la relecture y a ajouté.
    expect(TEXTES_DES_PREUVES.releve.netablitPas).toContain('aucun compte bancaire ne manque')
    expect(TEXTES_DES_PREUVES['declarations-tva'].netablitPas).toContain('exigibilité')
  })

  it('un compte sans preuve : rien d’attendu, et le dire', () => {
    const p = preuve('275000', 150000, {})
    expect(p).toMatchObject({ type: 'aucune', compte: '275000', annee: 2025, verdict: 'sans-preuve', attenduCentimes: null, ecartCentimes: null, faits: [], detail: [], sourcesProposees: [] })
    expect(p.resume).toBe('Aucune preuve de l’application.')
    expect(preuveSuffisanteSeule(p)).toBe(false)
  })

  it('écrit un solde en mots, débit et crédit', () => {
    expect(soldeEnMots(0)).toBe('nul')
    expect(soldeEnMots(103425)).toMatch(/^1\s034,25\s€ au débit$/)
    expect(soldeEnMots(-1234)).toMatch(/^12,34\s€ au crédit$/)
  })
})

// ── Le relevé au 31 décembre ──────────────────────────────────────────────────────────────────────────────────────

describe('le relevé au 31 décembre (512000)', () => {
  const decembre = controleReleve({
    id: 'c-dec', source_fichier: 'releve-12.pdf', periode_debut: '2025-11-30', periode_fin: '2025-12-31', solde_initial: 1000,
    solde_final: 1034.25, somme_mouvements: 34.25,
  })
  const mouvementsDeDecembre = [
    ligne({ id: 'l1', date: '2025-12-05', montant: 100, source_fichier: 'releve-12.pdf' }),
    ligne({ id: 'l2', date: '2025-12-20', montant: -65.75, source_fichier: 'releve-12.pdf' }),
  ]

  it('un relevé qui finit le 31 décembre et boucle : son solde final, comparé au 512', () => {
    const p = preuve('512000', 103425, { controlesReleves: [decembre], lignes: mouvementsDeDecembre })
    expect(p.verdict).toBe('concorde')
    expect(p.attenduCentimes).toBe(103425)
    expect(p.ecartCentimes).toBe(0)
    expect(p.detail).toEqual([{ libelle: 'Relevé du 30/11/2025 au 31/12/2025 : solde au 31/12/2025', montantCentimes: 103425, reference: { type: 'releve', id: 'c-dec' } }])
    expect(p.faits).toEqual([])
    expect(preuveSuffisanteSeule(p)).toBe(true)
    expect(p.resume).toMatch(/^Relevé au 31\/12\/2025 : 1\s034,25\s€ au débit, comme le compte\.$/)
  })

  it('un écart, signé comme le solde : le 512 moins le relevé', () => {
    const p = preuve('512000', 100000, { controlesReleves: [decembre], lignes: mouvementsDeDecembre })
    expect(p.verdict).toBe('ecart')
    expect(p.ecartCentimes).toBe(-3425)
    expect(preuveSuffisanteSeule(p)).toBe(false)
    expect(p.resume).toMatch(/^Relevé au 31\/12\/2025 : 1\s034,25\s€ au débit attendu, le compte 1\s000,00\s€ au débit — écart de 34,25\s€\.$/)
  })

  it('au centime : un centime d’écart est un écart', () => {
    expect(preuve('512000', 103424, { controlesReleves: [decembre], lignes: mouvementsDeDecembre })).toMatchObject({ verdict: 'ecart', ecartCentimes: -1 })
    expect(preuve('512000', 103426, { controlesReleves: [decembre], lignes: mouvementsDeDecembre })).toMatchObject({ verdict: 'ecart', ecartCentimes: 1 })
  })

  it('propose le relevé bancaire déposé sous le nom du relevé importé, sans le citer, et rien d’autre', () => {
    const p = preuve('512000', 103425, {
      controlesReleves: [decembre], lignes: mouvementsDeDecembre,
      documents: [
        documentDivers({ id: 'doc-dec', nom_fichier: 'releve-12.pdf', categorie: 'releve_bancaire' }),
        // Même nom, mais ce n'est pas un relevé : l'onglet Banque n'importe que des relevés bancaires.
        documentDivers({ id: 'doc-homonyme', nom_fichier: 'releve-12.pdf', categorie: 'autre' }),
        documentDivers({ id: 'doc-autre', categorie: 'releve_bancaire' }),
      ],
    })
    expect(p.sourcesProposees).toEqual([{ pieceId: null, documentId: 'doc-dec', raison: 'Le relevé bancaire déposé sous le nom du relevé du 30/11/2025 au 31/12/2025.' }])
    expect(JSON.stringify(p)).not.toContain('releve-12.pdf')
  })

  it('faute de relevé qui finit le 31 décembre, celui qui le couvre : son solde initial et ses mouvements jusqu’au 31', () => {
    const chevauche = controleReleve({
      id: 'c-chev', source_fichier: 'releve-chev.pdf', periode_debut: '2025-12-15', periode_fin: '2026-01-14', solde_initial: 500,
      solde_final: 1549, somme_mouvements: 1049,
    })
    const lignes = [
      ligne({ id: 'm1', date: '2025-12-20', montant: 100, source_fichier: 'releve-chev.pdf' }),
      ligne({ id: 'm2', date: '2025-12-31', montant: -50, source_fichier: 'releve-chev.pdf' }),
      ligne({ id: 'm3', date: '2026-01-05', montant: 999, source_fichier: 'releve-chev.pdf' }),
      ligne({ id: 'm4', date: '2025-12-21', montant: 7, source_fichier: 'un-autre.pdf' }),
    ]
    const p = preuve('512000', 55000, { controlesReleves: [chevauche], lignes })
    expect(p.verdict).toBe('concorde')
    expect(p.attenduCentimes).toBe(55000)
  })

  it('un relevé qui commence le 1er janvier suivant : son solde initial est celui de la fin du 31 décembre', () => {
    const janvier = controleReleve({ id: 'c-jan', source_fichier: null, periode_debut: '2026-01-01', periode_fin: '2026-01-31', solde_initial: 1034.25, solde_final: 2000, somme_mouvements: 965.75 })
    const p = preuve('512000', 103425, { controlesReleves: [janvier] })
    expect(p.verdict).toBe('concorde')
    expect(p.detail).toEqual([{ libelle: 'Relevé du 01/01/2026 au 31/01/2026 : solde au 31/12/2025', montantCentimes: 103425, reference: { type: 'releve', id: 'c-jan' } }])
    // Ni ses mouvements ni son nom de fichier ne comptent : il n'en a aucun avant le 1er janvier.
    expect(p.faits).toEqual([])
    // Un relevé qui commence le 2 janvier ne dit pas, lui, le solde de la fin du 31 décembre.
    expect(preuve('512000', 103425, { controlesReleves: [{ ...janvier, periode_debut: '2026-01-02' }] })).toMatchObject({ verdict: 'incomplete', attenduCentimes: null })
  })

  it('un relevé qui commence le 31 décembre : ses mouvements de ce jour comptent', () => {
    const p = preuve('512000', 99000, {
      controlesReleves: [controleReleve({ source_fichier: 'r.pdf', periode_debut: '2025-12-31', periode_fin: '2026-01-31', solde_initial: 1000, solde_final: 1010, somme_mouvements: 0 })],
      lignes: [ligne({ date: '2025-12-31', montant: -10, source_fichier: 'r.pdf' }), ligne({ date: '2026-01-02', montant: 10, source_fichier: 'r.pdf' })],
    })
    expect(p).toMatchObject({ verdict: 'concorde', attenduCentimes: 99000 })
  })

  it('un relevé qui couvre le 31 décembre mais dont les mouvements ne font plus la somme contrôlée : rien ne se calcule', () => {
    const chevauche = controleReleve({
      id: 'c-chev', source_fichier: 'releve-chev.pdf', periode_debut: '2025-12-15', periode_fin: '2026-01-14', solde_initial: 500,
      solde_final: 1549, somme_mouvements: 1049,
    })
    const p = preuve('512000', 55000, { controlesReleves: [chevauche], lignes: [ligne({ date: '2025-12-20', montant: 100, source_fichier: 'releve-chev.pdf' })] })
    expect(p.verdict).toBe('incomplete')
    // Sans solde au 31 décembre, les causes possibles se disent encore : ce premier relevé part de 500 €, le 512 de zéro.
    expect(cles(p)).toEqual(['mouvements-modifies', 'ouverture-absente'])
    expect(p.attenduCentimes).toBeNull()
  })

  it('un relevé qui couvre le 31 décembre et ne boucle pas ne prouve rien non plus', () => {
    const chevauche = controleReleve({
      id: 'c-chev', source_fichier: 'releve-chev.pdf', periode_debut: '2025-12-15', periode_fin: '2026-01-14', solde_initial: 500,
      solde_final: 1549, somme_mouvements: 1049, coherent: false, ecart: 2,
    })
    const p = preuve('512000', 154900, { controlesReleves: [chevauche], lignes: [ligne({ date: '2025-12-20', montant: 1049, source_fichier: 'releve-chev.pdf' })] })
    expect(p.verdict).toBe('incomplete')
    expect(p.attenduCentimes).toBeNull()
    expect(p.faits).toEqual([expect.objectContaining({ cle: 'releve-ne-boucle-pas', montantCentimes: 200 }), expect.objectContaining({ cle: 'ouverture-absente' })])
  })

  it('quand le relevé du 31 décembre boucle, un relevé qui couvre ce jour n’est pas regardé', () => {
    const chevauche = controleReleve({ id: 'c-chev', periode_debut: '2025-12-15', periode_fin: '2026-01-14', coherent: false, ecart: 2 })
    const p = preuve('512000', 103425, { controlesReleves: [decembre, chevauche], lignes: mouvementsDeDecembre })
    expect(p.verdict).toBe('concorde')
    expect(p.faits).toEqual([])
    // Même quand il boucle : le relevé qui finit le 31 décembre l'emporte, il n'y a pas deux relevés à départager.
    const janvier = controleReleve({ id: 'c-jan', source_fichier: null, periode_debut: '2026-01-01', periode_fin: '2026-01-31', solde_initial: 1034.25 })
    expect(preuve('512000', 103425, { controlesReleves: [decembre, janvier], lignes: mouvementsDeDecembre })).toMatchObject({ verdict: 'concorde', faits: [] })
  })

  it('chaque relevé qui ne boucle pas se dit, avec son écart', () => {
    const second = controleReleve({ id: 'c-2', periode_debut: '2025-12-01', coherent: false, ecart: -3 })
    const p = preuve('512000', 103425, { controlesReleves: [{ ...decembre, coherent: false, ecart: 1 }, second] })
    expect(p.faits.filter((f) => f.cle === 'releve-ne-boucle-pas').map((f) => f.montantCentimes)).toEqual([100, -300])
  })

  it('un relevé qui couvre le 31 décembre sans nom de fichier : ses mouvements ne se retrouvent pas', () => {
    const p = preuve('512000', 0, { controlesReleves: [controleReleve({ source_fichier: null, periode_debut: '2025-12-15', periode_fin: '2026-01-14' })] })
    expect(p.verdict).toBe('incomplete')
    expect(cles(p)).toEqual(['releve-sans-fichier'])
  })

  it('un relevé qui finit le 31 décembre dont les mouvements ont changé : son solde final vaut toujours, et le fait se dit', () => {
    const p = preuve('512000', 103425, { controlesReleves: [decembre], lignes: [mouvementsDeDecembre[0]] })
    expect(p.verdict).toBe('concorde')
    expect(cles(p)).toEqual(['mouvements-modifies'])
    // Sans nom de fichier, ses mouvements ne se cherchent pas : rien à en dire.
    expect(preuve('512000', 103425, { controlesReleves: [{ ...decembre, source_fichier: null }] }).faits).toEqual([])
  })

  it('un relevé qui ne boucle pas ne prouve rien, et se dit avec son écart', () => {
    const p = preuve('512000', 103425, { controlesReleves: [{ ...decembre, coherent: false, ecart: 53.59 }] })
    expect(p.verdict).toBe('incomplete')
    expect(faitDe(p, 'releve-ne-boucle-pas')?.montantCentimes).toBe(5359)
    expect(p.resume).toBe('Relevé au 31/12/2025 : aucun relevé qui boucle ne donne le solde au 31/12/2025.')
  })

  it('celui du 31 décembre ne boucle pas : celui qui couvre le 31 le remplace, et le premier se dit', () => {
    const chevauche = controleReleve({
      id: 'c-chev', source_fichier: 'releve-chev.pdf', periode_debut: '2025-12-31', periode_fin: '2026-01-31', solde_initial: 1034.25,
      solde_final: 1034.25, somme_mouvements: 0,
    })
    const p = preuve('512000', 103425, { controlesReleves: [{ ...decembre, coherent: false, ecart: 1 }, chevauche] })
    expect(p.verdict).toBe('concorde')
    expect(cles(p)).toEqual(['releve-ne-boucle-pas'])
  })

  it('aucun relevé ne finit le 31 décembre ni ne couvre la fin de ce jour : la preuve n’a pas de solde de banque', () => {
    const fevrier = controleReleve({ periode_debut: '2026-02-01', periode_fin: '2026-02-28' })
    const p = preuve('512000', 103425, { controlesReleves: [fevrier] })
    expect(p.verdict).toBe('incomplete')
    expect(cles(p)).toEqual(['aucun-releve'])
  })

  // DEUX RELEVÉS AU 31 DÉCEMBRE NE S'ADDITIONNENT PAS : rien ne dit s'ils sont de deux comptes ou du même — le mensuel et
  // l'annuel d'un même compte finissent tous deux le 31, et leur somme tomberait juste sur un 512 compté deux fois.
  it('plusieurs relevés au 31 décembre se montrent un à un, avec leur somme, et la preuve ne conclut pas', () => {
    const second = controleReleve({ id: 'c-2', source_fichier: 'second.pdf', periode_debut: '2025-12-01', solde_initial: 10, solde_final: 20, somme_mouvements: 10 })
    const p = preuve('512000', 105425, {
      controlesReleves: [decembre, second], lignes: [...mouvementsDeDecembre, ligne({ montant: 10, source_fichier: 'second.pdf' })],
    })
    expect(p.verdict).toBe('incomplete')
    expect(p.attenduCentimes).toBeNull()
    expect(p.ecartCentimes).toBeNull()
    expect(preuveSuffisanteSeule(p)).toBe(false)
    expect(p.detail.map((l) => [l.reference?.id, l.montantCentimes])).toEqual([['c-dec', 103425], ['c-2', 2000]])
    expect(faitDe(p, 'plusieurs-releves')).toMatchObject({ nombre: 2, montantCentimes: 105425 })
    expect(faitDe(p, 'plusieurs-releves')?.texte).toMatch(/^2 relevés donnent un solde au 31\/12\/2025, 1\s054,25\s€ au débit à eux tous : la preuve ne sait pas s’ils sont de comptes différents, que le 512000 réunit, ou du même compte\.$/)
    expect(p.resume).toBe('Relevé au 31/12/2025 : 2 relevés donnent un solde au 31/12/2025 : un seul compte, ou plusieurs ?')
  })

  it('le mensuel et l’annuel d’un même compte : leur somme ferait un faux accord, la preuve n’en conclut rien', () => {
    const annuel = controleReleve({ id: 'c-an', source_fichier: 'annuel.pdf', periode_debut: '2025-01-01', periode_fin: '2025-12-31', solde_initial: 0, solde_final: 1034.25, somme_mouvements: 1034.25 })
    // Le 512 vaut DEUX FOIS le solde : la somme des deux relevés tomberait juste.
    const p = preuve('512000', 206850, { controlesReleves: [decembre, annuel], lignes: mouvementsDeDecembre })
    expect(p.verdict).toBe('incomplete')
    expect(faitDe(p, 'plusieurs-releves')?.montantCentimes).toBe(206850)
  })

  it('deux relevés qui couvrent le 31 décembre ne s’additionnent pas non plus', () => {
    const a = controleReleve({ id: 'c-a', source_fichier: null, periode_debut: '2026-01-01', periode_fin: '2026-01-31', solde_initial: 5 })
    const b = controleReleve({ id: 'c-b', source_fichier: null, periode_debut: '2026-01-01', periode_fin: '2026-01-31', solde_initial: 7 })
    expect(preuve('512000', 1200, { controlesReleves: [a, b] })).toMatchObject({ verdict: 'incomplete', attenduCentimes: null })
  })

  describe('les causes possibles d’un écart, sans en choisir une', () => {
    const premier = controleReleve({ id: 'c-jan', source_fichier: 'releve-01.pdf', periode_debut: '2025-01-01', periode_fin: '2025-01-31', solde_initial: 2000, solde_final: 2000 })

    it('l’écart est exactement le solde initial du premier relevé : l’exercice n’a pas d’ouverture', () => {
      const p = preuve('512000', 103425 - 200000, { controlesReleves: [premier, decembre], lignes: mouvementsDeDecembre })
      expect(p.ecartCentimes).toBe(-200000)
      const f = faitDe(p, 'ecart-egal-solde-initial')
      expect(f?.montantCentimes).toBe(200000)
      expect(f?.texte).toMatch(/^L’écart est exactement le solde initial du premier relevé du dossier \(2\s000,00\s€ au débit au 01\/01\/2025\) : l’exercice n’a pas d’ouverture sur le 512000, qui part de zéro\.$/)
      expect(cles(p)).not.toContain('ouverture-absente')
    })

    it('ou l’ouverture du dossier ne le porte pas', () => {
      const p = preuve('512000', 103425 - 200000, {
        controlesReleves: [premier, decembre], lignes: mouvementsDeDecembre,
        reprise: [aNouveau({ date: '2025-01-01', compte: '512000', montant: 5 })],
      })
      expect(faitDe(p, 'ecart-egal-solde-initial')?.texte).toContain('l’ouverture du dossier ne le porte pas.')
    })

    it('le premier relevé est celui de la tenue : un relevé plus ancien que la reprise est dans les comptes repris', () => {
      const ancien = controleReleve({ id: 'c-ancien', periode_debut: '2024-12-01', periode_fin: '2024-12-31', solde_initial: 999, solde_final: 999 })
      const p = preuve('512000', 103425 - 200000, {
        controlesReleves: [ancien, premier, decembre], lignes: mouvementsDeDecembre,
        reprise: [aNouveau({ date: '2025-01-01', compte: '101000', sens: 'credit', montant: 1 })],
      })
      expect(faitDe(p, 'ecart-egal-solde-initial')?.montantCentimes).toBe(200000)
      expect(cles(p)).not.toContain('ouverture-absente')
    })

    it('un relevé qui finit le jour de la reprise est encore dans les comptes repris : son solde de clôture est l’ouverture', () => {
      const cloture = controleReleve({ id: 'c-dec24', periode_debut: '2024-12-01', periode_fin: '2025-01-01', solde_initial: 999, solde_final: 2000 })
      const p = preuve('512000', 103425 - 200000, {
        controlesReleves: [cloture, premier, decembre], lignes: mouvementsDeDecembre,
        reprise: [aNouveau({ date: '2025-01-01', compte: '101000', sens: 'credit', montant: 1 })],
      })
      expect(faitDe(p, 'ecart-egal-solde-initial')?.montantCentimes).toBe(200000)
      expect(cles(p)).not.toContain('ouverture-absente')
    })

    it('avec une ouverture, un écart d’un autre montant ne dit pas qu’elle manque', () => {
      const p = preuve('512000', 1, {
        controlesReleves: [premier, decembre], lignes: mouvementsDeDecembre,
        reprise: [aNouveau({ date: '2025-01-01', compte: '512000', montant: 5 })],
      })
      expect(p.verdict).toBe('ecart')
      expect(cles(p)).not.toContain('ouverture-absente')
      expect(cles(p)).not.toContain('ecart-egal-solde-initial')
    })

    it('un premier relevé qui part de zéro n’explique rien : aucune ouverture ne lui manque', () => {
      const annuel = controleReleve({ id: 'c-an', periode_debut: '2025-01-01', periode_fin: '2025-12-31', solde_initial: 0, solde_final: 50, somme_mouvements: 50 })
      const p = preuve('512000', 4000, { controlesReleves: [annuel] })
      expect(p.verdict).toBe('ecart')
      expect(cles(p)).not.toContain('ouverture-absente')
      expect(cles(p)).not.toContain('ecart-egal-solde-initial')
    })

    it('sans ouverture, un écart d’un autre montant se dit encore', () => {
      const p = preuve('512000', 1, { controlesReleves: [premier, decembre], lignes: mouvementsDeDecembre })
      expect(faitDe(p, 'ouverture-absente')).toMatchObject({ montantCentimes: 200000 })
      expect(faitDe(p, 'ouverture-absente')?.texte).toMatch(/^L’exercice n’a pas d’ouverture sur le 512000, et le premier relevé du dossier commence à 2\s000,00\s€ au débit : sans balance reprise, le 512000 part de zéro\.$/)
      expect(cles(p)).not.toContain('ecart-egal-solde-initial')
    })

    it('les mouvements ignorés, à traiter, et les écritures du 512 sans mouvement, depuis la reprise jusqu’au 31 décembre', () => {
      const lignes = [
        ...mouvementsDeDecembre,
        ligne({ id: 'i1', date: '2025-06-01', montant: -40, statut: 'ignoree' }),
        ligne({ id: 'i2', date: '2025-07-01', montant: 15, statut: 'ignoree' }),
        ligne({ id: 'i3', date: '2025-07-02', montant: -500, statut: 'ignoree', prelevement_personnel: true }),
        ligne({ id: 'i4', date: '2026-01-02', montant: -9, statut: 'ignoree' }),
        ligne({ id: 't1', date: '2025-08-01', montant: -12, statut: 'non_rapprochee' }),
        ligne({ id: 't2', date: '2026-02-01', montant: -12, statut: 'non_rapprochee' }),
      ]
      const ecritures = [
        ecriture({ id: 'e1', date: '2025-03-01', compte: '512000', sens: 'credit', montant: 3, ligne_bancaire_id: null }),
        ecriture({ id: 'e2', date: '2025-03-02', compte: '512000', sens: 'debit', montant: 8, ligne_bancaire_id: 'l1' }),
        // Un exercice précédent compte aussi : le 512 du 31 décembre cumule depuis l'ouverture.
        ecriture({ id: 'e3', date: '2024-03-02', compte: '512000', sens: 'debit', montant: 99, ligne_bancaire_id: null }),
        ecriture({ id: 'e4', date: '2026-01-03', compte: '512000', sens: 'debit', montant: 1, ligne_bancaire_id: null }),
        ecriture({ id: 'e5', date: '2025-04-01', compte: '512100', sens: 'debit', montant: 2, ligne_bancaire_id: null }),
      ]
      const p = preuve('512000', 100000, { controlesReleves: [decembre], lignes, ecritures })
      expect(faitDe(p, 'mouvements-ignores')).toMatchObject({ nombre: 2, montantCentimes: -2500 })
      expect(faitDe(p, 'mouvements-a-traiter')).toMatchObject({ nombre: 1, montantCentimes: -1200 })
      expect(faitDe(p, 'banque-sans-mouvement')).toMatchObject({ nombre: 2, montantCentimes: 9600 })
      // Chaque fait s'accorde avec son nombre, et les mouvements ignorés se disent dans leurs deux sens.
      expect(faitDe(p, 'mouvements-ignores')?.texte).toMatch(/^2 mouvements ignorés jusqu’au 31\/12\/2025 \(15,00\s€ encaissés et 40,00\s€ payés\), 25,00\s€ au crédit au net : un doublon le reste, un mouvement réel manque au 512000\.$/)
      expect(faitDe(p, 'mouvements-a-traiter')?.texte).toMatch(/^1 mouvement à traiter jusqu’au 31\/12\/2025, 12,00\s€ au crédit au net : son écriture manque au 512000\.$/)
      expect(faitDe(p, 'banque-sans-mouvement')?.texte).toMatch(/^2 écritures du 512000 jusqu’au 31\/12\/2025 ne désignent aucun mouvement du relevé, 96,00\s€ au débit au net\.$/)
    })

    it('avant la reprise du dossier, rien ne compte : la balance reprise le porte', () => {
      const lignes = [
        ...mouvementsDeDecembre,
        ligne({ date: '2024-12-01', montant: -40, statut: 'ignoree' }),
        ligne({ date: '2024-12-02', montant: -12, statut: 'non_rapprochee' }),
      ]
      const ecritures = [ecriture({ date: '2024-12-03', compte: '512000', sens: 'debit', montant: 99, ligne_bancaire_id: null })]
      const p = preuve('512000', 100000, { controlesReleves: [decembre], lignes, ecritures, reprise: [aNouveau({ date: '2025-01-01' })] })
      expect(cles(p)).not.toContain('mouvements-ignores')
      expect(cles(p)).not.toContain('mouvements-a-traiter')
      expect(cles(p)).not.toContain('banque-sans-mouvement')
    })

    it('une écriture du 512 sans mouvement, à un et à plusieurs', () => {
      const une = preuve('512000', 100000, { controlesReleves: [decembre], ecritures: [ecriture({ date: '2025-03-01', compte: '512000', sens: 'credit', montant: 3 })] })
      expect(faitDe(une, 'banque-sans-mouvement')?.texte).toMatch(/^1 écriture du 512000 jusqu’au 31\/12\/2025 ne désigne aucun mouvement du relevé, 3,00\s€ au crédit au net\.$/)
    })

    it('aucune cause ne se dit quand le relevé tombe juste', () => {
      const lignes = [...mouvementsDeDecembre, ligne({ date: '2025-06-01', montant: -40, statut: 'ignoree' })]
      expect(preuve('512000', 103425, { controlesReleves: [premier, decembre], lignes }).faits).toEqual([])
    })

    it('elles se disent aussi quand la preuve ne conclut pas', () => {
      const p = preuve('512000', 5000, { lignes: [ligne({ date: '2025-08-01', montant: -12, statut: 'non_rapprochee' })] })
      expect(cles(p)).toEqual(['aucun-releve', 'mouvements-a-traiter'])
    })
  })
})

// ── Les virements internes ────────────────────────────────────────────────────────────────────────────────────────

describe('les virements internes (580000)', () => {
  it('un compte soldé : rien à dire de plus', () => {
    const p = preuve('580000', 0, {})
    expect(p.verdict).toBe('concorde')
    expect(p.detail).toEqual([])
    expect(p.resume).toBe('Virements internes : solde nul, comme le compte.')
  })

  it('apparie un débit et un crédit du même montant, dans l’ordre des dates, et dit ce qui reste', () => {
    const ecritures = [
      ecriture({ id: 'v2', date: '2025-02-05', compte: '580000', sens: 'credit', montant: 500 }),
      ecriture({ id: 'v1', date: '2025-02-03', compte: '580000', sens: 'debit', montant: 500 }),
      ecriture({ id: 'v3', date: '2025-03-10', compte: '580000', sens: 'debit', montant: 200 }),
      ecriture({ id: 'v4', date: '2025-04-10', compte: '580000', sens: 'credit', montant: 200 }),
      ecriture({ id: 'v5', date: '2025-05-10', compte: '580000', sens: 'debit', montant: 200 }),
      ecriture({ id: 'v6', date: '2026-01-10', compte: '580000', sens: 'credit', montant: 200 }),
    ]
    const p = preuve('580000', 20000, { ecritures })
    expect(p.verdict).toBe('ecart')
    expect(p.attenduCentimes).toBe(0)
    expect(p.detail).toEqual([{ libelle: expect.stringMatching(/^Virement du 10\/05\/2025 : 200,00\s€ au débit, sans contrepartie$/), montantCentimes: 20000, reference: { type: 'ecriture', id: 'v5' } }])
    expect(faitDe(p, 'virements-sans-contrepartie')).toMatchObject({ nombre: 1, montantCentimes: 20000 })
    expect(faitDe(p, 'virements-sans-contrepartie')?.texte).toBe('1 ligne du compte sans contrepartie de même montant dans l’exercice : le compte n’est pas soldé.')
  })

  it('un compte soldé n’a rien à apparier, même quand ses lignes ne se répondent pas une à une', () => {
    const ecritures = [
      ecriture({ id: 's1', date: '2025-03-01', compte: '580000', sens: 'debit', montant: 500 }),
      ecriture({ id: 's2', date: '2025-03-02', compte: '580000', sens: 'credit', montant: 300 }),
      ecriture({ id: 's3', date: '2025-03-03', compte: '580000', sens: 'credit', montant: 200 }),
    ]
    expect(preuve('580000', 0, { ecritures })).toMatchObject({ verdict: 'concorde', faits: [], detail: [] })
  })

  it('le premier virement parti trouve la première arrivée : le dernier reste en chemin', () => {
    const ecritures = [
      ecriture({ id: 'w1', date: '2025-11-02', compte: '580000', sens: 'debit', montant: 200 }),
      ecriture({ id: 'w2', date: '2025-11-03', compte: '580000', sens: 'debit', montant: 200 }),
      ecriture({ id: 'w3', date: '2025-12-30', compte: '580000', sens: 'credit', montant: 200 }),
    ]
    expect(preuve('580000', 20000, { ecritures }).detail.map((l) => l.reference?.id)).toEqual(['w2'])
  })

  it('l’ouverture du compte s’apparie aussi, et se dit quand elle reste seule', () => {
    const reportes = [soldeReporte({ id: 'r580', compte: '580000', montant: 300, date: '2025-01-01' })]
    expect(preuve('580000', 0, { reportes, ecritures: [ecriture({ compte: '580000', sens: 'credit', montant: 300, date: '2025-02-01' })] }).verdict).toBe('concorde')
    const seule = preuve('580000', 30000, { reportes })
    expect(seule.detail).toEqual([{ libelle: expect.stringContaining('Ouverture du 01/01/2025'), montantCentimes: 30000, reference: { type: 'solde-reporte', id: 'r580' } }])
    const reprise = preuve('580000', 30000, { reprise: [aNouveau({ id: 'a580', compte: '580000', montant: 300 })] })
    expect(reprise.detail[0].reference).toEqual({ type: 'a-nouveau', id: 'a580' })
  })
})

// ── Le registre ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('le registre des immobilisations, valeurs brutes (20…, 21…)', () => {
  const informatique = nature({ id: 'n-info', compte_immobilisation: '218300' })
  const ordinateur = bien({ id: 'b1', nature_id: 'n-info', piece_id: 'p1', valeur: 1200, date_acquisition: '2025-03-10' })
  const acquisition = ecriture({ id: 'acq', date: '2025-03-15', compte: '218300', sens: 'debit', montant: 1200, piece_id: 'p1' })

  it('le solde du compte est la valeur des biens que le registre y range, et la facture de chacun se propose', () => {
    const p = preuve('218300', 120000, { natures: [informatique], immobilisations: [ordinateur], ecritures: [acquisition] })
    expect(p.verdict).toBe('concorde')
    expect(p.detail).toEqual([{ libelle: 'Bien acquis le 10/03/2025', montantCentimes: 120000, reference: { type: 'bien', id: 'b1' } }])
    expect(p.sourcesProposees).toEqual([{ pieceId: 'p1', documentId: null, raison: 'La facture du bien acquis le 10/03/2025.' }])
  })

  it('un bien acquis après le 31 décembre, ou d’une autre nature, n’est pas attendu', () => {
    const p = preuve('218300', 120000, {
      natures: [informatique, nature({ id: 'n-mob', compte_immobilisation: '218400' })],
      immobilisations: [ordinateur, bien({ id: 'b2', nature_id: 'n-info', valeur: 50, date_acquisition: '2026-01-02' }), bien({ id: 'b3', nature_id: 'n-mob', valeur: 70 })],
      ecritures: [acquisition],
    })
    expect(p.verdict).toBe('concorde')
  })

  it('un bien acquis le 31 décembre est attendu', () => {
    const p = preuve('218300', 120000, { natures: [informatique], immobilisations: [{ ...ordinateur, date_acquisition: '2025-12-31' }], ecritures: [acquisition] })
    expect(p.verdict).toBe('concorde')
  })

  it('un bien d’un exercice précédent, ou acquis avant la reprise, n’attend pas d’acquisition dans l’exercice', () => {
    const anterieur = preuve('218300', 0, { natures: [informatique], immobilisations: [{ ...ordinateur, date_acquisition: '2024-05-01' }] })
    expect(anterieur.verdict).toBe('ecart')
    expect(cles(anterieur)).not.toContain('acquisitions-non-ecrites')
    const avantLaReprise = preuve('218300', 0, {
      natures: [informatique], immobilisations: [ordinateur], reprise: [aNouveau({ date: '2025-07-01', compte: '101000', sens: 'credit', montant: 1 })],
    })
    expect(avantLaReprise.verdict).toBe('ecart')
    expect(cles(avantLaReprise)).not.toContain('acquisitions-non-ecrites')
  })

  it('un bien acquis avant la reprise est attendu : la balance reprise porte sa valeur', () => {
    const p = preuve('218300', 120000, {
      natures: [informatique], immobilisations: [{ ...ordinateur, date_acquisition: '2023-05-01' }],
      reprise: [aNouveau({ date: '2025-01-01', compte: '218300', montant: 1200 })],
    })
    expect(p.verdict).toBe('concorde')
  })

  it('les causes possibles d’un écart : acquisition non écrite, facture différente, ligne hors registre, sans facture, sans nature', () => {
    const p = preuve('218300', 9900, {
      natures: [informatique],
      immobilisations: [
        ordinateur,
        bien({ id: 'b-sans-facture', nature_id: 'n-info', piece_id: null, valeur: 30, date_acquisition: '2025-04-01' }),
        bien({ id: 'b-sans-nature', nature_id: null, valeur: 40, date_acquisition: '2025-04-01' }),
      ],
      pieces: [piece({ id: 'p1', montant_ttc: 1440, montant_ht: 1200, montant_tva: 240 })],
      ecritures: [ecriture({ id: 'autre', date: '2025-06-01', compte: '218300', sens: 'debit', montant: 99, piece_id: 'p9' })],
    })
    expect(p.verdict).toBe('ecart')
    expect(p.attenduCentimes).toBe(123000)
    expect(cles(p)).toEqual(['acquisitions-non-ecrites', 'facture-differente', 'lignes-hors-registre', 'biens-sans-justificatif', 'biens-sans-nature'])
    expect(faitDe(p, 'acquisitions-non-ecrites')).toMatchObject({ nombre: 1, montantCentimes: 120000 })
    expect(faitDe(p, 'facture-differente')).toMatchObject({ nombre: 1, montantCentimes: null })
    expect(faitDe(p, 'lignes-hors-registre')).toMatchObject({ nombre: 1, montantCentimes: 9900 })
    expect(faitDe(p, 'biens-sans-justificatif')).toMatchObject({ nombre: 1, montantCentimes: null })
    expect(faitDe(p, 'biens-sans-nature')).toMatchObject({ nombre: 1, montantCentimes: 4000 })
    // Un bien sans facture n'a rien à proposer : une source désigne une pièce.
    expect(p.sourcesProposees.map((s) => s.pieceId)).toEqual(['p1'])
  })

  it('un bien dont la nature n’est pas lue est sans nature ; un bien acquis après le 31 décembre ne compte pas', () => {
    const p = preuve('218300', 1000, {
      natures: [informatique],
      immobilisations: [bien({ id: 'b-x', nature_id: 'n-inconnue', valeur: 10 }), bien({ id: 'b-tard', nature_id: null, valeur: 20, date_acquisition: '2026-01-02' })],
    })
    expect(faitDe(p, 'biens-sans-nature')).toMatchObject({ nombre: 1, montantCentimes: 1000 })
  })

  it('pour un dossier redevable, la facture se compare au hors taxe : elle porte la valeur du registre', () => {
    const p = preuve('218300', 0, {
      assujettiTva: true, natures: [informatique], immobilisations: [ordinateur],
      pieces: [piece({ id: 'p1', montant_ttc: 1440, montant_ht: 1200, montant_tva: 240 })],
    })
    expect(cles(p)).not.toContain('facture-differente')
  })
})

describe('le registre des immobilisations, amortissements (28…)', () => {
  const informatique = nature({ id: 'n-info', compte_immobilisation: '218300' })
  const ordinateur = bien({ id: 'b1', nature_id: 'n-info', piece_id: 'p1', valeur: 1200, date_acquisition: '2025-01-01', duree_annees: 3 })
  const dotation = ecritureEquilibree('dot', '2025-12-31', '681100', '281830', 400, { immobilisation_id: 'b1' })

  it('le solde du compte est le cumul des amortissements au 31 décembre, au crédit', () => {
    const p = preuve('281830', -40000, { natures: [informatique], immobilisations: [ordinateur], ecritures: dotation })
    expect(p.verdict).toBe('concorde')
    expect(p.attenduCentimes).toBe(-40000)
    expect(p.detail[0]).toEqual({ libelle: 'Bien mis en service le 01/01/2025 : amortissements cumulés au 31/12/2025', montantCentimes: -40000, reference: { type: 'bien', id: 'b1' } })
  })

  it('le compte d’amortissement d’une nature au sixième chiffre significatif a sept chiffres', () => {
    const fine = nature({ id: 'n-fine', compte_immobilisation: '218311' })
    const p = preuve('2818311', -40000, { natures: [fine], immobilisations: [{ ...ordinateur, nature_id: 'n-fine' }] })
    expect(p).toMatchObject({ type: 'registre-amortissements', verdict: 'concorde', attenduCentimes: -40000 })
    expect(preuve('281831', 0, { natures: [fine], immobilisations: [{ ...ordinateur, nature_id: 'n-fine' }] }).attenduCentimes).toBe(0)
  })

  it('au prorata depuis la mise en service, ouverture comprise', () => {
    const juillet = { ...ordinateur, date_mise_en_service: '2025-07-01' }
    expect(preuve('281830', -20000, { natures: [informatique], immobilisations: [juillet] }).attenduCentimes).toBe(-20000)
    // Un bien de 2023 : trois annuités de 400 au 31/12/2025 — le bien est entièrement amorti.
    expect(preuve('281830', 0, { natures: [informatique], immobilisations: [{ ...ordinateur, date_acquisition: '2023-01-01' }] }).attenduCentimes).toBe(-120000)
    // Mis en service après le 31 décembre : rien d'attendu.
    expect(preuve('281830', 0, { natures: [informatique], immobilisations: [{ ...ordinateur, date_mise_en_service: '2026-01-02' }] }).detail).toEqual([])
    // Mis en service le 31 décembre : un jour, (2 × 120 000 × 1 + 360 × 3) ÷ (720 × 3) = 111 centimes, arrondis comme la base.
    expect(preuve('281830', 0, { natures: [informatique], immobilisations: [{ ...ordinateur, date_mise_en_service: '2025-12-31' }] }).attenduCentimes).toBe(-111)
  })

  it('une dotation écrite n’est pas en défaut ; l’écriture d’un bien amorti à un autre compte est hors registre', () => {
    const mobilier = nature({ id: 'n-mob', compte_immobilisation: '218400' })
    const chaise = bien({ id: 'b9', nature_id: 'n-mob', valeur: 300, date_acquisition: '2025-01-01', duree_annees: 3 })
    const p = preuve('281830', -50000, {
      natures: [informatique, mobilier], immobilisations: [ordinateur, chaise],
      ecritures: [...dotation, ecriture({ date: '2025-12-31', compte: '281830', sens: 'credit', montant: 100, immobilisation_id: 'b9' })],
    })
    expect(p.verdict).toBe('ecart')
    expect(cles(p)).not.toContain('dotations-en-defaut')
    expect(faitDe(p, 'lignes-hors-registre')).toMatchObject({ nombre: 1, montantCentimes: -10000 })
  })

  it('un bien acquis le jour de la reprise n’est pas repris : la balance reprise ne le porte pas', () => {
    const p = preuve('281830', -1000, {
      natures: [informatique], immobilisations: [{ ...ordinateur, date_acquisition: '2025-03-01' }],
      reprise: [aNouveau({ date: '2025-03-01', compte: '101000', sens: 'credit', montant: 1 })],
    })
    expect(p.verdict).toBe('ecart')
    expect(cles(p)).not.toContain('biens-repris')
  })

  it('une dotation qui manque se dit, avec les écritures hors registre et les biens repris', () => {
    const p = preuve('281830', -1000, {
      natures: [informatique], immobilisations: [ordinateur, bien({ id: 'b0', nature_id: 'n-info', valeur: 300, date_acquisition: '2020-01-01' })],
      reprise: [aNouveau({ date: '2024-01-01', compte: '281830', sens: 'credit', montant: 300 })],
      ecritures: [ecriture({ date: '2025-06-30', compte: '281830', sens: 'credit', montant: 10 })],
    })
    expect(p.verdict).toBe('ecart')
    expect(cles(p)).toEqual(['dotations-en-defaut', 'lignes-hors-registre', 'biens-repris'])
    expect(faitDe(p, 'dotations-en-defaut')?.nombre).toBe(1)
    expect(faitDe(p, 'biens-repris')?.nombre).toBe(1)
  })

  it('un bien sans nature se dit, son compte d’amortissement n’étant pas connu', () => {
    const p = preuve('281830', -1000, { natures: [informatique], immobilisations: [bien({ id: 'b-sn', nature_id: null, valeur: 30 })] })
    expect(faitDe(p, 'biens-sans-nature')).toMatchObject({ nombre: 1, montantCentimes: null })
  })
})

// ── L'échéancier des emprunts ─────────────────────────────────────────────────────────────────────────────────────

describe('l’échéancier des emprunts (164000)', () => {
  afterEach(() => { vi.useRealTimers() })
  // 12 000 € à taux nul sur douze mois, du 1er janvier 2025 : une échéance de 1 000 € le 1er de chaque mois, de février
  // 2025 à janvier 2026 — onze sont passées au 31 décembre, il reste 1 000 € dus.
  const pret = emprunt({ id: 'em1', capital_initial: 12000, taux_annuel: 0, date_debut: '2025-01-01', duree_mois: 12 })
  const deblocage = ligne({ id: 'deb', emprunt_id: 'em1', montant: 12000, date: '2025-01-02' })

  it('le solde du compte est le capital restant dû au 31 décembre, au crédit', () => {
    const p = preuve('164000', -100000, { emprunts: [pret] })
    expect(p.verdict).toBe('concorde')
    expect(p.detail).toEqual([{ libelle: expect.stringMatching(/^Emprunt du 01\/01\/2025, 12\s000,00\s€ sur 12 mois : capital restant dû au 31\/12\/2025$/), montantCentimes: -100000, reference: { type: 'emprunt', id: 'em1' } }])
  })

  it('un emprunt soldé dans l’année n’attend plus rien, et un emprunt qui commence après le 31 décembre n’existe pas encore', () => {
    const court = emprunt({ id: 'em2', capital_initial: 6000, date_debut: '2025-01-01', duree_mois: 6 })
    const tardif = emprunt({ id: 'em3', capital_initial: 50000, date_debut: '2026-01-15', duree_mois: 60 })
    const p = preuve('164000', -100000, { emprunts: [pret, court, tardif] })
    expect(p.verdict).toBe('concorde')
    expect(p.detail.map((l) => l.montantCentimes)).toEqual([-100000, 0])
    // Un emprunt qui commence le 31 décembre est dû en entier ce jour-là.
    const dernierJour = emprunt({ id: 'em4', capital_initial: 3000, date_debut: '2025-12-31', duree_mois: 12 })
    expect(preuve('164000', -400000, { emprunts: [pret, dernierJour] }).attenduCentimes).toBe(-400000)
  })

  it('la date passe explicitement : la preuve ne dépend pas du jour où l’écran s’ouvre', () => {
    const avant = preuve('164000', -100000, { emprunts: [pret] })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-06-15T12:00:00Z'))
    expect(preuve('164000', -100000, { emprunts: [pret] })).toEqual(avant)
  })

  it('un emprunt antérieur à la reprise : seules les échéances de l’exercice se réclament, son capital est dans la reprise', () => {
    const ancien = emprunt({ id: 'em0', capital_initial: 12000, taux_annuel: 0, date_debut: '2024-07-01', duree_mois: 12 })
    const p = preuve('164000', -100000, { emprunts: [ancien], reprise: [aNouveau({ date: '2025-01-01', compte: '164000', sens: 'credit', montant: 6000 })] })
    expect(p.verdict).toBe('ecart')
    expect(faitDe(p, 'echeances-non-rapprochees')?.nombre).toBe(7)
    expect(cles(p)).not.toContain('deblocages-ecart')
  })

  it('une écriture du 164000 sur un mouvement qui ne rapproche aucun emprunt est hors emprunt', () => {
    const p = preuve('164000', -100500, {
      emprunts: [pret], lignes: [deblocage, ligne({ id: 'sans-emprunt', montant: -5, date: '2025-05-01' })],
      ecritures: [ecriture({ date: '2025-05-01', compte: '164000', sens: 'credit', montant: 5, ligne_bancaire_id: 'sans-emprunt' })],
    })
    expect(faitDe(p, 'lignes-hors-emprunt')).toMatchObject({ nombre: 1, montantCentimes: -500 })
  })

  it('les causes possibles d’un écart : échéances sans mouvement, déblocage absent, écritures hors emprunt', () => {
    const lignes = [
      ...Array.from({ length: 9 }, (_, i) => ligne({ id: `ech${i + 1}`, emprunt_id: 'em1', emprunt_echeance: i + 1, montant: -1000, date: `2025-${String(i + 2).padStart(2, '0')}-01` })),
    ]
    const p = preuve('164000', -300000, { emprunts: [pret], lignes, ecritures: [ecriture({ date: '2025-05-01', compte: '164000', sens: 'credit', montant: 5 })] })
    expect(p.verdict).toBe('ecart')
    expect(faitDe(p, 'echeances-non-rapprochees')).toMatchObject({ nombre: 2, montantCentimes: 200000 })
    expect(faitDe(p, 'deblocages-ecart')).toMatchObject({ nombre: 1, montantCentimes: 1200000 })
    expect(faitDe(p, 'lignes-hors-emprunt')).toMatchObject({ nombre: 1, montantCentimes: -500 })
    expect(faitDe(p, 'echeances-non-rapprochees')?.texte).toMatch(/^2 échéances de l’exercice qu’aucun mouvement ne paie : leur capital \(2\s000,00\s€\) n’est pas déduit du 164000\.$/)
    expect(faitDe(p, 'deblocages-ecart')?.texte).toMatch(/^1 emprunt dont les déblocages rapprochés au 31\/12\/2025 ne font pas le capital emprunté \(12\s000,00\s€ manquent\) : un déblocage non rapproché, rapproché deux fois, ou versé ailleurs qu’au compte bancaire\.$/)
    const debloque = preuve('164000', -300000, { emprunts: [pret], lignes: [...lignes, deblocage] })
    expect(cles(debloque)).not.toContain('deblocages-ecart')
  })

  it('un déblocage partiel, ou rapproché deux fois, se dit avec ce qui manque ou ce qui est de trop', () => {
    const partiel = preuve('164000', -50000, { emprunts: [pret], lignes: [{ ...deblocage, montant: 7000 }] })
    expect(faitDe(partiel, 'deblocages-ecart')).toMatchObject({ nombre: 1, montantCentimes: 500000 })
    const double = preuve('164000', -2500000, { emprunts: [pret], lignes: [deblocage, { ...deblocage, id: 'deb2' }] })
    expect(faitDe(double, 'deblocages-ecart')).toMatchObject({ nombre: 1, montantCentimes: -1200000 })
    expect(faitDe(double, 'deblocages-ecart')?.texte).toMatch(/\(12\s000,00\s€ de trop\)/)
  })

  it('un déblocage qui n’est pas rapproché, ou postérieur au 31 décembre, ne compte pas', () => {
    expect(faitDe(preuve('164000', 0, { emprunts: [pret], lignes: [{ ...deblocage, statut: 'non_rapprochee' }] }), 'deblocages-ecart')?.montantCentimes).toBe(1200000)
    expect(faitDe(preuve('164000', 0, { emprunts: [pret], lignes: [{ ...deblocage, date: '2026-01-02' }] }), 'deblocages-ecart')?.montantCentimes).toBe(1200000)
  })
})

// ── Les déclarations de TVA ───────────────────────────────────────────────────────────────────────────────────────

describe('les déclarations de TVA (445…)', () => {
  const cases = (o: Record<string, number>) => ({ l22: 0, l26: 0, l27: 0, l28: 0, l32: 0, ...o })
  const t = (n: number, o: Parameters<typeof declaration>[0]) => {
    const debut = `2025-${String(n * 3 - 2).padStart(2, '0')}-01`
    const fin = { 1: '2025-03-31', 2: '2025-06-30', 3: '2025-09-30', 4: '2025-12-31' }[n] as string
    return declaration({ id: `t${n}`, periode_debut: debut, periode_fin: fin, cases: cases({}), tva_collectee: 0, tva_deductible: 0, tva_deductible_immobilisations: 0, ...o })
  }
  const paiement = (id: string, decl: string, date: string, montant: number) =>
    ligne({ id, declaration_tva_id: decl, date, montant, statut: 'rapprochee' })

  it('le 445510 garde la TVA déclarée et non payée au 31 décembre : la dernière période, payée en janvier', () => {
    const declarations = [t(1, { cases: cases({ l28: 100, l32: 100 }) }), t(2, { cases: cases({ l28: 200, l32: 200 }) }),
      t(3, { cases: cases({ l28: 0 }) }), t(4, { cases: cases({ l28: 1234, l32: 1234 }) })]
    const lignes = [paiement('p1', 't1', '2025-04-20', -100), paiement('p2', 't2', '2025-07-20', -200), paiement('p4', 't4', '2026-01-20', -1234)]
    const p = preuve('445510', -123400, { assujettiTva: true, declarationsTva: declarations, lignes })
    expect(p.verdict).toBe('concorde')
    expect(p.detail).toEqual([{ libelle: 'Déclaration 4e trimestre 2025 : reste à payer au 31/12/2025', montantCentimes: -123400, reference: { type: 'declaration', id: 't4' } }])
  })

  it('le 445510 reçoit la ligne 28 que la liquidation y porte, pas la ligne 32', () => {
    // Aujourd'hui la base refuse une CA3 dont la ligne 32 n'est pas la ligne 28 (`enregistrer_declaration_tva`) : ce cas
    // n'existe pas en base. Il épingle la SOURCE — ce que la liquidation écrit au compte (lib/liquidationTva.ts) —, pour
    // le jour où la ligne 32, ce qui se paie, porterait autre chose que la TVA nette.
    const p = preuve('445510', -10000, { assujettiTva: true, declarationsTva: [t(4, { cases: cases({ l28: 100, l32: 0 }) })] })
    expect(p).toMatchObject({ verdict: 'concorde', attenduCentimes: -10000 })
  })

  it('une déclaration saisie à la main fait payer sa TVA nette moins le crédit reçu', () => {
    const main = declaration({ id: 'm', periode_debut: '2024-10-01', periode_fin: '2024-12-31', tva_declaree: 300, credit_anterieur: 50 })
    expect(preuve('445510', -25000, { declarationsTva: [main] }).verdict).toBe('concorde')
    expect(preuve('445510', 0, { declarationsTva: [main], lignes: [paiement('pm', 'm', '2025-01-20', -250)] }).verdict).toBe('concorde')
    // Un crédit plus grand que la TVA due ne fait rien payer.
    expect(preuve('445510', 0, { declarationsTva: [{ ...main, credit_anterieur: 400 }] }).verdict).toBe('concorde')
  })

  it('le 445670 porte le crédit que reporte la dernière déclaration de l’exercice', () => {
    const declarations = [t(3, { tva_declaree: -100, credit_anterieur: 0 }), t(4, { tva_declaree: -500, credit_anterieur: 200 })]
    const p = preuve('445670', 70000, { assujettiTva: true, declarationsTva: declarations })
    expect(p.verdict).toBe('concorde')
    expect(p.detail[0]).toMatchObject({ libelle: 'Déclaration 4e trimestre 2025 : crédit reporté', montantCentimes: 70000 })
    expect(preuve('445670', 0, { declarationsTva: [] }).verdict).toBe('concorde')
  })

  it('une déclaration d’une période qui finit après le 31 décembre n’entre pas dans l’exercice', () => {
    const declarations = [t(4, { tva_declaree: -500, credit_anterieur: 200 }), declaration({ id: 't2026', periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_declaree: -900 })]
    expect(preuve('445670', 70000, { assujettiTva: true, declarationsTva: declarations }).verdict).toBe('concorde')
  })

  it('le 445830 porte le remboursement demandé et non encore reçu', () => {
    const declarations = [t(3, { cases: cases({ l26: 760 }), remboursement_demande: 760 }), t(4, { cases: cases({ l26: 150 }), remboursement_demande: 150 })]
    const lignes = [paiement('r3', 't3', '2025-11-15', 760), paiement('r4', 't4', '2026-02-15', 150)]
    const p = preuve('445830', 15000, { assujettiTva: true, declarationsTva: declarations, lignes })
    expect(p.verdict).toBe('concorde')
    expect(p.detail).toHaveLength(1)
    // Une déclaration saisie à la main : le remboursement qu'elle a demandé.
    expect(preuve('445830', 30000, { declarationsTva: [declaration({ id: 'm', periode_fin: '2024-12-31', remboursement_demande: 300 })] }).verdict).toBe('concorde')
  })

  it('la TVA collectée et déductible est soldée quand toutes les périodes sont déclarées', () => {
    const toutes = [1, 2, 3, 4].map((n) => t(n, {}))
    expect(preuve('445660', 0, { assujettiTva: true, declarationsTva: toutes }).verdict).toBe('concorde')
    const p = preuve('445660', 1234, { assujettiTva: true, declarationsTva: [toutes[0], toutes[1], toutes[3]] })
    expect(p.verdict).toBe('ecart')
    expect(faitDe(p, 'periodes-non-declarees')?.texte).toContain('3e trimestre 2025')
    expect(cles(p)).not.toContain('exigibilite-decalee')
  })

  it('toutes les périodes déclarées et liquidées, un solde reste : l’exigibilité décalée, cause possible', () => {
    const toutes = [1, 2, 3, 4].map((n) => t(n, {}))
    const p = preuve('445710', -1234, { assujettiTva: true, declarationsTva: toutes })
    expect(cles(p)).toEqual(['exigibilite-decalee'])
    expect(faitDe(p, 'exigibilite-decalee')?.texte).toBe('Toutes les périodes de l’exercice sont déclarées et liquidées : le solde peut venir d’une TVA qui n’est pas exigible dans la période de son écriture — une facture réglée après le 31 décembre —, que la preuve ne calcule pas.')
    const engagement = preuve('445710', -1234, { assujettiTva: true, declarationsTva: toutes, modele: { mode: 'engagement', compteNotesDeFrais: '467000' } })
    expect(faitDe(engagement, 'exigibilite-decalee')?.texte).toContain('une facture réglée après le 31 décembre, ou toute facture non réglée d’un dossier en engagement —')
    // Ni sur un compte que la liquidation ne solde pas, ni sur un dossier qui n'est pas redevable.
    expect(cles(preuve('445510', -1234, { assujettiTva: true, declarationsTva: toutes }))).toEqual([])
    expect(cles(preuve('445710', -1234, { assujettiTva: false, declarationsTva: toutes }))).toEqual(['non-redevable'])
  })

  it('un dossier qui n’est pas redevable : aucune déclaration n’est attendue, et le dire', () => {
    const p = preuve('445660', 1234, { assujettiTva: false })
    expect(cles(p)).toEqual(['non-redevable'])
  })

  it('une liquidation ou un paiement d’un autre exercice ne se réclame pas dans celui-ci', () => {
    const ancienne = declaration({
      id: 't2024', periode_debut: '2024-10-01', periode_fin: '2024-12-31', cases: cases({ l28: 10 }), tva_collectee: 10, tva_deductible: 0,
      tva_deductible_immobilisations: 0,
    })
    const liquidation = preuve('445710', -1000, { assujettiTva: true, declarationsTva: [ancienne, ...[1, 2, 3, 4].map((n) => t(n, {}))] })
    expect(liquidation.verdict).toBe('ecart')
    expect(cles(liquidation)).not.toContain('liquidations-a-reecrire')
    const paiementDeJanvier = preuve('445510', -100000, {
      assujettiTva: true, declarationsTva: [t(4, { cases: cases({ l28: 1234, l32: 1234 }) })], lignes: [paiement('p4', 't4', '2026-01-20', -1234)],
    })
    expect(paiementDeJanvier.verdict).toBe('ecart')
    expect(cles(paiementDeJanvier)).not.toContain('paiements-a-reecrire')
  })

  it('les périodes antérieures à la reprise du dossier ne s’attendent pas', () => {
    const p = preuve('445660', 1234, {
      assujettiTva: true, declarationsTva: [t(3, {}), t(4, {})], reprise: [aNouveau({ date: '2025-07-01', compte: '101000', sens: 'credit', montant: 1 })],
    })
    expect(p.verdict).toBe('ecart')
    expect(cles(p)).not.toContain('periodes-non-declarees')
  })

  it('une liquidation qui manque se dit', () => {
    const quatre = t(4, { cases: cases({ l28: 10 }), tva_collectee: 10 })
    const p = preuve('445710', -1000, { assujettiTva: true, declarationsTva: [1, 2, 3].map((n) => t(n, {})).concat(quatre) })
    expect(cles(p)).toContain('liquidations-a-reecrire')
    expect(cles(p)).not.toContain('exigibilite-decalee')
  })

  it('un paiement dont l’écriture ne suit plus le mouvement se dit', () => {
    const p = preuve('445510', -1000, {
      assujettiTva: true, declarationsTva: [1, 2, 3, 4].map((n) => t(n, {})), lignes: [paiement('pt', 't1', '2025-04-20', -10)],
    })
    expect(cles(p)).toContain('paiements-a-reecrire')
  })
})

// ── L'ouverture de l'exercice ─────────────────────────────────────────────────────────────────────────────────────

describe('l’ouverture de l’exercice (101000)', () => {
  const empreinte = 'e'.repeat(64)
  const valide2024 = { annee: 2024, valide_le: '2025-03-01T10:00:00+00:00', empreinte }
  const report = soldeReporte({ id: 'r101', compte: '101000', sens: 'credit', montant: 5000, source_empreinte: empreinte })

  it('l’ouverture est celle que la validation de l’exercice précédent a écrite, et il se relit tel quel', () => {
    const p = preuve('101000', -500000, { exercicesValides: [valide2024], reportes: [report], verificationPrecedent: true })
    expect(p.verdict).toBe('concorde')
    expect(cles(p)).toEqual(['empreinte-intacte'])
    expect(p.detail).toEqual([{ libelle: 'Solde reporté de l’exercice 2024 validé', montantCentimes: -500000, reference: { type: 'solde-reporte', id: 'r101' } }])
  })

  it('l’empreinte pas encore vérifiée : la preuve ne conclut pas', () => {
    const p = preuve('101000', -500000, { exercicesValides: [valide2024], reportes: [report], verificationPrecedent: null })
    expect(p.verdict).toBe('incomplete')
    expect(cles(p)).toEqual(['empreinte-a-verifier'])
    expect(p.resume).toBe('Ouverture de l’exercice : l’empreinte de l’exercice 2024 reste à vérifier.')
  })

  it('une empreinte altérée, un maillon rompu ou une écriture sur le compte : un écart', () => {
    const alteree = preuve('101000', -500000, { exercicesValides: [valide2024], reportes: [report], verificationPrecedent: false })
    expect(alteree.verdict).toBe('ecart')
    expect(cles(alteree)).toEqual(['empreinte-alteree'])
    expect(alteree.resume).toBe('Ouverture de l’exercice : l’empreinte de l’exercice 2024 est altérée.')
    const rompu = preuve('101000', -500000, { exercicesValides: [valide2024], reportes: [{ ...report, source_empreinte: 'f'.repeat(64) }], verificationPrecedent: true })
    expect(rompu.verdict).toBe('ecart')
    expect(cles(rompu)).toContain('maillon-rompu')
    expect(rompu.resume).toBe('Ouverture de l’exercice : le maillon avec l’exercice précédent est rompu.')
    const ecrit = preuve('101000', -510000, {
      exercicesValides: [valide2024], reportes: [report], verificationPrecedent: true,
      ecritures: [ecriture({ date: '2025-05-01', compte: '101000', sens: 'credit', montant: 100 })],
    })
    expect(ecrit.verdict).toBe('ecart')
    expect(faitDe(ecrit, 'ecritures-sur-le-compte')).toMatchObject({ nombre: 1, montantCentimes: -10000 })
  })

  it('l’exercice de la reprise : l’ouverture est la balance reprise, désignée par son empreinte et jamais par son nom', () => {
    const p = preuve('101000', -80000, { reprise: [aNouveau({ id: 'a101', compte: '101000', sens: 'credit', montant: 800, source_empreinte: '0123456789abcdef'.repeat(4) })] })
    expect(p.verdict).toBe('concorde')
    expect(p.detail[0]).toEqual({ libelle: 'Balance reprise au 01/01/2025, empreinte 0123456789abcdef…', montantCentimes: -80000, reference: { type: 'a-nouveau', id: 'a101' } })
    expect(JSON.stringify(p)).not.toContain(MARQUE_SAISIE)
  })

  it('un compte que le report ne porte pas — soldé à la fin de l’exercice précédent — n’attend rien, et son maillon tient', () => {
    const autre = soldeReporte({ id: 'r512', compte: '512000', montant: 10, source_empreinte: empreinte })
    const p = preuve('101000', 0, { exercicesValides: [valide2024], reportes: [autre], verificationPrecedent: true })
    expect(p.verdict).toBe('concorde')
    expect(cles(p)).toEqual(['empreinte-intacte'])
  })

  it('rien ne précède l’exercice : le compte n’a pas d’ouverture', () => {
    expect(preuve('101000', 0, {}).verdict).toBe('concorde')
    expect(preuve('101000', -100, {}).verdict).toBe('ecart')
  })

  it('l’ouverture attend la validation de l’exercice précédent : la preuve ne conclut pas', () => {
    const p = preuve('101000', 0, { ecritures: ecritureEquilibree('x', '2024-06-01', '512000', '706000', 10) })
    expect(p.verdict).toBe('incomplete')
    expect(cles(p)).toEqual(['ouverture-en-attente'])
  })
})

// ── Le compte de l'exploitant ─────────────────────────────────────────────────────────────────────────────────────

describe('la composition du compte de l’exploitant (108000)', () => {
  it('dit de quoi le solde est fait, source par source, sans rien attendre', () => {
    const lignes = [
      ligne({ id: 'perso-sortie', prelevement_personnel: true, statut: 'ignoree', montant: -200 }),
      ligne({ id: 'perso-entree', prelevement_personnel: true, statut: 'ignoree', montant: 50 }),
      ligne({ id: 'cotis', cotisation_id: 'c1', montant: -330 }),
      ligne({ id: 'vent', ventilee: true, montant: -125 }),
      ligne({ id: 'affecte', categorie_id: 'k', montant: -10 }),
      ligne({ id: 'bilan', compte_bilan: '455000', montant: -4 }),
    ]
    const sur108 = (o: Parameters<typeof ecriture>[0]) => ecriture({ compte: '108000', date: '2025-06-01', ...o })
    const ecritures = [
      sur108({ id: 'a', ligne_bancaire_id: 'perso-sortie', sens: 'debit', montant: 200 }),
      sur108({ id: 'b', ligne_bancaire_id: 'perso-entree', sens: 'credit', montant: 50 }),
      sur108({ id: 'c', ligne_bancaire_id: 'cotis', sens: 'debit', montant: 30 }),
      sur108({ id: 'd', cotisation_id: 'c2', sens: 'credit', montant: 400 }),
      sur108({ id: 'e', vehicule_id: 'v', sens: 'credit', montant: 600, date: '2025-12-31' }),
      sur108({ id: 'f', piece_id: 'ndf', sens: 'credit', montant: 80 }),
      sur108({ id: 'g', ligne_bancaire_id: 'vent', sens: 'debit', montant: 25 }),
      sur108({ id: 'h', ligne_bancaire_id: 'affecte', sens: 'debit', montant: 10 }),
      sur108({ id: 'i', piece_id: 'achat', sens: 'debit', montant: 5 }),
      sur108({ id: 'j', sens: 'debit', montant: 1 }),
      sur108({ id: 'k', ligne_bancaire_id: 'disparu', sens: 'debit', montant: 2 }),
      sur108({ id: 'm', ligne_bancaire_id: 'bilan', sens: 'debit', montant: 4 }),
      sur108({ id: 'l', date: '2024-06-01', sens: 'debit', montant: 1000 }),
    ]
    const solde = 20000 - 5000 + 3000 - 40000 - 60000 - 8000 + 2500 + 1000 + 500 + 100 + 200 + 400 + 7000
    const p = preuve('108000', solde, {
      lignes, ecritures, pieces: [piece({ id: 'ndf', type_piece: 'note_frais' }), piece({ id: 'achat' })],
      reprise: [aNouveau({ compte: '108000', sens: 'debit', montant: 70 })],
    })
    expect(p.verdict).toBe('decrit')
    expect(p.attenduCentimes).toBeNull()
    expect(p.detail.map((l) => [l.libelle, l.montantCentimes])).toEqual([
      ['Ouverture de l’exercice (1)', 7000],
      ['Prélèvements du relevé (1)', 20000],
      ['Apports du relevé (1)', -5000],
      ['CSG-CRDS des cotisations prélevées (1)', 3000],
      ['Cotisations payées depuis le compte personnel (1)', -40000],
      ['Forfaits kilométriques (1)', -60000],
      ['Notes de frais payées par l’exploitant (1)', -8000],
      ['Parts personnelles des ventilations (1)', 2500],
      ['Mouvements affectés à ce compte (1)', 1000],
      ['Pièces rangées à ce compte (1)', 500],
      ['Autres écritures (3)', 700],
    ])
    expect(p.detail.every((l) => l.reference === null)).toBe(true)
    expect(p.detail.reduce((s, l) => s + (l.montantCentimes ?? 0), 0)).toBe(solde)
    expect(preuveSuffisanteSeule(p)).toBe(false)
  })
})

describe('la ligne de la carte du compte de l’exploitant', () => {
  it('sans écriture, puis avec une seule source', () => {
    expect(preuve('108000', 0, {}).resume).toBe('Composition du compte de l’exploitant : aucune écriture.')
    const une = preuve('108000', 1000, { ecritures: [ecriture({ compte: '108000', date: '2025-06-01', sens: 'debit', montant: 10 })] })
    expect(une.resume).toMatch(/^Composition du compte de l’exploitant : 1 source, 10,00\s€ au débit en tout\.$/)
  })

  it('des écritures qui se compensent : le compte est nul, il n’est pas vide', () => {
    const lignes = [ligne({ id: 'sortie', prelevement_personnel: true, montant: -10 }), ligne({ id: 'entree', prelevement_personnel: true, montant: 10 })]
    const ecritures = [
      ecriture({ id: 'a', compte: '108000', date: '2025-06-01', ligne_bancaire_id: 'sortie', sens: 'debit', montant: 10 }),
      ecriture({ id: 'b', compte: '108000', date: '2025-07-01', ligne_bancaire_id: 'entree', sens: 'credit', montant: 10 }),
    ]
    expect(preuve('108000', 0, { lignes, ecritures }).resume).toBe('Composition du compte de l’exploitant : 2 sources, nul en tout.')
  })
})

// ── Ce qu'une preuve compose : jamais une saisie ──────────────────────────────────────────────────────────────────

describe('aucune preuve ne recopie ce que le cabinet ou le client a saisi', () => {
  it('ni libellé, ni nom de fichier, de tiers, de bien ou d’emprunt, sur chaque compte prouvé et chacun de ses faits', () => {
    // Un jeu qui fait parler chaque preuve — écarts, relevés, causes, sources proposées —, chaque champ saisi marqué.
    const d = donnees({
      assujettiTva: true,
      controlesReleves: [
        controleReleve({ id: 'c1', solde_final: 10, somme_mouvements: 10 }),
        controleReleve({ id: 'c2', periode_debut: '2025-01-01', periode_fin: '2025-01-31', solde_initial: 3 }),
        controleReleve({ id: 'c3', periode_debut: '2025-12-02', coherent: false, ecart: 1 }),
      ],
      lignes: [ligne({ montant: 10, date: '2025-12-02' }), ligne({ id: 'l2', statut: 'ignoree', montant: -4 }), ligne({ id: 'l3', statut: 'non_rapprochee', montant: -2 })],
      documents: [documentDivers({ nom_fichier: `${MARQUE_SAISIE}-releve.pdf`, categorie: 'releve_bancaire' })],
      natures: [nature({ id: 'n1' })], immobilisations: [bien({ nature_id: 'n1', piece_id: 'p1' }), bien({ id: 'b2' })],
      emprunts: [emprunt({})], declarationsTva: [declaration({})],
      ecritures: [ecriture({ compte: '580000', montant: 5 }), ecriture({ compte: '108000', montant: 5 }), ecriture({ compte: '101000', montant: 5 }), ecriture({ compte: '512000', montant: 5 })],
      reprise: [aNouveau({ compte: '101000', sens: 'credit', montant: 9 })],
    })
    const parlent = new Set<string>()
    for (const compte of ['512000', '580000', '218300', '281830', '164000', '445510', '445660', '445670', '445830', '101000', '108000', '275000']) {
      const p = preuveDuCompte(compte, 123, d)
      expect(JSON.stringify(p), compte).not.toContain(MARQUE_SAISIE)
      for (const f of p.faits) parlent.add(f.cle)
    }
    // Le plancher : le jeu fait bien parler les preuves.
    expect(parlent.size).toBeGreaterThanOrEqual(10)
  })
})

// ── Le texte d'un jsonb, comme la base l'écrit ────────────────────────────────────────────────────────────────────

// LA TABLE RELEVÉE EN BASE, par une lecture seule (`select t::jsonb::text, octet_length(t::jsonb::text) from (values …)`,
// aucune table lue), le 09/10/2026, puis REJOUÉE en production le 10/10/2026 — chaque valeur envoyée encodée en
// hexadécimal, pour qu'aucun caractère ne change en route —, 33 sur 33 égales octet pour octet : chaque valeur telle que
// JSON.stringify l'envoie, et ce que la base en écrit. C'est ce texte que `justifier_solde` borne à 64 Kio (refus 12)
// et que la table contraint : le module doit le mesurer comme elle, ou il dirait d'un instantané qu'il passe quand la
// base le refuse.
const RELEVE_JSONB: [envoye: string, ecrit: string, octets: number][] = [
  ['{"a":1}', '{"a": 1}', 8],
  ['{"b":1,"a":2}', '{"a": 2, "b": 1}', 16],
  ['{"bb":1,"a":2,"ccc":3}', '{"a": 2, "bb": 1, "ccc": 3}', 27],
  ['{"ab":1,"aa":2,"ba":3}', '{"aa": 2, "ab": 1, "ba": 3}', 27],
  ['{"é":1,"z":2}', '{"z": 2, "é": 1}', 17],
  ['{"Z":1,"a":2,"_":3}', '{"Z": 1, "_": 3, "a": 2}', 24],
  ['{"version":1,"type":"releve","solde":103425}', '{"type": "releve", "solde": 103425, "version": 1}', 49],
  ['{"liste":[1,2,3],"vide":[],"objet":{},"rien":null,"vrai":true,"faux":false}',
    '{"faux": false, "rien": null, "vide": [], "vrai": true, "liste": [1, 2, 3], "objet": {}}', 88],
  ['{"n":0.1}', '{"n": 0.1}', 10],
  ['{"n":1e-7}', '{"n": 0.0000001}', 16],
  ['{"n":-1.5e-10}', '{"n": -0.00000000015}', 21],
  ['{"n":1.5e+21}', '{"n": 1500000000000000000000}', 29],
  ['{"n":123456789012345680000}', '{"n": 123456789012345680000}', 28],
  ['{"n":0.000001}', '{"n": 0.000001}', 15],
  ['{"n":0}', '{"n": 0}', 8],
  ['{"n":5e-324}', `{"n": 0.${'0'.repeat(323)}5}`, 333],
  ['{"n":1034.25}', '{"n": 1034.25}', 14],
  ['{"n":-12.34}', '{"n": -12.34}', 13],
  ['{"n":9007199254740992}', '{"n": 9007199254740992}', 23],
  ['{"s":"ligne\\nsuivante\\ttab\\"guillemet\\\\barre"}', '{"s": "ligne\\nsuivante\\ttab\\"guillemet\\\\barre"}', 47],
  ['{"s":"\\u0001\\u001f\u007f\\b\\f\\r"}', '{"s": "\\u0001\\u001f\u007f\\b\\f\\r"}', 28],
  ['{"s":"é😀\u2028fin"}', '{"s": "é😀\u2028fin"}', 21],
  ['{"s":"/"}', '{"s": "/"}', 10],
  ['[1,"deux",[3,[4,[]]],{"b":{},"a":[]}]', '[1, "deux", [3, [4, []]], {"a": [], "b": {}}]', 45],
  ['{"profond":{"b":{"d":1,"c":2},"a":[{"y":1,"x":2}]}}', '{"profond": {"a": [{"x": 2, "y": 1}], "b": {"c": 2, "d": 1}}}', 61],
  ['"chaine"', '"chaine"', 8],
  ['42', '42', 2],
  ['true', 'true', 4],
  ['null', 'null', 4],
  ['[]', '[]', 2],
  // Une clé se trie sur ses octets DÉCODÉS, pas sur son écriture échappée ; et sa longueur se compte en octets UTF-8 :
  // « 🙂 » (4 octets, 2 unités UTF-16) passe après « ab » et « é » (2 octets chacun), ce que la longueur d'une chaîne
  // JavaScript classerait autrement.
  ['{"a\\"b":1,"c\\nd":2,"e\\\\f":3}', '{"a\\"b": 1, "c\\nd": 2, "e\\\\f": 3}', 33],
  ['{"🙂":1,"é":2,"ab":3}', '{"ab": 3, "é": 2, "🙂": 1}', 29],
  ['{"x":"ééé","y":[{"z":-0.5}]}', '{"x": "ééé", "y": [{"z": -0.5}]}', 35],
]

describe('le texte d’un jsonb, mesuré comme la base le mesure', () => {
  it('la table relevée compte ses trente-trois valeurs', () => {
    expect(RELEVE_JSONB).toHaveLength(33)
  })

  for (const [envoye, ecrit, octets] of RELEVE_JSONB) {
    it(envoye.length > 60 ? `${envoye.slice(0, 60)}…` : envoye, () => {
      const valeur: unknown = JSON.parse(envoye)
      expect(JSON.stringify(valeur)).toBe(envoye)
      expect(texteJsonb(valeur)).toBe(ecrit)
      expect(octetsJsonb(valeur)).toBe(octets)
    })
  }

  it('mesure ce que supabase-js envoie : une clé `undefined` disparaît, NaN devient null', () => {
    expect(texteJsonb({ a: undefined, b: Number.NaN, c: [undefined] })).toBe('{"b": null, "c": [null]}')
    expect(texteJsonb(undefined)).toBeNull()
    expect(octetsJsonb(undefined)).toBe(0)
  })
})

// ── L'instantané ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('l’instantané d’une preuve, gardé avec la décision', () => {
  const informatique = nature({ id: 'n-info', compte_immobilisation: '218300' })
  const exemples: PreuveProposee[] = [
    preuve('512000', 1000, { controlesReleves: [controleReleve({ solde_final: 10, somme_mouvements: 0 })] }),
    preuve('580000', 100, { ecritures: [ecriture({ compte: '580000', montant: 1 })] }),
    preuve('218300', 100, { natures: [informatique], immobilisations: [bien({ nature_id: 'n-info', piece_id: 'p1', valeur: 1 })] }),
    preuve('281830', 0, { natures: [informatique], immobilisations: [bien({ nature_id: 'n-info' })] }),
    preuve('164000', 0, { emprunts: [emprunt({})] }),
    preuve('445510', 0, { declarationsTva: [declaration({ tva_declaree: 5 })] }),
    preuve('101000', 0, {}),
    preuve('108000', 100, { ecritures: [ecriture({ compte: '108000', montant: 1 })] }),
  ]

  it('se relit tel qu’il a été gardé, pour chaque preuve', () => {
    expect(exemples.map((p) => p.type)).toEqual(TYPES_DE_PREUVE.filter((t) => t !== 'aucune'))
    for (const p of exemples) {
      const instantane = instantaneDeLaPreuve(p) as InstantaneDePreuve
      expect(instantane.version).toBe(1)
      expect(instantane.detailOmis).toBe(0)
      expect(instantane).toMatchObject({ type: p.type, compte: p.compte, annee: p.annee, verdict: p.verdict, soldeCentimes: p.soldeCentimes, resume: p.resume })
      const relu = lireInstantaneDePreuve(JSON.parse(JSON.stringify(instantane)))
      expect(relu, p.type).toEqual(instantane)
      expect(relu?.etablit).toBe(TEXTES_DES_PREUVES[p.type].etablit)
    }
  })

  it('rien pour un compte sans preuve : il n’y a rien à garder', () => {
    expect(instantaneDeLaPreuve(preuve('275000', 1, {}))).toBeNull()
  })

  it('tient sous la borne de la base, et compte ce qu’il omet', () => {
    // Deux mille virements internes sans contrepartie : leur détail dépasse 64 Kio.
    const ecritures = Array.from({ length: 2000 }, (_, i) => ecriture({ id: `v${i}`, compte: '580000', montant: 1 + i, date: '2025-06-01' }))
    const p = preuve('580000', 1, { ecritures })
    expect(octetsJsonb({ ...instantaneDeLaPreuve(p), detail: p.detail })).toBeGreaterThan(TAILLE_MAX_PREUVE_APPLICATION)
    const instantane = instantaneDeLaPreuve(p) as InstantaneDePreuve
    expect(octetsJsonb(instantane)).toBeLessThanOrEqual(TAILLE_MAX_PREUVE_APPLICATION)
    expect(instantane.detailOmis).toBeGreaterThan(0)
    expect(instantane.detail.length + instantane.detailOmis).toBe(2000)
    expect(instantane.detail).toEqual(p.detail.slice(0, instantane.detail.length))
    // Le plus long début qui tient : une ligne de plus dépasserait.
    const uneDePlus = { ...instantane, detail: p.detail.slice(0, instantane.detail.length + 1), detailOmis: instantane.detailOmis - 1 }
    expect(octetsJsonb(uneDePlus)).toBeGreaterThan(TAILLE_MAX_PREUVE_APPLICATION)
    expect(lireInstantaneDePreuve(JSON.parse(JSON.stringify(instantane)))).toEqual(instantane)
  })

  it('garde le plus long début qui tient, quelle que soit la longueur des lignes', () => {
    const base = exemples[1]
    for (let longueur = 1200; longueur <= 3000; longueur += 50) {
      const detail = Array.from({ length: 60 }, (_, i) => ({ libelle: 'x'.repeat(longueur), montantCentimes: i, reference: null }))
      const instantane = instantaneDeLaPreuve({ ...base, detail }) as InstantaneDePreuve
      expect(instantane.detailOmis, String(longueur)).toBeGreaterThan(0)
      expect(octetsJsonb(instantane), String(longueur)).toBeLessThanOrEqual(TAILLE_MAX_PREUVE_APPLICATION)
      const uneDePlus = { ...instantane, detail: detail.slice(0, instantane.detail.length + 1), detailOmis: instantane.detailOmis - 1 }
      expect(octetsJsonb(uneDePlus), String(longueur)).toBeGreaterThan(TAILLE_MAX_PREUVE_APPLICATION)
    }
  })

  it('tient à l’octet près : un instantané de 64 Kio exactement passe entier', () => {
    const base = exemples[1]
    const avecUneLigne = (n: number): PreuveProposee => ({ ...base, detail: [{ libelle: 'x'.repeat(n), montantCentimes: 1, reference: null }] })
    const juste = TAILLE_MAX_PREUVE_APPLICATION - octetsJsonb(instantaneDeLaPreuve(avecUneLigne(0)))
    expect(octetsJsonb(instantaneDeLaPreuve(avecUneLigne(juste)))).toBe(TAILLE_MAX_PREUVE_APPLICATION)
    expect(instantaneDeLaPreuve(avecUneLigne(juste))?.detailOmis).toBe(0)
    expect(instantaneDeLaPreuve(avecUneLigne(juste + 1))?.detailOmis).toBe(1)
  })

  it('refuse ce qu’il ne sait pas relire, plutôt que de deviner', () => {
    const bon = instantaneDeLaPreuve(exemples[0]) as InstantaneDePreuve
    const variantes: unknown[] = [
      null, [], 'texte', { ...bon, version: 2 }, { ...bon, type: 'aucune' }, { ...bon, type: 'autre' }, { ...bon, compte: 512000 },
      { ...bon, annee: 2025.5 }, { ...bon, verdict: 'peut-etre' }, { ...bon, soldeCentimes: 1.5 }, { ...bon, attenduCentimes: '1' },
      { ...bon, ecartCentimes: undefined }, { ...bon, detailOmis: -1 }, { ...bon, detailOmis: 0.5 }, { ...bon, titre: null }, { ...bon, etablit: 1 },
      { ...bon, netablitPas: [] }, { ...bon, resume: 5 }, { ...bon, faits: {} },
      { ...bon, faits: [{ cle: 'inconnue', texte: 'x', montantCentimes: null, nombre: null }] },
      { ...bon, faits: [{ cle: 'aucun-releve', texte: 1, montantCentimes: null, nombre: null }] },
      { ...bon, faits: [{ cle: 'aucun-releve', texte: 'x', montantCentimes: 0.5, nombre: null }] },
      { ...bon, faits: [{ cle: 'aucun-releve', texte: 'x', montantCentimes: null, nombre: '1' }] },
      { ...bon, detail: {} },
      { ...bon, detail: [{ libelle: 'x', montantCentimes: 1, reference: { type: 'piece', id: 'p' } }] },
      { ...bon, detail: [{ libelle: 'x', montantCentimes: 1, reference: { type: 'releve', id: 5 } }] },
      { ...bon, detail: [{ libelle: 'x', montantCentimes: 1.5, reference: null }] },
      { ...bon, detail: [{ libelle: null, montantCentimes: 1, reference: null }] },
      { ...bon, sources: {} },
      { ...bon, sources: [{ pieceId: 'p', documentId: 'd', raison: 'x' }] },
      { ...bon, sources: [{ pieceId: null, documentId: null, raison: 'x' }] },
      { ...bon, sources: [{ pieceId: 'p', documentId: null, raison: null }] },
      { ...bon, sources: [{ pieceId: 5, documentId: null, raison: 'x' }] }, { ...bon, sources: [{ pieceId: null, documentId: ['d'], raison: 'x' }] },
    ]
    for (const v of variantes) expect(lireInstantaneDePreuve(v), JSON.stringify(v)?.slice(0, 80)).toBeNull()
    expect(lireInstantaneDePreuve({ ...bon, faits: CLES_DE_FAITS.map((cle) => ({ cle, texte: 'x', montantCentimes: null, nombre: null })) })).not.toBeNull()
    expect(lireInstantaneDePreuve({ ...bon, sources: [{ pieceId: null, documentId: 'd', raison: 'x' }], detail: [{ libelle: 'x', montantCentimes: null, reference: { type: 'releve', id: 'c' } }] })).not.toBeNull()
  })
})
