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
export const IconSave = make(<><path d="M5 3h11l4 4v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a1 1 0 011-1z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></>);
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
export const IconInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IconChevronUp = make(<path d="M6 15l6-6 6 6" />);
export const IconCopy = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></>);
export const IconDownload = make(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></>);
export const IconEye = make(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconSparkle = make(<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />);
export const IconLogo = make(<><ellipse cx="7" cy="12" rx="4" ry="3" /><ellipse cx="17" cy="7" rx="4" ry="3" /><ellipse cx="17" cy="17" rx="4" ry="3" /><path d="M10.5 10.8l3-2M10.5 13.2l3 2" /></>);
export const IconHome = make(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h5v-6h4v6h5V10" /></>);
export const IconShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>);
