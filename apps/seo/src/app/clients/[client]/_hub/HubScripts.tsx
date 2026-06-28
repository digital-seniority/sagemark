"use client";

/**
 * HubScripts — client-side behaviour for the branded hub (Slice 9).
 *
 * Ported from the Whispering Willows demo's app.js:
 *   - Mobile nav toggle (show/hide #hub-nav on small screens)
 *   - Scroll-reveal (IntersectionObserver, .hub-reveal → .hub-revealed)
 *   - Print button clicks (window.print())
 *
 * This component renders null markup; it only registers event listeners.
 * The `"use client"` boundary ensures it runs only in the browser.
 */

import { useEffect } from "react";

export function HubScripts() {
  useEffect(() => {
    // Mobile nav toggle
    const toggle = document.getElementById("hub-nav-toggle");
    const nav = document.getElementById("hub-nav");
    if (toggle && nav) {
      // Show toggle on small screens via JS (CSS would require a media query in <style>)
      const mq = window.matchMedia("(max-width: 640px)");
      const updateNav = (matches: boolean) => {
        toggle.style.display = matches ? "block" : "none";
        if (!matches) nav.style.display = "flex";
      };
      updateNav(mq.matches);
      mq.addEventListener("change", (e) => updateNav(e.matches));

      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!open));
        nav.style.display = open ? "none" : "flex";
        nav.style.flexDirection = "column";
        nav.style.position = "absolute";
        nav.style.top = "60px";
        nav.style.left = "0";
        nav.style.right = "0";
        nav.style.background = "var(--brand-color, #3d5446)";
        nav.style.padding = "1rem";
      });
    }

    // Scroll-reveal
    const reveals = document.querySelectorAll<HTMLElement>(".hub-reveal");
    if (reveals.length > 0 && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              (e.target as HTMLElement).classList.add("hub-revealed");
              io.unobserve(e.target);
            }
          }
        },
        { threshold: 0.1 },
      );
      reveals.forEach((el) => io.observe(el));
      return () => io.disconnect();
    }
  }, []);

  return null;
}
