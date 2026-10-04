/**
 * Tiny scripts inlined in <head> by RootDocument (a server component): they run before the
 * first paint. Plain module, no "use client", so the server gets the strings themselves.
 */
export const MODE_KEY = "henine.mode.v1";
export const DESIGN_KEY = "henine.design.v3";

/** The saved light / dark choice ("auto" needs nothing: the CSS follows the phone). */
export const MODE_BOOT = `try{var m=localStorage.getItem("${MODE_KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;

/**
 * The store's remembered colours and fonts (Admin → Apparence), no flash of the defaults.
 * Every font is self-hosted (lib/fonts.ts): the saved CSS only switches CSS variables.
 */
export const THEME_BOOT = `try{var d=JSON.parse(localStorage.getItem("${DESIGN_KEY}")||"null");if(d){if(d.css){var s=document.createElement("style");s.id="henine-theme";s.textContent=d.css;document.head.appendChild(s)}}}catch(e){}`;
