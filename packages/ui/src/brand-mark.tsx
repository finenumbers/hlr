import type { CSSProperties, ReactElement } from 'react';

type BrandMarkProps = {
  title?: string;
  style?: CSSProperties;
};

/** Minimal shared brand text mark for scaffold pages. */
export function BrandMark({
  title = 'Finenumbers',
  style,
}: BrandMarkProps): ReactElement {
  return (
    <span
      style={{
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        ...style,
      }}
    >
      {title}
    </span>
  );
}
