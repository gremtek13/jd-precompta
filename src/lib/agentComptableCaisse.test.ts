import { beforeAll, describe, expect, it } from 'vitest'
import { CONTRATS, jouerScenario, type Contexte } from '../test/contratsFonctions'
import { ID, type Monde } from '../test/fonctionsEdge'

// L'ASSISTANT DEVANT LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (ligne 26.6, étape C13) : RIEN DE CHANGÉ SANS PAIEMENT.
//
// L'assistant lit les opérations de caisse de son dossier dans `points_a_traiter`, et en tire les paiements de pièces par la
// caisse comme `paiementsParLaCaisseSelon(true, …)` (src/lib/paiementParLaCaisse.ts) : le genre `paiement`, une pièce citée,
// ni retiré, ni remplacé, d'un montant non nul. SANS DRAPEAU : une telle opération n'existe qu'après la migration
// `paiement_par_la_caisse` — la base ne l'écrit que par `regler_piece_par_la_caisse` —, et c'est ce qui permet de déployer
// l'assistant AVANT elle. Encore faut-il qu'un dossier sans paiement vivant rende ce qu'il rendait, au caractère près.
//
// LA PREUVE : chaque scénario du contrat HTTP de l'assistant (src/test/contratsFonctions.ts), joué deux fois sur le même
// monde — tel quel, puis avec des opérations de caisse qui ne paient RIEN : un paiement retiré, un paiement sans pièce, un
// paiement de zéro euro, un paiement remplacé (et celle qui le remplace, retirée), et un paiement vivant d'un AUTRE dossier.
// La réponse de la fonction et tout ce que le modèle reçoit — la consigne, la description des outils, chaque résultat
// d'outil — sont les mêmes, au caractère près. Le témoin : un paiement vivant du dossier change ce que le modèle reçoit.
// Un plancher dit que la preuve n'est pas vide : des dizaines de scénarios, dont des dizaines où les outils répondent.
//
// L'autre moitié — la source d'après C13 rend, sur les mêmes mondes, ce que rendait celle d'avant, hors de la phrase neuve
// de la consigne — s'est jouée une fois, le 01/11/2026, contre une copie de la source d'avant gardée hors du dépôt : 57
// scénarios, 27 où le modèle reçoit des résultats d'outils, aucun écart (HISTORIQUE.md, « LA CAISSE : L'ASSISTANT DEVANT LE
// PAIEMENT D'UNE PIÈCE PAR LA CAISSE (C13, LIGNE 26.6) »). Ce test-ci tient la propriété qui la rend vraie pour la suite.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat = CONTRATS.find((c) => c.slug === 'agent-comptable')!

/** Une opération de caisse de genre `paiement`, de ce dossier. */
function paiement(id: string, dossierId: string, o: Record<string, unknown> = {}) {
  return {
    id, dossier_id: dossierId, genre: 'paiement', date: '2026-03-10', montant: -42, categorie_id: null, taux_tva: null,
    encaissements_du_jour: null, piece_id: 'c13f0000-0000-4000-8000-0000000000ff', origine: 'cabinet', remplace_id: null,
    cree_le: '2026-03-10T18:00:00Z', cree_par: null, retire_le: null, retire_par: null, ...o,
  }
}

/** Des opérations de caisse qui ne paient aucune pièce du dossier. */
function paiementsMorts(m: Monde) {
  ;(m.base.operations_caisse ??= []).push(
    paiement('c13f0000-0000-4000-8000-000000000001', ID.dossier, { retire_le: '2026-03-11T09:00:00Z' }),
    paiement('c13f0000-0000-4000-8000-000000000002', ID.dossier, { piece_id: null }),
    paiement('c13f0000-0000-4000-8000-000000000003', ID.dossier, { montant: 0 }),
    paiement('c13f0000-0000-4000-8000-000000000004', ID.dossier),
    paiement('c13f0000-0000-4000-8000-000000000005', ID.dossier, {
      remplace_id: 'c13f0000-0000-4000-8000-000000000004', retire_le: '2026-03-12T09:00:00Z',
    }),
    paiement('c13f0000-0000-4000-8000-000000000006', ID.dossierVoisin),
  )
}

/** Un paiement VIVANT d'une pièce du dossier : le témoin. */
function paiementVivant(m: Monde) {
  ;(m.base.operations_caisse ??= []).push(paiement('c13f0000-0000-4000-8000-000000000007', ID.dossier))
}

/** Ce qu'un scénario rend de comparable : le statut, le texte de la réponse, et tout ce que le modèle a reçu. */
async function rendu(nom: string, apres?: (m: Monde) => void) {
  const scenario = contrat.scenarios.find((s) => s.nom === nom)!
  const { monde, r } = await jouerScenario(contrat, scenario, contexte, { apres })
  const demandes = JSON.stringify(monde.notes.demandesAuModele ?? [])
  return { statut: r.statut, texte: r.texte, demandes, outils: demandes.includes('tool_use_id') }
}

// Les scénarios des mondes de C13 portent eux-mêmes des paiements vivants : ils se jugent à part, dans le contrat.
const SCENARIOS = contrat.scenarios.filter((s) => !s.nom.includes('(C13)')).map((s) => s.nom)

describe('agent-comptable : un dossier sans paiement par la caisse rend ce qu’il rendait (étape C13)', () => {
  const tels: Record<string, Awaited<ReturnType<typeof rendu>>> = {}
  const morts: Record<string, Awaited<ReturnType<typeof rendu>>> = {}
  beforeAll(async () => {
    for (const nom of SCENARIOS) {
      tels[nom] = await rendu(nom)
      morts[nom] = await rendu(nom, paiementsMorts)
    }
  }, 600_000)

  it('la preuve n’est pas vide : des dizaines de scénarios, dont des dizaines où les outils répondent', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(50)
    expect(SCENARIOS.filter((nom) => tels[nom].outils).length).toBeGreaterThanOrEqual(25)
  })

  it('des opérations qui ne paient rien — retirée, sans pièce, à zéro, remplacée, d’un autre dossier — ne changent rien, au caractère près', () => {
    const ecarts = SCENARIOS.filter((nom) => JSON.stringify(morts[nom]) !== JSON.stringify(tels[nom]))
    expect(ecarts).toEqual([])
  })

  it('le témoin : un paiement vivant du dossier change ce que le modèle reçoit de points_a_traiter', async () => {
    const nom = SCENARIOS.find((n) => tels[n].outils && tels[n].demandes.includes('points_a_traiter') && tels[n].demandes.includes('\\"caisse\\":'))
    expect(nom, 'aucun scénario où points_a_traiter répond : le témoin serait vide').toBeDefined()
    const vivant = await rendu(nom!, (m) => { paiementsMorts(m); paiementVivant(m) })
    expect(vivant.demandes).not.toBe(tels[nom!].demandes)
    expect(vivant.demandes).toContain('la caisse de ce dossier payant des pièces')
  }, 60_000)
})
