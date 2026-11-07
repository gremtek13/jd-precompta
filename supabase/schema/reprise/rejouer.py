#!/usr/bin/env python3
"""REJOUE L'EXPORT DU SCHÉMA DANS UNE BASE VIDE (ligne 20.6) — les fondations, les migrations dans l'ordre de leur version,
chacune avec sa ligne d'historique, et le socle intercalé objet par objet. Le mode d'emploi : PLAN_DE_REPRISE.md, §4,
étape 2 ; le récit : HISTORIQUE.md, « L'EXPORT REJOUÉ DANS UNE BASE VIDE ».

POURQUOI LE SOCLE S'INTERCALE. `socle/` est un INSTANTANÉ d'aujourd'hui des douze tables créées hors migration (et de
onze objets ajoutés hors migration à d'autres tables) : il porte déjà les colonnes, contraintes, index et policies que des
migrations leur ont ajoutés ensuite. Joué avant elles, une migration bute sur « existe déjà » ; joué après, la première qui
vise une de ces tables bute sur « n'existe pas » (supabase/schema/README.md, « Restaurer un schéma »). D'où la règle,
qui ne touche à AUCUNE migration :
  1. un objet du socle qu'une migration crée (son nom dans une instruction qui le crée : `add column`, `add constraint`,
     `create index`, `create policy … on`, `create function`, `create trigger`) est laissé à cette migration ;
  2. les autres — la forme d'origine de ces tables — se posent JUSTE À TEMPS : quand une migration échoue sur un objet qui
     n'existe pas (42P01, 42703, 42704, 42883), les objets du socle qui le créent se posent, chacun dans sa transaction,
     et la migration se rejoue ; ce qui ne se pose pas encore (une clé vers une table à venir) attend ;
  3. une migration qui bute sur un objet « existe déjà » qu'un objet du socle a posé trop tôt fait REPRENDRE de zéro, cet
     objet laissé à la migration ;
  4. une migration qui supprime un objet absent de l'instantané (supprimé depuis, donc dans aucun fichier) le reçoit
     d'abord sous une forme PROVISOIRE (une colonne `text`, une policy `using (false)`, une contrainte `check (true)`),
     écrite au journal comme un arrêt contourné ; et quand une migration lit la FORME d'un tel objet (une garde de tête,
     une recopie de données), elle la reçoit d'`objets_d_hier.sql`, tirée de l'histoire du dépôt, juste avant elle ;
  5. après la dernière migration, ce qui reste du socle se pose ; ce qui existe déjà (posé par une migration) se saute ;
  6. puis `ecarts_hors_export.sql` : ce que ni les migrations ni le socle ne portent, relevé par `signature.sql`.
Une règle de plus, avant la première migration : les droits par défaut du propriétaire dans public doivent être ceux
qu'exige la garde de tête de la dernière, `droits_hors_rls` (sinon l'arrêt se dit avant de rien rejouer).
Le plan suivi s'écrit en JSON (`<journal>/plan.json`), le journal de chaque étape aussi (`<journal>/journal.txt`).

Usage (une grappe PostgreSQL 17 NEUVE, voir PLAN_DE_REPRISE.md, §4, étape 2) :
  python3 -I supabase/schema/reprise/rejouer.py --psql /usr/lib/postgresql/17/bin/psql --hote /tmp/<socket> --port <p>
          --super postgres --base <nouvelle base> --journal <dossier> [--doublure-pg-net] [--jusqua <version>]
Il crée la base `fondations_<base>` (les fondations, son modèle, retirée à la fin) puis `<base>`, qu'il recrée à chaque
reprise. Il ne s'adresse PAS à un projet Supabase : il crée et supprime des bases, et pose des fondations qu'un projet porte.
"""
import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ICI = Path(__file__).resolve().parent
EXPORT = ICI.parent
# Lire socle.py sans laisser de `__pycache__` dans supabase/essais/, que essaisEnProduction.test.ts classe fichier à fichier.
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('socle', EXPORT.parent / 'essais' / 'socle.py')
socle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(socle)

