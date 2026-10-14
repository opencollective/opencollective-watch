// Indexes the GraphQL queries of our services by the hash Watch computes in
// production (setGraphqlHash: md5 of the query text, first 8 characters), so
// /graphql can link a hash to its definition on GitHub.
//
//   node scripts/graphql-index.js [--releases 3] [--dir ~/Dev/opencollective]
//
// For each service, it reads the commits of its latest deploys from Heroku
// (`heroku releases`), checks each one out in a temporary git worktree of the
// local clone (<dir>/<service>, fetched first), and finds its gql`…` documents.
// It rebuilds them with the service's own graphql-tag (fragments interpolated
// with ${…} resolved through imports) and prints them as its Apollo Client
// sends them (__typename added, client-only directives removed). The local
// clone's node_modules are used, so they should be installed.
//
// Writes graphql-index.json. Older deploys are indexed too: browsers keep
// running an older frontend bundle for a while.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVICES = [
  {
    name: 'frontend',
    dir: 'frontend',
    repo: 'opencollective/opencollective-frontend',
    app: 'oc-prod-frontend',
  },
  {
    name: 'rest',
    dir: 'rest',
    repo: 'opencollective/opencollective-rest',
    app: 'oc-prod-rest-api',
  },
  {
    name: 'images',
    dir: 'images',
    repo: 'opencollective/opencollective-images',
    app: 'oc-prod-image-server',
  },
  {
    name: 'pdf',
    dir: 'pdf',
    repo: 'opencollective/opencollective-pdf',
    app: 'oc-prod-pdf',
  },
  {
    name: 'contributors-svg',
    dir: 'contributors-svg',
    repo: 'opencollective/contributors-svg',
    app: 'contributors-svg',
  },
];

const OUTPUT = path.join(__dirname, '..', 'graphql-index.json');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
// Tags whose templates are GraphQL documents. One that isn't imported (e.g. a
// local alias of String.raw) sends its text as is.
const TAGS = new Set(['gql', 'gqlV1', 'graphql']);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const log = (message) => process.stderr.write(`${message}\n`);
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...options });

// The commits of the latest deploys of a Heroku app, newest first
function deployedCommits(app, count) {
  const releases = JSON.parse(
    run('heroku', ['releases', '-a', app, '-n', '50', '--json']),
  );
  const commits = [];
  for (const release of releases) {
    const match = /^Deploy ([0-9a-f]{7,40})\b/.exec(release.description || '');
    if (match && !commits.includes(match[1])) {
      commits.push(match[1]);
    }
    if (commits.length === count) {
      break;
    }
  }
  return commits;
}

// Extraction

