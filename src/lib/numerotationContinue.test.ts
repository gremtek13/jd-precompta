import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cleDeSerie,
  compteurDansLaSerie,
  jugementDeLaSerie,
  libelleDeSerie,
  MODELES_PAR_DEFAUT,
  modelesSeRecouvrent,
  motifDuModele,
  numeroDuModele,
  NUMEROTATION_CONTINUE_PREVUE,
  REFUS_DU_MODELE,
  refusDuModele,
  type SerieAJuger,
} from './numerotationContinue'
import { indiceSql } from '../test/schema'

// LA NUMÉROTATION QUI CONTINUE (ligne 51.5, étape A9a) : le module redit la migration `numerotation_continue` — préparée le
// 10/11/2026, dans l'export le jour de son application — et les cas de son essai, supabase/essais/numerotationContinue.sql,
// tels que la réplique y a répondu (67 verdicts justes sur 67, seize mutations qui mordent). La migration se cherche où
// qu'elle soit, une fois ; ses refus se lisent dans son texte, ses cas dans celui de l'essai.

const MIGRATION = /^\d{14}_numerotation_continue\.sql$/
const ESSAI = readFileSync(new URL('../../supabase/essais/numerotationContinue.sql', import.meta.url), 'utf8')

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

/** Une fonction de la migration, de son `create function` au `$$;` qui la ferme. */
function laFonction(texte: string, nom: string): string {
  const debut = indiceSql(texte, `create function public.${nom}(`)
  expect(debut, `la définition de ${nom}`).toBeGreaterThanOrEqual(0)
  return texte.slice(debut, texte.indexOf('\n$$;', debut))
}

/** Les littéraux SQL d'un texte, dans l'ordre, les apostrophes doublées rendues simples ; un commentaire (`--` jusqu'à la
 *  fin de la ligne, hors d'un littéral) n'en porte aucun — son apostrophe décalerait toutes les suivantes. */
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

/** Le dernier littéral d'une étape de l'essai (ce qu'elle attend), repérée par son rang. */
function attenduDeLEtape(rang: number): string {
  const debut = ESSAI.indexOf(`(${rang}, '${rang}. `)
  expect(debut, `l'étape ${rang} de l'essai`).toBeGreaterThan(0)
  const fin = ESSAI.indexOf(`\n      (${rang + 1}, '`, debut)
  const corps = ESSAI.slice(debut, fin < 0 ? ESSAI.indexOf('\n    ) as t(', debut) : fin)
  const tous = litteraux(corps)
  return tous[tous.length - 1]
}

describe('le drapeau de la migration', () => {
  it('baissé : la migration est préparée, pas appliquée', () => {
    expect(NUMEROTATION_CONTINUE_PREVUE).toBe(false)
  })
})

