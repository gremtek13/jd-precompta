import { describe, expect, it } from 'vitest'
import {
  COMPTES_DE_TIERS, COMPTES_NOTES_DE_FRAIS, EXPLICATIONS_MODE, LIBELLES_MODE, auxiliaireDuTiers, compteDeTiers,
  lignesEngagementPourPiece, lignesFactureEngagement, lignesReglementEngagement, modeleDuDossier,
} from './engagement'
import {
  COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_EXPLOITANT, COMPTE_FOURNISSEURS, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE,
  LIBELLES_COMPTES,
} from './comptes'
import { dateLocaleDe } from './format'
import type { LigneAGenerer } from './ecritures'
import type { LigneBancaire, Piece } from './types'

const ACHATS = '606100'
const VENTES = '706000'

// Jeu d'essai typé SANS `as` : le compilateur vérifie chaque champ contre la table.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2026-03-10', tiers: 'Transmedical',
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: 'c1', sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2026-03-12T09:00:00Z', updated_at: '2026-03-12T09:00:00Z', ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-04-05', libelle: 'PRLV TRANSMEDICAL', montant: -120,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2026-04-06T09:00:00Z', ...o,
  }
}

// Débit − crédit : zéro pour une écriture qui s'équilibre.
const solde = (lignes: readonly LigneAGenerer[]) =>
  Math.round(lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0) * 100) / 100

describe('compteDeTiers', () => {
  it('range une vente en 411, un achat et une pièce « autre » en 401', () => {
    expect(compteDeTiers(piece({ type_piece: 'vente' }), '455000')).toBe(COMPTE_CLIENTS)
    expect(compteDeTiers(piece({ type_piece: 'achat' }), '455000')).toBe(COMPTE_FOURNISSEURS)
    expect(compteDeTiers(piece({ type_piece: 'autre' }), '455000')).toBe(COMPTE_FOURNISSEURS)
  })

  it('range une note de frais sur le compte que le dossier a choisi, quel qu’il soit', () => {
    for (const compte of ['455000', '108000', '467000'] as const) {
      expect(compteDeTiers(piece({ type_piece: 'note_frais' }), compte)).toBe(compte)
    }
  })

  it('ne connaît que des comptes de tiers que la balance sait nommer', () => {
    for (const compte of COMPTES_DE_TIERS) expect(LIBELLES_COMPTES[compte]).toBeTruthy()
  })
})

describe('lignesFactureEngagement — la facture, à sa date, contre le compte de tiers', () => {
  it('passe un achat au débit, sa TVA au débit, et le TTC au crédit du 401', () => {
    const lignes = lignesFactureEngagement('d1', piece(), ACHATS, true, '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 100, date: '2026-03-10' }),
      expect.objectContaining({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20, date: '2026-03-10' }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 120, date: '2026-03-10' }),
    ])
    expect(solde(lignes)).toBe(0)
    // Une facture ne désigne aucun mouvement : c'est ce qui la garde hors du journal de banque.
    expect(lignes.every((l) => l.ligne_bancaire_id === undefined)).toBe(true)
  })

  it('passe une vente au crédit, sa TVA collectée au crédit, et le TTC au débit du 411', () => {
    const lignes = lignesFactureEngagement('d1', piece({ type_piece: 'vente', tiers: 'CPAM' }), VENTES, true, '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 100 }),
      expect.objectContaining({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 20 }),
      expect.objectContaining({ compte: COMPTE_CLIENTS, sens: 'debit', montant: 120 }),
    ])
    expect(solde(lignes)).toBe(0)
  })

  it('passe le TTC en charge pour un dossier exonéré, sans ligne de TVA', () => {
    const lignes = lignesFactureEngagement('d1', piece(), ACHATS, false, '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 120 }),
    ])
  })

  it('crédite le compte du dossier pour une note de frais payée par le dirigeant', () => {
    const lignes = lignesFactureEngagement('d1', piece({ type_piece: 'note_frais' }), ACHATS, true, '108000')
    expect(lignes.at(-1)).toMatchObject({ compte: COMPTE_EXPLOITANT, sens: 'credit', montant: 120 })
    expect(lignes.some((l) => l.compte === COMPTE_FOURNISSEURS)).toBe(false)
  })

  it('inverse les sens d’un avoir, les montants restant positifs', () => {
    const avoir = piece({ montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    const lignes = lignesFactureEngagement('d1', avoir, ACHATS, true, '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'credit', montant: 100 }),
      expect.objectContaining({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120 }),
    ])
  })

  it('date une pièce sans date de son dépôt, comme en trésorerie', () => {
    const lignes = lignesFactureEngagement('d1', piece({ date_piece: null }), ACHATS, true, '455000')
    expect(new Set(lignes.map((l) => l.date))).toEqual(new Set([dateLocaleDe('2026-03-12T09:00:00Z')]))
  })

  it('laisse déséquilibrée une facture dont la TVA ne recoupe pas le TTC, pour que le contrôle le dise', () => {
    // Le compte de tiers porte ce qui est DÛ, le TTC ; forcer l'équilibre en y mettant HT + TVA
    // masquerait une pièce fausse sous une écriture juste en apparence.
    const lignes = lignesFactureEngagement('d1', piece({ montant_ht: 100, montant_tva: 30, montant_ttc: 120 }), ACHATS, true, '455000')
    expect(lignes.at(-1)).toMatchObject({ compte: COMPTE_FOURNISSEURS, montant: 120 })
    expect(solde(lignes)).toBe(10)
  })
})