function createIndexer(modulesDir) {
  const load = (name) => require(path.join(modulesDir, name));
  const ts = load('typescript');
  const gqlTag = load('graphql-tag');
  const apollo = load('@apollo/client/utilities');
  // Apollo Client 4 moved it to utilities/internal
  let removeDirectives = apollo.removeDirectivesFromDocument;
  if (!removeDirectives) {
    try {
      removeDirectives = load(
        '@apollo/client/utilities/internal',
      ).removeDirectivesFromDocument;
    } catch {
      removeDirectives = null;
    }
  }
  gqlTag.disableFragmentWarnings();

  // What Apollo Client sends: __typename added, client-only directives removed
  const serverQuery = (doc) => {
    let query = apollo.addTypenameToDocument(doc);
    if (removeDirectives) {
      query =
        removeDirectives(
          [
            { name: 'client', remove: true },
            { name: 'connection' },
            { name: 'nonreactive' },
            { name: 'unmask' },
          ],
          query,
        ) || query;
    }
    return apollo.print(query);
  };

  return (root) => {
    const files = run('git', ['ls-files'], { cwd: root })
      .split('\n')
      .filter((file) => EXTENSIONS.includes(path.extname(file)))
      .filter((file) => !/(^|\/)(node_modules|dist|\.next)\//.test(file));

    const modules = new Map();
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      if (/gql|graphql/.test(text)) {
        modules.set(file, parseModule(ts, file, text));
      }
    }

    const resolveModule = (fromFile, spec) => {
      let base;
      if (spec.startsWith('.')) {
        base = path.join(path.dirname(fromFile), spec);
      } else if (spec.startsWith('@/')) {
        base = spec.slice(2);
      } else {
        return null;
      }
      base = path.normalize(base);
      const candidates = [
        base,
        ...EXTENSIONS.map((ext) => base + ext),
        ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
      ];
      return candidates.find((candidate) => modules.has(candidate)) || null;
    };

    // The template an expression (`fragment`, `fragments.name`) refers to
    const findTemplate = (mod, expr, seen = new Set()) => {
      const key = `${mod.file}:${expr}`;
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      if (mod.byName.has(expr)) {
        return mod.byName.get(expr);
      }
      const last = expr.split('.').pop();
      if (expr.includes('.') && mod.byName.has(last)) {
        return mod.byName.get(last);
      }
      const imported = mod.imports.get(expr.split('.')[0]);
      if (!imported) {
        return null;
      }
      const target = resolveModule(mod.file, imported.from);
      if (!target) {
        return null;
      }
      const rest = expr.includes('.')
        ? expr.split('.').slice(1).join('.')
        : null;
      if (imported.name === '*') {
        return rest ? findExport(modules.get(target), rest, seen) : null;
      }
      return findExport(
        modules.get(target),
        rest ? `${imported.name}.${rest}` : imported.name,
        seen,
      );
    };

    const findExport = (mod, expr, seen) => {
      const found = findTemplate(mod, expr, seen);
      if (found) {
        return found;
      }
      for (const reexport of mod.reexports) {
        if (reexport.name === '*' || reexport.name === expr.split('.')[0]) {
          const target = resolveModule(mod.file, reexport.from);
          const result =
            target &&
            findExport(
              modules.get(target),
              reexport.name === '*' ? expr : reexport.imported,
              seen,
            );
          if (result) {
            return result;
          }
        }
      }
      return null;
    };

    // The DocumentNode graphql-tag builds for a template
    const documents = new Map();
    const build = (template, stack = []) => {
      if (documents.has(template)) {
        return documents.get(template);
      }
      if (stack.includes(template)) {
        throw new Error('fragment cycle');
      }
      const values = template.exprs.map((expr) => {
        const target = findTemplate(template.mod, expr);
        if (!target) {
          throw new Error(`unresolved \${${expr}}`);
        }
        return build(target, [...stack, template]);
      });
      const strings = Object.assign([...template.parts], {
        raw: [...template.parts],
      });
      const doc = gqlTag.gql(strings, ...values);
      documents.set(template, doc);
      return doc;
    };

    const queries = [];
    const errors = [];
    for (const mod of modules.values()) {
      for (const template of mod.templates) {
        let text;
        let operation;
        if (template.raw) {
          // Sent as written: only plain operations can be indexed
          text = template.parts.length === 1 ? template.parts[0] : null;
          const match =
            text && /^\s*(query|mutation|subscription)\b\s*(\w+)?/.exec(text);
          if (!match) {
            continue;
          }
          operation = { kind: match[1], name: match[2] || null };
        } else {
          let doc;
          try {
            doc = build(template);
          } catch (error) {
            errors.push({
              file: mod.file,
              line: template.line,
              error: error.message,
            });
            continue;
          }
          const operations = doc.definitions.filter(
            (def) => def.kind === 'OperationDefinition',
          );
          if (operations.length !== 1) {
            continue; // fragments
          }
          text = serverQuery(doc);
          operation = {
            kind: operations[0].operation,
            name: operations[0].name ? operations[0].name.value : null,
          };
        }
        queries.push({
          hash: crypto.createHash('md5').update(text).digest('hex').slice(0, 8),
          operation: operation.name,
          kind: operation.kind,
          file: mod.file,
          line: template.line,
          endLine: template.endLine,
        });
      }
    }
    return { queries, errors };
  };
}