describe('les refus d’un modèle : ceux de refus_du_modele, au caractère près, dans son ordre', () => {
  const definition = () => laFonction(laMigration(), 'refus_du_modele')

  it('chaque refus du module est un littéral de la fonction, dans l’ordre où elle les rend', () => {
    const textes = litteraux(definition()).filter((l) => l.length > 40)
    const attendus = [REFUS_DU_MODELE.alphabet, REFUS_DU_MODELE.alphabet, REFUS_DU_MODELE.compteur, REFUS_DU_MODELE.annee,
      REFUS_DU_MODELE.espaces, REFUS_DU_MODELE.annuelSansAnnee, REFUS_DU_MODELE.apresLeTiret,
      REFUS_DU_MODELE.longueur(99).replace('99', '%s')]
    expect(textes).toEqual(attendus)
  })

  it('les cas de l’essai : le module rend le refus que la base a rendu (étapes 7 à 13)', () => {
    for (const rang of [7, 8, 9, 10, 11, 12, 13]) {
      const debut = ESSAI.indexOf(`(${rang}, '${rang}. `)
      const appel = /fixer_modele_numerotation\('\{D\}', 'facture', 'client', '([^']*)', (true|false), 2026\)/.exec(ESSAI.slice(debut))
      expect(appel, `l'appel de l'étape ${rang}`).not.toBeNull()
      expect(refusDuModele(appel![1], appel![2] === 'true'), `étape ${rang}`).toBe(attenduDeLEtape(rang))
    }
  })

  it('les modèles que l’essai pose et que la base reçoit, le module les reçoit', () => {
    const poses = [...ESSAI.matchAll(/fixer_modele_numerotation\('\{D\}', '(?:facture|avoir)', '(?:client|mandataire)', '([^']*)', (true|false), (?:2000|2026|2027)(?:, \d+)?\);/g)]
    expect(poses.length).toBeGreaterThan(10)
    for (const [, modele, annuel] of poses) expect(refusDuModele(modele, annuel === 'true'), modele).toBeNull()
  })

  // Ce que la base a répondu à la sonde du 10/11/2026 (refus_du_modele sur la réplique, la migration appliquée) : null, ou
  // la clé du refus, la longueur sous son nombre de caractères. Les bornes de la longueur y sont : 35 reçus, 36 refusés.
  const SONDE: [string | null, boolean, Exclude<keyof typeof REFUS_DU_MODELE, 'longueur'> | number | null][] = [
    [null, true, 'alphabet'], ['F{AAAA}-{N:0}', true, 'alphabet'], ['F{AA}-{N:4}', true, 'alphabet'],
    ['F{N:2}-{N:3}', false, 'compteur'], ['', false, 'compteur'], [' F{N:2}', false, 'espaces'], ['F{N:2} ', false, 'espaces'],
    ['FA-{AAAA}-{N:5}', true, null], ['F-{N:9}', false, null], ['F-{AAAA}0-{N:4}', true, null],
    ['F-{AAAA}{N:5}', true, 'apresLeTiret'], ['F-CL-{N:4}', false, 'apresLeTiret'], ['F--{N:4}', false, 'apresLeTiret'],
    ['FA{AAAA}{N:4}', true, null], ['{N:4}/{AAAA}', true, null],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ{N:9}', false, null], ['ABCDEFGHIJKLMNOPQRSTUVWXYZA{N:9}', false, 36],
    ['ABCDEFGHIJKLMNOPQRSTUV{AAAA}{N:9}', true, null], ['ABCDEFGHIJKLMNOPQRSTUVW{AAAA}{N:9}', true, 36],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ{N:4}', false, null], ['ABCDEFGHIJKLMNOPQRSTUVWXYZA{N:4}', false, 36],
  ]

  it('les réponses de la base à la sonde : le module rend les mêmes', () => {
    for (const [modele, annuel, attendu] of SONDE) {
      const refus = attendu === null ? null
        : typeof attendu === 'number' ? REFUS_DU_MODELE.longueur(attendu)
          : REFUS_DU_MODELE[attendu]
      expect(refusDuModele(modele, annuel), `${modele} (${annuel})`).toBe(refus)
    }
  })
})

