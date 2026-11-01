import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPTE_BANQUE, COMPTE_FOURNISSEURS } from './comptes'
import type { ModeleComptable } from './engagement'
import type { LigneBancaire, Piece } from './types'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

// Le client Supabase est simulé plutôt que le module découpé : ces deux fonctions *sont* des appels à
// la base, il n'y a pas de calcul pur à extraire. Le faux client reproduit le chaînage réellement
// utilisé (`from().select().eq()`, `from().insert()`, `from().delete().eq().eq()`) et rend la réponse
// programmée par le test — de quoi vérifier ce qui est écrit, et ce qui se passe quand la base refuse.
const reponses = {
  select: { data: [] as { id: string; compte: string; ligne_bancaire_id?: string | null }[] | null, error: null as { message: string } | null },
  // Le COMPTE des contreparties qui restent à une pièce (`select('id', { count, head })`), que lit
  // `rendreAuxDatesDeFacture` avant de redater.
  compte: { count: 0 as number | null, error: null as { message: string } | null },
  insert: { error: null as { message: string } | null },
  delete: { error: null as { message: string } | null },
  update: { error: null as { message: string } | null },
}
// Les filtres de chaque lecture de compte : c'est ce qui dit de QUELLE pièce on compte les contreparties.
let filtresComptes: string[][] = []
// Des comptes rendus l'un après l'autre, quand un test en lit plusieurs ; `reponses.compte` sinon.
let comptesSuccessifs: number[] = []
// Un objet en trésorerie (la contrepartie seule), un tableau en engagement (les deux lignes du règlement).
let insere: unknown = null
let supprime = false
// Les filtres de la suppression : c'est ce qui dit QUELLES lignes partent.
let filtresSuppression: string[] = []
// Les mises à jour de date, avec leurs filtres : c'est ce qui dit QUELLES lignes changent de date —
// la contrepartie banque, elle, garde toujours la date de son mouvement.
let misesAJour: { valeurs: Record<string, unknown>; filtres: string[] }[] = []
// L'ordre des écritures en base : ce qui dit qu'une ligne part AVANT que les autres soient redatées.
let ordre: string[] = []
// LA TABLE des écritures, quand un test en pose une : la suppression y APPLIQUE ses filtres (src/test/filtresPostgrest.ts,
// chargé dans la fabrique), si bien qu'un filtre oublié se voit aux lignes qui partent, et non au seul texte de la requête.
let brouillon: Record<string, unknown>[] | null = null

