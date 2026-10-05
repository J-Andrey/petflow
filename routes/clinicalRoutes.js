"use strict";
const router = require("express").Router(),
  db = require("../database/connection"),
  clinical = require("../services/clinicalService");
router.use(
  require("../middlewares/authMiddleware"),
  require("../middlewares/roleMiddleware")("ADMIN", "GERENTE"),
);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const lists = {
  consultas: {
    select: "r.*,p.nome AS pet_nome,c.nome AS cliente_nome",
    join: "LEFT JOIN pets p ON p.id=r.pet_id AND p.empresa_id=r.empresa_id LEFT JOIN clientes c ON c.id=r.cliente_id AND c.empresa_id=r.empresa_id",
    search:
      "COALESCE(p.nome,'')||' '||COALESCE(c.nome,'')||' '||r.motivo_consulta||' '||r.status",
  },
  prontuarios: {
    select: "r.*,p.nome AS pet_nome,c.motivo_consulta AS consulta_motivo",
    join: "LEFT JOIN consultas c ON c.id=r.consulta_id AND c.empresa_id=r.empresa_id LEFT JOIN pets p ON p.id=c.pet_id AND p.empresa_id=r.empresa_id",
    search: "COALESCE(p.nome,'')||' '||COALESCE(r.diagnostico,'')",
  },
  vacinas: {
    select: "r.*",
    join: "",
    search: "r.nome||' '||COALESCE(r.fabricante,'')",
  },
  historico_vacinas: {
    select: "r.*,p.nome AS pet_nome,v.nome AS vacina_nome",
    join: "LEFT JOIN pets p ON p.id=r.pet_id AND p.empresa_id=r.empresa_id LEFT JOIN vacinas v ON v.id=r.vacina_id AND v.empresa_id=r.empresa_id",
    search:
      "COALESCE(p.nome,'')||' '||COALESCE(v.nome,'')||' '||COALESCE(r.lote,'')",
  },
};
for (const kind of Object.keys(clinical.definitions)) {
  router.get(
    "/" + kind,
    wrap(async (req, res) => {
      const page = Math.max(
        1,
        Math.min(10000, parseInt(req.query.page, 10) || 1),
      );
      const list = lists[kind];
      const { rows } = await db.query(
        `SELECT ${list.select},COUNT(*) OVER() AS total FROM ${kind} r ${list.join}
            WHERE r.empresa_id=$1 AND (${list.search}) ILIKE $3 ORDER BY r.updated_at DESC,r.id LIMIT 25 OFFSET $2`,
        [
          req.user.empresaId,
          (page - 1) * 25,
          "%" + String(req.query.q || "").slice(0, 100) + "%",
        ],
      );
      res.json({ success: true, data: rows, page });
    }),
  );
  router.post(
    "/" + kind,
    wrap(async (req, res) =>
      res
        .status(201)
        .json({ success: true, data: await clinical.save(db, req, kind) }),
    ),
  );
  router.put(
    "/" + kind + "/:id",
    wrap(async (req, res) => {
      if (!require("../services/sessionService").UUID.test(req.params.id))
        return res
          .status(400)
          .json({ success: false, message: "Identificador inválido." });
      res.json({
        success: true,
        data: await clinical.save(db, req, kind, req.params.id),
      });
    }),
  );
}
module.exports = router;
