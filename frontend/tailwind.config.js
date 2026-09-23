/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#13131B",
        panel: "#1B1B23",
        panel2: "#1F1F27",
        panel3: "#292932",
        primary: "#C0C1FF",
        secondary: "#ADC6FF",
        ink: "#E4E1ED",
        muted: "#C7C4D7",
        border: "#262B35",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
