interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
}

export const Menu = ({ size = 21, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export const Plus = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Send = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const Stop = ({ size = 17, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);

export const Mic = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const Image = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
  </svg>
);

export const Sparkle = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9zM18.5 16l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
  </svg>
);

export const Close = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const Trash = ({ size = 17, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
);

export const Chat = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
);

export const Note = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const Check = ({ size = 15, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 12.5 9 17.5 20 6.5" />
  </svg>
);

export const Calendar = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const Clock = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.5l3.5 2" />
  </svg>
);

export const Folder = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const Layers = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />
  </svg>
);

export const Settings = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3.3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1.3z" />
  </svg>
);

export const Play = ({ size = 18, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M7 4.5 19 12 7 19.5z" fill="currentColor" />
  </svg>
);

export const Speaker = ({ size = 17, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
  </svg>
);

export const Copy = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

export const Download = ({ size = 17, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16" />
  </svg>
);

export const Refresh = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M20 11a8 8 0 1 0-.5 4M20 5v6h-6" />
  </svg>
);

export const Code = ({ size = 17, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m9 8-5 4 5 4M15 8l5 4-5 4" />
  </svg>
);

export const Eye = ({ size = 17, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const Back = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const Cloud = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M17.5 19a4.5 4.5 0 0 0 .6-8.96 6 6 0 0 0-11.6-1.3A4 4 0 0 0 7 19z" />
  </svg>
);

export const User = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
);

export const Shield = ({ size = 19, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 3.2 19 6v5.4c0 4.2-2.8 7.6-7 9.4-4.2-1.8-7-5.2-7-9.4V6z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </svg>
);
