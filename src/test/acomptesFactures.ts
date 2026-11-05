import { filtrer, predicatEq, predicatIn, type Ligne, type Predicat } from './filtresPostgrest'

// LES FACTURES D'ACOMPTE D'UN DEVIS, POUR LES TESTS DE L'APERÇU ET DE LA TRANSMISSION (étape P5b4b). Un faux client Supabase
// qui APPLIQUE les filtres (`.eq`, `.in` : src/test/filtresPostgrest.ts), ne rend que les colonnes demandées — une colonne
// que la ligne n'a pas manque à la réponse, comme une colonne que la base n'a pas encore —, annonce son compte, et peut
// refuser une table. Il se charge DANS la fabrique de `vi.mock` (`await import`) ; l'état est celui de ce module. Données
// FICTIVES.

export const fauxTables = {
  tables: {} as Record<string, Ligne[]>,
  refus: {} as Record<string, string>,
  // Chaque lecture, `table: colonnes` : drapeau baissé, aucune ne nomme une colonne de l'acompte.
  demandes: [] as string[],
  invoke: (nom: string, _body: Record<string, unknown>): Promise<unknown> =>
    Promise.reject(new Error(`Fonction non attendue dans ce test : ${nom}`)),
}

export function poserLesTables(tables: Record<string, Ligne[]>, refus: Record<string, string> = {}) {
  fauxTables.tables = tables
  fauxTables.refus = refus
  fauxTables.demandes = []
}

export const fauxClient = {
  from(table: string) {
    if (!(table in fauxTables.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
    const predicats: Predicat[] = []
    let colonnes: string[] | null = null
    let compte = false
    const reponse = () => {
      if (fauxTables.refus[table]) return { data: null, error: { message: fauxTables.refus[table] }, count: null }
      const lignes = filtrer(fauxTables.tables[table], predicats)
        .map((l) => (colonnes ? Object.fromEntries(colonnes.filter((k) => k in l).map((k) => [k, l[k]])) : l))
      return { data: lignes, error: null, count: compte ? lignes.length : null }
    }
    const q = {
      select(liste: string, options?: { count?: string; head?: boolean }) {
        fauxTables.demandes.push(`${table}: ${liste}`)
        colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim())
        compte = options?.count === 'exact'
        return q
      },
      eq(c: string, v: unknown) { predicats.push(predicatEq(c, v)); return q },
      in(c: string, v: readonly unknown[]) { predicats.push(predicatIn(c, v)); return q },
      order() { return q },
      range: async (debut: number, fin: number) => {
        const r = reponse()
        return r.data ? { ...r, data: r.data.slice(debut, fin + 1) } : r
      },
      maybeSingle: async () => {
        const r = reponse()
        if (!r.data) return { data: null, error: r.error }
        if (r.data.length > 1) return { data: null, error: { message: 'plusieurs lignes rendues' } }
        return { data: r.data[0] ?? null, error: null }
      },
      then<A, B>(ok: (r: ReturnType<typeof reponse>) => A, ko?: (e: unknown) => B) {
        return Promise.resolve(reponse()).then(ok, ko)
      },
    }
    return q
  },
  functions: { invoke: (nom: string, options: { body: Record<string, unknown> }) => fauxTables.invoke(nom, options.body) },
}

// ── Le dossier fictif : un devis, deux acomptes, une finale qui les reprend, l'avoir du premier ──────────────────────
export const DEVIS = { id: 'dv1', dossier_id: 'd1', numero: 'D2026-0002', date_emission: '2026-09-20' }

/** Une facture telle que la base la garde, marque d'acompte comprise. */
export function factureEnBase(o: Ligne): Ligne {
  return {
    dossier_id: 'd1', type: 'facture', statut: 'validee', facture_origine_id: null, acompte: false,
    date_versement_acompte: null, ...o,
  }
}

export const ACOMPTE_1 = factureEnBase({ id: 'a1', numero: 'F2026-0003', date_emission: '2026-10-01', acompte: true, date_versement_acompte: '2026-09-25' })
export const ACOMPTE_2 = factureEnBase({ id: 'a2', numero: 'F2026-0005', date_emission: '2026-10-15', acompte: true })
export const FINALE = factureEnBase({ id: 'fin', numero: 'F2026-0007', date_emission: '2026-11-02' })
export const AVOIR_ACOMPTE = factureEnBase({ id: 'av1', numero: 'A2026-0001', date_emission: '2026-10-20', type: 'avoir', facture_origine_id: 'a1' })

export function ligneEnBase(o: Ligne): Ligne {
  return { taux_tva: 20, reprise_facture_id: null, ...o }
}

export const LIGNES = [
  ligneEnBase({ id: 'la1', facture_id: 'a1', ordre: 1, designation: 'Acompte de 30 % sur le devis D2026-0002', quantite: 1, prix_unitaire_ht: 300 }),
  ligneEnBase({ id: 'la2', facture_id: 'a2', ordre: 1, designation: 'Acompte de 20 % sur le devis D2026-0002', quantite: 1, prix_unitaire_ht: 200 }),
  ligneEnBase({ id: 'lf1', facture_id: 'fin', ordre: 1, designation: 'Mission d’aménagement', quantite: 1, prix_unitaire_ht: 1000 }),
  ligneEnBase({ id: 'lf2', facture_id: 'fin', ordre: 2, designation: 'Reprise de l’acompte F2026-0003 du 01/10/2026', quantite: -1, prix_unitaire_ht: 300, reprise_facture_id: 'a1' }),
  ligneEnBase({ id: 'lf3', facture_id: 'fin', ordre: 3, designation: 'Reprise de l’acompte F2026-0005 du 15/10/2026', quantite: -1, prix_unitaire_ht: 200, reprise_facture_id: 'a2' }),
  ligneEnBase({ id: 'lv1', facture_id: 'av1', ordre: 1, designation: 'Acompte de 30 % sur le devis D2026-0002', quantite: -1, prix_unitaire_ht: 300 }),
]

export const LIENS = [
  { id: 'df1', dossier_id: 'd1', devis_id: 'dv1', facture_id: 'a1', role: 'acompte' },
  { id: 'df2', dossier_id: 'd1', devis_id: 'dv1', facture_id: 'a2', role: 'acompte' },
  { id: 'df3', dossier_id: 'd1', devis_id: 'dv1', facture_id: 'fin', role: 'finale' },
]

/** Les tables du dossier fictif, copiées : un cas les retouche sans toucher aux autres. */
export function tablesDuDossier(): Record<string, Ligne[]> {
  return {
    factures_emises: [ACOMPTE_1, ACOMPTE_2, FINALE, AVOIR_ACOMPTE].map((f) => ({ ...f })),
    facture_lignes: LIGNES.map((l) => ({ ...l })),
    devis_factures: LIENS.map((l) => ({ ...l })),
    devis: [{ ...DEVIS }],
  }
}
