import { useLayoutEffect, useRef } from 'react';
import katex from 'katex';
import { limitedMathParts } from '../lib/limitedMath';

function MathNode({ value, source, display }: { value: string; source: string; display: boolean }) {
  const container = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = container.current;
    if (!target) return;
    try {
      katex.render(value, target, { displayMode: display, throwOnError: true, trust: false, output: 'htmlAndMathml' });
    } catch {
      target.textContent = source;
    }
  }, [value, source, display]);
  return <span className={display ? 'insight-math-display' : 'insight-math-inline'} ref={container} />;
}

export function LimitedMath({ text }: { text: string }) {
  return limitedMathParts(text).map((part, index) => part.kind === 'text'
    ? part.value
    : <MathNode key={`${index}-${part.source}`} {...part} />);
}
