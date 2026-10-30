/** The thin × used on every close button (panels, find bar, tabs), drawn so it matches the title
 * bar's and doesn't depend on the font. */
export const CloseGlyph = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 10 10" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
  </svg>
);
