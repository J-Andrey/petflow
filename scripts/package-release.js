"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const directories = ["admin", "config", "controllers", "database/sql", "middlewares", "models", "public", "routes", "services", "scripts", "tests", "views"];
const documents = ["README.MD", "LICENSE", ".env.example", ".gitignore", "package.json", "package-lock.json", "app.js", "server.js", "railway.json", "railpack.json", "docs/ENTREGA-COMERCIAL.md", "docs/OPERACAO.md", "docs/ACEITE.md"];
function isPrivatePath(file) {
  const normalized = file.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const name = parts.at(-1);
  return normalized.startsWith("/") || parts.includes("..") || parts.some(part => [".git", ".tmp", ".backups", "node_modules", "uploads", "logs", "dist", "coverage", ".railway", ".codex", ".agents"].includes(part)) ||
    (name.startsWith(".env") && normalized !== ".env.example") || /\.(dump|log|pem|key|p12|env)$/i.test(name);
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
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git(["status", "--porcelain", "--untracked-files=normal"])) throw new Error("Salve as alterações em um commit antes de empacotar; a entrega deve corresponder a uma revisão verificável.");
  const revision = git(["rev-parse", "HEAD"]);
  const allFiles = git(["ls-tree", "-r", "--name-only", "HEAD"]).split(/\r?\n/);
  const files = shippingPaths(allFiles);
  for (const required of ["README.MD", ".env.example", "package-lock.json", "docs/ENTREGA-COMERCIAL.md", "docs/OPERACAO.md", "docs/ACEITE.md"]) {
    if (!files.includes(required) || !fs.statSync(path.join(root, required)).size) throw new Error("Documento obrigatório ausente ou vazio: " + required);
  }
  const manifestFiles = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error("A entrega não aceita links simbólicos: " + file);
    const bytes = fs.readFileSync(absolute);
    if ((/\.(js|json|md|html|sql|css|txt|ya?ml)$/i.test(file) || file === ".env.example") && containsCredential(bytes.toString("utf8"))) {
      throw new Error("Revise possível credencial no arquivo antes da entrega: " + file);
    }
    // Git normaliza texto. O manifesto informa o conteúdo canônico versionado.
    manifestFiles.push({ path: file });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version)) throw new Error("Versão de pacote inválida.");
  const outputDir = path.join(root, "dist");
  fs.mkdirSync(outputDir, { recursive: true });
  const base = "petflow-" + pkg.version + "-" + revision.slice(0, 8);
  const archive = path.join(outputDir, base + ".zip");
  if ([archive, path.join(outputDir, base + ".sha256"), path.join(outputDir, base + ".manifest.json")].some(file => fs.existsSync(file))) throw new Error("O pacote desta revisão já existe; preserve o artefato ou publique uma nova revisão.");
  const roots = [...directories, ...documents].filter(item => files.some(file => file === item || file.startsWith(item + "/")));
  // Exclusões explícitas também valem se alguém tiver versionado dados por engano.
  const excluded = allFiles.filter(file => roots.some(item => file === item || file.startsWith(item + "/")) && !files.includes(file));
  if (excluded.length) throw new Error("Há arquivos privados dentro das pastas de entrega; retire-os do versionamento antes de empacotar.");
  git(["archive", "--format=zip", "--prefix=petflow/", "--output=" + archive, "HEAD", ...roots]);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(path.join(outputDir, base + ".sha256"), digest + "  " + base + ".zip\n", { flag: "wx" });
  fs.writeFileSync(path.join(outputDir, base + ".manifest.json"), JSON.stringify({ product: "PetFlow", version: pkg.version, revision, createdAt: new Date().toISOString(), archive: path.basename(archive), sha256: digest, files: manifestFiles }, null, 2) + "\n", { flag: "wx" });
  return { archive, revision, sha256: digest, files: files.length };
}
if (require.main === module) {
  try { console.log(JSON.stringify(packageRelease(), null, 2)); }
  catch (error) { console.error(error.stderr ? "Não foi possível ler o Git ou criar o arquivo de entrega." : error.message); process.exitCode = 1; }
}
module.exports = { isPrivatePath, shippingPaths, containsCredential, packageRelease };
