"use strict";
(async () => {
  const $ = (id) => document.getElementById(id),
    params = new URLSearchParams(location.search);
  const driver = !params.get("pedido"),
    admin = params.get("admin") === "1";
  // Permite recarregar sem deixar o token na URL nem no armazenamento global.
  const privateToken = driver
    ? location.hash.slice(1) || history.state?.deliveryToken
    : null;
  if (driver)
    history.replaceState(
      privateToken ? { deliveryToken: privateToken } : null,
      "",
      location.pathname,
    );
  const bearer = sessionStorage.getItem(
    admin ? "token" : "petflow_customer_token",
  );
  const endpoint = driver
    ? "entregador"
    : (admin ? "admin/" : "cliente/") +
      encodeURIComponent(params.get("pedido"));
  let map,
    vehicle,
    destination,
    startMarker,
    line,
    lastData,
    bounds,
    watch = null,
    lastPosition = null;
  let started = false,
    closed = false,
    voice = false,
    lastInstruction = "",
    sending = false,
    loading = false;
  let lastSentAt = 0,
    lastSentObservation = null;
  let positionReceived,
    positionError,
    readingPosition = false;
  const gpsStatus = (message) => {
    $("gpsStatus").textContent = message;
  };
  const mapStatus = (message) => {
    $("mapStatus").textContent = message;
  };
  async function api(path, method = "GET", body) {
    const response = await fetch("/api/entregas/" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: driver ? "Delivery " + privateToken : "Bearer " + bearer,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(result.message || "Entrega indisponível."),
        { status: response.status },
      );
    return result;
  }
  function pointOnMap(point) {
    if (!map || point?.latitude == null || point?.longitude == null) return;
    try {
      const position = { lat: point.latitude, lng: point.longitude };
      if (!vehicle)
        vehicle = new google.maps.Marker({
          map,
          position,
          title: "Entregador",
        });
      vehicle.setPosition(position);
      vehicle.setIcon({
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 6,
        rotation: point.direcao || 0,
        fillColor: "#08715f",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      });
      if (!map.gpsCentered) {
        map.panTo(position);
        map.gpsCentered = true;
      }
    } catch {
      map = null;
      mapStatus(
        "O mapa não conseguiu exibir a posição. Use o link do Google Maps; o compartilhamento do GPS continua.",
      );
    }
  }
  function center() {
    if (map) {
      map.gpsCentered = false;
      pointOnMap(driver && lastPosition ? lastPosition : lastData);
    }
  }
  function draw(data) {
    lastData = data;
    $("updated").textContent = data.atualizado_em
      ? "Última posição compartilhada: " +
        new Date(data.atualizado_em).toLocaleTimeString("pt-BR")
      : "Aguardando posição do entregador.";
    $("status").textContent = data.antiga
      ? "Posição antiga ou ainda não recebida."
      : driver
        ? "Compartilhamento ativo."
        : "Entregador a caminho.";
    if (data.erro_rota)
      mapStatus(
        data.erro_rota + " O GPS pode continuar compartilhando a posição.",
      );
    if (driver && data.navegacao_url) {
      $("navigation").href = data.navegacao_url;
      $("navigation").hidden = false;
    }
    if (
      !driver &&
      Number.isFinite(data.latitude) &&
      Number.isFinite(data.longitude)
    ) {
      $("navigation").href =
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(data.latitude + "," + data.longitude);
      $("navigation").textContent = "Ver posição no Google Maps";
      $("navigation").hidden = false;
    }
    pointOnMap(driver && lastPosition ? lastPosition : data);
    const route = data.rota;
    if (!route) return;
    const seconds = Number(String(route.duration || "0s").replace("s", "")),
      eta = new Date(Date.now() + seconds * 1000);
    $("metrics").textContent =
      (route.distanceMeters / 1000).toFixed(1) +
      " km · " +
      Math.ceil(seconds / 60) +
      " min · Chegada prevista " +
      eta.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) +
      (driver && data.velocidade != null
        ? " · " + Math.round(data.velocidade * 3.6) + " km/h"
        : "");
    const leg = route.legs?.[0];
    const instruction =
      leg?.steps?.find((step) => step.navigationInstruction?.instructions)
        ?.navigationInstruction.instructions || "Siga a rota indicada.";
    $("instruction").textContent = instruction;
    if (voice && instruction !== lastInstruction && window.speechSynthesis) {
      speechSynthesis.cancel();
      const speech = new SpeechSynthesisUtterance(instruction);
      speech.lang = "pt-BR";
      speechSynthesis.speak(speech);
    }
    lastInstruction = instruction;
    if (!map || !route.polyline?.encodedPolyline) return;
    const path = google.maps.geometry.encoding.decodePath(
      route.polyline.encodedPolyline,
    );
    if (!line)
      line = new google.maps.Polyline({
        map,
        strokeColor: "#1976ed",
        strokeOpacity: 1,
        strokeWeight: 6,
      });
    line.setPath(path);
    bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));
    const end = leg?.endLocation?.latLng,
      origin = leg?.startLocation?.latLng;
    if (end && !destination)
      destination = new google.maps.Marker({
        map,
        position: { lat: end.latitude, lng: end.longitude },
        label: "D",
        title: "Destino",
      });
    if (origin) {
      const position = { lat: origin.latitude, lng: origin.longitude };
      if (!startMarker)
        startMarker = new google.maps.Marker({
          map,
          position,
          label: "P",
          title: "Partida",
        });
      else startMarker.setPosition(position);
    }
    if (!map.initialBounds && !(driver && lastPosition)) {
      map.fitBounds(bounds);
      map.initialBounds = true;
    }
  }
  function pauseGps() {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
    lastPosition = null;
  }
  async function poll() {
    if (loading || document.hidden || closed) return;
    loading = true;
    try {
      draw((await api(endpoint + (map ? "" : "?rota=0"))).data);
    } catch (error) {
      $("status").textContent = error.message;
      if (driver && error.status === 401) {
        closed = true;
        started = false;
        pauseGps();
        $("start").disabled = true;
      }
    } finally {
      loading = false;
    }
  }
  function watchPosition() {
    if (!driver || !started || closed || document.hidden || watch !== null)
      return;
    gpsStatus(
      "Obtendo sua localização. Permita o acesso quando o navegador solicitar.",
    );
    positionReceived = (position) => {
      if (!started || document.hidden) return;
      const coords = position.coords;
      if (
        !Number.isFinite(coords.accuracy) ||
        coords.accuracy > 200 ||
        Math.abs(Date.now() - position.timestamp) > 60000
      ) {
        gpsStatus(
          "GPS ainda impreciso ou antigo. Aguarde um sinal melhor com a localização precisa ativada.",
        );
        return;
      }
      lastPosition = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        precisao_m: coords.accuracy,
        observado_em: position.timestamp,
        direcao: Number.isFinite(coords.heading) ? coords.heading : null,
        velocidade: Number.isFinite(coords.speed) ? coords.speed : null,
      };
      gpsStatus(
        "GPS recebido · precisão de " +
          Math.round(coords.accuracy) +
          " m. Compartilhando...",
      );
      pointOnMap(lastPosition);
      void sendPosition();
    };
    positionError = (error) => {
      gpsStatus(
        error.code === 1
          ? "Localização bloqueada. Ative a permissão de localização deste site e tente iniciar novamente."
          : error.code === 3
            ? "O GPS demorou para responder. Confira a localização do aparelho e aguarde."
            : "GPS indisponível. Ative a localização precisa do aparelho e aguarde um sinal melhor.",
      );
      if (error.code === 1) {
        started = false;
        pauseGps();
        $("start").hidden = false;
        $("stop").hidden = true;
      }
    };
    watch = navigator.geolocation.watchPosition(
      positionReceived,
      positionError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  function refreshPosition() {
    if (
      !driver ||
      !started ||
      closed ||
      document.hidden ||
      readingPosition ||
      !navigator.geolocation?.getCurrentPosition ||
      (lastPosition && Date.now() - lastPosition.observado_em < 15000)
    )
      return;
    readingPosition = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        readingPosition = false;
        positionReceived(position);
      },
      (error) => {
        readingPosition = false;
        if (started && !document.hidden) positionError(error);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  async function sendPosition() {
    if (
      !driver ||
      !started ||
      closed ||
      document.hidden ||
      !lastPosition ||
      sending ||
      lastPosition.observado_em === lastSentObservation ||
      Date.now() - lastSentAt < 5000 ||
      Math.abs(Date.now() - lastPosition.observado_em) > 60000
    )
      return;
    sending = true;
    lastSentAt = Date.now();
    const point = lastPosition;
    try {
      await api("entregador/localizacao", "POST", point);
      lastSentObservation = point.observado_em;
      if (!started || document.hidden || closed) return;
      gpsStatus(
        "GPS compartilhado · precisão de " +
          Math.round(point.precisao_m) +
          " m.",
      );
      void poll();
    } catch (error) {
      if (!started || document.hidden || closed) return;
      gpsStatus(
        "GPS recebido, mas não enviado: " +
          error.message +
          " Tentaremos novamente.",
      );
    } finally {
      sending = false;
    }
  }
  $("start").hidden = !driver;
  $("stop").hidden = true;
  $("voice").hidden = !driver;
  $("privacy").hidden = !driver;
  $("gpsStatus").hidden = !driver;
  $("start").onclick = () => {
    if (window.isSecureContext === false) {
      gpsStatus(
        "Para usar o GPS no celular, abra este link em HTTPS. Endereços HTTP da rede local não permitem compartilhar localização.",
      );
      return;
    }
    if (!navigator.geolocation) {
      gpsStatus(
        "Seu navegador não oferece localização. Abra o link em um navegador atualizado no celular.",
      );
      return;
    }
    if (closed) return;
    started = true;
    $("start").hidden = true;
    $("stop").hidden = false;
    watchPosition();
  };
  $("stop").onclick = async () => {
    started = false;
    pauseGps();
    window.speechSynthesis?.cancel();
    try {
      await api("entregador", "DELETE");
      closed = true;
      history.replaceState(null, "", location.pathname);
      $("status").textContent =
        "Compartilhamento encerrado. Solicite um novo link para reiniciar.";
      gpsStatus("GPS encerrado.");
      $("stop").disabled = true;
    } catch (error) {
      gpsStatus(
        "GPS pausado. Não foi possível revogar o link: " +
          error.message +
          " Tente encerrar novamente.",
      );
    }
  };
  $("center").onclick = center;
  $("route").onclick = () => {
    if (map && bounds) map.fitBounds(bounds);
  };
  $("voice").onclick = () => {
    voice = !voice;
    $("voice").textContent = voice ? "Desativar voz" : "Ativar voz";
    if (!voice) window.speechSynthesis?.cancel();
  };
  $("fullscreen").onclick = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.().catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseGps();
      if (started)
        gpsStatus("GPS pausado enquanto esta página estiver em segundo plano.");
    } else {
      watchPosition();
      void poll();
    }
  });
  if (driver && !/^[a-f0-9]{64}$/.test(privateToken || "")) {
    closed = true;
    $("start").disabled = true;
    $("status").textContent =
      "Link de entrega inválido. Abra o link privado completo enviado pela loja.";
    return;
  }
  // GPS e consultas continuam funcionando quando Google Maps está indisponível.
  setInterval(poll, 5000);
  if (driver) {
    setInterval(sendPosition, 5000);
    setInterval(refreshPosition, 15000);
  }
  void poll();
  try {
    const config = await api("config");
    if (!config.key) {
      mapStatus(
        "Mapa indisponível nesta página. O GPS continua funcionando; use Abrir navegação para ver a rota no Google Maps.",
      );
      return;
    }
    window.gm_authFailure = () => {
      map = null;
      mapStatus(
        "Google Maps não autorizou este site. O GPS continua funcionando; use Abrir navegação.",
      );
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Tempo de carregamento excedido")),
        10000,
      );
      const script = document.createElement("script");
      script.src =
        "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(config.key) +
        "&libraries=geometry";
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Falha ao carregar mapa"));
      };
      document.head.append(script);
    });
    map = new google.maps.Map($("map"), {
      zoom: 15,
      center: { lat: 0, lng: 0 },
      mapTypeControl: false,
      streetViewControl: false,
    });
    if (lastData) draw(lastData);
    pointOnMap(lastPosition);
    void poll();
  } catch {
    mapStatus(
      "Não foi possível carregar o mapa. O GPS continua funcionando; use Abrir navegação e confira a conexão.",
    );
  }
})();
