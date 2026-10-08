import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// L'ÉMISSION PAR SUPER PDP (`superpdp-emit`, ligne 28.5, étape c) SE TESTE SUR SA VRAIE SOURCE, comme plateforme-agreee :
// le bloc ENVOI — ce que la réponse de Super PDP permet de dire — est extrait, transpilé et exécuté ; l'ordre du
// gestionnaire (juger avant tout appel, réserver avant d'envoyer) se lit sur la source. Les blocs du générateur, eux,
// sont gardés par copiesFacturation.test.ts.

const SOURCE = readFileSync(new URL('../../supabase/functions/superpdp-emit/index.ts', import.meta.url), 'utf8')

function bloc(nom: string): string {
  const debut = SOURCE.indexOf(`// ── DÉBUT ${nom} `)
  const fin = SOURCE.indexOf(`// ── FIN ${nom} `)
  expect(debut, `bornes « ${nom} » introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return SOURCE.slice(debut, fin)
}

function executer<T>(texte: string, noms: string[]): T {
  const js = ts.transpileModule(texte, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ${noms.join(', ')} }`)() as T
}

type Issue = { etat: 'depose'; id: number; detail: null } | { etat: 'echec' | 'envoi'; detail: string }
const E = executer<{
  HOTE_SUPERPDP: string
  dateDeParis: (ms: number) => string
  empreinteSha256: (octets: Uint8Array) => Promise<string>
  messageDeSuperPdp: (corps: unknown) => string | null
  issueDeLEnvoi: (statut: number, corps: unknown) => Issue
}>(bloc('ENVOI'), ['HOTE_SUPERPDP', 'dateDeParis', 'empreinteSha256', 'messageDeSuperPdp', 'issueDeLEnvoi'])