describe('le numéro, le motif et la clé d’une série : ceux de la migration', () => {
  it('le numéro : l’année sur quatre chiffres, le compteur sur k chiffres au moins, jamais tronqué', () => {
    expect(numeroDuModele('F{AAAA}-{N:4}', 2026, 7)).toBe('F2026-0007')
    expect(numeroDuModele('FA-{AAAA}-{N:5}', 2026, 42)).toBe('FA-2026-00042')
    expect(numeroDuModele('C{N:6}', 2026, 1)).toBe('C000001')
    expect(numeroDuModele('{N:3}', 2026, 12345)).toBe('12345')
    expect(numeroDuModele('F{AAAA}-{N:4}', 2026, 10000)).toBe('F2026-10000')
  })

  it('le modèle d’hier se formate comme numero_facture_formate (F ou A, l’année, quatre chiffres au moins)', () => {
    for (const [type, lettre] of [['facture', 'F'], ['avoir', 'A']] as const) {
      for (const n of [1, 42, 9999, 10000, 123456]) {
        expect(numeroDuModele(MODELES_PAR_DEFAUT.client[type], 2026, n)).toBe(`${lettre}2026-${String(n).padStart(4, '0')}`)
      }
    }
  })

  it('le motif : ancré, le « + » échappé, l’année de la série ou toute année, le compteur canonique', () => {
    expect(motifDuModele('F+{AAAA}-{N:3}', true, 2026)).toBe('^F\\+2026-([0-9]{3}|[1-9][0-9]{3,})$')
    expect(motifDuModele('{N:5}', false, 2026)).toBe('^([0-9]{5}|[1-9][0-9]{5,})$')
    expect(motifDuModele('F{AAAA}-{N:4}', false, 2026)).toBe('^F[0-9]{4}-([0-9]{4}|[1-9][0-9]{4,})$')
    expect(compteurDansLaSerie('F2026-0042', 'F{AAAA}-{N:4}', true, 2026)).toBe(42)
    expect(compteurDansLaSerie('F2026-00042', 'F{AAAA}-{N:4}', true, 2026)).toBeNull()
    expect(compteurDansLaSerie('F2026-10000', 'F{AAAA}-{N:4}', true, 2026)).toBe(10000)
    expect(compteurDansLaSerie('F2025-0042', 'F{AAAA}-{N:4}', true, 2026)).toBeNull()
  })

  it('le motif d’un numéro produit le relit, son compteur compris', () => {
    for (const modele of ['F{AAAA}-{N:4}', 'FA-{AAAA}-{N:5}', 'C{N:6}', '{N:4}/{AAAA}', 'F+{AAAA}-{N:3}', 'X{N:1}']) {
      for (const n of [1, 9, 10, 999, 1000, 123456789]) {
        expect(compteurDansLaSerie(numeroDuModele(modele, 2026, n), modele, true, 2026), `${modele} ${n}`).toBe(n)
      }
    }
  })

  it('la clé d’une série : celle d’hier pour les modèles d’hier, sinon le modèle (étapes 31 et 32 de l’essai)', () => {
    expect(cleDeSerie('F{AAAA}-{N:4}', true)).toBe('facture')
    expect(cleDeSerie('A{AAAA}-{N:4}', true)).toBe('avoir')
    expect(cleDeSerie('F{AAAA}-{N:4}', false)).toBe('modele:c:F{AAAA}-{N:4}')
    expect(cleDeSerie('M{AAAA}-{N:4}', true)).toBe('modele:a:M{AAAA}-{N:4}')
    expect(cleDeSerie('C{N:6}', false)).toBe('modele:c:C{N:6}')
    expect(attenduDeLEtape(31)).toContain(`${cleDeSerie('M{AAAA}-{N:4}', true)}:2026:1`)
  })

  it('les modèles par défaut sont ceux de modele_par_defaut, et le libellé d’une série celui de libelle_de_serie', () => {
    const corps = laFonction(laMigration(), 'modele_par_defaut')
    for (const emetteur of ['client', 'mandataire'] as const) {
      for (const nature of ['facture', 'avoir'] as const) {
        expect(corps).toContain(`when '${emetteur}/${nature}' then '${MODELES_PAR_DEFAUT[emetteur][nature]}'`)
      }
    }
    expect(laFonction(laMigration(), 'libelle_de_serie'))
      .toContain("select 'du modèle ' || p_modele || case when p_annuel then ' (' || p_annee::text || ')' else '' end")
    expect(libelleDeSerie('FA-{AAAA}-{N:5}', true, 2026)).toBe('du modèle FA-{AAAA}-{N:5} (2026)')
    expect(libelleDeSerie('C{N:6}', false, 2026)).toBe('du modèle C{N:6}')
  })
})

