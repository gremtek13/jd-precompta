import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { refusDuModele } from './numerotationContinue'
import {
  EMPLACEMENTS, REFUS_DU_GESTE, carteDesSeries, confirmationDeLaFin, confirmationDeLaPose, confirmationDesTrous, entierSaisi,
  jugerLaFin, jugerLaPose, jugerLesTrous, libelleDEmplacement, modeleEnVigueur, modelePose, nomDIntervalle, paroleLue, serieLue,
  seriesLues, type ModelePose, type ParoleLue, type SerieLue,
} from './numerotationContinueCarte'
import { indiceSql } from '../test/schema'

// LA CARTE « NUMÉROTATION DES FACTURES » (ligne 51.5, étape A9b), sa règle : ce qu'elle lit (jugé forme par forme), ce qu'elle
// dit de chaque série, et les refus qu'elle redit avant le clic — aux mots de `fixer_modele_numerotation`,
// `confirmer_fin_de_serie` et `lever_trous_de_numerotation`, lus dans le texte de la migration préparée (A9a).

const MIGRATION = /^\d{14}_numerotation_continue\.sql$/

function laMigration(): string {
  const trouvees: string[] = []
  for (const dossier of ['../../supabase/preparees/', '../../supabase/schema/']) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (MIGRATION.test(nom)) trouvees.push(chemin + nom)
  }
  expect(trouvees, 'la migration numerotation_continue, une fois').toHaveLength(1)
  return readFileSync(trouvees[0], 'utf8')
}

function laFonction(texte: string, nom: string): string {
  const debut = indiceSql(texte, `create function public.${nom}(`)
  expect(debut, `la définition de ${nom}`).toBeGreaterThanOrEqual(0)
  return texte.slice(debut, texte.indexOf('\n$$;', debut))
}

/** Les littéraux SQL d'un texte, les apostrophes doublées rendues simples, hors commentaires. */
function litteraux(texte: string): string[] {
  const sortie: string[] = []
  let i = 0
  while (i < texte.length) {
    if (texte.startsWith('--', i)) {
      const fin = texte.indexOf('\n', i)
      i = fin < 0 ? texte.length : fin
    } else if (texte[i] === "'") {
      let j = i + 1
      let valeur = ''
      while (j < texte.length && !(texte[j] === "'" && texte[j + 1] !== "'")) {
        valeur += texte[j]
        j += texte[j] === "'" ? 2 : 1
      }
      sortie.push(valeur)
      i = j + 1
    } else {
      i++
    }
  }
  return sortie
}

const CLIENT_FACTURE = EMPLACEMENTS[0]
const CLIENT_AVOIR = EMPLACEMENTS[1]
const CABINET_FACTURE = EMPLACEMENTS[2]

function ligne(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nature: 'facture', emetteur: 'client', modele: 'F{AAAA}-{N:4}', annuel: true, depuis: null, modele_par_defaut: true, premier: 1,
    emis: null, importes: 0, valides: 0, fin: null, trous: [], refus: null, prochain_numero: 'F2026-0001', ...surcharge,
  }
}

function lesQuatre(surcharges: Record<string, unknown>[] = []): unknown[] {
  const defauts = [
    { nature: 'facture', emetteur: 'client', modele: 'F{AAAA}-{N:4}' }, { nature: 'avoir', emetteur: 'client', modele: 'A{AAAA}-{N:4}' },
    { nature: 'facture', emetteur: 'mandataire', modele: 'M{AAAA}-{N:4}' }, { nature: 'avoir', emetteur: 'mandataire', modele: 'MA{AAAA}-{N:4}' },
  ]
  return defauts.map((d, i) => ligne({ ...d, ...(surcharges[i] ?? {}) }))
}

function serie(surcharge: Partial<SerieLue> = {}): SerieLue {
  const lue = serieLue(ligne())
  if (!lue) throw new Error('la ligne de référence se lit')
  return { ...lue, ...surcharge }
}

function pose(id: string, e: (typeof EMPLACEMENTS)[number], modele: string, annuel: boolean, depuis: number): ModelePose {
  return { id, ...e, modele, annuel, depuis, premierNumero: 1 }
}