PROPRIETAIRE = 'proprietaire'
MANQUE = {'42P01', '42703', '42704', '42883'}
EXISTE = {'42701', '42710', '42P07', '42723', '42P16'}


class Reprendre(Exception):
    pass


class Arret(Exception):
    pass


def lire_args():
    a = argparse.ArgumentParser()
    a.add_argument('--psql', required=True)
    a.add_argument('--hote', required=True)
    a.add_argument('--port', required=True)
    a.add_argument('--super', default='postgres')
    a.add_argument('--base', required=True)
    a.add_argument('--journal', required=True)
    a.add_argument('--doublure-pg-net', action='store_true')
    a.add_argument('--jusqua', default='99999999999999')
    a.add_argument('--reprises', type=int, default=40)
    return a.parse_args()


A = lire_args()
JOURNAL = Path(A.journal)
JOURNAL.mkdir(parents=True, exist_ok=True)
TRACE = open(JOURNAL / 'journal.txt', 'w', encoding='utf8')


def dire(*morceaux):
    ligne = ' '.join(str(m) for m in morceaux)
    print(ligne, file=TRACE, flush=True)


def psql(role, base, texte):
    """Joue un texte SQL d'un seul tenant ; rend (code, SQLSTATE, message)."""
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf8', newline='') as f:
        f.write(texte)
    r = subprocess.run([A.psql, '-h', A.hote, '-p', A.port, '-U', role, '-d', base, '-X', '-q', '-v', 'ON_ERROR_STOP=1',
                        '-v', 'VERBOSITY=verbose', '-f', f.name], capture_output=True, text=True)
    Path(f.name).unlink()
    m = re.search(r'ERROR:\s+([0-9A-Z]{5}):\s+(.*)', r.stderr)
    return r.returncode, (m.group(1) if m else ''), (m.group(2).strip() if m else r.stderr.strip()[-400:])


def lire(base, requete):
    r = subprocess.run([A.psql, '-h', A.hote, '-p', A.port, '-U', A.super, '-d', base, '-X', '-q', '-A', '-t', '-c', requete],
                       capture_output=True, text=True)
    if r.returncode:
        raise Arret(r.stderr)
    return r.stdout.strip()


def balise(texte):
    n = 0
    while f'$h{n}$' in texte:
        n += 1
    return f'$h{n}$'


# ── Le socle, objet par objet ──────────────────────────────────────────────────────────────────────────────────────

def objets_du_socle():
    objets = []
    for f in sorted((EXPORT / 'socle').glob('*.sql')):
        for s in socle.instructions(f.read_text(encoding='utf8')):
            m = re.match(r'create table public\.(\w+) \(\n(.*)\n\);$', s, re.S)
            if m:
                t = m.group(1)
                objets.append({'cle': f'table:{t}', 'genre': 'table', 'table': t, 'nom': t, 'colonnes': []})
                for item in re.split(r',\n(?=  \S)', m.group(2)):
                    item = item.strip()
                    k = re.match(r'constraint (\S+) (.*)$', item, re.S)
                    if k:
                        objets.append({'cle': f'contrainte:{t}.{k.group(1)}', 'genre': 'contrainte', 'table': t, 'nom': k.group(1),
                                       'sql': f'alter table public.{t} add constraint {k.group(1)} {k.group(2)};',
                                       'pk': k.group(2).startswith(('PRIMARY KEY', 'UNIQUE'))})
                    else:
                        c = item.split(' ', 1)[0]
                        objets.append({'cle': f'colonne:{t}.{c}', 'genre': 'colonne', 'table': t, 'nom': c,
                                       'sql': f'alter table public.{t} add column {item};', 'def': item})
                continue
            regles = [
                (r'alter table public\.(\w+) enable row level security;$', 'rls', lambda m: (m.group(1), m.group(1))),
                (r'create policy "([^"]+)" on public\.(\w+)', 'policy', lambda m: (m.group(2), m.group(1))),
                (r'create (?:unique )?index (\w+) on public\.(\w+)', 'index', lambda m: (m.group(2), m.group(1))),
                (r'alter table public\.(\w+) add column (\w+)', 'colonne', lambda m: (m.group(1), m.group(2))),
                (r'alter table public\.(\w+) add constraint (\w+)', 'contrainte', lambda m: (m.group(1), m.group(2))),
                (r'create or replace function public\.(\w+)\(', 'fonction', lambda m: ('', m.group(1))),
                (r'create trigger (\w+) .* on public\.(\w+)', 'declencheur', lambda m: (m.group(2), m.group(1))),
            ]
            for motif, genre, prise in regles:
                m = re.match(motif, s, re.I | re.S)
                if m:
                    t, nom = prise(m)
                    objets.append({'cle': f'{genre}:{t}.{nom}', 'genre': genre, 'table': t, 'nom': nom, 'sql': s})
                    break
            else:
                raise Arret(f'instruction du socle non reconnue : {s[:120]}')
    tables = {o['table'] for o in objets if o['genre'] == 'table'}
    for o in objets:
        o['douze'] = o['table'] in tables
    return objets


