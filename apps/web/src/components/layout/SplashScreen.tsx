import { Blossom } from "@/components/ui/icons";

/**
 * Brand intro screen, shown once per browser tab (sessionStorage), for ~1 second before it
 * fades out. The markup is server-rendered so it is already visible in the very first paint,
 * and the whole 1s-hold-then-fade timing is a single CSS animation (`henine-splash-cycle`,
 * see globals.css) — not a JS setTimeout. CSS animations of opacity run on the compositor
 * and start the instant the stylesheet applies, so the duration stays accurate even while
 * the page is busy hydrating; a setTimeout here could fire late under that same load.
 * The only JS needed is a tiny inline <script> that decides, synchronously and before first
 * paint, whether to show it at all this session.
 */
export function SplashScreen() {
  return (
    <>
      <div id="henine-splash" className="henine-splash" aria-hidden="true">
        <div className="henine-splash-mark">
          <Blossom size={52} className="animate-bloom" />
        </div>
        <p className="henine-splash-word heading-display" dir="ltr">
          Henine Boutique
        </p>
        <span className="henine-splash-bar">
          <span className="henine-splash-bar-fill" />
        </span>
      </div>
      {/* Runs synchronously as the parser reaches it — before paint of anything below it. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{
            if (sessionStorage.getItem("henine.splash")) {
              var s=document.getElementById("henine-splash");
              if (s) s.style.display = "none";
            } else {
              sessionStorage.setItem("henine.splash", "1");
            }
          } catch(e) {}})();`,
        }}
      />
    </>
  );
}