describe('ce que la carte lit : une ligne d’une autre forme rend la lecture illisible', () => {
  it('les quatre séries de la base, dans l’ordre des emplacements', () => {
    const lues = seriesLues(lesQuatre())
    expect(lues).not.toBeNull()
    expect(lues?.map((s) => `${s.nature}/${s.emetteur}`)).toEqual(['facture/client', 'avoir/client', 'facture/mandataire', 'avoir/mandataire'])
  })

  it('trois lignes, cinq, un ordre changé, ou autre chose qu’une liste : illisible', () => {
    expect(seriesLues(lesQuatre().slice(0, 3))).toBeNull()
    expect(seriesLues([...lesQuatre(), ligne()])).toBeNull()
    expect(seriesLues([...lesQuatre()].reverse())).toBeNull()
    expect(seriesLues(null)).toBeNull()
    expect(seriesLues({})).toBeNull()
  })

  it.each<[string, Record<string, unknown>]>([
    ['une nature inconnue', { nature: 'devis' }],
    ['un émetteur inconnu', { emetteur: 'banque' }],
    ['un modèle que le module refuse', { modele: 'F{AAAA}' }],
    ['un modèle annuel sans année', { modele: 'F-{N:4}', annuel: true }],
    ['un « annuel » qui n’est pas un booléen', { annuel: 'oui' }],
    ['une année d’effet hors de 2000', { depuis: 1999 }],
    ['un premier numéro à zéro', { premier: 0 }],
    ['un compteur lu décimal', { emis: 1.5 }],
    ['des numéros repris négatifs', { importes: -1 }],
    ['une fin à zéro', { fin: 0 }],
    ['des trous qui ne sont pas une liste', { trous: 'aucun' }],
    ['un trou à l’envers', { trous: [[5, 3]] }],
    ['un trou à trois bornes', { trous: [[1, 2, 3]] }],
    ['un refus vide', { refus: '' }],
    ['un numéro prochain vide', { prochain_numero: '' }],
  ])('%s', (_nom, surcharge) => {
    expect(serieLue(ligne(surcharge))).toBeNull()
  })

  it('les paroles du cabinet : une fin d’un seul numéro, un motif, un instant', () => {
    const base = { id: 'p1', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'fin', premier: 120, dernier: 120, motif: 'Dernier numéro du relevé', pose_le: '2026-11-10T10:00:00+00:00' }
    expect(paroleLue(base)).toMatchObject({ geste: 'fin', dernier: 120 })
    expect(paroleLue({ ...base, premier: 100 })).toBeNull()
    expect(paroleLue({ ...base, geste: 'trous', premier: 100 })).not.toBeNull()
    expect(paroleLue({ ...base, geste: 'trous', premier: 130 })).toBeNull()
    expect(paroleLue({ ...base, geste: 'autre' })).toBeNull()
    expect(paroleLue({ ...base, motif: '' })).toBeNull()
    expect(paroleLue({ ...base, annee: -1 })).toBeNull()
  })

  it('les modèles posés', () => {
    const base = { id: 'm1', nature: 'facture', emetteur: 'client', modele: 'F{AAAA}-{N:4}', annuel: true, depuis: 2026, premier_numero: 1 }
    expect(modelePose(base)).toMatchObject({ depuis: 2026, premierNumero: 1 })
    expect(modelePose({ ...base, depuis: 1999 })).toBeNull()
    expect(modelePose({ ...base, nature: 'x' })).toBeNull()
    expect(modelePose({ ...base, premier_numero: 0 })).toBeNull()
  })
})