// LE DRAPEAU DU PAIEMENT PAR LA CAISSE (étape C9a), joué dans ses deux états, ÉCRITS : baissé par défaut (`beforeEach`),
// les requêtes sont celles d'hier, filtre pour filtre — tous les cas plus haut, quelle que soit la valeur du module, que la
// migration lèvera ; levé, la ligne d'une opération de caisse s'écarte des redates, et une pièce qu'elle paie ne retourne pas
// à sa facture. `null` : la valeur du module.
const drapeau = vi.hoisted(() => ({ leve: false as boolean | null }))
vi.mock('./paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('./paiementParLaCaisse')>()
  return { ...module, get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeau.leve ?? module.PAIEMENT_PAR_LA_CAISSE_EXPORTE } }
})

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIs, predicatNot } = await import('../test/filtresPostgrest')
  const resolvable = (op: 'select' | 'compte' | 'insert' | 'delete' | 'update', filtres: string[] = []) => {
    const predicats: ((ligne: Record<string, unknown>) => boolean)[] = []
    const chaine = {
      eq: (colonne: string, valeur: unknown) => { filtres.push(`${colonne}=${valeur}`); predicats.push(predicatEq(colonne, valeur)); return chaine },
      neq: (colonne: string, valeur: unknown) => {
        filtres.push(`${colonne}!=${valeur}`)
        predicats.push(() => { throw new Error(`Faux client : .neq('${colonne}', …) n'est pas modélisé sur la table.`) })
        return chaine
      },
      is: (colonne: string, valeur: unknown) => { filtres.push(`${colonne} is ${valeur}`); predicats.push(predicatIs(colonne, valeur)); return chaine },
      not: (colonne: string, operateur: string, valeur: unknown) => {
        filtres.push(`${colonne} not ${operateur} ${valeur}`); predicats.push(predicatNot(colonne, operateur, valeur)); return chaine
      },
      then: (resoudre: (v: unknown) => unknown) => {
        if (op === 'delete' && brouillon && !reponses.delete.error) {
          const parties = new Set(filtrer(brouillon, predicats))
          brouillon = brouillon.filter((ligne) => !parties.has(ligne))
        }
        return Promise.resolve(resoudre(
          op === 'compte' && comptesSuccessifs.length > 0 ? { count: comptesSuccessifs.shift(), error: null } : reponses[op],
        ))
      },
    }
    return chaine
  }
  return {
    supabase: {
      from: () => ({
        select: (_colonnes: string, options?: { count?: string; head?: boolean }) => {
          if (!options?.head) return resolvable('select')
          const filtres: string[] = []
          filtresComptes.push(filtres)
          return resolvable('compte', filtres)
        },
        insert: (payload: Record<string, unknown>) => { insere = payload; ordre.push('insert'); return resolvable('insert') },
        delete: () => { supprime = true; filtresSuppression = []; ordre.push('delete'); return resolvable('delete', filtresSuppression) },
        update: (valeurs: Record<string, unknown>) => {
          const filtres: string[] = []
          misesAJour.push({ valeurs, filtres })
          ordre.push('update')
          return resolvable('update', filtres)
        },
      }),
    },
  }
})

const { synchroniserContrepartieBanque, retirerContrepartieBanque, rendreAuxDatesDeFacture } = await import('./contrepartieBanque')

const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'facture.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ttc: 120, tiers: 'EDF', ...o,
} as Piece)

const ligne = (montant: number, o: Partial<LigneBancaire> = {}): LigneBancaire =>
  ({ id: 'l1', dossier_id: 'd1', date: '2026-03-12', libelle: 'PRLV EDF', montant, ...o } as LigneBancaire)

beforeEach(() => {
  reponses.select = { data: [{ id: 'e1', compte: '606100' }], error: null }
  reponses.compte = { count: 0, error: null }
  filtresComptes = []
  comptesSuccessifs = []
  reponses.insert = { error: null }
  reponses.delete = { error: null }
  reponses.update = { error: null }
  insere = null
  supprime = false
  filtresSuppression = []
  misesAJour = []
  ordre = []
  brouillon = null
  drapeau.leve = false
})

