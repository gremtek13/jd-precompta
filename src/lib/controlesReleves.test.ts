import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControleSolde } from './soldeReleve'

// Client Supabase simulé (même motif que contrepartieBanque.test.ts) : ce module n'est qu'une
// écriture et une lecture, il n'y a pas de calcul pur à en extraire.
//
// Le faux client est indispensable même ici : `supabase.ts` lève au chargement quand les variables
// d'environnement manquent, donc sans lui ce fichier passerait en local — où un `.env` existe — et
// casserait en CI. Vérifié en rejouant la suite sans `.env`.
const etat = {
  appels: [] as { methode: string; table: string; ligne?: Record<string, unknown>; onConflict?: string }[],
  erreurEcriture: null as { message: string } | null,
  erreurLecture: null as { message: string } | null,
  lignes: [] as Record<string, unknown>[],
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (ligne: Record<string, unknown>, opts?: { onConflict?: string }) => {
        etat.appels.push({ methode: 'upsert', table, ligne, onConflict: opts?.onConflict })
        return Promise.resolve({ error: etat.erreurEcriture })
      },
      insert: (ligne: Record<string, unknown>) => {
        etat.appels.push({ methode: 'insert', table, ligne })
        return Promise.resolve({ error: etat.erreurEcriture })
      },
      // La lecture passe par `lireTout` (voir lib/lectureComplete.ts) : le faux client doit donc
      // honorer `range` et ANNONCER un `count`. Sans compte annoncé, toute lecture se déclarerait
      // incomplète et le test vérifierait autre chose que ce qu'il croit.
      select: () => {
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          eq: () => chaine,
          order: () => chaine,
          range: () => chaine,
          then: (suite: (r: unknown) => unknown) => Promise.resolve(
            etat.erreurLecture
              ? { data: null, error: etat.erreurLecture, count: null }
              : { data: etat.lignes, error: null, count: etat.lignes.length },
          ).then(suite),
        })
        return chaine
      },
    }),
  },
}))

const { enregistrerControleReleve, chargerRelevesIncoherents } = await import('./controlesReleves')

const controle = (o: Partial<ControleSolde> = {}): ControleSolde => ({
  soldeInitial: 8270.84, soldeFinal: 20023.55, sommeMouvements: 17112.71,
  attendu: 25383.55, ecart: 5359, coherent: false,
  dateInitiale: '2025-01-01', dateFinale: '2025-12-31', ...o,
})

beforeEach(() => {
  etat.appels = []
  etat.erreurEcriture = null
  etat.erreurLecture = null
  etat.lignes = []
})

describe('enregistrerControleReleve', () => {
  it('écrit le contrôle avec sa période et son écart', () => {
    // Les chiffres sont ceux du relevé réel du dossier de test : c'est cet écart de 5 359,00 € que
    // l'ancienne alerte annonçait puis détruisait au premier clic.
    return enregistrerControleReleve('d1', 'releve-2025.csv', controle()).then(() => {
      expect(etat.appels[0].ligne).toMatchObject({
        dossier_id: 'd1', source_fichier: 'releve-2025.csv',
        solde_initial: 8270.84, solde_final: 20023.55, ecart: 5359, coherent: false,
        periode_debut: '2025-01-01', periode_fin: '2025-12-31',
      })
    })
  })

  it('remplace le contrôle quand le même fichier est réimporté', async () => {
    // Sans `onConflict`, réimporter un relevé empilerait un second contrôle et l'écran annoncerait
    // deux relevés en écart là où il n'y en a qu'un.
    await enregistrerControleReleve('d1', 'releve-2025.csv', controle())
    expect(etat.appels[0].methode).toBe('upsert')
    expect(etat.appels[0].onConflict).toBe('dossier_id,source_fichier')
  })

  it('passe par le même upsert quand le relevé n’a pas de nom de fichier', async () => {
    // Pas de branche séparée : la contrainte unique est TOTALE, et deux NULL n'étant jamais égaux en
    // SQL, un relevé sans nom ne conflictue avec rien et s'insère. Une branche `insert` dédiée aurait
    // été du code mort à maintenir.
    await enregistrerControleReleve('d1', null, controle())
    expect(etat.appels[0].methode).toBe('upsert')
    expect(etat.appels[0].ligne).toMatchObject({ source_fichier: null })
  })

  it('n’échoue jamais l’import quand l’écriture du contrôle échoue', async () => {
    // Best-effort assumé : le garde-fou ne doit pas détruire ce qu'il garde. L'échec est journalisé,
    // jamais avalé en silence.
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    etat.erreurEcriture = { message: 'permission denied' }
    await expect(enregistrerControleReleve('d1', 'x.csv', controle())).resolves.toBeUndefined()
    expect(journal).toHaveBeenCalled()
    journal.mockRestore()
  })
})

describe('chargerRelevesIncoherents', () => {
  it('rend les relevés en écart', async () => {
    etat.lignes = [{ id: 'c1', ecart: 5359, coherent: false }]
    expect(await chargerRelevesIncoherents('d1')).toHaveLength(1)
  })

  it('lève quand la lecture échoue, au lieu de répondre « aucun écart »', async () => {
    // Le piège déjà rencontré ailleurs dans ce projet : un `data` nul est indiscernable d'un « rien
    // trouvé ». Rendre une liste vide ferait passer une lecture refusée pour un dossier sain — soit
    // exactement le silence que ce contrôle existe pour rompre.
    etat.erreurLecture = { message: 'permission denied' }
    // Le message porte désormais le motif rendu par `lireTout`, et il doit continuer de citer la
    // cause réelle : un refus RLS qui ressort en « lecture incomplète » sans dire pourquoi
    // n'apprendrait rien à qui le lit.
    await expect(chargerRelevesIncoherents('d1')).rejects.toThrow('Lecture des contrôles de relevé incomplète')
    await expect(chargerRelevesIncoherents('d1')).rejects.toThrow('permission denied')
  })
})