describe('ce que la carte dit de chaque série', () => {
  const paroles: ParoleLue[] = [
    { id: 'f1', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'fin', premier: 120, dernier: 120, motif: 'Dernier numéro du relevé', poseLe: '2026-11-10T10:00:00+00:00' },
    { id: 't1', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'trous', premier: 7, dernier: 9, motif: 'Annulées dans l’ancien logiciel', poseLe: '2026-11-10T10:05:00+00:00' },
    { id: 't0', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2025, geste: 'trous', premier: 3, dernier: 3, motif: 'Une autre année', poseLe: '2026-11-10T10:05:00+00:00' },
    { id: 't2', modele: 'M{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'trous', premier: 1, dernier: 1, motif: 'Une autre série', poseLe: '2026-11-10T10:05:00+00:00' },
  ]

  it('le modèle, un exemple, la fin confirmée, les trous nommés et ceux qui sont levés avec leur motif — ceux de la série et de l’exercice seuls', () => {
    const lues = seriesLues(lesQuatre([{ importes: 118, emis: 118, fin: 120, trous: [[4, 5], [11, 11]], refus: 'La série du modèle F{AAAA}-{N:4} (2026) a des trous.', prochain_numero: null }]))!
    const [client] = carteDesSeries(lues, paroles, 2026)
    expect(client.titre).toBe('Factures du client')
    expect(client.modele).toBe('F{AAAA}-{N:4}')
    expect(client.exemple).toBe('F2026-0001')
    expect(client.fin).toMatchObject({ numeros: 'F2026-0120', motif: 'Dernier numéro du relevé' })
    expect(client.trous).toEqual(['F2026-0004 à F2026-0005', 'F2026-0011'])
    expect(client.leves.map((l) => [l.numeros, l.motif])).toEqual([['F2026-0007 à F2026-0009', 'Annulées dans l’ancien logiciel']])
    expect(client.reprise).toBe('118 numéros repris de l’ancien logiciel, 0 validé dans l’application.')
    expect(client.refus).toContain('a des trous')
    expect(client.prochain).toBeNull()
  })

  it('un modèle continu parle de l’année 0 des paroles ; une série sans reprise ne dit rien de reprise', () => {
    const lues = seriesLues(lesQuatre([{ modele: 'FAC-{N:5}', annuel: false, modele_par_defaut: false, depuis: 2024, prochain_numero: 'FAC-00001' }]))!
    const continues: ParoleLue[] = [{ id: 'f9', modele: 'FAC-{N:5}', annuel: false, annee: 0, geste: 'fin', premier: 40, dernier: 40, motif: 'Reprise', poseLe: '2026-11-10T10:00:00+00:00' }]
    const [client] = carteDesSeries(lues, continues, 2026)
    expect(client.compteur).toMatch(/continue/)
    expect(client.parDefaut).toBe(false)
    expect(client.fin?.numeros).toBe('FAC-00040')
    expect(client.reprise).toBeNull()
  })

  it('les trous au-delà de dix se comptent', () => {
    const trous = Array.from({ length: 13 }, (_, i): [number, number] => [i * 3 + 2, i * 3 + 2])
    const lues = seriesLues(lesQuatre([{ importes: 1, emis: 40, trous }]))!
    const [client] = carteDesSeries(lues, [], 2026)
    expect(client.trous).toHaveLength(10)
    expect(client.trousDePlus).toBe(3)
  })

  it('un intervalle se nomme en numéros', () => {
    expect(nomDIntervalle('F{AAAA}-{N:4}', 2026, [3, 3])).toBe('F2026-0003')
    expect(nomDIntervalle('F{AAAA}-{N:4}', 2026, [3, 5])).toBe('F2026-0003 à F2026-0005')
  })
})

describe('poser un modèle : le refus se dit avant le clic, sur la saisie telle qu’elle part', () => {
  const saisie = (surcharge: Partial<{ modele: string; annuel: boolean; depuis: string; premier: string }> = {}) =>
    ({ modele: 'FAC{AAAA}-{N:5}', annuel: true, depuis: '2026', premier: '1', ...surcharge })

  it('un modèle reçu part avec ses paramètres exacts', () => {
    const j = jugerLaPose('d1', CLIENT_FACTURE, saisie({ depuis: ' 2026 ', premier: '12' }), [])
    expect(j.refus).toBeNull()
    expect(j.parametres).toEqual({
      p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_modele: 'FAC{AAAA}-{N:5}', p_annuel: true, p_depuis: 2026,
      p_premier_numero: 12,
    })
  })

  it.each([['2026,5'], ['1999'], ['2100'], [''], ['abc']])('l’année d’effet « %s » est refusée', (depuis) => {
    expect(jugerLaPose('d1', CLIENT_FACTURE, saisie({ depuis }), []).refus).toBe(REFUS_DU_GESTE.depuis)
  })

  it.each([['0'], ['1000000000'], [''], ['-1'], ['1,5']])('le premier numéro « %s » est refusé', (premier) => {
    expect(jugerLaPose('d1', CLIENT_FACTURE, saisie({ premier }), []).refus).toBe(REFUS_DU_GESTE.premierNumero)
  })

  it('le refus du modèle est celui de refus_du_modele', () => {
    for (const [modele, annuel] of [['', true], ['F{AAAA}', true], ['F-{N:4}', true], ['F{N:4}é', false]] as const) {
      expect(jugerLaPose('d1', CLIENT_FACTURE, saisie({ modele, annuel }), []).refus).toBe(refusDuModele(modele, annuel))
    }
  })

  it('le modèle du cabinet ne se pose pas sous celui du client, et celui du client pas sous une racine du cabinet (G1.45)', () => {
    const j = jugerLaPose('d1', CABINET_FACTURE, saisie({ modele: 'F{AAAA}-{N:4}' }), [])
    expect(j.refus).toBe(REFUS_DU_GESTE.racinePropre('F{AAAA}-{N:4}', libelleDEmplacement(CLIENT_FACTURE)))
    const k = jugerLaPose('d1', CLIENT_FACTURE, saisie({ modele: 'M{AAAA}-{N:4}' }), [])
    expect(k.refus).toBe(REFUS_DU_GESTE.racinePropre('M{AAAA}-{N:4}', libelleDEmplacement(CABINET_FACTURE)))
  })

  it('un modèle qui recouvre celui d’un autre emplacement, ou celui qu’il remplace', () => {
    // « A{AAAA}-{N:5} » côtoie « A{AAAA}-{N:4} » des avoirs du client : un même numéro se lirait dans les deux séries.
    expect(jugerLaPose('d1', CLIENT_FACTURE, saisie({ modele: 'A{AAAA}-{N:5}' }), []).refus)
      .toBe(REFUS_DU_GESTE.recouvreUneAutre('A{AAAA}-{N:5}', libelleDEmplacement(CLIENT_AVOIR), 'A{AAAA}-{N:4}'))
    // Un second modèle des avoirs du client, recouvrant celui qu'il remplace.
    expect(jugerLaPose('d1', CLIENT_AVOIR, saisie({ modele: 'A{AAAA}-{N:5}' }), []).refus)
      .toBe(REFUS_DU_GESTE.recouvreLeSien('A{AAAA}-{N:5}', 'A{AAAA}-{N:4}'))
  })

  it('le même modèle se repose (son premier numéro change), et les factures et les avoirs d’un émetteur partagent le leur', () => {
    expect(jugerLaPose('d1', CLIENT_FACTURE, saisie({ modele: 'F{AAAA}-{N:4}', premier: '30' }), []).refus).toBeNull()
    expect(jugerLaPose('d1', CLIENT_AVOIR, saisie({ modele: 'F{AAAA}-{N:4}' }), [pose('m1', CLIENT_FACTURE, 'F{AAAA}-{N:4}', true, 2026)]).refus)
      .toBeNull()
  })

  it('un modèle posé pour une année suivante est côtoyé aussi : celui qu’on pose le rencontre', () => {
    // Les factures du client prennent « B{AAAA}-{N:4} » dès 2028 ; le poser aux avoirs du cabinet, dès 2026, lui donne le même
    // numéro dès 2028 : refusé, la série du cabinet porte une racine propre.
    const poses = [pose('m1', CLIENT_FACTURE, 'B{AAAA}-{N:4}', true, 2028)]
    expect(jugerLaPose('d1', EMPLACEMENTS[3], saisie({ modele: 'B{AAAA}-{N:4}' }), []).refus).toBeNull()
    expect(jugerLaPose('d1', EMPLACEMENTS[3], saisie({ modele: 'B{AAAA}-{N:4}' }), poses).refus)
      .toBe(REFUS_DU_GESTE.racinePropre('B{AAAA}-{N:4}', libelleDEmplacement(CLIENT_FACTURE)))
  })

  it('le modèle en vigueur : le dernier posé qui couvre l’année, sinon celui d’hier', () => {
    const poses = [pose('m1', CLIENT_FACTURE, 'X{AAAA}-{N:4}', true, 2025), pose('m2', CLIENT_FACTURE, 'Y{AAAA}-{N:4}', true, 2027)]
    expect(modeleEnVigueur(poses, CLIENT_FACTURE, 2024)).toEqual({ modele: 'F{AAAA}-{N:4}', annuel: true })
    expect(modeleEnVigueur(poses, CLIENT_FACTURE, 2026).modele).toBe('X{AAAA}-{N:4}')
    expect(modeleEnVigueur(poses, CLIENT_FACTURE, 2027).modele).toBe('Y{AAAA}-{N:4}')
    expect(modeleEnVigueur(poses, CABINET_FACTURE, 2027).modele).toBe('M{AAAA}-{N:4}')
  })

  it('la confirmation nomme le modèle, l’exemple, ce qu’il remplace, et dit qu’un modèle posé ne se retire pas', () => {
    const j = jugerLaPose('d1', CLIENT_FACTURE, saisie(), [])
    if (j.refus !== null) throw new Error('reçu')
    const texte = confirmationDeLaPose(CLIENT_FACTURE, j.parametres)
    expect(texte).toContain('« FAC{AAAA}-{N:5} »')
    expect(texte).toContain('FAC2026-00001')
    expect(texte).toContain('des factures du client')
    expect(texte).toContain('à partir de 2026')
    expect(texte).toMatch(/ne se retire jamais/)
  })
})

describe('confirmer la fin d’une suite reprise', () => {
  const reprise = serie({ importes: 3, emis: 40, premier: 1 })
  const LIBELLE = 'du modèle F{AAAA}-{N:4} (2026)'

  it('le compteur part tel que saisi, avec son motif', () => {
    const j = jugerLaFin('d1', 2026, reprise, { dernier: ' 45 ', motif: 'Dernier numéro du relevé de l’ancien logiciel' })
    expect(j.refus).toBeNull()
    expect(j.parametres).toEqual({
      p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_annee: 2026, p_dernier: 45,
      p_motif: 'Dernier numéro du relevé de l’ancien logiciel',
    })
  })

  it('le motif d’abord : vide, d’espaces, ou de plus de 1 000 caractères', () => {
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '45', motif: '   ' }).refus).toBe(REFUS_DU_GESTE.motif)
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '45', motif: 'x'.repeat(1001) }).refus).toBe(REFUS_DU_GESTE.motif)
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '45', motif: 'x'.repeat(1000) }).refus).toBeNull()
    // 1 000 caractères, dont des caractères hors du plan de base : la base compte des caractères, pas des unités UTF-16.
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '45', motif: '😀'.repeat(1000) }).refus).toBeNull()
  })

  it('une série que l’application a continuée ne se confirme plus', () => {
    const continuee = serie({ importes: 3, valides: 2, emis: 44 })
    expect(jugerLaFin('d1', 2026, continuee, { dernier: '50', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.dejaContinuee(LIBELLE))
  })

  it('au moins le plus haut repris, ou le premier de la série', () => {
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '39', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.finHorsBornes(LIBELLE, 40))
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '40', motif: 'x' }).refus).toBeNull()
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '', motif: 'x' }).refus).not.toBeNull()
    expect(jugerLaFin('d1', 2026, reprise, { dernier: '1000000000', motif: 'x' }).refus).not.toBeNull()
    // Sans rien repris : le premier de la série.
    expect(jugerLaFin('d1', 2026, serie({ premier: 30 }), { dernier: '29', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.finHorsBornes(LIBELLE, 30))
  })

  it('une fin déjà confirmée ne recule pas', () => {
    const confirmee = serie({ importes: 3, emis: 40, fin: 45 })
    expect(jugerLaFin('d1', 2026, confirmee, { dernier: '45', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.finQuiRecule(LIBELLE, 'F2026-0045'))
    expect(jugerLaFin('d1', 2026, confirmee, { dernier: '46', motif: 'x' }).refus).toBeNull()
  })

  it('la confirmation nomme le numéro, le motif, la série, et dit que la fin ne se retire jamais (A9A-Q6)', () => {
    const j = jugerLaFin('d1', 2026, reprise, { dernier: '45', motif: ' Dernier numéro du relevé ' })
    if (j.refus !== null) throw new Error('reçu')
    const texte = confirmationDeLaFin(reprise, j.parametres)
    expect(texte).toContain('F2026-0045')
    expect(texte).toContain(LIBELLE)
    expect(texte).toContain('Motif : Dernier numéro du relevé')
    expect(texte).toMatch(/ne se retire jamais/)
  })
})

