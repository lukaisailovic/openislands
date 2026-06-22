import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      url: "/",
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img src="/logo-light.svg" alt="" width={22} height={22} />
          {appName}
        </span>
      ),
    },
    // GitHub lives in the top nav (not the sidebar footer, whose lone social bar would
    // otherwise render as a big empty box once the theme toggle is disabled).
    links: [
      {
        type: "icon",
        label: "GitHub",
        icon: (
          <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
            <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.2 11.19.6.11.82-.25.82-.56v-2.18c-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.71.08-.71 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.81 0-1.28.47-2.33 1.24-3.15-.13-.3-.54-1.51.12-3.15 0 0 1.01-.32 3.3 1.2.96-.26 1.98-.39 3-.39 1.02 0 2.04.13 3 .39 2.29-1.52 3.3-1.2 3.3-1.2.66 1.64.25 2.85.12 3.15.77.82 1.24 1.87 1.24 3.15 0 4.51-2.81 5.5-5.49 5.79.43.36.81 1.08.81 2.18v3.23c0 .31.21.68.83.56C20.56 21.91 24 17.5 24 12.29 24 5.78 18.63.5 12 .5Z" />
          </svg>
        ),
        text: "GitHub",
        url: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
        external: true,
      },
    ],
    // Dark-only — no theme toggle in the nav (matches the runtime's dark-only render).
    themeSwitch: { enabled: false },
  };
}