describe('lignesReglementEngagement — le règlement, au mouvement, contre la banque', () => {
  it('solde le 401 d’un achat payé : débit 401, crédit 512, datés et désignés du mouvement', () => {
    const lignes = lignesReglementEngagement('d1', piece(), mouvement(), '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l1' }),
    ])
  })

  it('solde le 411 d’une vente encaissée : débit 512, crédit 411', () => {
    const lignes = lignesReglementEngagement('d1', piece({ type_piece: 'vente' }), mouvement({ montant: 120 }), '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: COMPTE_CLIENTS, sens: 'credit', montant: 120 }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'debit', montant: 120 }),
    ])
  })

  it('lit la banque au signe du mouvement, pas au type de la pièce : un avoir remboursé entre en banque', () => {
    const lignes = lignesReglementEngagement('d1', piece(), mouvement({ montant: 30 }), '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 30 }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'debit', montant: 30 }),
    ])
  })

  it('rembourse le dirigeant depuis le compte bancaire de l’entreprise : débit 455, crédit 512', () => {
    const lignes = lignesReglementEngagement('d1', piece({ type_piece: 'note_frais' }), mouvement({ montant: -100 }), '455000')
    expect(lignes).toEqual([
      expect.objectContaining({ compte: '455000', sens: 'debit', montant: 100 }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 100 }),
    ])
  })

  it('porte le montant du MOUVEMENT, pas celui de la pièce : un frais bancaire reste sur le compte de tiers', () => {
    expect(lignesReglementEngagement('d1', piece(), mouvement({ montant: -118.5 }), '455000').map((l) => l.montant)).toEqual([118.5, 118.5])
  })

  it('ne produit rien pour un mouvement à zéro', () => {
    expect(lignesReglementEngagement('d1', piece(), mouvement({ montant: 0 }), '455000')).toEqual([])
  })
})

describe('lignesEngagementPourPiece', () => {
  it('rend la facture puis un règlement par mouvement, dans l’ordre des dates', () => {
    const lignes = lignesEngagementPourPiece('d1', piece(), ACHATS, true, '455000', [
      mouvement({ id: 'l2', date: '2026-05-02', montant: -70 }),
      mouvement({ id: 'l1', date: '2026-04-05', montant: -50 }),
    ])
    expect(lignes.map((l) => [l.compte, l.ligne_bancaire_id ?? null])).toEqual([
      [ACHATS, null], [COMPTE_TVA_DEDUCTIBLE, null], [COMPTE_FOURNISSEURS, null],
      [COMPTE_FOURNISSEURS, 'l1'], [COMPTE_BANQUE, 'l1'],
      [COMPTE_FOURNISSEURS, 'l2'], [COMPTE_BANQUE, 'l2'],
    ])
    expect(solde(lignes)).toBe(0)
  })
})