describe('le recouvrement de deux séries : celui de modeles_se_recouvrent', () => {
  // Les réponses de la réplique (sonde du 10/11/2026), dans les deux sens.
  const CAS: [string, string, boolean][] = [
    ['F{AAAA}-{N:4}', 'A{AAAA}-{N:4}', false], ['M{AAAA}-{N:4}', 'MA{AAAA}-{N:4}', false], ['{N:5}', 'F{AAAA}-{N:4}', false],
    ['{AAAA}{N:3}', '{N:6}', true], ['{N:3}', '{N:4}', true], ['F{AAAA}-{N:4}', 'F{AAAA}-{N:5}', true],
    ['X{N:1}', 'X1-{N:4}', false], ['{N:4}/{AAAA}', '{N:4}-{AAAA}', false], ['A{N:4}', 'A{AAAA}-{N:4}', false],
    ['F2026-{N:4}', 'F{AAAA}-{N:4}', true],
    // Un recouvrement qui ne paraît qu'au-delà de la longueur la plus courte : « 1212 », des deux côtés.
    ['12{N:1}', '{N:1}12', true], ['AB{N:2}', '{N:2}AB', false],
  ]

  it('les cas de la sonde, dans les deux sens', () => {
    for (const [a, b, attendu] of CAS) {
      expect(modelesSeRecouvrent(a, b), `${a} / ${b}`).toBe(attendu)
      expect(modelesSeRecouvrent(b, a), `${b} / ${a}`).toBe(attendu)
    }
  })

  it('les quatre modèles par défaut sont deux à deux séparés, et chacun reçu', () => {
    const tous = [...Object.values(MODELES_PAR_DEFAUT.client), ...Object.values(MODELES_PAR_DEFAUT.mandataire)]
    for (const m of tous) expect(refusDuModele(m, true), m).toBeNull()
    for (const a of tous) for (const b of tous) if (a !== b) expect(modelesSeRecouvrent(a, b), `${a} / ${b}`).toBe(false)
  })

  it('séparés, aucun numéro de l’un ne se lit dans l’autre (un échantillon de chaque série, trois années)', () => {
    const modeles = ['F{AAAA}-{N:4}', 'A{AAAA}-{N:4}', 'M{AAAA}-{N:4}', 'MA{AAAA}-{N:4}', '{N:5}', 'X{N:1}', 'X1-{N:4}',
      '{N:4}/{AAAA}', '{N:4}-{AAAA}', 'A{N:4}', 'FA-{AAAA}-{N:5}', 'FX{AAAA}{N:4}', 'C{N:6}', 'FA{AAAA}{N:4}']
    const compteurs = [1, 7, 42, 999, 1000, 2025, 2026, 9999, 10000, 20260, 123456, 2026000, 999999999]
    for (const a of modeles) {
      for (const b of modeles) {
        if (a === b || modelesSeRecouvrent(a, b)) continue
        for (const annee of [2025, 2026, 2027]) {
          for (const n of compteurs) {
            const numero = numeroDuModele(a, annee, n)
            for (const anneeB of [2025, 2026, 2027]) {
              expect(compteurDansLaSerie(numero, b, false, anneeB), `${numero} (${a}) lu dans ${b}`).toBeNull()
              expect(compteurDansLaSerie(numero, b, true, anneeB), `${numero} (${a}) lu dans ${b}, ${anneeB}`).toBeNull()
            }
          }
        }
      }
    }
  })
})