// Imports, re-exports and gql templates of a source file
function parseModule(ts, file, text) {
  const scriptKind = file.endsWith('x')
    ? ts.ScriptKind.TSX
    : file.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const mod = {
    file,
    imports: new Map(),
    reexports: [],
    byName: new Map(),
    templates: [],
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const from = node.moduleSpecifier.text;
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        mod.imports.set(bindings.name.text, { from, name: '*' });
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          mod.imports.set(element.name.text, {
            from,
            name: (element.propertyName || element.name).text,
          });
        }
      }
      if (node.importClause.name) {
        mod.imports.set(node.importClause.name.text, { from, name: 'default' });
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const from = node.moduleSpecifier.text;
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          mod.reexports.push({
            name: element.name.text,
            imported: (element.propertyName || element.name).text,
            from,
          });
        }
      } else {
        mod.reexports.push({ name: '*', from });
      }
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      TAGS.has(node.tag.getText(source))
    ) {
      const tag = node.tag.getText(source);
      const literal = node.template;
      const plain = ts.isNoSubstitutionTemplateLiteral(literal);
      const parts = plain
        ? [literal.text]
        : [
            literal.head.text,
            ...literal.templateSpans.map((s) => s.literal.text),
          ];
      const exprs = plain
        ? []
        : literal.templateSpans.map((s) => s.expression.getText(source));
      let parent = node.parent;
      while (
        parent &&
        (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent))
      ) {
        parent = parent.parent;
      }
      let name = null;
      if (
        parent &&
        ts.isVariableDeclaration(parent) &&
        ts.isIdentifier(parent.name)
      ) {
        name = parent.name.text;
      } else if (parent && ts.isPropertyAssignment(parent)) {
        name = parent.name.getText(source);
      }
      const template = {
        mod,
        name,
        parts,
        exprs,
        raw: !mod.imports.has(tag) && tag !== 'graphql',
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      };
      mod.templates.push(template);
      if (name && !mod.byName.has(name)) {
        mod.byName.set(name, template);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return mod;
}

// Main

function main() {
  const baseDir = option(
    'dir',
    path.join(os.homedir(), 'Dev', 'opencollective'),
  );
  const releases = Number(option('releases', 3));
  const index = {
    generatedAt: new Date().toISOString(),
    services: {},
    queries: {},
  };

  for (const service of SERVICES) {
    const clone = path.join(baseDir, service.dir);
    if (!fs.existsSync(path.join(clone, '.git'))) {
      log(`${service.name}: no clone in ${clone}, skipped`);
      continue;
    }
    const commits = deployedCommits(service.app, releases);
    if (commits.length === 0) {
      log(
        `${service.name}: no deploy found in the releases of ${service.app}, skipped`,
      );
      continue;
    }
    run('git', ['fetch', '--quiet', 'origin'], { cwd: clone });
    const indexer = createIndexer(path.join(clone, 'node_modules'));
    const deploys = [];
    // Oldest first, so the newest definition of a hash wins
    for (const short of [...commits].reverse()) {
      const commit = run('git', ['rev-parse', `${short}^{commit}`], {
        cwd: clone,
      }).trim();
      const worktree = fs.mkdtempSync(
        path.join(os.tmpdir(), `graphql-index-${service.name}-`),
      );
      run('git', ['worktree', 'add', '--quiet', '--detach', worktree, commit], {
        cwd: clone,
      });
      try {
        const { queries, errors } = indexer(worktree);
        for (const { hash, ...query } of queries) {
          // A hash found again in a newer deploy keeps only its definitions
          // there (several places can define the same query)
          const definitions = (index.queries[hash] || []).filter(
            (def) => def.service !== service.name || def.commit === commit,
          );
          index.queries[hash] = [
            ...definitions,
            { service: service.name, commit, ...query },
          ];
        }
        deploys.push({ commit, queries: queries.length, errors });
        log(
          `${service.name} ${commit.slice(0, 8)}: ${queries.length} queries, ${errors.length} unresolved`,
        );
        for (const error of errors) {
          log(`  ${error.file}:${error.line} ${error.error}`);
        }
      } finally {
        run('git', ['worktree', 'remove', '--force', worktree], { cwd: clone });
      }
    }
    index.services[service.name] = {
      repo: service.repo,
      deploys: deploys.reverse(),
    };
  }

  index.queries = Object.fromEntries(
    Object.entries(index.queries).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(OUTPUT, `${JSON.stringify(index, null, 2)}\n`);
  log(
    `${Object.keys(index.queries).length} hashes written to ${path.relative(process.cwd(), OUTPUT)}`,
  );
}

main();