def migrations():
    return sorted((p for p in EXPORT.glob('*.sql') if re.match(r'\d{14}_', p.name)), key=lambda p: p.name)


def cree_par_une_migration(o, textes):
    """Le nom de l'objet paraît-il dans une instruction d'une migration qui le CRÉE ? (règle 1)"""
    n, t = re.escape(o['nom']), re.escape(o['table'])
    motifs = {
        'colonne': rf'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?{t}\b[^;]*?\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?{n}"?\s',
        'contrainte': rf'\badd\s+constraint\s+"?{n}"?\s',
        'index': rf'create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?{n}"?\s',
        'policy': rf'create\s+policy\s+"?{n}"?\s+on\s+(?:public\.)?{t}\b',
        'fonction': rf'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?{n}\s*\(',
        'declencheur': rf'create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?{n}"?\s',
    }
    if o['genre'] not in motifs:
        return None
    for nom, texte in textes:
        if re.search(motifs[o['genre']], texte, re.I):
            return nom
    return None


def existe(base, o):
    t, n = o['table'], o['nom']
    q = {
        'table': f"select count(*) from pg_class where oid = to_regclass('public.{t}')",
        'colonne': f"select count(*) from pg_attribute where attrelid = to_regclass('public.{t}') and attname = '{n}' and not attisdropped",
        'contrainte': f"select count(*) from pg_constraint where conrelid = to_regclass('public.{t}') and conname = '{n}'",
        'index': f"select count(*) from pg_class where oid = to_regclass('public.{n}')",
        'rls': f"select count(*) from pg_class where oid = to_regclass('public.{t}') and relrowsecurity",
        'policy': f"select count(*) from pg_policies where schemaname = 'public' and tablename = '{t}' and policyname = '{n.replace(chr(39), chr(39) * 2)}'",
        'fonction': f"select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = '{n}'",
        'declencheur': f"select count(*) from pg_trigger where tgrelid = to_regclass('public.{t}') and tgname = '{n}'",
    }[o['genre']]
    return lire(base, q) != '0'


# ── La reprise ─────────────────────────────────────────────────────────────────────────────────────────────────────

