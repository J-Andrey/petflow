"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const directories = ["admin", "config", "controllers", "database/sql", "middlewares", "models", "public", "routes", "services", "scripts", "tests", "views"];
const documents = ["README.MD", "LICENSE", ".env.example", ".gitignore", "package.json", "package-lock.json", "app.js", "server.js", "railway.json", "railpack.json", "docs/ENTREGA-COMERCIAL.md", "docs/OPERACAO.md", "docs/ACEITE.md"];
function isPrivatePath(file) {
  const normalized = file.replace(/\\/g, "/");
  const parts = normalized.toLowerCase().split("/");
  const name = parts.at(-1);
  return normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || parts.includes("..") || parts.some(part => [".git", ".tmp", ".backups", "node_modules", "uploads", "logs", "dist", "coverage", ".railway", ".codex", ".agents"].includes(part)) ||
    (name.startsWith(".env") && normalized !== ".env.example") || /\.(dump|backup|bak|log|pem|key|p12|pfx|env)(?:\.(?:gz|zip|xz|bz2))?$/i.test(name);
}
function shippingPaths(files) {
  return files.filter(file => !isPrivatePath(file) && (documents.includes(file) || directories.some(dir => file.startsWith(dir + "/")))).sort();
}
function containsCredential(text) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) return true;
  if (/\bAIza[0-9A-Za-z_-]{35}\b/.test(text) || /\bre_[A-Za-z0-9]{24,}\b/.test(text)) return true;
  for (const match of text.matchAll(/(?:postgres(?:ql)?|cloudinary):\/\/[^\s:@/]+:([^\s@]+)@/gi)) {
    const password = match[1];
    if (!/^(?:EXAMPLE_PASSWORD|SENHA|PASSWORD|TEST_PASSWORD|sua_senha_do_postgres|\$\{[^}]+\}|<[^>]+>)$/i.test(password)) return true;
  }
  return false;
}
function packageRelease(root = path.resolve(__dirname, "..")) {
  const git = (args, options = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
  const assertClean = () => {
    if (git(["status", "--porcelain", "--untracked-files=normal"]).trim()) throw new Error("Salve as alterações em um commit antes de empacotar; a entrega deve corresponder a uma revisão verificável.");
  };
  assertClean();
  const revision = git(["rev-parse", "HEAD"]).trim();
  const entries = git(["ls-tree", "-r", "-l", "-z", revision]).split("\0").filter(Boolean).map(record => {
    const separator = record.indexOf("\t");
    const [mode, type, object, size] = record.slice(0, separator).trim().split(/\s+/);
    return { path: record.slice(separator + 1), mode, type, object, size: Number(size) };
  });
  const allFiles = entries.map(entry => entry.path);
  const files = shippingPaths(allFiles);
  const roots = [...directories, ...documents].filter(item => files.some(file => file === item || file.startsWith(item + "/")));
  // Também bloqueia dados privados versionados por engano dentro de uma pasta entregue.
  if (allFiles.some(file => roots.some(item => file === item || file.startsWith(item + "/")) && !files.includes(file))) {
    throw new Error("Há arquivos privados dentro das pastas de entrega; retire-os do versionamento antes de empacotar.");
  }
  const selected = entries.filter(entry => files.includes(entry.path));
  for (const entry of selected) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new Error("A entrega não aceita links simbólicos ou submódulos: " + entry.path);
  }
  // Lê os mesmos objetos imutáveis usados pelo ZIP, inclusive quando o checkout usa CRLF ou filtros.
  const batch = git(["cat-file", "--batch"], {
    encoding: null,
    input: selected.map(entry => entry.object).join("\n") + "\n",
    maxBuffer: Math.max(1024 * 1024, selected.reduce((total, entry) => total + entry.size + 128, 0))
  });
  const contents = new Map();
  let cursor = 0;
  for (const entry of selected) {
    const end = batch.indexOf(10, cursor);
    const [object, type, size] = batch.subarray(cursor, end).toString("utf8").split(" ");
    if (object !== entry.object || type !== "blob" || Number(size) !== entry.size) throw new Error("Não foi possível verificar o conteúdo versionado: " + entry.path);
    contents.set(entry.path, batch.subarray(end + 1, end + 1 + entry.size));
    cursor = end + entry.size + 2;
  }
  for (const required of ["README.MD", ".env.example", "package.json", "package-lock.json", "docs/ENTREGA-COMERCIAL.md", "docs/OPERACAO.md", "docs/ACEITE.md"]) {
    if (!contents.get(required)?.toString("utf8").trim()) throw new Error("Documento obrigatório ausente ou vazio: " + required);
  }
  // Esses atributos podem alterar ou retirar bytes, invalidando o manifesto e as verificações.
  const attributePaths = [...new Set(files.flatMap(file => {
    const parts = file.split("/");
    return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }))];
  const attributes = git(["check-attr", "--source=" + revision, "-z", "--stdin", "export-ignore", "export-subst", "eol", "working-tree-encoding", "ident", "filter"], { input: attributePaths.join("\0") + "\0" }).split("\0");
  for (let index = 0; index + 2 < attributes.length; index += 3) {
    const attribute = attributes[index + 1];
    const value = attributes[index + 2];
    if (!["unspecified", "unset"].includes(value) && !(attribute === "eol" && value === "lf")) throw new Error("Remova o atributo Git " + attribute + " antes de empacotar: " + attributes[index]);
  }
  const manifestFiles = [];
  for (const file of files) {
    const bytes = contents.get(file);
    if (containsCredential(bytes.toString("utf8"))) {
      throw new Error("Revise possível credencial no arquivo antes da entrega: " + file);
    }
    manifestFiles.push({ path: file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  }
  const pkg = JSON.parse(contents.get("package.json").toString("utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version)) throw new Error("Versão de pacote inválida.");
  const outputDir = path.join(root, "dist");
  if (fs.existsSync(outputDir) && fs.lstatSync(outputDir).isSymbolicLink()) throw new Error("A pasta de entrega não pode ser um link simbólico.");
  fs.mkdirSync(outputDir, { recursive: true });
  const base = "petflow-" + pkg.version + "-" + revision.slice(0, 8);
  const archive = path.join(outputDir, base + ".zip");
  if ([archive, path.join(outputDir, base + ".sha256"), path.join(outputDir, base + ".manifest.json")].some(file => fs.existsSync(file))) throw new Error("O pacote desta revisão já existe; preserve o artefato ou publique uma nova revisão.");
  const staging = fs.mkdtempSync(path.join(outputDir, ".package-"));
  try {
    const stagedArchive = path.join(staging, base + ".zip");
    git(["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=zip", "--prefix=petflow/", "--output=" + stagedArchive, revision, "--", ...roots]);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(stagedArchive)).digest("hex");
    fs.writeFileSync(path.join(staging, base + ".sha256"), digest + "  " + base + ".zip\n", { flag: "wx" });
    fs.writeFileSync(path.join(staging, base + ".manifest.json"), JSON.stringify({ product: "PetFlow", version: pkg.version, revision, createdAt: new Date().toISOString(), archive: path.basename(archive), sha256: digest, files: manifestFiles }, null, 2) + "\n", { flag: "wx" });
    assertClean();
    // A cópia exclusiva também impede sobrescrita caso outro processo publique durante a geração.
    for (const extension of [".zip", ".sha256", ".manifest.json"]) fs.copyFileSync(path.join(staging, base + extension), path.join(outputDir, base + extension), fs.constants.COPYFILE_EXCL);
    return { archive, revision, sha256: digest, files: files.length };
  } finally {
    for (const file of fs.readdirSync(staging)) fs.unlinkSync(path.join(staging, file));
    fs.rmdirSync(staging);
  }
}
if (require.main === module) {
  try { console.log(JSON.stringify(packageRelease(), null, 2)); }
  catch (error) { console.error(error.stderr ? "Não foi possível ler o Git ou criar o arquivo de entrega." : error.message); process.exitCode = 1; }
}
module.exports = { isPrivatePath, shippingPaths, containsCredential, packageRelease };
