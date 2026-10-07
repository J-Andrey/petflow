"use strict";
const crypto = require("node:crypto");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const hash = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");
function validatePosition(data, now = Date.now()) {
  const { latitude, longitude, precisao_m, observado_em, direcao, velocidade } =
    data || {};
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(precisao_m) ||
    precisao_m < 0 ||
    precisao_m > 200 ||
    !Number.isFinite(observado_em) ||
    Math.abs(now - observado_em) > 60000 ||
    (direcao != null &&
      (!Number.isFinite(direcao) || direcao < 0 || direcao >= 360)) ||
    (velocidade != null &&
      (!Number.isFinite(velocidade) || velocidade < 0 || velocidade > 80))
  )
    fail("Posição inválida, antiga ou imprecisa.");
  return {
    latitude,
    longitude,
    precisao_m,
    observado_em: new Date(observado_em),
    direcao: direcao ?? null,
    velocidade: velocidade ?? null,
  };
}
async function createLink(db, request, id) {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM vendas WHERE id=$1 AND empresa_id=$2 AND status='SAIU_PARA_ENTREGA' FOR UPDATE",
      [id, request.user.empresaId],
    );
    if (!rows[0]) fail("Pedido não está em entrega.", 409);
    const token = crypto.randomBytes(32).toString("hex");
    await client.query(
      `INSERT INTO entrega_rastreamento(venda_id,token_hash,expira_em) VALUES($1,$2,NOW()+INTERVAL '12 hours')
            ON CONFLICT(venda_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expira_em=EXCLUDED.expira_em,
            latitude=NULL,longitude=NULL,precisao_m=NULL,direcao=NULL,velocidade=NULL,atualizado_em=NULL,observado_em=NULL,rota=NULL,rota_solicitada_em=NULL`,
      [id, hash(token)],
    );
    await require("./auditService").record(
      client,
      request,
      "GERAR_LINK",
      "entrega",
      id,
      null,
      { status: "SAIU_PARA_ENTREGA" },
    );
    return {
      url: "/entrega.html#" + token,
      expira_em: new Date(Date.now() + 43200000).toISOString(),
    };
  });
}
async function driver(db, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token)))
    fail("Link de entrega inválido.", 401);
  const { rows } = await db.query(
    `SELECT r.*,v.empresa_id,v.endereco_entrega,v.status FROM entrega_rastreamento r
        JOIN vendas v ON v.id=r.venda_id WHERE r.token_hash=$1 AND r.expira_em>NOW() AND v.status='SAIU_PARA_ENTREGA'`,
    [hash(token)],
  );
  if (!rows[0]) fail("Link expirado ou revogado.", 401);
  return rows[0];
}
async function position(db, token, data) {
  const point = validatePosition(data);
  const current = await driver(db, token);
  const { rowCount } = await db.query(
    `UPDATE entrega_rastreamento r SET latitude=$1,longitude=$2,precisao_m=$3,
        observado_em=$4,direcao=$5,velocidade=$6,atualizado_em=NOW() FROM vendas v
        WHERE r.venda_id=$7 AND r.token_hash=$8 AND r.expira_em>NOW() AND v.id=r.venda_id AND v.status='SAIU_PARA_ENTREGA'
        AND (r.observado_em IS NULL OR r.observado_em<$4)`,
    [
      point.latitude,
      point.longitude,
      point.precisao_m,
      point.observado_em,
      point.direcao,
      point.velocidade,
      current.venda_id,
      hash(token),
    ],
  );
  return { atualizada: rowCount === 1 };
}
async function route(db, current, fetcher = fetch) {
  const usesGps =
    current.latitude != null &&
    current.longitude != null &&
    current.atualizado_em &&
    current.observado_em &&
    Date.now() - new Date(current.atualizado_em).getTime() < 120000 &&
    Date.now() - new Date(current.observado_em).getTime() < 120000;
  // A primeira posição substitui imediatamente uma rota antes calculada da loja.
  if (
    current.rota &&
    current.rota_solicitada_em &&
    Date.now() - new Date(current.rota_solicitada_em).getTime() < 30000 &&
    (!usesGps || current.rota.origem_gps_observado_em)
  )
    return current.rota;
  if (!process.env.GOOGLE_MAPS_API_KEY || !process.env.DELIVERY_ORIGIN_ADDRESS)
    fail("Mapa ainda não configurado.", 503);
  const address = current.endereco_entrega;
  if (!address) fail("Pedido sem endereço de entrega congelado.", 409);
  const origin = usesGps
    ? {
        location: {
          latLng: { latitude: current.latitude, longitude: current.longitude },
        },
      }
    : { address: process.env.DELIVERY_ORIGIN_ADDRESS };
  let response;
  try {
    response = await fetcher(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters",
        },
        body: JSON.stringify({
          origin,
          destination: {
            address: [
              address.endereco,
              address.numero,
              address.bairro,
              address.cidade,
              address.estado,
              address.cep,
              "Brasil",
            ].join(", "),
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          languageCode: "pt-BR",
          units: "METRIC",
        }),
      },
    );
  } catch {
    fail("Rota temporariamente indisponível.", 503);
  }
  if (!response.ok) fail("Rota temporariamente indisponível.", 503);
  const result = (await response.json()).routes?.[0];
  if (!result?.polyline) fail("Rota não encontrada.", 502);
  // Vincula a distância ao instante da posição usada como origem, não ao endereço da loja.
  result.origem_gps_observado_em = usesGps
    ? new Date(current.observado_em).toISOString()
    : null;
  await db.query(
    "UPDATE entrega_rastreamento SET rota=$1,rota_solicitada_em=NOW() WHERE venda_id=$2 AND token_hash=$3",
    [result, current.venda_id, current.token_hash],
  );
  return result;
}
function publicData(current) {
  return {
    venda_id: current.venda_id,
    latitude: current.latitude,
    longitude: current.longitude,
    precisao_m: current.precisao_m,
    direcao: current.direcao,
    velocidade: current.velocidade,
    atualizado_em: current.atualizado_em,
    antiga:
      !current.atualizado_em ||
      Date.now() - new Date(current.atualizado_em).getTime() > 30000,
  };
}
function navigationUrl(current) {
  const address = current.endereco_entrega;
  if (!address || typeof address !== "object") return null;
  const destination = [
    "endereco",
    "numero",
    "bairro",
    "cidade",
    "estado",
    "cep",
  ]
    .map((field) =>
      typeof address[field] === "string" ? address[field].trim() : "",
    )
    .filter(Boolean)
    .join(", ");
  if (!destination) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({
    api: "1",
    destination: destination + ", Brasil",
    travelmode: "driving",
    dir_action: "navigate",
  }).toString();
  return url.toString();
}
module.exports = {
  hash,
  validatePosition,
  createLink,
  driver,
  position,
  route,
  publicData,
  navigationUrl,
};