def rejouer(laisses, plan):
    objets = objets_du_socle()
    textes = [(p.stem, p.read_text(encoding='utf8')) for p in migrations()]
    for o in objets:
        o['migration'] = None if o['genre'] in ('table', 'rls') else cree_par_une_migration(o, textes)
        if o['cle'] in laisses and not o['migration']:
            o['migration'] = laisses[o['cle']]
    par_cle = {o['cle']: o for o in objets}
    base = A.base
    lire('postgres', f'drop database if exists {base}')
    # Un clone ne reprend ni le propriétaire ni les réglages de sa base modèle : ils se reposent.
    lire('postgres', f'create database {base} template fondations_{base} owner {PROPRIETAIRE}')
    lire('postgres', f'alter database {base} set search_path to "$user", public, extensions')
    poses, attente, provisoires = set(), {}, []
    texte_courant = ['']
    hier = {}
    for bloc in re.split(r'^-- avant ', (ICI / 'objets_d_hier.sql').read_text(encoding='utf8'), flags=re.M)[1:]:
        cle, corps = bloc.split('\n', 1)
        hier[cle.strip()] = '\n'.join(l for l in corps.split('\n') if not l.startswith('--')).strip()

    def poser(o, avant, raison):
        if o['cle'] in poses:
            return True
        if o['genre'] == 'table':
            cols = [c['def'] for c in objets if c['genre'] == 'colonne' and c['table'] == o['table'] and c['douze']
                    and not c['migration']]
            sql = f"create table public.{o['table']} (\n  " + ',\n  '.join(cols) + '\n);'
            for c in objets:
                if c['genre'] == 'colonne' and c['table'] == o['table'] and c['douze'] and not c['migration']:
                    poses.add(c['cle'])
        else:
            sql = o['sql']
        code, etat, msg = psql(PROPRIETAIRE, base, f'begin;\n{sql}\ncommit;\n')
        if code:
            attente[o['cle']] = f'{etat} {msg}'
            dire('  socle EN ATTENTE', o['cle'], 'avant', avant, ':', etat, msg[:200])
            return False
        poses.add(o['cle'])
        attente.pop(o['cle'], None)
        plan.append({'socle': o['cle'], 'avant': avant, 'raison': raison})
        dire('  socle posé', o['cle'], 'avant', avant, f'({raison})')
        if o['genre'] == 'table':
            suite = [c for c in objets if c['table'] == o['table'] and c['genre'] in ('contrainte', 'rls', 'index', 'policy')
                     and not c['migration']]
            suite.sort(key=lambda c: (c['genre'] != 'contrainte' or not c.get('pk'), c['genre'] != 'contrainte'))
            for c in suite:
                poser(c, avant, f"avec la table {o['table']}")
        return True

    rang = {'table': 0, 'colonne': 1, 'contrainte': 2, 'index': 4, 'rls': 5, 'fonction': 6, 'declencheur': 7, 'policy': 8}

    def sql_de(o):
        if o['genre'] == 'table':
            cols = [c['def'] for c in objets if c['genre'] == 'colonne' and c['table'] == o['table'] and c['douze']
                    and not c['migration']]
            return f"create table public.{o['table']} (\n  " + ',\n  '.join(cols) + '\n);'
        return o['sql']

    def tour(avant, aussi=()):
        """Règle 2 : tout objet du socle qu'aucune migration ne crée se pose DÈS QU'IL LE PEUT, d'un seul passage avant chaque
        migration (chaque instruction sous son point de reprise : ON_ERROR_ROLLBACK) ; ce qui échoue encore attend."""
        candidats = [o for o in objets if o['cle'] not in poses and not o['migration']
                     and not (o['genre'] == 'colonne' and o['douze'])] + [o for o in aussi if o['cle'] not in poses]
        candidats = list({o['cle']: o for o in candidats}.values())
        if not candidats:
            return
        candidats.sort(key=lambda o: rang[o['genre']] + (1 if o['genre'] == 'contrainte' and not o.get('pk') else 0))
        lignes, plages = ['\\set ON_ERROR_ROLLBACK on', 'begin;'], []
        for o in candidats:
            debut = len(lignes) + 1
            lignes += sql_de(o).split('\n')
            plages.append((debut, len(lignes), o))
        lignes.append('commit;')
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf8', newline='') as f:
            f.write('\n'.join(lignes) + '\n')
        r = subprocess.run([A.psql, '-h', A.hote, '-p', A.port, '-U', PROPRIETAIRE, '-d', base, '-X', '-q', '-v',
                            'VERBOSITY=verbose', '-f', f.name], capture_output=True, text=True)
        Path(f.name).unlink()
        erreurs = [(int(m.group(1)), m.group(2), m.group(3)) for m in
                   re.finditer(r'psql:[^\n]*?:(\d+): ERROR:\s+([0-9A-Z]{5}): ([^\n]*)', r.stderr)]
        if r.returncode or 'FATAL' in r.stderr:
            raise Arret(f'le passage du socle avant {avant} a échoué : {r.stderr[-400:]}')
        for debut, fin, o in plages:
            echec = [e for e in erreurs if debut <= e[0] <= fin]
            if echec:
                attente[o['cle']] = f'{echec[0][1]} {echec[0][2]}'
                continue
            poses.add(o['cle'])
            attente.pop(o['cle'], None)
            plan.append({'socle': o['cle'], 'avant': avant})
            dire('  socle posé', o['cle'], 'avant', avant)
            if o['genre'] == 'table':
                poses.update(c['cle'] for c in objets if c['genre'] == 'colonne' and c['table'] == o['table'] and c['douze']
                             and not c['migration'])

    def besoin(etat, msg):
        """Les objets du socle qui répondent à un manque (règle 2), ou une forme provisoire (règle 4)."""
        trouves = []
        if etat == '42P01':
            m = re.search(r'relation "(?:public\.)?(\w+)" does not exist', msg)
            if m and f'table:{m.group(1)}' in par_cle:
                trouves = [par_cle[f'table:{m.group(1)}']]
        elif etat == '42703':
            m = re.search(r'column "(\w+)" of relation "(\w+)" does not exist', msg) or \
                re.search(r'column (\w+)\.(\w+) does not exist', msg)
            if m and 'of relation' in msg:
                col, t = m.group(1), m.group(2)
            elif m:
                t, col = m.group(1), m.group(2)
                # « column d.notes » : `d` est un alias ; la table se lit dans la migration (`from documents_divers d`).
                alias = re.search(rf'(?:from|join)\s+(?:public\.)?(\w+)\s+(?:as\s+)?{re.escape(t)}\b', texte_courant[0], re.I)
                if alias:
                    t = alias.group(1)
            else:
                m = re.search(r'column "(\w+)" does not exist', msg)
                col, t = (m.group(1), None) if m else (None, None)
            trouves = [o for o in objets if o['genre'] == 'colonne' and o['nom'] == col and (t is None or o['table'] == t)
                       and o['cle'] not in poses]
            if not trouves and col and t:
                trouves = [{'cle': f'provisoire:colonne:{t}.{col}', 'genre': 'provisoire', 'table': t, 'nom': col,
                            'sql': f'alter table public.{t} add column {col} text;'}]
        elif etat == '42883':
            m = re.search(r'function (?:public\.)?(\w+)\(', msg)
            if m and f'fonction:.{m.group(1)}' in par_cle:
                trouves = [par_cle[f'fonction:.{m.group(1)}']]
        elif etat == '42704':
            for motif, genre in ((r'constraint "(\w+)" of relation "(\w+)" does not exist', 'contrainte'),
                                 (r'policy "([^"]+)" for table "(\w+)" does not exist', 'policy'),
                                 (r'trigger "(\w+)" for relation "(\w+)" does not exist', 'declencheur')):
                m = re.search(motif, msg)
                if m:
                    cle = f'{genre}:{m.group(2)}.{m.group(1)}'
                    if cle in par_cle and cle not in poses:
                        trouves = [par_cle[cle]]
                    elif genre == 'policy':
                        trouves = [{'cle': f'provisoire:{cle}', 'genre': 'provisoire', 'table': m.group(2), 'nom': m.group(1),
                                    'sql': f'create policy "{m.group(1)}" on public.{m.group(2)} using (false);'}]
                    elif genre == 'contrainte':
                        trouves = [{'cle': f'provisoire:{cle}', 'genre': 'provisoire', 'table': m.group(2), 'nom': m.group(1),
                                    'sql': f'alter table public.{m.group(2)} add constraint {m.group(1)} check (true);'}]
        return trouves

    for p in migrations():
        version, nom = p.stem.split('_', 1)
        if version > A.jusqua:
            break
        texte = p.read_text(encoding='utf8')
        texte_courant[0] = texte
        tour(p.stem)
        if p.stem in hier:
            code, etat, msg = psql(PROPRIETAIRE, base, f'begin;\n{hier[p.stem]}\ncommit;\n')
            if code:
                raise Arret(f"l'objet d'hier d'avant {p.stem} ne se pose pas : {etat} {msg}")
            plan.append({'hier': p.stem})
            dire("  objet d'hier posé avant", p.stem)
        b = balise(texte)
        enveloppe = (f"begin;\n\\i '{p}'\n"
                     f"insert into supabase_migrations.schema_migrations (version, name, statements) values ('{version}', '{nom}', array[{b}{texte}{b}]);\n"
                     'commit;\n')
        for essai in range(400):
            code, etat, msg = psql(PROPRIETAIRE, base, enveloppe)
            if not code:
                plan.append({'migration': p.stem})
                dire('migration', p.stem, 'passée' + (f' (après {essai} manque(s))' if essai else ''))
                break
            dire('migration', p.stem, 'bute :', etat, msg[:300])
            if etat in MANQUE:
                trouves = besoin(etat, msg)
                if trouves:
                    for o in trouves:
                        if etat == '42704' and o['genre'] in ('contrainte', 'policy') and o['cle'] not in poses \
                                and not poser(o, p.stem, f'{etat} {msg}'[:160]):
                            # La migration supprime l'objet avant de le recréer : sa forme d'avant n'est dans aucun fichier,
                            # et celle de l'instantané vise des colonnes qui ne sont pas encore là (règle 4).
                            sql = (f"create policy \"{o['nom']}\" on public.{o['table']} using (false);" if o['genre'] == 'policy'
                                   else f"alter table public.{o['table']} add constraint {o['nom']} check (true);")
                            o = {'cle': f"provisoire:{o['cle']}", 'genre': 'provisoire', 'sql': sql}
                        if o['genre'] == 'provisoire':
                            code2, e2, m2 = psql(PROPRIETAIRE, base, f"begin;\n{o['sql']}\ncommit;\n")
                            if code2:
                                raise Arret(f'{p.stem} : la forme provisoire de {o["cle"]} ne se pose pas : {e2} {m2}')
                            provisoires.append({'objet': o['cle'], 'avant': p.stem, 'sql': o['sql'], 'manque': f'{etat} {msg}'})
                            plan.append({'provisoire': o['cle'], 'avant': p.stem, 'sql': o['sql']})
                            dire('  PROVISOIRE posé', o['cle'], ':', o['sql'])
                        elif not poser(o, p.stem, f'{etat} {msg}'[:160]):
                            raise Arret(f'{p.stem} : {o["cle"]} manque et ne se pose pas : {attente.get(o["cle"])}')
                    continue
            if etat in EXISTE:
                coupables = []
                for motif, genre in ((r'column "(\w+)" of relation "(\w+)" already exists', 'colonne'),
                                     (r'constraint "(\w+)" for relation "(\w+)" already exists', 'contrainte'),
                                     (r'policy "([^"]+)" for table "(\w+)" already exists', 'policy'),
                                     (r'trigger "(\w+)" for relation "(\w+)" already exists', 'declencheur')):
                    m = re.search(motif, msg)
                    if m:
                        coupables = [o for o in objets if o['cle'] == f'{genre}:{m.group(2)}.{m.group(1)}']
                m = re.search(r'relation "(\w+)" already exists', msg)
                if m:
                    coupables = [o for o in objets if o['genre'] in ('index', 'contrainte') and o['nom'] == m.group(1)]
                m = re.search(r'function "(\w+)" already exists', msg)
                if m:
                    coupables = [o for o in objets if o['genre'] == 'fonction' and o['nom'] == m.group(1)]
                m = re.search(r'multiple primary keys for table "(\w+)"', msg)
                if m:
                    coupables = [o for o in objets if o['genre'] == 'contrainte' and o['table'] == m.group(1)
                                 and o['sql'].split(' add constraint ', 1)[1].split(' ', 1)[1].startswith('PRIMARY KEY')]
                coupables = [o for o in coupables if o['cle'] in poses]
                if coupables:
                    for o in coupables:
                        laisses[o['cle']] = p.stem
                    raise Reprendre(f'{p.stem} : {etat} {msg} — laissé à la migration : {[o["cle"] for o in coupables]}')
            raise Arret(f'{p.stem} : {etat} {msg}')
        else:
            raise Arret(f'{p.stem} : trop de manques successifs')

    dire('— après la dernière migration : le reste du socle (règle 5) —')
    absents = []
    for o in objets:
        if o['cle'] in poses:
            continue
        if existe(base, o):
            dire('  socle déjà là', o['cle'], f"(posé par {o['migration'] or 'une migration'})")
            poses.add(o['cle'])
        else:
            absents.append(o)
    tour('fin', aussi=absents)
    reste = [o['cle'] + ' : ' + attente.get(o['cle'], '?') for o in objets if o['cle'] not in poses]
    if reste:
        raise Arret('le socle ne se pose pas tout entier à la fin : ' + ' ; '.join(reste)[:1500])
    # Règle 6 : les écarts que ni les migrations ni le socle ne portent, relevés par signature.sql, en dernier.
    code, etat, msg = psql(PROPRIETAIRE, base, 'begin;\n' + (ICI / 'ecarts_hors_export.sql').read_text(encoding='utf8') + '\ncommit;\n')
    if code:
        raise Arret(f'les écarts hors export ne se posent pas : {etat} {msg}')
    plan.append({'ecarts_hors_export': 'ecarts_hors_export.sql'})
    dire('écarts hors export posés (ecarts_hors_export.sql)')
    return provisoires


