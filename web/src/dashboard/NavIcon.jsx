// Line icons for the console — its navigation, figures and buttons — drawn in
// the same 24px, 1.7-stroke style as the public pages (pages/Landing.jsx).
// They replace emoji, which each phone and desktop drew differently, and
// which no colour could be applied to.

const PATHS = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
    </>
  ),
  cases: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  register: (
    <>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3.5 20a6 6 0 0 1 12 0" />
      <path d="M18.5 8v6M15.5 11h6" />
    </>
  ),
  import: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  ),
  matches: (
    <>
      <path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2" />
      <circle cx="12" cy="10" r="2.8" />
      <path d="M7.8 17a4.8 4.8 0 0 1 8.4 0" />
    </>
  ),
  sightings: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  cci: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  grievances: <path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12z" />,
  patterns: (
    <>
      <circle cx="6" cy="6.5" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="9" cy="18" r="2.5" />
      <path d="M8.5 6.8l7 .9M6.6 9l1.8 6.6M16.3 9.9l-5.6 6.2" />
    </>
  ),
  mis: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 17v-5M12 17V6M17 17V9.5" />
    </>
  ),
  // A CCTV camera on its bracket.
  cctv: (
    <>
      <path d="M4 7.5 16.5 4l1.6 5.6L5.6 13.1z" />
      <path d="m18.1 9.6 2.4-.7" />
      <path d="M8.5 12.2 9.8 17H4.5M4.5 14.5v5" />
    </>
  ),
  audit: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  privacy: (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  fraud: (
    <>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h11.5l-2.2 4 2.2 4H5.5" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" />
    </>
  ),
  simulations: (
    <>
      <path d="M9 3.5h6M10 3.5v5.8L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.3V3.5" />
      <path d="M7.2 15h9.6" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  // Figures, buttons and the activity feed.
  missing: (
    <>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 9.6-5.7" />
      <circle cx="17.5" cy="16.5" r="3" />
      <path d="m21.5 20.5-1.9-1.9" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.5 20.5-4.8-4.8" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  upload: (
    <>
      <path d="M12 15.5v-11" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
};

export default function NavIcon({ name, className = 'h-5 w-5' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name] || PATHS.overview}
    </svg>
  );
}