describe('le jugement d’une série : celui de jugement_de_la_serie, sur les cas de l’essai', () => {
  const FA = 'FA-{AAAA}-{N:5}'
  const repris = (...compteurs: number[]) => compteurs.map((n) => ({ numero: numeroDuModele(FA, 2026, n), statut: 'importee' as const }))
  const serie = (s: Partial<SerieAJuger>): SerieAJuger => ({
    modele: FA, annuel: true, annee: 2026, premierNumero: 1, depuis: 2026, numeros: [], fins: [], levees: [], ...s,
  })

  it('34. une suite reprise que le cabinet n’a pas confirmée', () => {
    const j = jugementDeLaSerie(serie({ numeros: repris(1, 2, 5) }))
    expect(j.refus).toBe(attenduDeLEtape(34))
  })

  it('35. sa fin confirmée, ses trous nommés', () => {
    const j = jugementDeLaSerie(serie({ numeros: repris(1, 2, 5), fins: [5] }))
    expect(j.trous).toEqual([[3, 4]])
    expect(j.refus).toBe(attenduDeLEtape(35))
  })

  it('36. ses trous levés, la série continue au numéro de l’essai', () => {
    const j = jugementDeLaSerie(serie({ numeros: repris(1, 2, 5), fins: [5], levees: [[3, 4]] }))
    expect(j.refus).toBeNull()
    expect(numeroDuModele(FA, 2026, j.prochain)).toBe(attenduDeLEtape(36))
  })

  it('37 et 38. une fin au-delà du plus haut repris : ce qui manque jusqu’à elle est un trou, levé la série continue', () => {
    expect(jugementDeLaSerie(serie({ numeros: repris(1, 2, 5), fins: [7], levees: [[3, 4]] })).refus).toBe(attenduDeLEtape(37))
    const j = jugementDeLaSerie(serie({ numeros: repris(1, 2, 5), fins: [7], levees: [[3, 4], [6, 7]] }))
    expect(j.refus).toBeNull()
    expect(numeroDuModele(FA, 2026, j.prochain)).toBe(attenduDeLEtape(38))
  })

  it('46. le premier numéro d’une série ouverte en cours d’année : rien ne manque avant lui', () => {
    const j = jugementDeLaSerie(serie({ premierNumero: 57, numeros: repris(57, 58), fins: [58] }))
    expect(j.refus).toBeNull()
    expect(numeroDuModele(FA, 2026, j.prochain)).toBe(attenduDeLEtape(46))
    // Une autre année, le premier numéro est 1.
    expect(jugementDeLaSerie(serie({ premierNumero: 57, depuis: 2025, numeros: repris(57, 58), fins: [58] })).trous).toEqual([[1, 56]])
  })

  it('47. des trous nombreux : les cinq premiers nommés, le reste compté', () => {
    const j = jugementDeLaSerie(serie({ numeros: repris(1, 3, 5, 7, 9, 11, 13), fins: [13] }))
    expect(j.trous).toHaveLength(6)
    expect(j.refus).toBe(attenduDeLEtape(47))
    const plus = jugementDeLaSerie(serie({ numeros: repris(1, 3, 5, 7, 9, 11, 13, 15), fins: [15] }))
    expect(plus.refus).toContain(' — et 2 intervalles de plus, 7 numéros manquants en tout.')
  })

  it('48. une série de l’application seule ne se juge pas : un trou restauré n’y retient rien', () => {
    const j = jugementDeLaSerie(serie({
      modele: 'M{AAAA}-{N:4}', depuis: null,
      numeros: [{ numero: 'M2026-0001', statut: 'validee' }, { numero: 'M2026-0003', statut: 'validee' }],
    }))
    expect(j.refus).toBeNull()
    expect(j.trous).toEqual([])
    expect(numeroDuModele('M{AAAA}-{N:4}', 2026, j.prochain)).toBe(attenduDeLEtape(48))
  })

  it('58. l’état d’une suite reprise : repris, validés, la fin, les trous', () => {
    const j = jugementDeLaSerie(serie({ numeros: repris(1, 2, 5), fins: [6] }))
    expect(`${j.importes}|${j.valides}|${j.fin}|${JSON.stringify(j.trous).replaceAll(',', ', ')}`)
      .toBe(attenduDeLEtape(58).split('|').slice(0, 4).join('|'))
  })

  it('continuée, la fin ne s’exige plus ; un numéro d’une autre série n’y compte pas', () => {
    const j = jugementDeLaSerie(serie({
      numeros: [...repris(1, 2), { numero: numeroDuModele(FA, 2026, 3), statut: 'validee' }, { numero: 'F2026-0009', statut: 'validee' }],
    }))
    expect(j.refus).toBeNull()
    expect(j.prochain).toBe(4)
  })

  it('les deux refus du jugement sont ceux de la migration, au caractère près', () => {
    const corps = laFonction(laMigration(), 'jugement_de_la_serie')
    expect(corps).toContain("v_refus := format('La suite reprise de la série %s n''est pas confirmée : le cabinet dit le dernier numéro que l''ancien logiciel y a émis (%s au moins) avant que l''application la continue.',")
    expect(corps).toContain("v_refus := format('La série %s a des trous : %s%s. Chaque numéro manquant s''importe, ou le cabinet le lève, motif écrit, avant que l''application continue la série.',")
    expect(corps).toContain("then ' — et ' || case when jsonb_array_length(v_trous) = 6 then 'un intervalle'")
    expect(corps).toContain("|| ' de plus, ' || v_nombre::text || ' numéros manquants en tout'")
    expect(corps).toContain("else public.numero_du_modele(p_modele, p_annee, (t.v->>0)::integer) || ' à '")
  })
})
