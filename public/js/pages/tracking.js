"use strict";
(async()=>{
    const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
    const driver=!params.get("pedido"),admin=params.get("admin")==="1";
    const privateToken=driver?location.hash.slice(1):null;
    if(driver)history.replaceState(null,"",location.pathname);
    const bearer=sessionStorage.getItem(admin?"token":"petflow_customer_token");
    const endpoint=driver?"entregador":(admin?"admin/":"cliente/")+encodeURIComponent(params.get("pedido"));
    let map,vehicle,destination,startMarker,line,lastData,bounds,watch=null,lastPosition=null,started=false,voice=false,lastInstruction="",sending=false,loading=false;
    async function api(path,method="GET",body){
        const response=await fetch("/api/entregas/"+path,{method,headers:{"Content-Type":"application/json",Authorization:driver?"Delivery "+privateToken:"Bearer "+bearer},body:body?JSON.stringify(body):undefined});
        const result=await response.json();if(!response.ok)throw new Error(result.message||"Entrega indisponível.");return result;
    }
    function center(){if(map&&lastData?.latitude!=null)map.panTo({lat:lastData.latitude,lng:lastData.longitude});}
    function draw(data){
        lastData=data;
        $("updated").textContent=data.atualizado_em?"Última posição: "+new Date(data.atualizado_em).toLocaleTimeString("pt-BR"):"Aguardando posição do entregador.";
        $("status").textContent=data.antiga?"Posição antiga ou ainda não recebida.":driver?"Compartilhamento ativo.":"Entregador a caminho.";
        if(data.erro_rota)$("status").textContent+=" "+data.erro_rota;
        if(!map)return;
        if(data.latitude!=null){
            const point={lat:data.latitude,lng:data.longitude};
            if(!vehicle)vehicle=new google.maps.Marker({map,position:point,title:"Entregador"});
            vehicle.setPosition(point);vehicle.setIcon({path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:6,rotation:data.direcao||0,fillColor:"#08715f",fillOpacity:1,strokeColor:"#fff",strokeWeight:2});
        }
        const route=data.rota;if(!route)return;
        const path=google.maps.geometry.encoding.decodePath(route.polyline.encodedPolyline);
        if(!line)line=new google.maps.Polyline({map,strokeColor:"#1976ed",strokeOpacity:1,strokeWeight:6});line.setPath(path);
        bounds=new google.maps.LatLngBounds();path.forEach(point=>bounds.extend(point));
        const leg=route.legs?.[0],end=leg?.endLocation?.latLng,origin=leg?.startLocation?.latLng;
        if(end&&!destination)destination=new google.maps.Marker({map,position:{lat:end.latitude,lng:end.longitude},label:"D",title:"Destino"});
        if(origin&&!startMarker)startMarker=new google.maps.Marker({map,position:{lat:origin.latitude,lng:origin.longitude},label:"P",title:"Partida"});
        const seconds=Number(String(route.duration||"0s").replace("s","")),eta=new Date(Date.now()+seconds*1000);
        $("metrics").textContent=(route.distanceMeters/1000).toFixed(1)+" km · "+Math.ceil(seconds/60)+" min · Chegada prevista "+eta.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})+(driver&&data.velocidade!=null?" · "+Math.round(data.velocidade*3.6)+" km/h":"");
        const instruction=leg?.steps?.find(step=>step.navigationInstruction?.instructions)?.navigationInstruction.instructions||"Siga a rota indicada.";
        $("instruction").textContent=instruction;
        if(voice&&instruction!==lastInstruction){speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(instruction);speech.lang="pt-BR";speechSynthesis.speak(speech);}
        lastInstruction=instruction;
        if(!map.initialBounds){map.fitBounds(bounds);map.initialBounds=true;}
    }
    async function poll(){if(loading||document.hidden)return;loading=true;try{draw((await api(endpoint)).data);}catch(error){$("status").textContent=error.message;}finally{loading=false;}}
    function watchPosition(){
        if(!driver||!started||document.hidden||watch!==null)return;
        watch=navigator.geolocation.watchPosition(position=>{
            lastPosition={latitude:position.coords.latitude,longitude:position.coords.longitude,precisao_m:position.coords.accuracy,observado_em:position.timestamp,direcao:position.coords.heading,velocidade:position.coords.speed};
        },error=>{$("status").textContent=error.code===1?"Permita o acesso à localização para compartilhar.":"Não foi possível obter uma posição confiável.";},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    }
    async function sendPosition(){
        if(!driver||!started||document.hidden||!lastPosition||sending)return;sending=true;
        try{await api("entregador/localizacao","POST",lastPosition);}catch(error){$("status").textContent=error.message;}finally{sending=false;}
    }
    $("start").hidden=!driver;$("stop").hidden=true;$("voice").hidden=!driver;$("privacy").hidden=!driver;
    $("start").onclick=()=>{if(!navigator.geolocation){$("status").textContent="Seu navegador não oferece localização.";return;}started=true;$("start").hidden=true;$("stop").hidden=false;watchPosition();};
    $("stop").onclick=async()=>{started=false;if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;speechSynthesis.cancel();try{await api("entregador","DELETE");$("status").textContent="Compartilhamento encerrado. Solicite um novo link para reiniciar.";$("stop").disabled=true;}catch(error){$("status").textContent=error.message;}};
    $("center").onclick=center;$("route").onclick=()=>{if(map&&bounds)map.fitBounds(bounds);};
    $("voice").onclick=()=>{voice=!voice;$("voice").textContent=voice?"Desativar voz":"Ativar voz";if(!voice)speechSynthesis.cancel();};
    $("fullscreen").onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.().catch(()=>{});
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}else watchPosition();});
    try{
        const config=await api("config");
        if(config.key){
            await new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(config.key)+"&libraries=geometry";script.onload=resolve;script.onerror=reject;document.head.append(script);});
            map=new google.maps.Map($("map"),{zoom:15,center:{lat:0,lng:0},mapTypeControl:false,streetViewControl:false});
        }else $("status").textContent="Mapa não configurado pela loja.";
        await poll();setInterval(poll,5000);if(driver)setInterval(sendPosition,5000);
    }catch{$("status").textContent="Não foi possível carregar o mapa. Verifique a conexão.";}
})();
