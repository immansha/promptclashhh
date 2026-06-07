import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
    "./src/store/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        quiet: "#667085",
        panel: "#ffffff",
        field: "#f7f9fc",
        line: "#d8dee9",
        teal: "#147d75",
        coral: "#c85542",
        gold: "#b7791f",
      },
      boxShadow: {
        soft: "0 24px 70px rgba(23, 32, 51, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
