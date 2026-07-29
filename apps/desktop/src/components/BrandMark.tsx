interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="112" fill="#202925" />
      <path
        fill="#f5f6f1"
        d="M166 128h182v57h-45c-17 0-28 6-35 19l-20 37h83v54h-112l-24 44c-11 20-28 30-52 30h-29v-57h20c13 0 21-5 27-16l22-41h-72v-54h101l24-45c10-19 27-28 50-28Z"
      />
    </svg>
  );
}
