import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOSSIER_DU_CABINET_PREVU } from './dossierDuCabinet'
import { lireLeMandataire } from './mandataireLecture'

// LE NOM DU CABINET QUI VALIDE, LU POUR L'ÉCRAN (étape P4). Ce que ces cas gardent : le nom est celui du cabinet du DOSSIER
// (`cabinets.nom` du `cabinet_id` du dossier, comme `enregistrer_facture` le lit) ; et la lecture ne REJETTE jamais — une
// requête qui lève ou qu'on refuse, une ligne absente, une colonne qui ne revient pas, tombent du côté signalé avec leur
// motif, jamais en un nom deviné. La désignation du dossier du cabinet (LM1, en production depuis le 12/11/2026) se lit avec le
// nom, le drapeau levé ; baissé, l'état d'avant, elle ne se nomme pas (ses deux états joués par un accesseur ; le dossier du
// cabinet lui-même, « sans mandat », dans dossierDuCabinetLecture.test.ts). Données FICTIVES.

const faux = vi.hoisted(() => ({
  dossiers: [] as Record<string, unknown>[],
  cabinets: [] as Record<string, unknown>[],
  refus: {} as Record<string, string | undefined>,
  leve: {} as Record<string, boolean | undefined>,
  requetes: [] as { table: string; colonnes: string; filtres: [string, unknown][] }[],
  // Le drapeau de la désignation, forcé par un cas ; `undefined` : l'état réel.
  designation: undefined as boolean | undefined,
}))

vi.mock('./dossierDuCabinet', async (original) => {
  const reel = await original<typeof import('./dossierDuCabinet')>()
  return { ...reel, get DOSSIER_DU_CABINET_PREVU() { return faux.designation ?? reel.DOSSIER_DU_CABINET_PREVU } }
})

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const requete = { table, colonnes: '', filtres: [] as [string, unknown][] }
        faux.requetes.push(requete)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string) => { requete.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          maybeSingle: () => {
            if (faux.leve[table]) return Promise.reject(new Error('réseau coupé'))
            const refus = faux.refus[table]
            if (refus) return Promise.resolve({ data: null, error: { message: refus } })
            const source = table === 'dossiers' ? faux.dossiers : table === 'cabinets' ? faux.cabinets : null
            if (source === null) throw new Error(`Table non attendue dans ce test : ${table}`)
            const lignes = filtrer(source, predicats)
            // Seules les colonnes demandées reviennent : une colonne absente de la demande est absente de la ligne.
            const demandees = requete.colonnes.split(',').map((x) => x.trim())
            const ligne = lignes[0] ? Object.fromEntries(Object.entries(lignes[0]).filter(([k]) => demandees.includes(k))) : null
            return Promise.resolve({ data: ligne, error: null })
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.dossiers = [{ id: 'd1', cabinet_id: 'c1' }, { id: 'd2', cabinet_id: 'c2' }]
  faux.cabinets = [{ id: 'c1', nom: 'Cabinet Fictif', dossier_du_cabinet: null }, { id: 'c2', nom: 'Autre Cabinet', dossier_du_cabinet: null }]
  faux.refus = {}
  faux.leve = {}
  faux.requetes = []
  faux.designation = undefined
})

// Les colonnes du cabinet que la lecture demande : le nom, et la désignation le drapeau levé.
const COLONNES_DU_CABINET = () => (DOSSIER_DU_CABINET_PREVU ? 'nom, dossier_du_cabinet' : 'nom')

describe('lireLeMandataire', () => {
  it('rend le nom du cabinet DU dossier, jamais celui d’un autre', async () => {
    expect(await lireLeMandataire('d1')).toEqual({ etat: 'lu', nom: 'Cabinet Fictif' })
    expect(await lireLeMandataire('d2')).toEqual({ etat: 'lu', nom: 'Autre Cabinet' })
    expect(faux.requetes.map((r) => [r.table, r.colonnes, r.filtres])).toEqual([
      ['dossiers', 'cabinet_id', [['id', 'd1']]], ['cabinets', COLONNES_DU_CABINET(), [['id', 'c1']]],
      ['dossiers', 'cabinet_id', [['id', 'd2']]], ['cabinets', COLONNES_DU_CABINET(), [['id', 'c2']]],
    ])
  })

  it('un refus de la base ou une requête qui lève : illisible, avec son motif, sans rejeter', async () => {
    faux.refus = { dossiers: 'Accès refusé' }
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible', motif: expect.stringContaining('Accès refusé') })
    faux.refus = { cabinets: 'Accès refusé au cabinet' }
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible', motif: expect.stringContaining('Accès refusé au cabinet') })
    faux.refus = {}
    faux.leve = { cabinets: true }
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible', motif: expect.stringContaining('réseau coupé') })
    faux.leve = { dossiers: true }
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible' })
  })

  it('un dossier, un cabinet ou un nom que la lecture ne rend pas : illisible — jamais un nom deviné', async () => {
    expect(await lireLeMandataire('inconnu')).toEqual({ etat: 'illisible', motif: 'le dossier n’a pas été trouvé' })
    faux.dossiers = [{ id: 'd1', cabinet_id: null }]
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible' })
    faux.dossiers = [{ id: 'd1', cabinet_id: 'absent' }]
    expect(await lireLeMandataire('d1')).toEqual({ etat: 'illisible', motif: 'le cabinet n’a pas été trouvé' })
    faux.dossiers = [{ id: 'd1', cabinet_id: 'c1' }]
    faux.cabinets = [{ id: 'c1', nom: null, dossier_du_cabinet: null }]
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible' })
    faux.cabinets = [{ id: 'c1', dossier_du_cabinet: null }]
    expect(await lireLeMandataire('d1')).toMatchObject({ etat: 'illisible' })
  })

  it('un nom vide est LU tel quel : c’est le jugement de la saisie qui le retient', async () => {
    faux.cabinets = [{ id: 'c1', nom: '', dossier_du_cabinet: null }]
    expect(await lireLeMandataire('d1')).toEqual({ etat: 'lu', nom: '' })
  })

  it('le drapeau de la désignation baissé (l’état d’avant) : elle ne se nomme pas, et le nom se lit', async () => {
    faux.designation = false
    expect(await lireLeMandataire('d1')).toEqual({ etat: 'lu', nom: 'Cabinet Fictif' })
    expect(faux.requetes.map((r) => r.colonnes)).toEqual(['cabinet_id', 'nom'])
  })

  it('levé : une désignation que la lecture ne rend pas est illisible ; le dossier que son cabinet désigne, sans mandat', async () => {
    faux.designation = true
    faux.cabinets = [{ id: 'c1', nom: 'Cabinet Fictif' }]
    expect(await lireLeMandataire('d1')).toEqual({ etat: 'illisible', motif: 'la désignation du dossier du cabinet n’a pas été rendue' })
    faux.cabinets = [{ id: 'c1', nom: 'Cabinet Fictif', dossier_du_cabinet: 'd1' }]
    expect(await lireLeMandataire('d1')).toEqual({ etat: 'sans_mandat' })
  })
})
