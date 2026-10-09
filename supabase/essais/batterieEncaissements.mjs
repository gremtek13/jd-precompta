// LA BATTERIE DES ENCAISSEMENTS, JOUÉE PAR LA BASE — sur une RÉPLIQUE locale du schéma, jamais en production (ligne
// 28.5, étapes d2 et d4).
//
// src/lib/encaissementsBatterie.test.ts fige l'empreinte des réponses qu'`enregistrer_encaissement` a rendues à 4 000
// saisies tirées par src/test/encaissementsBatterie.ts, et exige que le module rende exactement les mêmes. Ce script en
// est la moitié « base » : il construit le monde fictif de la batterie dans UNE transaction, appelle la fonction en chef
// du cabinet pour chaque saisie, chacune annulée dans sa sous-transaction, ANNULE tout, puis confronte les réponses de
// la base à celles du module, saisie par saisie. Rien de ce qu'il écrit ne reste, et il ne supprime rien.
//
// LE JOUR DU RELEVÉ. La base juge « l'avenir » au jour de Paris où elle tourne, et la batterie vise ce jour, le
// lendemain et le 1er janvier qui suit : ses saisies et son empreinte en dépendent. Le script lit ce jour dans la base et
// tire la batterie pour lui. Sans écart, il rend le couple à recopier — AUJOURD_HUI_RELEVE dans
// src/test/encaissementsBatterie.ts, EMPREINTE_DE_LA_BASE dans src/lib/encaissementsBatterie.test.ts — quand le module
// ou la base a changé ce qu'ils répondent ; sinon l'empreinte figée reste celle de son jour.
//
// LA RÉPLIQUE n'est pas montée ici. Ses neuf familles d'objets doivent avoir l'empreinte de la production
// (supabase/essais/signature.sql, jouée des deux côtés), et elle doit porter les deux dossiers de la batterie (DOSSIERS)
// dont le chef du cabinet (CHEF) est administrateur : le script vérifie ces deux-là avant de jouer. Le procédé qui la
// monte, et pourquoi il n'est pas dans le dépôt : HISTORIQUE.md, entrée de l'étape d4.
//
//   node supabase/essais/batterieEncaissements.mjs --hote /var/run/postgresql --port 5432 --base replique
//
// Node 22 exécute le TypeScript du dépôt tel quel, types effacés ; un crochet de résolution ajoute l'extension `.ts` aux
// imports relatifs, que le dépôt écrit sans elle.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // Un module qui n'est pas du TypeScript du dépôt : la résolution ordinaire.
    }
  }
  return next(specifier, context)
}
register(`data:text/javascript,${encodeURIComponent(`export ${resolve}`)}`)

const CHEF = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162'

const { values: options } = parseArgs({
  options: { hote: { type: 'string' }, port: { type: 'string' }, base: { type: 'string' }, utilisateur: { type: 'string' } },
})
if (!options.hote || !options.port || !options.base) {
  console.error('Usage : node supabase/essais/batterieEncaissements.mjs --hote <socket ou hôte> --port <port> --base <base> [--utilisateur postgres]')
  process.exit(2)
}
const connexion = ['-h', options.hote, '-p', options.port, '-U', options.utilisateur ?? 'postgres', '-d', options.base]

const DEPOT = new URL('../../', import.meta.url)
const generateur = await import(new URL('src/test/encaissementsBatterie.ts', DEPOT).href)
const { DOSSIERS, GRAINE_DE_LA_BATTERIE, MONDE, SAISIES_DE_LA_BATTERIE, batterie, reponsesDuModule } = generateur