describe('lever des trous', () => {
  const avecTrous = serie({ importes: 3, emis: 40, fin: 45, trous: [[4, 6], [20, 20]] })

  it('un intervalle tout entier dans un trou, motif écrit', () => {
    for (const [premier, dernier] of [['4', '6'], ['5', '5'], ['20', '20']]) {
      expect(jugerLesTrous('d1', 2026, avecTrous, { premier, dernier, motif: 'Annulés' }).refus, `${premier}-${dernier}`).toBeNull()
    }
    const j = jugerLesTrous('d1', 2026, avecTrous, { premier: '5', dernier: '6', motif: 'Annulés' })
    expect(j.parametres).toEqual({ p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_annee: 2026, p_premier: 5, p_dernier: 6, p_motif: 'Annulés' })
  })

  it('le motif d’abord, puis le trou : à cheval sur deux trous, hors de tout trou, à l’envers ou illisible', () => {
    expect(jugerLesTrous('d1', 2026, avecTrous, { premier: '4', dernier: '6', motif: '' }).refus).toBe(REFUS_DU_GESTE.motif)
    const libelle = 'du modèle F{AAAA}-{N:4} (2026)'
    expect(jugerLesTrous('d1', 2026, avecTrous, { premier: '6', dernier: '20', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.pasUnTrou('6', '20', libelle))
    expect(jugerLesTrous('d1', 2026, avecTrous, { premier: '10', dernier: '10', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.pasUnTrou('10', '10', libelle))
    expect(jugerLesTrous('d1', 2026, avecTrous, { premier: '6', dernier: '4', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.pasUnTrou('6', '4', libelle))
    expect(jugerLesTrous('d1', 2026, avecTrous, { premier: 'a', dernier: '', motif: 'x' }).refus).toBe(REFUS_DU_GESTE.pasUnTrou('?', '?', libelle))
  })

  it('une série sans trou n’en lève aucun', () => {
    expect(jugerLesTrous('d1', 2026, serie(), { premier: '1', dernier: '1', motif: 'x' }).refus).not.toBeNull()
  })

  it('la confirmation nomme les numéros levés, le motif, et dit que la levée ne se retire jamais', () => {
    const j = jugerLesTrous('d1', 2026, avecTrous, { premier: '4', dernier: '6', motif: 'Annulés' })
    if (j.refus !== null) throw new Error('reçu')
    const texte = confirmationDesTrous(avecTrous, j.parametres)
    expect(texte).toContain('F2026-0004 à F2026-0006')
    expect(texte).toContain('Motif : Annulés')
    expect(texte).toMatch(/ne se retire jamais/)
    const seul = jugerLesTrous('d1', 2026, avecTrous, { premier: '20', dernier: '20', motif: 'Annulé' })
    if (seul.refus !== null) throw new Error('reçu')
    expect(confirmationDesTrous(avecTrous, seul.parametres)).toContain('Lever le numéro F2026-0020')
  })

  it('un entier saisi : des chiffres seuls', () => {
    expect(entierSaisi(' 12 ')).toBe(12)
    for (const t of ['', '1,5', '-1', '1e3', '1 2', '0x10', '9999999999999']) expect(entierSaisi(t), t).toBeNull()
  })
})

describe('les refus du module sont ceux de la base, au caractère près (migration numerotation_continue)', () => {
  const sql = () => laMigration()
  const gabarit = (texte: string) => texte.replace(/§\d/g, '%')

  it('fixer_modele_numerotation : l’année, le premier numéro, les trois refus de recouvrement', () => {
    const lits = litteraux(laFonction(sql(), 'fixer_modele_numerotation'))
    const attendus = [
      REFUS_DU_GESTE.depuis,
      REFUS_DU_GESTE.premierNumero,
      gabarit(REFUS_DU_GESTE.racinePropre('§1', '§2')),
      gabarit(REFUS_DU_GESTE.recouvreLeSien('§1', '§2')),
      gabarit(REFUS_DU_GESTE.recouvreUneAutre('§1', '§2', '§3')),
    ]
    for (const a of attendus) expect(lits, a).toContain(a)
  })

  it('confirmer_fin_de_serie : le motif, la série continuée, les bornes de la fin, la fin qui recule', () => {
    const lits = litteraux(laFonction(sql(), 'confirmer_fin_de_serie'))
    const attendus = [
      REFUS_DU_GESTE.motif,
      gabarit(REFUS_DU_GESTE.dejaContinuee('§1')),
      gabarit(REFUS_DU_GESTE.finHorsBornes('§1', 0)).replace('au moins 0', 'au moins %'),
      gabarit(REFUS_DU_GESTE.finQuiRecule('§1', '§2')),
    ]
    for (const a of attendus) expect(lits, a).toContain(a)
  })

  it('lever_trous_de_numerotation : le motif, le numéro qui ne manque pas', () => {
    const lits = litteraux(laFonction(sql(), 'lever_trous_de_numerotation'))
    for (const a of [REFUS_DU_GESTE.motif, gabarit(REFUS_DU_GESTE.pasUnTrou('§1', '§2', '§3'))]) expect(lits, a).toContain(a)
  })

  it('libelle_d_emplacement : les mots d’un emplacement', () => {
    const texte = laFonction(sql(), 'libelle_d_emplacement')
    expect(texte).toContain("'des factures'")
    expect(texte).toContain("'des avoirs'")
    expect(texte).toContain("' du client'")
    expect(texte).toContain("' du cabinet mandataire'")
    expect(EMPLACEMENTS.map(libelleDEmplacement)).toEqual([
      'des factures du client', 'des avoirs du client', 'des factures du cabinet mandataire', 'des avoirs du cabinet mandataire',
    ])
  })

  it('l’état se lit de ce que rend etat_de_la_numerotation : mêmes colonnes, même ordre des emplacements', () => {
    const texte = laFonction(sql(), 'etat_de_la_numerotation')
    for (const colonne of ['nature text', 'emetteur text', 'modele text', 'annuel boolean', 'depuis integer', 'modele_par_defaut boolean',
      'premier integer', 'emis numeric', 'importes integer', 'valides integer', 'fin integer', 'trous jsonb', 'refus text', 'prochain_numero text']) {
      expect(texte, colonne).toContain(colonne)
    }
    expect(texte).toContain("(1, 'facture', 'client'), (2, 'avoir', 'client'), (3, 'facture', 'mandataire'), (4, 'avoir', 'mandataire')")
  })

  it('les paramètres envoyés portent les noms que les fonctions déclarent', () => {
    const entete = (nom: string) => /\(([^)]*)\)/s.exec(laFonction(sql(), nom))![1].split(',').map((p) => p.trim().split(/\s+/)[0])
    const pose = jugerLaPose('d1', CLIENT_FACTURE, { modele: 'FAC{AAAA}-{N:5}', annuel: true, depuis: '2026', premier: '1' }, [])
    const fin = jugerLaFin('d1', 2026, serie({ importes: 1, emis: 1 }), { dernier: '3', motif: 'x' })
    const trous = jugerLesTrous('d1', 2026, serie({ trous: [[2, 2]] }), { premier: '2', dernier: '2', motif: 'x' })
    expect(Object.keys(pose.parametres ?? {})).toEqual(entete('fixer_modele_numerotation'))
    expect(Object.keys(fin.parametres ?? {})).toEqual(entete('confirmer_fin_de_serie'))
    expect(Object.keys(trous.parametres ?? {})).toEqual(entete('lever_trous_de_numerotation'))
  })
})