def main():
    if A.doublure_pg_net:
        dossier = Path(subprocess.run([str(Path(A.psql).parent / 'pg_config'), '--sharedir'], capture_output=True,
                                      text=True, check=True).stdout.strip()) / 'extension'
        for f in (ICI / 'pg_net').iterdir():
            if (dossier / f.name).exists():
                raise Arret(f'{dossier / f.name} existe déjà : rien n\'est écrasé')
            shutil.copy(f, dossier / f.name)
    try:
        modele = f'fondations_{A.base}'
        lire('postgres', f'drop database if exists {modele}')
        lire('postgres', f'create database {modele}')
        code, etat, msg = psql(A.super, modele, (ICI / '0_fondations_supabase.sql').read_text(encoding='utf8'))
        if code:
            raise Arret(f'fondations : {etat} {msg}')
        # Avant la première migration, ce que la dernière exigera : la garde de tête de `droits_hors_rls` (son point (e))
        # veut que le défaut du propriétaire dans public donne à anon et à authenticated les huit droits d'une table. Un
        # projet qui ne les donnerait pas se dit ici, plutôt qu'après 176 migrations (PLAN_DE_REPRISE.md, §4, étape 2).
        n = lire(modele, "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a "
                         f"where d.defaclrole = to_regrole('{PROPRIETAIRE}') and d.defaclnamespace = 'public'::regnamespace "
                         "and d.defaclobjtype = 'r' and a.grantee in (to_regrole('anon'), to_regrole('authenticated'), "
                         "to_regrole('service_role')) and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', "
                         "'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')")
        if n != '24':
            raise Arret(f'les droits par défaut de {PROPRIETAIRE} dans public ne donnent pas les huit droits d\'une table à '
                        f'anon, authenticated et service_role ({n} sur 24) : droits_hors_rls serait refusée à la fin')
        laisses, reprises = {}, 0
        while True:
            plan = []
            try:
                provisoires = rejouer(laisses, plan)
                break
            except Reprendre as r:
                reprises += 1
                dire('REPRISE', reprises, ':', r)
                if reprises > A.reprises:
                    raise Arret('trop de reprises')
        json.dump({'plan': plan, 'laisses_aux_migrations': laisses, 'provisoires': provisoires, 'reprises': reprises},
                  open(JOURNAL / 'plan.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
        lire('postgres', f'drop database {modele}')
        n = sum(1 for e in plan if 'migration' in e)
        print(f'{n} migrations rejouées, {sum(1 for e in plan if "socle" in e)} objets du socle intercalés, '
              f'{len(provisoires)} forme(s) provisoire(s), {reprises} reprise(s) ; journal : {JOURNAL}')
        return 0
    except Arret as e:
        dire('ARRÊT', e)
        print('ARRÊT :', e)
        return 1
    finally:
        if A.doublure_pg_net:
            for f in (ICI / 'pg_net').iterdir():
                (dossier / f.name).unlink(missing_ok=True)


if __name__ == '__main__':
    sys.exit(main())
