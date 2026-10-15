"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { packageRelease } = require("../scripts/package-release");

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "petflow-release-test-"));
  t.after(() => {
    // A remoção recursiva fica restrita ao diretório temporário criado por este teste.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("petflow-release-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (args, input) => execFileSync("git", args, { cwd: root, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  git(["init", "--quiet"]);
  for (const [key, value] of Object.entries({
    "user.name": "PetFlow Test", "user.email": "release@example.test", "commit.gpgSign": "false",
    "core.autocrlf": "false", "core.symlinks": "false", "core.hooksPath": path.join(root, ".git", "unused-hooks"),
    "core.attributesFile": path.join(root, ".git", "unused-attributes")
  })) git(["config", key, value]);
  const contents = {
    "README.MD": "# PetFlow\r\n\r\nDocumentação fictícia para teste de entrega.\r\n",
    "LICENSE": "Fixture license\n",
    ".env.example": "DATABASE_URL=postgresql://user:EXAMPLE_PASSWORD@localhost/petflow\n",
    ".gitignore": "dist/\n.scratch/\n",
    "package.json": JSON.stringify({ name: "petflow", version: "1.2.3", private: true }) + "\n",
    "package-lock.json": JSON.stringify({ name: "petflow", version: "1.2.3", lockfileVersion: 3, packages: {} }) + "\n",
    "app.js": "module.exports = {};\n",
    "server.js": "require('./app');\n",
    "docs/ENTREGA-COMERCIAL.md": "# Entrega\nConteúdo fictício.\n",
    "docs/OPERACAO.md": "# Operação\nConteúdo fictício.\n",
    "docs/ACEITE.md": "# Aceite\nConteúdo fictício.\n",
    "public/marca café.txt": "Marca fictícia\n".repeat(20),
    "public/logo.bin": Buffer.from([0, 1, 2, 255, 254, 0, 128]),
    "database/sql/001_schema.sql": "CREATE TABLE example (id integer);\n",
    ".gitattributes": "* text=auto\n",
    "private/operator-notes.txt": "PRIVATE_SYNTHETIC_FIXTURE_DO_NOT_SHIP\n",
    ".scratch/local-notes.txt": "IGNORED_SYNTHETIC_FIXTURE_DO_NOT_SHIP\n"
  };
  for (const [file, content] of Object.entries(contents)) write(file, content);
  const commit = () => { git(["add", "--all"]); git(["commit", "--quiet", "-m", "Synthetic release fixture"]); };
  commit();
  assert.equal(git(["status", "--porcelain"]), "");
  return { root, git, write, commit, contents };
}

// Leitor independente do diretório central do ZIP; usa apenas zlib nativo, sem extrair no disco.
function zipContents(archive) {
  const bytes = fs.readFileSync(archive);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "ZIP deve conter diretório central");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28);
    const extraSize = bytes.readUInt16LE(cursor + 30);
    const commentSize = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameSize).toString("utf8");
    cursor += 46 + nameSize + extraSize + commentSize;
    assert.ok(name.startsWith("petflow/"));
    assert.ok(!name.split("/").includes(".."));
    if (name.endsWith("/")) continue;
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + compressedSize);
    assert.ok([0, 8].includes(method), "Compressão deve ser STORE ou DEFLATE");
    const content = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    assert.equal(content.length, size);
    assert.ok(!files.has(name.slice("petflow/".length)), "ZIP não deve conter caminhos duplicados");
    files.set(name.slice("petflow/".length), content);
  }
  return files;
}

function assertNoArtifacts(root) {
  const output = path.join(root, "dist");
  assert.deepEqual(fs.existsSync(output) ? fs.readdirSync(output) : [], []);
}

test("entrega E2E contém somente arquivos permitidos e verifica bytes, manifesto e SHA-256", t => {
  const repo = repository(t);
  const revision = repo.git(["rev-parse", "HEAD"]);
  const result = packageRelease(repo.root);
  const base = "petflow-1.2.3-" + revision.slice(0, 8);
  assert.equal(result.archive, path.join(repo.root, "dist", base + ".zip"));
  assert.equal(result.revision, revision);
  const digest = sha256(fs.readFileSync(result.archive));
  assert.equal(result.sha256, digest);
  assert.equal(fs.readFileSync(path.join(repo.root, "dist", base + ".sha256"), "utf8"), digest + "  " + base + ".zip\n");
  const manifest = JSON.parse(fs.readFileSync(path.join(repo.root, "dist", base + ".manifest.json"), "utf8"));
  assert.equal(manifest.product, "PetFlow");
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.revision, revision);
  assert.equal(manifest.archive, base + ".zip");
  assert.equal(manifest.sha256, digest);
  assert.ok(Number.isFinite(Date.parse(manifest.createdAt)));
  const archived = zipContents(result.archive);
  const expected = Object.keys(repo.contents).filter(file => ![".gitattributes", "private/operator-notes.txt", ".scratch/local-notes.txt"].includes(file)).sort();
  assert.deepEqual([...archived.keys()].sort(), expected);
  assert.deepEqual(manifest.files.map(file => file.path), expected);
  assert.equal(result.files, expected.length);
  for (const file of manifest.files) {
    const bytes = archived.get(file.path);
    const original = repo.contents[file.path];
    const canonical = Buffer.isBuffer(original) ? original : Buffer.from(original.replace(/\r\n/g, "\n"));
    assert.deepEqual(bytes, canonical, file.path + " deve conter os bytes do commit");
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, sha256(bytes));
    assert.doesNotMatch(bytes.toString("utf8"), /SYNTHETIC_FIXTURE_DO_NOT_SHIP/);
  }
  assert.equal(repo.git(["status", "--porcelain"]), "");
  assert.deepEqual(fs.readdirSync(path.join(repo.root, "dist")).sort(), [base + ".manifest.json", base + ".sha256", base + ".zip"]);
});