describe('synchroniserContrepartieBanque', () => {
  // UNE NOTE DE FRAIS QUE CE VIREMENT REMBOURSE EN ENTIER n'est plus due au dirigeant : sa contrepartie au compte de
  // l'exploitant part, AVANT la redate — redatée, elle resterait à côté de la banque et l'écriture compterait deux
  // fois ce que la banque paie déjà.
  it('retire la contrepartie au compte de l’exploitant d’une note de frais remboursée en entier, avant de redater', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '108000' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(ordre).toEqual(['delete', 'update', 'insert'])
    expect(filtresSuppression).toEqual(['piece_id=p1', 'compte=108000'])
    expect(insere).toMatchObject({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120 })
  })

  it('laisse la contrepartie d’une note de frais remboursée en partie, comme sa charge', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '108000' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-50), TRESORERIE)
    expect(ordre).toEqual(['insert'])
  })

  it('ne retire rien d’une pièce qui n’est pas une note de frais, ni d’une note de frais sans cette contrepartie', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '108000' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat', montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(ordre).toEqual(['update', 'insert'])
    ordre = []
    reponses.select = { data: [{ id: 'e1', compte: '625100' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(ordre).toEqual(['update', 'insert'])
  })

  // Rangée dans une catégorie au 108000, la note y porte sa CHARGE et n'a pas de contrepartie à part
  // (`estContrepartieDirigeant`) : retirer ses lignes au 108000 effacerait la dépense. Sa TVA n'est pas une charge.
  it('laisse la charge d’une note de frais rangée au compte de l’exploitant', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '108000' }, { id: 'e2', compte: '445660' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(ordre).toEqual(['update', 'insert'])
    // Le garde symétrique : la même note, sa charge ailleurs, perd bien sa contrepartie.
    ordre = []
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '445660' }, { id: 'e3', compte: '108000' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(ordre).toEqual(['delete', 'update', 'insert'])
  })

  it('un refus de retirer la contrepartie se dit, et rien n’est redaté ni écrit', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '108000' }], error: null }
    reponses.delete = { error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), TRESORERIE))
      .rejects.toMatchObject({ message: 'permission denied' })
    expect(ordre).toEqual(['delete'])
  })

  it('déduit le sens du signe du mouvement, pas du type de la pièce', () => {
    // Le compte banque est un compte d'actif : une sortie d'argent le crédite, une entrée le débite.
    // Un remboursement reçu sur une pièce d'achat va dans l'autre sens que le type ne le laisse
    // croire — c'est le piège que ce choix évite.
    return synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat' }), ligne(-120), TRESORERIE)
      .then(() => { expect(insere).toMatchObject({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }) })
      .then(() => { insere = null; return synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat' }), ligne(45), TRESORERIE) })
      .then(() => { expect(insere).toMatchObject({ sens: 'debit', montant: 45 }) })
  })

  it('prend le montant réel du mouvement, pas celui de la pièce', async () => {
    // Ils peuvent différer de quelques centimes (frais bancaires, arrondi) — c'est la banque qui fait foi.
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-119.98), TRESORERIE)
    expect(insere).toMatchObject({ montant: 119.98, date: '2026-03-12' })
  })

  it('libelle par le tiers, sinon par le nom du fichier', async () => {
    await synchroniserContrepartieBanque('d1', piece({ tiers: null }), ligne(-120), TRESORERIE)
    expect(insere).toMatchObject({ libelle: 'facture.pdf' })
  })

  it('n’écrit rien tant que la pièce n’a pas sa ligne de charge', async () => {
    // La contrepartie viendra d'elle-même quand les écritures seront générées.
    reponses.select = { data: [], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)
    expect(insere).toBeNull()
  })

  it('reste idempotente PAR MOUVEMENT : pas de doublon si la contrepartie de ce mouvement existe déjà', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, { id: 'e2', compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' }], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)
    expect(insere).toBeNull()
  })

  // Le défaut d'avant : elle sortait dès que la pièce portait UNE contrepartie, et une pièce payée en
  // deux fois — un acompte puis la part d'un virement groupé — ne recevait jamais la seconde.
  it('écrit la contrepartie d’un SECOND paiement de la pièce, sans la redater', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, { id: 'e2', compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), { id: 'g', date: '2026-04-02', montant: -120 }, TRESORERIE)
    expect(insere).toMatchObject({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'g', date: '2026-04-02', montant: 120, sens: 'credit' })
    // Ce paiement réglerait la pièce à lui seul, mais un autre la paie déjà : les lignes restent où elles
    // sont, et le contrôle demandera « Régénérer », qui les répartit.
    expect(misesAJour).toEqual([])
  })

  it('porte la PART d’un virement groupé, jamais le virement entier', async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 700 }), { id: 'g', date: '2026-02-12', montant: -700 }, TRESORERIE)
    expect(insere).toMatchObject({ ligne_bancaire_id: 'g', montant: 700, sens: 'credit', date: '2026-02-12' })
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-02-12' }, filtres: ['piece_id=p1', `compte!=${COMPTE_BANQUE}`] }])
  })

  it('levé : la même PART, la redate écartant la ligne d’une opération de caisse', async () => {
    drapeau.leve = true
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 700 }), { id: 'g', date: '2026-02-12', montant: -700 }, TRESORERIE)
    expect(insere).toMatchObject({ ligne_bancaire_id: 'g', montant: 700, sens: 'credit', date: '2026-02-12' })
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-02-12' }, filtres: ['piece_id=p1', `compte!=${COMPTE_BANQUE}`, 'operation_caisse_id is null'] }])
  })

  it('n’écrit rien pour un paiement de zéro euro', async () => {
    await synchroniserContrepartieBanque('d1', piece(), ligne(0), TRESORERIE)
    expect(insere).toBeNull()
    expect(misesAJour).toEqual([])
  })

  it('lève quand la base refuse l’écriture, au lieu de rendre la main', async () => {
    // Sans cela, l'échec ne se voyait qu'indirectement : une pièce comptée « en attente de
    // rapprochement bancaire » dans la Checklist, sans qu'on sache que l'écriture avait été refusée.
    reponses.insert = { error: { message: 'new row violates row-level security policy' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE))
      .rejects.toMatchObject({ message: expect.stringContaining('row-level security') })
  })

  it('lève aussi quand c’est la lecture préalable qui échoue', async () => {
    // Une lecture refusée rendait `data` nul, ce qui ressemblait à « pas encore d'écriture » : le
    // renoncement paraissait légitime alors qu'il masquait un refus.
    reponses.select = { data: null, error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

// L'ÉCRITURE SUIT LA DATE DU PAIEMENT, comme la 2035 compte la pièce (lib/rattachement.ts) : générée
// avant le rapprochement, elle portait la date de facture.
describe('synchroniserContrepartieBanque — la date du paiement', () => {
  it("passe l'écriture à la date du paiement qui règle la pièce, sans toucher la contrepartie", async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-03-12' }, filtres: ['piece_id=p1', `compte!=${COMPTE_BANQUE}`] }])
  })

  it('levé : la même date, la ligne d’une opération de caisse écartée de la redate', async () => {
    drapeau.leve = true
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-03-12' }, filtres: ['piece_id=p1', `compte!=${COMPTE_BANQUE}`, 'operation_caisse_id is null'] }])
  })

  it('tient pour réglée une pièce payée à des frais près', async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-119.98), TRESORERIE)
    expect(misesAJour).toHaveLength(1)
  })

  it("laisse la date d'une pièce réglée en partie : « Régénérer » la répartira", async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 1000 }), ligne(-400), TRESORERIE)
    expect(misesAJour).toEqual([])
    expect(insere).toMatchObject({ compte: COMPTE_BANQUE, montant: 400 })
  })

  it('ne touche à rien quand la contrepartie de ce mouvement existe déjà', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, { id: 'e2', compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' }], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([])
  })

  it("lève quand la date ne peut pas être écrite, avant d'écrire la contrepartie", async () => {
    // L'ordre garde le message de l'appelant vrai : « la contrepartie n'a pas pu être créée ».
    reponses.update = { error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

describe('retirerContrepartieBanque', () => {
  it('supprime la contrepartie de CE mouvement, et elle seule', async () => {
    // Elle retirait toutes celles de la pièce : annuler l'un de ses deux paiements effaçait aussi
    // la contrepartie de l'autre.
    await retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)
    expect(supprime).toBe(true)
    expect(filtresSuppression).toEqual(['piece_id=p1', 'ligne_bancaire_id=l1'])
  })

  it('laisse les dates d’une pièce qu’un autre paiement date encore', async () => {
    reponses.compte = { count: 1, error: null }
    await retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)
    expect(filtresComptes).toEqual([['piece_id=p1', `compte=${COMPTE_BANQUE}`]])
    expect(misesAJour).toEqual([])
  })

  it('ne redate rien quand le compte des contreparties restantes ne revient pas', async () => {
    // « Plus aucun paiement » ne se déduit pas d'un compte que la base n'a pas rendu.
    reponses.compte = { count: null, error: null }
    await retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)
    expect(misesAJour).toEqual([])
  })

  it('lève quand le compte des contreparties restantes est refusé', async () => {
    reponses.compte = { count: null, error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
    expect(misesAJour).toEqual([])
  })

  it('lève quand la suppression échoue', async () => {
    // L'appelant doit pouvoir le dire : le rapprochement est annulé mais l'écriture de paiement
    // subsiste, pour un mouvement qui n'est plus rapproché.
    reponses.delete = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
  })

  it("rend l'écriture à la date de sa facture : plus rien ne la date au paiement", async () => {
    await retirerContrepartieBanque('l1', 'p1', piece({ date_piece: '2026-03-10' }), TRESORERIE)
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-03-10' }, filtres: ['piece_id=p1'] }])
  })

  it('levé : rendue à sa facture de même, la ligne d’une opération de caisse écartée', async () => {
    drapeau.leve = true
    await retirerContrepartieBanque('l1', 'p1', piece({ date_piece: '2026-03-10' }), TRESORERIE)
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-03-10' }, filtres: ['piece_id=p1', 'operation_caisse_id is null'] }])
  })

  it('à la date de dépôt pour une pièce sans date, comme la génération', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece({ date_piece: null, created_at: '2026-03-01T10:00:00Z' }), TRESORERIE)
    expect(misesAJour[0].valeurs).toEqual({ date: '2026-03-01' })
  })

  it("ne date rien quand l'écran n'a pas la pièce", async () => {
    await retirerContrepartieBanque('l1', 'p1', null, TRESORERIE)
    expect(supprime).toBe(true)
    expect(misesAJour).toEqual([])
  })

  it('lève quand la date ne peut pas être rendue', async () => {
    reponses.update = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
  })
})

