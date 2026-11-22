// Valbury Brand Mark (Stylized 'V' monogram with financial momentum)
// Renders with currentColor for dark/light theme support.
export function ValburyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 40" role="img" fill="none" className={className}>
      <title>Valbury</title>
      {/* Left arm of the stylized V */}
      <path
        d="M2 3H12.5L22.5 33H14.5L2 3Z"
        fill="currentColor"
      />
      {/* Right arm of the stylized V */}
      <path
        d="M42 3H31L17.5 39H25.5L42 3Z"
        fill="currentColor"
      />
      {/* Golden growth diamond accent */}
      <path
        d="M27.5 11.5L30 6L32.5 11.5L30 17Z"
        fill="#f59e0b"
      />
    </svg>
  );
}

export const LuxAlgoMark = ValburyMark;
