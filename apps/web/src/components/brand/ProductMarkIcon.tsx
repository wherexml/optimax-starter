import type { SVGProps } from 'react'

export function ProductMarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" {...props}>
      <path
        d="M14 2.75 23 7.8v10.4l-9 7.05-9-7.05V7.8L14 2.75Z"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 16.3a6.1 6.1 0 0 1 11-4.85"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.58"
      />
      <path d="M14 14l5.2-4.55" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2.05" strokeWidth="1.7" />
      <circle cx="20.25" cy="8.45" r="1.35" fill="currentColor" stroke="none" opacity="0.78" />
      <circle cx="7.65" cy="18.05" r="1.15" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  )
}