// EN ENGAGEMENT (lib/engagement.ts), le rapprochement écrit le RÈGLEMENT : le compte de tiers contre la
// banque, au mouvement — et ne redate jamais la facture.
describe('synchroniserContrepartieBanque — en engagement', () => {
  beforeEach(() => {
    reponses.select = { data: [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: COMPTE_FOURNISSEURS, ligne_bancaire_id: null }], error: null }
  })

  it('écrit le règlement du mouvement, 401 contre 512, sans redater la facture', async () => {
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120, date: '2026-03-12', ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-03-12', ligne_bancaire_id: 'l1' }),
    ])
    expect(misesAJour).toEqual([])
  })

  it('solde le 404 de la facture d’un bien immobilisé, pas le 401', async () => {
    // L'écriture d'ACQUISITION crédite le 404000 : c'est elle que le règlement lit pour savoir quel compte solder.
    reponses.select = { data: [{ id: 'e1', compte: '218300', ligne_bancaire_id: null }, { id: 'e2', compte: '404000', ligne_bancaire_id: null }], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toEqual([
      expect.objectContaining({ compte: '404000', sens: 'debit', montant: 120, ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
    ])
  })

  it('ne lit pas le 404 d’un RÈGLEMENT comme celui d’une facture de bien', async () => {
    // Seule la facture (sans mouvement) dit ce qui est dû : un règlement d'un autre mouvement au 404, à côté
    // d'une facture au 401, n'est pas une raison de solder le 404 — c'est une écriture à régénérer.
    reponses.select = {
      data: [
        { id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: COMPTE_FOURNISSEURS, ligne_bancaire_id: null },
        { id: 'e3', compte: '404000', ligne_bancaire_id: 'l9' },
      ],
      error: null,
    }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120, ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
    ])
  })

  it('n’écrit rien tant que la facture n’est pas générée — la génération écrira les deux', async () => {
    reponses.select = { data: [], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toBeNull()
  })

  it('reste idempotente PAR MOUVEMENT : un second paiement reçoit son propre règlement', async () => {
    reponses.select = { data: [
      { id: 'e1', compte: '606100', ligne_bancaire_id: null },
      { id: 'e3', compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' },
    ], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toBeNull()
    await synchroniserContrepartieBanque('d1', piece(), ligne(-60, { id: 'l2' }), ENGAGEMENT)
    expect(insere).toEqual([
      expect.objectContaining({ ligne_bancaire_id: 'l2', montant: 60 }),
      expect.objectContaining({ ligne_bancaire_id: 'l2', montant: 60 }),
    ])
  })

  it('lève quand la base refuse le règlement', async () => {
    reponses.insert = { error: { message: 'new row violates row-level security policy' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT))
      .rejects.toMatchObject({ message: expect.stringContaining('row-level security') })
  })

  it('lève quand la lecture préalable échoue, sans rien écrire', async () => {
    reponses.select = { data: null, error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

describe('retirerContrepartieBanque — en engagement', () => {
  it('retire le règlement de CE mouvement, et ne redate rien', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece(), ENGAGEMENT)
    expect(filtresSuppression).toEqual(['ligne_bancaire_id=l1', 'facture_id is null', 'encaissement_id is null'])
    expect(misesAJour).toEqual([])
  })

  // R1 (migration `lignes_propres_au_mouvement`) : un mouvement libéré porte encore les lignes d'une vente facturée — la
  // banque d'un encaissement contre-passé sans mouvement, celle de sa contre-passation, et, restaurée, une ligne d'une
  // facture. Elles ne se retirent que par leur fonction : supprimées ici, G5 refuserait APRÈS que l'écran a délié le
  // mouvement, et le règlement de la pièce resterait au brouillon. Le faux client applique les filtres à la table.
  const ecriture = (id: string, o: Record<string, unknown>) => ({
    id, piece_id: null, ligne_bancaire_id: 'l1', facture_id: null, encaissement_id: null, ...o,
  })
  const tableDuMouvementLibere = () => [
    ecriture('reglement-tiers', { piece_id: 'p1', compte: COMPTE_FOURNISSEURS }),
    ecriture('reglement-banque', { piece_id: 'p1', compte: COMPTE_BANQUE }),
    ecriture('propre-sans-piece', { compte: '467000' }),
    ecriture('encaissement', { compte: COMPTE_BANQUE, encaissement_id: 'e1' }),
    ecriture('contre-passation', { compte: COMPTE_BANQUE, encaissement_id: 'e2' }),
    ecriture('facture', { compte: '411000', facture_id: 'f1' }),
    ecriture('autre-mouvement', { piece_id: 'p2', ligne_bancaire_id: 'l2', compte: COMPTE_BANQUE }),
  ]

  it('retire les lignes propres du mouvement, jamais celles d’une vente facturée', async () => {
    brouillon = tableDuMouvementLibere()
    await retirerContrepartieBanque('l1', 'p1', piece(), ENGAGEMENT)
    expect(brouillon.map((l) => l.id)).toEqual(['encaissement', 'contre-passation', 'facture', 'autre-mouvement'])
  })

  it('en trésorerie, la contrepartie de la pièce seule : une ligne d’une vente facturée ne porte jamais de pièce', async () => {
    brouillon = tableDuMouvementLibere()
    await retirerContrepartieBanque('l1', 'p1', null, TRESORERIE)
    expect(brouillon.map((l) => l.id))
      .toEqual(['propre-sans-piece', 'encaissement', 'contre-passation', 'facture', 'autre-mouvement'])
  })

  it('retire en trésorerie la contrepartie de ce mouvement pour la pièce', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)
    expect(filtresSuppression).toEqual(['piece_id=p1', 'ligne_bancaire_id=l1'])
  })

  it('lève quand la suppression échoue', async () => {
    reponses.delete = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), ENGAGEMENT)).rejects.toMatchObject({ message: 'permission denied' })
  })
})