describe('auxiliaireDuTiers — le compte auxiliaire du FEC', () => {
  it('numérote un fournisseur à sa clé d’identité, et le nomme comme il est lu', () => {
    expect(auxiliaireDuTiers(piece({ tiers: 'Transmedical' }), COMPTE_FOURNISSEURS)).toEqual({ num: 'FTRANSMEDICAL', lib: 'Transmedical' })
    expect(auxiliaireDuTiers(piece({ tiers: 'CPAM des\nBouches-du-Rhône' }), COMPTE_CLIENTS)).toEqual({ num: 'CCPAM', lib: 'CPAM des Bouches-du-Rhône' })
  })

  it('donne le même numéro aux deux lectures d’un même fournisseur', () => {
    expect(auxiliaireDuTiers(piece({ tiers: 'Transmedical / et redevient' }), COMPTE_FOURNISSEURS)?.num).toBe('FTRANSMEDICAL')
  })

  it('range un tiers sans clé au compte « divers » plutôt que de lui en inventer une', () => {
    expect(auxiliaireDuTiers(piece({ tiers: null }), COMPTE_FOURNISSEURS)).toEqual({ num: 'FDIVERS', lib: 'Fournisseurs divers' })
    expect(auxiliaireDuTiers(piece({ tiers: 'CARTE BANCAIRE' }), COMPTE_CLIENTS)).toEqual({ num: 'CDIVERS', lib: 'Clients divers' })
  })

  it('ne donne d’auxiliaire qu’au 401 et au 411', () => {
    for (const compte of [ACHATS, COMPTE_BANQUE, COMPTE_TVA_DEDUCTIBLE, '455000', '108000', '467000']) {
      expect(auxiliaireDuTiers(piece(), compte)).toBeNull()
    }
  })
})

describe('le modèle du dossier', () => {
  it('se lit sur les deux colonnes du dossier', () => {
    expect(modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: '108000' }))
      .toEqual({ mode: 'engagement', compteNotesDeFrais: '108000' })
  })

  it('se présente sous les noms choisis par le cabinet', () => {
    expect(LIBELLES_MODE).toEqual({ tresorerie: 'Trésorerie (BNC, 2035)', engagement: 'Engagement (BIC, IS)' })
    expect(EXPLICATIONS_MODE.engagement).toMatch(/2035 n’est pas produite/)
  })
})

// Les corrections du cabinet (28/09/2026), gardées mot pour mot : une explication réécrite « plus
// naturellement » y reviendrait sans que rien ne le dise.
describe('les comptes d’une note de frais, tels que le cabinet les a formulés', () => {
  const texte = (compte: string) => {
    const choix = COMPTES_NOTES_DE_FRAIS.find((c) => c.compte === compte)!
    return `${choix.libelle} ${choix.explication}`
  }

  it('propose les trois comptes, le 455 en premier et recommandé', () => {
    expect(COMPTES_NOTES_DE_FRAIS.map((c) => c.compte)).toEqual(['455000', '108000', '467000'])
    expect(COMPTES_NOTES_DE_FRAIS[0].libelle).toMatch(/recommandé/)
  })

  it('dit que c’est la société qui rembourse le dirigeant, depuis son compte bancaire — jamais « la banque »', () => {
    expect(texte('455000')).toMatch(/la société rembourse le dirigeant, depuis son compte bancaire : débit 455, crédit 512/)
    for (const c of COMPTES_NOTES_DE_FRAIS) expect(`${c.libelle} ${c.explication}`).not.toMatch(/par la banque|la banque (le |la )?(rembourse|solde)/i)
  })

  it('ne dit pas du 108 que rien n’est remboursé : il retrace les apports et les prélèvements', () => {
    expect(texte('108000')).toMatch(/apports et ses prélèvements personnels/)
    expect(texte('108000')).not.toMatch(/rien n.est rembours/i)
  })

  it('ne présente jamais le 467 comme un compte d’attente', () => {
    expect(texte('467000')).toMatch(/pas associée, ou lorsqu’aucun compte plus spécifique ne convient/)
    for (const c of COMPTES_NOTES_DE_FRAIS) expect(`${c.libelle} ${c.explication}`).not.toMatch(/attente/i)
  })
})
