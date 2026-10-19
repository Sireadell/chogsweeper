import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0c0916",
        panel: "#16112a",
        edge: "#2a2147",
        mute: "#9a93b8",
        chog: "#836ef9",
        mint: "#8bf5c0",
        boom: "#ff5d73",
      },
    },
  },
  plugins: [],
};
export default config;
