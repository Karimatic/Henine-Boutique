/**
 * Tiny scripts inlined in <head> by RootDocument (a server component): they run before the
 * first paint. Plain module, no "use client", so the server gets the strings themselves.
 */
export const MODE_KEY = "henine.mode.v1";
export const DESIGN_KEY = "henine.design.v2";

/** The saved light / dark choice ("auto" needs nothing: the CSS follows the phone). */
export const MODE_BOOT = `try{var m=localStorage.getItem("${MODE_KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;

/**
 * The store's remembered colours and fonts (Admin → Apparence), no flash of the defaults.
 * A chosen Google font: the connections are opened first, the stylesheet is added by script
 * (so it never blocks the first paint) and uses display=swap.
 */
export const THEME_BOOT = `try{var d=JSON.parse(localStorage.getItem("${DESIGN_KEY}")||"null");if(d){if(d.css){var s=document.createElement("style");s.id="henine-theme";s.textContent=d.css;document.head.appendChild(s)}if(d.font){["https://fonts.googleapis.com","https://fonts.gstatic.com"].forEach(function(h){var p=document.createElement("link");p.rel="preconnect";p.href=h;p.crossOrigin="";document.head.appendChild(p)});var l=document.createElement("link");l.id="henine-font";l.rel="stylesheet";l.href=d.font;document.head.appendChild(l)}}}catch(e){}`;