// Après un règlement groupé retiré, ou réglé de nouveau sans certaines pièces : la base a déjà retiré les
// contreparties du mouvement, et chaque pièce qu'aucun paiement ne date plus retourne à sa facture.
describe('rendreAuxDatesDeFacture', () => {
  it('ramène à sa facture chaque pièce sans contrepartie restante, et elle seule', async () => {
    comptesSuccessifs = [0, 2]
    await rendreAuxDatesDeFacture([
      piece({ id: 'p1', date_piece: '2026-01-10' }),
      piece({ id: 'p2', date_piece: '2026-01-11' }),
    ], TRESORERIE)
    expect(filtresComptes).toEqual([['piece_id=p1', `compte=${COMPTE_BANQUE}`], ['piece_id=p2', `compte=${COMPTE_BANQUE}`]])
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-01-10' }, filtres: ['piece_id=p1'] }])
  })

  it('levé : la caisse comptée aussi, après la banque ; ramenée seule la pièce que ni l’une ni l’autre ne date', async () => {
    drapeau.leve = true
    comptesSuccessifs = [0, 0, 2]
    await rendreAuxDatesDeFacture([
      piece({ id: 'p1', date_piece: '2026-01-10' }),
      piece({ id: 'p2', date_piece: '2026-01-11' }),
    ], TRESORERIE)
    expect(filtresComptes).toEqual([
      ['piece_id=p1', `compte=${COMPTE_BANQUE}`], ['piece_id=p1', 'operation_caisse_id not is null'], ['piece_id=p2', `compte=${COMPTE_BANQUE}`],
    ])
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-01-10' }, filtres: ['piece_id=p1', 'operation_caisse_id is null'] }])
  })

  it('ne redate rien en engagement : la facture n’a jamais quitté sa date', async () => {
    await rendreAuxDatesDeFacture([piece()], ENGAGEMENT)
    expect(filtresComptes).toEqual([])
    expect(misesAJour).toEqual([])
  })
})

