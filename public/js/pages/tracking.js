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
    lineOutline,
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
  let suspended = false,
    lifecycleVersion = 0,
    gpsVersion = 0,
    pollVersion = 0,
    sendVersion = 0,
    stopping = false,
    mapLoading = false,
    mapAttempt = 0,
    mapScriptPromise = null,
    connectionError = "",
    followPosition = true;
  const requests = new Set(),
    timers = [];
  const connected = () => navigator.onLine !== false;
  const active = () => !closed && !suspended && !document.hidden;
  const optionalText = (id, text) => {
    if ($(id)) $(id).textContent = text;
  };
  function controlLabel(id, label) {
    const node = $(id);
    node.setAttribute?.("aria-label", label);
    const text = node.querySelector?.(".sr-only");
    if (text) text.textContent = label;
    else node.textContent = label;
  }
  function formatDistance(meters) {
    return meters < 1000
      ? Math.round(meters) + " m"
      : (meters / 1000).toLocaleString("pt-BR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }) + " km";
  }
  function maneuverIcon(id, maneuver) {
    const node = $(id);
    if (!node) return;
    let path = "M6 12h12",
      mirror = false;
    if (["STRAIGHT", "DEPART", "NAME_CHANGE"].includes(maneuver))
      path = "M12 21V3m-6 6 6-6 6 6";
    else if (/^(TURN|RAMP|FORK)_.*(LEFT|RIGHT)$/.test(maneuver)) {
      path = "M6 21v-9a6 6 0 0 1 6-6h9m-5-4 5 4-5 4";
      mirror = maneuver.endsWith("LEFT");
    } else if (/^UTURN_(LEFT|RIGHT)$/.test(maneuver)) {
      path = "M6 21V9a6 6 0 0 1 12 0v6m-4-4 4 4 4-4";
      mirror = maneuver.endsWith("LEFT");
    } else if (/^ROUNDABOUT_(LEFT|RIGHT)$/.test(maneuver)) {
      path = "M8 21v-5a6 6 0 1 1 9-7h5m-4-4 4 4-4 4";
      mirror = maneuver.endsWith("LEFT");
    } else if (maneuver === "MERGE") path = "M12 21V3m-6 6 6-6 6 6M3 19l9-7";
    node.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="' +
      path +
      '" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"' +
      (mirror ? ' transform="translate(24 0) scale(-1 1)"' : "") +
      "/></svg>";
  }
  const gpsStatus = (message) => {
    $("gpsStatus").textContent = message;
  };
  const mapStatus = (message) => {
    $("mapStatus").textContent = message;
  };
  async function api(path, method = "GET", body) {
    if (!connected())
      throw new Error("Sem conexão. Confira a internet do aparelho.");
    const controller = new AbortController();
    requests.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    try {
      const response = await fetch("/api/entregas/" + path, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: driver
            ? "Delivery " + privateToken
            : "Bearer " + bearer,
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
    } catch (error) {
      if (timedOut)
        throw new Error(
          "A conexão demorou para responder. Tentaremos novamente.",
        );
      if (error.name === "SyntaxError")
        throw new Error(
          "O servidor não respondeu corretamente. Tentaremos novamente.",
        );
      if (error.name === "TypeError")
        throw new Error(
          "Não foi possível conectar. Confira a internet; tentaremos novamente.",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }
  function invalidateRequests() {
    lifecycleVersion++;
    pollVersion++;
    sendVersion++;
    mapAttempt++;
    loading = sending = mapLoading = false;
    for (const controller of requests) controller.abort();
    requests.clear();
  }
  function clearRoute() {
    $("metrics").textContent = "";
    $("instruction").textContent = "Aguardando rota atualizada.";
    for (const id of ["distance", "duration", "arrival", "nextInstruction"])
      optionalText(id, "—");
    line?.setMap(null);
    lineOutline?.setMap(null);
    line = lineOutline = null;
    bounds = null;
    lastInstruction = "";
    maneuverIcon("maneuverIcon");
    maneuverIcon("nextManeuverIcon");
    window.speechSynthesis?.cancel();
  }
  function positionIsOld(data) {
    const observed = data?.atualizado_em
      ? new Date(data.atualizado_em).getTime()
      : NaN;
    return (
      !data ||
      data.antiga ||
      !Number.isFinite(observed) ||
      Date.now() - observed > 30000
    );
  }
  function renderStatus() {
    if (closed) return;
    const old = positionIsOld(lastData);
    $("status").textContent = !connected()
      ? "Sem conexão. O rastreamento será retomado ao reconectar." +
        (old ? " Posição antiga ou ainda não recebida." : "")
      : connectionError ||
        (old
          ? "Posição antiga ou ainda não recebida."
          : driver
            ? started && active()
              ? "Compartilhamento ativo."
              : "GPS pausado. Toque em Iniciar viagem para retomar."
            : "Entregador a caminho.");
    if (old || !connected() || connectionError) {
      clearRoute();
      optionalText("speed", "—");
      if (!driver && lastData?.latitude != null)
        controlLabel("navigation", "Ver última posição no Google Maps");
    }
  }
  function stopTimers() {
    while (timers.length) clearInterval(timers.pop());
  }
  function startTimers() {
    if (timers.length || !active()) return;
    timers.push(setInterval(poll, 5000));
    if (driver) {
      timers.push(setInterval(sendPosition, 5000));
      timers.push(setInterval(refreshPosition, 15000));
    }
  }
  function closeTracking(message) {
    closed = true;
    started = false;
    pauseGps();
    invalidateRequests();
    stopTimers();
    $("status").textContent = message;
    if (driver) {
      history.replaceState(null, "", location.pathname);
      $("start").disabled = true;
      $("stop").hidden = true;
      gpsStatus("GPS encerrado. Solicite um novo link à loja para reiniciar.");
    }
    clearRoute();
    optionalText("speed", "—");
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
        path: Number.isFinite(point.direcao)
          ? google.maps.SymbolPath.FORWARD_CLOSED_ARROW
          : google.maps.SymbolPath.CIRCLE,
        scale: 6,
        rotation: Number.isFinite(point.direcao) ? point.direcao : 0,
        fillColor: point.antiga ? "#6b7280" : "#3e86ff",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      });
      if (followPosition) map.panTo(position);
    } catch {
      map = null;
      mapStatus(
        "O mapa não conseguiu exibir a posição. Use o link do Google Maps; o compartilhamento do GPS continua.",
      );
    }
  }
  function center() {
    if (map) {
      followPosition = true;
      pointOnMap(driver && lastPosition ? lastPosition : lastData);
    }
  }
  function fitRoute() {
    if (!map || !bounds) return;
    const height = window.innerHeight || 800;
    map.fitBounds(bounds, {
      top: Math.min(190, Math.round(height * 0.26)),
      bottom: Math.min(230, Math.round(height * 0.3)),
      left: 36,
      right: 76,
    });
  }
  function draw(data) {
    lastData = data;
    $("updated").textContent = data.atualizado_em
      ? "Última posição compartilhada: " +
        new Date(data.atualizado_em).toLocaleTimeString("pt-BR")
      : "Aguardando posição do entregador.";
    renderStatus();
    if (data.erro_rota)
      mapStatus(
        data.erro_rota + " O GPS pode continuar compartilhando a posição.",
      );
    else if (map) mapStatus("");
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
      controlLabel(
        "navigation",
        positionIsOld(data)
          ? "Ver última posição no Google Maps"
          : "Ver posição no Google Maps",
      );
      $("navigation").hidden = false;
    }
    if (
      !driver &&
      !(Number.isFinite(data.latitude) && Number.isFinite(data.longitude))
    )
      $("navigation").hidden = true;
    const old = positionIsOld(data);
    pointOnMap(
      driver && lastPosition ? lastPosition : { ...data, antiga: old },
    );
    const speed =
      driver && lastPosition ? lastPosition.velocidade : data.velocidade;
    optionalText(
      "speed",
      !old && Number.isFinite(speed) ? String(Math.round(speed * 3.6)) : "—",
    );
    const route = data.rota;
    if (!route || old || !connected()) {
      clearRoute();
      return;
    }
    const seconds =
      typeof route.duration === "string" &&
      /^\d+(?:\.\d+)?s$/.test(route.duration)
        ? Number(route.duration.slice(0, -1))
        : NaN;
    const routeTime = new Date(
      route.origem_gps_observado_em || data.atualizado_em,
    ).getTime();
    if (
      !Number.isFinite(seconds) ||
      !Number.isFinite(route.distanceMeters) ||
      !Number.isFinite(routeTime)
    ) {
      clearRoute();
      return;
    }
    const eta = new Date(routeTime + seconds * 1000);
    const minutes = Math.max(
      0,
      Math.ceil((eta.getTime() - Date.now()) / 60000),
    );
    optionalText("distance", formatDistance(route.distanceMeters));
    optionalText("duration", minutes + " min");
    optionalText(
      "arrival",
      eta.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    );
    $("metrics").textContent =
      formatDistance(route.distanceMeters) +
      " · " +
      minutes +
      " min · Chegada prevista " +
      eta.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) +
      (driver && data.velocidade != null
        ? " · " + Math.round(data.velocidade * 3.6) + " km/h"
        : "");
    const leg = route.legs?.[0];
    const instructions = navigationInstructions(data);
    const instruction =
      instructions[0]?.instructions || "Siga a rota indicada.";
    optionalText("nextInstruction", instructions[1]?.instructions || "—");
    maneuverIcon("maneuverIcon", instructions[0]?.maneuver);
    maneuverIcon("nextManeuverIcon", instructions[1]?.maneuver);
    $("instruction").textContent = instruction;
    speakInstruction(instruction);
    lastInstruction = instruction;
    if (!map || !route.polyline?.encodedPolyline) return;
    try {
      const path = google.maps.geometry.encoding.decodePath(
        route.polyline.encodedPolyline,
      );
      if (!line) {
        lineOutline = new google.maps.Polyline({
          map,
          strokeColor: "#1468be",
          strokeOpacity: 1,
          strokeWeight: 13,
          zIndex: 1,
        });
        line = new google.maps.Polyline({
          map,
          strokeColor: "#17dcf3",
          strokeOpacity: 1,
          strokeWeight: 8,
          zIndex: 2,
        });
      }
      lineOutline.setPath(path);
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
        fitRoute();
        map.initialBounds = true;
      }
    } catch {
      map = null;
      vehicle = destination = startMarker = null;
      line = lineOutline = null;
      bounds = null;
      mapStatus(
        "O mapa não conseguiu exibir a rota. O GPS continua funcionando; use Abrir navegação.",
      );
    }
  }
  function pauseGps() {
    gpsVersion++;
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
    lastPosition = null;
    readingPosition = false;
    optionalText("speed", "—");
  }
  async function poll() {
    if (!active() || stopping) return;
    renderStatus();
    if (loading || !connected()) return;
    loading = true;
    const version = ++pollVersion,
      lifecycle = lifecycleVersion;
    try {
      const result = await api(endpoint + (map ? "" : "?rota=0"));
      if (
        version !== pollVersion ||
        lifecycle !== lifecycleVersion ||
        !active() ||
        stopping
      )
        return;
      connectionError = "";
      draw(result.data);
    } catch (error) {
      if (
        version !== pollVersion ||
        lifecycle !== lifecycleVersion ||
        !active() ||
        stopping
      )
        return;
      if (error.status === 401 || error.status === 403) {
        closeTracking(
          driver
            ? error.message
            : "Sessão encerrada. Entre novamente para acompanhar a entrega.",
        );
      } else {
        connectionError = error.message;
        renderStatus();
      }
    } finally {
      if (version === pollVersion) loading = false;
    }
  }
  function watchPosition() {
    if (!driver || !started || !active() || watch !== null) return;
    gpsStatus(
      "Obtendo sua localização. Permita o acesso quando o navegador solicitar.",
    );
    const version = gpsVersion;
    positionReceived = (position) => {
      if (version !== gpsVersion || !started || !active()) return;
      const coords = position.coords;
      if (
        !Number.isFinite(position.timestamp) ||
        !Number.isFinite(coords.latitude) ||
        Math.abs(coords.latitude) > 90 ||
        !Number.isFinite(coords.longitude) ||
        Math.abs(coords.longitude) > 180 ||
        !Number.isFinite(coords.accuracy) ||
        coords.accuracy < 0 ||
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
        direcao:
          Number.isFinite(coords.heading) &&
          coords.heading >= 0 &&
          coords.heading < 360
            ? coords.heading
            : null,
        velocidade:
          Number.isFinite(coords.speed) &&
          coords.speed >= 0 &&
          coords.speed <= 80
            ? coords.speed
            : null,
      };
      gpsStatus(
        "GPS recebido · precisão de " +
          Math.round(coords.accuracy) +
          (connected()
            ? " m. Compartilhando..."
            : " m. Sem conexão; aguardando a internet para compartilhar."),
      );
      pointOnMap(lastPosition);
      void sendPosition();
    };
    positionError = (error) => {
      if (version !== gpsVersion || !started || !active()) return;
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
    try {
      watch = navigator.geolocation.watchPosition(
        positionReceived,
        positionError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      positionError({ code: 1 });
    }
  }
  function refreshPosition() {
    if (
      !driver ||
      !started ||
      !active() ||
      readingPosition ||
      !navigator.geolocation?.getCurrentPosition ||
      (lastPosition && Date.now() - lastPosition.observado_em < 15000)
    )
      return;
    readingPosition = true;
    const version = gpsVersion,
      received = positionReceived,
      failed = positionError;
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (version !== gpsVersion) return;
          readingPosition = false;
          received(position);
        },
        (error) => {
          if (version !== gpsVersion) return;
          readingPosition = false;
          failed(error);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      readingPosition = false;
      failed({ code: 1 });
    }
  }
  async function sendPosition() {
    if (
      !driver ||
      !started ||
      !active() ||
      !connected() ||
      !lastPosition ||
      sending ||
      lastPosition.observado_em === lastSentObservation ||
      Date.now() - lastSentAt < 5000 ||
      Math.abs(Date.now() - lastPosition.observado_em) > 60000
    )
      return;
    sending = true;
    lastSentAt = Date.now();
    const point = lastPosition,
      version = ++sendVersion,
      lifecycle = lifecycleVersion;
    try {
      const result = await api("entregador/localizacao", "POST", point);
      if (
        version !== sendVersion ||
        lifecycle !== lifecycleVersion ||
        !started ||
        !active()
      )
        return;
      lastSentObservation = point.observado_em;
      if (result.data?.atualizada === false) {
        gpsStatus(
          "A posição enviada já foi substituída por uma leitura mais recente. Aguardando nova captura GPS.",
        );
        if (lastPosition === point) lastPosition = null;
        refreshPosition();
        void poll();
        return;
      }
      gpsStatus(
        "GPS compartilhado · precisão de " +
          Math.round(point.precisao_m) +
          " m.",
      );
      void poll();
    } catch (error) {
      if (
        version !== sendVersion ||
        lifecycle !== lifecycleVersion ||
        !started ||
        !active()
      )
        return;
      if (error.status === 401 || error.status === 403) {
        closeTracking(error.message);
        return;
      }
      gpsStatus(
        "GPS recebido, mas não enviado: " +
          error.message +
          " Tentaremos novamente.",
      );
    } finally {
      if (version === sendVersion) sending = false;
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
    if (closed || stopping || !active()) return;
    started = true;
    followPosition = true;
    $("start").hidden = true;
    $("stop").hidden = false;
    watchPosition();
    renderStatus();
  };
  $("stop").onclick = async () => {
    if (closed || stopping) return;
    stopping = true;
    $("stop").disabled = true;
    started = false;
    pauseGps();
    invalidateRequests();
    $("status").textContent = "Encerrando compartilhamento...";
    gpsStatus("GPS pausado enquanto encerramos o compartilhamento.");
    window.speechSynthesis?.cancel();
    try {
      await api("entregador", "DELETE");
      closeTracking(
        "Compartilhamento encerrado. Solicite um novo link para reiniciar.",
      );
      gpsStatus("GPS encerrado.");
    } catch (error) {
      if (error.status === 401 || error.status === 403)
        closeTracking(error.message);
      else {
        gpsStatus(
          "GPS pausado. Não foi possível revogar o link: " +
            error.message +
            " Tente encerrar novamente.",
        );
        $("start").hidden = false;
        $("stop").hidden = false;
        $("stop").disabled = false;
        renderStatus();
      }
    } finally {
      stopping = false;
    }
  };
  $("center").onclick = center;
  $("route").onclick = () => {
    if (map && bounds) {
      followPosition = false;
      fitRoute();
    }
  };
  $("voice").onclick = () => {
    voice = !voice;
    const label = voice ? "Desativar voz" : "Ativar voz";
    controlLabel("voice", label);
    $("voice").setAttribute?.("aria-pressed", String(voice));
    if (!voice) window.speechSynthesis?.cancel();
    else if (!positionIsOld(lastData) && connected()) {
      const instruction =
        navigationInstructions(lastData)[0]?.instructions ||
        "Siga a rota indicada.";
      speakInstruction(instruction, true);
      lastInstruction = instruction;
    }
  };
  $("fullscreen").onclick = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.().catch(() => {});
  function suspendPage() {
    if (suspended) return;
    suspended = true;
    pauseGps();
    invalidateRequests();
    stopTimers();
    window.speechSynthesis?.cancel();
    if (started)
      gpsStatus("GPS pausado enquanto esta página estiver em segundo plano.");
    renderStatus();
  }
  function resumePage() {
    if (closed || document.hidden) return;
    suspended = false;
    connectionError = "";
    lastSentAt = 0;
    startTimers();
    watchPosition();
    void poll();
    void loadMap();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspendPage();
    else resumePage();
  });
  function navigationInstructions(data) {
    return (
      data?.rota?.legs?.[0]?.steps
        ?.map((step) => step.navigationInstruction)
        .filter((step) => step?.instructions) || []
    );
  }
  function speakInstruction(instruction, force = false) {
    if (!voice || !instruction || !window.speechSynthesis) return;
    if (!force && instruction === lastInstruction) return;
    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(instruction);
    speech.lang = "pt-BR";
    speechSynthesis.speak(speech);
  }
  window.addEventListener("pagehide", suspendPage);
  window.addEventListener("pageshow", resumePage);
  window.addEventListener("offline", () => {
    invalidateRequests();
    renderStatus();
    if (driver && started)
      gpsStatus(
        "Sem conexão. O GPS pode captar a posição, mas o compartilhamento aguarda a internet.",
      );
  });
  window.addEventListener("online", () => {
    invalidateRequests();
    pauseGps();
    resumePage();
  });
  if (driver && !/^[a-f0-9]{64}$/.test(privateToken || "")) {
    closed = true;
    $("start").disabled = true;
    $("status").textContent =
      "Link de entrega inválido. Abra o link privado completo enviado pela loja.";
    return;
  }
  // GPS e consultas continuam funcionando quando Google Maps está indisponível.
  startTimers();
  void poll();
  async function loadMap() {
    if (map || mapLoading || !active() || !connected()) return;
    mapLoading = true;
    const attempt = ++mapAttempt;
    try {
      const config = await api("config");
      if (attempt !== mapAttempt || !active()) return;
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
      if (!mapScriptPromise) {
        const scriptPromise = new Promise((resolve, reject) => {
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
        mapScriptPromise = scriptPromise.catch((error) => {
          if (mapScriptPromise === scriptPromise) mapScriptPromise = null;
          throw error;
        });
      }
      await mapScriptPromise;
      if (attempt !== mapAttempt || !active()) return;
      map = new google.maps.Map($("map"), {
        zoom: 15,
        center: { lat: 0, lng: 0 },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: false,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#18334e" }] },
          {
            elementType: "labels.text.stroke",
            stylers: [{ color: "#18334e" }],
          },
          { elementType: "labels.text.fill", stylers: [{ color: "#b4c2d2" }] },
          {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#617795" }],
          },
          {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#0d243a" }],
          },
          { featureType: "poi", stylers: [{ visibility: "off" }] },
        ],
      });
      map.addListener?.("dragstart", () => {
        followPosition = false;
      });
      vehicle = destination = startMarker = null;
      line = lineOutline = null;
      if (lastData) draw(lastData);
      pointOnMap(lastPosition);
      void poll();
    } catch {
      if (attempt === mapAttempt && active())
        mapStatus(
          "Não foi possível carregar o mapa. O GPS continua funcionando; use Abrir navegação e confira a conexão.",
        );
    } finally {
      if (attempt === mapAttempt) mapLoading = false;
    }
  }
  await loadMap();
})();
