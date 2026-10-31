import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const make = (children: ReactNode) =>
  function Icon({ size = 16, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        {children}
      </svg>
    );
  };

export const IconPointer = make(<path d="M5 3l14 7-6 2-2 6z" />);
export const IconEllipse = make(<><ellipse cx="12" cy="12" rx="9" ry="6" /><path d="M12 9v6M9 12h6" /></>);
export const IconArrow = make(<><path d="M4 18L18 6" /><path d="M10 6h8v8" /></>);
/** Curved double-headed arrow (covariance). */
export const IconCorrelate = make(<><path d="M5 17C5 8 19 8 19 17" /><path d="M2.5 14.5L5 17l2.5-2.5M16.5 14.5L19 17l2.5-2.5" /></>);
/** Error term: small circle with an arrow. */
export const IconErrorTerm = make(<><circle cx="6" cy="6" r="3.5" /><path d="M8.5 8.5L15 15" /><path d="M10.5 15H15v-4.5" /><rect x="14" y="16" width="7" height="5" rx="1" /></>);
export const IconUndo = make(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>);
export const IconRedo = make(<><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>);
export const IconOpen = make(<><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></>);
export const IconNew = make(<><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M12 11v6M9 14h6" /></>);
export const IconUpload = make(<><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>);
export const IconPlay = make(<path d="M7 4l13 8-13 8z" />);
export const IconRepeat = make(<><path d="M17 2l4 4-4 4" /><path d="M3 12V9a3 3 0 013-3h15M7 22l-4-4 4-4" /><path d="M21 12v3a3 3 0 01-3 3H3" /></>);
export const IconLayout = make(<><rect x="3" y="4" width="6" height="5" rx="1" /><rect x="15" y="4" width="6" height="5" rx="1" /><rect x="9" y="15" width="6" height="5" rx="1" /><path d="M6 9v3h12V9M12 12v3" /></>);
export const IconTrash = make(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></>);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconSwap = make(<><path d="M7 4L3 8l4 4M3 8h14" /><path d="M17 20l4-4-4-4M21 16H7" /></>);
export const IconAlert = make(<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>);
export const IconCheck = make(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>);
export const IconHelp = make(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17h.01" /></>);
export const IconInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IconChevronUp = make(<path d="M6 15l6-6 6 6" />);
export const IconCopy = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></>);
export const IconPencil = make(<><path d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17z" /><path d="M13.5 6.5l3 3" /></>);
export const IconDownload = make(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>);
export const IconEye = make(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconSparkle = make(<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />);
export const IconLogo = make(<><ellipse cx="7" cy="12" rx="4" ry="3" /><ellipse cx="17" cy="7" rx="4" ry="3" /><ellipse cx="17" cy="17" rx="4" ry="3" /><path d="M10.5 10.8l3-2M10.5 13.2l3 2" /></>);
export const IconShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>);
/** Indicator side of a construct: the box (construct) with a bold bar on that side. */
export function IconSide({ side, size = 16 }: { side: 'left' | 'top' | 'right' | 'bottom'; size?: number }) {
  const bar = { left: 'M3 6v12', right: 'M21 6v12', top: 'M6 3h12', bottom: 'M6 21h12' }[side];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
      <path d={bar} strokeWidth={3} />
    </svg>
  );
}
/** Fit view: the four corners of a frame. */
export const IconFitView = make(<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" />);
