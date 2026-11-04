/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Alfa Romeo Design System ───────────────────────────────────────
        ar: {
          red:        "#ba0816",   // Alfa Romeo Red — logo + accent lines ONLY
          "red-dark": "#8e0d25",   // Hover state for red CTAs
          navy:       "#1c1f2a",   // Deep Dark Navy — dark hero, nav bar
          dark:       "#292b35",   // Dark Navy — buttons, headings on light
          slate:      "#5d5e65",   // Mid Slate — secondary / disabled text
          light:      "#f4f4f4",   // Light Neutral — primary light surface
          offwhite:   "#dedede",   // Off-White — secondary light surface
          silver:     "#c4c4c4",   // Silver — borders and dividers
          white:      "#ffffff",   // Pure White — cards
          black:      "#000000",   // True Black — deepest hero surfaces
        },
        // ── Cloudflare brand (report content) ─────────────────────────────
        cf: {
          orange:        "#F6821F",
          "orange-dark": "#FF6633",
          "orange-light":"#FBAD41",
          "orange-pale": "#FEF3E2",
          navy:  "#1B1B1F",
          dark:  "#404040",
          teal:       "#00B0D1",
          "teal-light":"#7DD8EA",
          green:      "#00C853",
          red:        "#E53E3E",
          gray: {
            50:  "#FAFAF9",
            100: "#F5F5F4",
            200: "#E8E6E3",
            300: "#D4D0CA",
            400: "#A8A29E",
            500: "#78716C",
            600: "#57534E",
            700: "#44403C",
            800: "#292524",
            900: "#1C1917",
          },
        },
      },
      fontFamily: {
        sans:   ["Inter var", "Inter", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        "ar-label": "0.09375rem",  // 1.5px — AR micro label tracking
        "ar-hero":  "-0.105rem",   // -1.68px — AR hero headline tracking
      },
      screens: {
        print: { raw: "print" },
      },
    },
  },
  plugins: [],
};
