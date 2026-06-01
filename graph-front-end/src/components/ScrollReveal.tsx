import React, { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  animation?: 'fade-up' | 'fade-down' | 'slide-left' | 'slide-right' | 'scale';
  delay?: number;
  duration?: number;
  threshold?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function ScrollReveal({
  children,
  animation = 'fade-up',
  delay = 0,
  duration = 600,
  threshold = 0.1,
  className = '',
  style = {},
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      {
        threshold,
        rootMargin: '0px 0px -50px 0px',
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);

  const animClass = (() => {
    switch (animation) {
      case 'fade-up': return 'scroll-reveal';
      case 'fade-down': return 'scroll-reveal'; // uses base fade, could be extended
      case 'slide-left': return 'scroll-reveal from-right';
      case 'slide-right': return 'scroll-reveal from-left';
      case 'scale': return 'scroll-reveal scale-up';
      default: return 'scroll-reveal';
    }
  })();

  return (
    <div
      ref={ref}
      className={`${animClass} ${revealed ? 'revealed' : ''} ${className}`}
      style={{
        ...style,
        transitionDelay: `${delay}ms`,
        transitionDuration: `${duration}ms`,
      }}
    >
      {children}
    </div>
  );
}