describe('superpdp-emit — ce que la réponse à l’envoi permet de dire', () => {
  it('un 2xx qui rend un id entier est un envoi', () => {
    expect(E.issueDeLEnvoi(200, { id: 42 })).toEqual({ etat: 'depose', id: 42, detail: null })
    expect(E.issueDeLEnvoi(201, { id: 7, message: 'ok' })).toEqual({ etat: 'depose', id: 7, detail: null })
  })

  it('un 2xx sans id lisible laisse l’issue inconnue : la facture est peut-être partie', () => {
    for (const corps of [null, {}, { id: '42' }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(E.issueDeLEnvoi(200, corps), JSON.stringify(corps)).toMatchObject({ etat: 'envoi', detail: expect.stringMatching(/peut-être partie/) })
    }
  })

  it('un refus 4xx n’a rien envoyé : sa raison est reprise, nettoyée et bornée', () => {
    const issue = E.issueDeLEnvoi(400, { http_status_code: 400, message: 'pre-check: receiver address\n does not accept\u0007 this document' })
    expect(issue).toEqual({
      etat: 'echec',
      detail: 'Super PDP a refusé la facture (400) : pre-check: receiver address does not accept this document. Rien n’a été envoyé.'.replace('’', "'"),
    })
    expect(E.issueDeLEnvoi(422, { error: 'x'.repeat(500) }).detail).toContain('x'.repeat(300) + '.')
    expect(E.issueDeLEnvoi(422, { error: 'x'.repeat(500) }).detail).not.toContain('x'.repeat(301))
    expect(E.issueDeLEnvoi(403, null)).toEqual({ etat: 'echec', detail: "Super PDP a refusé la facture (403). Rien n'a été envoyé." })
  })

  it('pas de réponse ou un 5xx : l’issue est inconnue, et la facture ne repart pas sans vérification', () => {
    expect(E.issueDeLEnvoi(0, null)).toMatchObject({ etat: 'envoi', detail: expect.stringMatching(/pas répondu à temps/) })
    for (const statut of [500, 502, 503]) {
      expect(E.issueDeLEnvoi(statut, { message: 'détail' }), String(statut)).toMatchObject({
        etat: 'envoi', detail: expect.stringMatching(new RegExp(`répondu ${statut} : la facture est peut-être partie`)),
      })
    }
  })

  it('le message de Super PDP : `message`, sinon `error`, une chaîne non vide', () => {
    expect(E.messageDeSuperPdp({ message: ' a ', error: 'b' })).toBe('a')
    expect(E.messageDeSuperPdp({ error: 'b' })).toBe('b')
    for (const rien of [null, {}, { message: 42 }, { message: '  ' }, 'texte']) expect(E.messageDeSuperPdp(rien)).toBeNull()
  })

  it('le jour est celui de Paris, et l’empreinte le SHA-256 du fichier', async () => {
    expect(E.dateDeParis(Date.parse('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(E.dateDeParis(Date.parse('2026-10-07T21:59:59Z'))).toBe('2026-10-07')
    const octets = new TextEncoder().encode('<facture/>')
    expect(await E.empreinteSha256(octets)).toBe(createHash('sha256').update(octets).digest('hex'))
    // L'hôte enregistré passe la contrainte de la table des transmissions.
    expect(E.HOTE_SUPERPDP).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
  })
})

// CE QUE L'HISTORIQUE DE SUPER PDP DIT DE LA TRANSMISSION (ligne 28.5, étape c4). Les codes « fr: » sont ceux des
// spécifications externes de la DGFiP : 202 à 212, la facture a été reçue par la plateforme du destinataire ; 213
// « Rejetée » et 501 « Irrecevable », elle ne l'a pas été.
type Evenement = { id: number; status_code: string; status_text: string }
const S = executer<{
  REJETS_SUPERPDP: Set<string>
  RECEPTIONS_SUPERPDP: Set<string>
  suiteDeLHistorique: (evenements: Evenement[]) => { etat: 'accepte' | 'rejete'; detail: string | null } | null
}>(bloc('SUIVI'), ['REJETS_SUPERPDP', 'RECEPTIONS_SUPERPDP', 'suiteDeLHistorique'])

describe('superpdp-emit — ce que l’historique dit de la transmission', () => {
  const ev = (id: number, status_code: string, status_text = 'texte') => ({ id, status_code, status_text })

  it('déposée, émise, validée ou inconnue : la transmission reste déposée', () => {
    expect(S.suiteDeLHistorique([])).toBeNull()
    expect(S.suiteDeLHistorique([ev(1, 'api:uploaded'), ev(2, 'api:validated'), ev(3, 'fr:200'), ev(4, 'api:sent'), ev(5, 'fr:201')])).toBeNull()
    // « api:rejected » ne dit pas si c'est l'acheteur ou une plateforme : il ne décide rien.
    expect(S.suiteDeLHistorique([ev(1, 'api:rejected'), ev(2, 'xx:999')])).toBeNull()
  })

  it('reçue par la plateforme du destinataire, ou au-delà — refusée par l’acheteur comprise : acceptée', () => {
    for (const code of ['fr:202', 'fr:203', 'fr:204', 'fr:205', 'fr:210', 'fr:212']) {
      expect(S.suiteDeLHistorique([ev(1, 'fr:200'), ev(2, code)]), code).toEqual({ etat: 'accepte', detail: null })
    }
  })

  it('rejetée, irrecevable ou invalide : rejetée, avec ce que Super PDP en dit, nettoyé et borné', () => {
    expect(S.suiteDeLHistorique([ev(1, 'fr:200'), ev(2, 'fr:213', 'Anomalie\n sur  le SIREN\u0007')]))
      .toEqual({ etat: 'rejete', detail: 'Super PDP : fr:213 — Anomalie sur le SIREN.' })
    expect(S.suiteDeLHistorique([ev(1, 'fr:501')])?.etat).toBe('rejete')
    expect(S.suiteDeLHistorique([ev(1, 'api:invalid')])?.etat).toBe('rejete')
    expect(S.suiteDeLHistorique([ev(1, 'fr:213', 'x'.repeat(500))])?.detail).toBe(`Super PDP : fr:213 — ${'x'.repeat(300)}.`)
    expect(S.suiteDeLHistorique([{ id: 1, status_code: 'fr:213', status_text: null as unknown as string }])?.detail).toBe('Super PDP : fr:213.')
  })

  it('un rejet l’emporte sur une réception, dans quelque ordre qu’ils arrivent', () => {
    expect(S.suiteDeLHistorique([ev(2, 'fr:213'), ev(1, 'fr:202')])?.etat).toBe('rejete')
    expect(S.suiteDeLHistorique([ev(1, 'fr:213'), ev(2, 'fr:202')])?.etat).toBe('rejete')
  })

  it('les codes sont ceux des statuts que l’écran sait nommer, et les deux listes ne se croisent pas', async () => {
    const { libelleStatutSuperpdp } = await import('./superpdpStatuts')
    for (const code of [...S.REJETS_SUPERPDP, ...S.RECEPTIONS_SUPERPDP]) expect(libelleStatutSuperpdp(code), code).not.toBe(code)
    expect([...S.REJETS_SUPERPDP].filter((c) => S.RECEPTIONS_SUPERPDP.has(c))).toEqual([])
    expect([...S.RECEPTIONS_SUPERPDP].sort()).toEqual(Array.from({ length: 11 }, (_, i) => `fr:${202 + i}`))
  })
})

describe('superpdp-emit — le câblage du gestionnaire', () => {
  const GESTIONNAIRE = SOURCE.slice(SOURCE.indexOf('Deno.serve('))
  const position = (texte: string) => {
    const i = GESTIONNAIRE.indexOf(texte)
    expect(i, `${texte} introuvable`).toBeGreaterThan(-1)
    return i
  }

  it('la facture se juge AVANT tout appel à Super PDP, puis se valide, se réserve, part, et son issue s’enregistre', () => {
    const etapes = [
      'rpc("admin_du_dossier"',
      '.eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()',
      'if (facture.superpdp_invoice_id) {',
      'const donnees = donneesDeLaFacture(facture,',
      'const refus = refusEmission(donnees)',
      'const cii = factureCii(donnees)',
      'const token = await obtenirToken(',
      '/v1.beta/validation_reports',
      '.insert({ dossier_id: dossierId, facture_id: factureId, canal: "superpdp", hote: HOTE_SUPERPDP, sha256: fichier.sha256 })',
      '/v1.beta/invoices?external_id=',
      'const issue = issueDeLEnvoi(statutEnvoi, corpsEnvoi)',
      '.eq("id", reservee.id).eq("etat", "envoi")',
      '.update({ superpdp_invoice_id: issue.id })',
    ].map(position)
    expect(etapes).toEqual([...etapes].sort((a, b) => a - b))
    // Rien ne part avant que la facture soit jugée et écrite : la PREMIÈRE demande de jeton et le premier appel comptent,
    // quel que soit leur nom.
    const ecrite = position('const cii = factureCii(donnees)')
    for (const appel of ['obtenirToken(', 'fetch(', 'actualiserStatut(']) {
      const i = GESTIONNAIRE.indexOf(appel)
      expect(i === -1 || i > ecrite, `${appel} avant que la facture soit écrite`).toBe(true)
    }
    expect(GESTIONNAIRE).toContain('if (refus.length > 0) {')
    // Un refus que la transmission n'a pas enregistré la laisse réservée, et l'écran le dit.
    expect(GESTIONNAIRE).toContain('const encoreReservee = erreurSuivi && issue.etat === "echec"')
    expect(GESTIONNAIRE).toContain('? " Ce refus n\'a pas pu être enregistré : la transmission reste réservée, et la facture ne repartira')
    expect(GESTIONNAIRE).toContain('return json({ error: `${issue.detail}${encoreReservee}` }, 502)')
    expect(GESTIONNAIRE).toContain('if (erreurReservation?.code === "23505") {')
    // Ce qui part est le fichier jugé, dont l'empreinte est réservée.
    expect(GESTIONNAIRE).toContain('fichier = { xml: cii.xml, sha256: await empreinteSha256(new TextEncoder().encode(cii.xml)) }')
    expect(GESTIONNAIRE).toContain('body: fichier.xml,')
    // Une issue qui n'est pas un envoi s'arrête là : le numéro Super PDP n'est posé que sur un envoi.
    // La garde doit EXISTER avant d'être à sa place : un `indexOf` à -1 passerait pour « avant tout ».
    const garde = position('if (issue.etat !== "depose") {')
    const sortie = position('return json({ error: `${issue.detail}${encoreReservee}` }, 502)')
    expect(garde).toBeLessThan(sortie)
    expect(sortie).toBeLessThan(position('.update({ superpdp_invoice_id: issue.id })'))
  })

  it('ce que l’historique dit se reporte sur la transmission déposée, après l’envoi comme à l’actualisation', () => {
    const reports = [...GESTIONNAIRE.matchAll(/await actualiserStatut\(admin, headers, dossierId, factureId, (\w+(?:\.\w+)?)\)\n\s*await reporterSurLaTransmission\(admin, factureId, \1, evenements\)/g)]
    expect(reports.map((m) => m[1])).toEqual(['numeroSuperPdp', 'issue.id'])
    expect(GESTIONNAIRE.match(/actualiserStatut\(/g)).toHaveLength(2)
    const report = SOURCE.slice(SOURCE.indexOf('async function reporterSurLaTransmission('), SOURCE.indexOf('// ── DÉBUT CLÉS SUPABASE'))
    expect(report).toContain('const suite = suiteDeLHistorique(evenements)')
    expect(report).toContain('.eq("facture_id", factureId).eq("canal", "superpdp").eq("flux_id", String(superpdpInvoiceId)).eq("etat", "depose")')
    expect(report).toContain('const { error } = await admin.from("transmissions_factures")')
  })

  it('une facture dont le numéro Super PDP ne s’est pas écrit se suit par sa transmission, et le reprend', () => {
    const numero = position('let numeroSuperPdp = facture.superpdp_invoice_id')
    expect(numero).toBeLessThan(position('const token = await obtenirToken('))
    expect(GESTIONNAIRE).toContain('.eq("facture_id", factureId).eq("canal", "superpdp").not("flux_id", "is", null)')
    expect(GESTIONNAIRE).toContain('if (erreurTransmise) {')
    expect(GESTIONNAIRE).toContain('if (Number.isSafeInteger(lu) && lu > 0) numeroSuperPdp = lu')
    expect(GESTIONNAIRE).toContain('if (!numeroSuperPdp) {')
    // Le numéro se repose avec le statut, sur la facture.
    expect(SOURCE).toContain('.update({ superpdp_dernier_statut: dernier?.status_code ?? null, superpdp_invoice_id: superpdpInvoiceId })')
  })

  it('l’envoi a un délai, et Super PDP ne convertit plus rien', () => {
    expect(GESTIONNAIRE).toContain('signal: AbortSignal.timeout(DELAI_ENVOI_MS),')
    expect(SOURCE).not.toMatch(/invoices\/convert|construireEnInvoice|from=en16931/)
  })

  it('les journaux ne portent ni la facture ni le fichier', () => {
    const journaux = [...SOURCE.matchAll(/console\.(?:log|error|warn)\(`([^`]*)`/g)].map((m) => m[1])
    expect(journaux.length).toBeGreaterThan(4)
    for (const j of journaux) expect(j, j).not.toMatch(/\$\{(?:fichier|cii|enInvoice|facture\.|corps|validationBody|JSON\.stringify)/)
  })
})