function psql(texte, fichier = false) {
  const travail = fichier ? mkdtempSync(join(tmpdir(), 'batterie-')) : null
  try {
    const args = ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', ...connexion]
    if (travail) {
      writeFileSync(join(travail, 'batterie.sql'), texte)
      args.push('-f', join(travail, 'batterie.sql'))
    } else {
      args.push('-c', texte)
    }
    const r = spawnSync('psql', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) {
      console.error(`✗ psql a échoué :\n${(r.stderr || r.stdout || '').slice(-4000)}`)
      process.exit(1)
    }
    return r.stdout
  } finally {
    if (travail) rmSync(travail, { recursive: true, force: true })
  }
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const jsonb = (o) => `${lit(JSON.stringify(o))}::jsonb`
const claims = lit(JSON.stringify({ sub: CHEF, role: 'authenticated' }))

// 1. La réplique : ses deux dossiers, administrés par le chef du cabinet ; et son jour, à Paris.
const prealables = psql(`select (now() at time zone 'Europe/Paris')::date
  || '|' || (select count(*) from public.dossiers where id in (${lit(DOSSIERS.A)}, ${lit(DOSSIERS.B)}));`).trim()
const [jour, dossiers] = prealables.split('|')
if (dossiers !== '2') {
  console.error(`✗ La réplique ne porte pas les deux dossiers de la batterie (${DOSSIERS.A}, ${DOSSIERS.B}).`)
  process.exit(1)
}
const acces = psql(`begin;
set local role authenticated;
select set_config('request.jwt.claims', ${claims}, true) is not null;
select public.admin_du_dossier(${lit(DOSSIERS.A)}) and public.admin_du_dossier(${lit(DOSSIERS.B)});
rollback;`).trim().split('\n').pop()
if (acces !== 't') {
  console.error(`✗ Le chef du cabinet (${CHEF}) n'administre pas les deux dossiers de la batterie sur la réplique.`)
  process.exit(1)
}

// 2. La batterie de ce jour, et ce que le module y répond.
const cas = batterie(SAISIES_DE_LA_BATTERIE, GRAINE_DE_LA_BATTERIE, jour)
const module = reponsesDuModule(cas, jour)

// 3. Le monde : les factures par enregistrer_facture, en chef du cabinet ; le reste en direct, sous les déclencheurs.
const sql = ['begin;', 'set local client_min_messages = warning;',
  'create temp table ids (nom text primary key, id uuid not null) on commit drop;',
  'create temp table cas (n int primary key, c jsonb not null) on commit drop;',
  'create temp table resultats (n int primary key, sortie text not null) on commit drop;',
  `insert into ids values ('A', ${lit(DOSSIERS.A)}), ('B', ${lit(DOSSIERS.B)});`]
const corps = ['do $$', 'declare v uuid; d uuid; o uuid; m uuid; e uuid; begin']
for (const f of MONDE.factures) {
  const entete = { tiers_nom: 'Essai', date_emission: f.date, montant_ht: f.entete.ht, montant_tva: f.entete.tva, montant_ttc: f.entete.ttc }
  const lignes = f.lignes.map((l) => ({ designation: 'x', quantite: l.quantite, prix_unitaire_ht: l.prix, taux_tva: l.taux }))
  corps.push(`  select id into d from ids where nom = ${lit(f.dossier)};`)
  let enteteSql = jsonb(entete)
  if (f.origine) {
    corps.push(`  select id into o from ids where nom = ${lit(f.origine)};`)
    enteteSql = `${jsonb({ ...entete, type: 'avoir' })} || jsonb_build_object('facture_origine_id', o)`
  }
  corps.push('  set local role authenticated;')
  corps.push(`  perform set_config('request.jwt.claims', ${claims}, true);`)
  corps.push(`  select r.facture_id into v from enregistrer_facture(d, null, ${enteteSql}, ${jsonb(lignes)}, ${f.statut === 'validee'}) r;`)
  corps.push('  reset role;')
  corps.push(`  insert into ids values (${lit(f.id)}, v);`)
}
for (const mv of MONDE.mouvements) {
  corps.push(`  select id into d from ids where nom = ${lit(mv.dossier)};`)
  corps.push(`  insert into lignes_bancaires (dossier_id, date, libelle, montant) values (d, '2026-09-20', 'essai', ${mv.montant}) returning id into v;`)
  corps.push(`  insert into ids values (${lit(mv.id)}, v);`)
}
for (const en of MONDE.encaissements) {
  corps.push(`  select f.id, f.dossier_id into v, d from factures_emises f where f.id = (select id from ids where nom = ${lit(en.facture)});`)
  corps.push(en.mouvement ? `  m := (select id from ids where nom = ${lit(en.mouvement)});` : '  m := null;')
  corps.push(en.annule ? `  o := (select id from ids where nom = ${lit(en.annule)});` : '  o := null;')
  corps.push('  insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) '
    + `values (d, v, '2026-09-20', ${en.montant}, 'virement', m, o, ${en.annule ? "'essai'" : 'null'}) returning id into e;`)
  for (const p of en.parts) {
    corps.push(`  insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (e, d, ${p.taux}, ${p.montant});`)
  }
  corps.push(`  insert into ids values (${lit(en.id)}, e);`)
}
for (const en of MONDE.encaissements.filter((x) => x.retire)) {
  corps.push(`  update encaissements_factures set retire_le = now(), retire_par = ${lit(CHEF)} where id = (select id from ids where nom = ${lit(en.id)});`)
}
MONDE.transmissions.forEach((t, i) => {
  const flux = ['envoi', 'echec'].includes(t.etat) ? 'null' : lit(`flux-${i + 1}`)
  corps.push(`  select f.id, f.dossier_id into v, d from factures_emises f where f.id = (select id from ids where nom = ${lit(t.facture)});`)
  corps.push('  insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) '
    + `values (d, v, 'plateforme', 'pa.exemple.fr', ${lit('ab'.repeat(32))}, ${lit(t.etat)}, ${flux});`)
})
MONDE.evenements.forEach((ev, i) => {
  corps.push(`  select f.id, f.dossier_id into v, d from factures_emises f where f.id = (select id from ids where nom = ${lit(ev.facture)});`)
  corps.push('  insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) '
    + `values (d, v, ${-(i + 1)}, ${lit(ev.code)}, 'essai', now());`)
})
corps.push('end $$;')
sql.push(...corps)

// 4. Les saisies, puis chacune jouée en chef du cabinet et annulée ; la réponse de la base, recopiée.
for (let i = 0; i < cas.length; i += 500) {
  sql.push(`insert into cas values ${cas.slice(i, i + 500).map((c, k) => `(${i + k}, ${jsonb(c)})`).join(',\n')};`)
}
sql.push(`do $$
declare
  r record; v_dossier uuid; v_facture uuid; v_ligne uuid; v_montant numeric; accepte boolean; code text; msg text;
begin
  for r in select n, c from cas order by n loop
    select id into v_dossier from ids where nom = r.c ->> 'dossier';
    select id into v_facture from ids where nom = r.c ->> 'facture';
    v_ligne := case when r.c ->> 'ligne' is null then null
                    when r.c ->> 'ligne' = 'inconnu' then gen_random_uuid()
                    else (select id from ids where nom = r.c ->> 'ligne') end;
    v_montant := case when jsonb_typeof(r.c -> 'montant') = 'number' then (r.c ->> 'montant')::numeric end;
    accepte := false; code := null; msg := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', ${claims}, true);
      perform enregistrer_encaissement(v_dossier, v_facture, (r.c ->> 'date')::date, v_montant, r.c ->> 'moyen', v_ligne,
        r.c -> 'repartition');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code := sqlstate; msg := sqlerrm;
    end;
    reset role;
    insert into resultats values (r.n, case when accepte then 'ok' else code || ' ' || msg end);
  end loop;
end $$;`)
sql.push('select n || chr(9) || sortie from resultats order by n;')
sql.push('rollback;')

const reponses = new Map()
for (const ligne of psql(`${sql.join('\n')}\n`, true).split('\n')) {
  const tab = ligne.indexOf('\t')
  if (tab > 0) reponses.set(Number(ligne.slice(0, tab)), ligne.slice(tab + 1))
}
if (reponses.size !== cas.length) {
  console.error(`✗ ${reponses.size} réponses de la base pour ${cas.length} saisies.`)
  process.exit(1)
}
const base = cas.map((_, n) => reponses.get(n))

// 5. La confrontation, saisie par saisie.
const ecarts = base.map((b, n) => (b === module[n] ? null : n)).filter((n) => n !== null)
const parRefus = new Map()
for (const b of base) {
  const cle = b === 'ok' ? 'ok' : b.slice(b.indexOf(' ') + 1, b.indexOf(' ') + 61)
  parRefus.set(cle, (parRefus.get(cle) ?? 0) + 1)
}
const empreinte = (sorties) => createHash('md5').update(sorties.join('\n')).digest('hex')
console.log(`jour du relevé, à Paris : ${jour}`)
console.log(`${cas.length} saisies, ${ecarts.length} écart(s) entre la base et le module`)
for (const n of ecarts.slice(0, 30)) {
  console.log(`  #${n} ${JSON.stringify(cas[n])}\n     base   : ${base[n]}\n     module : ${module[n]}`)
}
console.log('Réponses de la base, par refus :')
for (const [cle, k] of [...parRefus].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padStart(5)}  ${cle}`)
console.log(`empreinte base   : ${empreinte(base)}`)
console.log(`empreinte module : ${empreinte(module)}`)
process.exit(ecarts.length === 0 ? 0 : 1)
