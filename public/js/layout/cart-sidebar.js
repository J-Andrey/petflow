"use strict";
(()=>{
    if(parent!==window||location.pathname==="/sacola")return;
    const link=document.createElement("link");link.rel="stylesheet";link.href="/css/pages/cart-sidebar.css";document.head.append(link);
    const dialog=document.createElement("dialog");dialog.className="petflow-bag";dialog.setAttribute("aria-label","Sacola de compras");
    const close=document.createElement("button");close.type="button";close.textContent="×";close.setAttribute("aria-label","Fechar sacola");
    const frame=document.createElement("iframe");frame.title="Sua sacola";
    close.onclick=()=>dialog.close();dialog.append(close,frame);document.body.append(dialog);
    dialog.addEventListener("click",event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left)dialog.close();}});
    document.addEventListener("click",event=>{
        const anchor=event.target.closest('a[href="/sacola"]');
        if(!anchor)return;event.preventDefault();frame.src="/sacola?sidebar=1";dialog.showModal();
    });
    window.addEventListener("message",event=>{
        if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
        if(event.data?.type==="petflow:cart-close")dialog.close();
        if(event.data?.type==="petflow:cart-update"){
            window.PetFlowPublicHeader?.update();
            window.dispatchEvent(new Event("petflow:cart-updated"));
        }
    });
})();