test("entrega rejeita alterações locais, alterações no índice e arquivos não versionados", t => {
  const repo = repository(t);
  repo.write("README.MD", "Conteúdo alterado\n");
  assert.throws(() => packageRelease(repo.root), /commit antes de empacotar/);
  repo.git(["add", "README.MD"]);
  assert.throws(() => packageRelease(repo.root), /commit antes de empacotar/);
  repo.git(["restore", "--staged", "--worktree", "--", "README.MD"]);
  repo.write("untracked.txt", "Arquivo sintético\n");
  assert.throws(() => packageRelease(repo.root), /commit antes de empacotar/);
  assertNoArtifacts(repo.root);
});

test("entrega rejeita documento obrigatório ausente ou apenas com espaços", t => {
  const repo = repository(t);
  fs.unlinkSync(path.join(repo.root, "docs/ACEITE.md"));
  repo.commit();
  assert.throws(() => packageRelease(repo.root), /Documento obrigatório ausente ou vazio: docs\/ACEITE\.md/);
  repo.write("docs/ACEITE.md", " \n\t\n");
  repo.commit();
  assert.throws(() => packageRelease(repo.root), /Documento obrigatório ausente ou vazio: docs\/ACEITE\.md/);
  assertNoArtifacts(repo.root);
});

test("entrega preserva qualquer artefato existente da revisão", t => {
  const repo = repository(t);
  const base = "dist/petflow-1.2.3-" + repo.git(["rev-parse", "HEAD"]).slice(0, 8);
  for (const extension of [".zip", ".sha256", ".manifest.json"]) {
    const artifact = base + extension;
    repo.write(artifact, "EXISTING_ARTIFACT_MUST_SURVIVE\n");
    assert.throws(() => packageRelease(repo.root), /pacote desta revisão já existe/);
    assert.equal(fs.readFileSync(path.join(repo.root, artifact), "utf8"), "EXISTING_ARTIFACT_MUST_SURVIVE\n");
    assert.deepEqual(fs.readdirSync(path.join(repo.root, "dist")), [path.basename(artifact)]);
    fs.unlinkSync(path.join(repo.root, artifact));
  }
});

test("entrega bloqueia dump versionado dentro de pasta permitida", t => {
  const repo = repository(t);
  repo.write("public/store.dump.gz", "SYNTHETIC_DUMP_FIXTURE\n");
  repo.commit();
  assert.throws(() => packageRelease(repo.root), /arquivos privados dentro das pastas de entrega/);
  assertNoArtifacts(repo.root);
});

test("entrega procura credencial nos bytes do commit mesmo com checkout marcado skip-worktree", t => {
  const repo = repository(t);
  const syntheticPassword = ["synthetic", "release", "test", "password"].join("-");
  repo.write("public/settings.csv", "connection,postgresql://fixture:" + syntheticPassword + "@example.test/fixture\n");
  repo.commit();
  repo.git(["update-index", "--skip-worktree", "public/settings.csv"]);
  repo.write("public/settings.csv", "connection,placeholder\n");
  assert.equal(repo.git(["status", "--porcelain"]), "");
  assert.throws(() => packageRelease(repo.root), error => {
    assert.match(error.message, /possível credencial.*public\/settings\.csv/);
    assert.ok(!error.message.includes(syntheticPassword));
    return true;
  });
  assertNoArtifacts(repo.root);
});

test("entrega rejeita atributos Git que retiram ou modificam arquivos e diretórios do ZIP", t => {
  const repo = repository(t);
  for (const [target, attribute] of [["docs/ACEITE.md", "export-ignore"], ["docs", "export-ignore"], ["docs/ACEITE.md", "export-subst"], ["docs/ACEITE.md", "eol=crlf"], ["docs/ACEITE.md", "ident"]]) {
    repo.write(".gitattributes", "* text=auto\n" + target + " " + attribute + "\n");
    repo.commit();
    assert.throws(() => packageRelease(repo.root), new RegExp("atributo Git " + attribute.split("=")[0]));
    assertNoArtifacts(repo.root);
  }
});

test("entrega rejeita links simbólicos versionados mesmo em checkout Windows sem symlinks", t => {
  const repo = repository(t);
  const object = repo.git(["hash-object", "-w", "--stdin"], "../private/operator-notes.txt");
  repo.git(["update-index", "--add", "--cacheinfo", "120000," + object + ",public/link.txt"]);
  repo.git(["checkout-index", "--force", "--", "public/link.txt"]);
  repo.git(["commit", "--quiet", "-m", "Synthetic symlink fixture"]);
  assert.equal(repo.git(["status", "--porcelain"]), "");
  assert.throws(() => packageRelease(repo.root), /links simbólicos ou submódulos: public\/link\.txt/);
  assertNoArtifacts(repo.root);
});
