export function getIframeScript(
  validateUrl: string,
  iframeParam: string,
  authCookieName: string,
  ssoCompleteMessage: string
): string {
  const paramGlue = validateUrl.includes("?") ? "&" : "?";
  const iframeSrc = `${validateUrl}${
    iframeParam ? paramGlue + iframeParam : ""
  }`;

  return `
(function(){
  if(document.cookie.includes('${authCookieName}')) return;
  var pResolve; window.__SSO_READY__ = new Promise(r=>pResolve=r);
  var f=document.createElement('iframe');f.style.display='none';f.src='${iframeSrc}';
  document.body.appendChild(f);
  window.addEventListener('message',function(e){
    if(e.data==='${ssoCompleteMessage}'){
      console.log('SSO iframe auth complete'); pResolve();
      // If you need to refresh the page after SSO:
      // window.location.reload();
    }
  });
  // Optional: Add a timeout or error handling for the iframe
  setTimeout(() => {
    // @ts-ignore __SSO_READY__ is a custom property
    if (window.__SSO_READY__ && !window.__SSO_READY__.isResolved) { // crude check if promise is still pending
        console.warn('SSO iframe timed out or did not send completion message.');
        pResolve(); // Resolve anyway to not block the app, or handle error
    }
  }, 15000); // 15 seconds timeout
})();`;
}