// LE PLAN DU DOSSIER (ligne 43, étape PC3 ; conception, § 2.4 et § 5.4) : la contrepartie s'écrit à la banque DU PLAN, et
// les lignes qu'elle RETROUVE se cherchent sur les comptes du plan. Filtrée sur le 108000, la suppression de la
// contrepartie de l'exploitant ne supprimerait rien, en silence, dans un dossier dont l'exploitant est au 108100.
describe('la contrepartie banque sous le plan du dossier', () => {
  const DECALE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: PLAN_DECALE.associe, plan: PLAN_DECALE }

  it('retire la contrepartie de l’exploitant du plan, redate hors de sa banque, et écrit sur elle', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '108100' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), DECALE)
    expect(ordre).toEqual(['delete', 'update', 'insert'])
    expect(filtresSuppression).toEqual(['piece_id=p1', 'compte=108100'])
    expect(misesAJour.map((m) => m.filtres)).toEqual([['piece_id=p1', 'compte!=512100']])
    expect(insere).toMatchObject({ compte: '512100', sens: 'credit', montant: 120 })
  })

  it('levé : de même sous le plan, la redate écartant la ligne d’une opération de caisse', async () => {
    drapeau.leve = true
    reponses.select = { data: [{ id: 'e1', compte: '625100' }, { id: 'e2', compte: '108100' }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ type_piece: 'note_frais', montant_ttc: 120 }), ligne(-120), DECALE)
    expect(ordre).toEqual(['delete', 'update', 'insert'])
    expect(filtresSuppression).toEqual(['piece_id=p1', 'compte=108100'])
    expect(misesAJour.map((m) => m.filtres)).toEqual([['piece_id=p1', 'compte!=512100', 'operation_caisse_id is null']])
    expect(insere).toMatchObject({ compte: '512100', sens: 'credit', montant: 120 })
  })

  it('compte les contreparties qui restent à la pièce sur la banque du plan', async () => {
    reponses.compte = { count: 1, error: null }
    await retirerContrepartieBanque('l1', 'p1', piece(), DECALE)
    expect(filtresComptes).toEqual([['piece_id=p1', 'compte=512100']])
    expect(misesAJour).toEqual([])
  })

  it('reconnaît en engagement la facture d’un bien à la dette du plan, et règle sur elle', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '218300', ligne_bancaire_id: null }, { id: 'e2', compte: '404100', ligne_bancaire_id: null }], error: null }
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), { ...DECALE, mode: 'engagement' })
    expect((insere as { compte: string; sens: string }[]).map((l) => [l.compte, l.sens])).toEqual([['404100', 'debit'], ['512100', 'credit']])
  })
})

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (étape C9a), le drapeau LEVÉ : la contrepartie de caisse s'écrit avec les écritures
// de sa pièce (la génération, « Régénérer »), jamais ici ; mais une pièce qu'elle paie est une pièce qu'un AUTRE paiement
// règle, et la ligne d'une opération de caisse ne se redate jamais — la garde du brouillon refuserait la mise à jour, et
// la redate de toute la pièce avec elle.
describe('le paiement par la caisse, le drapeau levé', () => {
  const CAISSE = { id: 'e2', compte: '530000', piece_id: 'p1', operation_caisse_id: 'oc-1' }

  it('les cas plus haut jouent le drapeau BAISSÉ, écrit — ceux d’hier, quelle que soit la valeur du module ; levé à la demande', async () => {
    // Le drapeau tel que lib/contrepartieBanque.ts le lit : celui de l'accesseur, que `beforeEach` baisse.
    const lu = await import('./paiementParLaCaisse')
    expect(lu.PAIEMENT_PAR_LA_CAISSE_EXPORTE).toBe(false)
    drapeau.leve = true
    expect(lu.PAIEMENT_PAR_LA_CAISSE_EXPORTE).toBe(true)
    // `null`, la valeur du module : celle que la migration lève (paiementParLaCaisse.test.ts la confronte à l'export).
    drapeau.leve = null
    const { PAIEMENT_PAR_LA_CAISSE_EXPORTE } = await vi.importActual<typeof import('./paiementParLaCaisse')>('./paiementParLaCaisse')
    expect(lu.PAIEMENT_PAR_LA_CAISSE_EXPORTE).toBe(PAIEMENT_PAR_LA_CAISSE_EXPORTE)
  })

  it('une pièce déjà payée par la caisse ne se redate pas au mouvement : « Régénérer » répartira entre les deux', async () => {
    drapeau.leve = true
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, CAISSE], error: null }
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([])
    expect(insere).toMatchObject({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' })
    // Le drapeau baissé, la même lecture — qu'aucune base d'aujourd'hui ne rend — n'y change rien : la ligne n'est lue que
    // pour son compte, comme hier.
    drapeau.leve = false
    misesAJour = []
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([])
  })

  it('la redate écarte la ligne d’une opération de caisse', async () => {
    drapeau.leve = true
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([{
      valeurs: { date: '2026-03-12' }, filtres: ['piece_id=p1', `compte!=${COMPTE_BANQUE}`, 'operation_caisse_id is null'],
    }])
  })

  it('rendre à sa facture : pas une pièce que la caisse date encore ; et jamais la ligne de la caisse', async () => {
    drapeau.leve = true
    comptesSuccessifs = [0, 1, 0, 0]
    await rendreAuxDatesDeFacture([piece({ id: 'p1', date_piece: '2026-01-10' }), piece({ id: 'p2', date_piece: '2026-01-11' })], TRESORERIE)
    expect(filtresComptes).toEqual([
      ['piece_id=p1', `compte=${COMPTE_BANQUE}`], ['piece_id=p1', 'operation_caisse_id not is null'],
      ['piece_id=p2', `compte=${COMPTE_BANQUE}`], ['piece_id=p2', 'operation_caisse_id not is null'],
    ])
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-01-11' }, filtres: ['piece_id=p2', 'operation_caisse_id is null'] }])
  })

  it('un compte de la caisse que la base ne rend pas ne dit pas « plus aucun paiement » : rien ne se redate', async () => {
    drapeau.leve = true
    comptesSuccessifs = [0]
    reponses.compte = { count: null, error: null }
    await rendreAuxDatesDeFacture([piece()], TRESORERIE)
    expect(misesAJour).toEqual([])
  })

  it('un compte de la caisse que la base refuse lève, sans rien redater', async () => {
    drapeau.leve = true
    comptesSuccessifs = [0]
    reponses.compte = { count: null, error: { message: 'permission denied' } }
    await expect(rendreAuxDatesDeFacture([piece()], TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
  })
})
